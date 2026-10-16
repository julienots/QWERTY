import { describe, expect, it } from 'vitest';
import { BASE_PACK } from '../../src/content/basePack';
import { ContentRegistry } from '../../src/content/Registry';
import { validatePack } from '../../src/content/validate';
import type { ContentPack } from '../../src/content/types';

describe('content packs', () => {
  it('base pack is valid', () => {
    const r = validatePack(BASE_PACK);
    expect(r.errors).toEqual([]);
  });

  it('every mission reward references existing powers and requires an existing mission', () => {
    const ids = new Set(BASE_PACK.powers!.map((p) => p.id));
    const missions = new Set(BASE_PACK.missions!.map((m) => m.id));
    for (const m of BASE_PACK.missions!) {
      for (const p of m.rewards.powers ?? []) expect(ids.has(p), `${m.id} -> ${p}`).toBe(true);
      if (m.requires) expect(missions.has(m.requires)).toBe(true);
      for (const o of m.objectives) {
        if (o.type === 'kill' && o.enemy !== '*') expect(BASE_PACK.enemies!.some((e) => e.id === o.enemy)).toBe(true);
      }
    }
  });

  it('rejects out-of-bounds values and unknown behaviours', () => {
    const bad: ContentPack = {
      id: 'bad_mod', name: 'Bad', version: '1.0.0', gameApi: 1,
      powers: [
        { ...BASE_PACK.powers![0], id: 'nuke', behavior: { type: 'nova', radius: 99999, damage: 1, knockback: 1 } },
        { ...BASE_PACK.powers![0], id: 'evil', behavior: { type: 'eval', code: 'alert(1)' } as any },
      ],
    };
    const r = validatePack(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('radius'))).toBe(true);
    expect(r.errors.some((e) => e.includes('eval'))).toBe(true);
  });

  it('registry enforces dependencies and unique ids atomically', () => {
    const reg = new ContentRegistry();
    expect(reg.register(BASE_PACK, 'base').ok).toBe(true);
    const dup: ContentPack = { id: 'dup', name: 'Dup', version: '1.0.0', gameApi: 1, powers: [BASE_PACK.powers![0]] };
    const r = reg.register(dup, 'mod');
    expect(r.ok).toBe(false);
    const needsDep: ContentPack = { id: 'needs', name: 'Needs', version: '1.0.0', gameApi: 1, dependencies: ['missing_pack'] };
    expect(reg.register(needsDep, 'mod').ok).toBe(false);
    expect(reg.packs.has('needs')).toBe(false);
  });

  it('rejects incompatible api versions', () => {
    const r = validatePack({ id: 'future', name: 'Future', version: '1.0.0', gameApi: 99 });
    expect(r.ok).toBe(false);
  });
});
