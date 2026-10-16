import * as THREE from 'three';
import type { Game } from '../Game';
import { STAGE_NAMES } from '../content/basePack';

/** Pure helpers (unit tested). */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
}
export function xpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 60;
}

/** Stage (story tier), experience level and Essence fragments. */
export class Progress {
  stage = 0;
  xp = 0;
  fragments = 0;

  constructor(private game: Game) {}

  get level() { return levelForXp(this.xp); }
  get stageName() { return STAGE_NAMES[this.stage]; }
  /** +3 % damage per experience level. */
  get damageMultiplier() { return 1 + (this.level - 1) * 0.03; }

  reward(xp: number, fragments: number, at?: THREE.Vector3) {
    const before = this.level;
    this.xp += xp;
    this.fragments += fragments;
    if (at && fragments > 0) {
      this.game.particles.emit({ count: 6 + fragments * 2, position: at.clone().setY(at.y + 1), color: '#7fe8ff', speed: 3, life: 0.8, size: 0.3 });
    }
    if (this.level > before) {
      this.game.hud.toast(`Niveau ${this.level} atteint ! Puissance +3 %`);
      this.game.audio.play('levelup');
      this.game.player.heal(this.game.player.maxHealth);
    }
  }

  setStage(stage: number) {
    if (stage <= this.stage) return;
    this.stage = Math.min(5, stage);
    this.game.player.health = this.game.player.maxHealth;
    this.game.player.energy = this.game.player.maxEnergy;
    this.game.hud.banner(`${this.stageName.toUpperCase()}`, stageDescription(this.stage), '#ffd23f', '✦');
    this.game.audio.play('levelup');
    this.game.cameraRig.shake(0.4);
    this.game.particles.emit({ count: 120, position: this.game.player.position.clone().setY(this.game.player.position.y + 1), color: '#ffd23f', color2: this.game.currentSkin().aura, speed: 7, life: 1.4, size: 0.6, drag: 1.5 });
    this.game.bus.emit('stage', this.stage);
  }
}

function stageDescription(s: number): string {
  return [
    '',
    "L'Essence de l'éclat coule dans tes veines. Des pouvoirs s'éveillent.",
    'Tu peux voler. Val-Lumen compte désormais sur toi.',
    "Ton corps résiste au vide. L'espace t'appelle.",
    'Le système solaire tout entier est sous ta protection.',
    "Tu es devenu une force du cosmos.",
  ][s];
}
