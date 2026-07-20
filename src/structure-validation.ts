/**
 * Offline North Indian Ocean structure validation and constrained calibration.
 *
 * This module is browser-neutral and imports the exact runtime structure model.
 * The CLI, regression tests, and report generator therefore cannot silently
 * drift to a separate copy of the Holland/RMW equations.
 */

import {
  DEFAULT_STRUCTURE_PARAMETERS,
  deriveStormStructure,
  type StructureParameters,
  UNCALIBRATED_STRUCTURE_PARAMETERS,
} from './structure.ts';
import type { WindRadiiKm } from './types';

export type ValidationMetric = 'pressure' | 'r34' | 'r50' | 'r64' | 'rmw';
export type ValidationPartition = 'calibration' | 'validation' | 'all';

export interface NullableWindRadiiKm {
  ne: number | null;
  se: number | null;
  sw: number | null;
  nw: number | null;
}

export interface StructureObservation {
  sid: string;
  season: number;
  name: string;
  subbasin: string;
  iso: string;
  status: string;
  lat: number;
  lon: number;
  windKt: number;
  pressureHpa: number | null;
  rmwKm: number | null;
  r34Km: NullableWindRadiiKm;
  r50Km: NullableWindRadiiKm;
  r64Km: NullableWindRadiiKm;
  distanceToLandKm: number | null;
  overLand: boolean;
  motionUms: number;
  motionVms: number;
  deltaHours: number;
}

export interface StructureValidationDataset {
  schemaVersion: number;
  source: {
    name: string;
    url: string;
    sha256: string;
    snapshotDate: string;
    basin: string;
    agencyColumns: string;
    sourceRows: number;
  };
  selection: {
    seasons: [number, number];
    intervalHours: number;
    trackType: string;
    statuses: string[];
    positionAndStructureAgency: string;
    r34QualityStartSeason: number;
    r50R64QualityStartSeason: number;
    rmwUse: string;
    pressureUse: string;
  };
  units: Record<string, string>;
  counts: Record<string, number>;
  observations: StructureObservation[];
}

export interface MetricSummary {
  count: number;
  bias: number | null;
  mae: number | null;
  rmse: number | null;
}

export type MetricSet = Record<ValidationMetric, MetricSummary>;

export interface EvaluationSlices {
  intensity: Record<string, MetricSet>;
  subbasin: Record<string, MetricSet>;
  lifecycle: Record<string, MetricSet>;
  quadrant: Record<string, MetricSet>;
}

export interface StructureEvaluation {
  partition: ValidationPartition;
  storms: number;
  fixes: number;
  metrics: MetricSet;
  objective: number;
  combinedRadiusMaeKm: number | null;
  slices: EvaluationSlices;
}

export interface StormSplit {
  calibration: string[];
  validation: string[];
}

export interface CalibrationSearchResult {
  baselineParameters: StructureParameters;
  proposedParameters: StructureParameters;
  deployedParameters: StructureParameters;
  baselineCalibration: StructureEvaluation;
  proposedCalibration: StructureEvaluation;
  baselineValidation: StructureEvaluation;
  proposedValidation: StructureEvaluation;
  deployedValidation: StructureEvaluation;
  evaluatedCandidates: number;
  accepted: boolean;
  reason: string;
  validationImprovementFraction: number;
}

interface MutableMetric {
  count: number;
  sumError: number;
  sumAbsoluteError: number;
  sumSquaredError: number;
}

interface MutableEvaluation {
  metrics: Record<ValidationMetric, MutableMetric>;
  intensity: Record<string, Record<ValidationMetric, MutableMetric>>;
  subbasin: Record<string, Record<ValidationMetric, MutableMetric>>;
  lifecycle: Record<string, Record<ValidationMetric, MutableMetric>>;
  quadrant: Record<string, Record<ValidationMetric, MutableMetric>>;
}

const QUADRANTS = ['ne', 'se', 'sw', 'nw'] as const;
const NEUTRAL_SHEAR_MS = 8;
const OBJECTIVE_SCALES: Record<Exclude<ValidationMetric, 'rmw'>, number> = {
  pressure: 15,
  r34: 100,
  r50: 75,
  r64: 50,
};

const SEARCH_AXES: ReadonlyArray<{
  key: keyof StructureParameters;
  values: readonly number[];
}> = [
  {
    key: 'outerSizeWeight',
    values: [0, 0.5, 0.75, 1],
  },
  {
    key: 'outerSizeBaseKm',
    values: [100, 120, 140, 160, 180],
  },
  {
    key: 'outerSizeWindSlopeKmPerKt',
    values: [0.5, 1, 1.5, 2, 2.5],
  },
  {
    key: 'outerSizeLatitudeSlopeKmPerDegree',
    values: [0, 2, 4],
  },
  {
    key: 'outerSizeRelaxationHours',
    values: [18, 30, 48, 72],
  },
  {
    key: 'outerSizeBayOffsetKm',
    values: [0, 20, 40, 60],
  },
  {
    key: 'outerSizeBayWindSlopeBonusKmPerKt',
    values: [0, 0.5, 1, 1.5],
  },
];

function emptyMutableMetric(): MutableMetric {
  return {
    count: 0,
    sumError: 0,
    sumAbsoluteError: 0,
    sumSquaredError: 0,
  };
}

function emptyMutableMetricSet(): Record<ValidationMetric, MutableMetric> {
  return {
    pressure: emptyMutableMetric(),
    r34: emptyMutableMetric(),
    r50: emptyMutableMetric(),
    r64: emptyMutableMetric(),
    rmw: emptyMutableMetric(),
  };
}

function emptyMutableEvaluation(): MutableEvaluation {
  return {
    metrics: emptyMutableMetricSet(),
    intensity: {},
    subbasin: {},
    lifecycle: {},
    quadrant: {},
  };
}

function metricSet(
  target: Record<string, Record<ValidationMetric, MutableMetric>>,
  key: string,
): Record<ValidationMetric, MutableMetric> {
  return (target[key] ??= emptyMutableMetricSet());
}

function addError(metric: MutableMetric, predicted: number, observed: number): void {
  if (!Number.isFinite(predicted) || !Number.isFinite(observed)) return;
  const error = predicted - observed;
  metric.count++;
  metric.sumError += error;
  metric.sumAbsoluteError += Math.abs(error);
  metric.sumSquaredError += error * error;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarize(metric: MutableMetric): MetricSummary {
  if (metric.count === 0) {
    return { count: 0, bias: null, mae: null, rmse: null };
  }
  return {
    count: metric.count,
    bias: rounded(metric.sumError / metric.count),
    mae: rounded(metric.sumAbsoluteError / metric.count),
    rmse: rounded(Math.sqrt(metric.sumSquaredError / metric.count)),
  };
}

function summarizeSet(
  metrics: Record<ValidationMetric, MutableMetric>,
): MetricSet {
  return {
    pressure: summarize(metrics.pressure),
    r34: summarize(metrics.r34),
    r50: summarize(metrics.r50),
    r64: summarize(metrics.r64),
    rmw: summarize(metrics.rmw),
  };
}

function summarizeSlices(
  slices: Record<string, Record<ValidationMetric, MutableMetric>>,
): Record<string, MetricSet> {
  return Object.fromEntries(
    Object.entries(slices)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, metrics]) => [key, summarizeSet(metrics)]),
  );
}

function objective(metrics: MetricSet): number {
  const values = (
    Object.entries(OBJECTIVE_SCALES) as Array<
      [Exclude<ValidationMetric, 'rmw'>, number]
    >
  )
    .map(([key, scale]) => {
      const mae = metrics[key].mae;
      return mae === null ? null : mae / scale;
    })
    .filter((value): value is number => value !== null);
  return values.length === 0
    ? Number.POSITIVE_INFINITY
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function combinedRadiusMae(metrics: MetricSet): number | null {
  let count = 0;
  let sum = 0;
  for (const key of ['r34', 'r50', 'r64'] as const) {
    const metric = metrics[key];
    if (metric.mae === null) continue;
    count += metric.count;
    sum += metric.mae * metric.count;
  }
  return count === 0 ? null : rounded(sum / count);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Hold out whole storms, stratified by season. No fix from a validation storm
 * may enter parameter selection.
 */
export function splitStructureStorms(
  observations: readonly StructureObservation[],
): StormSplit {
  const bySeason = new Map<number, Set<string>>();
  for (const observation of observations) {
    const ids = bySeason.get(observation.season) ?? new Set<string>();
    ids.add(observation.sid);
    bySeason.set(observation.season, ids);
  }

  const validation = new Set<string>();
  for (const [, ids] of [...bySeason.entries()].sort(([a], [b]) => a - b)) {
    const ordered = [...ids].sort((a, b) => {
      const difference =
        stableHash(`wallah-structure-v1:${a}`) -
        stableHash(`wallah-structure-v1:${b}`);
      return difference || a.localeCompare(b);
    });
    const holdoutCount = Math.max(1, Math.round(ordered.length * 0.25));
    for (const sid of ordered.slice(0, holdoutCount)) validation.add(sid);
  }

  const all = [...new Set(observations.map((observation) => observation.sid))];
  return {
    calibration: all.filter((sid) => !validation.has(sid)).sort(),
    validation: [...validation].sort(),
  };
}

function intensityBin(windKt: number): string {
  if (windKt < 64) return '34-63 kt';
  if (windKt < 96) return '64-95 kt';
  return '96+ kt';
}

function lifecycleBin(index: number, count: number): string {
  const fraction = count <= 1 ? 0 : index / (count - 1);
  if (fraction < 1 / 3) return 'early';
  if (fraction < 2 / 3) return 'middle';
  return 'late';
}

function addScalarObservation(
  mutable: MutableEvaluation,
  metric: ValidationMetric,
  predicted: number,
  observed: number,
  intensity: string,
  subbasin: string,
  lifecycle: string,
): void {
  addError(mutable.metrics[metric], predicted, observed);
  addError(metricSet(mutable.intensity, intensity)[metric], predicted, observed);
  addError(metricSet(mutable.subbasin, subbasin)[metric], predicted, observed);
  addError(metricSet(mutable.lifecycle, lifecycle)[metric], predicted, observed);
}

function addRadiiObservations(
  mutable: MutableEvaluation,
  metric: 'r34' | 'r50' | 'r64',
  predicted: WindRadiiKm,
  observed: NullableWindRadiiKm,
  intensity: string,
  subbasin: string,
  lifecycle: string,
): void {
  for (const quadrant of QUADRANTS) {
    const observedRadius = observed[quadrant];
    if (observedRadius === null) continue;
    addScalarObservation(
      mutable,
      metric,
      predicted[quadrant],
      observedRadius,
      intensity,
      subbasin,
      lifecycle,
    );
    addError(
      metricSet(mutable.quadrant, quadrant)[metric],
      predicted[quadrant],
      observedRadius,
    );
  }
}

function selectedStormIds(
  observations: readonly StructureObservation[],
  partition: ValidationPartition,
): Set<string> {
  const split = splitStructureStorms(observations);
  if (partition === 'all') {
    return new Set(observations.map((observation) => observation.sid));
  }
  return new Set(split[partition]);
}

/**
 * Score one parameter set against the pinned observations.
 *
 * Observed intensity, latitude, land distance, and centred track motion drive
 * the runtime model. Neutral 8 m/s shear is explicit because IBTrACS has no
 * environmental-shear field. RMW is reported but excluded from the objective.
 */
export function evaluateStructureModel(
  observations: readonly StructureObservation[],
  parameters: Readonly<StructureParameters>,
  partition: ValidationPartition,
): StructureEvaluation {
  const selected = selectedStormIds(observations, partition);
  const byStorm = new Map<string, StructureObservation[]>();
  for (const observation of observations) {
    if (!selected.has(observation.sid)) continue;
    const fixes = byStorm.get(observation.sid) ?? [];
    fixes.push(observation);
    byStorm.set(observation.sid, fixes);
  }

  const mutable = emptyMutableEvaluation();
  let fixesEvaluated = 0;
  for (const fixes of byStorm.values()) {
    fixes.sort((a, b) => a.iso.localeCompare(b.iso));
    let previousRmwKm: number | undefined;
    let previousOuterSizeKm: number | undefined;
    for (let index = 0; index < fixes.length; index++) {
      const observation = fixes[index];
      const structure = deriveStormStructure(
        {
          vKt: observation.windKt,
          lat: observation.lat,
          lon: observation.lon,
          shearMs: NEUTRAL_SHEAR_MS,
          overLand: observation.overLand,
          motionUms: observation.motionUms,
          motionVms: observation.motionVms,
          previousRmwKm,
          previousOuterSizeKm,
          deltaHours: observation.deltaHours,
        },
        parameters,
      );
      previousRmwKm = structure.rmwKm;
      previousOuterSizeKm = structure.outerSizeKm;
      fixesEvaluated++;

      if (observation.windKt < 34) continue;
      const intensity = intensityBin(observation.windKt);
      const lifecycle = lifecycleBin(index, fixes.length);
      if (observation.pressureHpa !== null) {
        addScalarObservation(
          mutable,
          'pressure',
          structure.centralPressureHpa,
          observation.pressureHpa,
          intensity,
          observation.subbasin,
          lifecycle,
        );
      }
      if (observation.rmwKm !== null) {
        addScalarObservation(
          mutable,
          'rmw',
          structure.rmwKm,
          observation.rmwKm,
          intensity,
          observation.subbasin,
          lifecycle,
        );
      }
      if (observation.season >= 2019) {
        addRadiiObservations(
          mutable,
          'r34',
          structure.r34Km,
          observation.r34Km,
          intensity,
          observation.subbasin,
          lifecycle,
        );
      }
      if (observation.season >= 2022 && observation.windKt >= 50) {
        addRadiiObservations(
          mutable,
          'r50',
          structure.r50Km,
          observation.r50Km,
          intensity,
          observation.subbasin,
          lifecycle,
        );
      }
      if (observation.season >= 2022 && observation.windKt >= 64) {
        addRadiiObservations(
          mutable,
          'r64',
          structure.r64Km,
          observation.r64Km,
          intensity,
          observation.subbasin,
          lifecycle,
        );
      }
    }
  }

  const metrics = summarizeSet(mutable.metrics);
  return {
    partition,
    storms: byStorm.size,
    fixes: fixesEvaluated,
    metrics,
    objective: objective(metrics),
    combinedRadiusMaeKm: combinedRadiusMae(metrics),
    slices: {
      intensity: summarizeSlices(mutable.intensity),
      subbasin: summarizeSlices(mutable.subbasin),
      lifecycle: summarizeSlices(mutable.lifecycle),
      quadrant: summarizeSlices(mutable.quadrant),
    },
  };
}

function parameterKey(parameters: Readonly<StructureParameters>): string {
  return SEARCH_AXES.map(({ key }) => `${key}:${parameters[key]}`).join('|');
}

function sameParameters(
  a: Readonly<StructureParameters>,
  b: Readonly<StructureParameters>,
): boolean {
  return (Object.keys(a) as Array<keyof StructureParameters>).every(
    (key) => a[key] === b[key],
  );
}

function validationGate(
  baseline: StructureEvaluation,
  proposed: StructureEvaluation,
): { accepted: boolean; reason: string; improvement: number } {
  const improvement =
    baseline.objective > 0
      ? (baseline.objective - proposed.objective) / baseline.objective
      : 0;
  const pressureOkay =
    proposed.metrics.pressure.mae !== null &&
    baseline.metrics.pressure.mae !== null &&
    proposed.metrics.pressure.mae <= baseline.metrics.pressure.mae * 1.02;
  const r34Improved =
    proposed.metrics.r34.mae !== null &&
    baseline.metrics.r34.mae !== null &&
    proposed.metrics.r34.mae <= baseline.metrics.r34.mae * 0.9;
  const innerThresholdsOkay = (['r50', 'r64'] as const).every((key) => {
    const proposedMae = proposed.metrics[key].mae;
    const baselineMae = baseline.metrics[key].mae;
    return (
      proposedMae !== null &&
      baselineMae !== null &&
      proposedMae <= baselineMae * 1.05
    );
  });
  const accepted =
    improvement >= 0.04 &&
    pressureOkay &&
    r34Improved &&
    innerThresholdsOkay;
  const reason = accepted
    ? 'accepted: held-out objective improved at least 4%, R34 MAE improved at least 10%, pressure stayed within 2%, and R50/R64 stayed within 5%'
    : 'rejected: candidate did not satisfy every held-out outer-size improvement and inner-core non-regression gate';
  return { accepted, reason, improvement: rounded(improvement) };
}

/**
 * Deterministic coordinate search using calibration storms only, followed by a
 * single held-out acceptance gate. RMW never contributes to parameter choice.
 */
export function calibrateStructureModel(
  observations: readonly StructureObservation[],
): CalibrationSearchResult {
  const baselineParameters = { ...UNCALIBRATED_STRUCTURE_PARAMETERS };
  const cache = new Map<string, StructureEvaluation>();
  let evaluatedCandidates = 0;
  const scoreCalibration = (
    parameters: Readonly<StructureParameters>,
  ): StructureEvaluation => {
    const key = parameterKey(parameters);
    const cached = cache.get(key);
    if (cached) return cached;
    const evaluation = evaluateStructureModel(
      observations,
      parameters,
      'calibration',
    );
    cache.set(key, evaluation);
    evaluatedCandidates++;
    return evaluation;
  };

  let proposedParameters = { ...baselineParameters };
  let proposedCalibration = scoreCalibration(proposedParameters);

  // The outer-size intercept, intensity slope, and Bay-of-Bengal adjustment
  // interact strongly. Seed the coordinate search with a small deterministic
  // joint grid so its result cannot depend on which coupled axis happens to be
  // visited first.
  for (const outerSizeBaseKm of [100, 120, 140, 160, 180]) {
    for (const outerSizeWindSlopeKmPerKt of [0.5, 1, 1.5, 2, 2.5]) {
      for (const outerSizeBayOffsetKm of [0, 20, 40, 60, 80]) {
        for (const outerSizeBayWindSlopeBonusKmPerKt of [0, 0.5, 1]) {
          const candidate = {
            ...baselineParameters,
            outerSizeWeight: 1,
            outerSizeBaseKm,
            outerSizeWindSlopeKmPerKt,
            outerSizeLatitudeSlopeKmPerDegree: 0,
            outerSizeBayOffsetKm,
            outerSizeBayWindSlopeBonusKmPerKt,
            outerSizeRelaxationHours: 18,
          };
          const evaluation = scoreCalibration(candidate);
          if (
            evaluation.objective <
            proposedCalibration.objective - 0.000001
          ) {
            proposedParameters = candidate;
            proposedCalibration = evaluation;
          }
        }
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const axis of SEARCH_AXES) {
      let axisBest = proposedParameters;
      let axisBestEvaluation = proposedCalibration;
      for (const value of axis.values) {
        const candidate = { ...proposedParameters, [axis.key]: value };
        const evaluation = scoreCalibration(candidate);
        if (evaluation.objective < axisBestEvaluation.objective - 0.000001) {
          axisBest = candidate;
          axisBestEvaluation = evaluation;
        }
      }
      if (!sameParameters(axisBest, proposedParameters)) changed = true;
      proposedParameters = axisBest;
      proposedCalibration = axisBestEvaluation;
    }
    if (!changed) break;
  }

  const baselineCalibration = scoreCalibration(baselineParameters);
  const baselineValidation = evaluateStructureModel(
    observations,
    baselineParameters,
    'validation',
  );
  const proposedValidation = evaluateStructureModel(
    observations,
    proposedParameters,
    'validation',
  );
  const gate = validationGate(baselineValidation, proposedValidation);
  const deployedParameters = gate.accepted
    ? proposedParameters
    : baselineParameters;
  const deployedValidation = gate.accepted
    ? proposedValidation
    : baselineValidation;

  return {
    baselineParameters,
    proposedParameters,
    deployedParameters,
    baselineCalibration,
    proposedCalibration,
    baselineValidation,
    proposedValidation,
    deployedValidation,
    evaluatedCandidates,
    accepted: gate.accepted,
    reason: gate.reason,
    validationImprovementFraction: gate.improvement,
  };
}

export function liveParametersMatchCalibration(
  result: CalibrationSearchResult,
): boolean {
  return sameParameters(DEFAULT_STRUCTURE_PARAMETERS, result.deployedParameters);
}
