/**
 * Decorative cloud-motion contract for the simulated IR layer.
 *
 * Owns the constants and scalar math the env fragment shader embeds via
 * template literals, plus CPU mirrors that vitest can pin — the suite has no
 * GL harness, so the GLSL sampling itself is browser-verified. Rain-aligned
 * geometry (precipitating-cloud.ts, RAINBAND_SPIRAL_ROTATION_PER_H) is a
 * separate contract and deliberately not touched here.
 */

import { HALF_DOMAIN_HEIGHT_KM } from './storm-radii';

/**
 * Display cap on cloud angular velocity, rad/sim-hour. PERCEPTION CAP, NOT
 * PHYSICS: a real eyewall (~4-5 rad/sim-h) at the 3 h/s playback timescale
 * would display above two revolutions per second and alias into blur. 0.6
 * gives an eyewall lap of ~3.5 screen-seconds.
 */
export const CLOUD_ROTATION_CAP_RAD_PER_H = 0.6;

/**
 * Flow-map sawtooth period, sim-hours. Bounds differential twist per phase to
 * cap x period = 0.45 rad so the advected noise never winds into filaments.
 * Tunable in [0.5, 1.5] against crossfade shimmer during browser QA; the
 * spec's bounded-distortion intent (<= ~1 rad) must hold.
 */
export const CLOUD_CROSSFADE_PERIOD_H = 0.75;

/** Band-pattern solid-body reference radius, in rMax units (spec: 2.5). */
export const CLOUD_BAND_REFERENCE_Q = 2.5;

/**
 * Overshooting-top lifecycle period, sim-hours. Real tops live ~30 min, which
 * is sub-second at 3 h/s; the stretch is a display-honesty compromise covered
 * by the layer's "simulated" label.
 */
export const CLOUD_PULSE_PERIOD_H = 2;

/** Pre-change solid-body rate, kept verbatim for the reduced-motion path. */
export const LEGACY_CLOUD_ROTATION_RAD_PER_H = 0.028;

/**
 * Interpolated decorative cloud age for u_cloudAgeH. Raw fixed-frame ageH
 * jumps 0.25 h per tick — up to 0.15 rad at the cap — and visibly stutters.
 * Runs monotonically forward: a respawn (prev age ahead of the new storm's)
 * snaps to the new age instead of interpolating backwards.
 */
export function interpolatedCloudAgeH(
  prevAgeH: number | null,
  ageH: number,
  alpha: number,
): number {
  if (prevAgeH === null || !Number.isFinite(prevAgeH) || prevAgeH > ageH) {
    return ageH;
  }
  const clamped = Math.min(1, Math.max(0, alpha));
  return prevAgeH + (ageH - prevAgeH) * clamped;
}

/**
 * Holland-profile angular rate at radius rKm, rad/sim-hour, display-capped.
 * 3.6 converts m/s to km/h; radii floor at 1 km to guard the singularity.
 */
export function cloudAngularRateRadPerH(
  rKm: number,
  rmwKm: number,
  vmaxMs: number,
  hollandB: number,
): number {
  if (rKm <= 0) return CLOUD_ROTATION_CAP_RAD_PER_H;
  const r = Math.max(rKm, 1);
  const x = Math.min(80, (Math.max(rmwKm, 1) / r) ** hollandB);
  const vMs = vmaxMs * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
  return Math.min((3.6 * vMs) / r, CLOUD_ROTATION_CAP_RAD_PER_H);
}

/**
 * cloudAngularRateRadPerH with metric-clip inputs — the exact mirror of the
 * GLSL cloudOmega(), including the shared 666-km half-domain conversion.
 */
export function cloudAngularRateAtClipRadius(
  rUnits: number,
  rmwUnits: number,
  vmaxMs: number,
  hollandB: number,
): number {
  return cloudAngularRateRadPerH(
    rUnits * HALF_DOMAIN_HEIGHT_KM,
    rmwUnits * HALF_DOMAIN_HEIGHT_KM,
    vmaxMs,
    hollandB,
  );
}

/**
 * Two-phase flow-map state. Triangle weights sum to one and each phase has
 * exactly zero weight at its own sawtooth reset, so neither the field nor its
 * brightness pops at a phase boundary.
 */
export function flowPhaseState(cloudAgeH: number): {
  phaseA: number;
  phaseB: number;
  weightA: number;
  weightB: number;
} {
  const t = cloudAgeH / CLOUD_CROSSFADE_PERIOD_H;
  const phaseA = t - Math.floor(t);
  const tB = t + 0.5;
  const phaseB = tB - Math.floor(tB);
  const weightA = 1 - Math.abs(2 * phaseA - 1);
  return { phaseA, phaseB, weightA, weightB: 1 - weightA };
}
