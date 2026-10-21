// Space QA tour: node tests/e2e/space.mjs <outDir>
// Grants a ship, boards it at the Observatory, leaves the atmosphere, visits the station and the
// Moon, checks zone state at each step and writes a frame of each view.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out = process.argv[2] ?? '.';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror', e.message); });
await page.addInitScript(() => localStorage.setItem('ua.settings', JSON.stringify({ autoQuality: false, quality: 'high' })));
await page.goto('http://localhost:4173/');
await page.waitForSelector('#title:not(.hidden)', { timeout: 180000 });
await page.click('[data-testid=new-game]');
await page.click('[data-testid=body-male]', { timeout: 240000 });
await page.waitForFunction(() => window.__UA?.ready, null, { timeout: 180000 });

const step = (n = 30) => page.evaluate((n) => { const g = window.__UA; for (let i = 0; i < n; i++) g.update(1 / 30); }, n);
const shot = async (name, cam) => {
  const png = await page.evaluate((cam) => {
    const g = window.__UA;
    g.hud.clearDialog();
    if (cam) { g.camera.position.set(...cam.pos); g.camera.lookAt(...cam.look); }
    if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera);
    return g.renderer.domElement.toDataURL('image/png');
  }, cam);
  writeFileSync(`${out}/space-${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
};
const state = () => page.evaluate(() => {
  const g = window.__UA;
  return { zone: g.zone.id, piloting: g.ships.piloting, ship: g.ships.currentId, pos: g.player.position.toArray().map((v) => Math.round(v)), ox: Math.round(g.player.oxygen), traveling: g.traveling };
});
const waitTravel = async () => {
  await page.waitForFunction(() => !window.__UA.traveling, null, { timeout: 120000 });
  await page.waitForTimeout(1800);
};
const check = (cond, msg) => { if (!cond) { console.log('FAIL', msg); process.exitCode = 1; } else console.log('ok  ', msg); };

await page.evaluate(() => {
  const g = window.__UA;
  g.paused = true;
  g.progress.setStage(3);
  for (const id of ['flight', 'blink']) g.powers.unlock(id);
  g.ships.grant('eclaireur');
  g.sky.setWeather('clear', true);
  g.time = 10.5;
  g.player.setPosition(-150, 1, 98);
});
await step(20);
let s = await state();
check(s.ship === 'eclaireur', 'ship granted and current');
await shot('pad', { pos: [-128, 9, 134], look: [-150, 2, 108] });
// Board through the contextual interactable
await page.evaluate(() => { const g = window.__UA; const it = g.ships.interactables[0]; it.use(g); });
await step(10);
s = await state();
check(s.piloting, 'boarded the ship');
// Climb out of the atmosphere
await page.evaluate(() => { const g = window.__UA; g.ships.position.set(-150, 2520, 110); g.ships.velocity.set(0, 40, 0); g.update(1 / 30); });
await waitTravel();
await step(10);
s = await state();
check(s.zone === 'orbit' && s.piloting, `in orbit while piloting (${JSON.stringify(s)})`);
await shot('orbit-arrival');
await shot('orbit-station', { pos: [90, 30, 150], look: [0, -10, 0] });
await shot('orbit-earth', { pos: [0, 60, 260], look: [0, -1500, -2600] });
// Land at the airlock, enter the station
await page.evaluate(() => { const g = window.__UA; g.ships.velocity.set(0, 0, 0); g.ships.disembark(g); });
await step(5);
s = await state();
check(!s.piloting, 'disembarked in orbit');
await page.evaluate(() => { const g = window.__UA; const a = g.zone.interactables.find((i) => i.id === 'airlock'); a.use(g); });
await waitTravel();
await step(10);
s = await state();
check(s.zone === 'station', `inside the station (${JSON.stringify(s)})`);
await shot('station');
// Warp to the Moon from the navigation terminal
await page.evaluate(() => { window.__UA.travel('moon', { from: 'warp', board: true }); });
await waitTravel();
await step(10);
s = await state();
check(s.zone === 'moon' && s.piloting, `on the Moon, piloting (${JSON.stringify(s)})`);
await shot('moon-arrival');
await page.evaluate(() => { const g = window.__UA; const y = g.zone.groundAt(18, 26); g.ships.position.set(18, y + 3, 26); g.ships.velocity.set(0, 0, 0); g.update(1 / 30); g.ships.disembark(g); });
await step(60);
s = await state();
check(!s.piloting && s.zone === 'moon', 'walking on the Moon');
await shot('moon-site', { pos: [-5, 14, 40], look: [-30, 9, 12] });
await shot('moon-ruins', { pos: [225, 32, -150], look: [260, 22, -190] });
await shot('moon-earth', { pos: [0, 30, 60], look: [55, 65, 136] });
await shot('moon-sun', { pos: [0, 30, 60], look: [-55, 68, -14] });
const ox = (await state()).ox;
check(ox < 100, `oxygen drains in vacuum (${ox})`);
// Back to Earth
await page.evaluate(() => { window.__UA.travel('earth', { from: 'warp', board: true }); });
await waitTravel();
await step(10);
s = await state();
check(s.zone === 'earth' && s.piloting, `back on Earth, piloting (${JSON.stringify(s)})`);
// Save round-trip keeps the ship
await page.evaluate(() => window.__UA.saveGame(false));
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ua.save.survival_1') ?? 'null')?.ships ?? null);
check(saved && saved.owned.includes('eclaireur'), `ship saved (${JSON.stringify(saved)})`);
check(errors.length === 0, `no page errors (${errors.length})`);
await b.close();
process.exit();
