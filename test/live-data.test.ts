import { describe, expect, it } from 'vitest';
import {
  evaluateLiveInputs,
  normalizeAdvisory,
  normalizeGridDescriptor,
  validateArchivedRun,
  type ArchivedForecastRun,
  type ForecastCycleIdentity,
  type SourceArtifact,
} from '../src/live-data';

const cycle: ForecastCycleIdentity = {
  providerId: 'rsmc-new-delhi',
  cycleId: '2026-06-01T00Z',
  analysisTime: '2026-06-01T00:00:00Z',
  issuedAt: '2026-06-01T03:00:00Z',
};
const kinds = [
  'agency-advisory',
  'atmospheric-grid',
  'sea-surface-temperature',
  'upper-ocean',
] as const;
const artifacts: SourceArtifact[] = kinds.map((kind, index) => ({
  id: `${kind}-${index}`,
  kind,
  providerId: kind === 'agency-advisory' ? cycle.providerId : `provider-${index}`,
  cycleId: cycle.cycleId,
  sourceUrl: `https://example.invalid/${kind}`,
  validTime: '2026-06-01T00:00:00Z',
  fetchedAt: '2026-06-01T03:05:00Z',
  license: 'provider terms snapshot 2026-06-01',
  sha256: 'a'.repeat(64),
  expectedBytes: 100 + index,
  receivedBytes: 100 + index,
  maxAgeHours: 12,
  required: true,
  compatibility: 'compatible',
}));

describe('HF-5 live-data boundary', () => {
  it('normalizes units while preserving the source wind averaging period', () => {
    const advisory = normalizeAdvisory({
      providerId: cycle.providerId,
      cycleId: cycle.cycleId,
      advisoryId: '1',
      stormId: 'ARB-01',
      stormName: null,
      analysisTime: cycle.analysisTime,
      issuedAt: cycle.issuedAt,
      lat: 17.5,
      lon: 65.25,
      motionDirectionDeg: 315,
      motionSpeed: 18.52,
      motionSpeedUnit: 'km/h',
      maximumWind: 90,
      windUnit: 'km/h',
      windAveragingMinutes: 3,
      centralPressure: 98_500,
      pressureUnit: 'Pa',
      rmw: 20,
      windRadii: { r34: 90, r50: null, r64: null },
      radiusUnit: 'nm',
      organization: 0.55,
    }, {
      canonicalMinutes: 1,
      toOneMinute: { 1: 1, 3: 1.05, 10: 1 / 0.88 },
      source: 'pinned WMO/provider policy',
      version: '2026-01',
    });
    expect(advisory.maximumWindOneMinuteKt).toBeCloseTo(51.026, 3);
    expect(advisory.originalMaximumWind.averagingMinutes).toBe(3);
    expect(advisory.motionSpeedMs).toBeCloseTo(5.144, 3);
    expect(advisory.centralPressureHpa).toBe(985);
    expect(advisory.rmwKm).toBeCloseTo(37.04, 3);
  });

  it('fails visibly on partial or stale required inputs', () => {
    const bad = artifacts.map((item) => ({ ...item }));
    bad[1].receivedBytes -= 1;
    bad[2].validTime = '2026-05-30T00:00:00Z';
    const decision = evaluateLiveInputs(cycle, bad, '2026-06-01T06:00:00Z');
    expect(decision.status).toBe('unavailable');
    expect(decision.currentForecastAllowed).toBe(false);
    expect(decision.failures.map((item) => item.code)).toEqual(
      expect.arrayContaining(['partial-download', 'stale']),
    );
    expect(decision.fallback.label).toContain('not a current forecast');
  });

  it('normalizes calendars, pressure levels, longitudes, and grid scanning metadata', () => {
    const grid = normalizeGridDescriptor({
      calendar: 'gregorian',
      analysisTime: '2026-06-01T00:00:00Z',
      validTimes: ['2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z'],
      pressureLevels: [85_000, 50_000, 25_000],
      pressureUnit: 'Pa',
      bbox: { west: 350, east: 20, south: -10, north: 30 },
      nx: 121,
      ny: 81,
      scanning: 'south-to-north-west-to-east',
    });
    expect(grid.calendar).toBe('proleptic-gregorian');
    expect(grid.pressureLevelsHpa).toEqual([850, 500, 250]);
    expect(grid.leadHours).toEqual([0, 24]);
    expect(grid.bbox.west).toBe(-10);
    expect(grid.sourceScanning).toBe('south-to-north-west-to-east');
    expect(() => normalizeGridDescriptor({
      ...grid,
      calendar: '360_day',
      pressureLevels: grid.pressureLevelsHpa,
      pressureUnit: 'hPa',
    })).toThrow(/unsupported live grid calendar/u);
  });

  it('refuses mixed advisory cycles and accepts a complete coherent cycle', () => {
    expect(evaluateLiveInputs(cycle, artifacts, '2026-06-01T06:00:00Z').status)
      .toBe('ready');
    const mixed = artifacts.map((item) => ({ ...item }));
    mixed[0].cycleId = '2026-06-01T06Z';
    expect(evaluateLiveInputs(cycle, mixed, '2026-06-01T06:00:00Z').failures)
      .toContainEqual(expect.objectContaining({ code: 'cycle-mismatch' }));
  });

  it('recomputes the archived decision and enforces side-by-side labels', () => {
    const advisory = normalizeAdvisory({
      providerId: cycle.providerId,
      cycleId: cycle.cycleId,
      advisoryId: '1',
      stormId: 'ARB-01',
      stormName: 'Example',
      analysisTime: cycle.analysisTime,
      issuedAt: cycle.issuedAt,
      lat: 18,
      lon: 65,
      motionDirectionDeg: null,
      motionSpeed: null,
      motionSpeedUnit: 'kt',
      maximumWind: 45,
      windUnit: 'kt',
      windAveragingMinutes: 1,
      centralPressure: 992,
      pressureUnit: 'hPa',
      rmw: null,
      windRadii: { r34: null, r50: null, r64: null },
      radiusUnit: 'km',
      organization: null,
    }, {
      canonicalMinutes: 1,
      toOneMinute: { 1: 1, 3: 1.05, 10: 1 / 0.88 },
      source: 'pinned policy',
      version: '1',
    });
    const run: ArchivedForecastRun = {
      schemaVersion: 1,
      product: 'experimental-forecast-companion',
      cycle,
      advisory,
      inputs: artifacts,
      inputDecision: evaluateLiveInputs(cycle, artifacts, '2026-06-01T06:00:00Z'),
      guidance: { official: [], persistence: [], wallahModel: [] },
      labels: {
        official: 'official agency guidance',
        persistence: 'baseline',
        wallahModel: 'experimental Wallah model',
        satellite: 'observed imagery',
        simulatedImagery: 'simulated proxy',
      },
      modelVersion: 'hf5-test',
      createdAt: '2026-06-01T06:00:00Z',
    };
    expect(validateArchivedRun(run)).toEqual([]);
    run.inputDecision.status = 'degraded';
    expect(validateArchivedRun(run)).toContain(
      'inputDecision is stale or does not match the archived inputs',
    );
  });
});
