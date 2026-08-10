/**
 * max-age.test.ts — SIM.MAX_AGE_H, the lifetime bound (nio-v1 Phase 1).
 *
 * Today the exit-domain test at sim.ts:1407 ends every real storm long before
 * any age cap, so the cap must be provably inert. This file proves BOTH halves:
 * (a) the cap never pre-empts an existing outcome, and it is strictly outside
 *     the 360-hour horizon `ensemble.runStorm` already stops at — so no recorded
 *     ensemble result gains a death record;
 * (b) the cap does fire for a storm the exit test cannot reach, built as the
 *     design-spec section 3.2 probe: beta drift cancelled by the environmental
 *     steer, stochastic wander disabled, a slow eastward drift that stays in box.
 */

import { describe, it, expect } from 'vitest';
import type { EnvSample, EnvSampler, SimEngine, SimEvent, SpawnParams, StormDeath } from '../src/types';
import { DeathReason } from '../src/types';
import { SIM, createSimEngine } from '../src/sim';
import { runStorm } from '../src/ensemble';
import { DOMAIN, inBBox } from '../src/grid';

const DT = 15; // the fixed accumulator step, sim-minutes
/** sim.ts:72's module-local MS_PER_KT, duplicated because it is not exported. */
const MS_PER_KT = 0.514444;
/** sim.ts:832-836's shipped-profile beta drift is {u:-B, v:+B} with this B. */
const BETA_SPEED_MS = SIM.BETA_DRIFT_KT * MS_PER_KT * Math.SQRT1_2;
/** Slow enough to stay in the box for 360 h, fast enough to avoid wake saturation. */
const DRIFT_EAST_MS = 1;

function env(over: Partial<EnvSample> = {}): EnvSampler {
  const s: EnvSample = {
    sstC: 29.5,
    steerU: 0,
    steerV: 0,
    shear: 0,
    shearU: 0,
    shearV: 0,
    midlevelRhPct: 75,
    ohcKjCm2: 120,
    ...over,
  };
  return { sample: () => ({ ...s }) };
}

const NO_LAND = () => false;

/** Net motion: +1 m/s east, 0 north. Beta drift is cancelled exactly in v. */
const IMMORTAL_ENV = env({
  steerU: BETA_SPEED_MS + DRIFT_EAST_MS,
  steerV: -BETA_SPEED_MS,
});

/**
 * Same immortal fixture, drift raised so the storm crosses the east domain
 * edge on the SAME tick (1441, ageH 360.25) the age cap first becomes
 * eligible -- a genuine tie, not just an earlier or later death. Found
 * empirically against the production engine: at 1.361 m/s the storm is still
 * at lon 69.98 on tick 1441 and the age cap fires; at 1.363 m/s it is already
 * past lon 70 on that same tick and exit-domain fires instead.
 */
const DRIFT_EAST_AT_CAP_MS = 1.363;
const EXIT_AT_CAP_ENV = env({
  steerU: BETA_SPEED_MS + DRIFT_EAST_AT_CAP_MS,
  steerV: -BETA_SPEED_MS,
});

function immortalSpawn(): SpawnParams {
  return {
    lat: 21,
    lon: 53,
    monthIndex: 5,
    seed: 12345,
    isDemo: false,
    disableWander: true,
  };
}

function firstDeath(events: SimEvent[]): StormDeath | null {
  for (const e of events) if (e.type === 'died') return e.death;
  return null;
}

describe('SIM.MAX_AGE_H: the declared lifetime bound', () => {
  it('is 360 hours, matching ensemble.ts:183 maxHours', () => {
    expect(SIM.MAX_AGE_H).toBe(360);
  });

  it('is strictly outside the 360-hour horizon runStorm already stops at', () => {
    const result = runStorm({
      env: IMMORTAL_ENV,
      isLand: NO_LAND,
      spawn: immortalSpawn(),
    });
    // If this flips to a death record, every recorded ensemble result changes.
    expect(result.death).toBeNull();
    expect(result.durationH).toBe(360);
  });

  it('fires on the first tick past the cap, for a storm the exit test cannot reach', () => {
    const engine: SimEngine = createSimEngine({ env: IMMORTAL_ENV, isLand: NO_LAND });
    engine.spawn(immortalSpawn());
    // 1440 ticks of 15 min = exactly 360.00 h.
    let events: SimEvent[] = [];
    for (let i = 0; i < 1440; i++) events = engine.tick(DT);
    const at360 = engine.getState()!;
    expect(at360.alive).toBe(true);
    expect(at360.ageH).toBe(360);
    expect(firstDeath(events)).toBeNull();
    // Fixture sanity: the exit test must not be what ends this storm.
    expect(inBBox(at360.lat, at360.lon, DOMAIN)).toBe(true);
    expect(at360.lat).toBeCloseTo(21, 6);
    expect(at360.vKt).toBeGreaterThanOrEqual(SIM.DESPAWN_VKT);

    const finalEvents = engine.tick(DT);
    const death = firstDeath(finalEvents);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.MaxAge);
    expect(death!.durationH).toBe(360.25);
    expect(engine.getState()!.alive).toBe(false);
  });

  it('exit-domain still wins when it becomes true on the same tick as the age cap', () => {
    // All six cases in the next describe block die well under 360 h, so none
    // of them is ever alive past the cap -- they would pass identically with
    // the age branch moved to the FRONT of sim.ts's lifecycle chain. This
    // case is built so both conditions are true on the same tick, which is
    // the only kind of case that can actually distinguish the two orderings.
    const engine = createSimEngine({ env: EXIT_AT_CAP_ENV, isLand: NO_LAND });
    engine.spawn(immortalSpawn());
    let death: StormDeath | null = null;
    for (let i = 0; i < 1500 && death === null; i++) death = firstDeath(engine.tick(DT));
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.ExitedDomain);
    // Past the cap when it dies -- the moment this isn't true, this case has
    // stopped testing precedence and is just another pre-emption case.
    expect(death!.durationH).toBe(360.25);
  });
});

describe('SIM.MAX_AGE_H: pre-empts no existing outcome', () => {
  const cases: Array<[string, Partial<EnvSample>, Partial<SpawnParams>, DeathReason]> = [
    ['cold water', { sstC: 22 }, {}, DeathReason.ColdWater],
    ['extreme shear', { sstC: 30, shear: 40 }, {}, DeathReason.Shear],
    ['east edge', { sstC: 29, steerU: 20 }, { lat: 21, lon: 69 }, DeathReason.ExitedDomain],
    ['west edge', { sstC: 29, steerU: -20 }, { lat: 21, lon: 51 }, DeathReason.ExitedDomain],
    ['north edge', { sstC: 29, steerV: 20 }, { lat: 26, lon: 60 }, DeathReason.ExitedDomain],
    ['south edge', { sstC: 29, steerV: -20 }, { lat: 16, lon: 60 }, DeathReason.ExitedDomain],
  ];
  for (const [name, over, spawnOver, reason] of cases) {
    it(`${name} still dies of ${reason}, before the cap`, () => {
      const engine = createSimEngine({ env: env(over), isLand: NO_LAND });
      engine.spawn({ lat: 21, lon: 60, monthIndex: 5, seed: 12345, isDemo: false, ...spawnOver });
      let death: StormDeath | null = null;
      for (let i = 0; i < 2000 && death === null; i++) death = firstDeath(engine.tick(DT));
      expect(death, name).not.toBeNull();
      expect(death!.reason).toBe(reason);
      expect(death!.durationH).toBeLessThan(SIM.MAX_AGE_H);
    });
  }
});
