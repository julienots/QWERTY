import type { Settings } from '../core/Settings';

export interface RadialItem {
  id: string;
  icon: string;
  color: string;
  name: string;
}

export interface ControlContext {
  actionLabel: string | null;
  actionIcon: string;
  jumpIcon: string;
  powerIcon: string;
  powerColor: string;
  powerReady: number; // 0..1 cooldown progress
  powerAvailable: boolean;
  mode: 'walk' | 'fly' | 'ship' | 'menu';
}

/**
 * Unified input. Touch: floating joystick (left), camera drag (right), three contextual
 * buttons and a radial power menu (long press on the power button). Desktop: WASD, mouse
 * look with pointer lock, Space/Shift/E/F and number keys.
 */
export class Input {
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  jumpHeld = false;
  private touchJump = false;
  private touchDown = false;
  private btnDown!: HTMLElement;
  descendHeld = false;
  run = false;
  private pressed = new Set<string>();
  private keys = new Set<string>();

  isTouch = false;
  root: HTMLElement;
  private joyBase!: HTMLElement;
  private joyKnob!: HTMLElement;
  private btnAction!: HTMLButtonElement;
  private btnJump!: HTMLButtonElement;
  private btnPower!: HTMLButtonElement;
  private powerRing!: HTMLElement;
  private radial!: HTMLElement;
  private joyPointer: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookPointers = new Map<number, { x: number; y: number }>();
  private powerPointer: number | null = null;
  private powerDownAt = 0;
  private radialOpen = false;
  private radialItems: RadialItem[] = [];
  private radialHover: string | null = null;
  private jumpTapTimes: number[] = [];
  enabled = true;

  /** Provides favourite powers for the radial menu. */
  radialProvider: () => RadialItem[] = () => [];
  onRadialSelect: (id: string) => void = () => {};
  onMenu: () => void = () => {};

  constructor(private container: HTMLElement, private settings: Settings) {
    this.root = document.createElement('div');
    this.root.className = 'controls';
    container.appendChild(this.root);
    this.buildTouch();
    this.bindKeyboard();
    this.applySettings(settings);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.root.style.setProperty('--ctl-scale', String(s.controlScale));
    this.root.style.setProperty('--ctl-opacity', String(s.controlOpacity));
    this.root.classList.toggle('left-handed', s.leftHanded);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = this.root): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    parent.appendChild(e);
    return e;
  }

  private buildTouch(): void {
    const look = this.el('div', 'look-zone');
    const joyZone = this.el('div', 'joy-zone');
    this.joyBase = this.el('div', 'joy-base', this.root);
    this.joyKnob = this.el('div', 'joy-knob', this.joyBase);
    const cluster = this.el('div', 'btn-cluster');
    this.btnAction = this.el('button', 'ctl-btn btn-action', cluster);
    this.btnJump = this.el('button', 'ctl-btn btn-jump', cluster);
    this.btnPower = this.el('button', 'ctl-btn btn-power', cluster);
    // Descend (flight and ship only): held like the jump button.
    this.btnDown = this.el('button', 'ctl-btn btn-down', cluster);
    this.btnDown.dataset.testid = 'btn-down';
    this.btnDown.innerHTML = '<span class="ic">⇩</span>';
    this.btnDown.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.markTouch(e); this.btnDown.setPointerCapture(e.pointerId); this.touchDown = true; this.btnDown.classList.add('down'); });
    const downUp = () => { this.touchDown = false; this.btnDown.classList.remove('down'); };
    this.btnDown.addEventListener('pointerup', downUp);
    this.btnDown.addEventListener('pointercancel', downUp);
    this.powerRing = this.el('div', 'power-ring', this.btnPower);
    this.btnAction.dataset.testid = 'btn-action';
    this.btnJump.dataset.testid = 'btn-jump';
    this.btnPower.dataset.testid = 'btn-power';
    this.btnAction.innerHTML = '<span class="ic">✋</span><span class="lbl"></span>';
    this.btnJump.innerHTML = '<span class="ic">⤒</span>';
    this.btnPower.innerHTML += '<span class="ic">✦</span>';
    this.radial = this.el('div', 'radial hidden', this.container);

    // Joystick
    joyZone.addEventListener('pointerdown', (e) => {
      if (this.joyPointer !== null || !this.enabled) return;
      this.markTouch(e);
      this.joyPointer = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.left = e.clientX + 'px';
      this.joyBase.style.top = e.clientY + 'px';
      this.joyBase.classList.add('active');
      this.updateJoy(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyPointer) this.updateJoy(e.clientX, e.clientY);
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = null;
      this.moveX = 0; this.moveY = 0; this.run = false;
      this.joyBase.classList.remove('active');
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
    };
    joyZone.addEventListener('pointerup', joyEnd);
    joyZone.addEventListener('pointercancel', joyEnd);

    // Camera look
    look.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.markTouch(e);
      if (e.pointerType === 'mouse' && !this.isTouch) {
        if (document.pointerLockElement !== document.body) document.body.requestPointerLock?.();
        if (e.button === 0) this.pressed.add('power');
        if (e.button === 2) this.pressed.add('action');
        return;
      }
      look.setPointerCapture(e.pointerId);
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    look.addEventListener('pointermove', (e) => {
      const p = this.lookPointers.get(e.pointerId);
      if (!p) return;
      this.lookDX += e.clientX - p.x;
      this.lookDY += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    });
    const lookEnd = (e: PointerEvent) => { this.lookPointers.delete(e.pointerId); };
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);
    look.addEventListener('contextmenu', (e) => e.preventDefault());

    // Buttons
    this.btnAction.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.markTouch(e); this.pressed.add('action'); this.btnAction.classList.add('down'); });
    this.btnAction.addEventListener('pointerup', () => this.btnAction.classList.remove('down'));
    this.btnAction.addEventListener('pointercancel', () => this.btnAction.classList.remove('down'));
    this.btnJump.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.markTouch(e);
      this.btnJump.setPointerCapture(e.pointerId);
      this.pressed.add('jump');
      this.touchJump = true;
      this.btnJump.classList.add('down');
      const now = performance.now();
      this.jumpTapTimes = this.jumpTapTimes.filter((t) => now - t < 350);
      this.jumpTapTimes.push(now);
      if (this.jumpTapTimes.length >= 2) { this.pressed.add('doubleJump'); this.jumpTapTimes = []; }
    });
    const jumpUp = () => { this.touchJump = false; this.btnJump.classList.remove('down'); };
    this.btnJump.addEventListener('pointerup', jumpUp);
    this.btnJump.addEventListener('pointercancel', jumpUp);

    this.btnPower.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.markTouch(e);
      this.btnPower.setPointerCapture(e.pointerId);
      this.powerPointer = e.pointerId;
      this.powerDownAt = performance.now();
      this.btnPower.classList.add('down');
    });
    this.btnPower.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.powerPointer) return;
      if (!this.radialOpen && performance.now() - this.powerDownAt > 280) this.openRadial();
      if (this.radialOpen) this.hoverRadial(e.clientX, e.clientY);
    });
    const powerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.powerPointer) return;
      this.powerPointer = null;
      this.btnPower.classList.remove('down');
      if (this.radialOpen) {
        this.hoverRadial(e.clientX, e.clientY);
        if (this.radialHover) this.onRadialSelect(this.radialHover);
        this.closeRadial();
      } else {
        this.pressed.add('power');
      }
    };
    this.btnPower.addEventListener('pointerup', powerUp);
    this.btnPower.addEventListener('pointercancel', powerUp);

    const menuBtn = this.el('button', 'menu-btn', this.container);
    menuBtn.dataset.testid = 'btn-menu';
    menuBtn.setAttribute('aria-label', 'Menu');
    menuBtn.innerHTML = '<span></span><span></span><span></span>';
    menuBtn.addEventListener('click', () => this.onMenu());
  }

  /** Called every frame so a held power button opens the radial menu without moving. */
  updateHold(): void {
    if (this.powerPointer !== null && !this.radialOpen && performance.now() - this.powerDownAt > 380) this.openRadial();
  }

  private markTouch(e: PointerEvent) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (!this.isTouch) {
        this.isTouch = true;
        document.body.classList.add('touch');
      }
    }
  }

  private updateJoy(x: number, y: number) {
    const radius = 56 * this.settings.controlScale;
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > radius) { dx *= radius / d; dy *= radius / d; }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dead = 0.12;
    let mx = dx / radius, my = -dy / radius;
    const m = Math.hypot(mx, my);
    if (m < dead) { mx = 0; my = 0; } else { const k = (m - dead) / (1 - dead) / m; mx *= k; my *= k; }
    this.moveX = mx;
    this.moveY = my;
    this.run = Math.hypot(mx, my) > 0.92;
  }

  private openRadial() {
    this.radialItems = this.radialProvider();
    if (this.radialItems.length === 0) return;
    this.radialOpen = true;
    const r = this.btnPower.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    this.radial.innerHTML = '';
    this.radial.classList.remove('hidden');
    const n = this.radialItems.length;
    const radius = Math.min(150, 70 + n * 10) * this.settings.controlScale;
    // Fan the items over the upper-left quadrant (thumb reach), or full circle if many.
    const span = n <= 5 ? Math.PI * 0.75 : Math.PI * 1.6;
    const start = Math.PI * (n <= 5 ? 0.62 : 0.2);
    this.radialItems.forEach((it, i) => {
      const a = start + (n === 1 ? span / 2 : (span * i) / (n - 1));
      const b = document.createElement('div');
      b.className = 'radial-item';
      b.dataset.id = it.id;
      b.style.left = cx + Math.cos(a) * radius * -1 + 'px';
      b.style.top = cy - Math.sin(a) * radius + 'px';
      b.style.setProperty('--c', it.color);
      b.innerHTML = `<span class="ic">${it.icon}</span><span class="nm">${it.name}</span>`;
      this.radial.appendChild(b);
    });
    this.radialHover = null;
  }

  private hoverRadial(x: number, y: number) {
    let best: string | null = null;
    let bestD = 60 * this.settings.controlScale;
    this.radial.querySelectorAll<HTMLElement>('.radial-item').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bestD) { bestD = d; best = el.dataset.id!; }
    });
    this.radialHover = best;
    this.radial.querySelectorAll<HTMLElement>('.radial-item').forEach((el) => el.classList.toggle('hover', el.dataset.id === best));
  }

  private closeRadial() {
    this.radialOpen = false;
    this.radial.classList.add('hidden');
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.code;
      if (!this.keys.has(k)) {
        this.pressed.add('key:' + k);
        if (k === 'Space') {
          this.pressed.add('jump');
          const now = performance.now();
          this.jumpTapTimes = this.jumpTapTimes.filter((t) => now - t < 350);
          this.jumpTapTimes.push(now);
          if (this.jumpTapTimes.length >= 2) { this.pressed.add('doubleJump'); this.jumpTapTimes = []; }
        }
        if (k === 'KeyE') this.pressed.add('action');
        if (k === 'KeyF') this.pressed.add('power');
        if (k === 'Escape' || k === 'Tab') { e.preventDefault(); this.onMenu(); }
      }
      this.keys.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === document.body && this.enabled) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== document.body || !this.enabled) return;
      if (e.button === 0) this.pressed.add('power');
      if (e.button === 2) this.pressed.add('action');
    });
  }

  /** Merge keyboard state into the analogue values. Call once per frame before reading. */
  poll(): void {
    if (this.joyPointer === null) {
      const k = this.keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const m = Math.hypot(x, y) || 1;
      this.moveX = x / m;
      this.moveY = y / m;
      this.run = k.has('ShiftLeft') || k.has('ShiftRight');
    }
    this.jumpHeld = this.keys.has('Space') || this.touchJump;
    this.descendHeld = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.touchDown;
    this.updateHold();
  }

  consume(name: string): boolean {
    if (this.pressed.has(name)) { this.pressed.delete(name); return true; }
    return false;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }

  clearFrame(): void {
    this.pressed.clear();
  }

  setContext(c: ControlContext): void {
    const lbl = this.btnAction.querySelector('.lbl') as HTMLElement;
    const ic = this.btnAction.querySelector('.ic') as HTMLElement;
    if (lbl.textContent !== (c.actionLabel ?? '')) lbl.textContent = c.actionLabel ?? '';
    if (ic.textContent !== c.actionIcon) ic.textContent = c.actionIcon;
    this.btnAction.classList.toggle('has-label', !!c.actionLabel);
    const ji = this.btnJump.querySelector('.ic') as HTMLElement;
    if (ji.textContent !== c.jumpIcon) ji.textContent = c.jumpIcon;
    const pi = this.btnPower.querySelector('.ic') as HTMLElement;
    if (pi.textContent !== c.powerIcon) pi.textContent = c.powerIcon;
    this.btnPower.style.setProperty('--c', c.powerColor);
    this.btnPower.classList.toggle('unavailable', !c.powerAvailable);
    this.powerRing.style.setProperty('--p', String(c.powerReady));
    this.root.dataset.mode = c.mode;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    (this.container.querySelector('.menu-btn') as HTMLElement | null)?.classList.toggle('hidden', !v);
    if (!v) {
      this.moveX = 0; this.moveY = 0; this.jumpHeld = false; this.touchJump = false; this.touchDown = false;
      this.joyPointer = null; this.joyBase.classList.remove('active');
      this.lookPointers.clear();
    }
  }
}
