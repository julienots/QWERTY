import * as THREE from 'three';
import type { Game } from '../Game';
import type { Element } from '../content/types';

interface Line { speaker: string; text: string; dur: number }

const ELEMENT_COLORS: Partial<Record<Element, string>> = { fire: '#ff9a3c', ice: '#9fe8ff', lightning: '#e6dcff', plasma: '#ff7af0', psychic: '#d8a6ff', gravity: '#b99cff' };

/**
 * Minimal, readable HUD: compact status (top-left), current objective with distance
 * (top-centre), reticle, dialogue subtitles, toasts, banners, world-anchored texts,
 * enemy health bars and damage numbers.
 */
export class Hud {
  readonly root: HTMLElement;
  private hp: HTMLElement;
  private hpFill: HTMLElement;
  private en: HTMLElement;
  private enFill: HTMLElement;
  private stage: HTMLElement;
  private frag: HTMLElement;
  private obj: HTMLElement;
  private objTitle: HTMLElement;
  private objText: HTMLElement;
  private objDist: HTMLElement;
  private objArrow: HTMLElement;
  private reticle: HTMLElement;
  private dialog: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement;
  private vignette: HTMLElement;
  private fps: HTMLElement;
  private worldLayer: HTMLElement;
  private beacon: THREE.Mesh;
  private lines: Line[] = [];
  private lineTime = 0;
  private banners: { title: string; sub: string; color: string; icon: string }[] = [];
  private bannerTime = 0;
  private vig = 0;
  private floats: { el: HTMLElement; pos: THREE.Vector3; t: number; dur: number; rise: number }[] = [];
  private bars = new Map<object, HTMLElement>();
  private tmp = new THREE.Vector3();
  private zoneLabel: HTMLElement;
  private ox: HTMLElement;
  private oxFill: HTMLElement;
  private shipPanel: HTMLElement;

  constructor(container: HTMLElement) {
    const el = (cls: string, parent: HTMLElement, html = '') => {
      const e = document.createElement('div');
      e.className = cls;
      e.innerHTML = html;
      parent.appendChild(e);
      return e;
    };
    this.root = el('hud', container);
    const status = el('status', this.root);
    this.stage = el('stage-label', status);
    this.hp = el('bar hp', status, '<div class="fill"></div>');
    this.hpFill = this.hp.firstElementChild as HTMLElement;
    this.en = el('bar en', status, '<div class="fill"></div>');
    this.enFill = this.en.firstElementChild as HTMLElement;
    this.ox = el('bar ox hidden', status, '<div class="fill"></div>');
    this.oxFill = this.ox.firstElementChild as HTMLElement;
    this.frag = el('frag', status);
    this.zoneLabel = el('zone-label', status);
    this.obj = el('objective', this.root);
    this.objTitle = el('obj-title', this.obj);
    this.objText = el('obj-text', this.obj);
    const row = el('obj-row', this.obj);
    this.objArrow = el('obj-arrow', row, '➤');
    this.objDist = el('obj-dist', row);
    this.reticle = el('reticle', this.root);
    this.shipPanel = el('ship-panel hidden', this.root, '<b></b><div class="bar hull"><div class="fill"></div></div><span class="spd"></span>');
    this.dialog = el('dialog hidden', this.root);
    this.dialog.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.lineTime = 999; });
    this.toasts = el('toasts', this.root);
    this.bannerEl = el('banner hidden', this.root);
    this.vignette = el('vignette', this.root);
    this.fps = el('fps hidden', this.root);
    this.worldLayer = el('world-layer', this.root);

    const geo = new THREE.CylinderGeometry(0.6, 0.6, 400, 12, 1, true);
    geo.translate(0, 200, 0);
    this.beacon = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beacon.visible = false;
  }

  get beaconMesh() { return this.beacon; }

  setVisible(v: boolean) { this.root.classList.toggle('hidden', !v); }

  say(speaker: string, text: string, dur = 4) {
    this.lines.push({ speaker, text, dur: Math.max(dur, 1.5 + text.length * 0.045) });
    if (this.lines.length === 1) this.lineTime = 0;
  }

  get talking() { return this.lines.length > 0; }

  /** Drops queued lines so an interaction's text appears immediately. */
  clearDialog() {
    this.lines.length = 0;
    this.lineTime = 0;
    this.dialog.classList.add('hidden');
  }

  toast(text: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  banner(title: string, sub: string, color: string, icon: string) {
    this.banners.push({ title, sub, color, icon });
  }

  flashDamage(a: number) { this.vig = Math.min(1, this.vig + 0.35 + a); }

  floatText(pos: THREE.Vector3, text: string, cls = 'bubble', dur = 2.6) {
    if (this.floats.length > 24) return;
    const e = document.createElement('div');
    e.className = 'float ' + cls;
    e.textContent = text;
    this.worldLayer.appendChild(e);
    this.floats.push({ el: e, pos: pos.clone(), t: 0, dur, rise: cls === 'dmg' ? 1.2 : 0.3 });
  }

  damageNumber(pos: THREE.Vector3, n: number, element?: Element) {
    if (n <= 0) return;
    pos.x += (Math.random() - 0.5) * 0.6;
    this.floatText(pos, String(n), 'dmg', 0.8);
    const f = this.floats[this.floats.length - 1];
    if (f && element && ELEMENT_COLORS[element]) f.el.style.color = ELEMENT_COLORS[element]!;
  }

  private project(p: THREE.Vector3, cam: THREE.Camera): { x: number; y: number; visible: boolean } {
    this.tmp.copy(p).project(cam);
    const visible = this.tmp.z < 1 && this.tmp.z > -1 && Math.abs(this.tmp.x) < 1.2 && Math.abs(this.tmp.y) < 1.2;
    return { x: (this.tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-this.tmp.y * 0.5 + 0.5) * window.innerHeight, visible };
  }

  update(dt: number, game: Game) {
    const p = game.player;
    // Status bars
    this.hpFill.style.width = `${(100 * p.health) / p.maxHealth}%`;
    this.hp.classList.toggle('low', p.health / p.maxHealth < 0.3);
    this.hp.classList.toggle('shielded', p.shield > 0);
    const hasEnergy = p.maxEnergy > 0;
    this.en.classList.toggle('hidden', !hasEnergy);
    if (hasEnergy) this.enFill.style.width = `${(100 * p.energy) / p.maxEnergy}%`;
    // Oxygen (only relevant in vacuum)
    const showOx = p.oxygen < 99.5 || (!game.zone.hasAtmosphere && !game.ships.piloting && !game.zone.breathable?.(p.position));
    this.ox.classList.toggle('hidden', !showOx);
    if (showOx) {
      this.oxFill.style.width = `${p.oxygen}%`;
      this.ox.classList.toggle('low', p.oxygen < 25);
    }
    // Ship status
    const sh = game.ships;
    this.shipPanel.classList.toggle('hidden', !sh.piloting);
    if (sh.piloting && sh.def) {
      const b = this.shipPanel.querySelector('b')!;
      if (b.textContent !== sh.def.name) b.textContent = sh.def.name;
      (this.shipPanel.querySelector('.hull .fill') as HTMLElement).style.width = `${sh.hull * 100}%`;
      const alt = Math.max(0, p.position.y - game.zone.groundAt(p.position.x, p.position.z));
      const spd = `${Math.round(sh.speed * 3.6)} km/h${alt < 1e5 ? ` · alt. ${Math.round(alt)} m` : ''}`;
      const sp = this.shipPanel.querySelector('.spd')!;
      if (sp.textContent !== spd) sp.textContent = spd;
    }
    const stageText = `${game.progress.stageName} · Niv. ${game.progress.level}`;
    if (this.stage.textContent !== stageText) this.stage.textContent = stageText;
    const fragText = game.progress.fragments > 0 || game.progress.stage > 0 ? `◆ ${game.progress.fragments}` : '';
    if (this.frag.textContent !== fragText) this.frag.textContent = fragText;
    const zl = game.zoneLabel();
    if (this.zoneLabel.textContent !== zl) this.zoneLabel.textContent = zl;

    // Objective
    const views = game.missions.views();
    const main = views[0];
    this.obj.classList.toggle('hidden', !main);
    let marker: THREE.Vector3 | null = null;
    if (main) {
      if (this.objTitle.textContent !== main.title) this.objTitle.textContent = main.title;
      const txt = main.text + (main.progress ? `  ${main.progress}` : '');
      if (this.objText.textContent !== txt) this.objText.textContent = txt;
      marker = main.marker;
      if (marker) {
        const d = Math.hypot(marker.x - p.position.x, marker.z - p.position.z);
        const dy = marker.y - p.position.y;
        this.objDist.textContent = d < 1000 ? `${Math.round(d)} m${Math.abs(dy) > 5 ? (dy > 0 ? ' ↑' : ' ↓') : ''}` : `${(d / 1000).toFixed(1)} km`;
        const ang = Math.atan2(marker.x - p.position.x, marker.z - p.position.z);
        const rel = ang - game.cameraRig.yaw;
        this.objArrow.style.transform = `rotate(${-rel * (180 / Math.PI) - 90}deg)`;
        this.objArrow.parentElement!.classList.remove('hidden');
      } else this.objArrow.parentElement!.classList.add('hidden');
    }
    this.beacon.visible = !!marker && marker.distanceTo(p.position) > 6;
    if (marker) {
      this.beacon.position.set(marker.x, marker.y, marker.z);
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(performance.now() / 300) * 0.06;
    }

    // Reticle: highlights an aimed creature
    const showReticle = game.progress.stage >= 1 && !game.ship?.active;
    this.reticle.classList.toggle('hidden', !showReticle);
    if (showReticle) {
      const camDir = game.cameraRig.forward();
      const target = game.enemies.inCone(game.camera.position, camDir, 90, game.input.isTouch ? 0.955 : 0.985);
      this.reticle.classList.toggle('locked', !!target);
    }

    // Dialogue
    if (this.lines.length) {
      const l = this.lines[0];
      if (this.lineTime === 0 || this.dialog.classList.contains('hidden')) {
        this.dialog.innerHTML = `<b>${escapeHtml(l.speaker)}</b><span>${escapeHtml(l.text)}</span>`;
        this.dialog.classList.remove('hidden');
      }
      this.lineTime += dt;
      if (this.lineTime > l.dur) {
        this.lines.shift();
        this.lineTime = 0;
        if (!this.lines.length) this.dialog.classList.add('hidden');
      }
    }

    // Banner
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.bannerEl.classList.add('hidden');
    } else if (this.banners.length) {
      const b = this.banners.shift()!;
      this.bannerEl.innerHTML = `<div class="b-icon">${escapeHtml(b.icon)}</div><div class="b-title">${escapeHtml(b.title)}</div><div class="b-sub">${escapeHtml(b.sub)}</div>`;
      this.bannerEl.style.setProperty('--c', b.color);
      this.bannerEl.classList.remove('hidden');
      this.bannerEl.classList.remove('anim');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('anim');
      this.bannerTime = 3.4;
    }

    // Damage vignette & time-slow tint
    this.vig = Math.max(0, this.vig - dt * 1.5);
    const lowHp = p.health / p.maxHealth < 0.3 ? 0.35 + Math.sin(performance.now() / 250) * 0.1 : 0;
    this.vignette.style.opacity = String(Math.max(this.vig, lowHp));
    this.root.classList.toggle('timeslow', game.timeSlowFx > 0);

    // World-anchored texts
    const cam = game.camera;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t > f.dur) { f.el.remove(); this.floats.splice(i, 1); continue; }
      const pos = f.pos.clone();
      pos.y += f.t * f.rise;
      const s = this.project(pos, cam);
      const far = f.pos.distanceTo(cam.position) > 60;
      f.el.style.display = s.visible && !far ? 'block' : 'none';
      f.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(Math.min(1, (f.dur - f.t) * 3));
    }

    // Enemy health bars (damaged, close, visible creatures only)
    const seen = new Set<object>();
    for (const e of game.enemies.alive) {
      const d = e.position.distanceTo(cam.position);
      const scan = game.powers.scanTime > 0;
      if ((e.health >= e.maxHealth && !scan && e.def.health < 300) || d > (scan ? 160 : 50)) continue;
      const s = this.project(e.position.clone().setY(e.position.y + e.model.center * 2 + 0.4), cam);
      if (!s.visible) continue;
      seen.add(e);
      let bar = this.bars.get(e);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'ebar';
        bar.innerHTML = '<div class="fill"></div>';
        this.worldLayer.appendChild(bar);
        this.bars.set(e, bar);
      }
      bar.classList.toggle('boss', e.def.health >= 300);
      bar.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      (bar.firstElementChild as HTMLElement).style.width = `${(100 * e.health) / e.maxHealth}%`;
    }
    for (const [k, bar] of this.bars) if (!seen.has(k)) { bar.remove(); this.bars.delete(k); }

    // FPS
    this.fps.classList.toggle('hidden', !game.settings.showFps);
    if (game.settings.showFps) this.fps.textContent = `${Math.round(game.perf.fps)} FPS · ${game.quality.name}`;
  }

  clearWorld() {
    for (const f of this.floats) f.el.remove();
    this.floats.length = 0;
    for (const b of this.bars.values()) b.remove();
    this.bars.clear();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
