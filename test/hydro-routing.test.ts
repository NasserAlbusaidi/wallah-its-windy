import { describe, expect, it } from 'vitest';
import {
  D8_DIRECTIONS,
  d8Offset,
  flowOffsetGlsl,
  HYDRO_ROUTE_CFL,
  routePulseStep,
} from '../src/hydro-routing';

function sum(values: Float32Array): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('HydroSHEDS D8 routing contract', () => {
  it('covers all eight official ESRI/HydroSHEDS direction codes', () => {
    expect(D8_DIRECTIONS.map(({ code }) => code)).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
    expect(d8Offset(1)).toEqual({ dx: 1, dy: 0 });
    expect(d8Offset(2)).toEqual({ dx: 1, dy: 1 });
    expect(d8Offset(64)).toEqual({ dx: 0, dy: -1 });
    expect(d8Offset(0)).toBeNull();
    expect(d8Offset(255)).toBeNull();
  });

  it('generates every GPU decoder branch from that canonical table', () => {
    const glsl = flowOffsetGlsl();
    for (const { code, dx, dy } of D8_DIRECTIONS) {
      expect(glsl).toContain(
        `if (code == ${code}) return vec2(${dx.toFixed(1)}, ${dy.toFixed(1)});`,
      );
    }
  });

  it('moves a pulse progressively downstream instead of wetting a basin at once', () => {
    const flowDir = new Uint8Array([1, 1, 1, 1, 0]);
    const travelMinutes = new Uint8Array([30, 30, 30, 30, 0]);
    let water: Float32Array<ArrayBufferLike> = new Float32Array([1, 0, 0, 0, 0]);

    water = routePulseStep({ width: 5, height: 1, water, flowDir, travelMinutes }, 0.25);
    expect(water[0]).toBeCloseTo(1 - HYDRO_ROUTE_CFL, 6);
    expect(water[1]).toBeCloseTo(HYDRO_ROUTE_CFL, 6);
    expect(water[2]).toBe(0);
    expect(water[3]).toBe(0);
    expect(water[4]).toBe(0);
    expect(sum(water)).toBeCloseTo(1, 6);

    water = routePulseStep({ width: 5, height: 1, water, flowDir, travelMinutes }, 0.25);
    expect(water[0]).toBeCloseTo(0.3025, 6);
    expect(water[1]).toBeCloseTo(0.495, 6);
    expect(water[2]).toBeCloseTo(0.2025, 6);
    expect(water[3]).toBe(0);
    expect(water[4]).toBe(0);
    expect(sum(water)).toBeCloseTo(1, 6);
  });

  it('routes diagonally and holds water at outlets and domain edges', () => {
    const diagonal = routePulseStep(
      {
        width: 3,
        height: 3,
        water: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0]),
        flowDir: new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0]),
        travelMinutes: new Uint8Array([60, 0, 0, 0, 0, 0, 0, 0, 0]),
      },
      0.25,
    );
    expect(diagonal[0]).toBeCloseTo(0.75, 6);
    expect(diagonal[4]).toBeCloseTo(0.25, 6);
    expect(sum(diagonal)).toBeCloseTo(1, 6);

    const edge = routePulseStep(
      {
        width: 2,
        height: 1,
        water: new Float32Array([0, 1]),
        flowDir: new Uint8Array([0, 1]),
        travelMinutes: new Uint8Array([0, 30]),
      },
      1,
    );
    expect(Array.from(edge)).toEqual([0, 1]);
  });

  it('rejects malformed grids and invalid simulated time', () => {
    const malformed = {
      width: 2,
      height: 1,
      water: new Float32Array([1]),
      flowDir: new Uint8Array([1, 0]),
      travelMinutes: new Uint8Array([30, 0]),
    };
    expect(() => routePulseStep(malformed, 0.25)).toThrow(/width × height/);

    const valid = {
      width: 1,
      height: 1,
      water: new Float32Array([1]),
      flowDir: new Uint8Array([0]),
      travelMinutes: new Uint8Array([0]),
    };
    expect(() => routePulseStep(valid, -1)).toThrow(/non-negative/);
  });
});
