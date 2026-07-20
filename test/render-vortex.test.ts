import { describe, expect, it } from 'vitest';
import { vortexWind, type VortexParams } from '../src/render/vortex';

const BASE: VortexParams = {
  cx: 0,
  cy: 0,
  rMax: 1,
  vMax: 1,
  hollandB: 1.4,
  motionX: 0,
  motionY: 0,
  asymmetryFraction: 0,
  outerScale: 1,
  outerBlendStartFraction: 0.48,
  outerBlendFullFraction: 0.36,
  shearX: 0,
  shearY: 0,
  shearAsymmetryFraction: 0,
  inflow: 0.35,
};

function speed(x: number, y: number, params: VortexParams): number {
  const wind = vortexWind(x, y, params);
  return Math.hypot(wind.wx, wind.wy);
}

describe('shared two-region render vortex', () => {
  it('preserves the inner core while stretching gale-force outer winds', () => {
    const expanded = { ...BASE, outerScale: 1.6 };
    expect(speed(1, 0, expanded)).toBeCloseTo(speed(1, 0, BASE), 8);
    expect(speed(6, 0, expanded)).toBeGreaterThan(speed(6, 0, BASE));
  });

  it('places shear asymmetry downshear-left only in the outer region', () => {
    const sheared = {
      ...BASE,
      shearX: 15,
      shearAsymmetryFraction: 0.2,
    };
    // Eastward shear: downshear-left is north in the Northern Hemisphere.
    expect(speed(0, 6, sheared)).toBeGreaterThan(speed(0, -6, sheared));
    expect(speed(0, 1, sheared)).toBeCloseTo(speed(0, -1, sheared), 8);
  });
});
