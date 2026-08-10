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

Probe host: `https://nasseralbusaidi.github.io/pages-compression-probe/` (throwaway
public repo `NasserAlbusaidi/pages-compression-probe`, created, measured, and
deleted in this session — see teardown confirmation below).

Probe content: `public/data/terrain.bin` (2,084,344 B) repeated 10× and
truncated with `head -c`, per `tmp/phase0/pages-probe/site/`. Step-3
compressibility check (`gzip -9 -c "$f" | wc -c`), reference ratio being
terrain.bin's own 2,084,344/905,869 = 2.30×:

```
probe_10485760.bin raw=10485760 gz9=4577132 ratio=2.2909
probe_14328784.bin raw=14328784 gz9=6348964 ratio=2.2569
probe_19105072.bin raw=19105072 gz9=8377378 ratio=2.2806
probe_4168680.bin raw=4168680 gz9=1813433 ratio=2.2988
probe_9437184.bin raw=9437184 gz9=4326347 ratio=2.1813
```

Four of five ratios fall in the expected 2.2–2.5 band; `probe_9437184.bin`
measured 2.1813, marginally below 2.2 (not above 3, so the brief's
regenerate-if-exceeds-3 condition was not triggered). Recorded as measured,
not adjusted.

Wire measurements, second pass (identical to the first pass; both showed
`x-proxy-cache: MISS`, recording pass 2 per the brief):

| Probe size (raw B) | Stands for | `Content-Encoding` | Wire `Content-Length` | Ratio |
| --- | --- | --- | --- | --- |
| 4,168,680 | today's `flowacc.bin` (control) | `gzip` | `1823980` | 4168680/1823980 = 2.2855 |
| 9,437,184 | 9 MiB, below the suspected cut | `gzip` | `4348008` | 9437184/4348008 = 2.1705 |
| 10,485,760 | 10 MiB, at the suspected cut | `gzip` | `4603132` | 10485760/4603132 = 2.2780 |
| 14,328,784 | projected new `terrain.bin` | `gzip` | `6383366` | 14328784/6383366 = 2.2447 |
| 19,105,072 | projected new `flowacc.bin` | `gzip` | `8423586` | 19105072/8423586 = 2.2680 |

Live control (the real deployed site, same day):

```
HTTP/1.1 200 OK
Content-Length: 685250
ETag: W/"6a793f20-3f9be8"
Content-Encoding: gzip
```

`0x3f9be8` = 4,168,680 (raw size); 4168680/685250 = 6.0834×.

Compression threshold bracket: no threshold up to 19,105,072 B — every probe,
including both projected new assets (14,328,784 and 19,105,072 B), returned
`Content-Encoding: gzip` on both passes. Step 6 (bisection) did not apply:
there was no identity-encoded probe to bracket against.

First paint implied by this result, gz bytes on the wire: 19,283,792 B =
18.39 MiB — the spec's "both large bins served gzip" branch, since both
`probe_14328784.bin` and `probe_19105072.bin` measured `Content-Encoding: gzip`.

Verdict: **PASS.** Falsification condition ("the response for
`probe_14328784.bin` or `probe_19105072.bin` carries no `Content-Encoding:
gzip` header") did not occur — both carried `Content-Encoding: gzip` on both
measurement passes. Kill criterion §11 #3 did not fire.

Teardown: `gh repo delete NasserAlbusaidi/pages-compression-probe --yes`
exited 0. Post-delete check: `curl -sS -o /dev/null -w "%{http_code}\n"
https://nasseralbusaidi.github.io/pages-compression-probe/probe_14328784.bin`
printed `404`; `gh repo view NasserAlbusaidi/pages-compression-probe` returned
`GraphQL: Could not resolve to a Repository with the name
'NasserAlbusaidi/pages-compression-probe'.` — the probe repository is deleted.

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

Prior evidence: Task 1 parked `hyd_af_dir_30s.zip`, `hyd_as_dir_30s.zip`,
`hyd_au_dir_30s.zip`, `hyd_eu_dir_30s.zip` in `tmp/phase0/prior-probes/hs/`.
`ls -la` on that directory measured (from disk, no network) `af dir`
14,601,343 B, `as dir` 12,215,300 B, `au dir` 7,179,698 B, `eu dir`
12,603,455 B. No `acc` zip was on disk for any region.

Measured 2026-08-10 with
`curl -sSIL "https://data.hydrosheds.org/file/hydrosheds-v1-$k/hyd_${r}_${k}_30s.zip"`
(network HEAD request only — the three `dir` zips already on disk were not
re-downloaded, only their headers were fetched to get `Content-Length` and
`last-modified`; the two `acc` zips have never been downloaded, so their
`Content-Length` here is the only measurement of them):

| Region | Kind | URL | HTTP | `Content-Length` | `last-modified` |
| --- | --- | --- | --- | --- | --- |
| af | dir | `https://data.hydrosheds.org/file/hydrosheds-v1-dir/hyd_af_dir_30s.zip` | 200 | 14,601,343 | Sun, 09 Aug 2026 16:22:35 GMT |
| af | acc | `https://data.hydrosheds.org/file/hydrosheds-v1-acc/hyd_af_acc_30s.zip` | 200 | 32,036,819 | Sun, 09 Aug 2026 16:22:32 GMT |
| as | dir | `https://data.hydrosheds.org/file/hydrosheds-v1-dir/hyd_as_dir_30s.zip` | 200 | 12,215,300 | Sun, 09 Aug 2026 16:22:40 GMT |
| as | acc | `https://data.hydrosheds.org/file/hydrosheds-v1-acc/hyd_as_acc_30s.zip` | 200 | 26,953,393 | Sun, 09 Aug 2026 16:22:38 GMT |
| eu | dir | `https://data.hydrosheds.org/file/hydrosheds-v1-dir/hyd_eu_dir_30s.zip` | 200 | 12,603,455 | Sun, 09 Aug 2026 16:22:51 GMT |
| eu | acc | `https://data.hydrosheds.org/file/hydrosheds-v1-acc/hyd_eu_acc_30s.zip` | 200 | 29,417,889 | Sun, 09 Aug 2026 16:22:49 GMT |

For `af dir`, `as dir`, and `eu dir` the network `Content-Length` matches the
on-disk file size exactly (byte-for-byte), confirming the brief's `eu dir`
anchor (12,603,455) and extending the same check to `af dir` and `as dir`.

Sub-sum, three `dir` zips: 14,601,343 + 12,215,300 + 12,603,455 = 39,420,098.
Sub-sum, three `acc` zips: 32,036,819 + 26,953,393 + 29,417,889 = 88,408,101.
Sum of the six: 39,420,098 + 88,408,101 = 127,828,199.
Agrees with the spec's 127,828,199 B? **Yes, exact match (diff 0 B).** The
spec's figure is the six-file (three regions × dir+acc) sum, not a three-file
sum — `au` is not part of it and was never claimed to be.

Raster bounds per region (read from the dir zips already on disk via
`node bake/run-python.mjs -c "import rasterio; ..."`, no new download; `au`
included only because Task 1 already had it on disk):

```
af BoundingBox(left=-19.0, bottom=-35.0, right=54.99999999999997, top=37.99999999999997) 8880 8760
as BoundingBox(left=57.0, bottom=1.4210854715202004e-14, right=151.99999999999994, top=56.99999999999999) 11400 6840
au BoundingBox(left=94.0, bottom=-55.999999999999545, right=179.99999999999994, top=25.000000000000426) 10320 9720
eu BoundingBox(left=-25.0, bottom=12.0, right=69.99999999999996, top=83.99999999999997) 11400 8640
```

Does the union cover 45–100 °E / 0–30 °N with no gap? **No.** By hand: `af`
covers lon [-19, 54.99999999999997] × lat [-35, 37.99999999999997], so it
fills lon 45–~55 for the full 0–30 lat range. `as` covers lon
[57, 151.99999999999994] × lat [~0, 56.99999999999999], so it fills lon
57–100 for the full 0–30 lat range on its own (`au`, lon [94, 180], is not
needed anywhere in the box — `as` already reaches 151.99999999999994). `eu`
covers lon [-25, 69.99999999999996] × lat [12, 83.99999999999997], so it
fills lon ~55–57 for lat 12–30 only. That leaves an uncovered rectangle at
approximately **lon [54.99999999999997, 57.0] × lat [0, 12.0]** — roughly 2°
of longitude by 12° of latitude, between `af`'s right edge and `as`'s left
edge, below `eu`'s bottom edge. Which additional HydroSHEDS region code (if
any) covers that rectangle was not determined in this measurement — no
region raster other than `af`, `as`, `au`, `eu` was probed for bounds, so
naming a fifth region code here would be a guess, not a measurement. This is
an open question for Phase 5.

Verdict: **FAIL** by the letter of the stated criterion ("all six URLs return
200 with a Content-Length and the union of bounds covers the box"). All six
URLs did return 200 with a `Content-Length`, but the union of `af`/`as`/`eu`
bounds does not fully cover 45–100 °E / 0–30 °N — it has the gap named above
at lon [~55, 57] × lat [0, 12]. The missing piece is that gap; the region
code needed to close it is unidentified and is Phase 5 work. Separately:
`bake/hydrosheds.py:49-73` (`_read_domain`) currently hardcodes the `eu`
region and a single `hyd_eu_{kind}_30s.tif` name per kind (see `tif =
f'hyd_eu_{kind}_30s.tif'` at line 64) and would need to learn to fetch and
mosaic `af`, `as`, and `eu` (and whatever region fills the gap) before this
domain can bake. The download cost the recorded sum implies for Phase 5 is
127,828,199 B (~121.9 MiB) of raw zip downloads for `af`+`as`+`eu` alone, not
counting whatever region is eventually found to close the gap.

## M4 — CDS request timing

One minimal request. This is a sample of one; CDS queue depth varies by hour and
by dataset, so the number below is an order of magnitude, not a service level.

Credential-existence check (brief Step 1 — existence only, contents never read,
copied, or edited):

```bash
test -f "$USERPROFILE/.cdsapirc" && echo "cdsapirc: present" || echo "cdsapirc: ABSENT"
```

```
cdsapirc: ABSENT
```

Per the repository owner's pre-flight ruling
(`.superpowers/sdd/2026-08-10-nio-domain-expansion-seam-a/progress.md`, "Task 5 /
M4"), `~/.cdsapirc` will not be created in this session: it needs a Copernicus
account, a licence acceptance on the CDS website, and a personal access token —
a human step that must not be automated. With credentials absent, the probe was
not attempted: no CDS request was issued. The brief's Step 2 (`pip install
cdsapi` into `bake/.venv`) was skipped too — it exists only to enable a probe
that will not run, so installing it here would buy nothing.

| Field | Value |
| --- | --- |
| Credentials present before the probe | `ABSENT` |
| Dataset | `BLOCKED` |
| Request dict | `BLOCKED` |
| Submit time (UTC) | `BLOCKED` |
| Completion time (UTC) | `BLOCKED` |
| Elapsed seconds | `BLOCKED` |
| Downloaded bytes | `BLOCKED` |

Projection to Phase 10's 45 event requests: `BLOCKED`
Projection to the two 12-month × 30-year climatology requests: `BLOCKED`
Verdict: `BLOCKED` — no CDS credentials at measurement time, by the repository
owner's decision.

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

Both `vayu` and `hikaa` are `benchmarkPartition: "calibration"` (confirmed
from `public/data/scenarios.json`), satisfying the brief's constraint against
substituting a `validation`-partition scenario. Both crops moved the bbox
origin on both axes (`originMoved.lon` and `.lat` both `true` for both
storms), so neither run needed a substitute scenario.

| Field | vayu | hikaa |
| --- | --- | --- |
| Scenario bin | `data/env_vayu.bin` | `data/env_hikaa.bin` |
| Full-extent header (nx, ny, bbox) | 40×24, bbox=(50,70,15,27) | 40×24, bbox=(50,70,15,27) |
| Simulated frame bbox | lon [65.07165243085765, 68.79471271825024], lat [20.279774922096035, 21.70066212585945] | lon [56.52468583857511, 66.1], lat [20.05712133883342, 20.4] |
| Crop window applied | lon [60.5, 70], lat [15.5, 26.5] | lon [52, 70], lat [15.5, 25] |
| Cropped header (nx, ny, bbox) | 19×22, bbox=(60.5,70,15.5,26.5) | 36×19, bbox=(52,70,15.5,25) |
| Origin moved (lonMin and/or latMax) | lon=true, lat=true | lon=true, lat=true |
| Cropped bin size, bytes | 482,248 (full 1,106,632; ratio 0.435780) | 526,024 (full 737,992; ratio 0.712777) |
| `validateEventBinForScenario` return | `null` | `null` |
| Frame count, full vs cropped | 360 vs 360 | 177 vs 177 |
| Tapes byte-identical | **true** (sha256 match) | **true** (sha256 match) |
| Max track deviation, km | 0 | 0 |
| Max wind deviation, kt | 0 | 0 |
| Max central-pressure deviation, hPa | 0 | 0 |
| Max RMW deviation, km | 0 | 0 |
| Landfall identical | true | true |
| Death identical | true | true |
| Pure-sampling max &#124;Δ&#124; over the interior lattice | 0 | 0 |
| Pure-sampling points differing at all, of 10201 | 0 | 0 |
| Negative control (zero-margin crop) track deviation, km | 108.00362262918549 | 140.327957185087 |
| Negative control raised an error | No (`controlError: null`) | No (`controlError: null`) |

Both runs died naturally inside the window (not a spike artifact — confirmed
by rerunning `runDetailedHindcastCase` against the full-extent bin alone and
inspecting `result.death`): `vayu` died to shear at `durationH` 89.75
(`{"reason":"shear","closestApproachKm":756.8855814927925,"peakKt":127.93698798852252}`),
`hikaa` died to land at `durationH` 44, after a landfall at `ageH` 34.25
(`{"reason":"land","closestApproachKm":370.9224546036663,"peakKt":73.57013979928252}`).
This is why the observed frame counts (360, 177) are shorter than a
naive full-duration estimate (windowH − envOffsetH at 15-min ticks: 481 for
vayu, 373 for hikaa) — the early `died` event breaks
`runDetailedHindcastCase`'s tick loop
(`src/hindcast-benchmark.ts:183-194`). What matters for M5 is that the full
and cropped runs died at the identical tick with the identical cause, which
they did (`deathEqual: true`, identical frame counts).

Contrary to the brief's own pre-measurement hypothesis (`src/grid.ts:86`
producing ~1e-14 rounding drift between `(lon − 50)` and `(lon − 60.5)`
arithmetic), the measured result is **exact, not approximate**:
`identicalTape` is `true` for both storms, and the pure-sampling probe found
zero differing points, not a small nonzero count with sub-1e-13 magnitude.
Extending the brief's sampling probe (which checks only the first shared
layer, by design — see the `break` in `samplingDiff`) to all eight shared
env layers for both storms confirms this is not a first-layer coincidence:
81,608 total sample points (10,201 × 8 layers) across both scenarios, 0
differing, worst-case |Δ| 0. No mechanism is asserted for why the predicted
ULP drift did not manifest here — this was not investigated beyond the
measurement itself, per the instruction to report only what was observed.

Two findings independent of the pass/fail verdict:

- `validateEventBinForScenario` (`src/scenarios.ts:184-202`) returned `null`
  — ACCEPTED — for both wrong-extent (subwindow) bins. Reading the function
  confirms why: it checks only layer names and `nt` per layer
  (`bin.layers.get(name)`, `layer.nt !== expectedNt`), never `bbox`, `nx`, or
  `ny`. This is the concrete case spec §5 invariant 1 ("No layer header bbox
  may disagree with `grid.ts DOMAIN`... `validateEventBinForScenario` must
  assert `nx`, `ny` and bbox") must close.
- `src/env-sampler.ts:163-164` (`sample()`) clamps every query lat/lon to
  `grid.ts DOMAIN` before calling `sampleEnvBin` → `sampleLayer` →
  `sampleLayerBilinear`; `src/raster-sampler.ts:15-16` then clamps the
  resulting cell coordinate a second time, to the layer's own `nx`/`ny`
  edge — confirmed by reading both call sites, not inferred. For a subwindow
  bin, a point inside `DOMAIN` but outside the subwindow's own bbox passes
  the first clamp unchanged and is then silently pinned to the subwindow's
  edge cell by the second clamp — reading stale/wrong edge data with no
  error. The negative control (zero-margin crop) is the empirical
  demonstration of exactly this: `vayu` deviated by 108.0 km track / 30.5 kt
  wind / 25.9 hPa pressure and changed its death outcome; `hikaa` deviated by
  140.3 km track / 15.6 kt wind and changed both its landfall and death
  outcome. Neither crop threw (`controlError: null` both times) — the run
  silently produced different, wrong physics. This is the evidence for spec
  §5 invariant 1's motivating case and for kill criterion §11 #4's concern
  about a too-tight subwindow.

Steering-bin sampling comparison (no sim, `steering_vayu.bin`, `u850`, crop
window lon [62.5,70] lat [15.5,27], same window used in the Step 3
round-trip check): `{"points":10201,"differing":0,"worst":0}` — exact match,
far inside the brief's 1e-6 m/s investigate-threshold. The
steering path is not exercised by `runDetailedHindcastCase`'s default
arguments (no `pressureWindSampler` passed — `calibrate:check` never drives
it), so this sampling-only check is the only M5 evidence for a cropped
STEERING bin specifically; no full sim run through a cropped steering bin
was measured.

Projected `calibration/data` size with track-following subwindows: spec
§4.3 states "a basin-wide cohort at full extent would be about 10 MB of
forcing per storm" — a figure for the *future*, much larger basin-wide
domain, not measured in this spike. This spike measured the crop ratio only
on the *current*, small 40×24 (20°×12°) domain: 0.435780 (vayu) and
0.712777 (hikaa), mean 0.574279. Applying that ratio directly to the spec's
stated 10 MB/storm figure gives an implied per-storm subwindow size of
4.36–7.13 MB (mean ≈5.74 MB). `calibration/data` today holds 30 HF-3
steering bins (`calibration/data/hf3/`, 20 MiB on disk) + 16 HF-6 forcing
bins (`calibration/data/hf6/forcing/`, 12 MiB on disk) = 46 storms —
independently counted with `ls`, matching the brief's figures exactly; whole
`calibration/data` is 54 MiB on disk today. At the measured ratio, 46
storms at the *future* full-extent size project to 46 × [4.36, 7.13] MB ≈
200.6–328.0 MB (mean ≈264.2 MB) — **above** the 150 MB target. This projection is
almost certainly pessimistic: the ratio measured here is "how much of a
20°×12° domain a track-following window occupies," and the future
basin-wide domain (55°×30° per M2) is far larger while a storm's physical
travel distance is not, so the true future-domain ratio should be smaller
than what was measured here. That reduction was not measured — it would
require repeating this spike against a new-domain-sized env bin, which does
not exist yet. The 150 MB target is therefore **CONTINGENT**, not
SUPPORTED: the offset-bbox mechanism itself is proven (see verdict below),
but this measurement's own ratio, taken at face value, projects over
budget, and the domain-size argument for why it should come in under budget
is reasoning, not measurement.

Verdict: **PASS.** Both scenarios hit the strongest pre-declared bar —
tapes byte-identical (`identicalTape: true`), not merely within the ≤1.0 km
track / ≤0.5 kt wind tolerance — with landfall and death identical in both
cases. Kill criterion §11 #4 does not fire: offset-bbox forcing is usable
for non-sealed calibration data. The 150 MB numeric budget target is
separately CONTINGENT (see above) — a distinct question from whether the
mechanism reproduces physics.

Separately, one arithmetic note on the brief's own Step 3 worked example,
which does not affect the verdict above: its "Expected" byte count
(`704 + 8*15*23*72*2 = 745,664`) does not match its own stated formula, which
evaluates to 398,144 (704+397,440), and the correct total including the
8-byte format-magic prefix omitted from that formula is 398,152
(8+704+397,440) — the value this measurement actually produced and which
`src/loader.ts` parsed without error, confirming the byte layout is correct
even though the brief's arithmetic was not.

## Verdicts

| # | Measurement | Verdict | Kill criterion | Fired |
| --- | --- | --- | --- | --- |
| M1 | Pages compression above 10 MB | `UNMEASURED` | §11 #3 | `UNMEASURED` |
| M2 | GMRT over the new box | PASS | §11 #1 | No |
| M3 | HydroSHEDS bytes | `UNMEASURED` | none | n/a |
| M4 | CDS queue time | `BLOCKED` | none | n/a |
| M5 | Offset-bbox forcing | `UNMEASURED` | §11 #4 | `UNMEASURED` |

## What Phase 0 did not measure

- **M4, CDS request timing.** No CDS request was issued: `~/.cdsapirc` is
  absent on this machine and, by the repository owner's decision, was not
  created for this measurement. This is not a narrow M4 gap — the same
  missing credential is the project's long pole for the whole domain
  expansion. It gates all of Seam B Phase 10's ERA5 refetch (45 CDS requests,
  spec §6 Phase 10). It also reaches into this very plan: Task 34's
  old-domain rebake, byte-clean gate cannot populate `data/raw/`'s two ERA5
  climatology files via `bake/fetch_era5.py` and therefore cannot bake, and
  Task 36's ERA5-at-new-extent reproduction probe cannot run — which means
  the combined reproduction-probe gate (Tasks 35-37, consumed by task P5-D)
  cannot complete either, even though Task 35's GMRT probe and Task 37's
  HydroSHEDS probe do not themselves need CDS credentials. Separately, and
  regardless of the CDS question, `data/raw/` does not exist at all on this
  machine, so every other bake input (GMRT, HydroSHEDS, OISST, IBTrACS) needs
  re-downloading before any of those later tasks can run either.
- (M1, M2, M3, M5 entries pending Task 7's verdict roll-up.)
