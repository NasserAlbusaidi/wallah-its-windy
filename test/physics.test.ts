/**
 * physics.test.ts — table-driven physics invariants for sim.ts (eng task T6).
 *
 * Spike-declaration exception (design doc): the physics core is a pure function
 * of (spawn, month, seed), so it is the one part that carries tests. These pin
 * the invariants from the test plan: warm water intensifies, land/shear/cold
 * weaken, despawn rules, clean domain exit at all four edges, exact determinism,
 * NW beta drift, and isFinite everywhere. Env is a synthetic in-memory stub —
 * no .bin is loaded here.
 */

import { describe, it, expect } from 'vitest';
import type { EnvSample, EnvSampler, SimEngine, SimEvent, SpawnParams } from '../src/types';
import { DeathReason } from '../src/types';
import { DOMAIN, inBBox } from '../src/grid';
import {
  SIM,
  createSimEngine,
  mpiKt,
  shearPenaltyKtPerH,
  landDecayKtPerH,
  dryAirPenaltyKtPerH,
  intensityRateKtPerH,
  betaDriftMs,
} from '../src/sim';

// --- Synthetic environment stubs -------------------------------------------

const BASE: EnvSample = { sstC: 29, steerU: 0, steerV: 0, shear: 0 };

/** Uniform environment everywhere. */
function env(over: Partial<EnvSample> = {}): EnvSampler {
  const s: EnvSample = { ...BASE, ...over };
  return { sample: () => ({ ...s }) };
}

const NO_LAND = () => false;
/** A synthetic straight coast: everything east of lon 64 is land. */
const COAST_64 = (_lat: number, lon: number) => lon >= 64;

const DT = 15; // the fixed accumulator step (sim-minutes)
const CENTER: Pick<SpawnParams, 'lat' | 'lon'> = { lat: 21, lon: 60 };

function spawnParams(over: Partial<SpawnParams> = {}): SpawnParams {
  return { lat: CENTER.lat, lon: CENTER.lon, monthIndex: 5, seed: 12345, isDemo: false, ...over };
}

/** Tick until the storm dies or maxTicks is hit; return every event emitted. */
function run(engine: SimEngine, maxTicks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    all.push(...engine.tick(DT));
    const st = engine.getState();
    if (st && !st.alive) break;
  }
  return all;
}

function firstDeath(events: SimEvent[]) {
  const d = events.find((e) => e.type === 'died');
  return d && d.type === 'died' ? d.death : null;
}

// ---------------------------------------------------------------------------
// MPI curve (DeMaria–Kaplan + maintenance taper)
// ---------------------------------------------------------------------------

describe('mpiKt: DeMaria–Kaplan fit with cold-water taper', () => {
  it('is 0 at/below the maintenance floor (cold water cannot sustain a TC)', () => {
    expect(mpiKt(24)).toBe(0);
    expect(mpiKt(20)).toBe(0);
    expect(mpiKt(SIM.SST_FLOOR_C)).toBe(0);
  });

  it('rises with SST and supports a major hurricane over 30 °C water', () => {
    expect(mpiKt(28)).toBeGreaterThan(mpiKt(26));
    expect(mpiKt(30)).toBeGreaterThan(mpiKt(28));
    expect(mpiKt(30)).toBeGreaterThan(110); // >= Cat 3 potential over very warm water
  });

  it('is finite and non-negative across a wide SST range', () => {
    for (let t = 0; t <= 35; t += 0.5) {
      const v = mpiKt(t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Intensity ODE invariants (test plan: warm→intensify, land→decay, shear→weaken)
// ---------------------------------------------------------------------------

describe('intensityRateKtPerH: dV/dt sign invariants', () => {
  interface Case {
    name: string;
    args: Parameters<typeof intensityRateKtPerH>[0];
    expect: 'positive' | 'negative';
  }
  const cases: Case[] = [
    {
      name: '30 °C ocean, calm shear → intensifies',
      args: { vKt: 40, sstC: 30, shearMs: 0, overLand: false, lat: 21, lon: 60, monthIndex: 5 },
      expect: 'positive',
    },
    {
      name: '29 °C ocean, weak storm → intensifies',
      args: { vKt: 30, sstC: 29, shearMs: 3, overLand: false, lat: 21, lon: 60, monthIndex: 5 },
      expect: 'positive',
    },
    {
      name: 'over land → decays',
      args: { vKt: 80, sstC: 30, shearMs: 0, overLand: true, lat: 23, lon: 58, monthIndex: 5 },
      expect: 'negative',
    },
    {
      name: 'high shear over warm water → weakens',
      args: { vKt: 60, sstC: 30, shearMs: 30, overLand: false, lat: 21, lon: 60, monthIndex: 5 },
      expect: 'negative',
    },
    {
      name: 'cold water (22 °C) → weakens (MPI taper → 0)',
      args: { vKt: 50, sstC: 22, shearMs: 0, overLand: false, lat: 18, lon: 63, monthIndex: 5 },
      expect: 'negative',
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const rate = intensityRateKtPerH(c.args);
      expect(Number.isFinite(rate)).toBe(true);
      if (c.expect === 'positive') expect(rate).toBeGreaterThan(0);
      else expect(rate).toBeLessThan(0);
    });
  }
});

describe('penalty helpers', () => {
  it('shear does nothing below threshold, grows linearly above', () => {
    expect(shearPenaltyKtPerH(SIM.SHEAR_THRESHOLD_MS - 1)).toBe(0);
    expect(shearPenaltyKtPerH(5)).toBe(0);
    expect(shearPenaltyKtPerH(20)).toBeGreaterThan(shearPenaltyKtPerH(15));
  });
  it('land decay is proportional to intensity and never negative', () => {
    expect(landDecayKtPerH(100)).toBeGreaterThan(landDecayKtPerH(50));
    expect(landDecayKtPerH(0)).toBe(0);
    expect(landDecayKtPerH(-5)).toBe(0);
  });
  it('dry-air term is a v1.0 no-op (seam for eng task T11)', () => {
    expect(dryAirPenaltyKtPerH(23, 58, 5)).toBe(0);
    expect(SIM.DRYAIR_K).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Motion: beta drift + spin-up timing
// ---------------------------------------------------------------------------

describe('motion', () => {
  it('beta drift is a northwestward vector (u west-negative, v north-positive)', () => {
    const b = betaDriftMs();
    expect(b.u).toBeLessThan(0);
    expect(b.v).toBeGreaterThan(0);
    expect(Number.isFinite(b.u)).toBe(true);
    expect(Number.isFinite(b.v)).toBe(true);
  });

  it('beta drift carries a zero-steering storm to the NW', () => {
    // Zero steering + warm water so it survives; only beta + the gentle wander
    // move it. Over ~4 days the NW beta bias dominates the mean-zero wander.
    const engine = createSimEngine({ env: env({ steerU: 0, steerV: 0 }), isLand: NO_LAND });
    engine.spawn(spawnParams());
    for (let i = 0; i < 400; i++) engine.tick(DT);
    const st = engine.getState()!;
    expect(st.lat).toBeGreaterThan(CENTER.lat); // moved north
    expect(st.lon).toBeLessThan(CENTER.lon); // moved west
  });

  it('spins up from spawn to a hurricane over ~2–3 sim-days over 30 °C water', () => {
    const engine = createSimEngine({ env: env({ sstC: 30 }), isLand: NO_LAND });
    engine.spawn(spawnParams());
    // 3 sim-days = 72 h = 288 ticks of 15 min.
    for (let i = 0; i < 288; i++) engine.tick(DT);
    const st = engine.getState()!;
    expect(st.alive).toBe(true);
    expect(st.vKt).toBeGreaterThan(64); // >= Cat 1 (64 kt) after 3 days
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: despawn rules + death-reason attribution
// ---------------------------------------------------------------------------

describe('lifecycle: despawn under 20 kt with honest cause of death', () => {
  it('cold water → weakens below 20 kt → dies of cold water', () => {
    const engine = createSimEngine({ env: env({ sstC: 22 }), isLand: NO_LAND });
    engine.spawn(spawnParams());
    const events = run(engine, 1000);
    const death = firstDeath(events);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.ColdWater);
    expect(engine.getState()!.alive).toBe(false);
    expect(engine.getState()!.vKt).toBeLessThan(SIM.DESPAWN_VKT);
  });

  it('extreme shear over warm water → dies of shear', () => {
    const engine = createSimEngine({ env: env({ sstC: 30, shear: 40 }), isLand: NO_LAND });
    engine.spawn(spawnParams());
    const events = run(engine, 1000);
    const death = firstDeath(events);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.Shear);
  });

  it('crossing onto land → decays → dies of land, after a landfall event', () => {
    const engine = createSimEngine({ env: env({ sstC: 29, steerU: 10 }), isLand: COAST_64 });
    engine.spawn(spawnParams({ lat: 21, lon: 62 })); // sea, west of the coast
    const events = run(engine, 2000);
    const death = firstDeath(events);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.Land);
    expect(events.some((e) => e.type === 'landfall')).toBe(true);
  });
});

describe('lifecycle: clean domain exit at all four edges (no NaN, reason exited)', () => {
  interface Edge {
    name: string;
    over: Partial<EnvSample>;
    spawn: Partial<SpawnParams>;
  }
  const edges: Edge[] = [
    { name: 'east', over: { sstC: 29, steerU: 20 }, spawn: { lat: 21, lon: 69 } },
    { name: 'west', over: { sstC: 29, steerU: -20 }, spawn: { lat: 21, lon: 51 } },
    { name: 'north', over: { sstC: 29, steerV: 20 }, spawn: { lat: 26, lon: 60 } },
    { name: 'south', over: { sstC: 29, steerV: -20 }, spawn: { lat: 16, lon: 60 } },
  ];
  for (const edge of edges) {
    it(`${edge.name} edge`, () => {
      const engine = createSimEngine({ env: env(edge.over), isLand: NO_LAND });
      engine.spawn(spawnParams(edge.spawn));
      const events = run(engine, 500);
      const death = firstDeath(events);
      expect(death).not.toBeNull();
      expect(death!.reason).toBe(DeathReason.ExitedDomain);
      const st = engine.getState()!;
      expect(inBBox(st.lat, st.lon, DOMAIN)).toBe(false);
      // Not one NaN/Inf anywhere along the track.
      for (const p of st.trackPoints) {
        expect(Number.isFinite(p.lat)).toBe(true);
        expect(Number.isFinite(p.lon)).toBe(true);
        expect(Number.isFinite(p.vKt)).toBe(true);
        expect(Number.isFinite(p.ageH)).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Determinism: sim = f(spawn, month, seed)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  function track(seed: number, n: number) {
    const engine = createSimEngine({ env: env({ sstC: 30 }), isLand: NO_LAND });
    engine.spawn(spawnParams({ seed }));
    for (let i = 0; i < n; i++) engine.tick(DT);
    return engine.getState()!.trackPoints;
  }

  it('same (spawn, month, seed) → byte-identical track after N ticks', () => {
    expect(track(777, 200)).toEqual(track(777, 200));
  });

  it('different seed → diverging track (the wander does its job)', () => {
    const a = track(1, 200);
    const b = track(2, 200);
    const last = a.length - 1;
    const moved = Math.abs(a[last].lat - b[last].lat) + Math.abs(a[last].lon - b[last].lon);
    expect(moved).toBeGreaterThan(1e-4);
  });

  it('same (spawn, month) but no seed change replays intensity exactly too', () => {
    const a = track(42, 150);
    const b = track(42, 150);
    expect(a.map((p) => p.vKt)).toEqual(b.map((p) => p.vKt));
  });
});

// ---------------------------------------------------------------------------
// Events + isFinite guards
// ---------------------------------------------------------------------------

describe('events', () => {
  it("emits 'spawned' on the first tick and 'peak' once the storm turns over", () => {
    const engine = createSimEngine({ env: env({ sstC: 29, steerU: 10 }), isLand: COAST_64 });
    engine.spawn(spawnParams({ lat: 21, lon: 62 }));
    const first = engine.tick(DT);
    expect(first.some((e) => e.type === 'spawned')).toBe(true);
    const rest = run(engine, 2000);
    const peak = rest.find((e) => e.type === 'peak');
    expect(peak && peak.type === 'peak' ? peak.vKt : 0).toBeGreaterThanOrEqual(SIM.PEAK_MIN_KT);
  });
});

describe('isFinite: a full storm life carries no NaN', () => {
  it('every track point + death payload is finite', () => {
    const engine = createSimEngine({ env: env({ sstC: 29, steerU: 8 }), isLand: COAST_64 });
    engine.spawn(spawnParams({ lat: 20, lon: 61 }));
    const events = run(engine, 3000);
    const st = engine.getState()!;
    for (const p of st.trackPoints) {
      expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
      expect(Number.isFinite(p.vKt) && Number.isFinite(p.ageH)).toBe(true);
    }
    const death = firstDeath(events);
    if (death) {
      expect(Number.isFinite(death.closestApproachKm)).toBe(true);
      expect(Number.isFinite(death.durationH)).toBe(true);
      expect(Number.isFinite(death.peakKt)).toBe(true);
    }
  });
});
