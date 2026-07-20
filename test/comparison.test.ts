import { describe, expect, it } from 'vitest';
import { compareRuns } from '../src/comparison';
import type { FlightRunSnapshot } from '../src/flight-recorder';
import { DeathReason } from '../src/types';

function run(label: string, peakKt: number, monthIndex = 4): FlightRunSnapshot {
  return {
    meta: {
      spawn: { lat: 17, lon: 62, seed: 7, monthIndex, isDemo: false },
      environmentId: 'climatology',
      monthIndex,
      seed: 7,
      isDemo: false,
      label,
      counterfactual: false,
    },
    debrief: {
      label,
      monthIndex,
      seed: 7,
      death: {
        reason: DeathReason.Shear,
        closestApproachKm: 200 + peakKt,
        durationH: 100 + peakKt,
        peakKt,
      },
      landfall: null,
    },
    frames: [],
    track: [],
  };
}

describe('compareRuns', () => {
  it('reports candidate-minus-baseline deltas for the same storm identity', () => {
    const result = compareRuns(run('may', 60), run('october', 90, 9));
    expect(result).toMatchObject({
      peakDeltaKt: 30,
      lifeDeltaH: 30,
      muscatDeltaKm: 30,
      landfallChanged: false,
    });
  });

  it('rejects a pair whose genesis or seed changed', () => {
    const candidate = run('other', 90);
    candidate.meta.spawn.seed = 8;
    expect(compareRuns(run('baseline', 60), candidate)).toBeNull();
  });
});

