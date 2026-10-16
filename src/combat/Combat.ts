import * as THREE from 'three';
import type { Game } from '../Game';
import type { Element } from '../content/types';

/** Shared combat effects: explosions, shock rings, melee strikes. */
export class Combat {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; t: number; dur: number; radius: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  constructor(private game: Game) {}

  ring(at: THREE.Vector3, radius: number, color: string, dur = 0.45) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at);
    this.group.add(m);
    this.rings.push({ mesh: m, t: 0, dur, radius });
  }

  explosion(at: THREE.Vector3, radius: number, damage: number, color: string, element: Element, owner: 'player' | 'enemy') {
    const g = this.game;
    g.particles.emit({ count: 60, position: at, color: '#ffffff', color2: color, speed: radius * 2.5, life: 0.6, size: 0.9, drag: 3 });
    g.particles.emit({ count: 30, position: at, color, color2: '#202020', speed: radius, life: 1.2, size: 1.4, sizeEnd: 2.5, drag: 2, gravity: -1 });
    this.ring(at.clone().setY(at.y + 0.1), radius, color);
    g.audio.play('boom', { position: at, volume: 0.9 });
    const camDist = g.camera.position.distanceTo(at);
    g.cameraRig.shake(Math.max(0, 0.5 - camDist / 60));
    if (owner === 'player') {
      for (const e of g.enemies.alive) {
        const d = e.position.clone().setY(e.position.y + e.model.center).distanceTo(at);
        if (d < radius + e.model.radius) {
          const fall = 1 - Math.min(1, d / (radius + e.model.radius)) * 0.5;
          const knock = e.position.clone().sub(at).setY(0).normalize().multiplyScalar(6 * fall).setY(4 * fall);
          g.enemies.damage(e, damage * fall, { element, knock });
        }
      }
      this.pushProps(at, radius, 10);
    } else if (g.player.position.distanceTo(at) < radius + 0.5) {
      g.player.damage(damage, g, at);
    }
  }

  /** Radial blast centred on the player. */
  nova(at: THREE.Vector3, radius: number, damage: number, knockback: number, color: string) {
    const g = this.game;
    this.ring(at.clone().setY(at.y + 0.2), radius, color, 0.5);
    g.particles.emit({ count: Math.min(160, 40 + radius * 6), position: at.clone().setY(at.y + 1), color, color2: '#ffffff', speed: radius * 3, spread: 1, direction: new THREE.Vector3(0, 0.1, 0), life: 0.5, size: 0.6, drag: 4 });
    g.cameraRig.shake(Math.min(0.6, radius / 30));
    for (const e of g.enemies.alive) {
      const d = e.position.distanceTo(at);
      if (d < radius + e.model.radius) {
        const fall = 1 - Math.min(1, d / radius) * 0.4;
        const dir = e.position.clone().sub(at).setY(0).normalize();
        g.enemies.damage(e, damage * fall, { element: 'psychic', knock: dir.multiplyScalar(knockback * fall).setY(knockback * 0.35 * fall) });
      }
    }
    this.pushProps(at, radius, knockback);
  }

  private pushProps(at: THREE.Vector3, radius: number, force: number) {
    for (const p of this.game.props.props) {
      const dx = p.body.x - at.x, dz = p.body.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d < radius && d > 0.01) {
        const k = (1 - d / radius) * force / p.mass;
        p.body.vx += (dx / d) * k;
        p.body.vz += (dz / d) * k;
        p.body.vy += k * 0.5;
        p.spin.set((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
      }
    }
  }

  /** Close-range strike in front of the player. */
  punch() {
    const g = this.game;
    const p = g.player;
    p.punchT = 1;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const stage = g.progress.stage;
    const dmg = (stage >= 1 ? 22 + stage * 12 : 6) * p.buff('strength') * g.progress.damageMultiplier;
    const reach = 2.0 + (stage >= 1 ? 0.4 : 0);
    let hit = false;
    for (const e of g.enemies.alive) {
      const rel = e.position.clone().sub(p.position);
      const d = Math.hypot(rel.x, rel.z);
      if (d > reach + e.model.radius || Math.abs(rel.y) > 2.5 + e.model.center) continue;
      if (rel.setY(0).normalize().dot(fwd) < 0.3) continue;
      const knock = fwd.clone().multiplyScalar(stage >= 1 ? 9 : 2).setY(stage >= 1 ? 3 : 0);
      g.enemies.damage(e, dmg, { element: 'none', knock });
      hit = true;
    }
    for (const pr of g.props.props) {
      const rel = new THREE.Vector3(pr.body.x, pr.body.y, pr.body.z).sub(p.position);
      if (rel.length() < reach + 0.5 && rel.setY(0).normalize().dot(fwd) > 0.3) {
        const k = (stage >= 1 ? 14 : 4) / pr.mass;
        pr.body.vx += fwd.x * k; pr.body.vz += fwd.z * k; pr.body.vy += k * 0.4;
        pr.thrownDamage = stage >= 1 ? 30 : 0;
        hit = true;
      }
    }
    g.audio.play(hit ? 'hit' : 'whoosh', { volume: hit ? 0.8 : 0.3, pitch: hit ? 1 : 1.6 });
    if (hit && stage >= 1) {
      g.particles.emit({ count: 14, position: p.position.clone().add(fwd.clone().multiplyScalar(1.2)).setY(p.position.y + 1.2), color: g.currentSkin().aura, speed: 6, life: 0.3, size: 0.35 });
      g.cameraRig.shake(0.12);
    }
  }

  update(dt: number) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      r.mesh.scale.setScalar(0.3 + k * r.radius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
