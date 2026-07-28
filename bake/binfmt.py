"""
binfmt.py — writer + reference parser for the self-describing WIWB .bin format.

This is the Python side of the contract in ../BINARY-FORMATS.md and the mirror of
../src/loader.ts (the browser reader). BINARY-FORMATS.md is LAW; this module is
tested byte-for-byte against the golden vector printed there (see
assert_golden_vector). If the two ever disagree, the doc wins and this file is the
bug.

Layout (all little-endian):
  header prefix (8B): magic "WIWB"(4) | version u8 | layerCount u8 | reserved u16
  layer record (88B): name(8 ascii null-pad) | dtype u8 | quant u8 | reserved u16
                      | nx u32 | ny u32 | nt u32
                      | lonMin/lonMax/latMin/latMax f64 | scale f64 | offset f64
                      | byteOffset u64 | byteLength u64
  data section starts at 8 + 88*layerCount; planes are row-major north->south,
  t-major: index = ((t*ny)+row)*nx + col.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"WIWB"
VERSION = 1
HEADER_PREFIX_BYTES = 8
LAYER_RECORD_BYTES = 88

# dtype code <-> numpy little-endian dtype. Codes are fixed by BINARY-FORMATS.md.
DTYPE_CODE = {
    "int16": 0,
    "uint16": 1,
    "float32": 2,
    "int8": 3,
    "uint8": 4,
}
_CODE_TO_NP = {
    0: np.dtype("<i2"),
    1: np.dtype("<u2"),
    2: np.dtype("<f4"),
    3: np.dtype("<i1"),
    4: np.dtype("<u1"),
}
_CODE_ELEM_BYTES = {0: 2, 1: 2, 2: 4, 3: 1, 4: 1}


@dataclass
class Layer:
    """One layer to write. `data` is a numpy array already laid out row-major
    north->south, t-major, of the raw (pre-dequant) integer/float values."""

    name: str
    dtype: str  # key of DTYPE_CODE
    quant: bool
    nx: int
    ny: int
    nt: int
    bbox: tuple[float, float, float, float]  # (lonMin, lonMax, latMin, latMax)
    scale: float
    offset: float
    data: np.ndarray

    def raw_bytes(self) -> bytes:
        code = DTYPE_CODE[self.dtype]
        npdt = _CODE_TO_NP[code]
        arr = np.asarray(self.data)
        expect = self.nx * self.ny * self.nt
        if arr.size != expect:
            raise ValueError(
                f"layer {self.name}: {arr.size} elems != nx*ny*nt={expect}"
            )
        return arr.astype(npdt, copy=False).tobytes()


def write_bin(path: str | None, layers: list[Layer]) -> bytes:
    """Serialise layers to the WIWB byte stream; write to `path` if given.
    Returns the exact bytes (used by the roundtrip assert)."""
    if len(layers) > 255:
        raise ValueError("layerCount is u8; max 255 layers")

    header = bytearray()
    header += MAGIC
    header += struct.pack("<BBH", VERSION, len(layers), 0)

    data_start = HEADER_PREFIX_BYTES + LAYER_RECORD_BYTES * len(layers)
    records = bytearray()
    data = bytearray()
    cursor = data_start
    for ly in layers:
        payload = ly.raw_bytes()
        byte_len = len(payload)
        expect = ly.nx * ly.ny * ly.nt * _CODE_ELEM_BYTES[DTYPE_CODE[ly.dtype]]
        if byte_len != expect:
            raise ValueError(f"layer {ly.name}: byteLength {byte_len} != {expect}")
        name_bytes = ly.name.encode("ascii")
        if len(name_bytes) > 8:
            raise ValueError(f"layer name too long (>8 bytes): {ly.name!r}")
        name_bytes = name_bytes.ljust(8, b"\x00")

        rec = bytearray()
        rec += name_bytes
        rec += struct.pack("<BBH", DTYPE_CODE[ly.dtype], 1 if ly.quant else 0, 0)
        rec += struct.pack("<III", ly.nx, ly.ny, ly.nt)
        lon_min, lon_max, lat_min, lat_max = ly.bbox
        rec += struct.pack("<dddd", lon_min, lon_max, lat_min, lat_max)
        rec += struct.pack("<dd", ly.scale, ly.offset)
        rec += struct.pack("<QQ", cursor, byte_len)
        assert len(rec) == LAYER_RECORD_BYTES, len(rec)
        records += rec

        data += payload
        cursor += byte_len

    blob = bytes(header + records + data)
    if path is not None:
        with open(path, "wb") as fh:
            fh.write(blob)
    return blob


@dataclass
class ParsedLayer:
    name: str
    dtype: int
    quantized: bool
    nx: int
    ny: int
    nt: int
    bbox: tuple[float, float, float, float]
    scale: float
    offset: float
    data: np.ndarray  # dequantized float32


def _iter_records(blob: bytes):
    """Yield each layer record's fields; shared by parse_bin/parse_bin_raw."""
    if len(blob) < HEADER_PREFIX_BYTES:
        raise ValueError("blob too small for header")
    if blob[0:4] != MAGIC:
        raise ValueError(f"bad magic {blob[0:4]!r}, expected {MAGIC!r}")
    version, layer_count, _reserved = struct.unpack_from("<BBH", blob, 4)
    if version != VERSION:
        raise ValueError(f"unsupported version {version}, expected {VERSION}")
    if HEADER_PREFIX_BYTES + LAYER_RECORD_BYTES * layer_count > len(blob):
        raise ValueError(
            f"record table for {layer_count} layers runs past end of file"
        )
    at = HEADER_PREFIX_BYTES
    for _ in range(layer_count):
        name = blob[at : at + 8].split(b"\x00", 1)[0].decode("ascii")
        dtype, quant, _r = struct.unpack_from("<BBH", blob, at + 8)
        if dtype not in _CODE_ELEM_BYTES:
            raise ValueError(f"{name}: unsupported dtype code {dtype}")
        if quant not in (0, 1):
            raise ValueError(f"{name}: invalid quant flag {quant}, expected 0 or 1")
        nx, ny, nt = struct.unpack_from("<III", blob, at + 12)
        bbox = struct.unpack_from("<dddd", blob, at + 24)
        scale, offset = struct.unpack_from("<dd", blob, at + 56)
        byte_off, byte_len = struct.unpack_from("<QQ", blob, at + 72)
        yield (
            name, dtype, quant, nx, ny, nt, bbox, scale, offset,
            byte_off, byte_len,
        )
        at += LAYER_RECORD_BYTES


@dataclass
class RawLayer:
    name: str
    dtype: int
    quantized: bool
    nx: int
    ny: int
    nt: int
    bbox: tuple[float, float, float, float]
    scale: float
    offset: float
    payload: bytes  # exact stored bytes, never dequantized


def parse_bin_raw(blob: bytes) -> dict[str, RawLayer]:
    """Records + UNDECODED payload bytes, for byte-level alignment gates
    (bake_upper_winds.py). parse_bin dequantizes to float32 and is lossy for
    byte comparison; this accessor exists so no other module re-walks the
    header layout."""
    out: dict[str, RawLayer] = {}
    for (
        name, dtype, quant, nx, ny, nt, bbox, scale, offset, off, length
    ) in _iter_records(blob):
        expect = nx * ny * nt * _CODE_ELEM_BYTES[dtype]
        if length != expect:
            raise ValueError(f"{name}: byteLength {length} != {expect}")
        if off + length > len(blob):
            raise ValueError(
                f"{name}: data [{off},{off + length}) runs past end of file"
            )
        if name in out:
            raise ValueError(f"duplicate layer name {name!r}")
        out[name] = RawLayer(
            name, dtype, bool(quant), nx, ny, nt, bbox, scale, offset,
            blob[off : off + length],
        )
    return out


def quantize_int16(a: np.ndarray, scale: float, offset: float) -> np.ndarray:
    """The int16 quantization contract (inverse of value = raw*scale + offset).
    Extracted from bake.py's build_env closure so every bake — env.bin and the
    sidecars verified against it — quantizes with the same expression."""
    raw = np.round((a - offset) / scale)
    return np.clip(raw, -32768, 32767).astype(np.int16).ravel(order="C")


def parse_bin(blob: bytes) -> dict[str, ParsedLayer]:
    """Reference parser mirroring src/loader.ts parseBin. Dequantizes every layer
    to float32 via value = raw*scale + offset. Raises on bad magic/version so the
    roundtrip assert catches any writer drift loudly."""
    out: dict[str, ParsedLayer] = {}
    for (
        name, dtype, quant, nx, ny, nt, bbox, scale, offset, byte_off, byte_len
    ) in _iter_records(blob):

        count = nx * ny * nt
        expect = count * _CODE_ELEM_BYTES[dtype]
        if byte_len != expect:
            raise ValueError(f"{name}: byteLength {byte_len} != {expect}")
        if byte_off + byte_len > len(blob):
            raise ValueError(
                f"{name}: data [{byte_off},{byte_off + byte_len}) "
                "runs past end of file"
            )
        raw = np.frombuffer(blob, dtype=_CODE_TO_NP[dtype], count=count, offset=byte_off)
        data = raw.astype(np.float32) * np.float32(scale) + np.float32(offset)
        out[name] = ParsedLayer(
            name, dtype, bool(quant), nx, ny, nt,
            bbox, scale, offset, data,
        )
    return out


# ---------------------------------------------------------------------------
# Golden-vector assert (eng task T6, bake half): header write->parse roundtrip
# against the exact bytes documented in BINARY-FORMATS.md.
# ---------------------------------------------------------------------------

# The exact continuous golden hex from BINARY-FORMATS.md (whitespace-insensitive).
GOLDEN_HEX = (
    "5749574201020000737374000000000000010000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b407b14ae47e17a843f0000000000003440b80000000000000008000000000000006c616e646d61736b04000000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b40000000000000f03f0000000000000000c0000000000000000400000000000000e8031a0484034c0400010100"
)


def assert_golden_vector() -> str:
    """Build the golden file with write_bin and assert byte-identity with the
    doc, then parse it back and check decoded values. Returns a status line."""
    domain = (50.0, 70.0, 15.0, 27.0)
    sst = Layer(
        name="sst", dtype="int16", quant=True, nx=2, ny=2, nt=1,
        bbox=domain, scale=0.01, offset=20.0,
        data=np.array([1000, 1050, 900, 1100], dtype="<i2"),
    )
    landmask = Layer(
        name="landmask", dtype="uint8", quant=False, nx=2, ny=2, nt=1,
        bbox=domain, scale=1.0, offset=0.0,
        data=np.array([0, 1, 1, 0], dtype="<u1"),
    )
    blob = write_bin(None, [sst, landmask])
    got = blob.hex()
    want = GOLDEN_HEX.lower()
    if got != want:
        raise AssertionError(
            "golden vector MISMATCH\n  got : " + got + "\n  want: " + want
        )
    if len(blob) != 196:
        raise AssertionError(f"golden file size {len(blob)} != 196")

    parsed = parse_bin(blob)
    got_sst = parsed["sst"].data.tolist()
    want_sst = [30.0, 30.5, 29.0, 31.0]
    if [round(v, 4) for v in got_sst] != want_sst:
        raise AssertionError(f"sst decode {got_sst} != {want_sst}")
    got_lm = parsed["landmask"].data.tolist()
    if got_lm != [0.0, 1.0, 1.0, 0.0]:
        raise AssertionError(f"landmask decode {got_lm} != [0,1,1,0]")
    return f"golden vector OK (196 bytes, byte-identical to BINARY-FORMATS.md; sst->{want_sst}, landmask->[0,1,1,0])"


if __name__ == "__main__":
    print(assert_golden_vector())
