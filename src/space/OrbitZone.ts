import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable, MapMarker, Zone } from '../world/Zone';
import { disposeObject } from '../world/Zone';
import { currentAssets } from '../world/build';
import { fitTo } from '../core/Assets';
import { instanceModel, type InstanceSpec } from '../world/Instanced';
import { mulberry32 } from '../core/noise';
import { Impostor } from './celestial';
import { SUN_DIR, makeEarth, makeMoon, spaceBackground, spaceLights } from './Scenery';

/**
 * Game-scale Earth: 6 000 m radius, station 1 500 m up. A higher orbit than the real ISS
 * (relative to the planet), so the curvature and the continents read clearly on a phone.
 */
export const EARTH_RADIUS = 6000;
export const ORBIT_ALTITUDE = 1500;
export const EARTH_CENTER = new THREE.Vector3(0, -EARTH_RADIUS - ORBIT_ALTITUDE, 0);
/** Outer hatch of Station Aurore (where the player enters the pressurised modules). */
export const AIRLOCK = new THREE.Vector3(0, 0, 64);

/**
 * Low Earth orbit around Station Aurore: the real NASA ISS model as the station exterior,
 * Hubble, a spacewalking astronaut, a debris field, the Earth below and the Moon far away.
 */
export class OrbitZone implements Zone {
  readonly id = 'orbit';
  readonly name = 'Orbite terrestre — Station Aurore';
  readonly gravity = 0;
  readonly hasAtmosphere = false;
  readonly zeroG = true;
  readonly floatSpeed = 9;
  readonly envIntensity = 0.12;
  readonly root = new THREE.Group();
  readonly physics = new CollisionWorld();
  readonly interactables: Interactable[] = [];
  readonly spawn = AIRLOCK.clone().add(new THREE.Vector3(0, 0, 6));
  readonly mapExtent = 1500;
  readonly background: THREE.Texture | THREE.Color;
  private earth: THREE.Group;
  private clouds: THREE.Mesh;
  private moon: Impostor;
  private sunDisc: THREE.Object3D | null = null;
  private spinners: { o: THREE.Object3D; axis: THREE.Vector3; speed: number }[] = [];
  private t = 0;
  private astronaut: THREE.Object3D | null = null;

  constructor(game: Game) {
    const q = game.quality;
    this.physics.ground = () => -1e6;
    this.background = spaceBackground(this.root);
    spaceLights(this.root, q.shadows, q.shadowMapSize, 90);
    this.sunDisc = this.root.children.find((c) => c.userData.followCamera) ?? null;

    const e = makeEarth(EARTH_RADIUS, q.viewDistance >= 800 ? 128 : 72);
    this.earth = e.group;
    this.clouds = e.clouds;
    this.earth.position.copy(EARTH_CENTER);
    // Put the Mediterranean (30°N, 15°E) right under the station.
    const lat = THREE.MathUtils.degToRad(30), lon = THREE.MathUtils.degToRad(15);
    const phi = lon + Math.PI, theta = Math.PI / 2 - lat;
    const below = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    this.earth.quaternion.setFromUnitVectors(below.normalize(), new THREE.Vector3(0, 1, 0));
    this.root.add(this.earth);

    const moonMesh = makeMoon(1700);
    this.root.add(moonMesh);
    this.moon = new Impostor(moonMesh, new THREE.Vector3(-0.35, 0.3, -0.89).normalize().multiplyScalar(60000), 1700);

    this.buildStation();
    this.buildSatellites(game);
    this.buildDebris(q.viewDistance >= 800 ? 160 : 70);

    this.interactables.push({
      id: 'airlock', position: AIRLOCK.clone(), radius: 9, icon: '🚪',
      label: (g) => (g.ships.piloting ? null : 'Entrer dans la Station Aurore'),
      use: (g) => { g.bus.emit('interact', 'airlock'); g.travel('station', { from: 'airlock' }); },
    });
  }

  private buildStation() {
    const iss = currentAssets()?.model('iss');
    const g = new THREE.Group();
    if (iss) {
      // The real ISS spans ~109 m across its truss.
      const holder = fitTo(iss, { x: 110 });
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      holder.position.y = -(box.min.y + box.max.y) / 2;
      g.add(holder);
      holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      holder.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(holder);
      // Coarse colliders: truss and pressurised spine.
      this.physics.addBox(b.min.x, -2.5, -3, b.max.x, 2.5, 3, 'iss-truss');
      this.physics.addBox(-5, -5, b.min.z, 5, 5, b.max.z, 'iss-modules');
      AIRLOCK.set(0, 0, b.max.z + 5);
    }
    // Docking collar and pressure field at the hatch (always shown, so the entrance reads clearly).
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.35, 12, 40), new THREE.MeshStandardMaterial({ color: '#d8b25a', metalness: 0.85, roughness: 0.3 }));
    ring.position.copy(AIRLOCK).add(new THREE.Vector3(0, 0, -2.5));
    const field = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    field.position.copy(ring.position);
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 6, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#e8ebef', metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide }));
    tunnel.rotation.x = Math.PI / 2;
    tunnel.position.copy(ring.position).add(new THREE.Vector3(0, 0, -3));
    const beacon = new THREE.PointLight('#7fd8ff', 30, 40);
    beacon.position.copy(AIRLOCK);
    g.add(ring, field, tunnel, beacon);
    this.root.add(g);
    this.spawn.copy(AIRLOCK).add(new THREE.Vector3(0, 0, 6));
  }

  private buildSatellites(game: Game) {
    const a = currentAssets();
    const hubble = a?.model('hubble');
    if (hubble) {
      const h = fitTo(hubble, { z: 13.2 });
      h.position.set(-160, 35, -90);
      this.root.add(h);
      this.spinners.push({ o: h, axis: new THREE.Vector3(0.3, 1, 0.2).normalize(), speed: 0.02 });
    }
    const voyager = a?.model('voyager');
    if (voyager) {
      const v = fitTo(voyager, { x: 4.5 });
      v.position.set(240, 80, 180);
      this.root.add(v);
      this.spinners.push({ o: v, axis: new THREE.Vector3(0, 1, 0), speed: 0.05 });
    }
    // An astronaut on a spacewalk near the truss
    const astro = a?.model('astronaut');
    if (astro) {
      const s = fitTo(astro, { y: 1.85 }, 'height');
      s.position.set(28, 4.5, 6);
      s.rotation.set(0.3, -0.8, 0.5);
      this.root.add(s);
      this.astronaut = s;
    }
    void game;
  }

  /** Slowly tumbling rocks and fragments: they give a sense of speed when flying. */
  private buildDebris(count: number) {
    const rnd = mulberry32(31);
    const names = ['moon_rock_1', 'moon_rock_2', 'moon_rock_3', 'moon_rock_4'];
    for (const [k, name] of names.entries()) {
      const src = currentAssets()?.model(name);
      if (!src) continue;
      const box = new THREE.Box3().setFromObject(src);
      const unit = 1 / Math.max(1e-3, box.getSize(new THREE.Vector3()).length());
      const specs: InstanceSpec[] = [];
      for (let i = 0; i < count / 4; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 500 + rnd() * 700;
        specs.push({ x: Math.cos(a) * r, y: -80 + rnd() * 220 + k * 10, z: Math.sin(a) * r, rotY: rnd() * 6.28, scale: unit * (3 + rnd() * rnd() * 30) });
      }
      const g = instanceModel(src, specs, { castShadow: false });
      this.root.add(g);
      this.spinners.push({ o: g, axis: new THREE.Vector3(0, 1, 0), speed: 0.004 * (k % 2 ? 1 : -1) });
    }
  }

  groundAt(): number { return -1e6; }

  mapMarkers(): MapMarker[] {
    return [
      { x: 0, z: 0, label: 'Station Aurore', color: '#7fd8ff' },
      { x: AIRLOCK.x, z: AIRLOCK.z, label: 'Sas', color: '#ffd23f' },
      { x: -160, z: -90, label: 'Télescope Hubble', color: '#d9d4cc' },
      { x: 240, z: 180, label: 'Sonde', color: '#b99cff' },
    ];
  }

  renderMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 180);
    grd.addColorStop(0, '#0b2a4a'); grd.addColorStop(1, '#02050c');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(127,216,255,0.25)';
    for (const r of [500, 1200]) { g.beginPath(); g.arc(128, 128, (r / 1500) * 128, 0, Math.PI * 2); g.stroke(); }
    return c;
  }

  /** Altitude above the Earth's surface. */
  altitude(p: THREE.Vector3): number { return p.distanceTo(EARTH_CENTER) - EARTH_RADIUS; }

  update(dt: number, game: Game) {
    this.t += dt;
    this.earth.rotateY(dt * 0.002);
    this.clouds.rotation.y += dt * 0.001;
    this.moon.update(game.camera);
    if (this.sunDisc) this.sunDisc.position.copy(game.camera.position).addScaledVector(SUN_DIR, 10500);
    for (const s of this.spinners) s.o.rotateOnAxis(s.axis, s.speed * dt);
    if (this.astronaut) this.astronaut.position.y = 4.5 + Math.sin(this.t * 0.4) * 0.3;
    game.audio.setAmbience({ wind: 0, rain: 0, birds: 0, crickets: 0, drone: 0.8 });
    // Re-entry when diving into the atmosphere.
    if (this.altitude(game.player.position) < 120) game.travel('earth', { from: 'space' });
  }

  dispose() { disposeObject(this.root); }
}
