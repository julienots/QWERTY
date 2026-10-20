"""Tree generator: recursive branching trunks with real Poly Haven bark, and canopies of
alpha-cut leaf cards made from Poly Haven's photographed jacaranda fronds (CC0).

Outputs tree_broadleaf.glb, tree_broadleaf_lod.glb, tree_fir.glb, tree_fir_lod.glb.
Materials: `bark` and `leaves` (the game turns `leaves` into an alpha-tested, double-sided material).
Run: <blender-python> tools/blender/trees.py <out_dir>
"""
import math
import os
import random
import sys

import bpy  # noqa: F401
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'public/assets/models'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, '.asset-cache', 'polyhaven', 'jacaranda_tree', 'textures')

# The three fronds of the atlas (u0, v0, u1, v1) and their stem anchor side.
FRONDS = [(0.15, 0.62, 1.0, 0.98), (0.0, 0.3, 0.42, 0.66), (0.25, 0.0, 1.0, 0.4)]


def leaf_image():
    """Builds an RGBA leaf atlas: alpha derived from the black background of the photo."""
    src = bpy.data.images.load(os.path.join(TEX, 'jacaranda_tree_leaves_diff_1k.jpg'))
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    lum = px[:, :3].max(axis=1)
    px[:, 3] = np.clip((lum - 0.05) * 9.0, 0.0, 1.0)
    img = bpy.data.images.new('leaves_rgba', w, h, alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.file_format = 'PNG'
    path = os.path.join(ROOT, '.asset-cache', 'blender', 'leaves_rgba.png')
    img.filepath_raw = path
    img.save()
    return img


def textured_mat(name, diff_img, nor_path=None, alpha=False, tint=(1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = diff_img
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    if nor_path and os.path.exists(nor_path):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(nor_path)
        n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.85
    return m


class Builder:
    def __init__(self, seed):
        self.rnd = random.Random(seed)
        self.bm_bark = bmesh.new()
        self.bm_leaf = bmesh.new()
        self.uv_b = self.bm_bark.loops.layers.uv.new('UVMap')
        self.uv_l = self.bm_leaf.loops.layers.uv.new('UVMap')
        self.col = self.bm_leaf.loops.layers.color.new('Col')

    def limb(self, base, direction, length, r0, r1, segs=6, ring=7, wobble=0.15):
        """Tapered, slightly curving branch made of rings; returns the path points."""
        d = direction.normalized()
        pts = [base.copy()]
        side = d.orthogonal().normalized()
        for i in range(1, segs + 1):
            bend = Vector((self.rnd.uniform(-1, 1), self.rnd.uniform(-1, 1), self.rnd.uniform(-0.3, 0.6))) * wobble
            d = (d + bend * (1.0 / segs)).normalized()
            pts.append(pts[-1] + d * (length / segs))
        rings = []
        for i, p in enumerate(pts):
            t = i / segs
            r = r0 + (r1 - r0) * t
            tan = (pts[min(i + 1, segs)] - pts[max(i - 1, 0)]).normalized()
            a = tan.orthogonal().normalized()
            b = tan.cross(a).normalized()
            ring_v = []
            for k in range(ring):
                ang = 2 * math.pi * k / ring
                ring_v.append(self.bm_bark.verts.new(p + (a * math.cos(ang) + b * math.sin(ang)) * r))
            rings.append(ring_v)
        for i in range(segs):
            for k in range(ring):
                k2 = (k + 1) % ring
                f = self.bm_bark.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
                for l, (u, v) in zip(f.loops, ((k / ring, i * length / segs / 1.5), ((k + 1) / ring, i * length / segs / 1.5), ((k + 1) / ring, (i + 1) * length / segs / 1.5), (k / ring, (i + 1) * length / segs / 1.5))):
                    l[self.uv_b].uv = (u * max(1, r0 * 6), v)
        return pts

    def card(self, center, normal, up, size, tint):
        """One leaf card using a random frond of the atlas."""
        u0, v0, u1, v1 = self.rnd.choice(FRONDS)
        n = normal.normalized()
        x = up.cross(n).normalized()
        y = n.cross(x).normalized()
        w = size * (u1 - u0) / max(u1 - u0, v1 - v0)
        h = size * (v1 - v0) / max(u1 - u0, v1 - v0)
        corners = [center - x * w / 2 - y * h / 2, center + x * w / 2 - y * h / 2, center + x * w / 2 + y * h / 2, center - x * w / 2 + y * h / 2]
        vs = [self.bm_leaf.verts.new(c) for c in corners]
        f = self.bm_leaf.faces.new(vs)
        for l, uv in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
            l[self.uv_l].uv = uv
            l[self.col] = (*tint, 1.0)

    def finish(self, bark_mat, leaf_mat, name):
        bark = kit.obj_from_bmesh(name + '_bark', self.bm_bark, bark_mat)
        leaves = kit.obj_from_bmesh(name + '_leaves', self.bm_leaf, leaf_mat)
        for o in (bark, leaves):
            for p in o.data.polygons:
                p.use_smooth = True
        return [bark, leaves]


def broadleaf(seed, lod, bark_mat, leaf_mat):
    b = Builder(seed)
    rnd = b.rnd
    height = rnd.uniform(4.2, 5.4)
    trunk = b.limb(Vector((0, 0, -0.2)), Vector((rnd.uniform(-.1, .1), rnd.uniform(-.1, .1), 1)), height, 0.32, 0.16, segs=7, ring=9 if not lod else 6, wobble=0.25)
    n_main = 7 if not lod else 5
    tips = []
    for i in range(n_main):
        t = 0.45 + 0.5 * i / n_main
        p = trunk[int(t * (len(trunk) - 1))]
        ang = i * 2.4 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(ang), math.sin(ang), rnd.uniform(0.5, 1.1)))
        ln = rnd.uniform(2.2, 3.4) * (1.1 - t * 0.4)
        br = b.limb(p, d, ln, 0.13 * (1.1 - t * 0.5), 0.04, segs=5 if not lod else 3, ring=6 if not lod else 4, wobble=0.35)
        tips.append(br)
        if not lod:
            for j in range(2):
                q = br[rnd.randint(2, len(br) - 1)]
                sub = b.limb(q, d + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.2, 1))), rnd.uniform(1.0, 1.8), 0.045, 0.015, segs=3, ring=4, wobble=0.4)
                tips.append(sub)
    tips.append(trunk[-4:])
    # Canopy: clusters of leaf cards around branch ends, shaded darker inside.
    centre = Vector((0, 0, height * 0.9))
    count = 26 if not lod else 9
    size = 1.5 if not lod else 3.0
    for path in tips:
        for k in range(count // 2):
            p = path[-1 - rnd.randint(0, min(2, len(path) - 1))]
            off = Vector((rnd.gauss(0, 0.9), rnd.gauss(0, 0.9), rnd.gauss(0.2, 0.6)))
            c = p + off
            out = (c - centre)
            shade = 0.55 + 0.45 * min(1, out.length / 3.5)
            normal = (out.normalized() + Vector((rnd.uniform(-.6, .6), rnd.uniform(-.6, .6), rnd.uniform(0, .8)))).normalized()
            up = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.3)).normalized()
            g = rnd.uniform(0.85, 1.05)
            b.card(c, normal, up, size * rnd.uniform(0.8, 1.2), (shade * g * 0.95, shade * g, shade * g * 0.8))
    return b.finish(bark_mat, leaf_mat, 'broadleaf')


def fir(seed, lod, bark_mat, leaf_mat):
    b = Builder(seed)
    rnd = b.rnd
    height = rnd.uniform(7.5, 9.5)
    b.limb(Vector((0, 0, -0.2)), Vector((0, 0, 1)), height, 0.26, 0.03, segs=8, ring=8 if not lod else 5, wobble=0.05)
    whorls = 11 if not lod else 6
    for w in range(whorls):
        t = 0.15 + 0.85 * w / whorls
        z = height * t
        reach = (1 - t) * 2.6 + 0.35
        nb = 6 if not lod else 4
        for i in range(nb):
            ang = i * 2 * math.pi / nb + w * 0.7 + rnd.uniform(-0.2, 0.2)
            d = Vector((math.cos(ang), math.sin(ang), -0.25))
            if not lod:
                b.limb(Vector((0, 0, z)), d, reach, 0.04, 0.012, segs=2, ring=4, wobble=0.1)
            for k in range(3 if not lod else 1):
                c = Vector((0, 0, z)) + d.normalized() * reach * (0.45 + 0.3 * k) + Vector((0, 0, -0.1 * k))
                shade = 0.45 + 0.4 * (k + 1) / 3
                normal = Vector((d.x, d.y, 0.9)).normalized()
                b.card(c, normal, d, (0.9 + reach * 0.55) * (1.0 if not lod else 1.6), (shade * 0.55, shade * 0.75, shade * 0.5))
    return b.finish(bark_mat, leaf_mat, 'fir')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, gen in (('tree_broadleaf', broadleaf), ('tree_fir', fir)):
        for lod in (False, True):
            kit.reset()
            bark_img = bpy.data.images.load(os.path.join(TEX, 'jacaranda_tree_trunk_diff_1k.jpg'))
            bark = textured_mat('bark', bark_img, os.path.join(TEX, 'jacaranda_tree_trunk_nor_gl_1k.jpg'))
            leaves = textured_mat('leaves', leaf_image(), alpha=True)
            objs = []
            for v in range(3):
                parts = gen(11 + v * 17, lod, bark, leaves)
                for o in parts:
                    o.location.x += v * 12  # three variants side by side (split in the game by node)
                group = kit.join(parts, f'variant_{v}') if len(parts) > 1 else parts[0]
                objs.append(group)
            suffix = '_lod' if lod else ''
            kit.export_glb(os.path.join(OUT, f'{name}{suffix}.glb'))
            print('exported', name + suffix, sum(len(o.data.polygons) for o in objs), 'faces')


if __name__ == '__main__':
    main()
