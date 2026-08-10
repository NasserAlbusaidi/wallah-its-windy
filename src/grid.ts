/**
 * grid.ts — THE coordinate convention module (eng task T1).
 *
 * Every latlon <-> grid-cell <-> clip-space conversion and the m/s -> deg/h
 * wind conversion lives here and NOWHERE else. Three coordinate systems meet in
 * this project (geographic degrees, raster cells, WebGL clip space); giving them
 * one owner is the whole point of this file. If sim, render, or bake code is
 * doing coordinate arithmetic inline, that is a bug — route it through here.
 *
 * Sim math is done entirely in lat/lon degrees. Cells are only for sampling
 * baked rasters; clip space is only for drawing.
 *
 * Conventions (fixed, mirror BINARY-FORMATS.md):
 *   - Longitude east-positive, latitude north-positive, degrees.
 *   - Raster row order: row 0 is the NORTH edge (latMax), row ny-1 the SOUTH
 *     edge (latMin). Columns run west (lonMin) -> east (lonMax).
 *   - Integer (col,row) addresses a cell CENTER; fractional values interpolate.
 *   - Clip space is [-1,1] on each axis, y-up (lat increases with y). Since the
 *     camera (UX v2 phase 2) this is WORLD space — domain edges at exactly ±1,
 *     regardless of what the screen shows. src/camera.ts owns the affine
 *     world->NDC view layered on top; it is presentation-only and never
 *     changes what these functions return. Recorded output, calibration, and
 *     offscreen state textures all live in this domain-fixed space.
 */

import type { BBox, CellCoord, ClipCoord, GridSpec, LatLon } from './types';

// --- Domain: one unified box used everywhere (terrain, env, despawn) --------
export const DOMAIN: BBox = {
  lonMin: 50,
  lonMax: 70,
  latMin: 15,
  latMax: 27,
};

// --- Physical constants -----------------------------------------------------
/** Mean Earth radius, km (spherical approximation). */
export const EARTH_RADIUS_KM = 6371;
/** Meters per degree of latitude (also per degree of longitude at the equator). */
export const METERS_PER_DEG_LAT = 111_320;
const DEG2RAD = Math.PI / 180;

/**
 * Kilometres per degree of latitude used by the RENDER km<->clip mapping, and
 * by nothing else.
 *
 * This deliberately disagrees with the two other km-per-degree numbers in the
 * tree, and the disagreement is load-bearing:
 *   - METERS_PER_DEG_LAT = 111_320 above (the physics wind conversion) would
 *     make the half-domain height 667.92 km;
 *   - KM_PER_LAT_DEGREE = 111.195 in src/render/terrain.ts:23 (and the same
 *     number in src/fidelity-verification.ts:14 and src/steering.ts:221) would
 *     make it 667.17 km.
 * Neither is 666. The render layer has always used a flat 111, and every
 * shipped shader constant, R2a realism metric and human-accepted R3/R4
 * presentation baseline is denominated in that mapping. Reconciling the <=
 * 0.29 % difference would move every cloud, rainband and radar radius those
 * verdicts accepted. It is a RENDERING unit, never a physical one: do not use
 * it in sim.ts, structure.ts, steering.ts or any calibration path.
 */
export const RENDER_KM_PER_LAT_DEG = 111;

/**
 * Half the domain height in km — THE km -> clip-y factor for every render and
 * measurement path. Derived, not written out, so a domain change cannot leave
 * a stale literal behind. Exactly 666 at the current 15..27 N domain
 * (12 / 2 * 111, all three operations exact in IEEE754 double).
 */
export const HALF_DOMAIN_HEIGHT_KM =
  ((DOMAIN.latMax - DOMAIN.latMin) / 2) * RENDER_KM_PER_LAT_DEG;

// ---------------------------------------------------------------------------
// Domain membership
// ---------------------------------------------------------------------------

/** True when (lat,lon) lies inside `bbox` (inclusive edges). */
export function inBBox(lat: number, lon: number, bbox: BBox = DOMAIN): boolean {
  return (
    lon >= bbox.lonMin &&
    lon <= bbox.lonMax &&
    lat >= bbox.latMin &&
    lat <= bbox.latMax
  );
}

// ---------------------------------------------------------------------------
// latlon <-> grid cell
// ---------------------------------------------------------------------------

/**
 * Cell center -> geographic degrees. `col` in [0,nx), `row` in [0,ny) with
 * row 0 at the north edge. Integer inputs give exact cell centers; fractional
 * inputs are the linear inverse of {@link latLonToCell}.
 */
export function cellToLatLon(spec: GridSpec, col: number, row: number): LatLon {
  const { nx, ny, bbox } = spec;
  const dLon = (bbox.lonMax - bbox.lonMin) / nx;
  const dLat = (bbox.latMax - bbox.latMin) / ny;
  return {
    lon: bbox.lonMin + (col + 0.5) * dLon,
    lat: bbox.latMax - (row + 0.5) * dLat, // north-to-south
  };
}

/**
 * Geographic degrees -> continuous cell coordinate. Exact inverse of
 * {@link cellToLatLon}: latLonToCell(cellToLatLon(c,r)) === {col:c, row:r}.
 * Callers that need an integer index must floor/round and bounds-check.
 */
export function latLonToCell(spec: GridSpec, lat: number, lon: number): CellCoord {
  const { nx, ny, bbox } = spec;
  const dLon = (bbox.lonMax - bbox.lonMin) / nx;
  const dLat = (bbox.latMax - bbox.latMin) / ny;
  return {
    col: (lon - bbox.lonMin) / dLon - 0.5,
    row: (bbox.latMax - lat) / dLat - 0.5, // north-to-south
  };
}

// ---------------------------------------------------------------------------
// latlon <-> clip space
// ---------------------------------------------------------------------------

/** Geographic degrees -> clip space [-1,1], y-up. Domain edges map to +/-1. */
export function latLonToClip(lat: number, lon: number, bbox: BBox = DOMAIN): ClipCoord {
  return {
    x: ((lon - bbox.lonMin) / (bbox.lonMax - bbox.lonMin)) * 2 - 1,
    y: ((lat - bbox.latMin) / (bbox.latMax - bbox.latMin)) * 2 - 1,
  };
}

/** Clip space [-1,1] -> geographic degrees. Exact inverse of {@link latLonToClip}. */
export function clipToLatLon(x: number, y: number, bbox: BBox = DOMAIN): LatLon {
  return {
    lon: bbox.lonMin + ((x + 1) / 2) * (bbox.lonMax - bbox.lonMin),
    lat: bbox.latMin + ((y + 1) / 2) * (bbox.latMax - bbox.latMin),
  };
}

// ---------------------------------------------------------------------------
// wind: m/s -> deg/h (cos-lat correction on the zonal component)
// ---------------------------------------------------------------------------

/**
 * Meridional (north-south) wind, m/s -> degrees latitude per hour.
 * No latitude correction: a degree of latitude is a fixed distance everywhere.
 */
export function msToDegPerHourMeridional(vMs: number): number {
  return (vMs * 3600) / METERS_PER_DEG_LAT;
}

/**
 * Zonal (east-west) wind, m/s -> degrees longitude per hour, WITH the cos-lat
 * correction: a degree of longitude shrinks toward the poles, so the same
 * ground speed spans MORE degrees of longitude at higher latitude. Equivalently,
 * `msToDegPerHourZonal(u, lat) * cos(lat)` is latitude-invariant and equals the
 * meridional conversion of the same speed — the property the tests pin down.
 */
export function msToDegPerHourZonal(uMs: number, lat: number): number {
  return (uMs * 3600) / (METERS_PER_DEG_LAT * Math.cos(lat * DEG2RAD));
}

/**
 * Convenience: full wind vector (m/s) -> per-hour change in (lon,lat) degrees at
 * a given latitude. This is what the position integrator advances each step.
 */
export function windToDegPerHour(
  uMs: number,
  vMs: number,
  lat: number,
): { dLon: number; dLat: number } {
  return {
    dLon: msToDegPerHourZonal(uMs, lat),
    dLat: msToDegPerHourMeridional(vMs),
  };
}

// ---------------------------------------------------------------------------
// distance
// ---------------------------------------------------------------------------

/**
 * Offset a lat/lon point by `km` along a unit (east,north) bearing vector, with
 * the cos-lat correction on the eastward component (a km east spans more degrees
 * of longitude toward the poles). `east`/`north` need not be normalized — they
 * scale the km. The sole owner of "step a point by a ground distance", used by
 * sim.ts's dry-air upwind ray probe so that file never does inline lat/lon math.
 */
export function offsetKm(
  lat: number,
  lon: number,
  east: number,
  north: number,
  km: number,
): LatLon {
  const degLat = (km * 1000) / METERS_PER_DEG_LAT;
  const cosLat = Math.max(0.2, Math.cos(lat * DEG2RAD));
  return {
    lat: lat + north * degLat,
    lon: lon + (east * degLat) / cosLat,
  };
}

/** Great-circle distance between two lat/lon points, km (haversine). */
export function greatCircleKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
