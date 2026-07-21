import { describe, expect, it, vi } from 'vitest';
import { buildNomadsGfsProducts, JsonCycleAdapter } from '../src/live-providers';

describe('HF-5 provider adapters', () => {
  it('builds cycle- and lead-specific NOMADS products', () => {
    expect(buildNomadsGfsProducts('2026-06-01T06:00:00Z', [0, 24, 120]))
      .toEqual([
        expect.objectContaining({
          leadH: 0,
          grib2Url: expect.stringContaining('/gfs.20260601/06/atmos/gfs.t06z.pgrb2.0p25.f000'),
        }),
        expect.objectContaining({ leadH: 24, inventoryUrl: expect.stringMatching(/f024\.idx$/u) }),
        expect.objectContaining({ leadH: 120, inventoryUrl: expect.stringMatching(/f120\.idx$/u) }),
      ]);
    expect(() => buildNomadsGfsProducts('2026-06-01T03:00:00Z', [0]))
      .toThrow(/GFS cycle/u);
  });

  it('rejects partial adapter responses before parsing', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': '20' },
    }));
    const adapter = new JsonCycleAdapter(
      'rsmc-new-delhi',
      'https://ingest.invalid/cycle',
      fetchImpl,
    );
    await expect(adapter.fetchCycle({
      providerId: 'rsmc-new-delhi',
      cycleId: '2026-06-01T00Z',
      analysisTime: '2026-06-01T00:00:00Z',
      issuedAt: '2026-06-01T03:00:00Z',
    })).rejects.toThrow(/partial response/u);
  });
});
