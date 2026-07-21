/** Continuous inner/outer-vortex land and terrain exposure for HF-2C. */

import { offsetKm } from './grid';

const BEARINGS_DEG = Object.freeze([
  0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
  180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
]);

export interface CoastalExposure {
  centerOverLand: boolean;
  coreLandFraction: number;
  outerLandFraction: number;
  meanLandElevationM: number;
  roughnessExposure: number;
}

function ring(
  lat: number,
  lon: number,
  radiusKm: number,
  isLand: (lat: number, lon: number) => boolean,
  terrainHeightM: (lat: number, lon: number) => number,
): { landFraction: number; landElevations: number[] } {
  let land = 0;
  const landElevations: number[] = [];
  for (const bearingDeg of BEARINGS_DEG) {
    const radians = (bearingDeg * Math.PI) / 180;
    const point = offsetKm(
      lat,
      lon,
      Math.sin(radians),
      Math.cos(radians),
      radiusKm,
    );
    if (isLand(point.lat, point.lon)) {
      land += 1;
      landElevations.push(Math.max(0, terrainHeightM(point.lat, point.lon)));
    }
  }
  return { landFraction: land / BEARINGS_DEG.length, landElevations };
}

export function sampleCoastalExposure(
  lat: number,
  lon: number,
  rmwKm: number,
  outerSizeKm: number,
  isLand: (lat: number, lon: number) => boolean,
  terrainHeightM: (lat: number, lon: number) => number = () => 0,
): CoastalExposure {
  const centerOverLand = isLand(lat, lon);
  const inner = ring(lat, lon, Math.max(5, rmwKm), isLand, terrainHeightM);
  const nearOuter = ring(
    lat,
    lon,
    Math.max(rmwKm * 1.5, outerSizeKm * 0.5),
    isLand,
    terrainHeightM,
  );
  const farOuter = ring(
    lat,
    lon,
    Math.max(rmwKm * 2, outerSizeKm),
    isLand,
    terrainHeightM,
  );
  const coreLandFraction = Math.min(
    1,
    0.5 * (centerOverLand ? 1 : 0) + 0.5 * inner.landFraction,
  );
  const outerLandFraction =
    0.35 * inner.landFraction +
    0.4 * nearOuter.landFraction +
    0.25 * farOuter.landFraction;
  const elevations = [
    ...inner.landElevations,
    ...nearOuter.landElevations,
    ...farOuter.landElevations,
  ];
  if (centerOverLand) elevations.push(Math.max(0, terrainHeightM(lat, lon)));
  const meanLandElevationM =
    elevations.length === 0
      ? 0
      : elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
  const terrainMultiplier = 1 + 0.4 * Math.min(1, meanLandElevationM / 1500);
  const roughnessExposure = Math.min(
    1,
    (0.75 * coreLandFraction + 0.25 * outerLandFraction) * terrainMultiplier,
  );
  return {
    centerOverLand,
    coreLandFraction,
    outerLandFraction,
    meanLandElevationM,
    roughnessExposure,
  };
}
