# Documentation index

One line per document. Classes:

- **GENERATED** — machine-written by the named npm command. Never edit by
  hand; the command overwrites the file and the gates diff it.
- **LOCKED** — frozen artifact. Changes require a new version, not edits.
- No marker — hand-written; edit freely.

## Root

| File | Class | What it is |
| --- | --- | --- |
| [`../README.md`](../README.md) | — | Project front page: what the simulator is, what it claims, and what it does not. |
| [`../ROADMAP.md`](../ROADMAP.md) | — | Canonical forward plan: scientific and product direction. |
| [`../TODOS.md`](../TODOS.md) | — | Scientific phase ledger plus the delivered weekend plan, kept as history; superseded as plan-of-record by ROADMAP.md. |
| [`../BINARY-FORMATS.md`](../BINARY-FORMATS.md) | — | Spec for the self-describing `WIWB` `.bin` assets; writer `bake/bake.py`, sole reader `src/loader.ts`. |
| [`../CLAUDE.md`](../CLAUDE.md) | — | Working rules for AI-assisted sessions in this repo (created alongside this index). |

## docs/

| File | Class | What it is |
| --- | --- | --- |
| [`architecture.md`](architecture.md) | — | Module map and data-flow reference for the runtime (created alongside this index). |
| [`fidelity-benchmark.md`](fidelity-benchmark.md) | **GENERATED** — `npm run fidelity` | HF-1 30-storm observational truth benchmark report. |
| [`findings-hf1-hf6.md`](findings-hf1-hf6.md) | — | Narrative verdict on HF-1 through HF-6: what each phase attempted and why its gate accepted or rejected it. |
| [`hf2a-dynamic-upper-ocean-spec.md`](hf2a-dynamic-upper-ocean-spec.md) | **LOCKED** | HF-2A dynamic upper-ocean spec; v1 locked and v2 candidate frozen 2026-07-21; machine-readable contract in `calibration/hf2a-contract.json`. |
| [`hf5-live-data-contract.md`](hf5-live-data-contract.md) | — | Provider-neutral boundary contract between operational weather products and the simulation core. |
| [`hf6-scorecard.md`](hf6-scorecard.md) | **GENERATED** — `npm run hf6:gate` | Versioned HF-6 gate scorecard (implementation, sealed first look, prospective evidence). |
| [`hindcast-benchmark.md`](hindcast-benchmark.md) | **GENERATED** — `npm run calibrate:intensity` | Ten-storm historical hindcast benchmark report. |
| [`model-card-hf6.md`](model-card-hf6.md) | — | Model card for the HF-6 reduced-order model: intended use, data, evaluation, limitations. Hand-written; `npm run hf6:gate` checks that it exists. |
| [`satellite-cloud-validation.md`](satellite-cloud-validation.md) | — | Qualitative cloud-morphology screen with an explicit claim boundary; not a forecast-skill score. |
| [`structure-calibration.md`](structure-calibration.md) | **GENERATED** — `npm run calibrate:structure` | North Indian Ocean physical-structure calibration report. |

## docs/superpowers/

Working specs and implementation plans for delivered feature branches; kept as
history once merged.

| File | Class | What it is |
| --- | --- | --- |
| [`superpowers/specs/2026-07-26-windy-grade-reskin-design.md`](superpowers/specs/2026-07-26-windy-grade-reskin-design.md) | — | Design spec for the windy-grade UI reskin: glass panel chrome, type scale, icon layer rail, storm tag pinned to the eye, category-coloured timeline. UI-only; explicitly excludes physics, calibration, data-format, and URL-hash changes. |
| [`superpowers/plans/2026-07-26-windy-grade-reskin.md`](superpowers/plans/2026-07-26-windy-grade-reskin.md) | — | Eight-task implementation plan for the reskin spec; delivered in PR #11 (merge `89f1539`), retained as the execution record. |

## Pipelines

| File | Class | What it is |
| --- | --- | --- |
| [`../bake/README.md`](../bake/README.md) | — | Offline Python bake pipeline: turns free public geodata into the `.bin` files the browser loads; nothing in it ships. |
| [`../calibration/README.md`](../calibration/README.md) | — | Calibration directory: pinned IBTrACS subset and the scripts that run the reproducible validation, separate from the browser runtime. |
