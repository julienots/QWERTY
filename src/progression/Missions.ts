import * as THREE from 'three';
import type { Game } from '../Game';
import type { MissionDef, ObjectiveDef } from '../content/types';

export interface ObjectiveView {
  missionId: string;
  title: string;
  text: string;
  progress: string;
  marker: THREE.Vector3 | null;
  main: boolean;
}

/** Pure check (unit tested): has the mission's prerequisite been met? */
export function missionAvailable(m: MissionDef, completed: Set<string>, active: Set<string>): boolean {
  return !completed.has(m.id) && !active.has(m.id) && (!m.requires || completed.has(m.requires));
}

/**
 * Tracks active missions. Each mission has sequential objectives; progress is driven by
 * gameplay events (interact, kills, power use) and per-frame checks (positions, altitude).
 */
export class MissionManager {
  readonly completed = new Set<string>();
  readonly active: string[] = [];
  /** missionId -> [objectiveIndex, counter] */
  progress: Record<string, number[]> = {};
  private waveState: Record<string, { wave: number; tag: string; pause: number }> = {};
  private spawned = new Set<string>();

  constructor(private game: Game) {
    game.bus.on('interact', (id: string) => this.onEvent((o) => o.type === 'interact' && o.target === id));
    game.bus.on('enemy:killed', (e: { id: string }) => this.onEvent((o) => o.type === 'kill' && (o.enemy === '*' || o.enemy === e.id), true));
    game.bus.on('power:used', (id: string) => this.onEvent((o) => o.type === 'usePower' && o.power === id, true));
    game.bus.on('ship:board', () => this.onEvent((o) => o.type === 'board'));
  }

  load(completed: string[], active: string[], progress: Record<string, number[]>) {
    this.completed.clear();
    completed.forEach((c) => this.completed.add(c));
    this.active.length = 0;
    for (const a of active) if (this.game.content.mission(a) && !this.completed.has(a)) this.active.push(a);
    this.progress = JSON.parse(JSON.stringify(progress ?? {}));
    this.spawned.clear();
    this.waveState = {};
    this.unlockNew();
  }

  isCompleted(id: string) { return this.completed.has(id); }

  private state(id: string): number[] {
    if (!this.progress[id]) this.progress[id] = [0, 0];
    return this.progress[id];
  }

  current(id: string): ObjectiveDef | null {
    const m = this.game.content.mission(id);
    if (!m) return null;
    return m.objectives[this.state(id)[0]] ?? null;
  }

  private onEvent(match: (o: ObjectiveDef) => boolean, counted = false) {
    for (const id of [...this.active]) {
      const o = this.current(id);
      if (!o || !match(o)) continue;
      const st = this.state(id);
      if (counted) {
        st[1]++;
        const need = o.type === 'kill' || o.type === 'usePower' ? o.count : 1;
        if (st[1] >= need) this.advance(id);
      } else this.advance(id);
    }
  }

  private advance(id: string) {
    const m = this.game.content.mission(id)!;
    const st = this.state(id);
    st[0]++;
    st[1] = 0;
    this.game.audio.play('chime', { volume: 0.6 });
    if (st[0] >= m.objectives.length) this.complete(id);
    else this.game.hud.toast(`✓ Objectif suivant : ${m.objectives[st[0]].text}`);
  }

  complete(id: string) {
    const m = this.game.content.mission(id);
    if (!m) return;
    const i = this.active.indexOf(id);
    if (i >= 0) this.active.splice(i, 1);
    this.completed.add(id);
    delete this.progress[id];
    const g = this.game;
    g.hud.banner('MISSION ACCOMPLIE', m.title, '#7dff9a', '✓');
    g.progress.reward(m.rewards.xp, m.rewards.fragments ?? 0);
    if (m.rewards.stage !== undefined) g.progress.setStage(m.rewards.stage);
    for (const p of m.rewards.powers ?? []) g.powers.unlock(p);
    for (const [item, n] of Object.entries(m.rewards.items ?? {})) g.inventory[item] = (g.inventory[item] ?? 0) + n;
    for (const s of m.rewards.ships ?? []) g.ships.grant(s);
    g.bus.emit('mission:completed', id);
    this.unlockNew();
    g.autosave();
  }

  private unlockNew() {
    const active = new Set(this.active);
    for (const m of this.game.content.missions.values()) {
      if (this.game.mode === 'creative') continue;
      if (missionAvailable(m, this.completed, active)) {
        this.active.push(m.id);
        active.add(m.id);
        if (this.game.ready) this.game.hud.toast(`Nouvelle mission : ${m.title}`);
      }
    }
    // Main missions first
    this.active.sort((a, b) => Number(!!this.game.content.mission(b)?.main) - Number(!!this.game.content.mission(a)?.main));
  }

  /** Resolves the world position an objective points at. */
  markerFor(o: ObjectiveDef): THREE.Vector3 | null {
    const g = this.game;
    switch (o.type) {
      case 'reach': return o.zone === g.zone.id ? new THREE.Vector3(o.x, o.y ?? g.zone.groundAt(o.x, o.z), o.z) : null;
      case 'interact': {
        const it = g.zone.interactables.find((x) => x.id === o.target);
        return it ? it.position.clone() : null;
      }
      case 'kill': {
        if (o.spawn) return new THREE.Vector3(o.spawn.x, g.zone.groundAt(o.spawn.x, o.spawn.z), o.spawn.z);
        const e = g.enemies.alive.find((x) => o.enemy === '*' || x.def.id === o.enemy);
        return e ? e.position.clone() : null;
      }
      case 'waves': return new THREE.Vector3(o.x, g.zone.groundAt(o.x, o.z), o.z);
      default: return null;
    }
  }

  views(): ObjectiveView[] {
    const out: ObjectiveView[] = [];
    for (const id of this.active) {
      const m = this.game.content.mission(id);
      const o = this.current(id);
      if (!m || !o) continue;
      const st = this.state(id);
      let progress = '';
      if (o.type === 'kill' || o.type === 'usePower') progress = `${st[1]}/${o.count}`;
      if (o.type === 'waves') {
        const ws = this.waveState[id];
        progress = ws ? `Vague ${Math.min(ws.wave, o.waves)}/${o.waves}` : `0/${o.waves}`;
      }
      if (o.type === 'altitude') progress = `${Math.max(0, Math.round(this.game.player.position.y))}/${o.value} m`;
      out.push({ missionId: id, title: m.title, text: o.text, progress, marker: this.markerFor(o), main: m.main });
    }
    return out;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player.position;
    for (const id of [...this.active]) {
      const o = this.current(id);
      if (!o) continue;
      const st = this.state(id);
      switch (o.type) {
        case 'reach': {
          if (o.zone !== g.zone.id) break;
          const dx = p.x - o.x, dz = p.z - o.z;
          const yOk = o.y === undefined || p.y >= o.y - 0.6;
          if (dx * dx + dz * dz < o.radius * o.radius && yOk) this.advance(id);
          break;
        }
        case 'altitude':
          if (g.zone.id === 'earth' && p.y >= o.value) this.advance(id);
          break;
        case 'zone':
          if (g.zone.id === o.zone && !g.traveling) this.advance(id);
          break;
        case 'board':
          // Already aboard when the objective starts.
          if (g.ships.piloting) this.advance(id);
          break;
        case 'kill': {
          const key = id + ':' + st[0];
          if (o.spawn && !this.spawned.has(key) && g.zone.id === 'earth') {
            const d = Math.hypot(p.x - o.spawn.x, p.z - o.spawn.z);
            const remaining = o.count - st[1];
            const tagged = g.enemies.countTagged(key);
            if (d < 90 && tagged < remaining) {
              this.spawned.add(key);
              for (let i = tagged; i < remaining; i++) {
                const a = (i / remaining) * Math.PI * 2;
                g.enemies.spawn(o.enemy === '*' ? 'void_stalker' : o.enemy, o.spawn.x + Math.cos(a) * 6, o.spawn.z + Math.sin(a) * 6, { game: g, hunter: true, tag: key });
              }
              g.hud.toast('⚠ Des créatures surgissent !');
            }
          }
          break;
        }
        case 'waves': {
          if (g.zone.id !== 'earth') break;
          let ws = this.waveState[id];
          const d = Math.hypot(p.x - o.x, p.z - o.z);
          if (!ws) {
            if (d > 60) break;
            ws = this.waveState[id] = { wave: 0, tag: id + ':wave', pause: 2 };
          }
          if (g.enemies.countTagged(ws.tag) > 0) break;
          ws.pause -= dt;
          if (ws.pause > 0) break;
          if (ws.wave >= o.waves) { this.advance(id); delete this.waveState[id]; break; }
          ws.wave++;
          ws.pause = 4;
          const n = 3 + ws.wave * 2;
          const pool = o.enemies.slice(0, Math.min(o.enemies.length, ws.wave));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + ws.wave;
            const r = 22 + Math.random() * 10;
            g.enemies.spawn(pool[i % pool.length], o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, { game: g, hunter: true, tag: ws.tag });
          }
          g.hud.banner(`VAGUE ${ws.wave}/${o.waves}`, 'Les créatures du Néant attaquent !', '#ff4d6d', '⚠');
          g.audio.play('growl', { volume: 1 });
          break;
        }
      }
    }
  }

  /** After death the current spawn-objectives may re-spawn their creatures. */
  resetSpawns() {
    this.spawned.clear();
    for (const k of Object.keys(this.waveState)) {
      this.waveState[k].pause = 3;
    }
  }
}
