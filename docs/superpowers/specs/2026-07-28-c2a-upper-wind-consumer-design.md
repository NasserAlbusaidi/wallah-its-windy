# C2a — Upper-wind runtime consumer — design

Date: 2026-07-28
Responds to: `docs/superpowers/specs/2026-07-27-layer-integrity-remediation-design.md`
§ C1 ("unlocks an honest upper-level outflow product") and the C1 plan's
deferral note ("no runtime consumer — C2-or-later work that this data
*unlocks*", `docs/superpowers/plans/2026-07-28-c1-upper-wind-sidecar.md`).

## Scope decision — C2 split in two

The layer-integrity spec's C2 (Emanuel PI + Tang–Emanuel ventilation) is a
versioned scientific phase: new frozen contract before any evaluation, a new
CDS acquisition for near-full-column T/q (which C1 does **not** provide),
development-partition storms only, a newly sealed cohort, a new gate runner
(ROADMAP.md "Later" item: any revised intensity candidate starts as a new
versioned phase). That is weeks and partly acquisition-gated.

The runtime consumer of `upper.bin` is product-lane work: days, zero sealed
gate impact, shippable independently. Bundling them couples a shippable
product to a science lane — the exact pattern the operating manual counters.

**This spec covers the consumer only (C2a).** The physics phase (C2b) gets its
own spec, starting from the acquisition predeclaration; nothing here
prejudges it. The only interface C2a leaves for C2b is a pure sampler module
a future gated profile MAY read — through its own phase protocol, never
implicitly.

## Product surface

**New weather layer `upper`** in `src/weather-layers.ts`:

- Label: **"200-hPa upper winds · ERA5 climatology sample"**. NOT "outflow":
  the storm's own outflow circulation is not modeled, and `upper.bin` carries
  the *environmental* 200-hPa flow of the sampled real year. Naming it
  outflow would claim a storm-scale product we do not have.
- `simulated: false` — it is real reanalysis data, classified like
  sst/humidity/ohc/shear.
- Legend: the existing wind-speed ramp labels; unit line names the level and
  source ("m/s · 200 hPa · ERA5").

**Rail order / keyboard.** The catalogue order is load-bearing (rail order ==
Digit1..Digit9 mapping, `weather-layers.ts:4-6`, `main.ts:2089`). `upper`
slots after `shear` (the two environmental wind fields sit together) taking
Digit9; `terrain` keeps its deliberate rail-closing position and moves to
Digit0. Accepted trade-off (user-approved): terrain's shortcut changes; the
alternative — appending `upper` after terrain — would break the "terrain
closes the list as the plain base chart" convention instead. Every hint
string that advertises the Digit mapping is updated with the reorder.

**Probe.** `PointProbeReading` (`src/point-probe.ts`) gains optional
upper-wind fields (speed m/s + direction) rendered as extra probe rows only
when an upper sample is available in the current mode. Display-time read;
nothing enters recorded output.

## Rendering

Reuse the trail-particle technique of `render/wind.ts` (offscreen fade
target, additive trails, wind-palette speed colouring) with two deliberate
differences:

1. **Advection field = `u200/v200` only — no Holland vortex superposition.**
   `render/wind.ts` superposes the analytic surface vortex on baked steering;
   doing that at 200 hPa would fabricate an upper-level storm circulation the
   model does not compute. The layer depicts environmental flow only, and its
   label says exactly that. (User-approved.)
2. **Speed-magnitude fill beneath the trails**, through the existing
   env-field fill pipeline (R8 texture pair + palette), which is also the
   `prefers-reduced-motion` rendering — the same pattern the surface wind
   layer uses today (motion gated, fill still communicates the field,
   `render/wind.ts:16-17`).

Colours come only from existing wind-palette tokens in `src/tokens.ts`; no
new literals in shaders or CSS (design-token rule). Whether the trails module
is a parameterization of `render/wind.ts` or a sibling `render/upper-wind.ts`
is an implementation choice for the plan — the constraint is no duplicated
palette/fade constants and no vortex import in the upper path.

## Architecture

**New module `src/upper-sampler.ts`** (~100 lines, pure) — the ONE place
`upper.bin` layer names resolve at runtime, mirroring the deliberate
env-sampler ↔ render/index name-resolution pairing:

```ts
export interface UpperWindSample {
  uMs: number;
  vMs: number;
  speedMs: number;
  dirDeg: number; // meteorological convention, documented in the module
}
export function sampleUpperWind(
  bin: ParsedBin,
  lat: number,
  lon: number,
  monthIndex: number,
  plane: number,
): UpperWindSample | null;
```

- Month resolution IMPORTS `envMonthSuffix` (exported,
  `env-sampler.ts:41`) — importing is not editing, and it prevents a third
  copy of the 04..10 clamp from drifting. `upper.bin` has no event variant
  and no un-suffixed courtesy names.
- Returns `null` when either `u200_MM`/`v200_MM` layer is absent. **Null
  means "unavailable" in every consumer — never an analytic substitute.**
  There is no fake upper climatology; this is the honesty line, and it is
  the designed-in answer to the CLAUDE.md silent-fallback trap (the fallback
  cannot be silent because no fallback exists).
- All outputs finite-guarded (same rule as the sim's guards: non-finite is a
  bug, fail loud).

**Wiring (`main.ts`).**

- `upper.bin` joins `CORE_ASSETS` next to the `env.bin` entry
  (`main.ts:650`): kind `bin`, key `upper`, small weight. 404 or parse
  failure → null; boot proceeds — a missing sidecar must not brick the demo,
  matching the env.bin failure philosophy.
- `RenderResources` (`render/index.ts:93-102`) gains
  `upper: ParsedBin | null`; the facade builds the fill texture pair and an
  `upperAt` closure (shape of the existing `steeringAt`) from it.
- The probe input assembly passes an optional `UpperWindSample` from the
  sampler at the probed point.

**Files that must NOT change:** `src/sim.ts` and `src/upper-ocean.ts` (the
two runtime sources HF-4/HF-6 hash — `calibration/hf4-verify.mjs:23,26`,
`hf6-verify.mjs:17,19`), `src/env-sampler.ts` (frozen runners ssrLoad it;
the sim-facing `EnvSample` seam stays closed), `src/loader.ts` (upper.bin is
standard WIWB; the existing parser already reads it — integration tests
prove this today), `bake/**`, and every file under `public/data/`
(C2a ships no data change; `assets:check` diff must be empty).

## Determinism and plane coherence

**Plane coherence is the load-bearing invariant.** The upper layer and probe
read the **same synoptic plane index** the env sampler is running on
(`seed % K`, set by main before spawn as sampling-mode state). Plane k =
same picked real year in both files is what C1's alignment gate bought;
re-deriving a plane anywhere in the consumer would silently mix vintages
between the shear driving the sim and the upper flow on screen. The plane
index flows from the single existing selection point in `main.ts` to the
renderer and the probe; a test pins that the value handed to
`sampleUpperWind` equals the env sampler's active synoptic plane. (The plane
*count* equality `u200_MM.nt == u_MM.nt` is already pinned by
`test/integration-bins.test.ts`.)

Everything is display-time sampling of committed bytes: no wall clock, no
RNG beyond the existing decorative particle seeds, no new recorded output,
no URL-hash change. Shared URLs replay byte-identical before and after C2a.

## Modes and degraded states

| State | Layer | Probe rows | Identity bar |
|---|---|---|---|
| Climatology, upper.bin loaded | on, plane-coherent | shown | — |
| Event-timeline mode | disabled, caption "no aligned upper-level analysis for this event" | hidden | — (by-design absence, not degradation) |
| upper.bin missing / unparseable | disabled, caption "upper-wind data unavailable" | hidden | `degradedInputs` gains "upper winds: unavailable" |

The identity-bar entry uses the existing `degradedInputs` mechanism
(`src/product-identity.ts:109-112`, the A-workstream pattern). Event mode is
deliberately NOT a degraded input: event bins never carried upper data, so
its absence there is contract, not failure.

## Error handling

- Fetch/parse failure of `upper.bin`: logged through the existing asset-load
  error path, resolves to null, UI degrades per the table above. Never
  throws past boot.
- Missing individual layer inside a present bin (e.g. a truncated future
  rebake): `sampleUpperWind` returns null → same degraded UI as a missing
  file, plus the integration tests fail on the committed artifact.
- Non-finite sampled values: loud throw (bug, not condition), consistent
  with sim guards.

## Testing (written first)

- `test/upper-sampler.test.ts`: month-suffix clamp behaviour (03→04, 11→10),
  plane selection, bilinear correctness against a synthetic two-plane bin,
  null on missing layer, dirDeg/speed math, finite guards.
- Plane-coherence pin: for a fixed seed in climatology mode, the plane index
  reaching `sampleUpperWind` equals the env sampler's active synoptic plane.
- `point-probe` tests: reading carries upper fields when supplied, omits
  them when absent; existing assertions untouched.
- Catalogue tests: `upper` present with the exact honest label,
  `simulated: false`, rail order shear→upper→terrain; keyboard-hint strings
  match the new Digit mapping.
- Integration: a real-bytes smoke test — `sampleUpperWind` over the
  committed `public/data/upper.bin` returns finite values inside the domain
  for every season month (extends the existing upper.bin describe block's
  role as the month-suffixed-layer trap coverage).
- Full gate set green and untouched: `npm test`, `npm run build`,
  `calibrate:check`, `assets:check` (no data diff), `hf6:verify:check`,
  `hf6:gate:check`, `hf6:prospective:check`, `data:hf6:catalog:check`.

## Non-goals

- No physics consumption — the sim never reads upper winds in C2a; C2b does
  so only through its own frozen-contract phase.
- No derived products: no 850-hPa reconstruction, no second shear pair, no
  ventilation-flavoured quantities.
- No "outflow" claims anywhere in UI copy or docs.
- No event-mode upper data and no per-event upper sidecar.
- No runtime fetch of `upper.json` — bin headers self-describe; the JSON
  remains a bake/CI alignment artifact.
- No changes to `env.bin`, the bake pipeline, or any sealed artefact.

## Product-honesty commitments

The layer is labeled as ERA5 climatology sample data at 200 hPa; it never
implies a modeled storm outflow. Degraded states are visible, never silent.
Ensemble/probability language is unaffected. All existing labels stay
intact.
