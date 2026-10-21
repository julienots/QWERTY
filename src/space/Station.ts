import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable } from '../world/Zone';
import { batchStatic, block, boxGeo, currentAssets, mat } from '../world/build';
import { Humanoid } from '../player/Humanoid';
import { CharacterModel, type Avatar } from '../player/CharacterModel';

/** Hollow pressurised volume (inner bounds). */
interface Volume { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

const IN = 1.8;   // inner half-size of a module cross-section
const OUT = 2.35; // outer half-size (hull)

function screenTexture(lines: string[], accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#04121e'; x.fillRect(0, 0, 256, 160);
  x.strokeStyle = accent; x.lineWidth = 3; x.strokeRect(4, 4, 248, 152);
  x.fillStyle = accent; x.font = 'bold 15px sans-serif';
  x.fillText(lines[0], 14, 28);
  x.fillStyle = '#cfe8ff'; x.font = '12px sans-serif';
  lines.slice(1).forEach((l, i) => x.fillText(l, 14, 52 + i * 18));
  x.strokeStyle = accent; x.globalAlpha = 0.5;
  x.beginPath();
  for (let i = 0; i < 240; i += 4) x.lineTo(10 + i, 140 - Math.abs(Math.sin(i * 0.08)) * 18);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Station Aurore — an ISS-inspired modular station. Pressurised corridors can be explored
 * in zero gravity; the exterior has a truss, solar arrays, radiators and a docking port.
 */
export class Station {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  readonly volumes: Volume[] = [];
  readonly dockPoint = new THREE.Vector3(66, -4, 0);
  private commander: Avatar;
  private panels: THREE.Mesh[] = [];
  private t = 0;

  constructor(private physics: CollisionWorld) {
    const wall = mat('#f4f5f6', { map: 'panel', rough: 0.75, metal: 0 });
    const floor = mat('#9aa3ad', { map: 'metal', rough: 0.6, metal: 0.4 });
    const strip = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#cfe8ff', emissiveIntensity: 2.2 });
    const hull = mat('#eef1f4', { map: 'metal', rough: 0.4, metal: 0.25 });
    const gold = mat('#d8b25a', { rough: 0.35, metal: 0.8 });

    // ---- Pressurised modules: main corridor (x) and two branches (z)
    this.module(-30, 56, 'x', wall, floor, strip, hull, { capMin: true, openingsMin: [], openingsMax: [] });
    this.module(IN, 15, 'z', wall, floor, strip, hull, { capMax: true });
    this.module(-15, -IN, 'z', wall, floor, strip, hull, { capMin: true, window: true });
    // Docking ring at the airlock
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.25, 10, 28), gold);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(56.2, 0, 0);
    this.group.add(ring);
    // Containment field across the open airlock
    const field = new THREE.Mesh(new THREE.CircleGeometry(1.9, 28), new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    field.rotation.y = Math.PI / 2;
    field.position.set(56.1, 0, 0);
    this.group.add(field);

    // ---- Exterior: truss, solar arrays, radiators
    const truss = mat('#b8bec6', { metal: 0.6, rough: 0.4 });
    block(this.group, physics, 8, OUT, -62, 12, OUT + 3, 62, { material: truss, tile: 2 });
    for (let z = -60; z <= 60; z += 6) {
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 6), truss);
      brace.position.set(10, OUT + 1.5, z);
      brace.rotation.z = Math.PI / 4;
      this.group.add(brace);
    }
    const panelTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0b1f4a'; g.fillRect(0, 0, 128, 256);
      g.strokeStyle = '#6e8fd6'; g.lineWidth = 1;
      for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
      for (let j = 0; j <= 256; j += 16) { g.beginPath(); g.moveTo(0, j); g.lineTo(128, j); g.stroke(); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.25, metalness: 0.7, side: THREE.DoubleSide, emissive: '#10204a', emissiveIntensity: 0.4 });
    for (const zs of [-1, 1]) {
      for (const x of [-4, 24]) {
        for (const z0 of [40, 52]) {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 11), panelMat);
          p.position.set(10 + (x > 0 ? 9 : -9), OUT + 1.5, zs * (z0 + 5));
          p.rotation.x = -Math.PI / 2;
          this.group.add(p);
          this.panels.push(p);
          physics.addBox(p.position.x - 4.5, p.position.y - 0.2, p.position.z - 5.5, p.position.x + 4.5, p.position.y + 0.2, p.position.z + 5.5, 'panel');
        }
      }
    }
    const radiator = mat('#f5f5f0', { rough: 0.6 });
    for (const z of [-22, 22]) block(this.group, physics, 4, OUT + 0.5, z - 0.1, 16, OUT + 10, z + 0.1, { material: radiator });
    // Antenna dish
    const dish = new THREE.Mesh(new THREE.SphereGeometry(2.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 3), hull);
    dish.position.set(-24, OUT + 4, 0);
    dish.rotation.x = Math.PI;
    this.group.add(dish);
    block(this.group, physics, -24.15, OUT, -0.15, -23.85, OUT + 4, 0.15, { material: truss });
    // Name band
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g2 = c.getContext('2d')!;
    g2.fillStyle = '#eef1f4'; g2.fillRect(0, 0, 512, 64);
    g2.fillStyle = '#2f5d9e'; g2.font = 'bold 40px sans-serif'; g2.textAlign = 'center';
    g2.fillText('STATION AURORE', 256, 46);
    const nameTex = new THREE.CanvasTexture(c);
    nameTex.colorSpace = THREE.SRGBColorSpace;
    const name = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.6 }));
    name.position.set(30, 0, OUT + 0.02);
    this.group.add(name);

    // ---- Interior details
    this.screen(20, 0.3, -IN + 0.02, 0, ['NAVIGATION', 'Orbite terrestre basse', 'Lune : 61 000 km (échelle jeu)', 'Toucher pour planifier un trajet'], '#7fd8ff');
    this.screen(45, 0.3, IN - 0.02, Math.PI, ['HANGAR', 'Vaisseaux disponibles', 'Toucher pour changer de vaisseau'], '#ffd23f');
    this.screen(-20, 0.3, IN - 0.02, Math.PI, ['INFIRMERIE', 'Soins • Oxygène • Sauvegarde'], '#7dff9a');
    this.interactables.push(
      {
        id: 'station_airlock', position: new THREE.Vector3(53.5, 0, 0), radius: 3, icon: '🚪', label: () => 'Sortir dans l’espace (sas)',
        use: (game) => game.travel('orbit', { from: 'airlock' }),
      },
      { id: 'nav_terminal', position: new THREE.Vector3(20, 0.3, -IN + 0.4), radius: 2.4, icon: '🧭', label: () => 'Ouvrir la navigation', use: (game) => game.menu.open('map') },
      { id: 'hangar', position: new THREE.Vector3(45, 0.3, IN - 0.4), radius: 2.4, icon: '🚀', label: (game) => (game.ships.owned.length > 1 ? 'Changer de vaisseau' : null), use: (game) => game.ships.cycleShip() },
      {
        id: 'med_station', position: new THREE.Vector3(-20, 0.3, IN - 0.4), radius: 2.4, icon: '✚', label: () => 'Infirmerie : soins et sauvegarde',
        use: (game) => {
          game.player.heal(game.player.maxHealth);
          game.player.oxygen = 100;
          game.ships.repairCurrent();
          game.saveGame(true);
        },
      },
    );

    // Commander (floating astronaut)
    // Commander in a white flight suit (rigged character; procedural figure as fallback).
    const colors = { skin: '#c68e63', suit: '#eef0f3', accent: '#2f5d9e', hair: '#111111', pants: '#e8e8e8', aura: '#2f5d9e' };
    const assets = currentAssets();
    this.commander = CharacterModel.available(assets, 'suit_body') ? new CharacterModel(assets!, 'suit_body', { height: 1.72 }) : new Humanoid(colors);
    this.commander.setColors(colors);
    this.commander.setGlow(0.2);
    this.commander.root.position.set(0, -0.9, 7);
    this.commander.root.rotation.y = Math.PI;
    this.group.add(this.commander.root);
    this.interactables.push({
      id: 'commander', position: new THREE.Vector3(0, 0, 7), radius: 3, icon: '💬', label: () => 'Parler à la commandante Varga',
      use: (game) => {
        game.hud.clearDialog();
        const done = game.missions.isCompleted('m_station');
        if (!done) {
          game.hud.say('Cdt. Ilyana Varga', "Alors c'est vous, le phénomène qui vole sans combinaison… Bienvenue à bord d'Aurore.", 4);
          game.hud.say('Cdt. Ilyana Varga', "La brèche au-dessus de Val-Lumen n'était qu'un écho. Nos capteurs ont trouvé la source : un signal très ancien, sur la Lune.", 6);
          game.hud.say('Cdt. Ilyana Varga', 'Prenez un de nos vaisseaux au hangar si vous voulez. Et soyez prudent : quelque chose garde ce signal.', 5);
        } else {
          game.hud.say('Cdt. Ilyana Varga', 'Le terminal de navigation peut vous emmener directement vers la Lune ou la Terre. Bonne chance.', 4);
        }
        game.bus.emit('interact', 'commander');
      },
    });

    this.commander.root.userData.dynamic = true;
    batchStatic(this.group);
  }

  private screen(x: number, y: number, z: number, rotY: number, lines: string[], accent: string) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ map: screenTexture(lines, accent), toneMapped: false }));
    s.position.set(x, y, z);
    s.rotation.y = rotY;
    this.group.add(s);
  }

  /** Builds a hollow module along an axis between a and b (inner volume ±IN). */
  private module(a: number, b: number, axis: 'x' | 'z', wall: THREE.Material, floor: THREE.Material, strip: THREE.Material, hull: THREE.Material, o: { capMin?: boolean; capMax?: boolean; window?: boolean; openingsMin?: number[]; openingsMax?: number[] }) {
    const g = this.group, p = this.physics;
    const T = OUT - IN;
    const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material, collide = true) =>
      axis === 'x' ? block(g, collide ? p : null, x0, y0, z0, x1, y1, z1, { material: m, tile: 2, castShadow: false })
        : block(g, collide ? p : null, z0, y0, x0, z1, y1, x1, { material: m, tile: 2, castShadow: false });
    // ceiling and floor
    box(a, IN, -IN, b, OUT, IN, wall);
    box(a, -OUT, -IN, b, -IN, IN, floor);
    // side walls, with an opening at the junction (|along| < IN) on the main corridor
    for (const s of [-1, 1]) {
      const z0 = s < 0 ? -OUT : IN, z1 = s < 0 ? -IN : OUT;
      if (axis === 'x') {
        box(a, -OUT, z0, -IN, OUT, z1, wall);
        box(IN, -OUT, z0, b, OUT, z1, wall);
      } else {
        box(a, -OUT, z0, b, OUT, z1, wall);
      }
    }
    if (o.capMin) {
      if (o.window) {
        // panoramic window: frame + glass, collider over the whole cap
        box(a - T, -OUT, -OUT, a, -0.9, OUT, wall);
        box(a - T, 0.9, -OUT, a, OUT, OUT, wall);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshStandardMaterial({ color: '#9cc7e0', transparent: true, opacity: 0.18, roughness: 0, metalness: 0.9 }));
        glass.position.set(0, 0, a - T / 2);
        g.add(glass);
        p.addBox(-OUT, -0.9, a - T, OUT, 0.9, a);
      } else box(a - T, -OUT, -OUT, a, OUT, OUT, wall);
    }
    if (o.capMax) box(b, -OUT, -OUT, b + T, OUT, OUT, wall);
    // light strips along the ceiling, handrails
    const len = b - a;
    const s1 = new THREE.Mesh(axis === 'x' ? boxGeo(len - 1, 0.04, 0.25) : boxGeo(0.25, 0.04, len - 1), strip);
    s1.position.set(axis === 'x' ? (a + b) / 2 : 0, IN - 0.03, axis === 'x' ? 0 : (a + b) / 2);
    g.add(s1);
    const rail = mat('#ffcc33', { metal: 0.5, rough: 0.4 });
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len - 1, 6), rail);
      if (axis === 'x') { r.rotation.z = Math.PI / 2; r.position.set((a + b) / 2, -0.6, s * (IN - 0.15)); }
      else { r.rotation.x = Math.PI / 2; r.position.set(s * (IN - 0.15), -0.6, (a + b) / 2); }
      g.add(r);
    }
    // outer hull cylinder (front faces only: invisible from inside)
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(OUT + 0.05, OUT + 0.05, len, 24, 1, true), hull);
    if (axis === 'x') { cyl.rotation.z = Math.PI / 2; cyl.position.set((a + b) / 2, 0, 0); }
    else { cyl.rotation.x = Math.PI / 2; cyl.position.set(0, 0, (a + b) / 2); }
    cyl.castShadow = true;
    g.add(cyl);
    this.volumes.push(axis === 'x'
      ? { minX: a, minY: -IN, minZ: -IN, maxX: b, maxY: IN, maxZ: IN }
      : { minX: -IN, minY: -IN, minZ: a, maxX: IN, maxY: IN, maxZ: b });
  }

  /** True if the point is inside a pressurised module (breathable, slow zero-g movement). */
  inside(p: THREE.Vector3, margin = 0.2): boolean {
    return this.volumes.some((v) => p.x > v.minX - margin && p.x < v.maxX + margin && p.y > v.minY - 1.2 && p.y < v.maxY + margin && p.z > v.minZ - margin && p.z < v.maxZ + margin);
  }

  update(dt: number, game: Game) {
    this.t += dt;
    this.commander.update(dt, { speed: 0, grounded: false, flying: true, vy: 0, flyForward: 0, cast: 0, punch: 0 });
    this.commander.root.position.y = -0.9 + Math.sin(this.t * 0.8) * 0.08;
    const p = game.player.position;
    const to = Math.atan2(p.x - this.commander.root.position.x, p.z - this.commander.root.position.z);
    this.commander.root.rotation.y += (to - this.commander.root.rotation.y) * Math.min(1, dt * 2);
  }
}
