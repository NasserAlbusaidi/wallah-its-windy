/**
 * integration-events.test.ts — the v1.1 event-artifact bake<->runtime drift guard.
 *
 * Sibling of integration-bins.test.ts, but for the event-mode artifacts
 * produced by the event bake (bake/sources.py + bake/era5_event.py): the real
 * public/data/tracks.json, scenarios.json, env_gonu.bin, env_shaheen.bin. Loads
 * each through the SAME production readers the app uses (parseBin, parseTracks,
 * parseScenarios) and asserts the cross-pipeline invariants the contracts pin:
 * ghost tracks are the right storms in time order; each scenario's windowH equals
 * (planes-1)*stepH of its bin; event bins carry a real time axis (nt>1) in
 * physical range; the vortex filter left steering distinct from climatology;
 * and the event thermodynamic fields share the same chronological axis.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBin } from '../src/loader';
import { parseTracks } from '../src/tracks';
import { eventSpawn, parseScenarios } from '../src/scenarios';
import { makeEnvSampler, envMonthSuffix } from '../src/env-sampler';
import { createSimEngine } from '../src/sim';
import { DOMAIN, latLonToCell } from '../src/grid';
import { FlightRecorder } from '../src/flight-recorder';
import { scoreHindcast } from '../src/hindcast';
import type { BinLayer, ParsedBin, SimEvent } from '../src/types';

const DATA_DIR = 'public/data';

function loadBin(name: string): ParsedBin {
  const buf = readFileSync(`${DATA_DIR}/${name}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return parseBin(ab);
}

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(`${DATA_DIR}/${name}`, 'utf8'));
}

function allFinite(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) return false;
  return true;
}

/** Mean of the first plane (nt=1 layers, or plane 0 of a time-axis layer). */
function planeMeanAbs(layer: BinLayer): number {
  const n = layer.nx * layer.ny;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(layer.data[i]);
  return s / n;
}

function planesDiffer(layer: BinLayer, a: number, b: number): boolean {
  const planeSize = layer.nx * layer.ny;
  const a0 = a * planeSize;
  const b0 = b * planeSize;
  let meanAbsDiff = 0;
  for (let i = 0; i < planeSize; i++) {
    meanAbsDiff += Math.abs(layer.data[a0 + i] - layer.data[b0 + i]);
  }
  return meanAbsDiff / planeSize > 0.001;
}

function maxAdjacentPlaneMeanDiff(layer: BinLayer): number {
  const planeSize = layer.nx * layer.ny;
  let maximum = 0;
  for (let plane = 1; plane < layer.nt; plane++) {
    let difference = 0;
    const previous = (plane - 1) * planeSize;
    const current = plane * planeSize;
    for (let i = 0; i < planeSize; i++) {
      difference += Math.abs(
        layer.data[current + i] - layer.data[previous + i],
      );
    }
    maximum = Math.max(maximum, difference / planeSize);
  }
  return maximum;
}

describe('tracks.json (ghost polylines)', () => {
  const tracks = parseTracks(loadJson('tracks.json'));

  it('parses through the production reader into a non-empty set', () => {
    expect(tracks).not.toBeNull();
    expect(tracks!.length).toBeGreaterThanOrEqual(2);
  });

  it('carries gonu2007 and shaheen2021 with the right names/years', () => {
    const byId = new Map(tracks!.map((t) => [t.id, t]));
    const gonu = byId.get('gonu2007');
    const shaheen = byId.get('shaheen2021');
    expect(gonu).toBeDefined();
    expect(shaheen).toBeDefined();
    expect(gonu!.name).toBe('gonu');
    expect(gonu!.year).toBe(2007);
    expect(shaheen!.name).toBe('shaheen');
    expect(shaheen!.year).toBe(2021);
  });

  it('has plausible fix counts and strictly time-ordered ISO timestamps', () => {
    for (const t of tracks!) {
      // A multi-day NI basin track is dozens of 3/6-hourly fixes, not a handful.
      expect(t.points.length, `${t.id} fix count`).toBeGreaterThanOrEqual(20);
      expect(t.points.length, `${t.id} fix count`).toBeLessThan(400);
      let prev = -Infinity;
      for (const p of t.points) {
        const ts = Date.parse(p.iso);
        expect(Number.isFinite(ts), `${t.id} iso ${p.iso}`).toBe(true);
        expect(ts, `${t.id} time order at ${p.iso}`).toBeGreaterThanOrEqual(prev);
        expect(Number.isFinite(p.lat) && Number.isFinite(p.lon)).toBe(true);
        prev = ts;
      }
    }
  });

  it('peak intensities match the historical record (Gonu major, Shaheen marginal)', () => {
    const byId = new Map(tracks!.map((t) => [t.id, t]));
    const peak = (id: string) =>
      Math.max(...byId.get(id)!.points.map((p) => p.windKt ?? -Infinity));
    // Gonu 2007 was a Cat-4/5 (peaked ~127-140 kt); Shaheen 2021 stayed marginal (~60 kt).
    expect(peak('gonu2007')).toBeGreaterThanOrEqual(110);
    expect(peak('shaheen2021')).toBeLessThanOrEqual(80);
    expect(peak('shaheen2021')).toBeGreaterThanOrEqual(45);
  });
});

describe('scenarios.json', () => {
  const scenarios = parseScenarios(loadJson('scenarios.json'));

  it('validates through the production reader with both events present', () => {
    expect(scenarios).not.toBeNull();
    const ids = new Set(scenarios!.map((s) => s.id));
    expect(ids.has('gonu')).toBe(true);
    expect(ids.has('shaheen')).toBe(true);
  });

  it('each scenario references a parseable bin whose nt matches windowH=(planes-1)*stepH', () => {
    for (const s of scenarios!) {
      // bin path is repo-relative under public/ (e.g. "data/env_gonu.bin").
      const bin = loadBin(s.bin.replace(/^data\//, ''));
      const mm = envMonthSuffix(s.monthIndex);
      const u = bin.layers.get(`u_${mm}`);
      expect(u, `${s.id} u_${mm}`).toBeDefined();
      // C3 invariant: windowH is computed from the bin's own plane count.
      expect(s.windowH, `${s.id} windowH`).toBe((u!.nt - 1) * s.stepH);
    }
  });

  it('ghostId matches a real storm id in tracks.json (active-ghost highlight seam)', () => {
    const trackIds = new Set(parseTracks(loadJson('tracks.json'))!.map((t) => t.id));
    for (const s of scenarios!) {
      expect(trackIds.has(s.ghostId), `${s.id} ghostId ${s.ghostId}`).toBe(true);
    }
  });

  it('spawn point lies inside the simulation domain', () => {
    for (const s of scenarios!) {
      expect(s.spawn.lat).toBeGreaterThanOrEqual(DOMAIN.latMin);
      expect(s.spawn.lat).toBeLessThanOrEqual(DOMAIN.latMax);
      expect(s.spawn.lon).toBeGreaterThanOrEqual(DOMAIN.lonMin);
      expect(s.spawn.lon).toBeLessThanOrEqual(DOMAIN.lonMax);
    }
  });

  it('ships an observed tropical-storm initialization for every scored hindcast', () => {
    for (const s of scenarios!) {
      expect(s.hindcast, `${s.id} hindcast metadata`).not.toBeNull();
      expect(s.hindcast!.initialWindKt).toBeGreaterThanOrEqual(34);
      expect(s.hindcast!.initialOrganization).toBeGreaterThanOrEqual(0);
      expect(s.hindcast!.initialOrganization).toBeLessThanOrEqual(1);
      expect(s.hindcast!.envOffsetH).toBeGreaterThanOrEqual(0);
      expect(Date.parse(s.hindcast!.startIso)).toBeGreaterThanOrEqual(
        Date.parse(s.startIso),
      );
    }
  });

  // The canonical spawn is the default replay on the picker's flagship path (no
  // user storm active). A spawn ON the domain-entry edge or hard against the coast
  // dies at ageH~0 ("drifted off the map" / instant landfall) — the exact DOA the
  // v1.1 review caught. Replay each scenario end-to-end through the SAME wiring
  // main.ts uses in event mode (explicit event-timeline sampling,
  // tFracHorizonH=windowH, the real terrain landmask) and assert a
  // non-trivial life: the headline storm must survive and intensify, not epitaph.
  it('each canonical counterfactual survives and intensifies without a hindcast peak target', () => {
    const terrain = loadBin('terrain.bin');
    const land = terrain.layers.get('landmask')!;
    const isLand = (lat: number, lon: number): boolean => {
      const { col, row } = latLonToCell({ nx: land.nx, ny: land.ny, bbox: land.bbox }, lat, lon);
      const c = Math.max(0, Math.min(land.nx - 1, Math.round(col)));
      const r = Math.max(0, Math.min(land.ny - 1, Math.round(row)));
      return land.data[r * land.nx + c] > 0.5;
    };
    for (const s of scenarios!) {
      const bin = loadBin(s.bin.replace(/^data\//, ''));
      const sampler = makeEnvSampler(() => bin);
      sampler.setSamplingMode({ kind: 'event-timeline' });
      const engine = createSimEngine({ env: sampler, isLand });
      engine.spawn({
        lat: s.spawn.lat,
        lon: s.spawn.lon,
        monthIndex: s.monthIndex,
        seed: s.spawn.seed,
        isDemo: false,
        tFracHorizonH: s.windowH,
      });
      let died = false;
      let peakKt = 0;
      let ticks = 0;
      const MAX_TICKS = 4000; // ~41 sim-days; any real storm dies well before this
      for (; ticks < MAX_TICKS && !died; ticks++) {
        const events: SimEvent[] = engine.tick(15);
        const st = engine.getState()!;
        peakKt = Math.max(peakKt, st.vKt);
        for (const e of events) if (e.type === 'died') died = true;
      }
      sampler.setSamplingMode({ kind: 'event-timeline' });
      const ageH = (ticks * 15) / 60;
      // A DOA spawn dies at ageH<=4 h with peak ~30 kt (spawn intensity, no
      // spin-up). Require a clearly non-trivial life instead: > 24 sim-hours and
      // a storm that strengthened past a strong tropical storm. This test is
      // explicitly the counterfactual path; the scored hindcast is pinned below.
      expect(ageH, `${s.id} canonical replay lifetime`).toBeGreaterThan(24);
      expect(peakKt, `${s.id} canonical replay peak`).toBeGreaterThanOrEqual(60);
    }
  });

  it('runs deterministic free hindcasts and scores them against observed fixes', () => {
    const terrain = loadBin('terrain.bin');
    const land = terrain.layers.get('landmask')!;
    const isLand = (lat: number, lon: number): boolean => {
      const { col, row } = latLonToCell(
        { nx: land.nx, ny: land.ny, bbox: land.bbox },
        lat,
        lon,
      );
      const c = Math.max(0, Math.min(land.nx - 1, Math.round(col)));
      const r = Math.max(0, Math.min(land.ny - 1, Math.round(row)));
      return land.data[r * land.nx + c] > 0.5;
    };
    const tracks = parseTracks(loadJson('tracks.json'))!;

    for (const scenario of scenarios!) {
      const bin = loadBin(scenario.bin.replace(/^data\//, ''));
      const runOnce = () => {
        const sampler = makeEnvSampler(() => bin);
        sampler.setSamplingMode({ kind: 'event-timeline' });
        const engine = createSimEngine({ env: sampler, isLand });
        const spawn = eventSpawn(scenario, null, 'hindcast');
        engine.spawn(spawn);
        const recorder = new FlightRecorder();
        recorder.start(
          {
            spawn,
            environmentId: scenario.id,
            monthIndex: scenario.monthIndex,
            seed: spawn.seed,
            isDemo: false,
            label: `${scenario.label} hindcast`,
            counterfactual: false,
            hindcast: true,
            hindcastStartIso: scenario.hindcast!.startIso,
          },
          engine.getState()!,
        );
        for (let tick = 0; tick < 4000; tick++) {
          const events = engine.tick(15);
          recorder.record(engine.getState()!, events);
          if (events.some((event) => event.type === 'died')) break;
        }
        return { spawn, snapshot: recorder.snapshot()! };
      };

      const first = runOnce();
      const second = runOnce();
      expect(first.spawn).toMatchObject({
        lat: scenario.hindcast!.lat,
        lon: scenario.hindcast!.lon,
        initialWindKt: scenario.hindcast!.initialWindKt,
        initialOrganization: scenario.hindcast!.initialOrganization,
        tFracOffsetH: scenario.hindcast!.envOffsetH,
        disableWander: true,
      });
      expect(first.snapshot.track).toEqual(second.snapshot.track);

      const observed = tracks.find((track) => track.id === scenario.ghostId)!;
      const score = scoreHindcast(
        first.snapshot.frames,
        observed,
        scenario.hindcast!.startIso,
      )!;
      expect(score.trackSamples, `${scenario.id} track samples`).toBeGreaterThan(5);
      expect(score.intensitySamples, `${scenario.id} intensity samples`).toBeGreaterThan(5);
      expect(score.trackMaeKm, `${scenario.id} track MAE`).not.toBeNull();
      expect(score.trackMaeKm!, `${scenario.id} track MAE`).toBeLessThan(100);
      expect(score.intensityMaeKt, `${scenario.id} intensity MAE`).not.toBeNull();
      expect(score.intensityMaeKt!, `${scenario.id} intensity MAE`).toBeLessThan(30);
      expect(Math.abs(score.peakBiasKt!), `${scenario.id} peak bias`).toBeLessThan(35);
    }
  });
});

describe('event env bins (byte-format-identical to env.bin, nt as a time axis)', () => {
  const clim = loadBin('env.bin');
  const cases = [
    { file: 'env_gonu.bin', monthIndex: 5 },
    { file: 'env_shaheen.bin', monthIndex: 8 },
  ] as const;

  for (const c of cases) {
    describe(c.file, () => {
      const bin = loadBin(c.file);
      const mm = envMonthSuffix(c.monthIndex);

      it('all eight fields carry one aligned, finite chronological axis', () => {
        const referenceNt = bin.layers.get(`u_${mm}`)!.nt;
        for (const field of ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc']) {
          const layer = bin.layers.get(`${field}_${mm}`);
          expect(layer, `${field}_${mm}`).toBeDefined();
          expect(layer!.nt, `${field}_${mm} nt`).toBeGreaterThan(1);
          expect(layer!.nt, `${field}_${mm} nt alignment`).toBe(referenceNt);
          expect(allFinite(layer!.data)).toBe(true);
        }
        // Steering components stay sane (< 60 m/s); shear non-negative, bounded.
        for (const field of ['u', 'v', 'shu', 'shv']) {
          const d = bin.layers.get(`${field}_${mm}`)!.data;
          for (let i = 0; i < d.length; i++) expect(Math.abs(d[i])).toBeLessThan(60);
        }
        const shr = bin.layers.get(`shr_${mm}`)!.data;
        for (let i = 0; i < shr.length; i++) {
          expect(shr[i]).toBeGreaterThanOrEqual(0);
          expect(shr[i]).toBeLessThan(120);
        }
        const sst = bin.layers.get(`sst_${mm}`)!.data;
        const rh = bin.layers.get(`rh_${mm}`)!.data;
        const ohc = bin.layers.get(`ohc_${mm}`)!.data;
        for (let i = 0; i < sst.length; i++) {
          expect(sst[i]).toBeGreaterThanOrEqual(15);
          expect(sst[i]).toBeLessThanOrEqual(35);
          expect(rh[i]).toBeGreaterThanOrEqual(0);
          expect(rh[i]).toBeLessThanOrEqual(100);
          expect(ohc[i]).toBeGreaterThanOrEqual(0);
          expect(ohc[i]).toBeLessThanOrEqual(300);
        }
      });

      it('time planes are genuinely distinct (adjacent |u| mean differs)', () => {
        const u = bin.layers.get(`u_${mm}`)!;
        const planeSize = u.nx * u.ny;
        let anyDiff = false;
        for (let p = 0; p + 1 < u.nt; p++) {
          let diff = 0;
          const a = p * planeSize;
          const b = (p + 1) * planeSize;
          for (let i = 0; i < planeSize; i++) diff += Math.abs(u.data[a + i] - u.data[b + i]);
          if (diff / planeSize > 0.1) anyDiff = true;
        }
        expect(anyDiff, `${c.file} has distinct time planes`).toBe(true);
      });

      it('steering differs from climatology (the event winds are not the mean field)', () => {
        // Vortex-filtered event steering should still depart from the 30-yr mean
        // regime for this month — proves the event bin carries real synoptic winds,
        // not a copy of env.bin's climatology planes.
        const climU = clim.layers.get(`u_${mm}`)!;
        const evU = bin.layers.get(`u_${mm}`)!;
        expect(Math.abs(planeMeanAbs(evU) - planeMeanAbs(climU))).toBeGreaterThan(0.01);
      });

      it('uses event-time ERA5 SST/RH rather than copied monthly climatology', () => {
        const climSst = clim.layers.get(`sst_${mm}`)!;
        const evSst = bin.layers.get(`sst_${mm}`)!;
        const evRh = bin.layers.get(`rh_${mm}`)!;
        expect(evSst.nt).toBeGreaterThan(1);
        expect(evRh.nt).toBe(evSst.nt);
        expect(planesDiffer(evSst, 0, evSst.nt - 1)).toBe(true);
        expect(planesDiffer(evRh, 0, evRh.nt - 1)).toBe(true);
        expect(Math.abs(planeMeanAbs(evSst) - planeMeanAbs(climSst))).toBeGreaterThan(0.001);
      });

      it('evolves monthly WOA23 OHC continuously without a calendar-boundary step', () => {
        const ohc = bin.layers.get(`ohc_${mm}`)!;
        expect(planesDiffer(ohc, 0, ohc.nt - 1)).toBe(true);
        // Three-hourly interpolation between monthly midpoints should move by a
        // small fraction of a kJ/cm² on average, never jump by a whole monthly
        // field at 00Z on day one.
        expect(maxAdjacentPlaneMeanDiff(ohc)).toBeLessThan(1);
      });
    });
  }
});
