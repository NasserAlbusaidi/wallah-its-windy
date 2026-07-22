# Wallah It's Windy

An Arabian Sea tropical-cyclone sandbox that runs in the browser. Click the sea
to spawn a storm, then **let it take course** — sea-surface temperature,
upper-ocean heat content, mid-level humidity, steering, wind shear, and terrain
decide its fate. When a storm makes landfall on the Omani coast, the Hajar
mountains wring out the rain and the wadis light up.

No joystick, no dragging the storm: you author it, physics finishes it.

> Status: **playable**. A deterministic storm forms, drifts, intensifies and dies
> on real baked climate data. Its Holland-style structure carries parametric
> central pressure, radius of maximum wind, persistent outer-core size,
> shear/motion asymmetry, displaced rainfall, and quadrant 34/50/64-kt wind
> radii, rendered as a dark nautical instrument. A fixed-seed
> demo storm opens mid-life on first load. Compare June vs October at one click;
> share any storm by its URL. User storms carry a live flight recorder that
> explains each intensity change in numbers and plain language, then becomes a
> debrief, controlled-comparison lab, export station, and replay timeline. Each
> user storm receives a deterministic, explicitly simulated WMO/ESCAP name; the
> tape adds an exact intensity sparkline and a geometric historical analog.
> Ten featured historical environments also have deterministic,
> observed-initialization hindcasts with honest track/intensity/pressure
> scoring and a separate counterfactual mode. A separate frozen 30-storm
> observational benchmark measures the exact runtime at 12/24/48/72 hours
> against a no-future-information persistence baseline. The map can switch
> among terrain, wind, simulated rain products, environmental fields, and a
> satellite desk with simulated or timestamp-matched observed imagery. A worker-run
> forecast laboratory adds deterministic ensembles, track member-frequency fields,
> and same-storm sensitivity experiments without blocking the map.

The current scientific and product sequence is maintained in
**[ROADMAP.md](ROADMAP.md)**. The
**[locked HF-2A specification](docs/hf2a-dynamic-upper-ocean-spec.md)** and the
phase artifacts under `calibration/` preserve every scientific gate. HF-2,
HF-3, and HF-4 are implemented but rejected by their frozen acceptance rules;
the app does not promote their ensemble output to calibrated probability. HF-5
implements provider-neutral normalization and immutable forecast issuance, but
no scheduled live feed is configured. HF-6 is implementation-complete: it
expands the audit to 72 storms and 144 initializations, and the untouched
eight-storm/16-initialization sealed first look has been scored. Track skill was
positive against persistence at 12/24/48 hours, but the frozen intensity and
pressure gates failed; the sealed result is therefore **rejected** and the
prospective registry remains at zero matured forecasts. See the
**[HF-6 model card](docs/model-card-hf6.md)** and generated
**[HF-6 scorecard](docs/hf6-scorecard.md)**. The project remains an experimental
simulator and retrospective forecast-companion prototype, not a replacement for
official guidance. The consolidated **[HF-1–HF-6 findings](docs/findings-hf1-hf6.md)**
explain what improved, what failed, and which claims the evidence supports.

## Stack

Vite + vanilla TypeScript + WebGL2, **zero runtime dependencies** (dev-only:
vite, typescript, vitest). Sim math is done in lat/lon degrees on a fixed 15
sim-minute timestep, seeded so a storm is a pure function of `(spawn, month,
seed)` — the seed rides in the URL hash, so storms are shareable. The renderer
interpolates between fixed steps; slow-mo near the coast is a pure timescale knob
and never touches determinism.

Unified domain everywhere: **50–70°E / 15–27°N**.

## Dev commands

```bash
npm install       # dev deps only
npm run dev       # local dev server
npm run build     # typecheck (tsc --noEmit) + vite build -> dist/
npm run preview   # serve the production build
npm test          # vitest run (physics, grid, loader golden vector, rng, bake<->runtime)
npm run profile:ensemble # 20/40/80-member steady-state benchmark
```

## Controls

- Click open water to spawn a storm.
- Hover the chart for modeled surface wind, SST, humidity, shear, and OHC at the
  cursor. Use **pin** to hold the reading; on touch, long-press the chart. The
  card identifies analysis, climatology, or fallback fields and always labels
  vortex wind as simulated.
- Eight coastal-city markers open exact current/run impact readings. A marker
  glows amber only while the same Holland profile used by the impact report
  puts that city at or above 34 kt.
- Pick a layer on the right-edge rail (or press 1–9): wind flow, simulated
  rain radar, simulated infrared, storm-total rainfall, SST, humidity, OHC,
  shear, and the terrain instrument. SST/RH/OHC/shear render the exact active
  baked plane; wind superposes ERA5 steering with the parametric vortex; IR,
  radar, and storm-total rainfall are explicitly simulated proxies.
- On the infrared layer, choose enhanced IR, operational grayscale, or a
  daytime visible-style rendering. Source controls switch among the simulated
  cloud field, timestamp-matched observed imagery, and a six-model-hour visual
  handoff from observed pixels to simulated evolution. Meteosat IR/VIS frames
  come from EUMETView; INSAT frames can be loaded from the provenance manifest
  after a registered MOSDAC download. The handoff is visual initialization,
  not data assimilation.
- The storm panel shows the live Saffir–Simpson category chip, an intensity
  bar with the model's MPI "potential" marker, and — near or after landfall —
  a coastal-impact report (parametric city winds, storm-total rain, and a
  flash-flood proxy tier). The track is coloured by category.
- Open **forecast laboratory** to run a 20/40/80-member deterministic ensemble.
  The map shows every member plus the fraction of members entering each grid
  cell. Peak-intensity quantiles and landfall/hurricane/major probabilities are
  reported beside it. These are explicit perturbation frequencies, not
  operationally calibrated forecast probabilities.
- Use the same laboratory to re-run one seed with controlled SST, RH, shear,
  OHC, or initial-core changes.
- Press Space or use the flight recorder's button to pause and resume.
- After the storm ends, scrub its recorded track or jump to its peak, first
  landfall, and final frame. Replay reads immutable recorded frames; it never
  rewinds the simulation engine. The wind-versus-time strip exposes every exact
  frame to pointer and keyboard inspection, while the analog line reports the
  closest shipped historical track under a labeled geometric score.
- Choose a second month or event environment under the debrief to run the exact
  same genesis and seed again. The first track remains amber beneath the cyan
  candidate, and the paired debrief reports intensity, lifetime, approach, and
  landfall differences.
- Save a 1600×900 PNG debrief card or a 10-second WebM replay. Both render from
  the immutable flight tape with no runtime dependency or server upload.
- Open **model notes** for the observed inputs, deliberate simplifications, and
  the hindcast/counterfactual contracts.

The live map shows three structure contours: amber is the radius of maximum
wind, faint cyan is the 34-kt footprint, and bright white-cyan is the 64-kt
footprint. The flight tape records central pressure, RMW, Holland B, outer wind
radii, translation, and right-of-motion bias with every fixed physics step.

### Weather-product contract

The four environmental products are data views, not decoration: their GPU
textures use the same temporally interpolated SST/RH/OHC/shear fields sampled by
physics. The enhanced-IR view follows the visual language of
[NOAA cloud-top-temperature products](https://www.goes-r.gov/products/baseline-cloud-top-temp.html),
but derives a bounded brightness-temperature proxy from the simulated vortex.
Its shader combines multiscale storm-relative turbulence, an organization- and
intensity-dependent eye and central overcast, convective cells tied to the
separated rain rates, humidity-limited spiral bands, and a canopy displaced and
eroded by the sampled deep-layer shear vector. The same generated cloud field
adds restrained context to terrain, wind, rain-radar, and storm-total rainfall;
it deliberately stays off SST, RH, OHC, and shear so those diagnostic fields
remain readable. The field evolves with simulated storm time and never feeds
back into the physics.

The satellite desk can instead display real, timestamp-labelled Meteosat IODC
IR10.8 or VIS0.6 pixels from EUMETSAT's public EUMETView WMS. Paused historical
runs match the 15-minute acquisition cadence; accelerated playback coarsens
refreshes to the event environment's three-hour cadence. The MOSDAC catalogue
is public but not browser-CORS-enabled, while INSAT pixels require registered
ingestion into the local provenance manifest. Observed imagery is always labelled with provider,
product, and acquisition time. The `obs to sim` mode crossfades pixels over six
model hours but does not change model state. The frozen
**[Shaheen morphology screen](docs/satellite-cloud-validation.md)** is a broad
visual-structure check, not radiometric or forecast validation.

The rain view maps the separated simulated rain rates through a
Marshall–Palmer-style `Z = 200 R^1.6` transform and a
reflectivity palette; it follows the
[NWS reflectivity concept](https://training.weather.gov/nwstc/NEXRAD/RADAR/3-1.htm)
but is not a radar observation. The interface labels both proxy products
as simulated and keeps observed satellite pixels source- and time-labelled.

On touch screens, a short stable tap spawns, a long-press pins the point probe,
and drag/multi-touch gestures do neither. Narrow layouts keep the causal sentence
visible and place exact physics behind a **details** disclosure. Decorative
resolution and particle count adapt to the device; physics and recorded results
never do.

Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`. The Vite
`base` is `./` so it works from a project subpath.

## Data baking

Map data is **pre-baked** into small self-describing `.bin` files by a Python
pipeline that never ships to the browser (`bake/bake.py`). The runtime reads them
through `src/loader.ts` (the only reader) and hardcodes no geometry — every
dimension, bbox, and quantization scale comes from the file header.

```bash
python3 -m venv bake/.venv
bake/.venv/bin/python -m pip install -r bake/requirements.txt
bake/.venv/bin/python bake/bake.py          # ~15s; writes public/data/*
bake/.venv/bin/python bake/fetch_event_benchmark.py # CDS-cached 10-storm inputs
bake/.venv/bin/python bake/bake.py events   # event bins + frozen catalogue
bake/.venv/bin/python bake/satellite_frames.py meteosat \
  --observed-at 2021-10-01T02:30:00Z --channel infrared # optional frame cache
npm run data:fidelity:catalog               # freeze the 30-storm HF-1 catalogue
npm run data:fidelity:fetch                 # fetch the 20 additional ERA5 cases
npm run data:fidelity:bake                  # bake offline-only forcing bins
npm run fidelity                            # regenerate metrics, reference + report
npm run data:hf6:catalog:check              # verify the frozen 72-storm catalogue
npm run hf6:observation-audit               # audit truth/strata availability
npm run data:hf6:fetch                      # acquire sealed ERA5 inputs (network)
npm run data:hf6:bake                       # bake 16 sealed initialization packages
npm run hf6:verify:check                    # reproduce the committed first look
npm run hf6:gate:check                      # enforce implementation + honesty gates
```

- Binary format + golden test vector: **`BINARY-FORMATS.md`**.
- Full provenance, licenses, and bake details: **`bake/README.md`**.
- Sources: **GMRT** bathymetry+topography (`terrain.bin`),
  **NOAA OISST** SST climatology (`env.bin` SST — real), **IBTrACS** North-Indian
  tracks (`genesis.json`), and official **HydroSHEDS v1.1** ACC+DIR hydrography
  with per-cell travel time (`flowacc.bin`). ERA5 supplies steering, shear, and
  600/700-hPa relative humidity; NOAA WOA23 supplies OHC26. Optional observed
  satellite frames use EUMETSAT EUMETView or registered MOSDAC/INSAT inputs,
  each recorded in `public/data/satellite/manifest.json`.
- GMRT, NOAA, and HydroSHEDS downloads are public and auth-free. ERA5
  reproduction requires a configured CDS API token and accepted Copernicus
  licence.
- Raw downloads cache under `data/raw/` (gitignored); the venv under `bake/.venv`.

### Provenance — steering/shear are REAL ERA5 (with synoptic samples)

`env.bin` is now **fully observed/climatological**: SST from OISST, steering
(`u`/`v`), shear, and 600/700-hPa relative humidity from **ERA5 1991–2020
monthly means** (`bake/era5.py`, `bake/era5_humidity.py`; deep-layer mean of
850/500/250 hPa; each shipped plane's shear = |V200 − V850| of that YEAR's
monthly-mean winds), and OHC26 from **NOAA WOA23** (`bake/woa23.py`). A normal
bake requires the real ERA5 wind and humidity files; the analytic environment is
only a browser asset-404 fallback.

**Synoptic samples (D10):** the track-diversity spike measured pure monthly
means as rail-prone (keep-ratio 16 % in June < the 30 % gate), so each month's
`u`/`v`/`shr`/`shu`/`shv`/`rh` layer carries `nt = 4` planes — four real,
coherent YEARS chosen
by deterministic farthest-point selection (one typical + three diverse; the
years print at bake time). At runtime the spawn **seed picks the plane**
(`seed % 4`, `src/env-sampler.ts`), so re-clicking the same spot summons
genuinely different environments while `sim = f(spawn, month, seed)` holds
(spike keep-ratio with samples: June 50 %, October 65 % — PASS). OISST SST and
WOA23 OHC stay `nt = 1`. November replaces the old wind-only “calm” selection
with two real years selected jointly for survivable shear and mid-level
moisture.

**Event contracts:** each of ten event bins carries aligned 3-hourly ERA5 SST,
600/700-hPa RH, steering, and shear plus midpoint-interpolated WOA23 OHC. “Observed
hindcast” starts at the first observed ≥34-kt fix at least 1.2° inside the map,
uses the matching
event-time offset, disables stochastic wander, then runs freely with no track or
intensity nudging. The debrief scores track MAE/RMSE, intensity MAE/bias,
pressure MAE, and peak bias against IBTrACS fixes. “Counterfactual sandbox”
keeps the original what-if workflow for a user-authored storm. The observed
ghost remains visible in both modes.

**Historical benchmark:** the catalogue is frozen at ten named storms with a
storm-level 7/3 split. Gonu, Phet, Nilofar, Ashobaa, Mekunu, Hikaa, and Vayu are
available to the bounded joint intensity search. Kyarr, Shaheen, and Biparjoy
stay untouched until acceptance. The generated
[hindcast report](docs/hindcast-benchmark.md) reports each storm and rejects a
candidate unless it improves the equal-storm held-out objective without breaking
per-storm wind, mean pressure, or track gates. CI re-runs the same runtime model
against the committed bins; it downloads nothing.

**HF-1 observational truth benchmark:** the broader reference is frozen at 30
Arabian Sea systems: 18 development, 6 validation, and 6 permanent final-test
storms. The ten featured browser cases are reused byte-for-byte; 20 additional
compact event bins live only under `calibration/data/fidelity/` and never enter
the browser bundle. This is a frozen, stratified coverage set rather than a
random or exhaustive sample, and IBTrACS best track is a post-analysis
verification reference rather than error-free ground truth. Every storm uses
USA/JTWC position, one-minute wind, and pressure consistently, begins at the
first >=34 kt fix at least 1.2 degrees
inside the product domain, and then runs freely with no observed-state nudging.
Initial `NATURE` is `TS`, or `NR` only for older archive rows that have a valid
USA/JTWC wind but no reported nature.
Exact 12/24/48/72-hour errors include track, along/cross-track displacement,
wind, and pressure. The comparison baseline extrapolates only motion observed
before initialization at constant spherical speed/bearing and holds the initial
intensity and pressure fixed; it cannot read a future fix. Uncertainty is a
deterministic 2,000-member
storm-level bootstrap. Development is available for future tuning, validation
is the <=5% regression gate, and final test is always report-only. See the
generated [HF-1 benchmark report](docs/fidelity-benchmark.md).

Scientific limitations are not hidden: this is still a deterministic point-vortex
track/intensity model, not an operational atmospheric model. Its convection,
ocean coupling, and rain rates are bounded parameterizations; WOA23 is monthly
climatology rather than an event-specific subsurface ocean analysis; the
Holland wind structure and Atlantic-derived RMW relation are parametric; and
downstream flood light is timed D8 routing—not discharge, infiltration, or
inundation.

`env.bin` encodes the month in the layer **name**
(`sst_MM/u_MM/v_MM/shr_MM/shu_MM/shv_MM/rh_MM/ohc_MM`,
`MM` = 0-indexed `monthIndex`, `04`=May … `10`=Nov). Consumers resolve it with
`clamp(monthIndex, 4, 10)`; `src/env-sampler.ts` (sim) and `src/render/index.ts`
(tint) both do, and `test/integration-bins.test.ts` guards the mapping, the
plane count, and plane distinctness.

Chronological event bins are different: they use the exact 0-indexed calendar
suffix, including December (`11`) in the offline HF-1 catalogue. Only
climatology layers clamp to the May–November shipped season.

**Physics note:** the shear penalty (`src/sim.ts`, threshold 14 m/s vs the
classic instantaneous ~10) is calibrated EMPIRICALLY against the shipped
monthly-mean-wind shear distribution: |V200 − V850| of monthly means is
smoother than instantaneous shear yet runs persistently high wherever the flow
is steady (the monsoon). Recalibrate from scratch if the env source ever moves
to daily/hourly fields. A young storm gets a 12 h shear-grace ramp so hostile
regimes kill it watchably (~15–20 sim-h), not before the cause can render.

**Core and ocean coupling:** convective organization is a persistent state, not
an instantaneous multiplier. Warm/moist/deep-ocean/low-shear environments build
it slowly; shear, land, and dry ventilation break it down faster. Intensity
growth depends nonlinearly on that core health and OHC. A strong slow storm
deposits spatial cold-wake patches that decay over five days; the vortex samples
its own accumulated cooling on later steps. This is deterministic and fixed-step
stable, but remains a compact parameterization rather than a mixed-layer model.

**Physical structure:** `src/structure.ts` converts each simulated intensity
state into a coherent [Holland-style radial wind
profile](https://doi.org/10.1175/1520-0493(1980)108%3C1212:AAMOTW%3E2.0.CO;2).
The radius of maximum wind begins from the
[NOAA/NHC-documented Willoughby–Rahn climatological
relationship](https://www.nhc.noaa.gov/jht/17-19reports/Chirokova_midyear1.pdf),
then relaxes over 12 simulated hours toward an intensity-, latitude-, shear-,
and land-dependent target. Holland B controls profile compactness; the inverted
Holland maximum-wind relation supplies a parametric central pressure. The
actual simulated translation vector introduces a bounded right-of-motion
asymmetry. A separately evolving outer-size state relaxes over 18 hours and
stretches only winds below 48 kt, leaving pressure and the R50/R64 inner core
unchanged. ERA5's actual 200–850 hPa vector then stretches the outer field and
displaces the rain source downshear-left. This is a deterministic
visualization/hazard proxy. The RMW relationship was developed from Atlantic
storms and is not a North Indian aircraft analysis.

**North Indian validation:** the offline harness under `calibration/` scores the
exact runtime structure equations against a pinned, agency-consistent subset of
39 IBTrACS/JTWC storms from 2019–2024. It holds out complete storms, uses modern
quality tiers (R34 from 2019; R50/R64 from 2022), reports pressure and quadrant
radii by intensity, subbasin, lifecycle, and quadrant, and keeps RMW
exploratory-only. The accepted outer-size calibration reduces held-out R34 MAE
from 61.9 km to 54.5 km (12.0%) while pressure, R50, and R64 MAE remain
unchanged. See the generated [calibration report](docs/structure-calibration.md).

```bash
npm run data:structure       # re-extract from the pinned raw IBTrACS snapshot
npm run calibrate:structure  # regenerate machine + human reports
npm run calibrate:intensity  # ten-storm search + untouched holdout decision
npm run fidelity             # 30-storm lead-time observational reference
npm run calibrate:check      # CI regression gate; no network required
```

**Ensemble performance:** simulation runs in a dedicated worker and caches
decoded environment/terrain bins by URL. Non-rendered members evolve the exact
same coupled intensity, organization, cold-wake, RMW, and outer-size dynamics
but skip twelve quadrant-radius inversions per tick; a regression test proves
those coupled states remain byte-for-byte identical to full structure mode.
`npm run profile:ensemble` records the 20 / 40 / 80-member scaling curve with a
synthetic environment (browser fetch and worker startup excluded); the committed
implementation remains below 250 ms even at 80 members on the current
development machine. Interactive analyses use a declared 240-hour horizon.

**Moisture and rainfall:** dry-air weakening now uses the actual ERA5 600/700-hPa
RH, with shear providing a ventilation pathway into a weakly organized core.
The former geometric coast-distance helper remains exported only for compatibility
with older diagnostics; it does not drive the engine. Rain is separated into an
organization-sensitive metric eyewall ring, broader spiral rainbands, and an
upslope terrain component. Only land accumulation feeds the wadi visualization.

## Layout

```
index.html            chrome (title, month picker, caption, canvases)
src/
  main.ts             composition root: fixed-dt loop, sim/render/ui wiring, input
  grid.ts             THE coordinate/units module (latlon/cell/clip, m/s->deg/h)
  types.ts            shared contracts (sim / render / ui / data)
  tokens.ts           design tokens -> CSS vars + shader uniforms
  rng.ts              seeded RNG + shareable-storm URL hash
  loader.ts           .bin parser + validation + dequantize
  env-sampler.ts      EnvSampler over env.bin (real SST) + analytic fallback
  sim.ts              track/intensity physics: steering+beta+wander, DeMaria-Kaplan
  structure.ts        two-region Holland profile, RMW/outer-size evolution, radii
  structure-validation.ts offline scoring, storm split, calibration acceptance
  storm-session.ts    recording, pause/seek/replay transport, comparison baseline
  flight-recorder.ts  immutable per-tick tape + debrief/snapshot construction
  hindcast.ts         observed-fix interpolation + track/intensity/pressure scores
  hindcast-benchmark.ts exact multi-storm runner + equal-storm aggregation
  fidelity-verification.ts exact lead errors, persistence + bootstrap intervals
  ensemble.ts         deterministic perturbations, probability grid, summaries
  ensemble.worker.ts  off-main-thread runs + decoded-bin URL cache
  weather-layers.ts   nine map-product labels, provenance, and legends
  category.ts         Saffir–Simpson thresholds, chip copy, tracker colours
  impact.ts           storm-total rain grid + per-city exposure (impact proxy)
  render/wind.ts      Windy-style full-map wind flow (particles + trails)
  comparison.ts       same-identity paired-run validation and result deltas
  narrative.ts        exact intensity budget -> plain-language dominant cause
  export.ts           dependency-free PNG card + WebM replay renderer
  performance.ts      device-aware DPR/particle budgets (render only)
  tap-gesture.ts      tap-vs-drag/pinch input recognizer
  ui.ts               loading/demo/aftermath state machine, ripple, epitaph, slow-mo
  render/             WebGL2 terrain, scalar, IR-proxy, radar, storm layers
  style.css           instrument chrome styling
  fonts/              self-hosted IBM Plex Mono woff2 (400, 500)
test/                 vitest: grid, loader (golden vector), rng, physics, integration
bake/                 Python data-baking (not shipped) — see bake/README.md
calibration/          pinned IBTrACS subsets, offline forcing, metrics + gates
docs/                 generated calibration and observational benchmark reports
ROADMAP.md             staged fidelity, forecasting, validation + product plan
```
