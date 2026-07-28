/**
 * rain.ts — orographic rain accumulation + wadi lighting (eng tasks T5 + T9).
 *
 * A dedicated HALF-RES render target accumulates rain. The eng review (T5)
 * resolved the "read-write-same-texture" trap by making the accumulator a
 * ping-pong pair and turning decay into a per-frame MULTIPLY knob (RAIN_DECAY,
 * 0.90–1.00): each frame the update pass reads target A and writes
 *   newAccum = decay*A + rainSource + routedTransport  into target B, then swaps.
 * "Additive blending" is realised as this in-shader add so decay and transport —
 * which hardware ONE,ONE blending cannot express — become possible.
 *
 * Rain source is explicitly separated into (1) an eyewall ring at RMW,
 * (2) spiral outer rainbands, and (3) an upslope enhancement from the SAME
 * analytic Holland vortex inflow the particles ride. The sim supplies distinct
 * mm/h component rates from intensity, humidity, and persistent organization;
 * the shader supplies their spatial structure and terrain interaction.
 *
 * Timed DIR routing (v1.2): flowacc.bin now carries official HydroSHEDS ACC+DIR
 * plus `travmin`, the visualization-scale travel time to the next 2 km cell.
 * Each update conservatively removes one time-scaled share from a cell and adds
 * shares only from neighbours whose D8 arrow points into it. The pulse therefore
 * follows observed hydrography over simulated hours. Old bins still fall back to
 * the former same-basin/elevation approximation instead of failing to render.
 *
 * The composite pass tints high flow-accumulation channels wadi-dry→wadi-flood by
 * local accumulated rain — the brightest layer in the luminance ranking. Flood
 * glow lingers and fades after the storm dies purely because the source stops and
 * the decay knob drains the accumulator (the ~10 s aftermath, for free).
 */

import { TOKENS } from '../tokens';
import { flowOffsetGlsl, HYDRO_ROUTE_CFL } from '../hydro-routing';
import {
  DOMAIN,
  clipToLatLon,
} from '../grid';
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_PITCH,
} from '../rainband-profile';
import type { DrawCtx, GpuTextures } from './context';
import {
  bindTex,
  disposeRenderTarget,
  makeProgram,
  makeQuadVao,
  makeRenderTarget,
} from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';
import { rainCenterClip } from './precipitating-cloud';
import { INFLOW_RAD, VORTEX_GLSL } from './vortex';

/** Per-frame decay multiply — THE knob (eng task T5, valid 0.90–1.00). */
const RAIN_DECAY_PER_H = 0.72;
const RAIN_GAIN = 0.0025; // metres of local relief -> bounded upslope multiplier
const FALLBACK_TRANSPORT_PER_H = 0.44;
const RMAX_BASE = 0.11; // mirror of particles' base radius (clip units here)
const HALF_DOMAIN_HEIGHT_KM =
  ((DOMAIN.latMax - DOMAIN.latMin) * 111) / 2;
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
uniform sampler2D u_flowdir; // R8 exact HydroSHEDS D8 code / 255
uniform sampler2D u_travmin; // R8 travel minutes / 255
uniform float u_hasBasin;
uniform float u_hasRouting;
uniform vec2 u_elevTexel;
uniform vec2 u_rtexel;      // rain-FBO texel size
uniform float u_decayPerH;
uniform float u_gain;
uniform float u_fallbackTransportPerH;
uniform float u_dtH;
uniform vec2 u_center;      // storm centre, clip
uniform float u_rMax;
uniform float u_hollandB;
uniform vec2 u_motion;
uniform float u_asymmetry;
uniform float u_outerScale;
uniform float u_outerBlendStartFraction;
uniform float u_outerBlendFullFraction;
uniform vec2 u_shear;
uniform float u_shearAsymmetry;
uniform float u_inflow;
uniform float u_metricX;
uniform float u_eyewallRain;
uniform float u_rainbandRain;
uniform float u_orographicRain;

${VORTEX_GLSL}

float elev(vec2 p) { return texture(u_elev, p).r; }

${flowOffsetGlsl()}

float routeFraction(vec2 p) {
  vec2 direction = flowOffset(p);
  if (dot(direction, direction) < 0.5) return 0.0;
  float minutes = max(8.0, texture(u_travmin, p).r * 255.0);
  return min(${HYDRO_ROUTE_CFL.toFixed(2)}, u_dtH / (minutes / 60.0));
}

void main() {
  vec2 uv = v_uv;
  float aHere = texture(u_src, uv).r;
  float eh = elev(uv);
  float land = texture(u_land, uv).r;

  // Orographic source: vortex inflow wind dotted with the terrain gradient.
  vec2 cell = vec2(uv.x * 2.0 - 1.0, 1.0 - 2.0 * uv.y); // clip, east=x north=y
  vec2 w = vortexWind(
    cell,
    u_center,
    u_rMax,
    1.0,
    u_hollandB,
    u_motion,
    u_asymmetry,
    u_outerScale,
    u_outerBlendStartFraction,
    u_outerBlendFullFraction,
    u_shear,
    u_shearAsymmetry,
    u_inflow
  );
  float eE = elev(uv + vec2(u_elevTexel.x, 0.0));
  float eW = elev(uv - vec2(u_elevTexel.x, 0.0));
  float eN = elev(uv + vec2(0.0, -u_elevTexel.y));
  float eS = elev(uv + vec2(0.0,  u_elevTexel.y));
  vec2 grad = vec2(eE - eW, eN - eS);
  float upslope = max(0.0, dot(w, grad));

  // Metric radial coordinate: clip x spans 20 lon degrees while clip y spans
  // 12 latitude degrees; u_metricX includes the centre-latitude cosine.
  vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
  float radius = length(radial);
  float q = radius / max(0.006, u_rMax);
  float eyewall = exp(-pow((q - 1.0) / ${EYEWALL_WIDTH_Q}, 2.0));
  float bandEnvelope =
    smoothstep(${RAINBAND_INNER_Q}, ${RAINBAND_INNER_FULL_Q.toFixed(1)}, q) *
    (1.0 - smoothstep(
      ${RAINBAND_OUTER_FADE_Q.toFixed(1)},
      ${RAINBAND_OUTER_Q.toFixed(1)},
      q
    ));
  float azimuth = atan(radial.y, radial.x);
  float spiral = ${RAINBAND_AZIMUTHAL_MEAN} +
    ${RAINBAND_SPIRAL_AMPLITUDE} * sin(
      ${RAINBAND_SPIRAL_ARMS.toFixed(1)} * azimuth -
        ${RAINBAND_SPIRAL_PITCH} * q
    );
  float rainband = bandEnvelope * spiral;
  float orographic = u_orographicRain * clamp(upslope * u_gain, 0.0, 2.0);
  float rainRateMmH =
    u_eyewallRain * eyewall +
    u_rainbandRain * rainband +
    orographic;
  float rain = min(rainRateMmH * 0.012, 0.6) * u_dtH * step(0.5, land);

  // Exact D8 transport: only neighbours whose arrow points toward this cell can
  // contribute. Each routed cell loses exactly one corresponding share.
  vec2 routeOffs[8] = vec2[8](
    vec2( u_rtexel.x, 0.0), vec2( u_rtexel.x,  u_rtexel.y),
    vec2(0.0,  u_rtexel.y), vec2(-u_rtexel.x,  u_rtexel.y),
    vec2(-u_rtexel.x, 0.0), vec2(-u_rtexel.x, -u_rtexel.y),
    vec2(0.0, -u_rtexel.y), vec2( u_rtexel.x, -u_rtexel.y));
  float routedIn = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 p = uv + routeOffs[i];
    vec2 towardHere = -sign(routeOffs[i]);
    float aimsHere = 1.0 - step(0.1, length(flowOffset(p) - towardHere));
    routedIn += texture(u_src, p).r * routeFraction(p) * aimsHere;
  }
  float routedNet = routedIn - aHere * routeFraction(uv);

  // Compatibility path for old flowacc.bin files that have basin but no DIR.
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
  float fallbackRate = min(0.2, u_dtH * u_fallbackTransportPerH);
  float fallbackNet = (inflow - aHere * outCount) * fallbackRate;
  float net = mix(fallbackNet, routedNet, step(0.5, u_hasRouting));

  float decay = pow(u_decayPerH, u_dtH);
  float acc = clamp(decay * aHere + rain + net, 0.0, 1.5);
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
    if (ctx.frame.paused || ctx.frame.hydroDeltaH <= 0) return;
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
    bindTex(gl, 4, gpu.flowDir ?? gpu.land, u('u_flowdir'));
    bindTex(gl, 5, gpu.travelMin ?? gpu.land, u('u_travmin'));
    gl.uniform1f(u('u_hasBasin'), gpu.hasBasin ? 1 : 0);
    gl.uniform1f(u('u_hasRouting'), gpu.hasFlowRouting ? 1 : 0);
    gl.uniform2f(u('u_elevTexel'), 1 / gpu.terrainGrid.nx, 1 / gpu.terrainGrid.ny);
    gl.uniform2f(u('u_rtexel'), 1 / this.rtW, 1 / this.rtH);
    gl.uniform1f(u('u_decayPerH'), RAIN_DECAY_PER_H);
    gl.uniform1f(u('u_gain'), RAIN_GAIN);
    gl.uniform1f(u('u_fallbackTransportPerH'), FALLBACK_TRANSPORT_PER_H);
    gl.uniform1f(u('u_dtH'), ctx.frame.hydroDeltaH);
    const c = ctx.centerClip;
    const structure = ctx.structure;
    const rainCenter = c && structure ? rainCenterClip(c, structure) : c;
    gl.uniform2f(
      u('u_center'),
      rainCenter ? rainCenter.x : 0,
      rainCenter ? rainCenter.y : 0,
    );
    const rMax = structure
      ? Math.max(
          0.015,
          Math.min(0.16, structure.rmwKm / HALF_DOMAIN_HEIGHT_KM),
        )
      : RMAX_BASE * (0.7 + 0.6 * ctx.intensity01);
    const maximumWind = Math.max(1, structure?.maximumWindKt ?? ctx.vKt);
    gl.uniform1f(u('u_rMax'), rMax);
    gl.uniform1f(u('u_hollandB'), structure?.hollandB ?? 1.35);
    gl.uniform2f(
      u('u_motion'),
      structure?.motionUms ?? 0,
      structure?.motionVms ?? 0,
    );
    gl.uniform1f(
      u('u_asymmetry'),
      (structure?.translationAsymmetryKt ?? 0) / maximumWind,
    );
    gl.uniform1f(u('u_outerScale'), structure?.outerWindScale ?? 1);
    gl.uniform1f(
      u('u_outerBlendStartFraction'),
      (structure?.outerBlendStartWindKt ?? 48) / maximumWind,
    );
    gl.uniform1f(
      u('u_outerBlendFullFraction'),
      (structure?.outerBlendFullWindKt ?? 36) / maximumWind,
    );
    gl.uniform2f(
      u('u_shear'),
      structure?.shearUms ?? 0,
      structure?.shearVms ?? 0,
    );
    gl.uniform1f(
      u('u_shearAsymmetry'),
      structure?.shearAsymmetryFraction ?? 0,
    );
    gl.uniform1f(u('u_inflow'), INFLOW_RAD);
    const centreLat = c ? clipToLatLon(c.x, c.y, DOMAIN).lat : 21;
    gl.uniform1f(
      u('u_metricX'),
      ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos((centreLat * Math.PI) / 180)) /
        (DOMAIN.latMax - DOMAIN.latMin),
    );
    // Only a live storm produces new rain; aftermath retains routing + decay.
    const raining = Boolean(c && ctx.frame.storm?.alive && ctx.vKt > 0);
    const d = ctx.frame.storm?.diagnostics;
    gl.uniform1f(u('u_eyewallRain'), raining ? (d?.eyewallRainMmH ?? 0) : 0);
    gl.uniform1f(u('u_rainbandRain'), raining ? (d?.rainbandRainMmH ?? 0) : 0);
    gl.uniform1f(
      u('u_orographicRain'),
      raining ? (d?.orographicRainMmH ?? 0) : 0,
    );
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
