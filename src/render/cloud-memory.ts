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

import {
  LEGACY_CLOUD_ROTATION_RAD_PER_H,
  cloudAngularRateRadPerH,
} from './cloud-motion';

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
/** Debris cloud-top grading, deg C — warmer than fresh bands (-45..-62). */
export const DEBRIS_TOP_WARM_C = -28;
export const DEBRIS_TOP_COLD_C = -45;
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
