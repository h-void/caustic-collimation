export interface FboCapabilities {
  fboFormat: 'RGBA16F' | 'RGBA8';
  internalFormat: number;
  format: number;
  type: number;
  filter: number;
  maxTargetDim: number;
  isSoftwareGl: boolean;
}

function detectSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  let rendererStr = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      rendererStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    }
    if (!rendererStr) {
      rendererStr = String(gl.getParameter(gl.RENDERER) || '');
    }
  } catch {
    rendererStr = '';
  }
  while (gl.getError() !== gl.NO_ERROR) {
    // Drain any probe error
  }
  return /swiftshader|llvmpipe|softpipe|software|mesa offscreen|basic render/i.test(rendererStr);
}

/**
 * Probes EXT_color_buffer_float + RGBA16F completeness cleanly, draining any probe GL errors,
 * and falls back to RGBA8 with mandatory gl.NEAREST filtering when unavailable.
 */
export function probeFboCapabilities(gl: WebGL2RenderingContext): FboCapabilities {
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRb = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const maxTargetDim = Math.max(256, Math.min(maxTex || 4096, maxRb || 4096));
  const isSoftwareGl = detectSoftwareRenderer(gl);

  const extFloat = gl.getExtension('EXT_color_buffer_float');
  // Optional float linear filtering (not required for HALF_FLOAT in WebGL2, safe to probe)
  gl.getExtension('OES_texture_float_linear');

  if (extFloat) {
    const testTex = gl.createTexture();
    const testFbo = gl.createFramebuffer();
    let ok = false;

    if (testTex && testFbo) {
      gl.bindTexture(gl.TEXTURE_2D, testTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 16, 16, 0, gl.RGBA, gl.HALF_FLOAT, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, testFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, testTex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      const err = gl.getError();
      ok = status === gl.FRAMEBUFFER_COMPLETE && err === gl.NO_ERROR;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (testFbo) gl.deleteFramebuffer(testFbo);
    if (testTex) gl.deleteTexture(testTex);
    while (gl.getError() !== gl.NO_ERROR) {
      // Drain any probe error so live diagnostics start at glError === 0
    }

    if (ok) {
      return {
        fboFormat: 'RGBA16F',
        internalFormat: gl.RGBA16F,
        format: gl.RGBA,
        type: gl.HALF_FLOAT,
        filter: gl.LINEAR,
        maxTargetDim,
        isSoftwareGl,
      };
    }
  }

  while (gl.getError() !== gl.NO_ERROR) {
    // Drain any probe error
  }

  return {
    fboFormat: 'RGBA8',
    internalFormat: gl.RGBA8,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    filter: gl.NEAREST,
    maxTargetDim,
    isSoftwareGl,
  };
}
