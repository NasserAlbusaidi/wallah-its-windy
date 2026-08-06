/**
 * env-sky.test.ts — the R3 wave-2 environmental cloud deck (RGR-001).
 *
 * The register's loudest gap: every observed IR/VIS frame carries monsoon/ITCZ
 * decks, granulated cumulus fields and streamed veils across the whole basin,
 * strongly month-conditioned, while the sim rendered the storm alone on black.
 * These tests define the deck's contract on the CPU BT-proxy twin: coverage
 * follows the baked humidity plane, the moist sky is substantially IR-cloudy
 * while the dry sky stays nearly clear, the field granulates instead of
 * washing, ambient tops never cross the realism cold-top mask, and the storm
 * still owns its core.
 *
 * A dead frame (stormPresence 0) isolates the ambient deck: stormCloud is zero
 * everywhere, so btProxyC is the pure ambient + surface composition.
 */

import { describe, expect, it } from 'vitest';
import type { FlightFrame } from '../src/flight-recorder';
import { DType } from '../src/types';
import type { BinLayer, ParsedBin } from '../src/types';
import { DOMAIN } from '../src/grid';
import {
  REALISM_COLD_TOP_C,
  metricsForField,
} from '../src/realism-metrics';
import {
  RealismNoise,
  buildRealismField,
  midlevelRhUniform,
} from '../src/realism-proxy';
import type { RealismField, RealismFrameContext } from '../src/realism-proxy';
import {
  AMBIENT_TOP_CONGESTUS_COLD_C,
  AMBIENT_TOP_CUMULUS_WARM_C,
} from '../src/render/cloud-motion';
import { syntheticFrame } from './helpers/realism';

/**
 * Plane values, RH percent: a monsoon-moist and a post-monsoon-dry column.
 * Anchored to the baked planes' actual ocean distribution (dry months p50
 * ~13-24%, moist event pockets 55-84%), NOT literature sounding values —
 * see the AMBIENT_RH_DRIVE_* doc in src/render/cloud-motion.ts.
 */
const MOIST_RH_PCT = 60;
const DRY_RH_PCT = 22;
/**
 * IR-cloudy fraction bounds over eligible ocean (BT-proxy <= 0 C, the sealed
 * RGR-001 threshold). The sealed sim-side baseline is ~0 in every month; the
 * deck must lift the moist sky by an order of magnitude while the dry sky
 * stays nearly clear — the Kyarr session's month-conditioning evidence.
 */
const MIN_MOIST_CLOUDY_FRACTION = 0.12;
const MAX_MOIST_CLOUDY_FRACTION = 0.85;
const MAX_DRY_CLOUDY_FRACTION = 0.05;
/** The deck must granulate: BT structure, not a uniform wash. */
const MIN_MOIST_BT_STDDEV_C = 5;
/** Every ambient top stays this far warm of the -60 C cold-top mask. */
const AMBIENT_BT_FLOOR_C = -55;

function openOcean() {
  return {
    envBin: null,
    land01At: () => 0,
    noise: new RealismNoise(),
    debris: null,
  };
}

/**
 * Minimal flat env bin: one plane, every texel the same value, month 05 to
 * match contextFor's monthIndex 5 (envMonthSuffix clamps into season). These
 * pin the DECK's response to the plane value, not the sampler's arithmetic —
 * quantize-before-filter already has its own tests in realism-proxy.test.ts.
 */
function flatLayer(name: string, value: number): BinLayer {
  const nx = 2;
  const ny = 1;
  return {
    name,
    dtype: DType.float32,
    quantized: false,
    nx,
    ny,
    nt: 1,
    bbox: DOMAIN,
    scale: 1,
    offset: 0,
    data: new Float32Array([value, value]),
  };
}

function flatBin(rhPct: number, sstC: number): ParsedBin {
  const layers = [flatLayer('rh_05', rhPct), flatLayer('sst_05', sstC)];
  return { version: 1, layers: new Map(layers.map((l) => [l.name, l])) };
}

function contextFor(frame: FlightFrame): RealismFrameContext {
  return {
    frame,
    genesis: { lat: 16, lon: 64 },
    envShear: {
      u: frame.structure.shearUms,
      v: frame.structure.shearVms,
      magnitude: Math.hypot(
        frame.structure.shearUms,
        frame.structure.shearVms,
      ),
    },
    envSteer: { u: -2, v: 3 },
    midlevelRh01: midlevelRhUniform(frame, null),
    monthIndex: 5,
    displayTFrac: 0,
    samplingMode: { kind: 'synoptic-plane', plane: 0 },
  };
}

/** A dead frame renders no storm cloud, isolating the ambient deck. */
function skyOnlyField(rhPct: number): RealismField {
  const dead = syntheticFrame({ alive: false });
  return buildRealismField(contextFor(dead), {
    ...openOcean(),
    envBin: flatBin(rhPct, 28.5),
  });
}

function oceanCloudyFraction(field: RealismField): number {
  let ocean = 0;
  let cloudy = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    if (field.oceanMask[index] !== 1) continue;
    ocean++;
    if (field.btProxyC[index] <= 0) cloudy++;
  }
  if (ocean < 1000) throw new Error('open-ocean fixture is undersampled');
  return cloudy / ocean;
}

function oceanBtStdDevC(field: RealismField): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    if (field.oceanMask[index] !== 1) continue;
    sum += field.btProxyC[index];
    count++;
  }
  const mean = sum / count;
  let variance = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    if (field.oceanMask[index] !== 1) continue;
    variance += (field.btProxyC[index] - mean) ** 2;
  }
  return Math.sqrt(variance / count);
}

function meanAmbientCover(field: RealismField): number {
  let sum = 0;
  for (let index = 0; index < field.ambientCloud.length; index++) {
    sum += field.ambientCloud[index];
  }
  return sum / field.ambientCloud.length;
}

describe('environmental cloud deck (RGR-001)', () => {
  it('keeps the constant contract: congestus floor stays warm of the cold-top mask', () => {
    // The metric-hygiene bound the whole design leans on: if a future tune
    // pushes ambient congestus at or below -60 C, the environment starts
    // counting as storm canopy in RGR-003/006/013 and the wave is invalid.
    expect(AMBIENT_TOP_CONGESTUS_COLD_C).toBeGreaterThan(REALISM_COLD_TOP_C);
    expect(AMBIENT_TOP_CUMULUS_WARM_C).toBeLessThan(0);
  });

  it('fills a monsoon-moist sky with IR-visible cloud; the sealed sky was empty', () => {
    const fraction = oceanCloudyFraction(skyOnlyField(MOIST_RH_PCT));
    expect(fraction).toBeGreaterThan(MIN_MOIST_CLOUDY_FRACTION);
    // Never solid overcast either: the deck is patchy by construction.
    expect(fraction).toBeLessThan(MAX_MOIST_CLOUDY_FRACTION);
  });

  it('keeps a post-monsoon-dry sky nearly clear — coverage is month-conditioned', () => {
    expect(oceanCloudyFraction(skyOnlyField(DRY_RH_PCT))).toBeLessThan(
      MAX_DRY_CLOUDY_FRACTION,
    );
  });

  it('raises ambient cover monotonically with the humidity plane', () => {
    // Sweep points sit inside the (LO, HI) moisture window; above HI the
    // drive deliberately saturates, so points past it would compare equal.
    const covers = [20, 30, 40, 50].map((rhPct) =>
      meanAmbientCover(skyOnlyField(rhPct)),
    );
    for (let i = 1; i < covers.length; i++) {
      expect(covers[i]).toBeGreaterThan(covers[i - 1]);
    }
  });

  it('granulates the moist deck instead of rendering a uniform wash', () => {
    expect(oceanBtStdDevC(skyOnlyField(MOIST_RH_PCT))).toBeGreaterThan(
      MIN_MOIST_BT_STDDEV_C,
    );
  });

  it('never lets an ambient top cross the realism cold-top mask', () => {
    const field = skyOnlyField(MOIST_RH_PCT);
    let coldest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < field.btProxyC.length; index++) {
      coldest = Math.min(coldest, field.btProxyC[index]);
    }
    expect(coldest).toBeGreaterThan(AMBIENT_BT_FLOOR_C);
    expect(AMBIENT_BT_FLOOR_C).toBeGreaterThan(REALISM_COLD_TOP_C);
  });

  it('contributes zero cold-top area: the storm-size metrics cannot see the deck', () => {
    const dead = syntheticFrame({ alive: false });
    const ctx = contextFor(dead);
    const field = buildRealismField(ctx, {
      ...openOcean(),
      envBin: flatBin(MOIST_RH_PCT, 28.5),
    });
    expect(metricsForField(field, ctx).coldTop.areaKm2).toBe(0);
  });

  it('still lets the storm own its core: ambient is suppressed under the CDO', () => {
    const frame = syntheticFrame();
    const ctx = contextFor(frame);
    const field = buildRealismField(ctx, {
      ...openOcean(),
      envBin: flatBin(MOIST_RH_PCT, 28.5),
    });
    // At the storm centre centralOvercast is ~1, so the composite must be the
    // storm's own cloud, not storm + deck.
    const n = field.n;
    const i = Math.min(
      n - 1,
      Math.max(0, Math.round(((field.center.x + 1) / 2) * n - 0.5)),
    );
    const j = Math.min(
      n - 1,
      Math.max(0, Math.round(((1 - field.center.y) / 2) * n - 0.5)),
    );
    const index = j * n + i;
    expect(field.cloud[index]).toBeCloseTo(field.stormCloud[index], 6);
  });
});
