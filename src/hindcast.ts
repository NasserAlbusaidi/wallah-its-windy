/** Pure historical-hindcast verification against observed IBTrACS fixes. */

import { greatCircleKm } from './grid';
import type { FlightFrame } from './flight-recorder';
import type { StormTrack, TrackFix } from './tracks';

export interface HindcastScore {
  startIso: string;
  endIso: string;
  trackSamples: number;
  intensitySamples: number;
  pressureSamples: number;
  trackMaeKm: number | null;
  trackRmseKm: number | null;
  intensityMaeKt: number | null;
  intensityBiasKt: number | null;
  pressureMaeHpa: number | null;
  peakBiasKt: number | null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function interpolateFrame(
  frames: readonly FlightFrame[],
  ageH: number,
): FlightFrame | null {
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
  if (b.ageH <= a.ageH) return a;
  const w = Math.max(0, Math.min(1, (ageH - a.ageH) / (b.ageH - a.ageH)));
  return {
    ...a,
    ageH,
    lat: a.lat + (b.lat - a.lat) * w,
    lon: a.lon + (b.lon - a.lon) * w,
    vKt: a.vKt + (b.vKt - a.vKt) * w,
    structure: {
      ...a.structure,
      centralPressureHpa:
        a.structure.centralPressureHpa +
        (b.structure.centralPressureHpa - a.structure.centralPressureHpa) * w,
    },
  };
}

function eligibleFixes(
  track: StormTrack,
  startMs: number,
  endMs: number,
): TrackFix[] {
  return track.points.filter((fix) => {
    const time = Date.parse(fix.iso);
    return Number.isFinite(time) && time >= startMs && time <= endMs;
  });
}

export function scoreHindcast(
  frames: readonly FlightFrame[],
  track: StormTrack,
  startIso: string,
): HindcastScore | null {
  if (frames.length === 0) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const endMs = startMs + frames.at(-1)!.ageH * 3_600_000;
  const fixes = eligibleFixes(track, startMs, endMs);
  const trackErrors: number[] = [];
  const intensityErrors: number[] = [];
  const intensityBiases: number[] = [];
  const pressureErrors: number[] = [];
  const observedWinds: number[] = [];

  for (const fix of fixes) {
    const ageH = (Date.parse(fix.iso) - startMs) / 3_600_000;
    const frame = interpolateFrame(frames, ageH);
    if (!frame) continue;
    trackErrors.push(
      greatCircleKm(
        { lat: frame.lat, lon: frame.lon },
        { lat: fix.lat, lon: fix.lon },
      ),
    );
    if (fix.windKt !== null) {
      const bias = frame.vKt - fix.windKt;
      intensityBiases.push(bias);
      intensityErrors.push(Math.abs(bias));
      observedWinds.push(fix.windKt);
    }
    if (fix.presMb !== null) {
      pressureErrors.push(
        Math.abs(frame.structure.centralPressureHpa - fix.presMb),
      );
    }
  }

  const peakObserved =
    observedWinds.length > 0 ? Math.max(...observedWinds) : null;
  const peakSim = Math.max(...frames.map((frame) => frame.vKt));
  return {
    startIso,
    endIso: new Date(endMs).toISOString(),
    trackSamples: trackErrors.length,
    intensitySamples: intensityErrors.length,
    pressureSamples: pressureErrors.length,
    trackMaeKm: mean(trackErrors),
    trackRmseKm:
      trackErrors.length === 0
        ? null
        : Math.sqrt(
            trackErrors.reduce((sum, error) => sum + error * error, 0) /
              trackErrors.length,
          ),
    intensityMaeKt: mean(intensityErrors),
    intensityBiasKt: mean(intensityBiases),
    pressureMaeHpa: mean(pressureErrors),
    peakBiasKt: peakObserved === null ? null : peakSim - peakObserved,
  };
}
