import type { Game } from '../Game';
import { escapeHtml } from './Hud';
import { STAGE_NAMES } from '../content/basePack';
import type { PowerCategory } from '../content/types';
import { QUALITY_ORDER, type Settings } from '../core/Settings';
import { WEATHER_NAMES, type WeatherKind } from '../world/EarthSky';

export type MenuTab = 'map' | 'powers' | 'skins' | 'missions' | 'creative' | 'settings' | 'system';

const TAB_LABELS: Record<MenuTab, string> = {
  map: 'Carte', powers: 'Pouvoirs', skins: 'Tenues', missions: 'Missions', creative: 'Créatif', settings: 'Réglages', system: 'Partie',
};

const CATEGORY_LABELS: Record<PowerCategory, string> = {
  physical: 'Physiques', movement: 'Déplacement', elemental: 'Élémentaires', psychic: 'Psychiques', cosmic: 'Cosmiques', divine: 'Divins',
};

/** Pause menu. Every control here is wired to a real system. */
export class Menu {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  tab: MenuTab = 'map';
  isOpen = false;
  private mapRaf = 0;

  constructor(container: HTMLElement, private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'menu hidden';
    this.root.innerHTML = `
      <div class="menu-panel">
        <div class="menu-head"><div class="menu-tabs"></div><button class="close" data-testid="menu-close" aria-label="Fermer">✕</button></div>
        <div class="menu-body"></div>
      </div>`;
    container.appendChild(this.root);
    this.body = this.root.querySelector('.menu-body')!;
    this.tabsEl = this.root.querySelector('.menu-tabs')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private tabs(): MenuTab[] {
    const t: MenuTab[] = ['map', 'powers', 'skins', 'missions'];
    if (this.game.mode === 'creative') t.push('creative');
    t.push('settings', 'system');
    return t;
  }

  open(tab?: MenuTab) {
    if (tab) this.tab = tab;
    if (!this.tabs().includes(this.tab)) this.tab = 'map';
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.game.setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  }

  close() {
    this.isOpen = false;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.mapRaf);
    this.game.applySettings();
    this.game.setPaused(false);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  render() {
    this.tabsEl.innerHTML = '';
    for (const t of this.tabs()) {
      const b = document.createElement('button');
      b.textContent = TAB_LABELS[t];
      b.className = t === this.tab ? 'active' : '';
      b.dataset.testid = 'tab-' + t;
      b.addEventListener('click', () => { this.tab = t; this.game.audio.play('ui'); this.render(); });
      this.tabsEl.appendChild(b);
    }
    cancelAnimationFrame(this.mapRaf);
    this.body.innerHTML = '';
    switch (this.tab) {
      case 'map': this.renderMap(); break;
      case 'powers': this.renderPowers(); break;
      case 'skins': this.renderSkins(); break;
      case 'missions': this.renderMissions(); break;
      case 'creative': this.renderCreative(); break;
      case 'settings': this.renderSettings(); break;
      case 'system': this.renderSystem(); break;
    }
  }

  // --------------------------------------------------------------------- map
  private renderMap() {
    const g = this.game;
    const wrap = document.createElement('div');
    wrap.className = 'map-wrap';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    canvas.className = 'map';
    wrap.appendChild(canvas);
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    wrap.appendChild(legend);
    this.body.appendChild(wrap);
    const ctx = canvas.getContext('2d')!;
    const base = g.mapImage();
    const ext = g.zone.mapExtent;
    const toPx = (x: number, z: number) => [((x + ext) / (2 * ext)) * 512, ((z + ext) / (2 * ext)) * 512];
    const markers = g.zone.mapMarkers();
    legend.innerHTML = `<b>${escapeHtml(g.zone.name)}</b>` + markers.map((m) => `<span><i style="background:${m.color}"></i>${escapeHtml(m.label)}</span>`).join('') + '<span><i style="background:#ffd23f"></i>Objectif</span>';
    if (g.mode === 'creative') legend.innerHTML += '<em>Touchez la carte pour vous téléporter.</em>';
    canvas.addEventListener('click', (e) => {
      if (g.mode !== 'creative') return;
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * ext - ext;
      const z = ((e.clientY - r.top) / r.height) * 2 * ext - ext;
      g.teleport(x, z);
      this.close();
    });
    const draw = () => {
      if (base) ctx.drawImage(base, 0, 0, 512, 512);
      else { ctx.fillStyle = '#0a0d18'; ctx.fillRect(0, 0, 512, 512); }
      for (const m of markers) {
        const [x, y] = toPx(m.x, m.z);
        ctx.fillStyle = m.color;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      for (const v of g.missions.views()) {
        if (!v.marker) continue;
        const [x, y] = toPx(v.marker.x, v.marker.z);
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 9 + Math.sin(performance.now() / 200) * 2, 0, Math.PI * 2); ctx.stroke();
      }
      for (const e of g.enemies.alive) {
        if (g.powers.scanTime <= 0 && e.position.distanceTo(g.player.position) > 40) continue;
        const [x, y] = toPx(e.position.x, e.position.z);
        ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      const [px, py] = toPx(g.player.position.x, g.player.position.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-g.player.yaw + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      this.mapRaf = requestAnimationFrame(draw);
    };
    draw();
  }

  // --------------------------------------------------------------------- powers
  private renderPowers() {
    const g = this.game;
    const info = document.createElement('div');
    info.className = 'info-line';
    info.innerHTML = `Stade : <b>${escapeHtml(g.progress.stageName)}</b> · Fragments d'Essence : <b>◆ ${g.progress.fragments}</b> · ★ = favori (menu radial, max 8)`;
    this.body.appendChild(info);
    const byCat = new Map<PowerCategory, string[]>();
    for (const p of g.content.powers.values()) {
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category)!.push(p.id);
    }
    for (const [cat, ids] of byCat) {
      const h = document.createElement('h3');
      h.textContent = CATEGORY_LABELS[cat];
      this.body.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      for (const id of ids) {
        const p = g.content.power(id)!;
        const owned = g.powers.unlocked.has(id);
        const card = document.createElement('div');
        card.className = 'card power' + (owned ? '' : ' locked') + (g.powers.active === id ? ' active' : '');
        card.style.setProperty('--c', p.color);
        const visible = owned || p.unlockStage <= g.progress.stage + 1;
        const castable = p.behavior.type !== 'passive';
        const fav = g.powers.favorites.includes(id);
        const cost = g.powers.upgradeCost(id);
        const origin = g.content.origin.get('power:' + id);
        card.innerHTML = `
          <div class="p-icon">${visible ? escapeHtml(p.icon) : '?'}</div>
          <div class="p-body">
            <div class="p-name">${visible ? escapeHtml(p.name) : '???'} ${owned && castable ? `<small>Niv. ${g.powers.level(id)}</small>` : ''}${origin && origin !== 'base' ? ' <small class="mod-tag">mod</small>' : ''}</div>
            <div class="p-desc">${visible ? escapeHtml(p.description) : `Se débloque au stade « ${STAGE_NAMES[p.unlockStage]} ».`}</div>
            ${owned ? `<div class="p-meta">${castable ? `Essence ${p.energyCost} · Recharge ${p.cooldown}s` : 'Passif — toujours actif'}</div>` : ''}
          </div>`;
        if (owned && castable) {
          const actions = document.createElement('div');
          actions.className = 'p-actions';
          const favBtn = document.createElement('button');
          favBtn.textContent = fav ? '★' : '☆';
          favBtn.title = 'Favori';
          favBtn.addEventListener('click', () => {
            if (fav) g.powers.favorites = g.powers.favorites.filter((f) => f !== id);
            else if (g.powers.favorites.length < 8) g.powers.favorites.push(id);
            else g.hud.toast('8 favoris maximum');
            this.render();
          });
          const useBtn = document.createElement('button');
          useBtn.textContent = g.powers.active === id ? 'Équipé' : 'Équiper';
          useBtn.dataset.testid = 'equip-' + id;
          useBtn.addEventListener('click', () => { g.powers.setActive(id); this.render(); });
          actions.append(favBtn, useBtn);
          if (cost !== null) {
            const up = document.createElement('button');
            up.textContent = `Améliorer ◆${cost}`;
            up.disabled = g.mode !== 'creative' && g.progress.fragments < cost;
            up.addEventListener('click', () => { if (g.powers.upgrade(id)) this.render(); });
            actions.appendChild(up);
          }
          card.appendChild(actions);
        }
        grid.appendChild(card);
      }
      this.body.appendChild(grid);
    }
  }

  // --------------------------------------------------------------------- skins
  private renderSkins() {
    const g = this.game;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const s of g.content.skins.values()) {
      const unlocked = s.unlockStage <= g.progress.stage;
      const card = document.createElement('div');
      card.className = 'card skin' + (unlocked ? '' : ' locked') + (g.skinId === s.id ? ' active' : '');
      card.innerHTML = `
        <div class="swatches">${[s.suit, s.accent, s.skin, s.hair, s.aura].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
        <div class="p-name">${escapeHtml(s.name)}</div>
        <div class="p-desc">${unlocked ? (g.skinId === s.id ? 'Équipée' : 'Toucher pour équiper') : `Stade requis : ${escapeHtml(STAGE_NAMES[s.unlockStage])}`}</div>`;
      if (unlocked) card.addEventListener('click', () => { g.setSkin(s.id); this.render(); });
      grid.appendChild(card);
    }
    this.body.appendChild(grid);
  }

  // --------------------------------------------------------------------- missions
  private renderMissions() {
    const g = this.game;
    const views = g.missions.views();
    const h = document.createElement('h3');
    h.textContent = 'En cours';
    this.body.appendChild(h);
    if (!views.length) this.body.insertAdjacentHTML('beforeend', '<p class="muted">Aucune mission active.</p>');
    for (const v of views) {
      const m = g.content.mission(v.missionId)!;
      this.body.insertAdjacentHTML('beforeend', `<div class="card mission ${v.main ? 'main' : ''}"><div class="p-name">${v.main ? '◆ ' : ''}${escapeHtml(m.title)}</div><div class="p-desc">${escapeHtml(m.description)}</div><div class="p-meta">➤ ${escapeHtml(v.text)} ${escapeHtml(v.progress)}</div></div>`);
    }
    const h2 = document.createElement('h3');
    h2.textContent = 'Accomplies';
    this.body.appendChild(h2);
    const done = [...g.missions.completed].map((id) => g.content.mission(id)?.title).filter(Boolean);
    this.body.insertAdjacentHTML('beforeend', done.length ? `<p class="muted">${done.map((t) => '✓ ' + escapeHtml(t!)).join('<br>')}</p>` : '<p class="muted">Aucune pour le moment.</p>');
  }

  // --------------------------------------------------------------------- creative
  private renderCreative() {
    const g = this.game;
    const sec = (title: string) => { const h = document.createElement('h3'); h.textContent = title; this.body.appendChild(h); const d = document.createElement('div'); d.className = 'btn-row'; this.body.appendChild(d); return d; };
    const spawn = sec('Faire apparaître des créatures (devant toi)');
    for (const e of g.content.enemies.values()) {
      const b = document.createElement('button');
      b.textContent = e.name;
      b.addEventListener('click', () => {
        const p = g.player.position;
        const f = { x: Math.sin(g.player.yaw), z: Math.cos(g.player.yaw) };
        g.enemies.spawn(e.id, p.x + f.x * 12, p.z + f.z * 12, { game: g });
        g.hud.toast(`${e.name} est apparu`);
      });
      spawn.appendChild(b);
    }
    const props = sec('Objets physiques');
    for (const kind of ['crate', 'barrel', 'rock'] as const) {
      const b = document.createElement('button');
      b.textContent = { crate: 'Caisse', barrel: 'Baril', rock: 'Rocher' }[kind];
      b.addEventListener('click', () => {
        const p = g.player.position;
        g.props.add(kind, p.x + Math.sin(g.player.yaw) * 4, p.y + 3, p.z + Math.cos(g.player.yaw) * 4);
      });
      props.appendChild(b);
    }
    const world = sec('Monde');
    const hostile = document.createElement('button');
    hostile.textContent = g.creativeHostile ? 'Créatures : hostiles' : 'Créatures : passives';
    hostile.addEventListener('click', () => { g.creativeHostile = !g.creativeHostile; this.render(); });
    const clear = document.createElement('button');
    clear.textContent = 'Retirer toutes les créatures';
    clear.addEventListener('click', () => g.enemies.clear());
    world.append(hostile, clear);
    if (g.sky) {
      const weather = sec('Météo');
      for (const w of Object.keys(WEATHER_NAMES) as WeatherKind[]) {
        const b = document.createElement('button');
        b.textContent = WEATHER_NAMES[w];
        b.className = g.sky.weather === w ? 'active' : '';
        b.addEventListener('click', () => { g.sky!.setWeather(w); this.render(); });
        weather.appendChild(b);
      }
    }
    this.body.appendChild(this.slider('Heure du jour', 0, 23.9, 0.1, g.time, (v) => { g.time = v; }, (v) => `${Math.floor(v)}h${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`));
    this.body.appendChild(this.slider('Gravité (m/s²)', 1, 25, 0.1, g.zone.gravity, (v) => { g.setGravity(v); }, (v) => v.toFixed(1)));
    const tp = sec('Téléportation');
    for (const m of g.zone.mapMarkers()) {
      const b = document.createElement('button');
      b.textContent = m.label;
      b.addEventListener('click', () => { g.teleport(m.x, m.z); this.close(); });
      tp.appendChild(b);
    }
  }

  // --------------------------------------------------------------------- settings
  private slider(label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void, fmt = (v: number) => v.toFixed(2)): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting';
    row.innerHTML = `<span>${escapeHtml(label)}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${fmt(value)}</output>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.addEventListener('input', () => { const v = parseFloat(input.value); out.textContent = fmt(v); onChange(v); });
    return row;
  }

  private checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'setting';
    row.innerHTML = `<span>${escapeHtml(label)}</span><input type="checkbox" ${value ? 'checked' : ''}>`;
    const input = row.querySelector('input')!;
    input.addEventListener('change', () => onChange(input.checked));
    return row;
  }

  private renderSettings() {
    const g = this.game;
    const s = g.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { s[k] = v; g.saveSettings(); };
    const h = (t: string) => { const e = document.createElement('h3'); e.textContent = t; this.body.appendChild(e); };
    h('Graphismes');
    const q = document.createElement('div');
    q.className = 'btn-row';
    for (const lvl of QUALITY_ORDER) {
      const b = document.createElement('button');
      b.textContent = { low: 'Faible', medium: 'Moyen', high: 'Élevé', ultra: 'Ultra' }[lvl];
      b.className = s.quality === lvl ? 'active' : '';
      b.dataset.testid = 'quality-' + lvl;
      b.addEventListener('click', () => { set('quality', lvl); g.applyQuality(); this.render(); });
      q.appendChild(b);
    }
    this.body.appendChild(q);
    this.body.appendChild(this.checkbox('Qualité automatique (réduit les effets si le jeu ralentit)', s.autoQuality, (v) => set('autoQuality', v)));
    this.body.appendChild(this.checkbox('Afficher les FPS', s.showFps, (v) => set('showFps', v)));
    h('Contrôles');
    this.body.appendChild(this.slider('Sensibilité caméra', 0.2, 3, 0.05, s.sensitivity, (v) => set('sensitivity', v)));
    this.body.appendChild(this.checkbox('Inverser l’axe vertical', s.invertY, (v) => set('invertY', v)));
    this.body.appendChild(this.slider('Taille des commandes', 0.6, 1.6, 0.05, s.controlScale, (v) => { set('controlScale', v); g.input.applySettings(s); }));
    this.body.appendChild(this.slider('Opacité des commandes', 0.2, 1, 0.05, s.controlOpacity, (v) => { set('controlOpacity', v); g.input.applySettings(s); }));
    this.body.appendChild(this.checkbox('Mode gaucher (joystick à droite)', s.leftHanded, (v) => { set('leftHanded', v); g.input.applySettings(s); }));
    this.body.appendChild(this.checkbox('Assistance à la visée', s.aimAssist, (v) => set('aimAssist', v)));
    h('Accessibilité');
    this.body.appendChild(this.checkbox('Réduire les mouvements (pas de tremblements ni d’effet de vitesse)', s.reduceMotion, (v) => set('reduceMotion', v)));
    this.body.appendChild(this.checkbox('Interface à fort contraste', s.highContrastUi, (v) => { set('highContrastUi', v); document.body.classList.toggle('high-contrast', v); }));
    h('Son');
    this.body.appendChild(this.slider('Volume général', 0, 1, 0.05, s.masterVolume, (v) => { set('masterVolume', v); g.audio.setVolumes(s.masterVolume, s.musicVolume); }));
    this.body.appendChild(this.slider('Musique', 0, 1, 0.05, s.musicVolume, (v) => { set('musicVolume', v); g.audio.setVolumes(s.masterVolume, s.musicVolume); }));
    h('Monde');
    this.body.appendChild(this.slider('Durée d’une journée (minutes réelles)', 4, 120, 1, s.dayLengthMinutes, (v) => set('dayLengthMinutes', v), (v) => `${v} min`));
  }

  // --------------------------------------------------------------------- system
  private renderSystem() {
    const g = this.game;
    const info = document.createElement('div');
    info.className = 'info-line';
    const mins = Math.floor(g.playTime / 60);
    info.innerHTML = `Mode : <b>${g.mode === 'creative' ? 'Créatif' : 'Survie'}</b> · Temps de jeu : <b>${Math.floor(mins / 60)} h ${mins % 60} min</b> · Jour ${g.day}`;
    this.body.appendChild(info);
    const row = document.createElement('div');
    row.className = 'btn-row vertical';
    const save = document.createElement('button');
    save.textContent = 'Sauvegarder maintenant';
    save.dataset.testid = 'save-now';
    save.addEventListener('click', () => { g.saveGame(true); });
    const load = document.createElement('button');
    load.textContent = 'Recharger la dernière sauvegarde';
    load.addEventListener('click', () => { this.close(); g.reloadSave(); });
    const quit = document.createElement('button');
    quit.textContent = 'Sauvegarder et revenir au titre';
    quit.dataset.testid = 'quit-title';
    quit.addEventListener('click', () => { g.saveGame(false); this.close(); g.toTitle(); });
    row.append(save, load, quit);
    this.body.appendChild(row);
    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML = `
      <h3>Commandes</h3>
      <p><b>Tactile :</b> pouce gauche = se déplacer (pousser à fond pour courir) · glisser à droite = caméra · ✋ action/frappe · ⤒ saut (en l'air : appuyer pour voler, maintenir pour monter, double appui pour arrêter) · ✦ pouvoir (appui long = roue des pouvoirs).</p>
      <p><b>Clavier :</b> ZQSD/WASD se déplacer · Maj courir · Espace sauter/voler/monter · C descendre · E action · F ou clic gauche pouvoir · A/R ou molette changer de pouvoir · 1-8 favoris · Échap menu.</p>`;
    this.body.appendChild(help);
  }
}
