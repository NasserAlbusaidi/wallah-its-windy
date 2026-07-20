/**
 * rain.ts — orographic rain accumulation + wadi lighting (eng tasks T5 + T9).
 *
 * A dedicated HALF-RES render target accumulates rain. The eng review (T5)
 * resolved the "read-write-same-texture" trap by making the accumulator a
 * ping-pong pair and turning decay into a per-frame MULTIPLY knob (RAIN_DECAY,
 * 0.90–1.00): each frame the update pass reads target A and writes
 *   newAccum = decay*A + rainSource + basinTransport   into target B, then swaps.
 * "Additive blending" is realised as this in-shader add so decay and transport —
 * which hardware ONE,ONE blending cannot express — become possible.
 *
 * Rain source = intensity · max(0, w⃗·∇h): w⃗ is the SAME analytic Rankine vortex
 * inflow the particles ride (vortex.ts, in clip east/north), ∇h from the R16F
 * elevation texture. max(0,·) clamps lee slopes to zero — orographic-only by
 * design.
 *
 * Basin-glow transport (T9) — the trick, documented plainly: instead of routing
 * water with flow-direction data, each frame a cell pulls a fraction of the
 * accumulated rain from any of its 4 neighbours that is HIGHER (uphill) and in
 * the SAME basin. Rain therefore migrates one cell downhill along a basin per
 * frame, so a dump on Jebel Akhdar marches down to the Batinah wadis over a few
 * seconds — a hand-tuned travel lag (TRANSPORT_RATE + neighbour step), legible
 * not hydrological, no volume conservation. Falls back to elevation-only when no
 * basin layer is baked.
 *
 * The composite pass tints high flow-accumulation channels wadi-dry→wadi-flood by
 * local accumulated rain — the brightest layer in the luminance ranking. Flood
 * glow lingers and fades after the storm dies purely because the source stops and
 * the decay knob drains the accumulator (the ~10 s aftermath, for free).
 */

import { TOKENS } from '../tokens';
import { INFLOW_RAD, VORTEX_GLSL } from './vortex';
import { bindTex, makeProgram, makeQuadVao, makeRenderTarget, disposeRenderTarget } from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';
import type { DrawCtx, GpuTextures } from './context';

/** Per-frame decay multiply — THE knob (eng task T5, valid 0.90–1.00). */
const RAIN_DECAY = 0.985;
const RAIN_GAIN = 45.0; // folds in the metres→slope scale of ∇h
const TRANSPORT_RATE = 0.11; // fraction pulled from each uphill same-basin neighbour
const RMAX_BASE = 0.11; // mirror of particles' base radius (clip units here)
// Channel window on the normalized baked log10(1+acc) values. These preserve the
// old visual cutoffs after removing the renderer's accidental second logarithm:
// old 0.62/0.92 in log1p-space map to ~0.41/0.84 in the honest linear space.
const WADI_LO = 0.41;
const WADI_HI = 0.84;
const RAIN_TO_GLOW = 2.5; // maps small accumulated rain to flood brightness

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const UPDATE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_src;    // previous accumulation (half-res)
uniform sampler2D u_elev;   // R16F metres
uniform sampler2D u_land;
uniform sampler2D u_basin;  // RG8 basin id (lo, hi) — compare BOTH channels
uniform float u_hasBasin;
uniform vec2 u_elevTexel;
uniform vec2 u_rtexel;      // rain-FBO texel size
uniform float u_decay;
uniform float u_gain;
uniform float u_transport;
uniform vec2 u_center;      // storm centre, clip
uniform float u_rMax;
uniform float u_inflow;
uniform float u_rainAmount; // storm intensity, 0 when no storm (decay-only)

${VORTEX_GLSL}

float elev(vec2 p) { return texture(u_elev, p).r; }

void main() {
  vec2 uv = v_uv;
  float aHere = texture(u_src, uv).r;
  float eh = elev(uv);
  float land = texture(u_land, uv).r;

  // Orographic source: vortex inflow wind dotted with the terrain gradient.
  vec2 cell = vec2(uv.x * 2.0 - 1.0, 1.0 - 2.0 * uv.y); // clip, east=x north=y
  vec2 w = vortexWind(cell, u_center, u_rMax, 1.0, u_inflow);
  float eE = elev(uv + vec2(u_elevTexel.x, 0.0));
  float eW = elev(uv - vec2(u_elevTexel.x, 0.0));
  float eN = elev(uv + vec2(0.0, -u_elevTexel.y));
  float eS = elev(uv + vec2(0.0,  u_elevTexel.y));
  vec2 grad = vec2(eE - eW, eN - eS);
  float upslope = max(0.0, dot(w, grad));
  float rain = u_rainAmount * upslope * u_gain * step(0.5, land);
  rain = min(rain, 0.15); // bound a single frame's contribution

  // Basin-glow downstream transport, CONSERVATIVE: a cell GAINS from each
  // strictly-higher same-basin neighbour and LOSES the matching share to each
  // strictly-lower one, so glow migrates downstream (travel lag = frames) without
  // amplifying. A copy-only pull would self-sustain (4*rate >> decay loss) and
  // light channels permanently; balancing gain against loss lets decay drain it,
  // so the flood fades after the rain stops. Legible, not hydrological.
  vec2 bh = texture(u_basin, uv).rg;   // this cell's basin id, split across R+G
  vec2 offs[4] = vec2[4](
    vec2( u_rtexel.x, 0.0), vec2(-u_rtexel.x, 0.0),
    vec2(0.0,  u_rtexel.y), vec2(0.0, -u_rtexel.y));
  float inflow = 0.0;
  float outCount = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 p = uv + offs[i];
    float en = elev(p);
    vec2 bn = texture(u_basin, p).rg;
    // Same basin only when BOTH id bytes match — no mod-256 aliasing.
    float bdiff = abs(bn.r - bh.r) + abs(bn.g - bh.g);
    float sameB = u_hasBasin < 0.5 ? 1.0 : step(bdiff, 0.6 / 255.0);
    inflow += texture(u_src, p).r * step(eh + 1.0, en) * sameB; // neighbour uphill
    outCount += step(en + 1.0, eh) * sameB;                     // neighbour downhill
  }
  float net = (inflow - aHere * outCount) * u_transport;

  float acc = clamp(u_decay * aHere + rain + net, 0.0, 1.5);
  o = vec4(acc, 0.0, 0.0, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_accum;
uniform sampler2D u_acc;   // normalised log flow-accumulation
uniform sampler2D u_land;
uniform vec4 u_wadiDry;
uniform vec4 u_wadiFlood;
uniform float u_lo;
uniform float u_hi;
uniform float u_fade;
void main() {
  float rainVal = texture(u_accum, v_uv).r;
  float accV = texture(u_acc, v_uv).r;
  float land = texture(u_land, v_uv).r;
  float channel = smoothstep(u_lo, u_hi, accV) * step(0.5, land);
  float wet = clamp(rainVal * ${RAIN_TO_GLOW.toFixed(1)}, 0.0, 1.0);
  vec3 col = mix(u_wadiDry.rgb, u_wadiFlood.rgb, wet);
  float dryA = u_wadiDry.a;
  float alpha = channel * u_fade * (dryA + (1.0 - dryA) * wet);
  o = vec4(col, alpha);
}`;

export class RainLayer {
  private gl!: WebGL2RenderingContext;
  private caps!: GlCaps;
  private updProg: WebGLProgram | null = null;
  private updVao: WebGLVertexArrayObject | null = null;
  private compProg: WebGLProgram | null = null;
  private compVao: WebGLVertexArrayObject | null = null;
  private targets: [RenderTarget | null, RenderTarget | null] = [null, null];
  private cur = 0;
  private rtW = 1;
  private rtH = 1;

  init(gl: WebGL2RenderingContext, caps: GlCaps): void {
    this.gl = gl;
    this.caps = caps;
    this.updProg = makeProgram(gl, QUAD_VS, UPDATE_FS);
    this.updVao = makeQuadVao(gl, this.updProg);
    this.compProg = makeProgram(gl, QUAD_VS, COMPOSITE_FS);
    this.compVao = makeQuadVao(gl, this.compProg);
  }

  resize(w: number, h: number): void {
    const gl = this.gl;
    this.rtW = Math.max(1, Math.floor(w / 2));
    this.rtH = Math.max(1, Math.floor(h / 2));
    disposeRenderTarget(gl, this.targets[0]);
    disposeRenderTarget(gl, this.targets[1]);
    this.targets[0] = makeRenderTarget(gl, this.rtW, this.rtH, this.caps);
    this.targets[1] = makeRenderTarget(gl, this.rtW, this.rtH, this.caps);
    this.cur = 0;
    // Clear both accumulators.
    for (const t of this.targets) {
      if (!t) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, this.rtW, this.rtH);
      gl.clearColor(0, 0, 0, 1);
      gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Advance the accumulator one frame (offscreen). Restores the screen FBO. */
  update(ctx: DrawCtx, gpu: GpuTextures): void {
    const gl = this.gl;
    // Paused: the flood is sim-coupled output, so freeze the accumulator (no
    // source, decay or transport) while the sim is stopped. composite() still
    // draws the frozen state. Return before any GL state change (screen FBO is
    // bound here) so nothing leaks.
    if (ctx.frame.paused) return;
    const src = this.targets[this.cur];
    const dst = this.targets[1 - this.cur];
    if (!this.updProg || !src || !dst || !gpu.elev || !gpu.land || !gpu.terrainGrid) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, this.rtW, this.rtH);
    gl.disable(gl.BLEND);
    gl.useProgram(this.updProg);
    gl.bindVertexArray(this.updVao);
    const u = (n: string) => gl.getUniformLocation(this.updProg!, n);
    bindTex(gl, 0, src.tex, u('u_src'));
    bindTex(gl, 1, gpu.elev, u('u_elev'));
    bindTex(gl, 2, gpu.land, u('u_land'));
    bindTex(gl, 3, gpu.basin ?? gpu.land, u('u_basin')); // dummy bind when absent
    gl.uniform1f(u('u_hasBasin'), gpu.hasBasin ? 1 : 0);
    gl.uniform2f(u('u_elevTexel'), 1 / gpu.terrainGrid.nx, 1 / gpu.terrainGrid.ny);
    gl.uniform2f(u('u_rtexel'), 1 / this.rtW, 1 / this.rtH);
    gl.uniform1f(u('u_decay'), RAIN_DECAY);
    gl.uniform1f(u('u_gain'), RAIN_GAIN);
    gl.uniform1f(u('u_transport'), TRANSPORT_RATE);
    const c = ctx.centerClip;
    gl.uniform2f(u('u_center'), c ? c.x : 0, c ? c.y : 0);
    gl.uniform1f(u('u_rMax'), RMAX_BASE * (0.7 + 0.6 * ctx.intensity01));
    gl.uniform1f(u('u_inflow'), INFLOW_RAD);
    // Only a live storm over the map produces rain; else decay + transport only.
    const raining = c && ctx.vKt > 0 ? ctx.intensity01 : 0;
    gl.uniform1f(u('u_rainAmount'), raining);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    this.cur = 1 - this.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
  }

  /** Composite the wadi flood glow onto the screen (additive). */
  composite(ctx: DrawCtx, gpu: GpuTextures, fade: number): void {
    const gl = this.gl;
    const accum = this.targets[this.cur];
    if (!this.compProg || !accum || !gpu.acc || !gpu.land) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.compProg);
    gl.bindVertexArray(this.compVao);
    const u = (n: string) => gl.getUniformLocation(this.compProg!, n);
    bindTex(gl, 0, accum.tex, u('u_accum'));
    bindTex(gl, 1, gpu.acc, u('u_acc'));
    bindTex(gl, 2, gpu.land, u('u_land'));
    gl.uniform4fv(u('u_wadiDry'), TOKENS.wadiDry.rgba01);
    gl.uniform4fv(u('u_wadiFlood'), TOKENS.wadiFlood.rgba01);
    gl.uniform1f(u('u_lo'), WADI_LO);
    gl.uniform1f(u('u_hi'), WADI_HI);
    gl.uniform1f(u('u_fade'), fade);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    void ctx;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.updProg) gl.deleteProgram(this.updProg);
    if (this.compProg) gl.deleteProgram(this.compProg);
    if (this.updVao) gl.deleteVertexArray(this.updVao);
    if (this.compVao) gl.deleteVertexArray(this.compVao);
    disposeRenderTarget(gl, this.targets[0]);
    disposeRenderTarget(gl, this.targets[1]);
    this.updProg = this.compProg = null;
    this.updVao = this.compVao = null;
    this.targets = [null, null];
  }
}
