import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Game } from '../Game';

export interface Interactable {
  id: string;
  position: THREE.Vector3;
  radius: number;
  /** Label shown on the contextual action button, or null if unavailable right now. */
  label: (game: Game) => string | null;
  icon?: string;
  use: (game: Game) => void;
}

export interface MapMarker {
  x: number;
  z: number;
  label: string;
  color: string;
}

/** A loadable region of the universe. Only one detailed zone is loaded at a time. */
export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly gravity: number;
  readonly hasAtmosphere: boolean;
  readonly root: THREE.Group;
  readonly physics: CollisionWorld;
  readonly interactables: Interactable[];
  readonly spawn: THREE.Vector3;
  /** Half-size of the area shown on the map. */
  readonly mapExtent: number;
  mapMarkers(): MapMarker[];
  /** Ground height used by AI and spawning. */
  groundAt(x: number, z: number): number;
  update(dt: number, game: Game): void;
  /** Called when quality settings change. */
  applyQuality?(game: Game): void;
  /** Weightless zone: the player floats (forced flight, limited speed). */
  readonly zeroG?: boolean;
  readonly floatSpeed?: number;
  /** Chase-camera distance override for cramped interiors. */
  readonly cameraDistance?: number;
  /** Image-based lighting strength (space is much darker than Earth's sky). */
  readonly envIntensity?: number;
  /** Background (e.g. the NASA star map) when the zone has no sky dome. */
  readonly background?: THREE.Texture | THREE.Color | null;
  /** Breathable air at this point (pressurised modules). */
  breathable?(p: THREE.Vector3): boolean;
  dispose(): void;
}

/** Recursively frees GPU resources of an object tree (assets cached for the session are kept). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (!x.userData.shared) x.dispose();
    if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
  });
}
