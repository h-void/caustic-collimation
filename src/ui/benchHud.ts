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
import type { PresetIndex, SupportedLocale } from '../shared/benchConfig';

interface ActiveDragSession {
  pointerId: number;
  mode: DragInteractionMode;
  lastEffectiveMode: DragInteractionMode;
  elementIndex: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldZ: number;
  startAngle: number;
  origX: number;
  origZ: number;
  origThetaX: number;
  origThetaY: number;
}

const HUD_IDLE_TIMEOUT_MS = 8500;

export class BenchHudController {
  private readonly renderer: OpticalBenchRenderer;
  private readonly audio: PrismAudioEngine;
  private readonly hudPinned: boolean;
  private lang: SupportedLocale;
  private dragSession: ActiveDragSession | null = null;
  private touchTiltMode = false;
  private telemetryOpenMobile = false;
  private idleTimer: number | null = null;
  private isHudHovered = false;

  constructor(
    renderer: OpticalBenchRenderer,
    audio: PrismAudioEngine,
    initialLang: SupportedLocale,
    hudPinned: boolean = false,
  ) {
    this.renderer = renderer;
    this.audio = audio;
    this.lang = initialLang;
    this.hudPinned = hudPinned;

    this.bindControls();
    this.bindCanvasPointers();
    this.bindKeyboardShortcuts();
    this.bindHudIdleFade();
    this.syncAudioOpticalParams();
    this.renderLocaleStrings();
    this.refreshTelemetry();
    this.scheduleHudIdle();
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
      const archShort = msg.archetypeShortNames[selElem.archetype];
      const glassShort = msg.glassShortNames[selElem.glass];
      const txDeg = ((selElem.thetaX * 180.0) / Math.PI).toFixed(1);
      const tyDeg = ((selElem.thetaY * 180.0) / Math.PI).toFixed(1);
      const tiltStr = Math.abs(selElem.thetaY) > 0.0005 ? `θ ${txDeg}°/${tyDeg}°` : `θx ${txDeg}°`;
      elSelected.textContent = `#${selIdx + 1} ${archShort} · ${glassShort} · ${tiltStr}`;
    }

    const colophonText = document.getElementById('print-colophon-text');
    if (colophonText) {
      const presetName = msg.presetShortNames[bench.preset];
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      colophonText.textContent =
        `CAUSTIC COLLIMATION · ${presetName} · γD=${bench.dispersionBoost.toFixed(1)}× · Θ=${tiltDeg.toFixed(1)}° · ${yyyy}-${mm}-${dd}`;
    }

    const btnTelToggle = document.getElementById('btn-telemetry-toggle');
    if (btnTelToggle) {
      const arrow = this.telemetryOpenMobile ? '▾' : '▴';
      btnTelToggle.textContent =
        `γD ${bench.dispersionBoost.toFixed(1)}× · Θ ${tiltDeg.toFixed(1)}° · ${msg.telemetryToggleLabel} ${arrow}`;
      btnTelToggle.classList.toggle('is-active', this.telemetryOpenMobile);
      btnTelToggle.setAttribute('aria-expanded', this.telemetryOpenMobile ? 'true' : 'false');
    }

    const bottomBar = document.getElementById('hud-bottombar');
    if (bottomBar) {
      bottomBar.classList.toggle('is-telemetry-open', this.telemetryOpenMobile);
    }

    for (let p = 1; p <= 5; p++) {
      const btn = document.getElementById(`preset-pill-${p}`);
      if (btn) {
        btn.classList.toggle('is-active', bench.preset === p);
        btn.setAttribute('aria-pressed', bench.preset === p ? 'true' : 'false');
      }
    }

    const btnView = document.getElementById('btn-view-mode') as HTMLButtonElement | null;
    if (btnView) {
      btnView.textContent =
        bench.viewMode === 'bench' ? msg.viewBench3D : msg.viewSchematic2D;
      btnView.disabled = bench.printMode;
      btnView.title = bench.printMode ? msg.viewDisabledInPrint : '';
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
      if (this.audio.isMuted) {
        audioPill.textContent = msg.audioMuted;
        audioPill.dataset.audioStatus = 'muted';
      } else if (this.audio.audioState !== 'running') {
        audioPill.textContent = msg.audioPrompt;
        audioPill.dataset.audioStatus = 'locked';
      } else {
        audioPill.textContent = msg.audioActive;
        audioPill.dataset.audioStatus = 'active';
      }
    }
  }

  private renderShortcutHint(hint: string): void {
    const el = document.getElementById('hud-interaction-hint');
    if (!el) return;
    el.textContent = '';
    const parts = hint.split(/(\[[^\]]+\])/g);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('[') && part.endsWith(']')) {
        const code = document.createElement('code');
        code.className = 'hud-keycap';
        code.textContent = part;
        el.appendChild(code);
      } else {
        el.appendChild(document.createTextNode(part));
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
    this.renderShortcutHint(msg.interactionHint);

    for (let p = 1; p <= 5; p++) {
      setText(`preset-pill-${p}`, msg.presetNames[p as PresetIndex]);
    }
  }

  private clearHudIdleTimer(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private wakeHud(reschedule: boolean): void {
    const hudEl = document.getElementById('hud-container');
    hudEl?.classList.remove('is-idle');
    if (reschedule) {
      this.scheduleHudIdle();
    } else {
      this.clearHudIdleTimer();
    }
  }

  private scheduleHudIdle(): void {
    this.clearHudIdleTimer();
    const hudEl = document.getElementById('hud-container');
    if (!hudEl) return;
    if (
      this.hudPinned ||
      this.renderer.bench.printMode ||
      this.isHudHovered ||
      hudEl.matches(':focus-within') ||
      this.dragSession !== null
    ) {
      hudEl.classList.remove('is-idle');
      return;
    }
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (
        this.hudPinned ||
        this.renderer.bench.printMode ||
        this.isHudHovered ||
        hudEl.matches(':focus-within') ||
        this.dragSession !== null
      ) {
        return;
      }
      hudEl.classList.add('is-idle');
    }, HUD_IDLE_TIMEOUT_MS);
  }

  private bindHudIdleFade(): void {
    const hudEl = document.getElementById('hud-container');
    if (!hudEl) return;

    const onActivity = () => {
      this.wakeHud(true);
    };

    const events: (keyof WindowEventMap)[] = [
      'pointermove',
      'pointerdown',
      'touchstart',
      'keydown',
      'wheel',
      'input',
      'focusin',
    ];
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true, capture: true });
    }

    hudEl.addEventListener('pointerover', () => {
      this.isHudHovered = true;
      this.wakeHud(false);
    });

    hudEl.addEventListener('pointerout', (e: PointerEvent) => {
      const rel = e.relatedTarget as Node | null;
      if (!rel || !hudEl.contains(rel)) {
        this.isHudHovered = false;
        this.scheduleHudIdle();
      }
    });

    hudEl.addEventListener('focusin', () => {
      this.wakeHud(false);
    });

    hudEl.addEventListener('focusout', (e: FocusEvent) => {
      const rel = e.relatedTarget as Node | null;
      if (!rel || !hudEl.contains(rel)) {
        this.scheduleHudIdle();
      }
    });
  }

  private setPrintModeAndSync(enabled: boolean): void {
    this.renderer.setPrintMode(enabled);
    if (enabled) {
      this.wakeHud(false);
    } else {
      this.scheduleHudIdle();
    }
    this.refreshTelemetry();
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

    document.getElementById('btn-telemetry-toggle')?.addEventListener('click', () => {
      this.telemetryOpenMobile = !this.telemetryOpenMobile;
      this.refreshTelemetry();
    });

    document.getElementById('btn-drag-mode')?.addEventListener('click', () => {
      this.touchTiltMode = !this.touchTiltMode;
      this.refreshTelemetry();
    });

    document.getElementById('btn-view-mode')?.addEventListener('click', () => {
      if (this.renderer.bench.printMode) return;
      const next = this.renderer.bench.viewMode === 'bench' ? 'schematic' : 'bench';
      this.renderer.setViewMode(next);
      this.refreshTelemetry();
    });

    document.getElementById('btn-breathing')?.addEventListener('click', () => {
      this.renderer.setBreathingEnabled(!this.renderer.bench.breathingEnabled);
      this.syncAudioOpticalParams();
      this.refreshTelemetry();
    });

    document.getElementById('btn-print-mode')?.addEventListener('click', () => {
      this.setPrintModeAndSync(!this.renderer.bench.printMode);
    });

    document.getElementById('btn-exit-print')?.addEventListener('click', () => {
      this.setPrintModeAndSync(false);
    });

    document.getElementById('btn-reset-bench')?.addEventListener('click', () => {
      this.renderer.setBreathingEnabled(false);
      this.renderer.bench.dispersionBoost = 3.5;
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
        this.renderer.markOpticalGeometryDirty(this.renderer.bench.breathingEnabled);
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
        }, 120);
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
      const allowRotateRing =
        !this.renderer.bench.printMode && this.renderer.hasUserSelectedElement();
      const hit = hitTestBench(
        world.x,
        world.z,
        this.renderer.bench.elements,
        this.renderer.bench.selectedElementIndex,
        isRotateMod,
        allowRotateRing,
      );

      if (hit.mode === 'none') return;

      if (this.renderer.bench.selectedElementIndex !== hit.elementIndex) {
        this.renderer.bench.selectedElementIndex = hit.elementIndex;
        this.renderer.markOverlayDirty();
      }
      const el = this.renderer.bench.elements[hit.elementIndex];
      const startAngle = Math.atan2(-(world.x - el.x), world.z - el.z);
      this.dragSession = {
        pointerId: e.pointerId,
        mode: hit.mode,
        lastEffectiveMode: hit.mode,
        elementIndex: hit.elementIndex,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: world.x,
        startWorldZ: world.z,
        startAngle,
        origX: el.x,
        origZ: el.z,
        origThetaX: el.thetaX,
        origThetaY: el.thetaY,
      };
      this.renderer.setDragging(true);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable for this event
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

      // Allow dynamic Shift toggle mid-drag without snapping position or angle
      const effectiveMode: DragInteractionMode =
        e.shiftKey && sess.mode === 'translate' ? 'rotate-drag' : sess.mode;
      if (effectiveMode !== sess.lastEffectiveMode) {
        sess.lastEffectiveMode = effectiveMode;
        sess.startClientX = e.clientX;
        sess.startClientY = e.clientY;
        sess.startWorldX = world.x;
        sess.startWorldZ = world.z;
        sess.startAngle = Math.atan2(-(world.x - el.x), world.z - el.z);
        sess.origX = el.x;
        sess.origZ = el.z;
        sess.origThetaX = el.thetaX;
        sess.origThetaY = el.thetaY;
      }

      if (effectiveMode === 'rotate-ring') {
        const angle = Math.atan2(-(world.x - el.x), world.z - el.z);
        const deltaAngle = Math.atan2(
          Math.sin(angle - sess.startAngle),
          Math.cos(angle - sess.startAngle),
        );
        el.thetaX = Math.max(-MAX_TILT_RAD, Math.min(MAX_TILT_RAD, sess.origThetaX + deltaAngle));
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

      const editedElem0ThetaX =
        sess.elementIndex === 0 &&
        (effectiveMode === 'rotate-ring' || effectiveMode === 'rotate-drag');
      this.renderer.markOpticalGeometryDirty(
        this.renderer.bench.breathingEnabled && !editedElem0ThetaX,
      );
      if (editedElem0ThetaX && this.renderer.bench.breathingEnabled) {
        this.renderer.resetBreathingPhase();
      }
      this.syncAudioOpticalParams();
      this.refreshTelemetry();
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragSession || e.pointerId !== this.dragSession.pointerId) return;
      this.dragSession = null;
      this.renderer.setDragging(false);
      this.scheduleHudIdle();
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
    const isEditableElement = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el.isContentEditable;
    };

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
        return;
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
        this.setPrintModeAndSync(!this.renderer.bench.printMode);
        return;
      }
      if (key === 'Escape') {
        if (this.renderer.bench.printMode) {
          this.setPrintModeAndSync(false);
        }
        return;
      }
      if (lower === 'v') {
        if (this.renderer.bench.printMode) return;
        const next = this.renderer.bench.viewMode === 'bench' ? 'schematic' : 'bench';
        this.renderer.setViewMode(next);
        this.refreshTelemetry();
        return;
      }
      if (lower === 'b') {
        this.renderer.setBreathingEnabled(!this.renderer.bench.breathingEnabled);
        this.syncAudioOpticalParams();
        this.refreshTelemetry();
        return;
      }
      if (lower === 'r') {
        this.renderer.setBreathingEnabled(false);
        this.renderer.bench.dispersionBoost = 3.5;
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
