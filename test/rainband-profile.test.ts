import { describe, expect, it } from 'vitest';
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
  RAINBAND_SPIRAL_ROTATION_PER_H,
  rainbandSpiral,
} from '../src/rainband-profile';

describe('rainband profile', () => {
  it('documents the mean the impact ledger actually deposits', () => {
    expect(RAINBAND_AZIMUTHAL_MEAN).toBe(0.68);
  });

  it('keeps the numerically integrated mean equal to the documented constant', () => {
    // The comment in impact.ts drifted from the radar shader for exactly this
    // reason. Integrate rather than trust the constant.
    const samples = 20000;
    let total = 0;
    for (let i = 0; i < samples; i += 1) {
      const azimuth = (i / samples) * 2 * Math.PI - Math.PI;
      total += rainbandSpiral(azimuth, 3.0, 0);
    }
    expect(total / samples).toBeCloseTo(RAINBAND_AZIMUTHAL_MEAN, 3);
  });

  it('never goes negative anywhere on the azimuth', () => {
    for (let i = 0; i <= 720; i += 1) {
      const azimuth = (i / 720) * 2 * Math.PI - Math.PI;
      expect(rainbandSpiral(azimuth, 3.0, 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('pins the four envelope edges the impact ledger already uses', () => {
    expect(RAINBAND_INNER_Q).toBe(1.45);
    expect(RAINBAND_INNER_FULL_Q).toBe(2.0);
    expect(RAINBAND_OUTER_FADE_Q).toBe(6.0);
    expect(RAINBAND_OUTER_Q).toBe(8.0);
    expect(EYEWALL_WIDTH_Q).toBe(0.38);
  });

  it('keeps amplitude and mean consistent so the spiral peaks at 1', () => {
    expect(
      RAINBAND_AZIMUTHAL_MEAN + RAINBAND_SPIRAL_AMPLITUDE,
    ).toBeCloseTo(1, 12);
    expect(
      RAINBAND_AZIMUTHAL_MEAN - RAINBAND_SPIRAL_AMPLITUDE,
    ).toBeCloseTo(0.36, 12);
  });

  it('pins the shared arm geometry and radar rotation rate', () => {
    expect(RAINBAND_SPIRAL_ARMS).toBe(3);
    expect(RAINBAND_SPIRAL_PITCH).toBe(1.35);
    expect(RAINBAND_SPIRAL_ROTATION_PER_H).toBe(0.035);
  });
});
