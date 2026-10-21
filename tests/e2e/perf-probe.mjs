// Render-cost probe (SwiftShader, CPU): node tests/e2e/perf-probe.mjs <quality>. Numbers are relative, not phone FPS.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.addInitScript((q) => localStorage.setItem('ua.settings', JSON.stringify({ autoQuality: false, quality: q })), process.argv[2] ?? 'high');
await p.goto('http://localhost:4173/');
await p.waitForSelector('#title:not(.hidden)', { timeout: 180000 });
await p.click('[data-testid=new-game]');
await p.click('[data-testid=body-male]');
await p.waitForFunction(() => window.__UA?.ready, null, { timeout: 180000 });
const r = await p.evaluate(() => {
  const g = window.__UA; g.paused = true;
  const out = {};
  for (const [name, pos] of [['house', null], ['street', [-20, 0.2, 10]], ['park', [85, 0.5, -85]], ['hills', [260, 30, -250]]]) {
    if (pos) g.player.setPosition(...pos);
    for (let i = 0; i < 5; i++) g.update(1 / 30);
    g.renderer.info.autoReset = false; g.renderer.info.reset();
    if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera); // warm-up (shader compile, uploads)
    g.renderer.getContext().finish();
    g.renderer.info.reset();
    const t = performance.now();
    if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera);
    g.renderer.getContext().finish();
    out[name] = { ms: Math.round(performance.now() - t), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
  }
  return out;
});
console.log(JSON.stringify(r));
await b.close();
process.exit(0);
