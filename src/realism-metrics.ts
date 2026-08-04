/**
 * realism-metrics.ts — the R2a shortlist metrics over the BT-proxy field.
 *
 * One function per register entry (RGR-001 environmental cloud fraction,
 * RGR-002 eye contrast, RGR-003/006/013 cold-top area + centroid, RGR-004 band
 * edge energy), each reducing a `RealismField` to plain numbers. Everything
 * here is a pure function of (field, context): no clock, no device trait, no
 * global state, and no import from a render path — the only dependency is
 * `realism-proxy`, the harness's single import surface.
 *
 * Conditioning that the register defines per BIN rather than per FRAME lives
 * with the aggregator, not here: RGR-001's month grouping and RGR-006's
 * pre-peak/post-peak stage split are the caller's (Task 7) to apply over these
 * per-frame values.
 *
 * A metric returns null rather than a placeholder whenever its defining
 * population is empty or its direction is unavailable. Callers must propagate
 * the null; substituting 0 would report "no gradient" where the truth is "not
 * measured".
 */

import type { RealismField, RealismFrameContext } from './realism-proxy';
import { clamp01, smoothstep } from './realism-proxy';

/** RGR-001: a cell is cloudy when `btProxyC <= 0 C`. */
// Proxy threshold, sealed sim-side; the observed-side BT mapping is an R2b
// decision recorded against this constant's name.
export const REALISM_ENV_CLOUDY_TOP_C = 0;
/** Cold-top threshold, deg C (RGR-003/006/013). */
export const REALISM_COLD_TOP_C = -60;
/** RGR-001 exclusion radius, in multiples of `outerSizeKm`. */
export const REALISM_ENV_EXCLUSION_OUTER_MULT = 3;
/** RGR-003/013 search radius, in multiples of `outerSizeKm`. */
export const REALISM_COLD_SEARCH_OUTER_MULT = 4;
/** RGR-002 eye disc, r/rmw. */
export const REALISM_EYE_CORE_Q = 0.35;
export const REALISM_EYEWALL_RING_Q_MIN = 0.8;
export const REALISM_EYEWALL_RING_Q_MAX = 1.3;
/** RGR-004 band-component mask. */
export const REALISM_BAND_MASK_MIN = 0.1;
/** Hence & Houze regime break, km. */
export const REALISM_INNER_OUTER_SPLIT_KM = 200;
export const REALISM_EDGE_OUTER_LIMIT_KM = 600;
export const REALISM_MIN_COLD_CELLS = 8;
/**
 * AT OR BELOW this shear-vector length (m/s) the display direction is the
 * shader's DECORATIVE fallback — env.ts keeps the physical direction only
 * for length STRICTLY greater than 0.05 (`length(u_shearVector) > 0.05`).
 * Shear-relative metrics therefore refuse to report a direction when
 * `length <= REALISM_MIN_SHEAR_DIR_MS`: centroid bearing and all four
 * quadrant means return null. The field itself still uses the fallback
 * direction, mirroring the display.
 */
export const REALISM_MIN_SHEAR_DIR_MS = 0.05;

/**
 * Below this eye strength the shader draws no warm eye at all, so RGR-002's
 * core-minus-ring difference would measure eyewall noise against itself.
 */
const EYE_STRENGTH_MIN = 0.05;

/**
 * Half the domain height in km — the clip→km factor. Mirrors
 * `HALF_DOMAIN_HEIGHT_KM` in `src/render/storm-radii.ts`, restated here because
 * this module must not import a render path; `buildRealismField` derives its
 * `cellKm` from the same 666, so the two mappings agree by construction.
 */
const HALF_DOMAIN_HEIGHT_KM = 666;

const DEG_PER_RAD = 180 / Math.PI;

/** RGR-004, mean |grad btProxyC| by quadrant relative to the shear vector. */
export interface RealismShearQuadrantMeans {
  /** Downshear-left. */
  dl: number | null;
  /** Downshear-right. */
  dr: number | null;
  /** Upshear-left. */
  ul: number | null;
  /** Upshear-right. */
  ur: number | null;
}

/** RGR-004, mean |grad btProxyC| in C/km over band-masked cells. */
export interface RealismBandEdgeEnergy {
  /** Band-masked, r <= 200 km. */
  innerCPerKm: number | null;
  /** Band-masked, 200 < r <= 600 km. */
  outerCPerKm: number | null;
  /** Band-masked, all radii <= 600 km. */
  byShearQuadrant: RealismShearQuadrantMeans;
}

/** RGR-003/006/013, the cold-top canopy. */
export interface RealismColdTop {
  areaKm2: number;
  centroidOffsetKm: number | null;
  /**
   * (-180, 180], 0 = downshear. COMPASS-framed and clockwise-positive
   * (`atan2(east, north)`), so a centroid downshear-LEFT reads NEGATIVE — the
   * OPPOSITE sign sense from RGR-004's `dl` bucket, which is `cross > 0`. Both
   * are intentional: the bearing follows the meteorological convention, the
   * quadrant follows the vector cross product. Do not "align" one to the other.
   */
  centroidBearingRelToShearDeg: number | null;
}

export interface RealismFrameMetrics {
  ageH: number;
  vKt: number;
  /** RGR-001 (null: no eligible ocean cells). */
  environmentalCloudFraction: number | null;
  /** RGR-002 (null: eyeStrength <= 0.05, or an empty disc/ring). */
  eyeContrastC: number | null;
  coldTop: RealismColdTop;
  bandEdgeEnergy: RealismBandEdgeEnergy;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Per-cell storm-relative offsets, in metric km. */
interface FieldGeometry {
  east: Float64Array;
  north: Float64Array;
  /** Distance from the storm centre, km. */
  km: Float64Array;
}

/**
 * Cell → storm geometry in metric km, for the field's own convention: cells are
 * indexed `j * n + i` with j = 0 the NORTH edge, cell uv is `(i + 0.5) / n`, and
 * clip is `x = u * 2 - 1`, `y = 1 - v * 2`. Hence
 * `east = (cellClipX - center.x) * metricX * 666` and
 * `north = (cellClipY - center.y) * 666`.
 *
 * Computed once per field and shared by every metric so the four reductions
 * cannot disagree about where a cell is.
 */
function fieldGeometry(field: RealismField): FieldGeometry {
  const n = field.n;
  const size = n * n;
  const east = new Float64Array(size);
  const north = new Float64Array(size);
  const km = new Float64Array(size);
  for (let j = 0; j < n; j++) {
    const clipY = 1 - ((j + 0.5) / n) * 2;
    const cellNorth = (clipY - field.center.y) * HALF_DOMAIN_HEIGHT_KM;
    for (let i = 0; i < n; i++) {
      const clipX = ((i + 0.5) / n) * 2 - 1;
      const cellEast =
        (clipX - field.center.x) * field.metricX * HALF_DOMAIN_HEIGHT_KM;
      const index = j * n + i;
      east[index] = cellEast;
      north[index] = cellNorth;
      km[index] = Math.hypot(cellEast, cellNorth);
    }
  }
  return { east, north, km };
}

/**
 * The shear vector when it carries a PHYSICAL direction, else null. The shader
 * keeps the physical direction only for `length > 0.05`; at or below that it
 * draws a decorative fixed axis, so no direction-relative metric may report
 * against it.
 */
function physicalShear(ctx: RealismFrameContext): { u: number; v: number } | null {
  const { u, v } = ctx.envShear;
  return Math.hypot(u, v) > REALISM_MIN_SHEAR_DIR_MS ? { u, v } : null;
}

/** Wrap degrees into (-180, 180]. */
function normalizeDeg(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function meanOrNull(sum: number, count: number): number | null {
  return count === 0 ? null : sum / count;
}

// ---------------------------------------------------------------------------
// RGR-001 — environmental cloud fraction
// ---------------------------------------------------------------------------

/**
 * Over cells with `oceanMask = 1` and `distanceKm > 3 * outerSizeKm`: the
 * fraction whose BT PROXY is at or below `REALISM_ENV_CLOUDY_TOP_C`. It
 * thresholds `btProxyC`, never a cover component — the register's definition is
 * a brightness-temperature statistic so it stays comparable to observed IR.
 * Month conditioning is aggregation-side.
 */
function environmentalCloudFraction(
  field: RealismField,
  geo: FieldGeometry,
  ctx: RealismFrameContext,
): number | null {
  const limitKm =
    REALISM_ENV_EXCLUSION_OUTER_MULT * ctx.frame.structure.outerSizeKm;
  let eligible = 0;
  let cloudy = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    if (field.oceanMask[index] !== 1) continue;
    if (geo.km[index] <= limitKm) continue;
    eligible++;
    if (field.btProxyC[index] <= REALISM_ENV_CLOUDY_TOP_C) cloudy++;
  }
  return meanOrNull(cloudy, eligible);
}

// ---------------------------------------------------------------------------
// RGR-002 — eye contrast
// ---------------------------------------------------------------------------

/**
 * Mean `btProxyC` over the eye disc (`q <= 0.35`) minus the mean over the
 * eyewall ring (`0.8 <= q <= 1.3`), with `q = distanceKm / rmwKm` from the
 * UNWOBBLED distance — the shader's azimuthal wobble deforms what is drawn, not
 * where the structural radius is. Positive = warm eye against a cold eyewall.
 *
 * Null unless the shader would draw an eye at all (`eyeStrength > 0.05`, the
 * same expression `sampleCloud()` evaluates), and null when either population
 * is empty — a grid too coarse to resolve the disc has no contrast to report.
 */
function eyeContrastC(
  field: RealismField,
  geo: FieldGeometry,
  ctx: RealismFrameContext,
): number | null {
  const frame = ctx.frame;
  const intensity01 = clamp01((frame.vKt - 20) / 100);
  const eyeStrength =
    smoothstep(0.18, 0.56, intensity01 * frame.organization) *
    smoothstep(0.62, 0.82, frame.organization);
  if (eyeStrength <= EYE_STRENGTH_MIN) return null;

  const rmwKm = frame.structure.rmwKm;
  let coreSum = 0;
  let coreCount = 0;
  let ringSum = 0;
  let ringCount = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    const q = geo.km[index] / rmwKm;
    if (q <= REALISM_EYE_CORE_Q) {
      coreSum += field.btProxyC[index];
      coreCount++;
    }
    if (q >= REALISM_EYEWALL_RING_Q_MIN && q <= REALISM_EYEWALL_RING_Q_MAX) {
      ringSum += field.btProxyC[index];
      ringCount++;
    }
  }
  const core = meanOrNull(coreSum, coreCount);
  const ring = meanOrNull(ringSum, ringCount);
  return core === null || ring === null ? null : core - ring;
}

// ---------------------------------------------------------------------------
// RGR-003/006/013 — cold-top area and centroid
// ---------------------------------------------------------------------------

/**
 * Cold mask = `btProxyC < -60` within `4 * outerSizeKm`; `areaKm2` is the cell
 * count times the metric cell area. The centroid is the mask's mean (east,
 * north) offset; `centroidOffsetKm` is its length and the bearing is measured
 * against the shear vector, `atan2(east, north) - atan2(shearU, shearV)`
 * normalized to (-180, 180] with 0 = downshear.
 *
 * Centroid fields are null below `REALISM_MIN_COLD_CELLS` — a handful of cells
 * places no canopy. The bearing is additionally null in calm shear, where the
 * display axis is decorative; `areaKm2` and `centroidOffsetKm` stay valid there
 * because neither reads a direction.
 */
function coldTopMetrics(
  field: RealismField,
  geo: FieldGeometry,
  ctx: RealismFrameContext,
): RealismColdTop {
  const searchKm =
    REALISM_COLD_SEARCH_OUTER_MULT * ctx.frame.structure.outerSizeKm;
  let count = 0;
  let eastSum = 0;
  let northSum = 0;
  for (let index = 0; index < field.btProxyC.length; index++) {
    if (geo.km[index] > searchKm) continue;
    if (field.btProxyC[index] >= REALISM_COLD_TOP_C) continue;
    count++;
    eastSum += geo.east[index];
    northSum += geo.north[index];
  }
  const areaKm2 = count * field.cellKm.x * field.cellKm.y;
  if (count < REALISM_MIN_COLD_CELLS) {
    return { areaKm2, centroidOffsetKm: null, centroidBearingRelToShearDeg: null };
  }
  const east = eastSum / count;
  const north = northSum / count;
  const shear = physicalShear(ctx);
  return {
    areaKm2,
    centroidOffsetKm: Math.hypot(east, north),
    centroidBearingRelToShearDeg: shear
      ? normalizeDeg(
          (Math.atan2(east, north) - Math.atan2(shear.u, shear.v)) * DEG_PER_RAD,
        )
      : null,
  };
}

// ---------------------------------------------------------------------------
// RGR-004 — band edge energy
// ---------------------------------------------------------------------------

interface QuadrantAccumulator {
  sum: number;
  count: number;
}

/**
 * Central-difference `|grad btProxyC|` in C/km over BAND-MASKED cells only:
 * `max(bands, precipBandCloud) >= 0.1`. The precipitation-eyewall arm belongs
 * to neither component, so eyewall gradients cannot leak into a band statistic.
 *
 * Border policy (sealed): a central difference reads all four neighbours, so
 * only cells whose four neighbours are in-grid contribute — the outermost ring
 * never does. Inner is `r <= 200 km`, outer `200 < r <= 600 km`, and the
 * quadrants cover every masked cell within 600 km, split by the signed angle
 * between the cell bearing and the shear bearing: `|angle| <= 90` (equivalently
 * `dot >= 0`) is downshear, and `shear x cell` positive is left. Every mean is
 * null when its masked count is 0, which is also how calm shear nulls all four
 * quadrants: with no physical direction, nothing is ever classified.
 */
function bandEdgeEnergy(
  field: RealismField,
  geo: FieldGeometry,
  ctx: RealismFrameContext,
): RealismBandEdgeEnergy {
  const n = field.n;
  const shear = physicalShear(ctx);
  const inverseDx = 1 / (2 * field.cellKm.x);
  const inverseDy = 1 / (2 * field.cellKm.y);
  let innerSum = 0;
  let innerCount = 0;
  let outerSum = 0;
  let outerCount = 0;
  const dl: QuadrantAccumulator = { sum: 0, count: 0 };
  const dr: QuadrantAccumulator = { sum: 0, count: 0 };
  const ul: QuadrantAccumulator = { sum: 0, count: 0 };
  const ur: QuadrantAccumulator = { sum: 0, count: 0 };

  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const index = j * n + i;
      const mask = Math.max(field.bands[index], field.precipBandCloud[index]);
      if (mask < REALISM_BAND_MASK_MIN) continue;
      const km = geo.km[index];
      if (km > REALISM_EDGE_OUTER_LIMIT_KM) continue;

      const dTdx =
        (field.btProxyC[index + 1] - field.btProxyC[index - 1]) * inverseDx;
      // j - 1 is the NORTHWARD neighbour under the field's row order.
      const dTdy =
        (field.btProxyC[index - n] - field.btProxyC[index + n]) * inverseDy;
      const gradient = Math.hypot(dTdx, dTdy);

      if (km <= REALISM_INNER_OUTER_SPLIT_KM) {
        innerSum += gradient;
        innerCount++;
      } else {
        outerSum += gradient;
        outerCount++;
      }

      if (!shear) continue;
      const dot = shear.u * geo.east[index] + shear.v * geo.north[index];
      const cross = shear.u * geo.north[index] - shear.v * geo.east[index];
      const bucket =
        dot >= 0 ? (cross > 0 ? dl : dr) : cross > 0 ? ul : ur;
      bucket.sum += gradient;
      bucket.count++;
    }
  }

  return {
    innerCPerKm: meanOrNull(innerSum, innerCount),
    outerCPerKm: meanOrNull(outerSum, outerCount),
    byShearQuadrant: {
      dl: meanOrNull(dl.sum, dl.count),
      dr: meanOrNull(dr.sum, dr.count),
      ul: meanOrNull(ul.sum, ul.count),
      ur: meanOrNull(ur.sum, ur.count),
    },
  };
}

// ---------------------------------------------------------------------------

/** Reduce one BT-proxy field to the R2a shortlist metrics. */
export function metricsForField(
  field: RealismField,
  ctx: RealismFrameContext,
): RealismFrameMetrics {
  const geo = fieldGeometry(field);
  return {
    ageH: ctx.frame.ageH,
    vKt: ctx.frame.vKt,
    environmentalCloudFraction: environmentalCloudFraction(field, geo, ctx),
    eyeContrastC: eyeContrastC(field, geo, ctx),
    coldTop: coldTopMetrics(field, geo, ctx),
    bandEdgeEnergy: bandEdgeEnergy(field, geo, ctx),
  };
}
