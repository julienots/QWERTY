import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable } from './Zone';
import type { EarthTerrain } from './Terrain';
import { CRASH_SITE, POND, WATER_LEVEL } from './Terrain';
import { block, boxGeo, mat } from './build';
import { facadeTexture, tex } from '../fx/textures';
import { mulberry32 } from '../core/noise';

/** Road segments (axis-aligned): [x0, z0, x1, z1, width] */
export const ROADS: [number, number, number, number, number][] = [
  [-175, 17, 175, 17, 8],   // R1 main street
  [-60, -150, -60, 150, 7], // R2
  [60, -150, 60, 150, 7],   // R3
  [-150, -75, 150, -75, 7], // R4
];

export const WATER_TOWER = { x: -90, z: -60, platform: 7.0, top: 14.5 };

export function onRoad(x: number, z: number, margin = 0): boolean {
  for (const [x0, z0, x1, z1, w] of ROADS) {
    const hw = w / 2 + margin;
    if (z0 === z1) { if (x >= x0 - margin && x <= x1 + margin && Math.abs(z - z0) <= hw) return true; }
    else if (z >= z0 - margin && z <= z1 + margin && Math.abs(x - x0) <= hw) return true;
  }
  return false;
}

interface Lot { x: number; z: number; facing: 1 | -1 }

export class Town {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  /** Rectangles (minX, minZ, maxX, maxZ) occupied by buildings — used to keep props off them. */
  readonly footprints: [number, number, number, number][] = [[-11.5, -10.5, 11.5, 11.5]];
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private lampMat!: THREE.MeshStandardMaterial;
  private poolMat!: THREE.MeshBasicMaterial;
  private shard!: THREE.Group;
  private shardLight!: THREE.PointLight;
  private shardDormant = false;
  private smokeTimer = 0;
  readonly lots: Lot[] = [];

  constructor(private physics: CollisionWorld, private terrain: EarthTerrain, treeCount: number) {
    this.buildRoads();
    this.buildNeighbourhood();
    this.buildCommercial();
    this.buildLamps();
    this.buildPark();
    this.buildWaterTower();
    this.buildCrashSite();
    this.buildTrees(treeCount);
  }

  // ------------------------------------------------------------------ roads
  private buildRoads() {
    const asphalt = mat('#b4b6ba', { map: 'asphalt', rough: 0.92 });
    const side = mat('#ece8e0', { map: 'concrete', rough: 0.9 });
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f0e6b0', roughness: 0.8 });
    for (const [x0, z0, x1, z1, w] of ROADS) {
      const horizontal = z0 === z1;
      const len = horizontal ? x1 - x0 : z1 - z0;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const geo = new THREE.PlaneGeometry(horizontal ? len : w, horizontal ? w : len);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (horizontal ? len : w) / 6, uv.getY(i) * (horizontal ? w : len) / 6);
      const road = new THREE.Mesh(geo, asphalt);
      road.rotation.x = -Math.PI / 2;
      road.position.set(cx, 0.03, cz);
      road.receiveShadow = true;
      this.group.add(road);
      // Dashed centre line (instanced)
      const dashes = Math.floor(len / 6);
      const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(horizontal ? 3 : 0.15, horizontal ? 0.15 : 3), lineMat, dashes);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      for (let i = 0; i < dashes; i++) {
        const t = -len / 2 + 3 + i * 6;
        m.compose(new THREE.Vector3(horizontal ? cx + t : cx, 0.045, horizontal ? cz : cz + t), q, new THREE.Vector3(1, 1, 1));
        dash.setMatrixAt(i, m);
      }
      dash.receiveShadow = true;
      this.group.add(dash);
      // Sidewalks (raised 15 cm — characters step onto them)
      const sw = 1.6;
      for (const s of [-1, 1]) {
        if (horizontal) block(this.group, this.physics, x0, 0, cz + s * (w / 2) - (s < 0 ? sw : 0), x1, 0.15, cz + s * (w / 2) + (s > 0 ? sw : 0), { material: side, tile: 2, castShadow: false });
        else block(this.group, this.physics, cx + s * (w / 2) - (s < 0 ? sw : 0), 0, z0, cx + s * (w / 2) + (s > 0 ? sw : 0), 0.15, z1, { material: side, tile: 2, castShadow: false });
      }
    }
    // Intersections: asphalt patches over sidewalks
    for (const [ix, iz] of [[-60, 17], [60, 17], [-60, -75], [60, -75]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), asphalt);
      p.rotation.x = -Math.PI / 2;
      p.position.set(ix, 0.16, iz);
      p.receiveShadow = true;
      this.group.add(p);
    }
  }

  // ------------------------------------------------------------------ houses
  private buildNeighbourhood() {
    const north = [-140, -120, -100, -80, -40, -20, 20, 40, 80, 100, 120, 140];
    const south = [-140, -120, -100, -80, -40, -20, 0, 20, 40, 80, 100, 120, 140];
    for (const x of north) this.lots.push({ x, z: 1, facing: 1 });
    for (const x of south) this.lots.push({ x, z: 33, facing: -1 });
    const n = this.lots.length;
    const rnd = mulberry32(77);
    const W = 10, D = 8, HH = 3;
    const bodyGeo = boxGeo(W, HH, D, 2);
    bodyGeo.translate(0, HH / 2, 0);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ map: mat('#fff', { map: 'plaster' }).map, roughness: 0.9 }), n);
    const shape = new THREE.Shape();
    shape.moveTo(-D / 2 - 0.6, 0);
    shape.lineTo(D / 2 + 0.6, 0);
    shape.lineTo(0, 2.2);
    shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: W + 1, bevelEnabled: false });
    roofGeo.rotateY(Math.PI / 2);
    roofGeo.translate(-(W + 1) / 2, HH, 0);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), n);
    const doorGeo = boxGeo(1.0, 2.1, 0.08);
    doorGeo.translate(-1.5, 1.05, D / 2 + 0.02);
    const doors = new THREE.InstancedMesh(doorGeo, mat('#a8774f', { map: 'wood' }), n);
    const winMat = new THREE.MeshStandardMaterial({ color: '#2a3a4a', roughness: 0.1, metalness: 0.5, emissive: '#ffcf8a', emissiveIntensity: 0 });
    this.windowMats.push(winMat);
    const winGeo = new THREE.PlaneGeometry(1.4, 1.1);
    const windows = new THREE.InstancedMesh(winGeo, winMat, n * 3);
    const garages = new THREE.InstancedMesh(boxGeo(2.6, 2.2, 0.08), mat('#d8d8d8', { rough: 0.5, metal: 0.3 }), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const wallColors = ['#f1e3c8', '#d9e6ec', '#efd6cf', '#e3ecd5', '#f5f0e6', '#e8dcc4'];
    const roofColors = ['#7a3328', '#4a4f57', '#5c3d2e', '#2f4a5c', '#6b2e2e'];
    const c = new THREE.Color();
    this.lots.forEach((lot, i) => {
      const rot = lot.facing === 1 ? 0 : Math.PI;
      q.setFromEuler(new THREE.Euler(0, rot, 0));
      m.compose(new THREE.Vector3(lot.x, 0, lot.z), q, s);
      bodies.setMatrixAt(i, m);
      roofs.setMatrixAt(i, m);
      doors.setMatrixAt(i, m);
      bodies.setColorAt(i, c.set(wallColors[Math.floor(rnd() * wallColors.length)]));
      roofs.setColorAt(i, c.set(roofColors[Math.floor(rnd() * roofColors.length)]));
      // Garage door on the right of the facade
      const gl = new THREE.Vector3(2.6, 1.1, D / 2 + 0.03).applyQuaternion(q).add(new THREE.Vector3(lot.x, 0, lot.z));
      m.compose(gl, q, s);
      garages.setMatrixAt(i, m);
      // Windows: two front, one side
      const wpos = [new THREE.Vector3(-3.6, 1.7, D / 2 + 0.03), new THREE.Vector3(0.4, 1.7, D / 2 + 0.03)];
      wpos.forEach((wp, k) => {
        m.compose(wp.clone().applyQuaternion(q).add(new THREE.Vector3(lot.x, 0, lot.z)), q, s);
        windows.setMatrixAt(i * 3 + k, m);
      });
      const sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot + Math.PI / 2, 0));
      m.compose(new THREE.Vector3(W / 2 + 0.03, 1.7, 0).applyQuaternion(q).add(new THREE.Vector3(lot.x, 0, lot.z)), sq, s);
      windows.setMatrixAt(i * 3 + 2, m);
      this.physics.addBox(lot.x - W / 2, 0, lot.z - D / 2, lot.x + W / 2, HH, lot.z + D / 2, 'house');
      this.physics.addBox(lot.x - W / 2 - 0.5, HH, lot.z - D / 2 + 1, lot.x + W / 2 + 0.5, HH + 1.2, lot.z + D / 2 - 1, 'roof');
      this.footprints.push([lot.x - W / 2 - 1, lot.z - D / 2 - 1, lot.x + W / 2 + 1, lot.z + D / 2 + 1]);
    });
    for (const im of [bodies, roofs, doors, windows, garages]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  private buildCommercial() {
    const specs: [number, number, number, number, number, number][] = [
      // x, z, w, d, h, seed
      [-40, -36, 18, 14, 18, 1],
      [-12, -38, 14, 12, 12, 2],
      [22, -36, 16, 14, 26, 3],
      [44, -38, 12, 12, 14, 4],
      [-100, 60, 16, 16, 21, 5],
      [100, 60, 18, 14, 16, 6],
    ];
    for (const [x, z, w, d, h, seed] of specs) {
      const floors = Math.round(h / 3.2);
      const { map, emissive } = facadeTexture(seed * 31, floors, Math.round(w / 3));
      const side = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.7, color: ['#d9d4cc', '#c9d3dc', '#e0d0c0'][seed % 3] });
      this.windowMats.push(side);
      const top = mat('#5d5f63', { map: 'concrete' });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, side]);
      b.position.set(x, h / 2, z);
      b.castShadow = true;
      b.receiveShadow = true;
      this.group.add(b);
      this.physics.addBox(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, 'building');
      // Rooftop equipment
      block(this.group, this.physics, x - 2, h, z - 2, x + 1, h + 1.6, z + 1, { material: mat('#9a9ea4', { map: 'metal', metal: 0.6, rough: 0.4 }) });
      this.footprints.push([x - w / 2 - 1, z - d / 2 - 1, x + w / 2 + 1, z + d / 2 + 1]);
    }
  }

  private buildLamps() {
    const pts: [number, number, number][] = [];
    for (let x = -165; x <= 165; x += 30) { pts.push([x, 11.7, 0]); pts.push([x + 15, 22.3, Math.PI]); }
    for (let z = -140; z <= 140; z += 32) { pts.push([-65.2, z, Math.PI / 2]); pts.push([65.2, z + 16, -Math.PI / 2]); }
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6, 8);
    poleGeo.translate(0, 3, 0);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.4);
    armGeo.translate(0, 6, 0.6);
    const headGeo = new THREE.BoxGeometry(0.4, 0.15, 0.6);
    headGeo.translate(0, 5.95, 1.25);
    const poleMat = mat('#3a3d42', { metal: 0.7, rough: 0.4 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffd58a', emissiveIntensity: 0 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, pts.length);
    const arms = new THREE.InstancedMesh(armGeo, poleMat, pts.length);
    const heads = new THREE.InstancedMesh(headGeo, this.lampMat, pts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    pts.forEach(([x, z, r], i) => {
      // face the road
      const facing = r === 0 ? Math.PI * 0 : r;
      q.setFromEuler(new THREE.Euler(0, facing, 0));
      m.compose(new THREE.Vector3(x, 0.15, z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m); arms.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      this.physics.addBox(x - 0.15, 0, z - 0.15, x + 0.15, 6, z + 0.15, 'lamp');
    });
    for (const im of [poles, arms, heads]) { im.castShadow = true; im.computeBoundingSphere(); this.group.add(im); }
    // Fake light pools under the lamps at night (no dynamic lights needed).
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex('glow'), color: '#ffcf8a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const poolGeo = new THREE.PlaneGeometry(10, 10);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(poolGeo, this.poolMat, pts.length);
    pts.forEach(([x, z, r], i) => {
      const fx = Math.sin(r) * 1.25, fz = Math.cos(r) * 1.25;
      m.compose(new THREE.Vector3(x + fx, 0.2, z + fz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      pools.setMatrixAt(i, m);
    });
    pools.computeBoundingSphere();
    this.group.add(pools);
  }

  // ------------------------------------------------------------------ park
  private buildPark() {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: '#2b5f78', roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2;
    water.scale.set(POND.rx * 1.12, POND.rz * 1.12, 1);
    water.position.set(POND.x, WATER_LEVEL, POND.z);
    water.receiveShadow = true;
    water.name = 'pond';
    this.group.add(water);
    // Gravel path ring around the pond
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.36, 64), mat('#c2b393', { rough: 1 }));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(POND.rx, POND.rz, 1);
    ring.position.set(POND.x, 0.04, POND.z);
    ring.receiveShadow = true;
    this.group.add(ring);
    const benchMat = mat('#6e4a2c', { map: 'wood' });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = POND.x + Math.cos(a) * POND.rx * 1.48, z = POND.z + Math.sin(a) * POND.rz * 1.48;
      const b = new THREE.Group();
      const seat = new THREE.Mesh(boxGeo(1.8, 0.08, 0.5), benchMat);
      seat.position.y = 0.45;
      const back = new THREE.Mesh(boxGeo(1.8, 0.45, 0.06), benchMat);
      back.position.set(0, 0.75, -0.25);
      b.add(seat, back);
      b.position.set(x, 0, z);
      b.lookAt(POND.x, 0, POND.z);
      b.traverse((o) => { o.castShadow = true; });
      this.group.add(b);
      this.physics.addBox(x - 0.9, 0, z - 0.9, x + 0.9, 0.5, z + 0.9, 'bench');
    }
    this.footprints.push([POND.x - POND.rx * 1.5, POND.z - POND.rz * 1.5, POND.x + POND.rx * 1.5, POND.z + POND.rz * 1.5]);
  }

  private buildWaterTower() {
    const { x, z, platform, top } = WATER_TOWER;
    const steel = mat('#a9b2ba', { map: 'metal', metal: 0.35, rough: 0.5 });
    const tankMat = mat('#e4e8ec', { map: 'metal', metal: 0.25, rough: 0.45 });
    for (const [lx, lz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, platform, 8), steel);
      leg.position.set(x + lx, platform / 2, z + lz);
      leg.castShadow = true;
      this.group.add(leg);
      this.physics.addBox(x + lx - 0.3, 0, z + lz - 0.3, x + lx + 0.3, platform, z + lz + 0.3, 'tower');
    }
    // Cross braces
    for (const [ax, az, rot] of [[0, -2.6, 0], [0, 2.6, 0], [-2.6, 0, Math.PI / 2], [2.6, 0, Math.PI / 2]] as [number, number, number][]) {
      for (const tilt of [0.9, -0.9]) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.2, 6), steel);
        br.position.set(x + ax, platform / 2, z + az);
        br.rotation.set(0, rot, tilt);
        this.group.add(br);
      }
    }
    // Walkway platform with railing
    block(this.group, this.physics, x - 4.5, platform - 0.3, z - 4.5, x + 4.5, platform, z + 4.5, { material: steel, tag: 'tower' });
    const rail = mat('#c94b3a', { metal: 0.6, rough: 0.4 });
    for (const [a, b, c, d] of [[-4.5, -4.5, 4.5, -4.4], [-4.5, 4.4, 4.5, 4.5], [-4.5, -4.5, -4.4, 4.5], [4.4, -4.5, 4.5, 4.5]]) {
      block(this.group, null, x + a, platform + 0.9, z + b, x + c, platform + 1.0, z + d, { material: rail, collide: false });
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, top - platform - 0.6, 28), tankMat);
    tank.position.set(x, (top + platform + 0.6) / 2, z);
    tank.castShadow = true;
    this.group.add(tank);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.25, 28), mat('#c94b3a', { metal: 0.5, rough: 0.5 }));
    cap.position.set(x, top - 0.12, z);
    this.group.add(cap);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
    dome.position.set(x, top, z);
    this.group.add(dome);
    this.physics.addBox(x - 2.6, platform, z - 2.6, x + 2.6, top, z + 2.6, 'tower');
    this.physics.addBox(x - 3.2, top - 0.6, z - 3.2, x + 3.2, top, z + 3.2, 'tower');
    // Painted town name band
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d7dde2'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#2f5d9e'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
    g.fillText('VAL-LUMEN', 128, 48); g.fillText('VAL-LUMEN', 384, 48);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.22, 3.22, 1.4, 28, 1, true), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
    band.position.set(x, (top + platform) / 2 + 1, z);
    this.group.add(band);
    this.footprints.push([x - 5, z - 5, x + 5, z + 5]);
  }

  // ------------------------------------------------------------------ crash site
  private buildCrashSite() {
    const cx = CRASH_SITE.x, cz = CRASH_SITE.z;
    const gy = this.terrain.heightAt(cx, cz);
    this.shard = new THREE.Group();
    this.shard.position.set(cx, gy, cz);
    const crystal = new THREE.MeshStandardMaterial({ color: '#bff6ff', emissive: '#4fd8ff', emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
    const rnd = mulberry32(5);
    for (let i = 0; i < 7; i++) {
      const s = i === 0 ? 1 : 0.35 + rnd() * 0.4;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crystal);
      m.scale.set(s * 0.6, s * 2.2, s * 0.6);
      m.position.set(i === 0 ? 0 : (rnd() - 0.5) * 1.6, s * 0.9, i === 0 ? 0 : (rnd() - 0.5) * 1.6);
      m.rotation.set((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6);
      m.castShadow = true;
      this.shard.add(m);
    }
    this.shard.userData.mat = crystal;
    this.group.add(this.shard);
    this.shardLight = new THREE.PointLight('#6fe3ff', 30, 30, 1.5);
    this.shardLight.position.set(cx, gy + 2, cz);
    this.group.add(this.shardLight);
    // Scattered scorched rocks
    const rockMat = mat('#3b3633', { map: 'rock', rough: 0.95 });
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 16;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const s = 0.3 + rnd() * 1.1;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, this.terrain.heightAt(x, z) + s * 0.3, z);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      rock.castShadow = true;
      this.group.add(rock);
      if (s > 0.8) this.physics.addBox(x - s * 0.7, rock.position.y - s, z - s * 0.7, x + s * 0.7, rock.position.y + s * 0.6, z + s * 0.7, 'rock');
    }
    // Police tape posts
    const tape = mat('#f2d33c', { rough: 0.6 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = cx + Math.cos(a) * 24, z = cz + Math.sin(a) * 24;
      const y = this.terrain.heightAt(x, z);
      block(this.group, null, x - 0.05, y, z - 0.05, x + 0.05, y + 1.1, z + 0.05, { material: mat('#333') , collide: false });
      const a2 = ((i + 1) / 10) * Math.PI * 2;
      const x2 = cx + Math.cos(a2) * 24, z2 = cz + Math.sin(a2) * 24;
      const y2 = this.terrain.heightAt(x2, z2);
      const len = Math.hypot(x2 - x, z2 - z);
      const t = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.01), tape);
      t.position.set((x + x2) / 2, (y + y2) / 2 + 1, (z + z2) / 2);
      t.rotation.y = -Math.atan2(z2 - z, x2 - x);
      this.group.add(t);
    }
    this.interactables.push({
      id: 'shard',
      position: new THREE.Vector3(cx, gy + 1, cz),
      radius: 3.2,
      icon: '✦',
      label: () => (this.shardDormant ? null : "Toucher l'éclat lumineux"),
      use: (game) => {
        this.shardDormant = true;
        game.bus.emit('interact', 'shard');
        game.particles.emit({ count: 200, position: this.shard.position.clone().add(new THREE.Vector3(0, 1, 0)), color: '#bff6ff', color2: '#4f7bff', speed: 9, life: 1.4, size: 0.6, drag: 1.5 });
        game.audio.play('warp');
        game.audio.play('boom', { volume: 0.6 });
        game.cameraRig.shake(0.6);
      },
    });
  }

  /** Marks the shard as already absorbed (loaded saves). */
  setShardDormant(v: boolean) { this.shardDormant = v; }

  // ------------------------------------------------------------------ trees
  private buildTrees(count: number) {
    const rnd = mulberry32(99);
    const positions: [number, number, number, number][] = [];
    let guard = 0;
    while (positions.length < count && guard++ < count * 30) {
      const near = rnd() < 0.55;
      const x = near ? (rnd() - 0.5) * 330 : (rnd() - 0.5) * 640;
      const z = near ? (rnd() - 0.5) * 330 : (rnd() - 0.5) * 640;
      if (onRoad(x, z, 3)) continue;
      if (this.footprints.some(([a, b, c, d]) => x > a - 1.5 && x < c + 1.5 && z > b - 1.5 && z < d + 1.5)) continue;
      if (Math.hypot(x - CRASH_SITE.x, z - CRASH_SITE.z) < 28) continue;
      // keep front yards along the main street mostly open
      if (Math.abs(z - 17) < 14 && Math.abs(x) < 170 && rnd() < 0.8) continue;
      const y = this.terrain.heightAt(x, z);
      if (y < 0.05 && Math.abs(x) > 150) continue;
      positions.push([x, y, z, 0.7 + rnd() * 0.7]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 7);
    trunkGeo.translate(0, 1.3, 0);
    const leafyGeo = new THREE.IcosahedronGeometry(1.9, 1);
    leafyGeo.translate(0, 3.6, 0);
    const pineGeo = new THREE.ConeGeometry(1.6, 4.8, 9);
    pineGeo.translate(0, 4.2, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat('#7a5c44', { rough: 1 }), positions.length);
    const leafy = positions.filter((_, i) => i % 3 !== 0);
    const pines = positions.filter((_, i) => i % 3 === 0);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const leafs = new THREE.InstancedMesh(leafyGeo, leafMat, leafy.length);
    const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), pines.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    positions.forEach(([x, y, z, s], i) => {
      q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, 0));
      m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      if (Math.abs(x) < 330 && Math.abs(z) < 330) this.physics.addBox(x - 0.3 * s, y - 1, z - 0.3 * s, x + 0.3 * s, y + 2.6 * s, z + 0.3 * s, 'tree');
    });
    leafy.forEach(([x, y, z, s], i) => {
      q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0));
      m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s * (0.9 + rnd() * 0.3), s * (0.85 + rnd() * 0.4), s * (0.9 + rnd() * 0.3)));
      leafs.setMatrixAt(i, m);
      leafs.setColorAt(i, c.setHSL(0.24 + rnd() * 0.08, 0.45 + rnd() * 0.2, 0.25 + rnd() * 0.12));
    });
    pines.forEach(([x, y, z, s], i) => {
      m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.4), s));
      pineMesh.setMatrixAt(i, m);
      pineMesh.setColorAt(i, c.setHSL(0.3 + rnd() * 0.05, 0.4, 0.18 + rnd() * 0.08));
    });
    for (const im of [trunks, leafs, pineMesh]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  update(dt: number, game: Game, night: number) {
    for (const wm of this.windowMats) wm.emissiveIntensity = night * 1.1;
    this.lampMat.emissiveIntensity = night * 3;
    this.poolMat.opacity = night * 0.55;
    // Shard pulse
    const t = performance.now() / 1000;
    const crystal = this.shard.userData.mat as THREE.MeshStandardMaterial;
    const pulse = this.shardDormant ? 0.25 : 1.6 + Math.sin(t * 2.5) * 0.7;
    crystal.emissiveIntensity = pulse;
    this.shardLight.intensity = this.shardDormant ? 2 : 22 + Math.sin(t * 2.5) * 10;
    this.shard.rotation.y += dt * 0.15;
    // Smoke from the crater while the player is around
    const p = game.player.position;
    const d = Math.hypot(p.x - CRASH_SITE.x, p.z - CRASH_SITE.z);
    if (d < 180) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        const pos = this.shard.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0.5, (Math.random() - 0.5) * 4));
        if (!this.shardDormant) game.particles.emit({ count: 2, position: pos, color: '#7fe8ff', color2: '#24324a', speed: 1.2, direction: new THREE.Vector3(0, 1, 0), spread: 0.25, life: 3, size: 1.2, sizeEnd: 3, drag: 0.3, gravity: -0.4 });
      }
    }
  }
}
