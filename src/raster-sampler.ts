/**
 * Bilinear CPU sampling for decoded raster layers.
 *
 * Raster geometry and north-to-south row order come from grid.ts. Consumers
 * choose the timestep/synoptic plane; this module only interpolates in space.
 */

import { latLonToCell } from './grid';
import type { BinLayer } from './types';

/** Bilinearly sample one plane of a layer at (lat,lon), clamped to its edge. */
export function sampleLayerBilinear(layer: BinLayer, plane: number, lat: number, lon: number): number {
  const { nx, ny } = layer;
  const cell = latLonToCell({ nx, ny, bbox: layer.bbox }, lat, lon);
  const col = Math.max(0, Math.min(nx - 1, cell.col));
  const row = Math.max(0, Math.min(ny - 1, cell.row));
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(nx - 1, c0 + 1);
  const r1 = Math.min(ny - 1, r0 + 1);
  const fx = col - c0;
  const fy = row - r0;
  const t = Math.max(0, Math.min(Math.floor(plane), layer.nt - 1));
  const base = t * nx * ny;
  const at = (r: number, c: number): number => layer.data[base + r * nx + c];
  const north = at(r0, c0) * (1 - fx) + at(r0, c1) * fx;
  const south = at(r1, c0) * (1 - fx) + at(r1, c1) * fx;
  return north * (1 - fy) + south * fy;
}
