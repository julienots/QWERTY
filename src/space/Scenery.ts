import * as THREE from 'three';
import { currentAssets } from '../world/build';
import { atmosphereMaterial, earthTextures, moonSphereMaterial, starfield, sunSprite } from './celestial';

/** Direction of sunlight shared by every space zone. */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.38, -0.74).normalize();

/** NASA Deep Star Maps panorama as background (falls back to procedural stars). */
export function spaceBackground(group: THREE.Group): THREE.Texture | THREE.Color {
  const t = currentAssets()?.space('starmap');
  if (t) {
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }
  group.add(starfield(6000));
  return new THREE.Color('#000000');
}

/**
 * Earth from space: NASA Blue Marble by day, Black Marble city lights on the night side,
 * a separate cloud layer and a scattering halo. Procedural textures when images are missing.
 */
export function makeEarth(radius: number, segments = 96): { group: THREE.Group; clouds: THREE.Mesh } {
  const a = currentAssets();
  const day = a?.space('earth_day') ?? null;
  const night = a?.space('earth_night') ?? null;
  const cloudsTex = a?.space('earth_clouds') ?? null;
  const fallback = day ? null : earthTextures(1024);
  const mat = new THREE.MeshStandardMaterial({
    map: day ?? fallback!.map,
    roughness: 0.85,
    metalness: 0,
    emissive: night ? new THREE.Color('#ffd9a0') : new THREE.Color('#000000'),
    emissiveMap: night,
    emissiveIntensity: night ? 1.6 : 0,
  });
  // City lights only on the night side.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.sunDirW = { value: SUN_DIR };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNW;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvNW = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 sunDirW;\nvarying vec3 vNW;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(0.08, -0.18, dot(normalize(vNW), sunDirW));')
      // Oceans (dark, bluish texels) are glossy: the sun glints on them.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat lumE = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\nfloat ocean = smoothstep(0.0, 0.004, diffuseColor.b - diffuseColor.r) * (1.0 - smoothstep(0.02, 0.07, lumE));\nroughnessFactor = mix(roughnessFactor, 0.32, ocean);');
  };
  mat.customProgramCacheKey = () => 'earth-night-lights';
  const group = new THREE.Group();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), mat);
  earth.name = 'earth';
  group.add(earth);
  const cm = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    alphaMap: cloudsTex ?? fallback?.clouds ?? null,
    map: cloudsTex ? null : fallback?.clouds ?? null,
    transparent: true,
    depthWrite: false,
    roughness: 1,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.007, segments, segments / 2), cm);
  group.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 64, 32), atmosphereMaterial('#5fa8ff', SUN_DIR, 1.1));
  group.add(atmo);
  return { group, clouds };
}

/** The Moon sphere with the NASA LRO colour map. */
export function makeMoon(radius: number): THREE.Mesh {
  const t = currentAssets()?.space('moon_color');
  const m = t ? new THREE.MeshStandardMaterial({ map: t, roughness: 1, metalness: 0 }) : moonSphereMaterial();
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), m);
}

/** Harsh vacuum sunlight with a faint fill, and the sun disc. */
export function spaceLights(group: THREE.Group, shadows: boolean, shadowSize: number, span = 120): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight('#fff6e8', 4.2);
  sun.position.copy(SUN_DIR).multiplyScalar(400);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const c = sun.shadow.camera;
  c.left = c.bottom = -span; c.right = c.top = span; c.near = 1; c.far = 1200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  group.add(sun, sun.target);
  group.add(new THREE.HemisphereLight('#3a4a6a', '#0b0b10', 0.25));
  const disc = sunSprite();
  disc.position.copy(SUN_DIR).multiplyScalar(10500);
  group.add(disc);
  disc.userData.followCamera = true;
  return sun;
}
