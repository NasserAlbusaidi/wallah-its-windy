import { describe, expect, it } from 'vitest';
import datasetJson from '../calibration/data/ibtracs-ni-jtwc-2019-2024.json';
import {
  calibrateStructureModel,
  evaluateStructureModel,
  liveParametersMatchCalibration,
  splitStructureStorms,
  type StructureObservation,
  type StructureValidationDataset,
} from '../src/structure-validation';
import { UNCALIBRATED_STRUCTURE_PARAMETERS } from '../src/structure';

const dataset = datasetJson as unknown as StructureValidationDataset;

function observation(
  overrides: Partial<StructureObservation> = {},
): StructureObservation {
  return {
    sid: '2021001N10080',
    season: 2021,
    name: 'TEST',
    subbasin: 'BB',
    iso: '2021-01-01T00:00:00Z',
    status: 'TY',
    lat: 15,
    lon: 80,
    windKt: 80,
    pressureHpa: 970,
    rmwKm: 35,
    r34Km: { ne: 150, se: 140, sw: 130, nw: 145 },
    r50Km: { ne: 90, se: 85, sw: 80, nw: 88 },
    r64Km: { ne: 60, se: 55, sw: 50, nw: 58 },
    distanceToLandKm: 500,
    overLand: false,
    motionUms: 2,
    motionVms: 3,
    deltaHours: 0,
    ...overrides,
  };
}

describe('pinned IBTrACS structure dataset', () => {
  it('pins one agency, six-hour fixes, and the reviewed source hash', () => {
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.source.agencyColumns).toBe('USA/JTWC');
    expect(dataset.source.sha256).toBe(
      '02f6af3b7e12ee76e88866995b4451b85867a2b7f20ed2666f8561024d671b62',
    );
    expect(dataset.counts).toMatchObject({
      storms: 39,
      fixes: 792,
      pressureFixes: 508,
      r34Fixes: 438,
      r50Fixes: 94,
      r64Fixes: 52,
    });
    expect(new Set(dataset.observations.map((fix) => fix.sid)).size).toBe(39);
    for (const fix of dataset.observations) {
      expect(new Date(fix.iso).getUTCHours() % 6).toBe(0);
      expect(['TD', 'TS', 'TY', 'ST']).toContain(fix.status);
      expect(Number.isFinite(fix.motionUms)).toBe(true);
      expect(Number.isFinite(fix.motionVms)).toBe(true);
    }
  });

  it('holds out complete storms and represents every season', () => {
    const split = splitStructureStorms(dataset.observations);
    expect(split.calibration).toHaveLength(28);
    expect(split.validation).toHaveLength(11);
    expect(
      split.calibration.filter((sid) => split.validation.includes(sid)),
    ).toEqual([]);

    const seasons = new Map<number, Set<string>>();
    for (const fix of dataset.observations) {
      const ids = seasons.get(fix.season) ?? new Set<string>();
      ids.add(fix.sid);
      seasons.set(fix.season, ids);
    }
    for (const ids of seasons.values()) {
      expect([...ids].some((sid) => split.validation.includes(sid))).toBe(true);
    }
  });
});

describe('structure validation protocol', () => {
  it('keeps pre-2022 R50/R64 out of quality-tier scoring', () => {
    const result = evaluateStructureModel(
      [observation()],
      UNCALIBRATED_STRUCTURE_PARAMETERS,
      'all',
    );
    expect(result.metrics.pressure.count).toBe(1);
    expect(result.metrics.r34.count).toBe(4);
    expect(result.metrics.r50.count).toBe(0);
    expect(result.metrics.r64.count).toBe(0);
  });

  it('reports RMW without allowing it to alter the fit objective', () => {
    const normal = evaluateStructureModel(
      [observation({ season: 2023 })],
      UNCALIBRATED_STRUCTURE_PARAMETERS,
      'all',
    );
    const extremeRmw = evaluateStructureModel(
      [observation({ season: 2023, rmwKm: 500 })],
      UNCALIBRATED_STRUCTURE_PARAMETERS,
      'all',
    );
    expect(extremeRmw.metrics.rmw.mae).toBeGreaterThan(normal.metrics.rmw.mae!);
    expect(extremeRmw.objective).toBe(normal.objective);
  });

  it(
    'accepts only the outer-size candidate that clears every held-out gate',
    () => {
      const result = calibrateStructureModel(dataset.observations);
      expect(result.evaluatedCandidates).toBeGreaterThan(350);
      expect(result.proposedCalibration.objective).toBeLessThan(
        result.baselineCalibration.objective,
      );
      expect(result.accepted).toBe(true);
      expect(result.validationImprovementFraction).toBeGreaterThanOrEqual(0.04);
      expect(result.proposedValidation.metrics.r34.mae).toBeLessThanOrEqual(
        result.baselineValidation.metrics.r34.mae! * 0.9,
      );
      expect(result.proposedValidation.metrics.pressure.mae).toBe(
        result.baselineValidation.metrics.pressure.mae,
      );
      expect(result.proposedValidation.metrics.r50.mae).toBe(
        result.baselineValidation.metrics.r50.mae,
      );
      expect(result.proposedValidation.metrics.r64.mae).toBe(
        result.baselineValidation.metrics.r64.mae,
      );
      expect(result.deployedParameters).toEqual(result.proposedParameters);
      expect(liveParametersMatchCalibration(result)).toBe(true);
    },
    60_000,
  );
});
