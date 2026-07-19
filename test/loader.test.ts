import { describe, it, expect } from 'vitest';
import { parseBin, FORMAT_VERSION } from '../src/loader';
import { DType } from '../src/types';

/**
 * GOLDEN TEST VECTOR — a 2-layer, 2x2x1 file. The identical hex dump is
 * documented in BINARY-FORMATS.md; if you change one, change the other.
 * Layer "sst": int16, scale 0.01, offset 20  -> [30.0, 30.5, 29.0, 31.0]
 * Layer "landmask": uint8, scale 1, offset 0  -> [0, 1, 1, 0]
 * Data order per layer: row (north->south) then col (west->east).
 */
const GOLDEN_HEX =
  '5749574201020000737374000000000000010000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b407b14ae47e17a843f0000000000003440b80000000000000008000000000000006c616e646d61736b04000000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b40000000000000f03f0000000000000000c0000000000000000400000000000000e8031a0484034c0400010100';

function hexToBuffer(hex: string): ArrayBuffer {
  const clean = hex.replace(/\s+/g, '');
  const n = clean.length / 2;
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return u8.buffer;
}

describe('loader: parses the golden vector to exact values', () => {
  const buf = hexToBuffer(GOLDEN_HEX);
  const parsed = parseBin(buf);

  it('reports the format version', () => {
    expect(parsed.version).toBe(FORMAT_VERSION);
    expect(buf.byteLength).toBe(196);
  });

  it('parses both layers with correct headers', () => {
    expect([...parsed.layers.keys()]).toEqual(['sst', 'landmask']);
    const sst = parsed.layers.get('sst')!;
    expect(sst.dtype).toBe(DType.int16);
    expect(sst.quantized).toBe(true);
    expect(sst.nx).toBe(2);
    expect(sst.ny).toBe(2);
    expect(sst.nt).toBe(1);
    expect(sst.bbox).toEqual({ lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 });
    expect(sst.scale).toBeCloseTo(0.01, 12);
    expect(sst.offset).toBe(20);

    const land = parsed.layers.get('landmask')!;
    expect(land.dtype).toBe(DType.uint8);
    expect(land.quantized).toBe(false);
    expect(land.scale).toBe(1);
    expect(land.offset).toBe(0);
  });

  it('dequantizes sst via value = raw*scale + offset', () => {
    const sst = parsed.layers.get('sst')!;
    expect(Array.from(sst.data)).toEqual([30.0, 30.5, 29.0, 31.0]);
  });

  it('passes uint8 landmask through unchanged', () => {
    const land = parsed.layers.get('landmask')!;
    expect(Array.from(land.data)).toEqual([0, 1, 1, 0]);
  });
});

describe('loader: validates loudly', () => {
  it('throws on bad magic', () => {
    const bad = new Uint8Array(hexToBuffer(GOLDEN_HEX));
    bad[0] = 0x58; // 'X' instead of 'W'
    expect(() => parseBin(bad.buffer)).toThrow(/magic/i);
  });

  it('throws on an unsupported (stale) version', () => {
    const bad = new Uint8Array(hexToBuffer(GOLDEN_HEX));
    bad[4] = 99; // version byte
    expect(() => parseBin(bad.buffer)).toThrow(/version 99/i);
  });

  it('throws on a truncated buffer', () => {
    expect(() => parseBin(new ArrayBuffer(4))).toThrow(/too small/i);
  });
});
