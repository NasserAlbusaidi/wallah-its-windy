import { describe, expect, it } from 'vitest';
import {
  makeEnsembleMembers,
  perturbEnvironment,
  runEnsemble,
  runStorm,
  summarizeEnsemble,
} from '../src/ensemble';
import { createSimEngine } from '../src/sim';
import type { EnvSampler, SpawnParams } from '../src/types';

const favorable: EnvSampler = {
  sample: () => ({
    sstC: 29.5,
    steerU: -2,
    steerV: 1,
    shear: 8,
    shearU: 8,
    shearV: 0,
    midlevelRhPct: 75,
    ohcKjCm2: 70,
  }),
};

const spawn: SpawnParams = {
  lat: 18,
  lon: 64,
  monthIndex: 5,
  seed: 42,
  initialWindKt: 35,
  initialOrganization: 0.55,
  isDemo: false,
};

describe('deterministic analysis ensemble', () => {
  it('builds a stable baseline member and reproducible perturbations', () => {
    const first = makeEnsembleMembers(spawn, 8);
    const second = makeEnsembleMembers(spawn, 8);
    expect(first).toEqual(second);
    expect(first[0].spawn).toEqual(spawn);
    expect(first[0].environment).toEqual({
      sstDeltaC: 0,
      rhDeltaPct: 0,
      shearDeltaMs: 0,
      ohcScale: 1,
    });
    expect(first[1]).not.toEqual(first[0]);
  });

  it('perturbs all thermodynamic fields while preserving finite vectors', () => {
    const sample = perturbEnvironment(favorable, {
      sstDeltaC: 1,
      rhDeltaPct: -20,
      shearDeltaMs: 4,
      ohcScale: 0.5,
    }).sample(18, 64, 5, 0);
    expect(sample.sstC).toBe(30.5);
    expect(sample.midlevelRhPct).toBe(55);
    expect(sample.shear).toBe(12);
    expect(sample.shearU).toBe(12);
    expect(sample.ohcKjCm2).toBe(35);
  });

  it('summarizes deterministic probabilities and a bounded track-density grid', () => {
    const first = runEnsemble(favorable, () => false, spawn, 12);
    const second = runEnsemble(favorable, () => false, spawn, 12);
    expect(first).toEqual(second);
    expect(first.members).toHaveLength(12);
    expect(first.grid.probability).toHaveLength(80 * 48);
    expect(Math.max(...first.grid.probability)).toBeLessThanOrEqual(1);
    expect(first.peakKt.p10).toBeLessThanOrEqual(first.peakKt.median);
    expect(first.peakKt.median).toBeLessThanOrEqual(first.peakKt.p90);
  });

  it('rasterizes between sparse fixes so probability corridors have no holes', () => {
    const summary = summarizeEnsemble(
      [
        {
          member: 0,
          track: [
            { lat: 21, lon: 51, vKt: 40, ageH: 0 },
            { lat: 21, lon: 69, vKt: 40, ageH: 12 },
          ],
          peakKt: 40,
          durationH: 12,
          closestApproachKm: 500,
          landfall: false,
          landfallEvents: [],
          death: null,
        },
      ],
      20,
      12,
    );
    const populated = [...summary.grid.probability].filter(
      (probability) => probability > 0,
    );
    expect(populated.length).toBeGreaterThanOrEqual(17);
    expect(populated.every((probability) => probability === 1)).toBe(true);
  });

  it('lets calibration coefficients change intensity without changing the API', () => {
    const baseline = runStorm({
      env: favorable,
      isLand: () => false,
      spawn,
      maxHours: 36,
    });
    const faster = runStorm({
      env: favorable,
      isLand: () => false,
      spawn,
      maxHours: 36,
      intensityParameters: { intensifyKPerH: 0.11 },
    });
    expect(faster.peakKt).toBeGreaterThan(baseline.peakKt);
  });

  it('skips radius inversions without changing coupled storm dynamics', () => {
    const full = createSimEngine({
      env: favorable,
      isLand: () => false,
      structureDetail: 'full',
    });
    const fast = createSimEngine({
      env: favorable,
      isLand: () => false,
      structureDetail: 'dynamics',
    });
    full.spawn(spawn);
    fast.spawn(spawn);
    for (let tick = 0; tick < 240; tick += 1) {
      full.tick(15);
      fast.tick(15);
    }
    const a = full.getState()!;
    const b = fast.getState()!;
    expect(b.lat).toBe(a.lat);
    expect(b.lon).toBe(a.lon);
    expect(b.vKt).toBe(a.vKt);
    expect(b.organization).toBe(a.organization);
    expect(b.coldWakeC).toBe(a.coldWakeC);
    expect(b.structure.rmwKm).toBe(a.structure.rmwKm);
    expect(b.structure.outerSizeKm).toBe(a.structure.outerSizeKm);
    expect(Object.values(b.structure.r34Km)).toEqual([0, 0, 0, 0]);
  });
});
