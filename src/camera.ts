/**
 * camera.ts — the ONE view transform (UX v2 phase 2, ROADMAP item 7).
 *
 * grid.ts's clip space is WORLD space: domain edges at ±1, the exact output
 * of latLonToClip(lat, lon, DOMAIN). This module layers a single affine view
 * on top — `ndc = world * scale + offset` — and everything that touches the
 * screen (shader vertex stages, Canvas2D px helpers, DOM label math, the
 * pointer inverse) composes through it. Nothing else changes meaning: all
 * fragment-shader math, the km->clip constants, and every recorded or
 * calibrated product keep operating on world coordinates.
 *
 * The camera is presentation-only. It never enters sim state, the flight
 * tape, the URL hash, or any sealed-gate surface. World coordinates remain
 * anchored to DOMAIN, while camera movement is clamped to the larger, real
 * terrain-backed DISPLAY_CONTEXT_DOMAIN. Render passes mask DOMAIN-bound
 * weather outside the simulation box; widening the view never invents
 * atmospheric coverage.
 */

import type { ViewState, ViewTransform } from './types';
import { DOMAIN, clipToLatLon, latLonToClip } from './grid';
import { DISPLAY_CONTEXT_DOMAIN } from './display-domain';

export type { ViewState, ViewTransform } from './types';

const displaySw = latLonToClip(
  DISPLAY_CONTEXT_DOMAIN.latMin,
  DISPLAY_CONTEXT_DOMAIN.lonMin,
);
const displayNe = latLonToClip(
  DISPLAY_CONTEXT_DOMAIN.latMax,
  DISPLAY_CONTEXT_DOMAIN.lonMax,
);
const DISPLAY_WORLD = Object.freeze({
  minX: displaySw.x,
  maxX: displayNe.x,
  minY: displaySw.y,
  maxY: displayNe.y,
});
const DISPLAY_CENTER = Object.freeze({
  x: (DISPLAY_WORLD.minX + DISPLAY_WORLD.maxX) / 2,
  y: (DISPLAY_WORLD.minY + DISPLAY_WORLD.maxY) / 2,
});

/** Lowest possible zoom: the display-context latitude span fills the view. */
export const MIN_ZOOM = 2 / (DISPLAY_WORLD.maxY - DISPLAY_WORLD.minY);

/** Regional context default; viewport aspect decides which edge cover-fits. */
export const HOME_VIEW: ViewState = {
  center: { x: DISPLAY_CENTER.x, y: DISPLAY_CENTER.y },
  zoom: MIN_ZOOM,
};

/** View half-height at max zoom = (latMax-latMin)/(2*MAX_ZOOM) = 0.75 deg. */
export const MAX_ZOOM = 8;

const DEG2RAD = Math.PI / 180;

/** East-west world anisotropy at a latitude — same formula as cloudMetricX. */
function metricX(lat: number): number {
  return (
    ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos(lat * DEG2RAD)) /
    (DOMAIN.latMax - DOMAIN.latMin)
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface ClampedView {
  cx: number;
  cy: number;
  zoom: number;
  halfW: number;
  halfH: number;
}

function clampPass(
  aspect: number,
  zoom: number,
  cx: number,
  cy: number,
): ClampedView {
  const centreLat = clipToLatLon(0, cy).lat;
  const m = metricX(centreLat);
  const displayHalfW = (DISPLAY_WORLD.maxX - DISPLAY_WORLD.minX) / 2;
  const displayHalfH = (DISPLAY_WORLD.maxY - DISPLAY_WORLD.minY) / 2;
  // Context containment outranks MAX_ZOOM: on an extreme-aspect canvas the
  // cover-fit floor can exceed MAX_ZOOM, and capping there would expose pixels
  // beyond the real context raster.
  const floor = Math.max(
    MIN_ZOOM,
    1 / displayHalfH,
    aspect / (m * displayHalfW),
  );
  const z = clamp(zoom, floor, Math.max(MAX_ZOOM, floor));
  const halfH = 1 / z;
  const halfW = (aspect * halfH) / m;
  return {
    zoom: z,
    halfW,
    halfH,
    cx:
      halfW * 2 >= DISPLAY_WORLD.maxX - DISPLAY_WORLD.minX
        ? DISPLAY_CENTER.x
        : clamp(
            cx,
            DISPLAY_WORLD.minX + halfW,
            DISPLAY_WORLD.maxX - halfW,
          ),
    cy:
      halfH * 2 >= DISPLAY_WORLD.maxY - DISPLAY_WORLD.minY
        ? DISPLAY_CENTER.y
        : clamp(
            cy,
            DISPLAY_WORLD.minY + halfH,
            DISPLAY_WORLD.maxY - halfH,
          ),
  };
}

/**
 * Derive the clamped affine transform for a camera state and canvas aspect
 * (width/height; CSS or device px — the ratio is identical). Two clamp
 * passes because the metric factor depends on the centre latitude the first
 * pass may move; the residual error after pass two is bounded by the cos
 * variation over one clamp step (<0.5% across this domain) and only affects
 * roundness, never containment.
 */
export function computeViewTransform(
  view: ViewState,
  canvasAspect: number,
): ViewTransform {
  const p1 = clampPass(canvasAspect, view.zoom, view.center.x, view.center.y);
  const p2 = clampPass(canvasAspect, p1.zoom, p1.cx, p1.cy);
  const scaleX = 1 / p2.halfW;
  const scaleY = 1 / p2.halfH;
  const sw = clipToLatLon(p2.cx - p2.halfW, p2.cy - p2.halfH);
  const ne = clipToLatLon(p2.cx + p2.halfW, p2.cy + p2.halfH);
  return {
    scaleX,
    scaleY,
    offsetX: -p2.cx * scaleX,
    offsetY: -p2.cy * scaleY,
    bbox: {
      lonMin: sw.lon,
      lonMax: ne.lon,
      latMin: sw.lat,
      latMax: ne.lat,
    },
  };
}

export function worldToNdc(
  t: ViewTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: x * t.scaleX + t.offsetX, y: y * t.scaleY + t.offsetY };
}

export function ndcToWorld(
  t: ViewTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: (x - t.offsetX) / t.scaleX, y: (y - t.offsetY) / t.scaleY };
}

/** Geographic degrees -> canvas px (y down). w/h in the caller's px space. */
export function latLonToScreen(
  t: ViewTransform,
  lat: number,
  lon: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const world = latLonToClip(lat, lon);
  const ndc = worldToNdc(t, world.x, world.y);
  return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h };
}

/** Canvas px (y down) -> geographic degrees. Exact inverse of latLonToScreen. */
export function screenToLatLon(
  t: ViewTransform,
  xPx: number,
  yPx: number,
  w: number,
  h: number,
): { lat: number; lon: number } {
  const ndcX = (xPx / w) * 2 - 1;
  const ndcY = 1 - (yPx / h) * 2;
  const world = ndcToWorld(t, ndcX, ndcY);
  return clipToLatLon(world.x, world.y);
}

/**
 * Move the camera by a screen-pixel delta (positive dx pans the camera east,
 * i.e. the map content slides left). Gesture code passes the NEGATED drag
 * delta. The result is unclamped — the next computeViewTransform clamps.
 */
export function panByPixels(
  view: ViewState,
  t: ViewTransform,
  dxPx: number,
  dyPx: number,
  w: number,
  h: number,
): ViewState {
  const pxPerWorldX = (w * t.scaleX) / 2;
  const pxPerWorldY = (h * t.scaleY) / 2;
  return {
    center: {
      x: view.center.x + dxPx / pxPerWorldX,
      y: view.center.y - dyPx / pxPerWorldY,
    },
    zoom: view.zoom,
  };
}

/**
 * Change zoom while keeping a world-space anchor at the same screen point.
 * scaleY is proportional to zoom, so the y relation is exact and gives the
 * new centre latitude; scaleX additionally carries metricX(centre lat), so
 * the x relation uses the metric factors of the old AND new centres. The
 * next computeViewTransform absorbs clamping (anchor drift at the domain
 * edge is the clamp doing its job).
 */
export function zoomAboutAnchor(
  view: ViewState,
  anchorWorld: { x: number; y: number },
  newZoom: number,
): ViewState {
  const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  const r = view.zoom / z;
  const cy = anchorWorld.y - (anchorWorld.y - view.center.y) * r;
  const m0 = metricX(clipToLatLon(0, view.center.y).lat);
  const m1 = metricX(clipToLatLon(0, cy).lat);
  return {
    center: {
      x:
        anchorWorld.x -
        (anchorWorld.x - view.center.x) * r * (m0 / m1),
      y: cy,
    },
    zoom: z,
  };
}

/**
 * Recover the CLAMPED camera state a transform was derived from (scaleY is
 * exactly the clamped zoom; the offsets encode the clamped centre). main.ts
 * feeds this back to the gesture controller each frame so its state cannot
 * drift unboundedly while panning against the domain edge.
 */
export function viewStateOf(t: ViewTransform): ViewState {
  return {
    center: { x: -t.offsetX / t.scaleX, y: -t.offsetY / t.scaleY },
    zoom: t.scaleY,
  };
}

/** Change-detection key for relayout / trail-clear triggers. */
export function viewKey(t: ViewTransform): string {
  return `${t.scaleX.toFixed(9)}|${t.scaleY.toFixed(9)}|${t.offsetX.toFixed(9)}|${t.offsetY.toFixed(9)}`;
}
