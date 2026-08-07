/**
 * terrain.ts — the opaque instrument base: hillshaded land + ocean depth tint.
 *
 * A single fullscreen pass reconstructs the domain UV from clip space (north at
 * the top, matching the BINARY-FORMATS row order), samples the R16F elevation
 * texture with manual neighbour taps for an NW-lit hillshade, and paints ocean a
 * near-black deep->shallow gradient that brightens toward the coast. Every colour
 * is a token uniform — no hex in the shader (design rule). This is the lowest
 * layer in the luminance ranking; everything else adds light on top of it.
 */

import { TOKENS } from '../tokens';
import { VIEW_QUAD_VS, makeProgram, makeQuadVao, setViewUniform } from './gl-utils';
import type { DrawCtx, GpuTextures, RenderModule } from './context';

/** Vertical exaggeration for the hillshade normal (elevation is raw metres). */
const RELIEF = 0.006;

const VS = VIEW_QUAD_VS;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_elev;
uniform sampler2D u_land;
uniform vec2 u_texel;
uniform float u_relief;
uniform float u_fade;
uniform vec4 u_oceanDeep;
uniform vec4 u_oceanShallow;
uniform vec4 u_terrain;
uniform vec4 u_ridgeHi;

float elev(vec2 p) { return texture(u_elev, p).r; }

void main() {
  float land = texture(u_land, v_uv).r;

  // Hillshade (NW light, ambient floor so valleys aren't crushed to black).
  float eE = elev(v_uv + vec2(u_texel.x, 0.0));
  float eW = elev(v_uv - vec2(u_texel.x, 0.0));
  float eN = elev(v_uv + vec2(0.0, -u_texel.y));
  float eS = elev(v_uv + vec2(0.0,  u_texel.y));
  vec3 n = normalize(vec3(-(eE - eW) * u_relief, -(eN - eS) * u_relief, 1.0));
  vec3 L = normalize(vec3(-0.6, 0.6, 0.8));
  float shade = clamp(dot(n, L), 0.0, 1.0);
  shade = 0.35 + 0.65 * shade;
  vec3 landCol = mix(u_terrain.rgb, u_ridgeHi.rgb, shade);

  // Coastal shallow tint: blur the land mask a few texels to widen the band.
  float prox = 0.25 * (
    texture(u_land, v_uv + vec2( u_texel.x * 3.0, 0.0)).r +
    texture(u_land, v_uv + vec2(-u_texel.x * 3.0, 0.0)).r +
    texture(u_land, v_uv + vec2(0.0,  u_texel.y * 3.0)).r +
    texture(u_land, v_uv + vec2(0.0, -u_texel.y * 3.0)).r);
  float shallow = smoothstep(0.05, 0.6, prox);
  vec3 oceanCol = mix(u_oceanDeep.rgb, u_oceanShallow.rgb, shallow);

  vec3 col = land > 0.5 ? landCol : oceanCol;
  o = vec4(col * u_fade, 1.0);
}`;

interface Uniforms {
  view: WebGLUniformLocation | null;
  elev: WebGLUniformLocation | null;
  land: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  relief: WebGLUniformLocation | null;
  fade: WebGLUniformLocation | null;
  oceanDeep: WebGLUniformLocation | null;
  oceanShallow: WebGLUniformLocation | null;
  terrain: WebGLUniformLocation | null;
  ridgeHi: WebGLUniformLocation | null;
}

export class TerrainLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private u!: Uniforms;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    const u = (n: string) => gl.getUniformLocation(this.prog!, n);
    this.u = {
      view: u('u_view'),
      elev: u('u_elev'),
      land: u('u_land'),
      texel: u('u_texel'),
      relief: u('u_relief'),
      fade: u('u_fade'),
      oceanDeep: u('u_oceanDeep'),
      oceanShallow: u('u_oceanShallow'),
      terrain: u('u_terrain'),
      ridgeHi: u('u_ridgeHi'),
    };
  }

  resize(): void {
    /* fullscreen pass — nothing resolution-dependent to cache */
  }

  draw(ctx: DrawCtx, gpu: GpuTextures, fade: number): void {
    const gl = this.gl;
    if (!this.prog || !gpu.elev || !gpu.land || !gpu.terrainGrid) return;
    gl.disable(gl.BLEND); // opaque base
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.elev);
    gl.uniform1i(this.u.elev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpu.land);
    gl.uniform1i(this.u.land, 1);

    setViewUniform(gl, this.u.view, ctx.view);
    gl.uniform2f(this.u.texel, 1 / gpu.terrainGrid.nx, 1 / gpu.terrainGrid.ny);
    gl.uniform1f(this.u.relief, RELIEF);
    gl.uniform1f(this.u.fade, fade);
    gl.uniform4fv(this.u.oceanDeep, TOKENS.oceanDeep.rgba01);
    gl.uniform4fv(this.u.oceanShallow, TOKENS.oceanShallow.rgba01);
    gl.uniform4fv(this.u.terrain, TOKENS.terrain.rgba01);
    gl.uniform4fv(this.u.ridgeHi, TOKENS.ridgeHi.rgba01);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.prog = null;
    this.vao = null;
  }
}
