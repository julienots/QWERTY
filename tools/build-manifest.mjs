#!/usr/bin/env node
// Lists the asset files actually present in public/assets so the game only requests those.
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const base = join(process.cwd(), 'public', 'assets');
const ls = (d, ext) => (existsSync(join(base, d)) ? readdirSync(join(base, d)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort() : []);
const manifest = { models: ls('models', '.glb'), textures: ls('textures', '.webp'), space: ls('space', '.webp'), hdri: ls('hdri', '.hdr') };
writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`manifest: ${manifest.models.length} modèles, ${manifest.textures.length} textures, ${manifest.space.length} images spatiales, ${manifest.hdri.length} HDRI`);
