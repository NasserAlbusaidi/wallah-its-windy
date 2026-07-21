import { describe, expect, it } from 'vitest';
import {
  aggregateEnsembleVerification,
  calibrateCone,
  ensembleCrps,
  verifyEnsembleLeads,
} from '../src/ensemble-verification';
import type { StormRun } from '../src/ensemble';
import type { StormTrack } from '../src/tracks';

function run(member: number, latOffset: number, windOffset: number): StormRun {
  return {
    member,
    track: [
      { lat: 18, lon: 60, vKt: 40, ageH: 0 },
      { lat: 19 + latOffset, lon: 61, vKt: 60 + windOffset, ageH: 24 },
      { lat: 20 + latOffset, lon: 62, vKt: 70 + windOffset, ageH: 48 },
    ],
    peakKt: 70 + windOffset,
    durationH: 48,
    closestApproachKm: 100,
    landfall: false,
    landfallEvents: [],
    death: null,
  };
}

const track: StormTrack = {
  id: 'truth',
  name: 'truth',
  year: 2020,
  points: [
    { iso: '2020-01-01T00:00:00Z', lat: 18, lon: 60, windKt: 40, presMb: 1000 },
    { iso: '2020-01-02T00:00:00Z', lat: 19.2, lon: 61, windKt: 62, presMb: 980 },
    { iso: '2020-01-03T00:00:00Z', lat: 20.2, lon: 62, windKt: 72, presMb: 970 },
  ],
};

describe('HF-4 probabilistic verification', () => {
  it('returns zero CRPS for a perfect degenerate ensemble', () => {
    expect(ensembleCrps([10, 10, 10], 10)).toBe(0);
  });

  it('computes spread, CRPS, Brier events, and ranks at exact leads', () => {
    const rows = verifyEnsembleLeads(
      [run(0, 0, 0), run(1, 0.4, 5), run(2, -0.4, -5)],
      track,
      '2020-01-01T00:00:00Z',
    );
    const row24 = rows.find((row) => row.leadH === 24)!;
    expect(row24.memberPositions).toBe(3);
    expect(row24.spreadKm).toBeGreaterThan(0);
    expect(row24.intensityCrpsKt).toBeGreaterThanOrEqual(0);
    expect(row24.intensityEvents).toHaveLength(3);
    expect(row24.intensityRank).not.toBeNull();
  });

  it('fits development-only additive radii and applies them deterministically', () => {
    const raw = verifyEnsembleLeads(
      [run(0, 0, 0), run(1, 0.1, 2), run(2, -0.1, -2)],
      track,
      '2020-01-01T00:00:00Z',
    );
    const calibration = calibrateCone([raw, raw]);
    const calibrated = verifyEnsembleLeads(
      [run(0, 0, 0), run(1, 0.1, 2), run(2, -0.1, -2)],
      track,
      '2020-01-01T00:00:00Z',
      calibration,
    );
    expect(calibration.trainingPartition).toBe('development');
    expect(calibrated[0].calibratedConeRadiusKm['0.9']).toBeGreaterThanOrEqual(
      calibrated[0].rawConeRadiusKm['0.9'],
    );
    const summary = aggregateEnsembleVerification([calibrated]);
    expect(summary.cases).toBe(1);
  });
});
