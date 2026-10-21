import * as THREE from 'three';
import { currentAssets } from './build';

export interface InstanceSpec {
  x: number; y: number; z: number;
  rotY: number;
  scale: number;
  /** Optional per-instance tint applied to parts accepted by `tintFilter`. */
  color?: THREE.Color;
}

/** Meshes (with their transform relative to `root`'s parent) under a model or one of its variants. */
function meshesOf(root: THREE.Object3D): { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] {
  root.updateMatrixWorld(true);
  // Relative to the root's parent: the root node itself may carry the mesh dequantization
  // scale (KHR_mesh_quantization), which must be kept.
  const inv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : new THREE.Matrix4();
  const out: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) out.push({ mesh: m, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  return out;
}

/** Top-level variants of a model file (several objects side by side → one entry each). */
export function variantRoots(name: string): THREE.Object3D[] {
  const scene = currentAssets()?.model(name);
  if (!scene) return [];
  // glTF scenes wrap nodes; descend through single-child wrappers.
  let root: THREE.Object3D = scene;
  while (root.children.length === 1 && !(root.children[0] as THREE.Mesh).isMesh) root = root.children[0];
  return root.children.length > 1 ? root.children : [root];
}

/**
 * Renders many copies of a real model with GPU instancing: one InstancedMesh per model part,
 * so a whole street of houses costs a handful of draw calls.
 */
export function instanceModel(
  source: THREE.Object3D,
  specs: InstanceSpec[],
  opts: { castShadow?: boolean; tintFilter?: (material: THREE.Material) => boolean; recentre?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group();
  if (!specs.length) return group;
  // Variants are laid out side by side in their file: move each back to the origin.
  const offset = new THREE.Matrix4();
  if (opts.recentre !== false) {
    const box = new THREE.Box3().setFromObject(source);
    const c = box.getCenter(new THREE.Vector3());
    offset.makeTranslation(-c.x, -box.min.y, -c.z);
  }
  const parts = meshesOf(source);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const { mesh, matrix } of parts) {
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, specs.length);
    const local = new THREE.Matrix4().multiplyMatrices(offset, matrix);
    const tint = opts.tintFilter?.(mesh.material as THREE.Material) ?? false;
    specs.forEach((s, i) => {
      q.setFromAxisAngle(up, s.rotY);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale)).multiply(local);
      im.setMatrixAt(i, m);
      if (tint && s.color) im.setColorAt(i, s.color);
    });
    if (tint && !im.instanceColor) im.setColorAt(0, new THREE.Color(1, 1, 1));
    im.castShadow = opts.castShadow ?? true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.frustumCulled = true;
    group.add(im);
  }
  return group;
}

interface TreeInstance extends InstanceSpec { kind: number; variant: number }

/**
 * Forest of real tree models: detailed near the camera, low-poly far away (LOD swapped every
 * half second by refilling instance buffers — no per-tree objects or draw calls).
 */
export class TreeField {
  readonly group = new THREE.Group();
  private sets: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; trees: TreeInstance[]; locals: { near: THREE.Matrix4[]; far: THREE.Matrix4[] } }[] = [];
  private timer = 0;
  readonly ok: boolean;

  constructor(trees: TreeInstance[], kinds: [string, string][], private nearDistance = 110) {
    let ok = true;
    kinds.forEach(([nearName, farName], kind) => {
      const nearVariants = variantRoots(nearName);
      const farVariants = variantRoots(farName);
      if (!nearVariants.length || !farVariants.length) { ok = false; return; }
      nearVariants.forEach((nv, variant) => {
        const fv = farVariants[variant % farVariants.length];
        const mine = trees.filter((t) => t.kind === kind && t.variant % nearVariants.length === variant);
        if (!mine.length) return;
        const build = (root: THREE.Object3D, shadow: boolean) => {
          const box = new THREE.Box3().setFromObject(root);
          const c = box.getCenter(new THREE.Vector3());
          const offset = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
          const parts = meshesOf(root);
          const meshes = parts.map(({ mesh }) => {
            const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, mine.length);
            im.castShadow = shadow;
            im.receiveShadow = true;
            im.count = 0;
            im.frustumCulled = false;
            this.group.add(im);
            return im;
          });
          return { meshes, locals: parts.map(({ matrix }) => new THREE.Matrix4().multiplyMatrices(offset, matrix)) };
        };
        const near = build(nv, true);
        const far = build(fv, false);
        this.sets.push({ near: near.meshes, far: far.meshes, trees: mine, locals: { near: near.locals, far: far.locals } });
      });
    });
    this.ok = ok && this.sets.length > 0;
  }

  update(dt: number, camera: THREE.Vector3, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.5;
    const m = new THREE.Matrix4();
    const base = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const nd2 = this.nearDistance * this.nearDistance;
    for (const set of this.sets) {
      let n = 0, f = 0;
      for (const t of set.trees) {
        const dx = t.x - camera.x, dz = t.z - camera.z;
        const near = dx * dx + dz * dz < nd2;
        q.setFromAxisAngle(up, t.rotY);
        base.compose(v.set(t.x, t.y, t.z), q, s.set(t.scale, t.scale, t.scale));
        const meshes = near ? set.near : set.far;
        const locals = near ? set.locals.near : set.locals.far;
        const idx = near ? n++ : f++;
        meshes.forEach((im, k) => im.setMatrixAt(idx, m.multiplyMatrices(base, locals[k])));
      }
      set.near.forEach((im) => { im.count = n; im.instanceMatrix.needsUpdate = true; });
      set.far.forEach((im) => { im.count = f; im.instanceMatrix.needsUpdate = true; });
    }
  }
}
