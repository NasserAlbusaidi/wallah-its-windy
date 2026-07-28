import { describe, expect, it } from 'vitest';
import { DOMAIN, latLonToClip, offsetKm } from '../src/grid';
import {
  PRECIPITATING_CLOUD_BAND_FULL_MM_H,
  PRECIPITATING_CLOUD_EYE_FULL_MM_H,
  precipitatingCloudSupport,
  rainCenterClip,
} from '../src/render/precipitating-cloud';

describe('precipitating cloud support', () => {
  it('does not force cloud where the model reports no rain', () => {
    expect(precipitatingCloudSupport(0, 0)).toEqual({
      eyewall: 0,
      rainband: 0,
    });
  });

  it('gives a weak spawned storm visible support over its rainbands', () => {
    // A representative 30 kt spawn at ordinary humidity produces about
    // 1.2 mm/h of rainband rain. It must not sit beneath an empty-looking IR sky.
    expect(precipitatingCloudSupport(0, 1.2).rainband).toBeGreaterThan(0.85);
  });

  it('saturates each component at its documented full-support rate', () => {
    expect(
      precipitatingCloudSupport(
        PRECIPITATING_CLOUD_EYE_FULL_MM_H,
        PRECIPITATING_CLOUD_BAND_FULL_MM_H,
      ),
    ).toEqual({ eyewall: 1, rainband: 1 });
  });
});

describe('rain centre alignment', () => {
  it('preserves the storm centre when shear does not displace rain', () => {
    const center = latLonToClip(20, 60, DOMAIN);
    expect(
      rainCenterClip(center, {
        rainOffsetEastKm: 0,
        rainOffsetNorthKm: 0,
      }),
    ).toEqual(center);
  });

  it('applies the exact shared ground-distance displacement', () => {
    const center = latLonToClip(20, 60, DOMAIN);
    const shifted = rainCenterClip(center, {
      rainOffsetEastKm: 30,
      rainOffsetNorthKm: 40,
    });
    const expected = offsetKm(20, 60, 0.6, 0.8, 50);
    const expectedClip = latLonToClip(expected.lat, expected.lon, DOMAIN);

    expect(shifted.x).toBeCloseTo(expectedClip.x, 12);
    expect(shifted.y).toBeCloseTo(expectedClip.y, 12);
  });
});
