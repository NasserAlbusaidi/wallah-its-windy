import { describe, expect, test } from 'vitest';
import {
  CLOUD_CROSSFADE_PERIOD_H,
  CLOUD_ROTATION_CAP_RAD_PER_H,
  cloudAngularRateAtClipRadius,
  cloudAngularRateRadPerH,
  flowPhaseState,
  interpolatedCloudAgeH,
} from '../src/render/cloud-motion';

describe('interpolatedCloudAgeH', () => {
  test('interpolates between fixed steps', () => {
    expect(interpolatedCloudAgeH(10, 10.25, 0.4)).toBeCloseTo(10.1, 12);
  });

  test('falls back to current age without a previous frame', () => {
    expect(interpolatedCloudAgeH(null, 5, 0.7)).toBe(5);
  });

  test('clamps alpha into [0,1]', () => {
    expect(interpolatedCloudAgeH(10, 10.25, 1.7)).toBeCloseTo(10.25, 12);
    expect(interpolatedCloudAgeH(10, 10.25, -0.3)).toBeCloseTo(10, 12);
  });

  test('never runs backwards across a storm respawn', () => {
    // prev frame belonged to the old storm (age 87 h), new storm is 0.25 h old
    expect(interpolatedCloudAgeH(87, 0.25, 0.5)).toBe(0.25);
  });
});

describe('cloudAngularRateRadPerH', () => {
  test('caps the eyewall rate for display', () => {
    // 40 m/s at the 30-km RMW: raw 3.6*40/30 = 4.8 rad/h, far above the cap
    expect(cloudAngularRateRadPerH(30, 30, 40, 1.35)).toBe(
      CLOUD_ROTATION_CAP_RAD_PER_H,
    );
  });

  test('returns the true Holland rate where it falls below the cap', () => {
    // r=200 km, rmw=30 km, vmax=40 m/s, B=1.35 — recompute in closed form
    const x = Math.min(80, (30 / 200) ** 1.35);
    const v = 40 * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
    const expected = (3.6 * v) / 200;
    expect(expected).toBeLessThan(CLOUD_ROTATION_CAP_RAD_PER_H);
    expect(cloudAngularRateRadPerH(200, 30, 40, 1.35)).toBeCloseTo(expected, 12);
  });

  test('guards the r=0 singularity', () => {
    const rate = cloudAngularRateRadPerH(0, 30, 40, 1.35);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBe(CLOUD_ROTATION_CAP_RAD_PER_H);
  });

  test('clip-radius form applies the shared 666-km conversion', () => {
    // rUnits 0.3 at the 666-km half-domain height = 199.8 km; rmw 30 km
    const viaKm = cloudAngularRateRadPerH(0.3 * 666, 0.045045045 * 666, 40, 1.35);
    const viaClip = cloudAngularRateAtClipRadius(0.3, 0.045045045, 40, 1.35);
    expect(viaClip).toBeCloseTo(viaKm, 12);
  });
});

describe('flowPhaseState', () => {
  test('weights sum to one and the resetting phase has zero weight', () => {
    // exactly at a phase-A reset (cloudAgeH = k * period)
    const atReset = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3);
    expect(atReset.phaseA).toBeCloseTo(0, 12);
    expect(atReset.weightA).toBeCloseTo(0, 12);
    expect(atReset.weightA + atReset.weightB).toBeCloseTo(1, 12);

    // half a period later phase B is at ITS reset with zero weight
    const atBReset = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3.5);
    expect(atBReset.phaseB).toBeCloseTo(0, 12);
    expect(atBReset.weightB).toBeCloseTo(0, 12);
    expect(atBReset.weightA).toBeCloseTo(1, 12);
  });

  test('weights are continuous across the boundary', () => {
    const eps = 1e-6;
    const before = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3 - eps);
    const after = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3 + eps);
    expect(Math.abs(before.weightA - after.weightA)).toBeLessThan(1e-4);
  });
});
