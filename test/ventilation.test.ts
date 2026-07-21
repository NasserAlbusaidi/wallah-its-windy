import { describe, expect, it } from 'vitest';
import type { EnvSample, EnvSampler } from '../src/types';
import { sampleVentilationEnvironment } from '../src/ventilation';

function sampler(sampleAt: (lat: number, lon: number) => Partial<EnvSample>): EnvSampler {
  return {
    sample(lat, lon) {
      return {
        sstC: 29,
        steerU: 0,
        steerV: 0,
        shear: 10,
        shearU: 10,
        shearV: 0,
        midlevelRhPct: 60,
        ohcKjCm2: 60,
        ...sampleAt(lat, lon),
      };
    },
  };
}

describe('HF-2B annular ventilation', () => {
  it('retains a coherent vector and follows shear-deficit-over-PI scaling', () => {
    const result = sampleVentilationEnvironment(
      sampler(() => ({})),
      20,
      60,
      5,
      0.5,
      200,
      100,
    );
    expect(result.sampleCount).toBe(8);
    expect(result.annulusRadiusKm).toBe(250);
    expect(result.shearUms).toBeCloseTo(10, 10);
    expect(result.shearVms).toBeCloseTo(0, 10);
    expect(result.shearVectorCoherence).toBeCloseTo(1, 10);
    expect(result.entropyDeficitProxy).toBeCloseTo(10 / 45, 10);
    expect(result.ventilationIndex).toBeCloseTo((10 * (10 / 45)) / (100 / 1.943844), 10);
  });

  it('does not let opposing shear vectors cancel to a false zero', () => {
    const result = sampleVentilationEnvironment(
      sampler((_lat, lon) => ({ shearU: lon >= 60 ? 12 : -12, shearV: 0 })),
      20,
      60,
      5,
      0.5,
      200,
      100,
    );
    expect(result.shearVectorCoherence).toBeLessThan(0.3);
    expect(result.shearMs).toBeGreaterThan(2.5);
  });

  it('raises ventilation for drier annular air at fixed vector shear', () => {
    const moist = sampleVentilationEnvironment(
      sampler(() => ({ midlevelRhPct: 70 })), 20, 60, 5, 0.5, 200, 100,
    );
    const dry = sampleVentilationEnvironment(
      sampler(() => ({ midlevelRhPct: 35 })), 20, 60, 5, 0.5, 200, 100,
    );
    expect(moist.ventilationIndex).toBe(0);
    expect(dry.ventilationIndex).toBeGreaterThan(0.1);
  });
});
