// Visual QA: node tests/e2e/shots.mjs <outDir> <prefix> '<json list of {name, x,y,z, yaw, pitch, time}>'
import { chromium } from 'playwright';
const [out, prefix, json] = process.argv.slice(2);
const views = JSON.parse(json);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => localStorage.setItem('ua.settings', JSON.stringify({ autoQuality: false, quality: 'high' })));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#title:not(.hidden)', { timeout: 180000 });
await page.click('[data-testid=new-game]');
await page.click('[data-testid=body-male]');
await page.waitForFunction(() => window.__UA?.ready);
await page.evaluate(() => { const g = window.__UA; g.paused = true; g.hud.clearDialog(); document.querySelector('.controls').style.display = 'none'; });
for (const v of views) {
  await page.evaluate((v) => {
    const g = window.__UA;
    if (v.setup) new Function('g', v.setup)(g);
    g.player.setPosition(v.x, v.y, v.z);
    g.player.yaw = v.pyaw ?? v.yaw;
    g.cameraRig.yaw = v.yaw; g.cameraRig.pitch = v.pitch ?? 0.2;
    if (v.time !== undefined) g.time = v.time;
    for (let i = 0; i < 30; i++) g.update(1 / 30);
    g.hud.clearDialog();
    if (v.cam) { g.camera.position.set(...v.cam); g.camera.lookAt(...v.look); g.camera.fov = v.fov ?? 70; g.camera.updateProjectionMatrix(); }
    if (v.hidePlayer) g.player.root.visible = false;
    if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera);
    g.player.root.visible = !v.hidePlayer;
  }, v);
  console.log(v.name, JSON.stringify(await page.evaluate(() => ({ cam: window.__UA.camera.position.toArray().map((x) => +x.toFixed(2)), paused: window.__UA.paused }))));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${prefix}-${v.name}.png` });
}
await b.close();
process.exit(0);
