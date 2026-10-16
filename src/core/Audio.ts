/**
 * Procedural audio: every sound is synthesised with WebAudio (no audio files), with
 * 3D positional playback, environmental ambience loops and a generative music layer.
 */

export type SfxName =
  | 'zap' | 'whoosh' | 'boom' | 'hum' | 'chime' | 'fire' | 'ice' | 'thunder' | 'warp'
  | 'step' | 'hit' | 'enemyHit' | 'growl' | 'door' | 'click' | 'pickup' | 'ui' | 'hurt' | 'levelup' | 'spit' | 'land' | 'engine';

export interface Vec3Like { x: number; y: number; z: number }

export interface AmbienceState {
  wind: number;
  rain: number;
  birds: number;
  crickets: number;
  drone: number;
  combat: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private droneGain!: GainNode;
  private ambience: AmbienceState = { wind: 0.2, rain: 0, birds: 0, crickets: 0, drone: 0, combat: 0 };
  private nextChirp = 0;
  private nextNote = 0;
  private chordIndex = 0;
  private volume = 0.8;
  private musicVolume = 0.5;
  private listener = { x: 0, y: 0, z: 0 };
  enabled = true;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVolume * 0.35; this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Wind loop
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    // Rain loop
    const rain = this.loopNoise();
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rf).connect(this.rainGain).connect(this.amb);
    // Deep space / cosmic drone
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    for (const f of [55, 82.4, 110.3]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.15;
      o.connect(g).connect(this.droneGain);
      o.start();
    }
    this.droneGain.connect(this.amb);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  setVolumes(master: number, music: number): void {
    this.volume = master;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(master, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(music * 0.35, this.ctx.currentTime, 0.05);
  }

  setListener(p: Vec3Like, forward: Vec3Like): void {
    this.listener.x = p.x; this.listener.y = p.y; this.listener.z = p.z;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener as any;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(forward.x, t); l.forwardY.setValueAtTime(forward.y, t); l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setAmbience(a: Partial<AmbienceState>): void {
    Object.assign(this.ambience, a);
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + this.ambience.wind * 0.35, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + this.ambience.wind * 900, t, 0.5);
    this.rainGain.gain.setTargetAtTime(this.ambience.rain * 0.25, t, 0.8);
    this.droneGain.gain.setTargetAtTime(this.ambience.drone * 0.25, t, 1.2);
  }

  /** Called every frame: schedules birds, crickets and generative music. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t > this.nextChirp) {
      if (this.ambience.birds > 0.05 && Math.random() < this.ambience.birds) this.chirp(t);
      if (this.ambience.crickets > 0.05 && Math.random() < this.ambience.crickets) this.cricket(t);
      this.nextChirp = t + 0.6 + Math.random() * 2.2;
    }
    if (t > this.nextNote) this.scheduleMusic(t);
  }

  private chirp(t: number) {
    const ctx = this.ctx!;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2500 + Math.random() * 2000;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + i * 0.11;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), s + 0.07);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.03 * this.ambience.birds, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 2 - 1;
      o.connect(g).connect(p).connect(this.amb);
      o.start(s); o.stop(s + 0.1);
    }
  }

  private cricket(t: number) {
    const ctx = this.ctx!;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + i * 0.045;
      o.frequency.value = 4200 + Math.random() * 300;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012 * this.ambience.crickets, s + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.03);
      o.connect(g).connect(this.amb);
      o.start(s); o.stop(s + 0.04);
    }
  }

  private static CHORDS = [
    [220, 261.6, 329.6, 392],
    [174.6, 220, 261.6, 329.6],
    [196, 246.9, 293.7, 392],
    [164.8, 207.7, 246.9, 329.6],
  ];

  private scheduleMusic(t: number) {
    const ctx = this.ctx!;
    const chord = AudioEngine.CHORDS[this.chordIndex++ % AudioEngine.CHORDS.length];
    const dur = 7.5;
    const cosmic = this.ambience.drone;
    for (const f of chord) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (cosmic > 0.5 ? 0.5 : 1);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2.5);
      g.gain.linearRampToValueAtTime(0, t + dur + 1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      o.connect(lp).connect(g).connect(this.music);
      o.start(t); o.stop(t + dur + 1.2);
    }
    if (this.ambience.combat > 0.1) {
      for (let i = 0; i < 16; i++) {
        const s = t + i * (dur / 16);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = chord[0] / 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(0.06 * this.ambience.combat, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 600;
        o.connect(lp).connect(g).connect(this.music);
        o.start(s); o.stop(s + 0.25);
      }
    }
    this.nextNote = t + dur;
  }

  /** Plays a synthesised sound effect, optionally positioned in 3D. */
  play(name: SfxName, opts: { position?: Vec3Like; volume?: number; pitch?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const vol = opts.volume ?? 1;
    const pitch = opts.pitch ?? 1;
    if (opts.position) {
      const dx = opts.position.x - this.listener.x, dy = opts.position.y - this.listener.y, dz = opts.position.z - this.listener.z;
      if (dx * dx + dy * dy + dz * dz > 160 * 160) return;
    }
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = vol;
    if (opts.position) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.2;
      p.positionX.value = opts.position.x;
      p.positionY.value = opts.position.y;
      p.positionZ.value = opts.position.z;
      out.connect(p).connect(this.sfx);
    } else out.connect(this.sfx);

    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, gain: number, start = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, t + start);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * pitch), t + start + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.linearRampToValueAtTime(gain, t + start + Math.min(0.02, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g).connect(out);
      o.start(t + start); o.stop(t + start + dur + 0.05);
    };
    const noise = (filter: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, q = 1, start = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0 * pitch, t + start);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t + start + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.linearRampToValueAtTime(gain, t + start + Math.min(0.03, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      src.connect(f).connect(g).connect(out);
      src.start(t + start, Math.random());
      src.stop(t + start + dur + 0.05);
    };

    switch (name) {
      case 'zap': osc('sawtooth', 1400, 260, 0.18, 0.18); noise('highpass', 3000, 1500, 0.1, 0.1); break;
      case 'whoosh': noise('bandpass', 300, 2200, 0.45, 0.5, 1.5); break;
      case 'boom': noise('lowpass', 1200, 60, 1.1, 0.9); osc('sine', 90, 30, 0.9, 0.6); break;
      case 'hum': osc('sine', 140, 150, 0.7, 0.25); osc('sine', 143, 290, 0.7, 0.15); break;
      case 'chime': osc('sine', 880, 880, 1.2, 0.15); osc('sine', 1320, 1320, 1.0, 0.1, 0.08); osc('sine', 1760, 1760, 0.9, 0.08, 0.16); break;
      case 'fire': noise('bandpass', 800, 200, 0.7, 0.6, 0.7); osc('sawtooth', 120, 60, 0.4, 0.12); break;
      case 'ice': osc('sine', 2400, 3600, 0.25, 0.1); noise('highpass', 5000, 3000, 0.3, 0.2); break;
      case 'thunder': noise('lowpass', 2500, 80, 2.4, 1.0, 0.5); noise('lowpass', 600, 40, 3, 0.6, 0.5, 0.25); break;
      case 'warp': osc('sawtooth', 180, 1400, 0.5, 0.12); noise('bandpass', 2000, 200, 0.6, 0.2, 3); break;
      case 'step': noise('lowpass', 900, 300, 0.08, 0.12); break;
      case 'land': noise('lowpass', 600, 80, 0.25, 0.4); break;
      case 'hit': noise('lowpass', 2500, 300, 0.15, 0.7); osc('square', 180, 60, 0.12, 0.2); break;
      case 'enemyHit': noise('bandpass', 1200, 500, 0.12, 0.4, 2); osc('square', 300, 120, 0.1, 0.1); break;
      case 'growl': osc('sawtooth', 90, 55, 0.7, 0.25); noise('bandpass', 400, 200, 0.7, 0.2, 4); break;
      case 'spit': noise('bandpass', 1500, 600, 0.25, 0.3, 3); osc('sine', 500, 200, 0.2, 0.1); break;
      case 'door': noise('bandpass', 300, 150, 0.4, 0.3, 5); osc('triangle', 220, 180, 0.3, 0.05); break;
      case 'click': osc('square', 2000, 1500, 0.03, 0.08); break;
      case 'ui': osc('sine', 660, 990, 0.08, 0.08); break;
      case 'pickup': osc('sine', 660, 1320, 0.2, 0.15); osc('sine', 990, 1980, 0.2, 0.1, 0.08); break;
      case 'hurt': osc('sawtooth', 260, 90, 0.25, 0.2); noise('lowpass', 1200, 200, 0.2, 0.3); break;
      case 'levelup':
        [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, f, 0.6, 0.15, i * 0.12));
        break;
      case 'engine': osc('sawtooth', 60, 70, 0.5, 0.15); noise('lowpass', 400, 300, 0.5, 0.3); break;
    }
  }
}
