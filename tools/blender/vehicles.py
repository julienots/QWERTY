"""Generic cars for Val-Lumen's traffic (original, unbranded designs), modelled in Blender.

Nodes: body (material `paint` — tinted per car in the game), glass, trim, headlights
(`headlight`), taillights (`taillight`), wheel_fl / wheel_fr / wheel_rl / wheel_rr (spin).
Front faces glTF +Z. Run: <blender-python> tools/blender/vehicles.py <out_dir>
"""
import math
import os
import sys

import bpy  # noqa: F401
import bmesh  # noqa: F401

sys.path.insert(0, os.path.dirname(__file__))
import kit  # noqa: E402

OUT = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].endswith('.py') else 'public/assets/models'


def wheel(name, x, y, r, width, m):
    tyre = kit.lathe(name + '_t', [(r * 0.62, -width / 2), (r * 0.95, -width / 2), (r, -width * 0.3), (r, width * 0.3), (r * 0.95, width / 2), (r * 0.62, width / 2)], m['tyre'], segments=24)
    rim = kit.lathe(name + '_r', [(0.001, width * 0.45), (r * 0.62, width * 0.4), (r * 0.62, -width * 0.2), (0.001, -width * 0.1)], m['rim'], segments=24)
    spokes = [kit.box(f'{name}_s{i}', (0.05, 0.04, r * 1.15), loc=(0, width * 0.42, 0), material=m['rim']) for i in range(5)]
    for i, s in enumerate(spokes):
        s.data.transform(kit.euler_matrix((0, i * 2 * math.pi / 5, 0)))
        s.data.transform(__import__('mathutils').Matrix.Translation((0, 0, 0)))
    w = kit.join([tyre, rim, *spokes], name)
    # lathe axis is Blender Y; wheels spin around the car's X axis
    w.data.transform(kit.euler_matrix((0, 0, math.pi / 2)))
    if x < 0:
        w.data.transform(kit.euler_matrix((0, 0, math.pi)))
    kit.smooth(w, 50)
    w.location = (x, y, r)
    return w


def car(name, length, width, profile, cabin, wheel_r=0.34):
    kit.reset()
    m = {
        'paint': kit.mat('paint', (0.7, 0.1, 0.1), metal=0.6, rough=0.25),
        'glass': kit.mat('glass', (0.05, 0.07, 0.09), metal=0.8, rough=0.05),
        'trim': kit.mat('trim', (0.04, 0.04, 0.045), metal=0.3, rough=0.6),
        'chrome': kit.mat('chrome', (0.9, 0.9, 0.92), metal=1.0, rough=0.15),
        'tyre': kit.mat('tyre', (0.03, 0.03, 0.03), rough=0.9),
        'rim': kit.mat('rim', (0.7, 0.72, 0.75), metal=0.9, rough=0.3),
        'head': kit.mat('headlight', (1, 1, 0.95), emission=(1, 0.95, 0.85), strength=0.3),
        'tail': kit.mat('taillight', (0.5, 0.02, 0.02), emission=(1, 0.05, 0.05), strength=0.4),
    }
    # Body: loft of rounded-box sections along the car (Blender -Y = front)
    secs = [(y * length / 2, w * width, h, zo, 4.0) for (y, w, h, zo) in profile]
    body = kit.loft('body', secs, m['paint'], ring=20)
    kit.add_subsurf(body, 1)
    kit.finish(body, 35)
    cab = kit.loft('glass', [(y * length / 2, w * width, h, zo, 3.2) for (y, w, h, zo) in cabin], m['glass'], ring=16)
    kit.add_subsurf(cab, 1)
    kit.finish(cab, 30)
    roof = kit.loft('roof', [(y * length / 2, w * width * 0.9, 0.07, zo + h / 2 - 0.12, 3.0) for (y, w, h, zo) in cabin[1:-1]], m['paint'], ring=12)
    kit.finish(roof, 30)
    bumper_f = kit.box('bumper_f', (width * 0.98, 0.18, 0.22), loc=(0, -length / 2 + 0.05, 0.38), material=m['trim'], bevel=0.05)
    bumper_r = kit.box('bumper_r', (width * 0.98, 0.18, 0.22), loc=(0, length / 2 - 0.05, 0.4), material=m['trim'], bevel=0.05)
    grille = kit.box('grille', (width * 0.45, 0.04, 0.16), loc=(0, -length / 2 + 0.02, 0.6), material=m['trim'])
    heads = [kit.box('h', (0.32, 0.06, 0.12), loc=(sx * width * 0.34, -length / 2 + 0.08, 0.68), material=m['head'], bevel=0.02) for sx in (-1, 1)]
    tails = [kit.box('t', (0.3, 0.06, 0.1), loc=(sx * width * 0.36, length / 2 - 0.06, 0.74), material=m['tail'], bevel=0.02) for sx in (-1, 1)]
    mirrors = [kit.box('mir', (0.14, 0.06, 0.1), loc=(sx * width * 0.53, cabin[0][0] * length / 2 + 0.25, 1.02), material=m['paint'], bevel=0.02) for sx in (-1, 1)]
    handles = [kit.box('hd', (0.02, 0.18, 0.03), loc=(sx * width * 0.5, 0.15, 0.95), material=m['chrome']) for sx in (-1, 1)]
    plate = kit.box('plate', (0.5, 0.02, 0.12), loc=(0, length / 2 + 0.04, 0.45), material=kit.mat('plate', (0.95, 0.95, 0.9), rough=0.5))
    for o in [bumper_f, bumper_r, grille, *heads, *tails, *mirrors, *handles, plate]:
        kit.apply_all(o)
    kit.join([bumper_f, bumper_r, grille], 'trim_parts')
    kit.join(heads, 'headlights')
    kit.join(tails, 'taillights')
    kit.join([*mirrors, *handles, plate], 'details')
    wb = length * 0.31
    for nm, x, y in (('wheel_fl', -width * 0.42, -wb), ('wheel_fr', width * 0.42, -wb), ('wheel_rl', -width * 0.42, wb), ('wheel_rr', width * 0.42, wb)):
        wheel(nm, x, y, wheel_r, 0.24, m)
    kit.export_glb(os.path.join(OUT, f'{name}.glb'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # (y along length -1..1, width factor, height, z offset of section centre)
    car('car_sedan', 4.5, 1.8,
        [(-1.0, 0.86, 0.36, 0.55), (-0.92, 0.97, 0.5, 0.6), (-0.55, 1.0, 0.58, 0.64), (0.0, 1.0, 0.62, 0.64), (0.6, 1.0, 0.6, 0.66), (0.92, 0.97, 0.52, 0.68), (1.0, 0.9, 0.4, 0.66)],
        [(-0.42, 0.78, 0.1, 0.95), (-0.2, 0.86, 0.5, 1.15), (0.25, 0.86, 0.5, 1.15), (0.55, 0.8, 0.2, 0.98)])
    car('car_hatch', 3.9, 1.75,
        [(-1.0, 0.85, 0.36, 0.55), (-0.9, 0.97, 0.5, 0.6), (-0.5, 1.0, 0.6, 0.65), (0.2, 1.0, 0.64, 0.66), (0.85, 0.98, 0.62, 0.7), (1.0, 0.92, 0.55, 0.72)],
        [(-0.42, 0.78, 0.1, 0.95), (-0.15, 0.88, 0.56, 1.18), (0.7, 0.88, 0.56, 1.2), (0.95, 0.84, 0.4, 1.1)])
    print('vehicles exported')
