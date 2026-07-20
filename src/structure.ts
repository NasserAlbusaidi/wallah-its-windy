/**
 * Parametric tropical-cyclone physical structure.
 *
 * Radial wind shape follows Holland's analytic pressure/wind model:
 *   Holland, G. J. (1980), Monthly Weather Review 108, 1212–1218.
 * RMW starts from the Willoughby–Rahn climatological relationship documented
 * by the NOAA/NHC Joint Hurricane Testbed:
 *   RMW = 51.6 exp(-0.0223 Vmax[m/s] + 0.0281 |latitude|).
 *
 * This is a deterministic, first-order structure model—not an aircraft wind
 * analysis. Its job is to keep pressure, eyewall size, wind radii, particles,
 * rainfall, replay, and exports on one physically interpretable contract.
 */

import type { StormStructure, WindRadiiKm } from './types';

const KT_TO_MS = 0.514444;
const MAX_RADIUS_KM = 800;

/**
 * Tunable physical-structure parameters. Values that are not exposed to the
 * calibration search remain here so the scientific contract is inspectable
 * and versionable instead of being scattered through the equations.
 */
export interface StructureParameters {
  environmentalPressureHpa: number;
  airDensityKgM3: number;
  surfaceWindReduction: number;
  rmwCoefficientKm: number;
  rmwWindDecayPerMs: number;
  rmwLatitudeGrowthPerDegree: number;
  rmwMinKm: number;
  rmwMaxKm: number;
  rmwRelaxationHours: number;
  shearExpansionThresholdMs: number;
  shearExpansionPerMs: number;
  shearExpansionMax: number;
  landExpansionFraction: number;
  hollandBaseB: number;
  hollandIntensityGainB: number;
  hollandIntensityStartKt: number;
  hollandIntensitySpanKt: number;
  hollandShearThresholdMs: number;
  hollandShearBroadeningPerMs: number;
  hollandMinB: number;
  hollandMaxB: number;
  translationAsymmetryMotionFactor: number;
  translationAsymmetryMaxKt: number;
  translationAsymmetryMaxWindFraction: number;
  pressureAsymmetryFraction: number;
  minimumPressureHpa: number;
}

/**
 * Pre-calibration reference retained as an immutable benchmark. The validation
 * harness always compares proposed parameters against this exact model.
 */
export const UNCALIBRATED_STRUCTURE_PARAMETERS: Readonly<StructureParameters> =
  Object.freeze({
    environmentalPressureHpa: 1010,
    airDensityKgM3: 1.15,
    surfaceWindReduction: 0.9,
    rmwCoefficientKm: 51.6,
    rmwWindDecayPerMs: 0.0223,
    rmwLatitudeGrowthPerDegree: 0.0281,
    rmwMinKm: 12,
    rmwMaxKm: 95,
    rmwRelaxationHours: 12,
    shearExpansionThresholdMs: 12,
    shearExpansionPerMs: 0.012,
    shearExpansionMax: 0.3,
    landExpansionFraction: 0.12,
    hollandBaseB: 1.1,
    hollandIntensityGainB: 1.05,
    hollandIntensityStartKt: 30,
    hollandIntensitySpanKt: 120,
    hollandShearThresholdMs: 12,
    hollandShearBroadeningPerMs: 0.012,
    hollandMinB: 0.9,
    hollandMaxB: 2.35,
    translationAsymmetryMotionFactor: 0.55,
    translationAsymmetryMaxKt: 12,
    translationAsymmetryMaxWindFraction: 0.18,
    pressureAsymmetryFraction: 0.5,
    minimumPressureHpa: 870,
  });

/** Parameters used by the live simulator. Updated only after held-out gates. */
export const DEFAULT_STRUCTURE_PARAMETERS: Readonly<StructureParameters> =
  Object.freeze({ ...UNCALIBRATED_STRUCTURE_PARAMETERS });

const QUADRANT_BEARINGS = {
  ne: 45,
  se: 135,
  sw: 225,
  nw: 315,
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function emptyRadii(): WindRadiiKm {
  return { ne: 0, se: 0, sw: 0, nw: 0 };
}

/**
 * First-order climatological RMW proxy from maximum surface wind and latitude.
 * The relationship was developed for Atlantic data, so it is deliberately
 * bounded and identified as a proxy when used over the North Indian Ocean.
 */
export function climatologicalRmwKm(
  vKt: number,
  latitude: number,
  parameters: Readonly<StructureParameters> = DEFAULT_STRUCTURE_PARAMETERS,
): number {
  const windMs = Math.max(0, finite(vKt)) * KT_TO_MS;
  const absoluteLatitude = clamp(Math.abs(finite(latitude)), 0, 60);
  return clamp(
    parameters.rmwCoefficientKm *
      Math.exp(
        -parameters.rmwWindDecayPerMs * windMs +
          parameters.rmwLatitudeGrowthPerDegree * absoluteLatitude,
      ),
    parameters.rmwMinKm,
    parameters.rmwMaxKm,
  );
}

function targetRmwKm(
  vKt: number,
  latitude: number,
  shearMs: number,
  overLand: boolean,
  parameters: Readonly<StructureParameters>,
): number {
  const shearExpansion = clamp(
    (Math.max(0, shearMs) - parameters.shearExpansionThresholdMs) *
      parameters.shearExpansionPerMs,
    0,
    parameters.shearExpansionMax,
  );
  const landExpansion = overLand ? parameters.landExpansionFraction : 0;
  return clamp(
    climatologicalRmwKm(vKt, latitude, parameters) *
      (1 + shearExpansion + landExpansion),
    parameters.rmwMinKm,
    parameters.rmwMaxKm,
  );
}

function hollandShape(
  vKt: number,
  shearMs: number,
  parameters: Readonly<StructureParameters>,
): number {
  const intensity = clamp(
    (vKt - parameters.hollandIntensityStartKt) /
      parameters.hollandIntensitySpanKt,
    0,
    1,
  );
  const shearBroadening = clamp(
    (shearMs - parameters.hollandShearThresholdMs) *
      parameters.hollandShearBroadeningPerMs,
    0,
    parameters.shearExpansionMax,
  );
  return clamp(
    parameters.hollandBaseB +
      intensity * parameters.hollandIntensityGainB -
      shearBroadening,
    parameters.hollandMinB,
    parameters.hollandMaxB,
  );
}

function motionAsymmetryKt(
  vKt: number,
  motionUms: number,
  motionVms: number,
  parameters: Readonly<StructureParameters>,
): number {
  const motionKt = Math.hypot(motionUms, motionVms) / KT_TO_MS;
  return clamp(
    motionKt * parameters.translationAsymmetryMotionFactor,
    0,
    Math.min(
      parameters.translationAsymmetryMaxKt,
      Math.max(0, vKt) * parameters.translationAsymmetryMaxWindFraction,
    ),
  );
}

function localPeakWindKt(
  bearingDeg: number,
  structure: StormStructure,
): number {
  const motionSpeed = Math.hypot(structure.motionUms, structure.motionVms);
  if (motionSpeed < 1e-6 || structure.translationAsymmetryKt <= 0) {
    return structure.maximumWindKt;
  }

  // Bearing is clockwise from north. At that radial bearing, a northern-
  // hemisphere vortex's CCW tangential vector is (-north, east).
  const angle = (bearingDeg * Math.PI) / 180;
  const radialEast = Math.sin(angle);
  const radialNorth = Math.cos(angle);
  const tangentialEast = -radialNorth;
  const tangentialNorth = radialEast;
  const motionEast = structure.motionUms / motionSpeed;
  const motionNorth = structure.motionVms / motionSpeed;
  const alignment =
    tangentialEast * motionEast + tangentialNorth * motionNorth;
  const symmetricMaximum =
    structure.maximumWindKt - structure.translationAsymmetryKt;
  return Math.max(
    0,
    symmetricMaximum + structure.translationAsymmetryKt * alignment,
  );
}

/** Surface-wind speed at radius/bearing from the parametric Holland profile. */
export function hollandWindSpeedKt(
  radiusKm: number,
  bearingDeg: number,
  structure: StormStructure,
): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return 0;
  const radius = Math.max(0.001, radiusKm);
  const x = Math.min(
    80,
    Math.pow(structure.rmwKm / radius, structure.hollandB),
  );
  const ratio = Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
  return localPeakWindKt(bearingDeg, structure) * ratio;
}

/** Outer radius at which the surface wind falls through `thresholdKt`. */
export function windRadiusAtBearingKm(
  thresholdKt: number,
  bearingDeg: number,
  structure: StormStructure,
): number {
  if (
    !Number.isFinite(thresholdKt) ||
    thresholdKt <= 0 ||
    localPeakWindKt(bearingDeg, structure) < thresholdKt
  ) {
    return 0;
  }

  let inside = structure.rmwKm;
  let outside = MAX_RADIUS_KM;
  if (hollandWindSpeedKt(outside, bearingDeg, structure) >= thresholdKt) {
    return outside;
  }
  for (let iteration = 0; iteration < 48; iteration++) {
    const radius = (inside + outside) / 2;
    if (hollandWindSpeedKt(radius, bearingDeg, structure) >= thresholdKt) {
      inside = radius;
    } else {
      outside = radius;
    }
  }
  return (inside + outside) / 2;
}

function quadrantRadii(
  thresholdKt: number,
  structure: StormStructure,
): WindRadiiKm {
  return {
    ne: windRadiusAtBearingKm(
      thresholdKt,
      QUADRANT_BEARINGS.ne,
      structure,
    ),
    se: windRadiusAtBearingKm(
      thresholdKt,
      QUADRANT_BEARINGS.se,
      structure,
    ),
    sw: windRadiusAtBearingKm(
      thresholdKt,
      QUADRANT_BEARINGS.sw,
      structure,
    ),
    nw: windRadiusAtBearingKm(
      thresholdKt,
      QUADRANT_BEARINGS.nw,
      structure,
    ),
  };
}

export function maxWindRadiusKm(radii: WindRadiiKm): number {
  return Math.max(radii.ne, radii.se, radii.sw, radii.nw);
}

/**
 * Smoothly interpolate operational-style quadrant radii at a geographic
 * bearing (degrees clockwise from north).
 */
export function windRadiusFromQuadrantsKm(
  radii: WindRadiiKm,
  bearingDeg: number,
): number {
  const values = [radii.ne, radii.se, radii.sw, radii.nw] as const;
  const normalized = ((bearingDeg % 360) + 360) % 360;
  const position = (normalized - 45) / 90;
  const lowerRaw = Math.floor(position);
  const fraction = position - lowerRaw;
  const lower = ((lowerRaw % 4) + 4) % 4;
  const upper = (lower + 1) % 4;
  return mix(values[lower], values[upper], fraction);
}

/** Detach nested quadrant objects before recording or exposing engine state. */
export function cloneStormStructure(
  structure: StormStructure,
): StormStructure {
  return {
    ...structure,
    r34Km: { ...structure.r34Km },
    r50Km: { ...structure.r50Km },
    r64Km: { ...structure.r64Km },
  };
}

function mix(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

function mixRadii(
  a: WindRadiiKm,
  b: WindRadiiKm,
  fraction: number,
): WindRadiiKm {
  return {
    ne: mix(a.ne, b.ne, fraction),
    se: mix(a.se, b.se, fraction),
    sw: mix(a.sw, b.sw, fraction),
    nw: mix(a.nw, b.nw, fraction),
  };
}

/** Smooth structure between fixed physics ticks without advancing the model. */
export function interpolateStormStructure(
  previous: StormStructure,
  current: StormStructure,
  alpha: number,
): StormStructure {
  const fraction = clamp(alpha, 0, 1);
  return {
    maximumWindKt: mix(
      previous.maximumWindKt,
      current.maximumWindKt,
      fraction,
    ),
    centralPressureHpa: mix(
      previous.centralPressureHpa,
      current.centralPressureHpa,
      fraction,
    ),
    environmentalPressureHpa: mix(
      previous.environmentalPressureHpa,
      current.environmentalPressureHpa,
      fraction,
    ),
    rmwKm: mix(previous.rmwKm, current.rmwKm, fraction),
    hollandB: mix(previous.hollandB, current.hollandB, fraction),
    motionUms: mix(previous.motionUms, current.motionUms, fraction),
    motionVms: mix(previous.motionVms, current.motionVms, fraction),
    translationAsymmetryKt: mix(
      previous.translationAsymmetryKt,
      current.translationAsymmetryKt,
      fraction,
    ),
    r34Km: mixRadii(previous.r34Km, current.r34Km, fraction),
    r50Km: mixRadii(previous.r50Km, current.r50Km, fraction),
    r64Km: mixRadii(previous.r64Km, current.r64Km, fraction),
  };
}

export interface StructureInput {
  vKt: number;
  lat: number;
  shearMs: number;
  overLand: boolean;
  motionUms: number;
  motionVms: number;
  previousRmwKm?: number;
  deltaHours?: number;
}

/** Derive one immutable-by-convention physical-structure snapshot. */
export function deriveStormStructure(
  input: StructureInput,
  parameters: Readonly<StructureParameters> = DEFAULT_STRUCTURE_PARAMETERS,
): StormStructure {
  const maximumWindKt = Math.max(0, finite(input.vKt));
  const shearMs = Math.max(0, finite(input.shearMs));
  const motionUms = finite(input.motionUms);
  const motionVms = finite(input.motionVms);
  const targetRmw = targetRmwKm(
    maximumWindKt,
    input.lat,
    shearMs,
    input.overLand,
    parameters,
  );
  const previousRmw =
    input.previousRmwKm === undefined
      ? targetRmw
      : clamp(
          finite(input.previousRmwKm, targetRmw),
          parameters.rmwMinKm,
          parameters.rmwMaxKm,
        );
  const deltaHours = Math.max(0, finite(input.deltaHours));
  const relaxation =
    input.previousRmwKm === undefined
      ? 1
      : 1 - Math.exp(-deltaHours / parameters.rmwRelaxationHours);
  const rmwKm = clamp(
    previousRmw + (targetRmw - previousRmw) * relaxation,
    parameters.rmwMinKm,
    parameters.rmwMaxKm,
  );
  const hollandB = hollandShape(maximumWindKt, shearMs, parameters);
  const translationAsymmetryKt = motionAsymmetryKt(
    maximumWindKt,
    motionUms,
    motionVms,
    parameters,
  );

  // Holland's cyclostrophic maximum-wind relation inverted for pressure
  // deficit. The simulated maximum is a surface wind, so convert it to a
  // gradient-wind proxy before applying the relation.
  const pressureWindKt = Math.max(
    0,
    maximumWindKt -
      translationAsymmetryKt * parameters.pressureAsymmetryFraction,
  );
  const gradientWindMs =
    (pressureWindKt * KT_TO_MS) / parameters.surfaceWindReduction;
  const pressureDeficitHpa =
    (parameters.airDensityKgM3 * Math.E * gradientWindMs * gradientWindMs) /
    hollandB /
    100;
  const centralPressureHpa = clamp(
    parameters.environmentalPressureHpa - pressureDeficitHpa,
    parameters.minimumPressureHpa,
    parameters.environmentalPressureHpa,
  );

  const structure: StormStructure = {
    maximumWindKt,
    centralPressureHpa,
    environmentalPressureHpa: parameters.environmentalPressureHpa,
    rmwKm,
    hollandB,
    motionUms,
    motionVms,
    translationAsymmetryKt,
    r34Km: emptyRadii(),
    r50Km: emptyRadii(),
    r64Km: emptyRadii(),
  };
  structure.r34Km = quadrantRadii(34, structure);
  structure.r50Km = quadrantRadii(50, structure);
  structure.r64Km = quadrantRadii(64, structure);
  return structure;
}
