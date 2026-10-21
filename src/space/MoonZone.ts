import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable, MapMarker, Zone } from '../world/Zone';
import { disposeObject } from '../world/Zone';
import { HeightGrid, type SplatFn } from '../world/Terrain';
import { terrainMaterial } from '../world/TerrainMaterial';
import { boxGeo, currentAssets, mat } from '../world/build';
import { fitTo } from '../core/Assets';
import { instanceModel, type InstanceSpec } from '../world/Instanced';
import { Noise2D, mulberry32, smoothstep } from '../core/noise';
import { Impostor } from './celestial';
import { SUN_DIR, makeEarth, spaceBackground, spaceLights } from './Scenery';

export const RUINS = { x: 260, z: -190 };
export const LANDING_SITE = { x: -30, z: 12 };
const INNER = 700;
/** Game-scale lunar radius used to bend the ground towards a close horizon. */
const CURVATURE_RADIUS = 1737;

interface Crater { x: number; z: number; r: number; depth: number }

/** Cratered lunar ground: rolling regolith, bowl craters with raised rims, a close horizon. */
class MoonTerrain {
  private noise = new Noise2D(1969);
  private craters: Crater[] = [];
  inner: HeightGrid;
  outer: HeightGrid;
  readonly mesh = new THREE.Group();

  constructor(private detail: 'low' | 'high') {
    const rnd = mulberry32(1969);
    for (let i = 0; i < 140; i++) {
      const r = 6 + Math.pow(rnd(), 2.6) * 120;
      const x = (rnd() - 0.5) * 2600, z = (rnd() - 0.5) * 2600;
      // Keep the landing site and the ruins plateau usable.
      if (Math.hypot(x - LANDING_SITE.x, z - LANDING_SITE.z) < 70 + r || Math.hypot(x - RUINS.x, z - RUINS.z) < 60 + r) continue;
      this.craters.push({ x, z, r, depth: r * (0.18 + rnd() * 0.1) });
    }
    this.craters.push({ x: 150, z: 120, r: 95, depth: 22 }, { x: -260, z: -160, r: 140, depth: 30 });
    const spacing = detail === 'high' ? 5 : 7;
    this.inner = new HeightGrid(-INNER, -INNER, spacing, Math.round((INNER * 2) / spacing) + 1, (x, z) => this.raw(x, z));
    this.outer = new HeightGrid(-6000, -6000, 80, 151, (x, z) => this.raw(x, z));
  }

  raw(x: number, z: number): number {
    const n = this.noise;
    let h = (n.fbm(x / 420, z / 420, 4) * 0.5 + 0.5) * 26 + n.fbm(x / 60, z / 60, 3) * 1.6;
    for (const c of this.craters) {
      const dx = x - c.x, dz = z - c.z;
      const d2 = (dx * dx + dz * dz) / (c.r * c.r);
      if (d2 > 3) continue;
      const d = Math.sqrt(d2);
      // Parabolic bowl plus a raised rim.
      if (d < 1) h -= c.depth * (1 - d2);
      h += c.depth * 0.35 * Math.exp(-(((d - 1) / 0.28) ** 2));
    }
    // Flatten the landing site and the ruins plateau.
    const site = smoothstep(80, 40, Math.hypot(x - LANDING_SITE.x, z - LANDING_SITE.z));
    const ruins = smoothstep(75, 45, Math.hypot(x - RUINS.x, z - RUINS.z));
    h = h * (1 - site) + 8 * site;
    h = h * (1 - ruins) + 18 * ruins;
    // Close lunar horizon.
    const r = Math.hypot(x, z);
    if (r > 500) h -= ((r - 500) ** 2) / (2 * CURVATURE_RADIUS);
    return h;
  }

  heightAt(x: number, z: number): number {
    if (this.inner.contains(x, z)) return this.inner.heightAt(x, z);
    if (this.outer.contains(x, z)) return this.outer.heightAt(x, z);
    return this.raw(x, z);
  }

  build(): THREE.Group {
    const tint = new THREE.Color();
    const colorFn = (x: number, z: number) => {
      const m = this.noise.fbm(x / 900 + 11, z / 900 - 4, 3) * 0.5 + 0.5;
      return tint.setScalar(0.78 + 0.22 * smoothstep(0.35, 0.7, m));
    };
    const splatFn: SplatFn = (x, z, h, slope) => {
      const mare = smoothstep(0.45, 0.75, this.noise.fbm(x / 600 - 7, z / 600 + 2, 3) * 0.5 + 0.5);
      const rock = smoothstep(0.35, 0.8, slope);
      void h;
      return [Math.max(0, 1 - mare - rock), mare * (1 - rock), rock, 0];
    };
    const m = terrainMaterial(currentAssets(), this.detail, { sets: ['moon', 'moon', 'rock'], tintA: 'vec3(0.92, 0.91, 0.9)', tintB: 'vec3(0.55, 0.55, 0.56)', key: 'moon' })
      ?? mat('#a9a7a3', { map: 'moon', rough: 1 });
    (m as THREE.MeshStandardMaterial).vertexColors = true;
    const inner = new THREE.Mesh(this.inner.buildGeometry(colorFn, (x, z, h) => {
      const o = this.outer.heightAt(x, z) - 0.05;
      return o < h ? Math.min(o - 0.3, h - 0.5) : o + 0.02;
    }, splatFn), m);
    inner.receiveShadow = true;
    this.mesh.add(inner);
    const og = this.outer.buildGeometry(colorFn, 0, splatFn);
    const idx = og.getIndex()!.array as Uint32Array;
    const pos = og.getAttribute('position');
    const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      let inside = true;
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        if (Math.abs(pos.getX(v)) > INNER + 0.01 || Math.abs(pos.getZ(v)) > INNER + 0.01) { inside = false; break; }
      }
      if (!inside) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    og.setIndex(keep);
    const outer = new THREE.Mesh(og, m);
    outer.position.y = -0.05;
    this.mesh.add(outer);
    return this.mesh;
  }
}

function glyphTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 512);
  const rnd = mulberry32(7);
  g.strokeStyle = '#7ff0ff'; g.lineWidth = 3; g.shadowColor = '#7ff0ff'; g.shadowBlur = 8;
  for (let y = 24; y < 500; y += 34) {
    g.beginPath();
    let x = 20 + rnd() * 20;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += 12 + rnd() * 14; g.lineTo(x, y + (rnd() - 0.5) * 18); }
    g.stroke();
    if (rnd() < 0.5) { g.beginPath(); g.arc(64 + (rnd() - 0.5) * 50, y + 8, 5 + rnd() * 5, 0, Math.PI * 2); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The Moon: landing site with the Apollo Lunar Module, rocks, craters, ancient ruins. */
export class MoonZone implements Zone {
  readonly id = 'moon';
  readonly name = 'Lune — Mer de la Tranquillité';
  readonly gravity = 1.62;
  readonly hasAtmosphere = false;
  readonly envIntensity = 0.1;
  readonly root = new THREE.Group();
  readonly physics = new CollisionWorld();
  readonly interactables: Interactable[] = [];
  readonly spawn: THREE.Vector3;
  readonly mapExtent = 500;
  readonly background: THREE.Texture | THREE.Color;
  readonly terrain: MoonTerrain;
  private earth: Impostor;
  private earthGroup: THREE.Group;
  private sun: THREE.DirectionalLight;
  private sunDisc: THREE.Object3D | null;
  private monolithMat: THREE.MeshStandardMaterial;
  private guardsSpawned = false;
  private t = 0;

  constructor(game: Game) {
    const q = game.quality;
    this.terrain = new MoonTerrain(q.viewDistance >= 800 ? 'high' : 'low');
    this.physics.ground = (x, z) => this.terrain.heightAt(x, z);
    this.root.add(this.terrain.build());
    this.background = spaceBackground(this.root);
    this.sun = spaceLights(this.root, q.shadows, q.shadowMapSize, 80);
    this.sunDisc = this.root.children.find((c) => c.userData.followCamera) ?? null;
    this.spawn = new THREE.Vector3(12, this.terrain.heightAt(12, 20) + 0.2, 20);

    const e = makeEarth(6000, 96);
    this.earthGroup = e.group;
    this.root.add(e.group);
    this.earth = new Impostor(e.group, new THREE.Vector3(0.55, 0.35, 0.76).normalize().multiplyScalar(110000), 6200);

    this.buildLandingSite();
    this.buildRocks(q.viewDistance >= 800 ? 420 : 200);
    this.monolithMat = this.buildRuins();
    this.interactables.push({
      id: 'monolith', position: new THREE.Vector3(RUINS.x, this.terrain.heightAt(RUINS.x, RUINS.z) + 2, RUINS.z + 2.5), radius: 5, icon: '✦',
      label: () => 'Toucher le monolithe',
      use: (g) => {
        g.hud.clearDialog();
        g.cameraRig.shake(0.4);
        g.audio.play('warp', { volume: 0.8, pitch: 0.7 });
        g.particles.emit({ count: 80, position: new THREE.Vector3(RUINS.x, this.terrain.heightAt(RUINS.x, RUINS.z) + 4, RUINS.z), color: '#7ff0ff', color2: '#ffffff', speed: 9, life: 1.6, size: 0.7, drag: 1.5 });
        g.hud.say('Monolithe', '« Gardien… Tu portes l’Essence, comme ceux qui ont scellé le Néant il y a des âges. »', 5);
        g.hud.say('Monolithe', '« Le sceau se brise. Ce qui attend derrière ne veut pas seulement la Terre : il veut tout ce qui brille. »', 6);
        g.hud.say('Monolithe', '« Rentre chez toi. Prépare ton monde. Et grandis — jusqu’aux étoiles. »', 5);
        g.bus.emit('interact', 'monolith');
      },
    });
  }

  private buildLandingSite() {
    const a = currentAssets();
    const { x, z } = LANDING_SITE;
    const y = this.terrain.heightAt(x, z);
    const lm = a?.model('lunar_module');
    if (lm) {
      const h = fitTo(lm, { y: 7 }, 'height');
      h.position.set(x, y - 0.1, z);
      h.rotation.y = 0.7;
      h.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.root.add(h);
      this.physics.addBox(x - 2.6, y, z - 2.6, x + 2.6, y + 5.5, z + 2.6, 'lm');
    }
    const astro = a?.model('astronaut');
    if (astro) {
      const s = fitTo(astro, { y: 1.85 }, 'height');
      s.position.set(x + 6, this.terrain.heightAt(x + 6, z + 4), z + 4);
      s.rotation.y = -2.2;
      s.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.root.add(s);
      this.physics.addBox(x + 5.6, s.position.y, z + 3.6, x + 6.4, s.position.y + 1.85, z + 4.4, 'astronaut');
    }
    // Ship landing pad lights
    const lightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffb347', emissiveIntensity: 3 });
    const geo = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 8);
    for (let i = 0; i < 10; i++) {
      const a2 = (i / 10) * Math.PI * 2;
      const lx = 18 + Math.cos(a2) * 12, lz = 26 + Math.sin(a2) * 12;
      const l = new THREE.Mesh(geo, lightMat);
      l.position.set(lx, this.terrain.heightAt(lx, lz) + 0.15, lz);
      this.root.add(l);
    }
  }

  private buildRocks(count: number) {
    const rnd = mulberry32(88);
    const names = ['moon_rock_1', 'moon_rock_2', 'moon_rock_3', 'moon_rock_4'];
    names.forEach((name, k) => {
      const src = currentAssets()?.model(name);
      if (!src) return;
      const box = new THREE.Box3().setFromObject(src);
      const size = box.getSize(new THREE.Vector3());
      const unit = 1 / Math.max(1e-3, Math.max(size.x, size.z));
      const specs: InstanceSpec[] = [];
      for (let i = 0; i < count / 4; i++) {
        const r = 15 + Math.pow(rnd(), 0.7) * 650;
        const a = rnd() * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.hypot(x - RUINS.x, z - RUINS.z) < 30 || Math.hypot(x - 18, z - 26) < 16) continue;
        const s = 0.3 + Math.pow(rnd(), 3) * 4.5;
        specs.push({ x, y: this.terrain.heightAt(x, z) - s * 0.15, z, rotY: rnd() * 6.28, scale: unit * s });
        if (s > 1.4) this.physics.addBox(x - s * 0.4, this.terrain.heightAt(x, z) - 1, z - s * 0.4, x + s * 0.4, this.terrain.heightAt(x, z) + s * 0.45, z + s * 0.4, 'rock');
      }
      this.root.add(instanceModel(src, specs, { castShadow: true }));
      void k;
    });
  }

  /** Ancient ruins: a ring of carved pillars around a glowing monolith. */
  private buildRuins(): THREE.MeshStandardMaterial {
    const a = currentAssets();
    const stone = a ? a.material('rock', 1 / 3, '#6d6a66', { tint: '#a29d96' }) : mat('#6d6a66', { map: 'rock' });
    const { x, z } = RUINS;
    const y = this.terrain.heightAt(x, z);
    const rnd = mulberry32(5);
    const glyphMat = new THREE.MeshStandardMaterial({ color: '#0a0c10', emissive: '#7ff0ff', emissiveMap: glyphTexture(), emissiveIntensity: 1.6, roughness: 0.4 });
    // Dais
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(14, 15.5, 1.2, 40), stone);
    dais.position.set(x, y + 0.3, z);
    dais.receiveShadow = true;
    this.root.add(dais);
    this.physics.addBox(x - 10.5, y - 1, z - 10.5, x + 10.5, y + 0.9, z + 10.5, 'dais');
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(ang) * 24, pz = z + Math.sin(ang) * 24;
      const py = this.terrain.heightAt(px, pz);
      const broken = rnd() < 0.35;
      const h = broken ? 2 + rnd() * 3 : 9 + rnd() * 6;
      const pillar = new THREE.Mesh(boxGeo(2.2, h, 2.2), stone);
      pillar.position.set(px, py + h / 2 - 0.3, pz);
      pillar.rotation.set((rnd() - 0.5) * 0.08, ang, (rnd() - 0.5) * 0.08);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.root.add(pillar);
      this.physics.addBox(px - 1.2, py - 1, pz - 1.2, px + 1.2, py + h, pz + 1.2, 'pillar');
      // Inlaid glyph strip
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.7, Math.min(h - 1, 7)), glyphMat);
      strip.position.set(px - Math.cos(ang) * 1.12, py + Math.min(h - 1, 7) / 2 + 0.4, pz - Math.sin(ang) * 1.12);
      strip.lookAt(x, strip.position.y, z);
      this.root.add(strip);
      if (broken) {
        const fallen = new THREE.Mesh(boxGeo(2, 1.8, 7 + rnd() * 3), stone);
        const fx = px + Math.cos(ang + 0.4) * 5, fz = pz + Math.sin(ang + 0.4) * 5;
        fallen.position.set(fx, this.terrain.heightAt(fx, fz) + 0.6, fz);
        fallen.rotation.set(0.05, ang + 1.2, 0.08);
        fallen.castShadow = true;
        this.root.add(fallen);
      }
    }
    // Lintels on some pillar pairs
    for (let i = 0; i < 12; i += 4) {
      const ang = ((i + 0.5) / 12) * Math.PI * 2;
      const lintel = new THREE.Mesh(boxGeo(2.4, 1.4, 14), stone);
      lintel.position.set(x + Math.cos(ang) * 24, y + 12.5, z + Math.sin(ang) * 24);
      lintel.rotation.y = -ang;
      lintel.castShadow = true;
      this.root.add(lintel);
    }
    // The monolith
    const mono = new THREE.Mesh(new THREE.BoxGeometry(2.4, 9, 0.6), glyphMat);
    mono.position.set(x, y + 5.4, z);
    mono.castShadow = true;
    this.root.add(mono);
    this.physics.addBox(x - 1.3, y, z - 0.4, x + 1.3, y + 10, z + 0.4, 'monolith');
    const glow = new THREE.PointLight('#7ff0ff', 40, 45, 1.5);
    glow.position.set(x, y + 6, z + 2);
    this.root.add(glow);
    return glyphMat;
  }

  groundAt(x: number, z: number): number { return this.terrain.heightAt(x, z); }

  mapMarkers(): MapMarker[] {
    return [
      { x: LANDING_SITE.x, z: LANDING_SITE.z, label: 'Site d’alunissage', color: '#d9d4cc' },
      { x: 18, z: 26, label: 'Aire du vaisseau', color: '#ffb347' },
      { x: RUINS.x, z: RUINS.z, label: 'Ruines', color: '#7ff0ff' },
    ];
  }

  renderMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const img = g.createImageData(256, 256);
    const ext = this.mapExtent;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const h = this.terrain.heightAt((i / 256) * 2 * ext - ext, (j / 256) * 2 * ext - ext);
      const v = Math.max(30, Math.min(220, 110 + h * 3));
      const o = (j * 256 + i) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v * 1.02; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  update(dt: number, game: Game) {
    this.t += dt;
    const p = game.player.position;
    this.earth.update(game.camera);
    this.earthGroup.rotation.y += dt * 0.003;
    if (this.sunDisc) this.sunDisc.position.copy(game.camera.position).addScaledVector(SUN_DIR, 10500);
    // Shadow camera follows the player
    this.sun.position.copy(p).addScaledVector(SUN_DIR, 300);
    this.sun.target.position.copy(p);
    this.monolithMat.emissiveIntensity = 1.3 + Math.sin(this.t * 1.7) * 0.5;
    game.audio.setAmbience({ wind: 0, rain: 0, birds: 0, crickets: 0, drone: 0.5 });
    // Guardians of the signal
    if (!this.guardsSpawned && game.missions.active.includes('m_moon') && Math.hypot(p.x - RUINS.x, p.z - RUINS.z) < 160) {
      this.guardsSpawned = true;
      const kinds = ['void_drone', 'void_drone', 'void_drone', 'void_stalker', 'void_stalker'];
      kinds.forEach((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        game.enemies.spawn(k, RUINS.x + Math.cos(a) * 30, RUINS.z + Math.sin(a) * 30, { game, hunter: true, tag: 'moon-guard' });
      });
      game.hud.banner('GARDIENS DU SIGNAL', 'Des créatures du Néant protègent les ruines', '#ff4d6d', '⚠');
    }
    // Leaving the Moon
    if (p.y - this.terrain.heightAt(p.x, p.z) > 900) game.travel('orbit', { from: 'moon' });
  }

  dispose() { disposeObject(this.root); }
}
