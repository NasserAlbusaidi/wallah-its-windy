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
 * `sst_MM / u_MM / v_MM / shr_MM / shu_MM / shv_MM`, where MM is the
 * 0-indexed monthIndex, zero-padded, for the season it bakes
 * (bake/bake.py SEASON_MONTHS = [4..10] =
 * May..Nov). This is the ONE place the sim resolves those names — it must agree
 * with bake/bake.py and src/render/index.ts (envMonthNames). Off-season months
 * clamp to the nearest season month; the Arabian-Sea cyclone season is all that
 * is baked. `tFrac` is inert for the frozen climatology plane and interpolates
 * the chronological axis in v1.1 per-storm event files.
 *
 * SYNOPTIC SAMPLES (D10): a v1.0 climatology bake may instead carry nt=K
 * distinct coherent real-year planes per steering/shear layer (bake/era5.py).
 * ALTERNATIVE regimes to pick per spawn (seed % K), NOT a time axis. The
 * explicit EnvSamplingMode discriminates those frozen planes from v1.1 event
 * files, whose nt IS chronological time.
 */

import { DOMAIN } from './grid';
import { sampleLayerBilinear } from './raster-sampler';
import type {
  BinLayer,
  EnvSample,
  EnvSampler,
  EnvSamplingMode,
  ParsedBin,
} from './types';

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
 * Bilinear spatial read of a layer. Synoptic mode selects one plane and ignores
 * tFrac; event mode treats nt as time and interpolates two spatial samples.
 */
function sampleLayer(
  layer: BinLayer,
  lat: number,
  lon: number,
  tFrac: number,
  mode: EnvSamplingMode,
): number {
  const { nt } = layer;
  if (mode.kind === 'synoptic-plane') {
    return sampleLayerBilinear(layer, mode.plane, lat, lon);
  }
  const tf = clamp(tFrac * (nt - 1), 0, nt - 1);
  const t0 = Math.floor(tf);
  const t1 = Math.min(nt - 1, t0 + 1);
  const w = tf - t0;
  const a = sampleLayerBilinear(layer, t0, lat, lon);
  const b = sampleLayerBilinear(layer, t1, lat, lon);
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
  mode: EnvSamplingMode,
): EnvSample | null {
  const mm = envMonthSuffix(monthIndex);
  const sst = pickLayer(bin, [`sst_${mm}`, 'sst']);
  const su = pickLayer(bin, [`u_${mm}`, 'u', 'steerU', 'steeru']);
  const sv = pickLayer(bin, [`v_${mm}`, 'v', 'steerV', 'steerv']);
  const sh = pickLayer(bin, [`shr_${mm}`, 'shear', 'shr']);
  const shU = pickLayer(bin, [`shu_${mm}`, 'shearU', 'shearu']);
  const shV = pickLayer(bin, [`shv_${mm}`, 'shearV', 'shearv']);
  if (!sst || !su || !sv || !sh || !shU || !shV) return null;
  return {
    // SST bakes nt=1, so either mode degenerates to its only plane.
    sstC: sampleLayer(sst, lat, lon, tFrac, mode),
    steerU: sampleLayer(su, lat, lon, tFrac, mode),
    steerV: sampleLayer(sv, lat, lon, tFrac, mode),
    shear: sampleLayer(sh, lat, lon, tFrac, mode),
    shearU: sampleLayer(shU, lat, lon, tFrac, mode),
    shearV: sampleLayer(shV, lat, lon, tFrac, mode),
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
  /** Explicitly select whether `nt` is a frozen synoptic plane or event time. */
  setSamplingMode(mode: EnvSamplingMode): void;
  /** The active interpretation of the environment layer's `nt` axis. */
  getSamplingMode(): EnvSamplingMode;
}

/**
 * Build an {@link EnvSampler} that prefers baked env.bin (via the live `getBin`
 * holder so it starts working the instant the file lands) and falls back to a
 * coarse analytic Arabian-Sea climatology when it is absent. The fallback is a
 * deterministic function of (lat, lon, month) and every output is finite.
 * The sampling mode is spawn state: main sets it from scenario + seed BEFORE
 * engine.spawn, so sim = f(spawn, month, seed[, env]) still holds exactly.
 */
export function makeEnvSampler(getBin: () => ParsedBin | null): SelectableEnvSampler {
  let samplingMode: EnvSamplingMode = { kind: 'synoptic-plane', plane: 0 };
  return {
    setSamplingMode(mode: EnvSamplingMode): void {
      samplingMode =
        mode.kind === 'synoptic-plane'
          ? { kind: 'synoptic-plane', plane: Math.max(0, Math.floor(mode.plane)) }
          : { kind: 'event-timeline' };
    },
    getSamplingMode(): EnvSamplingMode {
      return samplingMode;
    },
    sample(lat: number, lon: number, monthIndex: number, tFrac: number): EnvSample {
      const la = clamp(lat, DOMAIN.latMin, DOMAIN.latMax);
      const lo = clamp(lon, DOMAIN.lonMin, DOMAIN.lonMax);
      const bin = getBin();
      if (bin) {
        const sampled = sampleEnvBin(bin, la, lo, monthIndex, tFrac, samplingMode);
        if (sampled) return sampled;
      }
      const phase = (monthIndex / 12) * Math.PI * 2;
      // SST: warm (single summer peak ~June) cooling northward; clamp to plausible.
      const sstC = clamp(27 + 2.5 * Math.cos((monthIndex - 5) * (Math.PI / 6)) - 0.25 * (la - 15), 22, 31);
      // Steering: gentle NW push toward the Omani coast, seasonally modulated.
      const steerU = -3 + 2 * Math.sin(phase) - 0.05 * (la - 20); // eastward (mostly westward)
      const steerV = 3 + 1.5 * Math.cos(phase) + 0.1 * (65 - lo); // northward
      // Shear: monsoon peak (~Aug) + higher at latitude → northern/late storms
      // weaken. Scaled so the monsoon peak clearly exceeds sim.ts's
      // SHEAR_THRESHOLD_MS (14, calibrated for monthly-mean fields) — otherwise
      // the fallback could never kill a storm by shear and DeathReason.Shear
      // would be unreachable in degraded (env.bin-missing) mode.
      const shear = clamp(9 + 9 * Math.max(0, Math.cos((monthIndex - 7) * (Math.PI / 6))) + 0.5 * (la - 18), 5, 26);
      const shearAngle = (20 + 35 * Math.max(0, Math.cos((monthIndex - 7) * (Math.PI / 6)))) * Math.PI / 180;
      const shearU = shear * Math.cos(shearAngle);
      const shearV = shear * Math.sin(shearAngle);
      return { sstC, steerU, steerV, shear, shearU, shearV };
    },
  };
}
