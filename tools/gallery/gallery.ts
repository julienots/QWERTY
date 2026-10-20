// Dev-only QA page: renders every model of a group in a grid (used by tools/gallery/shoot.mjs).
import * as THREE from 'three';
import { Assets, fitTo } from '../../src/core/Assets';

const params = new URLSearchParams(location.search);
const names = (params.get('m') ?? '').split(',').filter(Boolean);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#3a3f47');
const assets = new Assets('/assets/');
(async () => {
try {
await assets.preload(() => {});
console.log('preloaded');
if (assets.hdr) { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(assets.hdr).texture; }
scene.add(new THREE.HemisphereLight('#ffffff', '#555555', 0.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.5);
sun.position.set(3, 6, 4);
scene.add(sun);
const cols = Math.ceil(Math.sqrt(names.length));
const cell = 3;
const labels = document.getElementById('l')!;
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
const span = cols * cell;
cam.position.set(span / 2 - cell / 2, span * 0.55, span * 1.35);
cam.lookAt(span / 2 - cell / 2, 0.6, (Math.ceil(names.length / cols) * cell) / 2 - cell / 2);
const placed: [THREE.Vector3, string][] = [];
names.forEach((n, i) => {
  console.log('place', n);
  const m = assets.character(n) ?? assets.model(n);
  const x = (i % cols) * cell, z = Math.floor(i / cols) * cell;
  if (!m) { placed.push([new THREE.Vector3(x, 0, z), n + ' (MANQUANT)']); return; }
  const h = fitTo(m, { x: cell * 0.8, y: cell * 0.8, z: cell * 0.8 });
  h.position.set(x, 0, z);
  h.rotation.y = 0.5;
  scene.add(h);
  placed.push([new THREE.Vector3(x, -0.05, z + cell * 0.35), n]);
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#50555c' }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
console.log('placing done');
renderer.render(scene, cam);
console.log('rendered');
for (const [p, n] of placed) {
  const v = p.clone().project(cam);
  const d = document.createElement('div');
  d.textContent = n;
  d.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
  d.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
  labels.appendChild(d);
}
(window as any).__ready = true;
console.log('ready');
} catch (e) { console.log('FAIL ' + (e as Error).stack); (window as any).__ready = true; }
})();
