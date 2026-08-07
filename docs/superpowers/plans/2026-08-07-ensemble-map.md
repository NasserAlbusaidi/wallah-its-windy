# Ensemble On-Map (UX v2 Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatic 20-member ensemble after a real spawn, a time-indexed
percentile track envelope on the map by default with member tracks on demand,
and headline hurricane-strength / landfall perturbation frequencies on the
impact board.

**Architecture:** Reuse the existing deterministic engine + worker path
unchanged (`makeEnsembleMembers`/`runStorm`/`summarizeEnsemble` via
`ensemble.worker.ts`). Add a pure envelope builder (`src/ensemble-envelope.ts`),
a facade render layer (`src/render/ensemble.ts`) slotted between ghosts and the
live track, cooperative worker cancellation, a versioned auto-run eligibility
gate in `performance.ts`, and an impact-board block using the phase-3 regions
template.

**Tech Stack:** Vanilla TS, Canvas 2D overlay, module worker. Zero new deps.

## Global Constraints

- Wording: **perturbation frequency** only — never "probability", never
  %-chance (HF-4 rejection binding). Board block renders counts:
  "N of 20 members".
- Determinism: ensemble result stays a pure function of
  (spawn, samplingMode, count); scheduling may read device tier/clock, the
  request payload may not. Envelope math runs in lat/lon, never through the
  camera view.
- Frozen gates stay green untouched: `calibrate:check`, `realism:check`,
  HF-6 ×3. `EnsembleResult` changes must be additive only
  (hf4-verify.mjs + test/ensemble.test.ts consume it).
- Camera stays presentation-only; `latLonToClip` stays camera-unaware.
- Colours only via `src/tokens.ts` (test/tokens.test.ts pins the palette).
- All seven existing `#ensemble-*` dock ids keep working (must() at boot).
- Board: every new visible string joins the change-detection key; new block
  added to BOTH mobile hide list and `[data-expanded]` reveal.

## Load-bearing recon facts

- Track points land at `ageH = 0.25 + 3k` (record fires after the first
  15-min tick), plus one off-step death point — envelope must match points by
  expected age (epsilon), not raw index.
- Every environment change funnels through `doSpawn` (scenario enter
  main.ts:1330, mode change :2899, climatology restore :1372/:1378) — one
  hook covers respawn + env-change invalidation.
- No cancellation exists: `analysisRequestSeq` only discards results; the
  worker computes queued jobs to completion. Auto-run needs cooperative
  cancel (macrotask yield between members + cancelled-request set).
- `drawEnsembleOverlay` (main.ts:2954) currently draws ABOVE the live track
  (luminance-rule violation) and uses raw `window.devicePixelRatio` while the
  canvas is dprCap-sized — both fixed by the facade layer move.
- ROADMAP 463-474 is the binding contract incl. "versioned device and
  frame-time budget" — the artifact does not exist; this phase defines
  eligibility as a versioned `RenderProfile.autoEnsemble` flag (desktop tier
  only; phone/mid keep the explicit Run fallback).

---

### Task 1: Percentile envelope builder (pure)

**Files:** Create `src/ensemble-envelope.ts`, `test/ensemble-envelope.test.ts`.

**Produces:** `buildEnsembleEnvelope(members: readonly StormRun[], opts?):
EnsembleEnvelope | null` where `EnsembleEnvelope = { nodes:
{ ageH, lat, lon, radiusKm, members }[], polygon: { lat, lon }[] }`.

- [ ] Failing tests: age-matched alignment (death points excluded), per-lead
  median centre + p90 great-circle radius hand-checked on a 3-member fixture,
  envelope truncates when alive members < max(4, 30% of count), null on
  <2 usable leads, run-twice determinism, polygon closed ribbon
  (left boundary + reversed right + end caps).
- [ ] Implement: expected ages derived from the members' own first points;
  per-lead component-wise median centre; radius = 90th-percentile
  great-circle distance (km); ribbon via perpendicular offsets of the centre
  polyline (km→deg at local latitude), semicircular caps.
- [ ] `npm test` green; commit.

### Task 2: Worker cancellation + auto-run eligibility gate

**Files:** Modify `src/ensemble-protocol.ts`, `src/ensemble.worker.ts`,
`src/ensemble-client.ts`, `src/performance.ts`, `test/performance.test.ts`
(or inline in existing suite).

- [ ] Protocol: `{type:'cancel', requestId}` request; `{type:'cancelled',
  requestId}` response.
- [ ] Worker: module-level cancelled set; member loop yields one macrotask
  between members so queued cancel messages deliver; abort posts 'cancelled'.
- [ ] Client: `requestEnsemble` returns/tracks its requestId;
  `cancelEnsemble(requestId)`; cancelled promise rejects with a typed
  `EnsembleCancelled` marker (callers treat as silent no-op).
- [ ] `performance.ts`: extend `RenderProfile` with `autoEnsemble: boolean`
  (desktop true, phone/mid false) + versioned budget comment
  (`AUTO_ENSEMBLE_BUDGET_VERSION = 1`: 20 members, worker-thread only,
  envelope computed once per result). Tier tests updated.
- [ ] `npm test` green; commit.

### Task 3: EnsembleLayer render facade module

**Files:** Create `src/render/ensemble.ts`; modify `src/render/index.ts`,
`src/tokens.ts`, delete `drawEnsembleOverlay` from `src/main.ts`.

- [ ] New token `ensembleEnvelope` (one rgb triple → CSS var + rgba01).
- [ ] `EnsembleLayer` (GhostLayer template): `init(overlay2d)`,
  `resize(w,h)`, `setResult(result, envelope)`, `setShowMembers(b)`,
  `draw(view)`. Draws frequency grid (existing visual), envelope fill +
  outline (default), member polylines only when toggled; unit-based line
  widths (no raw devicePixelRatio).
- [ ] Facade: instantiate, init in overlay branch, resize/dispose fan-out,
  draw between `ghosts.draw` and `track.draw`; setters
  `setEnsemble(result, envelope)` / `setEnsembleMembersVisible(b)`.
- [ ] main.ts: remove drawEnsembleOverlay + its call; completion handler now
  computes envelope once (`buildEnsembleEnvelope`) and pushes via facade.
- [ ] `npm test` + `npm run build` green; commit.

### Task 4: Auto-run scheduling + lifecycle in main.ts

**Files:** Modify `src/main.ts`.

- [ ] Shared completion path for manual + auto runs (status wording differs:
  "auto ensemble · 20 deterministic members · …" vs existing).
- [ ] doSpawn: cancel in-flight auto/manual ensemble (client cancel + seq
  bump + facade clear), then if `!isDemo && profile.autoEnsemble`, debounce
  ~1.5 s (settle) and fire a 20-member request. Debounce timer cleared on
  every doSpawn.
- [ ] Member-tracks toggle state wired to facade
  `setEnsembleMembersVisible`; reset to off on spawn.
- [ ] Status strings: envelope wording "perturbation-frequency envelope on
  map"; never probability.
- [ ] `npm run build` green; manual headless smoke; commit.

### Task 5: Impact-board ensemble block

**Files:** Modify `src/impact-board.ts`, `src/ui.ts`, `index.html`,
`src/style.css`, `test/impact-board.test.ts`.

- [ ] Model: `EnsembleBoardSummary = { state: 'running'|'done',
  memberCount, completed?, hurricaneCount?, landfallCount? } | null` as new
  `ImpactBoardInput.ensemble`; block builder → `ensembleTitle: string |
  null` ("ensemble outlook · perturbation frequency") + lines
  ("hurricane-strength — 13 of 20 members", "landfall — 9 of 20 members",
  running state "computing members 12/20…") + a members-toggle button row
  ("show member tracks"/"hide member tracks") via `onToggleMembers`
  callback (onCitySelect precedent). HIDDEN_MODEL + key join extended.
- [ ] Tests first: hidden when null / demo, running text, counts wording
  (never '%'), key moves on count + toggle-label change, toggle callback
  fires.
- [ ] HTML: block between `#impact-board-cities` and `#impact-board-regions`
  (headline stays above the scrolling ledger); note copy "perturbation
  frequency · not a calibrated probability".
- [ ] CSS: bordered-section pattern + mobile hide list + expanded reveal.
- [ ] ui.ts: dom lookups, demo branch passes null, live branch threads the
  summary from FlightRecorderView (new optional field, main supplies it).
- [ ] `npm test` green; commit.

### Task 6: Docs, QA, gates

- [ ] ROADMAP: mark "Automatic ensemble envelope" delivered (dated), record
  the versioned budget rule + explicit-Run fallback.
- [ ] docs/architecture.md rows (ensemble-envelope, render/ensemble, board
  block); CLAUDE.md bullet if a new invariant emerged.
- [ ] Headless QA: envelope + board block screenshots (desktop), member
  toggle on-demand, mid-tier fallback (no auto-run).
- [ ] Full sweep: `npm test`, `npm run build`, `npm run calibrate:check`,
  `npm run realism:check`, hf6 ×3, `npm run profile:ensemble` (bench —
  regression measured, not guessed).
- [ ] Commit; adversarial review workflow; fix confirmed findings; PR.
