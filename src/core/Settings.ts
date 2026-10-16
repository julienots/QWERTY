import type { KeyValueStorage } from './SaveSystem';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: QualityLevel;
  autoQuality: boolean;
  sensitivity: number;
  invertY: boolean;
  controlScale: number;
  controlOpacity: number;
  /** Swap: joystick on the right, camera/buttons on the left. */
  leftHanded: boolean;
  masterVolume: number;
  musicVolume: number;
  showFps: boolean;
  aimAssist: boolean;
  reduceMotion: boolean;
  highContrastUi: boolean;
  dayLengthMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  autoQuality: true,
  sensitivity: 1,
  invertY: false,
  controlScale: 1,
  controlOpacity: 0.85,
  leftHanded: false,
  masterVolume: 0.8,
  musicVolume: 0.5,
  showFps: false,
  aimAssist: true,
  reduceMotion: false,
  highContrastUi: false,
  dayLengthMinutes: 24,
};

const KEY = 'ua.settings';

export function sanitizeSettings(raw: any): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  const num = (k: keyof Settings, min: number, max: number) => {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) (s as any)[k] = Math.min(max, Math.max(min, v));
  };
  const bool = (k: keyof Settings) => {
    if (typeof raw[k] === 'boolean') (s as any)[k] = raw[k];
  };
  if (['low', 'medium', 'high', 'ultra'].includes(raw.quality)) s.quality = raw.quality;
  num('sensitivity', 0.2, 3);
  num('controlScale', 0.6, 1.6);
  num('controlOpacity', 0.2, 1);
  num('masterVolume', 0, 1);
  num('musicVolume', 0, 1);
  num('dayLengthMinutes', 4, 120);
  bool('autoQuality'); bool('invertY'); bool('leftHanded'); bool('showFps'); bool('aimAssist'); bool('reduceMotion'); bool('highContrastUi');
  return s;
}

export function loadSettings(storage: KeyValueStorage): Settings {
  try {
    return sanitizeSettings(JSON.parse(storage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: KeyValueStorage, s: Settings): void {
  storage.setItem(KEY, JSON.stringify(s));
}

export interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  viewDistance: number;
  particleBudget: number;
  rainDrops: number;
  treeCount: number;
  grass: boolean;
  bloom: boolean;
  antialias: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 512, viewDistance: 450, particleBudget: 600, rainDrops: 1200, treeCount: 260, grass: false, bloom: false, antialias: false },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, viewDistance: 800, particleBudget: 1500, rainDrops: 3000, treeCount: 520, grass: false, bloom: false, antialias: false },
  high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, viewDistance: 1200, particleBudget: 3000, rainDrops: 6000, treeCount: 900, grass: true, bloom: true, antialias: true },
  ultra: { pixelRatio: 2, shadows: true, shadowMapSize: 4096, viewDistance: 1800, particleBudget: 5000, rainDrops: 10000, treeCount: 1400, grass: true, bloom: true, antialias: true },
};

export const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
