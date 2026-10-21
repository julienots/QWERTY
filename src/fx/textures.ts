import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

/**
 * Procedurally painted textures (no image files). Each texture is generated once and cached.
 * They are deliberately subtle: colour mostly comes from materials, the textures add
 * believable surface detail (grain, joints, wear).
 */

const cache = new Map<string, THREE.Texture>();
let maxAniso = 4;
export function setMaxAnisotropy(a: number) { maxAniso = a; }

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, key: string, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, n: number, rnd: () => number, colors: string[], maxR = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.globalAlpha = 0.15 + rnd() * 0.35;
    const r = 0.5 + rnd() * maxR;
    ctx.fillRect(rnd() * size, rnd() * size, r, r);
  }
  ctx.globalAlpha = 1;
}

export function tex(name: string): THREE.Texture {
  const hit = cache.get(name);
  if (hit) return hit;
  const rnd = mulberry32(name.length * 977 + name.charCodeAt(0));
  switch (name) {
    case 'grass': {
      const [c, x] = canvas(256);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 9000, rnd, ['#9aa58c', '#c9d6b8', '#7d8a70', '#e8eedf'], 2.5);
      for (let i = 0; i < 1500; i++) {
        x.strokeStyle = rnd() > 0.5 ? '#8c9a7c' : '#d9e3cc';
        x.globalAlpha = 0.25;
        const px = rnd() * 256, py = rnd() * 256;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - 0.5) * 3, py - 3 - rnd() * 4); x.stroke();
      }
      return finish(c, name);
    }
    case 'asphalt': {
      const [c, x] = canvas(256);
      x.fillStyle = '#5a5c60';
      x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 14000, rnd, ['#2d2e31', '#77797d', '#444549', '#8a8c8f'], 1.6);
      x.globalAlpha = 0.15;
      x.strokeStyle = '#222';
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        let px = rnd() * 256, py = rnd() * 256;
        x.moveTo(px, py);
        for (let j = 0; j < 8; j++) { px += (rnd() - 0.5) * 30; py += (rnd() - 0.5) * 30; x.lineTo(px, py); }
        x.stroke();
      }
      x.globalAlpha = 1;
      return finish(c, name);
    }
    case 'concrete': {
      const [c, x] = canvas(256);
      x.fillStyle = '#b9b6ae';
      x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 8000, rnd, ['#9d9a93', '#cfccc5', '#a8a59e'], 1.5);
      x.strokeStyle = '#8a877f';
      x.lineWidth = 2;
      x.strokeRect(0, 0, 256, 256);
      return finish(c, name);
    }
    case 'brick': {
      const [c, x] = canvas(256);
      x.fillStyle = '#cfc8bd';
      x.fillRect(0, 0, 256, 256);
      const bh = 16, bw = 48;
      for (let row = 0; row < 256 / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < 256 / bw + 1; col++) {
          const v = 0.75 + rnd() * 0.25;
          x.fillStyle = `rgb(${Math.floor(178 * v)},${Math.floor(92 * v)},${Math.floor(70 * v)})`;
          x.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        }
      }
      speckle(x, 256, 3000, rnd, ['#000', '#fff'], 1.2);
      return finish(c, name);
    }
    case 'plaster': {
      const [c, x] = canvas(256);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 12000, rnd, ['#e9e6e0', '#f6f4ef', '#dedad2'], 2);
      return finish(c, name);
    }
    case 'wood': {
      const [c, x] = canvas(256);
      const plank = 32;
      for (let i = 0; i < 256 / plank; i++) {
        const v = 0.8 + rnd() * 0.2;
        x.fillStyle = `rgb(${Math.floor(166 * v)},${Math.floor(118 * v)},${Math.floor(78 * v)})`;
        x.fillRect(0, i * plank, 256, plank);
        x.strokeStyle = 'rgba(60,35,20,0.25)';
        for (let g = 0; g < 10; g++) {
          x.beginPath();
          const y = i * plank + rnd() * plank;
          x.moveTo(0, y);
          for (let px = 0; px <= 256; px += 16) x.lineTo(px, y + Math.sin(px * 0.05 + g) * 1.5);
          x.stroke();
        }
        x.fillStyle = 'rgba(40,25,15,0.6)';
        x.fillRect(0, i * plank, 256, 1.5);
        const cut = rnd() * 256;
        x.fillRect(cut, i * plank, 1.5, plank);
      }
      return finish(c, name);
    }
    case 'panel': {
      // Space-station interior: padded off-white panels, seams, handrail mounts and labels.
      const [c, x] = canvas(512);
      x.fillStyle = '#c9ccd0';
      x.fillRect(0, 0, 512, 512);
      const cols = 2, rows = 2, w = 512 / cols, h = 512 / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const px = i * w + 5, py = j * h + 5, pw = w - 10, ph = h - 10;
        const g = x.createLinearGradient(px, py, px, py + ph);
        const v = 0.95 + rnd() * 0.05;
        g.addColorStop(0, `rgb(${Math.floor(246 * v)},${Math.floor(246 * v)},${Math.floor(242 * v)})`);
        g.addColorStop(1, `rgb(${Math.floor(222 * v)},${Math.floor(223 * v)},${Math.floor(220 * v)})`);
        x.fillStyle = g;
        x.beginPath();
        x.roundRect(px, py, pw, ph, 14);
        x.fill();
        // quilting stitches
        x.strokeStyle = 'rgba(0,0,0,0.07)';
        x.lineWidth = 2;
        for (let k = 1; k < 3; k++) { x.beginPath(); x.moveTo(px + 10, py + (ph * k) / 3); x.lineTo(px + pw - 10, py + (ph * k) / 3); x.stroke(); }
        // fasteners
        x.fillStyle = '#8d939a';
        for (const [fx, fy] of [[px + 12, py + 12], [px + pw - 12, py + 12], [px + 12, py + ph - 12], [px + pw - 12, py + ph - 12]]) { x.beginPath(); x.arc(fx, fy, 4, 0, Math.PI * 2); x.fill(); }
        // occasional velcro patch / label
        if (rnd() < 0.7) {
          x.fillStyle = rnd() < 0.5 ? '#2c3e66' : '#5a5e63';
          x.fillRect(px + 30 + rnd() * (pw - 120), py + 30 + rnd() * (ph - 90), 50 + rnd() * 30, 18 + rnd() * 16);
        }
        if (rnd() < 0.5) {
          x.fillStyle = '#e8b12c';
          x.fillRect(px + pw - 70, py + ph - 34, 52, 12);
        }
      }
      return finish(c, name);
    }
    case 'tiles': {
      const [c, x] = canvas(256);
      x.fillStyle = '#9a9a9a';
      x.fillRect(0, 0, 256, 256);
      const s = 64;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const v = 0.92 + rnd() * 0.08;
        x.fillStyle = `rgb(${Math.floor(240 * v)},${Math.floor(240 * v)},${Math.floor(236 * v)})`;
        x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
      return finish(c, name);
    }
    case 'roof': {
      const [c, x] = canvas(256);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 256, 256);
      const h = 21, w = 32;
      for (let row = 0; row < 13; row++) {
        const off = row % 2 ? w / 2 : 0;
        for (let col = -1; col < 9; col++) {
          const v = 0.7 + rnd() * 0.3;
          x.fillStyle = `rgb(${Math.floor(255 * v)},${Math.floor(255 * v)},${Math.floor(255 * v)})`;
          x.beginPath();
          x.roundRect(col * w + off + 1, row * h, w - 2, h + 4, [0, 0, 8, 8]);
          x.fill();
          x.fillStyle = 'rgba(0,0,0,0.35)';
          x.fillRect(col * w + off + 1, row * h + h + 2, w - 2, 2);
        }
      }
      return finish(c, name);
    }
    case 'fabric': {
      const [c, x] = canvas(128);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 128, 128);
      x.globalAlpha = 0.12;
      for (let i = 0; i < 128; i += 2) {
        x.fillStyle = '#000';
        x.fillRect(i, 0, 1, 128);
        x.fillRect(0, i, 128, 1);
      }
      x.globalAlpha = 1;
      speckle(x, 128, 1500, rnd, ['#ddd', '#fff'], 1);
      return finish(c, name);
    }
    case 'rock': {
      const [c, x] = canvas(256);
      x.fillStyle = '#8b8780';
      x.fillRect(0, 0, 256, 256);
      speckle(x, 256, 16000, rnd, ['#6f6b64', '#a6a29a', '#58544e', '#bdb9b1'], 3);
      return finish(c, name);
    }
    case 'moon': {
      const [c, x] = canvas(512);
      x.fillStyle = '#9a9894';
      x.fillRect(0, 0, 512, 512);
      speckle(x, 512, 30000, rnd, ['#7d7b77', '#b1afab', '#8a8884'], 2.5);
      for (let i = 0; i < 70; i++) {
        const px = rnd() * 512, py = rnd() * 512, r = 3 + rnd() * rnd() * 40;
        const g = x.createRadialGradient(px, py, r * 0.2, px, py, r);
        g.addColorStop(0, 'rgba(60,60,60,0.35)');
        g.addColorStop(0.8, 'rgba(90,90,90,0.15)');
        g.addColorStop(0.92, 'rgba(220,220,220,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
      return finish(c, name);
    }
    case 'metal': {
      const [c, x] = canvas(256);
      x.fillStyle = '#c9ccd0';
      x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 256; i++) {
        x.fillStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},255,0.04)`;
        x.fillRect(0, i, 256, 1);
      }
      x.strokeStyle = 'rgba(40,40,50,0.5)';
      x.lineWidth = 2;
      x.strokeRect(1, 1, 254, 254);
      x.fillStyle = 'rgba(40,40,50,0.6)';
      for (const [px, py] of [[8, 8], [248, 8], [8, 248], [248, 248]]) { x.beginPath(); x.arc(px, py, 3, 0, Math.PI * 2); x.fill(); }
      return finish(c, name);
    }
    case 'glow': {
      const [c, x] = canvas(64);
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return finish(c, name, 1);
    }
    case 'cloud': {
      const [c, x] = canvas(256);
      for (let i = 0; i < 26; i++) {
        const px = 40 + rnd() * 176, py = 90 + rnd() * 80, r = 20 + rnd() * 50;
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
      const t = finish(c, name, 1);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    }
    default:
      throw new Error('unknown texture ' + name);
  }
}

/** A facade texture with lit windows, used for apartment buildings. */
export function facadeTexture(seed: number, floors: number, cols: number): { map: THREE.Texture; emissive: THREE.Texture } {
  const key = `facade_${seed}_${floors}_${cols}`;
  const rnd = mulberry32(seed);
  const W = 256, H = 512;
  const [c, x] = canvas(256);
  c.height = H;
  const [e, ex] = canvas(256);
  e.height = H;
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  speckle(x, W, 3000, rnd, ['#ddd', '#eee'], 1.5);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  const fh = H / floors, cw = W / cols;
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < cols; k++) {
      const wx = k * cw + cw * 0.18, wy = f * fh + fh * 0.22, ww = cw * 0.64, wh = fh * 0.5;
      x.fillStyle = '#2a3440';
      x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(255,255,255,0.18)';
      x.fillRect(wx, wy, ww, wh * 0.3);
      if (rnd() < 0.45) {
        const warm = rnd() < 0.7;
        ex.fillStyle = warm ? '#ffcf8a' : '#bfe3ff';
        ex.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const map = finish(c, key);
  const emissive = finish(e, key + '_e');
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  emissive.wrapS = emissive.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissive };
}

/** Animated TV / screen texture. */
export class ScreenTexture {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  private t = 0;
  constructor(private lines: string[], private w = 256, private h = 144) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(false);
  }
  setLines(lines: string[]) { this.lines = lines; }
  draw(on: boolean) {
    const x = this.ctx;
    x.fillStyle = on ? '#0b1a33' : '#050505';
    x.fillRect(0, 0, this.w, this.h);
    if (on) {
      const g = x.createLinearGradient(0, 0, this.w, this.h);
      g.addColorStop(0, 'rgba(80,140,255,0.5)');
      g.addColorStop(1, 'rgba(255,90,140,0.25)');
      x.fillStyle = g;
      x.fillRect(0, 0, this.w, this.h);
      x.fillStyle = '#ffd23f';
      x.font = 'bold 16px sans-serif';
      x.fillText('VAL-LUMEN INFO', 10, 24);
      x.fillStyle = '#fff';
      x.font = '13px sans-serif';
      this.lines.slice(0, 4).forEach((l, i) => x.fillText(l, 10, 52 + i * 18));
      x.fillStyle = '#c0182c';
      x.fillRect(0, this.h - 22, this.w, 22);
      x.fillStyle = '#fff';
      x.font = 'bold 12px sans-serif';
      const ticker = '  EN DIRECT • Pluie de météores observée cette nuit • Les autorités appellent au calme • ';
      const off = (this.t * 40) % 600;
      x.fillText(ticker + ticker, -off, this.h - 7);
    } else {
      x.fillStyle = 'rgba(255,255,255,0.05)';
      x.fillRect(this.w * 0.1, this.h * 0.1, this.w * 0.3, this.h * 0.2);
    }
    this.texture.needsUpdate = true;
  }
  update(dt: number, on: boolean) {
    this.t += dt;
    if (on) this.draw(true);
  }
}

/** Tileable water ripple normal map (sum of integer-frequency waves, so it wraps seamlessly). */
export function waterNormalTexture(): THREE.Texture {
  const hit = cache.get('water-normal');
  if (hit) return hit;
  const size = 256;
  const [c, ctx] = canvas(size);
  const rnd = mulberry32(4242);
  const waves = Array.from({ length: 14 }, () => ({ kx: Math.round((rnd() * 2 - 1) * 9), kz: Math.round((rnd() * 2 - 1) * 9), a: 0.4 + rnd(), p: rnd() * Math.PI * 2 }))
    .filter((w) => w.kx || w.kz);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dz = 0;
      const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
      for (const w of waves) {
        const k = Math.hypot(w.kx, w.kz);
        const cs = Math.cos(w.kx * u + w.kz * v + w.p) * w.a / k;
        dx += cs * w.kx; dz += cs * w.kz;
      }
      const n = new THREE.Vector3(-dx * 0.18, -dz * 0.18, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, 'water-normal', 1, false);
}
