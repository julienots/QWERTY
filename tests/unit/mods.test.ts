import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BASE_PACK } from '../../src/content/basePack';
import { ContentRegistry } from '../../src/content/Registry';
import { validatePack } from '../../src/content/validate';
import { MemoryStorage } from '../../src/core/SaveSystem';
import { enabledMods, importMod, registerMods, setModEnabled } from '../../src/core/Mods';
import type { ContentPack } from '../../src/content/types';

const cosmic = JSON.parse(readFileSync(new URL('../../public/mods/cosmic_powers.json', import.meta.url), 'utf8')) as ContentPack;

function baseRegistry() {
  const r = new ContentRegistry();
  expect(r.register(BASE_PACK, 'base').ok).toBe(true);
  return r;
}

describe('mods', () => {
  it('COSMIC POWERS is a valid pack and registers on top of the base game', () => {
    expect(validatePack(cosmic).errors).toEqual([]);
    const reg = baseRegistry();
    const st = registerMods(reg, [{ pack: cosmic, origin: 'bundled' }], ['cosmic_powers']);
    expect(st[0].loaded).toBe(true);
    expect(reg.power('supernova')).toBeTruthy();
    expect(reg.ships.has('comete')).toBe(true);
    expect(reg.origin.get('power:comet_volley')).toBe('cosmic_powers');
    // its mission only references content that exists once loaded
    const m = reg.mission('mod_cosmic_trial')!;
    expect(reg.mission(m.requires!)).toBeTruthy();
    for (const p of m.rewards.powers ?? []) expect(reg.power(p)).toBeTruthy();
    for (const s of m.rewards.ships ?? []) expect(reg.ships.has(s)).toBe(true);
  });

  it('disabled mods are listed but not registered', () => {
    const reg = baseRegistry();
    const st = registerMods(reg, [{ pack: cosmic, origin: 'bundled' }], []);
    expect(st[0].loaded).toBe(false);
    expect(reg.power('supernova')).toBeUndefined();
  });

  it('a mod overriding base content is rejected as a whole', () => {
    const reg = baseRegistry();
    const evil: ContentPack = { ...cosmic, id: 'evil', powers: [{ ...cosmic.powers![0], id: 'flight' }, cosmic.powers![1]] };
    const st = registerMods(reg, [{ pack: evil, origin: 'imported' }], ['evil']);
    expect(st[0].loaded).toBe(false);
    expect(st[0].errors.join(' ')).toMatch(/flight/);
    expect(reg.power(cosmic.powers![1].id)).toBeUndefined();
  });

  it('dependencies are resolved whatever the order', () => {
    const reg = baseRegistry();
    const child: ContentPack = { id: 'child_mod', name: 'Enfant', version: '1.0.0', gameApi: 1, dependencies: ['cosmic_powers'], skins: [{ id: 'child_skin', name: 'Tenue', skin: '#ffffff', suit: '#000000', accent: '#ff0000', aura: '#00ff00', hair: '#000000', unlockStage: 0 }] };
    const st = registerMods(reg, [{ pack: child, origin: 'imported' }, { pack: cosmic, origin: 'bundled' }], ['child_mod', 'cosmic_powers']);
    expect(st.every((s) => s.loaded)).toBe(true);
  });

  it('import rejects invalid JSON, out-of-bounds values and the reserved id', () => {
    const s = new MemoryStorage();
    expect(importMod(s, '{ nope').ok).toBe(false);
    const huge = { ...cosmic, id: 'huge', powers: [{ ...cosmic.powers![0], id: 'huge_power', behavior: { type: 'nova', radius: 9999, damage: 1, knockback: 1 } }] };
    const r = importMod(s, JSON.stringify(huge));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/radius/);
    expect(importMod(s, JSON.stringify({ ...cosmic, id: 'base' })).ok).toBe(false);
    const ok = importMod(s, JSON.stringify({ ...cosmic, id: 'my_copy', powers: [], enemies: [], missions: [], skins: [], ships: [] }));
    expect(ok.ok).toBe(true);
    expect(enabledMods(s)).toContain('my_copy');
  });

  it('enabled list defaults to the shipped mod and persists toggles', () => {
    const s = new MemoryStorage();
    expect(enabledMods(s)).toEqual(['cosmic_powers']);
    setModEnabled(s, 'cosmic_powers', false);
    expect(enabledMods(s)).toEqual([]);
  });
});
