#!/usr/bin/env node
/**
 * Runs every Blender generator, then optimises the exported models for mobile into
 * public/assets/models (meshopt compression, WebP textures).
 * Usage: BLENDER_PY=/path/to/python-with-bpy node tools/blender/build.mjs [script ...]
 * (a Python with the `bpy` module: `pip install bpy`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const py = process.env.BLENDER_PY ?? 'python3';
const scripts = process.argv.slice(2).length ? process.argv.slice(2) : ['ships', 'creatures', 'trees', 'houses', 'vehicles'];
const raw = join('.asset-cache', 'blender');
mkdirSync(raw, { recursive: true });
for (const s of scripts) {
  console.log(`▶ ${s}.py`);
  execFileSync(py, [join('tools', 'blender', `${s}.py`), raw], { stdio: ['ignore', 'ignore', 'inherit'] });
}
for (const f of readdirSync(raw).filter((x) => x.endsWith('.glb'))) {
  const out = join('public', 'assets', 'models', f);
  execFileSync(join('node_modules', '.bin', 'gltf-transform'), ['optimize', join(raw, f), out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512', '--simplify', 'false', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--palette', 'false'], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('  ✓', out);
}
