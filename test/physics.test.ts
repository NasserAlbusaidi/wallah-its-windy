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

const BASE: EnvSample = {
  sstC: 29,
  steerU: 0,
  steerV: 0,
  shear: 0,
  shearU: 0,
  shearV: 0,
};

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
});

describe('live storm diagnostics', () => {
  it('exposes the exact environment and intensity terms used by the latest tick', () => {
    const engine = createSimEngine({
      env: env({ sstC: 30, steerU: 3, steerV: 4, shear: 20 }),
      isLand: NO_LAND,
    });
    engine.spawn(spawnParams());
    engine.tick(DT);

    const state = engine.getState()!;
    const diagnostics = state.diagnostics;
    expect(diagnostics.sstC).toBe(30);
    expect(diagnostics.steerU).toBe(3);
    expect(diagnostics.steerV).toBe(4);
    expect(diagnostics.shearMs).toBe(20);
    expect(diagnostics.overLand).toBe(false);
    expect(diagnostics.mpiKt).toBeCloseTo(mpiKt(30), 8);
    expect(diagnostics.oceanKtPerH).toBeGreaterThan(0);
    expect(diagnostics.shearKtPerH).toBeGreaterThan(0);
    expect(diagnostics.landKtPerH).toBe(0);
    expect(diagnostics.dryAirKtPerH).toBe(0);
    expect(diagnostics.netKtPerH).toBeCloseTo(
      diagnostics.oceanKtPerH -
        diagnostics.shearKtPerH -
        diagnostics.landKtPerH -
        diagnostics.dryAirKtPerH,
      10,
    );
    expect(state.structure.maximumWindKt).toBeCloseTo(state.vKt, 10);
    expect(state.structure.centralPressureHpa).toBeLessThan(1010);
    expect(state.structure.rmwKm).toBeGreaterThan(0);
    expect(state.structure.hollandB).toBeGreaterThan(0);
    expect(Number.isFinite(state.structure.motionUms)).toBe(true);
    expect(Number.isFinite(state.structure.motionVms)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dry-air term (v1.1, design D12): geometric upwind-land proxy
// ---------------------------------------------------------------------------

describe('dryAirPenaltyKtPerH: distance-to-Arabian-landmass upwind proxy', () => {
  // A synthetic Arabian landmass to the N and W (the dry bearings): land north
  // of 23N or west of 57E, open sea to the SE. Mirrors Oman's real geometry
  // relative to the genesis belt.
  const NW_COAST = (lat: number, lon: number) => lat >= 23 || lon <= 57;

  it('is active in v1.1 (DRYAIR_K > 0) and off when the seam is disabled', () => {
    expect(SIM.DRYAIR_K).toBeGreaterThan(0);
    // With no land anywhere the proxy finds nothing within range → zero penalty.
    expect(dryAirPenaltyKtPerH(20, 62, 5, NO_LAND)).toBe(0);
  });

  it('is zero far out at sea (no upwind coast within range)', () => {
    // Deep in the SE corner: the NW coast is hundreds of km beyond DRYAIR_RANGE.
    expect(dryAirPenaltyKtPerH(15.5, 66, 5, NW_COAST)).toBe(0);
  });

  it('rises monotonically as the storm nears the upwind coast', () => {
    const far = dryAirPenaltyKtPerH(17, 63, 5, NW_COAST); // coast > RANGE away → 0
    const mid = dryAirPenaltyKtPerH(22, 58, 5, NW_COAST); // ~100 km upwind
    const near = dryAirPenaltyKtPerH(22.6, 57.4, 5, NW_COAST); // hugging the coast
    expect(far).toBe(0);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid);
  });

  it('is bounded to [0, DRYAIR_K] and finite everywhere, even over land', () => {
    const probes: Array<[number, number]> = [
      [15.5, 66], [18, 62], [21, 59], [22.5, 57.5], [24, 55], // last is over land
    ];
    for (const [lat, lon] of probes) {
      const p = dryAirPenaltyKtPerH(lat, lon, 5, NW_COAST);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(SIM.DRYAIR_K);
    }
  });

  it('only probes the dry N/NW/W bearings, ignoring land to the SE', () => {
    // Land ONLY to the south-east (a non-dry bearing) must not trigger the term.
    const SE_COAST = (lat: number, lon: number) => lat <= 17 && lon >= 63;
    expect(dryAirPenaltyKtPerH(18, 62, 5, SE_COAST)).toBe(0);
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

  it('dry-air-dominated weakening at sea → dies of dry air (not cold/shear)', () => {
    // SST=25.5 → MPI ~40 kt: warm enough that the storm never exceeds MPI (so the
    // cold channel stays 0), but low enough that the dry-air bite drags it below
    // 20 kt while still offshore. No shear, no landfall — only dry air can be the
    // cause. A synthetic Arabian coast to the N and W supplies the upwind land.
    const NW_COAST = (lat: number, lon: number) => lat >= 23 || lon <= 57;
    const engine = createSimEngine({ env: env({ sstC: 25.5, shear: 0, steerU: 0, steerV: 0 }), isLand: NW_COAST });
    engine.spawn(spawnParams({ lat: 22, lon: 58 })); // hugging the coast, still at sea
    const events = run(engine, 2000);
    const death = firstDeath(events);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.DryAir);
    // It really died offshore of dry air, not by wandering onto the coast.
    expect(events.some((e) => e.type === 'landfall')).toBe(false);
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
// tFracHorizonH: per-storm age→tFrac mapping (C4, event mode)
// ---------------------------------------------------------------------------

describe('SpawnParams.tFracHorizonH maps age onto the env timestep axis', () => {
  /** Warm, calm, no-land env that records the last tFrac it was asked for. */
  function recordingEnv(): { sampler: EnvSampler; lastTFrac: () => number } {
    let last = 0;
    return {
      sampler: { sample: (_la, _lo, _mi, tFrac) => ((last = tFrac), { ...BASE, sstC: 29 }) },
      lastTFrac: () => last,
    };
  }

  it('a short horizon reaches tFrac=1 (clamped) while the default stays low', () => {
    // 200 ticks * 15 min = 50 sim-hours.
    const shortEnv = recordingEnv();
    const shortEng = createSimEngine({ env: shortEnv.sampler, isLand: NO_LAND });
    shortEng.spawn(spawnParams({ tFracHorizonH: 24 }));
    for (let i = 0; i < 200; i++) shortEng.tick(DT);
    // 50 h age well past the 24 h horizon → clamped to 1.
    expect(shortEng.getState()!.alive).toBe(true);
    expect(shortEnv.lastTFrac()).toBe(1);

    const defEnv = recordingEnv();
    const defEng = createSimEngine({ env: defEnv.sampler, isLand: NO_LAND });
    defEng.spawn(spawnParams()); // no horizon → SIM.EVENT_TFRAC_HORIZON_H (240 h)
    for (let i = 0; i < 200; i++) defEng.tick(DT);
    // ~49.75 h / 240 h ≈ 0.21 — nowhere near 1.
    const t = defEnv.lastTFrac();
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.3);
  });

  it('tFrac grows linearly with age up to the horizon', () => {
    const rec = recordingEnv();
    const eng = createSimEngine({ env: rec.sampler, isLand: NO_LAND });
    eng.spawn(spawnParams({ tFracHorizonH: 48 })); // 48 h horizon
    for (let i = 0; i < 96; i++) eng.tick(DT); // 24 sim-hours = half the horizon
    // Last tick computed tFrac at age 23.75 h → ~0.495.
    expect(rec.lastTFrac()).toBeGreaterThan(0.45);
    expect(rec.lastTFrac()).toBeLessThan(0.5);
  });

  it('a zero/negative horizon falls back to the default (no divide-by-zero)', () => {
    const rec = recordingEnv();
    const eng = createSimEngine({ env: rec.sampler, isLand: NO_LAND });
    eng.spawn(spawnParams({ tFracHorizonH: 0 }));
    for (let i = 0; i < 40; i++) eng.tick(DT);
    const t = rec.lastTFrac();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1); // used the 240 h default, not 0
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
