import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import type { Interactable, MapMarker, Zone } from './Zone';
import { disposeObject } from './Zone';
import { EarthTerrain, CRASH_SITE, POND, WATER_LEVEL } from './Terrain';
import { House } from './House';
import { Town, ROADS, WATER_TOWER } from './Town';
import { Townsfolk } from './Townsfolk';
import { EarthSky } from './EarthSky';
import { OBSERVATORY } from './Observatory';
import { smoothstep } from '../core/noise';

/** The starting planet region: the town of Val-Lumen and its surroundings. */
export class EarthZone implements Zone {
  readonly id = 'earth';
  readonly name = 'Val-Lumen — Terre';
  gravity = 9.81;
  readonly hasAtmosphere = true;
  readonly root = new THREE.Group();
  readonly physics = new CollisionWorld();
  readonly interactables: Interactable[] = [];
  readonly spawn = new THREE.Vector3(-4.2, 0.15, -2.6);
  readonly mapExtent = 320;
  readonly terrain: EarthTerrain;
  readonly house: House;
  readonly town: Town;
  readonly folk: Townsfolk;
  readonly sky: EarthSky;
  altitudeFade = 0;

  constructor(game: Game) {
    const q = game.quality;
    this.terrain = new EarthTerrain(q.viewDistance >= 800 ? 'high' : 'low');
    this.physics.ground = (x, z) => this.terrain.heightAt(x, z);
    this.root.add(this.terrain.build());
    this.house = new House(this.physics, game.saveData.world.house);
    this.root.add(this.house.group);
    this.town = new Town(this.physics, this.terrain, q.treeCount);
    this.root.add(this.town.group);
    this.folk = new Townsfolk(this.physics, q.particleBudget >= 1500 ? 16 : 8, q.particleBudget >= 1500 ? 8 : 4, q.particleBudget >= 3000);
    this.root.add(this.folk.group);
    this.sky = new EarthSky(q.rainDrops, q.viewDistance);
    this.sky.configureShadows(q.shadows, q.shadowMapSize);
    this.sky.setWeather((game.saveData.world.weather as any) ?? 'clear', true);
    this.sky.onThunder = (delay) => setTimeout(() => game.audio.play('thunder', { volume: 0.9 }), delay * 1000);
    this.root.add(this.sky.group);
    this.interactables.push(...this.house.interactables, ...this.town.interactables);
    if (game.missions.isCompleted('m_lights')) this.town.setShardDormant(true);

    // Movable props for telekinesis and physics fun
    const spots: [string, number, number][] = [
      ['crate', -30, -27], ['crate', -31, -26], ['barrel', -29, -25.5], ['crate', -14, -30], ['barrel', 30, -27],
      ['barrel', 31, -26], ['crate', 52, -30], ['bin', -8, 12.6], ['bin', 8, 12.6], ['bin', 28, 21.4], ['bin', -28, 21.4],
      ['crate', 120, -95], ['barrel', 82, -100], ['rock', 196, -200], ['rock', 214, -228], ['crate', -84, -52], ['barrel', -95, -52],
    ];
    for (const [k, x, z] of spots) game.props.add(k as any, x, this.physics.surfaceHeight(x, z, 50, 0.4, 0) + 0.1, z);
  }

  groundAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  mapMarkers(): MapMarker[] {
    return [
      { x: 0, z: 0, label: 'Maison', color: '#7fd8ff' },
      { x: CRASH_SITE.x, z: CRASH_SITE.z, label: "Site d'impact", color: '#4fd8ff' },
      { x: WATER_TOWER.x, z: WATER_TOWER.z, label: "Château d'eau", color: '#c94b3a' },
      { x: POND.x, z: POND.z, label: 'Parc', color: '#7dff9a' },
      { x: 0, z: -37, label: 'Centre-ville', color: '#d9d4cc' },
      { x: OBSERVATORY.padX, z: OBSERVATORY.padZ, label: 'Observatoire', color: '#ffd23f' },
    ];
  }

  /** Top-down map picture of the zone. */
  renderMap(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    const ext = this.mapExtent;
    for (let j = 0; j < 256; j++) {
      for (let i = 0; i < 256; i++) {
        const x = (i / 256) * 2 * ext - ext, z = (j / 256) * 2 * ext - ext;
        const h = this.terrain.heightAt(x, z);
        const pe = ((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2;
        let r = 70 + h * 2, g = 105 + h * 1.5, b = 60 + h;
        if (pe < 1.1) { r = 40; g = 90; b = 130; }
        const o = (j * 256 + i) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const s = 256 / (2 * ext);
    ctx.fillStyle = '#4a4c50';
    for (const [x0, z0, x1, z1, w] of ROADS) {
      if (z0 === z1) ctx.fillRect((x0 + ext) * s, (z0 - w / 2 + ext) * s, (x1 - x0) * s, w * s);
      else ctx.fillRect((x0 - w / 2 + ext) * s, (z0 + ext) * s, w * s, (z1 - z0) * s);
    }
    ctx.fillStyle = '#d8cfc0';
    for (const [a, b, cc, d] of this.town.footprints) ctx.fillRect((a + ext) * s, (b + ext) * s, (cc - a) * s, (d - b) * s);
    return c;
  }

  update(dt: number, game: Game) {
    const p = game.player.position;
    this.altitudeFade = smoothstep(900, 3000, p.y);
    this.sky.update(dt, game.time, game.camera, p, this.altitudeFade);
    this.house.update(dt, game);
    const night = this.sky.night;
    this.town.update(dt, game, night);
    this.folk.update(dt, game, night, (pos, r) => game.enemies.dangerAt(pos, r));
    // Ambience
    const w = this.sky.params;
    const indoor = Math.abs(p.x) < 7 && Math.abs(p.z) < 6 && p.y < 3;
    const alt = smoothstep(30, 600, p.y);
    game.audio.setAmbience({
      wind: Math.min(1, (w.wind * 0.6 + alt * 0.9 + (game.player.flying ? Math.min(1, game.player.velocity.length() / 60) : 0)) * (indoor ? 0.25 : 1)),
      rain: w.rain * (indoor ? 0.4 : 1) * (1 - alt),
      birds: (1 - night) * (1 - w.rain) * (indoor ? 0.2 : 0.6) * (1 - alt),
      crickets: night * (1 - w.rain) * (indoor ? 0.15 : 0.5) * (1 - alt),
      drone: this.altitudeFade,
    });
    // Water: slow down and float in the pond
    if (p.y < WATER_LEVEL - 0.6) {
      const pe = ((p.x - POND.x) / POND.rx) ** 2 + ((p.z - POND.z) / POND.rz) ** 2;
      if (pe < 1.2) {
        const b = game.player.body;
        b.vy = Math.max(b.vy, 0) + 12 * dt;
        b.vx *= 0.92; b.vz *= 0.92;
      }
    }
  }

  applyQuality(game: Game) {
    this.sky.configureShadows(game.quality.shadows, game.quality.shadowMapSize);
  }

  dispose() {
    disposeObject(this.root);
  }
}
