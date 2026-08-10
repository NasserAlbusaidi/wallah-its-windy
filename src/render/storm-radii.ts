/**
 * Radial scales the cloud and rain shaders normalize by.
 *
 * The inner core (rMax) contracts as a storm intensifies; the canopy must not.
 * rCanopy is therefore a function of outerSizeKm ALONE — deliberately with no
 * rMax floor. An earlier design floored it against rMax as an "inversion
 * guard"; because structure.ts clamps rmwKm to [12,95] and outerSizeKm to
 * [60,420], that floor binds for broad weak storms and re-couples the canopy to
 * the contracting core, reintroducing the exact bug it was meant to prevent.
 * rCanopy < rMax is a real morphology (a broad ragged core), not an error.
 */

import type { StormStructure } from '../types';
import { HALF_DOMAIN_HEIGHT_KM, RENDER_KM_PER_LAT_DEG } from '../grid';

// grid.ts owns the km<->clip mapping (it owns clip space). Re-exported here so
// the twelve render and realism modules that already import it from this file
// keep working, and so docs/architecture.md's export list stays true.
export { HALF_DOMAIN_HEIGHT_KM, RENDER_KM_PER_LAT_DEG };

/** Shared numerical floor; matches the existing guards in env.ts and radar.ts. */
export const RENDER_RADIUS_FLOOR = 0.008;

/**
 * Reference outerSizeKm / rmwKm (180 / 40). Canopy coefficients are the former
 * rMax multiples divided by this, so the reference geometry is mathematically
 * unchanged. Rendered QA checks for implementation/precision drift.
 */
export const CANOPY_COEFFICIENT_DIVISOR = 4.5;

export interface StormRenderRadii {
  /** Inner core, clip units. Eye, eyewall, vortex wind, rainband envelopes. */
  rMax: number;
  /** Canopy, clip units. Central overcast, cirrus, canopy offset, noise space. */
  rCanopy: number;
}

export function stormRenderRadii(
  structure: Pick<StormStructure, 'rmwKm' | 'outerSizeKm'>,
): StormRenderRadii {
  return {
    rMax: Math.max(
      RENDER_RADIUS_FLOOR,
      structure.rmwKm / HALF_DOMAIN_HEIGHT_KM,
    ),
    rCanopy: Math.max(
      RENDER_RADIUS_FLOOR,
      structure.outerSizeKm / HALF_DOMAIN_HEIGHT_KM,
    ),
  };
}
