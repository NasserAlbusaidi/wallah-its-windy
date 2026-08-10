/**
 * texture-fit.test.ts — GPU texture-size fitting (nio-v1 Phase 1).
 *
 * The post-expansion terrain grid (2860 x 1670) exceeds the GLES 3.0 guaranteed
 * MAX_TEXTURE_SIZE of 2048, and the failure mode is silent black. texture-fit.ts
 * reduces a COPIED plane for display only. This file pins three things:
 *   1. the fit arithmetic;
 *   2. that every reducer is a byte-identical copy at f === 1, so a device that
 *      needs no reduction draws exactly what it draws today;
 *   3. the determinism guard — neither land predicate can observe the cap.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  binarize,
  boxReduce,
  fitFactor,
  majorityReduce,
  reducedDims,
  strideReduce,
} from '../src/render/texture-fit';
import { probeCaps } from '../src/render/gl-utils';
import { parseBin } from '../src/loader';
import { sampleLayerBilinear, sampleLayerNearest } from '../src/raster-sampler';
import type { ParsedBin } from '../src/types';

describe('fitFactor', () => {
  it('halves the post-expansion terrain grid on a 2048 floor device', () => {
    expect(fitFactor(2860, 1670, 2048)).toBe(2);
  });

  it('is 1 whenever the plane already fits', () => {
    expect(fitFactor(1040, 668, 2048)).toBe(1);
    expect(fitFactor(2048, 2048, 2048)).toBe(1);
    expect(fitFactor(1, 1, 2048)).toBe(1);
  });

  it('grows until BOTH axes fit', () => {
    expect(fitFactor(1040, 668, 512)).toBe(3); // ceil(1040/3) = 347 <= 512
    expect(fitFactor(8192, 100, 2048)).toBe(4);
  });

  it('reducedDims rounds up so no row or column is dropped', () => {
    expect(reducedDims(2860, 1670, 2)).toEqual({ nx: 1430, ny: 835 });
    expect(reducedDims(5, 3, 2)).toEqual({ nx: 3, ny: 2 });
    expect(reducedDims(5, 3, 1)).toEqual({ nx: 5, ny: 3 });
  });
});

describe('every reducer is a byte-identical copy at f === 1', () => {
  const nx = 4;
  const ny = 3;
  const binary = new Float32Array([0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1]);

  it('box, majority and stride all return the input unchanged', () => {
    for (const [name, out] of [
      ['box', boxReduce(binary, nx, ny, 1)],
      ['majority', majorityReduce(binary, nx, ny, 1)],
      ['stride', strideReduce(binary, nx, ny, 1)],
    ] as const) {
      expect(out.length, name).toBe(binary.length);
      expect(Array.from(out), name).toEqual(Array.from(binary));
      expect(out, name).not.toBe(binary); // a copy, never the caller's buffer
    }
  });

  it('box and stride are exact on continuous data at f === 1', () => {
    const continuous = new Float32Array([-12.5, 0, 3.25, 1e4, -1, 7, 0.5, 2, 9, 8, 7, 6]);
    expect(Array.from(boxReduce(continuous, nx, ny, 1))).toEqual(Array.from(continuous));
    expect(Array.from(strideReduce(continuous, nx, ny, 1))).toEqual(Array.from(continuous));
  });
});

describe('binarize-then-vote does not commute with vote-then-binarize', () => {
  const block = new Float32Array([0.4, 0.4, 0.4, 1.0]); // one 2x2 block

  it('the correct order keeps a lone land cell from swallowing the block', () => {
    const votes = majorityReduce(binarize(block, 0.5), 2, 2, 2);
    expect(Array.from(votes)).toEqual([0]);
  });

  it('the wrong order turns three sea cells into land', () => {
    const mean = boxReduce(block, 2, 2, 2);
    expect(mean[0]).toBeCloseTo(0.55, 6);
    expect(Array.from(binarize(mean, 0.5))).toEqual([1]);
  });

  it('majorityReduce refuses non-binary input rather than guessing', () => {
    expect(() => majorityReduce(block, 2, 2, 2)).toThrow(/binariz/i);
  });

  it('a 2-2 tie resolves to sea', () => {
    const tie = new Float32Array([1, 1, 0, 0]);
    expect(Array.from(majorityReduce(tie, 2, 2, 2))).toEqual([0]);
  });

  it('a partial edge block votes over the samples it has', () => {
    // 3x1 row, f = 2: block 0 = [1,1] -> 1; block 1 = [0] alone -> 0.
    expect(Array.from(majorityReduce(new Float32Array([1, 1, 0]), 3, 1, 2))).toEqual([1, 0]);
  });

  it('strideReduce keeps the top-left sample, never an average', () => {
    const ids = new Float32Array([7, 9, 9, 9, 3, 4, 4, 4, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(Array.from(strideReduce(ids, 4, 4, 2))).toEqual([7, 9, 1, 1]);
  });
});

describe('probeCaps reports the texture-size cap', () => {
  it('reads gl.MAX_TEXTURE_SIZE through getParameter', () => {
    const fake = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0),
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    const caps = probeCaps(fake);
    expect(caps.maxTextureSize).toBe(4096);
    expect(caps.colorBufferFloat).toBe(false);
  });

  it('falls back to the GLES 3.0 floor when the driver reports nothing usable', () => {
    const fake = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: () => null,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    expect(probeCaps(fake).maxTextureSize).toBe(2048);
  });

  it('falls back to the floor when a lost context reports 0, the realistic failure', () => {
    const fake = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: () => 0,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    expect(probeCaps(fake).maxTextureSize).toBe(2048);
  });
});

describe('determinism guard: no land predicate can observe the texture cap', () => {
  function loadBin(name: string): ParsedBin {
    const buf = readFileSync(`public/data/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return parseBin(ab);
  }

  /** 200 coastal cell CENTRES, deterministically strided. */
  function coastalCentres(
    nx: number,
    ny: number,
    data: Float32Array,
    bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number },
  ): Array<{ lat: number; lon: number }> {
    const dLon = (bbox.lonMax - bbox.lonMin) / nx;
    const dLat = (bbox.latMax - bbox.latMin) / ny;
    const coastal: Array<[number, number]> = [];
    for (let r = 1; r < ny - 1; r++) {
      for (let c = 1; c < nx - 1; c++) {
        const v = data[r * nx + c] > 0.5;
        if (
          (data[(r - 1) * nx + c] > 0.5) !== v ||
          (data[(r + 1) * nx + c] > 0.5) !== v ||
          (data[r * nx + c - 1] > 0.5) !== v ||
          (data[r * nx + c + 1] > 0.5) !== v
        ) {
          coastal.push([r, c]);
        }
      }
    }
    expect(coastal.length).toBeGreaterThan(1000);
    const step = Math.floor(coastal.length / 200);
    return Array.from({ length: 200 }, (_, i) => {
      const [r, c] = coastal[i * step];
      return { lon: bbox.lonMin + (c + 0.5) * dLon, lat: bbox.latMax - (r + 0.5) * dLat };
    });
  }

  it('ui.isLand and the worker predicate agree at 200 coastal points, cap or no cap', () => {
    const land = loadBin('terrain.bin').layers.get('landmask')!;
    const points = coastalCentres(land.nx, land.ny, land.data, land.bbox);

    // The two shipped predicates: ui.ts:1696-1705 (nearest) and
    // ensemble.worker.ts:74-75 (bilinear > 0.5). Measured 2026-08-10: they agree
    // at all 200 coastal CELL CENTRES (they do not agree off centre — sample centres).
    const uiSide = points.map((p) => sampleLayerNearest(land, 0, p.lat, p.lon) > 0.5);
    const workerSide = points.map((p) => sampleLayerBilinear(land, 0, p.lat, p.lon) > 0.5);
    expect(uiSide).toEqual(workerSide);

    // Snapshot the source plane before reducing it. Length staying put or the
    // predicates still agreeing would NOT catch an in-place write here: binarizing
    // at 0.5 preserves the > 0.5 predicate everywhere, so uiAfter/workerAfter are
    // blind to it. Only a full byte-for-byte compare proves no mutation.
    const beforeReduction = Float32Array.from(land.data);

    // Now stub a floor device that forces a real reduction — neither predicate
    // may notice, because neither reads the reduced plane. The fit arithmetic
    // itself is already pinned with bare literals in the `fitFactor` describe
    // block above; this only needs "a reduction genuinely happens" and must
    // stay true across the domain-expansion grid growth, so it asserts a
    // relation, not a value that changes with land.nx/land.ny.
    const f = fitFactor(land.nx, land.ny, 512);
    expect(f).toBeGreaterThan(1);
    const dims = reducedDims(land.nx, land.ny, f);
    const reduced = majorityReduce(binarize(land.data, 0.5), land.nx, land.ny, f);
    expect(reduced.length).toBe(dims.nx * dims.ny);

    const uiAfter = points.map((p) => sampleLayerNearest(land, 0, p.lat, p.lon) > 0.5);
    const workerAfter = points.map((p) => sampleLayerBilinear(land, 0, p.lat, p.lon) > 0.5);
    expect(uiAfter).toEqual(uiSide);
    expect(workerAfter).toEqual(workerSide);
    // The source plane was not mutated by the reduction: compare byte-for-byte.
    expect(land.data).toEqual(beforeReduction);
  });

  it('texture-fit is not reachable from either land predicate or the binary reader', () => {
    for (const file of [
      'src/loader.ts',
      'src/ensemble.worker.ts',
      'src/raster-sampler.ts',
      'src/ui.ts',
      'src/main.ts',
      'src/sim.ts',
      'src/ensemble.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/texture-fit/);
    }
    // And texture-fit itself never learns what a BinLayer is.
    const module = readFileSync('src/render/texture-fit.ts', 'utf8');
    expect(module).not.toMatch(/BinLayer/);
    expect(module).not.toMatch(/from '\.\.\/loader'/);
  });
});
