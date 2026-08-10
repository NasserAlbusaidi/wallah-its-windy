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

/**
 * Nearest-cell read of one plane, clamped to the layer's edges.
 *
 * The main-thread land predicate (ui.ts isLand -> main.ts's sim wiring) uses
 * this; the ensemble worker uses sampleLayerBilinear. The two differ off cell
 * centre by construction — that asymmetry predates the domain expansion and is
 * not changed here. The Math.round is kept exactly as it was: changing it moves
 * the sim's land boundary and therefore every calibrated track.
 */
export function sampleLayerNearest(layer: BinLayer, plane: number, lat: number, lon: number): number {
  const { nx, ny } = layer;
  const cell = latLonToCell({ nx, ny, bbox: layer.bbox }, lat, lon);
  const col = Math.max(0, Math.min(nx - 1, Math.round(cell.col)));
  const row = Math.max(0, Math.min(ny - 1, Math.round(cell.row)));
  const t = Math.max(0, Math.min(Math.floor(plane), layer.nt - 1));
  return layer.data[t * nx * ny + row * nx + col];
}
