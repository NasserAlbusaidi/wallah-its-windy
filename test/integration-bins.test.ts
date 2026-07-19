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
import { makeEnvSampler, envMonthSuffix } from '../src/env-sampler';
import { createSimEngine } from '../src/sim';
import { DOMAIN, inBBox, latLonToCell } from '../src/grid';
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
    // June (monthIndex 5) must resolve to sst_05 and match its nearest cell.
    const expected = nearest(env.layers.get('sst_05')!, 15.5, 64);
    const got = sampler.sample(15.5, 64, 5, 0).sstC;
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

  it('a demo storm lives a finite life on real data and terminates', () => {
    const engine = createSimEngine({ env: sampler, isLand });
    engine.spawn({ lat: 16.2, lon: 62.5, monthIndex: 5, seed: 0xc0c1a, isDemo: true });

    let died = false;
    const MAX_TICKS = 4000; // ~41 sim-days; any real storm dies well before this
    for (let i = 0; i < MAX_TICKS && !died; i++) {
      const events: SimEvent[] = engine.tick(15);
      const s = engine.getState();
      expect(s).not.toBeNull();
      expect(Number.isFinite(s!.lat)).toBe(true);
      expect(Number.isFinite(s!.lon)).toBe(true);
      expect(Number.isFinite(s!.vKt)).toBe(true);
      died = events.some((e) => e.type === 'died');
    }
    expect(died).toBe(true);
    expect(engine.getState()!.alive).toBe(false);
  });

  it('is deterministic: same spawn+seed reproduces the identical track', () => {
    const run = () => {
      const engine = createSimEngine({ env: sampler, isLand });
      engine.spawn({ lat: 17, lon: 61, monthIndex: 6, seed: 12345, isDemo: false });
      for (let i = 0; i < 200; i++) engine.tick(15);
      const s = engine.getState()!;
      return { lat: s.lat, lon: s.lon, vKt: s.vKt, n: s.trackPoints.length };
    };
    expect(run()).toEqual(run());
  });
});
