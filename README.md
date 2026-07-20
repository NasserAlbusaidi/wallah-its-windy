# Wallah It's Windy

An Arabian Sea tropical-cyclone sandbox that runs in the browser. Click the sea
to spawn a storm, then **let it take course** — sea-surface temperature, steering
winds, wind shear, and terrain decide its fate. When a storm makes landfall on
the Omani coast, the Hajar mountains wring out the rain and the wadis light up.

No joystick, no dragging the storm: you author it, physics finishes it.

> Status: **playable**. A deterministic storm forms, drifts, intensifies and dies
> on real baked climate data. Its Holland-style structure carries parametric
> central pressure, radius of maximum wind, motion asymmetry, and quadrant
> 34/50/64-kt wind radii, rendered as a dark nautical instrument. A fixed-seed
> demo storm opens mid-life on first load. Compare June vs October at one click;
> share any storm by its URL. User storms carry a live flight recorder that
> explains each intensity change in numbers and plain language, then becomes a
> debrief, controlled-comparison lab, export station, and replay timeline.

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
```

## Controls

- Click open water to spawn a storm.
- Press Space or use the flight recorder's button to pause and resume.
- After the storm ends, scrub its recorded track or jump to its peak, first
  landfall, and final frame. Replay reads immutable recorded frames; it never
  rewinds the simulation engine.
- Choose a second month or event environment under the debrief to run the exact
  same genesis and seed again. The first track remains amber beneath the cyan
  candidate, and the paired debrief reports intensity, lifetime, approach, and
  landfall differences.
- Save a 1600×900 PNG debrief card or a 10-second WebM replay. Both render from
  the immutable flight tape with no runtime dependency or server upload.
- Open **model notes** for the observed inputs, deliberate simplifications, and
  the counterfactual-event contract.

The live map shows three structure contours: amber is the radius of maximum
wind, faint cyan is the 34-kt footprint, and bright white-cyan is the 64-kt
footprint. The flight tape records central pressure, RMW, Holland B, outer wind
radii, translation, and right-of-motion bias with every fixed physics step.

On touch screens, a short stable tap spawns; drag, long-press, and multi-touch
gestures do not. Narrow layouts keep the causal sentence visible and place exact
physics behind a **details** disclosure. Decorative resolution and particle
count adapt to the device; physics and recorded results never do.

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
```

- Binary format + golden test vector: **`BINARY-FORMATS.md`**.
- Full provenance, licenses, and bake details: **`bake/README.md`**.
- Sources (all auth-free): **GMRT** bathymetry+topography (`terrain.bin`),
  **NOAA OISST** SST climatology (`env.bin` SST — real), **IBTrACS** North-Indian
  tracks (`genesis.json`), and official **HydroSHEDS v1.1** ACC+DIR hydrography
  with per-cell travel time (`flowacc.bin`).
- Raw downloads cache under `data/raw/` (gitignored); the venv under `bake/.venv`.

### Provenance — steering/shear are REAL ERA5 (with synoptic samples)

`env.bin` is now **fully real**: SST from OISST, steering (`u`/`v`) and shear
from **ERA5 1991–2020 monthly means** (`bake/era5.py`; deep-layer mean of
850/500/250 hPa; each shipped plane's shear = |V200 − V850| of that YEAR's
monthly-mean winds). `bake/synth.py` remains only as the loudly-bannered
fallback when `data/raw/era5_climatology.nc` is absent.

**Synoptic samples (D10):** the track-diversity spike measured pure monthly
means as rail-prone (keep-ratio 16 % in June < the 30 % gate), so each month's
`u`/`v`/`shr` layer carries `nt = 4` planes — four real, coherent YEARS chosen
by deterministic farthest-point selection (one typical + three diverse; the
years print at bake time). At runtime the spawn **seed picks the plane**
(`seed % 4`, `src/env-sampler.ts`), so re-clicking the same spot summons
genuinely different environments while `sim = f(spawn, month, seed)` holds
(spike keep-ratio with samples: June 50 %, October 65 % — PASS). SST stays `nt = 1`. Hourly
Gonu (Jun 2007) and Shaheen (Sep–Oct 2021) event fields are already downloaded
under `data/raw/` for the v1.1 counterfactual bake, where `nt` is a TIME axis
(`tFrac` interpolation — the sampler's other mode).

**Event replay contract:** event mode is a counterfactual, not a hindcast. The
historical ghost shows the observed storm; the live parametric storm answers how a
spawn evolves in vortex-filtered ERA5 steering and shear with climatological
OISST. Its track and peak intensity need not match the ghost. We deliberately
keep this distinction instead of tuning one physics model to reproduce two
storms. See `bake/README.md` for the intensity sensitivity measurements and the
requirements for a future hindcast mode.

That contract is also visible in the interface: event options are labelled as
environments, the picker displays “not a historical reconstruction,” and every
event flight tape carries a counterfactual marker. Scientific limitations are
not hidden in documentation: the in-app model notes identify the point-storm
track/intensity core, empirical intensity equation, parametric Holland wind
structure, Atlantic-derived RMW proxy, geometric dry-air proxy, and the fact that
downstream flood light is timed D8 routing—not a discharge, infiltration, or
inundation model.

`env.bin` encodes the month in the layer **name** (`sst_MM/u_MM/v_MM/shr_MM`,
`MM` = 0-indexed `monthIndex`, `04`=May … `10`=Nov). Consumers resolve it with
`clamp(monthIndex, 4, 10)`; `src/env-sampler.ts` (sim) and `src/render/index.ts`
(tint) both do, and `test/integration-bins.test.ts` guards the mapping, the
plane count, and plane distinctness.

**Physics note:** the shear penalty (`src/sim.ts`, threshold 14 m/s vs the
classic instantaneous ~10) is calibrated EMPIRICALLY against the shipped
monthly-mean-wind shear distribution: |V200 − V850| of monthly means is
smoother than instantaneous shear yet runs persistently high wherever the flow
is steady (the monsoon). Recalibrate from scratch if the env source ever moves
to daily/hourly fields. A young storm gets a 12 h shear-grace ramp so hostile
regimes kill it watchably (~15–20 sim-h), not before the cause can render.

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
asymmetry, from which quadrant 34/50/64-kt radii are solved. This is a
deterministic visualization/hazard proxy. The RMW relationship was developed
from Atlantic storms and is not a North Indian aircraft analysis.

**Dry air (v1.1):** a fourth decay term models desert-air entrainment as a pure
geometric proxy — no humidity field exists, so the penalty grows as the Arabian
landmass nears the storm along its dry N/NW/W bearings (an `isLand` ray probe out
to ~190 km, mirroring `ui.nearCoast`). It stays off during open-sea spin-up and
bites only on the final coastal approach, so a strong storm weakens recognizably
near Oman instead of holding Cat-4 to the beach (tuned against IBTrACS Gonu 2007,
127→77 kt on approach). A dry-air-dominated death earns its own epitaph.

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
  structure.ts        Holland pressure/wind profile, RMW evolution, quadrant radii
  storm-session.ts    recording, pause/seek/replay transport, comparison baseline
  flight-recorder.ts  immutable per-tick tape + debrief/snapshot construction
  comparison.ts       same-identity paired-run validation and result deltas
  narrative.ts        exact intensity budget -> plain-language dominant cause
  export.ts           dependency-free PNG card + WebM replay renderer
  performance.ts      device-aware DPR/particle budgets (render only)
  tap-gesture.ts      tap-vs-drag/pinch input recognizer
  ui.ts               loading/demo/aftermath state machine, ripple, epitaph, slow-mo
  render/             WebGL2 dark-instrument layers behind one facade
  style.css           instrument chrome styling
  fonts/              self-hosted IBM Plex Mono woff2 (400, 500)
test/                 vitest: grid, loader (golden vector), rng, physics, integration
bake/                 Python data-baking (not shipped) — see bake/README.md
```
