import { describe, expect, it } from 'vitest';
import { scoreHindcast } from '../src/hindcast';
import { deriveStormStructure } from '../src/structure';
import type { FlightFrame } from '../src/flight-recorder';
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
  vKt: number,
  pressureHpa: number,
): FlightFrame {
  const structure = deriveStormStructure({
    vKt,
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
    vKt,
    alive: true,
    organization: 0.7,
    coldWakeC: 0,
    diagnostics: { ...DIAGNOSTICS },
    structure,
  };
}

describe('scoreHindcast', () => {
  it('interpolates simulation frames onto observed fix times and scores each metric', () => {
    const startIso = '2000-01-01T00:00:00.000Z';
    const frames = [
      frame(0, 10, 60, 40, 1000),
      frame(6, 12, 62, 60, 980),
    ];
    const track: StormTrack = {
      id: 'test2000',
      name: 'test',
      year: 2000,
      points: [
        { iso: startIso, lat: 10, lon: 60, windKt: 40, presMb: 1000 },
        {
          iso: '2000-01-01T03:00:00.000Z',
          lat: 11,
          lon: 61,
          windKt: 50,
          presMb: 990,
        },
        {
          iso: '2000-01-01T06:00:00.000Z',
          lat: 12,
          lon: 62,
          windKt: 60,
          presMb: 980,
        },
      ],
    };

    expect(scoreHindcast(frames, track, startIso)).toMatchObject({
      trackSamples: 3,
      intensitySamples: 3,
      pressureSamples: 3,
      trackMaeKm: 0,
      trackRmseKm: 0,
      intensityMaeKt: 0,
      intensityBiasKt: 0,
      pressureMaeHpa: 0,
      peakBiasKt: 0,
    });
  });

  it('returns null for an empty tape or invalid start time', () => {
    const track: StormTrack = {
      id: 'empty',
      name: 'empty',
      year: 2000,
      points: [],
    };
    expect(scoreHindcast([], track, '2000-01-01T00:00:00Z')).toBeNull();
    expect(
      scoreHindcast([frame(0, 10, 60, 40, 1000)], track, 'not-a-date'),
    ).toBeNull();
  });
});
