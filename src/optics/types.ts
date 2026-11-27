import type { PresetIndex, ViewMode } from '../shared/benchConfig.ts';

export const ARCHETYPE_BICONVEX = 0;
export const ARCHETYPE_MENISCUS = 1;
export const ARCHETYPE_ASPHERIC = 2;
export const ARCHETYPE_PRISM = 3;
export const ARCHETYPE_CYLINDRICAL = 4;

export type ElementArchetypeId = 0 | 1 | 2 | 3 | 4;

export const GLASS_NBK7 = 0;
export const GLASS_SF11 = 1;

export type GlassId = 0 | 1;

export const MAX_OPTICAL_ELEMENTS = 5;
export const NUM_SPECTRAL_BANDS = 7;

/** 7 spectral Cauchy wavelengths in micrometers (420..680 nm) */
export const SPECTRAL_LAMBDAS_UM: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [0.420, 0.460, 0.500, 0.545, 0.590, 0.635, 0.680];

/** White-balanced linear RGB spectral primaries for the 7 Cauchy bands */
export const SPECTRAL_BAND_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.24, 0.02, 0.72], // 420 nm Violet
  [0.05, 0.22, 0.88], // 460 nm Royal Blue
  [0.00, 0.60, 0.46], // 500 nm Cyan-Teal
  [0.14, 0.82, 0.10], // 545 nm Emerald Green (reference anchor)
  [0.72, 0.45, 0.00], // 590 nm Sodium Amber
  [0.88, 0.14, 0.00], // 635 nm Vermilion Red
  [0.52, 0.02, 0.00], // 680 nm Deep Crimson
];

export interface OpticalElementState {
  archetype: ElementArchetypeId;
  glass: GlassId;
  x: number;
  z: number;
  thetaX: number; // In-plane meridional yaw in radians [-35°, +35°]
  thetaY: number; // Out-of-plane sagittal pitch in radians [-35°, +35°]
  geomA: [number, number, number, number];
  geomB: [number, number, number, number];
  apertureRadius: number;
}

export interface BenchState {
  preset: PresetIndex;
  seed: bigint;
  elements: OpticalElementState[];
  selectedElementIndex: number;
  dispersionBoost: number; // γ_D ∈ [1.0, 6.0], default 3.5
  viewMode: ViewMode;
  printMode: boolean;
  breathingEnabled: boolean;
}

export interface TracedBounceVertex {
  x: number;
  y: number;
  z: number;
  flux: number;
  isTIR: boolean;
}

export interface TracedRayResult {
  bandIndex: number;
  lambdaUm: number;
  vertices: TracedBounceVertex[];
  hadTIR: boolean;
  exitedForward: boolean;
  screenHitX: number | null;
  screenHitY: number | null;
}
