import { describe, expect, it } from 'vitest';
import { deriveStormStructure } from '../src/structure';
import {
  DEFAULT_UPPER_OCEAN_PARAMETERS,
  diagnoseMixedLayerLastIndex,
  dragCoefficient,
  homogenizeProfile,
  OCEAN_DEPTH_INTERFACES_M,
  oceanHeatContentKjCm2,
  profileFromSstAndOhc,
  relaxGradientRichardson,
  seawaterDensityKgM3,
  SparseUpperOcean,
  stormSurfaceWindMs,
  type OceanProfile,
  type OceanStormSnapshot,
} from '../src/upper-ocean';

const NO_LAND = () => false;

function storm(
  vKt = 110,
  lat = 20,
  lon = 60,
  motionUms = 0,
  motionVms = 4,
): OceanStormSnapshot {
  return {
    lat,
    lon,
    structure: deriveStormStructure({
      vKt,
      lat,
      lon,
      shearMs: 5,
      shearUms: 4,
      shearVms: 3,
      overLand: false,
      motionUms,
      motionVms,
    }),
  };
}

function configuredOcean(): SparseUpperOcean {
  const ocean = new SparseUpperOcean();
  ocean.reset(() => ({
    sstC: 29.5,
    ohcKjCm2: 65,
    initializationTier: 'climatological-subsurface',
    sourceValidTime: '2020-06-01T00:00:00Z',
  }));
  return ocean;
}

function forceAtTimestep(dtMin: number, hours = 12): ReturnType<SparseUpperOcean['sample']> {
  const ocean = configuredOcean();
  const state = storm();
  const steps = Math.round((hours * 60) / dtMin);
  for (let step = 1; step <= steps; step += 1) {
    ocean.forceSegment(state, state, dtMin / 60, (step * dtMin) / 60, NO_LAND);
  }
  return ocean.sample(20, 60.22, hours);
}

describe('upper-ocean fixed physics contract', () => {
  it('implements the locked Large-Pond drag law and high-wind cap', () => {
    expect(dragCoefficient(0)).toBe(1.2e-3);
    expect(dragCoefficient(11)).toBe(1.2e-3);
    expect(dragCoefficient(20)).toBeCloseTo(1.79e-3, 12);
    expect(dragCoefficient(25)).toBe(2.115e-3);
    expect(dragCoefficient(70)).toBe(2.115e-3);
  });

  it('uses the locked linear warm-ocean equation of state', () => {
    expect(seawaterDensityKgM3(27, 36)).toBe(1025);
    expect(seawaterDensityKgM3(26, 36)).toBeGreaterThan(1025);
    expect(seawaterDensityKgM3(27, 37)).toBeGreaterThan(1025);
  });

  it('constructs a stable profile that retains SST and target OHC', () => {
    const profile = profileFromSstAndOhc(29.2, 70);
    expect(profile.temperatureC[0]).toBe(29.2);
    expect(oceanHeatContentKjCm2(profile.temperatureC)).toBeCloseTo(70, 6);
    expect(diagnoseMixedLayerLastIndex(profile)).toBeGreaterThanOrEqual(1);
    for (let index = 1; index < profile.temperatureC.length; index += 1) {
      expect(profile.temperatureC[index]).toBeLessThanOrEqual(
        profile.temperatureC[index - 1] + 1e-12,
      );
      expect(
        seawaterDensityKgM3(profile.temperatureC[index], profile.salinityPsu[index]),
      ).toBeGreaterThanOrEqual(
        seawaterDensityKgM3(
          profile.temperatureC[index - 1],
          profile.salinityPsu[index - 1],
        ) - 1e-12,
      );
    }
  });

  it('rejects ocean tuning outside the three locked parameter ranges', () => {
    expect(() => new SparseUpperOcean({ bulkRichardsonCritical: 0.5 })).toThrow();
    expect(() => new SparseUpperOcean({ momentumDampingInertialPeriods: 0.8 })).toThrow();
    expect(() => new SparseUpperOcean({ momentumDampingInertialPeriods: 6 })).toThrow();
    expect(() => new SparseUpperOcean({ thermalRecoveryHours: 100 })).toThrow();
    expect(new SparseUpperOcean().parameters).toEqual(DEFAULT_UPPER_OCEAN_PARAMETERS);
  });
});

describe('upper-ocean conservation and retained state', () => {
  it('conserves heat, salt and both momentum components through homogenization', () => {
    const length = OCEAN_DEPTH_INTERFACES_M.length - 1;
    const temperatureC = Float64Array.from({ length }, (_, index) => 30 - index * 0.2);
    const salinityPsu = Float64Array.from({ length }, (_, index) => 35 + index * 0.02);
    const currentUms = Float64Array.from({ length }, (_, index) => index * 0.03);
    const currentVms = Float64Array.from({ length }, (_, index) => -index * 0.01);
    const thickness = Array.from({ length }, (_, index) =>
      OCEAN_DEPTH_INTERFACES_M[index + 1] - OCEAN_DEPTH_INTERFACES_M[index],
    );
    const ledgers = () => [temperatureC, salinityPsu, currentUms, currentVms].map(
      (values) => values.reduce((sum, value, index) => sum + value * thickness[index], 0),
    );
    const before = ledgers();
    homogenizeProfile(temperatureC, salinityPsu, currentUms, currentVms, 10);
    const after = ledgers();
    after.forEach((value, index) => expect(value).toBeCloseTo(before[index], 10));
  });

  it('conservatively relaxes transition-layer shear with the fixed gradient criterion', () => {
    const length = OCEAN_DEPTH_INTERFACES_M.length - 1;
    const temperatureC = Float64Array.from({ length }, (_, index) => 29 - index * 0.1);
    const salinityPsu = Float64Array.from({ length }, (_, index) => 36 + index * 0.01);
    const currentUms = new Float64Array(length);
    const currentVms = new Float64Array(length);
    currentUms[4] = 1.5;
    const thickness = Array.from({ length }, (_, index) =>
      OCEAN_DEPTH_INTERFACES_M[index + 1] - OCEAN_DEPTH_INTERFACES_M[index],
    );
    const ledgers = () => [temperatureC, salinityPsu, currentUms, currentVms].map(
      (values) => values.reduce((sum, value, index) => sum + value * thickness[index], 0),
    );
    const before = ledgers();
    expect(
      relaxGradientRichardson(
        temperatureC,
        salinityPsu,
        currentUms,
        currentVms,
      ),
    ).toBeGreaterThan(0);
    const after = ledgers();
    after.forEach((value, index) => expect(value).toBeCloseTo(before[index], 10));
    expect(currentUms[4]).toBeLessThan(1.5);
    expect(currentUms[3] + currentUms[5]).toBeGreaterThan(0);
  });

  it('does not cool an isothermal column through wind-driven mixing', () => {
    const length = OCEAN_DEPTH_INTERFACES_M.length - 1;
    const profile: OceanProfile = {
      temperatureC: new Float64Array(length).fill(29),
      salinityPsu: new Float64Array(length).fill(36),
    };
    const ocean = configuredOcean();
    ocean.createColumnForTesting(20, 60.22, profile);
    const state = storm();
    for (let step = 1; step <= 96; step += 1) {
      ocean.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
    }
    expect(ocean.sample(20, 60.22, 24).coolingC).toBeCloseTo(0, 10);
  });

  it('produces no mixing or momentum without surface wind', () => {
    const ocean = configuredOcean();
    const calm = storm(0);
    ocean.forceSegment(calm, calm, 6, 6, NO_LAND);
    const diagnostics = ocean.sample(20, 60.22, 6);
    expect(diagnostics.coolingC).toBe(0);
    expect(diagnostics.mixedLayerCurrentSpeedMs).toBe(0);
    expect(diagnostics.cumulativeMixingHeatJm2).toBe(0);
  });

  it('retains the modified column so a second pass cannot extract original heat twice', () => {
    const ocean = configuredOcean();
    const state = storm();
    for (let step = 1; step <= 48; step += 1) {
      ocean.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
    }
    const first = ocean.sample(20, 60.22, 12);
    for (let step = 49; step <= 96; step += 1) {
      ocean.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
    }
    const second = ocean.sample(20, 60.22, 24);
    expect(second.cumulativeMixingHeatJm2).toBeGreaterThanOrEqual(
      first.cumulativeMixingHeatJm2,
    );
    expect(
      second.cumulativeMixingHeatJm2 - first.cumulativeMixingHeatJm2,
    ).toBeLessThanOrEqual(first.cumulativeMixingHeatJm2 + 1e-6);
  });

  it('serializes identical integrations byte-for-byte', () => {
    const left = configuredOcean();
    const right = configuredOcean();
    const state = storm();
    for (let step = 1; step <= 12; step += 1) {
      left.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
      right.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
    }
    expect(left.serialize()).toBe(right.serialize());
  });
});

describe('upper-ocean coupled response', () => {
  it('derives the ocean wind from the same asymmetric Holland structure', () => {
    const state = storm(100, 20, 60, 0, 5);
    const right = stormSurfaceWindMs(state, 20, 60.25);
    const left = stormSurfaceWindMs(state, 20, 59.75);
    expect(right.speed).toBeGreaterThan(left.speed);
    expect(right.v).toBeGreaterThan(0);
    expect(left.v).toBeLessThan(0);
  });

  it('creates a Northern Hemisphere right-of-track cooling preference', () => {
    const ocean = configuredOcean();
    const state = storm(115, 20, 60, 0, 5);
    for (let step = 1; step <= 72; step += 1) {
      ocean.forceSegment(state, state, 0.25, step * 0.25, NO_LAND);
    }
    const right = ocean.sample(20, 60.25, 18);
    const left = ocean.sample(20, 59.75, 18);
    expect(right.coolingC).toBeGreaterThanOrEqual(left.coolingC);
    expect(right.windStressPa).toBeGreaterThan(left.windStressPa);
  });

  it('agrees within 5% at 5, 15 and 30 minute timesteps', () => {
    const results = [5, 15, 30].map((dt) => forceAtTimestep(dt));
    const reference = results[1];
    for (const result of results) {
      const coolingScale = Math.max(0.05, reference.coolingC);
      expect(Math.abs(result.coolingC - reference.coolingC) / coolingScale).toBeLessThan(0.05);
      expect(
        Math.abs(result.mixedLayerDepthM - reference.mixedLayerDepthM) /
          Math.max(5, reference.mixedLayerDepthM),
      ).toBeLessThan(0.05);
      expect(
        Math.abs(
          result.cumulativeMixingHeatJm2 - reference.cumulativeMixingHeatJm2,
        ) / Math.max(1, reference.cumulativeMixingHeatJm2),
      ).toBeLessThan(0.05);
    }
  });
});
