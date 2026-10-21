import * as THREE from 'three';
import type { CollisionWorld, Box } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import { Humanoid } from '../player/Humanoid';
import { CharacterModel, type Avatar } from '../player/CharacterModel';
import { currentAssets } from './build';
import { makeVehicle, spinWheels, type CarModel } from './Vehicles';
import { angleLerp, mulberry32 } from '../core/noise';

type NpcState = 'walk' | 'idle' | 'flee' | 'watch' | 'hidden';

const SIDEWALKS: { x0: number; x1: number; z0: number; z1: number }[] = [
  { x0: -170, x1: 170, z0: 12.2, z1: 12.2 },
  { x0: -170, x1: 170, z0: 21.8, z1: 21.8 },
  { x0: -64.3, x1: -64.3, z0: -140, z1: 140 },
  { x0: 64.3, x1: 64.3, z0: -140, z1: 140 },
];

const REMARKS_FLY = ['Il vole !', 'Incroyable…', 'Regardez là-haut !', 'Je rêve ou quoi ?', 'Un super-héros ?!'];
const REMARKS_FIGHT = ['Au secours !', 'Fuyez !', 'Ces créatures…', 'Vite, à l’abri !'];
const REMARKS_HELLO = ['Bonjour !', 'Belle journée, hein ?', 'Tu as vu les lumières cette nuit ?', 'Salut voisin !'];

class Npc {
  model: Avatar;
  pos = new THREE.Vector3();
  yaw = 0;
  target = new THREE.Vector3();
  state: NpcState = 'walk';
  timer = 0;
  speed = 0;
  remarkCooldown = 0;
  lane = 0;
  constructor(colors: { skin: string; suit: string; pants: string; hair: string; accent: string }, female: boolean, height: number, shadows: boolean) {
    // Real rigged, animated people when the models are loaded; procedural figures otherwise.
    const assets = currentAssets();
    const kind = female ? 'human_female' : 'human_male';
    if (CharacterModel.available(assets, kind)) {
      const c = new CharacterModel(assets!, kind, { height, castShadow: shadows });
      c.tint(new THREE.Color(colors.suit), 0.12);
      this.model = c;
    } else {
      this.model = new Humanoid(colors, 'low');
      this.model.root.traverse((o) => { o.castShadow = false; });
    }
  }
}

class Car {
  group: THREE.Group;
  s: number;
  speed = 0;
  yaw = 0;
  box: Box;
  constructor(public loop: number, color: string, s: number, physics: CollisionWorld, model: CarModel) {
    this.group = makeVehicle(color, model);
    this.s = s;
    this.box = physics.addDynamicBox('car');
  }
}

const LOOPS: [number, number][][] = [
  [[-62, 19], [62, 19], [62, -77], [-62, -77]],
  [[-58, 15], [-58, -73], [58, -73], [58, 15]],
];

function loopLength(l: [number, number][]) {
  let len = 0;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

function loopPoint(l: [number, number][], s: number): { x: number; z: number; yaw: number } {
  const total = loopLength(l);
  s = ((s % total) + total) % total;
  for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[(i + 1) % l.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= len) {
      const t = s / len;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    s -= len;
  }
  return { x: l[0][0], z: l[0][1], yaw: 0 };
}

/**
 * Town population: pedestrians with a small behaviour state machine (walk, idle, watch the
 * player, flee from danger, go home at night) and cars driving around the blocks.
 */
export class Townsfolk {
  readonly group = new THREE.Group();
  private npcs: Npc[] = [];
  private cars: Car[] = [];
  private rnd = mulberry32(1234);

  constructor(private physics: CollisionWorld, npcCount: number, carCount: number, shadows = false) {
    const skins = ['#f1c6a6', '#e0b48f', '#c68e63', '#8d5a3b', '#5c3a24', '#f6d7c3'];
    const clothes = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#f39c12', '#34495e', '#e84393', '#16a085', '#d35400'];
    const pants = ['#2c3e50', '#3d3d3d', '#5b4636', '#1f3a5f', '#6b6b6b'];
    const hair = ['#2b1d14', '#5a3a22', '#d9b26f', '#111111', '#8a8a8a', '#a0522d'];
    const pick = <T,>(a: T[]) => a[Math.floor(this.rnd() * a.length)];
    for (let i = 0; i < npcCount; i++) {
      const female = i % 3 !== 0;
      const n = new Npc({ skin: pick(skins), suit: pick(clothes), pants: pick(pants), hair: pick(hair), accent: '#222222' }, female, (female ? 1.6 : 1.7) + this.rnd() * 0.2, shadows);
      const sw = SIDEWALKS[i % SIDEWALKS.length];
      n.lane = i % SIDEWALKS.length;
      const t = this.rnd();
      n.pos.set(sw.x0 + (sw.x1 - sw.x0) * t, 0.15, sw.z0 + (sw.z1 - sw.z0) * t);
      this.pickTarget(n);
      this.npcs.push(n);
      this.group.add(n.model.root);
    }
    const colors = ['#2b6cb0', '#e2e8f0', '#1a202c', '#c53030', '#2f855a', '#d69e2e', '#718096'];
    for (let i = 0; i < carCount; i++) {
      const loop = i % 2;
      const car = new Car(loop, colors[i % colors.length], (i / carCount) * loopLength(LOOPS[loop]) + i * 13, physics, i % 3 === 1 ? 'car_hatch' : 'car_sedan');
      this.cars.push(car);
      this.group.add(car.group);
    }
  }

  private pickTarget(n: Npc) {
    const sw = SIDEWALKS[n.lane];
    const along = sw.x0 === sw.x1 ? n.pos.z : n.pos.x;
    const lo = sw.x0 === sw.x1 ? sw.z0 : sw.x0, hi = sw.x0 === sw.x1 ? sw.z1 : sw.x1;
    const next = Math.max(lo, Math.min(hi, along + (this.rnd() - 0.5) * 90));
    if (sw.x0 === sw.x1) n.target.set(sw.x0, 0.15, next); else n.target.set(next, 0.15, sw.z0);
  }

  /** Positions of pedestrians (used by enemies to pick victims and by cars to brake). */
  get pedestrians(): THREE.Vector3[] {
    return this.npcs.filter((n) => n.state !== 'hidden').map((n) => n.pos);
  }

  update(dt: number, game: Game, night: number, dangerAt: (p: THREE.Vector3, r: number) => THREE.Vector3 | null) {
    const player = game.player.position;
    const lateNight = night > 0.85;
    const drawDist = game.quality.viewDistance > 600 ? 110 : 70;
    for (const n of this.npcs) {
      n.remarkCooldown -= dt;
      const dPlayer = n.pos.distanceTo(player);
      // At night most people stay home
      if (lateNight && n.state !== 'flee' && dPlayer > 30) {
        n.state = 'hidden';
      } else if (n.state === 'hidden' && !lateNight) {
        n.state = 'walk';
      }
      const threat = n.state === 'hidden' ? null : dangerAt(n.pos, 28);
      if (threat) {
        if (n.state !== 'flee' && n.remarkCooldown <= 0 && dPlayer < 40) {
          game.hud.floatText(n.pos.clone().setY(2.2), REMARKS_FIGHT[Math.floor(this.rnd() * REMARKS_FIGHT.length)]);
          n.remarkCooldown = 8;
        }
        n.state = 'flee';
        const away = n.pos.clone().sub(threat).setY(0).normalize();
        n.target.copy(n.pos).addScaledVector(away, 10);
        n.timer = 3;
      } else if (n.state === 'flee') {
        n.timer -= dt;
        if (n.timer <= 0) { n.state = 'walk'; this.returnToSidewalk(n); }
      }
      if (n.state !== 'flee' && n.state !== 'hidden') {
        const spectacle = (game.player.flying || game.powers.recentlyCast > 0) && dPlayer < 22;
        if (spectacle) {
          if (n.state !== 'watch' && n.remarkCooldown <= 0) {
            game.hud.floatText(n.pos.clone().setY(2.2), REMARKS_FLY[Math.floor(this.rnd() * REMARKS_FLY.length)]);
            n.remarkCooldown = 12;
          }
          n.state = 'watch';
          n.timer = 2.5;
        } else if (n.state === 'watch') {
          n.timer -= dt;
          if (n.timer <= 0) n.state = 'walk';
        } else if (dPlayer < 3 && n.remarkCooldown <= 0 && !game.player.flying) {
          game.hud.floatText(n.pos.clone().setY(2.2), REMARKS_HELLO[Math.floor(this.rnd() * REMARKS_HELLO.length)]);
          n.remarkCooldown = 25;
        }
      }
      let desired = 0;
      if (n.state === 'walk' || n.state === 'flee') {
        const to = n.target.clone().sub(n.pos).setY(0);
        const d = to.length();
        if (d < 0.6) {
          if (n.state === 'walk') { n.state = 'idle'; n.timer = 2 + this.rnd() * 5; }
        } else {
          desired = n.state === 'flee' ? 5.5 : 1.3;
          n.yaw = angleLerp(n.yaw, Math.atan2(to.x, to.z), Math.min(1, dt * 6));
        }
      } else if (n.state === 'idle') {
        n.timer -= dt;
        if (n.timer <= 0) { n.state = 'walk'; this.pickTarget(n); }
      } else if (n.state === 'watch') {
        const to = player.clone().sub(n.pos);
        n.yaw = angleLerp(n.yaw, Math.atan2(to.x, to.z), Math.min(1, dt * 4));
      }
      n.speed += (desired - n.speed) * Math.min(1, dt * 5);
      n.pos.x += Math.sin(n.yaw) * n.speed * dt;
      n.pos.z += Math.cos(n.yaw) * n.speed * dt;
      n.pos.y = this.physics.surfaceHeight(n.pos.x, n.pos.z, n.pos.y + 0.3, 0.2, 0.4);
      const visible = n.state !== 'hidden' && dPlayer < drawDist;
      n.model.root.visible = visible;
      if (visible) {
        n.model.root.position.copy(n.pos);
        n.model.root.rotation.y = n.yaw;
        n.model.update(dt, { speed: n.speed, grounded: true, flying: false, vy: 0, flyForward: 0, cast: 0, punch: 0, panic: n.state === 'flee' });
      }
    }

    // Cars
    for (const car of this.cars) {
      const loop = LOOPS[car.loop];
      const p = loopPoint(loop, car.s);
      const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      let blocked = false;
      const check = (q: THREE.Vector3) => {
        const rel = q.clone().sub(new THREE.Vector3(p.x, q.y, p.z));
        const ahead = rel.dot(fwd);
        const lateral = Math.abs(rel.x * fwd.z - rel.z * fwd.x);
        if (ahead > 0 && ahead < 9 && lateral < 2.2 && Math.abs(q.y - 0.5) < 4) blocked = true;
      };
      check(player);
      for (const ped of this.pedestrians) check(ped);
      for (const other of this.cars) {
        if (other === car || other.loop !== car.loop) continue;
        const o = loopPoint(LOOPS[other.loop], other.s);
        check(new THREE.Vector3(o.x, 0.5, o.z));
      }
      if (dangerAt(new THREE.Vector3(p.x, 0, p.z), 14)) blocked = true;
      const target = blocked ? 0 : 9;
      car.speed += (target - car.speed) * Math.min(1, dt * (blocked ? 4 : 0.8));
      car.s += car.speed * dt;
      spinWheels(car.group, car.speed * dt);
      car.yaw = angleLerp(car.yaw, p.yaw, Math.min(1, dt * 5));
      const inter = Math.min(Math.abs(Math.abs(p.x) - 60), 99) < 6 && (Math.abs(p.z - 17) < 6 || Math.abs(p.z + 75) < 6);
      car.group.position.set(p.x, inter ? 0.16 : 0.03, p.z);
      car.group.rotation.y = car.yaw;
      const along = Math.abs(Math.sin(car.yaw)) > 0.7;
      const hx = along ? 2.1 : 0.95, hz = along ? 0.95 : 2.1;
      Object.assign(car.box, { minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz, minY: 0, maxY: 1.5 });
      const head = car.group.userData.headMat as THREE.MeshStandardMaterial;
      head.emissiveIntensity = 0.3 + night * 3;
      const tail = car.group.userData.tailMat as THREE.MeshStandardMaterial;
      tail.emissiveIntensity = blocked ? 3 : 0.4 + night * 1.2;
      car.group.visible = car.group.position.distanceTo(player) < 260;
    }
  }

  private returnToSidewalk(n: Npc) {
    let best = 0, bestD = Infinity;
    SIDEWALKS.forEach((sw, i) => {
      const x = Math.max(Math.min(sw.x0, sw.x1), Math.min(Math.max(sw.x0, sw.x1), n.pos.x));
      const z = Math.max(Math.min(sw.z0, sw.z1), Math.min(Math.max(sw.z0, sw.z1), n.pos.z));
      const d = Math.hypot(x - n.pos.x, z - n.pos.z);
      if (d < bestD) { bestD = d; best = i; }
    });
    n.lane = best;
    const sw = SIDEWALKS[best];
    n.target.set(
      Math.max(Math.min(sw.x0, sw.x1), Math.min(Math.max(sw.x0, sw.x1), n.pos.x)), 0.15,
      Math.max(Math.min(sw.z0, sw.z1), Math.min(Math.max(sw.z0, sw.z1), n.pos.z)));
  }
}
