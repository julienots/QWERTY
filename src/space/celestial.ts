import * as THREE from 'three';
import { Noise2D, mulberry32, smoothstep } from '../core/noise';
import { tex } from '../fx/textures';

/** Seamless pseudo-3D noise built from three 2D simplex planes (no texture seams). */
function noise3(n: Noise2D, x: number, y: number, z: number, oct = 5): number {
  return (n.fbm(x, y, oct) + n.fbm(y + 31.7, z - 12.3, oct) + n.fbm(z + 7.1, x + 54.2, oct)) / 3;
}

/** Procedural Earth-like planet texture (equirectangular), plus a separate cloud layer. */
export function earthTextures(width: number): { map: THREE.CanvasTexture; clouds: THREE.CanvasTexture } {
  const h = width / 2;
  const n = new Noise2D(4242);
  const nc = new Noise2D(777);
  const c = document.createElement('canvas');
  c.width = width; c.height = h;
  const cc = document.createElement('canvas');
  cc.width = width; cc.height = h;
  const ctx = c.getContext('2d')!;
  const cctx = cc.getContext('2d')!;
  const img = ctx.createImageData(width, h);
  const cimg = cctx.createImageData(width, h);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - j / h) * Math.PI;
    for (let i = 0; i < width; i++) {
      const lon = (i / width) * Math.PI * 2;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const e = noise3(n, x * 1.6, y * 1.6, z * 1.6) * 1.4 + noise3(n, x * 5, y * 5, z * 5, 3) * 0.25;
      const ice = smoothstep(0.72, 0.9, Math.abs(y) + noise3(n, x * 4, y * 4, z * 4, 2) * 0.1);
      let r: number, g: number, b: number;
      if (e < 0.04) {
        const d = smoothstep(-0.5, 0.04, e);
        r = 8 + 20 * d; g = 30 + 50 * d; b = 70 + 70 * d;
      } else {
        const dry = smoothstep(0.1, 0.45, noise3(n, x * 3 + 9, y * 3, z * 3, 3) + (1 - Math.abs(y)) * 0.25);
        const hi = smoothstep(0.25, 0.6, e);
        r = 50 + dry * 110 + hi * 40; g = 90 + dry * 60 - hi * 10; b = 40 + dry * 30 + hi * 20;
      }
      r = r + (235 - r) * ice; g = g + (240 - g) * ice; b = b + (245 - b) * ice;
      const o = (j * width + i) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      const cl = smoothstep(0.02, 0.35, noise3(nc, x * 2.5, y * 4, z * 2.5, 5));
      cimg.data[o] = 255; cimg.data[o + 1] = 255; cimg.data[o + 2] = 255; cimg.data[o + 3] = cl * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  cctx.putImageData(cimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const clouds = new THREE.CanvasTexture(cc);
  clouds.colorSpace = THREE.SRGBColorSpace;
  return { map, clouds };
}

/** Atmospheric halo shell (rendered from the back side) lit by the sun direction. */
export function atmosphereMaterial(color: string, sunDir: THREE.Vector3, strength = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(color) }, sunDir: { value: sunDir.clone().normalize() }, strength: { value: strength } },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform vec3 sunDir;
      uniform float strength;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        float rim = 1.0 - abs(dot(vNormalW, vViewW));
        float glow = pow(rim, 3.0);
        float lit = clamp(dot(-vNormalW, sunDir) * 0.8 + 0.35, 0.05, 1.0);
        gl_FragColor = vec4(glowColor * glow * lit * strength * 1.6, glow * lit * strength);
      }`,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Star field with a Milky Way band, centred on the camera every frame. */
export function starfield(count: number): THREE.Points {
  const rnd = mulberry32(2025);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const band = new THREE.Vector3(0.3, 0.85, 0.42).normalize();
  for (let i = 0; i < count; i++) {
    let v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    if (i % 2 === 0) {
      // concentrate half the stars near the galactic plane
      v.addScaledVector(band, -v.dot(band) * (0.85 + rnd() * 0.15)).normalize();
    }
    v = v.multiplyScalar(9000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = rnd();
    const c = new THREE.Color().setHSL(t < 0.2 ? 0.08 : t < 0.4 ? 0.6 : 0.15, 0.4, 0.7 + rnd() * 0.3);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  p.frustumCulled = false;
  p.renderOrder = -10;
  return p;
}

/** Bright sun disc with a glow halo, kept far away along the sun direction. */
export function sunSprite(): THREE.Group {
  const g = new THREE.Group();
  // Outside an atmosphere the sun is a small, blinding disc with a tight glare: draw it
  // outside tone mapping so it saturates to white and feeds the bloom.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('flare'), color: new THREE.Color(1.4, 1.3, 1.15), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  halo.scale.setScalar(2400);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: new THREE.Color(6, 5.6, 5), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  core.scale.setScalar(200);
  g.add(halo, core);
  g.renderOrder = -5;
  return g;
}

/**
 * A celestial body whose true position may be beyond the camera far plane. It is drawn at a
 * clamped distance with its size scaled to keep the exact apparent angular size.
 */
export class Impostor {
  readonly object: THREE.Object3D;
  constructor(object: THREE.Object3D, readonly truePosition: THREE.Vector3, readonly radius: number, private maxDist = 11000) {
    this.object = object;
  }
  update(camera: THREE.Camera) {
    const to = this.truePosition.clone().sub(camera.position);
    const d = to.length();
    if (d - this.radius * 1.1 < this.maxDist) {
      this.object.position.copy(this.truePosition);
      this.object.scale.setScalar(1);
    } else {
      const k = (this.maxDist - this.radius * 0.1) / d;
      this.object.position.copy(camera.position).addScaledVector(to, k);
      this.object.scale.setScalar(k);
    }
  }
}

/** Grey lunar surface texture for planet spheres. */
export function moonSphereMaterial(): THREE.MeshStandardMaterial {
  const t = tex('moon');
  return new THREE.MeshStandardMaterial({ map: t, color: '#d8d6d2', roughness: 1, metalness: 0 });
}
