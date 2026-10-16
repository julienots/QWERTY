# UNIVERSE ASCENDANT — Audit initial et plan de développement

SuperEssence Studio — document de conception technique (Phase A)

## 1. Audit du projet existant

| Élément | Constat |
|---|---|
| Dépôt `julienots/QWERTY` | **Vide** : aucun commit, aucun fichier, aucun asset, aucune musique. |
| Moteur existant | Aucun. |
| Assets existants | Aucun (seul le logo SuperEssence fourni dans la conversation, copié dans `public/`). |
| Risque de perte de données | Nul : rien à supprimer ni à remplacer. |

### Outillage réellement disponible dans l'environnement de build

| Outil | Disponible | Remarque |
|---|---|---|
| Node.js 22, npm | Oui | registre npm accessible |
| JDK 21, Gradle 8.14 | Oui | |
| Android SDK | Installé pendant l'audit (`platforms;android-35`, `build-tools;35.0.0`) | hors dépôt, dans `/root/android-sdk` |
| Chromium + Playwright | Oui | permet des tests automatisés du jeu réel en WebGL |
| Godot / Unity | **Non** | téléchargement des releases GitHub bloqué (403), Unity nécessite une licence et un éditeur graphique |
| Maven Central | Limité en débit (429) | contournement : miroir Google `maven-central.storage-download.googleapis.com` |

## 2. Choix du moteur — justification

**Three.js (WebGL2) + TypeScript + Vite, empaqueté pour Android avec Capacitor 7.**

- C'est un vrai moteur de rendu 3D (PBR, ombres dynamiques, instancing, post-traitement,
  shaders personnalisés), pas un outil de démonstration 2D.
- Il est **réellement compilable et testable ici** : build, tests unitaires (Vitest) et tests
  de bout en bout dans Chromium (Playwright) qui lancent le vrai jeu avec WebGL.
- Capacitor produit un **APK Android natif** (WebView matérielle) à partir du même code.
- Godot ou Unity seraient préférables pour un AAA natif, mais ils ne sont pas installables dans cet
  environnement : choisir un moteur qu'on ne peut ni compiler ni tester violerait la règle
  « ne jamais déclarer un test réussi sans l'avoir exécuté ».
- Aucun asset lourd téléchargé : modèles, textures et sons sont **générés procéduralement**
  (géométrie, textures canvas, synthèse WebAudio). Ils pourront être remplacés par des
  modèles glTF professionnels via le système de contenu, sans changer le code de gameplay.

Limites assumées : le rendu WebView mobile est moins puissant qu'un moteur natif ; on compense par
des niveaux de qualité (faible / moyen / élevé / ultra) et une réduction automatique des effets.

## 3. Architecture

```
src/
  main.ts                 point d'entrée (écran titre, boot)
  core/                   boucle de jeu, bus d'événements, registre de contenu,
                          sauvegarde versionnée, paramètres, moniteur de performances,
                          audio procédural, utilitaires (bruit, maths)
  input/                  entrées unifiées : tactile (joystick, caméra, boutons contextuels,
                          menu radial) + clavier/souris pour les tests
  physics/                collisions capsule/AABB + champ de hauteur, gravité par zone
  player/                 contrôleur (marche, course, saut, vol, apesanteur), modèle animé,
                          caméra 3e personne avec anti-collision
  world/                  zones chargeables : planète de départ (maison, quartier, terrain),
                          ciel/jour-nuit, météo, PNJ, véhicules
  powers/                 système de pouvoirs data-driven : chaque pouvoir est une
                          définition (données) qui compose des « comportements » primitifs
                          (projectile, zone, dash, bouclier, vol, télékinésie…)
  combat/                 santé, dégâts, ennemis et leur IA (machine à états)
  progression/            étapes (Humain → Dieu), XP, déblocages, missions
  space/                  orbite, Lune, station, vaisseaux (Phase D)
  ui/                     HUD minimaliste, menus, réglages
  content/                packs de contenu de base (pouvoirs, missions…) au même format que les mods
```

Principes :
- **Contenu = données.** Pouvoirs, missions, ennemis, skins sont déclarés dans des packs
  validés par schéma. Le jeu de base utilise le même format que les mods : ajouter un pouvoir
  ne demande pas de toucher au combat.
- **Mods sûrs.** Un mod ne peut que combiner les comportements fournis par le moteur avec des
  paramètres bornés ; aucun code arbitraire n'est exécuté (compatible avec les règles Android).
- **Zones.** Une seule zone détaillée chargée à la fois (planète, orbite, Lune, station) avec
  transitions ; les zones éloignées sont simulées de façon simplifiée.
- **Sauvegardes** versionnées, validées, migrables, avec emplacements séparés survie / créatif.

## 4. Contrôles mobiles (priorité)

- Moitié gauche : joystick flottant discret (apparaît sous le pouce).
- Moitié droite : glisser = caméra / visée.
- 3 boutons ronds à droite seulement : **Action contextuelle** (ouvrir, allumer, monter…),
  **Saut / Vol** (adaptatif : saut au sol, double appui = vol, monter en vol),
  **Pouvoir** (appui = pouvoir actif, appui long = menu radial).
- 1 petite icône menu en haut (carte, inventaire, pouvoirs, réglages, sauvegarde).
- Réglages : sensibilité, taille/opacité des commandes, inversion Y, qualité graphique,
  qualité automatique.

## 5. Plan par phases (chaque phase laisse le jeu lançable)

| Phase | Contenu | Statut visé dans cette première livraison |
|---|---|---|
| A | Audit, choix techniques, architecture | ce document |
| B | Personnage contrôlable, maison explorable, extérieur, caméra, tactile, sauvegarde, HUD | **à livrer** |
| C | Éveil, énergie, vol, premiers pouvoirs, ennemis, combat | **à livrer** |
| D | Transition orbite, vaisseau, station, Lune, retour | première version si B et C sont stables |
| E | Créatures, factions, missions, boss, défense | ultérieur |
| F | Ressources, construction, mode créatif | ultérieur |
| G | Gestionnaire de mods, mod COSMIC POWERS | fondations posées dès B (registre data-driven) |
| H | Finition, optimisation, tests complets | continu |

## 6. Risques et dépendances

| Risque | Mitigation |
|---|---|
| Performances WebGL sur Android d'entrée de gamme | niveaux de qualité, réduction auto, instancing, LOD, ombres limitées au voisinage |
| Pas d'appareil Android physique ici | APK compilé et vérifié (signature debug, contenu) ; tests jeu dans Chromium avec émulation tactile ; tests sur appareil réel à faire par l'utilisateur |
| Pas d'assets 3D professionnels | génération procédurale cohérente ; placeholders identifiés ; remplacement progressif par glTF |
| Échelle astronomique | échelles « gameplay » + voyage accéléré, documentées |
| Taille du projet | phases courtes, tests à chaque étape, aucune fonctionnalité annoncée sans être jouable |
