import { describe, expect, it } from 'vitest';
import { aggregateHindcasts } from '../src/hindcast-benchmark';
import type { HindcastCaseResult } from '../src/hindcast-benchmark';

function result(
  id: string,
  intensityMaeKt: number,
  peakBiasKt: number,
  pressureMaeHpa: number,
): HindcastCaseResult {
  return {
    id,
    label: id,
    partition: 'calibration',
    score: {
      startIso: '2020-01-01T00:00:00Z',
      endIso: '2020-01-02T00:00:00Z',
      trackSamples: 2,
      intensitySamples: 2,
      pressureSamples: 2,
      trackMaeKm: 50,
      trackRmseKm: 55,
      intensityMaeKt,
      intensityBiasKt: -2,
      pressureMaeHpa,
      peakBiasKt,
    },
  };
}

describe('hindcast benchmark aggregation', () => {
  it('weights complete storms equally rather than weighting by fix count', () => {
    const aggregate = aggregateHindcasts([
      result('short', 10, -5, 8),
      result('long', 30, 15, 12),
    ]);
    expect(aggregate.storms).toBe(2);
    expect(aggregate.intensityMaeKt).toBe(20);
    expect(aggregate.peakAbsBiasKt).toBe(10);
    expect(aggregate.pressureMaeHpa).toBe(10);
    expect(aggregate.objective).toBeCloseTo(
      ((10 / 20 + 5 / 25 + 8 / 20) / 3 +
        (30 / 20 + 15 / 25 + 12 / 20) / 3) /
        2,
    );
  });
});
