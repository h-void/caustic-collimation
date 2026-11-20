import type { OpticalBenchRenderer, RenderTargetSet } from '../optics/opticalBenchRenderer';

export type ArchivalPlateId =
  | 'caustic-hero'
  | 'caustic-schematic'
  | 'caustic-tilt-matrix'
  | 'caustic-thumb';

const VALID_PLATES = new Set<string>([
  'caustic-hero',
  'caustic-schematic',
  'caustic-tilt-matrix',
  'caustic-thumb',
]);

/**
 * Deterministic supersampled archival plate exporter (`window.__renderArchivalPlate`).
 * - Clamps (width, height) safely to [1, min(MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE)].
 * - Keeps internal accumulation FBOs >= 16x16 for shader safety and applies OOM-safe intermediate
 *   FBO cap when clampedW > 4096 || clampedH > 4096, in-place single-buffer vertical Y-flip (`A = 255`),
 *   and immediate GL disposal before PNG encode.
 * - Restores all WebGL, optical bench, PRNG, and live RAF state in `finally`.
 */
export async function renderArchivalPlate(
  renderer: OpticalBenchRenderer,
  plateId: string,
  width: number,
  height: number,
): Promise<string> {
  if (typeof plateId !== 'string' || !VALID_PLATES.has(plateId)) {
    throw new Error(`Unsupported archival plateId: ${String(plateId)}`);
  }
  if (typeof width !== 'number' || typeof height !== 'number' || Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error(`Invalid plate dimensions: ${String(width)}x${String(height)}`);
  }

  const gl = renderer.gl;
  const maxGpuDim = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
  );
  const clampedW = !Number.isFinite(width)
    ? width > 0
      ? maxGpuDim
      : 1
    : Math.max(1, Math.min(maxGpuDim, Math.round(width)));
  const clampedH = !Number.isFinite(height)
    ? height > 0
      ? maxGpuDim
      : 1
    : Math.max(1, Math.min(maxGpuDim, Math.round(height)));

  const rawAccumW =
    plateId === 'caustic-tilt-matrix'
      ? Math.max(16, Math.floor(clampedW / 4))
      : Math.max(16, clampedW);
  const rawAccumH = Math.max(16, clampedH);
  const oversized = clampedW > 4096 || clampedH > 4096;
  const maxAccDim = oversized ? 512 : 680;
  const scale = Math.min(1.0, maxAccDim / Math.max(rawAccumW, rawAccumH));
  const accumW = Math.max(16, Math.round(rawAccumW * scale));
  const accumH = Math.max(16, Math.round(rawAccumH * scale));

  const wasRunning = renderer.pauseLoop();
  const snapshot = renderer.cloneState();
  let tempTargets: RenderTargetSet | null = null;

  try {
    tempTargets = renderer.allocateTargetSet(accumW, accumH, clampedW, clampedH, true);
    renderer.renderCanonicalPlate(plateId as ArchivalPlateId, tempTargets, oversized);

    gl.bindFramebuffer(gl.FRAMEBUFFER, tempTargets.resolveFbo);
    gl.finish();
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

    const raw = new Uint8Array(clampedW * clampedH * 4);
    gl.readPixels(0, 0, clampedW, clampedH, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Free temporary WebGL textures/FBOs immediately BEFORE allocating Canvas2D backing store
    renderer.disposeTargetSet(tempTargets);

    // In-place vertical Y-flip (WebGL bottom-left -> PNG top-left) + strict opaque A = 255
    const rowBytes = clampedW * 4;
    const rowScratch = new Uint8Array(rowBytes);
    const halfH = Math.floor(clampedH / 2);

    for (let y = 0; y < halfH; y++) {
      const topOff = y * rowBytes;
      const botOff = (clampedH - 1 - y) * rowBytes;

      rowScratch.set(raw.subarray(topOff, topOff + rowBytes));
      raw.copyWithin(topOff, botOff, botOff + rowBytes);
      raw.set(rowScratch, botOff);

      for (let x = 3; x < rowBytes; x += 4) {
        raw[topOff + x] = 255;
        raw[botOff + x] = 255;
      }
    }
    if ((clampedH & 1) === 1) {
      const midOff = halfH * rowBytes;
      for (let x = 3; x < rowBytes; x += 4) {
        raw[midOff + x] = 255;
      }
    }

    const canvas2d = document.createElement('canvas');
    canvas2d.width = clampedW;
    canvas2d.height = clampedH;
    const ctx = canvas2d.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for PNG export');
    }

    const clampedView = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength);
    ctx.putImageData(new ImageData(clampedView, clampedW, clampedH), 0, 0);
    const dataUrl = canvas2d.toDataURL('image/png');

    // Release temporary 2D canvas memory immediately
    canvas2d.width = 0;
    canvas2d.height = 0;

    return dataUrl;
  } finally {
    if (tempTargets) {
      renderer.disposeTargetSet(tempTargets);
    }
    renderer.restoreState(snapshot);
    renderer.restoreMainViewport();
    if (wasRunning) {
      renderer.resumeLoop();
    }
  }
}

export function installArchivalPlateExporter(renderer: OpticalBenchRenderer): void {
  window.__renderArchivalPlate = (plateId: string, width: number, height: number) =>
    renderArchivalPlate(renderer, plateId, width, height);
}
