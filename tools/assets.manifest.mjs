/**
 * Every third-party asset used by the game, with its source and licence.
 * `tools/fetch-assets.mjs` downloads, optimises and credits everything listed here.
 *
 * simplify: target ratio of vertices to keep (photoscans are far too dense for phones);
 * simplifyError: max geometric error allowed while simplifying (default 0.002).
 */

export const POLYHAVEN = 'Poly Haven (polyhaven.com) — CC0 1.0';
export const NASA = 'NASA — domaine public (NASA Media Usage Guidelines ; aucune approbation de la NASA n’est impliquée)';

/** Poly Haven models (photoscanned / hand-modelled props). */
export const polyhavenModels = [
  // --- house interior
  { id: 'sofa_02', out: 'sofa', simplify: 1 },
  { id: 'ArmChair_01', out: 'armchair', simplify: 0.6 },
  { id: 'modern_coffee_table_01', out: 'coffee_table', simplify: 0.6 },
  { id: 'Television_01', out: 'television', simplify: 1 },
  { id: 'WoodenTable_01', out: 'dining_table', simplify: 1 },
  { id: 'WoodenChair_01', out: 'chair', simplify: 0.2, simplifyError: 0.004 },
  { id: 'old_bed_frame', out: 'bed_frame', simplify: 0.12 },
  { id: 'ClassicNightstand_01', out: 'nightstand', simplify: 0.8 },
  { id: 'small_wooden_table_01', out: 'desk', simplify: 0.8 },
  { id: 'vintage_radio_transceiver', out: 'radio', simplify: 0.15 },
  { id: 'classic_laptop', out: 'laptop', simplify: 0.3 },
  { id: 'wooden_bookshelf_worn', out: 'bookshelf', simplify: 0.4 },
  { id: 'drawer_cabinet', out: 'wardrobe', simplify: 0.25 },
  { id: 'potted_plant_02', out: 'plant', simplify: 0.08, simplifyError: 0.01 },
  { id: 'modern_ceiling_lamp_01', out: 'ceiling_lamp', simplify: 0.6 },
  { id: 'desk_lamp_arm_01', out: 'desk_lamp', simplify: 0.25 },
  { id: 'electric_stove', out: 'stove', simplify: 0.35 },
  { id: 'vintage_microwave', out: 'microwave', simplify: 0.5 },
  { id: 'wall_clock', out: 'wall_clock', simplify: 0.6 },
  { id: 'hanging_picture_frame_01', out: 'picture_frame', simplify: 1 },
  { id: 'throw_pillows_01', out: 'pillows', simplify: 0.4 },
  // --- town
  { id: 'street_lamp_01', out: 'street_lamp', simplify: 0.1, simplifyError: 0.006 },
  { id: 'fire_hydrant', out: 'fire_hydrant', variants: true, simplify: 0.04 },
  { id: 'metal_trash_can', out: 'dumpster', simplify: 0.3 },
  { id: 'modular_street_seating', out: 'street_bench', simplify: 0.15 },
  { id: 'wooden_picnic_table', out: 'picnic_table', simplify: 0.5 },
  { id: 'utility_box_01', out: 'utility_box', simplify: 0.6 },
  { id: 'garden_gnome', out: 'garden_gnome', simplify: 0.15 },
  { id: 'planter_box_01', out: 'planter', simplify: 0.4 },
  { id: 'Barrel_01', out: 'barrel', simplify: 1 },
  { id: 'wooden_crate_01', out: 'crate', simplify: 0.6 },
  { id: 'cardboard_box_01', out: 'cardboard_box', simplify: 0.2 },
  { id: 'concrete_road_barrier', out: 'road_barrier', simplify: 0.04 },
  { id: 'covered_car', out: 'covered_car', simplify: 0.5 },
  { id: 'exterior_aircon_unit', out: 'aircon', variants: true, simplify: 0.2 },
  { id: 'shrub_03', out: 'shrub_a', variants: true, simplify: 0.5 },
  { id: 'shrub_04', out: 'shrub_b', variants: true, simplify: 0.06, simplifyError: 0.006 },
  { id: 'fern_02', out: 'fern', variants: true, simplify: 0.35, simplifyError: 0.01 },
  { id: 'boulder_01', out: 'boulder', simplify: 0.01, simplifyError: 0.02 },
  { id: 'rock_moss_set_01', out: 'mossy_rocks', variants: true, simplify: 0.02, simplifyError: 0.02 },
  { id: 'tree_stump_01', out: 'tree_stump', simplify: 0.02, simplifyError: 0.02 },
  // --- moon
  { id: 'moon_rock_01', out: 'moon_rock_1', simplify: 0.12 },
  { id: 'moon_rock_02', out: 'moon_rock_2', simplify: 0.3 },
  { id: 'moon_rock_03', out: 'moon_rock_3', simplify: 0.15 },
  { id: 'moon_rock_05', out: 'moon_rock_4', simplify: 0.12 },
  // --- vegetation sources processed in Blender (tools/blender/trees.py), kept raw in the cache
  { id: 'jacaranda_tree', out: null, raw: true },
  { id: 'fir_sapling', out: null, raw: true },
  { id: 'pine_sapling_small', out: null, raw: true },
];

/** Poly Haven PBR texture sets (diffuse, OpenGL normal, ARM = AO/roughness/metal). */
export const polyhavenTextures = [
  { id: 'leafy_grass', out: 'grass' },
  { id: 'rock_ground', out: 'rock' },
  { id: 'forest_ground_04', out: 'dirt' },
  { id: 'asphalt_02', out: 'asphalt' },
  { id: 'patterned_paving', out: 'paving' },
  { id: 'painted_plaster_wall', out: 'plaster' },
  { id: 'wood_floor', out: 'wood_floor' },
  { id: 'floor_tiles_06', out: 'tiles' },
  { id: 'clay_roof_tiles', out: 'roof' },
  { id: 'brick_wall_02', out: 'brick' },
  { id: 'metal_plate', out: 'metal' },
  { id: 'concrete_floor_02', out: 'concrete' },
  { id: 'moon_01', out: 'moon' },
  { id: 'bark_willow', out: 'bark' },
  { id: 'fabric_pattern_07', out: 'fabric' },
];

export const polyhavenHdris = [{ id: 'kloofendal_48d_partly_cloudy_puresky', out: 'sky_day' }];

/** NASA 3D Resources (science.nasa.gov/3d-resources) — public domain. */
const NASA3D = 'https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model';
export const nasaModels = [
  { url: `${NASA3D}/international-space-station-(iss)-(a)/International%20Space%20Station%20(ISS)%20(A).glb`, out: 'iss', title: 'International Space Station (ISS) (A)', simplify: 0.5 },
  { url: `${NASA3D}/apollo-lunar-module/Apollo%20Lunar%20Module.glb`, out: 'lunar_module', title: 'Apollo Lunar Module', simplify: 0.5 },
  { url: `${NASA3D}/astronaut/Astronaut.glb`, out: 'astronaut', title: 'Astronaut', simplify: 0.5 },
  { url: `${NASA3D}/hubble-space-telescope-(a)/Hubble%20Space%20Telescope%20(A).glb`, out: 'hubble', title: 'Hubble Space Telescope (A)', simplify: 0.5 },
  { url: `${NASA3D}/voyager-probe-(a)/Voyager%20Probe%20(A).glb`, out: 'voyager', title: 'Voyager Probe (A)', simplify: 0.6 },
];

/** NASA imagery (public domain): Blue Marble, Black Marble, clouds, LRO Moon, Deep Star Maps. */
export const nasaImages = [
  { url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74218/world.200412.3x5400x2700.jpg', out: 'earth_day', width: 2048, title: 'Blue Marble Next Generation (NASA Earth Observatory)' },
  { url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg', out: 'earth_night', width: 2048, title: 'Black Marble 2012 (NASA Earth Observatory / NOAA)' },
  { url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg', out: 'earth_clouds', width: 2048, title: 'Blue Marble clouds (NASA Earth Observatory)' },
  { url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif', out: 'moon_color', width: 2048, title: 'CGI Moon Kit — LRO color (NASA SVS)' },
  { url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_4k_print.jpg', out: 'starmap', width: 4096, title: 'Deep Star Maps 2020 (NASA SVS)' },
];

/** Rigged / animated characters. */
const THREE_MODELS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf';
export const characterModels = [
  { url: `${THREE_MODELS}/Soldier.glb`, out: 'human_male', credit: 'Personnage et animations Mixamo (Adobe) — via les exemples three.js. Licence Mixamo : utilisation libre de droits dans les jeux ; ne pas redistribuer séparément. À revalider avant publication commerciale.' },
  { url: `${THREE_MODELS}/Michelle.glb`, out: 'human_female', credit: 'Personnage Mixamo (Adobe) — via les exemples three.js. Même licence que ci-dessus.' },
  { url: `${THREE_MODELS}/Xbot.glb`, out: 'suit_body', credit: 'X Bot — personnage Mixamo (Adobe) via les exemples three.js. Même licence Mixamo.' },
  { url: `${THREE_MODELS}/RobotExpressive/RobotExpressive.glb`, out: 'robot', credit: 'RobotExpressive par Tomás Laulhé (Quaternius) — CC0 1.0.' },
  { url: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Fox/glTF-Binary/Fox.glb', out: 'fox', credit: 'Fox — modèle par PixelMannen (CC0 1.0), rig et animations par tomkranis (CC BY 4.0) — Khronos glTF Sample Assets.' },
];
