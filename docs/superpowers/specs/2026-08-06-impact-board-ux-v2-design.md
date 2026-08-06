# UX v2 — at-a-glance storm effects (umbrella design)

Date: 2026-08-06 · Status: approved direction (approach A), Phase 1 specced in full
Author: brainstormed with Nasser; sequencing choice A confirmed in-session.

## Problem

Storm-impact information is fragmented across five surfaces (impact-live line,
city-detail card, point probe, debrief impact report, accum layer) with no
single home. The richest surface — the coastal impact report — requires the
storm to *complete* and then a below-the-fold scroll inside the 372 px flight
recorder. During a run there is no ranked view of which cities are being hit
or how much rain has landed anywhere.

## Direction (agreed)

Map-first overhaul delivered as **four sequenced PRs**, each leaving main
green and shippable, in this order:

1. **Impact board** (this spec, in full) — always-visible effects panel.
2. **Shared camera** — pan/zoom per the ROADMAP item-7 contract.
3. **Regional rain ledger** — baked Oman governorates (admin-1) + named
   HydroSHEDS wadi basins; per-region rain aggregation; worst-hit readout.
4. **Ensemble on-map** — automatic small ensemble + on-map envelope,
   perturbation-frequency wording only.

Desktop-first: mobile keeps working via existing compact breakpoints with
minimal board adaptations; the dedicated mobile pass stays a later phase.

---

## Phase 1 — Impact board (this PR)

### What it is

A new always-visible chrome panel, `#impact-board`, that becomes the ONE home
for storm effects. It appears on spawn, updates every frame while the storm
runs, **persists unchanged through completion and replay**, and resets on the
next spawn. The debrief's buried `#impact-report` section and the conditional
`#impact-live` one-liner are removed — the board supersedes both (dedupe, not
duplication).

### Placement

Bottom instrument row, desktop: flight recorder (physics, bottom-left,
unchanged) → **impact board** (`left: 404px; bottom: 96px`, width ~340 px,
same max-height clamp as the recorder) → analysis dock shifts right
(`left: ~760px`) when both recorder and board are visible. Z-index 6 with the
other chrome. All positioning lands in the style.css "Windy-grade P1" section
with `#app #impact-board` specificity, colours only via `src/tokens.ts`
custom properties.

Responsive (minimal, desktop-first): ≤1282 px width shrinks ~300 px;
≤820 px the board collapses to a one-line strip (headline + flood chip)
directly above the timeline, tap toggles `data-expanded` to reveal vitals +
city table (same idiom as the recorder's details toggle). No new mobile
redesign beyond that.

### Content, top to bottom

1. **Header**: `impact board` + persistent tag `parametric proxy` (product
   honesty: this is the existing "coastal impact · parametric proxy" label
   promoted to an always-visible surface; never dropped).
2. **Headline** (aria-live=polite): while running, the most-exposed-city
   phrase (reuses the `impact.summary().live` + `experiencedWindPhrase`
   logic that today powers `#impact-live`, but always present once a storm
   exists — "watching sur · 214 km out" when nothing is in reach). After
   completion, the final report headline (existing "ashore in the indicative
   … band near …" / "stayed offshore …" phrasing moves here verbatim).
3. **Vitals row** (definition list): peak-so-far (kt 1-min) · landfall
   status · max land rain (mm) with the flood chip (`data-risk` tiers,
   existing colours). **Landfall is a recorded fact only** — "over water" or
   "landfall +38 h near 19.7°N 57.7°E". Never an ETA and never a predicted
   location: an ETA is a forecast claim this product must not make
   (masthead disclaimer + ROADMAP honesty rules).
4. **Ranked city table**: all 8 `IMPACT_CITIES`, one row each — label ·
   **now** (parametric wind at the displayed frame, so scrubbing a replay
   moves it) · **peak** (kt) · **rain** (mm). Sorted by now-wind desc, then
   peak desc, then closest-approach asc; ties keep catalogue order. Rows
   with peak ≥ 20 kt get the category tint (via `categoryRgba`); the
   all-clear state renders the existing "no damaging winds reached any
   city" line. Clicking a row opens the same `#city-detail` card as
   clicking that city's map marker (one code path, no second detail UI).

### Architecture

- **`src/impact-board.ts` (new, ~200–300 lines)** — follows the
  intensity-sparkline pattern:
  - `buildImpactBoardModel(view): ImpactBoardModel` — a **pure function**
    from a plain view object (storm frame, `ImpactSummary`, debrief bits,
    landfallKt, milestones, complete/replay flags) to fully formatted
    strings + a stable `key`. Node-testable, no DOM, no clock, no RNG.
  - `ImpactBoardView` — a thin class holding element refs; `update(model)`
    rewrites DOM only when `model.key` changes (the `impactCitiesKey`
    caching idiom, generalized).
- **`src/ui.ts`** — instantiates `ImpactBoardView`, builds the model inside
  `updateFlightRecorder(...)` (the view object already carries `impact`,
  `landfallKt`, `debrief`, `milestones` — **zero main.ts changes**), and
  deletes the `#impact-report` / `#impact-live` write paths. Wires row
  clicks to the existing city-detail open path.
- **`index.html`** — adds the `#impact-board` skeleton; removes the
  `#impact-report` section and `#impact-live` from the recorder.
- **`src/style.css`** — board styles + responsive rules, P1 section.
- **No touches** to `src/sim.ts`, `src/impact.ts` recording paths,
  `src/render/*`, loader/bake, or any calibration surface.

### Data flow (unchanged upstream)

`tickSim` → `impact.record(...)` (existing, fixed 15-min steps) →
per-frame `impact.summary(storm)` in `render()` (already computed once,
main.ts ~L2853) → `ui.updateFlightRecorder(view)` → board model → DOM.
The board is pure presentation over existing read-only views; determinism
and the flight tape are untouched. Now-wind per city reuses the same
`windAtPointKt` values the city markers already compute each frame —
computed once in ui.ts and shared, not recomputed.

### Error handling

- No storm yet → board hidden (like the recorder).
- `impact === null` (event modes before first tick) → board hidden.
- Replay scrub → now-column follows the scrubbed frame; peak/rain/flood stay
  the run totals (they are storm-total ledgers).
- Missing landfall milestone → "over water" (never blank).

### Testing

`test/impact-board.test.ts` (node, like the rest of the suite):

- ranking: now-wind desc → peak desc → closest asc → catalogue order.
- live vs complete headline selection; all-clear line when no city ≥ 20 kt.
- landfall vitals: fact phrasing, "over water" fallback, no ETA strings.
- flood chip text/tier passthrough for all four tiers.
- model `key` stability: identical inputs → identical key; any visible
  change → new key (guards the DOM-skip cache).
- replay: model built from a scrubbed frame uses that frame's now-winds.

Existing suites must stay green: `npm test`, `npm run build`. Calibration
untouched ⇒ `calibrate:check` / HF-6 checks unaffected (CI enforces).

### Acceptance

- With a storm running: ranked wind + rain + flood status for all 8 cities
  visible with **zero interactions** on desktop.
- After completion: the same panel still shows the full report — no waiting,
  no scrolling, no hidden sections.
- Exactly one impact surface exists (report + live line removed).
- "parametric proxy" label always visible on the board; SIMULATED stamp and
  masthead disclaimer untouched.

---

## Phase 2 — shared camera (contract only, next PR)

Implements ROADMAP item 7 as written: one view-bbox/camera in `src/grid.ts`
(data domain stays separate), every geo↔clip conversion routed through it,
one shared view transform per shader, cover-fit so the map can go
edge-to-edge, wheel/drag/pinch zoom clamped to the baked domain, physics and
recorded output untouched, deterministic-screenshot acceptance tests.
Known landmines to fix in the same PR (constants that do NOT derive from
`DOMAIN` and would silently break under a camera):
`HALF_DOMAIN_HEIGHT_KM = 666` (render/storm-radii.ts), the `rmwKm/666` and
`(20·cos(lat))/12` literals (render/radar.ts), `cloudMetricX`
(render/cloud-motion.ts). The sim domain (despawn boundary) never changes —
enlarging it would break byte-identical replays and the sealed gates.

## Phase 3 — regional rain ledger (contract only)

- **Bake side**: rasterize Oman governorates (admin-1, Natural Earth or
  geoBoundaries) and HydroSHEDS basin ids to a region-id layer on the
  impact grid's 200×120 · 0.1° geometry, written through the three-way bin
  contract (`bake/binfmt.py` + `src/loader.ts` + BINARY-FORMATS.md incl.
  golden vector — change one, change all three). Region-id → display-name
  table ships as a JSON sidecar (precedent: `upper.json`). Basin names come
  from a curated table for major wadis; unnamed basins aggregate as
  "unnamed basin (id)".
- **Runtime**: per-region sum/mean/max over the existing deterministic rain
  ledger, computed in `summary()` (read-only), surfaced as a ranked
  "worst-hit regions" block on the impact board with per-window support
  (1h/3h/6h/24h/storm).
- **Honesty**: totals inherit the "parametric proxy · not validated against
  observed rainfall" labelling; flood tiers stay point-burst proxies and are
  not applied to areal means.

## Phase 4 — ensemble on-map (contract only)

Automatic 20-member ensemble after spawn (idle-scheduled, within the
device/frame budget rules in ROADMAP), percentile track envelope drawn on
the map by default with member tracks on demand, headline frequencies
(hurricane-strength, landfall) surfaced on the impact board. All wording
stays **perturbation frequency** — never probability, never %-chance
(HF-4 gate rejection is binding).

## Rejected alternatives

- Bottom-right board placement — collides with the layer rail on short
  viewports (rail bottom can reach ~840 px on 1080p with a workbench open).
- Landfall ETA in vitals — forecast claim; violates product honesty rules.
- Big-bang single branch for all four phases — giant diff, conflicts with
  the parallel realism session, violates one-PR-one-concern.
- Camera before HUD — riskiest work first with no UX payoff; the HUD is
  floating chrome and survives the camera change without rework.
