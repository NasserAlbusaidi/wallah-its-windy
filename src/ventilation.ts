/** Deterministic annular environmental ventilation diagnostics for HF-2B. */

import { offsetKm } from './grid';
import type { EnvSampler } from './types';

const KT_PER_MS = 1.943844;
const BEARINGS_DEG = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);

export interface VentilationDiagnostics {
  annulusRadiusKm: number;
  sampleCount: number;
  meanRhPct: number;
  upshearRhPct: number;
  minimumRhPct: number;
  shearUms: number;
  shearVms: number;
  shearMs: number;
  shearVectorCoherence: number;
  entropyDeficitProxy: number;
  ventilationIndex: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Sample the standard environment around, not inside, the vortex. The reduced
 * model lacks moist entropy profiles, so 600/700-hPa RH supplies an explicitly
 * named bounded entropy-deficit proxy. The Tang-Emanuel dimensional structure
 * is retained: shear times deficit divided by potential intensity.
 */
export function sampleVentilationEnvironment(
  env: EnvSampler,
  lat: number,
  lon: number,
  monthIndex: number,
  tFrac: number,
  outerSizeKm: number,
  potentialIntensityKt: number,
): VentilationDiagnostics {
  const annulusRadiusKm = clamp(outerSizeKm * 1.25, 150, 350);
  const rows = BEARINGS_DEG.map((bearingDeg) => {
    const radians = (bearingDeg * Math.PI) / 180;
    const point = offsetKm(
      lat,
      lon,
      Math.sin(radians),
      Math.cos(radians),
      annulusRadiusKm,
    );
    const sample = env.sample(point.lat, point.lon, monthIndex, tFrac);
    const vectorMagnitude = Math.hypot(sample.shearU, sample.shearV);
    const fallbackScalarShear =
      vectorMagnitude < 1e-9 && sample.shear > 0 ? sample.shear : null;
    const shearUms = fallbackScalarShear ?? sample.shearU;
    const shearVms = fallbackScalarShear === null ? sample.shearV : 0;
    return {
      bearingDeg,
      rhPct: clamp(sample.midlevelRhPct, 0, 100),
      shearUms,
      shearVms,
      shearMs: Math.hypot(shearUms, shearVms),
    };
  });
  const sampleCount = rows.length;
  const meanRhPct = rows.reduce((sum, row) => sum + row.rhPct, 0) / sampleCount;
  const minimumRhPct = Math.min(...rows.map((row) => row.rhPct));
  const shearUms = rows.reduce((sum, row) => sum + row.shearUms, 0) / sampleCount;
  const shearVms = rows.reduce((sum, row) => sum + row.shearVms, 0) / sampleCount;
  const meanShearMagnitude =
    rows.reduce((sum, row) => sum + row.shearMs, 0) / sampleCount;
  const vectorMeanShear = Math.hypot(shearUms, shearVms);
  const shearVectorCoherence =
    meanShearMagnitude <= 1e-9
      ? 1
      : clamp(vectorMeanShear / meanShearMagnitude, 0, 1);
  // Retain the resolved vector mean and a quarter of unresolved directional
  // variance. Opposing vectors must not silently cancel to a perfectly calm
  // environment, but incoherent sub-grid shear is not treated as fully aligned.
  const shearMs =
    vectorMeanShear + 0.25 * (meanShearMagnitude - vectorMeanShear);

  const shearDirection = Math.atan2(shearUms, shearVms);
  let upshearWeight = 0;
  let upshearRhTotal = 0;
  for (const row of rows) {
    const radialDirection = (row.bearingDeg * Math.PI) / 180;
    const alignment = Math.cos(radialDirection - shearDirection - Math.PI);
    const weight = 0.25 + 0.75 * Math.max(0, alignment);
    upshearWeight += weight;
    upshearRhTotal += row.rhPct * weight;
  }
  const upshearRhPct = upshearRhTotal / upshearWeight;
  const representativeRhPct = 0.65 * meanRhPct + 0.35 * upshearRhPct;
  const entropyDeficitProxy = clamp((70 - representativeRhPct) / 45, 0, 1);
  const potentialIntensityMs = Math.max(10, potentialIntensityKt / KT_PER_MS);
  const ventilationIndex = (shearMs * entropyDeficitProxy) / potentialIntensityMs;
  return {
    annulusRadiusKm,
    sampleCount,
    meanRhPct,
    upshearRhPct,
    minimumRhPct,
    shearUms,
    shearVms,
    shearMs,
    shearVectorCoherence,
    entropyDeficitProxy,
    ventilationIndex,
  };
}
