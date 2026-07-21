/**
 * HF-3 environmental steering and motion-budget helpers.
 *
 * The pressure-level sidecars contain temporally aligned, vortex-filtered
 * ERA5 winds. We still sample an eight-point environmental ring: Franklin et
 * al. (1996) found surrounding deep-layer flow near 3 degrees explained most
 * observed motion variance. Missing sidecars fall back to the existing baked
 * deep-layer wind without inventing pressure-level detail.
 */

import { DOMAIN, offsetKm } from './grid';
import { sampleLayerBilinear } from './raster-sampler';
import type {
  BinLayer,
  EnvSampler,
  EnvSamplingMode,
  ParsedBin,
  PressureLevelWinds,
  PressureWindSampler,
} from './types';

export interface SteeringWeights {
  w850: number;
  w500: number;
  w250: number;
}

export interface EnvironmentalSteering {
  u: number;
  v: number;
  annulusRadiusKm: number;
  weights: SteeringWeights;
  pressureLevelsAvailable: boolean;
  u850Contribution: number;
  v850Contribution: number;
  u500Contribution: number;
  v500Contribution: number;
  u250Contribution: number;
  v250Contribution: number;
}

export interface TerrainDrift {
  u: number;
  v: number;
  roughnessContrast: number;
}

export interface TimedPosition {
  iso: string;
  lat: number;
  lon: number;
}

const AZIMUTHS_DEG = [0, 45, 90, 135, 180, 225, 270, 315] as const;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Weak/shallow systems follow mostly 850 hPa flow. Intense, organized, and
 * poleward systems couple more deeply, but weights remain bounded and sum to 1.
 */
export function steeringWeights(
  maximumWindKt: number,
  organization: number,
  latitudeDeg: number,
): SteeringWeights {
  const intensity = clamp((maximumWindKt - 30) / 80, 0, 1);
  const organized = clamp(organization, 0, 1);
  const latitude = clamp((latitudeDeg - 15) / 12, 0, 1);
  const depth = clamp(0.6 * intensity + 0.3 * organized + 0.1 * latitude, 0, 1);
  const w850 = 0.68 - 0.23 * depth;
  const w250 = 0.04 + 0.17 * depth;
  const w500 = 1 - w850 - w250;
  return { w850, w500, w250 };
}

function environmentalRing(lat: number, lon: number, radiusKm: number) {
  return AZIMUTHS_DEG.map((bearingDeg) => {
    const radians = (bearingDeg * Math.PI) / 180;
    return offsetKm(lat, lon, Math.sin(radians), Math.cos(radians), radiusKm);
  });
}

/** Mean vortex-filtered environmental flow on a storm-size-aware ~3 degree ring. */
export function sampleEnvironmentalSteering(
  env: EnvSampler,
  pressureWinds: PressureWindSampler | undefined,
  lat: number,
  lon: number,
  monthIndex: number,
  tFrac: number,
  maximumWindKt: number,
  organization: number,
  outerSizeKm: number,
): EnvironmentalSteering {
  const annulusRadiusKm = clamp(Math.max(outerSizeKm * 1.35, 275), 275, 375);
  const points = environmentalRing(lat, lon, annulusRadiusKm);
  const weights = steeringWeights(maximumWindKt, organization, lat);
  const levels = pressureWinds
    ? points.map((point) => pressureWinds(point.lat, point.lon, monthIndex, tFrac))
    : [];
  const completeLevels =
    levels.length === points.length && levels.every((value) => value !== null);

  if (completeLevels) {
    const mean = (key: keyof PressureLevelWinds): number =>
      levels.reduce((sum, value) => sum + value![key], 0) / levels.length;
    const u850Contribution = mean('u850') * weights.w850;
    const v850Contribution = mean('v850') * weights.w850;
    const u500Contribution = mean('u500') * weights.w500;
    const v500Contribution = mean('v500') * weights.w500;
    const u250Contribution = mean('u250') * weights.w250;
    const v250Contribution = mean('v250') * weights.w250;
    return {
      u: u850Contribution + u500Contribution + u250Contribution,
      v: v850Contribution + v500Contribution + v250Contribution,
      annulusRadiusKm,
      weights,
      pressureLevelsAvailable: true,
      u850Contribution,
      v850Contribution,
      u500Contribution,
      v500Contribution,
      u250Contribution,
      v250Contribution,
    };
  }

  const samples = points.map((point) =>
    env.sample(point.lat, point.lon, monthIndex, tFrac),
  );
  const u = samples.reduce((sum, sample) => sum + sample.steerU, 0) / samples.length;
  const v = samples.reduce((sum, sample) => sum + sample.steerV, 0) / samples.length;
  return {
    u,
    v,
    annulusRadiusKm,
    weights,
    pressureLevelsAvailable: false,
    u850Contribution: 0,
    v850Contribution: 0,
    u500Contribution: u,
    v500Contribution: v,
    u250Contribution: 0,
    v250Contribution: 0,
  };
}

/**
 * Bounded differential-friction/terrain term. It is intentionally small and
 * separately diagnosed: this reduced-order correction cannot reproduce the
 * full potential-vorticity response of a cyclone crossing real topography.
 */
export function sampleTerrainDrift(
  lat: number,
  lon: number,
  outerSizeKm: number,
  isLand: (lat: number, lon: number) => boolean,
  terrainHeightM: ((lat: number, lon: number) => number) | undefined,
  maximumSpeedMs: number,
): TerrainDrift {
  if (maximumSpeedMs <= 0) return { u: 0, v: 0, roughnessContrast: 0 };
  const radiusKm = clamp(outerSizeKm, 80, 260);
  const roughness = (east: number, north: number): number => {
    const point = offsetKm(lat, lon, east, north, radiusKm);
    if (!isLand(point.lat, point.lon)) return 0;
    const elevation = Math.max(0, terrainHeightM?.(point.lat, point.lon) ?? 0);
    return 1 + 0.35 * clamp(elevation / 1500, 0, 1);
  };
  const east = roughness(1, 0);
  const west = roughness(-1, 0);
  const north = roughness(0, 1);
  const south = roughness(0, -1);
  const gradientEast = (east - west) / 2;
  const gradientNorth = (north - south) / 2;
  const contrast = Math.hypot(gradientEast, gradientNorth);
  if (contrast < 1e-9) return { u: 0, v: 0, roughnessContrast: 0 };
  // NH cyclonic rotation of the friction gradient plus a weaker component away
  // from higher terrain; the combined vector is normalized before bounding.
  const rawU = -gradientNorth - 0.25 * gradientEast;
  const rawV = gradientEast - 0.25 * gradientNorth;
  const magnitude = Math.hypot(rawU, rawV);
  const speed = maximumSpeedMs * clamp(contrast, 0, 1);
  return {
    u: (rawU / magnitude) * speed,
    v: (rawV / magnitude) * speed,
    roughnessContrast: contrast,
  };
}

/** Agency motion from the latest pre-initialization fix, never a future fix. */
export function observedInitialMotionMs(
  points: readonly TimedPosition[],
  initializationIso: string,
  maximumLookbackHours = 24,
): { u: number; v: number; lookbackHours: number } | null {
  const initializationTime = Date.parse(initializationIso);
  if (!Number.isFinite(initializationTime)) return null;
  const sorted = points
    .map((point) => ({ point, time: Date.parse(point.iso) }))
    .filter(({ time }) => Number.isFinite(time) && time <= initializationTime)
    .sort((a, b) => a.time - b.time);
  const current = sorted.filter(({ time }) => time === initializationTime).at(-1);
  if (!current) return null;
  const prior = sorted
    .filter(({ time }) => time < initializationTime)
    .filter(
      ({ time }) =>
        (initializationTime - time) / 3_600_000 <= maximumLookbackHours,
    )
    .at(-1);
  if (!prior) return null;
  const lookbackHours = (initializationTime - prior.time) / 3_600_000;
  if (!(lookbackHours > 0)) return null;
  const meanLatitudeRad =
    ((current.point.lat + prior.point.lat) * Math.PI) / 360;
  const eastKm =
    (current.point.lon - prior.point.lon) *
    111.195 *
    Math.cos(meanLatitudeRad);
  const northKm = (current.point.lat - prior.point.lat) * 111.195;
  return {
    u: (eastKm * 1000) / (lookbackHours * 3600),
    v: (northKm * 1000) / (lookbackHours * 3600),
    lookbackHours,
  };
}

function pickLayer(bin: ParsedBin, names: readonly string[]): BinLayer | null {
  for (const name of names) {
    const layer = bin.layers.get(name);
    if (layer) return layer;
  }
  return null;
}

function sampleLayer(
  layer: BinLayer,
  lat: number,
  lon: number,
  tFrac: number,
  mode: EnvSamplingMode,
): number {
  if (mode.kind === 'synoptic-plane') {
    return sampleLayerBilinear(
      layer,
      Math.min(layer.nt - 1, mode.plane),
      lat,
      lon,
    );
  }
  const position = clamp(tFrac * (layer.nt - 1), 0, layer.nt - 1);
  const first = Math.floor(position);
  const second = Math.min(layer.nt - 1, first + 1);
  const fraction = position - first;
  const a = sampleLayerBilinear(layer, first, lat, lon);
  const b = sampleLayerBilinear(layer, second, lat, lon);
  return a + (b - a) * fraction;
}

/** Build a CPU sampler for a versioned HF-3 pressure-wind sidecar. */
export function pressureWindSamplerFromBin(
  getBin: () => ParsedBin | null,
  getMode: () => EnvSamplingMode,
): PressureWindSampler {
  return (lat, lon, _monthIndex, tFrac) => {
    const bin = getBin();
    if (!bin) return null;
    const names = ['u850', 'v850', 'u500', 'v500', 'u250', 'v250'] as const;
    const layers = names.map((name) => pickLayer(bin, [name]));
    if (layers.some((layer) => layer === null)) return null;
    const la = clamp(lat, DOMAIN.latMin, DOMAIN.latMax);
    const lo = clamp(lon, DOMAIN.lonMin, DOMAIN.lonMax);
    const values = layers.map((layer) => sampleLayer(layer!, la, lo, tFrac, getMode()));
    return {
      u850: values[0],
      v850: values[1],
      u500: values[2],
      v500: values[3],
      u250: values[4],
      v250: values[5],
    };
  };
}
