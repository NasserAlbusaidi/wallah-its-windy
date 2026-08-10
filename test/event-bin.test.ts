/**
 * event-bin.test.ts — the v1.1 event-bin TIME-AXIS path, end-to-end (C2/C4/C8).
 *
 * A scenario switch swaps the sampler onto a historic event bin whose nt is a TIME
 * axis and selects event-timeline mode so tFrac linearly interpolates across the
 * timesteps (the counterfactual's sim-hours mapping onto event-hours). This builds
 * a tiny synthetic event bin with a test-only WIWB writer, parses it through the
 * PRODUCTION reader (loader.parseBin), and drives the PRODUCTION sampler
 * (makeEnvSampler) to prove: (1) event mode time-interpolates; (2) synoptic mode
 * freezes one plane and ignores tFrac; (3) the
 * sim actually runs on the event bin and terminates finitely.
 */

import { describe, it, expect } from 'vitest';
import { buildWiwbBin, constantPlanes } from './helpers/wiwb';
import { parseBin } from '../src/loader';
import {
  eventMonthSuffix,
  makeEnvSampler,
  synopticCount,
  envMonthSuffix,
} from '../src/env-sampler';
import {
  acceptEventBinForScenario,
  validateEventBinForScenario,
} from '../src/scenarios';
import { createSimEngine } from '../src/sim';
import { DOMAIN } from '../src/grid';
import type { ParsedBin, SimEvent } from '../src/types';
import type { Scenario } from '../src/scenarios';

// A June (monthIndex 5) event bin: all eight physical fields carry the same
// chronological axis. u_05 ramps 0 -> 10 -> 20
// across the timesteps so tFrac reads
// are unambiguous. Grid is 2x2 over the domain (cell choice is irrelevant — every
// cell in a plane holds the same value).
const MM = envMonthSuffix(5); // '05'
const NX = 2;
const NY = 2;
const U_PLANES = [0, 10, 20];

function buildEventBin(mm = MM): ParsedBin {
  const buf = buildWiwbBin([
    { name: `sst_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [29, 29, 29]) },
    { name: `u_${mm}`, nx: NX, ny: NY, nt: U_PLANES.length, bbox: DOMAIN, data: constantPlanes(NX, NY, U_PLANES) },
    { name: `v_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [1, 1, 1]) },
    { name: `shr_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [4, 4, 4]) },
    { name: `shu_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [0, 0, 0]) },
    { name: `shv_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [4, 4, 4]) },
    { name: `rh_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [70, 70, 70]) },
    { name: `ohc_${mm}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [60, 60, 60]) },
  ]);
  return parseBin(buf);
}

const SCENARIO: Scenario = {
  id: 'test',
  label: 'test event',
  bin: 'data/env_test.bin',
  monthIndex: 5,
  stepH: 3,
  windowH: 6,
  startIso: '2000-01-01T00:00:00Z',
  spawn: { lat: 18, lon: 62, seed: 1 },
  ghostId: 'test2000',
  hindcast: null,
  benchmarkPartition: null,
};

describe('event-bin scenario compatibility', () => {
  it('accepts a bin whose fields and timeline match the scenario', () => {
    expect(validateEventBinForScenario(buildEventBin(), SCENARIO)).toBeNull();
  });

  it('rejects a structurally valid bin with the wrong month suffix', () => {
    const wrongMonth = { ...SCENARIO, monthIndex: 6 };

    expect(validateEventBinForScenario(buildEventBin(), wrongMonth)).toMatch(
      /missing sst_06/,
    );
  });

  it('rejects a bin whose timeline length disagrees with scenario metadata', () => {
    const wrongWindow = { ...SCENARIO, windowH: 9 };

    expect(validateEventBinForScenario(buildEventBin(), wrongWindow)).toMatch(
      /sst_05 nt=3, expected 4/,
    );
  });

  it('warns and returns null instead of accepting incompatible physics', () => {
    const warnings: string[] = [];
    const wrongWindow = { ...SCENARIO, windowH: 9 };

    const accepted = acceptEventBinForScenario(
      buildEventBin(),
      wrongWindow,
      (message) => warnings.push(message),
    );

    expect(accepted).toBeNull();
    expect(warnings).toEqual([
      'test event bin mismatch: sst_05 nt=3, expected 4',
    ]);
  });
});

describe('event bin: nt semantics are explicit', () => {
  it('synopticCount reports the steering layer nt', () => {
    expect(synopticCount(buildEventBin(), 5)).toBe(U_PLANES.length);
  });

  it('event-timeline mode linearly interpolates u across the timesteps', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSamplingMode({ kind: 'event-timeline' });
    const lat = 21;
    const lon = 60;
    // tFrac 0 -> plane 0 (0), tFrac 1 -> plane 2 (20), tFrac 0.5 -> plane 1 (10).
    expect(sampler.sample(lat, lon, 5, 0).steerU).toBeCloseTo(0, 6);
    expect(sampler.sample(lat, lon, 5, 1).steerU).toBeCloseTo(20, 6);
    expect(sampler.sample(lat, lon, 5, 0.5).steerU).toBeCloseTo(10, 6);
    // Between planes 0 and 1: tFrac 0.25 -> tf=0.5 -> 0 + (10-0)*0.5 = 5.
    expect(sampler.sample(lat, lon, 5, 0.25).steerU).toBeCloseTo(5, 6);
  });

  it('reads an exact December suffix instead of climatology-clamped November', () => {
    const december = buildEventBin(eventMonthSuffix(11));
    const scenario = { ...SCENARIO, monthIndex: 11 };
    expect(validateEventBinForScenario(december, scenario)).toBeNull();
    const sampler = makeEnvSampler(() => december);
    sampler.setSamplingMode({ kind: 'event-timeline' });
    expect(sampler.sample(21, 60, 11, 0.5).steerU).toBeCloseTo(10, 6);
  });

  it('synoptic-plane mode freezes one plane and ignores tFrac', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 1 });
    // tFrac now inert: every tFrac reads plane 1's value (10), not interpolation.
    expect(sampler.sample(21, 60, 5, 0).steerU).toBeCloseTo(10, 6);
    expect(sampler.sample(21, 60, 5, 1).steerU).toBeCloseTo(10, 6);
    expect(sampler.getSamplingMode()).toEqual({
      kind: 'synoptic-plane',
      plane: 1,
    });
  });
});

describe('event bin: the sim runs on it and terminates finitely', () => {
  it('spawns, ticks, and dies without producing non-finite state', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSamplingMode({ kind: 'event-timeline' });
    const engine = createSimEngine({ env: sampler, isLand: () => false });
    engine.spawn({ lat: 18, lon: 62, monthIndex: 5, seed: 2007, isDemo: false });
    let died = false;
    for (let i = 0; i < 4000 && !died; i++) {
      const events: SimEvent[] = engine.tick(15);
      const s = engine.getState();
      if (s) {
        expect(Number.isFinite(s.lat)).toBe(true);
        expect(Number.isFinite(s.lon)).toBe(true);
        expect(Number.isFinite(s.vKt)).toBe(true);
      }
      died = events.some((e) => e.type === 'died');
    }
    // NO_LAND + steady low shear (4 m/s) -> the storm should live and eventually
    // exit the domain or dissipate; the invariant we pin is finiteness + a valid
    // final state (never a NaN blow-up on the event time-axis path).
    const final = engine.getState();
    if (final) expect(Number.isFinite(final.vKt)).toBe(true);
  });
});

describe('event-bin scenario compatibility: extent, not just names and nt', () => {
  const NEW_DOMAIN = { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 };

  function buildWrongExtentBin(): ParsedBin {
    const buf = buildWiwbBin(
      ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc'].map((field) => ({
        name: `${field}_${MM}`,
        nx: NX,
        ny: NY,
        nt: 3,
        bbox: NEW_DOMAIN,
        data: constantPlanes(NX, NY, [1, 1, 1]),
      })),
    );
    return parseBin(buf);
  }

  it('rejects a bin with every correct layer name and the correct nt but the wrong bbox', () => {
    const message = validateEventBinForScenario(buildWrongExtentBin(), SCENARIO);
    expect(message).not.toBeNull();
    expect(message).toMatch(/45,100,0,30/);
  });

  it('still accepts the matching bin', () => {
    expect(validateEventBinForScenario(buildEventBin(), SCENARIO)).toBeNull();
  });
});
