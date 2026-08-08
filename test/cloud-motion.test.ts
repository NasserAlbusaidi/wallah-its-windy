import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  CLOUD_BAND_CELL_GATE_HI,
  CLOUD_BAND_CELL_GATE_LO,
  CLOUD_BAND_CELL_LEFT_RETENTION,
  CLOUD_BAND_CELL_PRESENCE_GAIN,
  CLOUD_BAND_CELL_RIGHT_BONUS,
  CLOUD_BAND_CELL_RIGHT_GAIN,
  CLOUD_BAND_CELL_SCALE,
  CLOUD_BAND_CELL_SHEAR_ORGANIZATION_HI_MS,
  CLOUD_BAND_CELL_SHEAR_ORGANIZATION_LO_MS,
  CLOUD_BAND_OUTER_CELL_GAIN,
  CLOUD_BAND_OUTER_STRATIFORM_FLOOR,
  CLOUD_BAND_REGIME_INNER_KM,
  CLOUD_BAND_REGIME_OUTER_KM,
  CLOUD_BAND_THERMAL_CONTRAST_DEVELOPING_C,
  CLOUD_BAND_THERMAL_CONTRAST_MATURE_C,
  CLOUD_CROSSFADE_PERIOD_H,
  CLOUD_ROTATION_CAP_RAD_PER_H,
  CLOUD_TOP_BAND_DEVELOPING_C,
  CLOUD_TOP_BAND_MATURE_C,
  CLOUD_TOP_CDO_DEVELOPING_C,
  CLOUD_TOP_CDO_MATURE_C,
  CLOUD_TOP_CIRRUS_COLD_C,
  CLOUD_TOP_CIRRUS_WARM_C,
  CLOUD_TOPS_GLSL,
  cloudAngularRateAtClipRadius,
  cloudAngularRateRadPerH,
  flowPhaseState,
  interpolatedCloudAgeH,
} from '../src/render/cloud-motion';

describe('cellular rainband presentation constants', () => {
  test('pins the resolved cell blend and 200-km regime transition', () => {
    expect(CLOUD_BAND_CELL_SCALE).toBe(12);
    expect(CLOUD_BAND_CELL_GATE_LO).toBe(0.54);
    expect(CLOUD_BAND_CELL_GATE_HI).toBe(0.66);
    expect(CLOUD_BAND_CELL_RIGHT_BONUS).toBe(0.03);
    expect(CLOUD_BAND_CELL_LEFT_RETENTION).toBe(0.35);
    expect(CLOUD_BAND_CELL_RIGHT_GAIN).toBe(1.35);
    expect(CLOUD_BAND_CELL_PRESENCE_GAIN).toBe(2.2);
    expect(CLOUD_BAND_CELL_SHEAR_ORGANIZATION_LO_MS).toBe(7);
    expect(CLOUD_BAND_CELL_SHEAR_ORGANIZATION_HI_MS).toBe(15);
    expect(CLOUD_BAND_REGIME_INNER_KM).toBe(170);
    expect(CLOUD_BAND_REGIME_OUTER_KM).toBe(230);
    expect(CLOUD_BAND_OUTER_STRATIFORM_FLOOR).toBe(0);
    expect(CLOUD_BAND_OUTER_CELL_GAIN).toBe(6);
    expect(CLOUD_BAND_THERMAL_CONTRAST_MATURE_C).toBeGreaterThan(
      CLOUD_BAND_THERMAL_CONTRAST_DEVELOPING_C,
    );
  });
});

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
    // r=300 km, rmw=30 km, vmax=40 m/s, B=1.35 — recompute in closed form
    // (the radius sits outside the capped core for the 0.3 rad/h display cap)
    const x = Math.min(80, (30 / 300) ** 1.35);
    const v = 40 * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
    const expected = (3.6 * v) / 300;
    expect(expected).toBeLessThan(CLOUD_ROTATION_CAP_RAD_PER_H);
    expect(cloudAngularRateRadPerH(300, 30, 40, 1.35)).toBeCloseTo(expected, 12);
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

describe('cloud-top component temperature constants', () => {
  test('pins the component grading endpoints', () => {
    expect(CLOUD_TOP_CDO_DEVELOPING_C).toBe(-65);
    expect(CLOUD_TOP_CDO_MATURE_C).toBe(-82);
    expect(CLOUD_TOP_BAND_DEVELOPING_C).toBe(-45);
    expect(CLOUD_TOP_BAND_MATURE_C).toBe(-62);
    expect(CLOUD_TOP_CIRRUS_WARM_C).toBe(-35);
    expect(CLOUD_TOP_CIRRUS_COLD_C).toBe(-48);
  });

  test('keeps the emitted CLOUD_TOPS_GLSL byte-identical (morphology R3 digest)', () => {
    // sha256 of CLOUD_TOPS_GLSL captured on 2026-08-08 after the RGR-004
    // cellular-band thermal-topology pass (3781 chars). Any change to the
    // emitted shader text fails here.
    const digest = createHash('sha256').update(CLOUD_TOPS_GLSL).digest('hex');
    expect(digest).toBe(
      '2df916dcda2044fa26d5b2d169eebfdd5614c75242242d7f80a0cd5b1095c927',
    );
    expect(CLOUD_TOPS_GLSL.length).toBe(3781);
  });
});
