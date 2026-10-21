# UNIVERSE ASCENDANT — SuperEssence Studio

Jeu d'action / exploration 3D en monde ouvert pour mobile (Android) et navigateur : tu commences
humain ordinaire dans ta maison de Val-Lumen, tu deviens Gardien de l'Essence, tu voles, tu
combats les créatures du Néant, tu pilotes des vaisseaux jusqu'à l'orbite, la Station Aurore
et la Lune.

Moteur : **Three.js r170 + TypeScript + Vite**, empaqueté pour Android avec **Capacitor 7**.

## Lancer

```bash
npm install
npm run dev          # serveur de développement (http://localhost:5173)
npm run build        # manifeste des ressources + vérification TypeScript + build de production
npm run preview      # sert le build sur http://localhost:4173
```

Les ressources (modèles, textures, images NASA) sont déjà dans `public/assets/`. Pour les
re-télécharger et ré-optimiser depuis leurs sources libres : `npm run assets`
(voir `tools/fetch-assets.mjs` et `tools/assets.manifest.mjs`). Les modèles créés pour le jeu
(maisons, voitures, arbres, vaisseaux, créatures) sont générés par les scripts Blender de
`tools/blender/` (`node tools/blender/build.mjs`, nécessite Blender ou le module Python `bpy`).

### APK Android

Prérequis : JDK 21, Android SDK (plateforme 35, build-tools 35) avec `ANDROID_HOME` défini.

```bash
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk (signé avec la clé de débogage)
```

## Commandes

| Action | Clavier / souris | Tactile |
|---|---|---|
| Se déplacer | WASD / flèches | joystick flottant (moitié gauche) |
| Regarder | souris (clic pour capturer) | glisser à droite |
| Sauter / monter (vol) | Espace | bouton ⤒ |
| Descendre (vol, vaisseau) | C / Ctrl | bouton ⇩ (en vol) |
| Courir / boost | Maj | joystick poussé à fond |
| Interagir / frapper / débarquer | E | bouton d'action contextuel |
| Pouvoir actif / tir du vaisseau | F | bouton de pouvoir |
| Menu radial des pouvoirs | molette, Q / R, 1–8 | appui long sur le bouton de pouvoir |
| Carte, navigation, menu | M, Échap | bouton ☰ |

En vaisseau : le joystick règle la poussée, le regard donne la direction, ⇧/⇩ montent et
descendent, le bouton de pouvoir tire. Au-delà de 2 500 m d'altitude on quitte l'atmosphère ;
la carte (ou le terminal de la station) permet le saut de distorsion vers la Terre, l'orbite
ou la Lune.

## Ce qui est dans le jeu

- **Val-Lumen (Terre)** : maison meublée avec de vrais modèles (Poly Haven), quartier de maisons
  modélisées dans Blender, centre-ville, parc avec étang, château d'eau, Observatoire et sa
  piste, collines boisées (arbres Blender avec écorce et feuillage photographiés, LOD), sol
  photoréaliste (herbe/terre/roche/neige mélangées selon pente et altitude), cycle jour/nuit,
  météo (pluie, brouillard, orage), habitants animés (personnages riggés), circulation.
- **Progression** en 6 stades, 21 pouvoirs pilotés par les données (+7 avec le mod COSMIC
  POWERS), missions principales et secondaires, vagues de défense, boss (Colosse).
- **Créatures du Néant** sculptées dans Blender, animées procéduralement.
- **Espace** : orbite avec la Terre (NASA Blue Marble / Black Marble, nuages, reflet du soleil
  sur les océans), la Station Aurore (modèle ISS de la NASA) et son intérieur en apesanteur,
  Hubble, la Lune (relief cratérisé, horizon proche, module lunaire Apollo NASA, ruines et
  monolithe gardés), trois vaisseaux pilotables.
- **Modes survie et créatif** avec sauvegardes séparées, versionnées, avec copie de secours et
  migrations.
- **Mods** : paquets de contenu JSON (pouvoirs, créatures, missions, tenues, vaisseaux), sans
  code exécutable, chaque valeur bornée et vérifiée ; un mod invalide est refusé en bloc. Le
  premier mod, **COSMIC POWERS** (`public/mods/cosmic_powers.json`), est fourni et activé par
  défaut. Menu ☰ → Mods : activer/désactiver, importer un fichier `.json` (appliqué au redémarrage).
- **Qualité graphique** faible / moyenne / élevée / ultra, réglage automatique optionnel.

## Tests

```bash
npm test                         # tests unitaires (Vitest) : sauvegardes, migrations, validation du contenu…
npm run build && npm run test:e2e   # parcours de bout en bout dans Chromium (clavier, souris, multi-touch)
node tests/e2e/space.mjs <dossier>  # parcours spatial Terre → orbite → station → Lune → Terre (+ captures)
node tests/e2e/shots.mjs …          # captures de contrôle visuel (voir l'en-tête du fichier)
node tests/e2e/perf-probe.mjs high  # coût de rendu par lieu (draw calls, triangles)
```

Les tests de bout en bout utilisent le rendu logiciel SwiftShader : ils vérifient le
comportement, pas les performances réelles d'un téléphone.

## Arborescence

```
src/core        moteur : événements, sauvegardes, réglages, audio, chargement des ressources
src/content     définitions de contenu, validation, registre, paquet de base
src/world       zones terrestres : terrain, maison, ville, ciel, habitants, véhicules
src/space       vaisseaux, orbite, station, Lune, décors spatiaux
src/player      joueur, personnages riggés, caméra
src/powers      pouvoirs ; src/combat ennemis, projectiles, combat ; src/progression missions
src/ui          HUD et menus ; src/input entrées clavier/souris/tactile
tools/          pipeline de ressources, scripts Blender, galerie de modèles
tests/          unitaires et bout en bout
docs/           audit et plan
```

## Licences des ressources

Toutes les ressources tierces sont CC0 ou du domaine public (Poly Haven, NASA), à l'exception des
personnages Mixamo issus des exemples three.js (utilisables dans un jeu selon les conditions
d'Adobe Mixamo). Détail complet : [CREDITS.md](CREDITS.md).
