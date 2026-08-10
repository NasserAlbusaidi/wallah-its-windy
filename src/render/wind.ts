/**
 * wind.ts — the Windy-style full-map wind flow: particles + fading trails.
 *
 * ~3k particles seeded across the whole chart advect through the SUPERPOSED
 * wind field: baked ERA5 deep-layer steering (CPU-sampled from env.bin via the
 * facade's steeringAt closure) plus the SAME analytic Holland vortex the storm
 * particles and rain ride (vortex.ts), fed with the live parametric structure
 * so the swarm and the flow field never disagree. Speed colours each trail
 * through the shared wind-palette tokens.
 *
 * Trails are the classic technique: an offscreen half-res target is faded a
 * little each frame (dst *= fadeKeep), new segments draw additively on top,
 * and the target composites to screen with additive blending. Everything here
 * is decorative — no physics reads it; the RNG is a fixed private seed.
 *
 * prefers-reduced-motion is gated here in the module; the wind-speed fill in
 * env.ts still communicates either field without motion. The parameterized upper
 * path advects through upperAt only and never superposes the Holland vortex.
 */

import { TOKENS } from '../tokens';
import { makeRng } from '../rng';
import type { Rng } from '../rng';
import { DOMAIN, clipToLatLon } from '../grid';
import { INFLOW_RAD, vortexWind } from './vortex';
import { domainScissorRect } from '../domain-clip';
import {
  bindTex,
  makeProgram,
  makeQuadVao,
  makeRenderTarget,
  disposeRenderTarget,
  setViewUniform,
} from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';
import type { DrawCtx, RenderModule } from './context';
import { HALF_DOMAIN_HEIGHT_KM } from './storm-radii';

const DEFAULT_COUNT = 3000;
const MS_PER_KT = 0.514444;
/** Visual advection gain: clip units per second per m/s of wind. */
const SPEED_TO_CLIP = 0.0032;
/** Trail persistence per second (higher = longer trails). */
const TRAIL_KEEP_PER_S = 0.045; // keep^dt: ~0.95 per frame at 60 fps
const LIFE_MIN_S = 2.0;
const LIFE_MAX_S = 5.0;
/** Palette span, m/s (matches the wind layer legend + fill shader). */
const SPEED_SPAN_MS = 50;
/**
 * Clip-x metres per clip-y metre, deliberately frozen at the domain's mid
 * latitude (~1.56): the whole particle field shares one advection frame, so a
 * per-particle cos(lat) would shear trails mid-flight. Not a duplicate of
 * cloudMetricX (which is latitude-dependent by design).
 */
const METRIC_X =
  ((DOMAIN.lonMax - DOMAIN.lonMin) *
    Math.cos((((DOMAIN.latMin + DOMAIN.latMax) / 2) * Math.PI) / 180)) /
  (DOMAIN.latMax - DOMAIN.latMin);
/**
 * Vortex RMW floor for the wind-line field, in KILOMETRES (7.992 / 666 is
 * bit-exactly the old 0.012 clip literal). In km it cannot rescale with the
 * domain; structure.ts clamps rmwKm to >= 12, so it never binds in practice.
 */
const VORTEX_RMAX_FLOOR_KM = 7.992;

// a_pos is WORLD clip; u_view projects it to the screen-registered trail
// target (camera moves clear the trail history rather than re-projecting it).
const LINE_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
in float a_speed;
in float a_alpha;
uniform vec4 u_view;
out float v_speed;
out float v_alpha;
void main() {
  v_speed = a_speed;
  v_alpha = a_alpha;
  gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
}`;

const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_speed;
in float v_alpha;
out vec4 o;
uniform vec3 u_w0;
uniform vec3 u_w1;
uniform vec3 u_w2;
uniform vec3 u_w3;
uniform vec3 u_w4;
vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(u_w0, u_w1, x);
  if (x < 2.0) return mix(u_w1, u_w2, x - 1.0);
  if (x < 3.0) return mix(u_w2, u_w3, x - 2.0);
  return mix(u_w3, u_w4, x - 3.0);
}
void main() {
  // Lift the ramp toward white so 1px trails read over the matching fill.
  vec3 color = mix(ramp(v_speed), vec3(1.0), 0.35);
  o = vec4(color, v_alpha);
}`;

const FADE_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/**
 * Two decay passes share this shader. Pass 1 (multiply): rgb=0, alpha=u_keep
 * with blendFunc(ZERO, SRC_ALPHA) → dst *= keep. Pass 2 (subtract, only on
 * the RGBA8 fallback target): rgb=u_sub, blendEquation(REVERSE_SUBTRACT) →
 * dst -= sub, which drains the ~1-4% residue an 8-bit multiplicative fade
 * rounds into permanence (the classic webgl-wind artifact).
 */
const FADE_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
uniform float u_keep;
uniform float u_sub;
void main() { o = vec4(vec3(u_sub), u_keep); }`;

const COMP_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COMP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_trails;
uniform float u_alpha;
void main() {
  vec3 c = texture(u_trails, v_uv).rgb;
  o = vec4(c * u_alpha, 1.0);
}`;

export class WindLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private caps: GlCaps = { colorBufferFloat: false, floatLinear: false };
  private lineProg: WebGLProgram | null = null;
  private fadeProg: WebGLProgram | null = null;
  private compProg: WebGLProgram | null = null;
  private fadeVao: WebGLVertexArrayObject | null = null;
  private compVao: WebGLVertexArrayObject | null = null;
  private lineVao: WebGLVertexArrayObject | null = null;
  private lineBuf: WebGLBuffer | null = null;
  private trails: RenderTarget | null = null;
  private rtW = 1;
  private rtH = 1;
  private width = 1;
  private height = 1;

  private count = DEFAULT_COUNT;
  /** Per particle: x, y (clip). */
  private pos = new Float32Array(this.count * 2);
  private life = new Float32Array(this.count);
  /** Two line vertices per particle: (x, y, speed01, alpha) each. */
  private verts = new Float32Array(this.count * 8);
  private rng: Rng;
  private seeded = false;
  /**
   * World-space seed/kill rectangles tracking the visible viewport (set each
   * draw from ctx.view; defaults to the full domain). Seeding into the view
   * keeps on-screen particle density constant across the zoom range; the
   * kill margin is wider than the seed margin so edge spawns aren't culled.
   */
  private seedRect = { minX: -1.02, maxX: 1.02, minY: -1.02, maxY: 1.02 };
  private killRect = { minX: -1.04, maxX: 1.04, minY: -1.04, maxY: 1.04 };

  constructor(private readonly fieldKind: 'surface' | 'upper' = 'surface') {
    this.rng = makeRng(fieldKind === 'upper' ? 0x2007717 : 0x7717d);
  }

  setBudget(stormParticleBudget: number): void {
    // Scale with the device profile's storm-swarm budget, bounded sanely.
    const next = Math.max(600, Math.min(4200, Math.round(stormParticleBudget * 0.4)));
    if (next === this.count) return;
    this.count = next;
    this.pos = new Float32Array(next * 2);
    this.life = new Float32Array(next);
    this.verts = new Float32Array(next * 8);
    this.seeded = false;
    if (this.lineBuf && this.gl) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.lineBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.verts.byteLength, this.gl.DYNAMIC_DRAW);
    }
  }

  init(gl: WebGL2RenderingContext, caps?: GlCaps): void {
    this.gl = gl;
    if (caps) this.caps = caps;
    this.lineProg = makeProgram(gl, LINE_VS, LINE_FS);
    this.fadeProg = makeProgram(gl, FADE_VS, FADE_FS);
    this.compProg = makeProgram(gl, COMP_VS, COMP_FS);
    this.fadeVao = makeQuadVao(gl, this.fadeProg);
    this.compVao = makeQuadVao(gl, this.compProg);
    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(this.lineProg, 'a_pos');
    const speedLoc = gl.getAttribLocation(this.lineProg, 'a_speed');
    const alphaLoc = gl.getAttribLocation(this.lineProg, 'a_alpha');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(speedLoc);
    gl.vertexAttribPointer(speedLoc, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(alphaLoc);
    gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const gl = this.gl;
    if (!gl) return;
    this.rtW = Math.max(1, Math.floor(this.width / 2));
    this.rtH = Math.max(1, Math.floor(this.height / 2));
    disposeRenderTarget(gl, this.trails);
    this.trails = makeRenderTarget(gl, this.rtW, this.rtH, this.caps);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trails.fbo);
    gl.viewport(0, 0, this.rtW, this.rtH);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private respawn(i: number): void {
    const r = this.seedRect;
    this.pos[i * 2] = r.minX + this.rng.next() * (r.maxX - r.minX);
    this.pos[i * 2 + 1] = r.minY + this.rng.next() * (r.maxY - r.minY);
    this.life[i] = LIFE_MIN_S + this.rng.next() * (LIFE_MAX_S - LIFE_MIN_S);
  }

  private seedAll(): void {
    for (let i = 0; i < this.count; i++) this.respawn(i);
    this.seeded = true;
  }

  /** Total wind (m/s, east/north) at a clip position for the current frame. */
  private windAt(
    x: number,
    y: number,
    ctx: DrawCtx,
  ): { u: number; v: number } {
    if (this.fieldKind === 'upper') {
      if (!ctx.upperAt) return { u: 0, v: 0 };
      const { lat, lon } = clipToLatLon(x, y, DOMAIN);
      return ctx.upperAt(lat, lon);
    }
    let u = 0;
    let v = 0;
    if (ctx.steeringAt) {
      const { lat, lon } = clipToLatLon(x, y, DOMAIN);
      const steering = ctx.steeringAt(lat, lon);
      u = steering.u;
      v = steering.v;
    }
    const c = ctx.centerClip;
    const s = ctx.structure;
    if (c && s && s.maximumWindKt > 1 && ctx.aftermath > 0.001) {
      // Metric frame (clip-y units): scale x by METRIC_X so the vortex is
      // round on the ground, mirroring the rain shader's u_metricX.
      const w = vortexWind((x - c.x) * METRIC_X, y - c.y, {
        cx: 0,
        cy: 0,
        rMax:
          Math.max(VORTEX_RMAX_FLOOR_KM, s.rmwKm) / HALF_DOMAIN_HEIGHT_KM,
        vMax: s.maximumWindKt * MS_PER_KT,
        hollandB: s.hollandB,
        motionX: s.motionUms,
        motionY: s.motionVms,
        asymmetryFraction:
          s.translationAsymmetryKt / Math.max(1, s.maximumWindKt),
        outerScale: s.outerWindScale,
        outerBlendStartFraction:
          s.outerBlendStartWindKt / Math.max(1, s.maximumWindKt),
        outerBlendFullFraction:
          s.outerBlendFullWindKt / Math.max(1, s.maximumWindKt),
        shearX: s.shearUms,
        shearY: s.shearVms,
        shearAsymmetryFraction: s.shearAsymmetryFraction,
        inflow: INFLOW_RAD,
      });
      // The vortex spins down over the aftermath fade; the ambient steering
      // flow persists — the map is windy with or without a storm.
      u += w.wx * ctx.aftermath;
      v += w.wy * ctx.aftermath;
    }
    return { u, v };
  }

  draw(ctx: DrawCtx): void {
    const gl = this.gl;
    if (
      !this.lineProg ||
      !this.trails ||
      ctx.reduced ||
      (this.fieldKind === 'upper' && !ctx.upperAt)
    ) return;
    const weatherClip = domainScissorRect(ctx.view, this.width, this.height);
    if (weatherClip.width <= 0 || weatherClip.height <= 0) {
      // No supported forcing is visible. Do not sample a clamped edge field in
      // presentation-only geography, and purge trails before a later pan home.
      if (this.seeded) this.clearTrails();
      this.seeded = false;
      return;
    }

    // Track only the visible intersection with the simulation's WORLD-space
    // [-1,1] box. Margins help particles drift in, but never authorize samples
    // from the larger terrain-only display context.
    const v = ctx.view;
    const vminX = (-1 - v.offsetX) / v.scaleX;
    const vmaxX = (1 - v.offsetX) / v.scaleX;
    const vminY = (-1 - v.offsetY) / v.scaleY;
    const vmaxY = (1 - v.offsetY) / v.scaleY;
    const mx = (vmaxX - vminX) * 0.02;
    const my = (vmaxY - vminY) * 0.02;
    this.seedRect = {
      minX: Math.max(-1, vminX - mx),
      maxX: Math.min(1, vmaxX + mx),
      minY: Math.max(-1, vminY - my),
      maxY: Math.min(1, vmaxY + my),
    };
    this.killRect = {
      minX: Math.max(-1, vminX - 2 * mx),
      maxX: Math.min(1, vmaxX + 2 * mx),
      minY: Math.max(-1, vminY - 2 * my),
      maxY: Math.min(1, vmaxY + 2 * my),
    };
    if (!this.seeded) this.seedAll();
    const dt = Math.max(0.001, ctx.dtSec);

    // 1) Advect on the CPU and build the line-segment vertex data.
    const verts = this.verts;
    for (let i = 0; i < this.count; i++) {
      const px = this.pos[i * 2];
      const py = this.pos[i * 2 + 1];
      const wind = this.windAt(px, py, ctx);
      const speedMs = Math.hypot(wind.u, wind.v);
      // East advances clip-x more slowly than north advances clip-y (the
      // domain spans more ground east-west) — divide by METRIC_X.
      const nx = px + (wind.u / METRIC_X) * SPEED_TO_CLIP * dt;
      const ny = py + wind.v * SPEED_TO_CLIP * dt;
      this.life[i] -= dt;
      const k = this.killRect;
      const dead =
        this.life[i] <= 0 ||
        nx < k.minX || nx > k.maxX || ny < k.minY || ny > k.maxY;
      const speed01 = Math.min(1, speedMs / SPEED_SPAN_MS);
      // Fade in/out over the ends of a particle's life. NOT scaled by
      // ctx.aftermath — the ambient flow must not vanish after a storm dies
      // (the vortex term above already spins down with the fade).
      const alpha = dead
        ? 0
        : Math.min(1, this.life[i] / 0.5) * (0.28 + 0.5 * speed01);
      const o = i * 8;
      verts[o] = px;
      verts[o + 1] = py;
      verts[o + 2] = speed01;
      verts[o + 3] = alpha;
      verts[o + 4] = nx;
      verts[o + 5] = ny;
      verts[o + 6] = speed01;
      verts[o + 7] = alpha;
      if (dead) {
        this.respawn(i);
      } else {
        this.pos[i * 2] = nx;
        this.pos[i * 2 + 1] = ny;
      }
    }

    // 2) Decay the trail buffer, then draw the new segments into it.
    // A screen-space clip is only valid for the final default-framebuffer
    // composite, never for this earth-fixed trail-state target.
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trails.fbo);
    gl.viewport(0, 0, this.rtW, this.rtH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.useProgram(this.fadeProg);
    gl.bindVertexArray(this.fadeVao);
    const keep = Math.pow(TRAIL_KEEP_PER_S, dt);
    const uKeep = gl.getUniformLocation(this.fadeProg!, 'u_keep');
    const uSub = gl.getUniformLocation(this.fadeProg!, 'u_sub');
    gl.uniform1f(uKeep, keep);
    gl.uniform1f(uSub, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!this.trails.float) {
      // 8-bit target: the multiply stalls below ~10/255, so drain the floor.
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(uKeep, 0);
      gl.uniform1f(uSub, 1 / 255);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.blendEquation(gl.FUNC_ADD);
    }

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.lineProg);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
    const u = (n: string) => gl.getUniformLocation(this.lineProg!, n);
    setViewUniform(gl, u('u_view'), ctx.view);
    gl.uniform3fv(u('u_w0'), TOKENS.wind0.rgba01.subarray(0, 3));
    gl.uniform3fv(u('u_w1'), TOKENS.wind1.rgba01.subarray(0, 3));
    gl.uniform3fv(u('u_w2'), TOKENS.wind2.rgba01.subarray(0, 3));
    gl.uniform3fv(u('u_w3'), TOKENS.wind3.rgba01.subarray(0, 3));
    gl.uniform3fv(u('u_w4'), TOKENS.wind4.rgba01.subarray(0, 3));
    gl.drawArrays(gl.LINES, 0, this.count * 2);
    gl.bindVertexArray(null);

    // 3) Composite the trails to the screen additively.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.compProg);
    gl.bindVertexArray(this.compVao);
    bindTex(gl, 0, this.trails.tex, gl.getUniformLocation(this.compProg!, 'u_trails'));
    gl.uniform1f(
      gl.getUniformLocation(this.compProg!, 'u_alpha'),
      0.9 * (ctx.demo ? 0.8 : 1),
    );
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      weatherClip.x,
      weatherClip.y,
      weatherClip.width,
      weatherClip.height,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }

  /** Clear trails so stale streaks don't linger when the layer re-activates. */
  clearTrails(): void {
    const gl = this.gl;
    if (!gl || !this.trails) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trails.fbo);
    gl.viewport(0, 0, this.rtW, this.rtH);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.lineProg) gl.deleteProgram(this.lineProg);
    if (this.fadeProg) gl.deleteProgram(this.fadeProg);
    if (this.compProg) gl.deleteProgram(this.compProg);
    if (this.lineVao) gl.deleteVertexArray(this.lineVao);
    if (this.fadeVao) gl.deleteVertexArray(this.fadeVao);
    if (this.compVao) gl.deleteVertexArray(this.compVao);
    if (this.lineBuf) gl.deleteBuffer(this.lineBuf);
    disposeRenderTarget(gl, this.trails);
    this.lineProg = this.fadeProg = this.compProg = null;
    this.lineVao = this.fadeVao = this.compVao = null;
    this.lineBuf = null;
    this.trails = null;
    this.seeded = false;
  }
}
