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

/**
 * Shared numerical floor, in KILOMETRES. Denominated in km, not clip units, so
 * it cannot rescale with the domain: as a clip literal 0.008 is 5.33 km today
 * and would be 13.3 km over a 0-30 N domain, overriding structure.ts's 12 km
 * rmwKm floor and re-coupling the canopy to the core.
 */
export const RENDER_RADIUS_FLOOR_KM = 5.328;

/**
 * The same floor in clip units — 5.328 / 666 is bit-exactly 0.008, so the GLSL
 * template literals in env.ts, cloud-motion.ts and cloud-memory.ts still emit
 * "0.008" and their digest pins are unaffected. Kept exported: six modules
 * consume it as a clip value.
 */
export const RENDER_RADIUS_FLOOR = RENDER_RADIUS_FLOOR_KM / HALF_DOMAIN_HEIGHT_KM;

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
  // Clamp in km, convert once. Because RENDER_RADIUS_FLOOR_KM /
  // HALF_DOMAIN_HEIGHT_KM is bit-exactly RENDER_RADIUS_FLOOR and the division
  // is monotone, this returns the identical double as the old clip-space form
  // for every input, including the floored branch.
  return {
    rMax:
      Math.max(RENDER_RADIUS_FLOOR_KM, structure.rmwKm) / HALF_DOMAIN_HEIGHT_KM,
    rCanopy:
      Math.max(RENDER_RADIUS_FLOOR_KM, structure.outerSizeKm) /
      HALF_DOMAIN_HEIGHT_KM,
  };
}
