/**
 * env.ts — environment legibility (eng task T10, design D2/D11).
 *
 * One faint always-on additive pass over the ocean: the SST warmth tint — the
 * warm-orange token, alpha ramped by SST above 26 °C, masked to ocean. This is
 * the fuel the storm reads; it doubles as the dev debug view of where storms CAN
 * intensify. It sits just above terrain in the luminance ranking. Colours are
 * token uniforms; additive blend (SRC_ALPHA, ONE).
 *
 * The historic-genesis glow is NOT drawn here: it lives once, in ui.drawOverlay
 * on the 2D overlay canvas (a token-sourced radial gradient). A GL point-splat
 * copy used to live here too, but it (a) double-exposed the glow to ~2× its token
 * luminance and (b) relied on a large gl_PointSize that WebGL2 does not guarantee
 * (many GPUs clamp point size well below the ~100 px it needs), so it silently
 * shrank to dots on those devices. Keeping only the 2D-canvas copy fixes both.
 */

import { TOKENS } from '../tokens';
import { SST_MAX_C, SST_MIN_C } from './textures';
import { makeProgram, makeQuadVao } from './gl-utils';
import type { DrawCtx, GpuTextures, RenderModule } from './context';

const SST_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_sst;
uniform sampler2D u_land;
uniform vec2 u_range;   // (minC, maxC) the R8 was normalised over
uniform vec4 u_warm;    // sst-warm token (rgb + base alpha)
uniform float u_fade;
void main() {
  float land = texture(u_land, v_uv).r;
  float sstC = texture(u_sst, v_uv).r * (u_range.y - u_range.x) + u_range.x;
  float warm = smoothstep(26.0, 30.0, sstC);
  float a = u_warm.a * warm * (1.0 - smoothstep(0.4, 0.6, land)) * u_fade;
  o = vec4(u_warm.rgb, a);
}`;

export class EnvLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private sstProg: WebGLProgram | null = null;
  private sstVao: WebGLVertexArrayObject | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.sstProg = makeProgram(gl, SST_VS, SST_FS);
    this.sstVao = makeQuadVao(gl, this.sstProg);
  }

  resize(_w: number, _h: number): void {
    /* fullscreen pass — nothing resolution-dependent to cache */
  }

  draw(ctx: DrawCtx, gpu: GpuTextures, fade: number): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive light

    // SST warmth tint.
    if (this.sstProg && gpu.sst && gpu.land) {
      gl.useProgram(this.sstProg);
      gl.bindVertexArray(this.sstVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gpu.sst);
      gl.uniform1i(gl.getUniformLocation(this.sstProg, 'u_sst'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, gpu.land);
      gl.uniform1i(gl.getUniformLocation(this.sstProg, 'u_land'), 1);
      gl.uniform2f(gl.getUniformLocation(this.sstProg, 'u_range'), SST_MIN_C, SST_MAX_C);
      gl.uniform4fv(gl.getUniformLocation(this.sstProg, 'u_warm'), TOKENS.sstWarm.rgba01);
      gl.uniform1f(gl.getUniformLocation(this.sstProg, 'u_fade'), fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
    void ctx;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.sstProg) gl.deleteProgram(this.sstProg);
    if (this.sstVao) gl.deleteVertexArray(this.sstVao);
    this.sstProg = null;
    this.sstVao = null;
  }
}
