# Binary data formats — Wallah It's Windy

The baked map data ships as small, self-describing `.bin` files (magic `WIWB`).
The runtime **hardcodes no grid geometry**: every dimension, bounding box, and
quantization scale is read from the file header. A version byte lets a stale
cached file be **rejected loudly** instead of rendering as garbage.

- Writer: `bake/binfmt.py` (`write_bin`), called by `bake/bake.py` and the
  sibling bake scripts (`bake_upper_winds.py`, `bake_ocean_profiles.py`,
  `bake_event_ocean_profiles.py`, and — via `era5_event.py` — `bake_hf3_steering.py`,
  `bake_fidelity_benchmark.py`, `bake_hf6_benchmark.py`). None ship to the
  browser.
- Reader: `src/loader.ts` (`parseBin`). This is the only reader; do not parse
  these bytes anywhere else.
- Tiny, human-inspectable assets ship as JSON instead of binary: `genesis.json`,
  `scenarios.json`, `tracks.json`, `ocean.json`, `upper.json`, the satellite
  manifest. See the end.

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

### `nt` semantics — decided by the consumer, not the header

The byte layout is identical in every mode; what the planes MEAN is a contract
between the bake that wrote the file and the code that routes it:

1. **Synoptic samples** (climatology `env.bin`
   `u/v/shr/shu/shv/rh`, `nt = 4`): each
   plane is a distinct real YEAR's month (bake/era5.py picks them; plane 0 =
   most typical). Consumers SELECT one plane per storm — the spawn seed picks
   `seed % nt` in explicit `synoptic-plane` mode — and `tFrac` is ignored.
   This is the D10 track-diversity remedy.
2. **Time axis** (event files, e.g. a Gonu `env` bake with 3-hourly steps):
   planes are consecutive timesteps; consumers select explicit `event-timeline`
   mode and `tFrac` linearly interpolates along `nt`.
3. **Depth axis** (ocean profile bins `temp_MM`/`salt_MM`): planes are the 26
   locked depth-layer midpoints (0–300 m interfaces), nothing time-varying.

`sst_MM` and `ohc_MM` stay `nt = 1` in mode 1 (OISST/WOA23 climatology).

### Layer-name convention

Month-varying fields are named `<field>_MM`, where `MM` is the **0-indexed**
calendar month, zero-padded (`sources.SEASON_MONTHS`: May = `04` … Nov = `10`).
Climatology `env.bin` carries 8 fields × 7 months:
`sst_MM u_MM v_MM shr_MM shu_MM shv_MM rh_MM ohc_MM`. Event bins carry the same
eight names with a single fixed `MM` — the event's own calendar month (Gonu =
`05`) — so the sampler resolves them unchanged. Single-plane layers are
unsuffixed (`elev`, `landmask`, `flowacc`, …). Names must fit the 8-byte
null-padded header field.

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
build expects (currently `1`). Bump the version byte in BOTH `bake/binfmt.py`
(`VERSION`) and `src/loader.ts` (`FORMAT_VERSION`) whenever the record layout
changes so old cached files fail fast with a clear message.

---

## Golden test vector

A complete, tiny file: **2 layers, each 2×2×1**, bbox = the domain
(50–70°E / 15–27°N). `test/loader.test.ts` parses these exact bytes and asserts
the decoded values; `bake/binfmt.py assert_golden_vector()` writes the same
bytes and asserts byte-identity at every bake. Keep this dump and both asserts
in sync.

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

## `flowacc.bin` hydrology layers

All four layers share the terrain grid and domain bbox:

| layer | dtype | meaning |
|---|---|---|
| `flowacc` | quantized uint16, scale `0.0001` | `log10(1 + HydroSHEDS upstream cell count)`, block-MAX reduced |
| `flowdir` | uint8 | HydroSHEDS/ESRI D8 code: 1 E, 2 SE, 4 S, 8 SW, 16 W, 32 NW, 64 N, 128 NE; 0 outlet/unrouted |
| `travmin` | uint8 | visualization-scale minutes to the `flowdir` neighbour; 0 when unrouted |
| `basin` | uint16 | outlet id retained for compatibility with pre-DIR clients |

`flowdir` and `travmin` are exact categorical data and require NEAREST texture
filtering. The runtime advances a conservative pulse using
`hydroDeltaH / (travmin / 60)`, capped for explicit-step stability. Travel time
changes animation timing only; it is not an observed discharge or flood-depth
estimate.

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
extracted from IBTrACS by the default bake: a storm qualifies if any fix enters
the 52–62°E / 16–26°N Oman box; its point is the storm's first fix inside the
playable domain, rounded to 3 dp (`sources.load_genesis_points`).

---

## Event scenarios — `env_<event>.bin`, `scenarios.json`, `tracks.json`

The event bake (`bake/bake.py events`) adds one bin per frozen catalogue event
plus `scenarios.json`. `tracks.json` is written by the DEFAULT bake (step 5/5)
but is documented here because scenarios reference its storm ids:

- **`env_<event>.bin`** — the SAME WIWB format as `env.bin`
  (version 1, identical 88-byte records, 40×24, int16 quant scale 0.01, north
  row 0). The ONLY difference is the `nt` mode-2 **time axis**:
  `sst/u/v/shr/shu/shv/rh/ohc` planes
  are consecutive 3-hourly steps, consumed by
  selecting `event-timeline` mode and interpolating along `tFrac`. Layers keep
  the scenario's fixed month-suffix names so the existing sampler resolves them
  unchanged.
  SST/RH are event-time ERA5 fields; OHC linearly interpolates adjacent WOA23
  monthly means. The real-storm wind AND RH vortex is washed out at bake time
  (gaussian_filter σ=3 cells); SST keeps its observed cold wake. See
  `bake/README.md`.
- **`scenarios.json`** — JSON (tiny). `{"version":1,"scenarios":[{id,label,bin,
  monthIndex,stepH,windowH,startIso,spawn:{lat,lon,seed},ghostId,
  benchmarkPartition,hindcast:{startIso,lat,lon,initialWindKt,
  initialOrganization,envOffsetH}}]}`. `benchmarkPartition` is the frozen
  storm-level `calibration` or `validation` split. `windowH =
  (planes−1)·stepH`, computed. `hindcast` is derived from the first observed
  ≥34-kt fix at least 1.2° inside the domain and aligns it to the bin's time axis.
- **`tracks.json`** — JSON. `{"version":1,"storms":[{id,name,year,partition,
  points:[{iso,lat,lon,windKt,presMb}]}]}`; the historic ghost-track polylines.
  `partition` is the frozen storm-level `calibration`/`validation` split.
  `lat/lon` rounded to 3 dp; `windKt/presMb` are integers or `null` when the
  CSV cell is blank; all fixes kept in time order (off-domain segments included
  — the canvas clips them).

---

## `steering_<event>.bin` pressure-level sidecars

`bake/bake_hf3_steering.py` (via `era5_event.build_pressure_wind_sidecar`) bakes
six layers — `u850 v850 u500 v500 u250 v250` — int16 quant scale 0.01, on the
same 40×24 grid and the same 3-hourly event time axis as the matching
`env_<event>.bin`. Separate bytes on purpose: adding pressure levels must not
mutate the frozen HF-1/HF-2 env bins. The full 30-storm set lives under
`calibration/data/hf3/`, with `hf3-steering-manifest.json` beside it in
`calibration/data/`; the ten public
catalogue events get byte-identical copies at `public/data/steering_<event>.bin`,
which the runtime locates by replacing `env_` with `steering_` in the scenario's
bin path.

---

## `upper.bin` upper-level wind sidecar + `upper.json`

`bake/bake_upper_winds.py` bakes the absolute 200-hPa wind the climatology
fetch always downloaded but env.bin discarded (only `V200 − V850` survived):
layers `u200_MM` / `v200_MM` for each season month (`04`..`10`), int16 quant
scale 0.01 offset 0, on the 40×24 env grid. **`nt` is mode-1 synoptic
samples** — plane k is the same picked real year as env.bin's `u_MM`/`v_MM`
plane k. That alignment is not assumed: the bake refuses to write unless every
year-picked env.bin layer (`u/v/shr/shu/shv/rh` × 7 months) reconstructs
byte-identically from the current raw ERA5 files, and `upper.json` persists
the per-month plane→year map plus the sha256 of the env.bin it was proven
against (`alignment.envBinSha256`, cross-checked to
`calibration/asset-manifest.json` by `test/integration-bins.test.ts`).
Separate bytes on purpose: `env.bin` is frozen by the URL-replay contract and
`bake.py` has no append mode. `npm run data:upper` bakes;
`npm run data:upper:check` verifies the committed bytes reproduce. No runtime
consumer reads it yet (C1 ships data + contract only; C2-class work consumes
it) — when one arrives it must parse via `src/loader.ts` and gets
integration-test coverage for the month-suffixed names, like every other
layer.

---

## Ocean profile bins — `ocean.bin`, `hf2a-event-ocean.bin`

`bake/bake_ocean_profiles.py` writes `public/data/ocean.bin` (WOA23 monthly
climatology): layers `temp_MM`/`salt_MM` per season month on the 40×24 env grid,
int16 quantized, scale `0.001`, offset `20.0` (°C) / `35.0` (PSU). **`nt` = 26
is a depth axis** — the midpoints of the locked 0–300 m interfaces (mode 3
above). `ocean.json` is the provenance sidecar (grid, depth tables, source URLs
+ sha256); the runtime fetches only the bin.

`bake/bake_event_ocean_profiles.py` writes the event twin,
`calibration/data/hf2a-event-ocean.bin`: per-storm GODAS profiles from the last
completed month before each hindcast initialization, as `tNNN`/`sNNN` layer
pairs (`NNN` = the storm's index in the HF-2A contract partition order), same
dtype/scales/depth axis, with `hf2a-event-ocean.json` metadata.

---

## Satellite frames — `public/data/satellite/manifest.json`

Not WIWB. `bake/satellite_frames.py` caches observed Meteosat/INSAT frames as
PNG/WebP crops of the domain plus a JSON manifest:
`{"version":1,"frames":[{id,provider,satellite,product,observedAt,channel,
imageUrl,sourceUrl,attribution,license,bbox,cached}]}`. The browser reads the
manifest and displays the images directly; no binary parsing involved.
