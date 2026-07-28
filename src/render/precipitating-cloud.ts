/**
 * Shared geometry and intensity contract for cloud that accompanies the
 * simulator's instantaneous rain footprint.
 *
 * The broad CDO/cirrus canopy remains independent morphology. This module only
 * guarantees that radar-visible rain is not rendered beneath an implausibly
 * empty IR sky, and that every renderer uses the same displaced rain centre.
 */

import { DOMAIN, clipToLatLon, latLonToClip, offsetKm } from '../grid';
import type { ClipCoord, StormStructure } from '../types';

/** Rain rates at or below this threshold do not force visible cloud support. */
export const PRECIPITATING_CLOUD_RAIN_START_MM_H = 0.05;

/** Eyewall rain rate that reaches full forced-cloud support. */
export const PRECIPITATING_CLOUD_EYE_FULL_MM_H = 4;

/** Rainband rate that reaches full forced-cloud support. */
export const PRECIPITATING_CLOUD_BAND_FULL_MM_H = 1.5;

/** Preserve coherent texture without allowing an empty IR sky over rain. */
export const PRECIPITATING_CLOUD_TEXTURE_FLOOR = 0.55;

/** Keep the quieter side of each modeled spiral arm subtly cloud-bearing. */
export const PRECIPITATING_CLOUD_SPIRAL_FLOOR = 0.4;

/** Forced rainband support remains below an opaque CDO at its strongest. */
export const PRECIPITATING_CLOUD_BAND_MAX = 0.68;

type RainOffset = Pick<
  StormStructure,
  'rainOffsetEastKm' | 'rainOffsetNorthKm'
>;

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (!Number.isFinite(value) || value <= edge0) return 0;
  if (value >= edge1) return 1;
  const fraction = (value - edge0) / (edge1 - edge0);
  return fraction * fraction * (3 - 2 * fraction);
}

/** CPU mirror of the two GLSL rain-rate gates used by the IR shader. */
export function precipitatingCloudSupport(
  eyewallRainMmH: number,
  rainbandRainMmH: number,
): { eyewall: number; rainband: number } {
  return {
    eyewall: smoothstep(
      PRECIPITATING_CLOUD_RAIN_START_MM_H,
      PRECIPITATING_CLOUD_EYE_FULL_MM_H,
      eyewallRainMmH,
    ),
    rainband: smoothstep(
      PRECIPITATING_CLOUD_RAIN_START_MM_H,
      PRECIPITATING_CLOUD_BAND_FULL_MM_H,
      rainbandRainMmH,
    ),
  };
}

/**
 * Apply the structure model's east/north rain displacement to a storm centre.
 * The shared ground-distance helper avoids renderer-specific longitude
 * approximations and keeps radar, the render-side rain accumulator, and IR
 * aligned. The recorded impact ledger deliberately retains its existing math.
 */
export function rainCenterClip(
  center: ClipCoord,
  structure: RainOffset,
): ClipCoord {
  const distanceKm = Math.hypot(
    structure.rainOffsetEastKm,
    structure.rainOffsetNorthKm,
  );
  if (distanceKm <= 1e-6) return { ...center };

  const origin = clipToLatLon(center.x, center.y, DOMAIN);
  const shifted = offsetKm(
    origin.lat,
    origin.lon,
    structure.rainOffsetEastKm / distanceKm,
    structure.rainOffsetNorthKm / distanceKm,
    distanceKm,
  );
  return latLonToClip(shifted.lat, shifted.lon, DOMAIN);
}
