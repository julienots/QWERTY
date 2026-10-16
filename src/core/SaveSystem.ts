/**
 * Versioned, validated saves. Survival and creative data live in separate slots so a
 * creative session can never corrupt a survival save. Every write keeps a backup of the
 * previous valid save; a corrupted save falls back to that backup.
 */

export const SAVE_VERSION = 2;

export type GameMode = 'survival' | 'creative';

export interface SaveData {
  version: number;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  playTime: number;
  player: {
    zone: string;
    position: [number, number, number];
    yaw: number;
    health: number;
    energy: number;
    xp: number;
    stage: number;
    fragments: number;
    skin: string;
    flying: boolean;
  };
  powers: {
    unlocked: string[];
    favorites: string[];
    active: string | null;
    levels: Record<string, number>;
  };
  inventory: Record<string, number>;
  missions: {
    completed: string[];
    active: string[];
    progress: Record<string, number[]>;
    counters: Record<string, number>;
  };
  world: {
    time: number;
    day: number;
    weather: string;
    discovered: string[];
    house: { lightsOn: string[]; doorsOpen: string[] };
  };
  mods: { active: { id: string; version: string }[] };
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

export function newSave(mode: GameMode): SaveData {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    mode,
    createdAt: now,
    updatedAt: now,
    playTime: 0,
    player: {
      zone: 'earth',
      position: [-4.2, 0.15, -2.6],
      yaw: Math.PI / 2,
      health: 100,
      energy: 0,
      xp: 0,
      stage: mode === 'creative' ? 5 : 0,
      fragments: 0,
      skin: 'citizen',
      flying: false,
    },
    powers: { unlocked: [], favorites: [], active: null, levels: {} },
    inventory: {},
    missions: { completed: [], active: mode === 'creative' ? [] : ['m_morning'], progress: {}, counters: {} },
    world: { time: 7.2, day: 1, weather: 'clear', discovered: ['earth'], house: { lightsOn: ['bedroom'], doorsOpen: [] } },
    mods: { active: [] },
  };
}

/** Migrations from version N to N+1. */
const MIGRATIONS: Record<number, (d: any) => any> = {
  // v1 had a single active mission string and no counters/fragments.
  1: (d) => {
    d.missions = d.missions ?? {};
    const a = d.missions.active;
    d.missions.active = typeof a === 'string' ? [a] : Array.isArray(a) ? a : [];
    d.missions.counters = d.missions.counters ?? {};
    d.missions.progress = d.missions.progress ?? {};
    if (d.player) d.player.fragments = d.player.fragments ?? 0;
    d.version = 2;
    return d;
  },
};

export function migrate(raw: any): any {
  let d = raw;
  let guard = 0;
  while (d && typeof d.version === 'number' && d.version < SAVE_VERSION && guard++ < 50) {
    const m = MIGRATIONS[d.version];
    if (!m) throw new Error(`aucune migration depuis la version ${d.version}`);
    d = m(d);
  }
  return d;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Returns a list of problems; empty means the save is valid. */
export function validateSave(d: any): string[] {
  const e: string[] = [];
  if (!d || typeof d !== 'object') return ['sauvegarde vide'];
  if (d.version !== SAVE_VERSION) e.push(`version ${d.version} non supportée`);
  if (d.mode !== 'survival' && d.mode !== 'creative') e.push('mode invalide');
  const p = d.player;
  if (!p || typeof p !== 'object') e.push('joueur manquant');
  else {
    if (typeof p.zone !== 'string') e.push('zone invalide');
    if (!Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(isFiniteNum)) e.push('position invalide');
    for (const k of ['yaw', 'health', 'energy', 'xp', 'stage', 'fragments']) if (!isFiniteNum(p[k])) e.push(`player.${k} invalide`);
    if (isFiniteNum(p.stage) && (p.stage < 0 || p.stage > 5)) e.push('stage hors limites');
    if (typeof p.skin !== 'string') e.push('skin invalide');
  }
  const pw = d.powers;
  if (!pw || !isStrArr(pw.unlocked) || !isStrArr(pw.favorites) || typeof pw.levels !== 'object') e.push('pouvoirs invalides');
  if (!d.inventory || typeof d.inventory !== 'object') e.push('inventaire invalide');
  const m = d.missions;
  if (!m || !isStrArr(m.completed) || !isStrArr(m.active) || typeof m.progress !== 'object') e.push('missions invalides');
  const w = d.world;
  if (!w || !isFiniteNum(w.time) || !w.house || !isStrArr(w.house.lightsOn) || !isStrArr(w.house.doorsOpen)) e.push('monde invalide');
  if (!d.mods || !Array.isArray(d.mods.active)) e.push('mods invalides');
  return e;
}

export interface LoadResult {
  data: SaveData | null;
  /** 'primary' | 'backup' | 'none' */
  source: 'primary' | 'backup' | 'none';
  errors: string[];
}

export class SaveSystem {
  constructor(private storage: KeyValueStorage, private prefix = 'ua.save.') {}

  key(slot: string) { return this.prefix + slot; }

  save(slot: string, data: SaveData): void {
    const problems = validateSave(data);
    if (problems.length) throw new Error('sauvegarde refusée : ' + problems.join(', '));
    data.updatedAt = Date.now();
    const json = JSON.stringify(data);
    const prev = this.storage.getItem(this.key(slot));
    if (prev && this.parseValid(prev)) this.storage.setItem(this.key(slot) + '.bak', prev);
    this.storage.setItem(this.key(slot), json);
  }

  private parseValid(json: string): SaveData | null {
    try {
      const d = migrate(JSON.parse(json));
      return validateSave(d).length === 0 ? (d as SaveData) : null;
    } catch {
      return null;
    }
  }

  load(slot: string): LoadResult {
    const errors: string[] = [];
    const primary = this.storage.getItem(this.key(slot));
    if (primary) {
      try {
        const d = migrate(JSON.parse(primary));
        const probs = validateSave(d);
        if (probs.length === 0) return { data: d, source: 'primary', errors };
        errors.push(...probs);
      } catch (err) {
        errors.push('lecture impossible : ' + (err as Error).message);
      }
    }
    const backup = this.storage.getItem(this.key(slot) + '.bak');
    if (backup) {
      const d = this.parseValid(backup);
      if (d) return { data: d, source: 'backup', errors };
      errors.push('sauvegarde de secours invalide');
    }
    return { data: null, source: 'none', errors };
  }

  exists(slot: string): boolean {
    return this.load(slot).data !== null;
  }

  delete(slot: string): void {
    this.storage.removeItem(this.key(slot));
    this.storage.removeItem(this.key(slot) + '.bak');
  }
}
