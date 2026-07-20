# bake — baked map data for *Wallah It's Windy*

Turns free, public, no-auth geodata into the four small files the browser loads.
Nothing here ships to the browser; it runs once at build time. The output format
is LAW: see [`../BINARY-FORMATS.md`](../BINARY-FORMATS.md). This directory is the
Python source of truth for the *actual* grid dimensions the self-describing `.bin`
headers advertise (the runtime hardcodes none of them).

## Reproduce

```bash
cd cyclone-sim
python3 -m venv bake/.venv
bake/.venv/bin/python -m pip install --upgrade pip
bake/.venv/bin/python -m pip install numpy scipy h5py
bake/.venv/bin/python bake/bake.py
```

macOS, Python 3.14, numpy 2.x. Raw downloads cache under `data/raw/` (gitignored);
a second run reuses them. Total runtime ≈ 15 s after downloads. The script prints
its progress, both bake-time asserts, and a loud SYNTHETIC banner (see below).

## Outputs (`public/data/`, ~4.9 MB raw, budget ≤ 7 MB)

| file | layers | grid | source |
|------|--------|------|--------|
| `terrain.bin` | `elev` (int16 m), `landmask` (uint8) | 1040×668 (~2 km) | GMRT (real bathy+topo) |
| `env.bin` | `sst_MM`,`u_MM`,`v_MM`,`shr_MM` × 7 months | 40×24 (0.5°) | SST **real** (OISST); steering/shear **synthetic** |
| `flowacc.bin` | `flowacc` (uint16, log), `basin` (uint16) | 1040×668 | D8 from the real DEM |
| `genesis.json` | `[{lat,lon}]` | — | IBTrACS North Indian |

### `env.bin` layer naming (the EnvSampler must know this)

One layer **per field per month**, each `nt = 1` for the v1.0 climatology. Names
(≤ 8-byte limit forces the short forms):

```
sst_MM   SST °C          int16 quant scale 0.01 offset 20.0   (real OISST)
u_MM     steering U m/s  int16 quant scale 0.01 offset 0.0    (SYNTHETIC_V0)
v_MM     steering V m/s  int16 quant scale 0.01 offset 0.0    (SYNTHETIC_V0)
shr_MM   shear mag m/s   int16 quant scale 0.01 offset 0.0    (SYNTHETIC_V0)
```

`MM` is the **0-indexed calendar month, zero-padded**: May=`04` … Nov=`10` (only
these 7 exist). **Month and the timestep axis (`nt`) are orthogonal**: `monthIndex`
picks the layer, `tFrac` interpolates along that layer's `nt`. For v1.0 `nt=1` so
`tFrac` is a no-op; a v1.1 event file grows one field's `nt` to hourly steps
without any format change. Recommended sampler lookup:

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
- **HydroSHEDS** (intended flow-accumulation source) — see TODO below.
- **ERA5** (intended steering/shear source) — see TODO below.

## Downsample rules (eng task T3)

- elevation → block **mean**; land mask → **any-land-wins**; (basin → mode, ACC →
  block-max apply only to the HydroSHEDS path — the D8 fallback computes natively
  on the terrain grid, no downsample). Bake-time connectivity assert confirms the
  top-1 % ACC cells form connected channels, not speckle.

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
winds (0.531/0.313/0.156); shear = |V200 − V850| per year-month, then averaged
(mean-of-magnitudes — opposing years must not cancel to calm).

**Synoptic samples (D10):** monthly means alone FAILed the spike (June
keep-ratio 16 % < 30 %), so `steering_shear_samples()` ships 4 real YEARS per
month as `nt=4` planes (deterministic farthest-point pick: one typical + three
diverse; years print at bake). The runtime seed selects the plane. With
samples the spike PASSes at 50–65 %. NOTE: `src/sim.ts`'s shear penalty is
calibrated for monthly-mean-of-magnitudes input (threshold 14 m/s, not the
instantaneous ~10) — see the README physics note.

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
magnitude = `|V(200) − V(850)|`. Event files feed v1.1 counterfactual `env.bin`
timesteps (one field, `nt` = hourly steps, `tFrac` interpolates). Known caveat:
event fields contain the real storm's own vortex — smooth/large-scale-filter the
steering before baking, or document the contamination (design Open Question).

### Track-diversity spike (design D10 / eng task T7) — `bake/spike_tracks.py`

The pre-freeze spike (`bake/.venv/bin/python bake/spike_tracks.py`) integrates ~20
pure-steering tracks from varied spawns and reports whether nearby spawns collapse
onto rails (too-smooth monthly means). It is the reference implementation the TS
steering integrator is checked against.

**Status (2026-07-20): the D10 loop is CLOSED.** Run against real ERA5 monthly
means the spike FAILed (June keep-ratio 16 %, worse than the synthetic's
21–26 %) — the exact rails D10 predicted. The remedy was applied: 4 real-year
synoptic samples per month (`nt=4` planes, seed-selected at runtime). Re-run
with runtime-like per-sample assignment, the spike PASSes: May 50 %, Sep 65 %
(gate ≥ 30 %). The spike stays a standalone diagnostic, deliberately NOT wired
into `bake.py`'s gate (no WebGL, no bake format — design D10).

## TODO: real HydroSHEDS flow accumulation (currently D8-from-DEM)

`flowacc.bin` is computed by priority-flood D8 on the real GMRT DEM
(`bake/hydro.py`), the sanctioned fallback: HydroSHEDS distributes only large
continental GeoTIFFs (need GDAL/rasterio) and its `data.hydrosheds.org` ACC/DIR
paths 404'd on two documented attempts. To use official HydroSHEDS ACC + DIR:
download the continental `*_acc_30s` and `*_dir_30s` grids that cover the Arabian
Peninsula (check whether Oman lands in the **af** or **as** continent clip — it
straddles ~52–60°E), clip to 50–70°E/15–27°N, then downsample to the terrain grid
with **ACC = block-MAX** (mean destroys 1-cell wadi channels) and **basin = mode**.
Drop it in as `hydro.load_hydrosheds_acc_dir()` returning the same
`(flowacc_log, basin)` pair. License: HydroSHEDS © WWF; free, cite Lehner, B.,
Verdin, K., Jarvis, A. (2008), *Eos* 89(10).
