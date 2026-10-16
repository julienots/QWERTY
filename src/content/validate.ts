import type { ContentPack, EnemyDef, MissionDef, PowerDef, SkinDef } from './types';
import { GAME_CONTENT_API } from './types';

/**
 * Strict validation of content packs. Every number is bounded so that a pack
 * (base game or mod) cannot inject absurd values that would break balance or the engine.
 */

const ID_RE = /^[a-z0-9_]{2,48}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CATEGORIES = ['physical', 'movement', 'elemental', 'psychic', 'cosmic', 'divine'];
const ELEMENTS = ['none', 'fire', 'ice', 'lightning', 'plasma', 'gravity', 'psychic', 'light', 'shadow'];
const SOUNDS = ['zap', 'whoosh', 'boom', 'hum', 'chime', 'fire', 'ice', 'thunder', 'warp'];
const PASSIVES = ['superJump', 'flight', 'superSpeed', 'regeneration', 'spaceBreath', 'toughness'];
const MODELS = ['stalker', 'spitter', 'brute', 'drone'];

/** [min, max] for each numeric behaviour parameter. */
const BEHAVIOR_BOUNDS: Record<string, Record<string, [number, number, boolean?]>> = {
  projectile: { speed: [1, 300], damage: [0, 5000], radius: [0.05, 5], count: [1, 24, true], spread: [0, 1.5, true], gravity: [0, 50, true], explodeRadius: [0, 60, true], homing: [0, 20, true], range: [5, 2000, true] },
  beam: { range: [1, 500], dps: [0, 10000], width: [0.05, 20], duration: [0.05, 10] },
  nova: { radius: [0.5, 200], damage: [0, 10000], knockback: [0, 200] },
  dash: { distance: [1, 200], damage: [0, 5000] },
  blink: { distance: [1, 500] },
  shield: { duration: [0.5, 60], absorb: [1, 100000] },
  telekinesis: { range: [1, 200], force: [1, 300], damage: [0, 5000] },
  gravityWell: { radius: [1, 200], duration: [0.5, 30], pull: [0, 200], dps: [0, 5000] },
  timeSlow: { radius: [1, 200], duration: [0.5, 30], factor: [0.05, 1] },
  heal: { amount: [1, 100000] },
  buff: { factor: [1, 10], duration: [0.5, 120] },
  scan: { radius: [1, 2000], duration: [0.5, 60] },
  passive: { value: [0, 100, true] },
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function str(v: unknown, max = 400): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

export function validatePower(p: PowerDef, errors: string[], where: string): void {
  if (!p || typeof p !== 'object') { errors.push(`${where}: pouvoir invalide`); return; }
  if (!str(p.id) || !ID_RE.test(p.id)) errors.push(`${where}: id invalide "${p.id}"`);
  if (!str(p.name, 60)) errors.push(`${where}: nom manquant`);
  if (!str(p.description, 400)) errors.push(`${where}: description manquante`);
  if (!CATEGORIES.includes(p.category)) errors.push(`${where}: catégorie inconnue "${p.category}"`);
  if (!ELEMENTS.includes(p.element)) errors.push(`${where}: élément inconnu "${p.element}"`);
  if (!SOUNDS.includes(p.sound)) errors.push(`${where}: son inconnu "${p.sound}"`);
  if (!str(p.icon, 8)) errors.push(`${where}: icône manquante`);
  if (!str(p.color) || !COLOR_RE.test(p.color)) errors.push(`${where}: couleur invalide`);
  if (!isNum(p.energyCost) || p.energyCost < 0 || p.energyCost > 1000) errors.push(`${where}: energyCost hors limites`);
  if (!isNum(p.cooldown) || p.cooldown < 0 || p.cooldown > 600) errors.push(`${where}: cooldown hors limites`);
  if (!isNum(p.unlockStage) || p.unlockStage < 0 || p.unlockStage > 5) errors.push(`${where}: unlockStage hors limites`);
  if (p.upgradeCosts !== undefined) {
    if (!Array.isArray(p.upgradeCosts) || p.upgradeCosts.length > 9 || !p.upgradeCosts.every((c) => isNum(c) && c >= 0 && c <= 100000)) {
      errors.push(`${where}: upgradeCosts invalide`);
    }
  }
  const b = p.behavior as any;
  if (!b || typeof b !== 'object' || !BEHAVIOR_BOUNDS[b.type]) {
    errors.push(`${where}: comportement inconnu "${b?.type}"`);
    return;
  }
  const bounds = BEHAVIOR_BOUNDS[b.type];
  for (const [key, [min, max, optional]] of Object.entries(bounds)) {
    const v = b[key];
    if (v === undefined && optional) continue;
    if (!isNum(v) || v < min || v > max) errors.push(`${where}: ${b.type}.${key}=${v} hors limites [${min}, ${max}]`);
  }
  if (b.type === 'buff' && !['speed', 'strength', 'defense'].includes(b.stat)) errors.push(`${where}: buff.stat inconnu`);
  if (b.type === 'passive' && !PASSIVES.includes(b.effect)) errors.push(`${where}: passif inconnu "${b.effect}"`);
}

export function validateEnemy(e: EnemyDef, errors: string[], where: string): void {
  if (!e || typeof e !== 'object') { errors.push(`${where}: créature invalide`); return; }
  if (!str(e.id) || !ID_RE.test(e.id)) errors.push(`${where}: id invalide`);
  if (!str(e.name, 60)) errors.push(`${where}: nom manquant`);
  if (!MODELS.includes(e.model)) errors.push(`${where}: modèle inconnu "${e.model}"`);
  if (!COLOR_RE.test(e.color ?? '') || !COLOR_RE.test(e.glow ?? '')) errors.push(`${where}: couleurs invalides`);
  const nums: [keyof EnemyDef, number, number][] = [
    ['scale', 0.2, 30], ['health', 1, 1e6], ['speed', 0, 80], ['damage', 0, 10000], ['attackRange', 0.5, 300],
    ['attackCooldown', 0.1, 60], ['aggroRange', 1, 2000], ['xp', 0, 1e6], ['fragments', 0, 1e5], ['fleeAt', 0, 0.9],
  ];
  for (const [k, min, max] of nums) {
    const v = e[k] as unknown;
    if (!isNum(v) || v < min || v > max) errors.push(`${where}: ${String(k)} hors limites`);
  }
  if (typeof e.ranged !== 'boolean' || typeof e.flying !== 'boolean') errors.push(`${where}: ranged/flying doivent être booléens`);
}

export function validateMission(m: MissionDef, errors: string[], where: string): void {
  if (!m || typeof m !== 'object') { errors.push(`${where}: mission invalide`); return; }
  if (!str(m.id) || !ID_RE.test(m.id)) errors.push(`${where}: id invalide`);
  if (!str(m.title, 80) || !str(m.description, 600)) errors.push(`${where}: titre/description manquant`);
  if (!Array.isArray(m.objectives) || m.objectives.length === 0 || m.objectives.length > 20) {
    errors.push(`${where}: objectifs manquants`);
  } else {
    m.objectives.forEach((o: any, i) => {
      const w = `${where}.objectif[${i}]`;
      if (!str(o?.text, 160)) errors.push(`${w}: texte manquant`);
      switch (o?.type) {
        case 'interact': if (!str(o.target, 48)) errors.push(`${w}: cible manquante`); break;
        case 'reach': if (!isNum(o.x) || !isNum(o.z) || !isNum(o.radius) || !str(o.zone, 48)) errors.push(`${w}: position invalide`); break;
        case 'kill': if (!str(o.enemy, 48) || !isNum(o.count) || o.count < 1 || o.count > 1000) errors.push(`${w}: kill invalide`); break;
        case 'waves': if (!isNum(o.waves) || o.waves < 1 || o.waves > 50 || !Array.isArray(o.enemies) || o.enemies.length === 0) errors.push(`${w}: vagues invalides`); break;
        case 'altitude': if (!isNum(o.value)) errors.push(`${w}: altitude invalide`); break;
        case 'usePower': if (!str(o.power, 48) || !isNum(o.count)) errors.push(`${w}: usePower invalide`); break;
        default: errors.push(`${w}: type inconnu "${o?.type}"`);
      }
    });
  }
  if (!m.rewards || !isNum(m.rewards.xp) || m.rewards.xp < 0) errors.push(`${where}: récompense invalide`);
  if (m.rewards?.stage !== undefined && (!isNum(m.rewards.stage) || m.rewards.stage < 0 || m.rewards.stage > 5)) errors.push(`${where}: stage invalide`);
}

export function validateSkin(s: SkinDef, errors: string[], where: string): void {
  if (!s || !str(s.id) || !ID_RE.test(s.id)) { errors.push(`${where}: id invalide`); return; }
  if (!str(s.name, 60)) errors.push(`${where}: nom manquant`);
  for (const k of ['skin', 'suit', 'accent', 'aura', 'hair'] as const) {
    if (!COLOR_RE.test(s[k] ?? '')) errors.push(`${where}: couleur ${k} invalide`);
  }
  if (!isNum(s.unlockStage) || s.unlockStage < 0 || s.unlockStage > 5) errors.push(`${where}: unlockStage invalide`);
}

export function validatePack(pack: ContentPack): ValidationResult {
  const errors: string[] = [];
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['pack invalide'] };
  if (!str(pack.id) || !ID_RE.test(pack.id)) errors.push(`pack: id invalide "${pack.id}"`);
  if (!str(pack.name, 80)) errors.push('pack: nom manquant');
  if (!str(pack.version, 20) || !/^\d+\.\d+\.\d+$/.test(pack.version)) errors.push('pack: version doit être de la forme 1.2.3');
  if (pack.gameApi !== GAME_CONTENT_API) errors.push(`pack: gameApi ${pack.gameApi} incompatible (attendu ${GAME_CONTENT_API})`);
  const lists: [string, unknown][] = [['powers', pack.powers], ['enemies', pack.enemies], ['missions', pack.missions], ['skins', pack.skins]];
  for (const [name, list] of lists) {
    if (list !== undefined && (!Array.isArray(list) || list.length > 500)) errors.push(`pack: ${name} doit être une liste`);
  }
  pack.powers?.forEach((p, i) => validatePower(p, errors, `powers[${i}]`));
  pack.enemies?.forEach((e, i) => validateEnemy(e, errors, `enemies[${i}]`));
  pack.missions?.forEach((m, i) => validateMission(m, errors, `missions[${i}]`));
  pack.skins?.forEach((s, i) => validateSkin(s, errors, `skins[${i}]`));
  const seen = new Set<string>();
  for (const p of pack.powers ?? []) {
    if (seen.has(p.id)) errors.push(`pack: id de pouvoir dupliqué "${p.id}"`);
    seen.add(p.id);
  }
  return { ok: errors.length === 0, errors };
}
