import type { QualityLevel } from './Settings';
import { QUALITY_ORDER } from './Settings';

/**
 * Tracks frame times and recommends quality changes when auto-quality is enabled.
 * Lowers quality quickly when the game struggles, raises it slowly (never above 'high').
 */
export class PerfMonitor {
  private samples: number[] = [];
  private lowTimer = 0;
  private highTimer = 0;
  private cooldown = 0;
  fps = 60;
  frameMs = 16.7;

  constructor(private window = 90) {}

  record(dt: number): void {
    this.samples.push(dt);
    if (this.samples.length > this.window) this.samples.shift();
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.frameMs = avg * 1000;
    this.fps = avg > 0 ? 1 / avg : 60;
  }

  /** Returns a new quality level, or null if no change is recommended. */
  recommend(current: QualityLevel, dt: number): QualityLevel | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.samples.length < 30 || this.cooldown > 0) return null;
    const idx = QUALITY_ORDER.indexOf(current);
    if (this.fps < 26) {
      this.lowTimer += dt;
      this.highTimer = 0;
    } else if (this.fps > 56) {
      this.highTimer += dt;
      this.lowTimer = 0;
    } else {
      this.lowTimer = 0;
      this.highTimer = 0;
    }
    if (this.lowTimer > 3 && idx > 0) {
      this.reset();
      return QUALITY_ORDER[idx - 1];
    }
    if (this.highTimer > 12 && idx < QUALITY_ORDER.indexOf('high')) {
      this.reset();
      return QUALITY_ORDER[idx + 1];
    }
    return null;
  }

  private reset() {
    this.lowTimer = 0;
    this.highTimer = 0;
    this.cooldown = 6;
    this.samples = [];
  }
}
