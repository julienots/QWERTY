import type { ContentPack } from './types';
import { GAME_CONTENT_API } from './types';

export const STAGE_NAMES = [
  'Humain',
  'Éveillé',
  'Gardien planétaire',
  'Explorateur spatial',
  'Protecteur du système',
  "Dieu de l'univers",
];

/** Base game content. Uses the exact same format as mods. */
export const BASE_PACK: ContentPack = {
  id: 'base',
  name: 'Universe Ascendant — contenu de base',
  version: '0.1.0',
  author: 'SuperEssence Studio',
  gameApi: GAME_CONTENT_API,
  powers: [
    { id: 'essence_push', name: "Onde d'Essence", description: "Libère une onde d'Essence qui repousse et blesse tout ce qui t'entoure.", category: 'psychic', element: 'psychic', icon: '◎', color: '#7fd8ff', energyCost: 20, cooldown: 2.5, unlockStage: 1, sound: 'boom', behavior: { type: 'nova', radius: 7, damage: 30, knockback: 14 }, upgradeCosts: [5, 10, 20, 40] },
    { id: 'super_jump', name: 'Super-saut', description: 'Tes jambes défient la gravité : sauts bien plus hauts et chutes sans dégâts.', category: 'physical', element: 'none', icon: '⤒', color: '#ffd23f', energyCost: 0, cooldown: 0, unlockStage: 1, sound: 'whoosh', behavior: { type: 'passive', effect: 'superJump', value: 2.4 } },
    { id: 'essence_bolt', name: "Trait d'Essence", description: "Projette un éclat d'énergie pure vers la cible visée.", category: 'cosmic', element: 'light', icon: '✦', color: '#9ff0ff', energyCost: 8, cooldown: 0.35, unlockStage: 1, sound: 'zap', behavior: { type: 'projectile', speed: 45, damage: 22, radius: 0.25, homing: 2 }, upgradeCosts: [5, 10, 20, 40] },
    { id: 'flight', name: 'Vol', description: "Vole librement. Au sol : saute puis appuie à nouveau sur Saut. En vol, maintiens Saut pour monter.", category: 'movement', element: 'none', icon: '🜁', color: '#bfe6ff', energyCost: 0, cooldown: 0, unlockStage: 2, sound: 'whoosh', behavior: { type: 'passive', effect: 'flight' } },
    { id: 'regeneration', name: 'Régénération', description: 'Tes blessures se referment rapidement hors des combats.', category: 'physical', element: 'none', icon: '✚', color: '#7dff9a', energyCost: 0, cooldown: 0, unlockStage: 2, sound: 'chime', behavior: { type: 'passive', effect: 'regeneration', value: 4 } },
    { id: 'fireball', name: 'Boule de feu', description: 'Une sphère de feu qui explose à l\'impact et embrase les ennemis.', category: 'elemental', element: 'fire', icon: '🔥', color: '#ff7a2f', energyCost: 18, cooldown: 1.2, unlockStage: 2, sound: 'fire', behavior: { type: 'projectile', speed: 32, damage: 40, radius: 0.45, gravity: 3, explodeRadius: 4.5 }, upgradeCosts: [8, 16, 30, 60] },
    { id: 'frost_lance', name: 'Lances de givre', description: 'Trois lances de glace qui ralentissent fortement les cibles.', category: 'elemental', element: 'ice', icon: '❄', color: '#a8e8ff', energyCost: 15, cooldown: 0.9, unlockStage: 2, sound: 'ice', behavior: { type: 'projectile', speed: 60, damage: 16, radius: 0.18, count: 3, spread: 0.1 }, upgradeCosts: [8, 16, 30, 60] },
    { id: 'lightning_arc', name: 'Arc foudroyant', description: 'Un arc électrique continu qui électrocute la cible visée.', category: 'elemental', element: 'lightning', icon: 'ϟ', color: '#d6c8ff', energyCost: 20, cooldown: 1.5, unlockStage: 2, sound: 'thunder', behavior: { type: 'beam', range: 32, dps: 70, width: 0.25, duration: 0.7 }, upgradeCosts: [8, 16, 30, 60] },
    { id: 'telekinesis', name: 'Télékinésie', description: 'Saisis un objet ou une créature par la pensée et projette-le au loin.', category: 'psychic', element: 'psychic', icon: '✋', color: '#d08bff', energyCost: 15, cooldown: 1, unlockStage: 2, sound: 'hum', behavior: { type: 'telekinesis', range: 28, force: 38, damage: 35 }, upgradeCosts: [10, 20, 40] },
    { id: 'dash', name: 'Ruée', description: 'Fonce en avant en percutant tout sur ton passage.', category: 'movement', element: 'none', icon: '➤', color: '#ffe08a', energyCost: 10, cooldown: 1.2, unlockStage: 2, sound: 'whoosh', behavior: { type: 'dash', distance: 12, damage: 25 } },
    { id: 'super_speed', name: 'Vitesse extrême', description: 'Le monde ralentit autour de toi : vitesse de course décuplée.', category: 'physical', element: 'none', icon: '⚡', color: '#ffee55', energyCost: 25, cooldown: 15, unlockStage: 2, sound: 'whoosh', behavior: { type: 'buff', stat: 'speed', factor: 2.4, duration: 8 } },
    { id: 'mental_shield', name: 'Bouclier mental', description: 'Une barrière psychique absorbe les dégâts pendant quelques secondes.', category: 'psychic', element: 'psychic', icon: '⛉', color: '#88aaff', energyCost: 30, cooldown: 12, unlockStage: 2, sound: 'hum', behavior: { type: 'shield', duration: 6, absorb: 120 } },
    { id: 'life_sense', name: 'Perception du vivant', description: 'Révèle les êtres vivants et les anomalies proches à travers les murs.', category: 'psychic', element: 'psychic', icon: '◉', color: '#9dffcb', energyCost: 10, cooldown: 12, unlockStage: 2, sound: 'chime', behavior: { type: 'scan', radius: 160, duration: 10 } },
    { id: 'blink', name: 'Téléportation', description: 'Disparais et réapparais instantanément plus loin dans la direction visée.', category: 'movement', element: 'none', icon: '⟿', color: '#c9b6ff', energyCost: 20, cooldown: 3, unlockStage: 3, sound: 'warp', behavior: { type: 'blink', distance: 22 } },
    { id: 'shockwave', name: 'Onde de choc', description: 'Frappe le sol et libère une onde destructrice massive.', category: 'cosmic', element: 'none', icon: '◍', color: '#ffffff', energyCost: 45, cooldown: 6, unlockStage: 3, sound: 'boom', behavior: { type: 'nova', radius: 14, damage: 80, knockback: 30 }, upgradeCosts: [15, 30, 60] },
    { id: 'star_breath', name: 'Souffle stellaire', description: "Ton corps n'a plus besoin d'air : tu survis dans le vide spatial.", category: 'physical', element: 'none', icon: '☄', color: '#ffcf7a', energyCost: 0, cooldown: 0, unlockStage: 3, sound: 'chime', behavior: { type: 'passive', effect: 'spaceBreath' } },
    { id: 'titan_strength', name: 'Force titanesque', description: 'Triple les dégâts de tes coups et pouvoirs pendant 10 secondes.', category: 'physical', element: 'none', icon: '✊', color: '#ff9f6b', energyCost: 35, cooldown: 20, unlockStage: 3, sound: 'boom', behavior: { type: 'buff', stat: 'strength', factor: 3, duration: 10 } },
    { id: 'gravity_well', name: 'Puits gravitationnel', description: 'Crée une singularité qui aspire et broie les ennemis.', category: 'cosmic', element: 'gravity', icon: '◐', color: '#9b6bff', energyCost: 50, cooldown: 10, unlockStage: 4, sound: 'warp', behavior: { type: 'gravityWell', radius: 11, duration: 5, pull: 18, dps: 30 } },
    { id: 'time_slow', name: 'Ralentissement temporel', description: 'Ralentit le temps autour de toi. Les ennemis se figent presque.', category: 'cosmic', element: 'none', icon: '⧗', color: '#7af5e1', energyCost: 60, cooldown: 20, unlockStage: 4, sound: 'warp', behavior: { type: 'timeSlow', radius: 28, duration: 6, factor: 0.25 } },
    { id: 'plasma_lance', name: 'Rayon de plasma', description: 'Un rayon de plasma surchauffé qui traverse tout.', category: 'elemental', element: 'plasma', icon: '☀', color: '#ff5cf0', energyCost: 55, cooldown: 4, unlockStage: 4, sound: 'zap', behavior: { type: 'beam', range: 90, dps: 240, width: 0.6, duration: 1.2 } },
    { id: 'divine_nova', name: 'Nova divine', description: "L'énergie d'une étoile naissante jaillit de toi.", category: 'divine', element: 'light', icon: '✺', color: '#fff3a8', energyCost: 150, cooldown: 30, unlockStage: 5, sound: 'boom', behavior: { type: 'nova', radius: 60, damage: 900, knockback: 60 } },
  ],
  enemies: [
    { id: 'void_stalker', name: 'Rôdeur du Néant', model: 'stalker', color: '#1a1726', glow: '#b14dff', scale: 1, health: 60, speed: 5.5, damage: 10, attackRange: 1.9, attackCooldown: 1.1, aggroRange: 38, ranged: false, flying: false, xp: 15, fragments: 1, fleeAt: 0.15 },
    { id: 'void_spitter', name: 'Cracheur du Néant', model: 'spitter', color: '#211a2e', glow: '#62ff9d', scale: 1, health: 45, speed: 3.6, damage: 12, attackRange: 18, attackCooldown: 2, aggroRange: 42, ranged: true, flying: false, xp: 20, fragments: 2, fleeAt: 0.3 },
    { id: 'void_brute', name: 'Colosse du Néant', model: 'brute', color: '#15121d', glow: '#ff4d6d', scale: 1.9, health: 420, speed: 3.1, damage: 28, attackRange: 3.4, attackCooldown: 2.2, aggroRange: 48, ranged: false, flying: false, xp: 120, fragments: 10, fleeAt: 0 },
    { id: 'void_drone', name: 'Sentinelle du Néant', model: 'drone', color: '#2a2438', glow: '#4dd2ff', scale: 1, health: 50, speed: 7, damage: 8, attackRange: 22, attackCooldown: 1.5, aggroRange: 55, ranged: true, flying: true, xp: 25, fragments: 2, fleeAt: 0 },
  ],
  missions: [
    { id: 'm_morning', title: 'Un matin ordinaire', description: "Tu te réveilles chez toi. La radio parle d'étranges lumières tombées cette nuit sur la colline.", main: true, objectives: [
      { type: 'interact', target: 'radio', text: 'Écouter la radio sur le bureau de la chambre' },
      { type: 'reach', zone: 'earth', x: -2.5, z: 11, radius: 3.5, text: 'Sortir de la maison' },
    ], rewards: { xp: 50 } },
    { id: 'm_lights', title: 'Lumières dans le ciel', requires: 'm_morning', description: "Quelque chose est tombé sur la colline au nord-est. Va voir de quoi il s'agit.", main: true, objectives: [
      { type: 'reach', zone: 'earth', x: 205, z: -215, radius: 14, text: "Rejoindre le lieu de l'impact sur la colline" },
      { type: 'interact', target: 'shard', text: "Toucher l'éclat lumineux" },
    ], rewards: { xp: 150, stage: 1, powers: ['essence_push', 'super_jump'], fragments: 5 } },
    { id: 'm_echoes', title: 'Échos du Néant', requires: 'm_lights', description: "L'éclat a attiré des créatures venues d'ailleurs. Utilise ton Onde d'Essence pour les repousser.", main: true, objectives: [
      { type: 'kill', enemy: 'void_stalker', count: 4, text: 'Vaincre les Rôdeurs du Néant', spawn: { x: 190, z: -195, count: 4 } },
    ], rewards: { xp: 200, powers: ['essence_bolt'], fragments: 10 } },
    { id: 'm_takeoff', title: 'Prendre son envol', requires: 'm_echoes', description: "L'Essence brûle dans tes jambes. Grimpe au sommet du château d'eau en enchaînant les super-sauts.", main: true, objectives: [
      { type: 'reach', zone: 'earth', x: -90, y: 15, z: -60, radius: 6, text: "Atteindre le sommet du château d'eau" },
    ], rewards: { xp: 300, stage: 2, powers: ['flight', 'regeneration', 'dash'], fragments: 10 } },
    { id: 'm_defend', title: 'Défendre Val-Lumen', requires: 'm_takeoff', description: 'Une brèche du Néant s\'ouvre au-dessus de ta rue. Protège le quartier !', main: true, objectives: [
      { type: 'waves', waves: 3, x: 0, z: 30, enemies: ['void_stalker', 'void_spitter', 'void_drone'], text: 'Repousser les vagues du Néant' },
    ], rewards: { xp: 500, powers: ['fireball', 'frost_lance', 'telekinesis', 'mental_shield', 'life_sense'], fragments: 30 } },
    { id: 'm_brute', title: 'Le Colosse', requires: 'm_defend', description: 'Un Colosse du Néant a traversé la brèche près du parc. Il faut l\'arrêter avant qu\'il n\'atteigne les maisons.', main: true, objectives: [
      { type: 'kill', enemy: 'void_brute', count: 1, text: 'Vaincre le Colosse du Néant', spawn: { x: 95, z: -80, count: 1 } },
    ], rewards: { xp: 700, powers: ['lightning_arc', 'super_speed'], fragments: 40 } },
    { id: 'm_beyond', title: 'Au-delà du ciel', requires: 'm_brute', description: "La brèche venait d'en haut. Monte aussi haut que tu le peux.", main: true, objectives: [
      { type: 'altitude', value: 400, text: "Voler jusqu'à 400 m d'altitude" },
    ], rewards: { xp: 800, stage: 3, powers: ['star_breath', 'blink', 'shockwave', 'titan_strength'], fragments: 50 } },
    { id: 's_hunter', title: "Chasseur d'ombres", requires: 'm_echoes', description: 'Des créatures du Néant rôdent la nuit. Élimine-en quinze.', main: false, objectives: [
      { type: 'kill', enemy: '*', count: 15, text: 'Éliminer des créatures du Néant' },
    ], rewards: { xp: 250, fragments: 25 } },
    { id: 's_mastery', title: "Maîtrise de l'Essence", requires: 'm_echoes', description: "Entraîne-toi à canaliser ton Trait d'Essence.", main: false, objectives: [
      { type: 'usePower', power: 'essence_bolt', count: 25, text: "Utiliser le Trait d'Essence" },
    ], rewards: { xp: 150, fragments: 15 } },
  ],
  skins: [
    { id: 'citizen', name: 'Citoyen', skin: '#e0b48f', suit: '#3b5b8a', accent: '#d8d8d8', aura: '#7fd8ff', hair: '#3a2a20', unlockStage: 0 },
    { id: 'awakened', name: 'Éveillé', skin: '#e0b48f', suit: '#1f2a44', accent: '#7fd8ff', aura: '#7fd8ff', hair: '#3a2a20', unlockStage: 1 },
    { id: 'guardian', name: 'Armure de Gardien', skin: '#e0b48f', suit: '#d9dde6', accent: '#ffcc33', aura: '#ffd23f', hair: '#3a2a20', unlockStage: 2 },
    { id: 'astronaut', name: 'Combinaison spatiale', skin: '#e0b48f', suit: '#f2f2f2', accent: '#ff7a2f', aura: '#ffffff', hair: '#3a2a20', unlockStage: 3 },
    { id: 'nebula', name: 'Voile de nébuleuse', skin: '#c7b3ff', suit: '#2b1650', accent: '#ff5cf0', aura: '#c45cff', hair: '#ff9cf0', unlockStage: 4 },
    { id: 'cosmic_god', name: 'Divinité cosmique', skin: '#ffe9b0', suit: '#fff6dc', accent: '#ffcc33', aura: '#fff3a8', hair: '#ffffff', unlockStage: 5 },
  ],
};
