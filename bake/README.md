# bake — baked map data for *Wallah It's Windy*

Turns free, public, no-auth geodata into the five small files the browser loads.
Nothing here ships to the browser; it runs once at build time. The output format
is LAW: see [`../BINARY-FORMATS.md`](../BINARY-FORMATS.md). This directory is the
Python source of truth for the *actual* grid dimensions the self-describing `.bin`
headers advertise (the runtime hardcodes none of them).

## Reproduce

```bash
cd cyclone-sim
python3 -m venv bake/.venv
bake/.venv/bin/python -m pip install --upgrade pip
bake/.venv/bin/python -m pip install -r bake/requirements.txt
bake/.venv/bin/python bake/bake.py
```

macOS, Python 3.14, numpy 2.x. Raw downloads cache under `data/raw/` (gitignored);
a second run reuses them. Total runtime ≈ 15 s after downloads. The script prints
its progress, both bake-time asserts, and a loud SYNTHETIC banner (see below).

## Outputs (`public/data/`, ~6.5 MB raw, budget ≤ 7 MB)

| file | layers | grid | source |
|------|--------|------|--------|
| `terrain.bin` | `elev` (int16 m), `landmask` (uint8) | 1040×668 (~2 km) | GMRT (real bathy+topo) |
| `env.bin` | `sst_MM`,`u_MM`,`v_MM`,`shr_MM`,`shu_MM`,`shv_MM` × 7 months | 40×24 (0.5°) | OISST + ERA5 |
| `flowacc.bin` | `flowacc` (uint16 log), `flowdir` (uint8 D8), `travmin` (uint8 minutes), `basin` (uint16 compatibility) | 1040×668 | HydroSHEDS v1.1 ACC+DIR |
| `genesis.json` | `[{lat,lon}]` | — | IBTrACS North Indian |
| `tracks.json` | two observed ghost-track polylines | — | IBTrACS North Indian |

The physical-structure calibration subset is a separate offline artifact under
`calibration/data/`; it never ships in `public/` or the browser bundle. Rebuild
it from the same pinned IBTrACS raw download with:

```bash
python3 bake/extract_structure_validation.py
```

The extractor verifies the raw SHA-256, keeps six-hour main-track tropical
fixes from 2019–2024, and uses USA/JTWC columns consistently for position,
one-minute wind, pressure, RMW, and quadrant radii.

### `env.bin` layer naming (the EnvSampler must know this)

One layer **per field per month**. SST has `nt = 1`; the five wind fields have
`nt = 4` coherent real-year synoptic planes. Names (≤ 8-byte limit forces the
short forms):

```
sst_MM   SST °C          int16 quant scale 0.01 offset 20.0   (real OISST)
u_MM     steering U m/s  int16 quant scale 0.01 offset 0.0    (ERA5)
v_MM     steering V m/s  int16 quant scale 0.01 offset 0.0    (ERA5)
shr_MM   shear mag m/s   int16 quant scale 0.01 offset 0.0    (ERA5)
shu_MM   shear U m/s     int16 quant scale 0.01 offset 0.0    (ERA5 V200−V850)
shv_MM   shear V m/s     int16 quant scale 0.01 offset 0.0    (ERA5 V200−V850)
```

`MM` is the **0-indexed calendar month, zero-padded**: May=`04` … Nov=`10` (only
these 7 exist). **Month and the timestep axis (`nt`) are orthogonal**: `monthIndex`
picks the layer. In climatology mode, the seed freezes one of the wind layers'
synoptic planes and `tFrac` is ignored; in event mode, `tFrac` interpolates
chronological planes without any format change. Recommended sampler lookup:

```
name = `sst_${String(clamp(monthIndex,4,10)).padStart(2,'0')}`
```

Months outside May–Nov are not baked (no Arabian-Sea cyclone season) — clamp.

## Sources & licenses (all auth-free)

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
  *Eos* 89(10).
- **ERA5** pressure-level winds for climatological samples and event windows —
  see the active pipeline below.

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

## Real ERA5 steering + shear — ACTIVE (2026-07-20)

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

Gonu (Jun 2007) + Shaheen (Sep 20 – Oct 10 2021) hourly event fields are
already under `data/raw/` for the v1.1 counterfactual bake (`nt` = TIME there).

The original request, for reproducing from scratch (`bake/fetch_era5.py`
automates exactly this):

```python
import cdsapi
c = cdsapi.Client()

# 1) Monthly climatology for steering (deep-layer mean 850/500/250) + shear (850,200)
c.retrieve("reanalysis-era5-pressure-levels-monthly-means", {
    "product_type": "monthly_averaged_reanalysis",
    "variable": ["u_component_of_wind", "v_component_of_wind"],
    "pressure_level": ["200", "250", "500", "850"],
    "year": [str(y) for y in range(1991, 2021)],
    "month": ["05","06","07","08","09","10","11"],
    "time": "00:00",
    "area": [27, 50, 15, 70],   # N, W, S, E
    "grid": [0.5, 0.5],
    "format": "netcdf",
}, "data/raw/era5_climatology.nc")

# 2) Event windows, hourly — Gonu (Jun 2007) and Gulab->Shaheen (Sep-Oct 2021)
for tag, yr, mons, days in [
    ("gonu_2007",  "2007", ["06"], [f"{d:02d}" for d in range(1, 8)]),
    ("shaheen_2021","2021", ["09","10"], [f"{d:02d}" for d in range(1, 32)]),
]:
    c.retrieve("reanalysis-era5-pressure-levels", {
        "product_type": "reanalysis",
        "variable": ["u_component_of_wind", "v_component_of_wind"],
        "pressure_level": ["200", "250", "500", "850"],
        "year": yr, "month": mons, "day": days,
        "time": [f"{h:02d}:00" for h in range(24)],
        "area": [27, 50, 15, 70], "grid": [0.5, 0.5], "format": "netcdf",
    }, f"data/raw/era5_{tag}.nc")
```

Deep-layer steering = mass-weighted mean of the 850/500/250 winds; shear
magnitude = `|V(200) − V(850)|`. Event files feed the v1.1 counterfactual env
bins (below).

### Event bake (v1.1 counterfactual scenarios) — `bake/era5_event.py`

Opt-in, NOT part of the default bake (it must never touch env.bin/terrain.bin/
flowacc.bin/genesis.json):

```bash
bake/.venv/bin/python bake/bake.py events
```

emits `public/data/env_gonu.bin`, `public/data/env_shaheen.bin`, and
`public/data/scenarios.json`. The env bins are the **same WIWB format** as
env.bin (version 1, identical 88-byte records) — only the `nt` semantics differ:
`u/v/shr/shu/shv` carry a **time axis** (`nt` = 3-hourly steps, `tFrac` interpolates)
instead of the climatology's synoptic samples. Layers keep the month-suffix
convention so the existing sampler resolves them unchanged: gonu → `sst_05,
u_05, v_05, shr_05`; shaheen → `..._08`. Gonu = `era5_gonu_2007.nc` (192 h → 64
planes, windowH 189). Shaheen = `era5_shaheen_2021_09.nc` + `_10.nc` stitched by
`valid_time` into one continuous 504 h series (→ 168 planes, windowH 501).

**Vortex filter (why, and the diagnostic).** Event winds contain the real
storm's own vortex; baked verbatim they would replay the historical track rather
than provide a clean counterfactual steering environment. We wash the vortex out
with `scipy.ndimage.gaussian_filter`, **sigma = 3 native cells (1.5°)** on the
0.5° grid, applied to all steering/shear fields per time plane before regridding
to 40×24. The
bake reports mean `|raw − smoothed|` steering speed at the real storm's track
positions vs the far-field: **gonu near 9.0 vs far 0.8 m/s**, **shaheen near 2.4
vs far 0.7 m/s** — the filter removes the tight vortex (near ≫ far, and far
matches the ~0.7 m/s residual of the preserved large-scale monsoon flow). Gonu's
larger near value reflects its far stronger (127 kt) vortex. Fallback if a filter
ever visibly wrecks the monsoon flow: drop sigma to 2; never ship unfiltered
without this diagnostic.

**SST provenance.** The event fetch was **winds-only**, so `sst_MM` is *not* from
the event: it is copied verbatim (`nt=1`) from the committed `env.bin`'s
climatological `sst_05` / `sst_08` layer (OISST 1991–2020 long-term mean).

**Intensity fidelity decision (2026-07-20).** Event mode remains a
counterfactual, not a historical-intensity hindcast. A canonical replay with the
shipped fields peaks at 88.6 kt for Gonu and 81.5 kt for Shaheen. A sensitivity
run produced:

| Forcing experiment | Gonu peak | Shaheen peak |
| --- | ---: | ---: |
| Shipped fields | 88.6 kt | 81.5 kt |
| SST +1.0 °C everywhere | 98.1 kt | 94.3 kt |
| Shear reduced 20% everywhere | 103.6 kt | 81.5 kt |
| Both changes | 116.7 kt | 94.3 kt |

These broad adjustments still fail to reproduce both historical peaks and would
silently tune the sandbox to two storms. The shipped replay therefore keeps
climatological SST and the existing vortex filter. `tracks.json` supplies the
observed reference; the simulated storm is expected only to survive and
intensify plausibly. A future hindcast mode must fetch time-resolved event SST,
define how it removes the observed vortex without erasing environmental shear,
and validate against a larger storm set. It should be a separate named mode,
not a retune of this counterfactual.

`scenarios.json` (`{version, scenarios:[{id,label,bin,monthIndex,stepH,windowH,
startIso,spawn,ghostId}]}`) pins each scenario's sim window: `windowH =
(planes−1)·stepH` is **computed**, and `spawn` = the storm's first IBTrACS fix
inside the playable DOMAIN (same first-in-domain rule as genesis).

### Ghost tracks — `public/data/tracks.json`

`sources.load_event_tracks()` extracts the **full** IBTrACS polyline (every fix,
with time + intensity) for the two named systems, distinct from the genesis dots.
Storms are matched by **SEASON + a NAME token** (never NAME alone): GONU is one
SID (`2007151N14072`, 63 fixes); the Gulab→Shaheen system is the single SID
`2021267N18094` named `GULAB:SHAHEEN-GU` (85 fixes) — the loader still merges +
de-dupes across SIDs by ISO_TIME so a future split archive stitches transparently.
`windKt`/`presMb` are `null` where the CSV cell is blank; all fixes are kept
(including off-domain Bay-of-Bengal segments — canvas clipping handles them).

### Track-diversity spike (design D10 / eng task T7) — `bake/spike_tracks.py`

The pre-freeze spike (`bake/.venv/bin/python bake/spike_tracks.py`) integrates ~20
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
