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

## Selected UX investment

- Build one shared pan/zoom view transform across `grid.ts`, every shader, and
  every canvas/DOM overlay.
- Keep live mode in HF-5 behind its data freshness, provenance, failure, and
  prospective-verification contracts.

## Parked product work

- GIF/satellite-loop export.
- HydroSHEDS DIR downstream flood-pulse routing.
- Generated forecast-office-style advisories with explicit simulation labels.
- Mobile layout, touch controls, accessibility, and device performance budgets.

These remain behind the frozen scientific gates and prospective evidence
requirements in the roadmap.
