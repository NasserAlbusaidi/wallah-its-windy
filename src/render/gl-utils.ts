/**
 * gl-utils.ts — thin WebGL2 helpers shared by the render layers.
 *
 * Kept deliberately small: shader compile/link with a loud error, a fullscreen
 * clip quad, and render-target creation with the half-float -> UNSIGNED_BYTE
 * fallback the spec requires (WebGL2 hygiene). No GL constants leak into the
 * layer modules except through these helpers where practical.
 */

/** Compile a shader, throwing with the driver info-log on failure. */
function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('render: gl.createShader returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`render: shader compile failed:\n${log}\n---\n${src}`);
  }
  return sh;
}

/** Link a program from vertex + fragment GLSL. Throws on failure. */
export function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  if (!p) throw new Error('render: gl.createProgram returned null');
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  // Shaders can be detached+deleted once linked; the program keeps what it needs.
  gl.detachShader(p, v);
  gl.detachShader(p, f);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`render: program link failed:\n${log}`);
  }
  return p;
}

/** Clip-space corners for a fullscreen triangle strip (two triangles). */
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

/**
 * Build a VAO drawing a fullscreen clip quad through `a_pos` (vec2). The frag
 * shader reconstructs the domain UV from the interpolated clip position.
 */
export function makeQuadVao(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('render: createVertexArray returned null');
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/** Feature flags for float textures/targets, probed once. */
export interface GlCaps {
  colorBufferFloat: boolean;
  floatLinear: boolean;
}

export function probeCaps(gl: WebGL2RenderingContext): GlCaps {
  return {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
  };
}

/** A ping-pong pair of same-format render targets (for the rain accumulator). */
export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  /** True when this target is a 16-bit float; false after UNSIGNED_BYTE fallback. */
  float: boolean;
}

/**
 * Create an RGBA render target at (w,h). Tries RGBA16F when EXT_color_buffer_float
 * is present and falls back to RGBA8 if unavailable or the FBO is incomplete —
 * the accumulation maths clamp to [0,1] either way, so 8-bit degrades gracefully.
 * Cloud-memory requires 8-bit unorm storage because its tail and age-reset
 * contracts are defined on stored bytes (spec section 2).
 */
export function makeRenderTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  caps: GlCaps,
  forceRgba8 = false,
): RenderTarget {
  const wantFloat = caps.colorBufferFloat && !forceRgba8;
  // LINEAR upsamples the half-res accumulation smoothly. RGBA16F is texture-
  // FILTERABLE in core WebGL2 (OES_texture_float_linear only gates 32-bit float
  // filtering), and the RGBA8 fallback filters linearly too — so LINEAR is always
  // valid here. caps.floatLinear stays probed for any future 32F target.
  const filter = gl.LINEAR;
  const tex = gl.createTexture();
  if (!tex) throw new Error('render: createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let float = wantFloat;
  if (wantFloat) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('render: createFramebuffer returned null');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && wantFloat) {
    // Float target rejected by the driver despite the extension — fall back.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    float = false;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fbo, tex, float };
}

export function disposeRenderTarget(gl: WebGL2RenderingContext, rt: RenderTarget | null): void {
  if (!rt) return;
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.tex);
}

/** Bind a texture to a unit and point a sampler uniform at it. */
export function bindTex(
  gl: WebGL2RenderingContext,
  unit: number,
  tex: WebGLTexture | null,
  loc: WebGLUniformLocation | null,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (loc) gl.uniform1i(loc, unit);
}
