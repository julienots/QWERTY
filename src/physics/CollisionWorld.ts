/**
 * Lightweight character physics: vertical capsule (approximated as a cylinder) against
 * axis-aligned boxes stored in a spatial hash, plus an analytic ground height function.
 */

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  enabled: boolean;
  tag?: string;
}

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  radius: number;
  height: number;
  onGround: boolean;
  /** Max height of an obstacle the body walks over automatically. */
  stepHeight: number;
}

export type HeightFn = (x: number, z: number) => number;

const CELL = 8;

export class CollisionWorld {
  private grid = new Map<string, Box[]>();
  readonly boxes: Box[] = [];
  ground: HeightFn = () => 0;

  addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tag?: string): Box {
    const b: Box = {
      minX: Math.min(minX, maxX), minY: Math.min(minY, maxY), minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY), maxZ: Math.max(minZ, maxZ),
      enabled: true, tag,
    };
    this.boxes.push(b);
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i + ',' + j;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(b);
      }
    }
    return b;
  }

  /** Moving boxes (vehicles…). Not hashed: kept few and tested linearly. */
  readonly dynamic: Box[] = [];

  addDynamicBox(tag?: string): Box {
    const b: Box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, enabled: true, tag };
    this.dynamic.push(b);
    return b;
  }

  /** Box from center + half sizes. */
  addBoxCentered(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, tag?: string): Box {
    return this.addBox(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz, tag);
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Box[] = []): Box[] {
    out.length = 0;
    const seen = new Set<Box>();
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const arr = this.grid.get(i + ',' + j);
        if (!arr) continue;
        for (const b of arr) {
          if (b.enabled && !seen.has(b)) { seen.add(b); out.push(b); }
        }
      }
    }
    for (const b of this.dynamic) {
      if (b.enabled && b.maxX >= minX && b.minX <= maxX && b.maxZ >= minZ && b.minZ <= maxZ) out.push(b);
    }
    return out;
  }

  private tmp: Box[] = [];

  /** Highest walkable surface under (x, z) at or below `y + stepHeight`. */
  surfaceHeight(x: number, z: number, y: number, radius: number, step: number): number {
    let h = this.ground(x, z);
    const boxes = this.query(x - radius, z - radius, x + radius, z + radius, this.tmp);
    for (const b of boxes) {
      if (x + radius * 0.7 < b.minX || x - radius * 0.7 > b.maxX || z + radius * 0.7 < b.minZ || z - radius * 0.7 > b.maxZ) continue;
      if (b.maxY <= y + step && b.maxY > h) h = b.maxY;
    }
    return h;
  }

  /** Integrates the body and resolves collisions. Returns true if a ceiling was hit. */
  move(body: Body, dt: number): void {
    // Sub-step fast movement so we do not tunnel through thin walls.
    const speed = Math.hypot(body.vx, body.vy, body.vz);
    const steps = Math.min(12, Math.max(1, Math.ceil((speed * dt) / (body.radius * 0.8))));
    const sdt = dt / steps;
    body.onGround = false;
    for (let s = 0; s < steps; s++) {
      body.x += body.vx * sdt;
      body.z += body.vz * sdt;
      this.resolveHorizontal(body);
      body.y += body.vy * sdt;
      this.resolveVertical(body);
    }
  }

  private resolveHorizontal(body: Body): void {
    const r = body.radius;
    const boxes = this.query(body.x - r - 0.1, body.z - r - 0.1, body.x + r + 0.1, body.z + r + 0.1, this.tmp);
    for (const b of boxes) {
      // Vertical overlap, ignoring obstacles we can step onto.
      if (body.y + body.height <= b.minY || body.y + body.stepHeight >= b.maxY) continue;
      const cx = Math.max(b.minX, Math.min(body.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(body.z, b.maxZ));
      const dx = body.x - cx;
      const dz = body.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const push = r - d;
        const nx = dx / d, nz = dz / d;
        body.x += nx * push;
        body.z += nz * push;
        const vn = body.vx * nx + body.vz * nz;
        if (vn < 0) { body.vx -= vn * nx; body.vz -= vn * nz; }
      } else {
        // Center inside the box footprint: exit through the closest face.
        const pens = [
          { d: body.x - b.minX + r, nx: -1, nz: 0 },
          { d: b.maxX - body.x + r, nx: 1, nz: 0 },
          { d: body.z - b.minZ + r, nx: 0, nz: -1 },
          { d: b.maxZ - body.z + r, nx: 0, nz: 1 },
        ].sort((a, c) => a.d - c.d)[0];
        body.x += pens.nx * pens.d;
        body.z += pens.nz * pens.d;
        if (pens.nx) body.vx = 0; else body.vz = 0;
      }
    }
  }

  private resolveVertical(body: Body): void {
    const r = body.radius;
    // Ceiling: head entering a box from below.
    if (body.vy > 0) {
      const boxes = this.query(body.x - r * 0.5, body.z - r * 0.5, body.x + r * 0.5, body.z + r * 0.5, this.tmp);
      for (const b of boxes) {
        if (body.x < b.minX - r * 0.5 || body.x > b.maxX + r * 0.5 || body.z < b.minZ - r * 0.5 || body.z > b.maxZ + r * 0.5) continue;
        const head = body.y + body.height;
        if (head > b.minY && body.y < b.minY) {
          body.y = b.minY - body.height;
          body.vy = 0;
        }
      }
    }
    const floor = this.surfaceHeight(body.x, body.z, body.y, r, body.stepHeight);
    if (body.y <= floor + 1e-4) {
      // Smoothly climb steps instead of teleporting when walking.
      body.y = floor;
      if (body.vy < 0) body.vy = 0;
      body.onGround = true;
    } else if (body.y - floor < 0.06 && body.vy <= 0) {
      body.onGround = true;
    }
  }

  /** Ray cast against boxes and ground. Returns hit distance or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, includeGround = true): number {
    let best = Infinity;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const boxes = this.query(Math.min(ox, ex) - 0.5, Math.min(oz, ez) - 0.5, Math.max(ox, ex) + 0.5, Math.max(oz, ez) + 0.5, this.tmp);
    for (const b of boxes) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (t >= 0 && t < best && t <= maxDist) best = t;
    }
    if (includeGround) {
      // March along the ray for terrain intersection.
      const stepLen = Math.max(0.5, maxDist / 64);
      let prevT = 0;
      for (let t = stepLen; t <= maxDist + 1e-6 && t < best; t += stepLen) {
        const y = oy + dy * t;
        if (y < this.ground(ox + dx * t, oz + dz * t)) {
          // Refine with bisection.
          let a = prevT, c = t;
          for (let i = 0; i < 8; i++) {
            const m = (a + c) / 2;
            if (oy + dy * m < this.ground(ox + dx * m, oz + dz * m)) c = m; else a = m;
          }
          best = Math.min(best, a);
          break;
        }
        prevT = t;
      }
    }
    return best;
  }
}

export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box): number {
  let tmin = -Infinity, tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX], [oy, dy, b.minY, b.maxY], [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return -1;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
