import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import type { HumanoidColors, HumanoidState } from './Humanoid';
import { damp } from '../core/noise';

/** Common interface of every animated person (glTF character or procedural fallback). */
export interface Avatar {
  readonly root: THREE.Group;
  turnRate: number;
  update(dt: number, s: HumanoidState): void;
  setColors(c: HumanoidColors): void;
  setGlow(v: number): void;
}

export type BodyKind = 'human_male' | 'human_female' | 'suit_body';

/** Which model provides the locomotion clips for each body. */
const CLIP_SOURCE: Record<BodyKind, BodyKind> = { human_male: 'human_male', human_female: 'suit_body', suit_body: 'suit_body' };
const CLIP_NAMES: Record<string, { idle: string; walk: string; run: string }> = {
  human_male: { idle: 'Idle', walk: 'Walk', run: 'Run' },
  suit_body: { idle: 'idle', walk: 'walk', run: 'run' },
};

const retargetCache = new Map<string, THREE.AnimationClip>();

/** Local rest quaternions of every bone of a model (bind pose). */
function restPose(root: THREE.Object3D): Map<string, THREE.Quaternion> {
  const m = new Map<string, THREE.Quaternion>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) m.set(o.name, o.quaternion.clone()); });
  return m;
}

/**
 * Retargets a Mixamo clip between Mixamo rigs whose bind orientations differ:
 * q_target = rest_target · rest_source⁻¹ · q_source. Position tracks are dropped (rig scales differ).
 */
function retarget(clip: THREE.AnimationClip, srcRest: Map<string, THREE.Quaternion>, dstRest: Map<string, THREE.Quaternion>, key: string): THREE.AnimationClip {
  const hit = retargetCache.get(key);
  if (hit) return hit;
  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion();
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    if (prop !== 'quaternion') continue;
    const s = srcRest.get(bone), d = dstRest.get(bone);
    if (!s || !d) continue;
    const corr = d.clone().multiply(s.clone().invert());
    const values = new Float32Array(t.values.length);
    for (let i = 0; i < t.values.length; i += 4) {
      q.fromArray(t.values as unknown as number[], i);
      q.premultiply(corr);
      q.toArray(values as unknown as number[], i);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times as unknown as number[], values as unknown as number[]));
  }
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  retargetCache.set(key, out);
  return out;
}

const restCache = new Map<string, Map<string, THREE.Quaternion>>();

/**
 * Rigged, skinned glTF character driven by an AnimationMixer (idle/walk/run blended by speed)
 * with procedural bone aiming on top for jumps, superhero flight, casting, punches and panic.
 */
export class CharacterModel implements Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private model: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private run: THREE.AnimationAction;
  private air: THREE.AnimationAction;
  private bones = new Map<string, THREE.Bone>();
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseColors: THREE.Color[] = [];
  private flyBlend = 0;
  private airBlend = 0;
  private pitch = 0;
  private bank = 0;
  private t = Math.random() * 10;
  turnRate = 0;
  readonly kind: BodyKind;

  static available(assets: Assets | null, kind: BodyKind): boolean {
    return !!assets && assets.has(kind) && assets.has(CLIP_SOURCE[kind]);
  }

  constructor(assets: Assets, kind: BodyKind, opts: { height?: number; castShadow?: boolean } = {}) {
    this.kind = kind;
    this.model = assets.character(kind)!;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if (m.isMesh) {
        m.castShadow = opts.castShadow ?? true;
        m.receiveShadow = false;
        m.frustumCulled = false; // skinned bounds are unreliable once animated
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
        m.material = Array.isArray(m.material) ? mats : mats[0];
        for (const mm of mats) { this.mats.push(mm); this.baseColors.push(mm.color.clone()); }
      }
    });
    // Normalise height and facing (+Z forward, feet at y = 0).
    this.model.updateMatrixWorld(true);
    const head = this.bones.get('mixamorigHeadTop_End') ?? this.bones.get('mixamorigHead');
    const foot = this.bones.get('mixamorigLeftToeBase') ?? this.bones.get('mixamorigLeftFoot');
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.8, 0);
    const fp = foot ? foot.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const scale = (opts.height ?? 1.78) / Math.max(0.1, hp.y - Math.min(fp.y, 0));
    this.model.scale.multiplyScalar(scale);
    const la = this.bones.get('mixamorigLeftArm')?.getWorldPosition(new THREE.Vector3());
    const ra = this.bones.get('mixamorigRightArm')?.getWorldPosition(new THREE.Vector3());
    // Facing +Z means the character's left side is at +X.
    if (la && ra && la.x < ra.x) this.model.rotation.y += Math.PI;
    this.body.add(this.model);
    this.root.add(this.body);

    // Animations
    this.mixer = new THREE.AnimationMixer(this.model);
    const src = CLIP_SOURCE[kind];
    const names = CLIP_NAMES[src];
    const clips = assets.animations(src);
    const find = (n: string) => clips.find((c) => c.name === n) ?? clips[0];
    let get = (n: string) => find(n);
    if (src !== kind) {
      if (!restCache.has(src)) restCache.set(src, restPose(assets.character(src)!));
      if (!restCache.has(kind)) restCache.set(kind, restPose(assets.character(kind)!));
      get = (n: string) => retarget(find(n), restCache.get(src)!, restCache.get(kind)!, `${src}>${kind}:${n}`);
    }
    const strip = (c: THREE.AnimationClip) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => !t.name.endsWith('.position')));
    this.idle = this.mixer.clipAction(strip(get(names.idle)));
    this.walk = this.mixer.clipAction(strip(get(names.walk)));
    this.run = this.mixer.clipAction(strip(get(names.run)));
    this.air = this.mixer.clipAction(strip(get(names.run)).clone());
    for (const a of [this.idle, this.walk, this.run, this.air]) { a.play(); a.setEffectiveWeight(0); }
    this.idle.setEffectiveWeight(1);
    this.air.time = this.air.getClip().duration * 0.3;
    this.air.timeScale = 0; // frozen mid-stride: a natural jump/fall pose
    this.mixer.update(Math.random());
  }

  setColors(c: HumanoidColors) {
    // Suit bodies take the outfit colours; real people keep their textures, lightly tinted.
    this.mats.forEach((m, i) => {
      if (this.kind === 'suit_body') m.color.set(i === 0 ? c.accent : c.suit);
      else m.color.copy(this.baseColors[i]);
    });
    if (this.kind === 'suit_body') this.mats[0]?.emissive.set(c.aura ?? c.accent);
  }

  /** Tints a civilian's clothes subtly (used for crowd variety). */
  tint(color: THREE.Color, amount: number) {
    this.mats.forEach((m, i) => m.color.copy(this.baseColors[i]).lerp(color, amount));
  }

  setGlow(v: number) {
    if (this.kind === 'suit_body' && this.mats[0]) this.mats[0].emissiveIntensity = v * 0.6;
  }

  private bone(n: string) { return this.bones.get('mixamorig' + n); }

  /** Rotates `n` so the segment towards `child` points along a world direction. */
  private aim(n: string, child: string, dir: THREE.Vector3, w: number) {
    const b = this.bone(n), c = this.bone(child);
    if (!b || !c || !b.parent || w <= 0.001) return;
    const bp = b.getWorldPosition(new THREE.Vector3());
    const cp = c.getWorldPosition(new THREE.Vector3());
    const cur = cp.sub(bp).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
    const bw = b.getWorldQuaternion(new THREE.Quaternion());
    const pw = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const target = pw.invert().multiply(delta.multiply(bw));
    b.quaternion.slerp(target, Math.min(1, w));
    b.updateMatrixWorld(true);
  }

  update(dt: number, s: HumanoidState) {
    this.t += dt;
    const flying = s.flying ? 1 : 0;
    this.flyBlend += (flying - this.flyBlend) * damp(6, dt);
    const airborne = !s.grounded && !s.flying ? 1 : 0;
    this.airBlend += (airborne - this.airBlend) * damp(10, dt);
    const ground = (1 - this.flyBlend) * (1 - this.airBlend);

    // Locomotion weights from horizontal speed
    const sp = s.speed;
    const wWalk = Math.min(1, Math.max(0, sp / 1.6)) * (1 - Math.min(1, Math.max(0, (sp - 3.2) / 2)));
    const wRun = Math.min(1, Math.max(0, (sp - 3.2) / 2));
    const wIdle = Math.max(0, 1 - wWalk - wRun);
    this.idle.setEffectiveWeight(wIdle * ground + this.flyBlend);
    this.walk.setEffectiveWeight(wWalk * ground);
    this.run.setEffectiveWeight(wRun * ground);
    this.air.setEffectiveWeight(this.airBlend * (1 - this.flyBlend));
    this.walk.timeScale = Math.max(0.6, sp / 1.45);
    this.run.timeScale = Math.max(0.7, sp / 5.5);
    this.mixer.update(dt);

    // Body attitude: superhero pitch in forward flight, banking in turns.
    const targetPitch = this.flyBlend * s.flyForward * 1.25;
    this.pitch += (targetPitch - this.pitch) * damp(5, dt);
    const targetBank = THREE.MathUtils.clamp(-this.turnRate * 0.25, -0.6, 0.6) * this.flyBlend;
    this.bank += (targetBank - this.bank) * damp(4, dt);
    this.body.position.y = 0.95;
    this.model.position.y = -0.95 + (this.flyBlend * Math.sin(this.t * 1.6) * 0.05 * (1 - s.flyForward));
    this.body.rotation.set(this.pitch, 0, this.bank);
    this.root.updateMatrixWorld(true);

    // Procedural overrides (world-space aiming, independent of each rig's bone axes)
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const bq = this.body.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const bodyDown = new THREE.Vector3(0, -1, 0).applyQuaternion(bq);
    const bodyFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bq);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(bq);
    if (this.flyBlend > 0.02) {
      const f = this.flyBlend, k = s.flyForward;
      // forward flight: right fist leads, left arm along the body, legs straight back
      this.aim('RightArm', 'RightForeArm', bodyFwd.clone().lerp(bodyDown.clone().addScaledVector(right, 0.5), 1 - k), f * (0.4 + 0.6 * k));
      this.aim('RightForeArm', 'RightHand', bodyFwd.clone().lerp(bodyDown, 1 - k), f * k);
      this.aim('LeftArm', 'LeftForeArm', bodyDown.clone().addScaledVector(right, -0.25 - 0.35 * (1 - k)), f * 0.8);
      this.aim('LeftUpLeg', 'LeftLeg', bodyDown.clone().addScaledVector(right, -0.04).addScaledVector(bodyFwd, 0.1 * (1 - k)), f * 0.85);
      this.aim('RightUpLeg', 'RightLeg', bodyDown.clone().addScaledVector(right, 0.04).addScaledVector(bodyFwd, -0.05), f * 0.85);
      this.aim('LeftLeg', 'LeftFoot', bodyDown.clone().addScaledVector(bodyFwd, -0.25 * (1 - k)), f * 0.8);
      this.aim('RightLeg', 'RightFoot', bodyDown.clone().addScaledVector(bodyFwd, -0.4 * (1 - k)), f * 0.8);
    }
    if (s.panic) {
      const up = new THREE.Vector3(0, 1, 0);
      this.aim('LeftArm', 'LeftForeArm', up.clone().addScaledVector(right, -0.4 + Math.sin(this.t * 12) * 0.2), 0.9);
      this.aim('RightArm', 'RightForeArm', up.clone().addScaledVector(right, 0.4 - Math.sin(this.t * 12) * 0.2), 0.9);
    }
    if (s.cast > 0.01) {
      const dir = (s as HumanoidState & { aimDir?: THREE.Vector3 }).aimDir ?? fwd;
      this.aim('RightArm', 'RightForeArm', dir, Math.min(1, s.cast));
      this.aim('RightForeArm', 'RightHand', dir, Math.min(1, s.cast));
    }
    if (s.punch > 0.01) {
      const swing = Math.sin((1 - s.punch) * Math.PI);
      this.aim('RightArm', 'RightForeArm', fwd.clone().addScaledVector(right, 0.15), swing);
      this.aim('RightForeArm', 'RightHand', fwd, swing);
      this.aim('Spine1', 'Spine2', new THREE.Vector3(0, 1, 0).addScaledVector(fwd, 0.25 * swing), swing * 0.5);
    }
  }
}
