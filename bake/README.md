# bake — baked map data for *Wallah It's Windy*

Turns free, public geodata into the baked data files the browser loads: five
default files, plus opt-in event, ocean-column, steering, and satellite assets.
Nothing here ships to the browser; it runs once at build time. The output format
is LAW: see [`../BINARY-FORMATS.md`](../BINARY-FORMATS.md). This directory is the
Python source of truth for the *actual* grid dimensions the self-describing `.bin`
headers advertise (the runtime hardcodes none of them).

## Reproduce

```bash
cd wallah-its-windy
# Windows may use `python`; POSIX installations commonly use `python3`.
python3 -m venv bake/.venv
node bake/run-python.mjs -m pip install --upgrade pip
node bake/run-python.mjs -m pip install -r bake/requirements.txt
node bake/run-python.mjs bake/bake.py
```

The launcher selects `.venv/bin/python` on POSIX and
`.venv/Scripts/python.exe` on Windows, and fails rather than falling back to a
system interpreter. macOS, Python 3.14, numpy 2.x. Raw downloads cache under
`data/raw/` (gitignored);
a second run reuses them. Total runtime ≈ 15 s after downloads. The script prints
its progress, selected real years, thermodynamic ranges, and bake-time asserts.

On a clean checkout, `env.bin` needs the two ERA5 climatology files in
`data/raw/` first (`bake/fetch_era5.py`, free CDS token — see the active
pipeline below): winds alone would fall back to the labelled synthetic source,
but humidity has no synthetic fallback, so the bake fails loudly instead of
shipping fake RH. The four `fetch_*` scripts require `cdsapi`, which is not in
`requirements.txt` (the bake itself is offline); install it into the venv
before fetching.

## Outputs (default runtime set: ~7.7 MiB raw, budget ≤ 8.5 MiB)

| file | layers | grid | source |
|------|--------|------|--------|
| `terrain.bin` | `elev` (int16 m), `landmask` (uint8) | 1040×668 (~2 km) | GMRT (real bathy+topo) |
| `context-terrain.bin` | `elev` (int16 m), `landmask` (uint8) | 875×550 (0.04°) | GMRT (real regional bathy+topo; presentation only) |
| `env.bin` | `sst_MM`,`u_MM`,`v_MM`,`shr_MM`,`shu_MM`,`shv_MM`,`rh_MM`,`ohc_MM` × 7 months | 40×24 (0.5°) | OISST + ERA5 + WOA23 |
| `flowacc.bin` | `flowacc` (uint16 log), `flowdir` (uint8 D8), `travmin` (uint8 minutes), `basin` (uint16 compatibility) | 1040×668 | HydroSHEDS v1.1 ACC+DIR |
| `genesis.json` | `[{lat,lon}]` | — | IBTrACS North Indian |
| `tracks.json` | ten observed ghost-track polylines | — | IBTrACS North Indian |

### Presentation-only regional terrain context

`context-terrain.bin` is a separately reproducible GMRT sidecar for the larger
display box declared in `config/display-domain.json` (currently 45–80° E,
8–30° N at 875×550, or 0.04° cells):

```bash
npm run data:context-terrain
npm run data:context-terrain:check
```

It carries only `elev` and `landmask`, and is used for real relief/bathymetry
outside the fixed 50–70° E, 15–27° N simulation box. It does **not** widen the
physics domain, repeat weather edge texels, or imply forcing coverage. The
configuration id (`arabian-sea-context-v1`) versions the bbox/grid contract;
change the id whenever that contract changes. The raw GMRT SHA-256 is pinned in
the same contract and verified on every bake. The source NetCDF is cached under
`data/raw/`, while the compact WIWB output is committed under `public/data/` and
covered by the static asset hash manifest.

Opt-in bakes commit more under `public/data/` (~26 MB total as committed): ten
`env_<event>.bin` + `scenarios.json` (event bake, below), ten
`steering_<event>.bin` (`npm run data:hf3:steering`), `ocean.bin` + `ocean.json`
WOA23 temperature/salinity profiles (`npm run data:hf2a:profiles`), and
`satellite/manifest.json` (satellite frames, below). The ≤ 8.5 MiB budget applies
to the six default runtime files listed above.

The physical-structure calibration subset is a separate offline artifact under
`calibration/data/`; it never ships in `public/` or the browser bundle. Rebuild
it from the same pinned IBTrACS raw download with:

```bash
python3 bake/extract_structure_validation.py
```

The extractor (`npm run data:structure`) verifies the raw SHA-256, keeps
six-hour main-track tropical fixes from 2019–2024, and uses USA/JTWC columns
consistently for position, one-minute wind, pressure, RMW, and quadrant radii.

The larger HF-1 replay reference is also offline-only. It freezes 30 storms,
reuses the ten public event bins, and bakes 20 additional compact bins under
`calibration/data/fidelity/`:

```bash
npm run data:fidelity:catalog
npm run data:fidelity:fetch
npm run data:fidelity:bake
npm run fidelity
```

`bake/fidelity_catalog.py` owns the reviewed storm identities and permanent
18/6/6 split and rejects any change to the pinned raw IBTrACS checksum.
`bake/fetch_fidelity_benchmark.py` issues resumable, month-sized
ERA5 requests with the same variables, domain, grid, and hours as the featured
event pipeline. `bake/bake_fidelity_benchmark.py` uses the same vortex filter,
3-hour temporal reduction, WOA23 OHC interpolation, and WIWB writer as the
public event bake. Raw NetCDF files stay gitignored; only the compact benchmark
artifacts are committed. None of these 20 bins is copied to `public/`.

### `env.bin` layer naming (the EnvSampler must know this)

One layer **per field per month**. SST and OHC have `nt = 1`; the five wind
fields and RH have `nt = 4` aligned, coherent real-year planes. Names (≤ 8-byte
limit forces the short forms):

```
sst_MM   SST °C          int16 quant scale 0.01 offset 20.0   (real OISST)
u_MM     steering U m/s  int16 quant scale 0.01 offset 0.0    (ERA5)
v_MM     steering V m/s  int16 quant scale 0.01 offset 0.0    (ERA5)
shr_MM   shear mag m/s   int16 quant scale 0.01 offset 0.0    (ERA5)
shu_MM   shear U m/s     int16 quant scale 0.01 offset 0.0    (ERA5 V200−V850)
shv_MM   shear V m/s     int16 quant scale 0.01 offset 0.0    (ERA5 V200−V850)
rh_MM    mean RH %       int16 quant scale 0.01 offset 0.0    (ERA5 600/700 hPa)
ohc_MM   OHC26 kJ/cm²    int16 quant scale 0.01 offset 0.0    (NOAA WOA23)
```

`MM` is the **0-indexed calendar month, zero-padded**: May=`04` … Nov=`10` (only
these 7 exist). **Month and the timestep axis (`nt`) are orthogonal**: `monthIndex`
picks the layer. In climatology mode, the seed freezes one aligned wind/RH
real-year plane and `tFrac` is ignored; in event mode, `tFrac` interpolates all
eight chronological fields without any format change. Recommended sampler lookup:

```
name = `sst_${String(clamp(monthIndex,4,10)).padStart(2,'0')}`
```

Months outside May–Nov are not baked (no Arabian-Sea cyclone season) — clamp.

## Sources & licenses (auth-free, except ERA5's free CDS token)

- **GMRT** GridServer (bathymetry + topography), `resolution=med`, auto-coarsened
  to ~1.8 km over the full box, block-mean/any-land downsampled to 2 km.
  `https://www.gmrt.org/services/GridServer?...&format=netcdf&resolution=med`
  License: free with attribution — Ryan, W.B.F. et al. (2009), *Geochem. Geophys.
  Geosyst.* 10, Q03014.
- **NOAA OISST v2** monthly long-term-mean climatology (1991–2020), 1° global.
  `https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2/sst.ltm.1991-2020.nc`
  License: U.S. Government work, public domain; provided by NOAA PSL, Boulder.
- **IBTrACS v04r01** North Indian basin CSV.
  `https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv`
  License: public domain; cite Knapp et al. (2010) + Gahtan et al. (2024).
- **HydroSHEDS v1.1** Europe/Middle-East 30 arc-second ACC+DIR GeoTIFFs.
  `https://data.hydrosheds.org/file/hydrosheds-v1-acc/hyd_eu_acc_30s.zip`
  `https://data.hydrosheds.org/file/hydrosheds-v1-dir/hyd_eu_dir_30s.zip`
  License: HydroSHEDS © WWF; cite Lehner, B., Verdin, K., Jarvis, A. (2008),
  *Eos* 89(10). Also reused by `bake_regions.py` to derive the 0.1° wadi
  basin ids for `regions.bin`.
- **Natural Earth 10m admin-1** states/provinces GeoJSON, pinned release
  v5.1.2, filtered to Oman for the `regions.bin` governorate raster.
  `https://github.com/nvkelso/natural-earth-vector/raw/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson`
  License: public domain (Natural Earth).
- **ERA5** pressure-level winds for climatological samples and event windows —
  see the active pipeline below.
- **ERA5** 600/700-hPa relative humidity and event-time SST, fetched by
  `bake/fetch_era5.py` with the same domain/time axes as the winds.
- **NOAA World Ocean Atlas 2023**, monthly 1° temperature profiles. `bake/woa23.py`
  downloads NCSS subsets (with the official full monthly file as a resilient
  fallback) and integrates heat above 26 °C as
  `rho * cp * integral(max(T−26,0) dz) / 1e7` to kJ/cm².

## Downsample rules (eng task T3)

- elevation → block **mean**; land mask → **any-land-wins**.
- HydroSHEDS ACC → **block-MAX**, preserving narrow high-accumulation channels.
- HydroSHEDS DIR → the D8 code at that same maximum-ACC source pixel, followed
  until it crosses into a neighbouring 2 km target cell.
- `travmin` → distance to that neighbour divided by a visualization-scale channel
  velocity of 2–10 km/h. The runtime integrates it against simulated hours.

## Bake-time asserts (eng task T6)

1. **Golden-vector roundtrip** — `binfmt.write_bin` reproduces the exact bytes of
   the golden vector in `BINARY-FORMATS.md` (byte-identical, 196 bytes), then
   `parse_bin` decodes them to the documented values. Fails loudly on any drift.
2. **ACC connectivity** — top-1 % flow-accumulation cells must be ≥ 60 % inside
   connected components of ≥ 5 cells with mean size ≥ 3 (lines, not speckle).

---

## Real ERA5 steering, shear, and humidity — ACTIVE (2026-07-20)

`bake/era5.py` reads `data/raw/era5_climatology.nc` (fetched by
`bake/fetch_era5.py`) and replaces `synth` automatically when the file exists
(`bake.py`/`spike_tracks.py` pick `era5 if era5.available() else synth`).
Definitions: deep-layer steering = pressure-weighted mean of 850/500/250 hPa
winds (0.531/0.313/0.156); shear = |V200 − V850| of monthly-mean winds,
computed per year-month. The SHIPPED planes are single years (no cross-year
averaging); the 30-yr climatological mean (mean-of-magnitudes, so opposing
years cannot cancel to calm) exists only in `era5.steering_shear()` for the
bake report and the spike baseline.

The magnitude and both vector components are carried together so structure and
rainfall use the real downshear direction rather than a steering proxy.

**Synoptic samples (D10):** monthly means alone FAILed the spike (June
keep-ratio 16 % < 30 %), so `steering_shear_samples()` ships 4 real YEARS per
month as `nt=4` planes (deterministic farthest-point pick: one typical + three
diverse; years print at bake). The runtime seed selects the plane. With
samples the spike PASSes (June 50 %, October 65 %). NOTE: `src/sim.ts`'s shear
penalty is calibrated empirically for this monthly-mean-wind shear (threshold
14 m/s, not the instantaneous ~10) — see the README physics note.

The RH file uses the same year axis as the wind file. November's two tail planes
are selected jointly from real years with genesis-belt shear below 17 m/s,
ranked by RH; this avoids mistaking a calm but exceptionally dry year for a
productive post-monsoon regime.

`bake/fetch_era5.py` is the executable climatology request specification.
`bake/fetch_event_benchmark.py` shares the frozen catalogue with the bake and
downloads hourly wind, RH, and SST parts for all ten events. Both cache completed
files, require a configured CDS API token and accepted Copernicus licence, and
are safe to resume. WOA23 needs no credentials and is fetched lazily by
`bake/woa23.py`.

### Upper-level wind sidecar — `bake/bake_upper_winds.py`

`public/data/upper.bin` + `upper.json` carry the absolute 200-hPa monthly
sample planes (`u200_MM`/`v200_MM`), plane-aligned with env.bin's picked real
years. Because env.bin is frozen and its sample years were never persisted,
the bake proves alignment before writing: it re-derives every year-picked
env.bin layer (`u/v/shr/shu/shv/rh`, all 7 months) from `data/raw/` and
requires byte-identity with the committed env.bin.

- `npm run data:upper` — gate, then write both files.
- `npm run data:upper:check` — recompute and byte-diff against the committed
  files (requires the raw `.nc` files; local-only, not a CI step — CI pins
  the bytes via the asset manifest instead).
- Raw prerequisites: `era5_climatology.nc` + `era5_rh_climatology.nc`. Fetch
  just those two with `node bake/run-python.mjs -u bake/fetch_era5.py
  era5_climatology.nc era5_rh_climatology.nc` (the fetch script accepts
  target filenames now; no arguments still fetches everything).
- **Gate failure protocol:** a mismatch means the fresh CDS download no
  longer reproduces the frozen env.bin (e.g. converter/packing drift flipping
  a value at a rounding boundary). Do NOT rebake env.bin and do NOT loosen
  the comparison — record the printed per-layer diff and escalate; an env.bin
  refresh is a separate, gated decision.

`test_upper.py` is the offline standalone test for the sidecar bake
(`node bake/run-python.mjs bake/test_upper.py`).

`bake/fetch_fidelity_benchmark.py` extends that identical request contract to
the 20 HF-1-only storms. It enforces CDS's queue limit by allowing only one
active request per dataset while pressure-level and surface requests progress
in parallel. It skips every complete cached file, uses bounded transient retries
(rather than cdsapi's multi-hour default), honors queue-limit responses with a
two-minute cooldown, and accepts `--ids` for a partial repair. The corresponding
bake command accepts the same option but
will not write an incomplete scenario index unless the other cases already
exist from an earlier complete bake. A cache hit is accepted only after its
NetCDF variables and full hourly time axis validate; interrupted downloads are
removed and repaired rather than mistaken for complete source data.

### Event bake — `bake/era5_event.py`

Opt-in, NOT part of the default bake (it must never touch env.bin/terrain.bin/
flowacc.bin/genesis.json):

```bash
node bake/run-python.mjs bake/bake.py events
```

emits ten `public/data/env_<event>.bin` files and
`public/data/scenarios.json`. The env bins are the **same WIWB format** as
env.bin (version 1, identical 88-byte records) — only the `nt` semantics differ.
All eight fields (`sst/u/v/shr/shu/shv/rh/ohc`) share a 3-hourly chronological
axis and are interpolated by `tFrac`. Cross-month inputs are stitched by
`valid_time`; every `windowH` is derived from the resulting aligned axis.
Chronological event layers retain their exact 0-indexed start-month suffix;
unlike climatology, an offline December case therefore uses `_11`, not the
clamped November `_10`.

**Vortex filter (why, and the diagnostic).** Event winds contain the real
storm's own vortex; baked verbatim they would feed the observed circulation back
as environmental steering. We wash the vortex out
with `scipy.ndimage.gaussian_filter`, **sigma = 3 native cells (1.5°)** on the
0.5° grid, applied to all steering/shear fields per time plane before regridding
to 40×24. The
bake reports mean `|raw − smoothed|` steering speed at the real storm's track
positions vs the far-field: **gonu near 9.0 vs far 0.8 m/s**, **shaheen near 2.4
vs far 0.7 m/s** — the filter removes the tight vortex (near ≫ far, and far
matches the ~0.7 m/s residual of the preserved large-scale monsoon flow). Gonu's
larger near value reflects its far stronger (127 kt) vortex. Fallback if a filter
ever visibly wrecks the monsoon flow: drop sigma to 2; never ship unfiltered
without this diagnostic. RH is smoothed at the same spatial scale to remove the
tight storm imprint; SST remains unsmoothed so the event surface and observed
wake signal are retained. Coastal ERA5 SST gaps are filled from the nearest
valid ocean cell only at the bake boundary.

**Upper ocean.** Each chronological plane receives WOA23 OHC26 linearly
interpolated between adjacent monthly midpoints. This captures climatological
mixed-layer depth and a continuous September-to-October transition, but it is
not an event-specific subsurface analysis. The runtime adds its own persistent
storm-generated cold wake.

**Two explicit run modes.** The observed hindcast initializes from the first
in-domain IBTrACS fix at or above 34 kt, starts at the matching environment
offset, disables stochastic wander, and is then freely integrated—there is no
track or intensity nudging. Afterward it is scored against all eligible observed
fixes. Counterfactual mode retains the user-authored “what if this storm saw this
event environment?” workflow.

`scenarios.json` stores both the sandbox spawn and a `hindcast` block with
`startIso`, position, observed wind, derived initial organization, and
`envOffsetH`. `windowH = (planes−1)·stepH` is computed from the bin. It also
stores a frozen complete-storm benchmark split:

- calibration: Gonu, Phet, Nilofar, Ashobaa, Mekunu, Hikaa, Vayu;
- validation holdout: Kyarr, Shaheen, Biparjoy.

### Observed satellite frames — `bake/satellite_frames.py`

The browser can request public Meteosat IODC WMS frames directly, but reviewed
historical frames may be frozen into `public/data/satellite/manifest.json` for
reproducible runs:

```bash
node bake/run-python.mjs bake/satellite_frames.py meteosat \
  --observed-at 2021-10-01T02:30:00Z \
  --channel infrared
```

This downloads a same-domain 1000×600 crop of EUMETView
`msg_iodc:ir108` or `msg_iodc:vis006`, saves the provider/product/acquisition
metadata, and never changes a model input.

MOSDAC allows public catalogue search but requires a registered user for pixel
downloads. Download and render the authorized granule outside the repository,
then ingest that raster without passing credentials to the script:

```bash
node bake/run-python.mjs bake/satellite_frames.py insat \
  --observed-at 2023-06-12T23:00:00Z \
  --channel infrared \
  --input-image /secure/path/to/rendered-granule.png \
  --granule-id 11789154 \
  --satellite INSAT-3D \
  --product 'IMAGER TIR1'
```

The default source extent is the documented Asia Mercator L1C box
(44.5°E–105.5°E, 10°S–45°N); `--source-bbox` and `--projection` make the crop
contract explicit for other exports. Browser-ready files contain no credentials.
Every manifest entry retains the source URL, attribution, usage label, domain,
channel, and acquisition time.

The companion `bake/validate_satellite_structure.py` compares same-domain
grayscale captures using cold-cloud coverage, centroid displacement, core
coverage, and quadrant balance. Its result is deliberately labelled a
qualitative morphology screen, never forecast or radiometric skill. See
`docs/satellite-cloud-validation.md`.

### Ghost tracks — `public/data/tracks.json`

`sources.load_event_tracks()` extracts the **full** IBTrACS polyline (every fix,
with time + intensity) for all ten systems, distinct from the genesis dots.
Storms match exact frozen SIDs, avoiding reused-name ambiguity, and fixes
de-duplicate by ISO time.
`windKt`/`presMb` are `null` where the CSV cell is blank; all fixes are kept
(including off-domain Bay-of-Bengal segments — canvas clipping handles them).

### Track-diversity spike (design D10 / eng task T7) — `bake/spike_tracks.py`

The pre-freeze spike (`node bake/run-python.mjs bake/spike_tracks.py`) integrates ~20
pure-steering tracks from varied spawns and reports whether nearby spawns collapse
onto rails (too-smooth monthly means). It is the reference implementation the TS
steering integrator is checked against.

**Status (2026-07-20): the D10 loop is CLOSED.** Run against real ERA5 monthly
means the spike FAILed (June keep-ratio 16 %, worse than the synthetic's
21–26 %) — the exact rails D10 predicted. The remedy was applied: 4 real-year
synoptic samples per month (`nt=4` planes, seed-selected at runtime). Re-run
with runtime-like per-sample assignment, the spike PASSes: June 50 %, October
65 % (gate ≥ 30 %). The spike stays a standalone diagnostic, deliberately NOT wired
into `bake.py`'s gate (no WebGL, no bake format — design D10).

## HydroSHEDS timed routing — ACTIVE (2026-07-20)

The old priority-flood D8 approximation is closed. HydroSHEDS v1.1 restored
working GeoTIFF endpoints, and the Europe/Middle-East tile covers the full
50–70°E / 15–27°N domain. `bake/hydrosheds.py` downloads, clips, and coherently
reduces official 30 arc-second ACC+DIR to the terrain grid. The committed bake
covers 235,734 of 273,610 GMRT-land cells and routes 233,561 of them; uncovered
cells are mostly coastline/source-mask disagreement and deliberately carry no
invented channel.

The browser reads `flowdir` and `travmin` directly. A cell loses a time-scaled
share only toward its one D8 downstream neighbour; a cell gains only from
neighbours whose arrow points into it. The update is volume-conservative before
decay and advances from simulated hours, not rendered frame count. `basin` stays
in the file so an older client can fall back safely.

For an explicit offline fallback only, set `WIW_HYDRO_FALLBACK=1`. That invokes
the former GMRT priority-flood implementation in `bake/hydro.py`, emits zero
`flowdir`/`travmin`, and makes the runtime use its legacy elevation/basin
transport. A normal bake requires Rasterio and real HydroSHEDS inputs.

## Later benchmark bakes (HF-2A…HF-6)

Offline benchmark artifacts under `calibration/` (plus the two public ocean and
steering outputs noted above); none are part of the default bake. npm aliases
live in `package.json`.

- `bake_ocean_profiles.py` (`npm run data:hf2a:profiles`) — WOA23 monthly
  temperature/salinity profiles on the locked 26 depth midpoints →
  `public/data/ocean.bin` + `ocean.json`. A separate WIWB container whose `nt`
  axis is depth, not time.
- `bake_event_ocean_profiles.py` — pre-initialization NOAA GODAS profiles per
  benchmark storm (last complete calendar month before initialization; the
  storm month is never read) → `calibration/data/hf2a-event-ocean.bin/.json`.
- `hf2a_ocean_benchmark.py` (`npm run data:hf2a:ocean`, `--check`) — cold-wake
  observation set from NOAA CoastWatch's auth-free Geo-polar Blended night-only
  foundation SST. MUR v4.1 was dropped: it requires Earthdata credentials.
- `bake_hf2_initial_structure.py` (`npm run data:hf2:initial-structure`) —
  HF-2C initialization-structure sidecar from the pinned IBTrACS raw →
  `calibration/data/hf2-initial-structure.json`.
- `bake_hf3_steering.py` (`npm run data:hf3:steering`) — immutable
  pressure-level steering sidecars for the 30-storm suite under
  `calibration/data/hf3/`, plus the ten public `steering_<event>.bin`.
- `hf6_catalog.py` / `fetch_hf6_benchmark.py` / `bake_hf6_benchmark.py`
  (`npm run data:hf6:catalog` / `data:hf6:fetch` / `data:hf6:bake`) —
  outcome-blind HF-6 catalogue, fetch of the sealed-confirmation cohort (wraps
  the fidelity fetcher), and the sealed env + steering bins under
  `calibration/data/hf6/`.
- `hf6_observation_audit.py` (`npm run hf6:observation-audit`) — audits HF-6
  outcome availability and prespecified strata.
- `hf6_prospective.mjs` (`npm run hf6:prospective:check`, Node) — validates the
  HF-6 prospective-run registry via `src/live-data.ts`.
- `live_archive.mjs` (`npm run hf5:archive:sample`, Node) — validates and
  content-addresses live-run JSON into an archive, also via `src/live-data.ts`.

### Scheduled public-source monitor — `public_cycle.py`

`npm run live:acquire` discovers the latest complete NOAA/NCEP GFS cycle and
downloads a 50–70°E / 15–27°N regional GRIB2 subset for 0–120 hours at six-hour
intervals. It decodes deep-layer steering, 200–850-hPa shear, and 600/700-hPa
relative humidity with ecCodes, then combines those fields with a regional
near-real-time NOAA OISST ERDDAP subset.

The same run archives the RSMC New Delhi public bulletin page and checks the
current RTOFS three-dimensional ocean volume. It does not download that roughly
816 MB global RTOFS file because NOMADS exposes no Arabian Sea subset. GEFS
normalization is also not implemented. The resulting `public/data/live`
environment therefore contains only seven fields and deliberately omits OHC;
the runtime's eight-field forecast validator cannot promote it.

Every raw response, normalized partial environment, and hash-addressed manifest
is written non-overwriting under `tmp/public-cycle-archive`. GitHub Actions runs
the acquisition every six hours, publishes the current fail-closed manifest
with the site, and retains each workflow snapshot as a uniquely named artifact
for 90 days. This starts an immutable acquisition record; it is not yet the
multi-season prospective forecast archive required by HF-6.

The acquisition environment is intentionally small and separate:

```bash
python -m venv bake/.venv
node bake/run-python.mjs -m pip install -r bake/requirements-live.txt
npm run live:acquire
```

Support modules, imported rather than run: `sources.py` (downloads + terrain/
SST/IBTrACS loaders), `binfmt.py` (WIWB writer/parser + golden vector),
`event_catalog.py` (frozen ten-storm catalogue shared by fetch/bake/tests),
`era5_humidity.py` (RH planes aligned to the wind bake's real years),
`synth.py` (labelled synthetic wind fallback), `hydro.py`, `hydrosheds.py`.
`test_events.py` is the offline standalone test for the event bake
(`node bake/run-python.mjs bake/test_events.py`).
