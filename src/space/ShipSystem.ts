import * as THREE from 'three';
import type { Game } from '../Game';
import type { ShipDef } from '../content/types';
import type { Interactable } from '../world/Zone';
import { currentAssets } from '../world/build';
import { angleLerp, clamp, damp } from '../core/noise';

/** Default parking spots per zone (used when the ship was not left in that zone). */
export const SHIP_PADS: Record<string, { x: number; z: number; y?: number; yaw: number }> = {
  earth: { x: -150, z: 110, yaw: Math.PI / 2 },
  orbit: { x: 70, y: -6, z: 40, yaw: -Math.PI / 2 },
  moon: { x: 18, z: 26, yaw: 0.6 },
};

export interface SavedShips {
  owned: string[];
  current: string | null;
  parked: { zone: string; position: [number, number, number]; yaw: number; hull: number } | null;
  piloting: boolean;
}

/**
 * The player's spaceships: ownership, boarding, piloting (arcade 6-DoF flight that follows the
 * camera), landing, weapons and hull. The current ship is always reachable: it waits where it
 * was left in a zone, otherwise on that zone's pad (the Observatory, the station hangar, the
 * lunar landing site).
 */
export class ShipSystem {
  owned: string[] = [];
  currentId: string | null = null;
  piloting = false;
  hull = 1;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  private roll = 0;
  private object: THREE.Group | null = null;
  private objectFor: string | null = null;
  private engineMats: THREE.MeshStandardMaterial[] = [];
  private parked: SavedShips['parked'] = null;
  private fireCd = 0;
  private gun = 0;
  private throttle = 0;
  /** Set while the ship travels between zones (warp / atmosphere), to keep it under the player. */
  private carry = false;
  readonly interactables: Interactable[];

  constructor(private game: Game) {
    this.interactables = [{
      id: 'ship',
      position: this.position,
      radius: 9,
      icon: '🚀',
      label: () => (this.available && !this.piloting ? `Monter à bord — ${this.def!.name}` : null),
      use: (g) => this.board(g),
    }];
  }

  get def(): ShipDef | null { return this.currentId ? this.game.content.ships.get(this.currentId) ?? null : null; }
  get active() { return this.piloting; }
  /** Is a ship parked in the current zone? */
  get available() { return !!this.object && this.object.visible; }
  get speed() { return this.velocity.length(); }

  load(s: SavedShips) {
    this.owned = s.owned.filter((id) => this.game.content.ships.has(id));
    this.currentId = s.current && this.owned.includes(s.current) ? s.current : this.owned[0] ?? null;
    this.parked = s.parked;
    this.hull = s.parked?.hull ?? 1;
    this.piloting = false;
    this.carry = s.piloting;
  }

  save(): SavedShips {
    const here = this.object?.visible ? { zone: this.game.zone.id, position: this.position.toArray() as [number, number, number], yaw: this.yaw, hull: this.hull } : this.parked;
    return { owned: [...this.owned], current: this.currentId, parked: here ? { ...here, hull: this.hull } : null, piloting: this.piloting };
  }

  grant(id: string) {
    if (!this.game.content.ships.has(id) || this.owned.includes(id)) return;
    this.owned.push(id);
    const d = this.game.content.ships.get(id)!;
    this.game.hud.banner('NOUVEAU VAISSEAU', d.name, '#7fd8ff', '🚀');
    if (!this.currentId) { this.currentId = id; this.placeInZone(); }
  }

  cycleShip() {
    if (this.owned.length < 2 || this.piloting) return;
    const i = this.owned.indexOf(this.currentId ?? '');
    this.currentId = this.owned[(i + 1) % this.owned.length];
    this.hull = 1;
    this.objectFor = null;
    this.placeInZone(true);
    this.game.hud.toast(`Vaisseau prêt au hangar : ${this.def!.name}`);
  }

  repairCurrent() { this.hull = 1; }

  // ------------------------------------------------------------------ scene
  private buildObject(): THREE.Group | null {
    const d = this.def;
    if (!d) return null;
    const g = new THREE.Group();
    g.name = 'player-ship';
    this.engineMats = [];
    const src = currentAssets()?.model(`ship_${d.model}`);
    if (src) {
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name === 'engine_glow') {
          const c = mat.clone();
          c.userData.shared = false;
          m.material = c;
          this.engineMats.push(c);
        }
      });
      g.add(src);
    } else {
      // Fallback silhouette when models are unavailable.
      const hull = new THREE.Mesh(new THREE.ConeGeometry(2, 9, 8), new THREE.MeshStandardMaterial({ color: d.color, metalness: 0.5, roughness: 0.4 }));
      hull.rotation.x = Math.PI / 2;
      g.add(hull);
    }
    const box = new THREE.Box3().setFromObject(g);
    g.userData.length = box.getSize(new THREE.Vector3()).z;
    g.userData.gear = -box.min.y;
    return g;
  }

  /** Puts the current ship in the current zone (where it was left, or on the pad). */
  placeInZone(forcePad = false) {
    const g = this.game;
    if (this.object) { g.scene.remove(this.object); this.object = null; }
    if (!this.currentId) return;
    if (this.objectFor !== this.currentId || !this.object) {
      this.object = this.buildObject();
      this.objectFor = this.currentId;
    }
    if (!this.object) return;
    g.scene.add(this.object);
    const zone = g.zone.id;
    if (this.carry) {
      // Arrived together with the player: keep flying.
      this.carry = false;
      this.position.copy(g.player.position);
      this.piloting = true;
      g.player.root.visible = false;
    } else if (!forcePad && this.parked && this.parked.zone === zone) {
      this.position.fromArray(this.parked.position);
      this.yaw = this.parked.yaw;
    } else {
      const pad = SHIP_PADS[zone];
      if (!pad) { this.object.visible = false; return; }
      const y = pad.y ?? g.zone.groundAt(pad.x, pad.z) + (this.object.userData.gear ?? 1.2);
      this.position.set(pad.x, y, pad.z);
      this.yaw = pad.yaw;
    }
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.object.visible = true;
    this.sync(0);
  }

  /** Called before a zone change: whether the ship travels with the player. */
  prepareTravel(withPlayer: boolean) {
    if (this.object?.visible && !withPlayer) {
      this.parked = { zone: this.game.zone.id, position: this.position.toArray() as [number, number, number], yaw: this.yaw, hull: this.hull };
    }
    this.carry = withPlayer && this.piloting;
    if (this.object) { this.game.scene.remove(this.object); }
    this.object = null;
    this.objectFor = null;
  }

  // ------------------------------------------------------------------ boarding
  board(g: Game) {
    if (!this.def || this.piloting) return;
    this.piloting = true;
    g.player.flying = false;
    g.player.root.visible = false;
    g.cameraRig.snapBehind(this.yaw);
    g.audio.play('whoosh', { volume: 0.7, pitch: 0.6 });
    g.hud.toast(`${this.def.name} — joystick : poussée · regard : direction · ⇧/⇩ : monter/descendre`);
    g.bus.emit('ship:board', this.currentId);
  }

  disembark(g: Game) {
    if (!this.piloting) return;
    if (this.speed > 9) { g.hud.toast('Ralentis pour débarquer'); return; }
    this.piloting = false;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(5);
    const p = this.position.clone().add(side);
    const ground = g.zone.groundAt(p.x, p.z);
    const gravityZone = g.zone.gravity > 0.5;
    if (gravityZone) p.y = Math.max(ground + 0.2, Math.min(p.y, ground + 2));
    g.player.setPosition(p.x, p.y, p.z);
    g.player.flying = !gravityZone || (g.player.position.y - ground > 3 && g.powers.hasPassive('flight'));
    g.player.root.visible = true;
    g.player.yaw = this.yaw;
    g.cameraRig.snapBehind(this.yaw);
    g.audio.play('land', { volume: 0.4 });
  }

  // ------------------------------------------------------------------ flight
  update(dt: number, g: Game) {
    if (!this.object) return;
    const d = this.def;
    if (!this.piloting || !d) { this.sync(dt); return; }
    const input = g.input;
    const zone = g.zone;
    const atmosphere = zone.hasAtmosphere;
    const ground = zone.groundAt(this.position.x, this.position.z);
    const altitude = this.position.y - ground;
    // Speed envelope: slow near the ground, full speed in space.
    const env = zone.gravity > 0.5 ? (atmosphere ? 0.12 + 0.3 * clamp(altitude / 400, 0, 1) : 0.15 + 0.35 * clamp(altitude / 300, 0, 1)) : 1;
    const boost = input.run ? d.boost : 1;
    const maxSpeed = d.maxSpeed * env * boost;

    // Orientation follows the camera.
    const camYaw = g.cameraRig.yaw;
    const camPitch = g.cameraRig.pitch - 0.18;
    const prevYaw = this.yaw;
    const turn = damp(d.turnRate * 1.4, dt);
    this.yaw = angleLerp(this.yaw, camYaw, turn);
    this.pitch += (clamp(camPitch, -1.2, 1.2) - this.pitch) * turn;
    const dyaw = this.yaw - prevYaw;
    const yawRate = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) / Math.max(dt, 1e-3);
    this.roll += (clamp(-yawRate * 0.35, -0.7, 0.7) - this.roll) * damp(4, dt);

    const fwd = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.throttle += (input.moveY - this.throttle) * damp(3, dt);
    const target = fwd.multiplyScalar(this.throttle * maxSpeed).addScaledVector(right, input.moveX * maxSpeed * 0.35);
    const vert = (input.jumpHeld ? 1 : 0) - (input.descendHeld ? 1 : 0);
    target.y += vert * Math.max(12, maxSpeed * 0.4);
    const a = damp(d.accel / Math.max(40, d.maxSpeed) * 2.2, dt);
    this.velocity.lerp(target, a);
    // Gravity pulls a hovering ship down only when it is idle and close to the ground.
    if (zone.gravity > 0.5 && Math.abs(this.throttle) < 0.05 && vert === 0 && altitude < 30) this.velocity.y -= zone.gravity * 0.3 * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Ground contact (landing gear).
    const gear = this.object.userData.gear ?? 1.2;
    const floor = zone.groundAt(this.position.x, this.position.z) + gear;
    if (this.position.y < floor) {
      if (this.velocity.y < -25) this.damage(Math.min(0.5, (-this.velocity.y - 25) / 60), g);
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.velocity.x *= 1 - damp(3, dt);
      this.velocity.z *= 1 - damp(3, dt);
      this.pitch *= 1 - damp(4, dt);
    }
    // World limits of the detailed zones.
    const lim = zone.id === 'orbit' ? 5200 : 2300;
    this.position.x = clamp(this.position.x, -lim, lim);
    this.position.z = clamp(this.position.z, -lim, lim);

    // Weapons: twin plasma cannons on the power button.
    this.fireCd -= dt;
    if (input.consume('power') && this.fireCd <= 0) {
      this.fireCd = 1 / d.weaponRate;
      this.gun = 1 - this.gun;
      const aim = g.cameraRig.forward();
      const muzzle = this.position.clone().addScaledVector(right, (this.gun ? 1 : -1) * 2.2).addScaledVector(aim, (this.object.userData.length ?? 10) * 0.5);
      g.projectiles.spawn({ owner: 'player', position: muzzle, velocity: aim.clone().multiplyScalar(260).add(this.velocity), radius: 0.35, damage: d.weaponDamage, color: d.accent, element: 'plasma', range: 900 });
      g.audio.play('zap', { volume: 0.4, pitch: 1.4 });
    }

    // The pilot rides along.
    g.player.setPosition(this.position.x, this.position.y, this.position.z);
    g.player.velocity.copy(this.velocity);
    g.player.root.visible = false;
    this.sync(dt);
  }

  damage(fraction: number, g: Game) {
    if (g.mode === 'creative') return;
    this.hull = Math.max(0, this.hull - fraction);
    g.cameraRig.shake(0.3);
    g.audio.play('hurt', { volume: 0.5, pitch: 0.6 });
    if (this.hull <= 0) {
      g.hud.banner('VAISSEAU HORS SERVICE', 'Retour automatique au hangar pour réparation', '#ff4d6d', '⚠');
      this.disembarkForced(g);
      this.hull = 1;
      this.placeInZone(true);
    }
  }

  private disembarkForced(g: Game) {
    this.velocity.set(0, 0, 0);
    this.disembark(g);
  }

  private sync(dt: number) {
    const o = this.object;
    if (!o) return;
    o.position.copy(this.position);
    o.rotation.set(0, 0, 0);
    o.rotateY(this.yaw);
    o.rotateX(this.pitch);
    o.rotateZ(this.roll);
    const glow = this.piloting ? 1.5 + Math.abs(this.throttle) * 6 + (this.game.input.run ? 4 : 0) : 0.3;
    for (const m of this.engineMats) m.emissiveIntensity += (glow - m.emissiveIntensity) * Math.min(1, dt * 6 + (dt === 0 ? 1 : 0));
  }

  /** Camera distance for the chase camera. */
  get chaseDistance() { return Math.max(12, (this.object?.userData.length ?? 10) * 1.5); }
}
