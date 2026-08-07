# Shared Camera (UX v2 Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pan/zoom camera for the whole map — every geo↔screen conversion
routed through a single view transform, cover-fit edge-to-edge canvas, camera
clamped to the baked domain — with physics, recorded output, and every sealed
gate untouched (ROADMAP item 7; phase 2 of
`docs/superpowers/specs/2026-08-06-impact-board-ux-v2-design.md`).

**Architecture:** Preserve today's clip space as **world space** (domain
edges = ±1; the exact output of `latLonToClip(lat, lon, DOMAIN)`), and insert
one affine **view transform** `ndc = world·scale + offset` at the screen
boundary only. Fragment-shader math, the 666 km→clip constants, `metricX`,
`rainCenterClip`, cached genesis/aftermath clip products all keep their
meaning because they operate in world space. The view enters in exactly four
places: (a) vertex shaders (fullscreen-quad passes invert it to derive domain
UV; VBO/line passes apply it forward), (b) the Canvas2D `px()` helpers
(track, ghosts, ui overlay), (c) DOM label math (`pxX`/`pxY` in ui.ts), and
(d) the pointer inverse (`mapPointFromClient`). The camera is clamped so the
view bbox is always inside `DOMAIN` — out-of-domain sampling can never occur.

**Tech Stack:** Vanilla TS + WebGL2, zero runtime deps, vitest node env
(pure view-model math tests; no DOM tests possible).

## Global Constraints

- Runtime npm dependency count stays ZERO.
- No `Math.random`/`Date.now`/device traits in sim code or recorded output;
  camera state is presentation-only and never enters the flight tape, the
  URL hash, `impact.ts`, `ensemble.ts`, `realism-*`, `fidelity-*`, or
  `export`ed *data* (view-dependent *pixels* in captures are allowed, see
  Task 6).
- `latLonToClip`/`clipToLatLon`/`latLonToCell`/`inBBox` keep their exact
  domain-fixed semantics — sealed gates (calibrate:check, HF-6, realism)
  and `test/grid.test.ts` corner pins depend on them. The camera composes on
  top; it never redefines them.
- `npm test`, `npm run build`, `npm run calibrate:check` green after every
  task. `npm run realism:check` green at the end (advisory).
- Colours only via `src/tokens.ts` custom properties; no hardcoded colours.
- Product-honesty labels untouched (masthead chip, SIMULATED stamps).
- URL-hash format untouched (no camera key — future work, frozen contract).
- Observed satellite/radar *requests* stay domain-fixed
  (`test/satellite-observations.test.ts` / `test/radar-observations.test.ts`
  pin the bbox strings and tile ranges). Zoomed-in observed imagery is
  magnified from the fixed 1000×600 domain texture — accepted, documented.
- `fidelity-verification.ts`'s local `EARTH_RADIUS_KM` duplicate is
  deliberate — do NOT consolidate it (sealed numbers depend on it).
- `HALF_DOMAIN_HEIGHT_KM = 666` in `src/realism-metrics.ts` is a deliberate
  second copy (drift-guarded by `test/realism-metrics.test.ts`) — leave it.

## Camera model (shared by every task)

World space: `[-1,1]²`, x east, y north (lat/lon normalized to `DOMAIN`).
World anisotropy at latitude φ is `metricX(φ) = (20·cos φ)/12` — already
canonical as `cloudMetricX` (`src/render/cloud-motion.ts:66`).

```ts
/** Presentation-only camera state (main.ts owns the instance). */
export interface ViewState {
  /** View centre in world coordinates (domain clip), each in [-1,1]. */
  center: { x: number; y: number };
  /** 1 = cover-fit (min); MAX_ZOOM = 8. View half-height = 1/zoom world-y. */
  zoom: number;
}

/** Derived per-frame transform: ndc = world * scale + offset. */
export interface ViewTransform {
  scaleX: number; scaleY: number; offsetX: number; offsetY: number;
  /** Visible geographic bbox (for graticule/culling). Always inside DOMAIN. */
  bbox: BBox;
}
```

Derivation (`computeViewTransform(view, canvasAspect)` — pure):
- `A = canvasAspect` (CSS or device px, same ratio), `φc = center lat`,
  `m = metricX(φc)`.
- `halfH = 1/zoom` (world-y units); `halfW = A·halfH/m` (world-x units) —
  this makes ground-metres-per-px equal in x and y (unstretched map). Sanity:
  at `A = (20·cos21°)/12` (today's `MAP_ASPECT`) and zoom 1 this is the
  identity transform.
- Clamp (two-pass fixpoint, because `m` depends on centre latitude):
  1. `zoom = clamp(zoom, maxZoomOutFor(A, φc), MAX_ZOOM)` where
     `maxZoomOutFor = max(1, A/m)` (width may bind before height on wide
     canvases);
  2. clamp `center` so `[cx±halfW, cy±halfH] ⊆ [-1,1]²`;
  3. recompute `m` from the clamped centre, redo halfW, re-clamp centre once.
- `scaleX = 1/halfW; scaleY = 1/halfH; offsetX = -cx·scaleX;
  offsetY = -cy·scaleY`.

Helpers (all pure, in `src/camera.ts`):
- `worldToNdc(t, x, y)` / `ndcToWorld(t, x, y)`.
- `latLonToScreen(t, lat, lon, w, h)` → px (y down):
  world = latLonToClip(lat, lon); ndc = worldToNdc;
  `x = ((ndc.x+1)/2)·w; y = ((1-ndc.y)/2)·h`.
- `screenToLatLon(t, xPx, yPx, w, h)` → exact inverse via `clipToLatLon`.
- `panByPixels(view, dxPx, dyPx, t, w, h)` → new ViewState (centre moved by
  `dx/(pxPerWorldX)` etc.; caller re-derives the transform, which clamps).
- `zoomAboutAnchor(view, anchorWorld, newZoom, t)` → new ViewState keeping
  the anchor's NDC position fixed:
  `c'.x = a.x - (a.x - c.x)·(zoom/newZoom)` (same for y; the metricX change
  between the two zooms is folded in by the next computeViewTransform).
- `HOME_VIEW: ViewState = { center: {x:0,y:0}, zoom: 1 }`, `MAX_ZOOM = 8`.
- `viewKey(t)` — short string for change detection (drives relayout +
  trail clears).

File decision: the pure camera module is **`src/camera.ts`** (new,
~200 lines) importing `latLonToClip`/`clipToLatLon`/`DOMAIN` from grid.ts
and `cloudMetricX` from render/cloud-motion.ts is NOT allowed (render must
not be imported by a grid-level module — instead `camera.ts` derives
`metricX` from `DOMAIN` spans directly, same formula). grid.ts itself stays
untouched except its header comment (Task 6) — ROADMAP said "in grid.ts";
the deviation (sibling module, one concern per file, grid.ts stays ≤200
lines) is recorded in the ROADMAP note in Task 6.

GLSL contract (shared snippet, defined once in `src/render/gl-utils.ts`):

```glsl
// u_view: vec4(scaleX, scaleY, offsetX, offsetY); world -> ndc.
// Fullscreen-quad passes invert it: world = (ndc - offset) / scale.
```

- Fullscreen-quad VS pattern (terrain/env/radar/rain-composite/satellite/
  observed-radar): `vec2 world = (a_pos - u_view.zw) / u_view.xy;
  v_uv = vec2(world.x * 0.5 + 0.5, 0.5 - world.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);`
- VBO/line VS pattern (wind lines, particles):
  `gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);`
- Offscreen domain-space passes (env OHC blend, cloud-memory update, rain
  accumulator update) bind the IDENTITY view `vec4(1,1,0,0)` — their targets
  are domain-registered, not screens.

---

### Task 1: Pure camera module + tests

**Files:**
- Create: `src/camera.ts`
- Test: `test/camera.test.ts`

**Interfaces:**
- Produces: everything in "Camera model" above — `ViewState`,
  `ViewTransform`, `computeViewTransform(view, canvasAspect)`,
  `worldToNdc`, `ndcToWorld`, `latLonToScreen`, `screenToLatLon`,
  `panByPixels`, `zoomAboutAnchor`, `HOME_VIEW`, `MAX_ZOOM`, `viewKey`.
- Consumes: `DOMAIN`, `latLonToClip`, `clipToLatLon`, `BBox` from
  `./grid` / `./types`.

- [ ] **Step 1: Write the failing tests** (`test/camera.test.ts`, table-driven,
  `toBeCloseTo` 9-12 places, matching house idioms):
  - identity: `computeViewTransform(HOME_VIEW, domainMetricAspect)` where
    `domainMetricAspect = (20*Math.cos(21*Math.PI/180))/12` → scale (1,1),
    offset (0,0), bbox == DOMAIN.
  - cover-fit wide canvas (A = 2.0): zoom 1 is rejected — actual min zoom is
    `A/metricX(φ)`; assert view bbox ⊆ DOMAIN, bbox latMax-latMin < 12, and
    metric roundness: `(bbox.lonSpan·cos(midLat))/bbox.latSpan ≈ A` within
    0.5%.
  - cover-fit tall canvas (A = 1.0): height binds (zoom 1), lonSpan < 20,
    bbox ⊆ DOMAIN.
  - round-trip: for a grid of (lat, lon) × zooms {1, 2.5, 8} × centres
    {domain centre, near NE corner}: `screenToLatLon(latLonToScreen(p)) ≈ p`
    to 1e-9.
  - clamping: centre at (0.99, 0.99) zoom 2 → bbox still ⊆ DOMAIN.
  - zoom bounds: zoom 0.2 → clamps to cover-fit; zoom 50 → clamps to
    MAX_ZOOM = 8.
  - zoomAboutAnchor: anchor world point keeps identical screen px after
    zoom change (within 1e-9), for an off-centre anchor.
  - panByPixels: panning +100px right moves centre east by
    `100/pxPerWorldX`; panning past the domain edge clamps.
  - viewKey: identical states → identical key; any pan/zoom → new key.
- [ ] **Step 2: Run tests, verify they fail** (`npx vitest run test/camera.test.ts`).
- [ ] **Step 3: Implement `src/camera.ts`** per the Camera model section.
- [ ] **Step 4: Full suite green** (`npm test`).
- [ ] **Step 5: Commit** `feat: pure view/camera math module (UX v2 phase 2)`.

### Task 2: Consolidate the km→clip landmine constants (no behaviour change)

**Files:**
- Modify: `src/render/radar.ts:125-132` (literal `666` → import
  `HALF_DOMAIN_HEIGHT_KM` from `./storm-radii`; inline
  `(20 * Math.cos(latRadians)) / 12` → `cloudMetricX(storm.lat)` from
  `./cloud-motion`)
- Modify: `src/render/rain.ts:64-66`, `src/render/wind.ts:47`,
  `src/render/particles.ts:40-41` (each re-derives
  `((DOMAIN.latMax - DOMAIN.latMin) * 111) / 2` — replace with the
  `storm-radii` import; value is identically 666 so zero visual change)
- Modify: `src/render/rain.ts:372-377` (DOMAIN-expressed metricX →
  `cloudMetricX(centreLat)`)

Note: wind.ts `METRIC_X` (frozen at mid-domain lat) keeps its own constant —
it is deliberately latitude-fixed for the particle advection frame; add a
comment saying so. Do NOT touch `src/realism-metrics.ts`'s copy.

- [ ] **Step 1: Make the replacements.** Grep afterwards:
  `rg '666' src/render/` must hit only `storm-radii.ts` (the canonical
  definition); `rg '20 \* Math.cos|\* 111\) / 2' src/render/` must hit
  nothing.
- [ ] **Step 2: Full suite + build green** (`npm test && npm run build`) —
  storm-radii/cloud-motion/realism pins prove value-neutrality.
- [ ] **Step 3: Commit** `refactor: single owner for km->clip constants in render`.

### Task 3: View channel + shader plumbing + edge-to-edge canvas

The app goes cover-fit edge-to-edge with the camera fixed at `HOME_VIEW`;
interaction comes in Task 5. Since window aspect ≠ domain aspect, this task
already exercises every shader path with a non-identity view.

**Files:**
- Modify: `src/types.ts` (FrameState gains `view: ViewTransform`; import
  type from `./camera`)
- Modify: `src/render/context.ts` (DrawCtx gains `view: ViewTransform`)
- Modify: `src/render/gl-utils.ts` (shared GLSL comment + `VIEW_VS_SNIPPET`
  helpers; `IDENTITY_VIEW` export)
- Modify: `src/render/index.ts` (`buildCtx` copies `frame.view`; passes it
  to layers that take uniforms)
- Modify: fullscreen-quad VS + `u_view` uniform in `src/render/terrain.ts`,
  `src/render/env.ts` (screen program only — the OHC blend pass binds
  IDENTITY_VIEW), `src/render/radar.ts`, `src/render/rain.ts` (composite
  program only — update pass binds IDENTITY_VIEW for now, Task 4 makes its
  target domain-fixed), `src/render/satellite.ts`,
  `src/render/observed-radar.ts`
- Modify: forward-view VS + `u_view` in `src/render/wind.ts` (LINE_VS only;
  FADE_VS/COMP_VS are screen-space, untouched) and
  `src/render/particles.ts`
- Modify: `src/render/cloud-memory.ts` — update pass binds IDENTITY_VIEW
  explicitly (state textures are camera-independent by contract; add the
  comment)
- Modify: `src/main.ts` — `layoutMapFrame()` becomes full-window (drop
  MAP_ASPECT letterbox; keep the function as the single place that sizes
  the frame); module-level `let cameraView: ViewState = HOME_VIEW;` and
  `currentViewTransform()` helper (computed from `glCanvas.clientWidth/`
  `clientHeight` aspect); FrameState build (~line 2815) gains
  `view: currentViewTransform()`
- Modify: `src/style.css` — `#map-frame` full-bleed (no border-radius/frame
  shadow at full size; keep tokens)

**Key edit — the fullscreen-quad VS (identical pattern in all six files);
current form (e.g. env.ts:34-40):**

```glsl
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
```

becomes:

```glsl
in vec2 a_pos;
uniform vec4 u_view; // world->ndc: ndc = world * xy + zw
out vec2 v_uv;
void main() {
  vec2 world = (a_pos - u_view.zw) / u_view.xy;
  v_uv = vec2(world.x * 0.5 + 0.5, 0.5 - world.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
```

Every fragment shader keeps reconstructing `cell = uv*2-1` and now gets
WORLD clip — all storm/radial/texture math is untouched by construction.

**Key edit — VBO passes (wind.ts LINE_VS:63, particles.ts:105-114):**
`gl_Position = vec4(a_pos, 0.0, 1.0)` →
`gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);`
particles.ts `u_size` stays device-px (screen-constant glyphs — deliberate).
particles.ts roundness: replace `ctx.aspect` in the iso-frame math
(lines 196-201, 248-276) with `viewIso = (ctx.width * ctx.view.scaleX) /
(ctx.height * ctx.view.scaleY)` (px-per-world-x over px-per-world-y — equals
`ctx.aspect` exactly when the view is the old identity).
wind.ts advection/seeding stays world-space in this task (viewport-aware
seeding is Task 5, with the interaction that makes it visible).

- [ ] **Step 1:** types/context/gl-utils/index plumbing; `npm run build`.
- [ ] **Step 2:** the six fullscreen-quad passes + two VBO passes +
  IDENTITY_VIEW on the three offscreen passes (env OHC blend, cloud-memory
  update, rain update).
- [ ] **Step 3:** main.ts full-window frame + FrameState.view + style.css.
- [ ] **Step 4:** `npm test && npm run build && npm run calibrate:check`.
- [ ] **Step 5: Visual QA (headless):** spawn-hash URL at 1680×1000 and
  1366×768 — map fills the window edge-to-edge, all layers registered
  (terrain coastline under radar under track), storm drawn at the same
  geographic spot as pre-change screenshots. KNOWN REGRESSION at this step:
  DOM overlays (city markers, graticule, probe) still use the old identity
  projection — they land in Task 4/5's ui.ts work? NO — see Task 4: they
  must land in the SAME PR-visible state before commit. Task 3 therefore
  also includes the minimal ui.ts/main.ts overlay reroute below.
- [ ] **Step 6 (same task, DOM/2D overlays through the view):**
  - `src/ui.ts` gains `setView(t: ViewTransform)` storing the transform;
    `pxX/pxY` (ui.ts:1560-1568) become view-aware:
    `pxX(lon, w) = ((worldToNdc(t, latLonToClip(0, lon).x, 0).x + 1) / 2) * w`
    — implement via one private helper `screenPos(lat, lon, w, h)` calling
    `latLonToScreen`; graticule (1525-1558) derives its lon/lat range from
    `t.bbox` (step 5° when lonSpan > 8°, else 1°); city markers get
    off-canvas culling (`hidden` when outside [-40, w+40] × [-20, h+20]).
  - `src/render/track.ts` `px()` (63-65) and `src/render/ghosts.ts` `px()`
    (62-64) apply the view: layer gains `setView(t)` called from the facade
    `draw()` (facade reads `ctx.view`).
  - `src/main.ts`: `mapPointFromClient` (1366-1373) → `screenToLatLon(t, …)`
    + keep the `inBBox` gate; `probePlacement` (1375-1391) →
    `latLonToScreen`; ensemble overlay (2754-2795): heatmap cells map
    `cellToLatLon({nx, ny, bbox: DOMAIN}, col±0.5, row±0.5)` corners through
    `latLonToScreen` (device px), member tracks likewise; main calls
    `ui.setView(t)` each frame before `updateFlightRecorder`.
- [ ] **Step 7:** `npm test && npm run build`; headless QA again — markers,
  graticule, probe, ensemble overlay all registered with the GL map.
- [ ] **Step 8: Commit** `feat: route every render/UI path through the shared view transform`.

### Task 4: Domain-fixed rain accumulator

The flood/accumulator state must survive camera moves and stop depending on
canvas size. Fixed target 1000×600 (domain 5:3; ~2.1 km/cell — closer to the
baked 2 km travel-time cells than today's canvas-dependent size).

**Files:**
- Modify: `src/render/rain.ts` — ping-pong `RenderTarget`s (274-293) sized
  `1000×600` constants (`ACCUM_W/ACCUM_H`) instead of `floor(canvas/2)`;
  `u_rtexel` (321-322) becomes `(1/1000, 1/600)`; `resize()` no longer
  clears/reallocates them (only the composite path cares about canvas size);
  update pass keeps IDENTITY_VIEW (its quad IS the domain); composite pass
  (Task 3) already samples `u_accum` at view-derived domain UV.

- [ ] **Step 1:** implement; grep rain.ts for `rtW|rtH` to catch stragglers.
- [ ] **Step 2:** `npm test && npm run build && npm run realism:check`
  (realism is CPU-mirror based and must be untouched — if it moves, STOP,
  the change leaked outside render).
- [ ] **Step 3:** headless QA: wadi glow still appears near the storm's rain
  field after ~2 h sim time; identical at 1366×768 vs 1680×1000 (was
  canvas-dependent before — improvement, note in PR).
- [ ] **Step 4: Commit** `fix: rain accumulator on a domain-fixed grid (camera- and canvas-independent)`.

### Task 5: Interaction — wheel zoom, drag pan, pinch, keyboard

**Files:**
- Create: `src/camera-gestures.ts` (~180 lines) — a pure-ish controller
  in the intensity-sparkline pattern: holds `ViewState`, exposes
  `onWheel(dyPx, anchorPx)`, `onDragStart/Move/End(px)`,
  `onPinch(p1, p2, prev1, prev2)`, `onKey(key)`; every method returns the
  new `ViewState` (pure state machine over camera.ts helpers, testable in
  node with a fake transform provider).
- Test: `test/camera-gestures.test.ts`
- Modify: `src/main.ts` — wire it:
  - `wheel` on `#map-frame` (passive:false, preventDefault): zoom about the
    cursor (`zoomFactor = Math.exp(-deltaY * 0.0015)`).
  - pointer events: extend the existing handlers (2404-2481) — a drag past
    the existing 10 px threshold (2444-2449) BECOMES a pan (call
    `mapTap.cancel()` and clear `probeTouch`); pointerup after a pan does
    NOT spawn. Two active pointers → pinch (cancel tap + probe timers).
    Mouse-move with buttons!==0 pans (the probe already ignores it).
  - keyboard (existing `keydown` listener, 2495): arrows pan 64 px,
    `+`/`-`/`=` zoom about centre, `0` returns to `HOME_VIEW`. Skip when
    `event.target` is an input/select or an existing binding claims the key
    (read the handler before editing).
  - on every camera change: `renderCtrl.clearWindTrails?.()` (add a facade
    passthrough to `wind.clearTrails()` + `upperWind.clearTrails()`),
    `ui.setView(t)`, and the per-frame draw picks up the rest. City marker
    updates are already per-frame.
  - wind.ts (from Task 3 note): respawn box + kill bounds become the current
    view rect ±2% margin (facade passes `ctx.view` bbox in world coords);
    density now tracks the viewport.
- Modify: `index.html` — nothing (no zoom buttons; wheel/drag/pinch/keys
  only, per the ROADMAP contract).

**Gesture tests (node):** tap-vs-pan arbitration (10 px threshold hands off
exactly once), wheel anchor invariance (delegates to `zoomAboutAnchor`),
pinch ratio → zoom ratio, keyboard clamping at domain edges, pan during
replay does not touch the recorder (pure state, no engine reference —
structural: the module has no imports from sim/flight-recorder).

- [ ] **Step 1:** failing tests for the gesture state machine.
- [ ] **Step 2:** implement `camera-gestures.ts`; tests green.
- [ ] **Step 3:** wire main.ts; `npm test && npm run build`.
- [ ] **Step 4:** headless QA (CDP mouse events if feasible, else manual
  keyboard-driven states via injected key events): zoomed-in storm core,
  panned coastline, `0` home reset. Verify tap-to-spawn still works after
  a pan (arbitration), probe reads the correct lat/lon while zoomed
  (spot-check a city's known coordinates), no layer separation.
- [ ] **Step 5: Commit** `feat: wheel/drag/pinch/keyboard camera controls`.

### Task 6: Captures, docs, contract text, QA sweep, PR

**Files:**
- Modify: `src/export.ts:61-62` — the debrief-card annotation projects
  geo→px assuming a domain-spanning capture; captures are now
  view-dependent, so `captureMapFrame`/`flushMapCaptures` (main.ts:911-927)
  must snapshot the `ViewTransform` alongside the pixels and export.ts's
  annotation math must use it (`latLonToScreen(capturedView, …)`). Read
  both neighbourhoods first; keep exported *data* (CSV/JSON tracks) fully
  view-independent.
- Modify: `src/grid.ts:13-18` header — document the world/view split:
  "clip space" here is WORLD space (domain-normalized); the view transform
  in `src/camera.ts` maps world→NDC and is presentation-only.
- Modify: `docs/architecture.md` — camera.ts + camera-gestures.ts rows;
  "where to change what" row (map viewport/zoom → camera.ts).
- Modify: `ROADMAP.md` — item 7 → Complete (2026-08-07) with the
  grid.ts-sibling deviation noted; "UX big bet" status row updated.
- Modify: `CLAUDE.md` (repo) — one line under Determinism: camera/view is
  presentation-only (`src/camera.ts`); world clip stays domain-fixed; sim,
  recorded output, and offscreen state textures never read the view.

- [ ] **Step 1:** export/captures view snapshot; `npm test && npm run build`.
- [ ] **Step 2:** docs + contract text edits.
- [ ] **Step 3:** full gate sweep: `npm test`, `npm run build`,
  `npm run calibrate:check`, `npm run realism:check`,
  `npm run hf6:verify:check && npm run hf6:gate:check && npm run hf6:prospective:check`.
- [ ] **Step 4:** adversarial review workflow over `git diff main...HEAD`
  (find→refute, ≥2 lenses: coordinate-space correctness, state/lifecycle,
  gesture arbitration, determinism leakage); fix confirmed findings.
- [ ] **Step 5:** headless screenshot matrix: {home, zoom 2.5 on storm,
  panned SW coast} × {1680×1000, 1366×768, 390×844}; two identical runs of
  one fixed state for a determinism spot-check.
- [ ] **Step 6:** push `feat/map-camera`, open PR (body = summary + test
  plan, full-branch diff), watch CI.

## Self-review notes

- Spec coverage: ROADMAP contract clauses → camera state (T1), routed
  conversions (T3), shared per-shader transform (T3), clamp+zoom bounds
  (T1), wheel/drag/keyboard/pinch (T5), readability across zoom (screen-
  constant line weights/labels kept; particle density T5; glyph sizes
  device-px), physics untouched (identity-view offscreen passes + constraint
  checks each task), acceptance round-trips (T1 tests) + registration/
  determinism QA (T6).
- Landmines from the phase-2 spec: storm-radii 666 already canonical
  (T2 consolidates the four copies), radar literals (T2), cloudMetricX
  (T2/T3 — unchanged in meaning because world space is preserved).
- Known accepted costs: observed imagery magnifies at zoom (fixed 1000×600
  source); wind trails clear on camera change; genesis glow radius stays
  screen-relative; ghost polylines beyond the domain edge become visible
  only insofar as the camera never leaves the domain (they cannot — clamp).
