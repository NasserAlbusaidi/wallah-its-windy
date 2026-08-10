# nio-v1 Phase 0 — recon measurements

Date: 2026-08-10.
Repository commit at measurement time: `7914d7f0da70a93839dcbd5d049435661b518e10`.
Spec under test: `docs/superpowers/specs/2026-08-09-nio-domain-expansion-design.md` §6 Phase 0.
Status: in progress.

This note records measurements only. Phase 0 changes no code, no baked data and
no calibration artifact; this file is the only thing it commits. Every number
below is reproducible from the command printed beside it. A field still reading
`UNMEASURED` has not been measured and must not be cited.

## Environment

| Field | Value |
| --- | --- |
| OS | Windows 11 Pro |
| `node --version` | v22.23.1 |
| `bake/.venv` python version | 3.12.10 (tags/v3.12.10:0cc8128, Apr  8 2025, 12:21:36) [MSC v.1943 64 bit (AMD64)] |
| `curl --version` (first line) | curl 8.4.0 (x86_64-w64-mingw32) libcurl/8.4.0 Schannel zlib/1.3 brotli/1.1.0 zstd/1.5.5 libidn2/2.3.4 libpsl/0.21.2 (+libidn2/2.3.3) libssh2/1.11.0 |
| Operator | Claude Code subagent, dispatched by NasserAlbusaidi |

## M1 — GitHub Pages compression above 10 MB

Spec risk 2 and kill criterion 3. Today's largest deployed `.bin` is
`public/data/flowacc.bin` at 4,168,680 raw bytes, so nothing above ~4.2 MB has
ever been measured on the wire. The projected new assets are 14,328,784
(`terrain.bin`) and 19,105,072 (`flowacc.bin`).

Probe host: `UNMEASURED`

| Probe size (raw B) | Stands for | `Content-Encoding` | Wire `Content-Length` | Ratio |
| --- | --- | --- | --- | --- |
| 4,168,680 | today's `flowacc.bin` (control) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 9,437,184 | 9 MiB, below the suspected cut | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 10,485,760 | 10 MiB, at the suspected cut | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 14,328,784 | projected new `terrain.bin` | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 19,105,072 | projected new `flowacc.bin` | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |

Live control (the real deployed file, same day): `UNMEASURED`
Compression threshold bracket: `UNMEASURED`
First paint implied by this result, gz bytes on the wire: `UNMEASURED`
Verdict: `UNMEASURED`

## M2 — GMRT over the new box

Spec §3.6 and kill criterion 1. Target grid is 2860 × 1670, i.e. exactly
55/2860 = 0.019230769230769232 ° per column and 30/1670 =
0.017964071856287425 ° per row — bit-identical to today's 20/1040 and 12/668.

Prior evidence, from the untracked probes moved to `tmp/phase0/prior-probes/`:

| Request | Box | `dimension` | spacing lon/lat (°) |
| --- | --- | --- | --- |
| `resolution=med` | 20 × 12 | `[1140,735]` | `[0.017593557945566288,0.01639428439618534]` |
| `resolution=med` | 5 × 4 | `[1140,985]` | `[0.004398389486391572,0.004077568830554497]` |
| `resolution=high` | 5 × 4 | `[2276,1966]` | `[0.002198231456043956,0.002037781760235706]` |
| `resolution=max` | 5 × 4 | `[9103,7857]` | `[0.0005493767574262524,0.0005092448816141506]` |

Measured 2026-08-10 with `tmp/phase0/nc-header.mjs` against `tmp/phase0/prior-probes/{gmrt_50_70_15_27_med,gmrt_small,gmrt_s_high,gmrt_s_max}.nc`.

New measurements:

| Request | URL | HTTP | Bytes | `dimension` | `x_range` | `y_range` | spacing | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tile A, med, 11 × 10 | `.../GridServer?minlongitude=45&maxlongitude=56&minlatitude=0&maxlatitude=10&format=netcdf&resolution=med` | 200 | 5,729,880 | `[1252,1144]` | `[45,56.00390625]` | `[0,10.00347422892677]` | `[0.008796088129496404,0.00875194595706629]` | 46.053011 |
| tile B, med, 11 × 10, adjacent east | `.../GridServer?minlongitude=56&maxlongitude=67&minlatitude=0&maxlatitude=10&format=netcdf&resolution=med` | 200 | 5,739,032 | `[1254,1144]` | `[55.986328125,67.0078125]` | `[0,10.00347422892677]` | `[0.008796076915403033,0.00875194595706629]` | 42.688468 |
| full box, high | `.../GridServer?minlongitude=45&maxlongitude=100&minlatitude=0&maxlatitude=30&format=netcdf&resolution=high` | 200 | 22,416,884 | `[3129,1791]` | `[45,100.001953125]` | `[0,30.008225293122432]` | `[0.017583744605179027,0.016764371672135438]` | 94.243613 |
| full box, max | `.../GridServer?minlongitude=45&maxlongitude=100&minlatitude=0&maxlatitude=30&format=netcdf&resolution=max` | 200 | 358,559,096 | `[12516,7162]` | `[45,100.001953125]` | `[0,30.00061408073971]` | `[0.004394882391130644,0.004189444781558401]` | 649.224176 |

All four via `curl -sS -A "wallah-its-windy-bake/1.0" -w "HTTP %{http_code} %{size_download}B %{time_total}s\n"`; `Seconds` is curl's own `%{time_total}`. Headers cross-checked with `tmp/phase0/nc-header.mjs`; scipy readout for tile A (`node bake/run-python.mjs -c "from scipy.io import netcdf_file; ..."`) printed `[1252, 1144] [45.0, 56.00390625] [0.0, 10.00347422892677]` — identical to the hand-rolled reader.

Columns needed per 11 ° tile: 572. Rows needed per 10 ° tile: 557.
Is `resolution=med` a hard 1140-column cap? **No.** Tile A returned 1252 columns and tile B returned 1254 columns at 11° width — not 1140 — despite the 20° and 5° prior probes both returning exactly 1140. The 1140 figure from the prior probes does not generalize to an 11° box.
Tile seam — overlap or gap, in degrees: `56.00390625 − 55.986328125 = 0.017578125` — **overlap**.
Do adjacent tiles share a spacing? **No**, not within the stated `< 1e-9` tolerance: `|0.008796088129496404 − 0.008796076915403033| = 1.121409337091761e-8`, which is greater than `1e-9`.
Projected 15-tile wall clock and bytes: `15 × 46.053011s = 690.795165s` (~11.5 min); `15 × 5,729,880B = 85,948,200B` (~82 MiB). Stated as a projection from the single tile-A sample, per the brief's method.
Can one single request cover the whole box at sufficient resolution? **Yes.** `resolution=high` returned `dimension [3129,1791]` in one request (`3129 >= 2860 && 1791 >= 1670`), 22,416,884 bytes in 94.243613s. `resolution=max` also cleared the target, returning `dimension [12516,7162]` in 649.224176s (~10m49s) and 358,559,096 bytes — technically sufficient but far more expensive than `high` for no required benefit at the 2860×1670 target resolution.
Verdict: **PASS.** Both pass paths hold: the med tiles A (`[1252,1144]`) and B (`[1254,1144]`) both clear `572 × 557` with a non-negative seam (`0.017578125°`), and the single-request `resolution=high` full-box fetch clears `2860 × 1670` (`[3129,1791]`) on its own. `bake/sources.py:90-130`'s `load_terrain` today assumes exactly one netCDF file and would need to learn to mosaic multiple tiles to use the tile-A/tile-B path — that is Phase 5 work this measurement scopes, not Phase 0 work. Kill criterion §11 #1 did not fire.

## M3 — HydroSHEDS region downloads

Spec §6 Phase 0 item 3 claims 127,828,199 B total. `bake/hydrosheds.py:25-34`
fetches only the `eu` region today; the new box needs `af` and `as` as well.

| Region | Kind | URL | HTTP | `Content-Length` | `last-modified` |
| --- | --- | --- | --- | --- | --- |
| af | dir | `UNMEASURED` | | | |
| af | acc | `UNMEASURED` | | | |
| as | dir | `UNMEASURED` | | | |
| as | acc | `UNMEASURED` | | | |
| eu | dir | `UNMEASURED` | | | |
| eu | acc | `UNMEASURED` | | | |

Sum of the six: `UNMEASURED`
Agrees with the spec's 127,828,199 B? `UNMEASURED`
Raster bounds per region (from the already-downloaded dir zips): `UNMEASURED`
Does the union cover 45–100 °E / 0–30 °N with no gap? `UNMEASURED`
Verdict: `UNMEASURED`

## M4 — CDS request timing

One minimal request. This is a sample of one; CDS queue depth varies by hour and
by dataset, so the number below is an order of magnitude, not a service level.

| Field | Value |
| --- | --- |
| Credentials present before the probe | `UNMEASURED` |
| Dataset | `UNMEASURED` |
| Request dict | `UNMEASURED` |
| Submit time (UTC) | `UNMEASURED` |
| Completion time (UTC) | `UNMEASURED` |
| Elapsed seconds | `UNMEASURED` |
| Downloaded bytes | `UNMEASURED` |

Projection to Phase 10's 45 event requests: `UNMEASURED`
Projection to the two 12-month × 30-year climatology requests: `UNMEASURED`
Verdict: `UNMEASURED`

## M5 — Offset-bbox forcing spike

Spec §4.3 and kill criterion 4. No physics-forcing bin in this repository has
ever carried a header bbox different from `grid.ts DOMAIN`. This spike builds
one and runs a shipped scenario through it.

Method: `tmp/phase0/crop-bin.mjs` copies each layer's raw payload bytes into a
cell-aligned subwindow and writes the subwindow bbox into the 88-byte layer
records — no requantization, scale and offset untouched.
`tmp/phase0/offset-bbox-spike.mjs` runs `runDetailedHindcastCase` once against
the full-extent bin and once against the cropped bin, on the same interpreter,
and diffs the two flight-recorder tapes.

Declared before measuring, anchored to the repository's own hindcast gate
(`calibration/hindcast.mjs:340-347`, `trackRegressionKm <= 1` and
`maximumIntensityRegressionKt <= 3`):

- PASS — tapes byte-identical, or max track deviation ≤ 1.0 km AND max wind
  deviation ≤ 0.5 kt over the whole run, with landfall and death identical.
- CONDITIONAL — max track deviation ≤ 10 km AND max wind deviation ≤ 3.0 kt.
- FAIL — anything larger, a changed landfall/death outcome, or a throw.

| Field | vayu | hikaa |
| --- | --- | --- |
| Scenario bin | `UNMEASURED` | `UNMEASURED` |
| Full-extent header (nx, ny, bbox) | `UNMEASURED` | `UNMEASURED` |
| Simulated frame bbox | `UNMEASURED` | `UNMEASURED` |
| Crop window applied | `UNMEASURED` | `UNMEASURED` |
| Cropped header (nx, ny, bbox) | `UNMEASURED` | `UNMEASURED` |
| Origin moved (lonMin and/or latMax) | `UNMEASURED` | `UNMEASURED` |
| Cropped bin size, bytes | `UNMEASURED` | `UNMEASURED` |
| `validateEventBinForScenario` return | `UNMEASURED` | `UNMEASURED` |
| Frame count, full vs cropped | `UNMEASURED` | `UNMEASURED` |
| Tapes byte-identical | `UNMEASURED` | `UNMEASURED` |
| Max track deviation, km | `UNMEASURED` | `UNMEASURED` |
| Max wind deviation, kt | `UNMEASURED` | `UNMEASURED` |
| Max central-pressure deviation, hPa | `UNMEASURED` | `UNMEASURED` |
| Max RMW deviation, km | `UNMEASURED` | `UNMEASURED` |
| Landfall identical | `UNMEASURED` | `UNMEASURED` |
| Death identical | `UNMEASURED` | `UNMEASURED` |
| Pure-sampling max |Δ| over the interior lattice | `UNMEASURED` | `UNMEASURED` |
| Pure-sampling points differing at all, of 10201 | `UNMEASURED` | `UNMEASURED` |
| Negative control (zero-margin crop) track deviation, km | `UNMEASURED` | `UNMEASURED` |
| Negative control raised an error | `UNMEASURED` | `UNMEASURED` |

Steering-bin sampling comparison (no sim, `steering_vayu.bin`): `UNMEASURED`
Projected `calibration/data` size with track-following subwindows: `UNMEASURED`
Verdict: `UNMEASURED`

## Verdicts

| # | Measurement | Verdict | Kill criterion | Fired |
| --- | --- | --- | --- | --- |
| M1 | Pages compression above 10 MB | `UNMEASURED` | §11 #3 | `UNMEASURED` |
| M2 | GMRT over the new box | PASS | §11 #1 | No |
| M3 | HydroSHEDS bytes | `UNMEASURED` | none | n/a |
| M4 | CDS queue time | `UNMEASURED` | none | n/a |
| M5 | Offset-bbox forcing | `UNMEASURED` | §11 #4 | `UNMEASURED` |

## What Phase 0 did not measure

- `UNMEASURED`
