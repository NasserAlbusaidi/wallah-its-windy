/**
 * integration-bins.test.ts — the bake<->runtime format-drift guard.
 *
 * The four .bin/.json artifacts are produced by a SEPARATE pipeline (bake/*.py)
 * from the code that reads them (loader.ts, env-sampler.ts, sim.ts, ui.isLand,
 * render). This test loads the REAL baked files through the production reader and
 * asserts (a) headers + finite value ranges are sane and (b) the sim actually runs
 * on the real env.bin — i.e. the month-suffixed layer names resolve and the storm
 * lives a finite, terminating life. It is the regression guard for the parallel-
 * build seam bugs: env.bin's `sst_MM` naming and the sim's silent analytic
 * fallback when those names don't resolve.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBin } from '../src/loader';
import { makeEnvSampler, envMonthSuffix, synopticCount } from '../src/env-sampler';
import { DEMO_GENESIS, DEMO_MONTH, DEMO_SEED } from '../src/ui';
import { createSimEngine, SIM } from '../src/sim';
import { cellToLatLon, DOMAIN, inBBox, latLonToCell } from '../src/grid';
import { MUSCAT } from '../src/types';
import type { BinLayer, ParsedBin, SimEvent } from '../src/types';

// Vitest runs with cwd = repo root, so the baked artifacts resolve relatively.
// (Avoids @types/node: the project caps dev deps at vite/typescript/vitest, so a
// scoped ambient shim in test/node-fs.d.ts types just the `node:fs` read we use.)
const DATA_DIR = 'public/data';

function loadBin(name: string): ParsedBin {
  const buf = readFileSync(`${DATA_DIR}/${name}`);
  // Buffer may be a view into a pooled ArrayBuffer — slice out an exact copy.
  // A file read is never SharedArrayBuffer-backed, so narrowing the union is safe.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return parseBin(ab);
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Nearest-cell read of a layer (north->south row order), for spot checks. */
function nearest(layer: BinLayer, lat: number, lon: number): number {
  const { col, row } = latLonToCell({ nx: layer.nx, ny: layer.ny, bbox: layer.bbox }, lat, lon);
  const c = clampInt(col, 0, layer.nx - 1);
  const r = clampInt(row, 0, layer.ny - 1);
  return layer.data[r * layer.nx + c];
}

/** Nearest-cell read of one time/synoptic plane (for per-plane belt stats). */
function nearestPlane(layer: BinLayer, lat: number, lon: number, plane: number): number {
  const { col, row } = latLonToCell({ nx: layer.nx, ny: layer.ny, bbox: layer.bbox }, lat, lon);
  const c = clampInt(col, 0, layer.nx - 1);
  const r = clampInt(row, 0, layer.ny - 1);
  const p = clampInt(plane, 0, layer.nt - 1);
  return layer.data[(p * layer.ny + r) * layer.nx + c];
}

function allFinite(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) return false;
  return true;
}

function range(data: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  return { min, max };
}

const SEASON = [4, 5, 6, 7, 8, 9, 10] as const;

describe('terrain.bin', () => {
  const bin = loadBin('terrain.bin');
  const elev = bin.layers.get('elev');
  const land = bin.layers.get('landmask');

  it('has elev + landmask on the unified domain', () => {
    expect(elev).toBeDefined();
    expect(land).toBeDefined();
    expect(elev!.bbox).toEqual(DOMAIN);
    expect(land!.bbox).toEqual(DOMAIN);
    expect(elev!.nx).toBe(land!.nx);
    expect(elev!.ny).toBe(land!.ny);
  });

  it('elevation is finite and within plausible Earth relief', () => {
    expect(allFinite(elev!.data)).toBe(true);
    const { min, max } = range(elev!.data);
    expect(min).toBeGreaterThanOrEqual(-6000);
    expect(max).toBeLessThanOrEqual(3100);
  });

  it('land mask is strictly 0/1 and places Muscat on land, deep sea on water', () => {
    for (let i = 0; i < land!.data.length; i++) {
      const v = land!.data[i];
      expect(v === 0 || v === 1).toBe(true);
    }
    expect(nearest(land!, MUSCAT.lat, MUSCAT.lon)).toBe(1);
    expect(nearest(land!, 18, 62)).toBe(0); // central Arabian Sea
    expect(nearest(elev!, 18, 62)).toBeLessThan(0); // ocean elevation is negative
  });
});

describe('env.bin', () => {
  const bin = loadBin('env.bin');

  it('carries all four fields for every season month (sst_MM/u_MM/v_MM/shr_MM)', () => {
    for (const m of SEASON) {
      const mm = envMonthSuffix(m);
      for (const field of ['sst', 'u', 'v', 'shr']) {
        expect(bin.layers.get(`${field}_${mm}`), `${field}_${mm}`).toBeDefined();
      }
    }
  });

  it('SST is finite, ocean-plausible in [15,35]C, and shear is non-negative', () => {
    for (const m of SEASON) {
      const mm = envMonthSuffix(m);
      const sst = bin.layers.get(`sst_${mm}`)!;
      const shr = bin.layers.get(`shr_${mm}`)!;
      expect(allFinite(sst.data)).toBe(true);
      expect(allFinite(shr.data)).toBe(true);
      // an open-ocean cell must be a plausible tropical SST
      const oceanSst = nearest(sst, 15.5, 64);
      expect(oceanSst).toBeGreaterThanOrEqual(15);
      expect(oceanSst).toBeLessThanOrEqual(35);
      const { min } = range(shr.data);
      expect(min).toBeGreaterThanOrEqual(0);
    }
  });

  it('envMonthSuffix clamps off-season to the baked range and is 0-indexed', () => {
    expect(envMonthSuffix(5)).toBe('05'); // June -> sst_05, NOT sst_06 (the fixed bug)
    expect(envMonthSuffix(0)).toBe('04'); // Jan clamps to May
    expect(envMonthSuffix(11)).toBe('10'); // Dec clamps to Nov
  });

  it('u/v/shr ship K>=3 synoptic sample planes (D10), all finite and distinct', () => {
    for (const m of SEASON) {
      const mm = envMonthSuffix(m);
      for (const field of ['u', 'v', 'shr']) {
        const layer = bin.layers.get(`${field}_${mm}`)!;
        expect(layer.nt, `${field}_${mm} nt`).toBeGreaterThanOrEqual(3);
        expect(allFinite(layer.data)).toBe(true);
      }
      // Planes must be genuinely different regimes, not copies: every adjacent
      // pair of planes must differ clearly in mean |u| (catches duplicated or
      // zero-filled tail planes, not just a bad plane 1).
      const u = bin.layers.get(`u_${mm}`)!;
      const planeSize = u.nx * u.ny;
      for (let p = 0; p + 1 < u.nt; p++) {
        let diff = 0;
        const a = p * planeSize;
        const b = (p + 1) * planeSize;
        for (let i = 0; i < planeSize; i++) diff += Math.abs(u.data[a + i] - u.data[b + i]);
        expect(diff / planeSize, `u_${mm} plane${p} vs plane${p + 1}`).toBeGreaterThan(0.1);
      }
      // SST stays a single climatology plane.
      expect(bin.layers.get(`sst_${mm}`)!.nt).toBe(1);
    }
  });
});

describe('November post-monsoon rescue (C6)', () => {
  // v1.1 fixed the "November fizzle": every shipped shr_10 plane sat 14-20 m/s in
  // the genesis belt, above SHEAR_THRESHOLD_MS, so seed%K could never land a
  // survivable November and 0 probe storms reached Cat-1. The remedy was
  // data-side (bake/era5.py calm-year selection). NOTHING in the committed suite
  // pinned it — a future bake (refreshed ERA5 cache, a belt-mask tweak) could
  // re-ship an all-hostile November and stay green. These are that guard.
  const env = loadBin('env.bin');
  const gen = JSON.parse(readFileSync(`${DATA_DIR}/genesis.json`, 'utf8')) as Array<{ lat: number; lon: number }>;
  const shr = env.layers.get('shr_10')!;

  /** Mean of a shr_10 plane sampled at the real genesis.json points (the belt). */
  function genesisBeltShear(plane: number): number {
    let sum = 0;
    for (const g of gen) sum += nearestPlane(shr, g.lat, g.lon, plane);
    return sum / gen.length;
  }

  it('at least one shr_10 plane is calm enough in the genesis belt to survive', () => {
    // The whole point of the rescue: min over planes of the genesis-belt mean
    // shear must sit BELOW the threshold where shear starts killing storms, so
    // seed%K can land a survivable regime. Before the rescue every plane was above
    // it. This is the direct data-level regression guard.
    let minBelt = Infinity;
    for (let p = 0; p < shr.nt; p++) minBelt = Math.min(minBelt, genesisBeltShear(p));
    expect(minBelt).toBeLessThan(SIM.SHEAR_THRESHOLD_MS);
  });

  it('the calm November plane actually yields Cat-1 storms (live spot check)', () => {
    // Find the calmest plane, then confirm the physics agrees with the field: a
    // fair share of genesis-seeded November storms on that plane intensify to
    // Cat-1 (>=64 kt). Guards against a calm-looking field that still can't spin
    // a storm up (the observable symptom the rescue was about).
    const terrain = loadBin('terrain.bin');
    const land = terrain.layers.get('landmask')!;
    const isLand = (lat: number, lon: number) => nearest(land, lat, lon) > 0.5;
    let calmPlane = 0;
    let calm = Infinity;
    for (let p = 0; p < shr.nt; p++) {
      const b = genesisBeltShear(p);
      if (b < calm) { calm = b; calmPlane = p; }
    }
    const sampler = makeEnvSampler(() => env);
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: calmPlane });
    let reachedCat1 = 0;
    for (const g of gen) {
      const engine = createSimEngine({ env: sampler, isLand });
      engine.spawn({ lat: g.lat, lon: g.lon, monthIndex: 10, seed: 7, isDemo: false });
      let peak = 0;
      for (let i = 0; i < 4000; i++) {
        engine.tick(15);
        const s = engine.getState()!;
        peak = Math.max(peak, s.vKt);
        if (!s.alive) break;
      }
      if (peak >= 64) reachedCat1++;
    }
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
    // Observed ~29/71 on the shipped bin; assert a robust floor well clear of 0.
    expect(reachedCat1).toBeGreaterThanOrEqual(5);
  });
});

describe('flowacc.bin', () => {
  const bin = loadBin('flowacc.bin');
  it('has a non-negative flow-accumulation field and a basin field', () => {
    const acc = bin.layers.get('flowacc');
    const basin = bin.layers.get('basin');
    expect(acc).toBeDefined();
    expect(basin).toBeDefined();
    expect(allFinite(acc!.data)).toBe(true);
    expect(range(acc!.data).min).toBeGreaterThanOrEqual(0);
    expect(allFinite(basin!.data)).toBe(true);
  });
});

describe('genesis.json', () => {
  it('is an array of {lat,lon} all inside the domain', () => {
    const raw = readFileSync(`${DATA_DIR}/genesis.json`, 'utf8');
    const json = JSON.parse(raw) as Array<{ lat: number; lon: number }>;
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
    for (const p of json) {
      expect(typeof p.lat).toBe('number');
      expect(typeof p.lon).toBe('number');
      expect(inBBox(p.lat, p.lon, DOMAIN)).toBe(true);
    }
  });
});

describe('bake <-> sim seam (the real env.bin drives the physics)', () => {
  const env = loadBin('env.bin');
  const terrain = loadBin('terrain.bin');
  const land = terrain.layers.get('landmask')!;

  const sampler = makeEnvSampler(() => env);
  const isLand = (lat: number, lon: number): boolean => nearest(land, lat, lon) > 0.5;

  it('the sampler reads REAL baked SST, not the analytic fallback', () => {
    // June (monthIndex 5) must resolve to sst_05. Probe an exact raster-cell
    // center so the raw baked value is an independent oracle even though the
    // production sampler now interpolates between cells away from their centers.
    const sst = env.layers.get('sst_05')!;
    const probeCell = latLonToCell(sst, 15.5, 64);
    const col = clampInt(probeCell.col, 0, sst.nx - 1);
    const row = clampInt(probeCell.row, 0, sst.ny - 1);
    const probe = cellToLatLon(sst, col, row);
    const expected = sst.data[row * sst.nx + col];
    const got = sampler.sample(probe.lat, probe.lon, 5, 0).sstC;
    expect(got).toBeCloseTo(expected, 5);
    // The analytic fallback caps SST at 31C; the real warm pool exceeds it, so a
    // >31C reading anywhere proves we are on the bin path, not the fallback.
    let sawWarm = false;
    for (let lat = 15; lat <= 25 && !sawWarm; lat += 1) {
      for (let lon = 52; lon <= 68; lon += 1) {
        if (sampler.sample(lat, lon, 6, 0).sstC > 31.1) sawWarm = true;
      }
    }
    expect(sawWarm).toBe(true);
  });

  it('THE demo storm (ui.ts identity) lives long, gets strong, and lands on Oman', () => {
    // The ACTUAL ui.ts demo constants — editing them re-pins this test with it.
    const DEMO = { ...DEMO_GENESIS, monthIndex: DEMO_MONTH, seed: DEMO_SEED };
    sampler.setSamplingMode({
      kind: 'synoptic-plane',
      plane: DEMO.seed % synopticCount(env, DEMO.monthIndex),
    });
    const engine = createSimEngine({ env: sampler, isLand });
    engine.spawn({ ...DEMO, isDemo: true });

    let died = false;
    let sawLandfall = false;
    let ticks = 0;
    let maxV = 0;
    const MAX_TICKS = 4000; // ~41 sim-days; any real storm dies well before this
    for (; ticks < MAX_TICKS && !died; ticks++) {
      const events: SimEvent[] = engine.tick(15);
      const s = engine.getState();
      expect(s).not.toBeNull();
      expect(Number.isFinite(s!.lat)).toBe(true);
      expect(Number.isFinite(s!.lon)).toBe(true);
      expect(Number.isFinite(s!.vKt)).toBe(true);
      maxV = Math.max(maxV, s!.vKt);
      for (const e of events) {
        if (e.type === 'landfall') sawLandfall = true;
        if (e.type === 'died') died = true;
      }
    }
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
    expect(died).toBe(true);
    const s = engine.getState()!;
    expect(s.alive).toBe(false);
    // The demo is the first thing every visitor sees — pin its quality: a
    // multi-day major that actually CROSSES the coast (wadi payoff on screen)
    // and dies over the Omani landmass, not merely inside a sea-heavy box.
    expect(sawLandfall).toBe(true);
    expect(isLand(s.lat, s.lon)).toBe(true);
    expect((ticks * 15) / 60 / 24).toBeGreaterThan(4); // > 4 sim-days
    expect(maxV).toBeGreaterThan(90); // a major, not a fizzle
    expect(s.lon).toBeGreaterThan(52.5); // the Omani landmass box (not Makran/Iran)
    expect(s.lon).toBeLessThan(60.0);
    expect(s.lat).toBeGreaterThan(16.5);
    expect(s.lat).toBeLessThan(26.5);
  });

  it('is deterministic: same spawn+seed reproduces the identical track', () => {
    sampler.setSamplingMode({
      kind: 'synoptic-plane',
      plane: 12345 % synopticCount(env, 6),
    });
    const run = () => {
      const engine = createSimEngine({ env: sampler, isLand });
      engine.spawn({ lat: 17, lon: 61, monthIndex: 6, seed: 12345, isDemo: false });
      for (let i = 0; i < 200; i++) engine.tick(15);
      const s = engine.getState()!;
      return { lat: s.lat, lon: s.lon, vKt: s.vKt, n: s.trackPoints.length };
    };
    expect(run()).toEqual(run());
  });

  it('synoptic plane selection changes the environment a storm feels (D10)', () => {
    const k = synopticCount(env, 5);
    expect(k).toBeGreaterThanOrEqual(3);
    // The same point+month reads different steering under different planes for
    // at least one probe point (planes are distinct regimes).
    const probes: Array<[number, number]> = [[16, 60], [18, 64], [20, 66], [22, 62]];
    let differs = false;
    for (const [lat, lon] of probes) {
      sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
      const a = sampler.sample(lat, lon, 5, 0);
      sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 1 });
      const b = sampler.sample(lat, lon, 5, 0);
      if (Math.abs(a.steerU - b.steerU) > 0.05 || Math.abs(a.steerV - b.steerV) > 0.05) differs = true;
    }
    expect(differs).toBe(true);
    // And the selection is part of determinism: same index -> identical sample.
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 2 });
    const x = sampler.sample(17, 61, 5, 0);
    const y = sampler.sample(17, 61, 5, 0);
    expect(x).toEqual(y);
    sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
  });
});
