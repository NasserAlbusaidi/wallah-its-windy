# Binary data formats — Wallah It's Windy

The baked map data ships as small, self-describing `.bin` files (magic `WIWB`).
The runtime **hardcodes no grid geometry**: every dimension, bounding box, and
quantization scale is read from the file header. A version byte lets a stale
cached file be **rejected loudly** instead of rendering as garbage.

- Writer: `bake/bake.py` (not shipped to the browser).
- Reader: `src/loader.ts` (`parseBin`). This is the only reader; do not parse
  these bytes anywhere else.
- Genesis zones are the one exception — they ship as JSON, see the end.

All multi-byte fields are **little-endian**.

---

## Row order (the one convention everything agrees on)

Data planes are stored **row-major, north-to-south**:

- **Row 0 is the NORTH edge** of the bbox (`latMax`); the last row is the SOUTH
  edge (`latMin`).
- Within a row, columns run **west → east** (`lonMin` → `lonMax`).
- With a timestep axis, planes are **t-major**: all of t=0's rows, then t=1's.

Flat index for cell `(t, row, col)` in a layer of size `nx × ny × nt`:

```
index = ((t * ny) + row) * nx + col
```

`src/grid.ts` owns the cell↔latlon math for this convention (`cellToLatLon`
puts row 0 at the north edge). Nothing else may reimplement it.

### `nt` semantics — two modes, decided by the consumer, not the header

The byte layout is identical either way; what the planes MEAN is a contract
between the bake that wrote the file and the code that routes it:

1. **Synoptic samples** (v1.0 climatology `env.bin` `u/v/shr`, `nt = 4`): each
   plane is a distinct real YEAR's month (bake/era5.py picks them; plane 0 =
   most typical). Consumers SELECT one plane per storm — the spawn seed picks
   `seed % nt` via `env-sampler.setSynopticIndex()` — and `tFrac` is ignored.
   This is the D10 track-diversity remedy.
2. **Time axis** (v1.1 event files, e.g. a Gonu `env` bake with hourly steps):
   planes are consecutive timesteps; consumers clear the synoptic index (−1)
   and `tFrac` linearly interpolates along `nt`.

`sst_MM` stays `nt = 1` in mode 1 (OISST long-term mean).

---

## File layout

```
┌─ header prefix (8 bytes) ─────────────────────────────┐
│ offset size field                                     │
│   0     4   magic  = ASCII "WIWB" (57 49 57 42)       │
│   4     1   version = u8 (currently 1)                │
│   5     1   layerCount = u8                           │
│   6     2   reserved = u16 (0)                        │
└───────────────────────────────────────────────────────┘
┌─ layer record × layerCount (88 bytes each) ───────────┐
│ offset size field                                     │
│   0     8   name    = ASCII, null-padded to 8 bytes   │
│   8     1   dtype   = u8 (see codes below)            │
│   9     1   quant   = u8 (0 = raw, 1 = quantized)     │
│  10     2   reserved = u16 (0)                        │
│  12     4   nx = u32                                   │
│  16     4   ny = u32                                   │
│  20     4   nt = u32                                   │
│  24     8   bbox lonMin = f64                          │
│  32     8   bbox lonMax = f64                          │
│  40     8   bbox latMin = f64                          │
│  48     8   bbox latMax = f64                          │
│  56     8   scale  = f64                               │
│  64     8   offset = f64                               │
│  72     8   byteOffset = u64 (into this file)         │
│  80     8   byteLength = u64                           │
└───────────────────────────────────────────────────────┘
┌─ data section ────────────────────────────────────────┐
│ each layer's raw plane at its byteOffset/byteLength    │
│ (dtype-typed, little-endian, ordered as above)         │
└───────────────────────────────────────────────────────┘
```

The data section begins at `8 + 88 * layerCount`. Layers may appear in any order
in the data section; the reader trusts each record's `byteOffset`/`byteLength`.

### dtype codes

| code | type    | elem bytes |
|------|---------|-----------:|
| 0    | int16   | 2          |
| 1    | uint16  | 2          |
| 2    | float32 | 4          |
| 3    | int8    | 1          |
| 4    | uint8   | 1          |

### Dequantization

Every layer is decoded to `Float32Array` by the reader:

```
value = raw * scale + offset
```

For an unquantized float layer use `scale = 1`, `offset = 0` (and set
`quant = 0`). Example: elevation as int16 metres needs `scale = 1, offset = 0`;
SST quantized to centidegrees uses `scale = 0.01, offset = 20.0`.

### Version handling

`parseBin` throws if the magic is not `WIWB` or the version is not the value the
build expects (currently `1`). Bump the version byte in `bake.py` whenever the
record layout changes so old cached files fail fast with a clear message.

---

## Golden test vector

A complete, tiny file: **2 layers, each 2×2×1**, bbox = the domain
(50–70°E / 15–27°N). `test/loader.test.ts` parses these exact bytes and asserts
the decoded values; keep this dump and that test in sync.

- Layer `sst`: `int16`, quantized, `scale = 0.01`, `offset = 20.0`.
  Raw `[1000, 1050, 900, 1100]` → **`[30.0, 30.5, 29.0, 31.0]`** °C.
- Layer `landmask`: `uint8`, unquantized, `scale = 1`, `offset = 0`.
  Raw/decoded **`[0, 1, 1, 0]`**.

Decoded cells, in row-major north→south order, are
`(row0col0, row0col1, row1col0, row1col1)`.

Total file size: **196 bytes**.

```
offset  bytes
0000    57 49 57 42 01 02 00 00   magic "WIWB", ver 1, 2 layers, reserved
0008    73 73 74 00 00 00 00 00   layer0 name "sst"
0010    00 01 00 00               dtype 0 (int16), quant 1, reserved
0014    02 00 00 00               nx = 2
0018    02 00 00 00               ny = 2
001c    01 00 00 00               nt = 1
0020    00 00 00 00 00 00 49 40   lonMin = 50.0
0028    00 00 00 00 00 80 51 40   lonMax = 70.0
0030    00 00 00 00 00 00 2e 40   latMin = 15.0
0038    00 00 00 00 00 00 3b 40   latMax = 27.0
0040    7b 14 ae 47 e1 7a 84 3f   scale = 0.01
0048    00 00 00 00 00 00 34 40   offset = 20.0
0050    b8 00 00 00 00 00 00 00   byteOffset = 184
0058    08 00 00 00 00 00 00 00   byteLength = 8
0060    6c 61 6e 64 6d 61 73 6b   layer1 name "landmask"
0068    04 00 00 00               dtype 4 (uint8), quant 0, reserved
006c    02 00 00 00               nx = 2
0070    02 00 00 00               ny = 2
0074    01 00 00 00               nt = 1
0078    00 00 00 00 00 00 49 40   lonMin = 50.0
0080    00 00 00 00 00 80 51 40   lonMax = 70.0
0088    00 00 00 00 00 00 2e 40   latMin = 15.0
0090    00 00 00 00 00 00 3b 40   latMax = 27.0
0098    00 00 00 00 00 00 f0 3f   scale = 1.0
00a0    00 00 00 00 00 00 00 00   offset = 0.0
00a8    c0 00 00 00 00 00 00 00   byteOffset = 192
00b0    04 00 00 00 00 00 00 00   byteLength = 4
00b8    e8 03 1a 04 84 03 4c 04   sst int16: 1000, 1050, 900, 1100
00c0    00 01 01 00               landmask uint8: 0, 1, 1, 0
```

Continuous hex (whitespace-insensitive), the exact string in the test:

```
5749574201020000737374000000000000010000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b407b14ae47e17a843f0000000000003440b80000000000000008000000000000006c616e646d61736b04000000020000000200000001000000000000000000494000000000008051400000000000002e400000000000003b40000000000000f03f0000000000000000c0000000000000000400000000000000e8031a0484034c0400010100
```

---

## Genesis zones — `public/data/genesis.json`

Historic genesis points ship as **JSON, not binary**: the payload is tiny
(a few dozen `{lat, lon}` pairs), human-readable, and hand-inspectable, so a
binary format would only add friction. Schema:

```json
[
  { "lat": 15.6, "lon": 68.0 },
  { "lat": 20.0, "lon": 61.0 }
]
```

These drive the faint historic-genesis-zone glow (eng task T8) that nudges spawns
toward interesting outcomes without biasing the physics. The committed values are
**approximate placeholders**; weekend two replaces them with points extracted
from IBTrACS for storms that actually reached Oman.
