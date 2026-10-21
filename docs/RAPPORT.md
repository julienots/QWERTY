# Rapport d'avancement — Universe Ascendant

État au 21 octobre 2026. Ce rapport distingue ce qui fonctionne et a été vérifié, ce qui
n'a été vérifié qu'en partie, et ce qui reste à faire.

## Phases

| Phase | Contenu | État |
|---|---|---|
| A | Audit, architecture, plan | fait (`docs/AUDIT_ET_PLAN.md`) |
| B | Personnage, maison, ville, caméra, tactile, sauvegardes, HUD | fait |
| C | Éveil, énergie, vol, pouvoirs, créatures, combat, missions | fait |
| D | Observatoire, vaisseaux, orbite, Station Aurore, Lune, retour sur Terre | fait (première version jouable) |
| E | Factions, boss cosmiques géants, IA d'univers dynamique | **partiel** : créatures du Néant, Colosse, vagues de défense, gardiens lunaires ; pas encore de civilisations extraterrestres, de boss géants ni de planètes au-delà de la Lune |
| F | Ressources, construction, mode créatif | **partiel** : mode créatif (tous les pouvoirs, apparition de créatures, téléportation, gravité) ; pas de système de ressources ni de construction |
| G | Gestionnaire de mods, mod COSMIC POWERS | fait : chargement, validation, activation, import, menu Mods, mod COSMIC POWERS fourni |
| H | Finition, optimisation, tests | continu (voir limites) |

## Ressources 3D réelles

- Modèles photogrammétriques et mobilier **Poly Haven (CC0)**, textures PBR Poly Haven, ciel HDRI.
- **NASA (domaine public)** : ISS (Station Aurore), module lunaire Apollo, astronaute, Hubble,
  Voyager ; images Blue Marble, Black Marble, nuages, carte lunaire LRO, Deep Star Maps.
- **Modélisés pour le jeu dans Blender** (scripts dans `tools/blender/`) : trois types de maisons,
  deux voitures, arbres feuillus et sapins (avec LOD), trois vaisseaux, quatre créatures.
- Personnages riggés et animés : modèles Mixamo des exemples three.js (joueur, habitants,
  commandante). Licence Adobe Mixamo (usage dans un jeu autorisé), pas CC0.
- Pipeline reproductible : `npm run assets` (téléchargement, simplification, compression
  meshopt + WebP, génération de `CREDITS.md`).

## Tests exécutés

- **Unitaires** (`npm test`) : 30/30 — sauvegardes, migrations v1→v3, copie de secours,
  validation du contenu, mods (chargement, refus en bloc, dépendances, import, bornes).
- **Bout en bout** (`npm run test:e2e`, Chromium + SwiftShader, clavier/souris et multi-touch
  915×412) : 27/27 — démarrage, rendu, déplacement et collisions, saut, interactions, portes et
  lumières, missions, éveil, super-saut, combat, projectiles, vol, sauvegarde/rechargement,
  sauvegarde corrompue, menus, mods, mort/réapparition, mode créatif, joystick, caméra tactile,
  roue des pouvoirs, aucune erreur JavaScript.
- **Parcours spatial** (`node tests/e2e/space.mjs`) : 11/11 — obtention du vaisseau, embarquement
  à l'Observatoire, sortie d'atmosphère, débarquement en orbite, entrée dans la station par le
  sas, saut vers la Lune, marche sur la Lune avec consommation d'oxygène, retour sur Terre,
  sauvegarde du vaisseau, aucune erreur JavaScript.
- **APK** : `android/app/build/outputs/apk/debug/app-debug.apk` compilé par Gradle, vérifié avec
  `aapt2` et `apksigner` (paquet `com.superessence.universeascendant`, targetSdk 35, paysage,
  signature de débogage, 71 modèles, images NASA et mods inclus).

## Limites connues (honnêtes)

- **Aucun test sur un vrai téléphone** n'a pu être fait ici. Les mesures de performance viennent du
  rendu logiciel SwiftShader et ne disent rien des FPS réels. À vérifier sur appareil : fluidité,
  mémoire (textures 4K de la Terre), temps de chargement.
- Coût de rendu mesuré (qualité « élevée », ombres comprises) : ~900 appels de dessin et
  ~3,5 M triangles dans la maison/la rue ; en qualité « faible » ~480 appels et ~1,7 M
  triangles. C'est lourd pour un téléphone d'entrée de gamme ; la qualité automatique baisse
  le niveau si le jeu ralentit, mais une passe d'optimisation dédiée (fusion des pièces des
  voitures, LOD des accessoires, distance d'affichage) reste à faire.
- La construction du monde (Terre) prend plusieurs secondes de CPU au lancement d'une partie.
- Seulement deux modèles de personnages civils (homme en tenue tactique, femme civile) : la
  foule manque de variété.
- L'échelle spatiale est « gameplay » (Terre de 6 km de rayon, Lune à quelques dizaines de km),
  documentée dans le code.
- L'APK est signé avec une clé de débogage : il s'installe en « sources inconnues » mais n'est
  pas publiable sur le Play Store en l'état.
