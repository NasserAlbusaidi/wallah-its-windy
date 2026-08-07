/**
 * cloud-memory.ts — stateful advected debris field for the simulated clouds.
 *
 * state(k) at each 1-sim-hour boundary is DEFINED as N bounded
 * advect->source->decay passes from a zero field, reading only frozen
 * flight-recorder frames at boundaries k-N..k-1 (causality seal: nothing
 * later than k-1 is ever read, so live play and cold scrub compute the
 * identical texture). CPU mirrors here are vitest-pinned; the GLSL is
 * browser-verified because the suite has no GL harness.
 * Spec: docs/superpowers/specs/2026-07-30-cloud-memory-design.md
 */

import type { FlightFrame } from '../flight-recorder';
import { DOMAIN, latLonToClip } from '../grid';
import type { RenderModule } from './context';
import {
  bindTex,
  disposeRenderTarget,
  makeProgram,
  makeQuadVao,
  makeRenderTarget,
  probeCaps,
} from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';
import {
  CLOUD_ROTATION_CAP_RAD_PER_H,
  LEGACY_CLOUD_ROTATION_RAD_PER_H,
  cloudAngularRateRadPerH,
  cloudMetricX,
} from './cloud-motion';
export { DEBRIS_TOP_COLD_C, DEBRIS_TOP_WARM_C } from './cloud-motion';
import {
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from './storm-radii';

/** Memory boundary spacing, sim-hours. The crossfade denominator in env. */
export const CLOUD_MEMORY_DT_H = 1;
/**
 * Reconstruction window, sim-hours. A parcel lives at most this long BY
 * DEFINITION (truncation is definitional, not approximate); also bounds the
 * cold-scrub rebuild to CLOUD_MEMORY_STEPS passes regardless of storm age.
 */
export const CLOUD_MEMORY_WINDOW_H = 18;
export const CLOUD_MEMORY_STEPS = CLOUD_MEMORY_WINDOW_H / CLOUD_MEMORY_DT_H;
/**
 * Debris e-folding time, sim-hours. WINDOW/TAU = 3 so the oldest parcel
 * leaves the window at byte 13 (~5.1%) — pinned by tailResidualByte().
 */
export const CLOUD_MEMORY_DECAY_TAU_H = 6;
/**
 * Linear advection speed cap, km/h. The angular perception cap alone still
 * permits ~57-100 km/h linear far-field flow (gradient wind), but debris
 * physically rides the ambient flow at tens of km/h — this constant is both
 * the honest debris model and the ~13-texel backtrace bound at 512^2.
 */
export const CLOUD_MEMORY_MAX_ADVECT_KMH = 30;
/**
 * New radial outflow term, km/h (nothing shipped provides one; the
 * decorative field's drift is shear-aligned). Spreads debris outward so the
 * moving source leaves it behind. Ramps 0->full over 1.2..2.5 x RMW.
 */
export const CLOUD_MEMORY_OUTFLOW_KMH = 12;
/** State texture edge, px — a render trait per tier, like dprCap. */
export const CLOUD_MEMORY_SIZE_DETAIL = 512;
export const CLOUD_MEMORY_SIZE_MOBILE = 256;
/**
 * Enhancement-only macro gain: gain(0) = 1 exactly, so an empty field
 * reproduces the shipped look pixel-for-pixel apart from debris.
 */
export const CLOUD_MEMORY_MACRO_GAIN = 0.3;
/** Backtrace substeps; >1 only if browser QA shows swirl artifacts. */
export const CLOUD_MEMORY_SUBSTEPS = 1;
/** Max cloud fraction debris alone can claim (decaying stratiform, not CDO). */
export const DEBRIS_MAX_CLOUD = 0.55;

/** Boundary index and crossfade fraction for a cloud age. */
export function memoryBoundaryPair(cloudAgeH: number): {
  k: number;
  frac: number;
} {
  const t = Math.max(0, cloudAgeH) / CLOUD_MEMORY_DT_H;
  const k = Math.floor(t);
  return { k, frac: t - k };
}

/** Source boundaries for state(k): k-N..k-1, floored at spawn (age 0). */
export function sourceBoundaries(k: number): number[] {
  const out: number[] = [];
  for (let b = Math.max(0, k - CLOUD_MEMORY_STEPS); b < k; b++) out.push(b);
  return out;
}

/** Normalized [0,1] debris age; raw hours would saturate RGBA8 in one step. */
export function encodeDebrisAge(ageH: number): number {
  return Math.min(1, Math.max(0, ageH / CLOUD_MEMORY_WINDOW_H));
}

export function decodeDebrisAge(encoded: number): number {
  return Math.min(1, Math.max(0, encoded)) * CLOUD_MEMORY_WINDOW_H;
}

/** Round-to-nearest 255ths — the RGBA8 store the GL pipeline performs. */
export function quantizeByte(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 255) / 255;
}

/**
 * Advection speed at radius rKm, km/h: display-coherent capped rotation
 * under the same reduced-motion policy as env's animGate, then the linear
 * debris cap.
 */
export function memoryAdvectSpeedKmH(
  rKm: number,
  rmwKm: number,
  vmaxMs: number,
  hollandB: number,
  reducedMotion: boolean,
): number {
  const omega = reducedMotion
    ? LEGACY_CLOUD_ROTATION_RAD_PER_H
    : cloudAngularRateRadPerH(rKm, rmwKm, vmaxMs, hollandB);
  return Math.min(omega * Math.max(rKm, 1), CLOUD_MEMORY_MAX_ADVECT_KMH);
}

/** Sealed combine rule: additive convection with saturation. */
export function densityAfterSource(advected: number, source: number): number {
  return Math.min(1, advected + source);
}

/** Sealed combine rule: density-weighted age — fresh source rejuvenates. */
export function ageAfterSource(
  advectedAge: number,
  advectedDensity: number,
  sourceDensity: number,
): number {
  return (
    (advectedAge * advectedDensity) /
    Math.max(advectedDensity + sourceDensity, 1e-5)
  );
}

/**
 * The tail contract, in encoded space: run the byte-quantized decay
 * recurrence a unit injection experiences (Advect->Source->Decay order =
 * exactly N decays) and return the final stored byte. Spec: <= 13.
 */
export function tailResidualByte(): number {
  const decay = Math.exp(-CLOUD_MEMORY_DT_H / CLOUD_MEMORY_DECAY_TAU_H);
  let stored = 1;
  for (let step = 0; step < CLOUD_MEMORY_STEPS; step++) {
    stored = quantizeByte(stored * decay);
  }
  return Math.round(stored * 255);
}

/** Pure LRU keyed on everything that can change pixels. */
export class CloudMemoryLru<T> {
  private map = new Map<string, T>();

  constructor(private capacity: number) {}

  keyFor(
    runKey: string,
    k: number,
    sizePx: number,
    reducedMotion: boolean,
  ): string {
    return `${runKey}|${k}|${sizePx}|${reducedMotion ? 1 : 0}`;
  }

  get(key: string): T | null {
    const value = this.map.get(key);
    if (value === undefined) return null;
    this.map.delete(key);
    this.map.set(key, value); // refresh recency
    return value;
  }

  /** Insert; returns the evicted value (caller disposes GL resources). */
  set(key: string, value: T): T | null {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size <= this.capacity) return null;
    const oldest = this.map.keys().next().value as string;
    const evicted = this.map.get(oldest) as T;
    this.map.delete(oldest);
    return evicted;
  }
}

/** Boundary indices of the display pair that need computing, in order. */
export function planEnsure(
  cloudAgeH: number,
  cached: (k: number) => boolean,
): number[] {
  const { k } = memoryBoundaryPair(cloudAgeH);
  return [k, k + 1].filter((boundary) => !cached(boundary));
}

/** Read-only flight-recorder surface consumed by the render pass. */
export interface CloudTape {
  frameAtOrBeforeAge(ageH: number): FlightFrame | null;
  runKey(): string | null;
}

// Deliberately NOT the view-aware VIEW_QUAD_VS: cloud-memory state textures
// are domain-registered and causality-sealed (state(k) is a pure function of
// the frozen tape) — the camera must never enter this pipeline. env.ts reads
// the result at view-derived domain UV, which is where presentation happens.
const CLOUD_MEMORY_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const CLOUD_MEMORY_UPDATE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_prev;
uniform sampler2D u_cloudNoise;
uniform vec2 u_center;
uniform float u_metricX;
uniform float u_rMax;
uniform float u_rCanopy;
uniform float u_vmaxMs;
uniform float u_hollandB;
uniform float u_development;
uniform float u_seed;
uniform float u_reducedMotion;

// Holland-profile angular rate at rKm, rad/sim-hour, display-capped.
// Mirrors memoryAdvectSpeedKmH's rotating component exactly.
float cloudOmegaMem(float rKm) {
  float rmwKm = max(u_rMax, ${RENDER_RADIUS_FLOOR}) *
    ${HALF_DOMAIN_HEIGHT_KM}.0;
  float x = min(80.0, pow(max(rmwKm, 1.0) / rKm, u_hollandB));
  float vMs = u_vmaxMs * sqrt(max(0.0, x * exp(1.0 - x)));
  // 3.6: m/s -> km/h. min(): perception cap, not physics.
  return min(3.6 * vMs / rKm, ${CLOUD_ROTATION_CAP_RAD_PER_H});
}

void main() {
  // clip coords of this texel (same uv convention as env.ts VS)
  vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
  vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
  float rKm = max(length(radial) * ${HALF_DOMAIN_HEIGHT_KM}.0, 1.0);

  // -- advect: display-coherent capped rotation under the reduced-motion
  //    policy, then the linear debris cap (see memoryAdvectSpeedKmH mirror).
  float omega = mix(cloudOmegaMem(rKm), ${LEGACY_CLOUD_ROTATION_RAD_PER_H}, u_reducedMotion);
  float tangential = min(omega * rKm, ${CLOUD_MEMORY_MAX_ADVECT_KMH}.0);
  // -- new radial outflow, ramping 0->full over 1.2..2.5 x RMW
  float rmwKm = max(u_rMax, 0.001) * ${HALF_DOMAIN_HEIGHT_KM}.0;
  float outflow = ${CLOUD_MEMORY_OUTFLOW_KMH}.0 *
    smoothstep(1.2 * rmwKm, 2.5 * rmwKm, rKm);
  // CCW tangential + outward radial, in metric km/h
  vec2 tangentialDir = length(radial) > 1e-5
    ? normalize(vec2(-radial.y, radial.x))
    : vec2(0.0);
  vec2 radialDir = length(radial) > 1e-5 ? normalize(radial) : vec2(0.0);
  vec2 velocityKmH = tangentialDir * tangential + radialDir * outflow;
  // km -> clip -> uv backtrace over dt (x undoes metricX; uv y is flipped)
  vec2 dispClip = velocityKmH * ${CLOUD_MEMORY_DT_H}.0 / ${HALF_DOMAIN_HEIGHT_KM}.0;
  dispClip.x /= max(u_metricX, 1e-5);
  vec2 backUv = v_uv - vec2(dispClip.x * 0.5, -dispClip.y * 0.5);
  vec2 prev = texture(u_prev, backUv).rg;

  // -- source: analytic convection envelope at this boundary's storm,
  //    patchy via the shared cloud noise (seeded; no wall-clock input).
  float q = length(radial) / max(u_rMax, 0.001);
  float envelope = u_development * exp(-pow(q / 2.6, 2.0));
  float cells = smoothstep(0.35, 0.8,
    texture(u_cloudNoise, radial * 2.1 + u_seed * 13.0).r);
  float source = envelope * mix(0.35, 1.0, cells) * 0.55;

  // -- sealed combine rules (Task 1 CPU mirrors), then decay
  float density = min(1.0, prev.r + source);
  float age = prev.g * prev.r / max(prev.r + source, 1e-5);
  density *= ${Math.exp(-CLOUD_MEMORY_DT_H / CLOUD_MEMORY_DECAY_TAU_H)};
  // age-reset reads the STORED byte: emulate the quantized zero test
  age = density < (0.5 / 255.0) ? 0.0 : min(1.0, age + ${CLOUD_MEMORY_DT_H / CLOUD_MEMORY_WINDOW_H});
  o = vec4(density, age, 0.0, 0.0);
}`;

const CLOUD_MEMORY_PACK_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_stateA;
uniform sampler2D u_stateB;
void main() {
  o = vec4(texture(u_stateA, v_uv).rg, texture(u_stateB, v_uv).rg);
}`;

/** Stateful offscreen reconstruction and display-pair packing pass. */
export class CloudMemoryPass implements RenderModule {
  private gl: WebGL2RenderingContext | null = null;
  private caps: GlCaps | null = null;
  private updateProgram: WebGLProgram | null = null;
  private updateVao: WebGLVertexArrayObject | null = null;
  private packProgram: WebGLProgram | null = null;
  private packVao: WebGLVertexArrayObject | null = null;
  private work: [RenderTarget | null, RenderTarget | null] = [null, null];
  private packed: RenderTarget | null = null;
  private packedKey: string | null = null;
  private tape: CloudTape | null = null;
  private lru = new CloudMemoryLru<RenderTarget>(6);
  private cachedTargets = new Set<RenderTarget>();
  private width = 1;
  private height = 1;
  private sizePx = CLOUD_MEMORY_SIZE_MOBILE;

  init(gl: WebGL2RenderingContext): void {
    if (this.gl) this.dispose();
    this.gl = gl;
    this.caps = probeCaps(gl);
    this.updateProgram = makeProgram(gl, CLOUD_MEMORY_VS, CLOUD_MEMORY_UPDATE_FS);
    this.updateVao = makeQuadVao(gl, this.updateProgram);
    this.packProgram = makeProgram(gl, CLOUD_MEMORY_VS, CLOUD_MEMORY_PACK_FS);
    this.packVao = makeQuadVao(gl, this.packProgram);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (!this.gl || !this.caps) return;

    // main.ts publishes the exact chooseRenderProfile().compact decision before
    // resizing layers. Dimensions are only the non-DOM fallback for this module.
    const compactTrait = typeof document === 'undefined'
      ? null
      : document.documentElement.dataset.compact;
    const compact = compactTrait === null || compactTrait === undefined
      ? Math.min(this.width, this.height) <= 820
      : compactTrait === 'true';
    const nextSize = compact
      ? CLOUD_MEMORY_SIZE_MOBILE
      : CLOUD_MEMORY_SIZE_DETAIL;
    if (
      nextSize === this.sizePx &&
      this.work[0] &&
      this.work[1] &&
      this.packed
    ) {
      return;
    }

    const gl = this.gl;
    disposeRenderTarget(gl, this.work[0]);
    disposeRenderTarget(gl, this.work[1]);
    disposeRenderTarget(gl, this.packed);
    this.sizePx = nextSize;
    this.work = [
      makeRenderTarget(gl, this.sizePx, this.sizePx, this.caps, true),
      makeRenderTarget(gl, this.sizePx, this.sizePx, this.caps, true),
    ];
    this.packed = makeRenderTarget(
      gl,
      this.sizePx,
      this.sizePx,
      this.caps,
      true,
    );
    this.packedKey = null;
    for (const target of [...this.work, this.packed]) {
      if (!target) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, this.sizePx, this.sizePx);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.restoreScreenTarget();
  }

  setTape(tape: CloudTape | null): void {
    if (this.tape !== tape) this.packedKey = null;
    this.tape = tape;
  }

  ensure(
    cloudAgeH: number,
    reducedMotion: boolean,
    cloudNoiseTex: WebGLTexture | null,
    cloudSeed: number,
  ): void {
    if (
      !this.gl ||
      !this.tape ||
      !cloudNoiseTex ||
      !this.updateProgram ||
      !this.updateVao ||
      !this.packProgram ||
      !this.packVao ||
      !this.work[0] ||
      !this.work[1] ||
      !this.packed
    ) {
      return;
    }
    const runKey = this.tape.runKey();
    if (runKey === null) {
      this.packedKey = null;
      return;
    }

    const need = planEnsure(
      cloudAgeH,
      (k) => this.lru.get(
        this.lru.keyFor(runKey, k, this.sizePx, reducedMotion),
      ) !== null,
    );
    for (const k of need) {
      this.computeState(k, runKey, reducedMotion, cloudNoiseTex, cloudSeed);
    }

    const { k } = memoryBoundaryPair(cloudAgeH);
    const keyA = this.lru.keyFor(runKey, k, this.sizePx, reducedMotion);
    const keyB = this.lru.keyFor(runKey, k + 1, this.sizePx, reducedMotion);
    const stateA = this.lru.get(keyA);
    const stateB = this.lru.get(keyB);
    if (!stateA || !stateB) {
      throw new Error('cloud-memory: display pair missing after ensure');
    }
    const pairKey = keyA + '>' + keyB;
    if (pairKey !== this.packedKey) {
      this.packDisplay(stateA, stateB);
      this.packedKey = pairKey;
    }
  }

  get texture(): WebGLTexture | null {
    return this.packedKey === null ? null : (this.packed?.tex ?? null);
  }

  private computeState(
    k: number,
    runKey: string,
    reducedMotion: boolean,
    cloudNoiseTex: WebGLTexture,
    cloudSeed: number,
  ): void {
    const gl = this.gl;
    const caps = this.caps;
    const tape = this.tape;
    const updateProgram = this.updateProgram;
    const workA = this.work[0];
    const workB = this.work[1];
    if (!gl || !caps || !tape || !updateProgram || !workA || !workB) return;

    const frames = sourceBoundaries(k).map((boundary) => {
      const frame = tape.frameAtOrBeforeAge(boundary * CLOUD_MEMORY_DT_H);
      if (!frame) {
        throw new Error('cloud-memory: no tape frame at boundary ' + boundary);
      }
      return frame;
    });
    const cached = makeRenderTarget(
      gl,
      this.sizePx,
      this.sizePx,
      caps,
      true,
    );

    try {
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, workA.fbo);
      gl.viewport(0, 0, this.sizePx, this.sizePx);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (frames.length === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, cached.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        gl.useProgram(updateProgram);
        gl.bindVertexArray(this.updateVao);
        const u = (name: string) => gl.getUniformLocation(updateProgram, name);
        let source = workA;
        let workIndex = 0;
        for (let step = 0; step < frames.length; step++) {
          const frame = frames[step];
          const last = step === frames.length - 1;
          const destination = last
            ? cached
            : (workIndex === 0 ? workB : workA);
          gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo);
          bindTex(gl, 0, source.tex, u('u_prev'));
          bindTex(gl, 1, cloudNoiseTex, u('u_cloudNoise'));

          const center = latLonToClip(frame.lat, frame.lon, DOMAIN);
          const radii = stormRenderRadii(frame.structure);
          const intensity01 = Math.min(1, Math.max(0, (frame.vKt - 20) / 100));
          const development = Math.min(
            1,
            Math.max(0, 0.56 * frame.organization + 0.44 * intensity01),
          );
          gl.uniform2f(u('u_center'), center.x, center.y);
          // Causality seal: metricX derives from THIS boundary frame's
          // latitude, never the display frame's — state(k) must be a pure
          // function of the frozen tape or scrub returns stop being
          // byte-identical (QA item 1 caught exactly this).
          gl.uniform1f(u('u_metricX'), cloudMetricX(frame.lat));
          gl.uniform1f(u('u_rMax'), radii.rMax);
          gl.uniform1f(u('u_rCanopy'), radii.rCanopy);
          gl.uniform1f(
            u('u_vmaxMs'),
            frame.structure.maximumWindKt * 0.514444,
          );
          gl.uniform1f(u('u_hollandB'), frame.structure.hollandB);
          gl.uniform1f(u('u_development'), development);
          gl.uniform1f(u('u_seed'), cloudSeed);
          gl.uniform1f(u('u_reducedMotion'), reducedMotion ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          source = destination;
          if (!last) workIndex = 1 - workIndex;
        }
      }
    } catch (error) {
      disposeRenderTarget(gl, cached);
      throw error;
    } finally {
      gl.bindVertexArray(null);
      this.restoreScreenTarget();
    }

    this.cachedTargets.add(cached);
    const key = this.lru.keyFor(runKey, k, this.sizePx, reducedMotion);
    const evicted = this.lru.set(key, cached);
    if (evicted) {
      this.cachedTargets.delete(evicted);
      disposeRenderTarget(gl, evicted);
    }
  }

  private packDisplay(stateA: RenderTarget, stateB: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.packProgram || !this.packVao || !this.packed) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.packed.fbo);
    gl.viewport(0, 0, this.sizePx, this.sizePx);
    gl.disable(gl.BLEND);
    gl.useProgram(this.packProgram);
    gl.bindVertexArray(this.packVao);
    const u = (name: string) => gl.getUniformLocation(this.packProgram!, name);
    bindTex(gl, 0, stateA.tex, u('u_stateA'));
    bindTex(gl, 1, stateB.tex, u('u_stateB'));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.restoreScreenTarget();
  }

  private restoreScreenTarget(): void {
    if (!this.gl) return;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.updateProgram) gl.deleteProgram(this.updateProgram);
      if (this.packProgram) gl.deleteProgram(this.packProgram);
      if (this.updateVao) gl.deleteVertexArray(this.updateVao);
      if (this.packVao) gl.deleteVertexArray(this.packVao);
      disposeRenderTarget(gl, this.work[0]);
      disposeRenderTarget(gl, this.work[1]);
      disposeRenderTarget(gl, this.packed);
      for (const target of this.cachedTargets) {
        disposeRenderTarget(gl, target);
      }
    }
    this.updateProgram = null;
    this.updateVao = null;
    this.packProgram = null;
    this.packVao = null;
    this.work = [null, null];
    this.packed = null;
    this.packedKey = null;
    this.cachedTargets.clear();
    this.lru = new CloudMemoryLru<RenderTarget>(6);
    this.caps = null;
    this.gl = null;
  }
}
