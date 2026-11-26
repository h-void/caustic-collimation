import type { ViewMode } from '../shared/pureCodeContract.ts';
import { GLASS_SF11, type OpticalElementState } from './types.ts';

export const MAX_TILT_DEG = 35.0;
export const MAX_TILT_RAD = (MAX_TILT_DEG * Math.PI) / 180.0;

export const BENCH_BOUNDS = {
  minZ: -2.25,
  maxZ: 1.55,
  minX: -1.25,
  maxX: 1.25,
} as const;

export interface BenchCameraMapping {
  viewMode: ViewMode;
  aspect: number;
  orthoHalfZ: number;
  centerZ: number;
  centerX: number;
  eye: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovYRad: number;
}

export interface CameraBasis {
  eye: [number, number, number];
  fwd: [number, number, number];
  right: [number, number, number];
  camUp: [number, number, number];
  tanHalfFov: number;
}

export function createDefaultCameraMapping(
  viewMode: ViewMode,
  aspect: number,
): BenchCameraMapping {
  const safeAspect = Math.max(0.25, Number.isFinite(aspect) ? aspect : 1.6);
  const baseFovYRad = (36.5 * Math.PI) / 180.0;
  const baseTanHalfFov = Math.tan(baseFovYRad * 0.5);
  const baseOffsetX = -1.52;
  const baseOffsetY = 4.18;
  const baseDist = Math.hypot(baseOffsetX, baseOffsetY);

  let distScale = 1.0;
  let benchCenterZ = -0.02;
  let benchCenterX = 0.0;

  if (safeAspect < 1.5) {
    const portraitT = Math.max(0.0, Math.min(1.0, (1.5 - safeAspect) / (1.5 - 0.45)));
    const targetHalfZ = 2.20 - 0.04 * portraitT;
    const neededDist = targetHalfZ / (baseTanHalfFov * safeAspect);
    distScale = Math.max(1.0, neededDist / baseDist);
    benchCenterZ = -0.02 - 0.12 * portraitT;
    benchCenterX = -0.14 * portraitT;
  }

  return {
    viewMode,
    aspect: safeAspect,
    orthoHalfZ: 3.12,
    centerZ: viewMode === 'schematic' ? 0.02 : benchCenterZ,
    centerX: viewMode === 'schematic' ? 0.0 : benchCenterX,
    eye: [benchCenterX + baseOffsetX * distScale, baseOffsetY * distScale, benchCenterZ],
    target: [benchCenterX, 0.0, benchCenterZ],
    up: [1.0, 0.0, 0.0],
    fovYRad: baseFovYRad,
  };
}

export function computeCameraBasis(cam: BenchCameraMapping): CameraBasis {
  const fx = cam.target[0] - cam.eye[0];
  const fy = cam.target[1] - cam.eye[1];
  const fz = cam.target[2] - cam.eye[2];
  const fLen = Math.hypot(fx, fy, fz) || 1.0;
  const fwd: [number, number, number] = [fx / fLen, fy / fLen, fz / fLen];

  let rx = fwd[1] * cam.up[2] - fwd[2] * cam.up[1];
  let ry = fwd[2] * cam.up[0] - fwd[0] * cam.up[2];
  let rz = fwd[0] * cam.up[1] - fwd[1] * cam.up[0];
  const rLen = Math.hypot(rx, ry, rz) || 1.0;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;
  const right: [number, number, number] = [rx, ry, rz];

  const camUp: [number, number, number] = [
    ry * fwd[2] - rz * fwd[1],
    rz * fwd[0] - rx * fwd[2],
    rx * fwd[1] - ry * fwd[0],
  ];

  return {
    eye: cam.eye,
    fwd,
    right,
    camUp,
    tanHalfFov: Math.tan(cam.fovYRad * 0.5),
  };
}

/**
 * Column-major 4x4 View-Projection matrix aligned 100% with screenToBenchXZ.
 */
export function computeViewProjMatrix(cam: BenchCameraMapping): Float32Array {
  const m = new Float32Array(16);
  const safeAspect = Math.max(0.25, cam.aspect);

  if (cam.viewMode === 'schematic') {
    const halfZ = Math.max(0.2, cam.orthoHalfZ);
    const halfX = halfZ / safeAspect;
    // uNdc = (z - centerZ) / halfZ
    // vNdc = (x - centerX) / halfX
    // zNdc = -0.1 * y
    m[0] = 0.0;
    m[1] = 1.0 / halfX;
    m[2] = 0.0;
    m[3] = 0.0;

    m[4] = 0.0;
    m[5] = 0.0;
    m[6] = -0.1;
    m[7] = 0.0;

    m[8] = 1.0 / halfZ;
    m[9] = 0.0;
    m[10] = 0.0;
    m[11] = 0.0;

    m[12] = -cam.centerZ / halfZ;
    m[13] = -cam.centerX / halfX;
    m[14] = 0.0;
    m[15] = 1.0;
    return m;
  }

  const basis = computeCameraBasis(cam);
  const { eye, fwd, right, camUp, tanHalfFov } = basis;
  const f = 1.0 / Math.max(1e-4, tanHalfFov);
  const sx = f / safeAspect;
  const sy = f;
  const near = 0.15;
  const far = 48.0;
  const sz = (far + near) / (far - near);
  const tz = -(2.0 * far * near) / (far - near);

  const dotRightEye = right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2];
  const dotUpEye = camUp[0] * eye[0] + camUp[1] * eye[1] + camUp[2] * eye[2];
  const dotFwdEye = fwd[0] * eye[0] + fwd[1] * eye[1] + fwd[2] * eye[2];

  // Column 0 (multiplies p.x)
  m[0] = right[0] * sx;
  m[1] = camUp[0] * sy;
  m[2] = fwd[0] * sz;
  m[3] = fwd[0];

  // Column 1 (multiplies p.y)
  m[4] = right[1] * sx;
  m[5] = camUp[1] * sy;
  m[6] = fwd[1] * sz;
  m[7] = fwd[1];

  // Column 2 (multiplies p.z)
  m[8] = right[2] * sx;
  m[9] = camUp[2] * sy;
  m[10] = fwd[2] * sz;
  m[11] = fwd[2];

  // Column 3 (translation)
  m[12] = -dotRightEye * sx;
  m[13] = -dotUpEye * sy;
  m[14] = -dotFwdEye * sz + tz;
  m[15] = -dotFwdEye;

  return m;
}

/**
 * Maps pointer client coordinates onto the y = 0 XZ optical bench plane.
 */
export function screenToBenchXZ(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  cam: BenchCameraMapping,
): { x: number; z: number } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const uNdc = ((clientX - rect.left) / w) * 2.0 - 1.0;
  const vNdc = 1.0 - ((clientY - rect.top) / h) * 2.0;

  if (cam.viewMode === 'schematic') {
    const halfZ = cam.orthoHalfZ;
    const halfX = halfZ / Math.max(0.25, cam.aspect);
    return {
      z: cam.centerZ + uNdc * halfZ,
      x: cam.centerX + vNdc * halfX,
    };
  }

  const { eye, fwd, right, camUp, tanHalfFov } = computeCameraBasis(cam);
  const dx = fwd[0] + right[0] * (uNdc * cam.aspect * tanHalfFov) + camUp[0] * (vNdc * tanHalfFov);
  const dy = fwd[1] + right[1] * (uNdc * cam.aspect * tanHalfFov) + camUp[1] * (vNdc * tanHalfFov);
  const dz = fwd[2] + right[2] * (uNdc * cam.aspect * tanHalfFov) + camUp[2] * (vNdc * tanHalfFov);

  if (Math.abs(dy) < 1e-5) {
    return { x: 0, z: cam.centerZ };
  }
  const t = -eye[1] / dy;
  return {
    x: Math.max(-3.0, Math.min(3.0, eye[0] + t * dx)),
    z: Math.max(-4.0, Math.min(4.0, eye[2] + t * dz)),
  };
}

export type DragInteractionMode = 'none' | 'translate' | 'rotate-drag' | 'rotate-ring';

export interface HitTestResult {
  mode: DragInteractionMode;
  elementIndex: number;
}

export function hitTestBench(
  worldX: number,
  worldZ: number,
  elements: readonly OpticalElementState[],
  currentSelectedIndex: number,
  isRotateModifier: boolean,
  allowRotateRing: boolean = true,
): HitTestResult {
  if (elements.length === 0) {
    return { mode: 'none', elementIndex: 0 };
  }

  const selIdx = Math.max(0, Math.min(elements.length - 1, currentSelectedIndex));

  let bestIdx = selIdx;
  let bestDist = Infinity;
  for (let i = 0; i < elements.length; i++) {
    const d = Math.hypot(worldX - elements[i].x, worldZ - elements[i].z);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // Clicking directly inside another element's body selects/moves it instead of
  // being hijacked by the currently selected element's rotate ring.
  const directInteriorHit =
    bestIdx !== selIdx && bestDist <= elements[bestIdx].apertureRadius * 0.85;

  if (allowRotateRing && !isRotateModifier && !directInteriorHit) {
    const selElem = elements[selIdx];
    const ringRadius = selElem.apertureRadius + 0.15;
    const distToSel = Math.hypot(worldX - selElem.x, worldZ - selElem.z);
    if (Math.abs(distToSel - ringRadius) <= 0.11) {
      return { mode: 'rotate-ring', elementIndex: selIdx };
    }
  }

  if (isRotateModifier) {
    if (bestDist <= elements[bestIdx].apertureRadius + 0.45) {
      return { mode: 'rotate-drag', elementIndex: bestIdx };
    }
    return { mode: 'none', elementIndex: selIdx };
  }

  if (bestDist <= elements[bestIdx].apertureRadius + 0.25) {
    return { mode: 'translate', elementIndex: bestIdx };
  }

  return { mode: 'none', elementIndex: selIdx };
}

/**
 * Net optical tilt magnitude Θ = sqrt(Σ_i (θx_i^2 + θy_i^2)) in radians.
 */
export function computeNetTiltRad(elements: readonly OpticalElementState[]): number {
  let sumSq = 0.0;
  for (const el of elements) {
    sumSq += el.thetaX * el.thetaX + el.thetaY * el.thetaY;
  }
  return Math.sqrt(sumSq);
}

/**
 * Effective bench glass Cauchy constants (weighted across active elements) for AudioWorklet sync.
 */
export function computeEffectiveGlassConstants(elements: readonly OpticalElementState[]): {
  glassA: number;
  glassB: number;
} {
  if (elements.length === 0) {
    return { glassA: 1.6239, glassB: 0.00881 };
  }
  let sumA = 0.0;
  let sumB = 0.0;
  for (const el of elements) {
    sumA += el.glass === GLASS_SF11 ? 1.7432 : 1.5046;
    sumB += el.glass === GLASS_SF11 ? 0.01342 : 0.00420;
  }
  return {
    glassA: sumA / elements.length,
    glassB: sumB / elements.length,
  };
}
