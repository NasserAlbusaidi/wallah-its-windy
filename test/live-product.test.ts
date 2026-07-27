import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLiveProductView, fetchIssuedLiveRun } from '../src/live-product';
import type { ArchivedForecastRun } from '../src/live-data';

const fixture = JSON.parse(
  readFileSync('calibration/data/hf5/sample-live-run.json', 'utf8'),
) as ArchivedForecastRun;

describe('HF-5 live product presentation', () => {
  it('keeps official, baseline, and experimental guidance side by side', () => {
    const view = buildLiveProductView(fixture, fixture.createdAt);
    expect(view.status).toBe('current-experimental');
    expect(view.guidance.map((item) => [item.id, item.role])).toEqual([
      ['official', 'official'],
      ['persistence', 'baseline'],
      ['wallahModel', 'experimental'],
    ]);
    expect(view.statusLabel).toContain('not official guidance');
    expect(view.imageryLabels).toEqual({
      satellite: 'observed imagery',
      simulated: 'simulated proxy',
    });
  });

  it('rejects a partial issued-run response', async () => {
    const adapter = async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': '30' },
    });
    await expect(fetchIssuedLiveRun('https://example.invalid/current', adapter))
      .rejects.toThrow(/partial response/u);
  });

  it('accepts a valid decoded body when transfer bytes were compressed', async () => {
    const body = JSON.stringify(fixture);
    const adapter = async () => new Response(body, {
      status: 200,
      headers: {
        'content-encoding': 'br',
        'content-length': String(Math.floor(body.length / 2)),
      },
    });
    await expect(fetchIssuedLiveRun('https://example.invalid/current', adapter))
      .resolves.toMatchObject({ cycle: fixture.cycle });
  });
});
