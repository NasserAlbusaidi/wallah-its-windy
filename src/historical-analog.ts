/**
 * Deterministic geometric/intensity similarity against shipped historic ghosts.
 * The result is an educational analogue, never a causal or forecast claim.
 */

import type { TrackPoint } from './types';
import type { StormTrack, TrackFix } from './tracks';

const SAMPLE_COUNT = 24;
const KM_PER_DEGREE = 111.32;

export interface HistoricalAnalog {
  trackId: string;
  name: string;
  year: number;
  score: number;
  shapeErrorKm: number;
  directionErrorDeg: number;
  intensityErrorKt: number | null;
  durationRatio: number | null;
  comparedThroughH: number;
  activePrefix: boolean;
}

interface NormalizedPoint {
  t: number;
  xKm: number;
  yKm: number;
  windKt: number | null;
}

function finiteTrack(points: readonly TrackPoint[]): TrackPoint[] {
  return points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lon) &&
      Number.isFinite(point.ageH) &&
      Number.isFinite(point.vKt),
  );
}

function historicalHours(points: readonly TrackFix[]): number[] {
  const parsed = points.map((point) => Date.parse(point.iso));
  if (parsed.every(Number.isFinite)) {
    const start = parsed[0];
    return parsed.map((time) => Math.max(0, (time - start) / 3_600_000));
  }
  // IBTrACS ghosts are normally six-hourly. This fallback is explicit and only
  // used for malformed/missing ISO text in a still-valid display track.
  return points.map((_, index) => index * 6);
}

function trimHistoricalPrefix(
  points: readonly TrackFix[],
  elapsedH: number,
): { points: TrackFix[]; hours: number[] } {
  const hours = historicalHours(points);
  const kept: TrackFix[] = [];
  const keptHours: number[] = [];
  for (let index = 0; index < points.length; index++) {
    if (hours[index] > elapsedH + 1e-9) break;
    kept.push(points[index]);
    keptHours.push(hours[index]);
  }
  return { points: kept, hours: keptHours };
}

function interpolate(
  points: readonly NormalizedPoint[],
  fraction: number,
): NormalizedPoint {
  if (points.length === 1) return points[0];
  const target = Math.max(0, Math.min(1, fraction));
  let b = 1;
  while (b < points.length - 1 && points[b].t < target) b++;
  const a = Math.max(0, b - 1);
  const span = Math.max(1e-9, points[b].t - points[a].t);
  const weight = Math.max(0, Math.min(1, (target - points[a].t) / span));
  const windA = points[a].windKt;
  const windB = points[b].windKt;
  return {
    t: target,
    xKm: points[a].xKm + (points[b].xKm - points[a].xKm) * weight,
    yKm: points[a].yKm + (points[b].yKm - points[a].yKm) * weight,
    windKt:
      windA === null || windB === null
        ? windA ?? windB
        : windA + (windB - windA) * weight,
  };
}

function normalize(
  points: readonly { lat: number; lon: number; windKt: number | null }[],
  hours: readonly number[],
): NormalizedPoint[] {
  const origin = points[0];
  const meanLat =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lonScale = KM_PER_DEGREE * Math.cos((meanLat * Math.PI) / 180);
  const startH = hours[0] ?? 0;
  const durationH = Math.max(1e-9, (hours.at(-1) ?? startH) - startH);
  return points.map((point, index) => ({
    t: Math.max(0, Math.min(1, ((hours[index] ?? startH) - startH) / durationH)),
    xKm: (point.lon - origin.lon) * lonScale,
    yKm: (point.lat - origin.lat) * KM_PER_DEGREE,
    windKt: point.windKt,
  }));
}

function angleErrorDeg(a: NormalizedPoint, b: NormalizedPoint): number {
  const angleA = Math.atan2(a.yKm, a.xKm);
  const angleB = Math.atan2(b.yKm, b.xKm);
  let difference = Math.abs(angleA - angleB) * (180 / Math.PI);
  if (difference > 180) difference = 360 - difference;
  return difference;
}

function scoreCandidate(
  simulated: readonly TrackPoint[],
  historic: StormTrack,
  complete: boolean,
): HistoricalAnalog | null {
  const elapsedH = Math.max(0, simulated.at(-1)!.ageH - simulated[0].ageH);
  const trimmed = complete
    ? { points: [...historic.points], hours: historicalHours(historic.points) }
    : trimHistoricalPrefix(historic.points, elapsedH);
  if (trimmed.points.length < 2) return null;

  const simNormalized = normalize(
    simulated.map((point) => ({ ...point, windKt: point.vKt })),
    simulated.map((point) => point.ageH),
  );
  const historyNormalized = normalize(trimmed.points, trimmed.hours);
  let shapeSquared = 0;
  let intensitySquared = 0;
  let intensityCount = 0;
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const fraction = index / (SAMPLE_COUNT - 1);
    const a = interpolate(simNormalized, fraction);
    const b = interpolate(historyNormalized, fraction);
    shapeSquared += (a.xKm - b.xKm) ** 2 + (a.yKm - b.yKm) ** 2;
    if (a.windKt !== null && b.windKt !== null) {
      intensitySquared += (a.windKt - b.windKt) ** 2;
      intensityCount++;
    }
  }
  const shapeErrorKm = Math.sqrt(shapeSquared / SAMPLE_COUNT);
  const intensityErrorKt =
    intensityCount > 0 ? Math.sqrt(intensitySquared / intensityCount) : null;
  const directionErrorDeg = angleErrorDeg(
    simNormalized.at(-1)!,
    historyNormalized.at(-1)!,
  );
  const historicDurationH = trimmed.hours.at(-1) ?? 0;
  const durationRatio =
    complete && elapsedH > 0 && historicDurationH > 0
      ? historicDurationH / elapsedH
      : null;
  const durationPenalty =
    durationRatio === null ? 0 : Math.abs(Math.log(durationRatio));
  const normalizedError =
    shapeErrorKm / 260 +
    (directionErrorDeg / 90) * 0.18 +
    (intensityErrorKt === null ? 0 : intensityErrorKt / 55) * 0.25 +
    durationPenalty * 0.18;
  return {
    trackId: historic.id,
    name: historic.name,
    year: historic.year,
    score: Math.max(0, Math.min(100, Math.round(100 * Math.exp(-normalizedError)))),
    shapeErrorKm,
    directionErrorDeg,
    intensityErrorKt,
    durationRatio,
    comparedThroughH: Math.min(elapsedH, historicDurationH),
    activePrefix: !complete,
  };
}

export function findHistoricalAnalog(
  simulatedPoints: readonly TrackPoint[],
  historicTracks: readonly StormTrack[],
  options: { complete: boolean },
): HistoricalAnalog | null {
  const simulated = finiteTrack(simulatedPoints);
  if (simulated.length < 2) return null;
  let best: HistoricalAnalog | null = null;
  for (const historic of historicTracks) {
    const candidate = scoreCandidate(simulated, historic, options.complete);
    if (
      candidate &&
      (!best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.trackId < best.trackId))
    ) {
      best = candidate;
    }
  }
  return best;
}
