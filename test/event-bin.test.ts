/**
 * event-bin.test.ts — the v1.1 event-bin TIME-AXIS path, end-to-end (C2/C4/C8).
 *
 * A scenario switch swaps the sampler onto a historic event bin whose nt is a TIME
 * axis and calls setSynopticIndex(-1) so tFrac linearly interpolates across the
 * timesteps (the counterfactual's sim-hours mapping onto event-hours). This builds
 * a tiny synthetic event bin with a test-only WIWB writer, parses it through the
 * PRODUCTION reader (loader.parseBin), and drives the PRODUCTION sampler
 * (makeEnvSampler) to prove: (1) index -1 time-interpolates; (2) a non-negative
 * index freezes on one plane and ignores tFrac (the mode-switch sign flip); (3) the
 * sim actually runs on the event bin and terminates finitely.
 */

import { describe, it, expect } from 'vitest';
import { buildWiwbBin, constantPlanes } from './helpers/wiwb';
import { parseBin } from '../src/loader';
import { makeEnvSampler, synopticCount, envMonthSuffix } from '../src/env-sampler';
import { createSimEngine } from '../src/sim';
import { DOMAIN } from '../src/grid';
import type { ParsedBin, SimEvent } from '../src/types';

// A June (monthIndex 5) event bin: sst_05 is a single climatological plane; u/v/shr
// carry 3 time planes. u_05 ramps 0 -> 10 -> 20 across the timesteps so tFrac reads
// are unambiguous. Grid is 2x2 over the domain (cell choice is irrelevant — every
// cell in a plane holds the same value).
const MM = envMonthSuffix(5); // '05'
const NX = 2;
const NY = 2;
const U_PLANES = [0, 10, 20];

function buildEventBin(): ParsedBin {
  const buf = buildWiwbBin([
    { name: `sst_${MM}`, nx: NX, ny: NY, nt: 1, bbox: DOMAIN, data: constantPlanes(NX, NY, [29]) },
    { name: `u_${MM}`, nx: NX, ny: NY, nt: U_PLANES.length, bbox: DOMAIN, data: constantPlanes(NX, NY, U_PLANES) },
    { name: `v_${MM}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [1, 1, 1]) },
    { name: `shr_${MM}`, nx: NX, ny: NY, nt: 3, bbox: DOMAIN, data: constantPlanes(NX, NY, [4, 4, 4]) },
  ]);
  return parseBin(buf);
}

describe('event bin: nt is a time axis when setSynopticIndex(-1)', () => {
  it('synopticCount reports the steering layer nt', () => {
    expect(synopticCount(buildEventBin(), 5)).toBe(U_PLANES.length);
  });

  it('tFrac linearly interpolates u across the timesteps (index -1)', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSynopticIndex(-1); // event mode: nt as time
    const lat = 21;
    const lon = 60;
    // tFrac 0 -> plane 0 (0), tFrac 1 -> plane 2 (20), tFrac 0.5 -> plane 1 (10).
    expect(sampler.sample(lat, lon, 5, 0).steerU).toBeCloseTo(0, 6);
    expect(sampler.sample(lat, lon, 5, 1).steerU).toBeCloseTo(20, 6);
    expect(sampler.sample(lat, lon, 5, 0.5).steerU).toBeCloseTo(10, 6);
    // Between planes 0 and 1: tFrac 0.25 -> tf=0.5 -> 0 + (10-0)*0.5 = 5.
    expect(sampler.sample(lat, lon, 5, 0.25).steerU).toBeCloseTo(5, 6);
  });

  it('a non-negative index freezes on one plane and IGNORES tFrac (the sign flip)', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSynopticIndex(1); // climatology-style plane pick
    // tFrac now inert: every tFrac reads plane 1's value (10), not interpolation.
    expect(sampler.sample(21, 60, 5, 0).steerU).toBeCloseTo(10, 6);
    expect(sampler.sample(21, 60, 5, 1).steerU).toBeCloseTo(10, 6);
    expect(sampler.getSynopticIndex()).toBe(1);
  });
});

describe('event bin: the sim runs on it and terminates finitely', () => {
  it('spawns, ticks, and dies without producing non-finite state', () => {
    const bin = buildEventBin();
    const sampler = makeEnvSampler(() => bin);
    sampler.setSynopticIndex(-1); // event mode
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
