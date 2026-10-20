"""Suburban houses for Val-Lumen (original designs), modelled in Blender.

Footprint 10 m (X) × 8 m (Z), front door facing glTF +Z, ground at y = 0, so they match the
town's existing colliders. Materials prefixed `pbr_` are re-bound by the game to the shared
Poly Haven PBR texture sets; `window_glass` glows at night; `trim` is painted wood.
Outputs house_a.glb (plaster, gable), house_b.glb (brick, hip roof), house_c.glb (plaster,
porch and dormer). Run: <blender-python> tools/blender/houses.py <out_dir>
"""
import math
import os
import sys

import bpy  # noqa: F401
import bmesh  # noqa: F401
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'public/assets/models'
W, D, H, T = 10.0, 8.0, 3.0, 0.25  # width (x), depth, wall height, wall thickness


def mats(wall='pbr_plaster'):
    return {
        'wall': kit.mat(wall, (0.95, 0.93, 0.88), rough=0.9),
        'roof': kit.mat('pbr_roof', (0.85, 0.85, 0.85), rough=0.85),
        'trim': kit.mat('trim', (0.94, 0.94, 0.92), rough=0.45),
        'glass': kit.mat('window_glass', (0.12, 0.17, 0.22), metal=0.6, rough=0.08),
        'door': kit.mat('pbr_wood', (0.6, 0.42, 0.3), rough=0.6),
        'garage': kit.mat('garage', (0.86, 0.87, 0.88), metal=0.3, rough=0.4),
        'base': kit.mat('pbr_concrete', (0.7, 0.7, 0.7), rough=0.9),
        'dark': kit.mat('metal_dark', (0.12, 0.12, 0.13), metal=0.7, rough=0.4),
        'brick': kit.mat('pbr_brick', (0.9, 0.9, 0.9), rough=0.9),
    }


def cutter(x, z, w, h, y0, axis='front'):
    """Box used as a boolean cutter through the wall (Blender coords: front wall at y = -D/2)."""
    if axis == 'front':
        return kit.box('cut', (w, T * 4, h), loc=(x, -D / 2, y0 + h / 2))
    if axis == 'back':
        return kit.box('cut', (w, T * 4, h), loc=(x, D / 2, y0 + h / 2))
    sx = -W / 2 if axis == 'left' else W / 2
    return kit.box('cut', (T * 4, w, h), loc=(sx, z, y0 + h / 2))


def walls(m, openings):
    """Hollow shell with real openings cut by booleans."""
    outer = kit.box('walls', (W, D, H), loc=(0, 0, H / 2), material=m['wall'])
    inner = kit.box('inner', (W - 2 * T, D - 2 * T, H + 1), loc=(0, 0, H / 2))
    mod = outer.modifiers.new('hollow', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = inner
    cuts = [cutter(*o) for o in openings]
    for c in cuts:
        b = outer.modifiers.new('cut', 'BOOLEAN')
        b.operation = 'DIFFERENCE'
        b.object = c
    kit.apply_all(outer)
    for o in [inner, *cuts]:
        bpy.data.objects.remove(o)
    return outer


def window(m, x, z, w, h, y0, side='front'):
    """Frame, sill, mullions and glass for an opening."""
    parts = []
    fy = -D / 2 if side == 'front' else D / 2
    if side in ('front', 'back'):
        s = -1 if side == 'front' else 1
        parts.append(kit.box('g', (w, 0.03, h), loc=(x, fy, y0 + h / 2), material=m['glass']))
        for dx in (-w / 2, w / 2):
            parts.append(kit.box('f', (0.09, 0.14, h + 0.09), loc=(x + dx, fy + s * 0.02, y0 + h / 2), material=m['trim']))
        for dz in (0, h):
            parts.append(kit.box('f', (w + 0.18, 0.14, 0.09), loc=(x, fy + s * 0.02, y0 + dz), material=m['trim']))
        parts.append(kit.box('m', (0.05, 0.08, h), loc=(x, fy + s * 0.02, y0 + h / 2), material=m['trim']))
        parts.append(kit.box('m', (w, 0.08, 0.05), loc=(x, fy + s * 0.02, y0 + h * 0.6), material=m['trim']))
        parts.append(kit.box('sill', (w + 0.3, 0.28, 0.06), loc=(x, fy + s * 0.12, y0 - 0.04), material=m['trim']))
        # shutters
        for dx in (-1, 1):
            parts.append(kit.box('sh', (w * 0.42, 0.05, h + 0.1), loc=(x + dx * (w / 2 + w * 0.24), fy + s * 0.05, y0 + h / 2), material=m['door']))
    else:
        sx = -W / 2 if side == 'left' else W / 2
        s = -1 if side == 'left' else 1
        parts.append(kit.box('g', (0.03, w, h), loc=(sx, z, y0 + h / 2), material=m['glass']))
        for dz in (-w / 2, w / 2):
            parts.append(kit.box('f', (0.14, 0.09, h + 0.09), loc=(sx + s * 0.02, z + dz, y0 + h / 2), material=m['trim']))
        for dy in (0, h):
            parts.append(kit.box('f', (0.14, w + 0.18, 0.09), loc=(sx + s * 0.02, z, y0 + dy), material=m['trim']))
        parts.append(kit.box('sill', (0.28, w + 0.3, 0.06), loc=(sx + s * 0.12, z, y0 - 0.04), material=m['trim']))
    return parts


def gable_roof(m, overhang=0.6, rise=2.3, thickness=0.18):
    parts = []
    half = D / 2 + overhang
    slope = math.hypot(half, rise)
    ang = math.atan2(rise, half)
    for s in (-1, 1):
        slab = kit.box('roof', (W + overhang * 2, slope, thickness), material=m['roof'])
        slab.rotation_euler = (s * -ang, 0, 0)
        slab.location = (0, s * half / 2, H + rise / 2 + thickness / 2)
        parts.append(slab)
    # gable end walls
    for sx in (-W / 2 + T / 2, W / 2 - T / 2):
        bm = bmesh.new()
        pts = [(sx - T / 2, -D / 2, H), (sx - T / 2, D / 2, H), (sx - T / 2, 0, H + rise), (sx + T / 2, -D / 2, H), (sx + T / 2, D / 2, H), (sx + T / 2, 0, H + rise)]
        v = [bm.verts.new(p) for p in pts]
        for f in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
            bm.faces.new([v[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append(kit.obj_from_bmesh('gable', bm, m['wall']))
    # fascia boards and gutters
    for s in (-1, 1):
        parts.append(kit.box('fascia', (W + overhang * 2 + 0.05, 0.05, 0.25), loc=(0, s * (half + 0.02), H - 0.08), material=m['trim']))
        g = kit.cylinder('gutter', 0.07, W + overhang * 2, loc=(0, s * (half + 0.08), H - 0.05), rot=(0, math.pi / 2, 0), material=m['dark'], verts=8)
        parts.append(g)
    return parts


def hip_roof(m, overhang=0.55, rise=2.0):
    bm = bmesh.new()
    x, z = W / 2 + overhang, D / 2 + overhang
    ridge = (W - D) / 2
    base = [bm.verts.new(p) for p in ((-x, -z, H), (x, -z, H), (x, z, H), (-x, z, H))]
    r0, r1 = bm.verts.new((-ridge, 0, H + rise)), bm.verts.new((ridge, 0, H + rise))
    bm.faces.new((base[0], base[1], r1, r0))
    bm.faces.new((base[2], base[3], r0, r1))
    bm.faces.new((base[1], base[2], r1))
    bm.faces.new((base[3], base[0], r0))
    bm.faces.new(list(reversed(base)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    roof = kit.obj_from_bmesh('roof', bm, m['roof'])
    kit.add_solidify(roof, 0.16)
    return [roof, kit.box('fascia', (W + 2 * overhang, D + 2 * overhang, 0.2), loc=(0, 0, H - 0.05), material=m['trim'])]


def chimney(m, x, z, top):
    return [kit.box('chimney', (0.8, 0.8, top), loc=(x, z, top / 2 + 0.5), material=m['brick']),
            kit.box('cap', (0.95, 0.95, 0.12), loc=(x, z, top + 0.55), material=m['base'])]


def door(m, x, w=1.0, h=2.15):
    fy = -D / 2
    return [
        kit.box('door', (w, 0.08, h), loc=(x, fy + 0.06, h / 2 + 0.15), material=m['door'], bevel=0.01),
        kit.box('frame', (w + 0.2, 0.16, 0.1), loc=(x, fy - 0.01, h + 0.2), material=m['trim']),
        kit.box('frame', (0.1, 0.16, h), loc=(x - w / 2 - 0.05, fy - 0.01, h / 2 + 0.15), material=m['trim']),
        kit.box('frame', (0.1, 0.16, h), loc=(x + w / 2 + 0.05, fy - 0.01, h / 2 + 0.15), material=m['trim']),
        kit.sphere('knob', 0.04, loc=(x + w * 0.35, fy - 0.02, 1.15), material=m['dark'], segments=10, rings=6),
        kit.box('step', (w + 0.8, 0.9, 0.15), loc=(x, fy - 0.45, 0.075), material=m['base']),
    ]


def garage(m, x, w=2.8, h=2.3):
    fy = -D / 2
    parts = [kit.box('garage', (w, 0.06, h), loc=(x, fy + 0.08, h / 2), material=m['garage'])]
    for i in range(1, 5):
        parts.append(kit.box('panel', (w - 0.1, 0.03, 0.03), loc=(x, fy + 0.04, i * h / 5), material=m['trim']))
    parts.append(kit.box('frame', (w + 0.2, 0.16, 0.12), loc=(x, fy - 0.01, h + 0.06), material=m['trim']))
    return parts


def porch(m, x, w=3.0, depth=1.8):
    fy = -D / 2
    parts = [kit.box('porch_floor', (w, depth, 0.18), loc=(x, fy - depth / 2, 0.09), material=m['door'])]
    for dx in (-w / 2 + 0.15, w / 2 - 0.15):
        parts.append(kit.cylinder('column', 0.09, 2.5, loc=(x + dx, fy - depth + 0.15, 1.43), material=m['trim'], verts=12))
    roof = kit.box('porch_roof', (w + 0.3, depth + 0.3, 0.14), loc=(x, fy - depth / 2, 2.75), material=m['roof'])
    roof.rotation_euler = (math.radians(-12), 0, 0)
    parts.append(roof)
    return parts


def finish(objs, name):
    for o in objs:
        kit.apply_all(o)
    # group by material into a few meshes (one draw call each in the game)
    by_mat = {}
    for o in objs:
        key = o.data.materials[0].name if o.data.materials else 'none'
        by_mat.setdefault(key, []).append(o)
    out = []
    for key, group in by_mat.items():
        j = kit.join(group, f'{name}_{key}') if len(group) > 1 else group[0]
        j.name = f'{name}_{key}'
        kit.box_uv(j, 2.0 if key.startswith('pbr_') else 1.0)
        kit.smooth(j, 30)
        out.append(j)
    return out


def house_a():
    kit.reset()
    m = mats('pbr_plaster')
    openings = [(-3.4, 0, 1.5, 1.2, 1.0, 'front'), (-1.2, 0, 1.0, 2.2, 0.15, 'front'), (2.6, 0, 2.8, 2.3, 0.0, 'front'),
                (0, -1.5, 1.4, 1.2, 1.0, 'left'), (0, 1.8, 1.4, 1.2, 1.0, 'right'), (-2.5, 0, 1.6, 1.2, 1.0, 'back'), (2.5, 0, 1.6, 1.2, 1.0, 'back')]
    objs = [walls(m, openings)]
    objs += window(m, -3.4, 0, 1.5, 1.2, 1.0) + window(m, 0, -1.5, 1.4, 1.2, 1.0, 'left') + window(m, 0, 1.8, 1.4, 1.2, 1.0, 'right')
    objs += window(m, -2.5, 0, 1.6, 1.2, 1.0, 'back') + window(m, 2.5, 0, 1.6, 1.2, 1.0, 'back')
    objs += door(m, -1.2) + garage(m, 2.6) + gable_roof(m) + chimney(m, 3.0, 1.5, 4.6)
    objs.append(kit.box('foundation', (W + 0.1, D + 0.1, 0.3), loc=(0, 0, 0.05), material=m['base']))
    finish(objs, 'house_a')
    kit.export_glb(os.path.join(OUT, 'house_a.glb'))


def house_b():
    kit.reset()
    m = mats('pbr_brick')
    openings = [(-3.2, 0, 1.8, 1.3, 0.95, 'front'), (0.2, 0, 1.0, 2.2, 0.15, 'front'), (3.3, 0, 1.6, 1.3, 0.95, 'front'),
                (0, -2, 1.4, 1.2, 1.0, 'left'), (0, 2, 1.4, 1.2, 1.0, 'right'), (0, 0, 2.4, 1.2, 1.0, 'back')]
    objs = [walls(m, openings)]
    objs += window(m, -3.2, 0, 1.8, 1.3, 0.95) + window(m, 3.3, 0, 1.6, 1.3, 0.95) + window(m, 0, -2, 1.4, 1.2, 1.0, 'left')
    objs += window(m, 0, 2, 1.4, 1.2, 1.0, 'right') + window(m, 0, 0, 2.4, 1.2, 1.0, 'back')
    objs += door(m, 0.2) + hip_roof(m) + chimney(m, -2.6, 1.2, 4.3)
    objs.append(kit.box('foundation', (W + 0.1, D + 0.1, 0.3), loc=(0, 0, 0.05), material=m['base']))
    finish(objs, 'house_b')
    kit.export_glb(os.path.join(OUT, 'house_b.glb'))


def house_c():
    kit.reset()
    m = mats('pbr_plaster')
    openings = [(-3.6, 0, 1.4, 1.3, 0.95, 'front'), (0, 0, 1.1, 2.25, 0.15, 'front'), (3.4, 0, 1.6, 1.3, 0.95, 'front'),
                (0, 0, 1.4, 1.2, 1.0, 'left'), (0, 0, 1.4, 1.2, 1.0, 'right'), (-2.2, 0, 1.6, 1.2, 1.0, 'back'), (2.2, 0, 1.6, 1.2, 1.0, 'back')]
    objs = [walls(m, openings)]
    objs += window(m, -3.6, 0, 1.4, 1.3, 0.95) + window(m, 3.4, 0, 1.6, 1.3, 0.95) + window(m, 0, 0, 1.4, 1.2, 1.0, 'left')
    objs += window(m, 0, 0, 1.4, 1.2, 1.0, 'right') + window(m, -2.2, 0, 1.6, 1.2, 1.0, 'back') + window(m, 2.2, 0, 1.6, 1.2, 1.0, 'back')
    objs += door(m, 0.0, w=1.1) + porch(m, 0.0) + gable_roof(m, rise=2.6)
    # dormer
    objs.append(kit.box('dormer', (1.8, 1.2, 1.2), loc=(-2.5, -1.9, H + 1.2), material=m['wall']))
    objs.append(kit.box('dormer_glass', (1.1, 0.05, 0.7), loc=(-2.5, -2.52, H + 1.2), material=m['glass']))
    dr = kit.box('dormer_roof', (2.1, 1.5, 0.12), loc=(-2.5, -1.95, H + 1.9), material=m['roof'])
    dr.rotation_euler = (math.radians(-15), 0, 0)
    objs.append(dr)
    objs.append(kit.box('foundation', (W + 0.1, D + 0.1, 0.3), loc=(0, 0, 0.05), material=m['base']))
    finish(objs, 'house_c')
    kit.export_glb(os.path.join(OUT, 'house_c.glb'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    house_a()
    house_b()
    house_c()
    print('houses exported')
