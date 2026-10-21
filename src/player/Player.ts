import * as THREE from 'three';
import type { Body } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import { Humanoid } from './Humanoid';
import { CharacterModel, type Avatar, type BodyKind } from './CharacterModel';
import type { Assets } from '../core/Assets';
import { angleLerp, clamp, damp } from '../core/noise';
import type { SkinDef } from '../content/types';

export const STAGE_ENERGY = [0, 100, 160, 240, 340, 500];
export const STAGE_HEALTH = [100, 130, 180, 250, 350, 500];

/**
 * Player character controller: walking, running, (super) jumping, free flight and
 * zero-gravity floating. Health, Essence energy, buffs and shields live here too.
 */
export class Player {
  readonly body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0.33, height: 1.75, onGround: false, stepHeight: 0.45 };
  /** Stable scene node; the avatar inside can be swapped when the outfit changes body type. */
  readonly root = new THREE.Group();
  model: Avatar;
  private bodyKind: BodyKind | 'procedural' = 'procedural';
  yaw = 0;
  health = 100;
  energy = 0;
  flying = false;
  /** Breathable air reserve in vacuum (0-100). */
  oxygen = 100;
  shield = 0;
  shieldTime = 0;
  invulnerable = 0;
  punchT = 0;
  castT = 0;
  lastDamageAt = -100;
  /** Active temporary buffs: stat -> {factor, time}. */
  buffs: Record<string, { factor: number; time: number }> = {};
  private stepTimer = 0;
  private wasOnGround = true;
  private minVy = 0;
  private lastYaw = 0;
  private aura = 0;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private shieldMesh: THREE.Mesh;
  private time = 0;

  constructor(skin: SkinDef, private assets: Assets | null = null, private baseBody: BodyKind = 'human_male') {
    this.model = this.makeAvatar(skin);
    this.root.add(this.model.root);
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#88aaff', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shieldMesh.position.y = 0.95;
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);
  }

  /** Real rigged character when assets are loaded, procedural figure otherwise. */
  private makeAvatar(skin: SkinDef): Avatar {
    const kind: BodyKind = skin.model === 'suit' ? 'suit_body' : this.baseBody;
    let a: Avatar;
    if (CharacterModel.available(this.assets, kind)) {
      a = new CharacterModel(this.assets!, kind);
      this.bodyKind = kind;
    } else {
      a = new Humanoid({ skin: skin.skin, suit: skin.suit, accent: skin.accent, hair: skin.hair, aura: skin.aura });
      this.bodyKind = 'procedural';
    }
    a.setColors({ skin: skin.skin, suit: skin.suit, accent: skin.accent, hair: skin.hair, aura: skin.aura });
    return a;
  }

  get maxHealth() { return STAGE_HEALTH[this.stageRef()]; }
  get maxEnergy() { return STAGE_ENERGY[this.stageRef()]; }
  stageRef: () => number = () => 0;

  setSkin(s: SkinDef) {
    const want: BodyKind = s.model === 'suit' ? 'suit_body' : this.baseBody;
    if (this.bodyKind !== 'procedural' && want !== this.bodyKind) {
      this.root.remove(this.model.root);
      this.model = this.makeAvatar(s);
      this.root.add(this.model.root);
    }
    this.model.setColors({ skin: s.skin, suit: s.suit, accent: s.accent, hair: s.hair, aura: s.aura });
    (this.shieldMesh.material as THREE.MeshBasicMaterial).color.set(s.aura);
  }

  setPosition(x: number, y: number, z: number) {
    this.body.x = x; this.body.y = y; this.body.z = z;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.position.set(x, y, z);
  }

  buff(stat: string): number {
    return this.buffs[stat]?.factor ?? 1;
  }

  heal(n: number) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  /** Returns damage actually taken. */
  damage(amount: number, game: Game, from?: THREE.Vector3): number {
    if (this.invulnerable > 0 || game.mode === 'creative') return 0;
    amount /= this.buff('defense');
    if (game.powers.hasPassive('toughness')) amount *= 0.7;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
      game.particles.emit({ count: 10, position: this.position.clone().setY(this.position.y + 1), color: '#88aaff', speed: 4, life: 0.4, size: 0.3 });
      if (amount <= 0) return 0;
    }
    this.health -= amount;
    this.lastDamageAt = game.elapsed;
    game.audio.play('hurt', { volume: 0.7 });
    game.hud.flashDamage(Math.min(1, amount / 30));
    if (from) {
      const push = this.position.clone().sub(from).setY(0).normalize().multiplyScalar(4);
      this.body.vx += push.x; this.body.vz += push.z;
    }
    if (this.health <= 0) {
      this.health = 0;
      game.onPlayerDeath();
    }
    return amount;
  }

  update(dt: number, game: Game) {
    this.time += dt;
    const input = game.input;
    const zone = game.zone;
    const b = this.body;
    const powers = game.powers;
    const camYaw = game.cameraRig.yaw;
    const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    const right = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw));
    const move = fwd.clone().multiplyScalar(input.moveY).addScaledVector(right, input.moveX);
    const moveMag = Math.min(1, move.length());
    const zeroG = !!zone.zeroG;
    const canFly = powers.hasPassive('flight') || game.mode === 'creative' || zeroG;
    const superJump = powers.hasPassive('superJump') || game.mode === 'creative';
    const gravity = zone.gravity;

    // Buff timers
    for (const k of Object.keys(this.buffs)) {
      this.buffs[k].time -= dt;
      if (this.buffs[k].time <= 0) delete this.buffs[k];
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.punchT = Math.max(0, this.punchT - dt * 3.5);
    this.castT = Math.max(0, this.castT - dt * 2.5);
    if (this.shieldTime > 0) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shield = 0;
    }

    // Enter / leave flight
    const jumpPressed = input.consume('jump');
    const doubleJump = input.consume('doubleJump');
    if (canFly) {
      if (!this.flying && ((jumpPressed && !b.onGround) || (doubleJump && b.onGround))) {
        this.flying = true;
        b.vy = Math.max(b.vy, 2);
        game.audio.play('whoosh', { volume: 0.6 });
        game.bus.emit('player:fly');
      } else if (this.flying && doubleJump) {
        this.flying = false;
      }
    } else this.flying = false;
    // Weightlessness: always floating, never "landing".
    if (zeroG) this.flying = true;

    const speedBuff = this.buff('speed');
    if (this.flying) {
      // Free flight along the camera direction (including pitch).
      const pitch = game.cameraRig.pitch;
      const look = new THREE.Vector3(Math.sin(camYaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(camYaw) * Math.cos(pitch));
      const dir = look.multiplyScalar(input.moveY).addScaledVector(right, input.moveX);
      const stage = game.progress.stage;
      let flySpeed = 14 + stage * 4;
      if (input.run) {
        flySpeed = 45 + stage * 25;
        if (b.y > 120 && stage >= 3) flySpeed = 160 + stage * 40;
      }
      if (game.mode === 'creative' && input.run) flySpeed = Math.max(flySpeed, 220);
      if (zeroG && zone.floatSpeed) flySpeed = Math.min(flySpeed, zone.floatSpeed * (input.run ? 2.5 : 1));
      flySpeed *= speedBuff;
      const vert = (input.jumpHeld ? 1 : 0) - (input.descendHeld ? 1 : 0);
      const target = dir.multiplyScalar(flySpeed);
      target.y += vert * (10 + stage * 3) * (input.run ? 2 : 1);
      const k = damp(input.run ? 2.2 : 4, dt);
      b.vx += (target.x - b.vx) * k;
      b.vy += (target.y - b.vy) * k;
      b.vz += (target.z - b.vz) * k;
      // Hover bob compensation: no gravity in flight
      if (moveMag > 0.1) {
        const hv = Math.hypot(b.vx, b.vz);
        if (hv > 0.5) this.yaw = angleLerp(this.yaw, Math.atan2(b.vx, b.vz), damp(6, dt));
      } else this.yaw = angleLerp(this.yaw, camYaw, damp(3, dt));
      if (input.run && moveMag > 0.5 && game.mode !== 'creative') this.energy = Math.max(0, this.energy - dt * 2);
    } else {
      // Ground / air movement
      const run = input.run || moveMag > 0.92;
      let speed = (run ? 7 : 3.4) * speedBuff;
      if (superJump && run) speed *= 1.25;
      if (game.mode === 'creative') speed *= 1.3;
      const target = move.clone().normalize().multiplyScalar(speed * moveMag);
      const control = b.onGround ? damp(14, dt) : damp(3, dt);
      b.vx += (target.x - b.vx) * control;
      b.vz += (target.z - b.vz) * control;
      if (moveMag > 0.05) this.yaw = angleLerp(this.yaw, Math.atan2(move.x, move.z), damp(12, dt));
      if (jumpPressed && b.onGround) {
        const jv = 5.2 * (superJump ? 2.4 : 1) * Math.sqrt(gravity / 9.81);
        b.vy = jv;
        b.onGround = false;
        game.audio.play(superJump ? 'whoosh' : 'step', { volume: superJump ? 0.5 : 0.3 });
        if (superJump) {
          game.bus.emit('power:used', 'super_jump');
          game.particles.emit({ count: 14, position: this.position.clone(), color: '#d8d0c0', speed: 3, spread: 1, direction: new THREE.Vector3(0, 0.2, 0), life: 0.6, size: 0.5, drag: 3 });
        }
      }
      b.vy -= gravity * dt;
      if (b.vy < -55) b.vy = -55;
    }

    zone.physics.move(b, dt);

    // Snap down small drops while walking (stairs, sidewalks)
    if (!this.flying && this.wasOnGround && !b.onGround && b.vy <= 0) {
      const floor = zone.physics.surfaceHeight(b.x, b.z, b.y, b.radius, b.stepHeight);
      if (b.y - floor < 0.5) { b.y = floor; b.vy = 0; b.onGround = true; }
    }
    if (this.flying && !zeroG && b.onGround && b.vy <= 0.1 && !input.jumpHeld) {
      // Touching down ends flight
      this.flying = false;
      game.audio.play('land', { volume: 0.4 });
    }

    // Landing
    if (!this.wasOnGround && b.onGround) {
      const impact = -this.minVy;
      if (impact > 6) {
        game.audio.play('land', { volume: Math.min(1, impact / 20) });
        if (impact > 12) game.particles.emit({ count: Math.min(40, impact * 1.5), position: this.position.clone().setY(b.y + 0.1), color: '#cfc6b8', speed: impact * 0.3, spread: 1, direction: new THREE.Vector3(0, 0.3, 0), life: 0.7, size: 0.6, drag: 3 });
        if (impact > 18) game.cameraRig.shake(Math.min(0.5, impact / 60));
      }
      if (impact > 15 && !superJump && !this.flying) this.damage((impact - 15) * 5, game);
      this.minVy = 0;
    }
    if (!b.onGround) this.minVy = Math.min(this.minVy, b.vy);
    this.wasOnGround = b.onGround;

    // World bounds
    const lim = zone.id === 'orbit' ? 5200 : 2300;
    b.x = clamp(b.x, -lim, lim);
    b.z = clamp(b.z, -lim, lim);

    this.position.set(b.x, b.y, b.z);
    this.velocity.set(b.vx, b.vy, b.vz);

    // Footsteps
    const hSpeed = Math.hypot(b.vx, b.vz);
    if (b.onGround && hSpeed > 1) {
      this.stepTimer -= dt * hSpeed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 1.6;
        game.audio.play('step', { volume: 0.25 + Math.min(0.3, hSpeed / 30), pitch: 0.8 + Math.random() * 0.4 });
      }
    }

    // Regeneration of health and energy
    const sinceHit = game.elapsed - this.lastDamageAt;
    const regen = powers.hasPassive('regeneration') ? powers.passiveValue('regeneration', 4) : 0.6;
    if (sinceHit > (powers.hasPassive('regeneration') ? 3 : 8)) this.heal(regen * dt);
    if (this.maxEnergy > 0) this.energy = Math.min(this.maxEnergy, this.energy + (5 + game.progress.stage * 2.5) * dt);
    if (game.mode === 'creative') { this.energy = this.maxEnergy; this.health = this.maxHealth; }

    // Model & animation
    const turn = (this.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    this.lastYaw = this.yaw;
    this.model.turnRate = clamp(turn, -4, 4);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    const flyFwd = this.flying ? clamp(Math.hypot(b.vx, b.vz, b.vy * 0.5) / 12, 0, 1) : 0;
    this.model.update(dt, { speed: hSpeed, grounded: b.onGround, flying: this.flying, vy: b.vy, flyForward: flyFwd, cast: this.castT, punch: this.punchT });
    // Aura when awakened
    const stage = game.progress.stage;
    const targetAura = stage >= 1 ? (this.flying ? 1 : 0.35) + this.castT : 0;
    this.aura += (targetAura - this.aura) * damp(4, dt);
    this.model.setGlow(stage >= 1 ? 1.5 + this.aura * 2 : 0);
    if (stage >= 1 && this.aura > 0.2 && Math.random() < this.aura * dt * 30 * (game.quality.particleBudget > 1000 ? 1 : 0.4)) {
      const skin = game.currentSkin();
      game.particles.emit({ count: 1, position: this.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6)), color: skin.aura, speed: 0.6, direction: new THREE.Vector3(0, 1, 0), spread: 0.5, life: 0.8, size: 0.25, drag: 1 });
    }
    if (this.flying && hSpeed > 30) {
      game.particles.emit({ count: 1, position: this.position.clone().setY(this.position.y + 0.9), color: game.currentSkin().aura, speed: 0.2, life: 0.5, size: 0.6, sizeEnd: 0.1 });
    }
    // Shield bubble
    this.shieldMesh.visible = this.shield > 0;
    if (this.shield > 0) {
      const m = this.shieldMesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.18 + Math.sin(this.time * 8) * 0.06;
    }
  }
}
