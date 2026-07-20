/**
 * env-sampler.ts — the EnvSampler the sim runs on (integration seam).
 *
 * The physics core (sim.ts) reads SST + deep-layer steering + shear through an
 * EnvSampler. This module builds one that prefers the baked env.bin and falls
 * back to a deterministic analytic Arabian-Sea climatology when the file is
 * absent (a 404 during load must not brick the demo). Both branches are pure
 * functions of (lat, lon, monthIndex) so the sim stays a pure function of
 * (spawn, month, seed); every output is finite (the sim guards on NaN).
 *
 * env.bin encodes the month in the layer NAME, not a timestep axis: bake writes
 * `sst_MM / u_MM / v_MM / shr_MM` where MM is the 0-indexed monthIndex, zero-
 * padded, for the season it bakes (bake/bake.py SEASON_MONTHS = [4..10] =
 * May..Nov). This is the ONE place the sim resolves those names — it must agree
 * with bake/bake.py and src/render/index.ts (envMonthNames). Off-season months
 * clamp to the nearest season month; the Arabian-Sea cyclone season is all that
 * is baked. tFrac interpolates along a layer's timestep axis (a no-op at the
 * v1.0 nt=1 climatology; live for v1.1 per-storm event files).
 *
 * SYNOPTIC SAMPLES (D10): a v1.0 climatology bake may instead carry nt=K
 * distinct real-year planes per u/v/shr layer (bake/era5.py). Those planes are
 * ALTERNATIVE regimes to pick per spawn (seed % K, set via setSynopticIndex),
 * NOT a time axis — so while an index is set, nearestCell reads that one plane
 * and ignores tFrac. Clearing the index (setSynopticIndex(-1)) restores tFrac
 * interpolation for v1.1 event files, whose nt IS time.
 */

import { DOMAIN, latLonToCell } from './grid';
import type { BinLayer, EnvSample, EnvSampler, ParsedBin } from './types';

/** Season layer suffix for a monthIndex, clamped to bake's [4..10] and padded. */
export function envMonthSuffix(monthIndex: number): string {
  const m = Math.min(10, Math.max(4, Math.round(monthIndex)));
  return String(m).padStart(2, '0');
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pickLayer(bin: ParsedBin, names: readonly string[]): BinLayer | null {
  for (const n of names) {
    const l = bin.layers.get(n);
    if (l) return l;
  }
  return null;
}

/**
 * Nearest-cell read of a layer. The latlon->cell conversion is grid.latLonToCell
 * (eng D1: ONE owner of coordinate math); row order is north->south per
 * BINARY-FORMATS.md and grid.ts. Plane semantics: a non-negative sampleIndex
 * selects one synoptic plane (D10 regime pick, tFrac ignored); a negative index
 * means nt is a TIME axis and tFrac linearly interpolates along it.
 */
function nearestCell(layer: BinLayer, lat: number, lon: number, tFrac: number, sampleIndex: number): number {
  const { nx, ny, nt, bbox, data } = layer;
  const cell = latLonToCell({ nx, ny, bbox }, lat, lon);
  const col = clamp(Math.round(cell.col), 0, nx - 1);
  const row = clamp(Math.round(cell.row), 0, ny - 1);
  if (sampleIndex >= 0) {
    const t = clamp(Math.floor(sampleIndex), 0, nt - 1);
    return data[(t * ny + row) * nx + col];
  }
  const tf = clamp(tFrac * (nt - 1), 0, nt - 1);
  const t0 = Math.floor(tf);
  const t1 = Math.min(nt - 1, t0 + 1);
  const w = tf - t0;
  const a = data[(t0 * ny + row) * nx + col];
  const b = data[(t1 * ny + row) * nx + col];
  return a + (b - a) * w;
}

/**
 * Read all four env fields for a month from the baked bin, or null if the
 * expected season layers are absent (caller then uses the analytic fallback).
 * Un-suffixed names are accepted as a courtesy for a future single-month bake.
 */
export function sampleEnvBin(
  bin: ParsedBin,
  lat: number,
  lon: number,
  monthIndex: number,
  tFrac: number,
  sampleIndex = -1,
): EnvSample | null {
  const mm = envMonthSuffix(monthIndex);
  const sst = pickLayer(bin, [`sst_${mm}`, 'sst']);
  const su = pickLayer(bin, [`u_${mm}`, 'u', 'steerU', 'steeru']);
  const sv = pickLayer(bin, [`v_${mm}`, 'v', 'steerV', 'steerv']);
  const sh = pickLayer(bin, [`shr_${mm}`, 'shear', 'shr']);
  if (!sst || !su || !sv || !sh) return null;
  return {
    // SST bakes nt=1, so the synoptic index degenerates to plane 0 there.
    sstC: nearestCell(sst, lat, lon, tFrac, sampleIndex),
    steerU: nearestCell(su, lat, lon, tFrac, sampleIndex),
    steerV: nearestCell(sv, lat, lon, tFrac, sampleIndex),
    shear: nearestCell(sh, lat, lon, tFrac, sampleIndex),
  };
}

/** How many synoptic sample planes the bake shipped (nt of a steering layer). */
export function synopticCount(bin: ParsedBin | null, monthIndex: number): number {
  if (!bin) return 1;
  const su = pickLayer(bin, [`u_${envMonthSuffix(monthIndex)}`, 'u']);
  return su ? Math.max(1, su.nt) : 1;
}

/** An EnvSampler whose synoptic plane can be re-pointed per spawn (seed % K). */
export interface SelectableEnvSampler extends EnvSampler {
  /** Select the plane storms read (>= 0), or -1 to restore tFrac time-interp. */
  setSynopticIndex(index: number): void;
  /** The currently selected plane (-1 = time-interp mode). */
  getSynopticIndex(): number;
}

/**
 * Build an {@link EnvSampler} that prefers baked env.bin (via the live `getBin`
 * holder so it starts working the instant the file lands) and falls back to a
 * coarse analytic Arabian-Sea climatology when it is absent. The fallback is a
 * deterministic function of (lat, lon, month) and every output is finite.
 * The synoptic index is spawn state: main sets it from the seed BEFORE
 * engine.spawn, so sim = f(spawn, month, seed) still holds exactly.
 */
export function makeEnvSampler(getBin: () => ParsedBin | null): SelectableEnvSampler {
  let synopticIndex = -1;
  return {
    setSynopticIndex(index: number): void {
      synopticIndex = Math.floor(index);
    },
    getSynopticIndex(): number {
      return synopticIndex;
    },
    sample(lat: number, lon: number, monthIndex: number, tFrac: number): EnvSample {
      const la = clamp(lat, DOMAIN.latMin, DOMAIN.latMax);
      const lo = clamp(lon, DOMAIN.lonMin, DOMAIN.lonMax);
      const bin = getBin();
      if (bin) {
        const sampled = sampleEnvBin(bin, la, lo, monthIndex, tFrac, synopticIndex);
        if (sampled) return sampled;
      }
      const phase = (monthIndex / 12) * Math.PI * 2;
      // SST: warm (single summer peak ~June) cooling northward; clamp to plausible.
      const sstC = clamp(27 + 2.5 * Math.cos((monthIndex - 5) * (Math.PI / 6)) - 0.25 * (la - 15), 22, 31);
      // Steering: gentle NW push toward the Omani coast, seasonally modulated.
      const steerU = -3 + 2 * Math.sin(phase) - 0.05 * (la - 20); // eastward (mostly westward)
      const steerV = 3 + 1.5 * Math.cos(phase) + 0.1 * (65 - lo); // northward
      // Shear: monsoon peak (~Aug) + higher at latitude → northern/late storms weaken.
      const shear = clamp(7 + 3 * Math.max(0, Math.cos((monthIndex - 7) * (Math.PI / 6))) + 0.3 * (la - 18), 4, 20);
      return { sstC, steerU, steerV, shear };
    },
  };
}
