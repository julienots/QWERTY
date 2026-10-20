import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { tex } from '../fx/textures';
import type { Assets, TEXTURE_SETS } from '../core/Assets';

let assetsRef: Assets | null = null;
/** Lets world builders use real PBR texture sets (falls back to procedural canvas textures). */
export function useAssets(a: Assets | null) { assetsRef = a; }
export function currentAssets(): Assets | null { return assetsRef; }

/** Procedural texture name → real PBR set (Poly Haven). */
const PBR_FOR: Record<string, (typeof TEXTURE_SETS)[number]> = {
  plaster: 'plaster', wood: 'wood_floor', tiles: 'tiles', roof: 'roof', brick: 'brick', concrete: 'concrete',
  asphalt: 'asphalt', metal: 'metal', rock: 'rock', grass: 'grass', fabric: 'fabric', moon: 'moon', paving: 'paving',
};

/** BoxGeometry whose UVs are scaled to world size so tiling textures keep a constant density. */
export function boxGeo(w: number, h: number, d: number, tile = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared standard material keyed by its parameters. */
export function mat(color: string, opts: { map?: string; rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, opts]);
  let m = matCache.get(key);
  const set = opts.map ? PBR_FOR[opts.map] : undefined;
  const pbr = !m && set && assetsRef ? assetsRef.pbr(set, 1) : null;
  if (!m && pbr) {
    m = new THREE.MeshStandardMaterial({
      color,
      map: pbr.map,
      normalMap: pbr.normalMap,
      aoMap: pbr.arm,
      roughnessMap: pbr.arm,
      metalnessMap: opts.metal && opts.metal > 0.3 ? pbr.arm : null,
      roughness: Math.min(1, (opts.rough ?? 0.8) + 0.25),
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      map: opts.map ? tex(opts.map) : null,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

/** Clears the shared material cache (materials are disposed with their zone). */
export function clearMaterialCache() {
  matCache.clear();
}

export interface BlockOptions {
  material: THREE.Material;
  collide?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  tile?: number;
  tag?: string;
}

/** Adds an axis-aligned block (visual + optional collider) given min/max corners. */
export function block(
  parent: THREE.Object3D,
  physics: CollisionWorld | null,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
  o: BlockOptions,
): THREE.Mesh {
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  const m = new THREE.Mesh(boxGeo(w, h, d, o.tile ?? 1), o.material);
  m.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  m.castShadow = o.castShadow ?? true;
  m.receiveShadow = o.receiveShadow ?? true;
  parent.add(m);
  if (physics && o.collide !== false) physics.addBox(minX, minY, minZ, maxX, maxY, maxZ, o.tag);
  return m;
}

/** Glass material shared by windows. */
export function glassMaterial(): THREE.MeshStandardMaterial {
  return mat('#9cc7e0', { rough: 0.05, metal: 0.6, transparent: true, opacity: 0.35 });
}

/**
 * Static batching: merges every non-moving mesh under `root` that shares a material into a
 * single draw call. Objects (or ancestors) flagged with `userData.dynamic` are left alone.
 * Cuts draw calls dramatically for furnished interiors on mobile GPUs.
 */
export function batchStatic(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const victims: THREE.Mesh[] = [];
  const isDynamic = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.dynamic) return true;
    return false;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as any).isInstancedMesh || Array.isArray(m.material) || isDynamic(m)) return;
    const g = m.geometry;
    if (!g.index || !g.getAttribute('normal') || !g.getAttribute('uv') || g.morphAttributes.position) return;
    // Quantized (meshopt / KHR_mesh_quantization) attributes can't be baked & merged: leave those meshes alone.
    for (const name of ['position', 'normal', 'uv']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      if (!(attr.array instanceof Float32Array) || attr.normalized || (attr as any).isInterleavedBufferAttribute) return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(g.index.clone());
    for (const name of ['position', 'normal', 'uv']) geo.setAttribute(name, g.getAttribute(name).clone());
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const key = m.material.uuid + (m.castShadow ? ':s' : '');
    let entry = groups.get(key);
    if (!entry) { entry = { material: m.material as THREE.Material, cast: m.castShadow, geos: [], meshes: [] }; groups.set(key, entry); }
    entry.geos.push(geo);
    entry.meshes.push(m);
  });
  let count = 0;
  for (const { material, cast, geos, meshes } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue; // keep the original meshes when merging is impossible
    for (const v of meshes) { v.parent?.remove(v); victims.push(v); }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
    count++;
  }
  return victims.length - count;
}

export interface Placement {
  x: number; y: number; z: number;
  /** Target footprint: w along X, d along Z (before rotY), h height. */
  w: number; h: number; d: number;
  rotY?: number;
  /** Allow non-uniform scaling to fill the box exactly (tables, counters). */
  stretch?: boolean;
  /** Align the model's long horizontal side with the box's long side. */
  align?: boolean;
  shadow?: boolean;
}

/**
 * Places a copy of a real model inside a target box: scaled to fit, base on `y`, centred on
 * (x, z), then rotated by rotY around its centre. Returns null if the model isn't loaded.
 */
export function placeModel(name: string, p: Placement): THREE.Group | null {
  const model = assetsRef?.model(name);
  if (!model) return null;
  const inner = new THREE.Group();
  inner.add(model);
  let size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  if (p.align !== false && (size.x - size.z) * (p.w - p.d) < 0) {
    model.rotation.y += Math.PI / 2;
    inner.updateMatrixWorld(true);
    size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  }
  const sx = p.w / Math.max(1e-6, size.x), sy = p.h / Math.max(1e-6, size.y), sz = p.d / Math.max(1e-6, size.z);
  if (p.stretch) inner.scale.set(sx, sy, sz);
  else inner.scale.setScalar(Math.min(sx, sy, sz));
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner);
  const c = b.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -b.min.y, -c.z);
  const holder = new THREE.Group();
  holder.add(inner);
  holder.position.set(p.x, p.y, p.z);
  holder.rotation.y = p.rotY ?? 0;
  holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = p.shadow ?? true; o.receiveShadow = true; } });
  return holder;
}
