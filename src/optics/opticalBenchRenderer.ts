import {
  ARCHIVAL_LITHO_PALETTE,
  DEFAULT_SEED_U64,
  Rng64,
  type PresetIndex,
  type ViewMode,
} from '../shared/pureCodeContract';
import { probeFboCapabilities, type FboCapabilities } from './fboCapabilities';
import {
  computeCameraBasis,
  computeViewProjMatrix,
  createDefaultCameraMapping,
  type BenchCameraMapping,
} from './picking';
import {
  buildPresetElements,
  buildThumbMacroElements,
  buildTiltMatrixCellElements,
} from './presets';
import { traceOpticalRay3D } from './sdfMath';
import {
  AIRY_SPLAT_FS,
  AIRY_SPLAT_VS,
  BEAM_SPLAT_FS,
  BEAM_SPLAT_VS,
  DISCRETE_RAY_FS,
  DISCRETE_RAY_VS,
  DUMMY_FS,
  FULLSCREEN_QUAD_VS,
  RESOLVE_BENCH_FS,
  RESOLVE_SCHEMATIC_FS,
  RGBA8_ACCUM_FS,
  TRACE_RAY_VS,
} from './shaders';
import {
  MAX_OPTICAL_ELEMENTS,
  type BenchState,
  type OpticalElementState,
} from './types';

export const RAYS_PER_BAND = 96;
export const RAYS_PER_STEP = RAYS_PER_BAND * 7; // 672 rays/step -> 67,200 rays over 100 warmup steps
export const BOOT_WARMUP_STEPS = 100;
const MAX_WAVEFRONT_STEPS = 25;
const RAYS_PER_TEX_ROW = 64;
const RAY_TEX_WIDTH = RAYS_PER_TEX_ROW * 11; // 704 (<< MAX_TEXTURE_SIZE)
const RAY_TEX_HEIGHT = Math.ceil((MAX_WAVEFRONT_STEPS * RAYS_PER_STEP) / RAYS_PER_TEX_ROW); // 263
const PATH_SEGMENTS = 9; // 8 surface bounces (0..7) + 1 free-space focal exit segment (8)
const RAY_PATH_FLOATS = 44; // 11 vec4s: v_p0..v_p9 + v_airy
const RAY_PATH_BYTES = RAY_PATH_FLOATS * 4; // 176 bytes per ray
const RGBA8_BATCH_SCALE = 0.085;

export interface RenderTargetSet {
  accumW: number;
  accumH: number;
  resolveW: number;
  resolveH: number;
  isOffscreen: boolean;
  accumTexA: WebGLTexture;
  accumFboA: WebGLFramebuffer;
  accumTexB: WebGLTexture | null;
  accumFboB: WebGLFramebuffer | null;
  scratchBatchTex: WebGLTexture | null;
  scratchBatchFbo: WebGLFramebuffer | null;
  pingIdx: number;
  resolveTex: WebGLTexture | null;
  resolveFbo: WebGLFramebuffer | null;
  disposed: boolean;
}

export interface EngineSnapshot {
  bench: BenchState;
  rngState: bigint;
  accumFrames: number;
  stepCounter: number;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Failed to create WebGLShader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) ?? 'unknown shader error';
    gl.deleteShader(sh);
    throw new Error(`GLSL compile failed: ${info}`);
  }
  return sh;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  tfVaryings?: string[],
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('Failed to create WebGLProgram');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (tfVaryings && tfVaryings.length > 0) {
    gl.transformFeedbackVaryings(prog, tfVaryings, gl.INTERLEAVED_ATTRIBS);
  }
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? 'unknown link error';
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${info}`);
  }
  return prog;
}

export class OpticalBenchRenderer {
  public readonly canvas: HTMLCanvasElement;
  public readonly gl: WebGL2RenderingContext;
  public readonly caps: FboCapabilities;

  public bench: BenchState;
  private rng: Rng64;

  public readonly warmupSteps = BOOT_WARMUP_STEPS;
  public simSteps = 0;
  public accumFrames = 0;
  private stepCounter = 0;
  public lastGlError = 0;

  private traceRayProg: WebGLProgram;
  private beamProg: WebGLProgram;
  private airyProg: WebGLProgram;
  private rgba8AccumProg: WebGLProgram | null = null;
  private resolveBenchProg: WebGLProgram | null = null;
  private resolveSchematicProg: WebGLProgram | null = null;
  private discreteRayProg: WebGLProgram | null = null;

  private emptyVao: WebGLVertexArrayObject;
  private rayPathVbo: WebGLBuffer;
  private rayPathTex: WebGLTexture;
  private tfObj: WebGLTransformFeedback;
  private discreteRayVao: WebGLVertexArrayObject;
  private discreteRayVbo: WebGLBuffer;
  private discreteRayCapFloats = 0;

  private readonly uniformCache = new WeakMap<
    WebGLProgram,
    Map<string, WebGLUniformLocation | null>
  >();
  private readonly scratchPoses = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);
  private readonly scratchTrigs = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);
  private readonly scratchMetas = new Int32Array(MAX_OPTICAL_ELEMENTS * 2);
  private readonly scratchGeomA = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);
  private readonly scratchGeomB = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);
  private readonly scratchBoxMin = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);
  private readonly scratchBoxMax = new Float32Array(MAX_OPTICAL_ELEMENTS * 4);

  private mainTargets: RenderTargetSet;
  private rafHandle: number | null = null;
  private isLoopRunning = false;
  private startTimeMs = 0;
  private isDragging = false;
  private baseDragThetaX0 = 0;
  private prePrintViewMode: ViewMode | null = null;
  private onFrameTick?: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    initialBench: BenchState,
    onFrameTick?: () => void,
  ) {
    this.canvas = canvas;
    this.bench = initialBench;
    this.rng = new Rng64(initialBench.seed);
    this.onFrameTick = onFrameTick;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required for Caustic Collimation');
    }
    this.gl = gl;
    this.caps = probeFboCapabilities(gl);

    const tfVaryings = [
      'v_p0',
      'v_p1',
      'v_p2',
      'v_p3',
      'v_p4',
      'v_p5',
      'v_p6',
      'v_p7',
      'v_p8',
      'v_p9',
      'v_airy',
    ];
    this.traceRayProg = createProgram(gl, TRACE_RAY_VS, DUMMY_FS, tfVaryings);
    this.beamProg = createProgram(gl, BEAM_SPLAT_VS, BEAM_SPLAT_FS);
    this.airyProg = createProgram(gl, AIRY_SPLAT_VS, AIRY_SPLAT_FS);
    if (this.caps.fboFormat === 'RGBA8') {
      this.rgba8AccumProg = createProgram(gl, FULLSCREEN_QUAD_VS, RGBA8_ACCUM_FS);
    }
    if (initialBench.viewMode === 'schematic') {
      this.resolveSchematicProg = createProgram(gl, FULLSCREEN_QUAD_VS, RESOLVE_SCHEMATIC_FS);
      this.discreteRayProg = createProgram(gl, DISCRETE_RAY_VS, DISCRETE_RAY_FS);
    } else {
      this.resolveBenchProg = createProgram(gl, FULLSCREEN_QUAD_VS, RESOLVE_BENCH_FS);
    }

    const emptyVao = gl.createVertexArray();
    const rayPathVbo = gl.createBuffer();
    const rayPathTex = gl.createTexture();
    const tfObj = gl.createTransformFeedback();
    const discreteRayVao = gl.createVertexArray();
    const discreteRayVbo = gl.createBuffer();

    if (!emptyVao || !rayPathVbo || !rayPathTex || !tfObj || !discreteRayVao || !discreteRayVbo) {
      throw new Error('Failed to allocate WebGL2 buffers/VAOs');
    }

    this.emptyVao = emptyVao;
    this.rayPathVbo = rayPathVbo;
    this.rayPathTex = rayPathTex;
    this.tfObj = tfObj;
    this.discreteRayVao = discreteRayVao;
    this.discreteRayVbo = discreteRayVbo;

    gl.bindBuffer(gl.ARRAY_BUFFER, rayPathVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      RAY_TEX_HEIGHT * RAYS_PER_TEX_ROW * RAY_PATH_BYTES,
      gl.DYNAMIC_COPY,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindTexture(gl.TEXTURE_2D, rayPathTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      RAY_TEX_WIDTH,
      RAY_TEX_HEIGHT,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Discrete geometric ray VAO (12 floats = 48 bytes per instance: a_seg0, a_seg1, a_color)
    gl.bindVertexArray(discreteRayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, discreteRayVbo);
    this.discreteRayCapFloats = 4096 * 12;
    gl.bufferData(gl.ARRAY_BUFFER, this.discreteRayCapFloats * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 48, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 48, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 48, 32);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const { width, height } = this.syncCanvasPixelSize();
    const accScale0 = Math.min(0.28, 256 / Math.max(width, height));
    const liveAccW = Math.max(16, Math.round(width * accScale0));
    const liveAccH = Math.max(16, Math.round(height * accScale0));
    this.mainTargets = this.allocateTargetSet(liveAccW, liveAccH, width, height, false);
    this.clearAccumTarget(this.mainTargets);

    // Synchronous 100-step boot warmup (67,200 multi-bounce 3D SDF rays >= 65,536!)
    const cam = this.getCameraMapping(width / Math.max(1, height));
    this.runPhotonAccumulationSteps(BOOT_WARMUP_STEPS, this.mainTargets, cam, this.bench.elements, {
      emitterZ: -2.85,
      beamRadiusX: 0.36,
      beamRadiusY: 0.20,
      focalPlaneZ: 1.92,
      focalSlabHalf: 0.32,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: 1.15,
      rayGain: 0.034,
      airyRadiusPx: 3.8,
      airyGain: 0.042,
      maxMarchSteps: 11,
      beamMask: 15,
    });
    this.simSteps += BOOT_WARMUP_STEPS;
    this.renderMainResolve(cam);
    this.pollGlError();
  }

  public getCameraMapping(aspect?: number): BenchCameraMapping {
    const a =
      aspect ??
      Math.max(1, this.canvas.clientWidth || this.canvas.width) /
        Math.max(1, this.canvas.clientHeight || this.canvas.height);
    return createDefaultCameraMapping(this.bench.viewMode, a);
  }

  public setDragging(active: boolean): void {
    this.isDragging = active;
    if (!active && this.bench.elements.length > 0) {
      this.baseDragThetaX0 = this.bench.elements[0].thetaX;
    }
  }

  public markOverlayDirty(): void {
    // Handled analytically in resolve pass
  }

  public markOpticalGeometryDirty(): void {
    this.accumFrames = 0;
    this.stepCounter = 0;
    this.clearAccumTarget(this.mainTargets);
    if (this.bench.elements.length > 0) {
      this.baseDragThetaX0 = this.bench.elements[0].thetaX;
    }
  }

  public applyPreset(preset: PresetIndex, resetSeed: boolean = true): void {
    this.bench.preset = preset;
    if (resetSeed) {
      this.rng = new Rng64(this.bench.seed);
    }
    this.bench.elements = buildPresetElements(preset, this.bench.seed);
    this.bench.selectedElementIndex = Math.min(
      this.bench.selectedElementIndex,
      Math.max(0, this.bench.elements.length - 1),
    );
    if (this.bench.elements.length > 0) {
      this.baseDragThetaX0 = this.bench.elements[0].thetaX;
    }
    this.markOpticalGeometryDirty();
    const w = this.mainTargets.resolveW;
    const h = this.mainTargets.resolveH;
    const cam = this.getCameraMapping(w / Math.max(1, h));
    this.runPhotonAccumulationSteps(12, this.mainTargets, cam, this.bench.elements, {
      emitterZ: -2.85,
      beamRadiusX: 0.36,
      beamRadiusY: 0.20,
      focalPlaneZ: 1.92,
      focalSlabHalf: 0.32,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: 1.15,
      rayGain: 0.056,
      airyRadiusPx: 9.0,
      airyGain: 0.038,
    });
  }

  public setPrintMode(enabled: boolean): void {
    this.bench.printMode = enabled;
    document.documentElement.dataset.printMode = enabled ? 'true' : 'false';
    if (enabled) {
      if (this.prePrintViewMode === null) {
        this.prePrintViewMode = this.bench.viewMode;
      }
      this.bench.viewMode = 'schematic';
      document.documentElement.dataset.viewMode = 'schematic';
    } else if (this.prePrintViewMode !== null) {
      this.bench.viewMode = this.prePrintViewMode;
      this.prePrintViewMode = null;
      document.documentElement.dataset.viewMode = this.bench.viewMode;
    }
    this.markOpticalGeometryDirty();
    const w = this.mainTargets.resolveW;
    const h = this.mainTargets.resolveH;
    const cam = this.getCameraMapping(w / Math.max(1, h));
    this.runPhotonAccumulationSteps(16, this.mainTargets, cam, this.bench.elements, {
      emitterZ: -2.85,
      beamRadiusX: 0.36,
      beamRadiusY: 0.20,
      focalPlaneZ: 1.92,
      focalSlabHalf: 0.32,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: 1.15,
      rayGain: 0.056,
      airyRadiusPx: 9.0,
      airyGain: 0.038,
    });
    this.renderMainResolve(cam);
  }

  public setViewMode(mode: ViewMode): void {
    if (this.bench.viewMode === mode) return;
    this.bench.viewMode = mode;
    this.prePrintViewMode = null;
    document.documentElement.dataset.viewMode = mode;
    this.markOpticalGeometryDirty();
    const w = this.mainTargets.resolveW;
    const h = this.mainTargets.resolveH;
    const cam = this.getCameraMapping(w / Math.max(1, h));
    this.runPhotonAccumulationSteps(12, this.mainTargets, cam, this.bench.elements, {
      emitterZ: -2.85,
      beamRadiusX: 0.36,
      beamRadiusY: 0.20,
      focalPlaneZ: 1.92,
      focalSlabHalf: 0.32,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: 1.15,
      rayGain: 0.056,
      airyRadiusPx: 9.0,
      airyGain: 0.038,
    });
  }

  public startLoop(): void {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;
    this.startTimeMs = performance.now();
    if (this.bench.elements.length > 0) {
      this.baseDragThetaX0 = this.bench.elements[0].thetaX;
    }

    const tick = (nowMs: number) => {
      if (!this.isLoopRunning) return;
      this.renderLiveFrame(nowMs);
      this.rafHandle = window.requestAnimationFrame(tick);
    };
    this.rafHandle = window.requestAnimationFrame(tick);
  }

  public pauseLoop(): boolean {
    const wasRunning = this.isLoopRunning;
    this.isLoopRunning = false;
    if (this.rafHandle !== null) {
      window.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    return wasRunning;
  }

  public resumeLoop(): void {
    this.startLoop();
  }

  public renderLiveFrame(nowMs: number): void {
    const { width, height, resized } = this.syncCanvasPixelSize();
    if (resized) {
      this.disposeTargetSet(this.mainTargets);
      const accScale = Math.min(0.28, 256 / Math.max(width, height));
      const liveAccW = Math.max(16, Math.round(width * accScale));
      const liveAccH = Math.max(16, Math.round(height * accScale));
      this.mainTargets = this.allocateTargetSet(liveAccW, liveAccH, width, height, false);
      this.markOpticalGeometryDirty();
    }

    if (
      this.bench.breathingEnabled &&
      !this.isDragging &&
      !this.bench.printMode &&
      this.bench.elements.length > 0
    ) {
      const elapsedSec = (nowMs - this.startTimeMs) * 0.001;
      const delta = ((3.2 * Math.PI) / 180.0) * Math.sin(elapsedSec * 0.55);
      this.bench.elements[0].thetaX = Math.max(
        -0.61,
        Math.min(0.61, this.baseDragThetaX0 + delta),
      );
      this.markOpticalGeometryDirty();
    }

    const cam = this.getCameraMapping(width / Math.max(1, height));
    const convergedIdle =
      this.accumFrames >= 140 && !this.isDragging && !this.bench.breathingEnabled;
    this.stepPhotonAccumulation(this.mainTargets, cam, this.bench.elements, {
      emitterZ: -2.85,
      beamRadiusX: 0.36,
      beamRadiusY: 0.20,
      focalPlaneZ: 1.92,
      focalSlabHalf: 0.32,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: 1.15,
      rayGain: 0.034,
      airyRadiusPx: 3.8,
      airyGain: 0.042,
      maxMarchSteps: 20,
      beamMask: 7,
      raysPerBandOverride: convergedIdle ? 24 : RAYS_PER_BAND,
    });
    this.simSteps++;
    if (!convergedIdle || (this.simSteps & 3) === 0) {
      this.renderMainResolve(cam);
    }
    this.onFrameTick?.();
  }

  public cloneState(): EngineSnapshot {
    return {
      bench: {
        ...this.bench,
        elements: this.bench.elements.map((e) => ({
          ...e,
          geomA: [...e.geomA] as [number, number, number, number],
          geomB: [...e.geomB] as [number, number, number, number],
        })),
      },
      rngState: this.rng.getState(),
      accumFrames: this.accumFrames,
      stepCounter: this.stepCounter,
    };
  }

  public restoreState(snap: EngineSnapshot): void {
    this.bench = {
      ...snap.bench,
      elements: snap.bench.elements.map((e) => ({
        ...e,
        geomA: [...e.geomA] as [number, number, number, number],
        geomB: [...e.geomB] as [number, number, number, number],
      })),
    };
    this.rng.setState(snap.rngState);
    this.accumFrames = snap.accumFrames;
    this.stepCounter = snap.stepCounter;
    document.documentElement.dataset.printMode = this.bench.printMode ? 'true' : 'false';
    document.documentElement.dataset.viewMode = this.bench.viewMode;
  }

  public restoreMainViewport(): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const cam = this.getCameraMapping(this.canvas.width / Math.max(1, this.canvas.height));
    this.renderMainResolve(cam);
    this.pollGlError();
  }

  private syncCanvasPixelSize(): { width: number; height: number; resized: boolean } {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cssW = Math.max(16, this.canvas.clientWidth || window.innerWidth || 1280);
    const cssH = Math.max(16, this.canvas.clientHeight || window.innerHeight || 800);
    const rawW = cssW * dpr;
    const rawH = cssH * dpr;
    const capScale = Math.min(1.0, 640 / Math.max(rawW, rawH));
    const maxDim = Math.min(this.caps.maxTargetDim, 640);
    const targetW = Math.min(maxDim, Math.max(16, Math.round(rawW * capScale)));
    const targetH = Math.min(maxDim, Math.max(16, Math.round(rawH * capScale)));
    const resized = this.canvas.width !== targetW || this.canvas.height !== targetH;
    if (resized) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
    return { width: targetW, height: targetH, resized };
  }

  private createTex2D(
    w: number,
    h: number,
    internalFormat: number,
    format: number,
    type: number,
    filter: number,
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  private createFboForTex(tex: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('Failed to create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  public allocateTargetSet(
    accumW: number,
    accumH: number,
    resolveW: number,
    resolveH: number,
    isOffscreen: boolean,
  ): RenderTargetSet {
    const gl = this.gl;
    const safeAccumW = Math.max(16, Math.round(accumW));
    const safeAccumH = Math.max(16, Math.round(accumH));
    const safeResolveW = Math.max(1, Math.round(resolveW));
    const safeResolveH = Math.max(1, Math.round(resolveH));
    const { internalFormat, format, type, filter, fboFormat } = this.caps;

    const accumTexA = this.createTex2D(
      safeAccumW,
      safeAccumH,
      internalFormat,
      format,
      type,
      filter,
    );
    const accumFboA = this.createFboForTex(accumTexA);

    let accumTexB: WebGLTexture | null = null;
    let accumFboB: WebGLFramebuffer | null = null;
    let scratchBatchTex: WebGLTexture | null = null;
    let scratchBatchFbo: WebGLFramebuffer | null = null;

    if (fboFormat === 'RGBA8') {
      accumTexB = this.createTex2D(
        safeAccumW,
        safeAccumH,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gl.NEAREST,
      );
      accumFboB = this.createFboForTex(accumTexB);
      scratchBatchTex = this.createTex2D(
        safeAccumW,
        safeAccumH,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gl.NEAREST,
      );
      scratchBatchFbo = this.createFboForTex(scratchBatchTex);
    }

    let resolveTex: WebGLTexture | null = null;
    let resolveFbo: WebGLFramebuffer | null = null;
    if (isOffscreen) {
      resolveTex = this.createTex2D(
        safeResolveW,
        safeResolveH,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gl.LINEAR,
      );
      resolveFbo = this.createFboForTex(resolveTex);
    }

    return {
      accumW: safeAccumW,
      accumH: safeAccumH,
      resolveW: safeResolveW,
      resolveH: safeResolveH,
      isOffscreen,
      accumTexA,
      accumFboA,
      accumTexB,
      accumFboB,
      scratchBatchTex,
      scratchBatchFbo,
      pingIdx: 0,
      resolveTex,
      resolveFbo,
      disposed: false,
    };
  }

  public disposeTargetSet(ts: RenderTargetSet): void {
    if (ts.disposed) return;
    ts.disposed = true;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(ts.accumFboA);
    gl.deleteTexture(ts.accumTexA);
    if (ts.accumFboB) gl.deleteFramebuffer(ts.accumFboB);
    if (ts.accumTexB) gl.deleteTexture(ts.accumTexB);
    if (ts.scratchBatchFbo) gl.deleteFramebuffer(ts.scratchBatchFbo);
    if (ts.scratchBatchTex) gl.deleteTexture(ts.scratchBatchTex);
    if (ts.resolveFbo) gl.deleteFramebuffer(ts.resolveFbo);
    if (ts.resolveTex) gl.deleteTexture(ts.resolveTex);
  }

  public clearAccumTarget(ts: RenderTargetSet): void {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ts.accumFboA);
    gl.viewport(0, 0, ts.accumW, ts.accumH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (ts.accumFboB) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, ts.accumFboB);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    ts.pingIdx = 0;
  }

  private getRgba8AccumProg(): WebGLProgram {
    if (!this.rgba8AccumProg) {
      this.rgba8AccumProg = createProgram(this.gl, FULLSCREEN_QUAD_VS, RGBA8_ACCUM_FS);
    }
    return this.rgba8AccumProg;
  }

  private getResolveBenchProg(): WebGLProgram {
    if (!this.resolveBenchProg) {
      this.resolveBenchProg = createProgram(this.gl, FULLSCREEN_QUAD_VS, RESOLVE_BENCH_FS);
    }
    return this.resolveBenchProg;
  }

  private getResolveSchematicProg(): WebGLProgram {
    if (!this.resolveSchematicProg) {
      this.resolveSchematicProg = createProgram(this.gl, FULLSCREEN_QUAD_VS, RESOLVE_SCHEMATIC_FS);
    }
    return this.resolveSchematicProg;
  }

  private getDiscreteRayProg(): WebGLProgram {
    if (!this.discreteRayProg) {
      this.discreteRayProg = createProgram(this.gl, DISCRETE_RAY_VS, DISCRETE_RAY_FS);
    }
    return this.discreteRayProg;
  }

  private uLoc(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let map = this.uniformCache.get(prog);
    if (!map) {
      map = new Map<string, WebGLUniformLocation | null>();
      this.uniformCache.set(prog, map);
    }
    if (map.has(name)) {
      return map.get(name) ?? null;
    }
    const loc = this.gl.getUniformLocation(prog, name);
    map.set(name, loc);
    return loc;
  }

  private uploadElementUniforms(
    prog: WebGLProgram,
    elements: readonly OpticalElementState[],
  ): void {
    const gl = this.gl;
    const count = Math.min(MAX_OPTICAL_ELEMENTS, elements.length);
    gl.uniform1i(this.uLoc(prog, 'u_elemCount'), count);

    const poses = this.scratchPoses;
    const trigs = this.scratchTrigs;
    const metas = this.scratchMetas;
    const geomA = this.scratchGeomA;
    const geomB = this.scratchGeomB;
    const boxMin = this.scratchBoxMin;
    const boxMax = this.scratchBoxMax;
    poses.fill(0);
    trigs.fill(0);
    metas.fill(0);
    geomA.fill(0);
    geomB.fill(0);
    boxMin.fill(0);
    boxMax.fill(0);

    for (let i = 0; i < count; i++) {
      const el = elements[i];
      const cx = Math.cos(el.thetaX);
      const sx = Math.sin(el.thetaX);
      const cy = Math.cos(el.thetaY);
      const sy = Math.sin(el.thetaY);

      poses[i * 4 + 0] = el.x;
      poses[i * 4 + 1] = el.z;
      poses[i * 4 + 2] = el.thetaX;
      poses[i * 4 + 3] = el.thetaY;

      trigs[i * 4 + 0] = cx;
      trigs[i * 4 + 1] = sx;
      trigs[i * 4 + 2] = cy;
      trigs[i * 4 + 3] = sy;

      metas[i * 2 + 0] = el.archetype;
      metas[i * 2 + 1] = el.glass;

      geomA.set(el.geomA, i * 4);
      geomB.set(el.geomB, i * 4);
      if (el.archetype === 3) {
        geomB[i * 4 + 2] = Math.sin(el.geomA[2]);
        geomB[i * 4 + 3] = Math.cos(el.geomA[2]);
      }

      let cxLocal = 0.0;
      let lx = 0.62;
      let ly = 0.62;
      let lz = 0.34;
      if (el.archetype === 0 || el.archetype === 1) {
        lx = el.geomA[3] + 0.025;
        ly = el.geomA[3] + 0.025;
        lz = el.geomA[2] + 0.27;
      } else if (el.archetype === 2) {
        lx = el.geomB[1] + 0.03;
        ly = el.geomB[1] + 0.03;
        lz = el.geomB[0] + 0.24;
      } else if (el.archetype === 3) {
        const sinBeta = Math.max(0.25, Math.abs(Math.sin(el.geomA[2])));
        const cosBeta = Math.max(0.25, Math.abs(Math.cos(el.geomA[2])));
        const xApex = el.geomA[0] / sinBeta;
        const xBase = -el.geomA[0];
        const minXL = el.geomA[3] >= 0 ? xBase : -xApex;
        const maxXL = el.geomA[3] >= 0 ? xApex : -xBase;
        cxLocal = 0.5 * (minXL + maxXL);
        lx = 0.5 * (maxXL - minXL) + 0.03;
        ly = el.geomA[1] + 0.03;
        lz = (el.geomA[0] * (1.0 + sinBeta)) / cosBeta + 0.03;
      } else {
        lx = el.geomA[3] + 0.025;
        ly = el.geomB[0] + 0.025;
        lz = el.geomA[2] + 0.24;
      }

      const worldCenterX = el.x + cx * cxLocal;
      const worldCenterZ = el.z - sx * cxLocal;
      const wx = Math.abs(cx) * lx + Math.abs(sx * sy) * ly + Math.abs(sx * cy) * lz + 0.015;
      const wy = Math.abs(cy) * ly + Math.abs(sy) * lz + 0.015;
      const wz = Math.abs(sx) * lx + Math.abs(cx * sy) * ly + Math.abs(cx * cy) * lz + 0.015;

      boxMin[i * 4 + 0] = worldCenterX - wx;
      boxMin[i * 4 + 1] = -wy;
      boxMin[i * 4 + 2] = worldCenterZ - wz;
      boxMin[i * 4 + 3] = el.archetype === 1 ? 1.0 : 0.0;

      boxMax[i * 4 + 0] = worldCenterX + wx;
      boxMax[i * 4 + 1] = wy;
      boxMax[i * 4 + 2] = worldCenterZ + wz;
    }

    gl.uniform4fv(this.uLoc(prog, 'u_elemPose'), poses);
    gl.uniform4fv(this.uLoc(prog, 'u_elemTrig'), trigs);
    gl.uniform2iv(this.uLoc(prog, 'u_elemMeta'), metas);
    gl.uniform4fv(this.uLoc(prog, 'u_elemGeomA'), geomA);
    gl.uniform4fv(this.uLoc(prog, 'u_elemGeomB'), geomB);
    const locMin = this.uLoc(prog, 'u_elemBoxMin');
    if (locMin) gl.uniform4fv(locMin, boxMin);
    const locMax = this.uLoc(prog, 'u_elemBoxMax');
    if (locMax) gl.uniform4fv(locMax, boxMax);
  }

  public runPhotonAccumulationSteps(
    totalSteps: number,
    ts: RenderTargetSet,
    cam: BenchCameraMapping,
    elements: readonly OpticalElementState[],
    opts: {
      gammaD?: number;
      emitterZ: number;
      beamRadiusX: number;
      beamRadiusY: number;
      focalPlaneZ: number;
      focalSlabHalf: number;
      fanSpreadRad: number;
      beamHalfWidthPx: number;
      rayGain: number;
      airyRadiusPx: number;
      airyGain: number;
      maxMarchSteps?: number;
      beamMask?: number;
      raysPerBandOverride?: number;
      viewportRect?: [number, number, number, number];
    },
  ): void {
    const maxChunk = this.caps.fboFormat === 'RGBA8' ? 5 : MAX_WAVEFRONT_STEPS;
    let remaining = Math.max(0, Math.trunc(totalSteps));
    while (remaining > 0) {
      const chunk = Math.min(remaining, maxChunk);
      this.stepPhotonAccumulation(ts, cam, elements, opts, chunk);
      remaining -= chunk;
    }
  }

  public stepPhotonAccumulation(
    ts: RenderTargetSet,
    cam: BenchCameraMapping,
    elements: readonly OpticalElementState[],
    opts: {
      gammaD?: number;
      emitterZ: number;
      beamRadiusX: number;
      beamRadiusY: number;
      focalPlaneZ: number;
      focalSlabHalf: number;
      fanSpreadRad: number;
      beamHalfWidthPx: number;
      rayGain: number;
      airyRadiusPx: number;
      airyGain: number;
      maxMarchSteps?: number;
      beamMask?: number;
      raysPerBandOverride?: number;
      viewportRect?: [number, number, number, number];
    },
    batchSteps: number = 1,
  ): void {
    const gl = this.gl;
    const steps = Math.max(1, Math.min(MAX_WAVEFRONT_STEPS, Math.trunc(batchSteps)));
    const gammaD = opts.gammaD ?? this.bench.dispersionBoost;
    const raysPerBand = Math.max(
      8,
      Math.min(RAYS_PER_BAND, opts.raysPerBandOverride ?? RAYS_PER_BAND),
    );
    const raysThisStep = raysPerBand * 7;
    const totalWavefrontRays = steps * raysThisStep;
    const rayGainScale = 192.0 / raysPerBand;
    const beamMask = opts.beamMask ?? 0;
    const beamMaskComp = beamMask > 0 ? beamMask + 1 : 1.0;
    const vp = opts.viewportRect ?? [0, 0, ts.accumW, ts.accumH];
    const isRgba8 = this.caps.fboFormat === 'RGBA8';
    const splatFbo = isRgba8 && ts.scratchBatchFbo ? ts.scratchBatchFbo : ts.accumFboA;
    const rgba8Scale = steps > 1 ? RGBA8_BATCH_SCALE / Math.min(steps, 3.0) : RGBA8_BATCH_SCALE;
    const batchScale = isRgba8 ? rgba8Scale : 1.0;
    const baseStep = this.stepCounter;

    if (isRgba8) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, splatFbo);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    let jx = 0;
    let jy = 0;
    let jz = 0;
    let jw = 0;
    for (let s = 0; s < steps; s++) {
      const a = this.rng.nextF64();
      const b = this.rng.nextF64();
      const c = this.rng.nextF64();
      const d = this.rng.nextF64();
      if (s === 0) {
        jx = a;
        jy = b;
        jz = c;
        jw = d;
      }
    }

    // 1. Single-Pass Warp-Coherent 8-Bounce Transform Feedback (traces all steps*672 rays in 1 draw!)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.useProgram(this.traceRayProg);
    this.uploadElementUniforms(this.traceRayProg, elements);
    gl.uniform1i(this.uLoc(this.traceRayProg, 'u_baseStep'), baseStep);
    gl.uniform1i(this.uLoc(this.traceRayProg, 'u_raysThisStep'), raysThisStep);
    gl.uniform1i(this.uLoc(this.traceRayProg, 'u_raysPerBand'), raysPerBand);
    gl.uniform1i(this.uLoc(this.traceRayProg, 'u_maxBounces'), 8);
    gl.uniform1i(this.uLoc(this.traceRayProg, 'u_maxMarchSteps'), opts.maxMarchSteps ?? 64);
    gl.uniform1f(this.uLoc(this.traceRayProg, 'u_gammaD'), gammaD);
    gl.uniform4f(this.uLoc(this.traceRayProg, 'u_jitter'), jx, jy, jz, jw);
    gl.uniform3f(
      this.uLoc(this.traceRayProg, 'u_emitterParams'),
      opts.emitterZ,
      opts.beamRadiusX,
      opts.beamRadiusY,
    );
    gl.uniform1f(this.uLoc(this.traceRayProg, 'u_fanSpreadRad'), opts.fanSpreadRad);
    gl.uniform2f(
      this.uLoc(this.traceRayProg, 'u_focalParams'),
      opts.focalPlaneZ,
      opts.focalSlabHalf,
    );

    gl.bindVertexArray(this.emptyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tfObj);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.rayPathVbo);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, totalWavefrontRays);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // GPU-resident PBO upload into 704x263 RGBA32F rayPathTex (zero CPU readback, zero VAO divisor staging!)
    const uploadRows = Math.max(1, Math.ceil(totalWavefrontRays / RAYS_PER_TEX_ROW));
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, this.rayPathVbo);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, this.rayPathTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      RAY_TEX_WIDTH,
      uploadRows,
      gl.RGBA,
      gl.FLOAT,
      0,
    );
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);

    // 2. Single-Draw Zero-Attribute Additive Splat Pass (invokes ONLY non-masked beam & Airy rays!)
    const viewProj = computeViewProjMatrix(cam);
    gl.bindFramebuffer(gl.FRAMEBUFFER, splatFbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (opts.viewportRect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(vp[0], vp[1], vp[2], vp[3]);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rayPathTex);

    const beamStride = beamMask > 0 ? beamMask + 1 : 1;
    const activeRaysPerStep = Math.max(1, Math.ceil(raysThisStep / beamStride));
    const lineWidthComp = Math.max(1.0, opts.beamHalfWidthPx * 1.18);
    gl.useProgram(this.beamProg);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_rayTex'), 0);
    gl.uniformMatrix4fv(this.uLoc(this.beamProg, 'u_viewProj'), false, viewProj);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_raysThisStep'), raysThisStep);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_raysPerBand'), raysPerBand);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_activeRaysPerStep'), activeRaysPerStep);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_beamMask'), beamMask);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_beamStride'), beamStride);
    gl.uniform1i(this.uLoc(this.beamProg, 'u_baseStep'), baseStep);
    gl.uniform1f(
      this.uLoc(this.beamProg, 'u_rayGain'),
      opts.rayGain * rayGainScale * lineWidthComp * beamMaskComp,
    );
    gl.uniform1f(this.uLoc(this.beamProg, 'u_batchScale'), batchScale);

    const activeSegments = Math.min(PATH_SEGMENTS, elements.length * 2 + 1);
    gl.drawArraysInstanced(gl.LINES, 0, activeSegments * 2, steps * activeRaysPerStep);

    if (opts.airyGain > 0.0) {
      const airyPerBand = Math.max(1, Math.floor(raysPerBand / 4));
      const airyRaysPerStep = airyPerBand * 7;
      gl.useProgram(this.airyProg);
      gl.uniform1i(this.uLoc(this.airyProg, 'u_rayTex'), 0);
      gl.uniformMatrix4fv(this.uLoc(this.airyProg, 'u_viewProj'), false, viewProj);
      gl.uniform1i(this.uLoc(this.airyProg, 'u_raysThisStep'), raysThisStep);
      gl.uniform1i(this.uLoc(this.airyProg, 'u_raysPerBand'), raysPerBand);
      gl.uniform1i(this.uLoc(this.airyProg, 'u_airyPerBand'), airyPerBand);
      gl.uniform1i(this.uLoc(this.airyProg, 'u_airyRaysPerStep'), airyRaysPerStep);
      gl.uniform1f(this.uLoc(this.airyProg, 'u_airyRadiusPx'), opts.airyRadiusPx);
      gl.uniform1f(this.uLoc(this.airyProg, 'u_airyGain'), opts.airyGain * rayGainScale);
      gl.uniform1f(this.uLoc(this.airyProg, 'u_batchScale'), batchScale);
      gl.drawArrays(gl.POINTS, 0, steps * airyRaysPerStep);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.stepCounter += steps;
    this.accumFrames += steps;

    // Tier 2 RGBA8 ping-pong running-mean resolve
    if (isRgba8 && ts.accumFboB && ts.accumTexB && ts.scratchBatchTex) {
      const readTex = ts.pingIdx === 0 ? ts.accumTexA : ts.accumTexB;
      const writeFbo = ts.pingIdx === 0 ? ts.accumFboB : ts.accumFboA;

      const accumProg = this.getRgba8AccumProg();
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
      gl.viewport(0, 0, ts.accumW, ts.accumH);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(accumProg);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.uLoc(accumProg, 'u_prevAccumTex'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ts.scratchBatchTex);
      gl.uniform1i(this.uLoc(accumProg, 'u_batchTex'), 1);

      gl.uniform1i(this.uLoc(accumProg, 'u_accumIndex'), this.accumFrames);
      gl.uniform1i(this.uLoc(accumProg, 'u_batchSteps'), steps);
      gl.uniform1f(this.uLoc(accumProg, 'u_batchScale'), batchScale);

      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);

      ts.pingIdx = 1 - ts.pingIdx;
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private getActiveAccumTex(ts: RenderTargetSet): WebGLTexture {
    if (this.caps.fboFormat === 'RGBA8' && ts.accumTexB) {
      return ts.pingIdx === 0 ? ts.accumTexA : ts.accumTexB;
    }
    return ts.accumTexA;
  }

  private renderMainResolve(cam: BenchCameraMapping): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.executeResolvePass(
      null,
      [0, 0, w, h],
      this.getActiveAccumTex(this.mainTargets),
      this.accumFrames,
      cam,
      this.bench.elements,
      {
        camMarchSteps: 12,
        printMode: this.bench.printMode,
        isSchematicView: this.bench.viewMode === 'schematic',
        showHudHandles: !this.bench.printMode,
        selectedElemIdx: this.bench.selectedElementIndex,
        exposure: this.bench.printMode ? 2.85 : 3.45,
        rimScale: 1.0,
        emitterZ: -2.85,
        focalScaleZ: 2.35,
      },
    );

    if (this.bench.viewMode === 'schematic') {
      this.drawSchematicDiscreteOverlay(
        null,
        [0, 0, w, h],
        cam,
        this.bench.elements,
        this.bench.dispersionBoost,
        this.bench.printMode,
        Math.max(1.0, h / 650.0),
      );
    }
  }

  public executeResolvePass(
    targetFbo: WebGLFramebuffer | null,
    vp: [number, number, number, number],
    accumTex: WebGLTexture,
    accumFrames: number,
    cam: BenchCameraMapping,
    elements: readonly OpticalElementState[],
    opts: {
      camMarchSteps?: number;
      printMode: boolean;
      isSchematicView: boolean;
      showHudHandles: boolean;
      selectedElemIdx: number;
      exposure: number;
      rimScale: number;
      emitterZ: number;
      focalScaleZ: number;
      scissor?: boolean;
    },
  ): void {
    const gl = this.gl;
    const vpW = Math.max(1, vp[2]);
    const vpH = Math.max(1, vp[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(vp[0], vp[1], vpW, vpH);
    if (opts.scissor) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(vp[0], vp[1], vpW, vpH);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.disable(gl.BLEND);

    const prog = opts.isSchematicView
      ? this.getResolveSchematicProg()
      : this.getResolveBenchProg();
    gl.useProgram(prog);
    this.uploadElementUniforms(prog, elements);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumTex);
    gl.uniform1i(this.uLoc(prog, 'u_accumTex'), 0);
    gl.uniform1i(this.uLoc(prog, 'u_isRgba8'), this.caps.fboFormat === 'RGBA8' ? 1 : 0);
    gl.uniform1i(this.uLoc(prog, 'u_accumFrames'), Math.max(1, accumFrames));
    gl.uniform1i(this.uLoc(prog, 'u_printMode'), opts.printMode ? 1 : 0);
    gl.uniform1i(this.uLoc(prog, 'u_showHudHandles'), opts.showHudHandles ? 1 : 0);
    gl.uniform1i(this.uLoc(prog, 'u_selectedElemIdx'), opts.selectedElemIdx);
    gl.uniform1f(this.uLoc(prog, 'u_exposure'), opts.exposure);
    gl.uniform1f(this.uLoc(prog, 'u_rimScale'), opts.rimScale);
    gl.uniform2f(this.uLoc(prog, 'u_viewportSize'), vpW, vpH);
    gl.uniform1f(this.uLoc(prog, 'u_aspect'), cam.aspect);
    gl.uniform2f(this.uLoc(prog, 'u_benchGuides'), opts.emitterZ, opts.focalScaleZ);

    if (opts.isSchematicView) {
      gl.uniform3f(
        this.uLoc(prog, 'u_orthoParams'),
        cam.orthoHalfZ,
        cam.centerZ,
        cam.centerX,
      );
    } else {
      const basis = computeCameraBasis(cam);
      gl.uniform3fv(this.uLoc(prog, 'u_camEye'), basis.eye);
      gl.uniform3fv(this.uLoc(prog, 'u_camFwd'), basis.fwd);
      gl.uniform3fv(this.uLoc(prog, 'u_camRight'), basis.right);
      gl.uniform3fv(this.uLoc(prog, 'u_camUp'), basis.camUp);
      gl.uniform1f(this.uLoc(prog, 'u_tanHalfFov'), basis.tanHalfFov);
    }

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public drawSchematicDiscreteOverlay(
    targetFbo: WebGLFramebuffer | null,
    vp: [number, number, number, number],
    cam: BenchCameraMapping,
    elements: readonly OpticalElementState[],
    gammaD: number,
    printMode: boolean,
    pxScale: number,
    opts?: {
      rayCount?: number;
      emitterZ?: number;
      beamHalfSpan?: number;
      includeGrazingTirBundle?: boolean;
      scissor?: boolean;
    },
  ): void {
    const rayCount = opts?.rayCount ?? 15;
    const emitterZ = opts?.emitterZ ?? -2.85;
    const beamHalfSpan = opts?.beamHalfSpan ?? 0.36;
    const includeTirBundle = opts?.includeGrazingTirBundle ?? true;

    const soot = ARCHIVAL_LITHO_PALETTE.INK_PINE_SOOT_RGB;
    const prussian = ARCHIVAL_LITHO_PALETTE.INK_PRUSSIAN_BLUE_RGB;
    const ochre = ARCHIVAL_LITHO_PALETTE.INK_MINERAL_OCHRE_RGB;
    const cinnabar = ARCHIVAL_LITHO_PALETTE.INK_CINNABAR_RGB;

    const bandColorsLitho: readonly (readonly [number, number, number])[] = [
      prussian,
      [0.12, 0.30, 0.49],
      [0.16, 0.40, 0.44],
      [0.34, 0.44, 0.24],
      ochre,
      [0.72, 0.32, 0.17],
      cinnabar,
    ];
    const bandColorsDark: readonly (readonly [number, number, number])[] = [
      [0.48, 0.30, 0.98],
      [0.25, 0.52, 0.98],
      [0.12, 0.85, 0.72],
      [0.35, 0.92, 0.32],
      [0.96, 0.72, 0.18],
      [0.98, 0.36, 0.18],
      [0.92, 0.18, 0.16],
    ];

    const segs: number[] = [];
    const pushSeg = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      hw: number,
      rgb: readonly [number, number, number],
      alpha: number,
    ) => {
      segs.push(x0, 0.0, z0, hw, x1, 0.0, z1, 0.0, rgb[0], rgb[1], rgb[2], alpha);
    };

    const pushCircle = (
      cx: number,
      cz: number,
      radiusWorld: number,
      hw: number,
      rgb: readonly [number, number, number],
      alpha: number,
    ) => {
      const N = 12;
      for (let m = 0; m < N; m++) {
        const a0 = (m / N) * Math.PI * 2.0;
        const a1 = ((m + 1) / N) * Math.PI * 2.0;
        pushSeg(
          cx + Math.cos(a0) * radiusWorld,
          cz + Math.sin(a0) * radiusWorld,
          cx + Math.cos(a1) * radiusWorld,
          cz + Math.sin(a1) * radiusWorld,
          hw,
          rgb,
          alpha,
        );
      }
    };

    for (let r = 0; r < rayCount; r++) {
      const u = rayCount === 1 ? 0.0 : (r / (rayCount - 1)) * 2.0 - 1.0;
      const x0 = u * beamHalfSpan;

      for (let k = 0; k < 7; k++) {
        const res = traceOpticalRay3D(
          [x0, 0.0, emitterZ],
          [0.0, 0.0, 1.0],
          k,
          gammaD,
          elements,
          2.35,
        );
        const verts = res.vertices;
        for (let b = 0; b < verts.length - 1; b++) {
          const v0 = verts[b];
          const v1 = verts[b + 1];
          if (b === 0) {
            if (k === 3) {
              const incCol = printMode ? soot : ([0.88, 0.90, 0.95] as const);
              pushSeg(v0.x, v0.z, v1.x, v1.z, 1.35 * pxScale, incCol, printMode ? 0.62 : 0.55);
              if (r % 3 === 1) {
                const mx = v0.x + (v1.x - v0.x) * 0.52;
                const mz = v0.z + (v1.z - v0.z) * 0.52;
                pushSeg(mx + 0.028, mz - 0.048, mx, mz, 1.3 * pxScale, incCol, 0.78);
                pushSeg(mx - 0.028, mz - 0.048, mx, mz, 1.3 * pxScale, incCol, 0.78);
              }
            }
          } else {
            const isTirSeg = v0.isTIR;
            const col = isTirSeg
              ? cinnabar
              : printMode
                ? bandColorsLitho[k]
                : bandColorsDark[k];
            const hw = (isTirSeg ? 1.75 : 1.18) * pxScale;
            const alpha = isTirSeg ? 0.85 : printMode ? 0.48 : 0.45;
            pushSeg(v0.x, v0.z, v1.x, v1.z, hw, col, alpha);

            if (isTirSeg && (k === 0 || k === 6)) {
              pushCircle(v0.x, v0.z, 0.032, 1.35 * pxScale, cinnabar, 0.88);
            }
          }
        }
      }
    }

    if (includeTirBundle) {
      const prismElem = elements.find((e) => e.archetype === 3);
      if (prismElem) {
        for (let m = -1; m <= 1; m++) {
          const aimX = prismElem.x + 0.14 + m * 0.045;
          const aimZ = prismElem.z - 0.35;
          const dirX = -0.34;
          const dirZ = 0.94;
          for (const k of [0, 3, 6]) {
            const res = traceOpticalRay3D(
              [aimX, 0.0, aimZ],
              [dirX, 0.0, dirZ],
              k,
              gammaD,
              [prismElem],
              2.35,
            );
            const verts = res.vertices;
            for (let b = 0; b < verts.length - 1; b++) {
              const v0 = verts[b];
              const v1 = verts[b + 1];
              const col = v0.isTIR
                ? cinnabar
                : printMode
                  ? bandColorsLitho[k]
                  : bandColorsDark[k];
              pushSeg(
                v0.x,
                v0.z,
                v1.x,
                v1.z,
                (v0.isTIR ? 1.9 : 1.25) * pxScale,
                col,
                v0.isTIR ? 0.90 : 0.55,
              );
              if (v0.isTIR && k === 0) {
                pushCircle(v0.x, v0.z, 0.036, 1.45 * pxScale, cinnabar, 0.92);
              }
            }
          }
        }
      }
    }

    this.drawRawSegments(targetFbo, vp, cam, segs, opts?.scissor ?? false);
  }

  public drawRawSegments(
    targetFbo: WebGLFramebuffer | null,
    vp: [number, number, number, number],
    cam: BenchCameraMapping,
    segs: readonly number[],
    scissor: boolean,
  ): void {
    const count = Math.floor(segs.length / 12);
    if (count <= 0) return;

    const gl = this.gl;
    const data = new Float32Array(segs);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.discreteRayVbo);
    if (data.length > this.discreteRayCapFloats) {
      this.discreteRayCapFloats = Math.ceil(data.length * 1.5);
      gl.bufferData(gl.ARRAY_BUFFER, this.discreteRayCapFloats * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const vpW = Math.max(1, vp[2]);
    const vpH = Math.max(1, vp[3]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(vp[0], vp[1], vpW, vpH);
    if (scissor) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(vp[0], vp[1], vpW, vpH);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

    const viewProj = computeViewProjMatrix(cam);
    const discProg = this.getDiscreteRayProg();
    gl.useProgram(discProg);
    gl.uniformMatrix4fv(this.uLoc(discProg, 'u_viewProj'), false, viewProj);
    gl.uniform2f(this.uLoc(discProg, 'u_viewportSize'), vpW, vpH);

    gl.bindVertexArray(this.discreteRayVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public renderCanonicalPlate(
    plateId: 'caustic-hero' | 'caustic-schematic' | 'caustic-tilt-matrix' | 'caustic-thumb',
    ts: RenderTargetSet,
    oversizedFastCap: boolean,
  ): void {
    const gl = this.gl;
    const resW = Math.max(1, ts.resolveW);
    const resH = Math.max(1, ts.resolveH);
    const accH = Math.max(16, ts.accumH);
    const aspect = resW / Math.max(1, resH);

    this.rng = new Rng64(DEFAULT_SEED_U64);
    this.stepCounter = 0;
    this.accumFrames = 0;
    this.clearAccumTarget(ts);

    if (plateId === 'caustic-hero') {
      const elems = buildPresetElements(1, DEFAULT_SEED_U64);
      const cam: BenchCameraMapping = {
        viewMode: 'bench',
        aspect,
        orthoHalfZ: 3.05,
        centerZ: 0.12,
        centerX: -0.04,
        eye: [-1.36, 3.62, 0.14],
        target: [-0.04, 0.0, 0.14],
        up: [1.0, 0.0, 0.0],
        fovYRad: (35.0 * Math.PI) / 180.0,
      };
      const batches = oversizedFastCap ? 16 : 100;
      const accScale = accH / 490.0;
      this.runPhotonAccumulationSteps(batches, ts, cam, elems, {
        gammaD: 3.85,
        emitterZ: -2.85,
        beamRadiusX: 0.38,
        beamRadiusY: 0.22,
        focalPlaneZ: 1.92,
        focalSlabHalf: 0.36,
        fanSpreadRad: 0.015,
        beamHalfWidthPx: Math.max(1.2, 1.45 * accScale),
        rayGain: 0.038,
        airyRadiusPx: Math.max(8.0, 12.0 * accScale),
        airyGain: 0.048,
      });
      this.executeResolvePass(
        ts.resolveFbo,
        [0, 0, resW, resH],
        this.getActiveAccumTex(ts),
        this.accumFrames,
        cam,
        elems,
        {
          printMode: false,
          isSchematicView: false,
          showHudHandles: false,
          selectedElemIdx: -1,
          exposure: 3.25,
          rimScale: 1.2,
          emitterZ: -2.85,
          focalScaleZ: 2.35,
        },
      );
      return;
    }

    if (plateId === 'caustic-schematic') {
      const elems = buildPresetElements(1, DEFAULT_SEED_U64);
      const cam: BenchCameraMapping = {
        viewMode: 'schematic',
        aspect,
        orthoHalfZ: 2.98,
        centerZ: 0.02,
        centerX: -0.02,
        eye: [0, 4, 0],
        target: [0, 0, 0],
        up: [1, 0, 0],
        fovYRad: 0.6,
      };
      const batches = oversizedFastCap ? 12 : 36;
      const accScale = accH / 280.0;
      this.runPhotonAccumulationSteps(batches, ts, cam, elems, {
        gammaD: 4.15,
        emitterZ: -2.76,
        beamRadiusX: 0.36,
        beamRadiusY: 0.04,
        focalPlaneZ: 2.02,
        focalSlabHalf: 0.22,
        fanSpreadRad: 0.010,
        beamHalfWidthPx: Math.max(1.1, 1.40 * accScale),
        rayGain: 0.034,
        airyRadiusPx: Math.max(7.0, 10.0 * accScale),
        airyGain: 0.025,
      });
      const pxScale = Math.max(0.75, resH / 280.0);
      this.executeResolvePass(
        ts.resolveFbo,
        [0, 0, resW, resH],
        this.getActiveAccumTex(ts),
        this.accumFrames,
        cam,
        elems,
        {
          printMode: true,
          isSchematicView: true,
          showHudHandles: false,
          selectedElemIdx: -1,
          exposure: 1.55,
          rimScale: 1.1,
          emitterZ: -2.76,
          focalScaleZ: 2.38,
        },
      );
      this.drawSchematicDiscreteOverlay(
        ts.resolveFbo,
        [0, 0, resW, resH],
        cam,
        elems,
        4.15,
        true,
        pxScale * 0.58,
        {
          rayCount: 15,
          emitterZ: -2.76,
          beamHalfSpan: 0.36,
          includeGrazingTirBundle: true,
        },
      );
      return;
    }

    if (plateId === 'caustic-tilt-matrix') {
      const tiltsDeg = [0, 7, 15, 24] as const;
      const cellBaseW = Math.floor(resW / 4);
      const batches = oversizedFastCap ? 10 : 32;

      gl.bindFramebuffer(gl.FRAMEBUFFER, ts.resolveFbo);
      gl.viewport(0, 0, resW, resH);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0.9647, 0.9569, 0.9373, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      for (let c = 0; c < 4; c++) {
        const rx = Math.floor((c * resW) / 4);
        const rw = Math.floor(((c + 1) * resW) / 4) - rx;
        if (rw <= 0) continue;
        const cellAspect = rw / Math.max(1, resH);

        this.rng = new Rng64(DEFAULT_SEED_U64);
        this.stepCounter = 0;
        this.accumFrames = 0;
        this.clearAccumTarget(ts);

        const elems = buildTiltMatrixCellElements(tiltsDeg[c]);
        const cam: BenchCameraMapping = {
          viewMode: 'schematic',
          aspect: cellAspect,
          orthoHalfZ: 1.18,
          centerZ: 0.92,
          centerX: 0.05 * (c / 3),
          eye: [0, 4, 0],
          target: [0, 0, 0],
          up: [1, 0, 0],
          fovYRad: 0.6,
        };

        const accScale = accH / 190.0;
        this.runPhotonAccumulationSteps(batches, ts, cam, elems, {
          gammaD: 4.2,
          emitterZ: -2.15,
          beamRadiusX: 0.44,
          beamRadiusY: 0.04,
          focalPlaneZ: 1.56,
          focalSlabHalf: 0.05 + c * 0.04,
          fanSpreadRad: 0.008,
          beamHalfWidthPx: Math.max(1.1, 1.35 * accScale),
          rayGain: 0.044,
          airyRadiusPx: Math.max(8.0, (16.0 - c * 1.5) * accScale),
          airyGain: 0.055,
        });

        this.executeResolvePass(
          ts.resolveFbo,
          [rx, 0, rw, resH],
          this.getActiveAccumTex(ts),
          this.accumFrames,
          cam,
          elems,
          {
            printMode: true,
            isSchematicView: true,
            showHudHandles: false,
            selectedElemIdx: -1,
            exposure: 2.25,
            rimScale: 1.15,
            emitterZ: -2.15,
            focalScaleZ: 1.56,
            scissor: true,
          },
        );

        const pxScale = Math.max(0.75, resH / 190.0);
        this.drawSchematicDiscreteOverlay(
          ts.resolveFbo,
          [rx, 0, rw, resH],
          cam,
          elems,
          4.2,
          true,
          pxScale * 0.46,
          {
            rayCount: 11,
            emitterZ: -2.15,
            beamHalfSpan: 0.42,
            includeGrazingTirBundle: false,
            scissor: true,
          },
        );
      }

      if (resW >= 8 && resH >= 4) {
        const borderCam: BenchCameraMapping = {
          viewMode: 'schematic',
          aspect,
          orthoHalfZ: 1.0,
          centerZ: 0.0,
          centerX: 0.0,
          eye: [0, 4, 0],
          target: [0, 0, 0],
          up: [1, 0, 0],
          fovYRad: 0.6,
        };
        const halfX = 1.0 / Math.max(0.25, aspect);
        const soot = ARCHIVAL_LITHO_PALETTE.INK_PINE_SOOT_RGB;
        const borderHw = Math.max(1.2, 2.0 * (resH / 190.0) * 0.5);
        const divSegs: number[] = [];
        const addLine = (z0: number, x0: number, z1: number, x1: number, hw: number) => {
          divSegs.push(x0, 0, z0, hw, x1, 0, z1, 0, soot[0], soot[1], soot[2], 0.92);
        };
        for (let c = 1; c <= 3; c++) {
          const zNdc = ((c * cellBaseW) / resW) * 2.0 - 1.0;
          addLine(zNdc, -halfX, zNdc, halfX, borderHw);
        }
        addLine(-0.998, -halfX * 0.994, 0.998, -halfX * 0.994, borderHw);
        addLine(-0.998, halfX * 0.994, 0.998, halfX * 0.994, borderHw);
        addLine(-0.998, -halfX * 0.994, -0.998, halfX * 0.994, borderHw);
        addLine(0.998, -halfX * 0.994, 0.998, halfX * 0.994, borderHw);

        this.drawRawSegments(ts.resolveFbo, [0, 0, resW, resH], borderCam, divSegs, false);
      }
      return;
    }

    // 'caustic-thumb' — 2.2x Macro Dark-Chamber zoom
    const elems = buildThumbMacroElements();
    const cam: BenchCameraMapping = {
      viewMode: 'bench',
      aspect,
      orthoHalfZ: 1.65,
      centerZ: 0.38,
      centerX: -0.08,
      eye: [-0.88, 2.15, 0.36],
      target: [-0.08, 0.0, 0.36],
      up: [1.0, 0.0, 0.0],
      fovYRad: (34.0 * Math.PI) / 180.0,
    };
    const batches = oversizedFastCap ? 12 : 48;
    const accScale = Math.max(0.75, accH / 90.0);
    this.runPhotonAccumulationSteps(batches, ts, cam, elems, {
      gammaD: 4.6,
      emitterZ: -1.95,
      beamRadiusX: 0.36,
      beamRadiusY: 0.16,
      focalPlaneZ: 1.55,
      focalSlabHalf: 0.24,
      fanSpreadRad: 0.014,
      beamHalfWidthPx: Math.max(1.5, 1.30 * accScale),
      rayGain: 0.046,
      airyRadiusPx: Math.max(7.5, 6.0 * accScale),
      airyGain: 0.062,
    });
    this.executeResolvePass(
      ts.resolveFbo,
      [0, 0, resW, resH],
      this.getActiveAccumTex(ts),
      this.accumFrames,
      cam,
      elems,
      {
        printMode: false,
        isSchematicView: false,
        showHudHandles: false,
        selectedElemIdx: -1,
        exposure: 3.35,
        rimScale: 1.75,
        emitterZ: -1.95,
        focalScaleZ: 1.85,
      },
    );
  }

  public pollGlError(): number {
    const err = this.gl.getError();
    if (err !== this.gl.NO_ERROR) {
      this.lastGlError = err;
    }
    return this.lastGlError;
  }
}
