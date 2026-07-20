/**
 * comparison.ts — pure paired-run analysis.
 *
 * A comparison always holds genesis and seed constant and changes only the
 * environment. This module does not start simulations; it validates that
 * invariant and turns two completed flight tapes into one readable result.
 */

import type { FlightRunSnapshot } from './flight-recorder';

export interface RunComparison {
  baseline: FlightRunSnapshot;
  candidate: FlightRunSnapshot;
  peakDeltaKt: number;
  lifeDeltaH: number;
  muscatDeltaKm: number;
  landfallChanged: boolean;
}

function sameIdentity(a: FlightRunSnapshot, b: FlightRunSnapshot): boolean {
  const left = a.meta.spawn;
  const right = b.meta.spawn;
  return left.lat === right.lat && left.lon === right.lon && left.seed === right.seed;
}

export function compareRuns(
  baseline: FlightRunSnapshot,
  candidate: FlightRunSnapshot,
): RunComparison | null {
  if (!sameIdentity(baseline, candidate)) return null;
  return {
    baseline,
    candidate,
    peakDeltaKt: candidate.debrief.death.peakKt - baseline.debrief.death.peakKt,
    lifeDeltaH:
      candidate.debrief.death.durationH - baseline.debrief.death.durationH,
    muscatDeltaKm:
      candidate.debrief.death.closestApproachKm -
      baseline.debrief.death.closestApproachKm,
    landfallChanged:
      (baseline.debrief.landfall === null) !==
      (candidate.debrief.landfall === null),
  };
}

