import { ARCHIVAL_LITHO_PALETTE } from '../shared/benchConfig.ts';
import {
  ARCHETYPE_ASPHERIC,
  ARCHETYPE_BICONVEX,
  ARCHETYPE_MENISCUS,
  ARCHETYPE_PRISM,
  GLASS_SF11,
  SPECTRAL_LAMBDAS_UM,
  type GlassId,
  type OpticalElementState,
  type TracedBounceVertex,
  type TracedRayResult,
} from './types.ts';

export type Vec3 = [number, number, number];

export const HIT_EPS = 1e-3;
export const MAX_MARCH_STEPS = 64;
export const MAX_BOUNCES = 14;

export function safeNormalize3(vx: number, vy: number, vz: number): Vec3 {
  const lenSq = Math.max(vx * vx + vy * vy + vz * vz, 1e-16);
  const invLen = 1.0 / Math.sqrt(lenSq);
  return [vx * invLen, vy * invLen, vz * invLen];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Exact Cauchy dispersion formula (λ in μm):
 * n(λ) = A + (γ_D * B) / λ^2
 * N-BK7: A = 1.5046, B = 0.00420
 * SF11:  A = 1.7432, B = 0.01342
 */
export function cauchyIndex(glass: GlassId, lambdaUm: number, gammaD: number): number {
  const A = glass === GLASS_SF11 ? 1.7432 : 1.5046;
  const B = glass === GLASS_SF11 ? 0.01342 : 0.00420;
  const safeLambda = Math.max(0.25, lambdaUm);
  return A + (gammaD * B) / (safeLambda * safeLambda);
}

/**
 * Orthonormal world-to-local transform:
 * p_local = R_pitch(-θy) * R_yaw(-θx) * (p - (x_i, 0, z_i))
 */
export function worldToLocal(p: Vec3, elem: OpticalElementState): Vec3 {
  const qx = p[0] - elem.x;
  const qy = p[1];
  const qz = p[2] - elem.z;
  const cx = Math.cos(elem.thetaX);
  const sx = Math.sin(elem.thetaX);
  const cy = Math.cos(elem.thetaY);
  const sy = Math.sin(elem.thetaY);

  const rx = cx * qx - sx * qz;
  const ry = qy;
  const rz = sx * qx + cx * qz;

  return [rx, cy * ry - sy * rz, sy * ry + cy * rz];
}

/**
 * Exact 3D Signed Distance Function for all 5 optical element archetypes (mirrors GLSL 1:1).
 */
export function sdfElementLocal(
  p: Vec3,
  archetype: number,
  gA: readonly [number, number, number, number],
  gB: readonly [number, number, number, number],
): number {
  const rxy = Math.hypot(p[0], p[1]);

  if (archetype === ARCHETYPE_BICONVEX) {
    const R1 = gA[0];
    const R2 = gA[1];
    const th = gA[2];
    const ap = gA[3];
    const d1 = Math.hypot(rxy, p[2] - (R1 - th)) - R1;
    const d2 = Math.hypot(rxy, p[2] - (th - R2)) - R2;
    return Math.max(Math.max(d1, d2), rxy - ap);
  }

  if (archetype === ARCHETYPE_MENISCUS) {
    const R1 = gA[0];
    const R2 = gA[1];
    const th = gA[2];
    const ap = gA[3];
    const dFront = Math.hypot(rxy, p[2] - (R1 - th)) - R1;
    const dBack = -(Math.hypot(rxy, p[2] - (th + R2)) - R2);
    const rSafe = Math.min(ap, R2 * 0.96);
    const zCap = th + R2 - Math.sqrt(Math.max(1e-4, R2 * R2 - rSafe * rSafe)) + 0.015;
    return Math.max(Math.max(dFront, dBack), Math.max(rxy - ap, p[2] - zCap));
  }

  if (archetype === ARCHETYPE_ASPHERIC) {
    const c = gA[0];
    const kappa = gA[1];
    const a4 = gA[2];
    const a6 = gA[3];
    const th = gB[0];
    const ap = gB[1];
    const rc = Math.min(rxy, ap + 0.06);
    const r2 = rc * rc;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const sag =
      (c * r2) / (1.0 + Math.sqrt(Math.max(0.01, 1.0 - (1.0 + kappa) * c * c * r2))) +
      a4 * r4 +
      a6 * r6;
    const dSlab = 0.72 * Math.max(-th + sag - p[2], p[2] - (th - 0.65 * sag));
    const dRad = rxy - ap;
    const extZ = Math.abs(p[2]) - (th + 0.16);
    if (dRad > 0.06 || extZ > 0.06) {
      const mx = Math.max(dRad, 0.0);
      const mz = Math.max(extZ, 0.0);
      return Math.max(Math.max(dSlab, dRad), Math.hypot(mx, mz) - 0.04);
    }
    return Math.max(dSlab, dRad);
  }

  if (archetype === ARCHETYPE_PRISM) {
    const h = gA[0];
    const hy = gA[1];
    const beta = gA[2];
    const flipS = gA[3];
    const xs = p[0] * flipS;
    const sb = Math.sin(beta);
    const cb = Math.cos(beta);
    const dTri = Math.max(-xs - h, Math.max(sb * xs - cb * p[2] - h, sb * xs + cb * p[2] - h));
    const dY = Math.abs(p[1]) - hy;
    const insideTerm = Math.min(Math.max(dTri, dY), 0.0);
    const outsideTerm = Math.hypot(Math.max(dTri, 0.0), Math.max(dY, 0.0));
    return insideTerm + outsideTerm;
  }

  // ARCHETYPE_CYLINDRICAL (4): curved in X, flat in Y
  const R1 = gA[0];
  const R2 = gA[1];
  const th = gA[2];
  const ap = gA[3];
  const hy = gB[0];
  const d1 = Math.hypot(p[0], p[2] - (R1 - th)) - R1;
  const d2 = Math.hypot(p[0], p[2] - (th - R2)) - R2;
  return Math.max(Math.max(d1, d2), Math.max(Math.abs(p[0]) - ap, Math.abs(p[1]) - hy));
}

export function sdfElementWorld(p: Vec3, elem: OpticalElementState): number {
  return sdfElementLocal(worldToLocal(p, elem), elem.archetype, elem.geomA, elem.geomB);
}

export function calcElementNormal(pWorld: Vec3, elem: OpticalElementState): Vec3 {
  const e = 2e-4;
  const dx =
    sdfElementWorld([pWorld[0] + e, pWorld[1], pWorld[2]], elem) -
    sdfElementWorld([pWorld[0] - e, pWorld[1], pWorld[2]], elem);
  const dy =
    sdfElementWorld([pWorld[0], pWorld[1] + e, pWorld[2]], elem) -
    sdfElementWorld([pWorld[0], pWorld[1] - e, pWorld[2]], elem);
  const dz =
    sdfElementWorld([pWorld[0], pWorld[1], pWorld[2] + e], elem) -
    sdfElementWorld([pWorld[0], pWorld[1], pWorld[2] - e], elem);
  return safeNormalize3(dx, dy, dz);
}

export function schlickFresnel(cosThetaI: number, n1: number, n2: number): number {
  const denom = Math.max(n1 + n2, 1e-4);
  let r0 = (n1 - n2) / denom;
  r0 *= r0;
  const m = Math.max(0.0, Math.min(1.0, 1.0 - cosThetaI));
  const m2 = m * m;
  return Math.max(0.0, Math.min(1.0, r0 + (1.0 - r0) * m2 * m2 * m));
}

export interface SurfaceInteractionResult {
  direction: Vec3;
  isTIR: boolean;
  kTIR: number;
  fresnelR: number;
  cosThetaI: number;
  orientedNormal: Vec3;
}

/**
 * SIMD-safe 3D Vector Snell refraction + explicit k_TIR < 0 Total Internal Reflection.
 */
export function refractOrReflect3D(
  incidentUnit: Vec3,
  surfaceNormalUnit: Vec3,
  n1: number,
  n2: number,
): SurfaceInteractionResult {
  const I = safeNormalize3(incidentUnit[0], incidentUnit[1], incidentUnit[2]);
  let N = safeNormalize3(surfaceNormalUnit[0], surfaceNormalUnit[1], surfaceNormalUnit[2]);
  if (dot3(I, N) > 0.0) {
    N = [-N[0], -N[1], -N[2]];
  }
  const cosThetaI = Math.max(0.0, Math.min(1.0, -dot3(I, N)));
  const eta = n1 / Math.max(n2, 1e-4);
  const kTIR = 1.0 - eta * eta * (1.0 - cosThetaI * cosThetaI);

  if (kTIR < 0.0) {
    const dir = safeNormalize3(
      I[0] + 2.0 * cosThetaI * N[0],
      I[1] + 2.0 * cosThetaI * N[1],
      I[2] + 2.0 * cosThetaI * N[2],
    );
    return {
      direction: dir,
      isTIR: true,
      kTIR,
      fresnelR: 1.0,
      cosThetaI,
      orientedNormal: N,
    };
  }

  const fresnelR = schlickFresnel(cosThetaI, n1, n2);
  const kSqrt = Math.sqrt(Math.max(0.0, kTIR));
  const scaleN = eta * cosThetaI - kSqrt;
  const dir = safeNormalize3(
    eta * I[0] + scaleN * N[0],
    eta * I[1] + scaleN * N[1],
    eta * I[2] + scaleN * N[2],
  );
  return {
    direction: dir,
    isTIR: false,
    kTIR,
    fresnelR,
    cosThetaI,
    orientedNormal: N,
  };
}

/**
 * Traces a single multi-bounce 3D ray through the active optical bench elements.
 */
export function traceOpticalRay3D(
  origin: Vec3,
  dir: Vec3,
  bandIndex: number,
  gammaD: number,
  elements: readonly OpticalElementState[],
  screenZ: number = 2.25,
): TracedRayResult {
  const k = Math.max(0, Math.min(6, Math.trunc(bandIndex)));
  const lambdaUm = SPECTRAL_LAMBDAS_UM[k];
  let p: Vec3 = [origin[0], origin[1], origin[2]];
  let I: Vec3 = safeNormalize3(dir[0], dir[1], dir[2]);
  let flux = 1.0;
  let insideIdx = -1;
  let hadTIR = false;

  // Detect if ray starts inside an element
  for (let i = 0; i < elements.length; i++) {
    if (sdfElementWorld(p, elements[i]) < -HIT_EPS) {
      insideIdx = i;
      break;
    }
  }

  const vertices: TracedBounceVertex[] = [
    { x: p[0], y: p[1], z: p[2], flux, isTIR: false },
  ];

  const computeBenchExitT = (pos: Vec3, dirVec: Vec3): number => {
    let tExit = 4.5;
    if (dirVec[2] > 0.05) {
      tExit = Math.min(tExit, Math.max(0.0, (3.05 - pos[2]) / dirVec[2]));
    } else if (dirVec[2] < -0.05) {
      tExit = Math.min(tExit, Math.max(0.0, (-3.25 - pos[2]) / dirVec[2]));
    }
    if (Math.abs(dirVec[0]) > 0.05) {
      const targetX = dirVec[0] > 0 ? 2.6 : -2.6;
      tExit = Math.min(tExit, Math.max(0.0, (targetX - pos[0]) / dirVec[0]));
    }
    if (Math.abs(dirVec[1]) > 0.05) {
      const targetY = dirVec[1] > 0 ? 2.2 : -2.2;
      tExit = Math.min(tExit, Math.max(0.0, (targetY - pos[1]) / dirVec[1]));
    }
    return Math.max(0.0, Math.min(4.5, tExit));
  };

  let completedAllBounces = true;

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    let hitIdx = -1;
    let marched = 0.0;

    for (let step = 0; step < MAX_MARCH_STEPS; step++) {
      let minDist = 1e6;
      let nearestIdx = -1;

      if (insideIdx >= 0 && insideIdx < elements.length) {
        minDist = -sdfElementWorld(p, elements[insideIdx]);
        nearestIdx = insideIdx;
      } else {
        for (let i = 0; i < elements.length; i++) {
          const d = sdfElementWorld(p, elements[i]);
          if (d < minDist) {
            minDist = d;
            nearestIdx = i;
          }
        }
      }

      if (minDist < HIT_EPS) {
        hitIdx = nearestIdx;
        break;
      }

      const stepLen = Math.max(minDist * 0.92, 5e-4);
      marched += stepLen;
      p = [p[0] + I[0] * stepLen, p[1] + I[1] * stepLen, p[2] + I[2] * stepLen];

      if (
        marched > 8.5 ||
        Math.abs(p[0]) > 2.8 ||
        Math.abs(p[1]) > 2.2 ||
        p[2] < -3.4 ||
        p[2] > 3.25
      ) {
        break;
      }
    }

    if (hitIdx < 0) {
      // Advance free-space ray to bench exit boundary
      const remT = computeBenchExitT(p, I);
      const endP: Vec3 = [p[0] + I[0] * remT, p[1] + I[1] * remT, p[2] + I[2] * remT];
      vertices.push({ x: endP[0], y: endP[1], z: endP[2], flux, isTIR: false });
      completedAllBounces = false;
      break;
    }

    const elem = elements[hitIdx];
    const rawN = calcElementNormal(p, elem);
    const nGlass = cauchyIndex(elem.glass, lambdaUm, gammaD);
    const n1 = insideIdx >= 0 ? nGlass : 1.0;
    const n2 = insideIdx >= 0 ? 1.0 : nGlass;

    const res = refractOrReflect3D(I, rawN, n1, n2);
    vertices.push({ x: p[0], y: p[1], z: p[2], flux, isTIR: res.isTIR });

    if (res.isTIR) {
      hadTIR = true;
      I = res.direction;
      const nextP: Vec3 = [
        p[0] + 3.0 * HIT_EPS * res.orientedNormal[0],
        p[1] + 3.0 * HIT_EPS * res.orientedNormal[1],
        p[2] + 3.0 * HIT_EPS * res.orientedNormal[2],
      ];
      // Guard against razor-tip apex grazing where inward TIR nudge exits the adjacent face
      if (insideIdx >= 0 && sdfElementWorld(nextP, elem) >= 0.0) {
        insideIdx = -1;
      }
      p = nextP;
    } else {
      flux *= 1.0 - res.fresnelR;
      I = res.direction;
      const nextP: Vec3 = [
        p[0] - 3.0 * HIT_EPS * res.orientedNormal[0],
        p[1] - 3.0 * HIT_EPS * res.orientedNormal[1],
        p[2] - 3.0 * HIT_EPS * res.orientedNormal[2],
      ];
      if (insideIdx >= 0) {
        insideIdx = -1;
      } else {
        // Guard against razor-tip apex grazing where the inward nudge immediately exits the sharp corner
        insideIdx = sdfElementWorld(nextP, elem) < 0.0 ? hitIdx : -1;
      }
      p = nextP;
    }

    if (flux < 0.02) {
      completedAllBounces = false;
      break;
    }
  }

  if (completedAllBounces && insideIdx < 0 && flux > 0.004) {
    const remT = computeBenchExitT(p, I);
    const endP: Vec3 = [p[0] + I[0] * remT, p[1] + I[1] * remT, p[2] + I[2] * remT];
    vertices.push({ x: endP[0], y: endP[1], z: endP[2], flux, isTIR: false });
  }

  let screenHitX: number | null = null;
  let screenHitY: number | null = null;
  let exitedForward = false;

  if (vertices.length >= 2) {
    const a = vertices[vertices.length - 2];
    const b = vertices[vertices.length - 1];
    const dz = b.z - a.z;
    if (dz > 1e-4 && a.z <= screenZ && b.z >= screenZ - 0.5) {
      const t = (screenZ - a.z) / dz;
      screenHitX = a.x + (b.x - a.x) * t;
      screenHitY = a.y + (b.y - a.y) * t;
      exitedForward = Math.abs(screenHitX) < 2.2 && Math.abs(screenHitY) < 1.8;
    }
  }

  return {
    bandIndex: k,
    lambdaUm,
    vertices,
    hadTIR,
    exitedForward,
    screenHitX,
    screenHitY,
  };
}

/**
 * NaN-proof Airy diffraction ring intensity (2 * J1(rho) / rho)^2.
 */
export function airyDiskIntensity(rho: number): number {
  const r = Math.abs(rho);
  const r2 = r * r;
  const nearJinc =
    1.0 -
    r2 *
      (0.125 -
        r2 * (0.0052083333 - r2 * (0.00010850694 - r2 * 0.000001356337)));
  const safeR = Math.max(r, 2.5);
  const farJinc =
    (2.0 / safeR) * Math.sqrt(0.63661977 / safeR) * Math.cos(safeR - 2.35619449);
  const t = Math.max(0.0, Math.min(1.0, (r - 2.6) / 0.6));
  const smooth = t * t * (3.0 - 2.0 * t);
  const jinc = nearJinc * (1.0 - smooth) + farJinc * smooth;
  return jinc * jinc;
}

export function linearToSrgbChannel(c: number): number {
  const clamped = Math.max(0.0, Math.min(1.0, c));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1.0 / 2.4) - 0.055;
}

/**
 * CPU mirror of Mode A Beer-Lambert Archival Lithograph colorimetry.
 */
export function resolveBeerLambertSrgb(
  spectralLin: Vec3,
  exposure: number,
  archInkDensities: [number, number, number, number] = [0, 0, 0, 0],
): Vec3 {
  const xr = Math.max(0.0, spectralLin[0] * exposure);
  const xg = Math.max(0.0, spectralLin[1] * exposure);
  const xb = Math.max(0.0, spectralLin[2] * exposure);

  const sr = xr / (1.0 + 0.55 * xr);
  const sg = xg / (1.0 + 0.55 * xg);
  const sb = xb / (1.0 + 0.55 * xb);

  const poly = Math.min(sr, Math.min(sg, sb));
  const shortWave =
    Math.max(0.0, sb - 0.65 * poly) + 0.3 * Math.max(0.0, sg - Math.max(sr, sb));
  const midWave = 0.85 * Math.max(0.0, sg - 0.7 * poly) + 0.35 * Math.min(sr, sg);
  const longWave = Math.max(0.0, sr - 0.65 * poly);

  const dSoot = 0.95 * Math.pow(poly, 1.15) + archInkDensities[0];
  const dPrussian = 0.88 * shortWave + archInkDensities[1];
  const dOchre = 0.72 * midWave + archInkDensities[2];
  const dCinnabar = 0.92 * longWave + archInkDensities[3];

  const P = ARCHIVAL_LITHO_PALETTE.PAPER_ALABASTER_LIN;
  const sSoot = ARCHIVAL_LITHO_PALETTE.SIGMA_PINE_SOOT;
  const sPrus = ARCHIVAL_LITHO_PALETTE.SIGMA_PRUSSIAN_BLUE;
  const sOchr = ARCHIVAL_LITHO_PALETTE.SIGMA_MINERAL_OCHRE;
  const sCinn = ARCHIVAL_LITHO_PALETTE.SIGMA_CINNABAR;

  const out: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const tau =
      dSoot * sSoot[c] +
      dPrussian * sPrus[c] +
      dOchre * sOchr[c] +
      dCinnabar * sCinn[c];
    out[c] = linearToSrgbChannel(P[c] * Math.exp(-tau));
  }
  return out;
}
