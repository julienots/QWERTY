"""Spaceships of Universe Ascendant, modelled in Blender (original designs).

Run: <blender-python> tools/blender/ships.py <out_dir>
Outputs ship_scout.glb, ship_fighter.glb, ship_explorer.glb. Each file contains:
  hull (main mesh), canopy (glass), engine_glow (emissive exhaust — the game drives its
  intensity), nav_lights. Nose points to glTF +Z.
"""
import math
import os
import sys

import bpy  # must be imported before bmesh when using the bpy module
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'public/assets/models'


def wing(name, material, root_x, tip_x, root_le, root_te, tip_le, tip_te, root_t, tip_t, dihedral=0.0, z=0.0, mirror=True):
    """Tapered, swept wing with a lens-shaped airfoil, on the +X side (mirror for -X).
    le/te = leading/trailing edge Y positions (Blender -Y is forward)."""
    bm = bmesh.new()

    def section(x, le, te, t, zz):
        chord = te - le
        pts = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            cy = le + chord * (0.5 - 0.5 * math.cos(a))
            th = t * 0.5 * math.sin(a) * (1.15 if math.sin(a) > 0 else 0.7)
            pts.append(bm.verts.new((x, cy, zz + th)))
        return pts

    r = section(root_x, root_le, root_te, root_t, z)
    t = section(tip_x, tip_le, tip_te, tip_t, z + (tip_x - root_x) * math.tan(dihedral))
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((r[i], r[j], t[j], t[i]))
    bm.faces.new(list(reversed(r)))
    bm.faces.new(t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.obj_from_bmesh(name, bm, material)
    if mirror:
        kit.add_mirror(ob)
    kit.add_bevel(ob, 0.02, 2)
    return ob


def nacelle(name, material, x, z, y0, y1, r, mirror=True):
    prof = [(0.001, y0), (r * 0.7, y0 + 0.05), (r, y0 + 0.5), (r * 1.02, (y0 + y1) / 2), (r * 0.95, y1 - 0.3), (r * 0.82, y1), (r * 0.6, y1 - 0.15), (0.001, y1 - 0.4)]
    ob = kit.lathe(name, prof, material, segments=20)
    ob.location = (x, 0, z)
    kit.apply_all(ob)
    if mirror:
        kit.add_mirror(ob)
    return ob


def glow_disc(name, material, x, z, y, r, mirror=True):
    ob = kit.cylinder(name, r, 0.05, loc=(x, y, z), rot=(math.pi / 2, 0, 0), material=material, verts=20)
    if mirror:
        kit.add_mirror(ob)
    return ob


def nav_lights(name, span, y, z):
    red = kit.mat('nav_red', (1, 0.1, 0.1), emission=(1, 0.05, 0.05), strength=6)
    green = kit.mat('nav_green', (0.1, 1, 0.2), emission=(0.1, 1, 0.2), strength=6)
    a = kit.sphere(name + '_l', 0.07, loc=(-span, y, z), material=red, segments=10, rings=6)
    b = kit.sphere(name + '_r', 0.07, loc=(span, y, z), material=green, segments=10, rings=6)
    return kit.join([a, b], name)


def finish_ship(parts, glow_parts, canopy, lights, path):
    for p in parts + glow_parts + [canopy]:
        kit.apply_all(p)
    hull = kit.join(parts, 'hull')
    kit.smooth(hull, 35)
    glow = kit.join(glow_parts, 'engine_glow') if len(glow_parts) > 1 else glow_parts[0]
    glow.name = 'engine_glow'
    kit.smooth(canopy, 60)
    canopy.name = 'canopy'
    lights.name = 'nav_lights'
    kit.export_glb(path)


# ------------------------------------------------------------------ Éclaireur (scout)
def scout():
    kit.reset()
    white = kit.mat('hull_paint', (0.86, 0.87, 0.9), metal=0.25, rough=0.32)
    yellow = kit.mat('accent', (1.0, 0.72, 0.12), metal=0.2, rough=0.35)
    dark = kit.mat('panel_dark', (0.06, 0.065, 0.075), metal=0.6, rough=0.45)
    glass = kit.mat('glass', (0.05, 0.12, 0.2), metal=0.9, rough=0.05)
    glow = kit.mat('engine_glow', (0.6, 0.85, 1.0), emission=(0.45, 0.8, 1.0), strength=8)
    body = kit.loft('fuselage', [
        (-6.0, 0.06, 0.05, 0.0, 2),
        (-5.5, 0.62, 0.42, 0.0, 2.2),
        (-4.4, 1.25, 0.85, 0.05, 2.4),
        (-2.8, 1.85, 1.2, 0.12, 2.6),
        (-0.8, 2.15, 1.35, 0.18, 2.9),
        (1.6, 2.2, 1.3, 0.15, 3.1),
        (3.6, 1.9, 1.15, 0.1, 3.2),
        (4.9, 1.45, 0.9, 0.1, 3.2),
    ], white, ring=24)
    kit.add_subsurf(body, 2)
    w = wing('wings', white, 0.9, 4.9, -0.6, 2.6, 1.6, 2.8, 0.28, 0.07, dihedral=-0.06, z=-0.15)
    stripe = wing('wing_stripe', yellow, 3.9, 4.95, 1.25, 2.85, 1.58, 2.82, 0.09, 0.075, dihedral=-0.06, z=-0.15 + 3.9 * math.tan(-0.06) - 0.205)
    n = nacelle('nacelles', dark, 1.35, 0.05, 1.2, 5.3, 0.48)
    fins = wing('fins', white, 0.0, 1.25, 2.9, 4.6, 4.1, 4.9, 0.14, 0.05, mirror=False)
    fins.rotation_euler = (0, -math.radians(70), 0)
    fins.location = (1.35, 0, 0.45)
    kit.apply_all(fins)
    kit.add_mirror(fins)
    intake = kit.box('intakes', (0.5, 1.2, 0.28), loc=(0.95, -0.9, -0.45), material=dark, bevel=0.05)
    kit.add_mirror(intake)
    spine = kit.box('spine_stripe', (0.28, 5.0, 0.05), loc=(0, 1.6, 0.86), material=yellow, bevel=0.02)
    canopy = kit.sphere('canopy', 0.72, loc=(0, -2.5, 0.62), scale=(0.95, 2.4, 0.62), material=glass, segments=32, rings=16)
    g = glow_disc('glow', glow, 1.35, 0.05, 5.32, 0.36)
    lights = nav_lights('nav', 4.9, 2.6, -0.33)
    finish_ship([body, w, stripe, n, fins, intake, spine], [g], canopy, lights, os.path.join(OUT, 'ship_scout.glb'))


# ------------------------------------------------------------------ Faucon (fighter)
def fighter():
    kit.reset()
    hull_c = kit.mat('hull_paint', (0.2, 0.23, 0.27), metal=0.55, rough=0.38)
    red = kit.mat('accent', (0.9, 0.15, 0.22), metal=0.3, rough=0.35)
    dark = kit.mat('panel_dark', (0.05, 0.05, 0.06), metal=0.7, rough=0.4)
    glass = kit.mat('glass', (0.25, 0.08, 0.04), metal=0.9, rough=0.05)
    glow = kit.mat('engine_glow', (1.0, 0.55, 0.3), emission=(1.0, 0.45, 0.2), strength=9)
    body = kit.loft('fuselage', [
        (-7.0, 0.08, 0.06, -0.1, 2),
        (-6.3, 0.7, 0.4, -0.05, 3.5),
        (-4.5, 1.4, 0.8, 0.0, 4.0),
        (-2.0, 1.9, 1.15, 0.1, 4.5),
        (1.0, 2.3, 1.3, 0.1, 4.5),
        (4.0, 2.2, 1.2, 0.05, 4.5),
        (5.6, 1.6, 1.0, 0.05, 4.0),
    ], hull_c, ring=24)
    kit.add_subsurf(body, 1)
    wings = wing('wings', hull_c, 0.9, 6.2, -1.5, 4.8, 3.4, 5.0, 0.32, 0.08, dihedral=0.0, z=-0.2)
    tips = wing('wingtip', red, 5.4, 6.25, 2.9, 5.0, 3.35, 5.0, 0.12, 0.08, z=-0.2 - 0.0 - 0.0)
    canards = wing('canards', hull_c, 0.7, 2.3, -4.6, -3.4, -3.8, -3.3, 0.12, 0.05, z=0.0)
    cannons = kit.cylinder('cannons', 0.09, 2.4, loc=(6.2, 2.2, -0.2), rot=(math.pi / 2, 0, 0), material=dark, verts=12)
    kit.add_mirror(cannons)
    fins = wing('fins', hull_c, 0.0, 1.8, 2.6, 5.4, 4.6, 5.7, 0.16, 0.05, mirror=False)
    fins.rotation_euler = (0, -math.radians(78), 0)
    fins.location = (0.85, 0, 0.5)
    kit.apply_all(fins)
    kit.add_mirror(fins)
    engine = kit.lathe('engine', [(0.001, 3.6), (0.95, 3.7), (1.05, 5.0), (0.95, 6.0), (0.75, 6.1), (0.001, 5.7)], dark, segments=24)
    stripe = kit.box('stripes', (0.18, 6.0, 0.04), loc=(0.55, -0.5, 0.64), material=red)
    kit.add_mirror(stripe)
    canopy = kit.sphere('canopy', 0.6, loc=(0, -3.2, 0.62), scale=(1.0, 2.2, 0.75), material=glass, segments=32, rings=16)
    g = kit.cylinder('glow', 0.7, 0.05, loc=(0, 6.05, 0), rot=(math.pi / 2, 0, 0), material=glow, verts=24)
    lights = nav_lights('nav', 6.25, 4.6, -0.2)
    finish_ship([body, wings, tips, canards, cannons, fins, engine, stripe], [g], canopy, lights, os.path.join(OUT, 'ship_fighter.glb'))


# ------------------------------------------------------------------ Pèlerin (explorer)
def explorer():
    kit.reset()
    beige = kit.mat('hull_paint', (0.78, 0.72, 0.6), metal=0.2, rough=0.5)
    cyan = kit.mat('accent', (0.3, 0.75, 0.95), metal=0.2, rough=0.35)
    dark = kit.mat('panel_dark', (0.08, 0.08, 0.09), metal=0.6, rough=0.45)
    glass = kit.mat('glass', (0.05, 0.12, 0.2), metal=0.9, rough=0.05)
    glow = kit.mat('engine_glow', (0.5, 0.9, 1.0), emission=(0.35, 0.85, 1.0), strength=8)
    window = kit.mat('window_glow', (1, 0.9, 0.7), emission=(1, 0.85, 0.6), strength=3)
    cockpit = kit.loft('cockpit', [
        (-11.0, 0.1, 0.1, 0.4, 2), (-10.4, 1.6, 1.3, 0.4, 2.3), (-9.0, 2.8, 2.2, 0.3, 2.6), (-7.0, 3.2, 2.6, 0.2, 2.8), (-5.5, 2.4, 2.0, 0.1, 2.6),
    ], beige, ring=24)
    kit.add_subsurf(cockpit, 2)
    spine = kit.loft('spine', [(-6.0, 1.4, 1.4, 0, 2), (6.5, 1.4, 1.4, 0, 2)], dark, ring=16)
    hab = kit.lathe('habitat', [(0.001, -4.5), (2.1, -4.4), (2.4, -3.5), (2.4, 1.5), (2.1, 2.4), (0.001, 2.5)], beige, segments=28)
    ring = bpy.data.objects.new('ring', bpy.data.meshes.new('ring'))
    bpy.context.scene.collection.objects.link(ring)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=4.2, radius2=4.2, depth=1.2)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=kit.euler_matrix((math.pi / 2, 0, 0)))
    bmesh.ops.translate(bm, vec=Vector((0, -1.0, 0)), verts=bm.verts)
    bm.to_mesh(ring.data)
    bm.free()
    ring.data.materials.append(cyan)
    kit.add_solidify(ring, 0.25)
    spokes = [kit.box(f'spoke{i}', (0.25, 0.4, 4.0), loc=(0, -1.0, 0), material=dark) for i in range(4)]
    for i, s in enumerate(spokes):
        s.rotation_euler = (0, i * math.pi / 4, 0)
    pods = kit.box('pods', (1.3, 4.0, 1.3), loc=(2.2, 4.2, 0), material=beige, bevel=0.2)
    kit.add_mirror(pods)
    eng = kit.lathe('engines', [(0.001, 6.4), (1.0, 6.5), (1.15, 8.6), (0.9, 9.6), (0.001, 9.2)], dark, segments=20)
    eng.location = (1.5, 0, 0)
    kit.apply_all(eng)
    kit.add_mirror(eng)
    canopy = kit.sphere('canopy', 1.0, loc=(0, -9.6, 1.05), scale=(1.3, 1.4, 0.55), material=glass, segments=32, rings=16)
    windows = kit.box('windows', (0.08, 3.6, 0.35), loc=(2.42, -1.0, 0.6), material=window)
    kit.add_mirror(windows)
    g = glow_disc('glow', glow, 1.5, 0, 9.62, 0.85)
    lights = nav_lights('nav', 4.3, -1.0, 0)
    finish_ship([cockpit, spine, hab, ring, *spokes, pods, eng, windows], [g], canopy, lights, os.path.join(OUT, 'ship_explorer.glb'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    scout()
    fighter()
    explorer()
    print('ships exported to', OUT)
