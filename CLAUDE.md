# CLAUDE.md — operating rules for AI sessions on cyclone-sim

Wallah It's Windy: a browser Arabian Sea cyclone simulator. Vite + vanilla
TypeScript + WebGL2; offline Python bake pipeline under `bake/` writes
self-describing `.bin` assets the browser loads.

## Commands

- `npm test` — full vitest suite. Run it before claiming any change works.
- `npm run build` — `tsc --noEmit` then `vite build`; a type error fails the build.
- `npm run calibrate:check` — replays the structure, hindcast, and fidelity
  calibrations and diffs against committed results; fails if the model drifted
  from the sealed numbers. Any physics edit must leave this green or be a
  deliberate, gated recalibration.
- `npm run fidelity` regenerates the 30-storm benchmark report;
  `npm run fidelity:check` verifies without writing.
- `npm run realism` regenerates the R2a realism benchmark report;
  `npm run realism:check` verifies without writing (advisory — not yet a CI
  gate). It is a sim-side regression check only: drift fails in both
  directions, and R2 completes only with R2b's observed references.
- `npm run profile:ensemble` — vitest bench of `calibration/ensemble.bench.ts`;
  run it when touching ensemble/worker hot paths so regressions are measured,
  not guessed.
- HF-6 checks: `npm run hf6:verify:check`, `hf6:gate:check`,
  `hf6:prospective:check`, `data:hf6:catalog:check` — sealed-cohort
  verification; must pass untouched after any model change.
- CI deploy gate (`.github/workflows/deploy.yml`, Node 24.18.0): `npm ci`,
  `npm test`, `npm run calibrate:check`, the three HF-6 checks, then
  `npm run build`. Breaking any of these blocks the GitHub Pages deploy.
- Runtime `.ts` reaches the offline scripts two ways: most `calibration/*.mjs`
  load it through an in-process Vite server (`vite.ssrLoadModule`, which works
  under plain `node`); only `calibration/run.mjs`, `bake/hf6_prospective.mjs`,
  and `bake/live_archive.mjs` import `.ts` statically and need
  `node --experimental-strip-types`. The gate scripts (`hf2-gate.mjs`, ...)
  run on plain `node`; none imports `.ts` statically (`hf5-gate.mjs` loads
  `.ts` only via `ssrLoadModule`). Data scripts use
  `node bake/run-python.mjs`, which resolves the repository venv's POSIX
  `bin/python` or Windows `Scripts/python.exe` layout and never falls back to a
  system interpreter (except the documented `data:structure` command).
  Wrong Node or a missing venv fails these, not the app.

## Determinism (the core invariant)

- A storm is a pure function of (spawn, month, seed). `src/sim.ts` contains no
  `Math.random`/`Date.now`; all randomness flows through the seeded mulberry32
  stream in `src/rng.ts`. The only `Math.random` in `src/` is
  `randomSeed()` (rng.ts), which mints a seed UI-side for a brand-new storm —
  after that the seed is in the URL hash and the run must replay identically.
- Physics advances in fixed 15-sim-minute steps (`SIM_DT_MIN` in main.ts,
  `dtMin = 15` in ensemble.ts). Never tie dt to frame rate or wall clock:
  shared URLs must replay byte-identical tracks.
- Render/UI may adapt to the device via `src/performance.ts` — dprCap,
  particle budget, compact layout only. Physics and recorded results never
  read device traits or the clock.
- Replay reads the immutable flight-recorder tape
  (`src/flight-recorder.ts`); scrubbing rebuilds state from copied frames and
  never rewinds or re-drives the engine, so replay cannot corrupt the run.
- Wall-clock time is allowed only in observed-imagery/live paths
  (`satellite-observations.ts`, `radar-observations.ts`, and the satellite
  target-time and radar-timeline code in main.ts) — never in sim code or
  recorded output.
- The pan/zoom camera (`src/camera.ts` + `src/camera-gestures.ts`) is
  presentation-only: `grid.ts` clip space stays domain-fixed WORLD space
  (edges at ±1) and the camera is an affine world→NDC view applied at the
  screen boundary. Sim, recorded output, calibration, and offscreen state
  passes (cloud-memory, OHC blend, rain accumulator update — they bind
  `IDENTITY_VIEW`) never read it. Never make `latLonToClip`/`clipToLatLon`
  camera-aware — realism/fidelity/impact all consume them.
- The URL-hash format is a frozen compatibility contract: a climatology storm
  must encode to the exact legacy `lat=…&lon=…&month=…&seed=…` string; optional
  keys (the scenario `env` key) append validated and last, and unknown values
  are dropped on both encode and read (`test/rng.test.ts`). New hash keys must
  keep legacy URLs byte-identical on round-trip or every previously shared URL
  breaks.
- Fidelity metrics are canonicalized to 9 decimal places (`canonicalizeNumbers`
  / `RESULT_DECIMAL_PLACES` in `calibration/fidelity.mjs`) so ARM64 vs x86_64
  libm differences cannot desync sealed results; any new number written to the
  fidelity results/reference must pass through it.
- `src/rainband-profile.ts` is the ONE rainband spatial contract for the three
  RAIN products (`render/radar.ts`, `render/rain.ts`, `impact.ts`) and the
  minimum precipitating-cloud support in `render/env.ts`. The latter shares
  only the instantaneous rain centre/envelope; its CDO and cirrus remain
  independent morphology. Only the render paths share `rainCenterClip`;
  `impact.ts` retains its recorded-output displacement math. The mean is
  internally consistent, NOT validated against observed rainfall.
- `rCanopy` in `src/render/storm-radii.ts` has NO `rMax` floor, deliberately.
  Because `structure.ts` clamps `rmwKm` to [12,95] and `outerSizeKm` to
  [60,420], such a floor binds for broad weak storms and re-couples the canopy
  to the contracting core — the exact bug it appears to prevent.

## Binary data pipeline

- `src/loader.ts` is the ONLY `.bin` reader; `bake/bake.py` (via
  `bake/binfmt.py`) is the writer; `BINARY-FORMATS.md` is the byte-level
  contract. Change one, change all three, including the golden hex vector.
- `test/loader.test.ts` ("loader: parses the golden vector to exact values")
  pins the exact byte layout; `test/integration-bins.test.ts` loads the real
  baked files through the production reader. Both must pass after any format
  work.
- Dims, bbox, and quantization come from file headers — the runtime hardcodes
  no grid geometry. Do not add a second parser or inline byte offsets.
- `regions.bin` region ids are categorical: unquantized uint8/uint16 with
  scale 1 offset 0 so they survive the loader's Float32 dequantize bit-exact.
  Wadi names in `regions.json` are resolved from geography-keyed anchor
  coordinates at bake time (`bake/bake_regions.py`) — never hand-edit the id
  tables; rebake instead. The runtime resamples through the layer's own
  header grid and treats a missing file as "no regions block", never an error.
- `public/data/upper.bin`'s planes must carry the same picked real years as
  `env.bin`'s (plane k = same year, both files). `bake/bake_upper_winds.py`
  enforces this by reconstructing env.bin's year-picked layers byte-for-byte
  before writing; if that gate fails, STOP — never rebake env.bin to satisfy
  it. `upper.json` is the persisted plane→year record.

## Design tokens

- `src/tokens.ts` is the ONE design-token source: CSS custom properties
  (`injectCssVars`, consumed by `src/style.css`) and WebGL colour uniforms are
  both derived from the same rgb triples so they cannot drift. Tune colours
  only there — never hardcode a colour in `style.css` or a shader.
  `test/tokens.test.ts` pins the chrome palette.

## env.bin month-index quirk

- Layer names carry a 0-INDEXED month: June is `sst_05`, not `sst_06`.
  Climatology suffixes clamp to `04..10` (`envMonthSuffix` in
  `src/env-sampler.ts`); event bins use the exact calendar suffix `00..11`,
  December included (`eventMonthSuffix`). Guarded by the suffix tests in
  `test/integration-bins.test.ts`.
- A wrong suffix does not throw — the sim silently falls back to the analytic
  climate. That silent fallback is why the integration test exists; keep it
  covering any new month-suffixed layer.

## Machine-generated reports — never hand-edit

- `docs/fidelity-benchmark.md` (`npm run fidelity`),
  `docs/hindcast-benchmark.md` (`npm run calibrate:intensity`),
  `docs/structure-calibration.md` (`npm run calibrate:structure`),
  `docs/hf6-scorecard.md` (`npm run hf6:gate`),
  `docs/realism-benchmark.md` (`npm run realism`). Regenerate via the script; a
  hand edit is reverted on the next run and makes the report lie about the code.

## Frozen scientific gates

- Acceptance rules and contracts (`calibration/*-acceptance.json`,
  `*-contract.json`) are frozen before scoring and never retuned after.
  HF-2/HF-3/HF-4 and the HF-6 sealed first look are REJECTED and stay rejected
  (ROADMAP.md, docs/findings-hf1-hf6.md). Re-running a gate to flip a verdict
  invalidates the whole protocol.
- Calibration changes go only through the documented flows
  (`calibrate:structure`, `calibrate:intensity`, `hfN:gate`) with their frozen
  storm splits — 18/6/6 fidelity catalogue, whole-storm 7/3 hindcast split,
  stratified whole-storm structure holdout (`calibration/README.md`). Never
  move a storm across a split boundary; that is holdout leakage.
- `SHEAR_THRESHOLD_MS` / `SHEAR_K_KT_PER_H_PER_MS` in `src/sim.ts` are
  calibrated to env.bin's monthly-mean shear distribution — not literature
  instantaneous values; do not "correct" them toward ~10 m/s. Month-specific
  intensity failures are fixed data-side (bake year selection), never by
  tuning these constants; moving the env source to daily/hourly fields forces
  a from-scratch recalibration (see the `SHEAR_THRESHOLD_MS` comment in
  `src/sim.ts`).

## Dependencies

- Runtime dependency count is ZERO — `package.json` has no `dependencies`;
  dev is vite/typescript/vitest only. Adding a runtime npm dep is a design
  decision to raise explicitly, not a convenience. Even `@types/node` is
  avoided (see the scoped shim `test/node-fs.d.ts`).

## Product honesty

- Simulated products stay labeled simulated: "simulated rain radar",
  "simulated satellite infrared" (`src/weather-layers.ts`); simulated storm
  names are marked non-official. Never drop a label to clean up the UI.
- Observed satellite imagery keeps provider id + acquisition timestamp
  (`src/satellite-observations.ts`); requests are slot-floored so accelerated
  simulation cannot flood a provider.
- Ensemble output is perturbation frequency, NOT calibrated probability —
  HF-4's gate rejected the calibration claim (docs/model-card-hf6.md). Never
  rename it to "probability" or add %-chance framing in UI or docs.
- The masthead chip (`index.html` `#guidance-chip`) stays "interactive cyclone
  simulator · research prototype — not official guidance" — the product is a
  simulator and must not call itself a forecast product while no live forecast
  mode ships. The gated live-run status label in `src/live-product.ts` keeps
  "experimental forecast companion — not official guidance" for the day an
  issued live run actually renders. Neither disclaimer is ever dropped or
  truncated to clean up the UI.

## Pointers

- `BINARY-FORMATS.md` — .bin byte contract and golden vector.
- `docs/architecture.md` — module map.
- `ROADMAP.md` — phase history, frozen gate outcomes, forward plan.
- `docs/README.md` — docs index.
