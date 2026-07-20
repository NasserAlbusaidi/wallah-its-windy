/**
 * particles.ts — the storm as a satellite spiral (design "whoa" moment).
 *
 * 8k particles held in a preallocated interleaved typed array (x, y, alpha) and
 * advected on the CPU each frame through the SHARED analytic Rankine vortex
 * (vortex.ts) around the interpolated storm centre — the same wind field the
 * rain source samples, so spiral and rain never disagree. Particles are seeded
 * along two logarithmic spiral arms and recycled as the ~20° inflow pulls them
 * in, so the swarm reads as a rotating spiral rather than a shrinking disc.
 *
 * The vortex runs in an aspect-corrected "iso" frame (clip.x scaled by W/H) so
 * the spiral is ROUND on screen regardless of window shape; positions convert
 * back to clip for the VBO. Drawn as soft additive points in the storm-core
 * token. Downshear smear (eng task T10): when env shear exceeds a threshold the
 * whole swarm drifts downshear, streaking the spiral — a rendered cause of death.
 * Demo storm renders dimmer. prefers-reduced-motion never reaches here (the
 * facade draws track+halo instead); the guard is belt-and-braces.
 *
 * No per-frame allocation: the arrays and the GPU buffer are sized once.
 */

import { TOKENS } from '../tokens';
import { makeRng } from '../rng';
import { INFLOW_RAD, vortexWind } from './vortex';
import { makeProgram } from './gl-utils';
import type { Rng } from '../rng';
import type { DrawCtx, RenderModule } from './context';

const DEFAULT_COUNT = 8000;
const RMAX_BASE = 0.11; // radius of max wind, iso units (fraction of half-height)
const VMAX_BASE = 0.32; // peak tangential speed, iso units / sec
const SPAWN_R = 0.34; // outer seed radius, iso units
const SPIRAL_TIGHTNESS = 2.4;
const SHEAR_THRESHOLD = 9; // m/s; above this the swarm smears downshear
const SHEAR_K = 0.010; // clip units / sec per (m/s) above threshold
const LIFE_MIN = 2.2;
const LIFE_MAX = 5.5;

const VS = /* glsl */ `#version 300 es
in vec2 a_pos;
in float a_a;
uniform float u_size;
out float v_a;
void main() {
  v_a = a_a;
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const FS = /* glsl */ `#version 300 es
precision highp float;
in float v_a;
out vec4 o;
uniform vec4 u_core;
uniform float u_alpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float g = smoothstep(1.0, 0.0, d);
  o = vec4(u_core.rgb, g * g * v_a * u_alpha);
}`;

export class ParticleLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private count = DEFAULT_COUNT;
  private data = new Float32Array(this.count * 3); // x, y, alpha interleaved
  private life = new Float32Array(this.count);
  private rng: Rng = makeRng(0x51ee9);
  private seeded = false;
  private uSize: WebGLUniformLocation | null = null;
  private uCore: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private height = 1;

  setBudget(count: number): void {
    const next = Math.max(256, Math.round(count));
    if (next === this.count) return;
    this.count = next;
    this.data = new Float32Array(next * 3);
    this.life = new Float32Array(next);
    this.seeded = false;
    if (this.buf && this.gl) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        this.data.byteLength,
        this.gl.DYNAMIC_DRAW,
      );
    }
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(this.prog, 'a_pos');
    const aLoc = gl.getAttribLocation(this.prog, 'a_a');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);
    this.uSize = gl.getUniformLocation(this.prog, 'u_size');
    this.uCore = gl.getUniformLocation(this.prog, 'u_core');
    this.uAlpha = gl.getUniformLocation(this.prog, 'u_alpha');
  }

  resize(_w: number, h: number): void {
    this.height = h;
  }

  /** Seed particle i onto one of two spiral arms around the centre (iso frame). */
  private spawn(i: number, cx: number, cy: number, aspect: number, intensity: number): void {
    const rMax = RMAX_BASE * (0.7 + 0.6 * intensity);
    const rr = rMax * 0.3 + this.rng.next() * (SPAWN_R - rMax * 0.3);
    const arm = this.rng.next() < 0.5 ? 0 : Math.PI;
    const theta = arm + SPIRAL_TIGHTNESS * Math.log(rr / rMax + 0.001) + (this.rng.next() - 0.5) * 0.5;
    const fx = rr * Math.cos(theta);
    const fy = rr * Math.sin(theta);
    const o = i * 3;
    this.data[o] = cx + fx / aspect;
    this.data[o + 1] = cy + fy;
    this.data[o + 2] = 0; // fades in as life starts
    this.life[i] = LIFE_MIN + this.rng.next() * (LIFE_MAX - LIFE_MIN);
  }

  private seedAll(cx: number, cy: number, aspect: number, intensity: number): void {
    for (let i = 0; i < this.count; i++) {
      this.spawn(i, cx, cy, aspect, intensity);
    }
    this.seeded = true;
  }

  draw(ctx: DrawCtx): void {
    const gl = this.gl;
    if (!this.prog || ctx.reduced) return;
    const c = ctx.centerClip;
    if (!c) {
      this.seeded = false; // storm gone; re-seed on next spawn
      return;
    }
    const aspect = ctx.aspect;
    const intensity = ctx.intensity01;
    if (!this.seeded) this.seedAll(c.x, c.y, aspect, intensity);

    const dt = ctx.dtSec;
    const rMax = RMAX_BASE * (0.7 + 0.6 * intensity);
    const vMax = VMAX_BASE * (0.5 + 0.5 * intensity);

    // Downshear drift (clip units/sec) from env shear + steering-direction proxy.
    let driftX = 0;
    let driftY = 0;
    if (ctx.env && ctx.env.shear > SHEAR_THRESHOLD) {
      const su = ctx.env.steerU;
      const sv = ctx.env.steerV;
      const mag = Math.hypot(su, sv) || 1;
      const g = SHEAR_K * (ctx.env.shear - SHEAR_THRESHOLD);
      driftX = (su / mag) * g;
      driftY = (sv / mag) * g;
    }

    const data = this.data;
    const life = this.life;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      // Relative position in the round iso frame.
      let fx = (data[o] - c.x) * aspect;
      let fy = data[o + 1] - c.y;
      const w = vortexWind(fx, fy, { cx: 0, cy: 0, rMax, vMax, inflow: INFLOW_RAD });
      fx += w.wx * dt;
      fy += w.wy * dt;
      let x = c.x + fx / aspect + driftX * dt;
      let y = c.y + fy + driftY * dt;
      life[i] -= dt;
      const r = Math.hypot(fx, fy);
      if (life[i] <= 0 || r > SPAWN_R * 1.4 || r < 0.006) {
        this.spawn(i, c.x, c.y, aspect, intensity);
        continue;
      }
      // Fade in over the first ~0.4s of life, fade out over the last ~0.6s.
      const lifeFrac = life[i];
      const fadeIn = Math.min(1, (LIFE_MAX - lifeFrac) / 0.4);
      const fadeOut = Math.min(1, lifeFrac / 0.6);
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = Math.min(fadeIn, fadeOut);
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
    gl.useProgram(this.prog);
    gl.uniform1f(this.uSize, this.height * 0.011 * (0.8 + 0.5 * intensity));
    gl.uniform4fv(this.uCore, TOKENS.stormCore.rgba01);
    // Soft per-point alpha; demo storm and aftermath both render dimmer.
    const baseAlpha = 0.10 * (ctx.demo ? 0.45 : 1) * ctx.aftermath;
    gl.uniform1f(this.uAlpha, baseAlpha);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.buf) gl.deleteBuffer(this.buf);
    this.prog = null;
    this.vao = null;
    this.buf = null;
    this.seeded = false;
  }
}
