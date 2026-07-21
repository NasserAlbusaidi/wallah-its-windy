import { describe, expect, it } from 'vitest';
import {
  climatologicalRmwKm,
  deriveStormStructure,
  hollandWindSpeedKt,
  maxWindRadiusKm,
  windRadiusAtBearingKm,
  windRadiusFromQuadrantsKm,
} from '../src/structure';
import {
  DEFAULT_STRUCTURE_PARAMETERS,
  UNCALIBRATED_STRUCTURE_PARAMETERS,
} from '../src/structure';

describe('agency structure initialization', () => {
  it('uses exact-fix wind radii only for provided quadrants', () => {
    const structure = deriveStormStructure({
      vKt: 80,
      lat: 18,
      lon: 64,
      shearMs: 8,
      overLand: false,
      motionUms: 2,
      motionVms: 1,
      initialR34Km: { ne: 210, sw: 125 },
      initialR50Km: { ne: 95 },
    });

    expect(structure.r34Km.ne).toBe(210);
    expect(structure.r34Km.sw).toBe(125);
    expect(structure.r50Km.ne).toBe(95);
    expect(structure.r34Km.se).toBeGreaterThan(0);
    expect(structure.windRadiiSource).toBe('agency-observed');

    const next = deriveStormStructure({
      vKt: 80,
      lat: 18,
      lon: 64,
      shearMs: 8,
      overLand: false,
      motionUms: 2,
      motionVms: 1,
      previousRmwKm: structure.rmwKm,
      previousOuterSizeKm: structure.outerSizeKm,
      deltaHours: 1,
    });
    expect(next.windRadiiSource).toBe('model-derived');
    expect(next.r34Km.ne).not.toBe(210);
  });
});

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

  it('evolves outer size with independent, slower memory', () => {
    const initial = deriveStormStructure({
      vKt: 40,
      lat: 20,
      lon: 60,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    const next = deriveStormStructure({
      vKt: 110,
      lat: 20,
      lon: 60,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
      previousRmwKm: initial.rmwKm,
      previousOuterSizeKm: initial.outerSizeKm,
      deltaHours: 0.25,
    });
    const instantaneous = deriveStormStructure({
      vKt: 110,
      lat: 20,
      lon: 60,
      shearMs: 5,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });

    expect(next.outerSizeKm).toBeGreaterThan(initial.outerSizeKm);
    expect(next.outerSizeKm).toBeLessThan(instantaneous.outerSizeKm);
    const outerProgress =
      Math.abs(next.outerSizeKm - initial.outerSizeKm) /
      Math.abs(instantaneous.outerSizeKm - initial.outerSizeKm);
    const rmwProgress =
      Math.abs(next.rmwKm - initial.rmwKm) /
      Math.abs(instantaneous.rmwKm - initial.rmwKm);
    expect(outerProgress).toBeLessThan(rmwProgress);
  });

  it('changes gale-force size without perturbing R50/R64 or pressure', () => {
    const input = {
      vKt: 100,
      lat: 20,
      lon: 60,
      shearMs: 8,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    };
    const baseline = deriveStormStructure(
      input,
      UNCALIBRATED_STRUCTURE_PARAMETERS,
    );
    const outerCore = deriveStormStructure(input, DEFAULT_STRUCTURE_PARAMETERS);

    expect(maxWindRadiusKm(outerCore.r34Km)).not.toBeCloseTo(
      maxWindRadiusKm(baseline.r34Km),
      3,
    );
    expect(maxWindRadiusKm(outerCore.r50Km)).toBeCloseTo(
      maxWindRadiusKm(baseline.r50Km),
      6,
    );
    expect(maxWindRadiusKm(outerCore.r64Km)).toBeCloseTo(
      maxWindRadiusKm(baseline.r64Km),
      6,
    );
    expect(outerCore.centralPressureHpa).toBe(baseline.centralPressureHpa);
  });

  it('puts shear-driven outer winds and rainfall downshear-left', () => {
    const structure = deriveStormStructure({
      vKt: 90,
      lat: 20,
      lon: 60,
      shearMs: 20,
      shearUms: 20,
      shearVms: 0,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    // Eastward shear points downshear-left toward north in the NH.
    expect(structure.shearAsymmetryFraction).toBeGreaterThan(0);
    expect(structure.r34Km.ne).toBeGreaterThan(structure.r34Km.se);
    expect(structure.r34Km.nw).toBeGreaterThan(structure.r34Km.sw);
    expect(structure.rainOffsetEastKm).toBeCloseTo(0, 8);
    expect(structure.rainOffsetNorthKm).toBeGreaterThan(0);
    expect(hollandWindSpeedKt(structure.rmwKm, 0, structure)).toBeCloseTo(
      hollandWindSpeedKt(structure.rmwKm, 180, structure),
      8,
    );
  });

  it('keeps zero-vector shear structurally symmetric', () => {
    const structure = deriveStormStructure({
      vKt: 90,
      lat: 20,
      lon: 60,
      shearMs: 20,
      shearUms: 0,
      shearVms: 0,
      overLand: false,
      motionUms: 0,
      motionVms: 0,
    });
    expect(structure.shearAsymmetryFraction).toBe(0);
    expect(structure.rainOffsetEastKm).toBe(0);
    expect(structure.rainOffsetNorthKm).toBe(0);
    expect(structure.r34Km.ne).toBeCloseTo(structure.r34Km.sw, 8);
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
        structure.outerSizeKm,
        structure.outerWindScale,
        structure.outerBlendStartWindKt,
        structure.outerBlendFullWindKt,
        structure.hollandB,
        structure.translationAsymmetryKt,
        structure.shearAsymmetryFraction,
        Math.abs(structure.rainOffsetEastKm),
        Math.abs(structure.rainOffsetNorthKm),
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
