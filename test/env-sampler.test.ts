import { describe, expect, it } from 'vitest';
import { sampleEnvBin } from '../src/env-sampler';
import { DType } from '../src/types';
import type { BinLayer, ParsedBin } from '../src/types';

const BBOX = { lonMin: 0, lonMax: 2, latMin: 0, latMax: 2 };

function layer(name: string, planes: readonly (readonly number[])[]): BinLayer {
  return {
    name,
    dtype: DType.float32,
    quantized: false,
    nx: 2,
    ny: 2,
    nt: planes.length,
    bbox: BBOX,
    scale: 1,
    offset: 0,
    data: new Float32Array(planes.flat()),
  };
}

function envBin(planes: readonly (readonly number[])[]): ParsedBin {
  const layers = new Map<string, BinLayer>();
  for (const field of ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc']) {
    const name = `${field}_04`;
    layers.set(name, layer(name, planes));
  }
  return { version: 1, layers };
}

describe('sampleEnvBin spatial interpolation', () => {
  it('bilinearly blends the four surrounding cells in a selected synoptic plane', () => {
    const bin = envBin([[0, 10, 20, 30]]);

    const sample = sampleEnvBin(
      bin,
      1,
      1,
      4,
      0,
      { kind: 'synoptic-plane', plane: 0 },
    );

    expect(sample).toEqual({
      sstC: 15,
      steerU: 15,
      steerV: 15,
      shear: 15,
      shearU: 15,
      shearV: 15,
      midlevelRhPct: 15,
      ohcKjCm2: 15,
    });
  });

  it('combines bilinear space sampling with time interpolation for event timelines', () => {
    const bin = envBin([
      [0, 10, 20, 30],
      [100, 110, 120, 130],
    ]);

    const sample = sampleEnvBin(
      bin,
      1,
      1,
      4,
      0.25,
      { kind: 'event-timeline' },
    );

    expect(sample).toEqual({
      sstC: 40,
      steerU: 40,
      steerV: 40,
      shear: 40,
      shearU: 40,
      shearV: 40,
      midlevelRhPct: 40,
      ohcKjCm2: 40,
    });
  });

  it('freezes a selected synoptic plane without interpreting nt as time', () => {
    const bin = envBin([
      [0, 10, 20, 30],
      [100, 110, 120, 130],
    ]);

    const sample = sampleEnvBin(
      bin,
      1,
      1,
      4,
      0,
      { kind: 'synoptic-plane', plane: 1 },
    );

    expect(sample?.steerU).toBe(115);
  });

  it('preserves exact cell-centre values and clamps queries to the raster edge', () => {
    const bin = envBin([[0, 10, 20, 30]]);

    const mode = { kind: 'synoptic-plane', plane: 0 } as const;
    expect(sampleEnvBin(bin, 1.5, 0.5, 4, 0, mode)?.sstC).toBe(0);
    expect(sampleEnvBin(bin, 1.5, 1.5, 4, 0, mode)?.sstC).toBe(10);
    expect(sampleEnvBin(bin, 0.5, 0.5, 4, 0, mode)?.sstC).toBe(20);
    expect(sampleEnvBin(bin, 0.5, 1.5, 4, 0, mode)?.sstC).toBe(30);
    expect(sampleEnvBin(bin, 3, -1, 4, 0, mode)?.sstC).toBe(0);
    expect(sampleEnvBin(bin, -1, 3, 4, 0, mode)?.sstC).toBe(30);
  });
});
