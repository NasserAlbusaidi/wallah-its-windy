/**
 * Deterministic reduced Price/PWP-style upper-ocean response.
 *
 * The atmospheric model supplies its own earth-relative Holland wind field.
 * Each forced 0.1-degree ocean cell owns a retained temperature, salinity and
 * current profile. Wind stress accelerates the diagnosed mixed slab and a bulk
 * Richardson criterion entrains the next layer. Entrainment is conservative;
 * the only non-conservative thermal term is the explicit, diagnosed recovery
 * toward the immutable background profile.
 *
 * This is deliberately a one-dimensional column model. It does not resolve
 * horizontal currents, waves, spray, rain freshening or ocean eddies.
 */

import { cellToLatLon, DOMAIN, latLonToCell } from './grid';
import { cloneStormStructure, hollandWindSpeedKt } from './structure';
import type { GridSpec, StormStructure } from './types';

export const OCEAN_DEPTH_INTERFACES_M = Object.freeze([
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80,
  85, 90, 95, 100, 125, 150, 175, 200, 250, 300,
] as const);

export const OCEAN = Object.freeze({
  GRID_DEGREES: 0.1,
  RHO0_KG_M3: 1025,
  CP_J_KG_K: 3990,
  RHO_AIR_KG_M3: 1.15,
  GRAVITY_MS2: 9.80665,
  OMEGA_RAD_S: 7.2921159e-5,
  THERMAL_EXPANSION_PER_C: 3.3e-4,
  HALINE_CONTRACTION_PER_PSU: 7.6e-4,
  REFERENCE_TEMPERATURE_C: 27,
  REFERENCE_SALINITY_PSU: 36,
  MLD_DENSITY_DELTA_KG_M3: 0.03,
  GRADIENT_RICHARDSON_CRITICAL: 0.25,
  OHC_THRESHOLD_C: 26,
  J_M2_PER_KJ_CM2: 1e7,
  MIN_ACTIVE_WIND_MS: 5,
  /** Convert one-minute best-track/structure wind to a stress-relevant 10-minute mean. */
  STRESS_WIND_AVERAGING_FACTOR: 0.93,
  RECOVERY_DELAY_H: 6,
  MAX_COOLING_C: 8,
} as const);

export interface UpperOceanParameters {
  bulkRichardsonCritical: number;
  momentumDampingInertialPeriods: number;
  thermalRecoveryHours: number;
}

export const DEFAULT_UPPER_OCEAN_PARAMETERS: Readonly<UpperOceanParameters> =
  Object.freeze({
    bulkRichardsonCritical: 0.55,
    momentumDampingInertialPeriods: 1,
    thermalRecoveryHours: 120,
  });

export interface OceanBackgroundSample {
  /** Wake-free surface temperature at initialization. */
  sstC: number;
  /** Used only to construct the retained climatological profile. */
  ohcKjCm2: number;
  initializationTier?: 'event-analysis' | 'climatological-subsurface' | 'analytic-fallback';
  sourceValidTime?: string;
  /** WOA/analysis profile; absent only in explicit degraded fallback mode. */
  profile?: OceanProfile;
}

export type OceanBackgroundSampler = (
  lat: number,
  lon: number,
) => OceanBackgroundSample;

export interface OceanProfile {
  temperatureC: Float64Array;
  salinityPsu: Float64Array;
}

export interface OceanColumnDiagnostics {
  initializationTier: NonNullable<OceanBackgroundSample['initializationTier']>;
  sourceValidTime: string | null;
  backgroundSstC: number;
  surfaceSstC: number;
  coolingC: number;
  mixedLayerDepthM: number;
  ohcKjCm2: number;
  isotherm26DepthM: number;
  temperatureBelowMixedLayerC: number;
  mixedLayerCurrentSpeedMs: number;
  mixedLayerCurrentDirectionDeg: number;
  inertialPeriodH: number;
  windStressPa: number;
  bulkRichardson: number | null;
  entrainmentDepthM: number;
  heatMovedThisStepJm2: number;
  cumulativeMixingHeatJm2: number;
  cumulativeRecoveryHeatJm2: number;
  activeColumnCount: number;
  hardBoundFlag: boolean;
  missingSourceFlag: boolean;
}

export interface OceanStormSnapshot {
  lat: number;
  lon: number;
  structure: StormStructure;
}

interface OceanColumn {
  lat: number;
  lon: number;
  background: OceanBackgroundSample;
  backgroundTemperatureC: Float64Array;
  backgroundSalinityPsu: Float64Array;
  temperatureC: Float64Array;
  salinityPsu: Float64Array;
  currentUms: Float64Array;
  currentVms: Float64Array;
  mixedLayerLastIndex: number;
  calmHours: number;
  lastUpdateH: number;
  cumulativeMixingHeatJm2: number;
  cumulativeRecoveryHeatJm2: number;
  lastWindStressPa: number;
  lastBulkRichardson: number | null;
  lastEntrainmentDepthM: number;
  lastHeatMovedJm2: number;
  forcingCursor: number;
}

interface OceanForcingStep {
  previous: OceanStormSnapshot;
  next: OceanStormSnapshot;
  dtH: number;
  endAgeH: number;
}

const OCEAN_GRID: GridSpec = {
  nx: Math.round((DOMAIN.lonMax - DOMAIN.lonMin) / OCEAN.GRID_DEGREES),
  ny: Math.round((DOMAIN.latMax - DOMAIN.latMin) / OCEAN.GRID_DEGREES),
  bbox: DOMAIN,
};

const LAYER_COUNT = OCEAN_DEPTH_INTERFACES_M.length - 1;
const LAYER_THICKNESS_M = Float64Array.from(
  { length: LAYER_COUNT },
  (_, index) => OCEAN_DEPTH_INTERFACES_M[index + 1] - OCEAN_DEPTH_INTERFACES_M[index],
);
const LAYER_MIDPOINT_M = Float64Array.from(
  { length: LAYER_COUNT },
  (_, index) =>
    (OCEAN_DEPTH_INTERFACES_M[index] + OCEAN_DEPTH_INTERFACES_M[index + 1]) / 2,
);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`upper-ocean: non-finite ${label}`);
  return value;
}

function assertParameters(parameters: Readonly<UpperOceanParameters>): void {
  if (parameters.bulkRichardsonCritical < 0.55 || parameters.bulkRichardsonCritical > 0.75) {
    throw new Error('upper-ocean: bulk Richardson critical outside locked range');
  }
  if (
    parameters.momentumDampingInertialPeriods < 1 ||
    parameters.momentumDampingInertialPeriods > 5
  ) {
    throw new Error('upper-ocean: momentum damping outside locked range');
  }
  if (parameters.thermalRecoveryHours < 120 || parameters.thermalRecoveryHours > 720) {
    throw new Error('upper-ocean: thermal recovery outside locked range');
  }
}

export function seawaterDensityKgM3(temperatureC: number, salinityPsu: number): number {
  return (
    OCEAN.RHO0_KG_M3 *
    (1 -
      OCEAN.THERMAL_EXPANSION_PER_C *
        (temperatureC - OCEAN.REFERENCE_TEMPERATURE_C) +
      OCEAN.HALINE_CONTRACTION_PER_PSU *
        (salinityPsu - OCEAN.REFERENCE_SALINITY_PSU))
  );
}

export function dragCoefficient(windSpeedMs: number): number {
  const speed = Math.max(0, windSpeedMs);
  if (speed <= 11) return 1.2e-3;
  if (speed < 25) return (0.49 + 0.065 * speed) * 1e-3;
  return 2.115e-3;
}

export function localInertialPeriodH(latitude: number): number {
  const coriolis = 2 * OCEAN.OMEGA_RAD_S * Math.sin((Math.abs(latitude) * Math.PI) / 180);
  return coriolis <= 1e-12 ? Infinity : (2 * Math.PI) / coriolis / 3600;
}

export function oceanHeatContentKjCm2(temperatureC: ArrayLike<number>): number {
  let degreeMetres = 0;
  for (let index = 0; index < LAYER_COUNT; index += 1) {
    degreeMetres +=
      Math.max(0, temperatureC[index] - OCEAN.OHC_THRESHOLD_C) *
      LAYER_THICKNESS_M[index];
  }
  return (
    (OCEAN.RHO0_KG_M3 * OCEAN.CP_J_KG_K * degreeMetres) /
    OCEAN.J_M2_PER_KJ_CM2
  );
}

function isothermDepthM(temperatureC: ArrayLike<number>, thresholdC: number): number {
  if (temperatureC[0] < thresholdC) return 0;
  for (let index = 1; index < LAYER_COUNT; index += 1) {
    if (temperatureC[index] < thresholdC) {
      const warm = temperatureC[index - 1];
      const cold = temperatureC[index];
      const fraction = clamp((warm - thresholdC) / Math.max(1e-12, warm - cold), 0, 1);
      return LAYER_MIDPOINT_M[index - 1] +
        fraction * (LAYER_MIDPOINT_M[index] - LAYER_MIDPOINT_M[index - 1]);
    }
  }
  return OCEAN_DEPTH_INTERFACES_M.at(-1)!;
}

/** Diagnose the retained mixed slab using the locked 0.03 kg/m3 density rule. */
export function diagnoseMixedLayerLastIndex(profile: OceanProfile): number {
  const referenceIndex = 1; // 5-10 m layer; its lower interface is exactly 10 m.
  const referenceDensity = seawaterDensityKgM3(
    profile.temperatureC[referenceIndex],
    profile.salinityPsu[referenceIndex],
  );
  for (let index = referenceIndex + 1; index < LAYER_COUNT; index += 1) {
    const density = seawaterDensityKgM3(
      profile.temperatureC[index],
      profile.salinityPsu[index],
    );
    if (density - referenceDensity >= OCEAN.MLD_DENSITY_DELTA_KG_M3) {
      return Math.max(referenceIndex, index - 1);
    }
  }
  return LAYER_COUNT - 1;
}

/**
 * Construct a stable climatological fallback profile that exactly preserves
 * the supplied surface temperature and approximately matches supplied OHC26.
 * Real WOA/analysis profiles can be injected through createColumnForTesting;
 * this fallback keeps degraded/offline runs finite and explicitly labelled.
 */
export function profileFromSstAndOhc(sstC: number, ohcKjCm2: number): OceanProfile {
  const surface = clamp(finite(sstC, 'background SST'), -2, 36);
  const targetOhc = clamp(finite(ohcKjCm2, 'background OHC'), 0, 250);
  const nominalMldM = clamp(8 + targetOhc * 0.25, 10, 70);

  function temperatures(gradientCPerM: number): Float64Array {
    return Float64Array.from(LAYER_MIDPOINT_M, (depth) => {
      if (depth <= nominalMldM) return surface;
      const below = depth - nominalMldM;
      // Arabian Sea water near 300 m is typically thermocline water, not a
      // deep-ocean 4 C mass. A 12 C floor keeps the degraded analytic profile
      // within that basin-scale envelope; real WOA/analysis profiles bypass it.
      return Math.max(12, surface - gradientCPerM * below - 0.00002 * below * below);
    });
  }

  let low = 0.002;
  // Do not manufacture a thermocline cliff to force an internally inconsistent
  // scalar SST/OHC pair to match. 0.12 C/m is already a very sharp tropical
  // thermocline; the retained profile is the physical state and its recomputed
  // OHC is authoritative after initialization.
  let high = 0.12;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const middle = (low + high) / 2;
    if (oceanHeatContentKjCm2(temperatures(middle)) > targetOhc) low = middle;
    else high = middle;
  }
  const temperatureC = temperatures((low + high) / 2);
  const salinityPsu = Float64Array.from(LAYER_MIDPOINT_M, (depth) =>
    clamp(35.7 + 0.0045 * depth, 20, 45),
  );
  return { temperatureC, salinityPsu };
}

function weightedMean(values: ArrayLike<number>, lastIndex: number): number {
  let total = 0;
  let weight = 0;
  for (let index = 0; index <= lastIndex; index += 1) {
    total += values[index] * LAYER_THICKNESS_M[index];
    weight += LAYER_THICKNESS_M[index];
  }
  return total / weight;
}

function ledger(values: ArrayLike<number>, scale = 1): number {
  let total = 0;
  for (let index = 0; index < LAYER_COUNT; index += 1) {
    total += values[index] * LAYER_THICKNESS_M[index] * scale;
  }
  return total;
}

function relativeError(before: number, after: number): number {
  return Math.abs(after - before) / Math.max(1, Math.abs(before), Math.abs(after));
}

/** Mix [0, lastIndex] in place and prove heat/salt/momentum closure. */
export function homogenizeProfile(
  temperatureC: Float64Array,
  salinityPsu: Float64Array,
  currentUms: Float64Array,
  currentVms: Float64Array,
  lastIndex: number,
): void {
  const capped = Math.min(LAYER_COUNT - 1, Math.max(0, lastIndex));
  const before = [
    ledger(temperatureC, OCEAN.RHO0_KG_M3 * OCEAN.CP_J_KG_K),
    ledger(salinityPsu),
    ledger(currentUms, OCEAN.RHO0_KG_M3),
    ledger(currentVms, OCEAN.RHO0_KG_M3),
  ];
  const means = [
    weightedMean(temperatureC, capped),
    weightedMean(salinityPsu, capped),
    weightedMean(currentUms, capped),
    weightedMean(currentVms, capped),
  ];
  for (let index = 0; index <= capped; index += 1) {
    temperatureC[index] = means[0];
    salinityPsu[index] = means[1];
    currentUms[index] = means[2];
    currentVms[index] = means[3];
  }
  const after = [
    ledger(temperatureC, OCEAN.RHO0_KG_M3 * OCEAN.CP_J_KG_K),
    ledger(salinityPsu),
    ledger(currentUms, OCEAN.RHO0_KG_M3),
    ledger(currentVms, OCEAN.RHO0_KG_M3),
  ];
  for (let index = 0; index < before.length; index += 1) {
    if (relativeError(before[index], after[index]) > 1e-8) {
      throw new Error(`upper-ocean: conservative mixing ledger ${index} failed`);
    }
  }
}

function partiallyMixAdjacent(
  values: Float64Array,
  upper: number,
  lower: number,
  fraction: number,
): void {
  const upperWeight = LAYER_THICKNESS_M[upper];
  const lowerWeight = LAYER_THICKNESS_M[lower];
  const totalWeight = upperWeight + lowerWeight;
  const difference = values[lower] - values[upper];
  values[upper] +=
    fraction * difference * (lowerWeight / totalWeight);
  values[lower] -=
    fraction * difference * (upperWeight / totalWeight);
}

/**
 * PWP gradient-Richardson relaxation. The least-stable adjacent pair is mixed
 * only far enough to move above the fixed 0.25 threshold, then the profile is
 * rescanned. Thickness weighting extends the reference equal-layer algorithm
 * while preserving all four column ledgers.
 */
export function relaxGradientRichardson(
  temperatureC: Float64Array,
  salinityPsu: Float64Array,
  currentUms: Float64Array,
  currentVms: Float64Array,
): number {
  const before = [
    ledger(temperatureC, OCEAN.RHO0_KG_M3 * OCEAN.CP_J_KG_K),
    ledger(salinityPsu),
    ledger(currentUms, OCEAN.RHO0_KG_M3),
    ledger(currentVms, OCEAN.RHO0_KG_M3),
  ];
  let iterations = 0;
  let lastMinimumRi = Infinity;
  let lastMinimumIndex = -1;
  for (; iterations < 16384; iterations += 1) {
    let minimumRi = Infinity;
    let minimumIndex = -1;
    for (let upper = 0; upper < LAYER_COUNT - 1; upper += 1) {
      const lower = upper + 1;
      const densityUpper = seawaterDensityKgM3(
        temperatureC[upper],
        salinityPsu[upper],
      );
      const densityLower = seawaterDensityKgM3(
        temperatureC[lower],
        salinityPsu[lower],
      );
      const shearSquared =
        (currentUms[lower] - currentUms[upper]) ** 2 +
        (currentVms[lower] - currentVms[upper]) ** 2;
      if (shearSquared < 1e-10) continue;
      const separationM = LAYER_MIDPOINT_M[lower] - LAYER_MIDPOINT_M[upper];
      const ri =
        (OCEAN.GRAVITY_MS2 *
          separationM *
          ((densityLower - densityUpper) / densityUpper)) /
        shearSquared;
      if (ri < minimumRi) {
        minimumRi = ri;
        minimumIndex = upper;
      }
    }
    if (
      minimumIndex < 0 ||
      minimumRi > OCEAN.GRADIENT_RICHARDSON_CRITICAL
    ) {
      break;
    }
    lastMinimumRi = minimumRi;
    lastMinimumIndex = minimumIndex;
    const excess =
      0.02 +
      (OCEAN.GRADIENT_RICHARDSON_CRITICAL - minimumRi) / 2;
    const targetRi =
      OCEAN.GRADIENT_RICHARDSON_CRITICAL + excess / 5;
    const fraction = clamp(1 - minimumRi / targetRi, 0, 1);
    for (const values of [
      temperatureC,
      salinityPsu,
      currentUms,
      currentVms,
    ]) {
      partiallyMixAdjacent(
        values,
        minimumIndex,
        minimumIndex + 1,
        fraction,
      );
    }
  }
  if (iterations >= 16384) {
    throw new Error(
      `upper-ocean: gradient Richardson mixing did not converge ` +
        `(Ri=${lastMinimumRi}, pair=${lastMinimumIndex}/${lastMinimumIndex + 1})`,
    );
  }
  const after = [
    ledger(temperatureC, OCEAN.RHO0_KG_M3 * OCEAN.CP_J_KG_K),
    ledger(salinityPsu),
    ledger(currentUms, OCEAN.RHO0_KG_M3),
    ledger(currentVms, OCEAN.RHO0_KG_M3),
  ];
  for (let index = 0; index < before.length; index += 1) {
    if (relativeError(before[index], after[index]) > 1e-8) {
      throw new Error(`upper-ocean: gradient mixing ledger ${index} failed`);
    }
  }
  return iterations;
}

function bearingAndDistance(
  center: Pick<OceanStormSnapshot, 'lat' | 'lon'>,
  point: { lat: number; lon: number },
): { bearingDeg: number; distanceKm: number; radialEast: number; radialNorth: number } {
  const northKm = (point.lat - center.lat) * 111.32;
  const eastKm =
    (point.lon - center.lon) *
    111.32 *
    Math.cos((((point.lat + center.lat) * 0.5) * Math.PI) / 180);
  const norm = Math.max(1e-12, Math.hypot(eastKm, northKm));
  return {
    bearingDeg: (Math.atan2(eastKm, northKm) * 180) / Math.PI,
    distanceKm: norm,
    radialEast: eastKm / norm,
    radialNorth: northKm / norm,
  };
}

/** Earth-relative surface vector derived from the shared Holland structure. */
export function stormSurfaceWindMs(
  storm: OceanStormSnapshot,
  lat: number,
  lon: number,
): { u: number; v: number; speed: number } {
  const geometry = bearingAndDistance(storm, { lat, lon });
  const speed =
    hollandWindSpeedKt(geometry.distanceKm, geometry.bearingDeg, storm.structure) *
    0.514444 *
    OCEAN.STRESS_WIND_AVERAGING_FACTOR;
  // Northern Hemisphere circulation is counter-clockwise: left of the radial
  // vector. Translation and shear asymmetry are already present in local speed.
  return {
    u: -geometry.radialNorth * speed,
    v: geometry.radialEast * speed,
    speed,
  };
}

function cloneProfile(profile: OceanProfile): OceanProfile {
  return {
    temperatureC: Float64Array.from(profile.temperatureC),
    salinityPsu: Float64Array.from(profile.salinityPsu),
  };
}

function adjustProfileSurface(
  profile: OceanProfile,
  targetSurfaceSstC: number,
): OceanProfile {
  const adjusted = cloneProfile(profile);
  const mixedLast = diagnoseMixedLayerLastIndex(adjusted);
  const mixedBottomM = OCEAN_DEPTH_INTERFACES_M[mixedLast + 1];
  const deltaC = targetSurfaceSstC - adjusted.temperatureC[0];
  for (let index = 0; index < LAYER_COUNT; index += 1) {
    const depthM = LAYER_MIDPOINT_M[index];
    const weight =
      index <= mixedLast
        ? 1
        : clamp(1 - (depthM - mixedBottomM) / 20, 0, 1);
    adjusted.temperatureC[index] += deltaC * weight;
  }
  return adjusted;
}

export class SparseUpperOcean {
  readonly parameters: Readonly<UpperOceanParameters>;
  private columns = new Map<number, OceanColumn>();
  private profileCache = new Map<string, OceanProfile>();
  private forcingHistory: OceanForcingStep[] = [];
  private isLand: (lat: number, lon: number) => boolean = () => false;
  private background: OceanBackgroundSampler = () => ({
    sstC: 28,
    ohcKjCm2: 60,
    initializationTier: 'analytic-fallback',
  });

  constructor(parameters: Partial<UpperOceanParameters> = {}) {
    this.parameters = Object.freeze({
      ...DEFAULT_UPPER_OCEAN_PARAMETERS,
      ...parameters,
    });
    assertParameters(this.parameters);
  }

  reset(background: OceanBackgroundSampler): void {
    this.columns.clear();
    this.profileCache.clear();
    this.forcingHistory = [];
    this.isLand = () => false;
    this.background = background;
  }

  get activeColumnCount(): number {
    return this.columns.size;
  }

  private key(col: number, row: number): number {
    return row * OCEAN_GRID.nx + col;
  }

  private cell(lat: number, lon: number): { col: number; row: number } {
    const at = latLonToCell(OCEAN_GRID, lat, lon);
    return {
      col: clamp(Math.round(at.col), 0, OCEAN_GRID.nx - 1),
      row: clamp(Math.round(at.row), 0, OCEAN_GRID.ny - 1),
    };
  }

  private createColumn(col: number, row: number, ageH: number): OceanColumn {
    const point = cellToLatLon(OCEAN_GRID, col, row);
    const sampled = this.background(point.lat, point.lon);
    const background: OceanBackgroundSample = {
      sstC: finite(sampled.sstC, 'sampled SST'),
      ohcKjCm2: finite(sampled.ohcKjCm2, 'sampled OHC'),
      initializationTier: sampled.initializationTier ?? 'analytic-fallback',
      sourceValidTime: sampled.sourceValidTime,
      profile: sampled.profile,
    };
    let profile: OceanProfile;
    if (background.profile) {
      profile = adjustProfileSurface(background.profile, background.sstC);
    } else {
      const profileKey = `${background.sstC.toFixed(2)}:${background.ohcKjCm2.toFixed(2)}`;
      let cachedProfile = this.profileCache.get(profileKey);
      if (!cachedProfile) {
        cachedProfile = profileFromSstAndOhc(background.sstC, background.ohcKjCm2);
        this.profileCache.set(profileKey, cachedProfile);
      }
      profile = cloneProfile(cachedProfile);
    }
    const retained = cloneProfile(profile);
    return {
      lat: point.lat,
      lon: point.lon,
      background,
      backgroundTemperatureC: retained.temperatureC,
      backgroundSalinityPsu: retained.salinityPsu,
      temperatureC: Float64Array.from(profile.temperatureC),
      salinityPsu: Float64Array.from(profile.salinityPsu),
      currentUms: new Float64Array(LAYER_COUNT),
      currentVms: new Float64Array(LAYER_COUNT),
      mixedLayerLastIndex: diagnoseMixedLayerLastIndex(profile),
      calmHours: 0,
      lastUpdateH: ageH,
      cumulativeMixingHeatJm2: 0,
      cumulativeRecoveryHeatJm2: 0,
      lastWindStressPa: 0,
      lastBulkRichardson: null,
      lastEntrainmentDepthM: OCEAN_DEPTH_INTERFACES_M[diagnoseMixedLayerLastIndex(profile) + 1],
      lastHeatMovedJm2: 0,
      forcingCursor: 0,
    };
  }

  /** Test/analysis seam for real WOA/GLORYS profiles and invariant fixtures. */
  createColumnForTesting(
    lat: number,
    lon: number,
    profile: OceanProfile,
    ageH = 0,
  ): void {
    if (profile.temperatureC.length !== LAYER_COUNT || profile.salinityPsu.length !== LAYER_COUNT) {
      throw new Error(`upper-ocean: profile must contain ${LAYER_COUNT} layers`);
    }
    const at = this.cell(lat, lon);
    const point = cellToLatLon(OCEAN_GRID, at.col, at.row);
    const retained = cloneProfile(profile);
    this.columns.set(this.key(at.col, at.row), {
      lat: point.lat,
      lon: point.lon,
      background: {
        sstC: profile.temperatureC[0],
        ohcKjCm2: oceanHeatContentKjCm2(profile.temperatureC),
        initializationTier: 'event-analysis',
      },
      backgroundTemperatureC: retained.temperatureC,
      backgroundSalinityPsu: retained.salinityPsu,
      temperatureC: Float64Array.from(profile.temperatureC),
      salinityPsu: Float64Array.from(profile.salinityPsu),
      currentUms: new Float64Array(LAYER_COUNT),
      currentVms: new Float64Array(LAYER_COUNT),
      mixedLayerLastIndex: diagnoseMixedLayerLastIndex(profile),
      calmHours: 0,
      lastUpdateH: ageH,
      cumulativeMixingHeatJm2: 0,
      cumulativeRecoveryHeatJm2: 0,
      lastWindStressPa: 0,
      lastBulkRichardson: null,
      lastEntrainmentDepthM: OCEAN_DEPTH_INTERFACES_M[diagnoseMixedLayerLastIndex(profile) + 1],
      lastHeatMovedJm2: 0,
      forcingCursor: 0,
    });
  }

  private getColumn(col: number, row: number, ageH: number): OceanColumn {
    const key = this.key(col, row);
    let column = this.columns.get(key);
    if (!column) {
      column = this.createColumn(col, row, ageH);
      this.columns.set(key, column);
    }
    return column;
  }

  private rotateAndDamp(column: OceanColumn, dtH: number): void {
    if (dtH <= 0) return;
    const coriolis =
      2 * OCEAN.OMEGA_RAD_S * Math.sin((column.lat * Math.PI) / 180);
    const angle = coriolis * dtH * 3600;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const inertialH = localInertialPeriodH(column.lat);
    const damping = Number.isFinite(inertialH)
      ? Math.exp(-dtH / (this.parameters.momentumDampingInertialPeriods * inertialH))
      : 1;
    for (let index = 0; index < LAYER_COUNT; index += 1) {
      const u = column.currentUms[index];
      const v = column.currentVms[index];
      column.currentUms[index] = (u * cosine + v * sine) * damping;
      column.currentVms[index] = (-u * sine + v * cosine) * damping;
    }
  }

  private advanceUnforced(column: OceanColumn, toAgeH: number): void {
    const dtH = Math.max(0, toAgeH - column.lastUpdateH);
    if (dtH <= 0) return;
    this.rotateAndDamp(column, dtH);
    const recoveryBefore = Math.max(0, column.calmHours - OCEAN.RECOVERY_DELAY_H);
    column.calmHours += dtH;
    const recoveryAfter = Math.max(0, column.calmHours - OCEAN.RECOVERY_DELAY_H);
    const recoveryH = recoveryAfter - recoveryBefore;
    if (recoveryH > 0) {
      const retained = Math.exp(-recoveryH / this.parameters.thermalRecoveryHours);
      let heatDelta = 0;
      for (let index = 0; index < LAYER_COUNT; index += 1) {
        const before = column.temperatureC[index];
        const after =
          column.backgroundTemperatureC[index] +
          (before - column.backgroundTemperatureC[index]) * retained;
        column.temperatureC[index] = after;
        heatDelta +=
          OCEAN.RHO0_KG_M3 *
          OCEAN.CP_J_KG_K *
          (after - before) *
          LAYER_THICKNESS_M[index];
      }
      column.cumulativeRecoveryHeatJm2 += heatDelta;
      column.mixedLayerLastIndex = diagnoseMixedLayerLastIndex({
        temperatureC: column.temperatureC,
        salinityPsu: column.salinityPsu,
      });
    }
    column.lastWindStressPa = 0;
    column.lastHeatMovedJm2 = 0;
    column.lastUpdateH = toAgeH;
  }

  private forceColumnStep(
    column: OceanColumn,
    windUms: number,
    windVms: number,
    dtH: number,
    endAgeH: number,
  ): void {
    this.advanceUnforced(column, endAgeH - dtH);
    this.rotateAndDamp(column, dtH);
    const speed = Math.hypot(windUms, windVms);
    column.lastHeatMovedJm2 = 0;
    column.lastEntrainmentDepthM =
      OCEAN_DEPTH_INTERFACES_M[column.mixedLayerLastIndex + 1];
    if (speed < OCEAN.MIN_ACTIVE_WIND_MS) {
      column.calmHours += dtH;
      column.lastWindStressPa = 0;
      column.lastBulkRichardson = null;
      column.lastUpdateH = endAgeH;
      return;
    }
    column.calmHours = 0;
    const stressScale = OCEAN.RHO_AIR_KG_M3 * dragCoefficient(speed) * speed;
    const stressU = stressScale * windUms;
    const stressV = stressScale * windVms;
    column.lastWindStressPa = Math.hypot(stressU, stressV);
    const mixedDepthM = OCEAN_DEPTH_INTERFACES_M[column.mixedLayerLastIndex + 1];
    const seconds = dtH * 3600;
    const deltaU = (stressU * seconds) / (OCEAN.RHO0_KG_M3 * mixedDepthM);
    const deltaV = (stressV * seconds) / (OCEAN.RHO0_KG_M3 * mixedDepthM);
    for (let index = 0; index <= column.mixedLayerLastIndex; index += 1) {
      column.currentUms[index] += deltaU;
      column.currentVms[index] += deltaV;
    }

    while (column.mixedLayerLastIndex < LAYER_COUNT - 1) {
      const mixed = column.mixedLayerLastIndex;
      const below = mixed + 1;
      const mixedT = weightedMean(column.temperatureC, mixed);
      const mixedS = weightedMean(column.salinityPsu, mixed);
      const mixedU = weightedMean(column.currentUms, mixed);
      const mixedV = weightedMean(column.currentVms, mixed);
      const rhoMixed = seawaterDensityKgM3(mixedT, mixedS);
      const rhoBelow = seawaterDensityKgM3(
        column.temperatureC[below],
        column.salinityPsu[below],
      );
      const shearSquared =
        (mixedU - column.currentUms[below]) ** 2 +
        (mixedV - column.currentVms[below]) ** 2;
      const depthM = OCEAN_DEPTH_INTERFACES_M[mixed + 1];
      const unstable = rhoBelow < rhoMixed;
      const bulkRichardson =
        !unstable && shearSquared < 1e-8
          ? Infinity
          : (OCEAN.GRAVITY_MS2 * depthM * (rhoBelow - rhoMixed)) /
            (OCEAN.RHO0_KG_M3 * Math.max(shearSquared, Number.MIN_VALUE));
      column.lastBulkRichardson = Number.isFinite(bulkRichardson)
        ? bulkRichardson
        : null;
      if (!unstable && bulkRichardson >= this.parameters.bulkRichardsonCritical) break;

      let mixedHeatBefore = 0;
      for (let index = 0; index <= mixed; index += 1) {
        mixedHeatBefore +=
          OCEAN.RHO0_KG_M3 *
          OCEAN.CP_J_KG_K *
          column.temperatureC[index] *
          LAYER_THICKNESS_M[index];
      }
      homogenizeProfile(
        column.temperatureC,
        column.salinityPsu,
        column.currentUms,
        column.currentVms,
        below,
      );
      column.mixedLayerLastIndex = below;
      let mixedHeatAfter = 0;
      for (let index = 0; index <= mixed; index += 1) {
        mixedHeatAfter +=
          OCEAN.RHO0_KG_M3 *
          OCEAN.CP_J_KG_K *
          column.temperatureC[index] *
          LAYER_THICKNESS_M[index];
      }
      const heatMoved = Math.max(0, mixedHeatBefore - mixedHeatAfter);
      column.lastHeatMovedJm2 += heatMoved;
      column.cumulativeMixingHeatJm2 += heatMoved;
      column.lastEntrainmentDepthM = OCEAN_DEPTH_INTERFACES_M[below + 1];
    }

    const surfaceSlabLast = column.mixedLayerLastIndex;
    let surfaceHeatBeforeGradient = 0;
    for (let index = 0; index <= surfaceSlabLast; index += 1) {
      surfaceHeatBeforeGradient +=
        OCEAN.RHO0_KG_M3 *
        OCEAN.CP_J_KG_K *
        column.temperatureC[index] *
        LAYER_THICKNESS_M[index];
    }
    relaxGradientRichardson(
      column.temperatureC,
      column.salinityPsu,
      column.currentUms,
      column.currentVms,
    );
    let surfaceHeatAfterGradient = 0;
    for (let index = 0; index <= surfaceSlabLast; index += 1) {
      surfaceHeatAfterGradient +=
        OCEAN.RHO0_KG_M3 *
        OCEAN.CP_J_KG_K *
        column.temperatureC[index] *
        LAYER_THICKNESS_M[index];
    }
    const gradientHeatMoved = Math.max(
      0,
      surfaceHeatBeforeGradient - surfaceHeatAfterGradient,
    );
    column.lastHeatMovedJm2 += gradientHeatMoved;
    column.cumulativeMixingHeatJm2 += gradientHeatMoved;
    column.mixedLayerLastIndex = diagnoseMixedLayerLastIndex({
      temperatureC: column.temperatureC,
      salinityPsu: column.salinityPsu,
    });

    column.lastUpdateH = endAgeH;
  }

  private forceColumn(
    column: OceanColumn,
    windUms: number,
    windVms: number,
    dtH: number,
    endAgeH: number,
  ): void {
    // Ocean mixing thresholds are nonlinear. A fixed maximum five-minute
    // substep makes 5/15/30-minute callers converge without changing the
    // atmosphere's locked 15-minute coupling cadence.
    const steps = Math.max(1, Math.ceil(dtH / (5 / 60)));
    const substepH = dtH / steps;
    const startAgeH = endAgeH - dtH;
    for (let step = 0; step < steps; step += 1) {
      this.forceColumnStep(
        column,
        windUms,
        windVms,
        substepH,
        startAgeH + (step + 1) * substepH,
      );
    }
  }

  forceSegment(
    previous: OceanStormSnapshot,
    next: OceanStormSnapshot,
    dtH: number,
    endAgeH: number,
    isLand: (lat: number, lon: number) => boolean,
  ): void {
    if (dtH <= 0) return;
    this.isLand = isLand;
    this.forcingHistory.push({
      previous: {
        lat: previous.lat,
        lon: previous.lon,
        structure: cloneStormStructure(previous.structure),
      },
      next: {
        lat: next.lat,
        lon: next.lon,
        structure: cloneStormStructure(next.structure),
      },
      dtH,
      endAgeH,
    });
  }

  /**
   * Apply only the wind history that can affect a queried column. This lazy
   * Eulerian evaluation is mathematically identical to stepping every cell,
   * but avoids visiting ~24,000 unaffected columns on every 15-minute tick.
   * It is what keeps deterministic 20–80 member ensembles browser-feasible.
   */
  private applyPendingForcing(column: OceanColumn, throughAgeH: number): void {
    if (this.isLand(column.lat, column.lon)) {
      column.forcingCursor = this.forcingHistory.length;
      this.advanceUnforced(column, throughAgeH);
      return;
    }
    while (column.forcingCursor < this.forcingHistory.length) {
      const forcing = this.forcingHistory[column.forcingCursor];
      if (forcing.endAgeH > throughAgeH + 1e-9) break;
      const before = stormSurfaceWindMs(
        forcing.previous,
        column.lat,
        column.lon,
      );
      const after = stormSurfaceWindMs(
        forcing.next,
        column.lat,
        column.lon,
      );
      const windUms = (before.u + after.u) * 0.5;
      const windVms = (before.v + after.v) * 0.5;
      if (Math.hypot(windUms, windVms) >= OCEAN.MIN_ACTIVE_WIND_MS) {
        this.forceColumn(
          column,
          windUms,
          windVms,
          forcing.dtH,
          forcing.endAgeH,
        );
      }
      column.forcingCursor += 1;
    }
  }

  sample(lat: number, lon: number, ageH: number): OceanColumnDiagnostics {
    const at = this.cell(lat, lon);
    const column = this.getColumn(at.col, at.row, 0);
    this.applyPendingForcing(column, ageH);
    this.advanceUnforced(column, ageH);
    const lastMixed = column.mixedLayerLastIndex;
    const currentU = weightedMean(column.currentUms, lastMixed);
    const currentV = weightedMean(column.currentVms, lastMixed);
    const surfaceSstC = column.temperatureC[0];
    const coolingC = Math.max(0, column.background.sstC - surfaceSstC);
    const hardBoundFlag =
      !Number.isFinite(surfaceSstC) ||
      surfaceSstC < -2 ||
      surfaceSstC > 36 ||
      coolingC > OCEAN.MAX_COOLING_C ||
      column.salinityPsu.some((value) => value < 20 || value > 45);
    if (hardBoundFlag) {
      throw new Error(
        `upper-ocean: diagnostic hard-bound failure at ${column.lat.toFixed(2)},` +
          `${column.lon.toFixed(2)} (SST=${surfaceSstC.toFixed(3)}, ` +
          `cooling=${coolingC.toFixed(3)}, MLD=${OCEAN_DEPTH_INTERFACES_M[lastMixed + 1]})`,
      );
    }
    return {
      initializationTier: column.background.initializationTier ?? 'analytic-fallback',
      sourceValidTime: column.background.sourceValidTime ?? null,
      backgroundSstC: column.background.sstC,
      surfaceSstC,
      coolingC,
      mixedLayerDepthM: OCEAN_DEPTH_INTERFACES_M[lastMixed + 1],
      ohcKjCm2:
        Math.round(oceanHeatContentKjCm2(column.temperatureC) * 1e9) / 1e9,
      isotherm26DepthM: isothermDepthM(column.temperatureC, 26),
      temperatureBelowMixedLayerC:
        column.temperatureC[Math.min(LAYER_COUNT - 1, lastMixed + 1)],
      mixedLayerCurrentSpeedMs: Math.hypot(currentU, currentV),
      mixedLayerCurrentDirectionDeg:
        (Math.atan2(currentU, currentV) * 180) / Math.PI,
      inertialPeriodH: localInertialPeriodH(column.lat),
      windStressPa: column.lastWindStressPa,
      bulkRichardson: column.lastBulkRichardson,
      entrainmentDepthM: column.lastEntrainmentDepthM,
      heatMovedThisStepJm2: column.lastHeatMovedJm2,
      cumulativeMixingHeatJm2: column.cumulativeMixingHeatJm2,
      cumulativeRecoveryHeatJm2: column.cumulativeRecoveryHeatJm2,
      activeColumnCount: this.columns.size,
      hardBoundFlag,
      missingSourceFlag: column.background.initializationTier === 'analytic-fallback',
    };
  }

  /** Canonical replay/debug state; keys are sorted so identical runs serialize identically. */
  serialize(): string {
    const columns = [...this.columns.entries()]
      .sort(([left], [right]) => left - right)
      .map(([key, column]) => ({
        key,
        temperatureC: [...column.temperatureC],
        salinityPsu: [...column.salinityPsu],
        currentUms: [...column.currentUms],
        currentVms: [...column.currentVms],
        mixedLayerLastIndex: column.mixedLayerLastIndex,
        calmHours: column.calmHours,
        lastUpdateH: column.lastUpdateH,
        cumulativeMixingHeatJm2: column.cumulativeMixingHeatJm2,
        cumulativeRecoveryHeatJm2: column.cumulativeRecoveryHeatJm2,
        forcingCursor: column.forcingCursor,
      }));
    return JSON.stringify({
      schemaVersion: 1,
      parameters: this.parameters,
      forcingSteps: this.forcingHistory.length,
      columns,
    });
  }
}
