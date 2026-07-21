/**
 * Parametric tropical-cyclone physical structure.
 *
 * Radial wind shape follows Holland's analytic pressure/wind model:
 *   Holland, G. J. (1980), Monthly Weather Review 108, 1212–1218.
 * RMW starts from the Willoughby–Rahn climatological relationship documented
 * by the NOAA/NHC Joint Hurricane Testbed:
 *   RMW = 51.6 exp(-0.0223 Vmax[m/s] + 0.0281 |latitude|).
 *
 * A second, slowly evolving outer-size state stretches only the outer Holland
 * profile. Deep-layer shear then applies a downshear-left outer-core asymmetry
 * and displaces rainfall without moving the pressure/wind centre.
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
  outerSizeWeight: number;
  outerSizeBaseKm: number;
  outerSizeWindSlopeKmPerKt: number;
  outerSizeLatitudeSlopeKmPerDegree: number;
  outerSizeBayOffsetKm: number;
  outerSizeBayWindSlopeBonusKmPerKt: number;
  outerSizeShearExpansionKmPerMs: number;
  outerSizeLandDecayFraction: number;
  outerSizeMinKm: number;
  outerSizeMaxKm: number;
  outerSizeRelaxationHours: number;
  outerBlendStartWindKt: number;
  outerBlendFullWindKt: number;
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
  shearAsymmetryThresholdMs: number;
  shearAsymmetryPerMs: number;
  shearAsymmetryMaxFraction: number;
  rainOffsetThresholdMs: number;
  rainOffsetKmPerMs: number;
  rainOffsetMaxKm: number;
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
    // Weight zero reproduces the original one-region benchmark exactly. The
    // held-out calibration gate is the only route to a non-zero live weight.
    outerSizeWeight: 0,
    outerSizeBaseKm: 180,
    outerSizeWindSlopeKmPerKt: -0.45,
    outerSizeLatitudeSlopeKmPerDegree: 2,
    outerSizeBayOffsetKm: 0,
    outerSizeBayWindSlopeBonusKmPerKt: 0,
    outerSizeShearExpansionKmPerMs: 2,
    outerSizeLandDecayFraction: 0.15,
    outerSizeMinKm: 60,
    outerSizeMaxKm: 420,
    outerSizeRelaxationHours: 30,
    outerBlendStartWindKt: 48,
    outerBlendFullWindKt: 36,
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
    shearAsymmetryThresholdMs: 9,
    shearAsymmetryPerMs: 0.018,
    shearAsymmetryMaxFraction: 0.22,
    rainOffsetThresholdMs: 7,
    rainOffsetKmPerMs: 4,
    rainOffsetMaxKm: 48,
    pressureAsymmetryFraction: 0.5,
    minimumPressureHpa: 870,
  });

/** Parameters used by the live simulator. Updated only after held-out gates. */
export const DEFAULT_STRUCTURE_PARAMETERS: Readonly<StructureParameters> =
  Object.freeze({
    ...UNCALIBRATED_STRUCTURE_PARAMETERS,
    outerSizeWeight: 1,
    outerSizeBaseKm: 120,
    outerSizeWindSlopeKmPerKt: 1.5,
    outerSizeLatitudeSlopeKmPerDegree: 0,
    outerSizeBayOffsetKm: 40,
    outerSizeBayWindSlopeBonusKmPerKt: 0.5,
    outerSizeRelaxationHours: 18,
  });

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const fraction = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return fraction * fraction * (3 - 2 * fraction);
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
  landExposureFraction: number,
  parameters: Readonly<StructureParameters>,
): number {
  const shearExpansion = clamp(
    (Math.max(0, shearMs) - parameters.shearExpansionThresholdMs) *
      parameters.shearExpansionPerMs,
    0,
    parameters.shearExpansionMax,
  );
  const landExpansion =
    clamp(landExposureFraction, 0, 1) * parameters.landExpansionFraction;
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

function targetOuterSizeKm(
  vKt: number,
  latitude: number,
  longitude: number,
  shearMs: number,
  landExposureFraction: number,
  parameters: Readonly<StructureParameters>,
): number {
  const shearExpansion =
    Math.max(0, shearMs - parameters.shearAsymmetryThresholdMs) *
    parameters.outerSizeShearExpansionKmPerMs;
  // A continuous basin weight avoids a hard discontinuity near Sri Lanka.
  // The Bay of Bengal outer-size climatology is fitted independently from the
  // Arabian Sea while remaining inert throughout the simulator's Oman domain.
  const bayEntry = smoothstep(72, 80, longitude);
  const maritimeEntry = smoothstep(98, 104, longitude);
  const bayWeight = bayEntry * (1 - maritimeEntry);
  const windAnomalyKt = vKt - 50;
  const oceanTarget =
    parameters.outerSizeBaseKm +
    windAnomalyKt * parameters.outerSizeWindSlopeKmPerKt +
    (Math.abs(latitude) - 15) *
      parameters.outerSizeLatitudeSlopeKmPerDegree +
    bayWeight *
      (parameters.outerSizeBayOffsetKm +
        windAnomalyKt *
          parameters.outerSizeBayWindSlopeBonusKmPerKt) +
    shearExpansion;
  return clamp(
    oceanTarget *
      (1 -
        clamp(landExposureFraction, 0, 1) *
          parameters.outerSizeLandDecayFraction),
    parameters.outerSizeMinKm,
    parameters.outerSizeMaxKm,
  );
}

function hollandRatio(radiusKm: number, rmwKm: number, hollandB: number): number {
  if (radiusKm <= 0) return 0;
  const x = Math.min(80, Math.pow(rmwKm / radiusKm, hollandB));
  return Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
}

function referenceOuterRadiusKm(
  thresholdKt: number,
  rmwKm: number,
  hollandB: number,
  symmetricPeakKt: number,
): number {
  if (symmetricPeakKt < thresholdKt) return rmwKm * 4;
  let inside = rmwKm;
  let outside = MAX_RADIUS_KM;
  for (let iteration = 0; iteration < 48; iteration++) {
    const radius = (inside + outside) / 2;
    if (symmetricPeakKt * hollandRatio(radius, rmwKm, hollandB) >= thresholdKt) {
      inside = radius;
    } else {
      outside = radius;
    }
  }
  return (inside + outside) / 2;
}

function downshearLeftUnit(
  shearUms: number,
  shearVms: number,
): { east: number; north: number } {
  const magnitude = Math.hypot(shearUms, shearVms);
  if (magnitude < 1e-6) return { east: 0, north: 0 };
  // In the northern hemisphere, left of the downshear vector (u, v) is (-v, u).
  return { east: -shearVms / magnitude, north: shearUms / magnitude };
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

function outerStretchAtBearing(
  bearingDeg: number,
  structure: StormStructure,
): number {
  const angle = (bearingDeg * Math.PI) / 180;
  const radialEast = Math.sin(angle);
  const radialNorth = Math.cos(angle);
  const downshearLeft = downshearLeftUnit(
    structure.shearUms,
    structure.shearVms,
  );
  const alignment =
    radialEast * downshearLeft.east + radialNorth * downshearLeft.north;
  return clamp(
    structure.outerWindScale *
      (1 + structure.shearAsymmetryFraction * alignment),
    0.45,
    2.5,
  );
}

/** Map physical radius onto the inner Holland profile for the two-region wind field. */
export function effectiveHollandRadiusKm(
  radiusKm: number,
  bearingDeg: number,
  structure: StormStructure,
): number {
  if (radiusKm <= structure.rmwKm) return Math.max(0.001, radiusKm);
  const unmodifiedWindKt =
    localPeakWindKt(bearingDeg, structure) *
    hollandRatio(radiusKm, structure.rmwKm, structure.hollandB);
  const blend = 1 - smoothstep(
    structure.outerBlendFullWindKt,
    structure.outerBlendStartWindKt,
    unmodifiedWindKt,
  );
  const stretch =
    1 + (outerStretchAtBearing(bearingDeg, structure) - 1) * blend;
  return (
    structure.rmwKm +
    (radiusKm - structure.rmwKm) / Math.max(0.2, stretch)
  );
}

/** Surface-wind speed at radius/bearing from the parametric Holland profile. */
export function hollandWindSpeedKt(
  radiusKm: number,
  bearingDeg: number,
  structure: StormStructure,
): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return 0;
  const radius = effectiveHollandRadiusKm(
    Math.max(0.001, radiusKm),
    bearingDeg,
    structure,
  );
  const ratio = hollandRatio(radius, structure.rmwKm, structure.hollandB);
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
    rmwSource: current.rmwSource ?? previous.rmwSource,
    outerSizeKm: mix(previous.outerSizeKm, current.outerSizeKm, fraction),
    outerSizeSource: current.outerSizeSource ?? previous.outerSizeSource,
    windRadiiSource:
      current.windRadiiSource ?? previous.windRadiiSource,
    outerWindScale: mix(
      previous.outerWindScale,
      current.outerWindScale,
      fraction,
    ),
    outerBlendStartWindKt: mix(
      previous.outerBlendStartWindKt,
      current.outerBlendStartWindKt,
      fraction,
    ),
    outerBlendFullWindKt: mix(
      previous.outerBlendFullWindKt,
      current.outerBlendFullWindKt,
      fraction,
    ),
    hollandB: mix(previous.hollandB, current.hollandB, fraction),
    motionUms: mix(previous.motionUms, current.motionUms, fraction),
    motionVms: mix(previous.motionVms, current.motionVms, fraction),
    translationAsymmetryKt: mix(
      previous.translationAsymmetryKt,
      current.translationAsymmetryKt,
      fraction,
    ),
    shearUms: mix(previous.shearUms, current.shearUms, fraction),
    shearVms: mix(previous.shearVms, current.shearVms, fraction),
    shearAsymmetryFraction: mix(
      previous.shearAsymmetryFraction,
      current.shearAsymmetryFraction,
      fraction,
    ),
    rainOffsetEastKm: mix(
      previous.rainOffsetEastKm,
      current.rainOffsetEastKm,
      fraction,
    ),
    rainOffsetNorthKm: mix(
      previous.rainOffsetNorthKm,
      current.rainOffsetNorthKm,
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
  lon?: number;
  shearMs: number;
  overLand: boolean;
  /** Continuous vortex land fraction; center-land is the fallback for archives. */
  landExposureFraction?: number;
  motionUms: number;
  motionVms: number;
  shearUms?: number;
  shearVms?: number;
  previousRmwKm?: number;
  previousOuterSizeKm?: number;
  rmwSource?: StormStructure['rmwSource'];
  outerSizeSource?: StormStructure['outerSizeSource'];
  /** Optional exact-fix agency radii; missing quadrants stay model-derived. */
  initialR34Km?: Partial<WindRadiiKm>;
  initialR50Km?: Partial<WindRadiiKm>;
  initialR64Km?: Partial<WindRadiiKm>;
  deltaHours?: number;
}

function mergeObservedRadii(
  derived: WindRadiiKm,
  observed: Partial<WindRadiiKm> | undefined,
): { radii: WindRadiiKm; usedObservation: boolean } {
  let usedObservation = false;
  const value = (quadrant: keyof WindRadiiKm): number => {
    const candidate = observed?.[quadrant];
    if (candidate !== undefined && Number.isFinite(candidate) && candidate >= 0) {
      usedObservation = true;
      return candidate;
    }
    return derived[quadrant];
  };
  return {
    radii: {
      ne: value('ne'),
      se: value('se'),
      sw: value('sw'),
      nw: value('nw'),
    },
    usedObservation,
  };
}

/**
 * `dynamics` advances the RMW/outer-size state used by ocean coupling while
 * skipping the twelve expensive quadrant-radius inversions. It is for
 * non-rendered ensemble members only; displayed and scored storms stay `full`.
 */
export type StructureDetail = 'full' | 'dynamics';

/** Derive one immutable-by-convention physical-structure snapshot. */
export function deriveStormStructure(
  input: StructureInput,
  parameters: Readonly<StructureParameters> = DEFAULT_STRUCTURE_PARAMETERS,
  detail: StructureDetail = 'full',
): StormStructure {
  const maximumWindKt = Math.max(0, finite(input.vKt));
  const shearMs = Math.max(0, finite(input.shearMs));
  const shearUms = finite(input.shearUms);
  const shearVms = finite(input.shearVms);
  const motionUms = finite(input.motionUms);
  const motionVms = finite(input.motionVms);
  const landExposureFraction = clamp(
    finite(input.landExposureFraction, input.overLand ? 1 : 0),
    0,
    1,
  );
  const targetRmw = targetRmwKm(
    maximumWindKt,
    input.lat,
    shearMs,
    landExposureFraction,
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
  const targetOuterSize = targetOuterSizeKm(
    maximumWindKt,
    input.lat,
    finite(input.lon, 60),
    shearMs,
    landExposureFraction,
    parameters,
  );
  const previousOuterSize =
    input.previousOuterSizeKm === undefined
      ? targetOuterSize
      : clamp(
          finite(input.previousOuterSizeKm, targetOuterSize),
          parameters.outerSizeMinKm,
          parameters.outerSizeMaxKm,
        );
  const outerRelaxation =
    input.previousOuterSizeKm === undefined
      ? 1
      : 1 - Math.exp(-deltaHours / parameters.outerSizeRelaxationHours);
  const outerSizeKm = clamp(
    previousOuterSize +
      (targetOuterSize - previousOuterSize) * outerRelaxation,
    parameters.outerSizeMinKm,
    parameters.outerSizeMaxKm,
  );
  const symmetricPeakKt = Math.max(
    0,
    maximumWindKt - translationAsymmetryKt,
  );
  let outerWindScale = 1;
  // Outer size participates in HF-2A ocean forcing, so it belongs to coupled
  // dynamics. The lightweight detail mode skips only the three expensive wind-
  // radius products below; it must not alter the wind profile itself.
  const referenceOuterSize = referenceOuterRadiusKm(
    34,
    rmwKm,
    hollandB,
    symmetricPeakKt,
  );
  const calibratedOuterScale = clamp(
    outerSizeKm / Math.max(rmwKm * 1.1, referenceOuterSize),
    0.5,
    2.3,
  );
  outerWindScale =
    1 +
    (calibratedOuterScale - 1) *
      clamp(parameters.outerSizeWeight, 0, 1);
  const vectorMagnitude = Math.hypot(shearUms, shearVms);
  const shearAsymmetryFraction =
    vectorMagnitude < 1e-6
      ? 0
      : clamp(
          (shearMs - parameters.shearAsymmetryThresholdMs) *
            parameters.shearAsymmetryPerMs,
          0,
          parameters.shearAsymmetryMaxFraction,
        );
  const downshearLeft = downshearLeftUnit(shearUms, shearVms);
  const rainOffsetKm =
    vectorMagnitude < 1e-6
      ? 0
      : clamp(
          (shearMs - parameters.rainOffsetThresholdMs) *
            parameters.rainOffsetKmPerMs,
          0,
          parameters.rainOffsetMaxKm,
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
    rmwSource: input.rmwSource ?? 'climatological-prior',
    outerSizeKm,
    outerSizeSource: input.outerSizeSource ?? 'climatological-prior',
    windRadiiSource: 'model-derived',
    outerWindScale,
    outerBlendStartWindKt: parameters.outerBlendStartWindKt,
    outerBlendFullWindKt: parameters.outerBlendFullWindKt,
    hollandB,
    motionUms,
    motionVms,
    translationAsymmetryKt,
    shearUms,
    shearVms,
    shearAsymmetryFraction,
    rainOffsetEastKm: downshearLeft.east * rainOffsetKm,
    rainOffsetNorthKm: downshearLeft.north * rainOffsetKm,
    r34Km: emptyRadii(),
    r50Km: emptyRadii(),
    r64Km: emptyRadii(),
  };
  if (detail === 'full') {
    const r34 = mergeObservedRadii(
      quadrantRadii(34, structure),
      input.initialR34Km,
    );
    const r50 = mergeObservedRadii(
      quadrantRadii(50, structure),
      input.initialR50Km,
    );
    const r64 = mergeObservedRadii(
      quadrantRadii(64, structure),
      input.initialR64Km,
    );
    structure.r34Km = r34.radii;
    structure.r50Km = r50.radii;
    structure.r64Km = r64.radii;
    structure.windRadiiSource =
      r34.usedObservation || r50.usedObservation || r64.usedObservation
        ? 'agency-observed'
        : 'model-derived';
  }
  return structure;
}
