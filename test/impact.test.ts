import { describe, expect, it } from 'vitest';
import {
  experiencedWindPhrase,
  floodRiskTier,
  IMPACT_CITIES,
  ImpactTracker,
  windAtPointKt,
} from '../src/impact';
import type { StormDiagnostics, StormState } from '../src/types';
import { deriveStormStructure } from '../src/structure';

const DIAGNOSTICS: StormDiagnostics = {
  sstC: 29,
  effectiveSstC: 29,
  midlevelRhPct: 70,
  ohcKjCm2: 60,
  organization: 0.7,
  organizationTarget: 0.8,
  coldWakeC: 0,
  mpiKt: 120,
  steerU: -2,
  steerV: 3,
  shearMs: 8,
  shearUms: 6,
  shearVms: 5,
  overLand: false,
  oceanKtPerH: 1,
  shearKtPerH: 0,
  landKtPerH: 0,
  dryAirKtPerH: 0,
  netKtPerH: 1,
  eyewallRainMmH: 12,
  rainbandRainMmH: 5,
  orographicRainMmH: 2,
  totalRainMmH: 19,
};

function storm(lat: number, lon: number, vKt: number, alive = true): StormState {
  return {
    lat,
    lon,
    vKt,
    ageH: 12,
    trackPoints: [],
    alive,
    isDemo: false,
    organization: 0.7,
    coldWakeC: 0,
    diagnostics: { ...DIAGNOSTICS },
    structure: deriveStormStructure({
      vKt,
      lat,
      lon,
      shearMs: 8,
      overLand: false,
      motionUms: -2,
      motionVms: 3,
    }),
  };
}

describe('flood risk proxy tiers', () => {
  // Table-driven boundaries: wadi flash floods start well below humid-climate
  // totals, and the tier drives user-facing risk copy.
  const CASES: Array<[number, string]> = [
    [0, 'minimal'],
    [29.9, 'minimal'],
    [30, 'moderate'],
    [79.9, 'moderate'],
    [80, 'high'],
    [149.9, 'high'],
    [150, 'extreme'],
    [500, 'extreme'],
  ];
  it.each(CASES)('%s mm tiers as %s', (mm, tier) => {
    expect(floodRiskTier(mm)).toBe(tier);
  });
});

describe('ImpactTracker', () => {
  it('uses one instantaneous wind answer for city footprints and probes', () => {
    const active = storm(23.2, 58.9, 90);
    const muscat = IMPACT_CITIES.find((city) => city.id === 'muscat')!;
    const tracker = new ImpactTracker();
    tracker.record(active, 0.25);
    const reported = tracker.summary(active).cities.find(
      (entry) => entry.city.id === 'muscat',
    )!;
    expect(reported.peakWindKt).toBeCloseTo(windAtPointKt(active, muscat), 4);
  });

  it('accumulates rain near the storm and reports it at the closest city', () => {
    const tracker = new ImpactTracker();
    const nearMuscat = storm(23.2, 58.9, 90);
    for (let i = 0; i < 24; i++) tracker.record(nearMuscat, 0.25);
    const summary = tracker.summary(nearMuscat);
    const muscat = summary.cities.find((c) => c.city.id === 'muscat')!;
    expect(muscat.rainMm).toBeGreaterThan(0);
    expect(muscat.peakWindKt).toBeGreaterThan(20);
    expect(muscat.closestKm).toBeLessThan(120);
    // A far city sees nothing from a storm near Muscat.
    const karachi = summary.cities.find((c) => c.city.id === 'karachi')!;
    expect(karachi.rainMm).toBe(0);
  });

  it('is deterministic: identical tick sequences give identical summaries', () => {
    const run = () => {
      const tracker = new ImpactTracker();
      for (let i = 0; i < 12; i++) {
        tracker.record(storm(21 + i * 0.1, 60 - i * 0.1, 60 + i), 0.25);
      }
      return tracker.summary(null);
    };
    expect(run()).toEqual(run());
  });

  it('rebuilds fixed accumulation windows from the deterministic 24 h tick ring', () => {
    const tracker = new ImpactTracker();
    const stationary = storm(22, 60, 80);
    for (let i = 0; i < 32; i++) tracker.record(stationary, 0.25);
    const peak = () => Math.max(...tracker.rainView().mm);

    const stormTotal = peak();
    tracker.setRainWindow('6h');
    const sixHour = peak();
    tracker.setRainWindow('3h');
    const threeHour = peak();
    tracker.setRainWindow('1h');
    const oneHour = peak();

    expect(stormTotal).toBeGreaterThan(sixHour);
    expect(sixHour).toBeGreaterThan(threeHour);
    expect(threeHour).toBeGreaterThan(oneHour);
    expect(tracker.rainView().breaksMm).toEqual([0, 10, 25, 50, 80]);

    tracker.setRainWindow('storm');
    expect(peak()).toBeCloseTo(stormTotal, 5);
  });

  it('ages deposits out of an actively selected trailing window', () => {
    const tracker = new ImpactTracker();
    const stationary = storm(22, 60, 80);
    tracker.setRainWindow('1h');
    for (let i = 0; i < 4; i++) tracker.record(stationary, 0.25);
    const firstHour = Math.max(...tracker.rainView().mm);
    for (let i = 0; i < 8; i++) tracker.record(stationary, 0.25);
    const latestHour = Math.max(...tracker.rainView().mm);

    expect(latestHour).toBeCloseTo(firstHour, 5);
    const rainLat =
      stationary.lat + stationary.structure.rainOffsetNorthKm / 111;
    const rainLon =
      stationary.lon +
      (
        stationary.structure.rainOffsetEastKm +
        stationary.structure.rmwKm
      ) /
        (111 * Math.cos((stationary.lat * Math.PI) / 180));
    expect(tracker.displayRainAtMm(rainLat, rainLon)).toBeLessThan(
      tracker.rainAtMm(rainLat, rainLon),
    );
    tracker.setRainWindow('storm');
    expect(Math.max(...tracker.rainView().mm)).toBeCloseTo(firstHour * 3, 4);
  });

  it('reset() clears the grid, the version moving so the GPU re-uploads', () => {
    const tracker = new ImpactTracker();
    tracker.record(storm(22, 60, 80), 1);
    const before = tracker.rainView().version;
    expect(tracker.rainView().mm.some((v) => v > 0)).toBe(true);
    tracker.reset();
    expect(tracker.rainView().version).toBeGreaterThan(before);
    expect(tracker.rainView().mm.every((v) => v === 0)).toBe(true);
    const summary = tracker.summary(null);
    expect(summary.maxLandRainMm).toBe(0);
    expect(summary.cities.every((c) => c.peakWindKt === 0)).toBe(true);
  });

  it('a dead storm deposits nothing', () => {
    const tracker = new ImpactTracker();
    tracker.record(storm(22, 60, 80, false), 1);
    expect(tracker.rainView().mm.every((v) => v === 0)).toBe(true);
  });

  it('offers a live city only when one is in reach', () => {
    const tracker = new ImpactTracker();
    const offshore = storm(16, 66, 70); // far southeast open sea
    tracker.record(offshore, 0.25);
    expect(tracker.summary(offshore).live).toBeNull();
    // (23.0N, 59.0E) sits ~72 km from Sur and ~91 km from Muscat — the live
    // slot goes to the closest in-reach city.
    const closing = storm(23.0, 59.0, 70);
    tracker.record(closing, 0.25);
    expect(tracker.summary(closing).live?.city.id).toBe('sur');
  });

  it('covers the coastal cities the domain can threaten', () => {
    const ids = IMPACT_CITIES.map((c) => c.id);
    expect(ids).toContain('muscat');
    expect(ids).toContain('salalah');
    expect(ids).toContain('karachi');
  });
});

describe('experienced wind phrasing', () => {
  it('maps peak winds onto honest marine-scale phrases', () => {
    expect(experiencedWindPhrase(10)).toBe('light winds');
    expect(experiencedWindPhrase(25)).toBe('gusty winds');
    expect(experiencedWindPhrase(40)).toBe('gale-force winds');
    expect(experiencedWindPhrase(55)).toBe('storm-force winds');
    expect(experiencedWindPhrase(100)).toBe('cat 3 winds');
  });
});
