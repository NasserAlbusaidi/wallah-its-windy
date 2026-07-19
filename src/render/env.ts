/**
 * env.ts — environment legibility (eng task T10, design D2/D11).
 *
 * Two faint always-on additive passes over the ocean:
 *   1. SST warmth tint — the warm-orange token, alpha ramped by SST above 26 °C,
 *      masked to ocean. This is the fuel the storm reads; it doubles as the dev
 *      debug view of where storms CAN intensify.
 *   2. Genesis-zone glow — soft amber splats at the historic genesis points
 *      (public/data/genesis.json), nudging spawns toward interesting outcomes
 *      without biasing the physics.
 *
 * Both sit just above terrain in the luminance ranking (SST tint > terrain,
 * genesis > SST). Colours are token uniforms; additive blend (SRC_ALPHA, ONE).
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

const GEN_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
uniform float u_size;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const GEN_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform vec4 u_genesis;
uniform float u_fade;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  o = vec4(u_genesis.rgb, u_genesis.a * a * a * u_fade);
}`;

export class EnvLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private sstProg: WebGLProgram | null = null;
  private sstVao: WebGLVertexArrayObject | null = null;
  private genProg: WebGLProgram | null = null;
  private genVao: WebGLVertexArrayObject | null = null;
  private genBuf: WebGLBuffer | null = null;
  private genCount = 0;
  private genRef: Float32Array | null = null;
  private height = 1;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.sstProg = makeProgram(gl, SST_VS, SST_FS);
    this.sstVao = makeQuadVao(gl, this.sstProg);
    this.genProg = makeProgram(gl, GEN_VS, GEN_FS);
    this.genVao = gl.createVertexArray();
    this.genBuf = gl.createBuffer();
  }

  resize(_w: number, h: number): void {
    this.height = h;
  }

  private ensureGenesis(clip: Float32Array | null): void {
    const gl = this.gl;
    if (clip === this.genRef) return;
    this.genRef = clip;
    this.genCount = clip ? clip.length / 2 : 0;
    if (!clip || !this.genProg) return;
    gl.bindVertexArray(this.genVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.genBuf);
    gl.bufferData(gl.ARRAY_BUFFER, clip, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.genProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
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

    // Genesis-zone glow.
    this.ensureGenesis(gpu.genesisClip);
    if (this.genProg && this.genCount > 0) {
      gl.useProgram(this.genProg);
      gl.bindVertexArray(this.genVao);
      gl.uniform1f(gl.getUniformLocation(this.genProg, 'u_size'), this.height * 0.075);
      gl.uniform4fv(gl.getUniformLocation(this.genProg, 'u_genesis'), TOKENS.genesis.rgba01);
      gl.uniform1f(gl.getUniformLocation(this.genProg, 'u_fade'), fade);
      gl.drawArrays(gl.POINTS, 0, this.genCount);
    }
    gl.bindVertexArray(null);
    void ctx;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.sstProg) gl.deleteProgram(this.sstProg);
    if (this.genProg) gl.deleteProgram(this.genProg);
    if (this.sstVao) gl.deleteVertexArray(this.sstVao);
    if (this.genVao) gl.deleteVertexArray(this.genVao);
    if (this.genBuf) gl.deleteBuffer(this.genBuf);
    this.sstProg = this.genProg = null;
    this.sstVao = this.genVao = null;
    this.genBuf = null;
    this.genRef = null;
    this.genCount = 0;
  }
}
