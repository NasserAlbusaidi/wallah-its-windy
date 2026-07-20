/**
 * wiwb.ts — a minimal WIWB v1 .bin WRITER for tests (the inverse of loader.ts).
 *
 * loader.ts is the only production reader of the self-describing binary format;
 * there is no production writer in the TS tree (the bake pipeline is Python). To
 * exercise the v1.1 event-bin time-axis path (nt = timesteps, sampled with
 * setSynopticIndex(-1)) end-to-end in node, this builds a tiny in-memory bin that
 * loader.parseBin round-trips. It writes float32 layers (scale 1, offset 0) so the
 * dequantized values equal the inputs exactly. Byte layout mirrors loader.ts /
 * BINARY-FORMATS.md: 8-byte header + 88-byte layer records + contiguous data.
 */

import { DType } from '../../src/types';
import type { BBox } from '../../src/types';

const HEADER_PREFIX_BYTES = 8;
const LAYER_RECORD_BYTES = 88;

export interface WiwbLayerInput {
  /** <=8 ascii chars (e.g. "u_05"); longer names are rejected. */
  name: string;
  nx: number;
  ny: number;
  nt: number;
  bbox: BBox;
  /** length nx*ny*nt, laid t-major then row (north->south) then col: ((t*ny)+row)*nx+col. */
  data: Float32Array;
}

/** Build a parseable WIWB v1 ArrayBuffer from float32 layers. */
export function buildWiwbBin(layers: WiwbLayerInput[]): ArrayBuffer {
  const dataByteLengths = layers.map((l) => l.nx * l.ny * l.nt * 4);
  let dataStart = HEADER_PREFIX_BYTES + layers.length * LAYER_RECORD_BYTES;
  const total = dataStart + dataByteLengths.reduce((s, n) => s + n, 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);

  // Header.
  for (let i = 0; i < 4; i++) dv.setUint8(i, 'WIWB'.charCodeAt(i));
  dv.setUint8(4, 1); // version
  dv.setUint8(5, layers.length); // layerCount
  dv.setUint16(6, 0, true); // reserved

  let dataAt = dataStart;
  layers.forEach((l, i) => {
    const count = l.nx * l.ny * l.nt;
    if (l.data.length !== count) {
      throw new Error(`wiwb: layer "${l.name}" data length ${l.data.length} != nx*ny*nt ${count}`);
    }
    if (l.name.length > 8) throw new Error(`wiwb: layer name "${l.name}" exceeds 8 bytes`);
    const rec = HEADER_PREFIX_BYTES + i * LAYER_RECORD_BYTES;
    for (let c = 0; c < l.name.length; c++) dv.setUint8(rec + c, l.name.charCodeAt(c));
    dv.setUint8(rec + 8, DType.float32);
    dv.setUint8(rec + 9, 0); // quantized = false
    dv.setUint16(rec + 10, 0, true); // reserved
    dv.setUint32(rec + 12, l.nx, true);
    dv.setUint32(rec + 16, l.ny, true);
    dv.setUint32(rec + 20, l.nt, true);
    dv.setFloat64(rec + 24, l.bbox.lonMin, true);
    dv.setFloat64(rec + 32, l.bbox.lonMax, true);
    dv.setFloat64(rec + 40, l.bbox.latMin, true);
    dv.setFloat64(rec + 48, l.bbox.latMax, true);
    dv.setFloat64(rec + 56, 1, true); // scale
    dv.setFloat64(rec + 64, 0, true); // offset
    dv.setBigUint64(rec + 72, BigInt(dataAt), true);
    dv.setBigUint64(rec + 80, BigInt(dataByteLengths[i]), true);
    for (let k = 0; k < count; k++) dv.setFloat32(dataAt + k * 4, l.data[k], true);
    dataAt += dataByteLengths[i];
  });

  return buf;
}

/**
 * A per-plane-constant layer: every cell in time-plane t holds planeValues[t].
 * Handy for time-axis interpolation tests where cell choice must not matter.
 */
export function constantPlanes(nx: number, ny: number, planeValues: number[]): Float32Array {
  const nt = planeValues.length;
  const out = new Float32Array(nx * ny * nt);
  for (let t = 0; t < nt; t++) {
    const v = planeValues[t];
    for (let i = 0; i < nx * ny; i++) out[t * nx * ny + i] = v;
  }
  return out;
}
