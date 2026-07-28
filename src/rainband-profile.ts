/**
 * The one rainband spatial contract shared by the three RAIN products:
 * src/render/radar.ts, src/render/rain.ts and src/impact.ts.
 *
 * src/render/env.ts is deliberately NOT a consumer. Its band is cloud
 * morphology, not a quantitative rain product, and it keeps its own
 * development-dependent outer radius and organization-dependent eyewall width.
 *
 * These values are INTERNALLY CONSISTENT, NOT VALIDATED against observed
 * rainfall. They exist so three products stop disagreeing, not because 0.68 is
 * a measured quantity.
 */

/** Azimuthal mean of the spiral. The value the impact ledger deposits. */
export const RAINBAND_AZIMUTHAL_MEAN = 0.68;

/** Spiral amplitude. Mean + amplitude = 1, so the spiral peaks at unity. */
export const RAINBAND_SPIRAL_AMPLITUDE = 0.32;

/** Envelope: ramps in over INNER_Q→INNER_FULL_Q, out over OUTER_FADE_Q→OUTER_Q. */
export const RAINBAND_INNER_Q = 1.45;
export const RAINBAND_INNER_FULL_Q = 2.0;
export const RAINBAND_OUTER_FADE_Q = 6.0;
export const RAINBAND_OUTER_Q = 8.0;

/** Gaussian eyewall half-width in RMW multiples. */
export const EYEWALL_WIDTH_Q = 0.38;

/** Spiral arm count. */
export const RAINBAND_SPIRAL_ARMS = 3;
/** Radial pitch of the arms. */
export const RAINBAND_SPIRAL_PITCH = 1.35;
/** Arm rotation rate, radians per simulated hour. */
export const RAINBAND_SPIRAL_ROTATION_PER_H = 0.035;

/**
 * Azimuthal modulation of the rainband, in [mean - amplitude, mean + amplitude].
 * `q` is the radius in RMW multiples; `ageH` rotates the arms.
 */
export function rainbandSpiral(
  azimuth: number,
  q: number,
  ageH: number,
): number {
  return (
    RAINBAND_AZIMUTHAL_MEAN +
    RAINBAND_SPIRAL_AMPLITUDE *
      Math.sin(
        RAINBAND_SPIRAL_ARMS * azimuth -
          RAINBAND_SPIRAL_PITCH * q +
          ageH * RAINBAND_SPIRAL_ROTATION_PER_H,
      )
  );
}
