import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, mulberry32, smoothstep } from '../core/noise';
import { tex } from '../fx/textures';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm';

interface WeatherParams { clouds: number; rain: number; fog: number; wind: number; lightning: number }

const WEATHER: Record<WeatherKind, WeatherParams> = {
  clear: { clouds: 0.15, rain: 0, fog: 0, wind: 0.2, lightning: 0 },
  cloudy: { clouds: 0.7, rain: 0, fog: 0.1, wind: 0.4, lightning: 0 },
  rain: { clouds: 0.95, rain: 0.7, fog: 0.3, wind: 0.6, lightning: 0 },
  fog: { clouds: 0.5, rain: 0, fog: 1, wind: 0.1, lightning: 0 },
  storm: { clouds: 1, rain: 1, fog: 0.4, wind: 1, lightning: 1 },
};

export const WEATHER_NAMES: Record<WeatherKind, string> = {
  clear: 'Dégagé', cloudy: 'Nuageux', rain: 'Pluie', fog: 'Brouillard', storm: 'Orage',
};

/**
 * Physically-inspired sky (three.js Sky shader), sun/moon lights following the time of
 * day, stars, drifting clouds and an evolving weather system with rain and lightning.
 */
export class EarthSky {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#bcd8ff', '#4a5a3a', 1);
  private sky = new Sky();
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private clouds: THREE.Sprite[] = [];
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainCount: number;
  weather: WeatherKind = 'clear';
  private current: WeatherParams = { ...WEATHER.clear };
  private weatherTimer = 240;
  private flash = 0;
  private nextLightning = 5;
  readonly fog: THREE.FogExp2;
  night = 0;
  envIntensity = 0.5;
  sunDir = new THREE.Vector3();
  private rnd = mulberry32(Date.now() & 0xffff);
  onThunder: ((delay: number) => void) | null = null;

  constructor(rainDrops: number, private viewDistance: number) {
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.group.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.group.add(this.sun, this.sun.target, this.hemi);

    // Stars
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const r = mulberry32(11);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1);
      pos.set([Math.sin(ph) * Math.cos(th) * 4000, Math.abs(Math.cos(ph)) * 4000 - 200, Math.sin(ph) * Math.sin(th) * 4000], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.group.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), new THREE.MeshBasicMaterial({ map: tex('moon'), fog: false, color: '#e8e8f0' }));
    this.group.add(this.moon);

    // Clouds
    const cloudTex = tex('cloud');
    const cr = mulberry32(3);
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.8, fog: false }));
      s.position.set((cr() - 0.5) * 3200, 300 + cr() * 250, (cr() - 0.5) * 3200);
      const sc = 300 + cr() * 420;
      s.scale.set(sc, sc * 0.45, 1);
      s.userData.base = cr();
      this.clouds.push(s);
      this.group.add(s);
    }

    // Rain (line segments re-cycled around the camera)
    this.rainCount = rainDrops;
    this.rainPos = new Float32Array(rainDrops * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#b8c8d8', transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.group.add(this.rain);
    for (let i = 0; i < rainDrops; i++) this.respawnDrop(i, new THREE.Vector3(), true);

    this.fog = new THREE.FogExp2('#bcd3e6', 0.0012);
  }

  setWeather(w: WeatherKind, instant = false) {
    this.weather = w;
    this.weatherTimer = 180 + this.rnd() * 240;
    if (instant) this.current = { ...WEATHER[w] };
  }

  private respawnDrop(i: number, c: THREE.Vector3, randomY: boolean) {
    const x = c.x + (this.rnd() - 0.5) * 60, z = c.z + (this.rnd() - 0.5) * 60;
    const y = c.y + (randomY ? (this.rnd() - 0.3) * 40 : 25 + this.rnd() * 10);
    this.rainPos.set([x, y, z, x, y - 0.7, z], i * 6);
  }

  /** time in hours [0, 24). */
  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3, altitudeFade: number) {
    // Weather evolution
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const roll = this.rnd();
      const next: WeatherKind = roll < 0.4 ? 'clear' : roll < 0.65 ? 'cloudy' : roll < 0.82 ? 'rain' : roll < 0.92 ? 'fog' : 'storm';
      this.setWeather(next);
    }
    const target = WEATHER[this.weather];
    const k = Math.min(1, dt * 0.08);
    for (const key of Object.keys(target) as (keyof WeatherParams)[]) this.current[key] = lerp(this.current[key], target[key], k);
    const w = this.current;

    // Sun path: rises at 6h in the east (+x), sets at 18h in the west.
    const dayAngle = ((time - 6) / 12) * Math.PI;
    const elev = Math.sin(dayAngle) * 1.15;
    this.sunDir.set(Math.cos(dayAngle), Math.max(-1, elev), -0.35).normalize();
    const sunUp = smoothstep(-0.22, 0.25, this.sunDir.y);
    this.night = 1 - smoothstep(-0.32, 0.05, this.sunDir.y);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.rayleigh.value = lerp(1.6, 3.2, w.clouds * 0.6);
    u.turbidity.value = lerp(6, 18, w.clouds);
    this.sky.position.copy(camera.position);

    // Lights
    const overcast = 1 - w.clouds * 0.6;
    const warm = smoothstep(0.0, 0.35, this.sunDir.y);
    this.sun.color.setRGB(1, lerp(0.62, 0.96, warm), lerp(0.4, 0.9, warm));
    this.sun.intensity = sunUp * 3.4 * overcast;
    // Moonlight when the sun is down
    const moonDir = this.sunDir.clone().negate();
    if (this.night > 0.5) {
      this.sun.position.copy(focus).addScaledVector(moonDir, 120);
      this.sun.intensity = 0.9 * this.night * overcast;
      this.sun.color.set('#9fb4ff');
    } else {
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 120);
    }
    this.sun.target.position.copy(focus);
    this.hemi.intensity = lerp(0.55, 1.15, sunUp) * lerp(1, 0.75, w.clouds) + this.flash * 3;
    this.hemi.color.setRGB(lerp(0.3, 0.72, sunUp), lerp(0.38, 0.82, sunUp), lerp(0.62, 1, sunUp));
    this.hemi.groundColor.setRGB(lerp(0.1, 0.32, sunUp), lerp(0.1, 0.3, sunUp), lerp(0.16, 0.22, sunUp));
    this.envIntensity = lerp(0.12, 0.55, sunUp) * lerp(1, 0.7, w.clouds);

    // Fog colour roughly matches the horizon
    const day = new THREE.Color('#b9cfe0'), dusk = new THREE.Color('#d99a78'), nightC = new THREE.Color('#141c30'), grey = new THREE.Color('#8a949c');
    const duskAmt = clamp(1 - Math.abs(this.sunDir.y - 0.05) / 0.3, 0, 1) * (1 - this.night);
    const fc = nightC.clone().lerp(day, sunUp).lerp(dusk, clamp(duskAmt, 0, 0.7)).lerp(grey.multiplyScalar(lerp(0.15, 1, sunUp)), w.clouds * 0.6);
    this.fog.color.copy(fc);
    const base = 2.4 / this.viewDistance;
    this.fog.density = (base + w.fog * 0.012 + w.rain * 0.002) * (1 - altitudeFade);

    // Stars & moon
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(this.night * (1 - w.clouds * 0.8), altitudeFade);
    this.stars.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 3500);
    this.moon.visible = moonDir.y > -0.1;

    // Clouds drift with the wind and fade with cover
    for (const c of this.clouds) {
      c.position.x += dt * (4 + w.wind * 18);
      if (c.position.x > focus.x + 1700) c.position.x -= 3400;
      if (c.position.x < focus.x - 1700) c.position.x += 3400;
      if (c.position.z > focus.z + 1700) c.position.z -= 3400;
      if (c.position.z < focus.z - 1700) c.position.z += 3400;
      const visible = c.userData.base < 0.2 + w.clouds * 0.85 ? 1 : 0;
      const mat = c.material as THREE.SpriteMaterial;
      mat.opacity = lerp(mat.opacity, visible * lerp(0.5, 0.95, w.clouds) * (1 - altitudeFade), Math.min(1, dt));
      const shade = lerp(0.18, 1, sunUp) * lerp(1, 0.55, w.clouds * w.clouds);
      mat.color.setRGB(shade + duskAmt * 0.3, shade, shade * (1 + this.night * 0.2));
    }

    // Rain
    const raining = w.rain > 0.05 && altitudeFade < 0.5;
    this.rain.visible = raining;
    if (raining) {
      const active = Math.floor(this.rainCount * clamp(w.rain, 0, 1));
      const c = camera.position;
      const windX = w.wind * 6;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        if (i >= active) { this.rainPos[o + 1] = -9999; this.rainPos[o + 4] = -9999; continue; }
        const fall = 24 * dt;
        this.rainPos[o] += windX * dt; this.rainPos[o + 3] += windX * dt;
        this.rainPos[o + 1] -= fall; this.rainPos[o + 4] -= fall;
        if (this.rainPos[o + 1] < c.y - 12 || Math.abs(this.rainPos[o] - c.x) > 32 || Math.abs(this.rainPos[o + 2] - c.z) > 32) this.respawnDrop(i, c, false);
        this.rainPos[o + 3] = this.rainPos[o] - windX * 0.03;
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.3 * sunUp;
    }

    // Lightning
    this.flash = Math.max(0, this.flash - dt * 4);
    if (w.lightning > 0.6) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.flash = 1;
        this.nextLightning = 4 + this.rnd() * 10;
        this.onThunder?.(0.4 + this.rnd() * 2.5);
      }
    }
  }

  get params(): WeatherParams { return this.current; }
  get lightningFlash() { return this.flash; }

  configureShadows(enabled: boolean, size: number) {
    this.sun.castShadow = enabled;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = -45; cam.right = 45; cam.top = 45; cam.bottom = -45;
    cam.near = 1; cam.far = 300;
    cam.updateProjectionMatrix();
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as any).map = null;
  }
}
