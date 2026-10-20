"""Shared helpers for the game's Blender modelling scripts (run with Blender's Python, bpy >= 4.2).

Conventions: metres; the model's front faces Blender -Y (exported glTF +Z, the game's forward);
Blender Z is up (exported glTF +Y). Materials that the game re-binds to its shared PBR textures
are named with a `pbr_` prefix (e.g. `pbr_plaster`); everything else exports as-is.
"""
import math
import random

import bpy  # must be imported before bmesh when using the bpy module
import bmesh
from mathutils import Matrix, Vector


_mats = {}


def reset():
    _mats.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)



def mat(name, color=(0.8, 0.8, 0.8), metal=0.0, rough=0.5, emission=None, strength=1.0, alpha=1.0):
    """Principled BSDF material (exported to glTF metallic-roughness)."""
    key = name
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1.0)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
        try:
            m.surface_render_method = 'BLENDED'
        except AttributeError:
            pass
    _mats[key] = m
    return m


def obj_from_bmesh(name, bm, material=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if material:
        ob.data.materials.append(material)
    return ob


def superellipse(n, w, h, power=2.6, y_off=0.0):
    """Closed cross-section ring (in the X/Z plane) — power 2 = ellipse, higher = squarer."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c) ** (2 / power), c) * w / 2
        z = math.copysign(abs(s) ** (2 / power), s) * h / 2 + y_off
        pts.append((x, z))
    return pts


def loft(name, sections, material=None, ring=16, cap_start=True, cap_end=True):
    """Builds a tube through cross-sections.

    sections: list of (y, width, height, z_offset, power[, x_offset]) along Blender Y.
    """
    bm = bmesh.new()
    rings = []
    for sec in sections:
        y, w, h, zo, pw = sec[:5]
        xo = sec[5] if len(sec) > 5 else 0.0
        ring_pts = superellipse(ring, max(w, 1e-4), max(h, 1e-4), pw, zo)
        rings.append([bm.verts.new((x + xo, y, z)) for x, z in ring_pts])
    for a, b in zip(rings, rings[1:]):
        for i in range(ring):
            j = (i + 1) % ring
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, material)


def lathe(name, profile, material=None, segments=24, axis='Y'):
    """Surface of revolution from (radius, height) points around Blender Y (or Z)."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            if axis == 'Y':
                ring.append(bm.verts.new((math.cos(a) * r, h, math.sin(a) * r)))
            else:
                ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, h)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, material)


def box(name, size, loc=(0, 0, 0), material=None, bevel=0.0, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    ob = obj_from_bmesh(name, bm, material)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def cylinder(name, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), material=None, verts=20, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    m = Matrix.Translation(Vector(loc)) @ euler_matrix(rot)
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return obj_from_bmesh(name, bm, material)


def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), material=None, segments=24, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return obj_from_bmesh(name, bm, material)


def euler_matrix(rot):
    return (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X'))


def transform(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = scale
    return ob


def add_subsurf(ob, levels=2):
    m = ob.modifiers.new('subsurf', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return m


def add_bevel(ob, width, segments=2, angle=None):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    if angle is not None:
        m.limit_method = 'ANGLE'
        m.angle_limit = angle
    return m


def add_mirror(ob, axis_x=True):
    m = ob.modifiers.new('mirror', 'MIRROR')
    m.use_axis[0] = axis_x
    m.use_clip = True
    return m


def add_solidify(ob, thickness):
    m = ob.modifiers.new('solidify', 'SOLIDIFY')
    m.thickness = thickness
    return m


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def smooth(ob, angle_deg=40):
    """Smooth shading with sharp edges kept above `angle_deg` (split normals)."""
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.view_layer.objects:
            o.select_set(o == ob)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except Exception:
        try:
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(angle_deg)
        except AttributeError:
            pass


def finish(ob, angle=40):
    apply_all(ob)
    smooth(ob, angle)
    return ob


def box_uv(ob, meters_per_unit=1.0):
    """World-scale box-projected UVs (1 UV unit = `meters_per_unit` metres) for tiling textures."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = ob.matrix_world
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = mw @ l.vert.co
            if ax == 0:
                u, v = p.y, p.z
            elif ax == 1:
                u, v = p.x, p.z
            else:
                u, v = p.x, p.y
            l[uv].uv = (u / meters_per_unit, v / meters_per_unit)
    bm.to_mesh(me)
    bm.free()


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def parent(child, par):
    child.parent = par
    return child


def empty(name, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


def export_glb(path, selection=None):
    if selection is not None:
        bpy.ops.object.select_all(action='DESELECT')
        for o in selection:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=selection is not None,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_animations=True,
    )


def jitter_verts(ob, amount, seed=1):
    rnd = random.Random(seed)
    for v in ob.data.vertices:
        v.co.x += (rnd.random() - 0.5) * amount
        v.co.y += (rnd.random() - 0.5) * amount
        v.co.z += (rnd.random() - 0.5) * amount


def add_displace(ob, strength=0.05, size=0.25, kind='CLOUDS', seed=0):
    """Organic surface detail (noise displacement along normals)."""
    tex = bpy.data.textures.new(f'{ob.name}_disp{seed}', type=kind)
    if kind == 'CLOUDS':
        tex.noise_scale = size
        tex.noise_depth = 3
    elif kind == 'VORONOI':
        tex.noise_scale = size
    m = ob.modifiers.new('displace', 'DISPLACE')
    m.texture = tex
    m.strength = strength
    m.mid_level = 0.5
    m.texture_coords = 'OBJECT' if False else 'LOCAL'
    return m


def add_decimate(ob, ratio):
    m = ob.modifiers.new('decimate', 'DECIMATE')
    m.ratio = ratio
    return m


def bake_cavity(ob, base=(1, 1, 1), dark=0.35, light=1.15, layer='Col'):
    """Bakes concavity (dirt) and convexity (edge wear) into vertex colours (exported as COLOR_0)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    vals = []
    for v in bm.verts:
        if not v.link_edges:
            vals.append(0.0)
            continue
        avg = Vector((0, 0, 0))
        for e in v.link_edges:
            avg += e.other_vert(v).co
        avg /= len(v.link_edges)
        d = (avg - v.co)
        lens = sum(e.calc_length() for e in v.link_edges) / len(v.link_edges)
        vals.append(d.dot(v.normal) / max(lens, 1e-6))
    # normalise around the median
    s = sorted(vals)
    lo, hi = s[int(len(s) * 0.05)], s[int(len(s) * 0.95)]
    span = max(hi - lo, 1e-6)
    col = bm.loops.layers.color.new(layer) if hasattr(bm.loops.layers, 'color') else None
    if col is None:
        bm.free()
        return
    for f in bm.faces:
        for l in f.loops:
            t = (vals[l.vert.index] - lo) / span  # 0 = convex, 1 = concave
            k = light + (dark - light) * min(1, max(0, t))
            l[col] = (base[0] * k, base[1] * k, base[2] * k, 1.0)
    bm.to_mesh(me)
    bm.free()
