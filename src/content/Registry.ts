import type { ContentPack, EnemyDef, MissionDef, PowerDef, SkinDef } from './types';
import { validatePack } from './validate';

export interface RegisteredPack {
  pack: ContentPack;
  source: 'base' | 'mod';
}

/** Central registry of all game content (base game + enabled mods). */
export class ContentRegistry {
  readonly powers = new Map<string, PowerDef>();
  readonly enemies = new Map<string, EnemyDef>();
  readonly missions = new Map<string, MissionDef>();
  readonly skins = new Map<string, SkinDef>();
  readonly packs = new Map<string, RegisteredPack>();
  /** Which pack declared each content id (used for diagnostics and save compatibility). */
  readonly origin = new Map<string, string>();

  register(pack: ContentPack, source: 'base' | 'mod'): { ok: boolean; errors: string[] } {
    const res = validatePack(pack);
    const errors = [...res.errors];
    if (this.packs.has(pack.id)) errors.push(`pack "${pack.id}" déjà chargé`);
    for (const dep of pack.dependencies ?? []) {
      if (!this.packs.has(dep)) errors.push(`dépendance manquante : "${dep}"`);
    }
    const check = (kind: string, map: Map<string, unknown>, list?: { id: string }[]) => {
      for (const item of list ?? []) {
        if (map.has(item.id)) errors.push(`${kind} "${item.id}" existe déjà (déclaré par ${this.origin.get(kind + ':' + item.id)})`);
      }
    };
    check('power', this.powers, pack.powers);
    check('enemy', this.enemies, pack.enemies);
    check('mission', this.missions, pack.missions);
    check('skin', this.skins, pack.skins);
    if (errors.length) return { ok: false, errors };

    // All-or-nothing registration: nothing is added if any check failed above.
    const add = <T extends { id: string }>(kind: string, map: Map<string, T>, list?: T[]) => {
      for (const item of list ?? []) {
        map.set(item.id, item);
        this.origin.set(kind + ':' + item.id, pack.id);
      }
    };
    add('power', this.powers, pack.powers);
    add('enemy', this.enemies, pack.enemies);
    add('mission', this.missions, pack.missions);
    add('skin', this.skins, pack.skins);
    this.packs.set(pack.id, { pack, source });
    return { ok: true, errors: [] };
  }

  power(id: string): PowerDef | undefined {
    return this.powers.get(id);
  }
  enemy(id: string): EnemyDef | undefined {
    return this.enemies.get(id);
  }
  mission(id: string): MissionDef | undefined {
    return this.missions.get(id);
  }
}
