import { describe, expect, it } from 'vitest';
import {
  environmentPlaneInterpolation,
  hasTimedFlowRouting,
  normalizeLoggedFlowAccumulation,
} from '../src/render/textures';
import { DType } from '../src/types';
import type { BinLayer } from '../src/types';

function layer(name: string, data: number[]): BinLayer {
  return {
    name,
    dtype: DType.uint8,
    quantized: false,
    nx: data.length,
    ny: 1,
    nt: 1,
    bbox: { lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 },
    scale: 1,
    offset: 0,
    data: new Float32Array(data),
  };
}

describe('flow-accumulation texture contract', () => {
  it('linearly normalizes the already-log10 baked values exactly once', () => {
    expect(normalizeLoggedFlowAccumulation(0, 5)).toBe(0);
    expect(normalizeLoggedFlowAccumulation(2.5, 5)).toBe(0.5);
    expect(normalizeLoggedFlowAccumulation(5, 5)).toBe(1);
  });

  it('activates timed routing only for populated DIR and travel layers', () => {
    const directions = layer('flowdir', [0, 1, 4]);
    const travel = layer('travmin', [0, 30, 20]);
    const emptyDirections = layer('flowdir', [0, 0, 0]);
    const emptyTravel = layer('travmin', [0, 0, 0]);

    expect(hasTimedFlowRouting(directions, travel)).toBe(true);
    expect(hasTimedFlowRouting(emptyDirections, emptyTravel)).toBe(false);
    expect(hasTimedFlowRouting(directions, emptyTravel)).toBe(false);
    expect(hasTimedFlowRouting(null, travel)).toBe(false);
  });
});

describe('environment texture time contract', () => {
  it('brackets and blends event planes exactly like the physics sampler', () => {
    expect(
      environmentPlaneInterpolation(5, { kind: 'event-timeline' }, 0.375),
    ).toEqual({ current: 1, next: 2, blend: 0.5 });
    expect(
      environmentPlaneInterpolation(5, { kind: 'event-timeline' }, 1),
    ).toEqual({ current: 4, next: 4, blend: 0 });
  });

  it('freezes a selected synoptic plane', () => {
    expect(
      environmentPlaneInterpolation(
        4,
        { kind: 'synoptic-plane', plane: 2 },
        0.9,
      ),
    ).toEqual({ current: 2, next: 2, blend: 0 });
  });
});
