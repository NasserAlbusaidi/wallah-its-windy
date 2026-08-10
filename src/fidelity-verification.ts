/** Lead-time verification and deterministic storm-level uncertainty intervals. */

import type { FlightFrame } from './flight-recorder';
import { greatCircleKm, inBBox } from './grid';
import { SCORING_DOMAIN } from './scoring-domain';
import { mulberry32 } from './rng';
import type { StormTrack, TrackFix } from './tracks';

export const FIDELITY_LEAD_HOURS = [12, 24, 48, 72] as const;
export const FIDELITY_BOOTSTRAP_REPLICATES = 2_000;
export const PERSISTENCE_LOOKBACK_MAX_HOURS = 24;
export type FidelityLeadHour = (typeof FIDELITY_LEAD_HOURS)[number];

const KM_PER_DEGREE = 111.195;
const EARTH_RADIUS_KM = (KM_PER_DEGREE * 180) / Math.PI;

export interface ForecastError {
  trackKm: number;
  /** Signed displacement along observed motion: positive is too fast. */
  alongTrackKm: number;
  /** Signed displacement left of observed motion: positive is left. */
  crossTrackKm: number;
  intensityAbsKt: number | null;
  intensityBiasKt: number | null;
  pressureAbsHpa: number | null;
  pressureBiasHpa: number | null;
}

export interface LeadTimeVerification {
  leadH: FidelityLeadHour;
  observedIso: string;
  model: ForecastError;
  persistence: ForecastError;
  /** HF-3 climatology-and-persistence reference, when a dev-trained model exists. */
  cliper?: ForecastError;
}

export interface ClimatologyPersistenceLead {
  leadH: FidelityLeadHour;
  climatologyEastKm: number;
  climatologyNorthKm: number;
  persistenceWeight: number;
  trainingCases: number;
}

export interface ConfidenceInterval {
  low: number;
  high: number;
}

export interface ErrorAggregate {
  /** Track samples; every retained verification row has a position. */
  samples: number;
  intensitySamples: number;
  pressureSamples: number;
  trackMaeKm: number | null;
  trackMedianKm: number | null;
  alongTrackMaeKm: number | null;
  alongTrackBiasKm: number | null;
  crossTrackMaeKm: number | null;
  crossTrackBiasKm: number | null;
  intensityMaeKt: number | null;
  intensityBiasKt: number | null;
  pressureMaeHpa: number | null;
  pressureBiasHpa: number | null;
  trackMaeCi95: ConfidenceInterval | null;
  intensityMaeCi95: ConfidenceInterval | null;
  pressureMaeCi95: ConfidenceInterval | null;
}

export interface LeadTimeAggregate {
  leadH: FidelityLeadHour;
  model: ErrorAggregate;
  persistence: ErrorAggregate;
  climatologyPersistence?: ErrorAggregate;
  /** Fraction of storms for which the model has smaller absolute track error. */
  trackFrequencySuperior: number | null;
  /** Fraction of comparable storms with smaller absolute intensity error. */
  intensityFrequencySuperior: number | null;
  pressureFrequencySuperior: number | null;
  trackMaeSkillFraction: number | null;
  trackMaeSkillFractionAgainstCliper?: number | null;
  intensityMaeSkillFraction: number | null;
  pressureMaeSkillFraction: number | null;
  /** Paired model-minus-persistence error; negative is better. */
  trackDifferenceCi95: ConfidenceInterval | null;
  intensityDifferenceCi95: ConfidenceInterval | null;
  pressureDifferenceCi95: ConfidenceInterval | null;
}

interface PositionValue {
  lat: number;
  lon: number;
  windKt: number | null;
  pressureHpa: number | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolateNullable(
  a: number | null,
  b: number | null,
  fraction: number,
): number | null {
  // Preserve a valid value at an exact endpoint even when the adjacent agency
  // fix is missing that field. Only an in-between interpolation needs both.
  if (fraction <= 0) return a;
  if (fraction >= 1) return b;
  if (a === null || b === null) return null;
  return a + (b - a) * fraction;
}

function interpolateFrames(
  frames: readonly FlightFrame[],
  ageH: number,
): PositionValue | null {
  if (
    frames.length === 0 ||
    ageH < frames[0].ageH ||
    ageH > frames.at(-1)!.ageH
  ) {
    return null;
  }
  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (frames[mid].ageH <= ageH) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[Math.min(frames.length - 1, lo + 1)];
  const fraction =
    b.ageH <= a.ageH ? 0 : clamp01((ageH - a.ageH) / (b.ageH - a.ageH));
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lon: a.lon + (b.lon - a.lon) * fraction,
    windKt: a.vKt + (b.vKt - a.vKt) * fraction,
    pressureHpa:
      a.structure.centralPressureHpa +
      (b.structure.centralPressureHpa - a.structure.centralPressureHpa) *
        fraction,
  };
}

function timedTrack(track: StormTrack): Array<{ time: number; fix: TrackFix }> {
  return track.points
    .map((fix) => ({ time: Date.parse(fix.iso), fix }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time);
}

function interpolateTrack(
  points: readonly { time: number; fix: TrackFix }[],
  time: number,
): PositionValue | null {
  if (
    points.length === 0 ||
    time < points[0].time ||
    time > points.at(-1)!.time
  ) {
    return null;
  }
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[Math.min(points.length - 1, lo + 1)];
  const fraction =
    b.time <= a.time ? 0 : clamp01((time - a.time) / (b.time - a.time));
  return {
    lat: a.fix.lat + (b.fix.lat - a.fix.lat) * fraction,
    lon: a.fix.lon + (b.fix.lon - a.fix.lon) * fraction,
    windKt: interpolateNullable(a.fix.windKt, b.fix.windKt, fraction),
    pressureHpa: interpolateNullable(a.fix.presMb, b.fix.presMb, fraction),
  };
}

function localDeltaKm(
  from: Pick<PositionValue, 'lat' | 'lon'>,
  to: Pick<PositionValue, 'lat' | 'lon'>,
): { east: number; north: number } {
  const meanLatitudeRad = ((from.lat + to.lat) * Math.PI) / 360;
  return {
    east: (to.lon - from.lon) * KM_PER_DEGREE * Math.cos(meanLatitudeRad),
    north: (to.lat - from.lat) * KM_PER_DEGREE,
  };
}

function observedMotionUnit(
  points: readonly { time: number; fix: TrackFix }[],
  time: number,
  fallbackStart: PositionValue,
  observed: PositionValue,
): { east: number; north: number } {
  // Use the local tangent around the verifying time. At an exact fix this must
  // span its previous and next fixes, not collapse to the exact fix twice and
  // silently fall back to the whole start-to-lead chord.
  let before: (typeof points)[number] | null = null;
  let after: (typeof points)[number] | null = null;
  for (const point of points) {
    if (point.time < time) before = point;
    if (point.time > time) {
      after = point;
      break;
    }
  }
  let delta: { east: number; north: number };
  if (before && after) delta = localDeltaKm(before.fix, after.fix);
  else if (before) delta = localDeltaKm(before.fix, observed);
  else if (after) delta = localDeltaKm(observed, after.fix);
  else delta = localDeltaKm(fallbackStart, observed);
  let magnitude = Math.hypot(delta.east, delta.north);
  if (magnitude < 1e-6) {
    delta = localDeltaKm(fallbackStart, observed);
    magnitude = Math.hypot(delta.east, delta.north);
  }
  return magnitude < 1e-6
    ? { east: 1, north: 0 }
    : { east: delta.east / magnitude, north: delta.north / magnitude };
}

function scoreForecast(
  forecast: PositionValue,
  observed: PositionValue,
  motion: { east: number; north: number },
): ForecastError {
  const error = localDeltaKm(observed, forecast);
  const along = error.east * motion.east + error.north * motion.north;
  const cross = -error.east * motion.north + error.north * motion.east;
  const intensityBias =
    forecast.windKt === null || observed.windKt === null
      ? null
      : forecast.windKt - observed.windKt;
  const pressureBias =
    forecast.pressureHpa === null || observed.pressureHpa === null
      ? null
      : forecast.pressureHpa - observed.pressureHpa;
  return {
    trackKm: greatCircleKm(forecast, observed),
    alongTrackKm: along,
    crossTrackKm: cross,
    intensityAbsKt: intensityBias === null ? null : Math.abs(intensityBias),
    intensityBiasKt: intensityBias,
    pressureAbsHpa: pressureBias === null ? null : Math.abs(pressureBias),
    pressureBiasHpa: pressureBias,
  };
}

function persistenceMotion(
  points: readonly { time: number; fix: TrackFix }[],
  startMs: number,
  start: PositionValue,
): { speedKmH: number; bearingRad: number } {
  const prior = [...points].reverse().find(({ time }) => time < startMs);
  if (!prior) return { speedKmH: 0, bearingRad: 0 };
  const ageH = (startMs - prior.time) / 3_600_000;
  if (ageH <= 0 || ageH > PERSISTENCE_LOOKBACK_MAX_HOURS) {
    return { speedKmH: 0, bearingRad: 0 };
  }
  const lat1 = (prior.fix.lat * Math.PI) / 180;
  const lat2 = (start.lat * Math.PI) / 180;
  const deltaLon = ((start.lon - prior.fix.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return {
    speedKmH: greatCircleKm(prior.fix, start) / ageH,
    bearingRad: Math.atan2(y, x),
  };
}

function persistencePosition(
  start: PositionValue,
  motion: { speedKmH: number; bearingRad: number },
  leadH: number,
): PositionValue {
  const distanceKm = motion.speedKmH * leadH;
  const bearing = motion.bearingRad;
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const lat1 = (start.lat * Math.PI) / 180;
  const lon1 = (start.lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((((lon2 * 180) / Math.PI + 180) % 360) + 360) % 360 - 180,
    windKt: start.windKt,
    pressureHpa: start.pressureHpa,
  };
}

function localOffsetPosition(
  start: PositionValue,
  eastKm: number,
  northKm: number,
): PositionValue {
  const latitude = start.lat + northKm / KM_PER_DEGREE;
  const cosine = Math.max(0.2, Math.cos(((start.lat + latitude) * Math.PI) / 360));
  return {
    lat: latitude,
    lon: start.lon + eastKm / (KM_PER_DEGREE * cosine),
    windKt: start.windKt,
    pressureHpa: start.pressureHpa,
  };
}

/** Train a compact CLIPER-style displacement blend on development storms only. */
export function trainClimatologyPersistence(
  cases: readonly { track: StormTrack; startIso: string }[],
): ClimatologyPersistenceLead[] {
  return FIDELITY_LEAD_HOURS.map((leadH) => {
    const samples: Array<{
      observed: { east: number; north: number };
      persistence: { east: number; north: number };
    }> = [];
    for (const item of cases) {
      const startMs = Date.parse(item.startIso);
      const points = timedTrack(item.track);
      const start = interpolateTrack(points, startMs);
      const observed = interpolateTrack(points, startMs + leadH * 3_600_000);
      if (!start || !observed) continue;
      const motion = persistenceMotion(points, startMs, start);
      samples.push({
        observed: localDeltaKm(start, observed),
        persistence: localDeltaKm(
          start,
          persistencePosition(start, motion, leadH),
        ),
      });
    }
    if (samples.length === 0) {
      return {
        leadH,
        climatologyEastKm: 0,
        climatologyNorthKm: 0,
        persistenceWeight: 1,
        trainingCases: 0,
      };
    }
    const climatologyEastKm =
      samples.reduce((sum, sample) => sum + sample.observed.east, 0) /
      samples.length;
    const climatologyNorthKm =
      samples.reduce((sum, sample) => sum + sample.observed.north, 0) /
      samples.length;
    let numerator = 0;
    let denominator = 0;
    for (const sample of samples) {
      const px = sample.persistence.east - climatologyEastKm;
      const py = sample.persistence.north - climatologyNorthKm;
      const yx = sample.observed.east - climatologyEastKm;
      const yy = sample.observed.north - climatologyNorthKm;
      numerator += px * yx + py * yy;
      denominator += px * px + py * py;
    }
    return {
      leadH,
      climatologyEastKm,
      climatologyNorthKm,
      persistenceWeight:
        denominator <= 1e-9 ? 0 : clamp01(numerator / denominator),
      trainingCases: samples.length,
    };
  });
}

export function verifyLeadTimes(
  frames: readonly FlightFrame[],
  track: StormTrack,
  startIso: string,
  leads: readonly FidelityLeadHour[] = FIDELITY_LEAD_HOURS,
  cliperModel?: readonly ClimatologyPersistenceLead[],
): LeadTimeVerification[] {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs) || frames.length === 0) return [];
  const points = timedTrack(track);
  const startObserved = interpolateTrack(points, startMs);
  if (!startObserved) return [];
  const persistence = persistenceMotion(points, startMs, startObserved);
  const output: LeadTimeVerification[] = [];
  for (const leadH of leads) {
    const verifyingMs = startMs + leadH * 3_600_000;
    const observed = interpolateTrack(points, verifyingMs);
    const model = interpolateFrames(frames, leadH);
    // The sealed cohorts were truncated against the FROZEN scoring box, not
    // the live DOMAIN. Truncating against a wider box would admit fixes the
    // catalogues never contained and move every sealed lead-time score.
    const observedExited = points.some(
      ({ time, fix }) =>
        time > startMs &&
        time <= verifyingMs &&
        !inBBox(fix.lat, fix.lon, SCORING_DOMAIN),
    );
    if (
      !observed ||
      !model ||
      observedExited ||
      !inBBox(observed.lat, observed.lon, SCORING_DOMAIN)
    ) {
      continue;
    }
    const motion = observedMotionUnit(
      points,
      verifyingMs,
      startObserved,
      observed,
    );
    const cliper = cliperModel?.find((item) => item.leadH === leadH);
    const persistenceForecast = persistencePosition(startObserved, persistence, leadH);
    const persistenceDelta = localDeltaKm(startObserved, persistenceForecast);
    const cliperForecast = cliper
      ? localOffsetPosition(
          startObserved,
          cliper.climatologyEastKm * (1 - cliper.persistenceWeight) +
            persistenceDelta.east * cliper.persistenceWeight,
          cliper.climatologyNorthKm * (1 - cliper.persistenceWeight) +
            persistenceDelta.north * cliper.persistenceWeight,
        )
      : null;
    output.push({
      leadH,
      observedIso: new Date(verifyingMs).toISOString(),
      model: scoreForecast(model, observed, motion),
      persistence: scoreForecast(persistenceForecast, observed, motion),
      ...(cliperForecast
        ? { cliper: scoreForecast(cliperForecast, observed, motion) }
        : {}),
    });
  }
  return output;
}

function finite(values: readonly (number | null)[]): number[] {
  return values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function quantile(sorted: readonly number[], probability: number): number {
  const index = (sorted.length - 1) * probability;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export function bootstrapMeanInterval(
  values: readonly number[],
  seed = 0x46494445,
  replicates = FIDELITY_BOOTSTRAP_REPLICATES,
): ConfidenceInterval | null {
  if (values.length === 0 || replicates < 2) return null;
  const random = mulberry32(seed);
  const means = new Array<number>(replicates);
  for (let sample = 0; sample < replicates; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    means[sample] = sum / values.length;
  }
  means.sort((a, b) => a - b);
  return { low: quantile(means, 0.025), high: quantile(means, 0.975) };
}

function aggregateErrors(
  rows: readonly ForecastError[],
  seed: number,
): ErrorAggregate {
  const track = rows.map((row) => row.trackKm);
  const intensity = finite(rows.map((row) => row.intensityAbsKt));
  return {
    samples: rows.length,
    intensitySamples: intensity.length,
    pressureSamples: finite(rows.map((row) => row.pressureAbsHpa)).length,
    trackMaeKm: mean(track),
    trackMedianKm: median(track),
    alongTrackMaeKm: mean(rows.map((row) => Math.abs(row.alongTrackKm))),
    alongTrackBiasKm: mean(rows.map((row) => row.alongTrackKm)),
    crossTrackMaeKm: mean(rows.map((row) => Math.abs(row.crossTrackKm))),
    crossTrackBiasKm: mean(rows.map((row) => row.crossTrackKm)),
    intensityMaeKt: mean(intensity),
    intensityBiasKt: mean(finite(rows.map((row) => row.intensityBiasKt))),
    pressureMaeHpa: mean(finite(rows.map((row) => row.pressureAbsHpa))),
    pressureBiasHpa: mean(finite(rows.map((row) => row.pressureBiasHpa))),
    trackMaeCi95: bootstrapMeanInterval(track, seed),
    intensityMaeCi95: bootstrapMeanInterval(intensity, seed ^ 0x9e3779b9),
    pressureMaeCi95: bootstrapMeanInterval(
      finite(rows.map((row) => row.pressureAbsHpa)),
      seed ^ 0x85ebca6b,
    ),
  };
}

function skill(model: number | null, baseline: number | null): number | null {
  if (model === null || baseline === null || baseline <= 0) return null;
  return 1 - model / baseline;
}

function superiorFraction(
  pairs: readonly { model: number | null; persistence: number | null }[],
): number | null {
  const comparable = pairs.filter(
    (pair): pair is { model: number; persistence: number } =>
      pair.model !== null && pair.persistence !== null,
  );
  if (comparable.length === 0) return null;
  return (
    comparable.filter((pair) => pair.model < pair.persistence).length /
    comparable.length
  );
}

function pairedSkillFraction(
  pairs: readonly { model: number | null; persistence: number | null }[],
): number | null {
  const comparable = pairs.filter(
    (pair): pair is { model: number; persistence: number } =>
      pair.model !== null && pair.persistence !== null,
  );
  return skill(
    mean(comparable.map((pair) => pair.model)),
    mean(comparable.map((pair) => pair.persistence)),
  );
}

export function aggregateLeadTimes(
  cases: readonly (readonly LeadTimeVerification[])[],
): LeadTimeAggregate[] {
  return FIDELITY_LEAD_HOURS.map((leadH, leadIndex) => {
    const rows = cases
      .map((storm) => storm.find((row) => row.leadH === leadH) ?? null)
      .filter((row): row is LeadTimeVerification => row !== null);
    const model = aggregateErrors(
      rows.map((row) => row.model),
      0x1000 + leadIndex,
    );
    const persistence = aggregateErrors(
      rows.map((row) => row.persistence),
      0x2000 + leadIndex,
    );
    const cliperRows = rows
      .map((row) => row.cliper ?? null)
      .filter((row): row is ForecastError => row !== null);
    const climatologyPersistence =
      cliperRows.length > 0
        ? aggregateErrors(cliperRows, 0x2500 + leadIndex)
        : undefined;
    const trackPairs = rows.map((row) => ({
      model: row.model.trackKm,
      persistence: row.persistence.trackKm,
    }));
    const trackDifferences = trackPairs.map(
      (pair) => pair.model - pair.persistence,
    );
    const cliperTrackPairs = rows
      .filter((row) => row.cliper !== undefined)
      .map((row) => ({
        model: row.model.trackKm,
        persistence: row.cliper!.trackKm,
      }));
    const intensityPairs = rows.map((row) => ({
      model: row.model.intensityAbsKt,
      persistence: row.persistence.intensityAbsKt,
    }));
    const intensityDifferences = intensityPairs
      .filter(
        (pair): pair is { model: number; persistence: number } =>
          pair.model !== null && pair.persistence !== null,
      )
      .map((pair) => pair.model - pair.persistence);
    const pressurePairs = rows.map((row) => ({
      model: row.model.pressureAbsHpa,
      persistence: row.persistence.pressureAbsHpa,
    }));
    const pressureDifferences = pressurePairs
      .filter(
        (pair): pair is { model: number; persistence: number } =>
          pair.model !== null && pair.persistence !== null,
      )
      .map((pair) => pair.model - pair.persistence);
    return {
      leadH,
      model,
      persistence,
      ...(climatologyPersistence ? { climatologyPersistence } : {}),
      trackFrequencySuperior: superiorFraction(trackPairs),
      intensityFrequencySuperior: superiorFraction(intensityPairs),
      pressureFrequencySuperior: superiorFraction(pressurePairs),
      trackMaeSkillFraction: pairedSkillFraction(trackPairs),
      ...(cliperTrackPairs.length > 0
        ? {
            trackMaeSkillFractionAgainstCliper:
              pairedSkillFraction(cliperTrackPairs),
          }
        : {}),
      intensityMaeSkillFraction: pairedSkillFraction(intensityPairs),
      pressureMaeSkillFraction: pairedSkillFraction(pressurePairs),
      trackDifferenceCi95: bootstrapMeanInterval(
        trackDifferences,
        0x3000 + leadIndex,
      ),
      intensityDifferenceCi95: bootstrapMeanInterval(
        intensityDifferences,
        0x4000 + leadIndex,
      ),
      pressureDifferenceCi95: bootstrapMeanInterval(
        pressureDifferences,
        0x5000 + leadIndex,
      ),
    };
  });
}
