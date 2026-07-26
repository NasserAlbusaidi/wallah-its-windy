# TODOs

The canonical forward plan is now [ROADMAP.md](ROADMAP.md). The older weekend
design plan has been delivered and is retained only as historical context; it
is no longer the source of truth for project status.

## Scientific phase ledger

- **HF-2 complete, rejected:** dynamic upper ocean, vector ventilation,
  organization memory, structure closure, and coastal exposure are implemented;
  the frozen intensity gate did not fully pass.
- **HF-3 complete, rejected:** pressure-level annular steering, bounded motion
  physics, residual calibration, and CLIPER-style reference are implemented;
  the frozen bias/intensity-regression gate did not fully pass.
- **HF-4 complete, rejected:** uncertainty sources, deterministic substreams,
  CRPS/Brier/rank/coverage verification, conformal cone experiment, and runtime
  budget are implemented; the product remains perturbation frequency.
- **HF-5 infrastructure complete:** provider normalization, visible failure,
  side-by-side guidance, and immutable issuance pass. A scheduled lawful live
  feed is intentionally not configured.
- **HF-6 implementation complete; sealed result rejected:** 72 storms/144
  initializations are audited and the independent 8-storm/16-start first look is
  permanently scored. Track skill passed, intensity/pressure did not, and the
  generated scorecard preserves that result without retuning. Prospective
  acceptance remains open until future storms actually mature.

## Completed roadmap slice

- Point probe with hover, touch long-press, pinning, provenance, and exact CPU
  environment/Holland-profile values.
- Eight accessible impact-city markers with instantaneous 34-kt glow and run
  detail cards.
- Deterministic, versioned WMO/ESCAP simulated storm names in the tape, exports,
  ensemble summary, and stable shared URL.
- Prefix-safe geometric historical analog and an exact flight-tape intensity
  sparkline with pointer and keyboard inspection.

## Delivered after the slice (2026-07-20 → 2026-07-27)

- HydroSHEDS v1.1 ACC+DIR timed downstream flood-pulse routing (`flowacc.bin`
  v1.2: ACC + D8 DIR + travel-time layers; conservative GPU routing pass with
  CPU oracle and legacy-bin fallback).
- Storm room and satellite desk: simulated vs observed IR/VIS with provenance
  labels, Meteosat IODC frame matching, INSAT manifest ingestion, and the
  observed-to-simulated visual handoff.
- Observed radar frames (timestamped RainViewer loop) and deterministic
  1/3/6/24-hour and storm-lifetime rain-accumulation windows with URL-stable
  colour breaks, beside the labelled simulated products.
- Windy-grade UI reskin (PR #11, merge `89f1539`): chrome/glass tokens, panel
  material + type scale, category-coloured timeline with live wind/pressure
  cluster, icon layer rail, eye-pinned storm tag, wind palette retune —
  UI-only; no physics, loader, or calibration change.

## Selected UX investment

- Build one shared pan/zoom view transform across `grid.ts`, every shader, and
  every canvas/DOM overlay.
- Keep live mode in HF-5 behind its data freshness, provenance, failure, and
  prospective-verification contracts.

## Parked product work

- GIF/satellite-loop export.
- Generated forecast-office-style advisories with explicit simulation labels.
- Formal accessibility review and a dedicated mobile-layout pass (device
  performance budgets, tap/pinch touch controls, long-press probe, and compact
  layouts including the icon-only layer rail are already shipped —
  `src/performance.ts`, `src/tap-gesture.ts`, `src/ui.ts`).

These remain behind the frozen scientific gates and prospective evidence
requirements in the roadmap.
