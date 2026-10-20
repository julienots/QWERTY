#!/usr/bin/env node
/**
 * Downloads every third-party asset listed in tools/assets.manifest.mjs, optimises it for
 * mobile (meshoptimizer geometry compression, WebP textures, decimation of dense photoscans)
 * and writes the results to public/assets/. Also regenerates CREDITS.md.
 *
 * Usage: node tools/fetch-assets.mjs [--force] [--only=name]
 * Raw downloads are cached in .asset-cache/ (git-ignored). Downloads go through curl so the
 * system proxy configuration is honoured.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import * as M from './assets.manifest.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CACHE = join(ROOT, '.asset-cache');
const OUT = join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const credits = [];

const mk = (p) => mkdirSync(p, { recursive: true });
const want = (name) => !ONLY || ONLY === name;
const fresh = (p) => !FORCE && existsSync(p) && statSync(p).size > 0;
const kb = (p) => Math.round(statSync(p).size / 1024);

function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  mk(dirname(dest));
  // Atomic download: a connection reset never leaves a truncated file in the cache.
  execFileSync('curl', ['-sSfL', '--retry', '6', '--retry-delay', '3', '--retry-all-errors', '-o', dest + '.part', url], { stdio: 'inherit' });
  renameSync(dest + '.part', dest);
  return dest;
}

function json(url) {
  return JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '6', '--retry-all-errors', url]).toString());
}

function gltfTransform(args) {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'gltf-transform'), args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function optimizeModel(input, output, { simplify = 1, textureSize = 512, character = false, variants = false } = {}) {
  const args = ['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(textureSize), '--instance', 'false', '--palette', 'false'];
  if (character || variants) args.push('--flatten', 'false', '--join', 'false');
  if (character) args.push('--simplify', 'false');
  if (character) { /* keep geometry intact */ } else if (simplify < 1) args.push('--simplify', 'true', '--simplify-ratio', String(simplify), '--simplify-error', '0.002');
  else args.push('--simplify', 'false');
  gltfTransform(args);
}

async function image(input, output, width, quality = 82) {
  await sharp(input, { limitInputPixels: false }).resize({ width, withoutEnlargement: true }).webp({ quality }).toFile(output);
}

// ---------------------------------------------------------------- Poly Haven models
const failures = [];
for (const m of M.polyhavenModels) {
  if (!want(m.out ?? m.id)) continue;
  try {
  const files = json(`https://api.polyhaven.com/files/${m.id}`);
  const info = json(`https://api.polyhaven.com/info/${m.id}`);
  const g = files.gltf['1k'].gltf;
  const dir = join(CACHE, 'polyhaven', m.id);
  const main = download(g.url, join(dir, g.url.split('/').pop()));
  for (const [rel, f] of Object.entries(g.include ?? {})) download(f.url, join(dir, rel));
  credits.push({ section: 'Modèles 3D', name: info.name, by: Object.keys(info.authors ?? {}).join(', '), url: `https://polyhaven.com/a/${m.id}`, license: M.POLYHAVEN, used: m.out ?? '(source de végétation traitée dans Blender)' });
  if (!m.out) { console.log(`  · ${m.id}: source brute en cache`); continue; }
  const out = join(OUT, 'models', `${m.out}.glb`);
  mk(dirname(out));
  if (!fresh(out)) optimizeModel(main, out, { simplify: m.simplify, textureSize: m.textureSize ?? 512, variants: m.variants });
  console.log(`  ✓ ${m.out}.glb (${kb(out)} Ko) ← Poly Haven ${m.id}`);
  } catch (e) { failures.push(m.id); console.log(`  ✘ ${m.id}: ${e.message.split('\n')[0]}`); }
}

// ---------------------------------------------------------------- Poly Haven textures
for (const t of M.polyhavenTextures) {
  if (!want(t.out)) continue;
  const files = json(`https://api.polyhaven.com/files/${t.id}`);
  const info = json(`https://api.polyhaven.com/info/${t.id}`);
  const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
  mk(join(OUT, 'textures'));
  for (const [kind, entry] of Object.entries(maps)) {
    if (!entry) continue;
    const url = entry['1k'].jpg?.url ?? entry['1k'].png.url;
    const raw = download(url, join(CACHE, 'polyhaven-tex', t.id, url.split('/').pop()));
    const out = join(OUT, 'textures', `${t.out}_${kind}.webp`);
    if (!fresh(out)) await image(raw, out, 1024, kind === 'nor' ? 90 : 80);
  }
  credits.push({ section: 'Textures PBR', name: info.name, by: Object.keys(info.authors ?? {}).join(', '), url: `https://polyhaven.com/a/${t.id}`, license: M.POLYHAVEN, used: `${t.out}_*.webp` });
  console.log(`  ✓ texture ${t.out} ← Poly Haven ${t.id}`);
}

// ---------------------------------------------------------------- HDRIs
for (const h of M.polyhavenHdris) {
  if (!want(h.out)) continue;
  const files = json(`https://api.polyhaven.com/files/${h.id}`);
  const info = json(`https://api.polyhaven.com/info/${h.id}`);
  const raw = download(files.hdri['1k'].hdr.url, join(CACHE, 'hdri', `${h.id}_1k.hdr`));
  const out = join(OUT, 'hdri', `${h.out}.hdr`);
  mk(dirname(out));
  if (!fresh(out)) copyFileSync(raw, out);
  credits.push({ section: 'Éclairage HDRI', name: info.name, by: Object.keys(info.authors ?? {}).join(', '), url: `https://polyhaven.com/a/${h.id}`, license: M.POLYHAVEN, used: `${h.out}.hdr` });
  console.log(`  ✓ hdri ${h.out}.hdr (${kb(out)} Ko)`);
}

// ---------------------------------------------------------------- NASA models
for (const n of M.nasaModels) {
  if (!want(n.out)) continue;
  const raw = download(n.url, join(CACHE, 'nasa', `${n.out}.glb`));
  const out = join(OUT, 'models', `${n.out}.glb`);
  if (!fresh(out)) optimizeModel(raw, out, { simplify: n.simplify, textureSize: 1024 });
  credits.push({ section: 'Modèles 3D', name: n.title, by: 'NASA', url: 'https://science.nasa.gov/3d-resources/', license: M.NASA, used: `${n.out}.glb` });
  console.log(`  ✓ ${n.out}.glb (${kb(out)} Ko) ← NASA`);
}

// ---------------------------------------------------------------- NASA images
for (const n of M.nasaImages) {
  if (!want(n.out)) continue;
  const raw = download(n.url, join(CACHE, 'nasa-img', n.url.split('/').pop()));
  const out = join(OUT, 'space', `${n.out}.webp`);
  mk(dirname(out));
  if (!fresh(out)) await image(raw, out, n.width, 85);
  credits.push({ section: 'Images spatiales', name: n.title, by: 'NASA', url: n.url, license: M.NASA, used: `${n.out}.webp` });
  console.log(`  ✓ ${n.out}.webp (${kb(out)} Ko) ← NASA`);
}

// ---------------------------------------------------------------- characters
for (const c of M.characterModels) {
  if (!want(c.out)) continue;
  const raw = download(c.url, join(CACHE, 'characters', `${c.out}.glb`));
  const out = join(OUT, 'models', `${c.out}.glb`);
  if (!fresh(out)) optimizeModel(raw, out, { character: true, textureSize: 1024 });
  credits.push({ section: 'Personnages animés', name: c.out, by: '', url: c.url, license: c.credit, used: `${c.out}.glb` });
  console.log(`  ✓ ${c.out}.glb (${kb(out)} Ko)`);
}

// ---------------------------------------------------------------- credits
if (failures.length) { console.log('\nÉCHECS : ' + failures.join(', ')); process.exitCode = 1; }
if (!ONLY && !failures.length) {
  const sections = [...new Set(credits.map((c) => c.section))];
  let md = '# Crédits des ressources\n\nUniverse Ascendant — SuperEssence Studio.\n\n';
  md += 'Toutes les ressources tierces ci-dessous sont libres de droits (CC0 / domaine public) sauf mention contraire. ';
  md += 'Elles sont téléchargées et optimisées par `tools/fetch-assets.mjs` ; les modèles créés pour le jeu dans Blender sont générés par `tools/blender/`.\n\n';
  for (const s of sections) {
    md += `## ${s}\n\n| Ressource | Auteur(s) | Fichier du jeu | Licence |\n|---|---|---|---|\n`;
    for (const c of credits.filter((x) => x.section === s)) md += `| [${c.name}](${c.url}) | ${c.by} | \`${c.used}\` | ${c.license} |\n`;
    md += '\n';
  }
  const blenderCredits = join(ROOT, 'tools', 'blender', 'CREDITS.part.md');
  if (existsSync(blenderCredits)) md += readFileSync(blenderCredits, 'utf8');
  writeFileSync(join(ROOT, 'CREDITS.md'), md);
  console.log('\nCREDITS.md mis à jour');
}
