/**
 * Content definitions. The base game and mods use exactly the same data format:
 * a content pack only *declares* things (numbers, strings, behaviour types), it never
 * ships executable code. Behaviours are implemented by the engine (src/powers/behaviors.ts).
 */

export type PowerCategory = 'physical' | 'movement' | 'elemental' | 'psychic' | 'cosmic' | 'divine';
export type Element = 'none' | 'fire' | 'ice' | 'lightning' | 'plasma' | 'gravity' | 'psychic' | 'light' | 'shadow';
export type SoundPreset = 'zap' | 'whoosh' | 'boom' | 'hum' | 'chime' | 'fire' | 'ice' | 'thunder' | 'warp';
export type PassiveEffect = 'superJump' | 'flight' | 'superSpeed' | 'regeneration' | 'spaceBreath' | 'toughness';

export type PowerBehavior =
  | { type: 'projectile'; speed: number; damage: number; radius: number; count?: number; spread?: number; gravity?: number; explodeRadius?: number; homing?: number; range?: number }
  | { type: 'beam'; range: number; dps: number; width: number; duration: number }
  | { type: 'nova'; radius: number; damage: number; knockback: number }
  | { type: 'dash'; distance: number; damage: number }
  | { type: 'blink'; distance: number }
  | { type: 'shield'; duration: number; absorb: number }
  | { type: 'telekinesis'; range: number; force: number; damage: number }
  | { type: 'gravityWell'; radius: number; duration: number; pull: number; dps: number }
  | { type: 'timeSlow'; radius: number; duration: number; factor: number }
  | { type: 'heal'; amount: number }
  | { type: 'buff'; stat: 'speed' | 'strength' | 'defense'; factor: number; duration: number }
  | { type: 'scan'; radius: number; duration: number }
  | { type: 'passive'; effect: PassiveEffect; value?: number };

export interface PowerDef {
  id: string;
  name: string;
  description: string;
  category: PowerCategory;
  element: Element;
  icon: string;
  color: string;
  energyCost: number;
  cooldown: number;
  /** Progression stage (0 = Humain … 5 = Dieu) at which the power may be learned. */
  unlockStage: number;
  sound: SoundPreset;
  behavior: PowerBehavior;
  /** Upgrade cost in Essence fragments per level (index 0 = level 2). */
  upgradeCosts?: number[];
}

export type EnemyModel = 'stalker' | 'spitter' | 'brute' | 'drone';

export interface EnemyDef {
  id: string;
  name: string;
  model: EnemyModel;
  color: string;
  glow: string;
  scale: number;
  health: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  aggroRange: number;
  ranged: boolean;
  flying: boolean;
  xp: number;
  fragments: number;
  /** Fraction of health under which the creature tries to flee (0 = never). */
  fleeAt: number;
}

export type ObjectiveDef =
  | { type: 'interact'; target: string; text: string }
  | { type: 'reach'; zone: string; x: number; y?: number; z: number; radius: number; text: string }
  | { type: 'kill'; enemy: string | '*'; count: number; text: string; spawn?: { x: number; z: number; count: number } }
  | { type: 'waves'; waves: number; x: number; z: number; enemies: string[]; text: string }
  | { type: 'altitude'; value: number; text: string }
  | { type: 'usePower'; power: string; count: number; text: string };

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  /** Mission that must be completed first. */
  requires?: string;
  main: boolean;
  objectives: ObjectiveDef[];
  rewards: { xp: number; fragments?: number; powers?: string[]; stage?: number; items?: Record<string, number> };
}

export interface SkinDef {
  id: string;
  name: string;
  skin: string;
  suit: string;
  accent: string;
  aura: string;
  hair: string;
  unlockStage: number;
}

export interface ContentPack {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** Game API version the pack targets. */
  gameApi: number;
  dependencies?: string[];
  powers?: PowerDef[];
  enemies?: EnemyDef[];
  missions?: MissionDef[];
  skins?: SkinDef[];
}

export const GAME_CONTENT_API = 1;
