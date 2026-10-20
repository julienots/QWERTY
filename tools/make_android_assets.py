"""Generates Android launcher icons and splash screens (run from the repo root).

Icon: a golden planet ring around an ascending star on black. Splash: the SuperEssence logo
centred on black. Requires Pillow.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

RES = 'android/app/src/main/res'
LOGO = 'public/superessence-logo.jpg'
GOLD = (255, 210, 63)
CYAN = (127, 216, 255)


def icon(size, round_mask=False, foreground=False):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0 if foreground else 255))
    d = ImageDraw.Draw(img)
    cx = cy = s / 2
    scale = 0.62 if foreground else 1.0  # adaptive icon safe zone
    r = s * 0.30 * scale
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - r * 1.5, cy - r * 1.5, cx + r * 1.5, cy + r * 1.5], fill=(255, 210, 63, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.06))
    img.alpha_composite(glow)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(14, 18, 34, 255), outline=CYAN + (255,), width=int(s * 0.012))
    # Tilted ring
    ring = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([cx - r * 1.65, cy - r * 0.45, cx + r * 1.65, cy + r * 0.45], outline=GOLD + (255,), width=int(s * 0.03))
    ring = ring.rotate(-18, center=(cx, cy), resample=Image.BICUBIC)
    img.alpha_composite(ring)
    # Ascending star
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r * (0.62 if i % 2 == 0 else 0.25)
        pts.append((cx + math.cos(a) * rr, cy - r * 0.08 + math.sin(a) * rr))
    d.polygon(pts, fill=GOLD + (255,))
    if round_mask:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, s, s], fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FG = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for dens, px in SIZES.items():
    folder = f'{RES}/mipmap-{dens}'
    os.makedirs(folder, exist_ok=True)
    icon(px).save(f'{folder}/ic_launcher.png')
    icon(px, round_mask=True).save(f'{folder}/ic_launcher_round.png')
    icon(FG[dens], foreground=True).save(f'{folder}/ic_launcher_foreground.png')

logo = Image.open(LOGO).convert('RGB')
for folder in os.listdir(RES):
    path = f'{RES}/{folder}/splash.png'
    if folder.startswith('drawable') and os.path.exists(path):
        w, h = Image.open(path).size
        splash = Image.new('RGB', (w, h), (0, 0, 0))
        lw = int(min(w, h) * 0.7)
        lh = int(lw * logo.height / logo.width)
        splash.paste(logo.resize((lw, lh), Image.LANCZOS), ((w - lw) // 2, (h - lh) // 2))
        splash.save(path)
print('assets generated')
