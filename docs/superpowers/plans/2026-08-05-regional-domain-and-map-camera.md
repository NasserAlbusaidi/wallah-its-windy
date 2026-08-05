# Regional Domain and Map Camera Implementation Plan

> **Status:** PLAN_DRAFT — implementation has not started and this document is
> not a gated specification. Before execution, a reviewer must verify the source
> coverage gate, target grid dimensions, runtime asset budget, and acceptance
> thresholds against a fresh baseline.

**Goal:** Let Arabian Sea storms enter the sandbox earlier and develop over a
larger ocean runway, while adding a smooth, accessible map camera that can move
between a full-basin view, the existing Oman view, West India, and storm follow.

**Recommended product decision:** Build toward a versioned regional world of
`50–80°E, 8–28°N`. Start the app in the full-basin view so genesis and early
development are visible; preserve the current `50–70°E, 15–27°N` composition as
the `Oman focus` preset. West India justifies the 80°E edge. It is not a claim
that the simulator covers the full North Indian Ocean or Bay of Bengal.

**Architecture:** Separate the visible world, the physics-data halo, and the
presentation camera. `WORLD_DOMAIN` owns the product viewport, storm-center
lifecycle, hydrology display, and earth-fixed runtime fields. `FORCING_DOMAIN`
extends beyond it far enough for every off-center physics sample (currently up
to 420 km) plus raster interpolation support. `SAFE_SIM_DOMAIN` is the
intersection of `WORLD_DOMAIN` and the safely sampleable interior of
`FORCING_DOMAIN`; V2 must make it equal the whole visible world. A pure
`ViewTransform` maps geographic coordinates and world UVs into visible
clip-space. Camera movement must never alter simulation state, recorder output,
scenario hashes, or termination. V1 remains supported and byte-stable while V2
data is baked and published under versioned paths.

**Tech stack:** TypeScript, WebGL2, DOM pointer/wheel/keyboard events, Vitest,
Playwright browser QA, Python bake scripts, existing WIWB binary format and
calibration gates.

---

## 1. Scope decision and evidence

### Proposed domain contract

| Product world | Visible bounds | Visible area | Approx. visible terrain samples | Visible environment cells | Impact grid | Arabian Sea literal starts inside world bbox | RainViewer zoom-5 tiles/frame |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current V1 | 50–70°E, 15–27°N | 240 deg² | 1040×668 | 40×24 | 200×120 | 13/59 | 6 |
| Lean alternative | 50–75°E, 8–27°N | 475 deg² | about 1328×1056 | 50×38 | 250×190 | 52/59 (88.1%) | 9 |
| **Recommended V2** | **50–80°E, 8–28°N** | **600 deg²** | **candidate 1584×1112** | **60×40** | **300×200** | **55/59 (93.2%)** | **12** |

Those terrain/environment dimensions describe the visible subwindow, not the
full physics raster. Off-center samplers reach farther than the displayed map:

| Physics-data contract | Forcing bounds | 0.5° environment grid | Edge behavior |
|---|---:|---:|---|
| Current V1 | 50–70°E, 15–27°N | 40×24 | legacy clamping retained only for V1 replay identity |
| **V2 candidate** | **45–85°E, 3.5–32.5°N** | **80×58** | 420 km maximum footprint + interpolation margin; clamping forbidden |

The V2 forcing halo is 1,160 deg²—about 4.83× the current raster area—even
though the visible world is only 2.5× larger. A shared near-2-km forcing
terrain would be roughly 2,100×1,600 cells. These remain candidates: Task 0
records the actual memory/timing, and Task 6 verifies source coverage, cell
alignment, maximum sample footprints, and final dimensions before sealing the
contract. Do not silently shrink the halo or grids during a bake.

The start counts above measure world-bbox coverage, not safe-water spawn
eligibility; Task 9 publishes the latter separately after the forcing halo and
landmask are available. The pinned IBTrACS inventory currently contains 71
Oman-affecting systems:
59 originate in the Arabian Sea and 12 originate in the Bay of Bengal before
crossing India. V2 captures 55/59 literal Arabian Sea start points (49 already
over water), but 0/12 Bay origins. For the 16 V2 cases that later make landfall,
the literal-start-to-landfall runway is approximately 102 h / 1,262 km at the
median, with an interquartile range of 75–138 h / 1,093–1,944 km. These are
coverage diagnostics, not a promise that the current physics will generate or
survive for those durations.

### Explicit non-goals

- No Bay of Bengal genesis or full India-crossing simulation in this project.
- No physics coefficient, intensity, steering, land-decay, or genesis-probability
  tuning merely to make long-lived storms appear.
- No Web Mercator/global slippy map, arbitrary rotation, or unbounded zoom.
- No camera state in deterministic simulation inputs, flight-recorder frames,
  calibration hashes, or scenario identity.
- No deletion or overwrite of V1 assets or calibration references during the
  first V2 release.
- No claim that a wider map by itself makes the model meteorologically better.

### Hard acquisition stop

`bake/hydrosheds.py` currently downloads only `hyd_eu_*` HydroSHEDS archives and
documents coverage specifically for 50–70°E / 15–27°N. The India extension may
cross a HydroSHEDS regional archive boundary. Task 6 must identify the official
ACC and DIR archives, prove complete coverage across the full forcing halo,
mosaic them without a routing seam, and record license/provenance. **If ACC/DIR
coverage or seam continuity cannot be established, stop before baking or
switching to V2.** Do not fill the gap with synthetic drainage while labeling
it HydroSHEDS.

---

## 2. Binding invariants

1. **Camera is presentation-only.** Given the same domain version, scenario,
   seed, input actions, and tick count, flight tapes and state hashes are
   identical at every camera pose.
2. **V1 identity lands first.** With the V1 world and identity camera, the
   refactor must reproduce the current scene, point probes, spawn location,
   replay, comparison, and export before V2 data work begins.
3. **Physical distances have one owner.** Replace every render-side
   `HALF_DOMAIN_HEIGHT_KM = 666` copy with shared geographic/world/view
   conversions. Storm RMW, outer radius, wind arrows, rain support, radar range,
   cloud motion, cloud memory, and particles remain defined in physical units.
4. **World textures are earth-fixed.** Camera movement changes sampling and
   projection only. It cannot advect or reset cloud memory, rain accumulation,
   terrain, environment, radar, satellite imagery, or historical tracks.
   Domain-sized runtime fields must preserve their V1 physical texel density;
   keeping a 512² cloud-memory field over a 2.5× larger world is not acceptable.
5. **No hidden V2 edge clamping for active storms.** Derive
   `SAFE_SIM_DOMAIN` by insetting `FORCING_DOMAIN` by the audited maximum
   off-center physics footprint (currently 420 km), converted conservatively at
   each edge, plus half a cell of every sampled raster; then intersect it with
   `WORLD_DOMAIN`. V2 must prove that this result contains the whole visible
   world. A storm leaving it gets an explicit deterministic `out-of-domain`
   reason before sampling. V1's existing clamp behavior is grandfathered only
   for replay/output identity and is never described as the V2 safety model.
6. **Assets fail closed by version.** Core assets must agree on domain ID,
   bounds, dimensions, format version, and hash. Missing or mixed core assets
   block simulation with a useful message. Optional observations may degrade
   honestly.
7. **V1 stays rollback-ready.** V2 assets use new paths; existing V1 files and
   references are not resealed. The app supports a one-release manifest switch
   back to V1.
8. **No redraw of frozen cohorts.** Existing V1 calibration, hindcast,
   fidelity, HF, and realism samples remain fixed. V2 adds explicitly named
   cohorts and references.
9. **Deterministic camera behavior.** No wall-clock value reaches simulation or
   exports. Animation uses the UI clock only; reduced-motion mode applies the
   final camera pose immediately.
10. **CPU/GLSL parity is pinned.** Before coordinate scale changes, add
    mechanical tests for constants and formulas duplicated between CPU helpers
    and inline GLSL, including the recently added IR morphology math.
11. **Camera motion is data-free.** Ordinary pan, zoom, follow, and preset
    changes cause no network refetch, texture re-upload, bake selection, or
    simulation restart.

---

## 3. Target contracts

### Machine-readable world definition

Create `config/world-domains.json` as the only hand-edited domain registry.
Both TypeScript and Python consume it (`resolveJsonModule` is already enabled).
The target shape below omits the required `runtimeFields` numeric block until
Task 0 supplies its V1 rain measurements:

~~~json
{
  "schemaVersion": 1,
  "domains": {
    "arabian-sea-v1": {
      "worldBBox": { "lonMin": 50, "lonMax": 70, "latMin": 15, "latMax": 27 },
      "forcingBBox": { "lonMin": 50, "lonMax": 70, "latMin": 15, "latMax": 27 },
      "maximumPhysicsSampleRadiusKm": 420,
      "edgePolicy": "legacy-clamp-v1",
      "terrain": { "nx": 1040, "ny": 668 },
      "environment": { "nx": 40, "ny": 24 },
      "impact": { "nx": 200, "ny": 120 },
      "assetBase": "data/"
    },
    "arabian-sea-west-india-v2": {
      "worldBBox": { "lonMin": 50, "lonMax": 80, "latMin": 8, "latMax": 28 },
      "forcingBBox": { "lonMin": 45, "lonMax": 85, "latMin": 3.5, "latMax": 32.5 },
      "maximumPhysicsSampleRadiusKm": 420,
      "edgePolicy": "forbid-clamp",
      "terrain": { "nx": 2112, "ny": 1612 },
      "environment": { "nx": 80, "ny": 58 },
      "impact": { "nx": 300, "ny": 200 },
      "assetBase": "data/domains/arabian-sea-west-india-v2/"
    }
  }
}
~~~

Task 1 lands this registry with the V1 entry only. The V2 block above shows the
target shape; Task 6 adds it only after the source and resource gates pass. The
final V2 terrain dimensions replace the candidates only through that reviewed
edit. `maximumPhysicsSampleRadiusKm` is not a tuning knob: tests derive every
off-center sampler's maximum (coastal exposure 420 km today) and fail if code
exceeds the registry. V2 contract validation also fails unless the inset
forcing bbox safely contains the entire world bbox.

### Runtime types

`src/domain.ts` owns:

~~~ts
export type DomainVersion = keyof typeof domainRegistry.domains;

export interface WorldDomain {
  id: DomainVersion;
  worldBBox: BBox;
  forcingBBox: BBox;
  safeSimBBox: BBox;
  maximumPhysicsSampleRadiusKm: number;
  edgePolicy: 'legacy-clamp-v1' | 'forbid-clamp';
  terrain: GridSpec;
  environment: GridSpec;
  impact: GridSpec;
  runtimeFields: {
    cloudMemory: { detail: GridSize; compact: GridSize };
    routedRain: { detail: GridSize; compact: GridSize };
  };
  assetBase: string;
}
~~~

`src/view-transform.ts` owns pure, inverse-tested transforms:

~~~ts
export interface ViewState {
  center: LatLon;
  zoom: number;       // 1 fits the active world; initially clamped to [1, 4]
}

export interface VisibleWorldRect {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export function latLonToWorldUv(...): WorldUv;
export function worldUvToLatLon(...): LatLon;
export function latLonToForcingUv(...): WorldUv;
export function visibleWorldRect(...): VisibleWorldRect;
export function latLonToViewClip(...): ClipCoord;
export function viewClipToLatLon(...): LatLon;
export function clampViewState(...): ViewState;
export function kmToViewClip(...): ClipCoord;
~~~

The first implementation preserves the existing affine full-canvas projection:
at zoom 1, world-bbox edges map exactly to clip-space edges. That is required
for the V1 pixel-identity gate. Physical overlays still use latitude-aware
distance conversion, so radii cannot assume a square degree. Cartographic
aspect correction or letterboxing is a separate product change, not smuggled
into this migration.

### Runtime asset manifest

Generate one small manifest per domain under
`public/data/domain-manifests/<domain-id>.json`. It includes:

- schema and domain version;
- exact world and forcing bounds plus every grid's dimensions;
- each core asset's relative URL, byte size, SHA-256, WIWB format version, and
  layer names;
- optional/lazy asset groups;
- source provenance record IDs;
- a compatibility version for code/assets.

The V1 manifest points at today's root `public/data/*` files so the migration
does not duplicate them. V2 assets live in their versioned directory. Task 1
creates/seals the V1 manifest and an initial `public/data/active-domain.json`
that selects it; Task 7 adds the V2 manifest without changing that selector.
PR E changes only the selector after V2 is published and accepted. Asset URLs
carry the selected manifest hash as a query so deploy/CDN caches cannot mix
releases.

### Domain-sized runtime fields

The actual registry also requires numeric detail/compact grids for cloud memory
and routed rain; they are omitted from the illustrative JSON until Task 0
measures today's rain targets. V1 cloud memory is 512×512 on detail and 256×256
on compact. A V2 starting estimate that preserves roughly the same degrees per
texel is about 768×850 and 384×425 respectively. Routed rain starts from the
Task 0 V1 half-canvas dimensions for each sealed reference profile and scales
by world span to preserve physical texel density. Tasks 0 and 6 seal the exact
rectangular dimensions and GPU budget before V2 baking.

Both fields are allocated once per domain/profile session. Canvas resize only
resizes composite targets; it never reallocates or clears earth-fixed state.
The backtrace bound, advection/routing step, and morphology/hydrology checks are
recomputed in physical units. If the sealed dimensions do not fit the measured
budget, stop for a tiled-world design—do not quietly stretch smaller textures
over the larger world. Impact accumulation uses the explicit domain grid
(candidate 300×200 for V2).

### Camera presets and behavior

- **Full basin:** zoom 1, centered on the active world; the V2 startup view.
- **Oman focus:** the current 50–70°E / 15–27°N composition.
- **West India:** candidate 62–80°E / 9–26°N, covering the Gujarat–Konkan–Kerala
  coast plus offshore approach without implying Bay of Bengal coverage; Task 0
  browser QA may adjust the camera pose, not the V2 world bounds.
- **Follow storm:** dead-zone tracking; manual pan/zoom suspends follow until
  explicitly resumed.
- Desktop zoom range: 1×–4×. Compact may be capped at 3× if Task 0 proves the
  fourth level unreadable or too expensive.
- Wheel and pinch zoom are pointer/centroid anchored. Drag pans. `Home` returns
  to Full basin; keyboard `+`/`-` zooms; arrow keys pan.
- A drag or pinch cancels click-to-spawn. A click remains a click only below
  the existing gesture distance/time threshold.
- On storm death, keep the final camera pose. Do not snap home.
- Comparison mode fits both storms/tracks with padding and then remains stable.
- Debrief card and replay exports use a canonical full-world camera by default,
  independent of the interactive view. “Export current view” is a later,
  explicitly labeled feature.

---

## 4. Delivery sequence

Dependent coordinate/data tasks are intentionally sequential. Browser QA and
independent review can run in parallel only after the relevant implementation
head is fixed.

### Task 0 — Seal the V1 baseline and budgets

**Files**

- Create: `calibration/domain-expansion/README.md`
- Create: `calibration/domain-expansion/v1-baseline.json`
- Create: `test/domain-baseline.test.ts`
- Create: `playwright.config.ts`
- Create: `test/browser/domain-baseline.spec.ts`
- Create: deterministic baseline captures under
  `calibration/domain-expansion/v1-screenshots/`
- Modify: `package.json` and `package-lock.json`
- Modify: `docs/README.md`

- [ ] Add pinned `@playwright/test`, desktop/compact Chromium projects, a Vite
  web-server fixture, and `npm run test:browser:domain`. Browser/version/GPU
  metadata must be written beside captures; pixel diffs run only against the
  matching environment, not as a cross-GPU CI golden.
- [ ] Document and run `npx playwright install chromium` on a clean developer
  machine before the baseline. If non-pixel browser checks enter Linux CI, its
  setup step uses `npx playwright install --with-deps chromium`; `npm install`
  alone is not treated as a browser installation.
- [ ] Record git SHA, browser/OS/GPU, desktop and compact viewports, device
  pixel ratio, render detail tier, and committed asset-manifest hash.
- [ ] Capture deterministic V1 screenshots for terrain, simulated IR, radar,
  rain, wind/particles, replay, and comparison at fixed scenario/frame inputs.
- [ ] Record byte sizes for core, event, observation, and total static assets.
  Current top-level public data is about 26.43 MiB. Display-area scaling alone
  gives a 66.1 MiB floor, while terrain/environment/hydrology that cover the
  4.83× forcing halo can be larger. Measure by asset class instead of accepting
  either extrapolation as a boot transfer.
- [ ] Measure 300-frame p50/p95/max main-thread frame work, long tasks, JS heap
  where exposed, GPU texture allocation estimate, boot transfer, and
  input-to-paint latency at desktop and compact viewports.
- [ ] Record the exact canvas, cloud-memory, and half-resolution routed-rain
  target dimensions for the sealed desktop/compact profiles; these become the
  V1 runtime-field contract and the density basis for V2.
- [ ] Record deterministic flight-tape/scenario hashes for at least one free
  spawn and one historical replay.
- [ ] Pin the current click-to-lat/lon examples and point-probe values at the
  four canvas corners, center, and two coastal points.
- [ ] Add a CPU/GLSL contract audit for render formulas duplicated as literals,
  including IR morphology and all 666-km scale references.

Run:

~~~powershell
npx playwright install chromium
npm test
npm run build
npm run assets:check
npm run calibrate:check
npm run realism:check
npm run test:browser:domain -- --project=chromium-desktop
npm run test:browser:domain -- --project=chromium-compact
~~~

Expected: all existing gates pass; baseline artifacts contain measurements,
not hand-authored targets. Any failure stops Task 1.

Commit: `test: seal regional expansion v1 baseline`

### Task 1 — Externalize the V1 domain contract without changing output

**Files**

- Create: `config/world-domains.json`
- Create: `src/domain.ts`
- Create: `src/physics-footprint.ts`
- Create: `bake/domain_config.py`
- Create: `calibration/domain-manifest.mjs`
- Create: `public/data/domain-manifests/arabian-sea-v1.json`
- Create: `public/data/active-domain.json` selecting V1
- Create: `test/domain-contract.test.ts`
- Create: `test/physics-footprint.test.ts`
- Modify: `package.json` with `domain:manifest` and `domain:manifest:check`
- Modify: `calibration/asset-manifest.mjs` and its tests to exclude only the
  mutable deployment pointer `active-domain.json`
- Modify: `src/grid.ts`
- Modify: `bake/sources.py`
- Modify: all bake scripts that copy bounds or grid dimensions
- Modify: `BINARY-FORMATS.md` and `bake/README.md`

- [ ] Add a strict parser that rejects unknown keys, invalid bounds,
  non-positive baked/runtime-field dimensions, duplicate IDs, and unsafe asset
  paths. Populate V1 routed-rain dimensions from Task 0, not guesses.
- [ ] Give each off-center physics sampler one named maximum reach and derive
  `MAX_PHYSICS_SAMPLE_RADIUS_KM` from them: coastal exposure (420 km today),
  environmental steering (375 km), ventilation (350 km), terrain drift
  (260 km), and dry-air land probes (190 km). Pin the registry value to that
  derived maximum.
- [ ] Derive V1 `WORLD_DOMAIN` and grid specs from the registry. Keep `DOMAIN`
  as a temporary deprecated alias only while callers migrate.
- [ ] Have Python read the same JSON and fail with the domain ID in every bake
  log and generated header/provenance record.
- [ ] Generate the V1 runtime manifest from the committed root assets, including
  domain/grid contracts, layer sets, sizes, and SHA-256 values. Seal the new
  manifest in the existing global asset manifest and validate the V1 selector
  separately; do not move or rewrite any V1 asset.
- [ ] Treat `active-domain.json` as a mutable deployment control, not an
  immutable data asset: exclude that exact path (not a broad prefix) from the
  global asset hash, and make `domain:manifest:check` validate its schema,
  allowed domain ID, referenced committed manifest, and manifest SHA-256.
- [ ] Inventory all inline copies of 50/70/15/27, 40×24, 1040×668, 200×120,
  and 666. Each is either migrated or documented as a fixture intentionally
  pinning V1.
- [ ] Re-run the V1 bake only in a disposable output directory and prove
  generated static files are byte-identical. Do not overwrite committed assets
  merely to run the comparison.
- [ ] Prove application output, baseline screenshots, recorder hashes, and
  calibration results are unchanged.

Run:

~~~powershell
npx vitest run test/domain-contract.test.ts test/physics-footprint.test.ts test/grid.test.ts test/domain-baseline.test.ts
npm run typecheck
npm run domain:manifest -- --domain=arabian-sea-v1 --active=arabian-sea-v1
npm run domain:manifest:check
npm run assets:manifest
npm run assets:check
npm run calibrate:check
npm run realism:check
~~~

Expected: zero V1 asset, state-hash, or screenshot drift.

Stop: if the shared JSON cannot reproduce existing Python and TypeScript
contracts exactly, resolve that mismatch before adding V2.

Commit: `refactor: centralize the v1 world-domain contract`

### Task 2 — Introduce physical scale and an identity world/view seam

**Files**

- Create: `src/geo-scale.ts`
- Create: `src/view-transform.ts`
- Create: `test/geo-scale.test.ts`
- Create: `test/view-transform.test.ts`
- Create: `test/domain-ownership.test.ts`
- Modify: `src/grid.ts`
- Modify: `src/env-sampler.ts`, `src/steering.ts`, `src/upper-ocean.ts`,
  `src/ensemble.ts`, `src/impact.ts`, `src/sim.ts`, and `src/tracks.ts`
- Modify: `src/radar-observations.ts` and `src/satellite-observations.ts`
- Modify: V1 measurement owners including `src/fidelity-verification.ts`
- Modify: `src/render/storm-radii.ts`
- Modify: `src/render/cloud-motion.ts`
- Modify: `src/render/cloud-memory.ts`
- Modify: `src/render/particles.ts`
- Modify: `src/render/rain.ts`
- Modify: `src/render/radar.ts`
- Modify: `src/render/wind.ts`
- Modify: `src/realism-field.ts`, `src/realism-metrics.ts`, and
  `src/realism-proxy.ts`
- Modify: any remaining render/test copy of `HALF_DOMAIN_HEIGHT_KM`

- [ ] Implement exact geographic ↔ world UV ↔ view clip inverses, camera
  containment, aspect fitting, visible world rectangles, and latitude-aware
  kilometre conversions.
- [ ] Pass `WorldDomain`/asset `GridSpec` explicitly into every physics sampler.
  Env, pressure-level steering, upper-ocean, terrain/elevation, and coastal
  probes clamp only to their forcing-grid bbox; storm/ensemble lifecycle uses
  the safe/world bbox; observations use the world bbox.
- [ ] Remove default bbox arguments from `inBBox`, `latLonToClip`, and
  `clipToLatLon`. The compiler must expose every ambiguous caller.
- [ ] Replace each 666-km copy with the new shared physical conversion.
  Shader snippets receive generated constants/uniforms from the same owner;
  tests compare CPU and GLSL formulas at multiple latitudes, radii, and zooms.
- [ ] Add `u_viewWorldRect` only to display/composite passes, plus an explicit
  world-to-forcing subrect transform for terrain/environment/upper/ocean
  display sampling. Both are exactly `[0, 1] × [0, 1]` for V1 identity; V2 must
  not stretch the hidden forcing halo into the visible map. Never route a view
  uniform into cloud-memory or routed-rain update shaders.
- [ ] Keep storm structure values in kilometres until the final projection.
  No caller stores camera-scaled RMW or outer radius in simulation state.
- [ ] Keep the V1 identity camera hard-wired. Do not expose controls yet.
- [ ] Prove zero changed pixels on the same browser/GPU for the deterministic
  V1 captures. If an unavoidable rasterization delta exists, stop for reviewer
  approval with the raw diff; do not silently loosen morphology thresholds.
- [ ] Prove recorder and scenario hashes are byte-identical.
- [ ] Add a staged ownership test that forbids global `DOMAIN` use in all
  physics, measurement, ensemble, observation, and data-sampling modules. Task
  4 removes the temporary presentation allowlist and the alias itself.

Run:

~~~powershell
npx vitest run test/geo-scale.test.ts test/view-transform.test.ts test/domain-ownership.test.ts test/cloud-motion.test.ts test/ir-morphology.test.ts
npm test
npm run build
npm run realism:check
~~~

Expected: identity transforms round-trip within 1e-12 in CPU tests; V1
recordings and deterministic captures remain unchanged.

Commit: `refactor: separate physical world scale from view clip space`

### Task 3 — Add the pure camera model on V1

**Files**

- Create: `src/camera.ts`
- Create: `test/camera.test.ts`
- Modify: `src/types.ts`
- Modify: `src/performance.ts`

- [ ] Implement immutable camera transitions for pointer-anchored zoom, pan,
  presets, follow dead-zone, fit-bounds, resize, and clamp.
- [ ] Keep camera state out of the sim engine, worker protocols, recorder
  frames, replay milestones, comparisons, and calibration inputs.
- [ ] Test pointer anchoring: the lat/lon under the pointer remains invariant
  before/after zoom to floating-point tolerance unless the world-edge clamp is
  active, in which case the result is the closest valid pose.
- [ ] Test clamps at all world edges, desktop/compact aspect ratios, zoom
  extrema, and resize.
- [ ] Test manual movement suspends follow; resume recenters only through the
  documented dead-zone behavior.
- [ ] Test reduced motion skips interpolation but lands at the same final pose.
- [ ] Add performance marks for camera input-to-paint without feeding their
  timestamps into product state.

Run:

~~~powershell
npx vitest run test/camera.test.ts test/view-transform.test.ts test/performance.test.ts
npm run typecheck
~~~

Expected: pure tests pass; runtime visuals are still identity-camera V1.

Commit: `feat: add a deterministic presentation-only map camera`

### Task 4 — Thread ViewTransform through rendering, overlays, and input

**Files**

- Modify: `src/render/index.ts`
- Modify: `src/render/context.ts`, `src/render/track.ts`,
  `src/render/ghosts.ts`, and `src/render/precipitating-cloud.ts`
- Modify: `src/render/terrain.ts`, `src/render/env.ts`,
  `src/render/satellite.ts`, `src/render/observed-radar.ts`,
  `src/render/radar.ts`, `src/render/rain.ts`, `src/render/wind.ts`,
  `src/render/particles.ts`, and `src/render/cloud-memory.ts`
- Modify: `src/main.ts`
- Modify: `src/ui.ts`
- Modify: `src/grid.ts` to remove the temporary global `DOMAIN` alias
- Modify: `src/tap-gesture.ts`
- Modify: `src/point-probe.ts`
- Modify: `src/tracks.ts` and ensemble overlay code
- Modify: `src/export.ts`
- Modify: `public/data/active-domain.json` to select V2 in the candidate commit
- Create: `test/camera-integration.test.ts`
- Extend: focused render, gesture, probe, track, ensemble, and export tests

- [ ] Pass one immutable `ViewState`/`ViewTransform` snapshot to every visual
  layer per frame. No layer recomputes its own camera math.
- [ ] Migrate every remaining presentation caller in `main`, `ui`, exports,
  render passes, tracks/ghosts, probes, and labels to explicit world/forcing
  contracts; tighten `test/domain-ownership.test.ts` to permit zero production
  imports of a global `DOMAIN`, then delete that alias.
- [ ] Resolve each screen sample to geographic/world UV first. Sample
  terrain/environment/upper/ocean through forcing UV, and satellite, observed
  radar, simulated IR, rain accumulation, and cloud memory through world UV;
  project to view clip last.
- [ ] Keep cloud-memory and routed-rain **update** passes on fixed full-world
  coordinates. They never receive `ViewState`/`u_viewWorldRect`; only their
  display/composite passes apply the camera transform.
- [ ] Split render context into world-update data (storm lat/lon/world UV,
  physical structure, sim delta) and display data (view transform/view clip).
  Update modules cannot type-access the latter. On V1, retain today's rain
  target dimensions and update math for the sealed profiles; only Task 9
  applies the separately sealed V2 world-field dimensions. `resize()` may
  resize composites but cannot dispose, reallocate, or clear world-state
  cloud/rain targets.
- [ ] Store wind particles in world UV and project at draw time. Reproject
  surviving particles and deterministically replenish only newly exposed view
  area so zoom retains screen density without a full-pool reset. The render PRNG
  and particle lifecycle remain isolated from simulation state.
- [ ] Convert storms, wind radii, labels, cities, tracks, ensembles, probes,
  and spawn clicks through the same transform.
- [ ] Route all canvas hit-testing through the inverse transform; no input path
  may retain the old fixed-domain arithmetic.
- [ ] Extend the gesture state machine so pointer travel/pinch cancels spawn;
  zoom and pan cannot accidentally create storms.
- [ ] Render exports with an explicit canonical full-world view without
  mutating the interactive camera.
- [ ] Assert camera movement performs no fetch, bin parse, texture upload,
  random reset, sim tick, or recorder append.
- [ ] Run identical sim ticks under two divergent camera histories, read back
  and hash the full-world cloud-memory/rain state, then composite both at one
  shared final camera. State hashes and final pixels must match.
- [ ] Run a V1 identity capture before enabling controls; it must still match
  Task 0.

Run:

~~~powershell
npx vitest run test/camera-integration.test.ts test/tap-gesture.test.ts test/point-probe.test.ts test/tracks.test.ts test/export.test.ts
npm test
npm run build
~~~

Expected: all layers remain registered over the same coastlines through pan,
zoom, resize, replay, and comparison.

Commit: `refactor: project all map layers through the shared camera`

### Task 5 — Ship camera controls and accessible interaction on V1

**Files**

- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/ui.ts`
- Modify: relevant CSS
- Create: `test/camera-controls.test.ts`
- Extend: `test/browser/domain-baseline.spec.ts` and the Task 0 Playwright
  projects with camera interaction cases

- [ ] Add Full basin/Oman/West India/Follow controls. Disable presets outside
  the active domain with an explanatory accessible label.
- [ ] Add pointer drag, anchored wheel, touch pinch, keyboard pan/zoom, Home,
  and explicit Follow resume.
- [ ] Prevent browser scroll/zoom only while a map gesture owns the pointer;
  never hijack arrow or +/- keys from form controls.
- [ ] Announce preset/follow state through an ARIA live region without
  announcing every animation frame.
- [ ] Preserve visible focus, 44 px minimum touch targets, and the current
  overlay information hierarchy.
- [ ] Honor `prefers-reduced-motion` with immediate camera transitions.
- [ ] Ensure overlays and controls remain usable at compact width and maximum
  text scaling.
- [ ] Validate that the old click-to-spawn flow remains one click/tap and that
  drag/pinch never spawns.
- [ ] Measure the Task 10 performance thresholds before merging.

Run:

~~~powershell
npx vitest run test/camera-controls.test.ts test/tap-gesture.test.ts
npm test
npm run build
~~~

Expected: camera is useful on V1, independently releasable, and reversible
before the costly data expansion.

Commit: `feat: add map zoom pan presets and storm follow`

### Task 6 — Run the West India source-acquisition spike

**Files**

- Create: `bake/audit_regional_sources.py`
- Create: `calibration/domain-expansion/source-coverage.json`
- Create: `calibration/domain-expansion/source-provenance.md`
- Create: `test/regional-source-contract.test.ts`
- Modify: `config/world-domains.json` only after the spike passes
- Modify: `bake/README.md`

- [ ] Resolve every required V2 source before changing production bakes:
  GMRT terrain, OISST climatology, ERA5 environment/steering/upper wind,
  upper-ocean inputs, IBTrACS, HydroSHEDS ACC/DIR, observation tile coverage,
  and licenses/attribution.
- [ ] Discover the official HydroSHEDS regional archive(s) from source
  metadata; do not guess archive names. Record URL, version, size, checksum,
  coverage bounds, CRS, nodata rules, and license.
- [ ] Download to task-owned cache only. Do not replace `data/raw` V1 source
  files during the spike.
- [ ] Verify each core source covers every V2 `FORCING_DOMAIN` target cell, not
  just the camera-visible world. Produce machine-readable uncovered-cell counts
  and a small diagnostic image for each raster source.
- [ ] Mosaic HydroSHEDS ACC/DIR by georeferenced coordinates. At every archive
  seam, check D8 codes, downstream neighbor continuity, ACC discontinuity, and
  outlet/cycle counts. A seam must not invent a sink or cross-water route.
- [ ] Verify GMRT target resolution is available for the larger request and
  empirically choose the final terrain grid under Task 0's memory budget.
- [ ] Verify event-specific env/steering files can be rebaked on a common V2
  grid; record any provider credentials needed separately from normal CI.
- [ ] Brute-force the world boundary, all declared sampler bearings, and all
  maximum radii; after latitude-aware offsets and half-texel interpolation
  support, every endpoint must remain inside the forcing bbox. Require the
  derived V2 `SAFE_SIM_DOMAIN` to equal `WORLD_DOMAIN`.
- [ ] Report observation-tile count and worst-case transfer for Full basin,
  Oman, West India, and max zoom.
- [ ] On PASS, add the reviewed V2 entry and final grid dimensions to
  `config/world-domains.json`. On failure, leave the executable registry V1-only.

Run:

~~~powershell
node bake/run-python.mjs -u bake/audit_regional_sources.py
npx vitest run test/regional-source-contract.test.ts
~~~

Pass: zero uncovered core-source cells; HydroSHEDS seam checks pass; provenance
and licensing are complete; chosen dimensions fit measured budgets.

**Hard stop:** any missing or ambiguous HydroSHEDS ACC/DIR coverage, unlawful
redistribution, unaffordable source/asset size, or unresolvable seam. Camera V1
may ship; physical V2 does not proceed.

Commit: `data: prove regional source coverage for west india expansion`

### Task 7 — Bake and validate versioned V2 assets

**Files**

- Modify: `bake/sources.py`, `bake/hydrosheds.py`, `bake/bake.py`,
  `bake/era5.py`, `bake/bake_upper_winds.py`, and relevant
  ocean/fidelity/HF/public-cycle scripts
- Create: versioned V2 outputs under
  `public/data/domains/arabian-sea-west-india-v2/`
- Create: generated
  `public/data/domain-manifests/arabian-sea-west-india-v2.json` and provenance
- Create: `calibration/domain-expansion/check-v2-assets.mjs`
- Create: `test/v2-domain-assets.test.ts`
- Create: `calibration/domain-expansion/v2-catalog.json` with frozen
  development/confirmation partitions and origin classifications
- Create: versioned `genesis.json`, `entries.json`, `tracks.json`, and
  `scenarios.json` under the V2 asset directory
- Modify: `calibration/asset-manifest.json` through the existing generator
- Modify: `package.json` with a `domain:v2:check` script
- Extend: bin integration, hydrology, event, scenario, and asset tests

- [ ] Parameterize each bake by domain ID; refuse an output path without that
  version segment for V2.
- [ ] Before generating event/catalog assets, seal the 71-storm inventory and
  schemas. `genesis.json` contains only literal IBTrACS first-fix starts inside
  `WORLD_DOMAIN` and labels them `literal-track-start`; `entries.json` contains
  first boundary entries for origins outside the world and labels them
  `domain-entry`. The 12 Bay-origin storms may remain historical tracks/entries
  but can never enter the synthetic-genesis pool or be described as born in the
  Arabian Sea.
- [ ] Freeze V2 development and untouched confirmation partitions before any
  V2 outcome/calibration result is visible. Event env/steering and scenarios
  are generated only from that sealed catalog.
- [ ] Put `domainVersion` and the frozen catalog hash in every V2 scenario
  asset before generating the runtime asset manifest. Never embed the
  containing core-manifest hash in a file that the manifest itself hashes.
- [ ] Bake terrain/landmask, environment, upper winds, ocean, event
  env/steering, and the required HydroSHEDS support across `FORCING_DOMAIN`.
  Bake genesis, tracks, scenarios, impact/runtime fields, and observation
  indexes against `WORLD_DOMAIN` unless their reviewed contract needs a halo.
- [ ] Keep the 0.5° environment grid alignment through the V1 overlap.
- [ ] Byte-compare aligned V1 climatology cells with the V2 forcing subwindow;
  any difference needs an identified source/resampling cause and review.
- [ ] Reproject/resample each source according to its existing categorical or
  continuous semantics; do not apply one generic resampler.
- [ ] Validate every WIWB header against the registry and runtime manifest.
- [ ] Validate terrain coastline, land fraction, finite values, range,
  HydroSHEDS connectivity, flow cycles/outlets, env variance, vector
  orientation, cross-layer cell-center alignment, and the exact visible-world
  subrect inside each forcing raster.
- [ ] Generate hashes and byte sizes only after all files pass. Run the bake
  twice from clean task-owned outputs and require byte-identical artifacts.
- [ ] Keep V1 assets and `calibration/asset-manifest.json` entries intact; the
  existing global asset manifest then seals both sets.
- [ ] Publish V2 assets before any app manifest can select them.

Run:

~~~powershell
npm run domain:manifest -- --domain=arabian-sea-west-india-v2
npm run domain:manifest:check
npm run assets:manifest
npm run assets:check
npm run domain:v2:check
npm run data:upper:check
npm run data:hf6:catalog:check
npm run hf2a:ocean:gate:check
npm run hf2:gate:check
npm run hf3:wander:check
npm run hf3:gate:check
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf5:gate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
~~~

Expected: all unchanged V1 gates remain green; V2 assets pass their own
structural checks. Data acquisition needing credentials/licenses is a
maintainer operation, not silently added to ordinary CI.

Commit: `data: add versioned arabian sea west india assets`

### Task 8 — Add the manifest-driven progressive loader

**Files**

- Create: `src/domain-loader.ts`
- Create: `src/asset-contract.ts`
- Create: `test/domain-loader.test.ts`
- Modify: `src/main.ts`
- Modify: `src/loader.ts`
- Modify: `src/render/index.ts`
- Modify: observation loaders

- [ ] Load and validate the active-domain selector with a no-store request,
  then load its content-hashed manifest before any core asset.
- [ ] Delete the duplicate hard-coded `MANIFEST`/`data/*.bin` ownership from
  `src/main.ts` and the renderer's self-source fallback. The validated domain
  loader is the sole owner of core URLs; render passes only receive resources.
- [ ] Expose explicit readiness states:
  - `mapReady`: domain metadata plus forcing terrain/elevation/landmask are
    validated and the visible subrect is renderable;
  - `sandboxPhysicsReady`: terrain/elevation/landmask, base `env.bin`, and
    `ocean.bin` are validated; free spawning remains disabled before this state;
  - `eventPhysicsReady(scenarioId)`: sandbox dependencies plus that scenario's
    event env and pressure-level steering bins are validated; event spawn/replay
    cannot silently fall back to climatology or centre-flow steering;
  - `upperDisplayReady`: `upper.bin` is validated for the display layer only;
    it is not mislabeled as a simulation dependency;
  - `catalogReady`: genesis, entries, tracks, and scenarios are validated;
  - `hydrologyReady`: routing/impact data is validated when that layer is used;
  - optional/lazy: the selected radar/satellite frame.
- [ ] Replace today's permissive core-404 behavior with an honest fail-closed
  domain error. Optional observation failure remains explicitly labeled.
- [ ] Verify response byte length and SHA-256 before parsing/caching core data.
- [ ] Reject mixed domain IDs, bounds, dimensions, format versions, or
  compatibility versions before creating textures or a sim session.
- [ ] Resolve event env/steering and scenario resources through the validated
  manifest rather than filename substitution or root-relative fallback.
- [ ] Deduplicate concurrent requests, support AbortController on a domain
  switch, and retain already validated assets in a bounded cache.
- [ ] Build and cache one bounded world-domain observation mosaic per selected
  timestamp (at most 12 fixed zoom-5 RainViewer tiles for V2). Camera movement
  samples that mosaic locally. View-dependent higher-resolution tiles are out
  of scope, so pan/zoom alone cannot trigger observation requests.
- [ ] Confirm camera-only movement never reloads core data or re-uploads
  world-sized textures.

Run:

~~~powershell
npx vitest run test/domain-loader.test.ts test/loader.test.ts test/integration-bins.test.ts
npm test
npm run build
npm run assets:check
~~~

Expected: V1 and V2 manifests load independently; every mixed/corrupt fixture
fails before simulation; initial V2 transfer stays within the Task 0 budget.

Commit: `feat: load versioned map domains progressively`

### Task 9 — Activate the regional simulation domain and V2 run envelopes

**Files**

- Modify: `src/sim.ts` and boundary/termination helpers
- Modify: `src/main.ts` and spawn validation
- Modify: `src/flight-recorder.ts`
- Modify: `src/scenarios.ts` and `src/tracks.ts`
- Modify: `src/impact.ts`
- Modify: `src/export.ts`
- Modify: `src/render/cloud-memory.ts`, `src/render/rain.ts`,
  `src/render/particles.ts`, and `src/performance.ts` for the sealed V2
  runtime-field dimensions/budgets
- Extend: sim, flight-recorder, scenario, track, impact, and export tests

- [ ] Audit every off-center physics sampler and derive `SAFE_SIM_DOMAIN` by
  insetting `FORCING_DOMAIN` by the maximum physical footprint (420 km today,
  latitude-aware at each edge) plus raster interpolation support. Intersect it
  with `WORLD_DOMAIN`; V2 activation fails unless the result contains all of
  `WORLD_DOMAIN`.
- [ ] Filter free-spawn/genesis points to water inside the safe box. Distinguish
  “outside world,” “unsafe sampling edge,” and “land” in the UI.
- [ ] Terminate an exiting storm deterministically as `out-of-domain` before
  any physics sample clamps. Record the reason.
- [ ] Define a V2 run/export/reproduction envelope carrying `domainVersion`,
  frozen catalog hash, and the **loaded** core-manifest hash. Scenario assets
  already carry domain/catalog identity from Task 7 and never embed their
  containing manifest hash. Do not add camera pose.
- [ ] Preserve V1 bytes: parsers interpret absent domain fields as legacy
  `arabian-sea-v1`, existing V1 scenarios/recordings/exports remain unchanged,
  and only V2 uses the new envelope. Add round-trip byte fixtures for V1.
- [ ] Reject replay/scenario assets whose domain version differs from the
  active world; provide a clear V1-load path for V1 recordings.
- [ ] Migrate city/impact coverage to the V2 grid and add relevant West India
  cities only with named source/provenance.
- [ ] Preserve the 71-storm inventory and publish exact counts: captured
  literal starts, captured over-water starts, out-of-domain cases, and
  Bay-origin entries/exclusions. Consume the Task 7 frozen partitions; no
  sample redraw to improve the percentage.
- [ ] Run V1 and V2 from identical in-overlap initial states. Explain state
  differences caused by new environmental/terrain data; do not compensate by
  changing physics coefficients in this delivery.
- [ ] Select Full basin as the V2 startup camera; confirm that camera choice
  does not change any run hash.
- [ ] Allocate the sealed rectangular cloud-memory and routed-rain targets,
  validate WebGL2 limits, retain physical advection/backtrace/routing scale,
  prove canvas resize preserves their state, and verify zoomed particle density
  without increasing simulation or recorder state.
- [ ] Only after PR D's V2 assets/manifests are deployed and reachable, change
  the PR E candidate selector to V2 and run `domain:manifest:check`. This
  selector-switched commit—not the preceding V1-default commit—is the head Task
  10 must test, review, and refute before merge.

Run:

~~~powershell
npx vitest run test/physics.test.ts test/flight-recorder.test.ts test/scenarios.test.ts test/tracks.test.ts test/impact.test.ts test/export.test.ts
npm test
npm run build
npm run domain:manifest:check
npm run assets:check
~~~

Expected: the wider world creates earlier valid spawn runway without sampling
clamped edges; V1 recordings remain reproducible through their V1 manifest.

Commit: `feat: activate the regional arabian sea simulation domain`

### Task 10 — Calibrate, profile, browser-test, and refute at the final head

**Files**

- Create: `calibration/domain-expansion/calibrate-v2.mjs`
- Create: V2 calibration scenarios, results, reviewed references, and benchmark
  report under `calibration/domain-expansion/v2/`
- Create: V2 realism scenarios/results/references under
  `calibration/realism/arabian-sea-west-india-v2/`
- Modify: the realism runner to require an explicit domain/versioned output
  path rather than overwriting V1 artifacts
- Modify: `package.json` with `calibrate:v2`, `calibrate:v2:check`,
  `realism:v2`, and `realism:v2:check`
- Add: browser screenshots/traces and raw performance measurements to
  `calibration/domain-expansion/`
- Modify: gap register/roadmap only for evidence actually produced

- [ ] Run all current gates at the actual final head:

~~~powershell
npm test
npm run typecheck
npm run build
npm run assets:check
npm run domain:v2:check
npm run calibrate:check
npm run realism:check
npm run calibrate:v2:check
npm run realism:v2:check
npm run test:browser:domain
npm run data:upper:check
npm run data:hf6:catalog:check
npm run hf2a:ocean:gate:check
npm run hf2:gate:check
npm run hf3:wander:check
npm run hf3:gate:check
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf5:gate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
git diff --check
~~~

- [ ] Create new V2 references only through a reviewed seal operation. Never
  reseal V1 to hide drift.
- [ ] Treat the existing calibration/realism/HF commands as V1 regression
  gates. The dedicated `*:v2:check` commands must exercise the frozen Task 7
  V2 catalog, forcing manifest, and V2 result paths; passing V1 checks alone is
  never evidence that V2 is calibrated.
- [ ] Browser matrix:
  - desktop and compact;
  - mouse and touch;
  - Full basin, Oman focus, West India, Follow, and maximum zoom;
  - terrain, simulated IR, observed IR, radar, rain, wind/particles;
  - live/free spawn, replay, and comparison;
  - normal and reduced motion.
- [ ] Verify coast/layer registration at multiple points and every preset.
- [ ] Verify spawn/probe coordinates against the inverse transform, including
  edge clamping rules and drag/pinch cancellation.
- [ ] Verify pausing freezes simulated IR/cloud memory regardless of camera;
  replaying the same frame at the same view reproduces the same pixels.
- [ ] Verify Full basin visibly exposes early development for the fixed
  captured-start cohort without claiming improved track/intensity skill.
- [ ] Independently review the implementation and run an adversarial refuter
  after the final commit. The refuter specifically tries mixed-version assets,
  camera-dependent hashes, edge clamping, HydroSHEDS seam defects, particle
  resets, accidental spawns, stale async loads, and V1 rollback.

Performance acceptance on the Task 0 machine:

- desktop active-view p95 frame work ≤16.7 ms;
- compact active-view p95 frame work ≤33.3 ms;
- camera input-to-paint p95 ≤100 ms;
- no >100 ms main-thread long task during ordinary pan/zoom;
- no core network request or world texture upload during ordinary camera moves;
- steady-render p95 regression ≤25% versus the same Task 0 scenario/profile.

Absolute memory, initial-transfer, and GPU-allocation caps are sealed from Task
0 measurements before implementation; do not invent them after seeing V2
results. A missed threshold is a stop/revise, not a documentation exception.

---

## 5. PR, rollout, and rollback sequence

1. **PR A — V1 coordinate seam:** Tasks 0–2. No controls, no V2 data, exact V1
   identity.
2. **PR B — V1 camera:** Tasks 3–5. Zoom/pan/presets/follow shipped on the
   current world; user value arrives before the risky data expansion.
3. **PR C — acquisition proof:** Task 6. Evidence-only source gate. A failure
   ends physical expansion cleanly without reverting the camera.
4. **PR D — versioned V2 assets/loader:** Tasks 7–8. Publish assets first;
   active-domain selector remains V1.
5. **PR E — V2 activation:** Task 9 switches `active-domain.json` in the
   candidate commit after PR D assets are live. Task 10 runs every gate, browser
   check, review, and refutation on that exact selector-switched head. Merge and
   deploy only on PASS; any later change requires the gates again.

Keep V1 code compatibility, manifest, assets, and calibration references for at
least one release. Rollback is a reviewed change of the active-domain selector
to `arabian-sea-v1`, followed by `domain:manifest:check`, asset-manifest,
browser smoke, and deployment checks. Do not delete V2 assets during rollback;
cached clients may still refer to their hashed URLs.

---

## 6. Stop conditions

Stop and return to design/review if any of these occurs:

- HydroSHEDS ACC/DIR or another core source does not completely and lawfully
  cover V2.
- A HydroSHEDS archive seam creates sinks, cycles, broken downstream links, or
  unexplained ACC discontinuity.
- V1 identity changes simulation/recorder hashes, fixed probe/spawn positions,
  calibration results, or deterministic screenshots.
- Any V2 active-storm physics sampler clamps at a world or forcing edge.
- Camera state reaches sim state, a recording, scenario identity, calibration
  input, or canonical export.
- Pan/zoom triggers core refetch, texture re-upload, random particle reset, or
  sim restart.
- V2 boot/steady-state misses the sealed resource or performance budget.
- Required V2 calibration can pass only by changing physics in the same
  expansion delivery.
- Mixed-version data degrades silently instead of failing closed.
- The 80°E boundary still cannot show the intended West India context; do not
  keep expanding east ad hoc—open a separate basin-scope decision.

---

## 7. Definition of done

The expansion is done only when:

- the app opens on a 50–80°E / 8–28°N full-basin world and can move smoothly
  among Full basin, Oman, West India, and Follow views;
- storms can be spawned and tracked through the safe regional ocean without
  edge-clamped forcing;
- every layer, overlay, click, probe, replay, comparison, and export shares the
  same tested coordinate transform;
- camera movement is provably presentation-only and deterministic;
- core V2 assets are complete, versioned, hashed, progressive, and
  provenance-backed;
- all V1 and V2 gates, browser matrix checks, performance budgets, independent
  review, and adversarial refutation pass at the final commit;
- V1 remains a tested one-step manifest rollback.
