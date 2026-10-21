// Lists the heaviest visible meshes by triangle count: node tests/e2e/perf-probe2.mjs <quality>.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.addInitScript((q) => localStorage.setItem('ua.settings', JSON.stringify({ autoQuality: false, quality: q })), process.argv[2] ?? 'high');
await p.goto('http://localhost:4173/');
await p.waitForSelector('#title:not(.hidden)', { timeout: 180000 });
await p.click('[data-testid=new-game]');
await p.click('[data-testid=body-male]');
await p.waitForFunction(() => window.__UA?.ready, null, { timeout: 180000 });
const r = await p.evaluate((sortByCount) => {
  const g = window.__UA; g.paused = true; window.__sortByCount = sortByCount;
  for (let i = 0; i < 5; i++) g.update(1 / 30);
  const rows = [];
  g.scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry; const idx = geo.index ? geo.index.count : geo.attributes.position.count;
    const n = o.isInstancedMesh ? o.count : 1;
    rows.push([(o.name || o.parent?.name || '?') + '|' + (Array.isArray(o.material) ? 'multi' : o.material.name), Math.round(idx / 3 * n), 1]);
  });
  const agg = {};
  for (const [k, t, n] of rows) { agg[k] = agg[k] || [0, 0]; agg[k][0] += t; agg[k][1] += n; }
  return Object.entries(agg).sort((a, b) => (window.__sortByCount ? b[1][1] - a[1][1] : b[1][0] - a[1][0])).slice(0, 25).concat([['TOTAL', [rows.length, rows.length]]]);
}, process.argv[3] === 'count');
for (const x of r) console.log(x[1][0], x[1][1], x[0]);
await b.close();
process.exit(0);
