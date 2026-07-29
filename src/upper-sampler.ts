/**
 * Pure runtime sampling for the ERA5 200-hPa upper-wind sidecar.
 *
 * upper.bin carries alternative real-year synoptic planes aligned plane-for-plane
 * with env.bin. It has no event-timeline variant and no analytic fallback.
 */

import { envMonthSuffix } from './env-sampler';
import { sampleLayerBilinear } from './raster-sampler';
import type { BinLayer, EnvSamplingMode, ParsedBin } from './types';

export interface UpperWindSample {
  /** Eastward 200-hPa wind component, m/s. */
  uMs: number;
  /** Northward 200-hPa wind component, m/s. */
  vMs: number;
  speedMs: number;
  /** Meteorological direction FROM which the wind blows: 0° north, 90° east. */
  dirDeg: number;
}

export interface UpperWindLayers {
  u: BinLayer;
  v: BinLayer;
}

/** The single runtime resolver for upper.bin's month-suffixed component names. */
export function upperWindLayers(
  bin: ParsedBin | null,
  monthIndex: number,
): UpperWindLayers | null {
  if (!bin) return null;
  const suffix = envMonthSuffix(monthIndex);
  const u = bin.layers.get('u200_' + suffix);
  const v = bin.layers.get('v200_' + suffix);
  return u && v ? { u, v } : null;
}

function guardFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error('upper wind: ' + name + ' must be finite, got ' + value);
  }
  return value;
}

/**
 * Sample the plane-coherent environmental 200-hPa wind at a display point.
 * Event mode returns null by contract: no aligned event upper-air sidecar exists.
 */
export function sampleUpperWind(
  bin: ParsedBin,
  lat: number,
  lon: number,
  monthIndex: number,
  mode: EnvSamplingMode,
): UpperWindSample | null {
  if (mode.kind !== 'synoptic-plane') return null;
  const layers = upperWindLayers(bin, monthIndex);
  if (!layers) return null;
  const uMs = guardFinite(
    sampleLayerBilinear(layers.u, mode.plane, lat, lon),
    'uMs',
  );
  const vMs = guardFinite(
    sampleLayerBilinear(layers.v, mode.plane, lat, lon),
    'vMs',
  );
  const speedMs = guardFinite(Math.hypot(uMs, vMs), 'speedMs');
  const dirDeg = guardFinite(
    ((Math.atan2(-uMs, -vMs) * 180) / Math.PI + 360) % 360,
    'dirDeg',
  );
  return { uMs, vMs, speedMs, dirDeg };
}
