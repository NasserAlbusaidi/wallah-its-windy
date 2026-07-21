/** Bilinear reader for the separate WOA23 temperature/salinity profile bin. */

import { envMonthSuffix } from './env-sampler';
import { sampleLayerBilinear } from './raster-sampler';
import type { ParsedBin } from './types';
import {
  OCEAN_DEPTH_INTERFACES_M,
  type OceanProfile,
} from './upper-ocean';

export type OceanProfileSampler = (
  lat: number,
  lon: number,
  monthIndex: number,
) => OceanProfile | null;

export function sampleOceanProfileBin(
  bin: ParsedBin | null,
  lat: number,
  lon: number,
  monthIndex: number,
): OceanProfile | null {
  if (!bin) return null;
  const suffix = envMonthSuffix(monthIndex);
  return sampleProfileLayers(bin, `temp_${suffix}`, `salt_${suffix}`, lat, lon);
}

export function sampleEventOceanProfileBin(
  bin: ParsedBin | null,
  lat: number,
  lon: number,
  layerIndex: number,
): OceanProfile | null {
  if (!bin || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 999) {
    return null;
  }
  const suffix = layerIndex.toString().padStart(3, '0');
  return sampleProfileLayers(bin, `t${suffix}`, `s${suffix}`, lat, lon);
}

function sampleProfileLayers(
  bin: ParsedBin,
  temperatureName: string,
  salinityName: string,
  lat: number,
  lon: number,
): OceanProfile | null {
  const temperature = bin.layers.get(temperatureName);
  const salinity = bin.layers.get(salinityName);
  const expectedLevels = OCEAN_DEPTH_INTERFACES_M.length - 1;
  if (
    !temperature ||
    !salinity ||
    temperature.nt !== expectedLevels ||
    salinity.nt !== expectedLevels
  ) {
    return null;
  }
  const temperatureC = new Float64Array(expectedLevels);
  const salinityPsu = new Float64Array(expectedLevels);
  for (let level = 0; level < expectedLevels; level += 1) {
    temperatureC[level] = sampleLayerBilinear(
      temperature,
      level,
      lat,
      lon,
    );
    salinityPsu[level] = sampleLayerBilinear(salinity, level, lat, lon);
    if (
      !Number.isFinite(temperatureC[level]) ||
      !Number.isFinite(salinityPsu[level])
    ) {
      return null;
    }
  }
  return { temperatureC, salinityPsu };
}
