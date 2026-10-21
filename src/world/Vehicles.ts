import * as THREE from 'three';
import { currentAssets } from './build';
import { makeCar } from './House';

export type CarModel = 'car_sedan' | 'car_hatch';

/**
 * A car built from the Blender-modelled glTF (own paint colour, working head/tail lights,
 * spinning wheels), or the procedural block car when models are not loaded.
 * Front faces +Z. userData: headMat, tailMat, wheels (Object3D[]), wheelRadius.
 */
export function makeVehicle(color: string, model: CarModel = 'car_sedan'): THREE.Group {
  const src = currentAssets()?.model(model);
  if (!src) return makeCar(color);
  const g = new THREE.Group();
  g.add(src);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const head = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1d0', emissiveIntensity: 0.3, roughness: 0.1 });
  const tail = new THREE.MeshStandardMaterial({ color: '#5a0000', emissive: '#ff1a1a', emissiveIntensity: 0.4, roughness: 0.2 });
  const wheels: THREE.Object3D[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (o.name.startsWith('wheel_')) wheels.push(o);
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const name = (m.material as THREE.Material).name;
    if (name === 'paint') m.material = paint;
    else if (name === 'headlight') m.material = head;
    else if (name === 'taillight') m.material = tail;
  });
  g.userData.headMat = head;
  g.userData.tailMat = tail;
  g.userData.paint = paint;
  g.userData.wheels = wheels;
  g.userData.wheelRadius = 0.34;
  return g;
}

/** Rolls the wheels for a distance travelled (metres). */
export function spinWheels(car: THREE.Group, distance: number) {
  const wheels = car.userData.wheels as THREE.Object3D[] | undefined;
  if (!wheels) return;
  const a = distance / (car.userData.wheelRadius as number);
  for (const w of wheels) w.rotation.x += a;
}
