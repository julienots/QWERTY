import * as THREE from 'three';
import type { Game } from '../Game';
import type { EnemyDef, Element } from '../content/types';
import type { Body } from '../physics/CollisionWorld';
import { createEnemyModel, type EnemyModel } from './EnemyModels';
import { distToSegment } from './Projectiles';
import { angleLerp, damp } from '../core/noise';

type AiState = 'wander' | 'chase' | 'windup' | 'recover' | 'flee';

export class Enemy {
  readonly model: EnemyModel;
  readonly body: Body;
  health: number;
  alive = true;
  state: AiState = 'wander';
  stateTime = 0;
  attackCd = 0;
  yaw = Math.random() * Math.PI * 2;
  home = new THREE.Vector3();
  wanderTarget = new THREE.Vector3();
  flash = 0;
  burn = 0;
  freeze = 0;
  stun = 0;
  timeScale = 1;
  grabbed = false;
  /** Enemies spawned by a mission/wave always hunt the player. */
  hunter = false;
  tag: string | null = null;
  deathT = 0;
  t = Math.random() * 10;
  attackAnim = 0;
  lodAccum = 0;
  hoverHeight = 4 + Math.random() * 3;
  constructor(readonly def: EnemyDef, x: number, y: number, z: number) {
    this.model = createEnemyModel(def);
    this.health = def.health;
    const r = def.flying ? 0.6 : 0.45 * def.scale;
    this.body = { x, y, z, vx: 0, vy: 0, vz: 0, radius: r, height: 1.2 * def.scale, onGround: false, stepHeight: 0.5 };
    this.home.set(x, y, z);
    this.wanderTarget.set(x, y, z);
  }
  get position(): THREE.Vector3 { return this.model.root.position; }
  get maxHealth() { return this.def.health; }
}

export interface DamageOpts {
  element?: Element;
  knock?: THREE.Vector3;
  source?: string;
  silent?: boolean;
}

/**
 * All hostile creatures in the current zone: spawning, AI (wander → chase → wind-up →
 * strike → recover, flee when hurt), status effects, damage and death. Distant creatures
 * run a simplified, lower-frequency update to save CPU.
 */
export class EnemyManager {
  readonly group = new THREE.Group();
  readonly list: Enemy[] = [];
  private tmp = new THREE.Vector3();
  private ambientTimer = 60;

  spawn(defId: string, x: number, z: number, opts: { hunter?: boolean; tag?: string; y?: number; game: Game }): Enemy | null {
    const def = opts.game.content.enemy(defId);
    if (!def) { console.warn('unknown enemy', defId); return null; }
    // Never spawn inside a building: spiral outwards to the nearest free spot.
    const phys = opts.game.zone.physics;
    for (let i = 0; i < 40; i++) {
      const g0 = opts.game.zone.groundAt(x, z);
      if (phys.surfaceHeight(x, z, g0 + 60, 0.8, 0) <= g0 + 0.3) break;
      const a = i * 2.4, r = 2 + i * 0.8;
      x += Math.cos(a) * r; z += Math.sin(a) * r;
    }
    const ground = opts.game.zone.groundAt(x, z);
    const y = opts.y ?? (def.flying ? ground + 5 : ground + 0.5);
    const e = new Enemy(def, x, y, z);
    e.hunter = !!opts.hunter;
    e.tag = opts.tag ?? null;
    e.model.root.position.set(x, y, z);
    this.list.push(e);
    this.group.add(e.model.root);
    // Rift effect
    opts.game.particles.emit({ count: 40, position: new THREE.Vector3(x, y + 1, z), color: def.glow, color2: '#000000', speed: 4, life: 0.9, size: 0.7, drag: 2 });
    opts.game.audio.play('growl', { position: e.position, pitch: 1.2 / def.scale });
    return e;
  }

  get alive(): Enemy[] { return this.list.filter((e) => e.alive); }

  countTagged(tag: string): number {
    return this.list.filter((e) => e.alive && e.tag === tag).length;
  }

  nearest(p: THREE.Vector3, radius: number): Enemy | null {
    let best: Enemy | null = null, bd = radius;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(p);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Closest living creature within a cone (aim assist / telekinesis). */
  inCone(origin: THREE.Vector3, dir: THREE.Vector3, range: number, cosLimit: number): Enemy | null {
    let best: Enemy | null = null, bestC = cosLimit;
    for (const e of this.list) {
      if (!e.alive) continue;
      this.tmp.copy(e.position).setY(e.position.y + e.model.center).sub(origin);
      const d = this.tmp.length();
      if (d > range) continue;
      const c = this.tmp.dot(dir) / d;
      if (c > bestC) { bestC = c; best = e; }
    }
    return best;
  }

  hitSegment(a: THREE.Vector3, b: THREE.Vector3, r: number): Enemy | null {
    for (const e of this.list) {
      if (!e.alive) continue;
      this.tmp.copy(e.position).setY(e.position.y + e.model.center);
      if (distToSegment(this.tmp, a, b) < r + e.model.radius) return e;
    }
    return null;
  }

  hitSphere(c: THREE.Vector3, r: number): Enemy | null {
    for (const e of this.list) {
      if (!e.alive) continue;
      this.tmp.copy(e.position).setY(e.position.y + e.model.center);
      if (this.tmp.distanceTo(c) < r + e.model.radius) return e;
    }
    return null;
  }

  /** Nearest threat to a position (used by civilians and traffic). */
  dangerAt(p: THREE.Vector3, r: number): THREE.Vector3 | null {
    const e = this.nearest(p, r);
    return e ? e.position : null;
  }

  damage(e: Enemy, amount: number, o: DamageOpts, game?: Game): void {
    const g = game ?? this.game;
    if (!e.alive || !g) return;
    e.health -= amount;
    e.flash = 0.12;
    if (o.knock) {
      const k = o.knock.clone().divideScalar(Math.max(0.6, e.def.scale));
      e.body.vx += k.x; e.body.vz += k.z;
      e.body.vy += Math.max(0, k.y);
      e.body.onGround = false;
    }
    switch (o.element) {
      case 'fire': e.burn = 3; break;
      case 'ice': e.freeze = 2.5; break;
      case 'lightning': e.stun = Math.max(e.stun, 0.5); break;
      case 'plasma': e.burn = 2; break;
    }
    if (e.state === 'wander') { e.state = 'chase'; e.stateTime = 0; }
    if (!o.silent) g.audio.play('enemyHit', { position: e.position, volume: 0.6 });
    g.hud.damageNumber(e.position.clone().setY(e.position.y + e.model.center * 2 + 0.6), Math.round(amount), o.element);
    if (e.health <= 0) this.kill(e, g);
  }

  private kill(e: Enemy, game: Game) {
    e.alive = false;
    e.health = 0;
    e.deathT = 0;
    game.particles.emit({ count: 50, position: e.position.clone().setY(e.position.y + e.model.center), color: e.def.glow, color2: '#000000', speed: 6, life: 1.0, size: 0.6, drag: 2 });
    game.audio.play('boom', { position: e.position, volume: 0.4, pitch: 1.6 });
    game.bus.emit('enemy:killed', { id: e.def.id, position: e.position.clone(), tag: e.tag });
    game.progress.reward(e.def.xp, e.def.fragments, e.position);
  }

  game: Game | null = null;

  update(dt: number, game: Game) {
    this.game = game;
    const player = game.player.position;
    const camPos = game.camera.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) {
        e.deathT += dt;
        const s = Math.max(0, 1 - e.deathT / 0.6);
        e.model.root.scale.setScalar(e.def.scale * s);
        if (e.deathT > 0.6) {
          this.group.remove(e.model.root);
          if (!e.model.root.userData.sharedGeometry) e.model.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
          this.list.splice(i, 1);
        }
        continue;
      }
      const dist = e.position.distanceTo(player);
      // LOD: far creatures think 4x less often and skip animation
      const far = e.position.distanceTo(camPos) > 140;
      e.model.root.visible = dist < game.quality.viewDistance * 0.6;
      if (far) {
        e.lodAccum += dt;
        if (e.lodAccum < 0.25) continue;
      }
      const edt = (far ? e.lodAccum : dt) * e.timeScale;
      e.lodAccum = 0;
      e.timeScale = 1; // re-applied each frame by time powers
      this.think(e, edt, game, dist);
      if (!far) {
        e.t += edt;
        e.attackAnim += ((e.state === 'windup' ? 1 : 0) - e.attackAnim) * damp(e.state === 'windup' ? 10 : 6, edt);
        e.model.animate(edt, { speed: Math.hypot(e.body.vx, e.body.vz), attack: e.attackAnim, t: e.t, airborne: !e.body.onGround });
        e.flash = Math.max(0, e.flash - dt);
        if (e.flash > 0) e.model.setFlash(1);
        else if (e.freeze > 0) e.model.setTint(new THREE.Color('#5fc8ff'));
        else if (e.burn > 0) e.model.setTint(new THREE.Color('#ff6a00'));
        else e.model.setFlash(0);
      }
    }
    this.ambientSpawns(dt, game);
  }

  private think(e: Enemy, dt: number, game: Game, dist: number) {
    const d = e.def;
    const b = e.body;
    // Status effects
    if (e.burn > 0) {
      e.burn -= dt;
      e.health -= 8 * dt;
      if (Math.random() < dt * 20) game.particles.emit({ count: 1, position: e.position.clone().setY(e.position.y + e.model.center), color: '#ff8a2f', color2: '#ff2000', speed: 1.5, direction: new THREE.Vector3(0, 1, 0), spread: 0.4, life: 0.5, size: 0.4 });
      if (e.health <= 0) { this.kill(e, game); return; }
    }
    const slow = e.freeze > 0 ? 0.35 : 1;
    e.freeze = Math.max(0, e.freeze - dt);
    e.stun = Math.max(0, e.stun - dt);
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.stateTime += dt;
    if (e.grabbed) { this.syncModel(e); return; }

    const player = game.player.position;
    const toPlayer = this.tmp.copy(player).sub(e.position);
    const flatDist = Math.hypot(toPlayer.x, toPlayer.z);
    const playerVisible = game.mode !== 'creative' || game.creativeHostile;
    const engaged = playerVisible && (e.hunter ? dist < 400 : dist < d.aggroRange);

    // State transitions
    if (e.state !== 'flee' && d.fleeAt > 0 && e.health < d.health * d.fleeAt) { e.state = 'flee'; e.stateTime = 0; }
    if (e.state === 'flee' && e.stateTime > 4) { e.state = 'chase'; e.stateTime = 0; }
    if (e.state === 'wander' && engaged) { e.state = 'chase'; e.stateTime = 0; game.audio.play('growl', { position: e.position, volume: 0.6 }); }
    if (e.state === 'chase' && !engaged && !e.hunter) { e.state = 'wander'; }

    let desired = new THREE.Vector3();
    let speed = d.speed * slow;
    if (e.stun > 0) speed = 0;

    switch (e.state) {
      case 'wander': {
        if (e.position.distanceTo(e.wanderTarget) < 2 || e.stateTime > 8) {
          // Prowl near home, sometimes towards civilians
          const peds = game.townsfolk?.pedestrians ?? [];
          const victim = peds.find((p) => p.distanceTo(e.position) < 35);
          if (victim) e.wanderTarget.copy(victim);
          else e.wanderTarget.set(e.home.x + (Math.random() - 0.5) * 30, 0, e.home.z + (Math.random() - 0.5) * 30);
          e.stateTime = 0;
        }
        desired.copy(e.wanderTarget).sub(e.position).setY(0);
        speed *= 0.45;
        break;
      }
      case 'chase': {
        if (d.ranged) {
          // Keep a comfortable firing distance and strafe
          const ideal = d.attackRange * 0.65;
          const radial = toPlayer.clone().setY(0).normalize();
          const tangent = new THREE.Vector3(-radial.z, 0, radial.x).multiplyScalar(Math.sin(e.t * 0.7) > 0 ? 1 : -1);
          desired.copy(radial).multiplyScalar(flatDist > ideal ? 1 : -0.6).add(tangent.multiplyScalar(0.6));
          if (flatDist < d.attackRange && e.attackCd <= 0 && this.lineOfSight(e, game)) { e.state = 'windup'; e.stateTime = 0; }
        } else {
          desired.copy(toPlayer).setY(0);
          if (dist < d.attackRange + 0.3 * d.scale && e.attackCd <= 0) { e.state = 'windup'; e.stateTime = 0; }
        }
        break;
      }
      case 'windup': {
        speed *= 0.15;
        desired.copy(toPlayer).setY(0);
        const windup = d.ranged ? 0.55 : d.model === 'brute' ? 0.8 : 0.4;
        if (e.stateTime > windup) {
          this.attack(e, game, dist);
          e.state = 'recover';
          e.stateTime = 0;
          e.attackCd = d.attackCooldown;
        }
        break;
      }
      case 'recover': {
        speed *= 0.3;
        if (e.stateTime > 0.5) { e.state = 'chase'; e.stateTime = 0; }
        break;
      }
      case 'flee': {
        desired.copy(toPlayer).setY(0).negate();
        speed *= 1.2;
        break;
      }
    }

    // Separation from other creatures
    for (const o of this.list) {
      if (o === e || !o.alive) continue;
      const dx = e.position.x - o.position.x, dz = e.position.z - o.position.z;
      const dd = dx * dx + dz * dz;
      const min = (e.model.radius + o.model.radius) * 1.2;
      if (dd < min * min && dd > 1e-6) {
        const k = (min - Math.sqrt(dd)) / min;
        desired.x += (dx / Math.sqrt(dd)) * k * 3;
        desired.z += (dz / Math.sqrt(dd)) * k * 3;
      }
    }

    if (desired.lengthSq() > 1e-4) {
      desired.normalize();
      const face = e.state === 'windup' || (d.ranged && e.state === 'chase') ? Math.atan2(toPlayer.x, toPlayer.z) : Math.atan2(desired.x, desired.z);
      e.yaw = angleLerp(e.yaw, face, Math.min(1, dt * 8));
    }
    const k = Math.min(1, dt * (b.onGround || d.flying ? 6 : 1));
    b.vx += (desired.x * speed - b.vx) * k;
    b.vz += (desired.z * speed - b.vz) * k;

    if (d.flying) {
      const ground = game.zone.groundAt(b.x, b.z);
      const targetY = Math.max(ground + e.hoverHeight, e.state === 'chase' || e.state === 'windup' ? player.y + 2.5 : ground + e.hoverHeight);
      b.vy += ((targetY - b.y) * 1.5 - b.vy) * Math.min(1, dt * 3);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < ground + 0.6) b.y = ground + 0.6;
    } else {
      b.vy -= game.zone.gravity * dt;
      game.zone.physics.move(b, dt);
      if (b.y < game.zone.groundAt(b.x, b.z) - 5) { b.y = game.zone.groundAt(b.x, b.z) + 1; b.vy = 0; }
    }
    this.syncModel(e);
  }

  private syncModel(e: Enemy) {
    e.model.root.position.set(e.body.x, e.body.y, e.body.z);
    e.model.root.rotation.y = e.yaw;
  }

  private lineOfSight(e: Enemy, game: Game): boolean {
    const from = e.position.clone().setY(e.position.y + e.model.center + 0.3);
    const to = game.player.position.clone().setY(game.player.position.y + 1.2);
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.divideScalar(len);
    return game.zone.physics.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, len, true) >= len - 0.5;
  }

  private attack(e: Enemy, game: Game, dist: number) {
    const d = e.def;
    if (d.ranged) {
      const from = e.position.clone().setY(e.position.y + e.model.center + 0.2);
      from.add(new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(e.model.radius));
      // Lead the target a little
      const target = game.player.position.clone().setY(game.player.position.y + 1).addScaledVector(game.player.velocity, Math.min(0.6, dist / 30));
      const speed = d.model === 'drone' ? 34 : 20;
      const vel = target.sub(from).normalize().multiplyScalar(speed);
      if (d.model === 'spitter') vel.y += 2.5;
      game.projectiles.spawn({ owner: 'enemy', position: from, velocity: vel, radius: d.model === 'drone' ? 0.15 : 0.3, damage: d.damage, color: d.glow, element: 'none', gravity: d.model === 'spitter' ? 4 : 0, range: 80 });
      game.audio.play(d.model === 'drone' ? 'zap' : 'spit', { position: e.position, volume: 0.6 });
    } else if (d.model === 'brute') {
      // Ground slam: area damage
      const r = 4.5;
      game.particles.emit({ count: 40, position: e.position.clone().setY(e.position.y + 0.2), color: d.glow, color2: '#3a2a2a', speed: 9, spread: 1, direction: new THREE.Vector3(0, 0.1, 0), life: 0.7, size: 0.8, drag: 3 });
      game.audio.play('boom', { position: e.position, volume: 0.8 });
      game.cameraRig.shake(dist < 15 ? 0.5 : 0.15);
      if (dist < r + 1 && game.player.position.y - e.position.y < 2.5) game.player.damage(d.damage, game, e.position);
    } else if (dist < d.attackRange + 0.8) {
      game.player.damage(d.damage, game, e.position);
      game.audio.play('hit', { position: e.position, volume: 0.7 });
    }
  }

  /** Dynamic world events: creatures roam at night once the story has awakened them. */
  private ambientSpawns(dt: number, game: Game) {
    if (game.zone.id !== 'earth' || game.mode === 'creative' || !game.missions.isCompleted('m_echoes')) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 75 + Math.random() * 60;
    const night = game.sky?.night ?? 0;
    const roaming = this.list.filter((e) => e.alive && e.tag === 'ambient').length;
    if (night < 0.5 || roaming >= 6) return;
    const a = Math.random() * Math.PI * 2;
    const p = game.player.position;
    const r = 60 + Math.random() * 50;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const n = 2 + Math.floor(Math.random() * 3);
    const types = game.progress.stage >= 2 ? ['void_stalker', 'void_spitter', 'void_drone'] : ['void_stalker'];
    for (let i = 0; i < n; i++) this.spawn(types[i % types.length], x + (Math.random() - 0.5) * 8, z + (Math.random() - 0.5) * 8, { game, tag: 'ambient' });
    game.hud.toast('⚠ Des créatures du Néant rôdent dans les environs…');
  }

  clear() {
    for (const e of this.list) this.group.remove(e.model.root);
    this.list.length = 0;
  }
}
