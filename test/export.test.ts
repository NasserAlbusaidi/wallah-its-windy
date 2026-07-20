import { describe, expect, it } from 'vitest';
import { exportFileStem } from '../src/export';
import type { FlightRunSnapshot } from '../src/flight-recorder';
import { DeathReason } from '../src/types';

describe('exportFileStem', () => {
  it('produces a stable filesystem-safe name from the run identity', () => {
    const run = {
      meta: {
        spawn: { lat: 17, lon: 62, seed: 2007, monthIndex: 5, isDemo: false },
        environmentId: 'gonu',
        monthIndex: 5,
        seed: 2007,
        isDemo: false,
        label: 'Gonu 2007 counterfactual',
        counterfactual: true,
      },
      debrief: {
        label: 'Gonu 2007 counterfactual',
        monthIndex: 5,
        seed: 2007,
        death: {
          reason: DeathReason.Shear,
          closestApproachKm: 200,
          durationH: 80,
          peakKt: 90,
        },
        landfall: null,
      },
      frames: [],
      track: [],
    } satisfies FlightRunSnapshot;
    expect(exportFileStem(run)).toBe(
      'wallah-its-windy-gonu-2007-counterfactual-2007',
    );
  });
});
