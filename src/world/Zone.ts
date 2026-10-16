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
  dispose(): void;
}

/** Recursively frees GPU resources of an object tree. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
