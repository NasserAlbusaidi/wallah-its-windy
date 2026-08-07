# Regional Rain Ledger (UX v2 Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-region rain totals — Oman governorates (admin-1) + named wadi
basins — aggregated read-only from the existing deterministic rain ledger and
surfaced as a ranked worst-hit block on the impact board, with the region-id
raster baked through the three-way bin contract (phase 3 of
`docs/superpowers/specs/2026-08-06-impact-board-ux-v2-design.md`).

**Architecture:** `bake/bake_regions.py` writes `public/data/regions.bin`
(two unquantized categorical layers on the impact grid geometry: `admin1`
uint8 governorate ids, `wadi` uint16 compacted basin ids) plus
`public/data/regions.json` (id→name tables + provenance, upper.json
discipline). Runtime: `ImpactTracker.setRegions(...)` resamples ids per
impact cell (setLandMask idiom); `summary()` attaches a lazily-cached
(version-keyed) per-region aggregation over `totalMm` and the currently
selected window grid; the board renders a capped ranked block that follows
the existing `#accum-window` selection. No change to `record()`, the flight
tape, or any sealed gate.

**Tech Stack:** Python bake (venv: numpy + rasterio already present), WIWB
bin format v1 (no format change — golden vector untouched), vanilla TS.

## Global Constraints

- Zero runtime npm deps; loader stays the ONLY .bin reader.
- `record()`'s deposit math and loop order are pinned
  (`test/impact.test.ts` 9-dp sum + run-twice determinism) — aggregation is
  read-only, allocation-stable, fixed iteration order, no clock/RNG.
- Bin format v1 unchanged ⇒ BINARY-FORMATS.md golden vector, binfmt
  GOLDEN_HEX, and loader.test.ts GOLDEN_HEX are all UNTOUCHED. New file
  gets its own BINARY-FORMATS.md section + integration-bins describe block.
- Layer names ≤ 8 ascii bytes; must NOT reuse `basin` (flowacc.bin owns it);
  regions.bin is its own resource key, never merged into terrain.
- Categorical layers unquantized: dtype uint8/uint16, quant=False, scale=1.0,
  offset=0.0 (bit-exact through the Float32 dequantize path); ids compacted
  (np.unique) before write so uint16 clipping can never alias.
- `npm run assets:manifest` regen ships in the SAME commit as the new
  public/data files (asset-manifest.test.ts auto-enumerates).
- Missing/corrupt regions.bin or regions.json degrades to "no regions
  block" — never throws (MANIFEST 404-tolerance; routeLoaded json branch
  MUST get an explicit `regions` key or the sidecar is silently discarded).
- Honesty: block keeps the board's `parametric proxy` tag and introduces
  the spec's user-facing copy "not validated against observed rainfall";
  flood tiers are NEVER applied to areal values; URL hash untouched (window
  selection stays ephemeral).
- Frozen gates green after every task; calibration surfaces untouched
  (impact.summary is UI-only — verified by recon grep).

## Region model (shared)

```ts
// src/impact.ts additions
export interface RegionRainRow {
  id: number;
  name: string;                     // from regions.json; wadi fallback "unnamed basin <id>"
  kind: 'governorate' | 'wadi';
  /** Max cell value inside the region, mm — the ranking key. */
  windowMaxMm: number;              // selected window grid (== storm when window='storm')
  stormMaxMm: number;               // storm-total grid
  /** Mean over the region's cells inside the domain, mm. */
  stormMeanMm: number;
}
export interface RegionRainSummary {
  window: RainAccumulationWindow;   // the window the windowMaxMm column used
  rows: RegionRainRow[];            // ranked windowMaxMm desc, then stormMaxMm desc, then id asc; capped at 6; only rows with stormMaxMm >= 1
}
// ImpactSummary gains: regions: RegionRainSummary | null  (null until data lands)
```

- `setRegions(bin: ParsedBin | null, names: RegionNamesTable | null)`:
  nearest-resample `admin1`/`wadi` layers (via each layer's own header grid,
  never assuming 200×120) into two preallocated Uint16Array(24000); ids are
  `Math.round(layer.data[...])`. Missing layer/names → regions stay null.
- Aggregation runs inside `summary()` behind a cache keyed on
  `(this.version, this.rainWindow)`: one row-major pass over 24 000 cells
  accumulating sum/max/count per region id into preallocated Float64/Uint32
  scratch arrays sized by max id (allocated once in setRegions). Wadi rows
  without a name entry use `unnamed basin <id>`; only top-6 shown, and the
  build drops sub-1 mm rows. Cost per bump ≈ 50k ops — trivial; cache makes
  steady-state frames free.

## Tasks

### Task 0: Bake environment feasibility (worktree)

- [ ] Check `bake/.venv` exists in the worktree; if not, create it
  (`python -m venv bake/.venv` + `node bake/run-python.mjs -m pip install -r bake/requirements.txt`).
- [ ] Check `data/raw/` for the cached HydroSHEDS zips (copy from the main
  tree `D:\personal\wallah-its-windy\data\raw\` if present there — it is a
  cache, not source).
- [ ] Verify the geoBoundaries OMN ADM1 URL resolves (gbOpen release,
  pinned versioned raw URL; record the final URL + license CC BY 4.0 in
  bake/README.md attribution section). If unreachable, STOP and surface.

### Task 1: bake_regions.py → regions.bin + regions.json

**Files:** Create `bake/bake_regions.py`; modify `bake/sources.py` (new
download entry), `package.json` (`data:regions`, `data:regions:check`),
`BINARY-FORMATS.md` (regions.bin section), `bake/README.md` (attribution);
generated `public/data/regions.bin`, `public/data/regions.json`,
regenerated `calibration/asset-manifest.json`.

- Grid: nx=200, ny=120, bbox DOMAIN (mirror impact.ts constants; the
  integration test pins them so drift is loud).
- `admin1` (uint8): rasterio.features.rasterize of geoBoundaries OMN ADM1
  polygons (GeoJSON dicts direct; all_touched=False, transform from DOMAIN)
  with ids 1..N in shapeName-sorted order; 0 = none. Names table from
  shapeName.
- `wadi` (uint16): derive basins on the TERRAIN grid exactly as the flowacc
  bake does (reuse bake/hydrosheds.py functions on the cached DIR zip),
  majority-resample (mode over covered terrain cells, land-only) to the
  impact grid, drop basins smaller than 4 impact cells (noise), compact ids
  with np.unique; 0 = none/ocean.
- Names: curated anchor table `[(name, lat, lon), ...]` of ~14 major Oman
  wadis (Samail, Dayqah, Aday, Bani Khalid, Halfayn, Andam, Bani Awf,
  Ghul/Nakhr, Mistal, Ma'awil, Sahtan, Darbat, Bani Kharus, Al Abyad);
  resolved to compacted ids AT BAKE TIME by sampling the wadi layer at the
  anchor cell (log every resolution; an anchor resolving to 0 is a bake
  WARNING, not an error). Names keyed to geography ⇒ rebakes cannot
  mislabel.
- regions.json: `{ version: 1, bin: 'data/regions.bin', grid: {...},
  admin1: {id: name}, wadi: {id: name}, source: {...provenance+license} }`,
  json.dumps sort_keys indent=2 + '\n', tmp+os.replace, `--check` rebuilds
  both in memory and byte-compares. `[assert]` golden vector printed first.

- [ ] Write the script; run `npm run data:regions`; eyeball the id rasters
  (quick matplotlib-free ASCII/PNG dump or value histograms in the log).
- [ ] `npm run data:regions:check` green; `npm run assets:manifest`.
- [ ] Commit (bin + json + manifest + script + docs together).

### Task 2: integration pins for the new file

**Files:** Modify `test/integration-bins.test.ts`.

- [ ] New describe block loading the REAL `regions.bin` via the existing
  loadBin helper: pins exact layer names ('admin1','wadi'), nx=200, ny=120,
  bbox=DOMAIN, nt=1, quantized=false, scale=1, offset=0, dtypes; all values
  integer-exact (`v === Math.round(v)`), admin1 max ≤ 12, wadi max equals
  the largest id in regions.json's wadi table or above (compaction sanity);
  regions.json parses, its grid echo matches the bin headers, and every
  named id exists in the corresponding raster.
- [ ] `npm test` green (manifest already regenerated in Task 1). Commit.

### Task 3: runtime aggregation in impact.ts (TDD)

**Files:** Modify `src/impact.ts`, `src/main.ts` (MANIFEST entries + json
route branch + `impact.setRegions(...)` handoff in loadAll); test
`test/impact-regions.test.ts` (new).

- [ ] Failing tests first (synthetic 200×120 BinLayer fixtures via the
  existing test helpers): region sums/max/mean correctness against
  hand-computed deposits; ranking + cap + sub-1mm drop; window switch
  changes windowMaxMm but not stormMaxMm; regions null when layers missing;
  run-twice determinism (toEqual) with regions active; cache: two summary()
  calls without a version bump return the identical rows array reference.
- [ ] Implement per the Region model section. `npm test` green; the pinned
  9-dp deposit test untouched. Commit.

### Task 4: worst-hit block on the impact board (TDD)

**Files:** Modify `src/impact-board.ts`, `src/ui.ts` (pass
`impact.regions` through — already inside ImpactSummary — plus the active
window travels IN the summary, so no new main.ts→ui coupling), `index.html`
(block skeleton after `#impact-board-cities`), `src/style.css` (row styles
at `#app #impact-board .impact-board-region` specificity; add the new
elements to BOTH the ≤820px collapsed hide list AND the [data-expanded]
show list).

- Model: ImpactBoardModel gains `regionRows: {id,label,windowText,stormText}[]`
  + `regionsTitle: string | null` (e.g. `worst-hit regions · trailing 3 h`
  / `· storm total`) + all strings fold into the change-detection key.
  Copy: block sub-caption `parametric rain · not validated against observed
  rainfall`. No flood-tier colouring on region rows (plain text values).
- Empty states: regions null (data missing) or zero rows → block hidden
  (`regionsTitle: null`).
- [ ] Failing model tests: rows built + ranked from RegionRainSummary;
  window title text for each of the five windows; key moves on window flip
  with identical totals; hidden when regions null/empty; honesty copy
  present verbatim.
- [ ] Implement model + view + DOM + CSS; `npm test && npm run build`.
- [ ] Headless QA: coastal storm a few sim-hours in (e.g.
  `#lat=21.5&lon=59.8&month=9&seed=77`), board shows ranked governorates/
  wadis; accum layer active + window switched via the workbench (needs a
  pointer click — if headless can't click, verify window plumbing via the
  model tests and QA storm-total visually); mobile 390×844 collapsed strip
  does NOT leak region rows; expanded shows them.
- [ ] Commit.

### Task 5: docs, review, gates, PR

- [ ] `docs/architecture.md` (bake_regions + regions resource + board
  block rows), `ROADMAP.md` (phase 3 complete entry; item 9 partial note),
  repo `CLAUDE.md` only if a new invariant emerged (regions.bin three-way
  note fits the existing binary-pipeline section — add one line).
- [ ] Adversarial review workflow over `git diff d0ad5b9...HEAD`
  (lenses: bake/data correctness incl. rasterization + resample, runtime
  determinism/perf, board/UI states, contract/test coverage).
  Fix confirmed findings.
- [ ] Full gate sweep (`npm test`, build, calibrate:check, realism:check,
  HF-6 ×3) + `npm run data:regions:check`.
- [ ] Push `feat/region-rain`, PR (summary + test plan), watch CI.

## Self-review notes

- Spec coverage: bake through the three-way contract ✓ (Task 1-2; contract
  is additive so the golden vector is deliberately untouched — documented),
  JSON sidecar ✓, per-region sum/mean/max in summary() read-only ✓ (Task 3),
  ranked worst-hit block with per-window support ✓ (Task 4 — follows the
  existing accum-window selector; all five windows), honesty labels ✓,
  unnamed basins fallback ✓.
- Known accepted costs: governorate set is Oman-only (Iran/Pakistan land
  cells carry no admin region — spec scoped it so); wadi names are curated
  anchors (bake logs resolutions; misresolution shows as a wrong label,
  not wrong numbers); the regions block shows the max/mean of an ~11 km
  parametric grid — labelled as such.
