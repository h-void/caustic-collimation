// public/worklets/caustic-prism-processor.js
// 7-Partial Stereo Additive Overtone Prism driven by 3D Optical Tilt Θ & Cauchy Dispersion n(λ)

const F0_HZ = 110.0;
const PARTIAL_RATIOS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
const LAMBDA_UM = [0.420, 0.460, 0.500, 0.545, 0.590, 0.635, 0.680];
const BASE_GAINS = [0.15, 0.17, 0.18, 0.20, 0.16, 0.13, 0.10];
const STEREO_PAN = [-0.66, -0.44, -0.22, 0.00, 0.22, 0.44, 0.66];
const CROSS_FEED = 0.38;
const TWO_PI = Math.PI * 2.0;

class CausticPrismProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phasesL = new Float64Array(7);
    this.phasesR = new Float64Array(7);
    this.curFreqL = new Float64Array(7);
    this.curFreqR = new Float64Array(7);
    this.tgtFreqL = new Float64Array(7);
    this.tgtFreqR = new Float64Array(7);
    this.curAmp = new Float64Array(7);
    this.tgtAmp = new Float64Array(7);
    this.bandWeights = new Float64Array([1, 1, 1, 1, 1, 1, 1]);

    this.glassA = 1.6239;
    this.glassB = 0.00881;
    this.dispersionBoost = 3.5;
    this.tiltRad = 0.0;

    this._recomputeTargets(true);

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'optical-state') {
        if (typeof msg.tiltRad === 'number' && Number.isFinite(msg.tiltRad)) {
          this.tiltRad = Math.max(0.0, Math.min(3.5, msg.tiltRad));
        }
        if (typeof msg.dispersionBoost === 'number' && Number.isFinite(msg.dispersionBoost)) {
          this.dispersionBoost = Math.max(1.0, Math.min(6.0, msg.dispersionBoost));
        }
        if (typeof msg.glassA === 'number' && Number.isFinite(msg.glassA)) {
          this.glassA = Math.max(1.1, Math.min(2.5, msg.glassA));
        }
        if (typeof msg.glassB === 'number' && Number.isFinite(msg.glassB)) {
          this.glassB = Math.max(0.001, Math.min(0.05, msg.glassB));
        }
        if (Array.isArray(msg.bandWeights) && msg.bandWeights.length === 7) {
          for (let k = 0; k < 7; k++) {
            const w = Number(msg.bandWeights[k]);
            if (Number.isFinite(w)) {
              this.bandWeights[k] = Math.max(0.25, Math.min(1.6, w));
            }
          }
        }
        this._recomputeTargets(false);
      }
    };
  }

  _recomputeTargets(initializeImmediate) {
    const gammaB = this.dispersionBoost * this.glassB;
    const nRef = this.glassA + gammaB / (LAMBDA_UM[3] * LAMBDA_UM[3]);
    const denom = Math.max(1e-6, nRef - 1.0);

    for (let k = 0; k < 7; k++) {
      const nk = this.glassA + gammaB / (LAMBDA_UM[k] * LAMBDA_UM[k]);
      const deltaFk = 5.5 * ((nk - nRef) / denom) * this.tiltRad;
      const centerFk = F0_HZ * PARTIAL_RATIOS[k];

      this.tgtFreqL[k] = Math.max(20.0, centerFk - 0.5 * deltaFk);
      this.tgtFreqR[k] = Math.max(20.0, centerFk + 0.5 * deltaFk);
      this.tgtAmp[k] = BASE_GAINS[k] * this.bandWeights[k];

      if (initializeImmediate) {
        this.curFreqL[k] = this.tgtFreqL[k];
        this.curFreqR[k] = this.tgtFreqR[k];
        this.curAmp[k] = this.tgtAmp[k];
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;
    const invSr = 1.0 / sampleRate;
    const smoothAlpha = 1.0 - Math.exp(-1.0 / (0.025 * sampleRate));

    for (let i = 0; i < blockSize; i++) {
      let accL = 0.0;
      let accR = 0.0;

      for (let k = 0; k < 7; k++) {
        this.curFreqL[k] += (this.tgtFreqL[k] - this.curFreqL[k]) * smoothAlpha;
        this.curFreqR[k] += (this.tgtFreqR[k] - this.curFreqR[k]) * smoothAlpha;
        this.curAmp[k] += (this.tgtAmp[k] - this.curAmp[k]) * smoothAlpha;

        let pL = this.phasesL[k] + TWO_PI * this.curFreqL[k] * invSr;
        let pR = this.phasesR[k] + TWO_PI * this.curFreqR[k] * invSr;
        if (pL >= TWO_PI) pL -= TWO_PI;
        if (pR >= TWO_PI) pR -= TWO_PI;
        this.phasesL[k] = pL;
        this.phasesR[k] = pR;

        const oscMinus = Math.sin(pL);
        const oscPlus = Math.sin(pR);

        const panAngle = (STEREO_PAN[k] + 1.0) * (Math.PI * 0.25);
        const wL = Math.cos(panAngle) * this.curAmp[k];
        const wR = Math.sin(panAngle) * this.curAmp[k];

        accL += wL * oscMinus + CROSS_FEED * wR * oscPlus;
        accR += wR * oscPlus + CROSS_FEED * wL * oscMinus;
      }

      outL[i] = Math.tanh(accL * 0.72) * 0.90;
      if (outR !== outL) {
        outR[i] = Math.tanh(accR * 0.72) * 0.90;
      }
    }

    return true;
  }
}

registerProcessor('caustic-prism-processor', CausticPrismProcessor);
