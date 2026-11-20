import './styles/main.css';
import { PrismAudioEngine } from './audio/prismAudioEngine';
import { OpticalBenchRenderer } from './optics/opticalBenchRenderer';
import { computeNetTiltRad } from './optics/picking';
import { buildPresetElements } from './optics/presets';
import type { BenchState } from './optics/types';
import { installArchivalPlateExporter } from './plates/archivalPlateExporter';
import { installDiagnosticsGetter } from './shared/diagnostics';
import { parseBootUrlConfig } from './shared/pureCodeContract';
import { BenchHudController } from './ui/benchHud';

function bootstrap(): void {
  const bootCfg = parseBootUrlConfig(window.location.search);

  // Set DOM datasets before first paint
  document.documentElement.lang = bootCfg.lang;
  document.documentElement.dataset.printMode = bootCfg.printMode ? 'true' : 'false';
  document.documentElement.dataset.viewMode = bootCfg.viewMode;

  const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #stage-canvas element');
  }

  const initialBench: BenchState = {
    preset: bootCfg.preset,
    seed: bootCfg.seed,
    elements: buildPresetElements(bootCfg.preset, bootCfg.seed),
    selectedElementIndex: 0,
    dispersionBoost: 3.5,
    viewMode: bootCfg.viewMode,
    printMode: bootCfg.printMode,
    breathingEnabled: false,
  };

  let hud: BenchHudController | null = null;

  const audio = new PrismAudioEngine(() => {
    hud?.refreshTelemetry();
  });
  audio.installStrictGestureGate();

  const renderer = new OpticalBenchRenderer(canvas, initialBench, () => {
    if (renderer.bench.breathingEnabled && hud) {
      hud.syncAudioOpticalParams();
      hud.refreshTelemetry();
    }
  });

  hud = new BenchHudController(renderer, audio, bootCfg.lang);

  installArchivalPlateExporter(renderer);

  installDiagnosticsGetter(() => {
    const tiltRad = computeNetTiltRad(renderer.bench.elements);
    return {
      appId: 'caustic-collimation',
      lang: hud ? hud.getLocale() : bootCfg.lang,
      seed: bootCfg.seedString,
      preset: renderer.bench.preset,
      printMode: document.documentElement.dataset.printMode === 'true',
      viewMode: renderer.bench.viewMode,
      fboFormat: renderer.caps.fboFormat,
      warmupSteps: renderer.warmupSteps,
      simSteps: renderer.simSteps,
      audioState: audio.audioState,
      glError: renderer.pollGlError(),
      elementCount: renderer.bench.elements.length,
      selectedElementIndex: renderer.bench.selectedElementIndex,
      tiltMagnitudeDeg: Number(((tiltRad * 180.0) / Math.PI).toFixed(4)),
      dispersionBoost: renderer.bench.dispersionBoost,
      beatingHz: Number(audio.beatingHz.toFixed(4)),
      accumFrames: renderer.accumFrames,
      audioMuted: audio.isMuted,
      audioBackend: audio.audioBackend,
    };
  });

  renderer.startLoop();
}

bootstrap();
