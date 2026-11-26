import './styles/main.css';
import { PrismAudioEngine } from './audio/prismAudioEngine';
import { OpticalBenchRenderer } from './optics/opticalBenchRenderer';
import { computeNetTiltRad } from './optics/picking';
import { buildPresetElements } from './optics/presets';
import type { BenchState } from './optics/types';
import { installArchivalPlateExporter } from './plates/archivalPlateExporter';
import { installDiagnosticsGetter } from './shared/diagnostics';
import { parseBootUrlConfig, type SupportedLocale } from './shared/pureCodeContract';
import { BenchHudController } from './ui/benchHud';

function renderWebglUnavailableFallback(lang: SupportedLocale): void {
  const hud = document.getElementById('hud-container');
  if (hud) hud.style.display = 'none';
  const colophon = document.getElementById('print-colophon');
  if (colophon) colophon.style.display = 'none';
  const exitPrint = document.getElementById('btn-exit-print');
  if (exitPrint) exitPrint.style.display = 'none';

  document.getElementById('webgl-fallback-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'webgl-fallback-overlay';
  overlay.className = 'webgl-status-overlay';
  overlay.setAttribute('role', 'alert');

  const card = document.createElement('div');
  card.className = 'webgl-status-card';

  const img = document.createElement('img');
  img.className = 'webgl-fallback-preview';
  img.src = './og.jpg';
  img.alt = 'CAUSTIC COLLIMATION // 光軸與焦散 — Static optical bench preview';

  const body = document.createElement('div');
  body.className = 'webgl-status-body';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'webgl-status-eyebrow';
  eyebrow.textContent = 'WORK 02 // WEBGL2 REQUIRED · 需要 WEBGL2 繪圖支援';

  const title = document.createElement('h1');
  title.className = 'webgl-status-title';
  title.textContent =
    lang === 'zh-HK'
      ? '光軸與焦散 · 需要 WebGL2 才能即時演算'
      : 'CAUSTIC COLLIMATION · WebGL2 Required';

  const enCopy =
    'This real-time 3D SDF optical bench requires WebGL2 graphics support, which is unavailable or disabled in this browser environment. Enable hardware acceleration or open the bench in a modern WebGL2-capable browser.';
  const zhCopy =
    '此即時三維隱式曲面光學台需要 WebGL2 繪圖支援，但目前瀏覽器或裝置環境未能啟用。請開啟硬體加速，或使用支援 WebGL2 的現代瀏覽器重新載入。';

  const primaryCopy = document.createElement('p');
  primaryCopy.className = 'webgl-status-copy';
  primaryCopy.textContent = lang === 'zh-HK' ? zhCopy : enCopy;

  const secondaryCopy = document.createElement('p');
  secondaryCopy.className = 'webgl-status-copy-secondary';
  secondaryCopy.textContent = lang === 'zh-HK' ? enCopy : zhCopy;

  const actions = document.createElement('div');
  actions.className = 'webgl-status-actions';

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.className = 'webgl-status-btn';
  reloadBtn.textContent = lang === 'zh-HK' ? '重新載入 / Reload' : 'Reload / 重新載入';
  reloadBtn.addEventListener('click', () => window.location.reload());

  const ghLink = document.createElement('a');
  ghLink.className = 'webgl-status-link';
  ghLink.href = 'https://github.com/h-void/caustic-collimation';
  ghLink.target = '_blank';
  ghLink.rel = 'noopener noreferrer';
  ghLink.textContent =
    lang === 'zh-HK' ? 'GitHub 原始碼 / Source ↗︎' : 'GitHub Source / 原始碼 ↗︎';

  actions.append(reloadBtn, ghLink);
  body.append(eyebrow, title, primaryCopy, secondaryCopy, actions);
  card.append(img, body);
  overlay.append(card);
  document.body.append(overlay);
}

function showContextLostOverlay(lang: SupportedLocale, restoreFailed: boolean = false): void {
  let overlay = document.getElementById('webgl-context-lost-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'webgl-context-lost-overlay';
    overlay.className = 'webgl-status-overlay';
    overlay.setAttribute('role', 'alert');

    const card = document.createElement('div');
    card.className = 'webgl-status-card';

    const body = document.createElement('div');
    body.className = 'webgl-status-body';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'webgl-status-eyebrow';
    eyebrow.textContent = 'WEBGL2 CONTEXT INTERRUPTED · 圖形環境中斷';

    const title = document.createElement('h2');
    title.id = 'webgl-context-lost-title';
    title.className = 'webgl-status-title';

    const primaryCopy = document.createElement('p');
    primaryCopy.id = 'webgl-context-lost-primary';
    primaryCopy.className = 'webgl-status-copy';

    const secondaryCopy = document.createElement('p');
    secondaryCopy.id = 'webgl-context-lost-secondary';
    secondaryCopy.className = 'webgl-status-copy-secondary';

    const actions = document.createElement('div');
    actions.className = 'webgl-status-actions';

    const reloadBtn = document.createElement('button');
    reloadBtn.id = 'btn-webgl-reload';
    reloadBtn.type = 'button';
    reloadBtn.className = 'webgl-status-btn';
    reloadBtn.addEventListener('click', () => window.location.reload());

    actions.append(reloadBtn);
    body.append(eyebrow, title, primaryCopy, secondaryCopy, actions);
    card.append(body);
    overlay.append(card);
    document.body.append(overlay);
  }

  const titleEl = document.getElementById('webgl-context-lost-title');
  const primaryEl = document.getElementById('webgl-context-lost-primary');
  const secondaryEl = document.getElementById('webgl-context-lost-secondary');
  const reloadBtn = document.getElementById('btn-webgl-reload');

  const enCopy = restoreFailed
    ? 'The WebGL2 graphics context could not be automatically restored. Reload the page to reinitialize the optical bench.'
    : 'The WebGL2 graphics context was temporarily lost (GPU reset or tab backgrounding). Waiting for automatic recovery, or reload to reset immediately.';
  const zhCopy = restoreFailed
    ? 'WebGL2 圖形環境無法自動恢復，請重新載入頁面以重置光學台。'
    : 'WebGL2 圖形環境暫時中斷（GPU 重置或背景分頁回收）。正在嘗試自動恢復，您亦可立即重新載入。';

  if (titleEl) {
    titleEl.textContent =
      lang === 'zh-HK'
        ? '光學台圖形環境已暫停 · WebGL2 Context Lost'
        : 'WebGL2 Context Lost · 圖形環境暫停';
  }
  if (primaryEl) primaryEl.textContent = lang === 'zh-HK' ? zhCopy : enCopy;
  if (secondaryEl) secondaryEl.textContent = lang === 'zh-HK' ? enCopy : zhCopy;
  if (reloadBtn) {
    reloadBtn.textContent = lang === 'zh-HK' ? '重新載入 / Reload' : 'Reload / 重新載入';
  }
}

function hideContextLostOverlay(): void {
  document.getElementById('webgl-context-lost-overlay')?.remove();
}

function bootstrap(): void {
  const bootCfg = parseBootUrlConfig(window.location.search);

  // Set DOM datasets before first paint
  document.documentElement.lang = bootCfg.lang;
  document.documentElement.dataset.printMode = bootCfg.printMode ? 'true' : 'false';
  document.documentElement.dataset.viewMode = bootCfg.viewMode;

  const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    renderWebglUnavailableFallback(bootCfg.lang);
    return;
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

  let renderer: OpticalBenchRenderer;
  try {
    renderer = new OpticalBenchRenderer(canvas, initialBench, {
      onFrameTick: () => {
        if (renderer.bench.breathingEnabled && hud) {
          hud.syncAudioOpticalParams();
          hud.refreshTelemetry();
        }
      },
      onContextLost: () => {
        showContextLostOverlay(hud ? hud.getLocale() : bootCfg.lang, false);
      },
      onContextRestored: () => {
        hideContextLostOverlay();
        hud?.refreshTelemetry();
      },
      onContextRestoreFailed: () => {
        showContextLostOverlay(hud ? hud.getLocale() : bootCfg.lang, true);
      },
    });
  } catch (err) {
    console.warn('[CausticCollimation] WebGL2 initialization unavailable:', err);
    renderWebglUnavailableFallback(bootCfg.lang);
    return;
  }

  audio.installStrictGestureGate();

  hud = new BenchHudController(renderer, audio, bootCfg.lang, bootCfg.hudPinned);

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
