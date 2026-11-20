import { resolveWorkletUrl } from '../shared/pureCodeContract.ts';

export const F0_HZ = 110.0;
export const PARTIAL_RATIOS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0] as const;
export const AUDIO_LAMBDA_UM = [0.420, 0.460, 0.500, 0.545, 0.590, 0.635, 0.680] as const;
const BASE_GAINS = [0.15, 0.17, 0.18, 0.20, 0.16, 0.13, 0.10] as const;
const STEREO_PAN = [-0.66, -0.44, -0.22, 0.00, 0.22, 0.44, 0.66] as const;

const MIN_EXP_GAIN = 0.0001; // -80 dBFS floor (exponentialRampToValueAtTime forbids 0)
const TARGET_MASTER_GAIN = 0.22;

export interface OpticalAudioParams {
  tiltRad: number;
  dispersionBoost: number;
  glassA: number;
  glassB: number;
  bandWeights?: readonly number[];
}

/**
 * Signed Cauchy chromatic phase beating Δf_k [Hz] for partial k ∈ {0..6}:
 * Δf_k = 5.5 * ((n(λ_k) - n(λ_3)) / (n(λ_3) - 1)) * Θ
 */
export function computePartialBeatingHz(k: number, params: OpticalAudioParams): number {
  const idx = Math.max(0, Math.min(6, Math.trunc(k)));
  if (idx === 3) return 0.0;
  const tilt = Math.max(0.0, params.tiltRad);
  if (tilt === 0.0) return 0.0;
  const gammaB = params.dispersionBoost * params.glassB;
  const nRef = params.glassA + gammaB / (AUDIO_LAMBDA_UM[3] * AUDIO_LAMBDA_UM[3]);
  const denom = Math.max(1e-6, nRef - 1.0);
  const nk = params.glassA + gammaB / (AUDIO_LAMBDA_UM[idx] * AUDIO_LAMBDA_UM[idx]);
  return 5.5 * ((nk - nRef) / denom) * tilt;
}

export function computeStereoPartialFrequencies(
  k: number,
  params: OpticalAudioParams,
): { freqL: number; freqR: number; deltaFk: number } {
  const idx = Math.max(0, Math.min(6, Math.trunc(k)));
  const deltaFk = computePartialBeatingHz(idx, params);
  const centerFk = F0_HZ * PARTIAL_RATIOS[idx];
  return {
    freqL: Math.max(20.0, centerFk - 0.5 * deltaFk),
    freqR: Math.max(20.0, centerFk + 0.5 * deltaFk),
    deltaFk,
  };
}

export function computeMaxBeatingHz(params: OpticalAudioParams): number {
  return Math.abs(computePartialBeatingHz(0, params));
}

interface FallbackVoicePair {
  oscL: OscillatorNode;
  oscR: OscillatorNode;
  gainL: GainNode;
  gainR: GainNode;
}

export class PrismAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private fallbackVoices: FallbackVoicePair[] | null = null;
  private unlockPromise: Promise<void> | null = null;
  private muted = false;
  private ready = false;
  private backend: 'none' | 'worklet' | 'fallback' = 'none';
  private latestParams: OpticalAudioParams = {
    tiltRad: 0,
    dispersionBoost: 3.5,
    glassA: 1.6239,
    glassB: 0.00881,
    bandWeights: [1, 1, 1, 1, 1, 1, 1],
  };
  private onStateChange?: () => void;

  constructor(onStateChange?: () => void) {
    this.onStateChange = onStateChange;
  }

  get audioState(): AudioContextState {
    if (!this.ctx || !this.ready) return 'suspended';
    return this.ctx.state;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get audioBackend(): 'none' | 'worklet' | 'fallback' {
    return this.backend;
  }

  get beatingHz(): number {
    return computeMaxBeatingHz(this.latestParams);
  }

  get isUnlockTriggered(): boolean {
    return this.unlockPromise !== null;
  }

  /**
   * STRICT GESTURE GATE: Binds ONLY to `pointerdown` and `keydown` (NEVER `pointermove` or `wheel`).
   */
  installStrictGestureGate(): () => void {
    let unlocked = false;

    const removeGateListeners = () => {
      window.removeEventListener('pointerdown', handleFirstGesture, true);
      window.removeEventListener('keydown', handleFirstGesture, true);
    };

    const handleFirstGesture = (e: Event) => {
      if (unlocked || this.unlockPromise !== null) {
        unlocked = true;
        removeGateListeners();
        return;
      }
      unlocked = true;
      (e as Event & { __causticAudioUnlocked?: boolean }).__causticAudioUnlocked = true;
      removeGateListeners();
      void this.unlock();
    };

    window.addEventListener('pointerdown', handleFirstGesture, true);
    window.addEventListener('keydown', handleFirstGesture, true);

    return removeGateListeners;
  }

  async unlock(): Promise<void> {
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = (async () => {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.setValueAtTime(MIN_EXP_GAIN, ctx.currentTime);
      master.connect(ctx.destination);
      this.masterGain = master;

      try {
        if (!ctx.audioWorklet) throw new Error('AudioWorklet unsupported');
        const workletUrl = resolveWorkletUrl('caustic-prism-processor.js');
        await ctx.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(ctx, 'caustic-prism-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.connect(master);
        this.workletNode = node;
        this.backend = 'worklet';
        this.pushParamsToEngine();
      } catch {
        this.initOscillatorFallback(ctx, master);
        this.backend = 'fallback';
        this.pushParamsToEngine();
      }

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      this.muted = false;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(MIN_EXP_GAIN, now);
      master.gain.exponentialRampToValueAtTime(TARGET_MASTER_GAIN, now + 0.15);

      this.ready = true;
      ctx.onstatechange = () => this.onStateChange?.();
      this.onStateChange?.();
    })();

    return this.unlockPromise;
  }

  toggleMute(): boolean {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') {
      void this.unlock();
      return false;
    }
    this.muted = !this.muted;
    const now = this.ctx.currentTime;
    const curVal = Math.max(MIN_EXP_GAIN, this.masterGain.gain.value);
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(curVal, now);
    this.masterGain.gain.exponentialRampToValueAtTime(
      this.muted ? MIN_EXP_GAIN : TARGET_MASTER_GAIN,
      now + (this.muted ? 0.06 : 0.15),
    );
    this.onStateChange?.();
    return this.muted;
  }

  updateOpticalState(params: OpticalAudioParams): void {
    this.latestParams = params;
    this.pushParamsToEngine();
  }

  private pushParamsToEngine(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'optical-state',
        tiltRad: this.latestParams.tiltRad,
        dispersionBoost: this.latestParams.dispersionBoost,
        glassA: this.latestParams.glassA,
        glassB: this.latestParams.glassB,
        bandWeights: this.latestParams.bandWeights
          ? Array.from(this.latestParams.bandWeights)
          : undefined,
      });
      return;
    }

    if (this.fallbackVoices && this.ctx) {
      const now = this.ctx.currentTime;
      for (let k = 0; k < 7; k++) {
        const { freqL, freqR } = computeStereoPartialFrequencies(k, this.latestParams);
        const w = this.latestParams.bandWeights?.[k] ?? 1.0;
        const amp = BASE_GAINS[k] * w * 0.45;
        const pair = this.fallbackVoices[k];
        pair.oscL.frequency.setTargetAtTime(freqL, now, 0.025);
        pair.oscR.frequency.setTargetAtTime(freqR, now, 0.025);
        pair.gainL.gain.setTargetAtTime(amp, now, 0.025);
        pair.gainR.gain.setTargetAtTime(amp, now, 0.025);
      }
    }
  }

  private initOscillatorFallback(ctx: AudioContext, master: GainNode): void {
    const voices: FallbackVoicePair[] = [];
    for (let k = 0; k < 7; k++) {
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();
      oscL.type = 'sine';
      oscR.type = 'sine';

      const gainL = ctx.createGain();
      const gainR = ctx.createGain();
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      panL.pan.value = Math.max(-1, STEREO_PAN[k] - 0.2);
      panR.pan.value = Math.min(1, STEREO_PAN[k] + 0.2);

      const fBase = F0_HZ * PARTIAL_RATIOS[k];
      oscL.frequency.value = fBase;
      oscR.frequency.value = fBase;
      gainL.gain.value = BASE_GAINS[k] * 0.45;
      gainR.gain.value = BASE_GAINS[k] * 0.45;

      oscL.connect(gainL).connect(panL).connect(master);
      oscR.connect(gainR).connect(panR).connect(master);
      oscL.start();
      oscR.start();

      voices.push({ oscL, oscR, gainL, gainR });
    }
    this.fallbackVoices = voices;
  }
}
