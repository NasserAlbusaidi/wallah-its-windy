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
closes the list as the plain base chart" convention instead.

**Gate correction — "update the hint strings" was not executable.** The
mechanics, verified against code, are:

- The dispatch at `main.ts:2437` is `/^Digit[1-9]$/` with `index = digit − 1`
  — Digit0 can never fire. It becomes `/^Digit[0-9]$/` with
  `index = (digit + 9) % 10` (Digit1→0 … Digit9→8, Digit0→9).
- The rail badge at `main.ts:2107` is `String(index + 1)` — the 10th button
  would read "10", a key that does not exist. It becomes
  `String((index + 1) % 10)` so the terrain badge reads "0".
- Both edits move into a pure exported helper pair in `weather-layers.ts`
  (next to the catalogue whose order they mirror), e.g.
  `layerIndexForDigitCode(code: string): number | null` and
  `digitHintForLayerIndex(index: number): string`, consumed by `main.ts` —
  the mapping is currently inline in the untested composition root, which is
  why a broken Digit0 would ship green. Tests pin Digit9→`upper`,
  Digit0→`terrain`, hint(9)→"0".
- Three user-visible surfaces advertise "keys 1–9" and are off the obvious
  file map (gate round-3 correction — the earlier sweep found two):
  `index.html:264` (`<span>keys 1–9</span>`), `index.html:683` ("Keys 1–9
  switch layers."), and `README.md:98-100`, which carries BOTH the stale key
  hint ("or press 1–9") and a prose enumeration of the nine layers that
  must gain `upper`. All three update to name the 0 key. The comments at
  `index.html:143`, `main.ts:2089` ("Digit1..Digit9 key hint"), and
  `main.ts:2112` ("Digit1-9 shortcuts") mirror the same claim and update
  with them.

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

**Gate correction (round 2) — the storm-spiral vortex swarm must be
excluded from the upper draw path.** The composed draw at
`render/index.ts:321-329` routes `wind` to its own trails and then draws
`this.particles.draw(ctx)` — the 8k-particle **Holland-vortex storm
spiral** — for every other layer except `infrared`/observed-radar/reduced.
A new `upper` layer satisfies that `else if` unmodified, so the fabricated
upper-level storm circulation this spec forbids would render on top of the
upper fill, past `tsc` and past the finiteness smoke test. The spec's "no
vortex import in the new module" constraint does not cover this shared
branch. Required: `render/index.ts`'s draw composition joins the touched
set; `upper` routes like `wind` to its own trails-only draw and is excluded
from the storm-spiral branch. If the trails ship as a sibling module, it
threads the same lifecycle points the wind layer uses (init / resize /
dispose / budget) **and** the trail-clear on layer switch
(`render/index.ts:384`) so stale upper trails cannot persist across a
toggle.

**Gate correction — the fill is NOT a free ride on the existing pipeline.**
Adding `'upper'` to `WeatherLayerId` reaches three exhaustive
`Record<WeatherLayerId, …>` surfaces — `LAYER_ICONS` (`main.ts:1557`) and
`MODE` / `PALETTE` (`render/env.ts:410,428`) — where `tsc` fails loud, plus
the catalogue itself, which is a plain `readonly WeatherLayerDefinition[]`
(`weather-layers.ts:77`): a missing `upper` entry **compiles clean** and is
caught only by the catalogue tests. Two further constraints are not
type-checkable and must be stated:

- `MODE['upper']` needs a **new** `u_mode` branch in the env fragment shader
  (`render/env.ts:547` selects by mode number) that samples newly-bound
  u200/v200 textures and colours by speed magnitude. Assigning an existing
  mode number to satisfy `tsc` would silently render the wrong field — the
  planned integration smoke checks finiteness, not identity, so only the
  shader-branch requirement here prevents it.
- The legend gradient bar is styled per layer id
  (`#weather-legend[data-layer='<id>'] .weather-scale`,
  `src/style.css:717-787`); without a new `upper` rule the base
  `.weather-scale` fallback (`style.css:710`) renders an SST-style ramp
  under the "m/s · 200 hPa" label. `style.css` therefore joins the touched
  files, with the gradient derived from the `--wind-*` token variables only.

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
  mode: EnvSamplingMode,
): UpperWindSample | null;
```

**Gate correction — the signature takes the sampling MODE, not a bare
plane.** A `plane: number` parameter invites a caller passing `plane: 0` in
event mode, silently rendering plane-0 climatology upper winds under an
event storm — exactly the cross-vintage mix the plane-coherence section
forbids. Taking `EnvSamplingMode` (`types.ts:148-150`) makes that
inexpressible: the sampler returns `null` unless
`mode.kind === 'synoptic-plane'`, and reads the plane from the mode object.
Callers obtain the mode only from `envSampler.getSamplingMode()` — the
accessor `main.ts` already threads to the probe and renderer (`main.ts:433,
1478, 2234`) — never by constructing one.

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

- `upper.bin` joins the `MANIFEST` load list next to the `env.bin` entry
  (`main.ts:648-650` — gate correction: the array is named `MANIFEST`, not
  `CORE_ASSETS`): kind `bin`, key `upper`, small weight. 404 or parse
  failure → null; boot proceeds — a missing sidecar must not brick the demo,
  matching the env.bin failure philosophy.
- `RenderResources` (`render/index.ts:93-102`) gains
  `upper: ParsedBin | null`; the facade builds the fill texture pair and an
  `upperAt` closure (shape of the existing `steeringAt`) from it.
  **Gate correction (round 2):** `main.ts` keeps its own structural mirror
  of that type — `RenderResourcesLike` (`main.ts:2886`) and the
  `emptyResources` literal (`main.ts:505`) — both gain `upper` in lockstep,
  and all **three** `setResources` call sites are edited deliberately:
  boot/climatology (`main.ts:820`) and return-to-climatology
  (`main.ts:1266`) pass the loaded bin; the event site (`main.ts:1228`)
  passes `upper: null` (see Modes below).
- The probe input (`PointProbeInput`) gains
  `upper?: UpperWindSample | null`; the reading gains
  `upperSpeedMs: number | null` and `upperDirDeg: number | null`
  (null = rows hidden). **Gate correction (round 2):** the rows render
  through `ui.ts` `showPointProbe` (`ui.ts:553`) into the probe `<dl>` in
  `index.html` (the `point-probe-*` nodes near `index.html:50-54`) — both
  join the touched-file set; naming `point-probe.ts` alone under-specified
  the render path. **Gate correction (round 3):** `showPointProbe` positions
  the card with a hardcoded `cardHeight = 104` (`ui.ts:558`) used in the
  bottom-edge clamp. The upper rows appear on every climatology probe (not
  only when the upper layer is active), so the card grows and the constant
  must grow or be derived with it — otherwise the new rows clip at the
  viewport bottom.

**Files that must NOT change** (gate correction — the hashed set is ten
files, not two): the sealed verifiers hash `ensemble.ts`,
`ensemble-verification.ts`, `sim.ts`, `rng.ts`, `steering.ts`,
`upper-ocean.ts`, `ventilation.ts` (`calibration/hf4-verify.mjs:21-27`) and
`sim.ts`, `steering.ts`, `upper-ocean.ts`, `ventilation.ts`,
`structure.ts`, `coastal-exposure.ts`, `hindcast-benchmark.ts`
(`hf6-verify.mjs:17-23`) — the union of ten `src/` files is off-limits;
`hf6:verify:check` is the backstop that catches an accidental edit. Also
unchanged: `src/env-sampler.ts` (frozen runners ssrLoad it; the sim-facing
`EnvSample` seam stays closed — importing its exports is fine, editing is
not), `src/loader.ts` (upper.bin is standard WIWB; the existing parser
already reads it — integration tests prove this today), `bake/**`, and
every file under `public/data/` (C2a ships no data change; `assets:check`
diff must be empty).

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

**Gate correction (round 2) — "disabled in event mode" must be wired, not
stated.** Nothing today disables a layer per-mode, and `applyEventEnv`
(`main.ts:1206-1233`) neither touches `activeWeatherLayer` nor passes new
resources beyond `terrain/env/genesis/tracks` — so without explicit wiring
the upper fill would keep drawing climatology winds under an event storm.
The executable contract:

- The event `setResources` site (`main.ts:1228`) passes `upper: null`; the
  climatology sites (`main.ts:820, 1266`) pass the loaded bin. The facade
  therefore has nothing to draw in event mode even if asked.
- `applyEventEnv` force-switches `activeWeatherLayer` off `upper` (to
  `DEFAULT_WEATHER_LAYER`) when it is active, and the upper rail button is
  disabled with the caption while a scenario is active; returning to
  climatology re-enables it.
- Both layers of defense exist on purpose: the resource null makes the
  wrong render impossible, the layer switch makes the UI state honest.

The identity-bar entry uses the existing `degradedInputs` mechanism
(`src/product-identity.ts:109-112`, the A-workstream pattern). Event mode is
deliberately NOT a degraded input: event bins never carried upper data, so
its absence there is contract, not failure.

The render facade's degraded self-sourcing path (mode B) either adds
`upper.bin` to its own fetch list or leaves `upper` unavailable there; the
plan picks one explicitly — what is not acceptable is mode B reaching a
different plane or vintage than mode A would. Unavailable-under-mode-B is
already covered by the degraded table.

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
  null on missing layer, **null on `event-timeline` mode** (the
  vintage-mixing guard), dirDeg/speed math, finite guards.
- Plane-coherence pin: for a fixed seed in climatology mode, the mode object
  reaching `sampleUpperWind` is the env sampler's active sampling mode (same
  accessor, same plane).
- Digit-mapping tests on the new pure helpers: Digit9 → `upper` index,
  Digit0 → `terrain` index, non-digit codes → null, hint(index 9) → "0",
  hints for indices 0–8 unchanged.
- `point-probe` tests: reading carries `upperSpeedMs`/`upperDirDeg` when an
  `upper` sample is supplied, nulls when absent; existing assertions
  untouched. The DOM row rendering in `ui.ts` has no unit-test seam (no
  `ui.test.ts` exists) — it is covered by the rendered QA pass, stated
  honestly rather than implied tested.
- Event-mode wiring tests: entering a scenario with `upper` active
  force-switches the layer; the event `setResources` payload carries
  `upper: null`. (Whatever seam the existing scenario tests use; at minimum
  the pure state transition is pinned.)
- Catalogue tests: `upper` present with the exact honest label,
  `simulated: false`, rail order shear→upper→terrain. The deliberate update
  in `test/weather-layers.test.ts` covers every nine-flavoured detail, not
  just the length assertion: the `toHaveLength(9)` and Set-size `toBe(9)`
  (`:11-12`), and the description strings "ships nine unique operational
  views" (`:10`) and "keys 1-9 stay in catalogue order" (`:26`) — a partial
  edit leaving `toBe(9)` beside `toHaveLength(10)`, or a title that lies
  about the count, is the failure mode being named.
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
