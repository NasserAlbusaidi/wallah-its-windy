/**
 * postfx.ts — screen-space bloom and vignette over the finished WebGL map.
 *
 * After every layer has drawn to the default framebuffer, the frame is
 * resolved (a blitFramebuffer, which also resolves the MSAA drawing buffer)
 * into a single-sample scene texture. A soft-knee bright pass feeds a
 * dual-filter (Kawase) down/up chain, and one composite pass writes
 * `(scene + bloom) * vignette` back to the screen.
 *
 * Presentation-only and layer-aware: no layer with a colour legend is
 * vignetted, and smooth value fields (scalars, rain totals) get no bloom, so
 * a legend reading is never shifted. If the driver rejects the resolve blit the pass
 * disables itself for the session and the map renders exactly as before.
 */

import type { WeatherLayerId } from '../weather-layers';
import { disposeRenderTarget, makeProgram, makeQuadVao, makeRenderTarget } from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';

export interface PostFxLook {
  /** Additive bloom gain; 0 disables the bright pass entirely. */
  bloom: number;
  /** Corner darkening, 0..1 (fraction of luminance removed at the corners). */
  vignette: number;
}

/**
 * Per-layer look. Vignette darkens every pixel near the corners, so only the
 * terrain instrument (no colour legend) carries it. Bloom only adds glow
 * around already-saturated pixels, so the flow, IR and radar products keep a
 * low amount; smooth scalar fields and rain totals, where a halo would read
 * as a value, get none.
 */
export const POSTFX_LOOK: Record<WeatherLayerId, PostFxLook> = {
  wind: { bloom: 0.75, vignette: 0 },
  upper: { bloom: 0.4, vignette: 0 },
  infrared: { bloom: 0.28, vignette: 0 },
  rain: { bloom: 0.35, vignette: 0 },
  terrain: { bloom: 0.5, vignette: 0.24 },
  accum: { bloom: 0, vignette: 0 },
  sst: { bloom: 0, vignette: 0 },
  humidity: { bloom: 0, vignette: 0 },
  ohc: { bloom: 0, vignette: 0 },
  shear: { bloom: 0, vignette: 0 },
};

/** Bloom mip levels below full resolution (1/2 .. 1/32). */
const LEVELS = 5;
/** Bright-pass luminance threshold and soft-knee half width. */
const THRESHOLD = 0.52;
const KNEE = 0.22;

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  // Four bilinear taps = a 4x4 box: steadier than one tap, so single bright
  // pixels (particle heads) do not flicker as fireflies.
  vec3 c = 0.25 * (
    texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb +
    texture(u_src, v_uv + u_texel * vec2( 1.0, -1.0)).rgb +
    texture(u_src, v_uv + u_texel * vec2(-1.0,  1.0)).rgb +
    texture(u_src, v_uv + u_texel * vec2( 1.0,  1.0)).rgb);
  float luma = max(c.r, max(c.g, c.b));
  float soft = clamp(luma - ${(THRESHOLD - KNEE).toFixed(3)}, 0.0, ${(2 * KNEE).toFixed(3)});
  soft = soft * soft / ${(4 * KNEE + 1e-4).toFixed(4)};
  float contribution = max(soft, luma - ${THRESHOLD.toFixed(3)}) / max(luma, 1e-4);
  o = vec4(c * contribution, 1.0);
}`;

const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec2 h = u_texel * 0.5;
  vec3 sum = texture(u_src, v_uv).rgb * 4.0;
  sum += texture(u_src, v_uv - h).rgb;
  sum += texture(u_src, v_uv + h).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, -h.y)).rgb;
  sum += texture(u_src, v_uv - vec2(h.x, -h.y)).rgb;
  o = vec4(sum / 8.0, 1.0);
}`;

const UP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec2 h = u_texel * 0.5;
  vec3 sum = texture(u_src, v_uv + vec2(-h.x * 2.0, 0.0)).rgb;
  sum += texture(u_src, v_uv + vec2(-h.x, h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, h.y * 2.0)).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(h.x * 2.0, 0.0)).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, -h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, -h.y * 2.0)).rgb;
  sum += texture(u_src, v_uv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(sum / 12.0, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomGain;
uniform float u_vignette;
uniform float u_aspect;
void main() {
  vec3 scene = texture(u_scene, v_uv).rgb;
  vec3 bloom = texture(u_bloom, v_uv).rgb * u_bloomGain;
  // Screen-blend the glow so bright cores saturate gracefully instead of
  // clipping to flat white.
  vec3 c = 1.0 - (1.0 - scene) * (1.0 - min(bloom, vec3(1.0)));
  vec2 d = (v_uv - 0.5) * vec2(u_aspect, 1.0);
  float r = length(d) / length(vec2(u_aspect, 1.0) * 0.5);
  c *= 1.0 - u_vignette * smoothstep(0.42, 1.0, r);
  o = vec4(c, 1.0);
}`;

/** Scene-copy formats, tried in order (see ensureTargets). */
const SCENE_FORMATS = ['RGB8', 'RGBA8'] as const;
type SceneFormat = (typeof SCENE_FORMATS)[number];

function makeSceneTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: SceneFormat,
): RenderTarget {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('postfx: scene target allocation failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format === 'RGB8' ? gl.RGB8 : gl.RGBA8, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fbo, tex, float: false };
}

interface Program {
  prog: WebGLProgram;
  vao: WebGLVertexArrayObject;
  src: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
}

export class PostFx {
  private gl!: WebGL2RenderingContext;
  private caps!: GlCaps;
  private bright: Program | null = null;
  private down: Program | null = null;
  private up: Program | null = null;
  private composite: Program | null = null;
  private scene: RenderTarget | null = null;
  private mips: RenderTarget[] = [];
  private mipSizes: [number, number][] = [];
  private width = 0;
  private height = 0;
  private enabled = true;
  /** Set once the driver rejects the resolve blit; never retried. */
  private failed = false;
  /** Whether the resolve blit has been checked against the current targets. */
  private verified = false;
  /** Index into SCENE_FORMATS of the scene format being tried or in use. */
  private formatIndex = 0;

  init(gl: WebGL2RenderingContext, caps: GlCaps): void {
    this.gl = gl;
    this.caps = caps;
    const make = (fs: string): Program => {
      const prog = makeProgram(gl, QUAD_VS, fs);
      return {
        prog,
        vao: makeQuadVao(gl, prog),
        src: gl.getUniformLocation(prog, 'u_src'),
        texel: gl.getUniformLocation(prog, 'u_texel'),
      };
    };
    this.bright = make(BRIGHT_FS);
    this.down = make(DOWN_FS);
    this.up = make(UP_FS);
    this.composite = make(COMPOSITE_FS);
    // Targets belong to the (possibly lost) previous context; rebuild lazily.
    this.scene = null;
    this.mips = [];
    this.mipSizes = [];
    this.width = 0;
    this.height = 0;
  }

  /** Device tier switch (RenderProfile.postFx). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.scene && this.width === width && this.height === height) return;
    this.disposeTargets();
    const gl = this.gl;
    // A multisample resolve blit needs identical colour formats, and the
    // drawing buffer's (RGB8 for alpha:false, RGBA8 on some drivers) is not
    // queryable — so formats are tried in order until one blit succeeds.
    this.scene = makeSceneTarget(gl, width, height, SCENE_FORMATS[this.formatIndex]);
    let w = width;
    let h = height;
    for (let level = 0; level < LEVELS; level += 1) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(makeRenderTarget(gl, w, h, this.caps));
      this.mipSizes.push([w, h]);
    }
    this.width = width;
    this.height = height;
    this.verified = false;
  }

  private pass(
    program: Program,
    src: WebGLTexture,
    srcW: number,
    srcH: number,
    dst: RenderTarget,
    dstW: number,
    dstH: number,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dstW, dstH);
    gl.useProgram(program.prog);
    gl.bindVertexArray(program.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(program.src, 0);
    gl.uniform2f(program.texel, 1 / srcW, 1 / srcH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Post-process the default framebuffer in place. Call after every GL layer
   * has drawn. No-op when disabled, failed, or the look is neutral.
   */
  apply(look: PostFxLook, width: number, height: number): void {
    const gl = this.gl;
    if (!this.enabled || this.failed || !this.bright || !this.composite) return;
    if (look.bloom <= 0 && look.vignette <= 0) return;
    this.ensureTargets(width, height);
    const scene = this.scene;
    if (!scene) return;

    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fbo);
    // getError is a GPU round trip, so the blit is verified once per target
    // allocation rather than every frame.
    const verify = !this.verified;
    if (verify) {
      for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i += 1) {
        /* drain stale errors so the check below is about the blit */
      }
    }
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    if (verify) {
      if (gl.getError() !== gl.NO_ERROR) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.formatIndex += 1;
        this.disposeTargets();
        if (this.formatIndex >= SCENE_FORMATS.length) {
          this.failed = true;
          console.warn('[postfx] drawing-buffer resolve rejected; bloom disabled');
        }
        return;
      }
      this.verified = true;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    if (look.bloom > 0) {
      const [w0, h0] = this.mipSizes[0];
      this.pass(this.bright, scene.tex, width, height, this.mips[0], w0, h0);
      for (let level = 1; level < LEVELS; level += 1) {
        const [sw, sh] = this.mipSizes[level - 1];
        const [dw, dh] = this.mipSizes[level];
        this.pass(this.down!, this.mips[level - 1].tex, sw, sh, this.mips[level], dw, dh);
      }
      // Upsample and ADD each level into the one above: the result holds
      // every scale, a tight core glow plus a wide soft halo.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let level = LEVELS - 1; level > 0; level -= 1) {
        const [sw, sh] = this.mipSizes[level];
        const [dw, dh] = this.mipSizes[level - 1];
        this.pass(this.up!, this.mips[level].tex, sw, sh, this.mips[level - 1], dw, dh);
      }
      gl.disable(gl.BLEND);
    }

    const c = this.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(c.prog);
    gl.bindVertexArray(c.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(gl.getUniformLocation(c.prog, 'u_scene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex);
    gl.uniform1i(gl.getUniformLocation(c.prog, 'u_bloom'), 1);
    // The up chain sums LEVELS scales; normalise so gain means "one level".
    gl.uniform1f(
      gl.getUniformLocation(c.prog, 'u_bloomGain'),
      look.bloom > 0 ? look.bloom / Math.sqrt(LEVELS) : 0,
    );
    gl.uniform1f(gl.getUniformLocation(c.prog, 'u_vignette'), look.vignette);
    gl.uniform1f(gl.getUniformLocation(c.prog, 'u_aspect'), width / Math.max(1, height));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private disposeTargets(): void {
    const gl = this.gl;
    disposeRenderTarget(gl, this.scene);
    for (const mip of this.mips) disposeRenderTarget(gl, mip);
    this.scene = null;
    this.mips = [];
    this.mipSizes = [];
    this.width = 0;
    this.height = 0;
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    this.disposeTargets();
    for (const program of [this.bright, this.down, this.up, this.composite]) {
      if (!program) continue;
      gl.deleteProgram(program.prog);
      gl.deleteVertexArray(program.vao);
    }
    this.bright = this.down = this.up = this.composite = null;
  }
}
