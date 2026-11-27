import type { OpticalBenchRenderer, RenderTargetSet } from '../optics/opticalBenchRenderer';
import { DEFAULT_SEED_U64 } from '../shared/benchConfig';

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

const TILT_MATRIX_LABELS = ['0°', '7°', '15°', '24°'] as const;

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

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
  const maxAccDim = oversized ? 512 : 1024;
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

    if (plateId === 'caustic-schematic' && clampedW >= 480 && clampedH >= 240) {
      const fontPx = Math.max(10, Math.min(24, Math.round(clampedH * 0.0155)));
      const padX = Math.max(16, Math.round(clampedW * 0.018));
      const padY = Math.max(14, Math.round(clampedH * 0.024));
      const dotR = Math.max(2.5, fontPx * 0.27);
      const baselineY = clampedH - padY;

      ctx.save();
      ctx.fillStyle = '#b83a2a';
      ctx.beginPath();
      ctx.arc(padX + dotR, baselineY - fontPx * 0.34, dotR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(29, 26, 22, 0.72)';
      ctx.font = `${fontPx}px "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(
        `CAUSTIC COLLIMATION · Off-Axis Coma · γD=4.15× · Θ=21.9° · SEED ${DEFAULT_SEED_U64.toString(10)}`,
        padX + dotR * 2 + Math.round(fontPx * 0.65),
        baselineY,
      );
      ctx.restore();
    }

    if (plateId === 'caustic-tilt-matrix' && clampedW >= 16 && clampedH >= 8) {
      ctx.save();
      const lineW = Math.max(1, Math.round(clampedH * 0.0045));
      const halfLw = lineW * 0.5;

      // Subtle neutral-gray vertical cell dividers
      ctx.strokeStyle = 'rgba(122, 126, 134, 0.52)';
      ctx.lineWidth = lineW;
      ctx.beginPath();
      for (let c = 1; c <= 3; c++) {
        const divX = Math.floor((c * clampedW) / 4) + (lineW % 2 === 1 ? 0.5 : 0);
        ctx.moveTo(divX, lineW);
        ctx.lineTo(divX, clampedH - lineW);
      }
      ctx.stroke();

      // Refined hairline outer frame harmonious with schematic lithograph plates
      ctx.strokeStyle = 'rgba(138, 142, 150, 0.58)';
      ctx.lineWidth = lineW;
      ctx.strokeRect(halfLw, halfLw, clampedW - lineW, clampedH - lineW);

      // High-contrast top-left tilt angle badges (0°, 7°, 15°, 24°), sized to stay sharp when downscaled
      if (clampedW >= 240 && clampedH >= 80) {
        const cellWAvg = clampedW / 4;
        const fontPx = Math.max(12, Math.min(54, Math.round(Math.min(clampedH * 0.080, cellWAvg * 0.105))));
        const padX = Math.max(8, Math.round(cellWAvg * 0.050));
        const padY = Math.max(8, Math.round(clampedH * 0.040));
        const innerX = Math.max(6, Math.round(fontPx * 0.40));
        const pillH = Math.round(fontPx * 1.46);
        const radius = Math.max(3, Math.round(fontPx * 0.24));
        const minPillW = Math.round(fontPx * 2.15);

        ctx.font = `700 ${fontPx}px "DejaVu Sans Mono", "Liberation Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        for (let c = 0; c < 4; c++) {
          const rx = Math.floor((c * clampedW) / 4);
          const label = TILT_MATRIX_LABELS[c];
          const metrics = ctx.measureText(label);
          const pillW = Math.max(minPillW, Math.ceil(metrics.width + innerX * 2));
          const pillX = rx + padX;
          const pillY = padY;

          traceRoundedRect(ctx, pillX, pillY, pillW, pillH, radius);
          ctx.fillStyle = 'rgba(20, 24, 31, 0.84)';
          ctx.fill();

          const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.72;
          const descent = metrics.actualBoundingBoxDescent || fontPx * 0.10;
          const baselineY = pillY + pillH * 0.5 + (ascent - descent) * 0.5;
          ctx.fillStyle = '#F3F2EE';
          ctx.fillText(label, pillX + pillW * 0.5, baselineY);
        }
      }

      ctx.restore();
    }

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
