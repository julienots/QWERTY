import type { ContentPack } from '../content/types';
import { validatePack } from '../content/validate';
import type { ContentRegistry } from '../content/Registry';
import type { KeyValueStorage } from './SaveSystem';

/**
 * Content mods. A mod is a JSON content pack (same format as the base game: powers, enemies,
 * missions, skins, ships). It cannot contain code; every value is validated and bounded before
 * registration, and a broken mod is rejected as a whole without affecting the game.
 * Sources: mods shipped with the game (public/mods/index.json) and mods imported by the player
 * (stored locally). Enabling or disabling a mod applies on the next launch.
 */
export interface ModEntry {
  pack: ContentPack;
  origin: 'bundled' | 'imported';
}

export interface ModStatus {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  origin: 'bundled' | 'imported';
  enabled: boolean;
  loaded: boolean;
  errors: string[];
}

const ENABLED_KEY = 'ua.mods.enabled';
const IMPORTED_KEY = 'ua.mods.imported';
/** Mods enabled by default on a fresh install (shipped and reviewed with the game). */
const DEFAULT_ENABLED = ['cosmic_powers'];
const MAX_MOD_BYTES = 256 * 1024;

export function enabledMods(storage: KeyValueStorage): string[] {
  try {
    const v = JSON.parse(storage.getItem(ENABLED_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [...DEFAULT_ENABLED];
  } catch {
    return [...DEFAULT_ENABLED];
  }
}

export function setModEnabled(storage: KeyValueStorage, id: string, on: boolean) {
  const list = new Set(enabledMods(storage));
  if (on) list.add(id); else list.delete(id);
  storage.setItem(ENABLED_KEY, JSON.stringify([...list]));
}

function importedPacks(storage: KeyValueStorage): ContentPack[] {
  try {
    const v = JSON.parse(storage.getItem(IMPORTED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Parses and validates a mod file chosen by the player, and stores it if valid. */
export function importMod(storage: KeyValueStorage, text: string): { ok: boolean; id?: string; errors: string[] } {
  if (text.length > MAX_MOD_BYTES) return { ok: false, errors: ['fichier trop volumineux (256 Ko max)'] };
  let pack: ContentPack;
  try {
    pack = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: ['JSON invalide : ' + (e as Error).message] };
  }
  const v = validatePack(pack);
  if (!v.ok) return { ok: false, errors: v.errors };
  if (pack.id === 'base') return { ok: false, errors: ['identifiant réservé'] };
  const list = importedPacks(storage).filter((p) => p.id !== pack.id);
  list.push(pack);
  storage.setItem(IMPORTED_KEY, JSON.stringify(list));
  setModEnabled(storage, pack.id, true);
  return { ok: true, id: pack.id, errors: [] };
}

export function removeImportedMod(storage: KeyValueStorage, id: string) {
  storage.setItem(IMPORTED_KEY, JSON.stringify(importedPacks(storage).filter((p) => p.id !== id)));
  setModEnabled(storage, id, false);
}

/** Lists shipped and imported mods (shipped files that fail to load are reported, not fatal). */
export async function discoverMods(base: string, storage: KeyValueStorage): Promise<{ mods: ModEntry[]; errors: string[] }> {
  const mods: ModEntry[] = [];
  const errors: string[] = [];
  try {
    const r = await fetch(`${base}mods/index.json`);
    if (r.ok) {
      const index = await r.json();
      for (const file of Array.isArray(index?.mods) ? index.mods : []) {
        if (typeof file !== 'string' || !/^[a-z0-9_-]+\.json$/i.test(file)) continue;
        try {
          const m = await fetch(`${base}mods/${file}`);
          if (m.ok) mods.push({ pack: await m.json(), origin: 'bundled' });
          else errors.push(`${file} : HTTP ${m.status}`);
        } catch (e) {
          errors.push(`${file} : ${(e as Error).message}`);
        }
      }
    }
  } catch { /* offline: only imported mods */ }
  for (const pack of importedPacks(storage)) {
    if (!mods.some((m) => m.pack?.id === pack?.id)) mods.push({ pack, origin: 'imported' });
  }
  return { mods, errors };
}

/**
 * Registers enabled mods into the content registry (dependencies first: packs are retried
 * while progress is made). Returns the status of every known mod for the Mods menu.
 */
export function registerMods(registry: ContentRegistry, mods: ModEntry[], enabled: string[]): ModStatus[] {
  const status = new Map<string, ModStatus>();
  for (const m of mods) {
    const p = m.pack ?? ({} as ContentPack);
    status.set(p.id, {
      id: String(p.id), name: String(p.name ?? p.id), version: String(p.version ?? '?'), author: String(p.author ?? 'inconnu'),
      description: String(p.description ?? ''), origin: m.origin, enabled: enabled.includes(p.id), loaded: false, errors: [],
    });
  }
  let pending = mods.filter((m) => enabled.includes(m.pack?.id));
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    const next: ModEntry[] = [];
    for (const m of pending) {
      const r = registry.register(m.pack, 'mod');
      const st = status.get(m.pack.id)!;
      if (r.ok) { st.loaded = true; st.errors = []; progress = true; } else { st.errors = r.errors; next.push(m); }
    }
    pending = next;
  }
  return [...status.values()];
}
