import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Loads and caches the game's real 3D assets (glTF models, PBR textures, HDRI, planet maps).
 * Every consumer checks `has()` and keeps a procedural fallback, so a missing or corrupted file
 * never prevents the game from running.
 */

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  arm: THREE.Texture | null;
}

export const MODEL_LIST = [
  // characters
  'human_male', 'human_female', 'suit_body', 'robot', 'fox',
  // house
  'sofa', 'armchair', 'coffee_table', 'television', 'dining_table', 'chair', 'bed_frame', 'nightstand', 'desk', 'radio',
  'laptop', 'bookshelf', 'wardrobe', 'plant', 'ceiling_lamp', 'desk_lamp', 'stove', 'microwave', 'wall_clock', 'picture_frame', 'pillows',
  // town
  'street_lamp', 'fire_hydrant', 'dumpster', 'street_bench', 'picnic_table', 'utility_box', 'garden_gnome', 'planter', 'barrel', 'crate',
  'cardboard_box', 'road_barrier', 'covered_car', 'aircon', 'shrub_a', 'shrub_b', 'fern', 'boulder', 'mossy_rocks', 'tree_stump',
  // generated in Blender (tools/blender)
  'tree_broadleaf', 'tree_broadleaf_lod', 'tree_fir', 'tree_fir_lod', 'house_a', 'house_b', 'house_c', 'car_sedan', 'car_hatch',
  'ship_scout', 'ship_fighter', 'ship_explorer', 'creature_stalker', 'creature_spitter', 'creature_brute', 'creature_drone', 'titan',
  // space
  'iss', 'lunar_module', 'astronaut', 'hubble', 'voyager', 'moon_rock_1', 'moon_rock_2', 'moon_rock_3', 'moon_rock_4',
] as const;

export const TEXTURE_SETS = ['grass', 'rock', 'dirt', 'asphalt', 'paving', 'plaster', 'wood_floor', 'tiles', 'roof', 'brick', 'metal', 'concrete', 'moon', 'bark', 'fabric'] as const;
export const SPACE_IMAGES = ['earth_day', 'earth_night', 'earth_clouds', 'moon_color', 'starmap'] as const;

export class Assets {
  private gltfs = new Map<string, GLTF>();
  private textures = new Map<string, THREE.Texture>();
  private loader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();
  hdr: THREE.DataTexture | null = null;
  readonly failed: string[] = [];
  private maxAniso = 4;

  constructor(private base = './assets/') {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  setAnisotropy(a: number) { this.maxAniso = a; }

  /** Loads everything; resolves even if some files are missing (they are reported in `failed`). */
  async preload(onProgress: (done: number, total: number, label: string) => void): Promise<void> {
    // The build writes manifest.json listing the files that really exist (no 404 probing).
    let manifest: { models: string[]; textures: string[]; space: string[]; hdri: string[] } | null = null;
    try {
      const r = await fetch(`${this.base}manifest.json`);
      if (r.ok) manifest = await r.json();
    } catch { /* offline/file: fall back to the full lists */ }
    const present = (list: string[] | undefined, name: string) => !list || list.includes(name);
    const jobs: { label: string; run: () => Promise<void> }[] = [];
    for (const name of MODEL_LIST) if (present(manifest?.models, name)) jobs.push({ label: name, run: () => this.loadModel(name) });
    for (const set of TEXTURE_SETS) for (const kind of ['diff', 'nor', 'arm'] as const) {
      if (present(manifest?.textures, `${set}_${kind}`)) jobs.push({ label: `${set}_${kind}`, run: () => this.loadTexture(`textures/${set}_${kind}.webp`, kind === 'diff') });
    }
    for (const img of SPACE_IMAGES) if (present(manifest?.space, img)) jobs.push({ label: img, run: () => this.loadTexture(`space/${img}.webp`, true) });
    if (present(manifest?.hdri, 'sky_day')) jobs.push({ label: 'hdri', run: () => this.loadHdr('hdri/sky_day.hdr') });
    let done = 0;
    const total = jobs.length;
    // Limited parallelism keeps memory spikes low on phones.
    const queue = [...jobs];
    const worker = async () => {
      while (queue.length) {
        const j = queue.shift()!;
        try { await j.run(); } catch { this.failed.push(j.label); }
        done++;
        onProgress(done, total, j.label);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.bindPbrMaterials();
    if (this.failed.length) console.warn('[Assets] indisponibles (repli procédural utilisé) :', this.failed.join(', '));
  }

  private loadModel(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loader.load(`${this.base}models/${name}.glb`, (g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              const sm = mat as THREE.MeshStandardMaterial;
              // Leaf cards: alpha-tested, double-sided, no sorting artefacts.
              if (/leaves|leaf|twig/i.test(sm.name)) {
                sm.transparent = false;
                sm.alphaTest = 0.45;
                sm.side = THREE.DoubleSide;
                sm.depthWrite = true;
              }
              for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
                const t = sm[key] as THREE.Texture | null;
                if (t) t.anisotropy = this.maxAniso;
              }
            }
          }
        });
        this.gltfs.set(name, g);
        resolve();
      }, undefined, () => reject(new Error(name)));
    });
  }

  private loadTexture(path: string, color: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.texLoader.load(`${this.base}${path}`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.maxAniso;
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(path, t);
        resolve();
      }, undefined, () => reject(new Error(path)));
    });
  }

  private loadHdr(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new RGBELoader().load(`${this.base}${path}`, (t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        this.hdr = t;
        resolve();
      }, undefined, () => reject(new Error(path)));
    });
  }

  /**
   * Models built in Blender name their tiling materials `pbr_<set>`: bind them to the shared
   * Poly Haven texture sets (one texture in GPU memory for every house, wall, door…).
   */
  private bindPbrMaterials() {
    const shared = new Map<string, THREE.MeshStandardMaterial>();
    const SET_ALIAS: Record<string, string> = { wood: 'wood_floor' };
    for (const g of this.gltfs.values()) {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (Array.isArray(mat) || !mat.name?.startsWith('pbr_')) return;
        const set = SET_ALIAS[mat.name.slice(4)] ?? mat.name.slice(4);
        if (!(TEXTURE_SETS as readonly string[]).includes(set) || !this.textures.has(`textures/${set}_diff.webp`)) return;
        const key = set + mat.color.getHexString();
        let sm = shared.get(key);
        if (!sm) {
          sm = this.material(set as (typeof TEXTURE_SETS)[number], 1, '#888888');
          sm.color.copy(mat.color);
          sm.name = mat.name;
          shared.set(key, sm);
        }
        m.material = sm;
      });
    }
  }

  has(name: string): boolean { return this.gltfs.has(name); }

  animations(name: string): THREE.AnimationClip[] { return this.gltfs.get(name)?.animations ?? []; }

  /** Instance of a static model (geometry and materials are shared). */
  model(name: string): THREE.Group | null {
    const g = this.gltfs.get(name);
    if (!g) return null;
    const c = g.scene.clone(true);
    return c as unknown as THREE.Group;
  }

  /** Independent instance of a skinned, animated model. */
  character(name: string): THREE.Group | null {
    const g = this.gltfs.get(name);
    if (!g) return null;
    return SkeletonUtils.clone(g.scene) as THREE.Group;
  }

  /** All meshes of a model merged into (geometry, material) pairs, for InstancedMesh use. */
  parts(name: string): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    const g = this.gltfs.get(name);
    if (!g) return [];
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      out.push({ geometry: geo, material: m.material as THREE.Material });
    });
    return out;
  }

  texture(path: string): THREE.Texture | null { return this.textures.get(path) ?? null; }

  space(name: (typeof SPACE_IMAGES)[number]): THREE.Texture | null { return this.textures.get(`space/${name}.webp`) ?? null; }

  /** PBR texture set with its own repeat (textures are cloned so repeats are independent). */
  pbr(set: (typeof TEXTURE_SETS)[number], repeatX = 1, repeatY = repeatX): PbrSet | null {
    const base = this.textures.get(`textures/${set}_diff.webp`);
    if (!base) return null;
    const rep = (t: THREE.Texture | undefined | null) => {
      if (!t) return null;
      const c = t.clone();
      c.repeat.set(repeatX, repeatY);
      c.needsUpdate = true;
      return c;
    };
    return { map: rep(base)!, normalMap: rep(this.textures.get(`textures/${set}_nor.webp`)), arm: rep(this.textures.get(`textures/${set}_arm.webp`)) };
  }

  /** Standard material from a PBR set, or a plain fallback colour. */
  material(set: (typeof TEXTURE_SETS)[number], repeat: number, fallback: string, opts: { tint?: string; normalScale?: number; metal?: boolean } = {}): THREE.MeshStandardMaterial {
    const p = this.pbr(set, repeat);
    if (!p) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.85 });
    const m = new THREE.MeshStandardMaterial({
      color: opts.tint ?? '#ffffff',
      map: p.map,
      normalMap: p.normalMap,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      aoMap: p.arm,
      roughnessMap: p.arm,
      metalnessMap: opts.metal ? p.arm : null,
      roughness: 1,
      metalness: opts.metal ? 1 : 0,
    });
    return m;
  }
}

/**
 * Wraps a model in a holder group, scales it uniformly so its bounding box fits inside `size`
 * (any axis may be omitted, or 'height' mode to match Y only), centres it on X/Z and puts its
 * base at y = 0 in the holder's space.
 */
export function fitTo(model: THREE.Object3D, size: { x?: number; y?: number; z?: number }, mode: 'fit' | 'height' = 'fit'): THREE.Group {
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  const dim = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  let s = Infinity;
  if (mode === 'height' && size.y) s = size.y / Math.max(1e-6, dim.y);
  else {
    if (size.x) s = Math.min(s, size.x / Math.max(1e-6, dim.x));
    if (size.y) s = Math.min(s, size.y / Math.max(1e-6, dim.y));
    if (size.z) s = Math.min(s, size.z / Math.max(1e-6, dim.z));
  }
  if (!Number.isFinite(s)) s = 1;
  model.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(model);
  const c = b.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.y -= b.min.y;
  model.position.z -= c.z;
  return holder;
}
