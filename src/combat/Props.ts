import * as THREE from 'three';
import type { Body } from '../physics/CollisionWorld';
import type { Game } from '../Game';
import { boxGeo, mat } from '../world/build';

export interface Prop {
  mesh: THREE.Object3D;
  body: Body;
  mass: number;
  /** Set while thrown: damages enemies on contact. */
  thrownDamage: number;
  held: boolean;
  spin: THREE.Vector3;
}

/** Movable physical objects (crates, barrels, bins) that telekinesis can lift and throw. */
export class PropSystem {
  readonly group = new THREE.Group();
  readonly props: Prop[] = [];

  add(kind: 'crate' | 'barrel' | 'bin' | 'rock', x: number, y: number, z: number): Prop {
    let mesh: THREE.Mesh;
    let r = 0.45, h = 0.9, mass = 1;
    switch (kind) {
      case 'crate':
        mesh = new THREE.Mesh(boxGeo(0.9, 0.9, 0.9), mat('#9b7046', { map: 'wood' }));
        mesh.position.y = 0.45;
        break;
      case 'barrel':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 14), mat('#2f6f9e', { metal: 0.6, rough: 0.4 }));
        mesh.position.y = 0.55;
        r = 0.4; h = 1.1; mass = 1.4;
        break;
      case 'bin':
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 12), mat('#3f6b3a', { rough: 0.6 }));
        mesh.position.y = 0.45;
        r = 0.3; mass = 0.6;
        break;
      default:
        mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), mat('#6d6862', { map: 'rock' }));
        mesh.position.y = 0.5;
        r = 0.6; h = 1; mass = 3;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.set(x, y, z);
    this.group.add(holder);
    const prop: Prop = {
      mesh: holder,
      body: { x, y, z, vx: 0, vy: 0, vz: 0, radius: r, height: h, onGround: false, stepHeight: 0.2 },
      mass, thrownDamage: 0, held: false, spin: new THREE.Vector3(),
    };
    this.props.push(prop);
    return prop;
  }

  nearestInCone(origin: THREE.Vector3, dir: THREE.Vector3, range: number, cosLimit: number): Prop | null {
    let best: Prop | null = null, bestScore = -Infinity;
    const tmp = new THREE.Vector3();
    for (const p of this.props) {
      tmp.set(p.body.x, p.body.y + 0.5, p.body.z).sub(origin);
      const d = tmp.length();
      if (d > range || d < 0.5) continue;
      const c = tmp.dot(dir) / d;
      if (c < cosLimit) continue;
      const score = c * 2 - d / range;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  update(dt: number, game: Game) {
    const g = game.zone.gravity;
    for (const p of this.props) {
      const b = p.body;
      if (!p.held) {
        b.vy -= g * dt;
        const fast = Math.hypot(b.vx, b.vy, b.vz);
        game.zone.physics.move(b, dt);
        if (b.onGround) {
          const f = Math.exp(-6 * dt);
          b.vx *= f; b.vz *= f;
          p.spin.multiplyScalar(f);
          if (fast < 4) p.thrownDamage = 0;
        }
        if (p.thrownDamage > 0 && fast > 6) {
          const hit = game.enemies.hitSphere(new THREE.Vector3(b.x, b.y + 0.5, b.z), b.radius + 0.4);
          if (hit) {
            game.enemies.damage(hit, p.thrownDamage, { element: 'none', knock: new THREE.Vector3(b.vx, 4, b.vz).multiplyScalar(0.5) });
            game.audio.play('hit', { position: hit.position });
            game.particles.emit({ count: 16, position: hit.position.clone().setY(hit.position.y + 1), color: '#ffffff', speed: 6, life: 0.4, size: 0.3 });
            b.vx *= -0.3; b.vz *= -0.3;
            p.thrownDamage = 0;
          }
        }
      }
      p.mesh.position.set(b.x, b.y, b.z);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
    }
  }

  clear() {
    this.group.clear();
    this.props.length = 0;
  }
}
