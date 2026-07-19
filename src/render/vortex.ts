/**
 * vortex.ts — THE analytic Rankine vortex, defined once for two consumers.
 *
 * The design doc's hard rule: the rain source uses "THE SAME analytic vortex
 * inflow wind" the particles ride, so rain and spiral never visibly disagree.
 * To keep that literally true the wind field lives here in exactly two mirrored
 * forms — a TS function {@link vortexWind} for the CPU particle advection, and a
 * GLSL string {@link VORTEX_GLSL} pasted into the rain shader. Edit them together.
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

/** Rankine radial wind profile: solid-body inside rMax, potential-flow outside. */
export function rankineSpeed(r: number, rMax: number, vMax: number): number {
  if (r <= 0) return 0;
  return r < rMax ? vMax * (r / rMax) : vMax * (rMax / r);
}

export interface VortexParams {
  cx: number;
  cy: number;
  rMax: number;
  vMax: number;
  /** Inflow angle, radians (~0.35 = 20°). */
  inflow: number;
}

/** Wind vector (same frame as inputs) at point (px,py) for the given vortex. */
export function vortexWind(px: number, py: number, p: VortexParams): { wx: number; wy: number } {
  const dx = px - p.cx;
  const dy = py - p.cy;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) return { wx: 0, wy: 0 };
  const spd = rankineSpeed(r, p.rMax, p.vMax);
  const rxu = dx / r;
  const ryu = dy / r;
  // Tangential (CCW) = radial rotated +90°; then tilt inward by `inflow`.
  const tx = -ryu;
  const ty = rxu;
  const c = Math.cos(p.inflow);
  const s = Math.sin(p.inflow);
  const wxu = c * tx - s * rxu;
  const wyu = c * ty - s * ryu;
  return { wx: wxu * spd, wy: wyu * spd };
}

/**
 * GLSL mirror of {@link vortexWind} + {@link rankineSpeed}. The rain shader
 * `#include`s this by string concatenation. Keep byte-for-byte in step with the
 * TS above — this pairing is the whole point of the file.
 */
export const VORTEX_GLSL = /* glsl */ `
vec2 vortexWind(vec2 pt, vec2 c, float rMax, float vMax, float inflow) {
  vec2 d = pt - c;
  float r = length(d);
  if (r < 1e-6) return vec2(0.0);
  float spd = r < rMax ? vMax * (r / rMax) : vMax * (rMax / r);
  vec2 ru = d / r;
  vec2 t = vec2(-ru.y, ru.x);            // tangential, CCW
  float cc = cos(inflow), ss = sin(inflow);
  vec2 wu = cc * t - ss * ru;            // tilt inward
  return wu * spd;
}
`;
