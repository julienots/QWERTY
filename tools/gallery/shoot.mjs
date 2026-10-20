// node tools/gallery/shoot.mjs <outDir> name1,name2,... [file]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const [out, models, file = 'gallery'] = process.argv.slice(2);
(await import('node:child_process')).execFileSync('node', ['tools/build-manifest.mjs']);
const server = spawn('node_modules/.bin/vite', ['--port', '5199', '--strictPort'], { stdio: 'pipe' });
process.on('exit', () => server.kill());
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('5199') && r()));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
p.on('console', (m) => { if (m.type() !== 'debug') console.log('console', m.type(), m.text().slice(0, 200)); });
await p.goto(`http://localhost:5199/tools/gallery/index.html?m=${models}`);
await p.waitForFunction(() => window.__ready, null, { timeout: 180000, polling: 500 });
console.log('ready seen');
await p.screenshot({ path: `${out}/${file}.png`, timeout: 120000 });
console.log('shot');
await b.close(); server.kill(); process.exit(0);
