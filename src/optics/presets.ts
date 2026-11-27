import { DEFAULT_SEED_U64, Rng64, type PresetIndex } from '../shared/benchConfig.ts';
import {
  ARCHETYPE_ASPHERIC,
  ARCHETYPE_BICONVEX,
  ARCHETYPE_CYLINDRICAL,
  ARCHETYPE_MENISCUS,
  ARCHETYPE_PRISM,
  GLASS_NBK7,
  GLASS_SF11,
  type OpticalElementState,
} from './types.ts';

const DEG = Math.PI / 180.0;

function cloneElements(elems: readonly OpticalElementState[]): OpticalElementState[] {
  return elems.map((e) => ({
    ...e,
    geomA: [...e.geomA] as [number, number, number, number],
    geomB: [...e.geomB] as [number, number, number, number],
  }));
}

const BASE_PRESET_ELEMENTS: Record<PresetIndex, readonly OpticalElementState[]> = {
  // Preset 1: Off-Axis Coma (4 elements: Aspheric + Meniscus + SF11 Prism + Biconvex)
  1: [
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: 0.05,
      z: -1.65,
      thetaX: 11.0 * DEG,
      thetaY: -3.0 * DEG,
      geomA: [0.76, -0.58, 0.075, -0.020],
      geomB: [0.115, 0.56, 0, 0],
      apertureRadius: 0.56,
    },
    {
      archetype: ARCHETYPE_MENISCUS,
      glass: GLASS_SF11,
      x: -0.04,
      z: -0.85,
      thetaX: -9.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [1.85, 0.88, 0.065, 0.52],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.52,
    },
    {
      archetype: ARCHETYPE_PRISM,
      glass: GLASS_SF11,
      x: 0.06,
      z: 0.02,
      thetaX: -14.0 * DEG,
      thetaY: 0.0,
      geomA: [0.22, 0.54, 24.0 * DEG, 1.0],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.48,
    },
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: -0.22,
      z: 0.92,
      thetaX: 8.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [1.15, 1.15, 0.130, 0.62],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.62,
    },
  ],

  // Preset 2: Double Flint Prism (4 elements: Biconvex + 60° Dove TIR SF11 Prism + Dispersive SF11 Prism + Aspheric)
  2: [
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: 0.00,
      z: -1.80,
      thetaX: 0.0,
      thetaY: 0.0,
      geomA: [1.95, 1.95, 0.110, 0.56],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.56,
    },
    {
      archetype: ARCHETYPE_PRISM,
      glass: GLASS_SF11,
      x: 0.22,
      z: -0.95,
      thetaX: 4.0 * DEG,
      thetaY: 0.0,
      geomA: [0.34, 0.56, 30.0 * DEG, 1.0], // Equilateral 60° Dove TIR cavity
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.52,
    },
    {
      archetype: ARCHETYPE_PRISM,
      glass: GLASS_SF11,
      x: -0.06,
      z: 0.02,
      thetaX: 14.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [0.21, 0.54, 24.0 * DEG, -1.0],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.46,
    },
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: 0.22,
      z: 0.95,
      thetaX: -7.0 * DEG,
      thetaY: 0.0,
      geomA: [0.80, -0.55, 0.065, -0.015],
      geomB: [0.125, 0.62, 0, 0],
      apertureRadius: 0.62,
    },
  ],

  // Preset 3: Anamorphic Astigmatism (3 elements: Cylindrical + Meniscus + Biconvex)
  3: [
    {
      archetype: ARCHETYPE_CYLINDRICAL,
      glass: GLASS_NBK7,
      x: 0.00,
      z: -1.55,
      thetaX: 4.0 * DEG,
      thetaY: 8.0 * DEG,
      geomA: [2.35, 2.35, 0.105, 0.56],
      geomB: [0.56, 0, 0, 0],
      apertureRadius: 0.56,
    },
    {
      archetype: ARCHETYPE_MENISCUS,
      glass: GLASS_SF11,
      x: -0.01,
      z: -0.55,
      thetaX: -3.0 * DEG,
      thetaY: 0.0,
      geomA: [1.85, 0.86, 0.065, 0.54],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.54,
    },
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: 0.00,
      z: 0.45,
      thetaX: 0.0,
      thetaY: 0.0,
      geomA: [1.32, 1.32, 0.125, 0.58],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.58,
    },
  ],

  // Preset 4: Zero-Beat Collimation (3 elements: strictly on-axis θx = θy = 0, Θ = 0)
  4: [
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: 0.00,
      z: -1.60,
      thetaX: 0.0,
      thetaY: 0.0,
      geomA: [1.45, 1.45, 0.120, 0.54],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.54,
    },
    {
      archetype: ARCHETYPE_MENISCUS,
      glass: GLASS_SF11,
      x: 0.00,
      z: -0.55,
      thetaX: 0.0,
      thetaY: 0.0,
      geomA: [1.85, 0.86, 0.065, 0.50],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.50,
    },
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: 0.00,
      z: 0.58,
      thetaX: 0.0,
      thetaY: 0.0,
      geomA: [0.84, -0.62, 0.040, -0.010],
      geomB: [0.125, 0.56, 0, 0],
      apertureRadius: 0.56,
    },
  ],

  // Preset 5: Five-Element Cavity (all 5 SDF optical archetypes simultaneously)
  5: [
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: 0.02,
      z: -1.88,
      thetaX: 3.0 * DEG,
      thetaY: 0.0,
      geomA: [2.20, 2.20, 0.105, 0.56],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.56,
    },
    {
      archetype: ARCHETYPE_MENISCUS,
      glass: GLASS_SF11,
      x: -0.02,
      z: -1.12,
      thetaX: -4.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [1.85, 0.82, 0.065, 0.54],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.54,
    },
    {
      archetype: ARCHETYPE_CYLINDRICAL,
      glass: GLASS_NBK7,
      x: 0.01,
      z: -0.38,
      thetaX: 3.0 * DEG,
      thetaY: -6.0 * DEG,
      geomA: [2.40, 2.40, 0.105, 0.56],
      geomB: [0.56, 0, 0, 0],
      apertureRadius: 0.56,
    },
    {
      archetype: ARCHETYPE_PRISM,
      glass: GLASS_SF11,
      x: 0.06,
      z: 0.28,
      thetaX: -14.0 * DEG,
      thetaY: 0.0,
      geomA: [0.19, 0.54, 24.0 * DEG, 1.0],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.44,
    },
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: -0.26,
      z: 1.06,
      thetaX: 9.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [0.86, -0.58, 0.065, -0.018],
      geomB: [0.135, 0.65, 0, 0],
      apertureRadius: 0.65,
    },
  ],
};

/**
 * Builds deterministic optical bench elements for `preset` seeded by `Rng64(seed)`.
 * - Canonical seed 1468n preserves exact calibrated reference geometry; other seeds apply
 *   calibrated micro-perturbations so distinct ?seed=<u64> values produce measurably distinct caustics.
 * - Preset 4 strictly keeps x = 0, θx = 0, θy = 0 across ALL seeds so Θ === 0 and beatingHz === 0.
 */
export function buildPresetElements(
  preset: PresetIndex,
  seed: bigint = DEFAULT_SEED_U64,
): OpticalElementState[] {
  const elems = cloneElements(BASE_PRESET_ELEMENTS[preset]);
  const rng = new Rng64(seed);

  if (preset === 4) {
    if (seed !== DEFAULT_SEED_U64) {
      for (const el of elems) {
        el.z += rng.range(-0.03, 0.03);
        el.x = 0.0;
        el.thetaX = 0.0;
        el.thetaY = 0.0;
      }
    }
    return elems;
  }

  if (seed !== DEFAULT_SEED_U64) {
    for (const el of elems) {
      el.x += rng.range(-0.022, 0.022);
      el.z += rng.range(-0.028, 0.028);
      el.thetaX += rng.range(-1.4 * DEG, 1.4 * DEG);
      el.thetaY += rng.range(-0.7 * DEG, 0.7 * DEG);
    }
  }
  return elems;
}

/**
 * Builds elements for each cell of 'caustic-tilt-matrix' (θx ∈ {0°, 7°, 15°, 24°}).
 * Uses an active 3-element doublet + weak dispersive flint wedge/meniscus + focusing singlet
 * where the primary compound lens tilts systematically across {0°, 7°, 15°, 24°}, morphing a
 * needle-sharp on-axis paraxial focus into classic Seidel coma and bifurcated astigmatic wings.
 */
export function buildTiltMatrixCellElements(tiltDeg: number): OpticalElementState[] {
  const rad = tiltDeg * DEG;
  return [
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: 0.0,
      z: -1.45,
      thetaX: rad * 0.65,
      thetaY: 0.0,
      geomA: [1.55, 1.55, 0.125, 0.58],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.58,
    },
    {
      archetype: ARCHETYPE_MENISCUS,
      glass: GLASS_SF11,
      x: 0.0,
      z: -0.62,
      thetaX: -rad * 0.85,
      thetaY: rad * 0.25,
      geomA: [1.80, 0.84, 0.065, 0.54],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.54,
    },
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: 0.0,
      z: 0.22,
      thetaX: rad,
      thetaY: rad * 0.35,
      geomA: [0.95, -0.35, 0.11, -0.02],
      geomB: [0.145, 0.60, 0, 0],
      apertureRadius: 0.60,
    },
  ];
}

/**
 * Builds high-contrast macro elements for 'caustic-thumb' (Page 1 Cover 126x90 pt thumbnail).
 */
export function buildThumbMacroElements(): OpticalElementState[] {
  return [
    {
      archetype: ARCHETYPE_ASPHERIC,
      glass: GLASS_NBK7,
      x: 0.02,
      z: -0.95,
      thetaX: 9.0 * DEG,
      thetaY: -2.0 * DEG,
      geomA: [0.82, -0.52, 0.08, -0.02],
      geomB: [0.13, 0.58, 0, 0],
      apertureRadius: 0.58,
    },
    {
      archetype: ARCHETYPE_PRISM,
      glass: GLASS_SF11,
      x: 0.04,
      z: -0.08,
      thetaX: -15.5 * DEG,
      thetaY: 0.0,
      geomA: [0.26, 0.58, 24.0 * DEG, 1.0],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.54,
    },
    {
      archetype: ARCHETYPE_BICONVEX,
      glass: GLASS_NBK7,
      x: -0.24,
      z: 0.82,
      thetaX: 11.0 * DEG,
      thetaY: 2.0 * DEG,
      geomA: [1.08, 1.08, 0.14, 0.64],
      geomB: [0, 0, 0, 0],
      apertureRadius: 0.64,
    },
  ];
}
