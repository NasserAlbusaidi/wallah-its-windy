# Wallah It's Windy

An Arabian Sea tropical-cyclone sandbox that runs in the browser. Click the sea
to spawn a storm, then **let it take course** — sea-surface temperature, steering
winds, wind shear, and terrain decide its fate. When a storm makes landfall on
the Omani coast, the Hajar mountains wring out the rain and the wadis light up.

No joystick, no dragging the storm: you author it, physics finishes it.

> Status: **playable**. A point-vortex storm forms, drifts, intensifies and dies
> on real baked climate data, rendered as a dark nautical instrument. A fixed-seed
> demo storm opens mid-life on first load. Compare June vs October at one click;
> share any storm by its URL. User storms carry a live flight recorder that
> explains each intensity change, then becomes a debrief and replay timeline.

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

Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`. The Vite
`base` is `./` so it works from a project subpath.

## Data baking

Map data is **pre-baked** into small self-describing `.bin` files by a Python
pipeline that never ships to the browser (`bake/bake.py`). The runtime reads them
through `src/loader.ts` (the only reader) and hardcodes no geometry — every
dimension, bbox, and quantization scale comes from the file header.

```bash
python3 -m venv bake/.venv
bake/.venv/bin/python -m pip install numpy scipy h5py
bake/.venv/bin/python bake/bake.py          # ~15s; writes public/data/*
```

- Binary format + golden test vector: **`BINARY-FORMATS.md`**.
- Full provenance, licenses, and the swap-in TODOs: **`bake/README.md`**.
- Sources (all auth-free): **GMRT** bathymetry+topography (`terrain.bin`),
  **NOAA OISST** SST climatology (`env.bin` SST — real), **IBTrACS** North-Indian
  tracks (`genesis.json`), D8 flow-accumulation from the real DEM (`flowacc.bin`).
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
historical ghost shows the observed storm; the live point vortex answers how a
spawn evolves in vortex-filtered ERA5 steering and shear with climatological
OISST. Its track and peak intensity need not match the ghost. We deliberately
keep this distinction instead of tuning one physics model to reproduce two
storms. See `bake/README.md` for the intensity sensitivity measurements and the
requirements for a future hindcast mode.

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
  sim.ts              point-vortex physics: steering+beta+wander, DeMaria-Kaplan
  ui.ts               loading/demo/aftermath state machine, ripple, epitaph, slow-mo
  render/             WebGL2 dark-instrument layers behind one facade
  style.css           instrument chrome styling
  fonts/              self-hosted IBM Plex Mono woff2 (400, 500)
test/                 vitest: grid, loader (golden vector), rng, physics, integration
bake/                 Python data-baking (not shipped) — see bake/README.md
```
