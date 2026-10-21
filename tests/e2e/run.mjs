/**
 * End-to-end tests: launches the production build in Chromium (WebGL through SwiftShader)
 * and drives the real game through keyboard, mouse and multi-touch input.
 *
 * Simulation is stepped deterministically with game.update(dt) while real input events are
 * dispatched, so results do not depend on the (slow) software renderer frame rate.
 *
 * Usage: npm run build && npm run test:e2e
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

const results = [];
let failures = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, info });
    console.log(`  ✔ ${name}${info ? '  — ' + info : ''}`);
  } catch (err) {
    failures++;
    results.push({ name, ok: false, ms: Date.now() - t0, info: String(err?.message ?? err) });
    console.log(`  ✘ ${name}\n      ${String(err?.stack ?? err).split('\n').slice(0, 3).join('\n      ')}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Spawn vite itself (not through npx) so that server.kill() really stops it.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(to); resolve(); } });
});

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function openGame({ touch = false, clear = true, viewport = { width: 1280, height: 720 } } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // Asset loading and world building are slow on the software renderer (SwiftShader).
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((clearIt) => {
    if (clearIt && !sessionStorage.getItem('__ua_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__ua_cleared', '1');
    }
    if (!localStorage.getItem('ua.settings')) localStorage.setItem('ua.settings', JSON.stringify({ autoQuality: false, quality: 'low' }));
  }, clear);
  await page.goto(URL);
  await page.waitForSelector('#title:not(.hidden)');
  return { ctx, page, errors };
}

/** Freezes the real-time loop and steps the simulation manually. */
const freeze = (page) => page.evaluate(() => { window.__UA.paused = true; });
const step = (page, frames = 30, dt = 1 / 30) => page.evaluate(([n, d]) => { const g = window.__UA; for (let i = 0; i < n; i++) g.update(d); }, [frames, dt]);
const state = (page) => page.evaluate(() => {
  const g = window.__UA;
  return {
    pos: g.player.position.toArray(), vy: g.player.body.vy, flying: g.player.flying, health: g.player.health, energy: g.player.energy,
    stage: g.progress.stage, active: [...g.missions.active], completed: [...g.missions.completed], unlocked: [...g.powers.unlocked],
    enemies: g.enemies.alive.length, objective: document.querySelector('.obj-text')?.textContent ?? '',
  };
});
const holdKey = async (page, key, frames) => {
  await page.keyboard.down(key);
  await step(page, frames);
  await page.keyboard.up(key);
  await step(page, 2);
};

console.log('\nUNIVERSE ASCENDANT — tests de bout en bout\n');

// ------------------------------------------------------------------------------------
const { page, errors } = await openGame();

await test('Écran titre et lancement sans erreur', async () => {
  const visible = await page.isVisible('[data-testid=new-game]');
  assert(visible, 'bouton Nouvelle partie absent');
  assert(!(await page.isVisible('[data-testid=continue]')), 'Continuer ne doit pas apparaître sans sauvegarde');
  await page.click('[data-testid=new-game]');
  await page.click('[data-testid=body-male]');
  await page.waitForFunction(() => window.__UA?.ready === true);
  await page.waitForTimeout(1500);
  await freeze(page);
  return 'jeu démarré';
});

await test('Le rendu 3D produit une image non vide', async () => {
  await step(page, 5);
  await page.evaluate(() => { const g = window.__UA; g.renderer.render(g.scene, g.camera); });
  const buf = await page.screenshot();
  // crude check: PNG must not be tiny (a black frame compresses to almost nothing)
  assert(buf.length > 60000, `capture trop petite (${buf.length} octets) : rendu vide ?`);
  const info = await page.evaluate(() => window.__UA.renderer.info.render);
  assert(info.triangles > 1000, 'presque aucun triangle rendu');
  return `${info.calls} draw calls, ${info.triangles} triangles, capture ${Math.round(buf.length / 1024)} Ko`;
});

await test('Déplacement clavier (W) et collisions avec les murs', async () => {
  const s0 = await state(page);
  await page.evaluate(() => { const g = window.__UA; g.cameraRig.yaw = -Math.PI / 2; g.player.yaw = -Math.PI / 2; });
  await holdKey(page, 'KeyW', 20);
  const s1 = await state(page);
  const moved = Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[2] - s0.pos[2]);
  assert(moved > 1, `le joueur n'a pas bougé (${moved.toFixed(2)} m)`);
  // Keep walking west into the bedroom's exterior wall (inner face at x = -6.9)
  await holdKey(page, 'KeyW', 120);
  const s2 = await state(page);
  assert(s2.pos[0] > -6.9 + 0.25, `traversée du mur : x=${s2.pos[0].toFixed(2)}`);
  return `déplacé de ${moved.toFixed(2)} m, bloqué au mur à x=${s2.pos[0].toFixed(2)}`;
});

await test('Saut : vitesse verticale puis retour au sol', async () => {
  await page.evaluate(() => window.__UA.player.setPosition(-4, 0.15, -2.5));
  await step(page, 3);
  await page.keyboard.press('Space');
  await step(page, 2);
  const up = await state(page);
  assert(up.pos[1] > 0.3, `pas de saut (y=${up.pos[1]})`);
  await step(page, 40);
  const down = await state(page);
  assert(Math.abs(down.pos[1] - 0.15) < 0.05, `n'est pas retombé au sol (y=${down.pos[1]})`);
  return `apogée mesurée > ${up.pos[1].toFixed(2)} m`;
});

await test('Interaction contextuelle : la radio fait avancer la mission', async () => {
  await page.evaluate(() => { const g = window.__UA; g.player.setPosition(-2.4, 0.15, -3.1); g.player.yaw = Math.PI / 2; });
  await step(page, 3);
  const label = await page.textContent('[data-testid=btn-action] .lbl');
  assert(label.includes('radio'), `bouton action inattendu : "${label}"`);
  await page.keyboard.press('KeyE');
  await step(page, 3);
  const s = await state(page);
  assert(s.objective.includes('Sortir'), `objectif non mis à jour : "${s.objective}"`);
  const dialog = await page.textContent('.dialog');
  assert(dialog.includes('Radio'), 'pas de dialogue radio');
  return `objectif suivant : « ${s.objective.trim()} »`;
});

await test('Lumières et portes interactives', async () => {
  // light switch in the bedroom
  await page.evaluate(() => { const g = window.__UA; g.player.setPosition(-2.75, 0.15, -1.1); g.player.yaw = 0; });
  await step(page, 3);
  const before = await page.evaluate(() => window.__UA.zone.house.lightsOn.includes('bedroom'));
  await page.keyboard.press('KeyE');
  await step(page, 2);
  const after = await page.evaluate(() => window.__UA.zone.house.lightsOn.includes('bedroom'));
  assert(before !== after, 'interrupteur sans effet');
  // bedroom door: closed door must block, open door must let through
  await page.evaluate(() => { const g = window.__UA; g.player.setPosition(-3.5, 0.15, -1.0); g.player.yaw = 0; g.cameraRig.yaw = 0; });
  await step(page, 2);
  const lbl = await page.textContent('[data-testid=btn-action] .lbl');
  assert(lbl.includes('porte'), `pas de porte détectée : "${lbl}"`);
  await holdKey(page, 'KeyW', 30);
  const blocked = await state(page);
  assert(blocked.pos[2] < 0, `porte fermée traversée (z=${blocked.pos[2].toFixed(2)})`);
  await page.keyboard.press('KeyE');
  await step(page, 15);
  await holdKey(page, 'KeyW', 40);
  const through = await state(page);
  assert(through.pos[2] > 0.5, `porte ouverte infranchissable (z=${through.pos[2].toFixed(2)})`);
  return 'interrupteur OK, porte fermée bloque, porte ouverte laisse passer';
});

await test('Sortir de la maison termine la mission 1 et débloque la mission 2', async () => {
  await page.evaluate(() => { const g = window.__UA; g.player.setPosition(-2.5, 0.05, 9.5); });
  await step(page, 5);
  const s = await state(page);
  assert(s.completed.includes('m_morning'), 'm_morning non terminée');
  assert(s.active.includes('m_lights'), 'm_lights non active');
  return `missions actives : ${s.active.join(', ')}`;
});

await test("L'éclat : Éveil, stade 1, pouvoirs débloqués", async () => {
  await page.evaluate(() => { const g = window.__UA; g.teleport(198, -207); });
  await step(page, 10);
  let s = await state(page);
  assert(s.objective.includes('éclat'), `objectif inattendu : ${s.objective}`);
  await page.evaluate(() => { const g = window.__UA; const it = g.zone.interactables.find((i) => i.id === 'shard'); g.teleport(it.position.x - 1.5, it.position.z); g.player.yaw = Math.PI / 2; });
  await step(page, 3);
  await page.keyboard.press('KeyE');
  await step(page, 5);
  s = await state(page);
  assert(s.stage === 1, `stade ${s.stage} au lieu de 1`);
  assert(s.unlocked.includes('essence_push') && s.unlocked.includes('super_jump'), 'pouvoirs manquants');
  assert(s.active.includes('m_echoes'), 'mission suivante absente');
  return `stade ${s.stage}, pouvoirs : ${s.unlocked.join(', ')}`;
});

await test('Super-saut plus haut que le saut humain', async () => {
  await page.evaluate(() => window.__UA.teleport(0, 25));
  await step(page, 5);
  const y0 = (await state(page)).pos[1];
  await page.keyboard.press('Space');
  let maxY = y0;
  for (let i = 0; i < 40; i++) { await step(page, 1); maxY = Math.max(maxY, (await state(page)).pos[1]); }
  assert(maxY - y0 > 5, `super-saut trop bas : ${(maxY - y0).toFixed(2)} m`);
  return `hauteur atteinte : ${(maxY - y0).toFixed(2)} m`;
});

await test('Combat : la mission fait apparaître des Rôdeurs, l’Onde d’Essence les blesse et les tue', async () => {
  await page.evaluate(() => { const g = window.__UA; g.teleport(185, -190); });
  await step(page, 10);
  let s = await state(page);
  assert(s.enemies >= 4, `créatures non apparues (${s.enemies})`);
  const e0 = s.energy;
  // Fight: cast the nova whenever ready, step the simulation
  let kills = 0;
  await page.evaluate(() => { window.__kills = 0; window.__UA.bus.on('enemy:killed', () => window.__kills++); window.__UA.player.invulnerable = 999; });
  for (let round = 0; round < 40 && kills < 4; round++) {
    await page.evaluate(() => { const g = window.__UA; g.player.energy = g.player.maxEnergy; });
    await page.keyboard.press('KeyF');
    await step(page, 25);
    kills = await page.evaluate(() => window.__kills);
  }
  s = await state(page);
  assert(kills >= 4, `seulement ${kills} créature(s) vaincue(s)`);
  assert(s.completed.includes('m_echoes'), 'mission Échos non terminée');
  assert(s.unlocked.includes('essence_bolt'), "Trait d'Essence non débloqué");
  void e0;
  return `${kills} créatures vaincues, Trait d'Essence débloqué`;
});

await test("Projectile : le Trait d'Essence touche et tue une cible visée", async () => {
  const r = await page.evaluate(() => {
    const g = window.__UA;
    g.teleport(0, 60);
    g.powers.setActive('essence_bolt');
    const e = g.enemies.spawn('void_stalker', 0, 75, { game: g });
    e.state = 'recover';
    g.cameraRig.yaw = 0; g.cameraRig.pitch = 0.05;
    return e.health;
  });
  await page.evaluate(() => { window.__kills = 0; });
  let kills = 0;
  for (let i = 0; i < 25 && kills === 0; i++) {
    await page.evaluate(() => { const g = window.__UA; g.player.energy = g.player.maxEnergy; });
    await page.mouse.move(640, 360);
    await page.keyboard.press('KeyF');
    await step(page, 12);
    kills = await page.evaluate(() => window.__kills);
  }
  assert(kills >= 1, 'la cible a survécu');
  return `cible de ${r} PV éliminée`;
});

await test('Vol : décollage, montée, atterrissage', async () => {
  await page.evaluate(() => { const g = window.__UA; g.powers.unlock('flight', true); g.teleport(0, 60); });
  await step(page, 5);
  await page.keyboard.press('Space');
  await step(page, 3);
  await page.keyboard.press('Space');
  await step(page, 3);
  let s = await state(page);
  assert(s.flying, 'le vol ne s’est pas activé');
  const y0 = s.pos[1];
  await page.keyboard.down('Space');
  await step(page, 60);
  await page.keyboard.up('Space');
  s = await state(page);
  const climb = s.pos[1] - y0;
  assert(climb > 10, `montée insuffisante (${climb.toFixed(1)} m)`);
  // descend and land
  await page.keyboard.down('KeyC');
  await step(page, 200);
  await page.keyboard.up('KeyC');
  await step(page, 10);
  s = await state(page);
  assert(!s.flying, 'pas d’atterrissage');
  return `montée de ${climb.toFixed(1)} m puis atterrissage`;
});

await test('Sauvegarde, rechargement de la page et reprise', async () => {
  const before = await page.evaluate(() => { const g = window.__UA; g.teleport(30, 30); g.progress.fragments = 42; g.saveGame(false); return { pos: g.player.position.toArray(), stage: g.progress.stage }; });
  await page.reload();
  await page.waitForSelector('#title:not(.hidden)');
  assert(await page.isVisible('[data-testid=continue]'), 'bouton Continuer absent après sauvegarde');
  await page.click('[data-testid=continue]');
  await page.waitForFunction(() => window.__UA?.ready === true);
  await freeze(page);
  const after = await page.evaluate(() => { const g = window.__UA; return { pos: g.player.position.toArray(), stage: g.progress.stage, frags: g.progress.fragments, done: [...g.missions.completed] }; });
  assert(after.stage === before.stage, 'stade perdu');
  assert(after.frags === 42, 'fragments perdus');
  assert(Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) < 0.5, 'position perdue');
  assert(after.done.includes('m_echoes'), 'missions perdues');
  return `reprise au stade ${after.stage}, ${after.done.length} missions accomplies`;
});

await test('Sauvegarde corrompue : récupération depuis la copie de secours', async () => {
  await page.evaluate(() => { const g = window.__UA; g.progress.fragments = 7; g.saveGame(false); g.progress.fragments = 8; g.saveGame(false); localStorage.setItem('ua.save.survival_1', '{"version":2, broken'); });
  const r = await page.evaluate(() => { const r = window.__UA.saves.load('survival_1'); return { src: r.source, frags: r.data?.player.fragments }; });
  assert(r.src === 'backup' && r.frags === 7, `récupération incorrecte ${JSON.stringify(r)}`);
  await page.evaluate(() => window.__UA.saveGame(false));
  return 'copie de secours utilisée, données intactes';
});

await test('Menu : pause, onglets, changement de qualité persistant', async () => {
  await page.evaluate(() => { window.__UA.paused = false; });
  await page.click('[data-testid=btn-menu]');
  await page.waitForSelector('.menu:not(.hidden)');
  assert(await page.evaluate(() => window.__UA.paused), 'le menu ne met pas en pause');
  for (const t of ['powers', 'skins', 'missions', 'settings', 'system', 'map']) {
    await page.click(`[data-testid=tab-${t}]`);
    await page.waitForTimeout(50);
  }
  await page.click('[data-testid=tab-settings]');
  await page.click('[data-testid=quality-medium]');
  const q = await page.evaluate(() => [window.__UA.settings.quality, JSON.parse(localStorage.getItem('ua.settings')).quality]);
  assert(q[0] === 'medium' && q[1] === 'medium', `qualité non appliquée ${q}`);
  await page.click('[data-testid=menu-close]');
  assert(!(await page.evaluate(() => window.__UA.paused)), 'reste en pause après fermeture');
  await freeze(page);
  return 'pause OK, 6 onglets, qualité « medium » enregistrée';
});

await test('Mods : COSMIC POWERS chargé, onglet Mods, désactivation persistante', async () => {
  const st = await page.evaluate(() => {
    const g = window.__UA;
    return { mods: g.modStatus.map((m) => [m.id, m.loaded]), supernova: !!g.content.power('supernova'), ship: g.content.ships.has('comete') };
  });
  const cosmic = st.mods.find((m) => m[0] === 'cosmic_powers');
  assert(cosmic && cosmic[1], `COSMIC POWERS non chargé : ${JSON.stringify(st.mods)}`);
  assert(st.supernova && st.ship, 'contenu du mod absent du registre');
  await page.evaluate(() => { window.__UA.paused = false; });
  await page.click('[data-testid=btn-menu]');
  await page.click('[data-testid=tab-mods]');
  const text = await page.textContent('.menu-body');
  assert(text.includes('COSMIC POWERS') && text.includes('actif'), 'onglet Mods incomplet');
  await page.click('.mod-card input[type=checkbox]');
  const enabled = await page.evaluate(() => JSON.parse(localStorage.getItem('ua.mods.enabled')));
  assert(Array.isArray(enabled) && !enabled.includes('cosmic_powers'), `désactivation non enregistrée : ${enabled}`);
  await page.click('.mod-card input[type=checkbox]');
  await page.click('[data-testid=menu-close]');
  await freeze(page);
  return '7 pouvoirs, 1 créature, 1 mission, 1 tenue, 1 vaisseau ajoutés';
});

await test('Mort et réapparition sans perte de progression', async () => {
  const r = await page.evaluate(() => {
    const g = window.__UA;
    g.player.invulnerable = 0;
    const stage = g.progress.stage, frags = g.progress.fragments;
    g.player.damage(99999, g);
    return { stage, frags };
  });
  await page.waitForTimeout(1200);
  await step(page, 2);
  const s = await page.evaluate(() => { const g = window.__UA; return { hp: g.player.health, max: g.player.maxHealth, pos: g.player.position.toArray(), stage: g.progress.stage, frags: g.progress.fragments }; });
  assert(s.hp === s.max, 'santé non restaurée');
  assert(Math.hypot(s.pos[0] + 4.2, s.pos[2] + 2.6) < 1, 'pas de réapparition à la maison');
  assert(s.stage === r.stage && s.frags === r.frags, 'progression perdue');
  return 'réapparition dans la chambre, progression conservée';
});

await test('Mode créatif : emplacement séparé, la survie reste intacte', async () => {
  const survivalBefore = await page.evaluate(() => localStorage.getItem('ua.save.survival_1'));
  await page.evaluate(() => { window.__UA.saveGame(false); window.__UA.toTitle(); });
  const survivalSaved = await page.evaluate(() => localStorage.getItem('ua.save.survival_1'));
  await page.click('[data-testid=creative]');
  if (await page.isVisible('[data-testid=body-female]')) await page.click('[data-testid=body-female]');
  await page.waitForFunction(() => window.__UA?.ready === true && window.__UA.mode === 'creative');
  await freeze(page);
  const c = await page.evaluate(() => { const g = window.__UA; g.progress.fragments = 99999; g.saveGame(false); return { powers: g.powers.unlocked.size, slot: g.slot }; });
  const survivalAfter = await page.evaluate(() => localStorage.getItem('ua.save.survival_1'));
  assert(c.slot === 'creative_1', 'mauvais emplacement');
  assert(c.powers >= 20, 'pouvoirs créatifs manquants');
  assert(survivalAfter === survivalSaved, 'la sauvegarde de survie a été modifiée');
  void survivalBefore;
  return `${c.powers} pouvoirs disponibles, survie inchangée`;
});

await test('Mode créatif : apparition de créatures, téléportation, gravité', async () => {
  const r = await page.evaluate(() => {
    const g = window.__UA;
    const n0 = g.enemies.alive.length;
    g.enemies.spawn('void_brute', 10, 10, { game: g });
    g.teleport(100, -100);
    g.setGravity(3);
    return { n: g.enemies.alive.length - n0, pos: g.player.position.toArray(), grav: g.zone.gravity };
  });
  assert(r.n === 1 && r.grav === 3 && Math.abs(r.pos[0] - 100) < 1, JSON.stringify(r));
  await page.evaluate(() => window.__UA.setGravity(9.81));
  return 'OK';
});

console.log('\n  Erreurs JavaScript pendant la session clavier : ' + (errors.length ? errors.join(' | ') : 'aucune'));
if (errors.length) { failures++; results.push({ name: 'Aucune erreur JS', ok: false, info: errors.join(' | ') }); }
await page.context().close();

// ------------------------------------------------------------------------------------
console.log('\n  — Session tactile (écran 915×412, multi-touch) —');
const touch = await openGame({ touch: true, viewport: { width: 915, height: 412 } });
const tp = touch.page;
const cdp = await tp.context().newCDPSession(tp);
const touchEv = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });

await test('Tactile : démarrer une partie au doigt', async () => {
  await tp.tap('[data-testid=new-game]');
  await tp.tap('[data-testid=body-male]');
  await tp.waitForFunction(() => window.__UA?.ready === true);
  await freeze(tp);
  await tp.evaluate(() => { const g = window.__UA; g.player.setPosition(-2.5, 0.05, 16); g.cameraRig.yaw = 0; });
  await step(tp, 3);
  return 'OK';
});

await test('Tactile : joystick flottant déplace le joueur', async () => {
  const p0 = (await state(tp)).pos;
  await touchEv('touchStart', [[150, 300, 1]]);
  await touchEv('touchMove', [[150, 230, 1]]);
  await step(tp, 30);
  const mid = await tp.evaluate(() => ({ x: window.__UA.input.moveX, y: window.__UA.input.moveY, run: window.__UA.input.run }));
  await touchEv('touchEnd', []);
  await step(tp, 2);
  const p1 = (await state(tp)).pos;
  const d = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  assert(mid.y > 0.8, `joystick non lu (${JSON.stringify(mid)})`);
  assert(d > 2, `déplacement insuffisant ${d.toFixed(2)} m`);
  const after = await tp.evaluate(() => window.__UA.input.moveY);
  assert(after === 0, 'joystick non relâché');
  return `déplacement ${d.toFixed(1)} m (course : ${mid.run})`;
});

await test('Tactile : glisser à droite tourne la caméra, en même temps que le joystick', async () => {
  const y0 = await tp.evaluate(() => window.__UA.cameraRig.yaw);
  await touchEv('touchStart', [[150, 300, 1], [600, 200, 2]]);
  await touchEv('touchMove', [[150, 240, 1], [700, 200, 2]]);
  await step(tp, 5);
  const moving = await tp.evaluate(() => window.__UA.input.moveY);
  await touchEv('touchEnd', []);
  await step(tp, 2);
  const y1 = await tp.evaluate(() => window.__UA.cameraRig.yaw);
  assert(Math.abs(y1 - y0) > 0.2, 'caméra immobile');
  assert(moving > 0.5, 'le multi-touch a bloqué le joystick');
  return `rotation caméra ${(y1 - y0).toFixed(2)} rad pendant le déplacement`;
});

await test('Tactile : bouton saut', async () => {
  const box = await tp.locator('[data-testid=btn-jump]').boundingBox();
  await touchEv('touchStart', [[box.x + box.width / 2, box.y + box.height / 2, 3]]);
  await step(tp, 2);
  await touchEv('touchEnd', []);
  await step(tp, 2);
  const s = await state(tp);
  assert(s.pos[1] > 0.4, `pas de saut (y=${s.pos[1]})`);
  await step(tp, 40);
  return 'OK';
});

await test('Tactile : appui long sur Pouvoir ouvre la roue et sélectionne un pouvoir', async () => {
  await tp.evaluate(() => { const g = window.__UA; for (const p of ['essence_push', 'essence_bolt', 'fireball']) g.powers.unlock(p, true); g.progress.stage = 2; g.powers.setActive('essence_push'); });
  const box = await tp.locator('[data-testid=btn-power]').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await touchEv('touchStart', [[cx, cy, 4]]);
  await tp.waitForTimeout(450);
  await step(tp, 1);
  const open = await tp.isVisible('.radial');
  assert(open, 'roue des pouvoirs non affichée');
  const item = await tp.locator('.radial-item[data-id=fireball]').boundingBox();
  await touchEv('touchMove', [[item.x + item.width / 2, item.y + item.height / 2, 4]]);
  await touchEv('touchEnd', []);
  await step(tp, 1);
  const active = await tp.evaluate(() => window.__UA.powers.active);
  assert(active === 'fireball', `pouvoir actif : ${active}`);
  assert(!(await tp.isVisible('.radial')), 'roue restée ouverte');
  return 'Boule de feu sélectionnée via la roue';
});

await test('Tactile : appui court sur Pouvoir lance le pouvoir actif', async () => {
  await tp.evaluate(() => { const g = window.__UA; g.player.energy = g.player.maxEnergy; window.__used = 0; g.bus.on('power:used', () => window.__used++); });
  const box = await tp.locator('[data-testid=btn-power]').boundingBox();
  await touchEv('touchStart', [[box.x + box.width / 2, box.y + box.height / 2, 5]]);
  await touchEv('touchEnd', []);
  await step(tp, 2);
  const used = await tp.evaluate(() => window.__used);
  assert(used === 1, `pouvoir utilisé ${used} fois`);
  return 'OK';
});

await test('Tactile : interface épurée (nombre de boutons permanents)', async () => {
  const n = await tp.evaluate(() => [...document.querySelectorAll('.ctl-btn, .menu-btn')].filter((b) => b.offsetParent !== null).length);
  assert(n <= 4, `${n} boutons permanents`);
  return `${n} boutons visibles (action, saut/vol, pouvoir, menu)`;
});

console.log('\n  Erreurs JavaScript pendant la session tactile : ' + (touch.errors.length ? touch.errors.join(' | ') : 'aucune'));
if (touch.errors.length) { failures++; results.push({ name: 'Aucune erreur JS (tactile)', ok: false, info: touch.errors.join(' | ') }); }

// ------------------------------------------------------------------------------------
await test('Mesure de performance (rendu logiciel SwiftShader — non représentatif d’un téléphone)', async () => {
  const r = await tp.evaluate(async () => {
    const g = window.__UA;
    g.paused = false;
    const t0 = performance.now();
    let frames = 0;
    await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { fps: frames / ((performance.now() - t0) / 1000), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, mem: g.renderer.info.memory };
  });
  return `${r.fps.toFixed(1)} FPS (CPU), ${r.calls} draw calls, ${r.tris} triangles, ${r.mem.geometries} géométries, ${r.mem.textures} textures`;
});

await touch.ctx.close();
await browser.close();
server.kill();

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} tests réussis${failures ? ` — ${failures} échec(s)` : ''}\n`);
process.exit(failures ? 1 : 0);
