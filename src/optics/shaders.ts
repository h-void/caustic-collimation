// GLSL ES 3.00 Shaders for Caustic Collimation (WebGL2)
// Mirrors src/optics/sdfMath.ts 1:1 for all 5 3D SDF archetypes, Cauchy dispersion,
// SIMD-safe 3D Snell refraction, Schlick Fresnel, and explicit k_TIR < 0 Total Internal Reflection.
// Uses dynamic GLSL ES 3.00 loop bounds + single-pass 12-bounce Transform Feedback (15x vec4 outputs)
// so ANGLE / SPIR-V shader compilers compile cleanly without megashader loop unrolling.

export const SHARED_SDF_GLSL = /* glsl */ `
uniform int u_elemCount;
uniform vec4 u_elemPose[5];   // (x, z, thetaX, thetaY)
uniform vec4 u_elemTrig[5];   // (cos(thetaX), sin(thetaX), cos(thetaY), sin(thetaY))
uniform ivec2 u_elemMeta[5];  // (archetypeId, glassId)
uniform vec4 u_elemGeomA[5];
uniform vec4 u_elemGeomB[5];

vec3 safeNormalize(vec3 v) {
  return v * inversesqrt(max(dot(v, v), 1e-16));
}

void fetchElement(int idx, out vec4 pose, out vec4 trig, out ivec2 meta, out vec4 gA, out vec4 gB) {
  if (idx <= 0) {
    pose = u_elemPose[0]; trig = u_elemTrig[0]; meta = u_elemMeta[0]; gA = u_elemGeomA[0]; gB = u_elemGeomB[0];
  } else if (idx == 1) {
    pose = u_elemPose[1]; trig = u_elemTrig[1]; meta = u_elemMeta[1]; gA = u_elemGeomA[1]; gB = u_elemGeomB[1];
  } else if (idx == 2) {
    pose = u_elemPose[2]; trig = u_elemTrig[2]; meta = u_elemMeta[2]; gA = u_elemGeomA[2]; gB = u_elemGeomB[2];
  } else if (idx == 3) {
    pose = u_elemPose[3]; trig = u_elemTrig[3]; meta = u_elemMeta[3]; gA = u_elemGeomA[3]; gB = u_elemGeomB[3];
  } else {
    pose = u_elemPose[4]; trig = u_elemTrig[4]; meta = u_elemMeta[4]; gA = u_elemGeomA[4]; gB = u_elemGeomB[4];
  }
}

vec3 worldToLocal(vec3 p, vec4 pose, vec4 trig) {
  vec3 q = vec3(p.x - pose.x, p.y, p.z - pose.y);
  float cx = trig.x, sx = trig.y;
  float cy = trig.z, sy = trig.w;
  vec3 r = vec3(cx * q.x - sx * q.z, q.y, sx * q.x + cx * q.z);
  return vec3(r.x, cy * r.y - sy * r.z, sy * r.y + cy * r.z);
}

vec3 worldToLocalDir(vec3 d, vec4 trig) {
  float cx = trig.x, sx = trig.y;
  float cy = trig.z, sy = trig.w;
  vec3 r = vec3(cx * d.x - sx * d.z, d.y, sx * d.x + cx * d.z);
  return vec3(r.x, cy * r.y - sy * r.z, sy * r.y + cy * r.z);
}

vec3 localToWorldDir(vec3 g, vec4 trig) {
  float cx = trig.x, sx = trig.y;
  float cy = trig.z, sy = trig.w;
  vec3 r = vec3(g.x, cy * g.y + sy * g.z, -sy * g.y + cy * g.z);
  return vec3(cx * r.x + sx * r.z, r.y, -sx * r.x + cx * r.z);
}

float sdfElementLocal(vec3 p, int type, vec4 gA, vec4 gB) {
  if (type == 3) {
    float h = gA.x, hy = gA.y, flipS = gA.w;
    float xs = p.x * flipS;
    float sb = gB.z, cb = gB.w;
    float dTri = max(-xs - h, max(sb * xs - cb * p.z - h, sb * xs + cb * p.z - h));
    float dY   = abs(p.y) - hy;
    return min(max(dTri, dY), 0.0) + length(max(vec2(dTri, dY), 0.0));
  }
  if (type == 4) {
    float R1 = gA.x, R2 = gA.y, th = gA.z, ap = gA.w, hy = gB.x;
    float d1 = length(vec2(p.x, p.z - (R1 - th))) - R1;
    float d2 = length(vec2(p.x, p.z - (th - R2))) - R2;
    return max(max(d1, d2), max(abs(p.x) - ap, abs(p.y) - hy));
  }
  float rxy = length(p.xy);
  if (type == 0) {
    float R1 = gA.x, R2 = gA.y, th = gA.z, ap = gA.w;
    float d1 = length(vec2(rxy, p.z - (R1 - th))) - R1;
    float d2 = length(vec2(rxy, p.z - (th - R2))) - R2;
    return max(max(d1, d2), rxy - ap);
  }
  if (type == 1) {
    float R1 = gA.x, R2 = gA.y, th = gA.z, ap = gA.w;
    float dFront = length(vec2(rxy, p.z - (R1 - th))) - R1;
    float dBack  = -(length(vec2(rxy, p.z - (th + R2))) - R2);
    float rSafe  = min(ap, R2 * 0.96);
    float zCap   = th + R2 - sqrt(max(1e-4, R2 * R2 - rSafe * rSafe)) + 0.015;
    return max(max(dFront, dBack), max(rxy - ap, p.z - zCap));
  }
  float c = gA.x, kappa = gA.y, a4 = gA.z, a6 = gA.w;
  float th = gB.x, ap = gB.y;
  float rc = min(rxy, ap + 0.06);
  float r2 = rc * rc;
  float r4 = r2 * r2;
  float r6 = r4 * r2;
  float sag = (c * r2) / (1.0 + sqrt(max(0.01, 1.0 - (1.0 + kappa) * c * c * r2)))
            + a4 * r4 + a6 * r6;
  float dSlab = 0.72 * max((-th + sag) - p.z, p.z - (th - 0.65 * sag));
  float dRad  = rxy - ap;
  float extZ  = abs(p.z) - (th + 0.16);
  if (dRad > 0.06 || extZ > 0.06) {
    return max(max(dSlab, dRad), length(max(vec2(dRad, extZ), 0.0)) - 0.04);
  }
  return max(dSlab, dRad);
}
`;

/**
 * Single-Pass Warp-Coherent 12-Bounce 3D SDF Optical Ray Tracer (Transform Feedback, 15x vec4 = 60 floats <= 64).
 * - Uses tight precomputed world AABBs + local-space sphere-tracing so free-space and interior rays
 *   march directly in element-local coordinates without redundant world-to-local matrix transforms.
 * - Evaluates 7-band Cauchy dispersion, 3D Snell refraction, Schlick Fresnel, bounce-0 secondary reflection, and explicit k_TIR < 0 TIR.
 */
export const TRACE_RAY_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

${SHARED_SDF_GLSL}

uniform vec4 u_elemBoxMin[5];
uniform vec4 u_elemBoxMax[5];
uniform int u_baseStep;
uniform int u_raysThisStep;
uniform int u_raysPerBand;
uniform int u_maxBounces;
uniform int u_maxMarchSteps;
uniform float u_gammaD;
uniform vec4 u_jitter;          // Rng64 Cranley-Patterson sub-aperture base shift
uniform vec3 u_emitterParams;   // (emitterZ, beamRadiusX, beamRadiusY)
uniform float u_fanSpreadRad;
uniform vec2 u_focalParams;     // (focalPlaneZ, focalSlabHalf)

out vec4 v_p0;
out vec4 v_p1;
out vec4 v_p2;
out vec4 v_p3;
out vec4 v_p4;
out vec4 v_p5;
out vec4 v_p6;
out vec4 v_p7;
out vec4 v_p8;
out vec4 v_p9;
out vec4 v_p10;
out vec4 v_p11;
out vec4 v_p12;
out vec4 v_p13;
out vec4 v_airy;

const float HIT_EPS = 1e-3;
const float LAMBDAS[7] = float[7](0.420, 0.460, 0.500, 0.545, 0.590, 0.635, 0.680);

float cauchyIndex(int glassId, float lambdaUm, float gammaD) {
  float A = (glassId == 1) ? 1.7432 : 1.5046;
  float B = (glassId == 1) ? 0.01342 : 0.00420;
  return A + (gammaD * B) / (lambdaUm * lambdaUm);
}

float schlickFresnel(float cosThetaI, float n1, float n2) {
  float r0 = (n1 - n2) / max(n1 + n2, 1e-4);
  r0 *= r0;
  float m = clamp(1.0 - cosThetaI, 0.0, 1.0);
  float m2 = m * m;
  return clamp(r0 + (1.0 - r0) * m2 * m2 * m, 0.0, 1.0);
}

void fetchElementBox4(int idx, out vec4 bMin, out vec4 bMax) {
  if (idx <= 0) {
    bMin = u_elemBoxMin[0]; bMax = u_elemBoxMax[0];
  } else if (idx == 1) {
    bMin = u_elemBoxMin[1]; bMax = u_elemBoxMax[1];
  } else if (idx == 2) {
    bMin = u_elemBoxMin[2]; bMax = u_elemBoxMax[2];
  } else if (idx == 3) {
    bMin = u_elemBoxMin[3]; bMax = u_elemBoxMax[3];
  } else {
    bMin = u_elemBoxMin[4]; bMax = u_elemBoxMax[4];
  }
}

void storeVertex(
  int idx,
  vec4 val,
  inout vec4 p1, inout vec4 p2, inout vec4 p3,
  inout vec4 p4, inout vec4 p5, inout vec4 p6,
  inout vec4 p7, inout vec4 p8, inout vec4 p9,
  inout vec4 p10, inout vec4 p11, inout vec4 p12,
  inout vec4 p13
) {
  if (idx == 1) p1 = val;
  else if (idx == 2) p2 = val;
  else if (idx == 3) p3 = val;
  else if (idx == 4) p4 = val;
  else if (idx == 5) p5 = val;
  else if (idx == 6) p6 = val;
  else if (idx == 7) p7 = val;
  else if (idx == 8) p8 = val;
  else if (idx == 9) p9 = val;
  else if (idx == 10) p10 = val;
  else if (idx == 11) p11 = val;
  else if (idx == 12) p12 = val;
  else p13 = val;
}

float computeBenchExitT(vec3 pos, vec3 dir) {
  float tExit = 7.5;
  if (dir.z > 0.05) {
    tExit = min(tExit, max(0.0, (3.45 - pos.z) / dir.z));
  } else if (dir.z < -0.05) {
    tExit = min(tExit, max(0.0, (-3.45 - pos.z) / dir.z));
  }
  if (abs(dir.x) > 0.05) {
    float targetX = (dir.x > 0.0) ? 2.85 : -2.85;
    tExit = min(tExit, max(0.0, (targetX - pos.x) / dir.x));
  }
  if (abs(dir.y) > 0.05) {
    float targetY = (dir.y > 0.0) ? 2.40 : -2.40;
    tExit = min(tExit, max(0.0, (targetY - pos.y) / dir.y));
  }
  return clamp(tExit, 0.0, 7.5);
}

void main() {
  int stepInBatch = gl_VertexID / u_raysThisStep;
  int rayId = gl_VertexID - stepInBatch * u_raysThisStep;
  int stepIndex = u_baseStep + stepInBatch;
  vec4 jitter = fract(
    u_jitter + float(stepInBatch) * vec4(0.6180339887, 0.3247179572, 0.2207440846, 0.8191725134)
  );

  int bandIdx = min(6, rayId / u_raysPerBand);
  int rayInBand = rayId - bandIdx * u_raysPerBand;

  int primaryCount = max(4, u_raysPerBand - 12);
  bool secondaryBranch = (rayInBand >= primaryCount);
  int localIdx = secondaryBranch ? (rayInBand - primaryCount) : rayInBand;
  int localTotal = secondaryBranch ? max(1, u_raysPerBand - primaryCount) : primaryCount;
  float flux = float(u_raysPerBand) / float(localTotal);

  float fSeq = float(stepIndex * localTotal + localIdx + 1);
  // Monotonic stratified X within each spectral band ensures 100% 4-wide SIMD warp coherence
  float u1 = (float(localIdx) + jitter.x) / float(localTotal);
  float u2 = fract(fSeq * 0.7548776662 + jitter.y);
  float u3 = fract(fSeq * 0.5698402910 + jitter.z);
  float u4 = fract(fSeq * 0.4301597090 + jitter.w);

  float xNorm = u1 * 2.0 - 1.0;
  float ySheetMix = ((localIdx & 3) == 0) ? 0.08 : 1.0;
  float yNorm = (u2 * 2.0 - 1.0) * ySheetMix;
  float rDisk = length(vec2(xNorm, yNorm));
  if (rDisk > 1.0) {
    xNorm /= rDisk;
    yNorm /= rDisk;
  }

  vec3 p = vec3(
    xNorm * u_emitterParams.y,
    yNorm * u_emitterParams.z,
    u_emitterParams.x
  );
  float angX = (u3 - 0.5) * u_fanSpreadRad + xNorm * 0.012;
  float angY = (u4 - 0.5) * (u_fanSpreadRad * 0.5);
  vec3 I = safeNormalize(vec3(sin(angX), sin(angY), cos(angX) * cos(angY)));

  vec4 p0 = vec4(p, flux);
  vec4 p1 = vec4(p, 0.0);
  vec4 p2 = vec4(p, 0.0);
  vec4 p3 = vec4(p, 0.0);
  vec4 p4 = vec4(p, 0.0);
  vec4 p5 = vec4(p, 0.0);
  vec4 p6 = vec4(p, 0.0);
  vec4 p7 = vec4(p, 0.0);
  vec4 p8 = vec4(p, 0.0);
  vec4 p9 = vec4(p, 0.0);
  vec4 p10 = vec4(p, 0.0);
  vec4 p11 = vec4(p, 0.0);
  vec4 p12 = vec4(p, 0.0);
  vec4 p13 = vec4(p, 0.0);
  vec4 airyOut = vec4(0.0);

  int insideIdx = -1;
  int justExitedIdx = -1;
  float lam = LAMBDAS[bandIdx];
  int tapCount = min(4, u_maxMarchSteps);
  int innerLimit = min(14, u_maxMarchSteps);
  int outerLimit = min(28, u_maxMarchSteps);

  for (int bounce = 0; bounce <= u_maxBounces; bounce++) {
    vec3 segStart = p;

    if (bounce == u_maxBounces) {
      if (insideIdx < 0 && flux > 0.004) {
        float remT = computeBenchExitT(p, I);
        vec3 endP = p + I * remT;
        if (I.z > 0.15) {
          float targetZ = u_focalParams.x + (u4 * 2.0 - 1.0) * u_focalParams.y;
          float tHit = (targetZ - segStart.z) / I.z;
          if (tHit > 0.0 && tHit < 6.5) {
            vec3 hitP = segStart + I * tHit;
            if (abs(hitP.x) < 2.2 && abs(hitP.y) < 1.8) {
              airyOut = vec4(hitP, flux);
            }
          }
        }
        storeVertex(
          bounce + 1,
          vec4(endP, 0.0),
          p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13
        );
      } else {
        storeVertex(
          bounce + 1,
          vec4(p, 0.0),
          p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13
        );
      }
      break;
    }

    int hitIdx = -1;
    float bestHitT = 1e6;
    vec3 bestHitPL = vec3(0.0);
    vec4 hitTrig = vec4(1.0, 0.0, 1.0, 0.0);
    ivec2 hitMeta = ivec2(0);
    vec4 hitGA = vec4(0.0);
    vec4 hitGB = vec4(0.0);

    vec3 invDir = 1.0 / vec3(
      abs(I.x) < 1e-5 ? (I.x < 0.0 ? -1e-5 : 1e-5) : I.x,
      abs(I.y) < 1e-5 ? (I.y < 0.0 ? -1e-5 : 1e-5) : I.y,
      abs(I.z) < 1e-5 ? (I.z < 0.0 ? -1e-5 : 1e-5) : I.z
    );

    int iterCount = (insideIdx >= 0) ? 1 : u_elemCount;
    for (int iter = 0; iter < iterCount; iter++) {
      int elemIdx = (insideIdx >= 0) ? insideIdx : iter;
      float tStart = 0.0;
      float maxLocal = 1.85;
      float sgn = -1.0;
      int stepLimit = innerLimit;

      if (insideIdx < 0) {
        vec4 bMin4; vec4 bMax4;
        fetchElementBox4(elemIdx, bMin4, bMax4);
        if (elemIdx == justExitedIdx && (bMin4.w < 0.5 || (I.z > 0.45 && abs(I.x) < 0.36))) continue;
        vec3 t0s = (bMin4.xyz - p) * invDir;
        vec3 t1s = (bMax4.xyz - p) * invDir;
        vec3 tSm = min(t0s, t1s);
        vec3 tBg = max(t0s, t1s);
        float tn = max(max(tSm.x, tSm.y), max(tSm.z, 0.0));
        float tf = min(tBg.x, min(tBg.y, tBg.z));
        if (tf <= tn || tn >= bestHitT) continue;
        tStart = max(0.0, tn - 0.004);
        maxLocal = min(tf, bestHitT) - tStart + 0.008;
        sgn = 1.0;
        stepLimit = outerLimit;
      }

      vec4 pose; vec4 trig; ivec2 meta; vec4 gA; vec4 gB;
      fetchElement(elemIdx, pose, trig, meta, gA, gB);
      vec3 pL = worldToLocal(p + I * tStart, pose, trig);
      vec3 IL = worldToLocalDir(I, trig);
      float tLocal = 0.0;
      for (int step = 0; step < stepLimit; step++) {
        float d = sgn * sdfElementLocal(pL, meta.x, gA, gB);
        if (d < HIT_EPS) {
          float candT = tStart + tLocal;
          if (candT < bestHitT) {
            bestHitT = candT;
            hitIdx = elemIdx;
            bestHitPL = pL;
            hitTrig = trig;
            hitMeta = meta;
            hitGA = gA;
            hitGB = gB;
          }
          break;
        }
        float stepLen = max(d, 1.5e-3);
        tLocal += stepLen;
        if (tLocal > maxLocal || (sgn > 0.0 && IL.z > 0.25 && pL.z > 0.68)) break;
        pL += IL * stepLen;
      }
    }

    if (hitIdx < 0) {
      float remT = computeBenchExitT(p, I);
      vec3 endP = p + I * remT;
      if (insideIdx < 0 && I.z > 0.15) {
        float targetZ = u_focalParams.x + (u4 * 2.0 - 1.0) * u_focalParams.y;
        float tHit = (targetZ - segStart.z) / I.z;
        if (tHit > 0.0 && tHit < 6.5) {
          vec3 hitP = segStart + I * tHit;
          if (abs(hitP.x) < 2.2 && abs(hitP.y) < 1.8) {
            airyOut = vec4(hitP, flux);
          }
        }
      }
      storeVertex(
        bounce + 1,
        vec4(endP, 0.0),
        p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13
      );
      break;
    }

    p = p + I * bestHitT;
    const float eNorm = 2e-4;
    vec3 gradL = vec3(0.0);
    for (int k = 0; k < tapCount; k++) {
      vec3 dir = vec3(
        (k == 0 || k == 3) ? 1.0 : -1.0,
        (k >= 2) ? 1.0 : -1.0,
        (k == 1 || k == 3) ? 1.0 : -1.0
      );
      gradL += dir * sdfElementLocal(bestHitPL + dir * eNorm, hitMeta.x, hitGA, hitGB);
    }
    vec3 N = safeNormalize(localToWorldDir(gradL, hitTrig));
    if (dot(I, N) > 0.0) N = -N;
    float cosThetaI = clamp(-dot(I, N), 0.0, 1.0);
    float nGlass = cauchyIndex(hitMeta.y, lam, u_gammaD);
    float n1 = (insideIdx >= 0) ? nGlass : 1.0;
    float n2 = (insideIdx >= 0) ? 1.0 : nGlass;
    float eta = n1 / max(n2, 1e-4);
    float k_TIR = 1.0 - eta * eta * (1.0 - cosThetaI * cosThetaI);

    float nextFlux = flux;
    int nextInside = insideIdx;
    vec3 nextPos = p;
    vec3 nextDir = I;

    if (k_TIR < 0.0) {
      // Explicit Total Internal Reflection (flux preserved 100%, insideIdx unchanged)
      nextDir = safeNormalize(I + 2.0 * cosThetaI * N);
      nextPos = p + (3.0 * HIT_EPS) * N;
      justExitedIdx = -1;
    } else if (bounce == 0 && secondaryBranch) {
      // Bounce-1 Secondary Fresnel Reflected Caustic Branch
      float R = schlickFresnel(cosThetaI, n1, n2);
      nextFlux = flux * R * 2.2;
      nextDir = safeNormalize(I + 2.0 * cosThetaI * N);
      nextPos = p + (3.0 * HIT_EPS) * N;
      justExitedIdx = -1;
    } else {
      // Exact 3D Vector Snell Refraction with SIMD-safe sqrt(max(0.0, k_TIR))
      float R = schlickFresnel(cosThetaI, n1, n2);
      nextFlux = flux * (1.0 - R);
      float kSqrt = sqrt(max(0.0, k_TIR));
      nextDir = safeNormalize(eta * I + (eta * cosThetaI - kSqrt) * N);
      nextPos = p - (3.0 * HIT_EPS) * N;
      justExitedIdx = (insideIdx >= 0) ? hitIdx : -1;
      nextInside = (insideIdx >= 0) ? -1 : hitIdx;
    }

    bool keepAlive = (nextFlux > 0.005);
    storeVertex(
      bounce + 1,
      vec4(nextPos, keepAlive ? nextFlux : 0.0),
      p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13
    );
    if (!keepAlive) break;

    p = nextPos;
    I = nextDir;
    flux = nextFlux;
    insideIdx = nextInside;
  }

  v_p0 = p0;
  v_p1 = p1;
  v_p2 = p2;
  v_p3 = p3;
  v_p4 = p4;
  v_p5 = p5;
  v_p6 = p6;
  v_p7 = p7;
  v_p8 = p8;
  v_p9 = p9;
  v_p10 = p10;
  v_p11 = p11;
  v_p12 = p12;
  v_p13 = p13;
  v_airy = airyOut;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export const DUMMY_FS = /* glsl */ `#version 300 es
precision mediump float;
out vec4 outColor;
void main() {
  outColor = vec4(0.0);
}
`;

export const BEAM_SPLAT_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_rayTex;
uniform mat4 u_viewProj;
uniform int u_raysThisStep;
uniform int u_raysPerBand;
uniform int u_activeRaysPerStep;
uniform int u_beamMask;
uniform int u_beamStride;
uniform int u_baseStep;
uniform float u_rayGain;
uniform float u_batchScale;

out vec3 v_radiance;

const vec3 BAND_RGB[7] = vec3[7](
  vec3(0.24, 0.02, 0.72),
  vec3(0.05, 0.22, 0.88),
  vec3(0.00, 0.60, 0.46),
  vec3(0.14, 0.82, 0.10),
  vec3(0.72, 0.45, 0.00),
  vec3(0.88, 0.14, 0.00),
  vec3(0.52, 0.02, 0.00)
);

void main() {
  int stepInBatch = gl_InstanceID / u_activeRaysPerStep;
  int activeIdx = gl_InstanceID - stepInBatch * u_activeRaysPerStep;
  int stepMod = (u_baseStep + stepInBatch) & u_beamMask;
  int rayInStep = activeIdx * u_beamStride + stepMod;
  if (rayInStep >= u_raysThisStep) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_radiance = vec3(0.0);
    return;
  }

  int rayRow = stepInBatch * u_raysThisStep + rayInStep;
  int baseX = (rayRow & 63) * 15;
  int texY = rayRow >> 6;
  int segIdx = gl_VertexID >> 1;
  vec4 seg0 = texelFetch(u_rayTex, ivec2(baseX + segIdx, texY), 0);
  float flux = seg0.w;
  if (flux <= 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_radiance = vec3(0.0);
    return;
  }

  vec4 seg1 = texelFetch(u_rayTex, ivec2(baseX + segIdx + 1, texY), 0);
  vec3 segDelta = seg1.xyz - seg0.xyz;
  if (dot(segDelta, segDelta) < 1e-7) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_radiance = vec3(0.0);
    return;
  }

  vec3 pos = ((gl_VertexID & 1) == 0) ? seg0.xyz : seg1.xyz;
  vec4 clip = u_viewProj * vec4(pos, 1.0);
  if (clip.w <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_radiance = vec3(0.0);
    return;
  }

  gl_Position = clip;
  int bandIdx = min(6, rayInStep / u_raysPerBand);
  float segWeight = (segIdx == 0) ? 0.32 : 1.0;
  v_radiance = BAND_RGB[bandIdx] * (flux * segWeight * u_rayGain * u_batchScale);
}
`;

export const BEAM_SPLAT_FS = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_radiance;
out vec4 outColor;

void main() {
  outColor = vec4(v_radiance, 0.0);
}
`;

export const AIRY_SPLAT_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_rayTex;
uniform mat4 u_viewProj;
uniform int u_raysThisStep;
uniform int u_raysPerBand;
uniform int u_airyPerBand;
uniform int u_airyRaysPerStep;
uniform float u_airyRadiusPx;
uniform float u_airyGain;
uniform float u_batchScale;

out vec3 v_radiance;

const float LAMBDAS[7] = float[7](0.420, 0.460, 0.500, 0.545, 0.590, 0.635, 0.680);
const vec3 BAND_RGB[7] = vec3[7](
  vec3(0.24, 0.02, 0.72),
  vec3(0.05, 0.22, 0.88),
  vec3(0.00, 0.60, 0.46),
  vec3(0.14, 0.82, 0.10),
  vec3(0.72, 0.45, 0.00),
  vec3(0.88, 0.14, 0.00),
  vec3(0.52, 0.02, 0.00)
);

void main() {
  int stepInBatch = gl_VertexID / u_airyRaysPerStep;
  int idxInStep = gl_VertexID - stepInBatch * u_airyRaysPerStep;
  int bandIdx = min(6, idxInStep / u_airyPerBand);
  int subIdx = idxInStep - bandIdx * u_airyPerBand;
  int rayInStep = bandIdx * u_raysPerBand + subIdx * 4;
  int rayRow = stepInBatch * u_raysThisStep + rayInStep;

  vec4 airy = texelFetch(u_rayTex, ivec2((rayRow & 63) * 15 + 14, rayRow >> 6), 0);
  float flux = airy.w * 4.0;
  if (flux <= 0.004 || u_airyGain <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_radiance = vec3(0.0);
    return;
  }

  vec4 c = u_viewProj * vec4(airy.xyz, 1.0);
  if (c.w <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_radiance = vec3(0.0);
    return;
  }

  float waveScale = LAMBDAS[bandIdx] / 0.545;
  float radPx = u_airyRadiusPx * waveScale;

  gl_Position = c;
  gl_PointSize = clamp(radPx * 2.0, 2.0, 48.0);
  v_radiance = BAND_RGB[bandIdx] * (flux * u_airyGain * u_batchScale / (waveScale * waveScale));
}
`;

export const AIRY_SPLAT_FS = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_radiance;
out vec4 outColor;

float airyDiskIntensity(float rho) {
  float r = abs(rho);
  float r2 = r * r;
  float nearJinc = 1.0 - r2 * (0.125 - r2 * (0.0052083333 - r2 * (0.00010850694 - r2 * 0.000001356337)));
  float safeR = max(r, 2.5);
  float farJinc = (2.0 / safeR) * sqrt(0.63661977 / safeR) * cos(safeR - 2.35619449);
  float jinc = mix(nearJinc, farJinc, smoothstep(2.6, 3.2, r));
  return jinc * jinc;
}

void main() {
  vec2 quadUv = gl_PointCoord * 2.0 - 1.0;
  float rNorm = length(quadUv);
  if (rNorm > 1.0) discard;
  float rho = rNorm * 9.2;
  float window = smoothstep(1.0, 0.78, rNorm);
  float airy = airyDiskIntensity(rho);
  float d1 = (rho - 5.1356) * 1.3889;
  float d2 = (rho - 8.4172) * 1.3889;
  float ringBoost = 0.028 * exp(-d1 * d1) + 0.012 * exp(-d2 * d2);
  outColor = vec4(v_radiance * (airy + ringBoost) * window, 0.0);
}
`;

export const FULLSCREEN_QUAD_VS = /* glsl */ `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  vec2 pos = vec2(
    (gl_VertexID == 1) ? 3.0 : -1.0,
    (gl_VertexID == 2) ? 3.0 : -1.0
  );
  v_uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const RGBA8_ACCUM_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_prevAccumTex;
uniform sampler2D u_batchTex;
uniform int u_accumIndex;
uniform int u_batchSteps;
uniform float u_batchScale;

out vec4 outColor;

const float MAX_RADIANCE = 8.0;

void main() {
  vec3 prevSqrt = texture(u_prevAccumTex, v_uv).rgb;
  vec3 prevLin = (u_accumIndex <= u_batchSteps) ? vec3(0.0) : (prevSqrt * prevSqrt * MAX_RADIANCE);
  float bSteps = float(max(1, u_batchSteps));
  vec3 curLin = texture(u_batchTex, v_uv).rgb / max(u_batchScale * bSteps, 1e-4);
  float w = clamp(bSteps / min(float(max(1, u_accumIndex)), 96.0), 0.0, 1.0);
  vec3 nextLin = mix(prevLin, curLin, w);
  vec3 nextSqrt = sqrt(clamp(nextLin / MAX_RADIANCE, 0.0, 1.0));
  outColor = vec4(nextSqrt, 1.0);
}
`;

const RESOLVE_COMMON_GLSL = /* glsl */ `
const float MAX_RADIANCE = 8.0;
const vec3 PAPER_ALABASTER_LIN = vec3(0.921582, 0.904661, 0.863157);
const vec3 SIGMA_PINE_SOOT     = vec3(4.88084, 4.72522, 4.48629);
const vec3 SIGMA_PRUSSIAN_BLUE = vec3(4.43183, 3.02941, 2.02059);
const vec3 SIGMA_MINERAL_OCHRE = vec3(0.99153, 1.81694, 3.57600);
const vec3 SIGMA_CINNABAR      = vec3(0.46724, 2.93279, 3.57600);

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 q = sqrt(sqrt(c));
  vec3 hi = -0.066822 + q * (0.212098 + q * (1.082494 + q * (-0.293166 + q * 0.065415)));
  return mix(lo, hi, step(vec3(0.0031308), c));
}

float interleavedGradientNoise(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

vec3 resolveArchivalLithograph(
  vec3 spectralLin,
  float exposure,
  vec4 archInkDensities,
  vec2 fragCoord
) {
  vec3 x = max(vec3(0.0), spectralLin * exposure);
  vec3 s = x / (1.0 + 0.55 * x);

  float poly = min(s.r, min(s.g, s.b));
  float shortWave = max(0.0, s.b - 0.65 * poly) + 0.30 * max(0.0, s.g - max(s.r, s.b));
  float midWave   = 0.85 * max(0.0, s.g - 0.70 * poly) + 0.35 * min(s.r, s.g);
  float longWave  = max(0.0, s.r - 0.65 * poly);

  float polyRoot = sqrt(sqrt(sqrt(max(poly, 0.0))));
  float dSoot     = 0.95 * (poly * polyRoot) + archInkDensities.x;
  float dPrussian = 0.88 * shortWave       + archInkDensities.y;
  float dOchre    = 0.72 * midWave         + archInkDensities.z;
  float dCinnabar = 0.92 * longWave        + archInkDensities.w;

  vec3 tau = dSoot * SIGMA_PINE_SOOT
           + dPrussian * SIGMA_PRUSSIAN_BLUE
           + dOchre * SIGMA_MINERAL_OCHRE
           + dCinnabar * SIGMA_CINNABAR;

  float grain = 1.0 + 0.008 * (interleavedGradientNoise(fragCoord * 0.73) - 0.5);
  vec3 outLin = (PAPER_ALABASTER_LIN * grain) * exp(-tau);
  vec3 outSrgb = linearToSrgb(outLin);
  float dither = (interleavedGradientNoise(fragCoord) - 0.5) / 255.0;
  return clamp(outSrgb + dither, 0.0, 1.0);
}

vec3 resolveDarkChamber(
  vec3 spectralLin,
  float exposure,
  vec3 glassRimFresnelLin,
  float reticleMask,
  vec2 uvNorm,
  vec2 fragCoord
) {
  vec3 bgDarkLin = mix(
    vec3(0.0092, 0.0150, 0.0260),
    vec3(0.0046, 0.0070, 0.0118),
    clamp(0.45 * dot(uvNorm, uvNorm), 0.0, 1.0)
  );
  bgDarkLin += reticleMask * vec3(0.0055, 0.0090, 0.0155);

  vec3 L = max(vec3(0.0), spectralLin * exposure) + glassRimFresnelLin;
  float peak = max(L.r, max(L.g, L.b));
  const float L_WHITE2 = 10.24;
  float mappedPeak = (peak * (1.0 + peak / L_WHITE2)) / (1.0 + peak);
  vec3 chromaPreserved = L * (mappedPeak / max(peak, 1e-6));
  vec3 coreIvory = vec3(mappedPeak) * vec3(0.99, 0.98, 0.95);
  vec3 litLin = bgDarkLin + mix(chromaPreserved, coreIvory, 0.34 * smoothstep(1.30, 4.8, peak));

  vec3 srgb = min(vec3(0.972), linearToSrgb(litLin));
  float dither = (interleavedGradientNoise(fragCoord) - 0.5) * (1.5 / 255.0);
  return clamp(srgb + dither, 12.0 / 255.0, 249.0 / 255.0);
}
`;

export const RESOLVE_SCHEMATIC_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

${SHARED_SDF_GLSL}

in vec2 v_uv;
uniform sampler2D u_accumTex;
uniform int u_isRgba8;
uniform int u_accumFrames;
uniform int u_printMode;
uniform int u_showHudHandles;
uniform int u_selectedElemIdx;
uniform float u_exposure;
uniform float u_rimScale;
uniform vec2 u_viewportSize;
uniform float u_aspect;
uniform vec3 u_orthoParams;
uniform vec2 u_benchGuides;

out vec4 outColor;

${RESOLVE_COMMON_GLSL}

float sdSegment2D(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

vec4 evalSchematicArchInks(vec2 xz, float worldPerPx) {
  float dSoot = 0.0;
  float dPrus = 0.0;
  float dOchr = 0.0;
  float dCinn = 0.0;

  float x = xz.x;
  float z = xz.y;

  vec2 gridDist = abs(fract(xz / 0.40 + 0.5) - 0.5) * 0.40;
  float gLine = min(gridDist.x, gridDist.y);
  dSoot += 0.048 * smoothstep(worldPerPx * 1.1, 0.0, gLine);

  float axisDist = abs(x);
  float cycle = mod(z + 10.0, 0.24);
  float dashMask = (cycle < 0.13 || (cycle > 0.175 && cycle < 0.198)) ? 1.0 : 0.0;
  dSoot += 0.28 * dashMask * smoothstep(worldPerPx * 1.35, worldPerPx * 0.25, axisDist);

  float emitZ = u_benchGuides.x;
  float emitBar = sdSegment2D(vec2(x, z), vec2(-0.42, emitZ), vec2(0.42, emitZ));
  dSoot += 0.72 * smoothstep(worldPerPx * 1.8, worldPerPx * 0.4, emitBar);

  float focZ = u_benchGuides.y;
  float focBar = sdSegment2D(vec2(x, z), vec2(-0.92, focZ), vec2(0.92, focZ));
  dSoot += 0.44 * smoothstep(worldPerPx * 1.4, worldPerPx * 0.3, focBar);
  if (abs(x) < 0.92 && abs(z - focZ) < 0.035) {
    float tickDist = abs(fract(x / 0.15 + 0.5) - 0.5) * 0.15;
    float tickSeg = max(tickDist, abs(z - focZ) - 0.022);
    dSoot += 0.42 * smoothstep(worldPerPx * 1.3, worldPerPx * 0.2, tickSeg);
  }
  float plusH = sdSegment2D(vec2(x, z), vec2(0.0, focZ - 0.055), vec2(0.0, focZ + 0.055));
  float plusV = sdSegment2D(vec2(x, z), vec2(-0.055, focZ), vec2(0.055, focZ));
  dCinn += 0.55 * smoothstep(worldPerPx * 1.5, worldPerPx * 0.3, min(plusH, plusV));

  vec3 p3 = vec3(x, 0.0, z);
  for (int i = 0; i < u_elemCount; i++) {
    vec4 pose; vec4 trig; ivec2 meta; vec4 gA; vec4 gB;
    fetchElement(i, pose, trig, meta, gA, gB);
    vec2 center = vec2(pose.x, pose.y);
    vec2 d2c = vec2(x, z) - center;

    if (dot(d2c, d2c) < 0.92) {
      float d = sdfElementLocal(worldToLocal(p3, pose, trig), meta.x, gA, gB);
      float contour = smoothstep(worldPerPx * 1.85, worldPerPx * 0.45, abs(d));
      dSoot += 0.92 * contour;

      if (d < 0.0) {
        float interiorFade = smoothstep(0.0, worldPerPx * 1.5, -d);
        if (meta.y == 0) {
          float phase = abs(fract((x + z) / (worldPerPx * 8.5)) - 0.5) * (worldPerPx * 8.5);
          float hatch = smoothstep(worldPerPx * 1.25, worldPerPx * 0.25, phase);
          dPrus += interiorFade * (0.068 + 0.165 * hatch);
        } else {
          float phase = abs(fract((x - z) / (worldPerPx * 7.0)) - 0.5) * (worldPerPx * 7.0);
          float hatch = smoothstep(worldPerPx * 1.30, worldPerPx * 0.25, phase);
          dOchr += interiorFade * (0.080 + 0.185 * hatch);
        }
      }

      vec2 localZDir = vec2(-trig.y, trig.x);
      vec2 localXDir = vec2(trig.x, trig.y);
      float tick1 = sdSegment2D(vec2(x, z), center - localZDir * 0.22, center + localZDir * 0.22);
      float tick2 = sdSegment2D(vec2(x, z), center - localXDir * 0.08, center + localXDir * 0.08);
      dSoot += 0.26 * smoothstep(worldPerPx * 1.2, worldPerPx * 0.2, min(tick1, tick2));
    }

    if (u_showHudHandles == 1 && i == u_selectedElemIdx) {
      float ap = max(0.45, gA.w);
      if (meta.x == 2) ap = gB.y;
      if (meta.x == 3) ap = 0.48;
      float ringR = ap + 0.15;
      float ringDist = abs(length(d2c) - ringR);
      dCinn += 0.55 * smoothstep(worldPerPx * 1.6, worldPerPx * 0.3, ringDist);
    }
  }

  return vec4(dSoot, dPrus, dOchr, dCinn);
}

void main() {
  vec3 rawTex = texture(u_accumTex, v_uv).rgb;
  vec3 spectralLin = (u_isRgba8 == 1)
    ? (rawTex * rawTex * MAX_RADIANCE)
    : (rawTex / float(max(1, u_accumFrames)));

  vec2 uvNorm = v_uv * 2.0 - 1.0;
  float halfZ = u_orthoParams.x;
  float halfX = halfZ / max(0.25, u_aspect);
  float z = u_orthoParams.y + uvNorm.x * halfZ;
  float x = u_orthoParams.z + uvNorm.y * halfX;
  float worldPerPx = (2.0 * halfZ) / max(1.0, u_viewportSize.x);
  vec4 archInks = evalSchematicArchInks(vec2(x, z), worldPerPx * u_rimScale);

  if (u_printMode == 1) {
    vec3 col = resolveArchivalLithograph(spectralLin, u_exposure, archInks, gl_FragCoord.xy);
    outColor = vec4(col, 1.0);
    return;
  }

  vec3 rimLin = archInks.x * vec3(0.18, 0.24, 0.34)
              + archInks.y * vec3(0.05, 0.18, 0.36)
              + archInks.z * vec3(0.32, 0.20, 0.05)
              + archInks.w * vec3(0.42, 0.12, 0.08);
  vec3 col = resolveDarkChamber(spectralLin, u_exposure, rimLin, archInks.x * 0.5, uvNorm, gl_FragCoord.xy);
  outColor = vec4(col, 1.0);
}
`;

export const RESOLVE_BENCH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

${SHARED_SDF_GLSL}

in vec2 v_uv;
uniform sampler2D u_accumTex;
uniform int u_isRgba8;
uniform int u_accumFrames;
uniform int u_printMode;
uniform int u_showHudHandles;
uniform int u_selectedElemIdx;
uniform float u_exposure;
uniform float u_rimScale;
uniform vec2 u_viewportSize;

uniform vec3 u_camEye;
uniform vec3 u_camFwd;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform float u_tanHalfFov;
uniform float u_aspect;
uniform vec2 u_benchGuides;

out vec4 outColor;

${RESOLVE_COMMON_GLSL}

void main() {
  vec3 rawTex = texture(u_accumTex, v_uv).rgb;
  vec3 spectralLin = (u_isRgba8 == 1)
    ? (rawTex * rawTex * MAX_RADIANCE)
    : (rawTex / float(max(1, u_accumFrames)));

  vec2 uvNorm = v_uv * 2.0 - 1.0;
  vec3 rayDir = safeNormalize(
    u_camFwd
    + u_camRight * (uvNorm.x * u_aspect * u_tanHalfFov)
    + u_camUp * (uvNorm.y * u_tanHalfFov)
  );

  float reticleMask = 0.0;
  vec3 glassRimLin = vec3(0.0);
  if (abs(rayDir.y) > 1e-4) {
    float tPlane = -u_camEye.y / rayDir.y;
    if (tPlane > 0.0 && tPlane < 60.0) {
      vec3 hitP = u_camEye + rayDir * tPlane;
      vec2 xz = vec2(hitP.x, hitP.z);
      float worldPerPx = (tPlane * 2.0 * u_tanHalfFov) / max(1.0, u_viewportSize.y);
      if (abs(xz.x) < 1.75 && abs(xz.y) < 3.15) {
        vec2 gDist = abs(fract(xz / 0.40 + 0.5) - 0.5) * 0.40;
        reticleMask += 0.55 * smoothstep(worldPerPx * 1.4, 0.0, min(gDist.x, gDist.y));
        float cycle = mod(xz.y + 10.0, 0.24);
        float dash = (cycle < 0.13 || (cycle > 0.175 && cycle < 0.198)) ? 1.0 : 0.0;
        reticleMask += 1.45 * dash * smoothstep(worldPerPx * 1.6, worldPerPx * 0.2, abs(xz.x));

        float focLine = abs(xz.y - u_benchGuides.y);
        reticleMask += 1.2 * smoothstep(worldPerPx * 1.6, 0.0, focLine);

        if (u_showHudHandles == 1 && u_selectedElemIdx >= 0 && u_selectedElemIdx < u_elemCount) {
          vec4 selPose; vec4 selTrig; ivec2 selMeta; vec4 selGA; vec4 selGB;
          fetchElement(u_selectedElemIdx, selPose, selTrig, selMeta, selGA, selGB);
          float ap = max(0.45, selGA.w);
          if (selMeta.x == 2) ap = selGB.y;
          if (selMeta.x == 3) ap = 0.48;
          float ringR = ap + 0.15;
          float dRing = abs(length(xz - vec2(selPose.x, selPose.y)) - ringR);
          float ringAlpha = smoothstep(worldPerPx * 1.8, worldPerPx * 0.3, dRing);
          glassRimLin += ringAlpha * vec3(0.28, 0.18, 0.07);
        }
      }
    }
  }

  vec3 keyLight = safeNormalize(vec3(-0.45, 0.82, -0.35));
  vec3 halfVec = safeNormalize(keyLight - rayDir);

  for (int i = 0; i < u_elemCount; i++) {
    vec4 pose; vec4 trig; ivec2 meta; vec4 gA; vec4 gB;
    fetchElement(i, pose, trig, meta, gA, gB);
    vec3 oc = vec3(pose.x - u_camEye.x, -u_camEye.y, pose.y - u_camEye.z);
    float b = dot(oc, rayDir);
    float rSq = (meta.x >= 3) ? 0.54 : 0.42;
    float h2 = rSq - (dot(oc, oc) - b * b);
    if (h2 > 0.0 && b > 0.2) {
      vec3 samplePos = u_camEye + rayDir * (b - 0.08);
      vec3 pL = worldToLocal(samplePos, pose, trig);
      float d = sdfElementLocal(pL, meta.x, gA, gB);
      int glassId = meta.y;

      if (d < 0.0) {
        vec3 nLocal = safeNormalize(vec3(pL.x * 1.45, pL.y * 1.45 + 0.55, (pL.z - 0.08) * 2.4));
        vec3 N = safeNormalize(localToWorldDir(nLocal, trig));
        float ndv = clamp(-dot(rayDir, N), 0.0, 1.0);
        float edgeRim = smoothstep(-0.11, -0.002, d);
        float om = 1.0 - ndv;
        float om2 = om * om;
        float fresnel = clamp((om2 * om * 0.85 + om2 * 0.15) * 0.65 + edgeRim * 0.75, 0.0, 1.2);
        float nh = max(dot(N, halfVec), 0.0);
        float nh2 = nh * nh;
        float nh4 = nh2 * nh2;
        float nh8 = nh4 * nh4;
        float nh16 = nh8 * nh8;
        float spec = nh16 * nh16 * nh2 + 0.35 * edgeRim;

        vec3 tint = (glassId == 1)
          ? vec3(0.20, 0.13, 0.055)
          : vec3(0.065, 0.155, 0.24);
        vec3 rimTint = (glassId == 1)
          ? vec3(0.75, 0.55, 0.28)
          : vec3(0.38, 0.65, 0.92);

        glassRimLin += (tint * 0.28 + rimTint * (0.14 + 0.68 * fresnel) + vec3(0.75, 0.82, 0.95) * spec * 0.48) * u_rimScale;
      } else if (d < 0.015 * u_rimScale) {
        vec3 edgeTint = (glassId == 1) ? vec3(0.55, 0.40, 0.20) : vec3(0.28, 0.50, 0.72);
        float halo = smoothstep(0.015 * u_rimScale, 0.0, d);
        glassRimLin += edgeTint * halo * 0.38;
      }
    }
  }

  if (u_printMode == 1) {
    float rimDensity = length(glassRimLin) * 0.65;
    vec4 arch3d = vec4(reticleMask * 0.08 + rimDensity * 0.55, rimDensity * 0.2, 0.0, 0.0);
    vec3 col = resolveArchivalLithograph(spectralLin, u_exposure, arch3d, gl_FragCoord.xy);
    outColor = vec4(col, 1.0);
    return;
  }

  vec3 col = resolveDarkChamber(spectralLin, u_exposure, glassRimLin, reticleMask, uvNorm, gl_FragCoord.xy);
  outColor = vec4(col, 1.0);
}
`;

export const DISCRETE_RAY_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec4 a_seg0;
layout(location = 1) in vec4 a_seg1;
layout(location = 2) in vec4 a_color;

uniform mat4 u_viewProj;
uniform vec2 u_viewportSize;

out float v_side;
out vec4 v_color;

void main() {
  vec4 c0 = u_viewProj * vec4(a_seg0.xyz, 1.0);
  vec4 c1 = u_viewProj * vec4(a_seg1.xyz, 1.0);
  if (c0.w <= 0.05 || c1.w <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_side = 0.0;
    v_color = vec4(0.0);
    return;
  }

  vec2 px0 = (c0.xy / c0.w) * 0.5 * u_viewportSize;
  vec2 px1 = (c1.xy / c1.w) * 0.5 * u_viewportSize;
  vec2 dPx = px1 - px0;
  float lenPx = length(dPx);
  vec2 dirPx = (lenPx > 1e-3) ? (dPx / lenPx) : vec2(1.0, 0.0);
  vec2 normPx = vec2(-dirPx.y, dirPx.x);

  float along = float(gl_VertexID >> 1);
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float hw = max(0.75, a_seg0.w);

  vec4 baseClip = mix(c0, c1, along);
  vec2 offsetNdc = (normPx * side * hw) * (2.0 / max(u_viewportSize, vec2(1.0)));
  gl_Position = vec4(baseClip.xy + offsetNdc * baseClip.w, baseClip.z, baseClip.w);
  v_side = side;
  v_color = a_color;
}
`;

export const DISCRETE_RAY_FS = /* glsl */ `#version 300 es
precision highp float;

in float v_side;
in vec4 v_color;
out vec4 outColor;

void main() {
  float aa = smoothstep(1.0, 0.38, abs(v_side));
  outColor = vec4(v_color.rgb, v_color.a * aa);
}
`;
