/**
 * scenarios.test.ts — the scenario catalogue parse/validation + the pure
 * counterfactual mode-switch invariants (C8).
 *
 * The scenario runtime lives in main.ts (DOM + fetch + sim), but its DECISIONS are
 * pure functions in src/scenarios.ts so the load-bearing invariants are node-
 * testable without a DOM: (1) a malformed catalogue degrades to null (picker
 * disabled), individual bad entries drop; (2) the synoptic-index SIGN flips
 * correctly — event mode < 0 (tFrac time-interp), climatology >= 0 (seed%K regime
 * pick); (3) an event pins the month and threads the window horizon, counterfactual-
 * ing an active user storm or falling back to the canonical spawn.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseScenarios,
  findScenario,
  synopticIndexForSpawn,
  eventSpawn,
  restoredMonth,
  CLIMATOLOGY_ID,
} from '../src/scenarios';
import type { Scenario } from '../src/scenarios';

function loadFixture(): unknown {
  return JSON.parse(readFileSync('test/scenarios.fixture.json', 'utf8'));
}

describe('parseScenarios: valid fixture', () => {
  it('parses the two catalogued events with C3 fields intact', () => {
    const s = parseScenarios(loadFixture());
    expect(s).not.toBeNull();
    expect(s!.length).toBe(2);
    const gonu = s![0];
    expect(gonu.id).toBe('gonu');
    expect(gonu.label).toBe('gonu 2007');
    expect(gonu.bin).toBe('data/env_gonu.bin');
    expect(gonu.monthIndex).toBe(5);
    expect(gonu.windowH).toBe(189);
    expect(gonu.spawn).toEqual({ lat: 16.2, lon: 63.4, seed: 2007 });
    expect(gonu.ghostId).toBe('gonu2007');
  });
});

describe('parseScenarios: bad shapes degrade to null (never throw)', () => {
  const bad: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 7],
    ['string', 'nope'],
    ['empty object', {}],
    ['wrong version', { version: 2, scenarios: [] }],
    ['missing version', { scenarios: [] }],
    ['scenarios not array', { version: 1, scenarios: 'nope' }],
  ];
  for (const [label, input] of bad) {
    it(`${label} -> null`, () => {
      expect(() => parseScenarios(input)).not.toThrow();
      expect(parseScenarios(input)).toBeNull();
    });
  }

  it('empty scenarios array is valid (picker disables, not null)', () => {
    expect(parseScenarios({ version: 1, scenarios: [] })).toEqual([]);
  });
});

describe('parseScenarios: per-entry sanitisation', () => {
  const base = {
    id: 'x',
    label: 'x 2000',
    bin: 'data/env_x.bin',
    monthIndex: 5,
    stepH: 3,
    windowH: 189,
    startIso: '2000-01-01T00:00:00Z',
    spawn: { lat: 18, lon: 62, seed: 1 },
    ghostId: 'x2000',
  };
  const drops: Array<[string, unknown]> = [
    ['missing id', { ...base, id: undefined }],
    ['empty id', { ...base, id: '' }],
    ['non-string bin', { ...base, bin: 42 }],
    ['non-finite monthIndex', { ...base, monthIndex: NaN }],
    ['missing windowH', { ...base, windowH: undefined }],
    ['spawn not object', { ...base, spawn: 'nope' }],
    ['spawn missing seed', { ...base, spawn: { lat: 18, lon: 62 } }],
    ['spawn non-finite lat', { ...base, spawn: { lat: Infinity, lon: 62, seed: 1 } }],
    ['missing ghostId', { ...base, ghostId: undefined }],
  ];
  for (const [label, entry] of drops) {
    it(`drops entry: ${label}, keeps a valid sibling`, () => {
      const parsed = parseScenarios({ version: 1, scenarios: [entry, base] });
      expect(parsed).not.toBeNull();
      expect(parsed!.map((s) => s.id)).toEqual(['x']);
    });
  }
});

describe('findScenario', () => {
  const list = parseScenarios(loadFixture())!;
  it('resolves a known id', () => {
    expect(findScenario(list, 'shaheen')!.id).toBe('shaheen');
  });
  it('climatology / unknown / null -> null', () => {
    expect(findScenario(list, CLIMATOLOGY_ID)).toBeNull();
    expect(findScenario(list, 'nope')).toBeNull();
    expect(findScenario(list, null)).toBeNull();
    expect(findScenario(list, undefined)).toBeNull();
  });
});

describe('synopticIndexForSpawn: the mode-switch SIGN invariant', () => {
  it('event mode is always -1 (restores tFrac time-interp)', () => {
    expect(synopticIndexForSpawn(true, 2007, 64)).toBe(-1);
    expect(synopticIndexForSpawn(true, 0, 1)).toBe(-1);
    // The seed must not leak a non-negative plane in event mode.
    expect(synopticIndexForSpawn(true, 12345, 4)).toBeLessThan(0);
  });

  it('climatology picks seed % planeCount (>= 0, D10 regime)', () => {
    expect(synopticIndexForSpawn(false, 71, 4)).toBe(71 % 4);
    expect(synopticIndexForSpawn(false, 2007, 4)).toBe(2007 % 4);
    expect(synopticIndexForSpawn(false, 71, 4)).toBeGreaterThanOrEqual(0);
  });

  it('climatology guards planeCount < 1 to plane 0 (never divide by zero)', () => {
    expect(synopticIndexForSpawn(false, 71, 0)).toBe(0);
    expect(synopticIndexForSpawn(false, 71, 1)).toBe(0);
  });
});

describe('eventSpawn: counterfactual vs canonical, month pinned, window threaded', () => {
  const gonu: Scenario = parseScenarios(loadFixture())![0];

  it('no active user storm -> the scenario canonical spawn', () => {
    const s = eventSpawn(gonu, null);
    expect(s.lat).toBe(gonu.spawn.lat);
    expect(s.lon).toBe(gonu.spawn.lon);
    expect(s.seed).toBe(gonu.spawn.seed);
    expect(s.monthIndex).toBe(gonu.monthIndex); // month PINNED to the event's
    expect(s.tFracHorizonH).toBe(gonu.windowH); // window threaded (C4)
    expect(s.isDemo).toBe(false);
  });

  it('active user storm -> same lat/lon/seed under the event month (the counterfactual)', () => {
    const user = { lat: 20.1, lon: 59.2, seed: 987654 };
    const s = eventSpawn(gonu, user);
    expect(s.lat).toBe(20.1);
    expect(s.lon).toBe(59.2);
    expect(s.seed).toBe(987654); // storm identity preserved
    expect(s.monthIndex).toBe(gonu.monthIndex); // but re-run in the event's month
    expect(s.tFracHorizonH).toBe(gonu.windowH);
  });
});

describe('restoredMonth: pre-event month wins, then storm month, then fallback', () => {
  it('prefers the captured pre-event month', () => {
    expect(restoredMonth(7, 5, 4)).toBe(7);
  });
  it('falls back to the storm month when none was captured', () => {
    expect(restoredMonth(null, 9, 4)).toBe(9);
  });
  it('falls back to the default (demo month) when neither exists', () => {
    expect(restoredMonth(null, null, 4)).toBe(4);
  });
});
