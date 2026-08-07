import { describe, expect, it } from 'vitest';
import { ImpactTracker } from '../src/impact';
import type { RegionNamesTable } from '../src/impact';
import { DOMAIN } from '../src/grid';
import type {
  BinLayer,
  ParsedBin,
  StormDiagnostics,
  StormState,
} from '../src/types';
import { DType } from '../src/types';
import { deriveStormStructure } from '../src/structure';

const NX = 200;
const NY = 120;

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

function storm(lat: number, lon: number, vKt: number): StormState {
  return {
    lat,
    lon,
    vKt,
    ageH: 12,
    trackPoints: [],
    alive: true,
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

function idLayer(
  name: string,
  fill: (col: number, row: number) => number,
): BinLayer {
  const data = new Float32Array(NX * NY);
  for (let row = 0; row < NY; row++) {
    for (let col = 0; col < NX; col++) {
      data[row * NX + col] = fill(col, row);
    }
  }
  return {
    name,
    dtype: DType.uint16,
    quantized: false,
    nx: NX,
    ny: NY,
    nt: 1,
    bbox: DOMAIN,
    scale: 1,
    offset: 0,
    data,
  };
}

/**
 * Two governorates split at lon 56 (col 60) — the west half stays beyond the
 * deposit envelope's 500 km cap from the 61E test storm; one NE wadi basin.
 */
function regionsBin(): ParsedBin {
  const admin1 = idLayer('admin1', (col) => (col < 60 ? 1 : 2));
  const wadi = idLayer('wadi', (col, row) =>
    col >= 120 && row < 40 ? 7 : 0,
  );
  return {
    version: 1,
    layers: new Map([
      ['admin1', admin1],
      ['wadi', wadi],
    ]),
  };
}

const NAMES: RegionNamesTable = {
  admin1: { '1': 'west test', '2': 'east test' },
  wadi: { '7': 'wadi test' },
};

function trackedRun(names: RegionNamesTable | null = NAMES): ImpactTracker {
  const tracker = new ImpactTracker();
  tracker.setRegions(regionsBin(), names);
  // A storm at 22N 61E rains into the "east test" governorate half and
  // (its outer bands) into the NE wadi box.
  const active = storm(22, 61, 90);
  for (let i = 0; i < 24; i++) tracker.record(active, 0.25);
  return tracker;
}

describe('regional rain aggregation', () => {
  it('is null before region data arrives and after setRegions(null)', () => {
    const tracker = new ImpactTracker();
    tracker.record(storm(22, 61, 90), 0.25);
    expect(tracker.summary(null).regions).toBeNull();
    tracker.setRegions(regionsBin(), NAMES);
    expect(tracker.summary(null).regions).not.toBeNull();
    tracker.setRegions(null, null);
    expect(tracker.summary(null).regions).toBeNull();
  });

  it('aggregates max and mean per region from the storm-total grid', () => {
    const tracker = trackedRun();
    const regions = tracker.summary(null).regions!;
    const east = regions.rows.find((row) => row.name === 'east test')!;
    expect(east.kind).toBe('governorate');
    expect(east.stormMaxMm).toBeGreaterThan(0);
    expect(east.stormMeanMm).toBeGreaterThan(0);
    expect(east.stormMeanMm).toBeLessThan(east.stormMaxMm);

    // Hand-check the max: scan the totalMm grid over the east region.
    const mm = tracker.rainView().mm;
    let expected = 0;
    for (let row = 0; row < NY; row++) {
      for (let col = 60; col < NX; col++) {
        expected = Math.max(expected, mm[row * NX + col]);
      }
    }
    expect(east.stormMaxMm).toBeCloseTo(expected, 9);
  });

  it('ranks by the window column, storm-total tie-break, capped at 6', () => {
    const tracker = trackedRun();
    const regions = tracker.summary(null).regions!;
    expect(regions.rows.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < regions.rows.length; i++) {
      const prev = regions.rows[i - 1];
      const cur = regions.rows[i];
      expect(
        prev.windowMaxMm > cur.windowMaxMm ||
          (prev.windowMaxMm === cur.windowMaxMm &&
            prev.stormMaxMm >= cur.stormMaxMm),
      ).toBe(true);
    }
    // Sub-1mm regions never appear: the dry western governorate is absent.
    expect(regions.rows.some((row) => row.name === 'west test')).toBe(false);
  });

  it('window column follows the selected window; storm column does not', () => {
    const tracker = trackedRun();
    const stormRows = tracker.summary(null).regions!;
    expect(stormRows.window).toBe('storm');
    const east0 = stormRows.rows.find((r) => r.name === 'east test')!;
    expect(east0.windowMaxMm).toBeCloseTo(east0.stormMaxMm, 9);

    tracker.setRainWindow('1h');
    const hourRows = tracker.summary(null).regions!;
    expect(hourRows.window).toBe('1h');
    const east1 = hourRows.rows.find((r) => r.name === 'east test')!;
    expect(east1.stormMaxMm).toBeCloseTo(east0.stormMaxMm, 9);
    expect(east1.windowMaxMm).toBeLessThan(east1.stormMaxMm);
  });

  it('falls back to "unnamed basin <id>" when the wadi has no name entry', () => {
    const tracker = trackedRun({ admin1: NAMES.admin1, wadi: {} });
    const regions = tracker.summary(null).regions!;
    const wadi = regions.rows.find((row) => row.kind === 'wadi');
    if (wadi) expect(wadi.name).toBe('unnamed basin 7');
  });

  it('caches: repeated summaries without a tick reuse the same rows array', () => {
    const tracker = trackedRun();
    const a = tracker.summary(null).regions!;
    const b = tracker.summary(null).regions!;
    expect(b.rows).toBe(a.rows);
    tracker.record(storm(22, 61, 90), 0.25);
    expect(tracker.summary(null).regions!.rows).not.toBe(a.rows);
  });

  it('is deterministic with regions active', () => {
    const run = () => {
      const tracker = new ImpactTracker();
      tracker.setRegions(regionsBin(), NAMES);
      for (let i = 0; i < 12; i++) {
        tracker.record(storm(21 + i * 0.1, 60 - i * 0.1, 60 + i), 0.25);
      }
      return tracker.summary(null);
    };
    expect(run()).toEqual(run());
  });

  it('resamples through the layer header grid, not assumed dimensions', () => {
    // A half-resolution layer must still land ids on the right cells.
    const coarse = idLayer('admin1', () => 0);
    const small: BinLayer = {
      ...coarse,
      nx: 100,
      ny: 60,
      data: new Float32Array(100 * 60).fill(3),
    };
    const bin: ParsedBin = {
      version: 1,
      layers: new Map([['admin1', small]]),
    };
    const tracker = new ImpactTracker();
    tracker.setRegions(bin, { admin1: { '3': 'everywhere' }, wadi: {} });
    for (let i = 0; i < 8; i++) tracker.record(storm(22, 61, 90), 0.25);
    const regions = tracker.summary(null).regions!;
    expect(regions.rows[0]?.name).toBe('everywhere');
  });
});
