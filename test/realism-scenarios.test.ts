/**
 * realism-scenarios.test.ts — guards the frozen R2a realism scenario set.
 *
 * The set is frozen before the first reference seal, so the risk it defends
 * against is silent drift: an event id that no longer exists (or lost its
 * hindcast metadata), a climatology spawn nudged outside the simulated domain,
 * or a month/cadence edit that would make two reference runs incomparable.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMAIN, inBBox } from '../src/grid';

const spec = JSON.parse(
  readFileSync('calibration/realism/realism-scenarios.json', 'utf8'),
) as {
  version: number;
  sampleEveryH: number;
  climatologyMaxHours: number;
  events: string[];
  climatology: { id: string; monthIndex: number; lat: number; lon: number; seed: number }[];
};
const catalogue = JSON.parse(
  readFileSync('public/data/scenarios.json', 'utf8'),
) as { scenarios: { id: string; hindcast: unknown }[] };

describe('realism scenario set', () => {
  it('every event id exists in the app catalogue with hindcast metadata', () => {
    for (const id of spec.events) {
      const scenario = catalogue.scenarios.find((s) => s.id === id);
      expect(scenario, id).toBeDefined();
      expect(scenario?.hindcast, id).toBeTruthy();
    }
  });

  it('climatology triplets are in-domain, in-season, integer-seeded', () => {
    expect(spec.climatology).toHaveLength(7);
    expect(new Set(spec.climatology.map((c) => c.monthIndex)).size).toBe(7);
    for (const c of spec.climatology) {
      expect(Number.isInteger(c.seed)).toBe(true);
      expect(c.monthIndex).toBeGreaterThanOrEqual(4);
      expect(c.monthIndex).toBeLessThanOrEqual(10);
      expect(inBBox(c.lat, c.lon, DOMAIN)).toBe(true);
    }
  });

  it('cadence and horizon are frozen', () => {
    expect(spec.sampleEveryH).toBe(6);
    expect(spec.climatologyMaxHours).toBe(240);
  });
});
