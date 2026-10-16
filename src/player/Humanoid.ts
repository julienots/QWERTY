import * as THREE from 'three';
import { damp } from '../core/noise';
import { tex } from '../fx/textures';

export interface HumanoidColors {
  skin: string;
  suit: string;
  accent: string;
  hair: string;
  aura?: string;
  pants?: string;
}

export interface HumanoidState {
  speed: number;      // horizontal speed m/s
  grounded: boolean;
  flying: boolean;
  vy: number;
  flyForward: number; // 0..1 forward flight intensity
  cast: number;       // 0..1 casting pose weight
  punch: number;      // 0..1 punch progress (1 = start)
  panic?: boolean;
}

type Seg = { pivot: THREE.Group; mesh: THREE.Mesh };

/**
 * A procedurally modelled, procedurally animated human figure (~1.8 m).
 * All limbs are pivoted groups so animation is a matter of joint rotations.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private thighL!: Seg; private thighR!: Seg;
  private shinL!: Seg; private shinR!: Seg;
  private armL!: Seg; private armR!: Seg;
  private foreL!: Seg; private foreR!: Seg;
  private mats: { skin: THREE.MeshStandardMaterial; suit: THREE.MeshStandardMaterial; pants: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial; emblem: THREE.MeshStandardMaterial };
  private phase = Math.random() * 10;
  private pitch = 0;
  private bank = 0;
  private flyBlend = 0;
  private airBlend = 0;
  private t = Math.random() * 10;
  /** Optional yaw rate for banking in flight. */
  turnRate = 0;

  constructor(colors: HumanoidColors, detail: 'high' | 'low' = 'high') {
    const seg = detail === 'high' ? 10 : 6;
    const fabric = tex('fabric');
    this.mats = {
      skin: new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.65 }),
      suit: new THREE.MeshStandardMaterial({ color: colors.suit, roughness: 0.7, map: fabric }),
      pants: new THREE.MeshStandardMaterial({ color: colors.pants ?? colors.suit, roughness: 0.75, map: fabric }),
      accent: new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4, metalness: 0.3 }),
      hair: new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9 }),
      emblem: new THREE.MeshStandardMaterial({ color: colors.accent, emissive: colors.aura ?? colors.accent, emissiveIntensity: 0 }),
    };
    const cap = (r: number, len: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, seg), mat);
      m.castShadow = true;
      return m;
    };
    const limb = (parent: THREE.Object3D, x: number, y: number, z: number, r: number, len: number, mat: THREE.Material): Seg => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const mesh = cap(r, len, mat);
      mesh.position.y = -len / 2 - r * 0.3;
      pivot.add(mesh);
      parent.add(pivot);
      return { pivot, mesh };
    };

    this.root.add(this.body);
    this.body.position.y = 0.95;
    this.body.add(this.hips);
    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.16, seg, seg), this.mats.pants);
    pelvis.scale.set(1.15, 0.7, 0.85);
    pelvis.castShadow = true;
    this.hips.add(pelvis);
    // Legs
    this.thighL = limb(this.hips, -0.1, -0.02, 0, 0.075, 0.36, this.mats.pants);
    this.thighR = limb(this.hips, 0.1, -0.02, 0, 0.075, 0.36, this.mats.pants);
    this.shinL = limb(this.thighL.pivot, 0, -0.45, 0, 0.06, 0.34, this.mats.pants);
    this.shinR = limb(this.thighR.pivot, 0, -0.45, 0, 0.06, 0.34, this.mats.pants);
    for (const shin of [this.shinL, this.shinR]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), this.mats.accent);
      foot.position.set(0, -0.44, 0.05);
      foot.castShadow = true;
      shin.pivot.add(foot);
    }
    // Spine / torso
    this.spine.position.y = 0.05;
    this.hips.add(this.spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, seg), this.mats.suit);
    torso.position.y = 0.27;
    torso.scale.set(1.12, 1, 0.72);
    torso.castShadow = true;
    this.spine.add(torso);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, seg), this.mats.accent);
    belt.scale.set(1.1, 1, 0.75);
    belt.position.y = 0.06;
    this.spine.add(belt);
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), this.mats.emblem);
    emblem.position.set(0, 0.36, 0.125);
    this.spine.add(emblem);
    // Head
    this.head.position.y = 0.6;
    this.spine.add(this.head);
    const neck = cap(0.05, 0.06, this.mats.skin);
    neck.position.y = -0.02;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, seg + 4, seg + 2), this.mats.skin);
    skull.position.y = 0.13;
    skull.scale.set(0.92, 1.08, 1);
    skull.castShadow = true;
    this.head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI * 0.55), this.mats.hair);
    hair.position.set(0, 0.145, -0.012);
    hair.scale.set(0.95, 1.08, 1.05);
    this.head.add(hair);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.3 });
    for (const sx of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), eyeMat);
      eye.position.set(sx, 0.14, 0.1);
      this.head.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6), this.mats.skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.11, 0.115);
    this.head.add(nose);
    // Arms
    this.armL = limb(this.spine, -0.24, 0.47, 0, 0.055, 0.25, this.mats.suit);
    this.armR = limb(this.spine, 0.24, 0.47, 0, 0.055, 0.25, this.mats.suit);
    this.foreL = limb(this.armL.pivot, 0, -0.33, 0, 0.047, 0.22, this.mats.skin);
    this.foreR = limb(this.armR.pivot, 0, -0.33, 0, 0.047, 0.22, this.mats.skin);
    for (const fore of [this.foreL, this.foreR]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this.mats.skin);
      hand.position.y = -0.33;
      hand.scale.set(0.8, 1.1, 0.6);
      fore.pivot.add(hand);
    }
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false; });
  }

  setColors(c: HumanoidColors) {
    this.mats.skin.color.set(c.skin);
    this.mats.suit.color.set(c.suit);
    this.mats.pants.color.set(c.pants ?? c.suit);
    this.mats.accent.color.set(c.accent);
    this.mats.hair.color.set(c.hair);
    this.mats.emblem.color.set(c.accent);
    this.mats.emblem.emissive.set(c.aura ?? c.accent);
  }

  setGlow(v: number) {
    this.mats.emblem.emissiveIntensity = v;
  }

  update(dt: number, s: HumanoidState): void {
    this.t += dt;
    const k = damp(10, dt);
    const flying = s.flying ? 1 : 0;
    this.flyBlend += (flying - this.flyBlend) * damp(6, dt);
    const airborne = !s.grounded && !s.flying ? 1 : 0;
    this.airBlend += (airborne - this.airBlend) * damp(12, dt);

    // Walk/run cycle
    const moving = Math.min(1, s.speed / 1.5) * (1 - this.flyBlend) * (1 - this.airBlend);
    const run = Math.min(1, Math.max(0, (s.speed - 3.5) / 3));
    this.phase += dt * (s.grounded ? (2.4 + s.speed * 1.35) : 3);
    const sw = Math.sin(this.phase);
    const amp = (0.5 + run * 0.45) * moving;

    let thighL = -sw * amp, thighR = sw * amp;
    let shinL = Math.max(0, Math.sin(this.phase + 1.2)) * (0.6 + run * 0.7) * moving;
    let shinR = Math.max(0, Math.sin(this.phase + 1.2 + Math.PI)) * (0.6 + run * 0.7) * moving;
    let armL = sw * amp * 0.9, armR = -sw * amp * 0.9;
    let foreL = -(0.2 + run * 0.9) * moving - 0.1, foreR = -(0.2 + run * 0.9) * moving - 0.1;
    let armLz = 0.08, armRz = -0.08;
    let spineX = run * 0.18 * moving;
    let bob = Math.abs(Math.cos(this.phase)) * 0.05 * moving;
    // Idle breathing
    const breath = Math.sin(this.t * 1.8) * 0.015 * (1 - moving);
    spineX += breath;

    // Jump / fall pose
    if (this.airBlend > 0.01) {
      const a = this.airBlend;
      const rising = s.vy > 0 ? 1 : 0;
      thighL = thighL * (1 - a) + a * (rising ? -0.9 : -0.3);
      thighR = thighR * (1 - a) + a * (rising ? 0.1 : 0.2);
      shinL = shinL * (1 - a) + a * 1.1;
      shinR = shinR * (1 - a) + a * (rising ? 0.3 : 0.6);
      armL = armL * (1 - a) + a * -0.6;
      armR = armR * (1 - a) + a * -0.6;
      armLz = armLz * (1 - a) + a * 0.7;
      armRz = armRz * (1 - a) + a * -0.7;
    }

    // Flight poses: hover (upright) blended with forward superhero flight.
    let targetPitch = 0;
    if (this.flyBlend > 0.01) {
      const f = this.flyBlend;
      const fwd = s.flyForward;
      const wave = Math.sin(this.t * 2.2);
      // Hover
      const hThighL = -0.15 + wave * 0.05, hThighR = 0.05 - wave * 0.05;
      const hShin = 0.35;
      // Forward flight: legs straight back, right arm forward
      thighL = thighL * (1 - f) + f * (hThighL * (1 - fwd) + 0.05 * fwd);
      thighR = thighR * (1 - f) + f * (hThighR * (1 - fwd) + 0.12 * fwd);
      shinL = shinL * (1 - f) + f * (hShin * (1 - fwd) + 0.1 * fwd);
      shinR = shinR * (1 - f) + f * (hShin * (1 - fwd) + 0.25 * fwd);
      armR = armR * (1 - f) + f * (-0.3 * (1 - fwd) - 2.9 * fwd);
      armL = armL * (1 - f) + f * (-0.2 * (1 - fwd) + 0.25 * fwd);
      armLz = armLz * (1 - f) + f * (0.45 * (1 - fwd) + 0.12 * fwd);
      armRz = armRz * (1 - f) + f * (-0.45 * (1 - fwd) - 0.05 * fwd);
      foreR = foreR * (1 - f) + f * (-0.3 * (1 - fwd));
      foreL = foreL * (1 - f) + f * -0.3;
      targetPitch = f * fwd * 1.25;
      bob = f * Math.sin(this.t * 1.6) * 0.05 * (1 - fwd);
    }

    // Panic: arms up
    if (s.panic) {
      armL = -2.6 + Math.sin(this.t * 12) * 0.2;
      armR = -2.6 - Math.sin(this.t * 12) * 0.2;
    }

    // Casting overrides right arm (point forward), punch swings it.
    if (s.cast > 0.01) {
      const c = Math.min(1, s.cast);
      const aim = this.flyBlend * s.flyForward > 0.5 ? -2.9 : -1.55;
      armR = armR * (1 - c) + aim * c;
      foreR = foreR * (1 - c);
      armRz = armRz * (1 - c) + -0.05 * c;
    }
    if (s.punch > 0.01) {
      const p = s.punch; // 1 → 0
      const swing = Math.sin((1 - p) * Math.PI);
      armR = -1.6 * swing + armR * (1 - swing);
      foreR = foreR * (1 - swing);
      spineX += 0.15 * swing;
    }

    this.pitch += (targetPitch - this.pitch) * damp(5, dt);
    const targetBank = THREE.MathUtils.clamp(-this.turnRate * 0.25, -0.6, 0.6) * this.flyBlend;
    this.bank += (targetBank - this.bank) * damp(4, dt);

    const set = (seg: Seg, x: number, z = 0) => {
      seg.pivot.rotation.x += (x - seg.pivot.rotation.x) * k;
      seg.pivot.rotation.z += (z - seg.pivot.rotation.z) * k;
    };
    set(this.thighL, thighL); set(this.thighR, thighR);
    set(this.shinL, shinL); set(this.shinR, shinR);
    set(this.armL, armL, armLz); set(this.armR, armR, armRz);
    set(this.foreL, foreL); set(this.foreR, foreR);
    this.spine.rotation.x += (spineX - this.spine.rotation.x) * k;
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.bank;
    this.body.position.y = 0.95 + bob;
    this.hips.rotation.y = Math.sin(this.phase) * 0.08 * moving;
  }
}
