/**
 * Presentation-only geographic context around the fixed simulation domain.
 *
 * This module deliberately does not redefine grid.ts DOMAIN. Simulation state,
 * weather rasters, tracks, and recordings stay registered to that original
 * 50–70 E / 15–27 N box. The larger domain only supplies honest terrain and
 * camera context outside it.
 */

import config from '../config/display-domain.json';
import type { BBox, GridSpec } from './types';

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`display-domain: ${name} must be finite`);
  return value;
}

function positiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`display-domain: ${name} must be a positive integer`);
  }
  return value;
}

const raw = config as {
  schemaVersion: number;
  id: string;
  bbox: BBox;
  grid: { nx: number; ny: number };
  asset: { path: string; layers: string[] };
};

if (raw.schemaVersion !== 1) {
  throw new Error(`display-domain: unsupported schemaVersion ${raw.schemaVersion}`);
}
if (!raw.id || !raw.asset.path) {
  throw new Error('display-domain: id and asset.path are required');
}

const bbox = Object.freeze({
  lonMin: finite('bbox.lonMin', raw.bbox.lonMin),
  lonMax: finite('bbox.lonMax', raw.bbox.lonMax),
  latMin: finite('bbox.latMin', raw.bbox.latMin),
  latMax: finite('bbox.latMax', raw.bbox.latMax),
});
if (bbox.lonMin >= bbox.lonMax || bbox.latMin >= bbox.latMax) {
  throw new Error('display-domain: bbox minima must be below maxima');
}

export const DISPLAY_CONTEXT_SCHEMA_VERSION = raw.schemaVersion;
export const DISPLAY_CONTEXT_ID = raw.id;
export const DISPLAY_CONTEXT_ASSET_PATH = raw.asset.path;
export const DISPLAY_CONTEXT_DOMAIN: BBox = bbox;
export const DISPLAY_CONTEXT_GRID: GridSpec = Object.freeze({
  nx: positiveInt('grid.nx', raw.grid.nx),
  ny: positiveInt('grid.ny', raw.grid.ny),
  bbox,
});

export interface UvTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Convert north-down raster UV from `source` into north-down raster UV in
 * `target`. Values may fall outside [0,1]; callers use that to avoid repeating
 * an edge texel beyond a dataset's declared coverage.
 */
export function rasterUvTransform(source: BBox, target: BBox): UvTransform {
  const sourceLonSpan = source.lonMax - source.lonMin;
  const sourceLatSpan = source.latMax - source.latMin;
  const targetLonSpan = target.lonMax - target.lonMin;
  const targetLatSpan = target.latMax - target.latMin;
  if (
    sourceLonSpan <= 0 ||
    sourceLatSpan <= 0 ||
    targetLonSpan <= 0 ||
    targetLatSpan <= 0
  ) {
    throw new Error('display-domain: UV transform requires non-empty bboxes');
  }
  return {
    scaleX: sourceLonSpan / targetLonSpan,
    scaleY: sourceLatSpan / targetLatSpan,
    offsetX: (source.lonMin - target.lonMin) / targetLonSpan,
    offsetY: (target.latMax - source.latMax) / targetLatSpan,
  };
}

const BBOX_EPSILON = 1e-9;

/** Exact-enough header guard for the committed display-context raster. */
export function matchesDisplayContextGrid(grid: GridSpec): boolean {
  const want = DISPLAY_CONTEXT_GRID;
  return (
    grid.nx === want.nx &&
    grid.ny === want.ny &&
    Math.abs(grid.bbox.lonMin - want.bbox.lonMin) <= BBOX_EPSILON &&
    Math.abs(grid.bbox.lonMax - want.bbox.lonMax) <= BBOX_EPSILON &&
    Math.abs(grid.bbox.latMin - want.bbox.latMin) <= BBOX_EPSILON &&
    Math.abs(grid.bbox.latMax - want.bbox.latMax) <= BBOX_EPSILON
  );
}
