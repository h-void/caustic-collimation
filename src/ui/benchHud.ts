import type { PrismAudioEngine } from '../audio/prismAudioEngine';
import type { OpticalBenchRenderer } from '../optics/opticalBenchRenderer';
import {
  BENCH_BOUNDS,
  computeEffectiveGlassConstants,
  computeNetTiltRad,
  hitTestBench,
  MAX_TILT_RAD,
  screenToBenchXZ,
  type DragInteractionMode,
} from '../optics/picking';
import { LOCALES } from '../shared/i18n';
import type { PresetIndex, SupportedLocale } from '../shared/pureCodeContract';

interface ActiveDragSession {
  pointerId: number;
  mode: DragInteractionMode;
  elementIndex: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldZ: number;
  origX: number;
  origZ: number;
  origThetaX: number;
  origThetaY: number;
}

export class BenchHudController {
  private readonly renderer: OpticalBenchRenderer;
  private readonly audio: PrismAudioEngine;
  private lang: SupportedLocale;
  private dragSession: ActiveDragSession | null = null;
  private touchTiltMode = false;

  constructor(
    renderer: OpticalBenchRenderer,
    audio: PrismAudioEngine,
    initialLang: SupportedLocale,
  ) {
    this.renderer = renderer;
    this.audio = audio;
    this.lang = initialLang;

    this.bindControls();
    this.bindCanvasPointers();
    this.bindKeyboardShortcuts();
    this.syncAudioOpticalParams();
    this.renderLocaleStrings();
    this.refreshTelemetry();
  }

  public getLocale(): SupportedLocale {
    return this.lang;
  }

  public setLocale(next: SupportedLocale): void {
    this.lang = next;
    document.documentElement.lang = next;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('lang') !== next) {
        url.searchParams.set('lang', next);
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      // Ignore history API restrictions
    }
    this.renderLocaleStrings();
    this.refreshTelemetry();
  }

  public syncAudioOpticalParams(): void {
    const elems = this.renderer.bench.elements;
    const tiltRad = computeNetTiltRad(elems);
    const { glassA, glassB } = computeEffectiveGlassConstants(elems);
    this.audio.updateOpticalState({
      tiltRad,
      dispersionBoost: this.renderer.bench.dispersionBoost,
      glassA,
      glassB,
    });
  }

  public refreshTelemetry(): void {
    const msg = LOCALES[this.lang];
    const bench = this.renderer.bench;
    const elems = bench.elements;
    const tiltDeg = (computeNetTiltRad(elems) * 180.0) / Math.PI;
    const beatHz = this.audio.beatingHz;

    const elTilt = document.getElementById('val-tilt-deg');
    if (elTilt) elTilt.textContent = `${tiltDeg.toFixed(1)}°`;

    const elBeat = document.getElementById('val-beat-hz');
    if (elBeat) elBeat.textContent = `${beatHz.toFixed(2)} Hz`;

    const elDispVal = document.getElementById('val-dispersion');
    if (elDispVal) elDispVal.textContent = `${bench.dispersionBoost.toFixed(1)}×`;

    const slider = document.getElementById('slider-dispersion') as HTMLInputElement | null;
    if (slider && Math.abs(Number(slider.value) - bench.dispersionBoost) > 0.04) {
      slider.value = bench.dispersionBoost.toFixed(1);
    }

    const selIdx = Math.max(0, Math.min(elems.length - 1, bench.selectedElementIndex));
    const selElem = elems[selIdx];
    const elSelected = document.getElementById('val-selected-elem');
    if (elSelected && selElem) {
      const archName = msg.archetypeNames[selElem.archetype];
      const glassName = msg.glassNames[selElem.glass];
      const txDeg = ((selElem.thetaX * 180.0) / Math.PI).toFixed(1);
      elSelected.textContent = `#${selIdx + 1} ${archName} (${glassName}, θx=${txDeg}°)`;
    }

    for (let p = 1; p <= 5; p++) {
      const btn = document.getElementById(`preset-pill-${p}`);
      if (btn) {
        btn.classList.toggle('is-active', bench.preset === p);
        btn.setAttribute('aria-pressed', bench.preset === p ? 'true' : 'false');
      }
    }

    const btnView = document.getElementById('btn-view-mode');
    if (btnView) {
      btnView.textContent =
        bench.viewMode === 'bench' ? msg.viewBench3D : msg.viewSchematic2D;
    }

    const btnDrift = document.getElementById('btn-breathing');
    if (btnDrift) {
      btnDrift.textContent = bench.breathingEnabled ? msg.driftGentle : msg.driftOff;
      btnDrift.classList.toggle('is-active', bench.breathingEnabled);
    }

    const btnDragMode = document.getElementById('btn-drag-mode');
    if (btnDragMode) {
      btnDragMode.textContent = this.touchTiltMode ? msg.dragTilt : msg.dragMove;
      btnDragMode.classList.toggle('is-active', this.touchTiltMode);
      btnDragMode.setAttribute('aria-pressed', this.touchTiltMode ? 'true' : 'false');
    }

    const btnPrint = document.getElementById('btn-print-mode');
    if (btnPrint) {
      btnPrint.classList.toggle('is-active', bench.printMode);
    }

    const audioPill = document.getElementById('audio-pill');
    if (audioPill) {
      if (this.audio.audioState !== 'running') {
        audioPill.textContent = msg.audioPrompt;
        audioPill.dataset.audioStatus = 'locked';
      } else if (this.audio.isMuted) {
        audioPill.textContent = msg.audioMuted;
        audioPill.dataset.audioStatus = 'muted';
      } else {
        audioPill.textContent = msg.audioActive;
        audioPill.dataset.audioStatus = 'active';
      }
    }
  }

  private renderLocaleStrings(): void {
    const msg = LOCALES[this.lang];
    document.title = msg.pageTitle;

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText('hud-eyebrow', msg.eyebrow);
    setText('hud-title', msg.title);
    setText('hud-subtitle', msg.subtitleBilingual);
    setText('link-github-label', msg.githubSource);
    setText('btn-print-mode', msg.printLitho);
    setText('btn-exit-print', msg.exitPrint);
    setText('btn-reset-bench', msg.resetBench);
    setText('btn-lang-toggle', msg.langSwitchLabel);
    setText('lbl-dispersion', msg.dispersionLabel);
    setText('lbl-telemetry-tilt', msg.telemetryTilt);
    setText('lbl-telemetry-beat', msg.telemetryBeat);
    setText('lbl-telemetry-selected', msg.telemetrySelected);
    setText('hud-interaction-hint', msg.interactionHint);

    for (let p = 1; p <= 5; p++) {
      setText(`preset-pill-${p}`, msg.presetNames[p as PresetIndex]);
    }
  }

  private bindControls(): void {
    for (let p = 1; p <= 5; p++) {
      const btn = document.getElementById(`preset-pill-${p}`);
      btn?.addEventListener('click', () => {
        this.renderer.applyPreset(p as PresetIndex, true);
        this.syncAudioOpticalParams();
        this.refreshTelemetry();
      });
    }

    document.getElementById('btn-drag-mode')?.addEventListener('click', () => {
      this.touchTiltMode = !this.touchTiltMode;
      this.refreshTelemetry();
    });

    document.getElementById('btn-view-mode')?.addEventListener('click', () => {
      const next = this.renderer.bench.viewMode === 'bench' ? 'schematic' : 'bench';
      this.renderer.setViewMode(next);
      this.refreshTelemetry();
    });

    document.getElementById('btn-breathing')?.addEventListener('click', () => {
      this.renderer.bench.breathingEnabled = !this.renderer.bench.breathingEnabled;
      this.refreshTelemetry();
    });

    document.getElementById('btn-print-mode')?.addEventListener('click', () => {
      this.renderer.setPrintMode(!this.renderer.bench.printMode);
      this.refreshTelemetry();
    });

    document.getElementById('btn-exit-print')?.addEventListener('click', () => {
      this.renderer.setPrintMode(false);
      this.refreshTelemetry();
    });

    document.getElementById('btn-reset-bench')?.addEventListener('click', () => {
      this.renderer.applyPreset(this.renderer.bench.preset, true);
      this.syncAudioOpticalParams();
      this.refreshTelemetry();
    });

    document.getElementById('btn-lang-toggle')?.addEventListener('click', () => {
      const next: SupportedLocale = this.lang === 'en' ? 'zh-HK' : 'en';
      this.setLocale(next);
    });

    const slider = document.getElementById('slider-dispersion') as HTMLInputElement | null;
    slider?.addEventListener('input', () => {
      const val = Number(slider.value);
      if (Number.isFinite(val)) {
        this.renderer.bench.dispersionBoost = Math.max(1.0, Math.min(6.0, val));
        this.renderer.markOpticalGeometryDirty();
        this.syncAudioOpticalParams();
        this.refreshTelemetry();
      }
    });

    const audioPill = document.getElementById('audio-pill');
    if (audioPill) {
      let suppressTrailingUnlockClick = false;
      let clearSuppressTimer: number | null = null;

      const cancelPendingSuppressTimer = () => {
        if (clearSuppressTimer !== null) {
          window.clearTimeout(clearSuppressTimer);
          clearSuppressTimer = null;
        }
      };

      const scheduleFallbackReset = () => {
        cancelPendingSuppressTimer();
        clearSuppressTimer = window.setTimeout(() => {
          suppressTrailingUnlockClick = false;
          clearSuppressTimer = null;
        }, 0);
      };

      audioPill.addEventListener('pointerdown', (e: PointerEvent) => {
        cancelPendingSuppressTimer();
        if ((e as Event & { __causticAudioUnlocked?: boolean }).__causticAudioUnlocked) {
          suppressTrailingUnlockClick = true;
          const onPointerEnd = () => {
            window.removeEventListener('pointerup', onPointerEnd, true);
            window.removeEventListener('pointercancel', onPointerEnd, true);
            scheduleFallbackReset();
          };
          window.addEventListener('pointerup', onPointerEnd, true);
          window.addEventListener('pointercancel', onPointerEnd, true);
        } else {
          suppressTrailingUnlockClick = false;
        }
      });

      audioPill.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          cancelPendingSuppressTimer();
          if ((e as Event & { __causticAudioUnlocked?: boolean }).__causticAudioUnlocked) {
            suppressTrailingUnlockClick = true;
            if (e.key === ' ') {
              const onKeyEnd = () => {
                window.removeEventListener('keyup', onKeyEnd, true);
                audioPill.removeEventListener('blur', onKeyEnd);
                scheduleFallbackReset();
              };
              window.addEventListener('keyup', onKeyEnd, true);
              audioPill.addEventListener('blur', onKeyEnd);
            } else {
              scheduleFallbackReset();
            }
          } else {
            suppressTrailingUnlockClick = false;
          }
        }
      });

      audioPill.addEventListener('click', (e: MouseEvent) => {
        cancelPendingSuppressTimer();
        if (
          suppressTrailingUnlockClick ||
          (e as Event & { __causticAudioUnlocked?: boolean }).__causticAudioUnlocked
        ) {
          suppressTrailingUnlockClick = false;
          this.refreshTelemetry();
          return;
        }
        this.audio.toggleMute();
        this.refreshTelemetry();
      });
    }
  }

  private bindCanvasPointers(): void {
    const canvas = this.renderer.canvas;

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cam = this.renderer.getCameraMapping(rect.width / Math.max(1, rect.height));
      const world = screenToBenchXZ(e.clientX, e.clientY, rect, cam);
      const isRotateMod = e.shiftKey || e.button === 2 || this.touchTiltMode;
      const hit = hitTestBench(
        world.x,
        world.z,
        this.renderer.bench.elements,
        this.renderer.bench.selectedElementIndex,
        isRotateMod,
      );

      if (hit.mode === 'none') return;

      if (this.renderer.bench.selectedElementIndex !== hit.elementIndex) {
        this.renderer.bench.selectedElementIndex = hit.elementIndex;
        this.renderer.markOverlayDirty();
      }
      const el = this.renderer.bench.elements[hit.elementIndex];
      this.dragSession = {
        pointerId: e.pointerId,
        mode: hit.mode,
        elementIndex: hit.elementIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: world.x,
        startWorldZ: world.z,
        origX: el.x,
        origZ: el.z,
        origThetaX: el.thetaX,
        origThetaY: el.thetaY,
      };
      this.renderer.setDragging(true);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events in headless automation may omit active pointerId capture
      }
      this.refreshTelemetry();
    });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragSession || e.pointerId !== this.dragSession.pointerId) return;
      const sess = this.dragSession;
      const el = this.renderer.bench.elements[sess.elementIndex];
      if (!el) return;

      const rect = canvas.getBoundingClientRect();
      const cam = this.renderer.getCameraMapping(rect.width / Math.max(1, rect.height));
      const world = screenToBenchXZ(e.clientX, e.clientY, rect, cam);

      // Allow dynamic Shift toggle mid-drag as well
      const effectiveMode: DragInteractionMode =
        e.shiftKey && sess.mode === 'translate' ? 'rotate-drag' : sess.mode;

      if (effectiveMode === 'rotate-ring') {
        const angle = Math.atan2(-(world.x - el.x), world.z - el.z);
        el.thetaX = Math.max(-MAX_TILT_RAD, Math.min(MAX_TILT_RAD, angle));
      } else if (effectiveMode === 'rotate-drag') {
        const dpx = e.clientX - sess.startClientX;
        const dpy = e.clientY - sess.startClientY;
        el.thetaX = Math.max(
          -MAX_TILT_RAD,
          Math.min(MAX_TILT_RAD, sess.origThetaX + dpx * 0.0045),
        );
        el.thetaY = Math.max(
          -MAX_TILT_RAD,
          Math.min(MAX_TILT_RAD, sess.origThetaY - dpy * 0.0045),
        );
      } else if (effectiveMode === 'translate') {
        const dx = world.x - sess.startWorldX;
        const dz = world.z - sess.startWorldZ;
        el.x = Math.max(BENCH_BOUNDS.minX, Math.min(BENCH_BOUNDS.maxX, sess.origX + dx));
        el.z = Math.max(BENCH_BOUNDS.minZ, Math.min(BENCH_BOUNDS.maxZ, sess.origZ + dz));
      }

      this.renderer.markOpticalGeometryDirty();
      this.syncAudioOpticalParams();
      this.refreshTelemetry();
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragSession || e.pointerId !== this.dragSession.pointerId) return;
      this.dragSession = null;
      this.renderer.setDragging(false);
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore synthetic pointer release error
      }
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.key !== 'Escape' && e.key.toLowerCase() !== 'p') return;
      }

      const key = e.key;
      if (key >= '1' && key <= '5') {
        const p = Number(key) as PresetIndex;
        this.renderer.applyPreset(p, true);
        this.syncAudioOpticalParams();
        this.refreshTelemetry();
        return;
      }

      const lower = key.toLowerCase();
      if (lower === 'p') {
        this.renderer.setPrintMode(!this.renderer.bench.printMode);
        this.refreshTelemetry();
        return;
      }
      if (key === 'Escape') {
        if (this.renderer.bench.printMode) {
          this.renderer.setPrintMode(false);
          this.refreshTelemetry();
        }
        return;
      }
      if (lower === 'v') {
        const next = this.renderer.bench.viewMode === 'bench' ? 'schematic' : 'bench';
        this.renderer.setViewMode(next);
        this.refreshTelemetry();
        return;
      }
      if (lower === 'b') {
        this.renderer.bench.breathingEnabled = !this.renderer.bench.breathingEnabled;
        this.refreshTelemetry();
        return;
      }
      if (lower === 'r') {
        this.renderer.applyPreset(this.renderer.bench.preset, true);
        this.syncAudioOpticalParams();
        this.refreshTelemetry();
        return;
      }
      if (lower === 'm') {
        if ((e as Event & { __causticAudioUnlocked?: boolean }).__causticAudioUnlocked) {
          this.refreshTelemetry();
          return;
        }
        this.audio.toggleMute();
        this.refreshTelemetry();
      }
    });
  }
}
