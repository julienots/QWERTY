import * as THREE from 'three';
import type { Box, CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable } from './Zone';
import { batchStatic, block, boxGeo, glassMaterial, mat } from './build';
import { ScreenTexture } from '../fx/textures';

/**
 * The player's home: five furnished rooms, working doors, light switches, TV, radio,
 * fridge, bed, wardrobe and computer. Footprint x ∈ [-7, 7], z ∈ [-6, 6], door facing +Z.
 */

const H = 2.8;       // wall height
const T = 0.2;       // wall thickness
const FLOOR = 0.15;  // floor slab top

interface Opening { a: number; b: number; kind: 'door' | 'window' | 'arch' }

interface Door {
  id: string;
  name: string;
  pivot: THREE.Group;
  box: Box;
  open: boolean;
  angle: number;
  openAngle: number;
}

interface RoomLight {
  id: string;
  name: string;
  light: THREE.PointLight;
  fixture: THREE.MeshStandardMaterial;
  on: boolean;
}

export class House {
  readonly group = new THREE.Group();
  readonly interactables: Interactable[] = [];
  private doors: Door[] = [];
  private lights: RoomLight[] = [];
  private tv!: { screen: ScreenTexture; mat: THREE.MeshBasicMaterial; on: boolean };
  private fridgeDoor!: THREE.Group;
  private fridgeOpen = 0;
  private radioLed!: THREE.MeshStandardMaterial;
  private radioPlaying = 0;

  constructor(private physics: CollisionWorld, state: { lightsOn: string[]; doorsOpen: string[] }) {
    this.buildShell();
    this.buildRoof();
    this.buildFurniture();
    this.buildLights(state.lightsOn);
    this.buildGarden();
    for (const d of this.doors) if (state.doorsOpen.includes(d.id)) this.setDoor(d, true, true);
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
    // Moving parts stay separate; everything else is merged per material.
    for (const d of this.doors) d.pivot.userData.dynamic = true;
    this.fridgeDoor.userData.dynamic = true;
    batchStatic(this.group);
  }

  // ---------------------------------------------------------------- shell
  private wallX(z: number, x1: number, x2: number, openings: Opening[], m: THREE.Material) {
    let cur = x1;
    const sorted = [...openings].sort((p, q) => p.a - q.a);
    const z0 = z - T / 2, z1 = z + T / 2;
    for (const o of sorted) {
      if (o.a > cur) block(this.group, this.physics, cur, 0, z0, o.a, H, z1, { material: m, tile: 2 });
      this.opening(o, (a, y0, b, y1, collide) => block(this.group, collide ? this.physics : null, a, y0, z0, b, y1, z1, { material: m, tile: 2 }), 'x', z);
      cur = o.b;
    }
    if (cur < x2) block(this.group, this.physics, cur, 0, z0, x2, H, z1, { material: m, tile: 2 });
  }

  private wallZ(x: number, z1: number, z2: number, openings: Opening[], m: THREE.Material) {
    let cur = z1;
    const sorted = [...openings].sort((p, q) => p.a - q.a);
    const x0 = x - T / 2, x1 = x + T / 2;
    for (const o of sorted) {
      if (o.a > cur) block(this.group, this.physics, x0, 0, cur, x1, H, o.a, { material: m, tile: 2 });
      this.opening(o, (a, y0, b, y1, collide) => block(this.group, collide ? this.physics : null, x0, y0, a, x1, y1, b, { material: m, tile: 2 }), 'z', x);
      cur = o.b;
    }
    if (cur < z2) block(this.group, this.physics, x0, 0, cur, x1, H, z2, { material: m, tile: 2 });
  }

  private opening(o: Opening, seg: (a: number, y0: number, b: number, y1: number, collide: boolean) => void, axis: 'x' | 'z', c: number) {
    const top = o.kind === 'arch' ? 2.35 : 2.15;
    seg(o.a, top, o.b, H, true);
    if (o.kind === 'window') {
      seg(o.a, 0, o.b, 0.95, true);
      // Glass pane (collider over the full opening so nobody walks through windows)
      const w = o.b - o.a;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, top - 0.95), glassMaterial());
      const mid = (o.a + o.b) / 2;
      if (axis === 'x') {
        glass.position.set(mid, (top + 0.95) / 2, c);
        this.physics.addBox(o.a, 0.95, c - 0.05, o.b, top, c + 0.05);
      } else {
        glass.rotation.y = Math.PI / 2;
        glass.position.set(c, (top + 0.95) / 2, mid);
        this.physics.addBox(c - 0.05, 0.95, o.a, c + 0.05, top, o.b);
      }
      glass.castShadow = false;
      this.group.add(glass);
      // Frame + mullion
      const frame = mat('#f4f1ea', { rough: 0.5 });
      const fw = 0.06;
      const parts: [number, number, number, number][] = [
        [o.a, 0.95, o.b, 0.95 + fw], [o.a, top - fw, o.b, top], [mid - fw / 2, 0.95, mid + fw / 2, top],
      ];
      for (const [a, y0, b, y1] of parts) {
        if (axis === 'x') block(this.group, null, a, y0, c - T / 2 - 0.02, b, y1, c + T / 2 + 0.02, { material: frame, castShadow: false });
        else block(this.group, null, c - T / 2 - 0.02, y0, a, c + T / 2 + 0.02, y1, b, { material: frame, castShadow: false });
      }
    }
  }

  private buildShell() {
    const ext = mat('#efe6d6', { map: 'plaster', rough: 0.9 });
    const int = mat('#f3f0ea', { map: 'plaster', rough: 0.95 });
    const accentWall = mat('#b8c9d6', { map: 'plaster', rough: 0.95 });
    // Foundation & floors
    block(this.group, null, -7.3, -0.4, -6.3, 7.3, 0.02, 6.3, { material: mat('#8d8a84', { map: 'concrete' }), collide: false, tile: 3 });
    this.physics.addBox(-7, 0, -6, 7, FLOOR, 6, 'floor');
    const wood = mat('#f0d2ae', { map: 'wood', rough: 0.6 });
    const tiles = mat('#e8e6e1', { map: 'tiles', rough: 0.35 });
    const floors: [number, number, number, number, THREE.Material][] = [
      [-7, -6, -1, 0, wood], [-1, -6, 2, 0, tiles], [2, -6, 7, 0, tiles], [-7, 0, 2, 6, wood], [2, 0, 7, 6, wood],
    ];
    for (const [x0, z0, x1, z1, m] of floors) block(this.group, null, x0, 0, z0, x1, FLOOR, z1, { material: m, collide: false, tile: 2, castShadow: false });
    // Exterior walls
    this.wallX(-6, -7.1, 7.1, [{ a: -5.5, b: -3.5, kind: 'window' }, { a: 0, b: 1.2, kind: 'window' }, { a: 4, b: 6, kind: 'window' }], ext);
    this.wallX(6, -7.1, 7.1, [{ a: -6.2, b: -4.6, kind: 'window' }, { a: -3, b: -2, kind: 'door' }, { a: -0.8, b: 0.9, kind: 'window' }, { a: 3.5, b: 5.5, kind: 'window' }], ext);
    this.wallZ(-7, -5.9, 5.9, [{ a: -4, b: -2, kind: 'window' }, { a: 4.2, b: 5.5, kind: 'window' }], ext);
    this.wallZ(7, -5.9, 5.9, [{ a: -2.6, b: -1, kind: 'window' }, { a: 2, b: 4, kind: 'window' }], ext);
    // Interior walls
    this.wallX(0, -6.9, 6.9, [{ a: -4, b: -3, kind: 'door' }, { a: 0, b: 1, kind: 'door' }, { a: 3.5, b: 5.5, kind: 'arch' }], int);
    this.wallZ(-1, -5.9, -0.1, [], accentWall);
    this.wallZ(2, -5.9, 5.9, [{ a: 2, b: 3.4, kind: 'arch' }], int);
    // Ceiling
    block(this.group, this.physics, -7.1, H, -6.1, 7.1, H + 0.12, 6.1, { material: int, castShadow: true });
    // Skirting boards for a finished look
    // Doors
    this.addDoor('front_door', "la porte d'entrée", 'x', -3, 6, Math.PI / 2, '#b9845a');
    this.addDoor('bedroom_door', 'la porte de la chambre', 'x', -4, 0, -Math.PI / 2, '#f0ece4');
    this.addDoor('bathroom_door', 'la porte de la salle de bain', 'x', 0, 0, -Math.PI / 2, '#f0ece4');
    // Front step
    block(this.group, this.physics, -3.4, 0, 6.1, -1.6, 0.08, 7.1, { material: mat('#a7a39b', { map: 'concrete' }), castShadow: false });
  }

  private addDoor(id: string, name: string, axis: 'x', hingeX: number, z: number, openAngle: number, color: string) {
    void axis;
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, FLOOR, z);
    const leaf = new THREE.Mesh(boxGeo(0.98, 2.0, 0.06), mat(color, { map: 'wood', rough: 0.55 }));
    leaf.position.set(0.5, 1.0, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat('#c9a646', { metal: 0.9, rough: 0.25 }));
    knob.position.set(0.88, 1.0, 0.06);
    const knob2 = knob.clone();
    knob2.position.z = -0.06;
    pivot.add(knob, knob2);
    this.group.add(pivot);
    const box = this.physics.addBox(hingeX, FLOOR, z - 0.06, hingeX + 1, 2.15, z + 0.06, 'door');
    const door: Door = { id, name, pivot, box, open: false, angle: 0, openAngle };
    this.doors.push(door);
    this.interactables.push({
      id,
      position: new THREE.Vector3(hingeX + 0.5, 1.1, z),
      radius: 1.7,
      icon: '🚪',
      label: () => (door.open ? 'Fermer ' : 'Ouvrir ') + name,
      use: (g) => {
        this.setDoor(door, !door.open);
        g.audio.play('door', { position: door.pivot.position });
        g.bus.emit('interact', id);
      },
    });
  }

  private setDoor(d: Door, open: boolean, instant = false) {
    d.open = open;
    d.box.enabled = !open;
    if (instant) d.angle = open ? d.openAngle : 0;
  }

  get doorsOpen(): string[] { return this.doors.filter((d) => d.open).map((d) => d.id); }
  get lightsOn(): string[] { return this.lights.filter((l) => l.on).map((l) => l.id); }

  // ---------------------------------------------------------------- roof
  private buildRoof() {
    const roofMat = mat('#8c3b2e', { map: 'roof', rough: 0.85 });
    const ridge = 4.7;
    const over = 0.6;
    const halfD = 6 + over;
    const rise = ridge - H;
    const slopeLen = Math.hypot(halfD, rise + 0.2);
    const angle = Math.atan2(rise + 0.2, halfD);
    for (const side of [-1, 1]) {
      const slab = new THREE.Mesh(boxGeo(14 + over * 2, 0.16, slopeLen, 1.5), roofMat);
      slab.position.set(0, H + (rise + 0.2) / 2 - 0.1, (side * halfD) / 2);
      slab.rotation.x = side * angle;
      slab.castShadow = true;
      this.group.add(slab);
    }
    // Gable triangles
    const shape = new THREE.Shape();
    shape.moveTo(-6.1, 0);
    shape.lineTo(6.1, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const gGeo = new THREE.ShapeGeometry(shape);
    const gMat = mat('#efe6d6', { map: 'plaster' });
    for (const sx of [-7.05, 7.05]) {
      const g = new THREE.Mesh(gGeo, gMat);
      g.material = gMat.clone();
      (g.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      g.rotation.y = Math.PI / 2;
      g.position.set(sx, H + 0.12, 0);
      g.castShadow = true;
      this.group.add(g);
    }
    // Chimney
    block(this.group, this.physics, 3.6, H, -3.4, 4.4, ridge + 0.9, -2.6, { material: mat('#9c5a46', { map: 'brick' }), tile: 1 });
    // Stepped colliders approximating the roof so it can be landed on.
    this.physics.addBox(-7.3, H, -6.4, 7.3, H + 0.6, 6.4, 'roof');
    this.physics.addBox(-7.3, H, -4.2, 7.3, H + 1.2, 4.2, 'roof');
    this.physics.addBox(-7.3, H, -2, 7.3, H + 1.7, 2, 'roof');
  }

  // ---------------------------------------------------------------- furniture
  private buildFurniture() {
    const g = this.group, p = this.physics;
    const wood = mat('#c99b72', { map: 'wood', rough: 0.55 });
    const lightWood = mat('#f2dcb8', { map: 'wood', rough: 0.55 });
    const white = mat('#f2f2f0', { rough: 0.4 });
    const fabricBlue = mat('#3d5a80', { map: 'fabric', rough: 0.95 });
    const fabricGrey = mat('#7a7f87', { map: 'fabric', rough: 0.95 });
    const metal = mat('#b8bcc2', { map: 'metal', rough: 0.35, metal: 0.8 });
    const dark = mat('#26282c', { rough: 0.5 });
    const F = FLOOR;

    // ---- Bedroom (x -7..-1, z -6..0)
    block(g, p, -6.9, F, -5.9, -4.8, F + 0.42, -4.2, { material: wood });
    block(g, null, -6.85, F + 0.42, -5.85, -4.85, F + 0.62, -4.25, { material: white, collide: false });
    block(g, null, -5.6, F + 0.6, -5.85, -4.85, F + 0.66, -4.25, { material: fabricBlue, collide: false });
    block(g, null, -6.75, F + 0.62, -5.6, -6.3, F + 0.72, -4.5, { material: white, collide: false }); // pillow
    block(g, p, -6.98, F, -5.95, -6.88, F + 1.1, -4.15, { material: wood }); // headboard
    this.interactables.push({
      id: 'bed', position: new THREE.Vector3(-5.8, 0.8, -4.2), radius: 1.8, icon: '🛏',
      label: (game) => (game.isNight() ? 'Dormir jusqu’au matin' : 'Se reposer'),
      use: (game) => game.sleep(),
    });
    // Nightstand + lamp
    block(g, p, -6.9, F, -4.1, -6.4, F + 0.5, -3.6, { material: wood });
    const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.2, 16, 1, true), mat('#f6e7c8', { emissive: '#ffcf8a', emissiveIntensity: 0.6 }));
    lampShade.position.set(-6.65, F + 0.82, -3.85);
    g.add(lampShade);
    block(g, null, -6.67, F + 0.5, -3.87, -6.63, F + 0.72, -3.83, { material: metal, collide: false });
    // Desk + radio (mission object)
    block(g, p, -1.75, F + 0.72, -4.2, -1.1, F + 0.77, -2.2, { material: lightWood });
    for (const [x, z] of [[-1.7, -4.15], [-1.15, -4.15], [-1.7, -2.25], [-1.15, -2.25]]) block(g, null, x - 0.03, F, z - 0.03, x + 0.03, F + 0.72, z + 0.03, { material: metal, collide: false });
    p.addBox(-1.75, F, -4.2, -1.1, F + 0.72, -2.2);
    block(g, null, -1.6, F + 0.77, -3.4, -1.25, F + 0.97, -2.9, { material: mat('#4a3b2f', { rough: 0.5 }), collide: false });
    const grill = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), dark);
    grill.rotation.y = Math.PI / 2;
    grill.position.set(-1.6 - 0.001 + 0.0, F + 0.87, -3.25);
    grill.rotation.y = -Math.PI / 2;
    g.add(grill);
    this.radioLed = new THREE.MeshStandardMaterial({ color: '#330000', emissive: '#ff3b3b', emissiveIntensity: 0.2 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), this.radioLed);
    led.position.set(-1.6, F + 0.93, -3.0);
    g.add(led);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35), metal);
    antenna.position.set(-1.35, F + 1.12, -3.0);
    antenna.rotation.z = 0.4;
    g.add(antenna);
    this.interactables.push({
      id: 'radio', position: new THREE.Vector3(-1.45, F + 0.9, -3.1), radius: 1.7, icon: '📻',
      label: () => 'Écouter la radio',
      use: (game) => {
        this.radioPlaying = 9;
        game.audio.play('click');
        game.hud.clearDialog();
        game.hud.say('Radio Val-Lumen', "…une pluie de météores d'une intensité jamais observée a illuminé le ciel cette nuit.", 5);
        game.hud.say('Radio Val-Lumen', "Un fragment lumineux serait tombé sur la colline au nord-est de la ville. Les habitants sont priés de ne pas s'en approcher…", 6);
        game.hud.say('Toi', "La colline au nord-est… C'est à quelques minutes d'ici. Je dois voir ça.", 4);
        game.bus.emit('interact', 'radio');
      },
    });
    // Chair
    this.chair(-2.1, -3.2, Math.PI / 2, lightWood);
    // Wardrobe (skins)
    block(g, p, -6.95, F, -2.1, -6.3, F + 2.1, -0.3, { material: wood });
    block(g, null, -6.31, F + 0.1, -1.2, -6.29, F + 2.0, -1.18, { material: dark, collide: false });
    this.interactables.push({
      id: 'wardrobe', position: new THREE.Vector3(-6.2, 1.2, -1.2), radius: 1.6, icon: '👕',
      label: () => 'Changer de tenue',
      use: (game) => game.menu.open('skins'),
    });
    // Rug
    block(g, null, -5, F, -3.2, -2.6, F + 0.015, -1.2, { material: mat('#7d3c3c', { map: 'fabric' }), collide: false, castShadow: false });

    // ---- Bathroom (x -1..2, z -6..0)
    block(g, p, -0.9, F, -5.9, 0.9, F + 0.55, -5.05, { material: white });
    block(g, null, -0.8, F + 0.4, -5.8, 0.8, F + 0.56, -5.15, { material: mat('#8fc3dd', { rough: 0.1, metal: 0.1 }), collide: false });
    block(g, p, 1.45, F, -3.6, 1.9, F + 0.85, -2.7, { material: white }); // sink unit
    block(g, null, 1.95, F + 1.1, -3.6, 1.97, F + 1.9, -2.7, { material: mat('#dfefff', { rough: 0.02, metal: 1 }), collide: false }); // mirror
    block(g, p, 1.4, F, -5.6, 1.9, F + 0.42, -5.0, { material: white }); // toilet
    block(g, null, 1.75, F + 0.42, -5.6, 1.9, F + 0.9, -5.0, { material: white, collide: false });

    // ---- Kitchen (x 2..7, z -6..0)
    block(g, p, 2.2, F, -5.9, 6.9, F + 0.88, -5.3, { material: white });
    block(g, null, 2.15, F + 0.88, -5.95, 6.95, F + 0.93, -5.25, { material: mat('#3b3d42', { rough: 0.25 }), collide: false });
    block(g, null, 3.2, F + 0.93, -5.8, 3.9, F + 0.95, -5.4, { material: dark, collide: false }); // stove
    for (const [x, z] of [[3.35, -5.5], [3.75, -5.5], [3.35, -5.7], [3.75, -5.7]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.01, 6, 16), metal);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, F + 0.96, z);
      g.add(ring);
    }
    block(g, null, 2.2, F + 1.5, -5.95, 6.9, F + 2.2, -5.6, { material: white, collide: false }); // wall cabinets
    // Fridge with an opening door
    block(g, p, 6.2, F, -4.9, 6.95, F + 1.95, -3.95, { material: mat('#dcdfe3', { rough: 0.3, metal: 0.4 }) });
    this.fridgeDoor = new THREE.Group();
    this.fridgeDoor.position.set(6.2, F, -3.95);
    const fd = new THREE.Mesh(boxGeo(0.06, 1.9, 0.95), mat('#e6e9ec', { rough: 0.25, metal: 0.4 }));
    fd.position.set(-0.03, 0.97, -0.475);
    this.fridgeDoor.add(fd);
    g.add(this.fridgeDoor);
    this.interactables.push({
      id: 'fridge', position: new THREE.Vector3(6.1, 1.2, -4.4), radius: 1.7, icon: '🍎',
      label: (game) => (game.player.health < game.player.maxHealth ? 'Manger un morceau (+30 PV)' : 'Ouvrir le frigo'),
      use: (game) => {
        this.fridgeOpen = 3;
        game.audio.play('door', { position: new THREE.Vector3(6.2, 1, -4.4), pitch: 1.6 });
        if (game.player.health < game.player.maxHealth) {
          game.player.heal(30);
          game.hud.toast('Tu reprends des forces. +30 PV');
        } else game.hud.toast('Le frigo est bien rempli.');
        game.bus.emit('interact', 'fridge');
      },
    });
    // Kitchen table
    block(g, p, 3.8, F + 0.72, -3.0, 5.2, F + 0.77, -2.0, { material: lightWood });
    for (const [x, z] of [[3.85, -2.95], [5.15, -2.95], [3.85, -2.05], [5.15, -2.05]]) block(g, null, x - 0.03, F, z - 0.03, x + 0.03, F + 0.72, z + 0.03, { material: lightWood, collide: false });
    p.addBox(3.8, F, -3.0, 5.2, F + 0.72, -2.0);
    this.chair(4.5, -1.6, Math.PI, lightWood);
    this.chair(4.5, -3.4, 0, lightWood);

    // ---- Living room (x -7..2, z 0..6)
    // TV stand + TV on the west wall
    block(g, p, -6.95, F, 1.9, -6.5, F + 0.5, 4.1, { material: wood });
    block(g, null, -6.8, F + 0.5, 2.98, -6.7, F + 0.6, 3.02, { material: dark, collide: false });
    block(g, null, -6.85, F + 0.6, 2.1, -6.78, F + 1.4, 3.9, { material: dark, collide: false });
    this.tv = { screen: new ScreenTexture(['Pluie de météores record', 'Un objet tombé près de la colline', 'Restez chez vous cette nuit']), mat: new THREE.MeshBasicMaterial(), on: false };
    this.tv.mat.map = this.tv.screen.texture;
    this.tv.mat.toneMapped = false;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.74), this.tv.mat);
    screen.rotation.y = Math.PI / 2;
    screen.position.set(-6.775, F + 1.0, 3.0);
    g.add(screen);
    this.interactables.push({
      id: 'tv', position: new THREE.Vector3(-6.5, 1.0, 3.0), radius: 2.2, icon: '📺',
      label: () => (this.tv.on ? 'Éteindre la télé' : 'Allumer la télé'),
      use: (game) => {
        this.tv.on = !this.tv.on;
        this.tv.screen.draw(this.tv.on);
        game.audio.play('click');
        if (this.tv.on) game.hud.clearDialog();
        if (this.tv.on) game.hud.say('Val-Lumen Info', "Les images de la nuit dernière : des dizaines de traînées lumineuses au-dessus de la ville.", 4);
        game.bus.emit('interact', 'tv');
      },
    });
    // Sofa facing the TV
    block(g, p, -4.2, F, 1.8, -3.3, F + 0.45, 4.2, { material: fabricGrey });
    block(g, p, -3.45, F, 1.8, -3.15, F + 0.95, 4.2, { material: fabricGrey });
    block(g, null, -4.2, F + 0.45, 1.8, -3.45, F + 0.7, 2.05, { material: fabricGrey, collide: false });
    block(g, null, -4.2, F + 0.45, 3.95, -3.45, F + 0.7, 4.2, { material: fabricGrey, collide: false });
    block(g, null, -4.1, F + 0.45, 2.1, -3.5, F + 0.6, 2.95, { material: fabricBlue, collide: false });
    block(g, null, -4.1, F + 0.45, 3.05, -3.5, F + 0.6, 3.9, { material: fabricBlue, collide: false });
    // Coffee table
    block(g, p, -5.6, F, 2.5, -4.8, F + 0.4, 3.5, { material: lightWood });
    // Bookshelf
    block(g, p, -2.6, F, 0.1, -1.2, F + 1.9, 0.45, { material: wood });
    const bookCols = ['#a33', '#36a', '#3a6', '#cc3', '#639', '#c63'];
    for (let r = 0; r < 4; r++) {
      let x = -2.55;
      while (x < -1.3) {
        const w = 0.04 + Math.random() * 0.05;
        const h = 0.22 + Math.random() * 0.12;
        block(g, null, x, F + 0.1 + r * 0.45, 0.46, x + w, F + 0.1 + r * 0.45 + h, 0.5, { material: mat(bookCols[Math.floor(Math.random() * 6)], { rough: 0.7 }), collide: false, castShadow: false });
        x += w + 0.01;
      }
    }
    // Plant
    block(g, p, -6.8, F, 5.4, -6.4, F + 0.4, 5.8, { material: mat('#a35a3a', { rough: 0.8 }) });
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat('#3f7a3a', { rough: 0.8 }));
    leaves.position.set(-6.6, F + 0.85, 5.6);
    leaves.scale.set(1, 1.3, 1);
    leaves.castShadow = true;
    g.add(leaves);
    // Rug
    block(g, null, -6, F, 1.9, -4.4, F + 0.015, 4.1, { material: mat('#c9b48a', { map: 'fabric' }), collide: false, castShadow: false });

    // ---- Dining / office (x 2..7, z 0..6)
    block(g, p, 3.8, F + 0.73, 3.0, 5.6, F + 0.78, 4.2, { material: wood });
    p.addBox(3.8, F, 3.0, 5.6, F + 0.73, 4.2);
    for (const [x, z] of [[3.85, 3.05], [5.55, 3.05], [3.85, 4.15], [5.55, 4.15]]) block(g, null, x - 0.04, F, z - 0.04, x + 0.04, F + 0.73, z + 0.04, { material: wood, collide: false });
    this.chair(4.3, 2.5, 0, wood);
    this.chair(5.1, 2.5, 0, wood);
    this.chair(4.3, 4.7, Math.PI, wood);
    this.chair(5.1, 4.7, Math.PI, wood);
    // Computer desk
    block(g, p, 6.3, F + 0.72, 0.3, 6.95, F + 0.76, 1.9, { material: white });
    p.addBox(6.3, F, 0.3, 6.95, F + 0.72, 1.9);
    block(g, null, 6.75, F + 0.76, 0.75, 6.8, F + 1.2, 1.45, { material: dark, collide: false });
    const monitorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.4), new THREE.MeshBasicMaterial({ color: '#4d8bd6', toneMapped: false }));
    monitorGlow.rotation.y = -Math.PI / 2;
    monitorGlow.position.set(6.745, F + 0.99, 1.1);
    g.add(monitorGlow);
    this.chair(5.9, 1.1, -Math.PI / 2, dark);
    this.interactables.push({
      id: 'computer', position: new THREE.Vector3(6.5, 1.0, 1.1), radius: 1.7, icon: '💻',
      label: () => "Consulter l'ordinateur",
      use: (game) => {
        game.audio.play('click');
        const lines = game.loreForComputer();
        game.hud.clearDialog();
        for (const l of lines) game.hud.say('Ordinateur', l, 5);
        game.bus.emit('interact', 'computer');
      },
    });
  }

  private chair(x: number, z: number, rot: number, m: THREE.Material) {
    const c = new THREE.Group();
    const seat = new THREE.Mesh(boxGeo(0.45, 0.05, 0.45), m);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(boxGeo(0.45, 0.5, 0.05), m);
    back.position.set(0, 0.72, -0.2);
    c.add(seat, back);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const leg = new THREE.Mesh(boxGeo(0.04, 0.45, 0.04), m);
      leg.position.set(lx, 0.225, lz);
      c.add(leg);
    }
    c.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    c.position.set(x, FLOOR, z);
    c.rotation.y = rot;
    this.group.add(c);
    this.physics.addBox(x - 0.24, FLOOR, z - 0.24, x + 0.24, FLOOR + 0.45, z + 0.24);
  }

  // ---------------------------------------------------------------- lights
  private buildLights(initiallyOn: string[]) {
    const rooms: [string, string, number, number, THREE.Vector3][] = [
      ['bedroom', 'de la chambre', -4, -3, new THREE.Vector3(-2.75, 1.25, -0.16)],
      ['bathroom', 'de la salle de bain', 0.5, -3, new THREE.Vector3(1.3, 1.25, -0.16)],
      ['kitchen', 'de la cuisine', 4.5, -3, new THREE.Vector3(3.2, 1.25, -0.16)],
      ['living', 'du salon', -2.5, 3, new THREE.Vector3(-3.4, 1.25, 5.84)],
      ['dining', 'de la salle à manger', 4.5, 3, new THREE.Vector3(2.16, 1.25, 1.6)],
    ];
    for (const [id, name, x, z, sw] of rooms) {
      const light = new THREE.PointLight('#ffd9a8', 0, 11, 1.6);
      light.position.set(x, H - 0.35, z);
      this.group.add(light);
      const fixture = new THREE.MeshStandardMaterial({ color: '#fff7e8', emissive: '#ffe2b0', emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), fixture);
      lamp.rotation.x = Math.PI;
      lamp.position.set(x, H, z);
      this.group.add(lamp);
      const plate = new THREE.Mesh(boxGeo(0.08, 0.12, 0.02), mat('#ffffff', { rough: 0.3 }));
      plate.position.copy(sw);
      if (id === 'dining') plate.rotation.y = Math.PI / 2;
      this.group.add(plate);
      const rl: RoomLight = { id, name, light, fixture, on: false };
      this.lights.push(rl);
      this.setLight(rl, initiallyOn.includes(id));
      this.interactables.push({
        id: 'light_' + id, position: sw.clone(), radius: 1.4, icon: '💡',
        label: () => (rl.on ? 'Éteindre la lumière ' : 'Allumer la lumière ') + name,
        use: (game) => {
          this.setLight(rl, !rl.on);
          game.audio.play('click', { position: sw });
          game.bus.emit('interact', 'light_' + id);
        },
      });
    }
  }

  private setLight(l: RoomLight, on: boolean) {
    l.on = on;
    l.light.intensity = on ? 14 : 0;
    l.fixture.emissiveIntensity = on ? 2.2 : 0;
  }

  // ---------------------------------------------------------------- garden
  private buildGarden() {
    const g = this.group, p = this.physics;
    const fence = mat('#f4f1ea', { rough: 0.6 });
    // Path to the sidewalk
    block(g, null, -3.2, 0, 7.1, -1.8, 0.04, 11.4, { material: mat('#b9b2a5', { map: 'concrete' }), collide: false, castShadow: false, tile: 1.5 });
    // Driveway
    block(g, null, 7.6, 0, -2, 11, 0.03, 11.4, { material: mat('#7c7a76', { map: 'concrete' }), collide: false, castShadow: false, tile: 3 });
    // Picket fence around the lot with gaps for path and driveway
    const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 0.35);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const picket = new THREE.Mesh(boxGeo(0.08, 0.9, 0.04), fence);
        picket.position.set(x0 + (x1 - x0) * t, 0.45, z0 + (z1 - z0) * t);
        if (z0 === z1) picket.rotation.y = 0; else picket.rotation.y = Math.PI / 2;
        picket.castShadow = true;
        g.add(picket);
      }
      const rail = new THREE.Mesh(boxGeo(z0 === z1 ? len : 0.04, 0.06, z0 === z1 ? 0.04 : len), fence);
      rail.position.set((x0 + x1) / 2, 0.6, (z0 + z1) / 2);
      g.add(rail);
      p.addBox(Math.min(x0, x1) - 0.06, 0, Math.min(z0, z1) - 0.06, Math.max(x0, x1) + 0.06, 0.95, Math.max(z0, z1) + 0.06);
    };
    fenceRun(-11, 11.2, -3.6, 11.2);
    fenceRun(-1.4, 11.2, 7.4, 11.2);
    fenceRun(-11, -10, 11.4, -10);
    fenceRun(-11, -10, -11, 11.2);
    fenceRun(11.4, -10, 11.4, -2.5);
    // Mailbox
    block(g, p, -4.3, 0, 11.4, -4.2, 1.0, 11.5, { material: mat('#555', { metal: 0.6 }) });
    block(g, null, -4.45, 1.0, 11.3, -4.05, 1.25, 11.65, { material: mat('#2f5d9e', { metal: 0.4, rough: 0.4 }), collide: false });
    this.interactables.push({
      id: 'mailbox', position: new THREE.Vector3(-4.25, 1.1, 11.4), radius: 1.6, icon: '✉',
      label: () => 'Lire le courrier',
      use: (game) => {
        game.audio.play('door', { pitch: 2 });
        game.hud.clearDialog();
        game.hud.say('Courrier', '« Observatoire de Val-Lumen — Avis aux riverains : des anomalies gravitationnelles ont été mesurées cette semaine. Signalez tout phénomène inhabituel. »', 6);
        game.bus.emit('interact', 'mailbox');
      },
    });
    // Garden bench and flower beds
    block(g, p, -8, 0, -8.2, -5.6, 0.45, -7.7, { material: mat('#7a5233', { map: 'wood' }) });
    block(g, p, -8, 0.45, -8.25, -5.6, 0.95, -8.15, { material: mat('#7a5233', { map: 'wood' }) });
    for (let i = 0; i < 18; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat(['#e04e6a', '#f2c94c', '#bb6bd9', '#ffffff'][i % 4], { rough: 0.7 }));
      f.position.set(-6.5 + (i % 9) * 0.9, 0.18, 7.0 + Math.floor(i / 9) * 0.5 + (i % 2) * 0.1);
      g.add(f);
    }
    block(g, null, -6.9, 0, 6.8, 0.6, 0.1, 8.0, { material: mat('#4a3626', { rough: 1 }), collide: false, castShadow: false });
    // Family car in the driveway
    const car = makeCar('#b23a3a');
    car.position.set(9.3, 0, 6.5);
    car.rotation.y = Math.PI;
    g.add(car);
    p.addBox(8.35, 0, 4.4, 10.25, 1.5, 8.6);
  }

  update(dt: number, game: Game) {
    for (const d of this.doors) {
      const target = d.open ? d.openAngle : 0;
      d.angle += (target - d.angle) * Math.min(1, dt * 8);
      d.pivot.rotation.y = d.angle;
    }
    this.tv.screen.update(dt, this.tv.on);
    this.fridgeOpen = Math.max(0, this.fridgeOpen - dt);
    const fa = this.fridgeOpen > 0 ? -1.6 : 0;
    this.fridgeDoor.rotation.y += (fa - this.fridgeDoor.rotation.y) * Math.min(1, dt * 6);
    if (this.radioPlaying > 0) {
      this.radioPlaying -= dt;
      this.radioLed.emissiveIntensity = 1.5 + Math.sin(performance.now() * 0.02) * 0.8;
    } else this.radioLed.emissiveIntensity = 0.3;
    void game;
  }
}

/** Procedural car model (also used by the traffic system). */
export function makeCar(color: string): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(color, { rough: 0.25, metal: 0.6 });
  const glass = mat('#1d2a36', { rough: 0.05, metal: 0.8 });
  const tire = mat('#1b1b1b', { rough: 0.9 });
  const chrome = mat('#d0d4d8', { rough: 0.2, metal: 1 });
  const body = new THREE.Mesh(boxGeo(1.8, 0.55, 4.1), paint);
  body.position.y = 0.6;
  const hood = new THREE.Mesh(boxGeo(1.76, 0.12, 1.2), paint);
  hood.position.set(0, 0.92, 1.35);
  const cabin = new THREE.Mesh(boxGeo(1.6, 0.55, 2.0), glass);
  cabin.position.set(0, 1.15, -0.25);
  const roof = new THREE.Mesh(boxGeo(1.62, 0.07, 1.7), paint);
  roof.position.set(0, 1.45, -0.3);
  g.add(body, hood, cabin, roof);
  for (const [x, z] of [[-0.82, 1.35], [0.82, 1.35], [-0.82, -1.35], [0.82, -1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tire);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.34, z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.25, 10), chrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(w.position);
    g.add(w, hub);
  }
  const head = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 0.3 });
  const tail = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff2020', emissiveIntensity: 0.4 });
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.Mesh(boxGeo(0.35, 0.12, 0.05), head);
    h.position.set(x, 0.72, 2.06);
    const t = new THREE.Mesh(boxGeo(0.35, 0.1, 0.05), tail);
    t.position.set(x, 0.75, -2.06);
    g.add(h, t);
  }
  g.userData.headMat = head;
  g.userData.tailMat = tail;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}
