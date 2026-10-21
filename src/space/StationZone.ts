import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable, MapMarker, Zone } from '../world/Zone';
import { disposeObject } from '../world/Zone';
import { Station } from './Station';
import { makeEarth, spaceBackground, spaceLights } from './Scenery';
import { EARTH_RADIUS } from './OrbitZone';

/** Inside Station Aurore: weightless pressurised modules, crew, navigation and hangar. */
export class StationZone implements Zone {
  readonly id = 'station';
  readonly name = 'Station Aurore — modules pressurisés';
  readonly gravity = 0;
  readonly hasAtmosphere = false;
  readonly zeroG = true;
  readonly floatSpeed = 4.5;
  readonly cameraDistance = 2.6;
  readonly envIntensity = 0.45;
  readonly root = new THREE.Group();
  readonly physics = new CollisionWorld();
  readonly interactables: Interactable[] = [];
  readonly spawn = new THREE.Vector3(50, -0.6, 0);
  readonly mapExtent = 70;
  readonly background: THREE.Texture | THREE.Color;
  readonly station: Station;

  constructor(game: Game) {
    this.physics.ground = () => -1e6;
    this.background = spaceBackground(this.root);
    spaceLights(this.root, false, 512);
    this.station = new Station(this.physics);
    this.root.add(this.station.group);
    this.interactables.push(...this.station.interactables);
    // Cabin lighting along the modules
    for (const x of [-22, -4, 14, 32, 50]) {
      const l = new THREE.PointLight('#e8f2ff', 14, 22, 1.6);
      l.position.set(x, 1.2, 0);
      this.root.add(l);
    }
    for (const z of [8, -10]) {
      const l = new THREE.PointLight('#e8f2ff', 10, 16, 1.6);
      l.position.set(0, 1.2, z);
      this.root.add(l);
    }
    // The Earth seen through the panoramic window
    const e = makeEarth(EARTH_RADIUS, 64);
    e.group.position.set(0, -EARTH_RADIUS - 900, -2500);
    this.root.add(e.group);
    void game;
  }

  breathable(p: THREE.Vector3) { return this.station.inside(p, 1); }

  groundAt(): number { return -1e6; }

  mapMarkers(): MapMarker[] {
    return [
      { x: 53, z: 0, label: 'Sas', color: '#ffd23f' },
      { x: 20, z: -1.8, label: 'Navigation', color: '#7fd8ff' },
      { x: 45, z: 1.8, label: 'Hangar', color: '#ffd23f' },
      { x: -20, z: 1.8, label: 'Infirmerie', color: '#7dff9a' },
      { x: 0, z: 7, label: 'Commandement', color: '#ff9cf0' },
    ];
  }

  renderMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#04080f'; g.fillRect(0, 0, 256, 256);
    const s = 256 / (2 * this.mapExtent);
    g.fillStyle = '#c9d2dc';
    for (const v of this.station.volumes) g.fillRect((v.minX + this.mapExtent) * s, (v.minZ + this.mapExtent) * s, (v.maxX - v.minX) * s, (v.maxZ - v.minZ) * s);
    return c;
  }

  update(dt: number, game: Game) {
    this.station.update(dt, game);
    game.audio.setAmbience({ wind: 0, rain: 0, birds: 0, crickets: 0, drone: 0.35 });
  }

  dispose() { disposeObject(this.root); }
}
