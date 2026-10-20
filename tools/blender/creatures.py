"""Creatures of the Void (original designs), modelled in Blender with articulated parts.

Each part is a separate object whose origin sits on its joint, parented in a hierarchy, so the
game animates them by rotating nodes (gait, strikes, flight). Materials:
  `hide`  — dark iridescent chitin (tinted per creature type in the game)
  `glow`  — emissive veins, eyes and spines (colour set per creature type in the game)
Run: <blender-python> tools/blender/creatures.py <out_dir>
"""
import math
import os
import sys

import bpy  # noqa: F401  (must precede bmesh)
import bmesh  # noqa: F401
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'public/assets/models'


def apply_mods(ob):
    """Applies modifiers but keeps the object's transform (its origin is a joint)."""
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def part(name, ob, parent=None, loc=(0, 0, 0), sub=1, jitter=0.0, seed=1, angle=50, detail=1.0):
    if jitter:
        kit.jitter_verts(ob, jitter, seed)
    if sub:
        # Dense subdivision + layered noise = sculpted, organic chitin; then decimate for mobile.
        kit.add_subsurf(ob, sub + 1)
        if detail > 0:
            kit.add_displace(ob, 0.035 * detail, 0.22, 'CLOUDS', seed)
            kit.add_displace(ob, 0.018 * detail, 0.06, 'VORONOI', seed + 7)
        apply_mods(ob)
        n = len(ob.data.polygons)
        if n > 2500:
            kit.add_decimate(ob, 2500 / n)
            apply_mods(ob)
    else:
        apply_mods(ob)
    kit.bake_cavity(ob)
    kit.smooth(ob, angle)
    ob.name = name
    ob.location = loc
    if parent is not None:
        ob.parent = parent
    return ob


def segment(name, length, r0, r1, material, direction=(0, 0, -1), ring=10, bulge=1.15):
    """Limb segment starting at the origin and extending along `direction`."""
    d = Vector(direction).normalized()
    secs = []
    n = 6
    for i in range(n + 1):
        t = i / n
        r = (r0 + (r1 - r0) * t) * (1 + (bulge - 1) * math.sin(t * math.pi))
        secs.append((t * length, r * 2, r * 2, 0, 2.2))
    ob = kit.loft(name, secs, material, ring=ring)
    # loft runs along +Y: rotate it onto `direction`
    rot = Vector((0, 1, 0)).rotation_difference(d)
    ob.data.transform(rot.to_matrix().to_4x4())
    return ob


def spikes(name, material, positions, length=0.35, radius=0.06, tilt=(-0.5, 0, 0)):
    objs = []
    for i, p in enumerate(positions):
        c = kit.cylinder(f'{name}{i}', radius, length, loc=(0, 0, length / 2), material=material, verts=8, r2=0.0)
        c.data.transform(kit.euler_matrix(tilt))
        c.data.transform(__import__('mathutils').Matrix.Translation(Vector(p)))
        objs.append(c)
    return kit.join(objs, name)


def materials():
    hide = kit.mat('hide', (0.07, 0.06, 0.1), metal=0.35, rough=0.32)
    glow = kit.mat('glow', (0.7, 0.3, 1.0), emission=(0.7, 0.3, 1.0), strength=4)
    return hide, glow


# ------------------------------------------------------------------ Rôdeur (stalker)
def stalker():
    kit.reset()
    hide, glow = materials()
    root = kit.empty('root')
    body = kit.loft('b', [
        (0.95, 0.15, 0.12, 0.05, 2), (0.7, 0.55, 0.45, 0.05, 2.2), (0.2, 0.85, 0.62, 0.0, 2.3), (-0.35, 0.8, 0.66, 0.05, 2.3), (-0.8, 0.55, 0.5, 0.06, 2.2), (-0.98, 0.32, 0.32, 0.08, 2),
    ], hide, ring=14)
    body = part('body', body, root, (0, 0, 0.85), sub=2, jitter=0.03, seed=2)
    sp = spikes('spines', glow, [(0, 0.55 - i * 0.28, 0.3 - abs(i - 2) * 0.02) for i in range(6)], length=0.32, radius=0.055)
    part('spines', sp, body, (0, 0, 0), sub=0)
    head = kit.loft('h', [(0.0, 0.42, 0.36, 0, 2.2), (-0.25, 0.48, 0.38, 0.02, 2.3), (-0.55, 0.36, 0.26, -0.02, 2.2), (-0.72, 0.12, 0.1, -0.05, 2)], hide, ring=12)
    head = part('head', head, body, (0, -0.92, 0.1), sub=2, jitter=0.02, seed=3)
    for i, x in enumerate((-0.12, 0.12)):
        e = kit.sphere(f'eye{i}', 0.055, loc=(x, -0.42, 0.12), material=glow, segments=10, rings=6)
        part(f'eye_{i}', e, head, (0, 0, 0), sub=0)
    jaw = kit.loft('j', [(0.0, 0.3, 0.1, 0, 2), (-0.3, 0.26, 0.08, 0, 2), (-0.5, 0.08, 0.05, 0, 2)], hide, ring=10)
    part('jaw', jaw, head, (0, -0.15, -0.14), sub=1)
    for side, sx in (('l', -1), ('r', 1)):
        for end, sy in (('f', -1), ('b', 1)):
            up = segment('u', 0.55, 0.09, 0.06, hide, direction=(sx * 0.6, 0, -0.8))
            up = part(f'leg_{end}{side}_u', up, body, (sx * 0.33, sy * 0.5, -0.05), sub=1)
            lo = segment('l', 0.62, 0.06, 0.015, hide, direction=(sx * 0.1, sy * -0.15, -1))
            lo = part(f'leg_{end}{side}_l', lo, up, (sx * 0.33, 0, -0.44), sub=1)
            claw = kit.cylinder('c', 0.035, 0.12, loc=(0, 0, -0.05), material=glow, verts=6, r2=0.0)
            part(f'claw_{end}{side}', claw, lo, (sx * 0.061, -sy * 0.092, -0.61), sub=0)
    prev = body
    for i in range(4):
        t = segment('t', 0.36, 0.11 - i * 0.022, 0.09 - i * 0.022, glow if i == 3 else hide, direction=(0, 1, 0.1))
        prev = part(f'tail_{i}', t, prev, (0, 0.95 if i == 0 else 0.36, 0.05 if i == 0 else 0.03), sub=1)
    kit.export_glb(os.path.join(OUT, 'creature_stalker.glb'))


# ------------------------------------------------------------------ Cracheur (spitter)
def spitter():
    kit.reset()
    hide, glow = materials()
    sac_m = kit.mat('sac', (0.3, 1.0, 0.6), emission=(0.25, 1.0, 0.55), strength=2.5, alpha=0.85)
    root = kit.empty('root')
    body = kit.sphere('b', 0.55, scale=(1.0, 1.15, 0.85), material=hide, segments=20, rings=12)
    body = part('body', body, root, (0, 0, 1.0), sub=1, jitter=0.05, seed=5)
    sac = kit.sphere('s', 0.45, scale=(1, 1.1, 0.95), material=sac_m, segments=20, rings=12)
    part('sac', sac, body, (0, 0.38, 0.42), sub=1, jitter=0.03, seed=6)
    plates = [kit.sphere(f'p{i}', 0.25, loc=(0, 0.2 - i * 0.22, 0.42 - i * 0.03), scale=(1.6, 0.8, 0.35), material=hide, segments=12, rings=6) for i in range(3)]
    part('plates', kit.join(plates, 'plates'), body, (0, 0, 0), sub=1)
    mouth = kit.lathe('m', [(0.001, 0.0), (0.22, -0.02), (0.2, -0.35), (0.15, -0.42), (0.1, -0.38)], hide, segments=16)
    mouth = part('mouth', mouth, body, (0, -0.55, 0.1), sub=1)
    throat = kit.cylinder('t', 0.11, 0.04, loc=(0, -0.4, 0), rot=(math.pi / 2, 0, 0), material=glow, verts=14)
    part('throat', throat, mouth, (0, 0, 0), sub=0)
    for i, x in enumerate((-0.18, 0.18)):
        part(f'eye_{i}', kit.sphere('e', 0.05, loc=(x, -0.48, 0.28), material=glow, segments=10, rings=6), body, (0, 0, 0), sub=0)
    for side, sx in (('l', -1), ('r', 1)):
        leg = segment('lg', 0.75, 0.13, 0.08, hide, direction=(sx * 0.15, 0, -1))
        leg = part(f'leg_{side}', leg, body, (sx * 0.3, 0, -0.3), sub=1)
        foot = kit.sphere('f', 0.12, scale=(1.2, 1.6, 0.5), material=hide, segments=10, rings=6)
        part(f'foot_{side}', foot, leg, (sx * 0.1, -0.05, -0.75), sub=0)
    kit.export_glb(os.path.join(OUT, 'creature_spitter.glb'))


# ------------------------------------------------------------------ Colosse (brute)
def brute():
    kit.reset()
    hide, glow = materials()
    root = kit.empty('root')
    # Hunched, V-tapered torso lofted from the hips (z=0) up to the shoulders, leaning forward.
    torso = kit.loft('t', [
        (0.0, 0.85, 0.6, 0.0, 2.4), (0.35, 1.05, 0.72, -0.05, 2.6), (0.75, 1.6, 0.95, -0.15, 2.8),
        (1.05, 1.85, 1.0, -0.25, 2.8), (1.25, 1.4, 0.85, -0.3, 2.6), (1.38, 0.6, 0.5, -0.32, 2.2),
    ], hide, ring=16)
    # loft runs along +Y: stand it up (Y -> Z), z_offset becomes a forward (−Y) lean
    torso.data.transform(kit.euler_matrix((math.pi / 2, 0, 0)))
    for v in torso.data.vertices:
        v.co.y, v.co.z = -v.co.y, v.co.z
    torso = part('torso', torso, root, (0, 0, 0.72), sub=1, jitter=0.05, seed=9)
    plates = [kit.sphere(f'p{i}', 0.34, loc=(x, -0.55 - (0.1 if z > 0.6 else 0), z), scale=(1.15, 0.35, 0.8), material=hide, segments=12, rings=8) for i, (x, z) in enumerate([(-0.38, 0.95), (0.38, 0.95), (0, 0.55)])]
    part('chest_plates', kit.join(plates, 'cp'), torso, (0, 0, 0), sub=1, jitter=0.02)
    cracks = [kit.box(f'c{i}', (0.06, 0.05, 0.45), loc=(-0.45 + i * 0.3, -0.62, 0.55 + (i % 2) * 0.12), material=glow) for i in range(4)]
    for i, c in enumerate(cracks):
        c.data.transform(kit.euler_matrix((0, (i - 1.5) * 0.3, 0)))
    part('cracks', kit.join(cracks, 'cracks'), torso, (0, 0, 0), sub=0)
    head = kit.sphere('h', 0.28, scale=(1, 1.1, 0.9), material=hide, segments=16, rings=10)
    head = part('head', head, torso, (0, -0.55, 1.25), sub=1, jitter=0.02)
    for i, x in enumerate((-0.1, 0.1)):
        part(f'eye_{i}', kit.sphere('e', 0.05, loc=(x, -0.27, 0.03), material=glow, segments=10, rings=6), head, (0, 0, 0), sub=0)
    sp = spikes('shoulder_spikes', glow, [(-0.8, -0.1, 1.2), (-0.6, 0.05, 1.32), (0.8, -0.1, 1.2), (0.6, 0.05, 1.32), (0, 0.15, 1.3)], length=0.45, radius=0.08, tilt=(0.5, 0, 0))
    part('shoulder_spikes', sp, torso, (0, 0, 0), sub=0)
    for side, sx in (('l', -1), ('r', 1)):
        arm = segment('a', 1.25, 0.2, 0.3, hide, direction=(sx * 0.15, -0.05, -1), bulge=1.2)
        arm = part(f'arm_{side}', arm, torso, (sx * 0.98, -0.2, 1.05), sub=1, jitter=0.03)
        fist = kit.sphere('f', 0.4, scale=(1, 1.1, 0.95), material=hide, segments=16, rings=10)
        fist = part(f'fist_{side}', fist, arm, (sx * 0.19, -0.06, -1.32), sub=1, jitter=0.04)
        kn = kit.box('k', (0.5, 0.12, 0.08), loc=(0, -0.3, 0.05), material=glow)
        part(f'knuckles_{side}', kn, fist, (0, 0, 0), sub=0)
        leg = segment('l', 0.75, 0.26, 0.2, hide, direction=(0, 0, -1), bulge=1.2)
        leg = part(f'leg_{side}', leg, root, (sx * 0.4, 0, 0.78), sub=1, jitter=0.03)
        foot = kit.sphere('ft', 0.22, scale=(1.2, 1.6, 0.6), material=hide, segments=12, rings=8)
        part(f'foot_{side}', foot, leg, (0, -0.08, -0.75), sub=0)
    kit.export_glb(os.path.join(OUT, 'creature_brute.glb'))


# ------------------------------------------------------------------ Sentinelle (drone)
def drone():
    kit.reset()
    shell = kit.mat('hide', (0.12, 0.11, 0.16), metal=0.75, rough=0.2)
    glow = kit.mat('glow', (0.3, 0.8, 1.0), emission=(0.3, 0.8, 1.0), strength=5)
    root = kit.empty('root')
    core = bpy.data.objects.new('c', bpy.data.meshes.new('c'))
    bpy.context.scene.collection.objects.link(core)
    import bmesh as bm_mod
    bm = bm_mod.new()
    bm_mod.ops.create_icosphere(bm, subdivisions=1, radius=0.55)
    for v in bm.verts:
        v.co.z *= 1.45
    bm.to_mesh(core.data)
    bm.free()
    core.data.materials.append(shell)
    core = part('core', core, root, (0, 0, 0), sub=0, angle=10)
    eye = kit.sphere('e', 0.17, material=glow, segments=14, rings=8)
    part('eye', eye, core, (0, -0.4, 0.05), sub=0)
    ring_ob = bpy.data.objects.new('r', bpy.data.meshes.new('r'))
    bpy.context.scene.collection.objects.link(ring_ob)
    bm = bm_mod.new()
    import math as m
    seg, tube = 40, 8
    verts = []
    for i in range(seg):
        a = 2 * m.pi * i / seg
        ring = []
        for j in range(tube):
            b = 2 * m.pi * j / tube
            r = 0.82 + 0.05 * m.cos(b)
            ring.append(bm.verts.new((m.cos(a) * r, m.sin(a) * r, 0.05 * m.sin(b))))
        verts.append(ring)
    for i in range(seg):
        for j in range(tube):
            bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % tube], verts[i][(j + 1) % tube]))
    bm.to_mesh(ring_ob.data)
    bm.free()
    ring_ob.data.materials.append(glow)
    part('ring', ring_ob, root, (0, 0, 0), sub=0)
    fins = []
    for i in range(3):
        a = i * 2 * math.pi / 3
        f = kit.cylinder(f'f{i}', 0.1, 0.55, loc=(math.cos(a) * 0.5, math.sin(a) * 0.5, -0.55), material=shell, verts=4, r2=0.0)
        f.data.transform(kit.euler_matrix((math.pi, 0, 0)))
        fins.append(f)
    part('fins', kit.join(fins, 'fins'), core, (0, 0, 0), sub=0, angle=10)
    kit.export_glb(os.path.join(OUT, 'creature_drone.glb'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    stalker()
    spitter()
    brute()
    drone()
    print('creatures exported to', OUT)
