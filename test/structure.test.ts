import { describe, expect, it } from 'vitest';
import {
  climatologicalRmwKm,
  deriveStormStructure,
  hollandWindSpeedKt,
  maxWindRadiusKm,
  windRadiusAtBearingKm,
  windRadiusFromQuadrantsKm,
} from '../src/structure';

describe('climatological radius of maximum wind', () => {
  it('contracts with intensity and expands modestly with latitude', () => {
    expect(climatologicalRmwKm(100, 20)).toBeLessThan(
      climatologicalRmwKm(40, 20),
    );
    expect(climatologicalRmwKm(70, 26)).toBeGreaterThan(
      climatologicalRmwKm(70, 16),
    );
  });

  it('stays inside the documented visualization bounds', () => {
    for (const windKt of [0, 20, 30, 60, 100, 160, 220]) {
      for (const latitude of [0, 15, 22, 35, 60]) {
        const radius = climatologicalRmwKm(windKt, latitude);
        expect(radius).toBeGreaterThanOrEqual(12);
        expect(radius).toBeLessThanOrEqual(95);
      }
    }
  });
});

describe('Holland storm structure', () => {
  it('deepens central pressure and contracts the target eye as intensity rises', () => {
    const weak = deriveStormStructure({
      vKt: 35,
      lat: 20,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    const major = deriveStormStructure({
      vKt: 120,
      lat: 20,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });

    expect(major.centralPressureHpa).toBeLessThan(weak.centralPressureHpa);
    expect(major.rmwKm).toBeLessThan(weak.rmwKm);
    expect(major.hollandB).toBeGreaterThan(weak.hollandB);
  });

  it('relaxes RMW toward its target instead of changing instantaneously', () => {
    const initial = deriveStormStructure({
      vKt: 35,
      lat: 20,
      shearMs: 4,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    const target = climatologicalRmwKm(110, 20);
    const firstTick = deriveStormStructure({
      vKt: 110,
      lat: 20,
      shearMs: 4,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
      previousRmwKm: initial.rmwKm,
      deltaHours: 0.25,
    });

    expect(firstTick.rmwKm).toBeLessThan(initial.rmwKm);
    expect(firstTick.rmwKm).toBeGreaterThan(target);
  });

  it('peaks at RMW and decays both inward and outward', () => {
    const structure = deriveStormStructure({
      vKt: 100,
      lat: 20,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    const atPeak = hollandWindSpeedKt(
      structure.rmwKm,
      0,
      structure,
    );
    expect(atPeak).toBeCloseTo(100, 6);
    expect(hollandWindSpeedKt(structure.rmwKm * 0.3, 0, structure)).toBeLessThan(
      atPeak,
    );
    expect(hollandWindSpeedKt(structure.rmwKm * 4, 0, structure)).toBeLessThan(
      atPeak,
    );
  });

  it('produces nested 34, 50, and 64-knot outer wind radii', () => {
    const structure = deriveStormStructure({
      vKt: 110,
      lat: 20,
      shearMs: 6,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });

    for (const quadrant of ['ne', 'se', 'sw', 'nw'] as const) {
      expect(structure.r34Km[quadrant]).toBeGreaterThan(
        structure.r50Km[quadrant],
      );
      expect(structure.r50Km[quadrant]).toBeGreaterThan(
        structure.r64Km[quadrant],
      );
      expect(structure.r64Km[quadrant]).toBeGreaterThan(structure.rmwKm);
    }
    expect(maxWindRadiusKm(structure.r34Km)).toBeGreaterThan(100);
  });

  it('keeps unavailable threshold radii at zero', () => {
    const depression = deriveStormStructure({
      vKt: 30,
      lat: 20,
      shearMs: 4,
      overLand: false,
      motionUms: 2,
      motionVms: 1,
    });
    expect(maxWindRadiusKm(depression.r34Km)).toBe(0);
    expect(maxWindRadiusKm(depression.r50Km)).toBe(0);
    expect(maxWindRadiusKm(depression.r64Km)).toBe(0);
  });

  it('interpolates quadrant radii continuously across north', () => {
    const radii = { ne: 120, se: 100, sw: 60, nw: 80 };
    expect(windRadiusFromQuadrantsKm(radii, 45)).toBe(120);
    expect(windRadiusFromQuadrantsKm(radii, 315)).toBe(80);
    expect(windRadiusFromQuadrantsKm(radii, 0)).toBe(100);
    expect(windRadiusFromQuadrantsKm(radii, 360)).toBe(100);
  });

  it('expands the right-of-motion wind field without changing the reported maximum', () => {
    const northbound = deriveStormStructure({
      vKt: 90,
      lat: 20,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 8,
    });
    const east = windRadiusAtBearingKm(34, 90, northbound);
    const west = windRadiusAtBearingKm(34, 270, northbound);

    expect(northbound.translationAsymmetryKt).toBeGreaterThan(0);
    expect(east).toBeGreaterThan(west);
    expect(
      hollandWindSpeedKt(northbound.rmwKm, 90, northbound),
    ).toBeCloseTo(90, 6);
    expect(
      hollandWindSpeedKt(northbound.rmwKm, 270, northbound),
    ).toBeLessThan(90);
  });

  it('returns finite bounded structure across the supported lifecycle', () => {
    for (const vKt of [19, 30, 50, 80, 120, 170]) {
      const structure = deriveStormStructure({
        vKt,
        lat: 23,
        shearMs: 28,
        overLand: vKt < 30,
        motionUms: -7,
        motionVms: 4,
      });
      for (const value of [
        structure.centralPressureHpa,
        structure.rmwKm,
        structure.hollandB,
        structure.translationAsymmetryKt,
        ...Object.values(structure.r34Km),
        ...Object.values(structure.r50Km),
        ...Object.values(structure.r64Km),
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(structure.centralPressureHpa).toBeGreaterThanOrEqual(870);
      expect(structure.centralPressureHpa).toBeLessThanOrEqual(1010);
    }
  });
});
