import * as THREE from 'three';
import type { Assets } from '../core/Assets';

/**
 * Photographic PBR ground: grass / dirt / rock / snow blended per vertex (`splat` attribute,
 * computed from slope, altitude and gameplay areas). Textures are projected in world space;
 * tiling is broken up by mixing a second, rotated and larger sample driven by low-frequency
 * noise, and the rock layer is tri-planar so cliffs are not stretched.
 */
export function terrainMaterial(assets: Assets | null, detail: 'low' | 'high'): THREE.MeshStandardMaterial | null {
  const tex = (set: string, kind: 'diff' | 'nor') => assets?.texture(`textures/${set}_${kind}.webp`) ?? null;
  const maps = {
    tGrass: tex('grass', 'diff'), tDirt: tex('dirt', 'diff'), tRock: tex('rock', 'diff'),
    nGrass: tex('grass', 'nor'), nDirt: tex('dirt', 'nor'), nRock: tex('rock', 'nor'),
  };
  if (Object.values(maps).some((t) => !t)) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.name = 'terrain-splat';
  const uniforms: Record<string, THREE.IUniform> = {
    uScale: { value: 1 / 3.2 },
  };
  for (const [k, t] of Object.entries(maps)) uniforms[k] = { value: t };
  const hq = detail === 'high';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSplat = splat;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = mat3(modelMatrix) * objectNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tDirt, tRock, nGrass, nDirt, nRock;
uniform float uScale;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;
vec4 wSplat;
float tMacro;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 tSafeN(vec3 n) { float l = length(n); return l > 1e-5 ? n / l : vec3(0.0, 1.0, 0.0); }
const mat2 tRot = mat2(0.8, -0.6, 0.6, 0.8);
vec3 tSample(sampler2D t, vec2 uv) {
  vec3 a = texture2D(t, uv).rgb;
  ${hq ? 'vec3 b = texture2D(t, tRot * uv * 0.29 + vec2(0.37, 0.71)).rgb; return mix(a, b, tMacro);' : 'return a;'}
}
vec3 tTriRock(vec3 p, vec3 n) {
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  return texture2D(tRock, p.zy).rgb * bw.x + tSample(tRock, p.xz) * bw.y + texture2D(tRock, p.xy).rgb * bw.z;
}`)
      .replace('#include <map_fragment>', `
{
  vec2 uv = vWPos.xz * uScale;
  float dist = length(vWPos - cameraPosition);
  tMacro = clamp(0.25 + 0.45 * tNoise(vWPos.xz / 37.0) + dist / 260.0, 0.0, 0.85);
  // Organic transitions: the splat boundaries are jittered by noise.
  float jn = tNoise(vWPos.xz / 3.1) * 0.6 + tNoise(vWPos.xz / 11.0) * 0.4;
  vec4 w = max(vSplat, 0.0);
  w.y *= 0.6 + jn * 0.9;
  w.z *= 0.7 + (1.0 - jn) * 0.6;
  w = pow(w, vec4(1.6));
  wSplat = w / max(1e-4, w.x + w.y + w.z + w.w);
  vec3 grass = tSample(tGrass, uv * 1.15);
  grass *= vec3(0.6, 0.84, 0.46) * mix(vec3(1.0), vec3(1.25, 1.08, 0.85), tNoise(vWPos.xz / 23.0) * 0.7);
  vec3 dirt = tSample(tDirt, uv);
  vec3 rock = tTriRock(vWPos * uScale * 0.5, tSafeN(vWNormal));
  vec3 snow = vec3(0.86, 0.89, 0.93) * (0.9 + 0.1 * rock.r);
  diffuseColor.rgb *= grass * wSplat.x + dirt * wSplat.y + rock * wSplat.z + snow * wSplat.w;
}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = dot(wSplat, vec4(0.97, 0.93, 0.82, 0.55));`)
      .replace('#include <normal_fragment_maps>', `
{
  vec2 uv = vWPos.xz * uScale;
  vec3 tn = (texture2D(nGrass, uv * 1.15).xyz * 2.0 - 1.0) * wSplat.x
          + (texture2D(nDirt, uv).xyz * 2.0 - 1.0) * wSplat.y
          + (texture2D(nRock, uv * 0.5).xyz * 2.0 - 1.0) * (wSplat.z + wSplat.w * 0.5);
  tn.xy *= 0.9;
  tn.z = max(tn.z, 0.2) + wSplat.w * 0.5;
  vec3 N = tSafeN(vWNormal);
  vec3 T = vec3(1.0, 0.0, 0.0) - N * N.x;
  T = dot(T, T) > 1e-6 ? normalize(T) : vec3(0.0, 0.0, 1.0);
  vec3 B = cross(N, T);
  vec3 nw = normalize(T * tn.x + B * tn.y + N * tn.z);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat-' + detail;
  return mat;
}
