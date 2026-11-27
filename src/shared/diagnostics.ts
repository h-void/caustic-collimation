import type { PresetIndex, SupportedLocale, ViewMode } from './benchConfig.ts';

export interface CausticAppDiagnostics {
  readonly appId: 'caustic-collimation';
  readonly lang: SupportedLocale;
  readonly seed: string;
  readonly preset: PresetIndex;
  readonly printMode: boolean;
  readonly viewMode: ViewMode;
  readonly fboFormat: 'RGBA16F' | 'RGBA8';
  readonly warmupSteps: number;
  readonly simSteps: number;
  readonly audioState: AudioContextState;
  readonly glError: number;

  // Optical & acoustic telemetry
  readonly elementCount: number;
  readonly selectedElementIndex: number;
  readonly tiltMagnitudeDeg: number;
  readonly dispersionBoost: number;
  readonly beatingHz: number;
  readonly accumFrames: number;
  readonly audioMuted: boolean;
  readonly audioBackend: 'none' | 'worklet' | 'fallback';
}

declare global {
  interface Window {
    readonly __APP_DIAGNOSTICS__: CausticAppDiagnostics;
    __renderArchivalPlate: (plateId: string, width: number, height: number) => Promise<string>;
  }
}

export function installDiagnosticsGetter(provider: () => CausticAppDiagnostics): void {
  Object.defineProperty(window, '__APP_DIAGNOSTICS__', {
    configurable: true,
    enumerable: true,
    get: provider,
  });
}
