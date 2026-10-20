import { describe, expect, it } from 'vitest';
import { CollisionWorld, type Body } from '../../src/physics/CollisionWorld';
import { MemoryStorage, SaveSystem, SAVE_VERSION, newSave, validateSave, migrate } from '../../src/core/SaveSystem';
import { Noise2D, mulberry32 } from '../../src/core/noise';
import { PerfMonitor } from '../../src/core/PerfMonitor';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../src/core/Settings';

function body(x = 0, y = 0, z = 0): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, radius: 0.35, height: 1.8, onGround: false, stepHeight: 0.45 };
}

describe('noise', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    const n1 = new Noise2D(7), n2 = new Noise2D(7);
    expect(n1.fbm(3.2, 1.1)).toBe(n2.fbm(3.2, 1.1));
  });
  it('stays in range', () => {
    const n = new Noise2D(3);
    for (let i = 0; i < 2000; i++) {
      const v = n.noise(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('CollisionWorld', () => {
  it('blocks a body walking into a wall', () => {
    const w = new CollisionWorld();
    w.addBox(2, 0, -5, 2.2, 3, 5);
    const b = body(0, 0, 0);
    b.vx = 5;
    for (let i = 0; i < 120; i++) w.move(b, 1 / 60);
    expect(b.x).toBeLessThan(2 - 0.3);
    expect(b.onGround).toBe(true);
  });

  it('does not tunnel through a thin wall at high speed', () => {
    const w = new CollisionWorld();
    w.addBox(5, 0, -5, 5.1, 3, 5);
    const b = body(0, 0, 0);
    b.vx = 200;
    w.move(b, 1 / 20);
    expect(b.x).toBeLessThan(5);
  });

  it('steps up onto low obstacles but not tall ones', () => {
    const w = new CollisionWorld();
    w.addBox(1, 0, -2, 3, 0.3, 2); // step
    const b = body(0, 0, 0);
    for (let i = 0; i < 60; i++) { b.vx = 3; b.vy -= 9.8 / 60; w.move(b, 1 / 60); }
    expect(b.y).toBeCloseTo(0.3, 3);
    const w2 = new CollisionWorld();
    w2.addBox(1, 0, -2, 3, 1.2, 2);
    const c = body(0, 0, 0);
    for (let i = 0; i < 60; i++) { c.vx = 3; c.vy -= 9.8 / 60; w2.move(c, 1 / 60); }
    expect(c.x).toBeLessThan(1);
  });

  it('lands on terrain and on top of boxes', () => {
    const w = new CollisionWorld();
    w.ground = (x) => x * 0.1;
    const b = body(10, 20, 0);
    for (let i = 0; i < 300; i++) { b.vy -= 9.8 / 60; w.move(b, 1 / 60); }
    expect(b.y).toBeCloseTo(1, 2);
    expect(b.onGround).toBe(true);
    w.addBox(-2, 0, -2, 2, 5, 2);
    const c = body(0, 10, 0);
    for (let i = 0; i < 300; i++) { c.vy -= 9.8 / 60; w.move(c, 1 / 60); }
    expect(c.y).toBeCloseTo(5, 2);
  });

  it('stops at a ceiling', () => {
    const w = new CollisionWorld();
    w.addBox(-5, 2.8, -5, 5, 3, 5);
    const b = body(0, 0, 0);
    b.vy = 10;
    for (let i = 0; i < 30; i++) w.move(b, 1 / 60);
    expect(b.y + b.height).toBeLessThanOrEqual(2.8 + 1e-6);
  });

  it('disabled boxes do not collide (open doors)', () => {
    const w = new CollisionWorld();
    const door = w.addBox(2, 0, -1, 2.1, 2.1, 1);
    door.enabled = false;
    const b = body(0, 0, 0);
    b.vx = 4;
    for (let i = 0; i < 60; i++) w.move(b, 1 / 60);
    expect(b.x).toBeGreaterThan(3);
  });

  it('raycasts boxes and terrain', () => {
    const w = new CollisionWorld();
    w.addBox(5, 0, -1, 6, 2, 1);
    expect(w.raycast(0, 1, 0, 1, 0, 0, 20)).toBeCloseTo(5, 5);
    w.ground = () => 0;
    const t = w.raycast(0, 10, 50, 0, -1, 0, 50);
    expect(t).toBeCloseTo(10, 1);
  });
});

describe('SaveSystem', () => {
  it('round-trips a save', () => {
    const s = new SaveSystem(new MemoryStorage());
    const d = newSave('survival');
    d.player.xp = 123;
    s.save('survival_1', d);
    const r = s.load('survival_1');
    expect(r.source).toBe('primary');
    expect(r.data?.player.xp).toBe(123);
  });

  it('refuses to write invalid data', () => {
    const s = new SaveSystem(new MemoryStorage());
    const d: any = newSave('survival');
    d.player.position = [0, NaN, 0];
    expect(() => s.save('x', d)).toThrow();
  });

  it('falls back to the backup when the primary save is corrupted', () => {
    const st = new MemoryStorage();
    const s = new SaveSystem(st);
    const d = newSave('survival');
    d.player.xp = 10;
    s.save('slot', d);
    d.player.xp = 20;
    s.save('slot', d);
    st.setItem('ua.save.slot', '{corrupted');
    const r = s.load('slot');
    expect(r.source).toBe('backup');
    expect(r.data?.player.xp).toBe(10);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('keeps survival and creative slots separate', () => {
    const s = new SaveSystem(new MemoryStorage());
    const a = newSave('survival');
    const b = newSave('creative');
    b.player.fragments = 999;
    s.save('survival_1', a);
    s.save('creative_1', b);
    expect(s.load('survival_1').data?.player.fragments).toBe(0);
    expect(s.load('creative_1').data?.mode).toBe('creative');
  });

  it('migrates a v1 save', () => {
    const v1: any = newSave('survival');
    v1.version = 1;
    v1.missions.active = 'm_lights';
    delete v1.missions.counters;
    delete v1.player.fragments;
    const m = migrate(JSON.parse(JSON.stringify(v1)));
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.missions.active).toEqual(['m_lights']);
    expect(validateSave(m)).toEqual([]);
    expect(m.ships.owned).toEqual([]);
    expect(m.player.oxygen).toBe(100);
  });

  it('migrates a v2 save to v3 (ships, oxygen)', () => {
    const v2: any = newSave('survival');
    v2.version = 2;
    delete v2.ships;
    delete v2.player.oxygen;
    const m = migrate(JSON.parse(JSON.stringify(v2)));
    expect(m.version).toBe(3);
    expect(validateSave(m)).toEqual([]);
  });

  it('rejects a corrupted parked ship', () => {
    const d: any = newSave('survival');
    d.ships.parked = { zone: 'orbit', position: [0, 'x', 0], yaw: 0, hull: 1 };
    expect(validateSave(d).length).toBeGreaterThan(0);
  });

  it('reports a missing save', () => {
    const s = new SaveSystem(new MemoryStorage());
    expect(s.load('nothing').source).toBe('none');
  });
});

describe('Settings & perf', () => {
  it('sanitizes bad settings', () => {
    const s = sanitizeSettings({ quality: 'insane', sensitivity: 99, invertY: 'yes' });
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.sensitivity).toBe(3);
    expect(s.invertY).toBe(false);
  });

  it('lowers quality when fps is low and raises it when high', () => {
    const p = new PerfMonitor(30);
    let rec = null;
    for (let i = 0; i < 400 && !rec; i++) { p.record(1 / 15); rec = p.recommend('high', 1 / 15); }
    expect(rec).toBe('medium');
    const q = new PerfMonitor(30);
    rec = null;
    for (let i = 0; i < 2000 && !rec; i++) { q.record(1 / 60); rec = q.recommend('low', 1 / 60); }
    expect(rec).toBe('medium');
  });
});
