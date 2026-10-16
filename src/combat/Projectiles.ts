import * as THREE from 'three';
import type { Game } from '../Game';
import type { Element } from '../content/types';
import type { Enemy } from './Enemies';

export interface ProjectileSpec {
  owner: 'player' | 'enemy';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  damage: number;
  color: string;
  element: Element;
  gravity?: number;
  explodeRadius?: number;
  homing?: number;
  target?: Enemy | null;
  range?: number;
  powerId?: string;
}

interface Projectile extends ProjectileSpec {
  mesh: THREE.Mesh;
  traveled: number;
  alive: boolean;
  trailTimer: number;
}

const ELEMENT_TRAIL: Partial<Record<Element, string>> = { fire: '#ffb347', ice: '#e8fbff', lightning: '#ffffff', plasma: '#ffb3f5', gravity: '#b99cff' };

/** Pooled projectiles shared by the player's powers and enemy attacks. */
export class Projectiles {
  readonly group = new THREE.Group();
  private list: Projectile[] = [];
  private geo = new THREE.SphereGeometry(1, 12, 8);

  spawn(s: ProjectileSpec) {
    let p = this.list.find((x) => !x.alive);
    if (!p) {
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      p = { ...s, mesh, traveled: 0, alive: true, trailTimer: 0 };
      this.list.push(p);
      this.group.add(mesh);
    }
    Object.assign(p, s, { traveled: 0, alive: true, trailTimer: 0 });
    p.position = s.position.clone();
    p.velocity = s.velocity.clone();
    (p.mesh.material as THREE.MeshBasicMaterial).color.set(s.color);
    p.mesh.scale.setScalar(Math.max(0.12, s.radius));
    p.mesh.position.copy(p.position);
    p.mesh.visible = true;
  }

  update(dt: number, game: Game) {
    const step = new THREE.Vector3();
    for (const p of this.list) {
      if (!p.alive) continue;
      if (p.homing && p.target && p.target.alive) {
        const want = p.target.position.clone().setY(p.target.position.y + p.target.model.center).sub(p.position).normalize().multiplyScalar(p.velocity.length());
        p.velocity.lerp(want, Math.min(1, p.homing * dt));
      }
      if (p.gravity) p.velocity.y -= p.gravity * dt;
      step.copy(p.velocity).multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len || 1);
      // World collision along the segment
      const wallT = game.zone.physics.raycast(p.position.x, p.position.y, p.position.z, dir.x, dir.y, dir.z, len);
      // Target collision
      let hitEnemy: Enemy | null = null;
      let hitPlayer = false;
      const next = p.position.clone().add(step);
      if (p.owner === 'player') {
        hitEnemy = game.enemies.hitSegment(p.position, next, p.radius + 0.25);
      } else {
        const pc = game.player.position.clone().setY(game.player.position.y + 1);
        if (distToSegment(pc, p.position, next) < p.radius + 0.5) hitPlayer = true;
      }
      if (hitEnemy || hitPlayer || wallT <= len) {
        const at = wallT <= len && !hitEnemy && !hitPlayer ? p.position.clone().addScaledVector(dir, wallT) : next;
        this.impact(p, at, hitEnemy, hitPlayer, game);
        continue;
      }
      p.position.copy(next);
      p.traveled += len;
      p.mesh.position.copy(p.position);
      if (p.traveled > (p.range ?? 120)) { p.alive = false; p.mesh.visible = false; continue; }
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.02;
        game.particles.emit({ count: 1, position: p.position, color: ELEMENT_TRAIL[p.element] ?? p.color, color2: p.color, speed: 0.4, life: 0.35, size: p.radius * 2.2, sizeEnd: 0.05 });
      }
    }
  }

  private impact(p: Projectile, at: THREE.Vector3, enemy: Enemy | null, player: boolean, game: Game) {
    p.alive = false;
    p.mesh.visible = false;
    const knock = p.velocity.clone().normalize().multiplyScalar(4);
    if (p.explodeRadius) {
      game.combat.explosion(at, p.explodeRadius, p.damage, p.color, p.element, p.owner);
    } else if (enemy) {
      game.enemies.damage(enemy, p.damage, { element: p.element, knock, source: p.powerId });
      game.particles.emit({ count: 12, position: at, color: p.color, speed: 5, life: 0.35, size: 0.35 });
    } else if (player) {
      game.player.damage(p.damage, game, p.position);
      game.particles.emit({ count: 10, position: at, color: p.color, speed: 4, life: 0.35, size: 0.3 });
    } else {
      game.particles.emit({ count: 8, position: at, color: p.color, speed: 3, life: 0.3, size: 0.3 });
    }
  }

  clear() {
    for (const p of this.list) { p.alive = false; p.mesh.visible = false; }
  }
}

export function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
