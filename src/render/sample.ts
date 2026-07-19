/**
 * sample.ts — render's own CPU read of a baked layer.
 *
 * The sim builder owns the real EnvSampler; render only needs a few scalars at
 * the storm centre (SST for nothing visible here, shear + steering for the
 * downshear smear cue). Rather than import another builder's module across the
 * parallel-build boundary, render does its own minimal bilinear tap through
 * grid.ts (the ONE coordinate module). Clamps to the edge, never throws.
 */

import { latLonToCell } from '../grid';
import type { BinLayer } from '../types';

/** Bilinear sample of one timestep of a layer at (lat,lon). Edge-clamped. */
export function sampleLayerBilinear(layer: BinLayer, t: number, lat: number, lon: number): number {
  const { nx, ny } = layer;
  const cc = latLonToCell({ nx, ny, bbox: layer.bbox }, lat, lon);
  // Clamp to the last cell centre; c1 below is separately capped at nx-1/ny-1,
  // so an exact last-cell query returns that cell's value (fx/fy = 0), not a bias.
  const col = Math.max(0, Math.min(nx - 1, cc.col));
  const row = Math.max(0, Math.min(ny - 1, cc.row));
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(nx - 1, c0 + 1);
  const r1 = Math.min(ny - 1, r0 + 1);
  const fx = col - c0;
  const fy = row - r0;
  const tt = Math.max(0, Math.min(t, layer.nt - 1));
  const base = tt * nx * ny;
  const at = (r: number, c: number): number => layer.data[base + r * nx + c];
  const top = at(r0, c0) * (1 - fx) + at(r0, c1) * fx;
  const bot = at(r1, c0) * (1 - fx) + at(r1, c1) * fx;
  return top * (1 - fy) + bot * fy;
}
