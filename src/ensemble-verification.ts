/** Deterministic HF-4 probabilistic verification and cone calibration. */

import { greatCircleKm } from './grid';
import type { StormRun } from './ensemble';
import type { StormTrack } from './tracks';

export const PROBABILISTIC_LEADS_H = [12, 24, 48, 72] as const;
export const CONE_COVERAGE_LEVELS = [0.5, 0.67, 0.9] as const;
export const INTENSITY_THRESHOLDS_KT = [34, 64, 96] as const;

export interface ConeCalibrationLead {
  leadH: number;
  trainingCases: number;
  additiveRadiusKm: Record<string, number>;
}

export interface ConeCalibration {
  schemaVersion: 1;
  method: 'split-conformal-additive-radius';
  trainingPartition: 'development';
  leads: ConeCalibrationLead[];
}

export interface EnsembleLeadVerification {
  leadH: number;
  memberPositions: number;
  memberIntensities: number;
  centreLat: number;
  centreLon: number;
  observedLat: number;
  observedLon: number;
  observedWindKt: number | null;
  centreTrackErrorKm: number;
  deterministicTrackErrorKm: number | null;
  spreadKm: number;
  rawConeRadiusKm: Record<string, number>;
  calibratedConeRadiusKm: Record<string, number>;
  coneCovered: Record<string, boolean>;
  intensityCrpsKt: number | null;
  deterministicIntensityAbsErrorKt: number | null;
  intensityRank: number | null;
  intensityEvents: Array<{
    thresholdKt: number;
    probability: number;
    observed: boolean;
    brier: number;
  }>;
}

export interface EnsembleVerificationSummary {
  cases: number;
  leads: Array<{
    leadH: number;
    samples: number;
    meanTrackErrorKm: number | null;
    meanDeterministicTrackErrorKm: number | null;
    meanSpreadKm: number | null;
    spreadErrorCorrelation: number | null;
    meanIntensityCrpsKt: number | null;
    meanDeterministicIntensityAbsErrorKt: number | null;
    coneCoverage: Record<string, number | null>;
    intensityBrier: Record<string, number | null>;
    intensityBrierReference: Record<string, number | null>;
    intensityBrierSkill: Record<string, number | null>;
    intensityRankHistogram: number[];
  }>;
}

interface Value {
  lat: number;
  lon: number;
  windKt: number | null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function conformalQuantile(values: readonly number[], coverage: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((sorted.length + 1) * coverage) - 1;
  return sorted[clamp(rank, 0, sorted.length - 1)];
}

function interpolateRun(run: StormRun, ageH: number): Value | null {
  const points = run.track;
  if (points.length === 0) return null;
  if (ageH > points.at(-1)!.ageH) {
    return run.death && run.durationH <= ageH
      ? { ...points.at(-1)!, windKt: 0 }
      : null;
  }
  let lower = points[0];
  let upper = points.at(-1)!;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].ageH >= ageH) {
      lower = points[index - 1];
      upper = points[index];
      break;
    }
  }
  const fraction =
    upper.ageH === lower.ageH
      ? 0
      : clamp((ageH - lower.ageH) / (upper.ageH - lower.ageH), 0, 1);
  return {
    lat: lower.lat + (upper.lat - lower.lat) * fraction,
    lon: lower.lon + (upper.lon - lower.lon) * fraction,
    windKt: lower.vKt + (upper.vKt - lower.vKt) * fraction,
  };
}

function interpolateObserved(
  track: StormTrack,
  timeMs: number,
): Value | null {
  const points = track.points
    .map((point) => ({ point, time: Date.parse(point.iso) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time);
  if (points.length === 0 || timeMs < points[0].time || timeMs > points.at(-1)!.time) {
    return null;
  }
  let lower = points[0];
  let upper = points.at(-1)!;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].time >= timeMs) {
      lower = points[index - 1];
      upper = points[index];
      break;
    }
  }
  const fraction =
    upper.time === lower.time
      ? 0
      : clamp((timeMs - lower.time) / (upper.time - lower.time), 0, 1);
  const windKt =
    lower.point.windKt === null || upper.point.windKt === null
      ? fraction <= 0
        ? lower.point.windKt
        : fraction >= 1
          ? upper.point.windKt
          : null
      : lower.point.windKt +
        (upper.point.windKt - lower.point.windKt) * fraction;
  return {
    lat: lower.point.lat + (upper.point.lat - lower.point.lat) * fraction,
    lon: lower.point.lon + (upper.point.lon - lower.point.lon) * fraction,
    windKt,
  };
}

/** Fair continuous ranked probability score for a finite scalar ensemble. */
export function ensembleCrps(
  members: readonly number[],
  observation: number,
): number | null {
  if (members.length === 0 || !Number.isFinite(observation)) return null;
  const first =
    members.reduce((sum, value) => sum + Math.abs(value - observation), 0) /
    members.length;
  let pairwise = 0;
  for (const a of members) for (const b of members) pairwise += Math.abs(a - b);
  return first - pairwise / (2 * members.length * members.length);
}

export function verifyEnsembleLeads(
  runs: readonly StormRun[],
  observedTrack: StormTrack,
  initializationIso: string,
  calibration?: ConeCalibration,
): EnsembleLeadVerification[] {
  const startMs = Date.parse(initializationIso);
  if (!Number.isFinite(startMs)) return [];
  const rows: EnsembleLeadVerification[] = [];
  for (const leadH of PROBABILISTIC_LEADS_H) {
    const observed = interpolateObserved(
      observedTrack,
      startMs + leadH * 3_600_000,
    );
    if (!observed) continue;
    const values = runs.map((run) => interpolateRun(run, leadH));
    const positions = values.filter((value): value is Value => value !== null);
    if (positions.length === 0) continue;
    const centreLat = positions.reduce((sum, value) => sum + value.lat, 0) / positions.length;
    const centreLon = positions.reduce((sum, value) => sum + value.lon, 0) / positions.length;
    const radial = positions.map((value) =>
      greatCircleKm({ lat: centreLat, lon: centreLon }, value),
    );
    const centreTrackErrorKm = greatCircleKm(
      { lat: centreLat, lon: centreLon },
      observed,
    );
    const deterministic = values[0];
    const rawConeRadiusKm: Record<string, number> = {};
    const calibratedConeRadiusKm: Record<string, number> = {};
    const coneCovered: Record<string, boolean> = {};
    const leadCalibration = calibration?.leads.find((item) => item.leadH === leadH);
    for (const coverage of CONE_COVERAGE_LEVELS) {
      const key = String(coverage);
      const raw = quantile(radial, coverage);
      const calibrated = Math.max(
        raw,
        raw + (leadCalibration?.additiveRadiusKm[key] ?? 0),
      );
      rawConeRadiusKm[key] = raw;
      calibratedConeRadiusKm[key] = calibrated;
      coneCovered[key] = centreTrackErrorKm <= calibrated;
    }
    const intensities = values.map((value) => value?.windKt ?? 0);
    const validIntensities = intensities.filter((value): value is number => value !== null);
    const observedWind = observed.windKt;
    rows.push({
      leadH,
      memberPositions: positions.length,
      memberIntensities: validIntensities.length,
      centreLat,
      centreLon,
      observedLat: observed.lat,
      observedLon: observed.lon,
      observedWindKt: observedWind,
      centreTrackErrorKm,
      deterministicTrackErrorKm: deterministic
        ? greatCircleKm(deterministic, observed)
        : null,
      spreadKm: Math.sqrt(
        radial.reduce((sum, value) => sum + value * value, 0) / radial.length,
      ),
      rawConeRadiusKm,
      calibratedConeRadiusKm,
      coneCovered,
      intensityCrpsKt:
        observedWind === null
          ? null
          : ensembleCrps(validIntensities, observedWind),
      deterministicIntensityAbsErrorKt:
        observedWind === null || intensities[0] === null
          ? null
          : Math.abs(intensities[0] - observedWind),
      intensityRank:
        observedWind === null
          ? null
          : validIntensities.filter((value) => value < observedWind).length,
      intensityEvents:
        observedWind === null
          ? []
          : INTENSITY_THRESHOLDS_KT.map((thresholdKt) => {
              const probability =
                validIntensities.filter((value) => value >= thresholdKt).length /
                validIntensities.length;
              const eventObserved = observedWind >= thresholdKt;
              return {
                thresholdKt,
                probability,
                observed: eventObserved,
                brier: (probability - Number(eventObserved)) ** 2,
              };
            }),
    });
  }
  return rows;
}

/** Fit additive split-conformal radii on development cases only. */
export function calibrateCone(
  developmentCases: readonly (readonly EnsembleLeadVerification[])[],
): ConeCalibration {
  return {
    schemaVersion: 1,
    method: 'split-conformal-additive-radius',
    trainingPartition: 'development',
    leads: PROBABILISTIC_LEADS_H.map((leadH) => {
      const rows = developmentCases
        .map((rows) => rows.find((row) => row.leadH === leadH))
        .filter((row): row is EnsembleLeadVerification => row !== undefined);
      const additiveRadiusKm: Record<string, number> = {};
      for (const coverage of CONE_COVERAGE_LEVELS) {
        const key = String(coverage);
        const nonconformity = rows.map(
          (row) => row.centreTrackErrorKm - row.rawConeRadiusKm[key],
        );
        additiveRadiusKm[key] = Math.max(
          0,
          conformalQuantile(nonconformity, coverage),
        );
      }
      return { leadH, trainingCases: rows.length, additiveRadiusKm };
    }),
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function correlation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let covariance = 0;
  let vx = 0;
  let vy = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - mx;
    const dy = ys[index] - my;
    covariance += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx <= 0 || vy <= 0 ? null : covariance / Math.sqrt(vx * vy);
}

export function aggregateEnsembleVerification(
  cases: readonly (readonly EnsembleLeadVerification[])[],
  developmentEventClimatology?: Record<string, number>,
): EnsembleVerificationSummary {
  return {
    cases: cases.length,
    leads: PROBABILISTIC_LEADS_H.map((leadH) => {
      const rows = cases
        .map((rows) => rows.find((row) => row.leadH === leadH))
        .filter((row): row is EnsembleLeadVerification => row !== undefined);
      const spreads = rows.map((row) => row.spreadKm);
      const errors = rows.map((row) => row.centreTrackErrorKm);
      const coneCoverage = Object.fromEntries(
        CONE_COVERAGE_LEVELS.map((coverage) => {
          const key = String(coverage);
          return [
            key,
            mean(rows.map((row) => Number(row.coneCovered[key]))),
          ];
        }),
      );
      const intensityBrier: Record<string, number | null> = {};
      const intensityBrierReference: Record<string, number | null> = {};
      const intensityBrierSkill: Record<string, number | null> = {};
      for (const threshold of INTENSITY_THRESHOLDS_KT) {
        const key = String(threshold);
        const events = rows
          .flatMap((row) => row.intensityEvents)
          .filter((event) => event.thresholdKt === threshold);
        const brier = mean(events.map((event) => event.brier));
        const climatology = developmentEventClimatology?.[`${leadH}:${threshold}`];
        const reference =
          climatology === undefined
            ? null
            : mean(
                events.map(
                  (event) => (climatology - Number(event.observed)) ** 2,
                ),
              );
        intensityBrier[key] = brier;
        intensityBrierReference[key] = reference;
        intensityBrierSkill[key] =
          brier === null || reference === null || reference <= 0
            ? null
            : 1 - brier / reference;
      }
      const rankCount = Math.max(
        0,
        ...rows.map((row) => row.memberIntensities + 1),
      );
      const intensityRankHistogram = new Array<number>(rankCount).fill(0);
      for (const row of rows) {
        if (row.intensityRank !== null) intensityRankHistogram[row.intensityRank]++;
      }
      return {
        leadH,
        samples: rows.length,
        meanTrackErrorKm: mean(errors),
        meanDeterministicTrackErrorKm: mean(
          rows
            .map((row) => row.deterministicTrackErrorKm)
            .filter((value): value is number => value !== null),
        ),
        meanSpreadKm: mean(spreads),
        spreadErrorCorrelation: correlation(spreads, errors),
        meanIntensityCrpsKt: mean(
          rows
            .map((row) => row.intensityCrpsKt)
            .filter((value): value is number => value !== null),
        ),
        meanDeterministicIntensityAbsErrorKt: mean(
          rows
            .map((row) => row.deterministicIntensityAbsErrorKt)
            .filter((value): value is number => value !== null),
        ),
        coneCoverage,
        intensityBrier,
        intensityBrierReference,
        intensityBrierSkill,
        intensityRankHistogram,
      };
    }),
  };
}
