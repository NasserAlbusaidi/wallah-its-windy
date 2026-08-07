/** Screen-space clipping for layers whose data is valid only inside DOMAIN. */

import { worldToNdc } from './camera';
import { DOMAIN, latLonToClip } from './grid';
import type { BBox, ViewTransform } from './types';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Convert a geographic data-validity box to a WebGL scissor rectangle.
 *
 * The returned y uses WebGL's bottom-left origin. Edges that are visible are
 * inset slightly so the terrain layer's simulation-boundary line remains
 * legible above real context. Off-screen edges are not inset.
 */
export function domainScissorRect(
  view: ViewTransform,
  width: number,
  height: number,
  bbox: BBox = DOMAIN,
  visibleEdgeInsetPx = 1,
): PixelRect {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  if (safeWidth === 0 || safeHeight === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const swWorld = latLonToClip(bbox.latMin, bbox.lonMin);
  const neWorld = latLonToClip(bbox.latMax, bbox.lonMax);
  const sw = worldToNdc(view, swWorld.x, swWorld.y);
  const ne = worldToNdc(view, neWorld.x, neWorld.y);
  const leftRaw = ((Math.min(sw.x, ne.x) + 1) / 2) * safeWidth;
  const rightRaw = ((Math.max(sw.x, ne.x) + 1) / 2) * safeWidth;
  const bottomRaw = ((Math.min(sw.y, ne.y) + 1) / 2) * safeHeight;
  const topRaw = ((Math.max(sw.y, ne.y) + 1) / 2) * safeHeight;
  const inset = Math.max(0, Math.floor(visibleEdgeInsetPx));

  const left = clamp(
    Math.ceil(leftRaw) + (leftRaw > 0 ? inset : 0),
    0,
    safeWidth,
  );
  const right = clamp(
    Math.floor(rightRaw) - (rightRaw < safeWidth ? inset : 0),
    0,
    safeWidth,
  );
  const bottom = clamp(
    Math.ceil(bottomRaw) + (bottomRaw > 0 ? inset : 0),
    0,
    safeHeight,
  );
  const top = clamp(
    Math.floor(topRaw) - (topRaw < safeHeight ? inset : 0),
    0,
    safeHeight,
  );

  return {
    x: left,
    y: bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, top - bottom),
  };
}

/** Same validity rectangle in Canvas2D/CSS top-left coordinates. */
export function domainCanvasRect(
  view: ViewTransform,
  width: number,
  height: number,
  bbox: BBox = DOMAIN,
  visibleEdgeInsetPx = 1,
): PixelRect {
  const safeHeight = Math.max(0, Math.floor(height));
  const rect = domainScissorRect(
    view,
    width,
    safeHeight,
    bbox,
    visibleEdgeInsetPx,
  );
  return {
    x: rect.x,
    y: safeHeight - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
}
