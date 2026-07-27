import { describe, expect, it } from 'vitest';
import {
  buildPublicCycleView,
  fetchPublicCycleManifest,
  parsePublicCycleManifest,
} from '../src/public-cycle';

function fixture(): unknown {
  return {
    schemaVersion: 1,
    product: 'public-source-monitor',
    generatedAt: '2026-07-27T09:00:00Z',
    cycle: {
      id: 'gfs-20260727T00Z',
      analysisTime: '2026-07-27T00:00:00Z',
      forecastLeadHours: [0, 6, 12],
    },
    status: 'forecast-disabled',
    statusLabel: 'PUBLIC DATA MONITOR — FORECAST DISABLED',
    gates: {
      deterministicAtmosphere: true,
      seaSurfaceTemperature: true,
      officialAdvisory: false,
      upperOcean: false,
      ensembleAtmosphere: false,
      readyForForecast: false,
    },
    sources: [
      {
        id: 'gfs',
        kind: 'atmospheric-grid',
        authority: 'NOAA/NCEP',
        status: 'acquired',
        usable: true,
        fetchedAt: '2026-07-27T09:00:00Z',
        validTime: '2026-07-27T00:00:00Z',
        maxAgeHours: 18,
        detail: 'regional fields decoded',
      },
      {
        id: 'rsmc',
        kind: 'agency-advisory',
        authority: 'RSMC New Delhi',
        status: 'no-active-cyclone',
        usable: false,
        fetchedAt: '2026-07-27T09:00:00Z',
        validTime: '2026-07-27T09:00:00Z',
        maxAgeHours: 6,
        detail: 'explicit no-cyclone product',
      },
    ],
    failures: ['no normalized active RSMC advisory is available'],
    fallback: {
      mode: 'climatology-sandbox',
      label: 'climatology sandbox',
    },
    prospective: {
      issued: false,
      registered: false,
      reason: 'required gates are closed',
    },
  };
}

describe('public-source monitor', () => {
  it('presents acquired and blocked sources without promoting them to a forecast', () => {
    const manifest = parsePublicCycleManifest(fixture());
    expect(manifest).not.toBeNull();
    const view = buildPublicCycleView(manifest!, '2026-07-27T10:00:00Z');
    expect(view.status).toBe('forecast-disabled');
    expect(view.sourceRows.map((row) => row.state)).toEqual(['available', 'blocked']);
    expect(view.cycleLabel).toContain('gfs-20260727T00Z');
  });

  it('rejects contradictory ready state', () => {
    const value = fixture() as {
      status: string;
      gates: { readyForForecast: boolean };
    };
    value.status = 'forecast-ready';
    value.gates.readyForForecast = true;
    expect(parsePublicCycleManifest(value)).toBeNull();
  });

  it('rejects a partial manifest response', async () => {
    const body = JSON.stringify(fixture());
    const adapter = async () => new Response(body, {
      headers: { 'content-length': String(body.length + 3) },
    });
    await expect(fetchPublicCycleManifest('https://example.invalid/current', adapter))
      .rejects.toThrow(/partial response/u);
  });

  it('fails closed on malformed source metadata', () => {
    const value = fixture() as { sources: Array<{ fetchedAt: unknown }> };
    value.sources[0]!.fetchedAt = 'not-a-date';
    expect(parsePublicCycleManifest(value)).toBeNull();
  });
});
