import * as THREE from 'three';
import { Noise2D, smoothstep } from '../core/noise';
import { tex } from '../fx/textures';

/**
 * A regular height grid. Rendering and physics share the same triangulation, so the
 * character's feet always match the visible ground exactly.
 * Each cell (i, j) is split along the diagonal from (i, j+1) to (i+1, j).
 */
export class HeightGrid {
  readonly heights: Float32Array;
  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly spacing: number,
    readonly n: number, // vertices per side
    fn: (x: number, z: number) => number,
  ) {
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heights[j * n + i] = fn(originX + i * spacing, originZ + j * spacing);
      }
    }
  }

  get size() { return (this.n - 1) * this.spacing; }

  contains(x: number, z: number): boolean {
    return x >= this.originX && z >= this.originZ && x <= this.originX + this.size && z <= this.originZ + this.size;
  }

  h(i: number, j: number) { return this.heights[j * this.n + i]; }

  heightAt(x: number, z: number): number {
    const fx = (x - this.originX) / this.spacing;
    const fz = (z - this.originZ) / this.spacing;
    let i = Math.floor(fx), j = Math.floor(fz);
    i = Math.max(0, Math.min(this.n - 2, i));
    j = Math.max(0, Math.min(this.n - 2, j));
    const u = Math.max(0, Math.min(1, fx - i));
    const v = Math.max(0, Math.min(1, fz - j));
    const h00 = this.h(i, j), h10 = this.h(i + 1, j), h01 = this.h(i, j + 1), h11 = this.h(i + 1, j + 1);
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  buildGeometry(colorFn: (x: number, z: number, h: number, slope: number) => THREE.Color, skirt = 0): THREE.BufferGeometry {
    const n = this.n;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = this.originX + i * this.spacing, z = this.originZ + j * this.spacing;
        const h = this.h(i, j);
        const hx = this.h(Math.min(n - 1, i + 1), j) - this.h(Math.max(0, i - 1), j);
        const hz = this.h(i, Math.min(n - 1, j + 1)) - this.h(i, Math.max(0, j - 1));
        const slope = Math.hypot(hx, hz) / (2 * this.spacing);
        pos.push(x, h, z);
        const c = colorFn(x, z, h, slope);
        col.push(c.r, c.g, c.b);
        uv.push(x / 6, z / 6);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = (j + 1) * n + i, c = (j + 1) * n + i + 1, d = j * n + i + 1;
        // triangles (a, b, d) and (b, c, d) — upward facing (counter-clockwise seen from +Y)
        idx.push(a, b, d, b, c, d);
      }
    }
    if (skirt > 0) {
      // Vertical skirt along the border hides cracks with a coarser neighbouring grid.
      const border: number[] = [];
      for (let i = 0; i < n; i++) border.push(i);
      for (let j = 1; j < n; j++) border.push(j * n + n - 1);
      for (let i = n - 2; i >= 0; i--) border.push((n - 1) * n + i);
      for (let j = n - 2; j > 0; j--) border.push(j * n);
      border.push(0);
      const base = pos.length / 3;
      for (let k = 0; k < border.length; k++) {
        const v = border[k];
        pos.push(pos[v * 3], pos[v * 3 + 1] - skirt, pos[v * 3 + 2]);
        col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        uv.push(uv[v * 2], uv[v * 2 + 1]);
      }
      for (let k = 0; k < border.length - 1; k++) {
        const t0 = border[k], t1 = border[k + 1], b0 = base + k, b1 = base + k + 1;
        idx.push(t0, b0, t1, t1, b0, b1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

export const CRASH_SITE = { x: 205, z: -215 };
export const POND = { x: 100, z: -110, rx: 26, rz: 16 };
export const WATER_LEVEL = -0.35;
const INNER_HALF = 320;

/** Earth-like starting region: flat town in the middle, hills, then a mountain ring. */
export class EarthTerrain {
  private noise = new Noise2D(2024);
  inner: HeightGrid;
  outer: HeightGrid;
  readonly mesh = new THREE.Group();

  constructor(detail: 'low' | 'high') {
    const innerSpacing = detail === 'high' ? 3.2 : 4;
    const innerHalf = INNER_HALF;
    this.inner = new HeightGrid(-innerHalf, -innerHalf, innerSpacing, Math.round((innerHalf * 2) / innerSpacing) + 1, (x, z) => this.raw(x, z));
    this.outer = new HeightGrid(-2400, -2400, 32, 151, (x, z) => this.raw(x, z));
  }

  /** Analytic height. */
  raw(x: number, z: number): number {
    const n = this.noise;
    const box = Math.max(Math.abs(x), Math.abs(z));
    const flat = smoothstep(150, 215, box);
    const hills = (n.fbm(x / 280, z / 280, 4) * 0.5 + 0.5) * 34 + n.fbm(x / 70 + 7, z / 70 - 3, 3) * 4;
    const r = Math.hypot(x, z);
    const mountains = smoothstep(480, 1100, r) * (160 + n.fbm(x / 260, z / 260, 5) * 140);
    const dc = Math.hypot(x - CRASH_SITE.x, z - CRASH_SITE.z);
    const hill = 16 * Math.exp(-(dc * dc) / (70 * 70));
    const crater = -3.2 * Math.exp(-(dc * dc) / (9 * 9)) + 1.2 * Math.exp(-((dc - 11) ** 2) / 12);
    const pe = ((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2;
    const pond = pe < 1.6 ? -1.6 * smoothstep(1.6, 0.6, pe) : 0;
    return flat * (hills + mountains + hill) + crater * smoothstep(120, 160, box) + pond;
  }

  heightAt(x: number, z: number): number {
    if (this.inner.contains(x, z)) return this.inner.heightAt(x, z);
    if (this.outer.contains(x, z)) return this.outer.heightAt(x, z);
    return this.raw(x, z);
  }

  build(): THREE.Group {
    const grass = new THREE.Color('#5d7f3a');
    const dry = new THREE.Color('#8a8a4a');
    const rock = new THREE.Color('#7b756b');
    const snow = new THREE.Color('#eef2f5');
    const dirt = new THREE.Color('#5a4632');
    const scorch = new THREE.Color('#2b2522');
    const tmp = new THREE.Color();
    const colorFn = (x: number, z: number, h: number, slope: number) => {
      const v = this.noise.noise(x / 40, z / 40) * 0.5 + 0.5;
      tmp.copy(grass).lerp(dry, v * 0.45);
      tmp.lerp(rock, smoothstep(0.45, 0.85, slope) * 0.9);
      tmp.lerp(rock, smoothstep(140, 220, h));
      tmp.lerp(snow, smoothstep(230, 300, h));
      const dc = Math.hypot(x - CRASH_SITE.x, z - CRASH_SITE.z);
      if (dc < 30) tmp.lerp(dc < 13 ? scorch : dirt, smoothstep(30, 8, dc));
      const pe = ((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2;
      if (pe < 1.3) tmp.lerp(dirt, smoothstep(1.3, 0.9, pe) * 0.7);
      return tmp;
    };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex('grass'), roughness: 0.95, metalness: 0 });
    const innerMesh = new THREE.Mesh(this.inner.buildGeometry(colorFn, 4), mat);
    innerMesh.receiveShadow = true;
    innerMesh.name = 'terrain-inner';
    this.mesh.add(innerMesh);

    // Outer grid without the cells already covered by the inner grid.
    const og = this.outer.buildGeometry(colorFn);
    const idx = og.getIndex()!.array as Uint32Array | Uint16Array;
    const pos = og.getAttribute('position');
    const keep: number[] = [];
    const half = INNER_HALF + 0.01;
    for (let t = 0; t < idx.length; t += 3) {
      let inside = true;
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        if (Math.abs(pos.getX(v)) > half || Math.abs(pos.getZ(v)) > half) { inside = false; break; }
      }
      if (!inside) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    og.setIndex(keep);
    const outerMat = mat.clone();
    outerMat.map = null;
    const outerMesh = new THREE.Mesh(og, outerMat);
    outerMesh.position.y = -0.05;
    outerMesh.receiveShadow = false;
    outerMesh.name = 'terrain-outer';
    this.mesh.add(outerMesh);
    return this.mesh;
  }
}
