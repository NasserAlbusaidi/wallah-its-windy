/**
 * vortex.ts — THE analytic Holland vortex, defined once for two consumers.
 *
 * The design doc's hard rule: the rain source uses "THE SAME analytic vortex
 * inflow wind" the particles ride, so rain and spiral never visibly disagree.
 * To keep that literally true the wind field lives here in exactly two mirrored
 * forms—a TS function {@link vortexWind} for CPU particle advection, and a GLSL
 * string pasted into the rain shader. Both consume the simulated RMW, Holland B,
 * persistent outer scale, motion asymmetry, and deep-layer shear asymmetry.
 *
 * Cyclonic sense is counter-clockwise (northern hemisphere) in a frame with
 * x = east, y = north. `inflow` tilts the tangential wind toward the centre
 * (~20° low-level inflow) so particles spiral IN, not just orbit.
 *
 * Units are frame-relative: particles run in an aspect-corrected screen frame so
 * the spiral is round; rain runs in the clip frame. Both take the same rMax /
 * vMax / inflow, which is what "the same vortex" means — the wind DIRECTION and
 * radial profile are identical; only the metric each consumer measures r in
 * differs, and that is a rendering detail (documented in report deviations).
 */

/** Low-level inflow angle, radians (~20°). Shared by particles and rain. */
export const INFLOW_RAD = 0.35;

/** Normalized Holland surface-wind profile; maximum occurs exactly at rMax. */
export function hollandSpeed(
  r: number,
  rMax: number,
  vMax: number,
  hollandB: number,
): number {
  if (r <= 0) return 0;
  const x = Math.min(80, Math.pow(rMax / r, hollandB));
  return vMax * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
}

export interface VortexParams {
  cx: number;
  cy: number;
  rMax: number;
  vMax: number;
  hollandB: number;
  /** Translation direction in the same east/north frame as the vortex. */
  motionX: number;
  motionY: number;
  /** Fraction of vMax reserved for right-of-motion enhancement. */
  asymmetryFraction: number;
  /** Persistent stretch of the gale-force outer wind region. */
  outerScale: number;
  /** vMax fractions bounding the inner-to-outer profile blend. */
  outerBlendStartFraction: number;
  outerBlendFullFraction: number;
  /** 200–850 hPa shear vector in the same east/north frame. */
  shearX: number;
  shearY: number;
  /** Maximum downshear-left radial stretch fraction in the outer region. */
  shearAsymmetryFraction: number;
  /** Inflow angle, radians (~0.35 = 20°). */
  inflow: number;
}

/** Wind vector (same frame as inputs) at point (px,py) for the given vortex. */
export function vortexWind(px: number, py: number, p: VortexParams): { wx: number; wy: number } {
  const dx = px - p.cx;
  const dy = py - p.cy;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) return { wx: 0, wy: 0 };
  const rxu = dx / r;
  const ryu = dy / r;
  // Tangential (CCW) = radial rotated +90°; then tilt inward by `inflow`.
  const tx = -ryu;
  const ty = rxu;
  const motionMagnitude = Math.hypot(p.motionX, p.motionY);
  const mx = motionMagnitude > 1e-6 ? p.motionX / motionMagnitude : 0;
  const my = motionMagnitude > 1e-6 ? p.motionY / motionMagnitude : 0;
  const asymmetry = Math.max(0, Math.min(0.45, p.asymmetryFraction));
  const alignment = tx * mx + ty * my;
  const localMaximum =
    p.vMax * Math.max(0, 1 - asymmetry + asymmetry * alignment);
  const unmodified = hollandSpeed(r, p.rMax, localMaximum, p.hollandB);
  const fullWind = p.vMax * p.outerBlendFullFraction;
  const startWind = p.vMax * p.outerBlendStartFraction;
  const blendFraction = Math.max(
    0,
    Math.min(1, (startWind - unmodified) / Math.max(1e-6, startWind - fullWind)),
  );
  const blend = blendFraction * blendFraction * (3 - 2 * blendFraction);
  const shearMagnitude = Math.hypot(p.shearX, p.shearY);
  const downshearLeftX = shearMagnitude > 1e-6 ? -p.shearY / shearMagnitude : 0;
  const downshearLeftY = shearMagnitude > 1e-6 ? p.shearX / shearMagnitude : 0;
  const shearAlignment = rxu * downshearLeftX + ryu * downshearLeftY;
  const outerStretch = Math.max(
    0.45,
    Math.min(
      2.5,
      p.outerScale * (1 + p.shearAsymmetryFraction * shearAlignment),
    ),
  );
  const stretch = 1 + (outerStretch - 1) * blend;
  const effectiveR =
    r <= p.rMax ? r : p.rMax + (r - p.rMax) / Math.max(0.2, stretch);
  const spd = hollandSpeed(
    effectiveR,
    p.rMax,
    localMaximum,
    p.hollandB,
  );
  const c = Math.cos(p.inflow);
  const s = Math.sin(p.inflow);
  const wxu = c * tx - s * rxu;
  const wyu = c * ty - s * ryu;
  return { wx: wxu * spd, wy: wyu * spd };
}

/**
 * GLSL mirror of {@link vortexWind} + {@link hollandSpeed}. The rain shader
 * `#include`s this by string concatenation. Keep byte-for-byte in step with the
 * TS above — this pairing is the whole point of the file.
 */
export const VORTEX_GLSL = /* glsl */ `
vec2 vortexWind(
  vec2 pt,
  vec2 c,
  float rMax,
  float vMax,
  float hollandB,
  vec2 motion,
  float asymmetryFraction,
  float outerScale,
  float outerBlendStartFraction,
  float outerBlendFullFraction,
  vec2 shear,
  float shearAsymmetryFraction,
  float inflow
) {
  vec2 d = pt - c;
  float r = length(d);
  if (r < 1e-6) return vec2(0.0);
  vec2 ru = d / r;
  vec2 t = vec2(-ru.y, ru.x);            // tangential, CCW
  float motionMagnitude = length(motion);
  vec2 motionUnit = motionMagnitude > 1e-6 ? motion / motionMagnitude : vec2(0.0);
  float asymmetry = clamp(asymmetryFraction, 0.0, 0.45);
  float localMaximum = vMax * max(
    0.0,
    1.0 - asymmetry + asymmetry * dot(t, motionUnit)
  );
  float x0 = min(80.0, pow(rMax / r, hollandB));
  float unmodified = localMaximum * sqrt(max(0.0, x0 * exp(1.0 - x0)));
  float fullWind = vMax * outerBlendFullFraction;
  float startWind = vMax * outerBlendStartFraction;
  float blendFraction = clamp(
    (startWind - unmodified) / max(1e-6, startWind - fullWind),
    0.0,
    1.0
  );
  float blend = blendFraction * blendFraction * (3.0 - 2.0 * blendFraction);
  float shearMagnitude = length(shear);
  vec2 downshearLeft = shearMagnitude > 1e-6
    ? vec2(-shear.y, shear.x) / shearMagnitude
    : vec2(0.0);
  float shearAlignment = dot(ru, downshearLeft);
  float outerStretch = clamp(
    outerScale * (1.0 + shearAsymmetryFraction * shearAlignment),
    0.45,
    2.5
  );
  float stretch = mix(1.0, outerStretch, blend);
  float effectiveR = r <= rMax ? r : rMax + (r - rMax) / max(0.2, stretch);
  float x = min(80.0, pow(rMax / effectiveR, hollandB));
  float spd = localMaximum * sqrt(max(0.0, x * exp(1.0 - x)));
  float cc = cos(inflow), ss = sin(inflow);
  vec2 wu = cc * t - ss * ru;            // tilt inward
  return wu * spd;
}
`;
