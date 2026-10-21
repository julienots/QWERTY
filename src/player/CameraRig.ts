import * as THREE from 'three';
import type { Game } from '../Game';
import { clamp, damp } from '../core/noise';

/** Third-person orbit camera with wall avoidance, speed-based FOV and screen shake. */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.28;
  distance = 4.2;
  private curDist = 4.2;
  private shakeAmt = 0;
  private pivot = new THREE.Vector3();
  private smoothPivot = new THREE.Vector3();
  private first = true;
  targetDistance = 4.2;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  shake(a: number) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }

  snapBehind(yaw: number) {
    this.yaw = yaw;
    this.first = true;
  }

  update(dt: number, game: Game) {
    const s = game.settings;
    const look = game.input.consumeLook();
    const sens = 0.0042 * s.sensitivity;
    this.yaw -= look.dx * sens;
    this.pitch += look.dy * sens * (s.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.2, 1.35);

    const p = game.player;
    const flying = p.flying;
    const speed = p.velocity.length();
    this.targetDistance = game.ship?.active ? game.ships.chaseDistance : flying ? 5.5 + Math.min(4, speed / 25) : 4.2;
    const inside = game.zone.id === 'earth' && Math.abs(p.position.x) < 7 && Math.abs(p.position.z) < 6 && p.position.y < 2.5;
    if (inside) this.targetDistance = 3.4;
    if (game.zone.cameraDistance && !game.ship?.active) this.targetDistance = game.zone.cameraDistance;

    const focus = game.ship?.active ? game.ship.position : p.position;
    this.pivot.set(focus.x, focus.y + (game.ship?.active ? game.ships.chaseDistance * 0.18 : 1.55), focus.z);
    if (this.first) { this.smoothPivot.copy(this.pivot); this.first = false; }
    this.smoothPivot.lerp(this.pivot, damp(speed > 30 ? 30 : 18, dt));

    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Wall/terrain avoidance
    const hit = game.zone.physics.raycast(this.smoothPivot.x, this.smoothPivot.y, this.smoothPivot.z, dir.x, dir.y, dir.z, this.targetDistance + 0.3);
    const allowed = Math.max(0.6, Math.min(this.targetDistance, hit - 0.3));
    this.curDist += (allowed - this.curDist) * (allowed < this.curDist ? 1 : damp(4, dt));
    const cam = this.camera;
    cam.position.copy(this.smoothPivot).addScaledVector(dir, this.curDist);
    // Shoulder offset to keep the reticle clear of the character
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    cam.position.addScaledVector(right, -0.45 * Math.min(1, this.curDist / 3));
    const target = this.smoothPivot.clone().addScaledVector(right, -0.45 * Math.min(1, this.curDist / 3));
    if (this.shakeAmt > 0 && !s.reduceMotion) {
      const a = this.shakeAmt * this.shakeAmt * 0.5;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    cam.lookAt(target);
    const fov = 62 + (s.reduceMotion ? 0 : Math.min(18, Math.max(0, speed - 8) * 0.25));
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * damp(3, dt);
      cam.updateProjectionMatrix();
    }
  }

  /** Direction the camera looks at (for aiming). */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }
}
