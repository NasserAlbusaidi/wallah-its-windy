import { describe, expect, it } from 'vitest';
import {
  aggregateLeadTimes,
  bootstrapMeanInterval,
  verifyLeadTimes,
} from '../src/fidelity-verification';
import type { FlightFrame } from '../src/flight-recorder';
import { deriveStormStructure } from '../src/structure';
import type { StormTrack } from '../src/tracks';
import type { StormDiagnostics } from '../src/types';

const DIAGNOSTICS: StormDiagnostics = {
  sstC: 29,
  effectiveSstC: 29,
  midlevelRhPct: 75,
  ohcKjCm2: 60,
  organization: 0.7,
  organizationTarget: 0.8,
  coldWakeC: 0,
  mpiKt: 120,
  steerU: 0,
  steerV: 0,
  shearMs: 5,
  shearUms: 3,
  shearVms: 4,
  overLand: false,
  oceanKtPerH: 1,
  shearKtPerH: 0,
  landKtPerH: 0,
  dryAirKtPerH: 0,
  netKtPerH: 1,
  eyewallRainMmH: 8,
  rainbandRainMmH: 4,
  orographicRainMmH: 2,
  totalRainMmH: 14,
};

function frame(
  ageH: number,
  lat: number,
  lon: number,
  windKt: number,
  pressureHpa: number,
): FlightFrame {
  const structure = deriveStormStructure({
    vKt: windKt,
    lat,
    shearMs: 5,
    overLand: false,
    motionUms: 0,
    motionVms: 0,
  });
  structure.centralPressureHpa = pressureHpa;
  return {
    ageH,
    lat,
    lon,
    vKt: windKt,
    alive: true,
    organization: 0.7,
    coldWakeC: 0,
    diagnostics: { ...DIAGNOSTICS },
    structure,
  };
}

describe('fidelity lead-time verification', () => {
  it('scores exact lead times and a no-future-information persistence baseline', () => {
    const track: StormTrack = {
      id: 'curve',
      name: 'curve',
      year: 2000,
      points: [
        {
          iso: '1999-12-31T18:00:00Z',
          lat: 17.5,
          lon: 60,
          windKt: 38,
          presMb: 1002,
        },
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-01T12:00:00Z',
          lat: 19,
          lon: 61,
          windKt: 55,
          presMb: 985,
        },
      ],
    };
    const rows = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19, 61, 55, 985)],
      track,
      '2000-01-01T00:00:00Z',
      [12],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].model.trackKm).toBeCloseTo(0);
    expect(rows[0].model.intensityAbsKt).toBeCloseTo(0);
    expect(rows[0].model.pressureAbsHpa).toBeCloseTo(0);
    expect(rows[0].persistence.trackKm).toBeGreaterThan(100);
    expect(rows[0].persistence.intensityAbsKt).toBe(15);
    expect(rows[0].persistence.pressureAbsHpa).toBe(15);
  });

  it('uses signed along/cross errors relative to observed motion', () => {
    const track: StormTrack = {
      id: 'north',
      name: 'north',
      year: 2000,
      points: [
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-01T12:00:00Z',
          lat: 19,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
      ],
    };
    const [row] = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19.2, 60.2, 40, 1000)],
      track,
      '2000-01-01T00:00:00Z',
      [12],
    );
    expect(row.model.alongTrackKm).toBeGreaterThan(20);
    expect(row.model.crossTrackKm).toBeLessThan(-20);
    expect(row.persistence.trackKm).toBeCloseTo(111.195, 1);
  });

  it('uses the local tangent at an exact verifying fix', () => {
    const track: StormTrack = {
      id: 'turn',
      name: 'turn',
      year: 2000,
      points: [
        { iso: '2000-01-01T00:00:00Z', lat: 18, lon: 60, windKt: 40, presMb: 1000 },
        { iso: '2000-01-01T12:00:00Z', lat: 19, lon: 60, windKt: 45, presMb: 995 },
        { iso: '2000-01-02T00:00:00Z', lat: 19, lon: 61, windKt: 50, presMb: 990 },
      ],
    };
    const [row] = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19.2, 60.2, 45, 995)],
      track,
      '2000-01-01T00:00:00Z',
      [12],
    );
    // The centered local tangent points northeast. Equal north/east error is
    // therefore mostly along-track rather than a large cross-track miss.
    expect(row.model.alongTrackKm).toBeGreaterThan(25);
    expect(Math.abs(row.model.crossTrackKm)).toBeLessThan(3);
  });

  it('uses a one-sided local tangent at the final observed fix', () => {
    const track: StormTrack = {
      id: 'terminal-turn',
      name: 'terminal-turn',
      year: 2000,
      points: [
        { iso: '2000-01-01T00:00:00Z', lat: 18, lon: 60, windKt: 40, presMb: 1000 },
        { iso: '2000-01-01T12:00:00Z', lat: 19, lon: 60, windKt: 45, presMb: 995 },
        { iso: '2000-01-02T00:00:00Z', lat: 19, lon: 61, windKt: 50, presMb: 990 },
      ],
    };
    const [row] = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(24, 19.2, 61.2, 50, 990)],
      track,
      '2000-01-01T00:00:00Z',
      [24],
    );
    expect(row.model.alongTrackKm).toBeGreaterThan(20);
    expect(row.model.crossTrackKm).toBeGreaterThan(20);
  });

  it('retains an exact observed value when the neighboring fix is missing it', () => {
    const track: StormTrack = {
      id: 'missing-neighbor',
      name: 'missing-neighbor',
      year: 2000,
      points: [
        { iso: '2000-01-01T00:00:00Z', lat: 18, lon: 60, windKt: 40, presMb: 1000 },
        { iso: '2000-01-01T12:00:00Z', lat: 19, lon: 61, windKt: 50, presMb: 990 },
        { iso: '2000-01-02T00:00:00Z', lat: 20, lon: 62, windKt: null, presMb: null },
      ],
    };
    const [row] = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19, 61, 50, 990)],
      track,
      '2000-01-01T00:00:00Z',
      [12],
    );
    expect(row.model.intensityAbsKt).toBe(0);
    expect(row.model.pressureAbsHpa).toBe(0);
  });

  it('omits leads beyond the freely simulated tape', () => {
    const track: StormTrack = {
      id: 'short',
      name: 'short',
      year: 2000,
      points: [
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-04T00:00:00Z',
          lat: 21,
          lon: 63,
          windKt: 50,
          presMb: 990,
        },
      ],
    };
    const rows = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(24, 19, 61, 45, 995)],
      track,
      '2000-01-01T00:00:00Z',
    );
    expect(rows.map((row) => row.leadH)).toEqual([12, 24]);
  });

  it('omits a lead after the observed storm leaves the product domain', () => {
    const track: StormTrack = {
      id: 'domain-exit',
      name: 'domain-exit',
      year: 2000,
      points: [
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 68,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-01T12:00:00Z',
          lat: 18,
          lon: 71,
          windKt: 45,
          presMb: 995,
        },
      ],
    };
    expect(
      verifyLeadTimes(
        [frame(0, 18, 68, 40, 1000), frame(12, 18, 69, 45, 995)],
        track,
        '2000-01-01T00:00:00Z',
        [12],
      ),
    ).toEqual([]);
  });

  it('does not resume scoring if the observed track re-enters the domain', () => {
    const track: StormTrack = {
      id: 'domain-reentry',
      name: 'domain-reentry',
      year: 2000,
      points: [
        { iso: '2000-01-01T00:00:00Z', lat: 18, lon: 68, windKt: 40, presMb: 1000 },
        { iso: '2000-01-01T06:00:00Z', lat: 18, lon: 71, windKt: 42, presMb: 998 },
        { iso: '2000-01-01T12:00:00Z', lat: 18, lon: 69, windKt: 45, presMb: 995 },
      ],
    };
    expect(
      verifyLeadTimes(
        [frame(0, 18, 68, 40, 1000), frame(12, 18, 69, 45, 995)],
        track,
        '2000-01-01T00:00:00Z',
        [12],
      ),
    ).toEqual([]);
  });

  it('aggregates paired skill and deterministic bootstrap intervals', () => {
    const track: StormTrack = {
      id: 'aggregate',
      name: 'aggregate',
      year: 2000,
      points: [
        {
          iso: '1999-12-31T18:00:00Z',
          lat: 17.5,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 60,
          windKt: 40,
          presMb: 1000,
        },
        {
          iso: '2000-01-01T12:00:00Z',
          lat: 19,
          lon: 61,
          windKt: 50,
          presMb: 990,
        },
      ],
    };
    const rows = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19, 61, 50, 990)],
      track,
      '2000-01-01T00:00:00Z',
      [12],
    );
    const aggregate = aggregateLeadTimes([rows, rows]);
    expect(aggregate[0].leadH).toBe(12);
    expect(aggregate[0].trackFrequencySuperior).toBe(1);
    expect(aggregate[0].trackMaeSkillFraction).toBe(1);
    expect(aggregate[0].model.trackMaeCi95).toEqual({ low: 0, high: 0 });
    expect(aggregate[0].model.intensitySamples).toBe(2);
    expect(aggregate[0].model.pressureSamples).toBe(2);
    expect(aggregate[0].pressureMaeSkillFraction).toBe(1);
    expect(aggregate[0].model.pressureMaeCi95).toEqual({ low: 0, high: 0 });

    const missingInitialPressure: StormTrack = {
      id: 'missing-initial-pressure',
      name: 'missing-initial-pressure',
      year: 2000,
      points: [
        {
          iso: '2000-01-01T00:00:00Z',
          lat: 18,
          lon: 60,
          windKt: 40,
          presMb: null,
        },
        {
          iso: '2000-01-01T12:00:00Z',
          lat: 19,
          lon: 61,
          windKt: 50,
          presMb: 990,
        },
      ],
    };
    const missingRows = verifyLeadTimes(
      [frame(0, 18, 60, 40, 1000), frame(12, 19, 61, 50, 890)],
      missingInitialPressure,
      '2000-01-01T00:00:00Z',
      [12],
    );
    const pairedPressure = aggregateLeadTimes([rows, missingRows])[0];
    expect(pairedPressure.model.pressureSamples).toBe(2);
    expect(pairedPressure.persistence.pressureSamples).toBe(1);
    expect(pairedPressure.model.pressureMaeHpa).toBe(50);
    // Skill uses only the one pressure case that both forecasts can score; the
    // unpaired 100 hPa model error remains visible in the model's all-case MAE.
    expect(pairedPressure.pressureMaeSkillFraction).toBe(1);

    expect(bootstrapMeanInterval([1, 2, 3, 4], 42)).toEqual(
      bootstrapMeanInterval([1, 2, 3, 4], 42),
    );
  });
});
