/**
 * textures.ts — turn decoded {@link BinLayer}s into GPU textures.
 *
 * Everything the render layers sample lives here as an R8 (filterable, always
 * renderable) or R16F (elevation, for a clean hillshade gradient) texture. The
 * loader (loader.ts) is the ONLY .bin reader; this module only consumes its
 * already-dequantised Float32 planes. Layer NAMES are resolved by a candidate
 * list because the bake builder owns the exact names and this build runs in
 * parallel — see the name lists in index.ts and the deviation note in the report.
 */

import type { BinLayer, ParsedBin } from '../types';

/** SST normalisation window, °C. Shader reverses: sstC = v*(MAX-MIN)+MIN. */
export const SST_MIN_C = 10;
export const SST_MAX_C = 35;

/**
 * flowacc.bin already stores log10(1 + upstream-cell-count). Normalize that
 * baked logarithmic value linearly; applying another logarithm would distort
 * the documented data contract.
 */
export function normalizeLoggedFlowAccumulation(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
  return Math.max(0, Math.min(1, value / maxValue));
}

/** Find a layer by any of `names` (exact first, then case-insensitive). */
export function pickLayer(bin: ParsedBin | null, names: readonly string[]): BinLayer | null {
  if (!bin) return null;
  for (const n of names) {
    const l = bin.layers.get(n);
    if (l) return l;
  }
  const lower = new Map<string, BinLayer>();
  bin.layers.forEach((v, k) => lower.set(k.toLowerCase(), v));
  for (const n of names) {
    const l = lower.get(n.toLowerCase());
    if (l) return l;
  }
  return null;
}

/** Slice one timestep plane (nx*ny floats) out of a layer's t-major data. */
export function planeOf(layer: BinLayer, t: number): Float32Array {
  const stride = layer.nx * layer.ny;
  const tt = Math.max(0, Math.min(t, layer.nt - 1));
  return layer.data.subarray(tt * stride, tt * stride + stride);
}

function newTex(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('render: createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Elevation as R16F (metres) with NEAREST sampling; layers do manual taps. */
export function buildElevationTex(gl: WebGL2RenderingContext, layer: BinLayer): WebGLTexture {
  const plane = planeOf(layer, 0);
  const tex = newTex(gl, gl.NEAREST);
  // R16F accepts FLOAT source data in WebGL2; the driver narrows to half-float.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, layer.nx, layer.ny, 0, gl.RED, gl.FLOAT, plane);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * A normalised R8 scalar texture: each value mapped through `norm` to [0,1].
 * `filter` LINEAR for smooth tints (SST, wadi glow), NEAREST for exact reads.
 */
export function buildR8Tex(
  gl: WebGL2RenderingContext,
  layer: BinLayer,
  t: number,
  norm: (v: number) => number,
  filter: number,
): WebGLTexture {
  const plane = planeOf(layer, t);
  const bytes = new Uint8Array(plane.length);
  for (let i = 0; i < plane.length; i++) {
    const n = norm(plane[i]);
    bytes[i] = n <= 0 ? 0 : n >= 1 ? 255 : Math.round(n * 255);
  }
  const tex = newTex(gl, filter);
  // R8 rows are nx bytes wide; the default UNPACK_ALIGNMENT of 4 only works when
  // nx % 4 === 0. Force 1 so a re-bake with any nx (headers are self-describing)
  // cannot silently raise GL_INVALID_OPERATION and render the layer black.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, layer.nx, layer.ny, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * A two-channel RG8 texture packing an integer id per texel as (id & 255, id >> 8),
 * so ids up to 65535 survive without the mod-256 aliasing an R8 texture forces.
 * Used for the basin-id layer (thousands of basins): the rain shader compares BOTH
 * channels for "same basin", so no two basins can collide. Always NEAREST — ids
 * must not be interpolated.
 */
export function buildBasinRG8Tex(gl: WebGL2RenderingContext, layer: BinLayer, t: number): WebGLTexture {
  const plane = planeOf(layer, t);
  const bytes = new Uint8Array(plane.length * 2);
  for (let i = 0; i < plane.length; i++) {
    const id = Math.max(0, Math.min(65535, Math.round(plane[i])));
    bytes[i * 2] = id & 0xff;
    bytes[i * 2 + 1] = (id >> 8) & 0xff;
  }
  const tex = newTex(gl, gl.NEAREST);
  // RG8 rows are 2*nx bytes; 2 divides into the default alignment of 4 only when
  // nx is even. Force 1 to be dimension-agnostic (same rationale as buildR8Tex).
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, layer.nx, layer.ny, 0, gl.RG, gl.UNSIGNED_BYTE, bytes);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/** Largest finite value in a plane (used to normalize scalar textures). */
export function planeMax(layer: BinLayer, t = 0): number {
  const plane = planeOf(layer, t);
  let m = 0;
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}
