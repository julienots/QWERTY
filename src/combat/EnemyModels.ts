import * as THREE from 'three';
import type { EnemyDef } from '../content/types';
import { currentAssets } from '../world/build';

export interface EnemyAnimState {
  speed: number;
  attack: number; // 0..1 wind-up / strike
  t: number;
  airborne: boolean;
}

export interface EnemyModel {
  root: THREE.Group;
  /** Height of the body centre (for hit tests and health bars). */
  center: number;
  radius: number;
  animate(dt: number, s: EnemyAnimState): void;
  setFlash(v: number): void;
  setTint(color: THREE.Color | null): void;
}

class Base {
  root = new THREE.Group();
  mats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];
  private baseIntensity: number[] = [];
  protected skin(color: string, glow: string, glowAmt = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, emissive: glow, emissiveIntensity: glowAmt });
    this.mats.push(m);
    this.baseEmissive.push(m.emissive.clone());
    this.baseIntensity.push(glowAmt);
    return m;
  }
  setFlash(v: number) {
    this.mats.forEach((m, i) => {
      if (v > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = v * 1.5; }
      else { m.emissive.copy(this.baseEmissive[i]); m.emissiveIntensity = this.baseIntensity[i]; }
    });
  }
  setTint(c: THREE.Color | null) {
    this.mats.forEach((m, i) => {
      if (c) { m.emissive.copy(c); m.emissiveIntensity = 0.6; }
      else { m.emissive.copy(this.baseEmissive[i]); m.emissiveIntensity = this.baseIntensity[i]; }
    });
  }
  /** Registers an existing (cloned) material so flashes and tints apply to it. */
  protected adopt(m: THREE.MeshStandardMaterial) {
    this.mats.push(m);
    this.baseEmissive.push(m.emissive.clone());
    this.baseIntensity.push(m.emissiveIntensity);
  }
  protected mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = this.root) {
    const x = new THREE.Mesh(geo, m);
    x.castShadow = true;
    parent.add(x);
    return x;
  }
}

/** Fast quadruped predator with a spiked back and glowing eyes. */
class Stalker extends Base implements EnemyModel {
  center = 0.85;
  radius = 0.8;
  private legs: { upper: THREE.Group; lower: THREE.Group; phase: number }[] = [];
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail: THREE.Group[] = [];
  constructor(def: EnemyDef) {
    super();
    const hide = this.skin(def.color, def.glow, 0.05);
    const glow = this.skin('#000000', def.glow, 3);
    this.root.add(this.body);
    this.body.position.y = 0.85;
    const torso = this.mesh(new THREE.SphereGeometry(0.5, 14, 10), hide, this.body);
    torso.scale.set(0.9, 0.75, 1.7);
    for (let i = 0; i < 5; i++) {
      const sp = this.mesh(new THREE.ConeGeometry(0.07, 0.4 - i * 0.04, 6), glow, this.body);
      sp.position.set(0, 0.38, 0.45 - i * 0.22);
      sp.rotation.x = -0.5;
    }
    this.head.position.set(0, 0.12, 0.85);
    this.body.add(this.head);
    const skull = this.mesh(new THREE.SphereGeometry(0.3, 12, 10), hide, this.head);
    skull.scale.set(0.9, 0.75, 1.3);
    const jaw = this.mesh(new THREE.ConeGeometry(0.2, 0.45, 8), hide, this.head);
    jaw.rotation.x = Math.PI / 2;
    jaw.position.set(0, -0.08, 0.3);
    for (const x of [-0.12, 0.12]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), glow, this.head);
      eye.position.set(x, 0.08, 0.3);
    }
    for (const [x, z, ph] of [[-0.35, 0.5, 0], [0.35, 0.5, Math.PI], [-0.35, -0.5, Math.PI], [0.35, -0.5, 0]] as [number, number, number][]) {
      const upper = new THREE.Group();
      upper.position.set(x, 0, z);
      upper.rotation.z = x < 0 ? -0.5 : 0.5;
      this.body.add(upper);
      const u = this.mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.5, 6), hide, upper);
      u.position.y = -0.25;
      const lower = new THREE.Group();
      lower.position.y = -0.5;
      upper.add(lower);
      lower.rotation.z = x < 0 ? 0.9 : -0.9;
      const l = this.mesh(new THREE.ConeGeometry(0.05, 0.55, 6), hide, lower);
      l.rotation.x = Math.PI;
      l.position.y = -0.27;
      this.legs.push({ upper, lower, phase: ph });
    }
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, i === 0 ? -0.8 : -0.3);
      parent.add(seg);
      const c = this.mesh(new THREE.ConeGeometry(0.12 - i * 0.025, 0.36, 6), i === 3 ? glow : hide, seg);
      c.rotation.x = -Math.PI / 2;
      c.position.z = -0.15;
      this.tail.push(seg);
      parent = seg;
    }
  }
  animate(dt: number, s: EnemyAnimState) {
    void dt;
    const f = s.t * (4 + s.speed * 1.6);
    const amp = Math.min(1, s.speed / 3) * 0.6;
    for (const l of this.legs) l.upper.rotation.x = Math.sin(f + l.phase) * amp;
    this.body.position.y = 0.85 + Math.abs(Math.sin(f)) * 0.06 * amp - s.attack * 0.15;
    this.head.rotation.x = -s.attack * 0.6 + Math.sin(s.t * 2) * 0.05;
    this.body.rotation.x = s.attack * 0.25;
    this.tail.forEach((seg, i) => { seg.rotation.y = Math.sin(s.t * 3 - i) * 0.3; });
  }
}

/** Slow artillery creature with a glowing acid sac. */
class Spitter extends Base implements EnemyModel {
  center = 1.0;
  radius = 0.8;
  private sac: THREE.Mesh;
  private legs: THREE.Group[] = [];
  private body = new THREE.Group();
  constructor(def: EnemyDef) {
    super();
    const hide = this.skin(def.color, def.glow, 0.05);
    const glow = this.skin(def.glow, def.glow, 1.6);
    glow.transparent = true;
    glow.opacity = 0.85;
    this.root.add(this.body);
    this.body.position.y = 1.0;
    const torso = this.mesh(new THREE.SphereGeometry(0.55, 14, 10), hide, this.body);
    torso.scale.set(1, 0.85, 1.1);
    this.sac = this.mesh(new THREE.SphereGeometry(0.45, 14, 10), glow, this.body);
    this.sac.position.set(0, 0.45, -0.35);
    const mouth = this.mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 10), hide, this.body);
    mouth.rotation.x = Math.PI / 2;
    mouth.position.set(0, 0.1, 0.62);
    const throat = this.mesh(new THREE.CircleGeometry(0.13, 10), glow, this.body);
    throat.position.set(0, 0.1, 0.83);
    for (const x of [-0.3, 0.3]) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.3, 0);
      this.body.add(leg);
      const l = this.mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.75, 8), hide, leg);
      l.position.y = -0.35;
      this.legs.push(leg);
    }
  }
  animate(_dt: number, s: EnemyAnimState) {
    const f = s.t * (3 + s.speed * 2);
    this.legs[0].rotation.x = Math.sin(f) * 0.5 * Math.min(1, s.speed);
    this.legs[1].rotation.x = -Math.sin(f) * 0.5 * Math.min(1, s.speed);
    const pulse = 1 + Math.sin(s.t * 4) * 0.06 + s.attack * 0.35;
    this.sac.scale.setScalar(pulse);
    this.body.rotation.x = -s.attack * 0.35;
    this.body.position.y = 1.0 + Math.abs(Math.sin(f)) * 0.05;
  }
}

/** Massive brute with heavy fists and glowing fissures. */
class Brute extends Base implements EnemyModel {
  center = 1.3;
  radius = 1.0;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private torso = new THREE.Group();
  constructor(def: EnemyDef) {
    super();
    const hide = this.skin(def.color, def.glow, 0.05);
    const glow = this.skin('#000000', def.glow, 2.5);
    this.root.add(this.torso);
    this.torso.position.y = 1.35;
    const chest = this.mesh(new THREE.SphereGeometry(0.7, 14, 12), hide, this.torso);
    chest.scale.set(1.2, 0.95, 0.85);
    for (let i = 0; i < 4; i++) {
      const crack = this.mesh(new THREE.BoxGeometry(0.06, 0.5, 0.05), glow, this.torso);
      crack.position.set(-0.4 + i * 0.27, 0.05 + (i % 2) * 0.1, 0.6);
      crack.rotation.z = (i - 1.5) * 0.3;
    }
    const head = this.mesh(new THREE.SphereGeometry(0.28, 12, 10), hide, this.torso);
    head.position.set(0, 0.68, 0.25);
    for (const x of [-0.1, 0.1]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.05, 8, 6), glow, this.torso);
      eye.position.set(x, 0.72, 0.5);
    }
    for (const [arm, x] of [[this.armL, -0.95], [this.armR, 0.95]] as [THREE.Group, number][]) {
      arm.position.set(x, 0.35, 0);
      this.torso.add(arm);
      const u = this.mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), hide, arm);
      u.position.y = -0.45;
      const fist = this.mesh(new THREE.SphereGeometry(0.36, 10, 8), hide, arm);
      fist.position.y = -1.05;
      const knuckles = this.mesh(new THREE.TorusGeometry(0.25, 0.05, 6, 12), glow, arm);
      knuckles.position.y = -1.05;
      knuckles.rotation.x = Math.PI / 2;
    }
    for (const [leg, x] of [[this.legL, -0.4], [this.legR, 0.4]] as [THREE.Group, number][]) {
      leg.position.set(x, 0.75, 0);
      this.root.add(leg);
      const l = this.mesh(new THREE.CapsuleGeometry(0.25, 0.45, 4, 8), hide, leg);
      l.position.y = -0.4;
    }
  }
  animate(_dt: number, s: EnemyAnimState) {
    const f = s.t * (2 + s.speed * 1.2);
    const amp = Math.min(1, s.speed / 2) * 0.5;
    this.legL.rotation.x = Math.sin(f) * amp;
    this.legR.rotation.x = -Math.sin(f) * amp;
    this.armL.rotation.x = -Math.sin(f) * amp * 0.6 - s.attack * 2.6;
    this.armR.rotation.x = Math.sin(f) * amp * 0.6 - s.attack * 2.6;
    this.torso.rotation.x = 0.15 + s.attack * 0.3;
    this.torso.position.y = 1.35 + Math.abs(Math.sin(f)) * 0.08 * amp;
  }
}

/** Hovering crystalline sentinel with a rotating ring. */
class Drone extends Base implements EnemyModel {
  center = 0;
  radius = 0.7;
  private ring: THREE.Mesh;
  private core: THREE.Mesh;
  constructor(def: EnemyDef) {
    super();
    const shell = this.skin(def.color, def.glow, 0.15);
    const glow = this.skin(def.glow, def.glow, 2.5);
    this.core = this.mesh(new THREE.OctahedronGeometry(0.5, 0), shell);
    this.core.scale.set(1, 1.4, 1);
    const eye = this.mesh(new THREE.SphereGeometry(0.16, 10, 8), glow);
    eye.position.z = 0.35;
    this.ring = this.mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 24), glow);
    for (let i = 0; i < 3; i++) {
      const fin = this.mesh(new THREE.ConeGeometry(0.1, 0.5, 4), shell);
      const a = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.55, -0.4, Math.sin(a) * 0.55);
      fin.rotation.x = Math.PI;
    }
  }
  animate(_dt: number, s: EnemyAnimState) {
    this.ring.rotation.x = s.t * 2;
    this.ring.rotation.y = s.t * 1.3;
    this.core.rotation.y = s.t * 0.8;
    this.core.position.y = Math.sin(s.t * 3) * 0.08;
    this.ring.scale.setScalar(1 + s.attack * 0.4);
  }
}

type CreatureKind = 'stalker' | 'spitter' | 'brute' | 'drone';
const METRICS: Record<CreatureKind, { center: number; radius: number }> = {
  stalker: { center: 0.85, radius: 0.8 }, spitter: { center: 1.0, radius: 0.8 }, brute: { center: 1.3, radius: 1.0 }, drone: { center: 0, radius: 0.7 },
};

/**
 * Creature modelled in Blender (tools/blender/creatures.py): sculpted, displaced and
 * cavity-baked meshes in a hierarchy of named, pivoted parts animated procedurally.
 * Hide and glow colours come from the enemy definition, so mods can recolour them.
 */
class GltfCreature extends Base implements EnemyModel {
  center: number;
  radius: number;
  private n = new Map<string, THREE.Object3D>();
  private rest = new Map<string, { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }>();
  constructor(def: EnemyDef, private kind: CreatureKind, scene: THREE.Object3D) {
    super();
    this.center = METRICS[kind].center;
    this.radius = METRICS[kind].radius;
    const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    scene.traverse((o) => {
      if (o.name) { this.n.set(o.name, o); this.rest.set(o.name, { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() }); }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      const src = m.material as THREE.MeshStandardMaterial;
      let c = clones.get(src);
      if (!c) {
        c = src.clone();
        if (src.name === 'hide') c.color.set(def.color).multiplyScalar(1.6);
        else { c.emissive.set(def.glow); if (src.name === 'glow') c.color.set(def.glow); }
        clones.set(src, c);
        this.adopt(c);
      }
      m.material = c;
    });
    this.root.add(scene);
    this.root.userData.sharedGeometry = true;
  }
  private node(name: string) { return this.n.get(name); }
  private pose(name: string, rx = 0, ry = 0, rz = 0, dy = 0) {
    const o = this.n.get(name), r = this.rest.get(name);
    if (!o || !r) return;
    o.rotation.set(r.r.x + rx, r.r.y + ry, r.r.z + rz);
    o.position.y = r.p.y + dy;
  }
  animate(_dt: number, s: EnemyAnimState) {
    switch (this.kind) {
      case 'stalker': {
        const f = s.t * (4 + s.speed * 1.6);
        const amp = Math.min(1, s.speed / 3) * 0.7;
        for (const [leg, ph] of [['fl', 0], ['fr', Math.PI], ['bl', Math.PI], ['br', 0]] as [string, number][]) {
          const w = Math.sin(f + ph);
          this.pose(`leg_${leg}_u`, w * amp);
          this.pose(`leg_${leg}_l`, Math.max(0, -w) * amp * 0.9);
        }
        this.pose('body', s.attack * 0.2, 0, Math.sin(f * 0.5) * 0.04 * amp, Math.abs(Math.sin(f)) * 0.06 * amp - s.attack * 0.15);
        this.pose('head', s.attack * 0.35 + Math.sin(s.t * 2) * 0.05, Math.sin(s.t * 0.7) * 0.15 * (1 - amp));
        this.pose('jaw', s.attack * 0.75 + Math.max(0, Math.sin(s.t * 1.3)) * 0.08);
        for (let i = 0; i < 4; i++) this.pose(`tail_${i}`, 0, Math.sin(s.t * 3 - i) * 0.3);
        break;
      }
      case 'spitter': {
        const f = s.t * (3 + s.speed * 2);
        const sw = Math.sin(f) * 0.5 * Math.min(1, s.speed);
        this.pose('leg_l', sw);
        this.pose('leg_r', -sw);
        this.pose('body', -s.attack * 0.35, 0, 0, Math.abs(Math.sin(f)) * 0.05);
        const sac = this.node('sac');
        if (sac) sac.scale.copy(this.rest.get('sac')!.s).multiplyScalar(1 + Math.sin(s.t * 4) * 0.06 + s.attack * 0.35);
        this.pose('mouth', -s.attack * 0.25);
        break;
      }
      case 'brute': {
        const f = s.t * (2 + s.speed * 1.2);
        const amp = Math.min(1, s.speed / 2) * 0.5;
        this.pose('leg_l', Math.sin(f) * amp);
        this.pose('leg_r', -Math.sin(f) * amp);
        this.pose('arm_l', -Math.sin(f) * amp * 0.6 - s.attack * 2.4);
        this.pose('arm_r', Math.sin(f) * amp * 0.6 - s.attack * 2.4);
        this.pose('torso', s.attack * 0.3, Math.sin(f) * 0.06 * amp, 0, Math.abs(Math.sin(f)) * 0.08 * amp);
        this.pose('head', -s.attack * 0.3, Math.sin(s.t * 0.6) * 0.2);
        break;
      }
      default: {
        this.pose('ring', s.t * 2, s.t * 1.3);
        const ring = this.node('ring');
        if (ring) ring.scale.copy(this.rest.get('ring')!.s).multiplyScalar(1 + s.attack * 0.4);
        this.pose('core', 0, s.t * 0.8, 0, Math.sin(s.t * 3) * 0.08);
      }
    }
  }
}

export function createEnemyModel(def: EnemyDef): EnemyModel {
  let m: EnemyModel;
  const scene = currentAssets()?.model(`creature_${def.model}`);
  if (scene && def.model in METRICS) m = new GltfCreature(def, def.model as CreatureKind, scene);
  else switch (def.model) {
    case 'stalker': m = new Stalker(def); break;
    case 'spitter': m = new Spitter(def); break;
    case 'brute': m = new Brute(def); break;
    default: m = new Drone(def);
  }
  m.root.scale.setScalar(def.scale);
  m.center *= def.scale;
  m.radius *= def.scale;
  return m;
}
