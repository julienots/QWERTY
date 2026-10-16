import * as THREE from 'three';
import type { Game } from '../Game';
import type { PowerBehavior, PowerDef, PassiveEffect } from '../content/types';
import type { Enemy } from '../combat/Enemies';
import type { Prop } from '../combat/Props';

/** Context handed to behaviour implementations when a power is cast. */
export interface CastContext {
  game: Game;
  def: PowerDef;
  level: number;
  /** Damage multiplier (level, strength buff, XP level). */
  power: number;
  origin: THREE.Vector3;
  aimDir: THREE.Vector3;
  aimPoint: THREE.Vector3;
  target: Enemy | null;
}

type BehaviorFn<T extends PowerBehavior['type']> = (ctx: CastContext, b: Extract<PowerBehavior, { type: T }>) => void;

interface Continuous {
  update(dt: number, game: Game): boolean; // false = finished
  dispose(): void;
}

/**
 * Data-driven power system. A power definition only names a behaviour type and its
 * parameters; this file implements each behaviour once. New powers (base or mods) are
 * added purely as data, without touching combat code.
 */
export class PowerSystem {
  readonly unlocked = new Set<string>();
  levels: Record<string, number> = {};
  favorites: string[] = [];
  active: string | null = null;
  private cooldowns = new Map<string, number>();
  private effects: Continuous[] = [];
  readonly group = new THREE.Group();
  recentlyCast = 0;
  scanTime = 0;

  constructor(private game: Game) {}

  load(unlocked: string[], favorites: string[], active: string | null, levels: Record<string, number>) {
    this.unlocked.clear();
    for (const id of unlocked) if (this.game.content.power(id)) this.unlocked.add(id);
    this.favorites = favorites.filter((f) => this.unlocked.has(f) && this.isCastable(f));
    this.levels = { ...levels };
    this.active = active && this.unlocked.has(active) && this.isCastable(active) ? active : this.favorites[0] ?? null;
  }

  isCastable(id: string): boolean {
    const d = this.game.content.power(id);
    return !!d && d.behavior.type !== 'passive';
  }

  unlock(id: string, silent = false): boolean {
    const d = this.game.content.power(id);
    if (!d || this.unlocked.has(id)) return false;
    this.unlocked.add(id);
    if (this.isCastable(id)) {
      if (this.favorites.length < 8) this.favorites.push(id);
      if (!this.active) this.active = id;
    }
    if (!silent) {
      this.game.hud.banner(`Nouveau pouvoir : ${d.name}`, d.description, d.color, d.icon);
      this.game.audio.play('levelup');
    }
    this.game.bus.emit('power:unlocked', id);
    return true;
  }

  hasPassive(effect: PassiveEffect): boolean {
    for (const id of this.unlocked) {
      const b = this.game.content.power(id)?.behavior;
      if (b?.type === 'passive' && b.effect === effect) return true;
    }
    return false;
  }

  passiveValue(effect: PassiveEffect, fallback: number): number {
    for (const id of this.unlocked) {
      const b = this.game.content.power(id)?.behavior;
      if (b?.type === 'passive' && b.effect === effect) return b.value ?? fallback;
    }
    return fallback;
  }

  level(id: string) { return this.levels[id] ?? 1; }

  upgradeCost(id: string): number | null {
    const d = this.game.content.power(id);
    const lvl = this.level(id);
    if (!d?.upgradeCosts || lvl - 1 >= d.upgradeCosts.length) return null;
    return d.upgradeCosts[lvl - 1];
  }

  upgrade(id: string): boolean {
    const cost = this.upgradeCost(id);
    if (cost === null || !this.unlocked.has(id)) return false;
    if (this.game.mode !== 'creative') {
      if (this.game.progress.fragments < cost) return false;
      this.game.progress.fragments -= cost;
    }
    this.levels[id] = this.level(id) + 1;
    this.game.audio.play('levelup');
    return true;
  }

  cooldownProgress(id: string): number {
    const d = this.game.content.power(id);
    const left = this.cooldowns.get(id) ?? 0;
    if (!d || d.cooldown <= 0) return 1;
    return 1 - Math.max(0, left) / d.cooldown;
  }

  setActive(id: string) {
    if (this.unlocked.has(id) && this.isCastable(id)) {
      this.active = id;
      this.game.audio.play('ui');
    }
  }

  cycle(dir: 1 | -1) {
    if (this.favorites.length === 0) return;
    const i = this.active ? this.favorites.indexOf(this.active) : -1;
    this.setActive(this.favorites[(i + dir + this.favorites.length) % this.favorites.length]);
  }

  /** Computes where the player is aiming: camera ray with optional aim assist. */
  aim(range: number): { origin: THREE.Vector3; dir: THREE.Vector3; point: THREE.Vector3; target: Enemy | null } {
    const g = this.game;
    const cam = g.camera;
    const camDir = g.cameraRig.forward();
    const p = g.player;
    const origin = p.position.clone().setY(p.position.y + 1.35).add(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(0.45));
    const cos = g.settings.aimAssist ? (g.input.isTouch ? 0.955 : 0.985) : 0.9995;
    const target = g.enemies.inCone(cam.position, camDir, range + 10, cos);
    let point: THREE.Vector3;
    if (target) {
      point = target.position.clone().setY(target.position.y + target.model.center);
    } else {
      const t = g.zone.physics.raycast(cam.position.x, cam.position.y, cam.position.z, camDir.x, camDir.y, camDir.z, range + 10);
      point = cam.position.clone().addScaledVector(camDir, Math.min(t, range + 10));
    }
    const dir = point.clone().sub(origin).normalize();
    return { origin, dir, point, target };
  }

  cast(id: string | null = this.active): boolean {
    const g = this.game;
    if (!id) return false;
    const def = g.content.power(id);
    if (!def || !this.unlocked.has(id) || def.behavior.type === 'passive') return false;
    if ((this.cooldowns.get(id) ?? 0) > 0) return false;
    const cost = def.energyCost * Math.pow(0.95, this.level(id) - 1);
    if (g.mode !== 'creative' && g.player.energy < cost) {
      g.hud.toast("Pas assez d'Essence");
      g.audio.play('click', { pitch: 0.5 });
      return false;
    }
    const range = (def.behavior as any).range ?? 60;
    const a = this.aim(range);
    const ctx: CastContext = {
      game: g, def, level: this.level(id),
      power: (1 + (this.level(id) - 1) * 0.2) * g.player.buff('strength') * g.progress.damageMultiplier,
      origin: a.origin, aimDir: a.dir, aimPoint: a.point, target: a.target,
    };
    // Face the aim direction
    g.player.yaw = Math.atan2(a.dir.x, a.dir.z);
    g.player.castT = 1;
    const fn = (BEHAVIORS as any)[def.behavior.type] as BehaviorFn<any>;
    fn.call(this, ctx, def.behavior as any);
    if (g.mode !== 'creative') g.player.energy -= cost;
    this.cooldowns.set(id, def.cooldown);
    this.recentlyCast = 2;
    g.audio.play(def.sound, { volume: 0.8 });
    g.bus.emit('power:used', id);
    return true;
  }

  addEffect(e: Continuous) {
    this.effects.push(e);
  }

  update(dt: number) {
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, v - dt);
    this.recentlyCast = Math.max(0, this.recentlyCast - dt);
    this.scanTime = Math.max(0, this.scanTime - dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(dt, this.game)) {
        this.effects[i].dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  clearEffects() {
    for (const e of this.effects) e.dispose();
    this.effects.length = 0;
  }
}

// ---------------------------------------------------------------------------------------
// Behaviour implementations
// ---------------------------------------------------------------------------------------

function beamMesh(color: string, width: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(width, width, 1, 8, 1, true);
  geo.translate(0, 0.5, 0);
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  return m;
}

const BEHAVIORS: { [K in PowerBehavior['type']]: BehaviorFn<K> } = {
  projectile(ctx, b) {
    const n = b.count ?? 1;
    for (let i = 0; i < n; i++) {
      const dir = ctx.aimDir.clone();
      if (n > 1) {
        const spread = (b.spread ?? 0.1) * (i - (n - 1) / 2);
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
      }
      ctx.game.projectiles.spawn({
        owner: 'player', position: ctx.origin.clone(), velocity: dir.multiplyScalar(b.speed),
        radius: b.radius, damage: b.damage * ctx.power, color: ctx.def.color, element: ctx.def.element,
        gravity: b.gravity, explodeRadius: b.explodeRadius, homing: b.homing, target: ctx.target, range: b.range ?? 140, powerId: ctx.def.id,
      });
    }
    ctx.game.particles.emit({ count: 10, position: ctx.origin, color: ctx.def.color, speed: 2, life: 0.25, size: 0.3 });
  },

  beam(ctx, b) {
    const g = ctx.game;
    const mesh = beamMesh(ctx.def.color, b.width);
    const core = beamMesh('#ffffff', b.width * 0.35);
    g.powers.group.add(mesh, core);
    let t = 0;
    const tick = 0.1;
    let acc = 0;
    g.powers.addEffect({
      update: (dt) => {
        t += dt;
        const a = g.powers.aim(b.range);
        const origin = a.origin;
        let end = origin.clone().addScaledVector(a.dir, b.range);
        const wall = g.zone.physics.raycast(origin.x, origin.y, origin.z, a.dir.x, a.dir.y, a.dir.z, b.range);
        if (wall < b.range) end = origin.clone().addScaledVector(a.dir, wall);
        g.player.castT = 1;
        g.player.yaw = Math.atan2(a.dir.x, a.dir.z);
        const len = origin.distanceTo(end);
        for (const m of [mesh, core]) {
          m.position.copy(origin);
          m.lookAt(end);
          m.scale.set(1 + Math.sin(t * 60) * 0.25, 1 + Math.cos(t * 50) * 0.25, len);
        }
        acc += dt;
        if (acc >= tick) {
          acc -= tick;
          // Damage everything along the beam
          for (const e of g.enemies.alive) {
            const c = e.position.clone().setY(e.position.y + e.model.center);
            const rel = c.clone().sub(origin);
            const along = rel.dot(a.dir);
            if (along < 0 || along > len) continue;
            const perp = rel.clone().addScaledVector(a.dir, -along).length();
            if (perp < b.width + e.model.radius) g.enemies.damage(e, b.dps * tick * ctx.power, { element: ctx.def.element, knock: a.dir.clone().multiplyScalar(0.6), silent: true });
          }
          g.particles.emit({ count: 4, position: end, color: ctx.def.color, color2: '#ffffff', speed: 4, life: 0.25, size: 0.4 });
        }
        return t < b.duration;
      },
      dispose: () => {
        g.powers.group.remove(mesh, core);
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
        core.geometry.dispose(); (core.material as THREE.Material).dispose();
      },
    });
  },

  nova(ctx, b) {
    ctx.game.combat.nova(ctx.game.player.position.clone(), b.radius, b.damage * ctx.power, b.knockback, ctx.def.color);
  },

  dash(ctx, b) {
    const g = ctx.game;
    const p = g.player;
    const dir = ctx.aimDir.clone();
    if (!p.flying) dir.setY(0).normalize();
    const speed = b.distance / 0.25;
    let t = 0;
    const hitSet = new Set<Enemy>();
    p.invulnerable = 0.35;
    g.powers.addEffect({
      update: (dt) => {
        t += dt;
        p.body.vx = dir.x * speed; p.body.vz = dir.z * speed;
        if (p.flying) p.body.vy = dir.y * speed;
        g.particles.emit({ count: 3, position: p.position.clone().setY(p.position.y + 1), color: ctx.def.color, speed: 1, life: 0.3, size: 0.6 });
        for (const e of g.enemies.alive) {
          if (hitSet.has(e)) continue;
          if (e.position.distanceTo(p.position) < 2 + e.model.radius) {
            hitSet.add(e);
            g.enemies.damage(e, b.damage * ctx.power, { element: 'none', knock: dir.clone().multiplyScalar(10).setY(4) });
          }
        }
        if (t >= 0.25) { p.body.vx *= 0.3; p.body.vz *= 0.3; return false; }
        return true;
      },
      dispose: () => {},
    });
  },

  blink(ctx, b) {
    const g = ctx.game;
    const p = g.player;
    const dir = ctx.aimDir.clone();
    if (!p.flying) dir.setY(0).normalize();
    const from = p.position.clone().setY(p.position.y + 1);
    const hit = g.zone.physics.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, b.distance, true);
    const dist = Math.max(0, Math.min(b.distance, hit - 0.8));
    const to = from.clone().addScaledVector(dir, dist);
    g.particles.emit({ count: 40, position: from, color: ctx.def.color, speed: 3, life: 0.5, size: 0.5 });
    const ground = g.zone.physics.surfaceHeight(to.x, to.z, to.y, 0.3, 1.2);
    p.setPosition(to.x, Math.max(ground, to.y - 1), to.z);
    g.particles.emit({ count: 40, position: to, color: ctx.def.color, speed: 3, life: 0.5, size: 0.5 });
  },

  shield(ctx, b) {
    const p = ctx.game.player;
    p.shield = b.absorb * ctx.power;
    p.shieldTime = b.duration;
  },

  telekinesis(ctx, b) {
    const g = ctx.game;
    const cam = g.camera.position;
    const camDir = g.cameraRig.forward();
    const enemy = g.enemies.inCone(cam, camDir, b.range, 0.94);
    const prop = enemy ? null : g.props.nearestInCone(cam, camDir, b.range, 0.94);
    if (!enemy && !prop) {
      g.hud.toast('Aucune cible à saisir');
      return;
    }
    let t = 0;
    const hold = 0.55;
    const pos = () => (enemy ? new THREE.Vector3(enemy.body.x, enemy.body.y, enemy.body.z) : new THREE.Vector3(prop!.body.x, prop!.body.y, prop!.body.z));
    const set = (v: THREE.Vector3) => {
      const body = enemy ? enemy.body : prop!.body;
      body.x = v.x; body.y = v.y; body.z = v.z;
      body.vx = body.vy = body.vz = 0;
    };
    if (enemy) enemy.grabbed = true;
    if (prop) prop.held = true;
    const start = pos();
    g.powers.addEffect({
      update: (dt) => {
        t += dt;
        const p = g.player;
        if (enemy && !enemy.alive) return false;
        if (t < hold) {
          const lift = p.position.clone().add(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(4)).setY(p.position.y + 3.5);
          const k = t / hold;
          set(start.clone().lerp(lift, k * k * (3 - 2 * k)));
          if (Math.random() < 0.6) g.particles.emit({ count: 2, position: pos().setY(pos().y + 0.6), color: ctx.def.color, speed: 1.5, life: 0.4, size: 0.4 });
          p.castT = 1;
          return true;
        }
        // Throw towards the current aim
        const a = g.powers.aim(80);
        const v = a.point.clone().sub(pos()).normalize().multiplyScalar(b.force);
        if (enemy) {
          enemy.grabbed = false;
          enemy.body.vx = v.x; enemy.body.vy = v.y + 3; enemy.body.vz = v.z;
          enemy.body.onGround = false;
          g.enemies.damage(enemy, b.damage * ctx.power, { element: 'psychic' });
        } else if (prop) {
          prop.held = false;
          prop.body.vx = v.x; prop.body.vy = v.y + 2; prop.body.vz = v.z;
          prop.thrownDamage = b.damage * ctx.power * 1.5;
          prop.spin.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
        }
        g.audio.play('whoosh');
        return false;
      },
      dispose: () => {
        if (enemy) enemy.grabbed = false;
        if (prop) (prop as Prop).held = false;
      },
    });
  },

  gravityWell(ctx, b) {
    const g = ctx.game;
    const center = ctx.aimPoint.clone();
    const ground = g.zone.groundAt(center.x, center.z);
    center.y = Math.max(center.y, ground + 2);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), new THREE.MeshBasicMaterial({ color: '#05010c' }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14), new THREE.MeshBasicMaterial({ color: ctx.def.color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(center); halo.position.copy(center);
    g.powers.group.add(core, halo);
    let t = 0;
    g.powers.addEffect({
      update: (dt) => {
        t += dt;
        halo.scale.setScalar(1 + Math.sin(t * 10) * 0.15);
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, r = b.radius * (0.6 + Math.random() * 0.4);
          const p = center.clone().add(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 3, Math.sin(a) * r));
          g.particles.emit({ count: 1, position: p, color: ctx.def.color, speed: r * 1.6, direction: center.clone().sub(p).normalize(), spread: 0, life: 0.55, size: 0.35, drag: 0 });
        }
        for (const e of g.enemies.alive) {
          const d = e.position.distanceTo(center);
          if (d < b.radius + e.model.radius) {
            const pull = center.clone().sub(e.position).normalize().multiplyScalar(b.pull * dt * 3);
            e.body.vx += pull.x; e.body.vz += pull.z; e.body.vy += pull.y + 0.5 * dt * 20;
            e.body.onGround = false;
            g.enemies.damage(e, b.dps * dt * ctx.power, { element: 'gravity', silent: true });
          }
        }
        for (const p of g.props.props) {
          const pp = new THREE.Vector3(p.body.x, p.body.y, p.body.z);
          if (pp.distanceTo(center) < b.radius) {
            const pull = center.clone().sub(pp).normalize().multiplyScalar(b.pull * dt * 2);
            p.body.vx += pull.x; p.body.vy += pull.y + 12 * dt; p.body.vz += pull.z;
          }
        }
        return t < b.duration;
      },
      dispose: () => {
        g.combat.explosion(center, b.radius * 0.6, b.dps * ctx.power, ctx.def.color, 'gravity', 'player');
        g.powers.group.remove(core, halo);
        core.geometry.dispose(); halo.geometry.dispose();
        (core.material as THREE.Material).dispose(); (halo.material as THREE.Material).dispose();
      },
    });
  },

  timeSlow(ctx, b) {
    const g = ctx.game;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 32, 16), new THREE.MeshBasicMaterial({ color: ctx.def.color, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    g.powers.group.add(dome);
    let t = 0;
    g.powers.addEffect({
      update: (dt) => {
        t += dt;
        dome.position.copy(g.player.position);
        (dome.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 3) * 0.03;
        for (const e of g.enemies.alive) if (e.position.distanceTo(g.player.position) < b.radius) e.timeScale = b.factor;
        g.timeSlowFx = 1;
        return t < b.duration;
      },
      dispose: () => {
        g.timeSlowFx = 0;
        g.powers.group.remove(dome);
        dome.geometry.dispose(); (dome.material as THREE.Material).dispose();
      },
    });
  },

  heal(ctx, b) {
    ctx.game.player.heal(b.amount * ctx.power);
    ctx.game.particles.emit({ count: 30, position: ctx.game.player.position.clone().setY(ctx.game.player.position.y + 1), color: ctx.def.color, speed: 2, direction: new THREE.Vector3(0, 1, 0), spread: 0.5, life: 1, size: 0.4 });
  },

  buff(ctx, b) {
    ctx.game.player.buffs[b.stat] = { factor: b.factor, time: b.duration };
    ctx.game.hud.toast(`${ctx.def.name} actif (${b.duration} s)`);
  },

  scan(ctx, b) {
    const g = ctx.game;
    g.powers.scanTime = b.duration;
    g.combat.ring(g.player.position.clone().setY(g.player.position.y + 0.5), Math.min(b.radius, 60), ctx.def.color, 1.2);
    const n = g.enemies.alive.filter((e) => e.position.distanceTo(g.player.position) < b.radius).length;
    g.hud.toast(n > 0 ? `Perception : ${n} créature(s) du Néant à proximité` : 'Perception : aucune présence hostile');
  },

  passive() {
    /* passives are queried, never cast */
  },
};
