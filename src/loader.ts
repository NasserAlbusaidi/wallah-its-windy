/**
 * loader.ts — parser for the self-describing .bin format (eng task T4).
 *
 * The full byte layout, row order, dtype codes, and a golden hex test vector
 * live in BINARY-FORMATS.md. This module is the ONLY reader of that format; it
 * validates magic + version loudly (a stale file throws, it never renders
 * garbage), then dequantizes every layer to Float32Array via value = raw*scale +
 * offset. The runtime hardcodes no grid geometry — dims and bbox come from the
 * header (that is the whole reason the format is self-describing).
 */

import { DType } from './types';
import type { BinLayer, DTypeCode, GridSpec, ParsedBin } from './types';

export const FORMAT_MAGIC = 'WIWB';
export const FORMAT_VERSION = 1;
/** magic(4) + version(1) + layerCount(1) + reserved(2). */
export const HEADER_PREFIX_BYTES = 8;
/** name(8)+dtype(1)+quant(1)+reserved(2)+nx/ny/nt(12)+bbox(32)+scale/offset(16)+off/len(16). */
export const LAYER_RECORD_BYTES = 88;

const ELEM_BYTES: Record<DTypeCode, number> = {
  [DType.int16]: 2,
  [DType.uint16]: 2,
  [DType.float32]: 4,
  [DType.int8]: 1,
  [DType.uint8]: 1,
};

function isDTypeCode(n: number): n is DTypeCode {
  return n === DType.int16 || n === DType.uint16 || n === DType.float32 || n === DType.int8 || n === DType.uint8;
}

/** Read a fixed 8-byte, null-padded ascii layer name. */
function readName(dv: DataView, at: number): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const c = dv.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Slice out a layer's raw bytes into an aligned buffer and dequantize to floats. */
function dequantize(
  buffer: ArrayBuffer,
  dtype: DTypeCode,
  byteOffset: number,
  count: number,
  scale: number,
  offset: number,
): Float32Array {
  const byteLen = count * ELEM_BYTES[dtype];
  // slice() returns a fresh, 0-aligned ArrayBuffer, so typed-array construction
  // is safe regardless of the layer's byteOffset alignment in the source file.
  const slice = buffer.slice(byteOffset, byteOffset + byteLen);
  let raw: ArrayLike<number>;
  switch (dtype) {
    case DType.int16: raw = new Int16Array(slice); break;
    case DType.uint16: raw = new Uint16Array(slice); break;
    case DType.float32: raw = new Float32Array(slice); break;
    case DType.int8: raw = new Int8Array(slice); break;
    case DType.uint8: raw = new Uint8Array(slice); break;
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = raw[i] * scale + offset;
  return out;
}

/**
 * Parse a .bin ArrayBuffer into a {@link ParsedBin}. Throws a clear Error on a
 * bad magic or an unsupported version (loudly rejecting stale cached files),
 * and on any layer whose declared byte length disagrees with its dims.
 */
export function parseBin(buffer: ArrayBuffer): ParsedBin {
  if (buffer.byteLength < HEADER_PREFIX_BYTES) {
    throw new Error(`.bin too small: ${buffer.byteLength} bytes, need at least ${HEADER_PREFIX_BYTES}.`);
  }
  const dv = new DataView(buffer);

  const magic = readName(dv, 0).slice(0, 4);
  if (magic !== FORMAT_MAGIC) {
    throw new Error(`Bad .bin magic: expected "${FORMAT_MAGIC}", got "${magic}". Not a Wallah-It's-Windy binary.`);
  }
  const version = dv.getUint8(4);
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `Unsupported .bin version ${version}; this build parses version ${FORMAT_VERSION}. ` +
        `Re-bake the data (the format changed) — refusing to render a stale file.`,
    );
  }
  const layerCount = dv.getUint8(5);
  // bytes 6..7: reserved u16, ignored.

  const layers = new Map<string, BinLayer>();
  let at = HEADER_PREFIX_BYTES;
  for (let i = 0; i < layerCount; i++) {
    if (at + LAYER_RECORD_BYTES > buffer.byteLength) {
      throw new Error(`.bin truncated: layer ${i} header runs past end of file.`);
    }
    const name = readName(dv, at);
    const dtypeRaw = dv.getUint8(at + 8);
    if (!isDTypeCode(dtypeRaw)) {
      throw new Error(`.bin layer "${name}": unknown dtype code ${dtypeRaw}.`);
    }
    const dtype: DTypeCode = dtypeRaw;
    const quantized = dv.getUint8(at + 9) !== 0;
    // at+10..11: reserved u16.
    const nx = dv.getUint32(at + 12, true);
    const ny = dv.getUint32(at + 16, true);
    const nt = dv.getUint32(at + 20, true);
    const lonMin = dv.getFloat64(at + 24, true);
    const lonMax = dv.getFloat64(at + 32, true);
    const latMin = dv.getFloat64(at + 40, true);
    const latMax = dv.getFloat64(at + 48, true);
    const scale = dv.getFloat64(at + 56, true);
    const offset = dv.getFloat64(at + 64, true);
    const byteOffset = Number(dv.getBigUint64(at + 72, true));
    const byteLength = Number(dv.getBigUint64(at + 80, true));

    const count = nx * ny * nt;
    const expected = count * ELEM_BYTES[dtype];
    if (byteLength !== expected) {
      throw new Error(
        `.bin layer "${name}": byteLength ${byteLength} != nx*ny*nt*elem ${expected} ` +
          `(nx=${nx} ny=${ny} nt=${nt} dtype=${dtype}).`,
      );
    }
    if (byteOffset + byteLength > buffer.byteLength) {
      throw new Error(`.bin layer "${name}": data [${byteOffset},${byteOffset + byteLength}) runs past end of file.`);
    }

    layers.set(name, {
      name,
      dtype,
      quantized,
      nx,
      ny,
      nt,
      bbox: { lonMin, lonMax, latMin, latMax },
      scale,
      offset,
      data: dequantize(buffer, dtype, byteOffset, count, scale, offset),
    });

    at += LAYER_RECORD_BYTES;
  }

  return { version, layers };
}

/** Convenience: the {@link GridSpec} for a parsed layer, for grid.ts sampling. */
export function layerGridSpec(layer: BinLayer): GridSpec {
  return { nx: layer.nx, ny: layer.ny, bbox: layer.bbox };
}
