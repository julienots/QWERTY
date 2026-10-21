import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { block, mat } from './build';

export const OBSERVATORY = { x: -150, z: 80, padX: -150, padZ: 110 };

function padTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 512);
  g.strokeStyle = '#f2c230';
  g.lineWidth = 14;
  g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6;
  g.setLineDash([26, 18]);
  g.beginPath(); g.arc(256, 256, 232, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 230px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 256, 268);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d2733'; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#e8edf2'; g.font = 'bold 58px sans-serif'; g.textAlign = 'center';
  g.fillText('OBSERVATOIRE DE VAL-LUMEN', 512, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The town observatory (where the prototype ship is hidden) and its landing pad.
 * Returns the footprint to keep trees and props away.
 */
export function buildObservatory(group: THREE.Group, physics: CollisionWorld, groundAt: (x: number, z: number) => number): [number, number, number, number] {
  const { x, z, padX, padZ } = OBSERVATORY;
  const gy = groundAt(x, z);
  const py = groundAt(padX, padZ);
  const plaster = mat('#e9e4da', { map: 'plaster', rough: 0.9 });
  const concrete = mat('#a9a8a3', { map: 'concrete', rough: 0.9 });
  const metal = mat('#c9ced4', { map: 'metal', rough: 0.35, metal: 0.8 });
  const dark = mat('#1b1f24', { rough: 0.5, metal: 0.4 });

  // Drum and dome
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.2, 7, 40, 1), plaster);
  drum.position.set(x, gy + 3.5, z);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7.3, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  dome.position.set(x, gy + 7, z);
  dome.rotation.y = 0.5;
  // Shutter slit (dark band over the dome) and the telescope tube peeking out
  const slit = new THREE.Mesh(new THREE.SphereGeometry(7.36, 6, 16, -0.12, 0.24, 0.05, Math.PI / 2 - 0.05), dark);
  slit.position.copy(dome.position);
  slit.rotation.y = 0.5;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.8, 7, 20), mat('#f2f2f2', { rough: 0.3, metal: 0.6 }));
  tube.position.set(x + Math.sin(0.5) * 2.5, gy + 10.5, z + Math.cos(0.5) * 2.5);
  tube.rotation.set(0.75, 0.5, 0, 'YXZ');
  group.add(drum, dome, slit, tube);
  for (const m of [drum, dome, tube]) { m.castShadow = true; m.receiveShadow = true; }
  physics.addBox(x - 6.6, gy, z - 6.6, x + 6.6, gy + 14, z + 6.6, 'observatory');

  // Lab wing with entrance and sign
  block(group, physics, x + 6, gy, z - 4, x + 18, gy + 4.5, z + 4, { material: plaster, tile: 2 });
  block(group, physics, x + 5.8, gy + 4.5, z - 4.3, x + 18.3, gy + 4.8, z + 4.3, { material: concrete, tile: 2 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.25), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6 }));
  sign.position.set(x + 12, gy + 3.6, z + 4.02);
  group.add(sign);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), dark);
  door.position.set(x + 12, gy + 1.2, z + 4.02);
  group.add(door);
  for (const wx of [8.5, 15.5]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), mat('#36506a', { rough: 0.1, metal: 0.6 }));
    w.position.set(x + wx, gy + 2.4, z + 4.02);
    group.add(w);
  }

  // Landing pad (concrete slab, painted marks, edge lights) and a path to the lab
  const S = 30;
  block(group, physics, padX - S / 2, py - 0.5, padZ - S / 2, padX + S / 2, py + 0.12, padZ + S / 2, { material: concrete, tile: 3 });
  const marks = new THREE.Mesh(new THREE.PlaneGeometry(S * 0.9, S * 0.9), new THREE.MeshStandardMaterial({ map: padTexture(), transparent: true, roughness: 0.8, depthWrite: false }));
  marks.rotation.x = -Math.PI / 2;
  marks.position.set(padX, py + 0.13, padZ);
  group.add(marks);
  const lightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#7fd8ff', emissiveIntensity: 2.5 });
  const lightGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.25, 10);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const l = new THREE.Mesh(lightGeo, lightMat);
    l.position.set(padX + Math.cos(a) * (S / 2 - 0.8), py + 0.25, padZ + Math.sin(a) * (S / 2 - 0.8));
    group.add(l);
  }
  block(group, physics, x + 10, gy - 0.4, z + 4, x + 14, gy + 0.08, padZ - S / 2, { material: concrete, tile: 2 });
  return [x - 9, z - 9, padX + S / 2 + 1, padZ + S / 2 + 1];
}
