import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EventBus } from './core/EventBus';
import { AudioEngine } from './core/Audio';
import { PerfMonitor } from './core/PerfMonitor';
import { SaveSystem, newSave, type GameMode, type KeyValueStorage, type SaveData } from './core/SaveSystem';
import { QUALITY_PROFILES, loadSettings, saveSettings, type QualityProfile, type Settings } from './core/Settings';
import { ContentRegistry } from './content/Registry';
import { BASE_PACK } from './content/basePack';
import type { SkinDef } from './content/types';
import { Input } from './input/Input';
import { Particles } from './fx/Particles';
import { setMaxAnisotropy } from './fx/textures';
import { Player } from './player/Player';
import { CameraRig } from './player/CameraRig';
import { PowerSystem } from './powers/PowerSystem';
import { EnemyManager } from './combat/Enemies';
import { Projectiles } from './combat/Projectiles';
import { PropSystem } from './combat/Props';
import { Combat } from './combat/Combat';
import { Progress } from './progression/Progress';
import { MissionManager } from './progression/Missions';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import type { Interactable, Zone } from './world/Zone';
import { EarthZone } from './world/EarthZone';
import type { EarthSky } from './world/EarthSky';
import type { Townsfolk } from './world/Townsfolk';
import { clearMaterialCache, useAssets } from './world/build';
import type { Assets } from './core/Assets';
import type { BodyKind } from './player/CharacterModel';

export interface ShipLike { active: boolean; position: THREE.Vector3 }

/** Owns every system and runs the main loop. */
export class Game {
  readonly bus = new EventBus();
  readonly content = new ContentRegistry();
  readonly audio = new AudioEngine();
  readonly perf = new PerfMonitor();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.2, 14000);
  readonly settings: Settings;
  readonly saves: SaveSystem;
  readonly input: Input;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly cameraRig: CameraRig;
  readonly projectiles = new Projectiles();
  readonly enemies = new EnemyManager();
  readonly props = new PropSystem();
  readonly combat: Combat;
  readonly powers: PowerSystem;
  readonly progress: Progress;
  readonly missions: MissionManager;
  particles: Particles;
  player!: Player;
  zone!: Zone;
  quality!: QualityProfile & { name: string };
  mode: GameMode = 'survival';
  slot = 'survival_1';
  saveData: SaveData = newSave('survival');
  inventory: Record<string, number> = {};
  skinId = 'citizen';
  time = 7.2;
  day = 1;
  elapsed = 0;
  playTime = 0;
  paused = true;
  ready = false;
  running = false;
  timeSlowFx = 0;
  creativeHostile = false;
  ship: ShipLike | null = null;
  private composer: EffectComposer | null = null;
  private clock = new THREE.Clock();
  private autosaveTimer = 60;
  private currentInteract: Interactable | null = null;
  private mapCache: HTMLCanvasElement | null = null;
  private dying = 0;
  private fade: HTMLElement;
  onExitToTitle: () => void = () => {};

  constructor(private container: HTMLElement, storage: KeyValueStorage, readonly assets: Assets | null = null) {
    this.settings = loadSettings(storage);
    this.storage = storage;
    this.saves = new SaveSystem(storage);
    const r = this.content.register(BASE_PACK, 'base');
    if (!r.ok) throw new Error('Contenu de base invalide : ' + r.errors.join('; '));

    this.renderer = new THREE.WebGLRenderer({ antialias: QUALITY_PROFILES[this.settings.quality].antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    // Image-based ambient lighting so PBR metals and glossy surfaces read correctly.
    // Real captured sky (Poly Haven HDRI) when available; neutral studio environment otherwise.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.dayEnvironment = assets?.hdr ? pmrem.fromEquirectangular(assets.hdr).texture : pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.dayEnvironment;
    pmrem.dispose();
    assets?.setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    useAssets(assets);

    this.hud = new Hud(container);
    this.input = new Input(container, this.settings);
    this.menu = new Menu(container, this);
    this.fade = document.createElement('div');
    this.fade.className = 'fade hidden';
    container.appendChild(this.fade);
    this.cameraRig = new CameraRig(this.camera);
    this.combat = new Combat(this);
    this.powers = new PowerSystem(this);
    this.progress = new Progress(this);
    this.missions = new MissionManager(this);
    this.particles = new Particles(1500);
    this.setQualityProfile();

    this.scene.add(this.projectiles.group, this.enemies.group, this.props.group, this.combat.group, this.powers.group, this.hud.beaconMesh);
    this.input.onMenu = () => { if (this.ready && !this.dying) this.menu.toggle(); };
    this.input.radialProvider = () => this.powers.favorites.map((id) => {
      const d = this.content.power(id)!;
      return { id, icon: d.icon, color: d.color, name: d.name };
    });
    this.input.onRadialSelect = (id) => this.powers.setActive(id);
    window.addEventListener('wheel', (e) => { if (this.ready && !this.paused) this.powers.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.ready) {
        this.saveGame(false);
        if (!this.menu.isOpen) this.menu.open('system');
      }
    });
    this.bus.on('mission:completed', () => { this.mapCache = null; });
    this.resize();
    document.body.classList.toggle('high-contrast', this.settings.highContrastUi);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume);
  }

  private storage: KeyValueStorage;
  dayEnvironment: THREE.Texture | null = null;
  /** Body chosen for a new game (character selection screen). */
  newGameBody: BodyKind = 'human_male';

  // ------------------------------------------------------------------ setup
  private setQualityProfile() {
    const name = this.settings.quality;
    this.quality = { ...QUALITY_PROFILES[name], name: { low: 'Faible', medium: 'Moyen', high: 'Élevé', ultra: 'Ultra' }[name] };
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.particles) {
      this.scene.remove(this.particles.points);
      this.particles.points.geometry.dispose();
    }
    this.particles = new Particles(q.particleBudget);
    this.particles.setViewportHeight(this.renderer.domElement.clientHeight || window.innerHeight);
    this.scene.add(this.particles.points);
    this.setupComposer();
  }

  private setupComposer() {
    this.composer?.dispose();
    this.composer = null;
    if (!this.quality.bloom) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 0.92));
    c.addPass(new OutputPass());
    this.composer = c;
  }

  applyQuality() {
    this.setQualityProfile();
    this.zone?.applyQuality?.(this);
    this.resize();
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  applySettings() {
    this.input.applySettings(this.settings);
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume);
    this.saveSettings();
  }

  saveSettings() { saveSettings(this.storage, this.settings); }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h);
  }

  get sky(): EarthSky | null { return (this.zone as EarthZone | undefined)?.sky ?? null; }
  get townsfolk(): Townsfolk | null { return (this.zone as EarthZone | undefined)?.folk ?? null; }

  currentSkin(): SkinDef {
    return this.content.skins.get(this.skinId) ?? this.content.skins.get('citizen')!;
  }

  setSkin(id: string) {
    const s = this.content.skins.get(id);
    if (!s || s.unlockStage > this.progress.stage) return;
    this.skinId = id;
    this.player.setSkin(s);
    this.audio.play('pickup');
  }

  // ------------------------------------------------------------------ game lifecycle
  hasSave(mode: GameMode): boolean {
    return this.saves.exists(mode === 'creative' ? 'creative_1' : 'survival_1');
  }

  /** Starts a new game or continues the existing one in the given mode. */
  start(mode: GameMode, fresh: boolean) {
    this.audio.unlock();
    this.mode = mode;
    this.slot = mode === 'creative' ? 'creative_1' : 'survival_1';
    let data: SaveData | null = null;
    if (!fresh) {
      const r = this.saves.load(this.slot);
      data = r.data;
      if (r.source === 'backup') console.warn('Sauvegarde principale invalide, secours utilisé', r.errors);
    }
    const save = data ?? newSave(mode);
    if (!data) save.player.body = this.newGameBody;
    this.applySave(save);
    this.ready = true;
    this.setPaused(false);
    if (fresh || !data) this.intro();
    if (!this.running) { this.running = true; this.clock.start(); this.loop(); }
  }

  private applySave(d: SaveData) {
    this.saveData = d;
    this.mode = d.mode;
    this.time = d.world.time;
    this.day = d.world.day;
    this.playTime = d.playTime;
    this.inventory = { ...d.inventory };
    this.progress.stage = d.player.stage;
    this.progress.xp = d.player.xp;
    this.progress.fragments = d.player.fragments;
    this.skinId = this.content.skins.has(d.player.skin) ? d.player.skin : 'citizen';
    this.missions.load(d.missions.completed, d.missions.active, d.missions.progress);
    if (d.mode === 'creative') {
      // Creative: every power is available, without affecting survival saves.
      this.powers.load([...this.content.powers.keys()], d.powers.favorites, d.powers.active, d.powers.levels);
      if (this.powers.favorites.length === 0) this.powers.favorites = [...this.powers.unlocked].filter((id) => this.powers.isCastable(id)).slice(0, 8);
      if (!this.powers.active) this.powers.active = this.powers.favorites[0] ?? null;
    } else this.powers.load(d.powers.unlocked, d.powers.favorites, d.powers.active, d.powers.levels);

    // Player
    if (this.player) this.scene.remove(this.player.root);
    this.player = new Player(this.currentSkin(), this.assets, (d.player.body as BodyKind | undefined) ?? 'human_male');
    this.player.stageRef = () => this.progress.stage;
    this.scene.add(this.player.root);
    this.loadZone(d.player.zone);
    const [x, y, z] = d.player.position;
    this.player.setPosition(x, y, z);
    this.player.yaw = d.player.yaw;
    this.player.health = Math.min(this.player.maxHealth, Math.max(1, d.player.health));
    this.player.energy = Math.min(this.player.maxEnergy, d.player.energy);
    this.player.flying = d.player.flying && this.powers.hasPassive('flight');
    this.cameraRig.snapBehind(d.player.yaw);
  }

  loadZone(id: string) {
    // Only one detailed zone is resident at a time.
    if (this.zone) {
      this.scene.remove(this.zone.root);
      this.zone.dispose();
      clearMaterialCache();
    }
    this.enemies.clear();
    this.projectiles.clear();
    this.props.clear();
    this.powers.clearEffects();
    this.hud.clearWorld();
    this.mapCache = null;
    switch (id) {
      default:
        this.zone = new EarthZone(this);
    }
    this.scene.add(this.zone.root);
    const sky = this.sky;
    this.scene.fog = sky ? sky.fog : null;
    this.scene.background = sky ? null : new THREE.Color('#000000');
  }

  private intro() {
    this.hud.say('', 'Un bourdonnement étrange te tire du sommeil. Dehors, le ciel vibre encore des lumières de la nuit.', 5);
    this.hud.say('Toi', "Quelle nuit… J'ai rêvé de lumières qui tombaient du ciel. Allumons la radio.", 4);
  }

  collectSave(): SaveData {
    const p = this.player;
    const zone = this.zone as EarthZone;
    const d = this.saveData;
    d.mode = this.mode;
    d.playTime = this.playTime;
    d.player = {
      zone: this.zone.id,
      position: [p.position.x, p.position.y, p.position.z],
      yaw: p.yaw,
      health: Math.max(1, p.health),
      energy: p.energy,
      xp: this.progress.xp,
      stage: this.progress.stage,
      fragments: this.progress.fragments,
      skin: this.skinId,
      flying: p.flying,
      oxygen: d.player.oxygen ?? 100,
      body: d.player.body ?? 'human_male',
    };
    d.powers = {
      unlocked: this.mode === 'creative' ? [] : [...this.powers.unlocked],
      favorites: [...this.powers.favorites],
      active: this.powers.active,
      levels: { ...this.powers.levels },
    };
    d.inventory = { ...this.inventory };
    d.missions = {
      completed: [...this.missions.completed],
      active: [...this.missions.active],
      progress: JSON.parse(JSON.stringify(this.missions.progress)),
      counters: d.missions.counters ?? {},
    };
    d.world.time = this.time;
    d.world.day = this.day;
    if (this.sky) d.world.weather = this.sky.weather;
    if (zone.house) d.world.house = { lightsOn: zone.house.lightsOn, doorsOpen: zone.house.doorsOpen };
    d.mods = { active: [...this.content.packs.values()].filter((p) => p.source === 'mod').map((p) => ({ id: p.pack.id, version: p.pack.version })) };
    return d;
  }

  saveGame(manual: boolean) {
    if (!this.ready) return;
    try {
      this.saves.save(this.slot, this.collectSave());
      if (manual) { this.hud.toast('Partie sauvegardée'); this.audio.play('chime'); }
    } catch (err) {
      console.error(err);
      this.hud.toast('⚠ Échec de la sauvegarde : ' + (err as Error).message);
    }
  }

  autosave() { this.saveGame(false); }

  reloadSave() {
    const r = this.saves.load(this.slot);
    if (!r.data) { this.hud.toast('Aucune sauvegarde à charger'); return; }
    this.applySave(r.data);
    this.hud.toast('Sauvegarde chargée');
  }

  toTitle() {
    this.ready = false;
    this.setPaused(true);
    this.onExitToTitle();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.input.setVisible(!p && this.ready);
    this.hud.setVisible(this.ready);
    this.input.enabled = !p;
    if (!p) this.clock.getDelta();
  }

  // ------------------------------------------------------------------ world actions
  isNight() { return this.time >= 20 || this.time < 6; }

  sleep() {
    const night = this.isNight();
    this.fadeOut(() => {
      if (night) {
        this.time = 7;
        this.day++;
        this.hud.toast(`Jour ${this.day} — tu te sens reposé.`);
      } else this.hud.toast('Une petite sieste fait du bien.');
      this.player.heal(this.player.maxHealth);
      this.player.energy = this.player.maxEnergy;
      this.saveGame(false);
    });
  }

  private fadeOut(mid: () => void, text = '') {
    this.fade.textContent = text;
    this.fade.classList.remove('hidden');
    this.fade.classList.add('show');
    this.input.setVisible(false);
    setTimeout(() => {
      mid();
      this.fade.classList.remove('show');
      setTimeout(() => {
        this.fade.classList.add('hidden');
        if (!this.paused) this.input.setVisible(true);
      }, 700);
    }, 900);
  }

  onPlayerDeath() {
    if (this.dying) return;
    this.dying = 1;
    this.audio.play('boom', { volume: 0.5, pitch: 0.5 });
    this.fadeOut(() => {
      const home = this.zone.id === 'earth' ? this.zone.spawn : this.zone.spawn;
      this.player.setPosition(home.x, home.y + 0.1, home.z);
      this.player.flying = false;
      this.player.health = this.player.maxHealth;
      this.player.energy = this.player.maxEnergy;
      this.player.invulnerable = 3;
      // Hostiles that were hunting you lose track of you.
      for (const e of this.enemies.alive) if (e.tag === 'ambient') e.alive = false;
      this.missions.resetSpawns();
      this.dying = 0;
      this.hud.say('', 'Tu reprends connaissance chez toi. Rien de perdu — sauf un peu de fierté.', 4);
    }, 'Tu as perdu connaissance…');
  }

  teleport(x: number, z: number) {
    const y = this.zone.physics.surfaceHeight(x, z, 9999, 0.4, 0) + 0.2;
    this.player.setPosition(x, y, z);
    this.particles.emit({ count: 40, position: this.player.position.clone().setY(y + 1), color: this.currentSkin().aura, speed: 4, life: 0.6, size: 0.5 });
  }

  setGravity(g: number) {
    (this.zone as any).gravity = g;
  }

  zoneLabel(): string {
    const h = Math.floor(this.time), m = Math.floor((this.time % 1) * 60);
    return `${this.zone?.name ?? ''} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  mapImage(): HTMLCanvasElement | null {
    if (!this.mapCache) this.mapCache = (this.zone as any).renderMap?.() ?? null;
    return this.mapCache;
  }

  loreForComputer(): string[] {
    const s = this.progress.stage;
    if (s === 0) return [
      'Forum de Val-Lumen — « Quelqu’un d’autre a vu les lumières cette nuit ? On aurait dit qu’elles tombaient au ralenti. »',
      'Observatoire — « Les capteurs ont enregistré une signature énergétique inconnue au nord-est. »',
    ];
    if (s === 1) return ['Tes recherches sur l’éclat ne donnent rien… sauf un vieux mythe : « l’Essence choisit ceux qui la protègent ».'];
    return ['Messagerie — « Merci, qui que vous soyez. Vous avez sauvé notre rue. » — un voisin anonyme.', 'Observatoire — « La brèche dans le ciel semble venir de bien au-delà de l’atmosphère… »'];
  }

  // ------------------------------------------------------------------ main loop
  private loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    if (this.ready && !this.paused) this.update(dt);
    this.perf.record(Math.min(0.25, raw));
    if (this.settings.autoQuality && this.ready && !this.paused) {
      const rec = this.perf.recommend(this.settings.quality, raw);
      if (rec) {
        this.settings.quality = rec;
        this.saveSettings();
        this.applyQuality();
        this.hud.toast(`Qualité graphique ajustée : ${this.quality.name}`);
      }
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  /** One simulation step (public so automated tests can drive the game deterministically). */
  update(dt: number) {
    this.elapsed += dt;
    this.playTime += dt;
    this.time = (this.time + (dt * 24) / (this.settings.dayLengthMinutes * 60)) % 24;
    if (this.time < (dt * 24) / (this.settings.dayLengthMinutes * 60)) this.day++;
    const input = this.input;
    input.poll();

    // Discrete inputs
    if (input.consume('key:KeyQ')) this.powers.cycle(-1);
    if (input.consume('key:KeyR')) this.powers.cycle(1);
    for (let i = 1; i <= 8; i++) if (input.consume('key:Digit' + i) && this.powers.favorites[i - 1]) this.powers.setActive(this.powers.favorites[i - 1]);
    if (input.consume('key:KeyM')) this.menu.open('map');

    this.player.update(dt, this);
    this.cameraRig.update(dt, this);

    // Interaction / primary action
    this.currentInteract = this.findInteractable();
    if (input.consume('action')) {
      if (this.currentInteract) this.currentInteract.use(this);
      else this.combat.punch();
    }
    if (input.consume('power')) {
      if (this.powers.active) this.powers.cast();
      else if (this.progress.stage === 0) this.hud.toast("Tu n'as encore aucun pouvoir…");
    }

    this.powers.update(dt);
    this.zone.update(dt, this);
    this.enemies.update(dt, this);
    this.projectiles.update(dt, this);
    this.props.update(dt, this);
    this.combat.update(dt);
    this.missions.update(dt);
    this.particles.update(dt);
    this.scene.environmentIntensity = this.sky ? this.sky.envIntensity : 0.35;
    this.audio.update();
    const fwd = this.cameraRig.forward();
    this.audio.setListener(this.camera.position, fwd);
    const fighting = this.enemies.alive.some((e) => e.position.distanceTo(this.player.position) < 45);
    this.audio.setAmbience({ combat: fighting ? 1 : 0 });
    this.updateControls();
    this.hud.update(dt, this);
    input.clearFrame();

    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) { this.autosaveTimer = 60; this.saveGame(false); }
  }

  private findInteractable(): Interactable | null {
    const p = this.player.position;
    const chest = new THREE.Vector3(p.x, p.y + 1.1, p.z);
    const facing = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    let best: Interactable | null = null, bestScore = -Infinity;
    for (const it of this.zone.interactables) {
      const d = it.position.distanceTo(chest);
      if (d > it.radius) continue;
      if (it.label(this) === null) continue;
      const to = it.position.clone().sub(chest).setY(0);
      const facingScore = to.lengthSq() > 0.01 ? to.normalize().dot(facing) : 1;
      if (facingScore < -0.2) continue;
      const score = facingScore - d / it.radius;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  private updateControls() {
    const p = this.player;
    const it = this.currentInteract;
    const canFly = this.powers.hasPassive('flight') || this.mode === 'creative';
    const active = this.powers.active ? this.content.power(this.powers.active) : null;
    this.input.setContext({
      actionLabel: it ? it.label(this) : null,
      actionIcon: it ? it.icon ?? '✋' : this.progress.stage >= 1 ? '👊' : '✋',
      jumpIcon: p.flying ? '⇧' : !p.body.onGround && canFly ? '🜁' : '⤒',
      powerIcon: active?.icon ?? '✦',
      powerColor: active?.color ?? '#666666',
      powerReady: active ? this.powers.cooldownProgress(active.id) : 0,
      powerAvailable: !!active && (this.mode === 'creative' || p.energy >= active.energyCost),
      mode: p.flying ? 'fly' : 'walk',
    });
  }
}
