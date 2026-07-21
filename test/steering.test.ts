import { describe, expect, it } from 'vitest';
import {
  pressureWindSamplerFromBin,
  observedInitialMotionMs,
  sampleEnvironmentalSteering,
  sampleTerrainDrift,
  steeringWeights,
} from '../src/steering';
import type { EnvSampler, ParsedBin } from '../src/types';

const environment: EnvSampler = {
  sample: () => ({
    sstC: 29,
    steerU: -3,
    steerV: 2,
    shear: 8,
    shearU: 6,
    shearV: 5,
    midlevelRhPct: 70,
    ohcKjCm2: 60,
  }),
};

describe('HF-3 environmental steering', () => {
  it('deepens bounded weights as a storm strengthens and organizes', () => {
    const weak = steeringWeights(35, 0.2, 16);
    const major = steeringWeights(120, 0.9, 24);
    expect(weak.w850).toBeGreaterThan(major.w850);
    expect(major.w250).toBeGreaterThan(weak.w250);
    expect(weak.w850 + weak.w500 + weak.w250).toBeCloseTo(1, 12);
    expect(major.w850 + major.w500 + major.w250).toBeCloseTo(1, 12);
  });

  it('reports exact pressure-level contributions from a coherent ring', () => {
    const result = sampleEnvironmentalSteering(
      environment,
      () => ({ u850: 2, v850: 1, u500: 4, v500: 2, u250: 8, v250: 3 }),
      20,
      62,
      5,
      0.4,
      90,
      0.8,
      220,
    );
    expect(result.pressureLevelsAvailable).toBe(true);
    expect(result.u).toBeCloseTo(
      result.u850Contribution + result.u500Contribution + result.u250Contribution,
      12,
    );
    expect(result.annulusRadiusKm).toBeGreaterThanOrEqual(275);
    expect(result.annulusRadiusKm).toBeLessThanOrEqual(375);
  });

  it('falls back honestly to the existing deep-layer field', () => {
    const result = sampleEnvironmentalSteering(
      environment,
      undefined,
      20,
      62,
      5,
      0.4,
      60,
      0.5,
      180,
    );
    expect(result.pressureLevelsAvailable).toBe(false);
    expect(result.u).toBeCloseTo(-3);
    expect(result.v).toBeCloseTo(2);
  });

  it('interpolates all six sidecar layers on one time axis', () => {
    const layer = (name: string, a: number, b: number) => ({
      name,
      dtype: 2 as const,
      quantized: false,
      nx: 1,
      ny: 1,
      nt: 2,
      bbox: { lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 },
      scale: 1,
      offset: 0,
      data: new Float32Array([a, b]),
    });
    const bin: ParsedBin = {
      version: 1,
      layers: new Map([
        ['u850', layer('u850', 0, 10)],
        ['v850', layer('v850', 1, 11)],
        ['u500', layer('u500', 2, 12)],
        ['v500', layer('v500', 3, 13)],
        ['u250', layer('u250', 4, 14)],
        ['v250', layer('v250', 5, 15)],
      ]),
    };
    const sample = pressureWindSamplerFromBin(
      () => bin,
      () => ({ kind: 'event-timeline' }),
    )(20, 60, 5, 0.5);
    expect(sample).toEqual({ u850: 5, v850: 6, u500: 7, v500: 8, u250: 9, v250: 10 });
  });

  it('bounds terrain drift and returns zero in a symmetric environment', () => {
    const symmetric = sampleTerrainDrift(20, 60, 180, () => false, undefined, 0.6);
    expect(symmetric).toEqual({ u: 0, v: 0, roughnessContrast: 0 });
    const coast = sampleTerrainDrift(
      20,
      60,
      180,
      (_lat, lon) => lon > 60,
      () => 1200,
      0.6,
    );
    expect(Math.hypot(coast.u, coast.v)).toBeLessThanOrEqual(0.6);
    expect(coast.roughnessContrast).toBeGreaterThan(0);
  });

  it('derives initialization motion from past fixes only', () => {
    const motion = observedInitialMotionMs(
      [
        { iso: '2020-01-01T00:00:00Z', lat: 18, lon: 60 },
        { iso: '2020-01-01T06:00:00Z', lat: 18.5, lon: 60.5 },
        { iso: '2020-01-01T12:00:00Z', lat: 40, lon: 90 },
      ],
      '2020-01-01T06:00:00Z',
    );
    expect(motion).not.toBeNull();
    expect(motion!.u).toBeGreaterThan(0);
    expect(motion!.v).toBeGreaterThan(0);
    expect(motion!.lookbackHours).toBe(6);
  });
});
