import { describe, expect, it } from 'vitest';
import { sampleCoastalExposure } from '../src/coastal-exposure';

describe('HF-2C continuous coastal exposure', () => {
  const coast = (_lat: number, lon: number) => lon >= 60;

  it('is zero over open water and one-sided near a straight coast', () => {
    const ocean = sampleCoastalExposure(20, 55, 30, 180, coast);
    const coastal = sampleCoastalExposure(20, 59.9, 30, 180, coast);
    expect(ocean.coreLandFraction).toBe(0);
    expect(ocean.outerLandFraction).toBe(0);
    expect(coastal.coreLandFraction).toBeGreaterThan(0);
    expect(coastal.coreLandFraction).toBeLessThan(0.6);
    expect(coastal.outerLandFraction).toBeGreaterThan(0);
  });

  it('responds continuously before and after center crossing', () => {
    const seaSide = sampleCoastalExposure(20, 59.95, 30, 180, coast);
    const landSide = sampleCoastalExposure(20, 60.05, 30, 180, coast);
    expect(seaSide.centerOverLand).toBe(false);
    expect(landSide.centerOverLand).toBe(true);
    expect(landSide.roughnessExposure).toBeGreaterThan(seaSide.roughnessExposure);
    expect(landSide.roughnessExposure).toBeLessThan(1);
  });

  it('increases roughness exposure over elevated terrain', () => {
    const low = sampleCoastalExposure(20, 60.1, 30, 180, coast, () => 0);
    const mountain = sampleCoastalExposure(20, 60.1, 30, 180, coast, () => 1500);
    expect(mountain.meanLandElevationM).toBe(1500);
    expect(mountain.roughnessExposure).toBeGreaterThan(low.roughnessExposure);
  });
});
