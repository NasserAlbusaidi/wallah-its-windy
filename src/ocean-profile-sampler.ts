/** Bilinear reader for the separate WOA23 temperature/salinity profile bin. */

import { envMonthSuffix } from './env-sampler';
import { sampleLayerBilinear } from './raster-sampler';
import type { ParsedBin } from './types';
import {
  OCEAN_DEPTH_INTERFACES_M,
  type OceanProfile,
} from './upper-ocean';

/** A profile plus the provenance of whatever actually supplied it. */
export interface OceanProfileSample {
  profile: OceanProfile;
  tier: 'event-analysis' | 'climatological-subsurface';
  sourceValidTime?: string;
}

/**
 * `null` means no profile was available. That is the ONLY state from which
 * 'analytic-fallback' may be inferred — a bare profile carries no provenance,
 * so the tier must travel with the data that justifies it.
 */
export type OceanProfileSampler = (
  lat: number,
  lon: number,
  monthIndex: number,
) => OceanProfileSample | null;

export function sampleOceanProfileBin(
  bin: ParsedBin | null,
  lat: number,
  lon: number,
  monthIndex: number,
): OceanProfileSample | null {
  if (!bin) return null;
  const suffix = envMonthSuffix(monthIndex);
  const profile = sampleProfileLayers(
    bin,
    `temp_${suffix}`,
    `salt_${suffix}`,
    lat,
    lon,
  );
  return profile
    ? { profile, tier: 'climatological-subsurface' }
    : null;
}

export function sampleEventOceanProfileBin(
  bin: ParsedBin | null,
  lat: number,
  lon: number,
  layerIndex: number,
): OceanProfileSample | null {
  if (!bin || !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 999) {
    return null;
  }
  const suffix = layerIndex.toString().padStart(3, '0');
  const profile = sampleProfileLayers(
    bin,
    `t${suffix}`,
    `s${suffix}`,
    lat,
    lon,
  );
  return profile ? { profile, tier: 'event-analysis' } : null;
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
