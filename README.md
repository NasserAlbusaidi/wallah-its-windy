# Wallah It's Windy

An Arabian Sea tropical-cyclone sandbox that runs in the browser. Click the sea
to spawn a storm, then **let it take course** — sea-surface temperature, steering
winds, wind shear, and terrain decide its fate. When a storm makes landfall on
the Omani coast, the Hajar mountains wring out the rain and the wadis light up.

No joystick, no dragging the storm: you author it, physics finishes it.

> Status: **foundation scaffold**. The map renders as a dark instrument; the sim,
> particle rendering, and wadi flooding plug into marked seams. See the design doc
> and `TODOS.md` for what lands next.

## Stack

Vite + vanilla TypeScript + WebGL2, **zero runtime dependencies** (dev-only:
vite, typescript, vitest). Sim math is done in lat/lon degrees on a fixed 15
sim-minute timestep, seeded so a storm is a pure function of `(spawn, month,
seed)` — the seed rides in the URL hash, so storms are shareable.

Unified domain everywhere: **50–70°E / 15–27°N**.

## Dev commands

```bash
npm install       # dev deps only
npm run dev       # local dev server
npm run build     # typecheck (tsc --noEmit) + vite build -> dist/
npm run preview   # serve the production build
npm test          # vitest run (physics/grid/loader invariants)
```

Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`. The Vite
`base` is `./` so it works from a project subpath.

## Data baking

Map data is **pre-baked** into small self-describing `.bin` files by a Python
script that never ships to the browser (`bake/bake.py`, added during the data
phase). The runtime reads them via `src/loader.ts` and hardcodes no geometry.

- Binary format + golden test vector: **`BINARY-FORMATS.md`**.
- Sources (baked at build time, not committed raw): SRTM/GEBCO elevation,
  NOAA OISST SST climatology, ERA5 steering/shear, HydroSHEDS flow-accumulation
  + basin IDs, IBTrACS tracks. Raw downloads live under `data/raw/` (gitignored);
  a Python venv lives under `bake/.venv` (gitignored).
- Genesis zones ship as `public/data/genesis.json` (see BINARY-FORMATS.md).

## Layout

```
index.html            chrome (title, month picker, caption, canvases)
src/
  main.ts             app shell + fixed-dt accumulator loop + load seams
  grid.ts             THE coordinate/units module (latlon/cell/clip, deg/h)
  types.ts            shared contracts (sim / render / ui / data)
  tokens.ts           design tokens -> CSS vars + shader uniforms
  rng.ts              seeded RNG + shareable-storm URL hash
  loader.ts           .bin parser + validation + dequantize
  style.css           instrument chrome styling
  fonts/              self-hosted IBM Plex Mono woff2 (400, 500)
test/                 vitest: grid, loader (golden vector), rng
bake/                 Python data-baking (not shipped)
```
