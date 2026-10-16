import * as THREE from 'three';
import { tex } from './textures';

export interface EmitOptions {
  count: number;
  position: THREE.Vector3;
  color: THREE.Color | string;
  color2?: THREE.Color | string;
  speed?: number;
  speedJitter?: number;
  direction?: THREE.Vector3;
  spread?: number; // 0 = along direction, 1 = full sphere
  size?: number;
  sizeEnd?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  posJitter?: number;
}

/**
 * Pooled additive particle system rendered as a single Points draw call.
 * Capacity follows the quality profile's particle budget.
 */
export class Particles {
  readonly points: THREE.Points;
  private capacity: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private col0: Float32Array;
  private col1: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private alive = 0;
  private cursor = 0;
  private geom: THREE.BufferGeometry;
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();
  private tmpV = new THREE.Vector3();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex('glow') }, scale: { value: 400 } },
      vertexShader: `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.geom.setDrawRange(0, 0);
  }

  setViewportHeight(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.5;
  }

  emit(o: EmitOptions): void {
    const c0 = this.tmpC.set(o.color as any);
    const c1 = this.tmpC2.set((o.color2 ?? o.color) as any);
    const speed = o.speed ?? 3;
    const jit = o.speedJitter ?? 0.5;
    const spread = o.spread ?? 1;
    const dir = o.direction;
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if (this.life[i] <= 0) this.alive++;
      const pj = o.posJitter ?? 0;
      this.pos[i * 3] = o.position.x + (Math.random() - 0.5) * pj;
      this.pos[i * 3 + 1] = o.position.y + (Math.random() - 0.5) * pj;
      this.pos[i * 3 + 2] = o.position.z + (Math.random() - 0.5) * pj;
      // Random direction, blended towards `direction` by (1 - spread).
      const v = this.tmpV.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      v.normalize();
      if (dir) v.multiplyScalar(spread).addScaledVector(dir, 1 - spread).normalize();
      const s = speed * (1 - jit + Math.random() * jit * 2);
      this.vel[i * 3] = v.x * s;
      this.vel[i * 3 + 1] = v.y * s;
      this.vel[i * 3 + 2] = v.z * s;
      this.col0[i * 3] = c0.r; this.col0[i * 3 + 1] = c0.g; this.col0[i * 3 + 2] = c0.b;
      this.col1[i * 3] = c1.r; this.col1[i * 3 + 1] = c1.g; this.col1[i * 3 + 2] = c1.b;
      this.size0[i] = (o.size ?? 0.4) * (0.7 + Math.random() * 0.6);
      this.size1[i] = o.sizeEnd ?? this.size0[i] * 0.2;
      const life = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
    }
    this.alive = Math.min(this.alive, this.capacity);
  }

  update(dt: number): void {
    let maxIndex = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive--;
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      maxIndex = i + 1;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.col[i * 4] = this.col0[i * 3] + (this.col1[i * 3] - this.col0[i * 3]) * t;
      this.col[i * 4 + 1] = this.col0[i * 3 + 1] + (this.col1[i * 3 + 1] - this.col0[i * 3 + 1]) * t;
      this.col[i * 4 + 2] = this.col0[i * 3 + 2] + (this.col1[i * 3 + 2] - this.col0[i * 3 + 2]) * t;
      this.col[i * 4 + 3] = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
    }
    this.geom.setDrawRange(0, maxIndex);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }

  get count() { return Math.max(0, this.alive); }

  clear() {
    this.life.fill(0);
    this.alive = 0;
  }
}
