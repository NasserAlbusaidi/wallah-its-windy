# Calibration and validation

This directory keeps the North Indian Ocean validation reproducible and
separate from the browser runtime. It holds the pinned observation subsets,
offline forcing, metric runners, and the frozen contracts and acceptance
evidence for phases HF-1 through HF-6.

## Files

- `data/ibtracs-ni-jtwc-2019-2024.json` — pinned normalized subset of the
  official IBTrACS v04r01 North Indian basin CSV.
- `run.mjs` — imports the exact runtime model, creates whole-storm splits,
  evaluates the baseline, searches calibration storms, and applies held-out
  acceptance gates.
- `results.json` — machine-readable dataset manifest, baseline/proposed/deployed
  metrics and parameters, acceptance decision, and live-parameter consistency.
- `../docs/structure-calibration.md` — generated human-readable report.
- `hindcast.mjs` — exact ten-event free-replay runner, bounded joint intensity
  search, and frozen 7/3 complete-storm acceptance split.
- `hindcast-results.json` — per-storm/aggregate baseline, proposal, deployed
  decision, and live-parameter consistency.
- `../docs/hindcast-benchmark.md` — generated historical-replay report.
- `fidelity-catalog.json` — frozen 30-storm HF-1 identities, source checksum,
  initialization contract, and 18/6/6 development/validation/test split.
- `data/fidelity-tracks.json` — normalized USA/JTWC truth tracks for HF-1.
- `data/fidelity-scenarios.json` — exact forcing-bin and initialization metadata.
- `data/fidelity/` — compact forcing bins for the 20 cases that are not featured
  in the browser; these files are calibration-only and never ship in `public/`.
- `fidelity.mjs` — exact-runtime lead-time verification, persistence comparison,
  storm-level bootstrap, and validation drift gate.
- `fidelity-results.json` — all storm, aggregate, lead-time, baseline, confidence
  interval, parameter, and input-manifest results.
- `fidelity-reference.json` — locked validation-only regression reference. The
  permanent final test is intentionally absent from the acceptance gate.
- `../docs/fidelity-benchmark.md` — generated HF-1 observational report.
- `ensemble.bench.ts` — steady-state 20/40/80-member performance profile.
- `select-demo.mjs` — reproducible ambient-demo seed selection after physics
  changes (`npm run calibrate:demo`).
- `satellite-cloud-validation.json` — frozen, timestamp-matched Shaheen
  cold-cloud morphology screen. It is a visual-structure check, not a
  radiometric or forecast-skill result; see
  `../docs/satellite-cloud-validation.md`.

## HF-2 through HF-6 files

Each later phase adds a contract written before evaluation, a gate runner, and
machine-written acceptance evidence:

- `hf2-contract.json` … `hf6-contract.json` — per-phase scope, thresholds, and
  selection rules; `hf2a-contract.json` and `hf6-contract.json` record their
  lock/seal timestamps.
- `hf2-gate.mjs`, `hf2a-ocean-gate.mjs`, `hf3-gate.mjs`, `hf4-gate.mjs`,
  `hf5-gate.mjs`, `hf6-gate.mjs` — regenerate the matching
  `hf*-acceptance.json` verdict; `hf6-gate.mjs` also regenerates
  `../docs/hf6-scorecard.md`.
- `hf2-candidate-selection.json`, `hf2a-candidate-selection.json`,
  `hf3-candidate-selection.json` — development-partition candidate picks, each
  pinning its evidence artifact by SHA-256.
- `fidelity-development-*.json` and `fidelity-validation-*-selected.json` —
  tagged partition snapshots written by `fidelity.mjs --partition=… --tag=…`;
  the `*-selected` files are gate evidence.
- HF-2A upper-ocean benchmark: `data/hf2a-ocean-observations.{bin,json}`,
  `data/hf2a-event-ocean.{bin,json}`, `hf2a-ocean-reference.mjs`, the frozen
  `hf2a-ocean-reference.json`, and the `hf2a-ocean-candidate*.json` runs. The
  observed track and wind force both ocean models, isolating ocean response
  from forecast error.
- `data/hf2-initial-structure.json` — baked initial wind structure for the
  HF-1 storms.
- HF-3 steering: `data/hf3-steering-manifest.json` and `data/hf3/` (30
  steering bins, one per HF-1 storm); `hf3-wander-calibration.mjs` writes
  `hf3-wander-calibration.json`.
- HF-4: `hf4-verify.mjs` writes `hf4-verification.json`;
  `hf4-performance.json` holds the ensemble timing evidence.
- HF-5: `data/hf5/sample-live-run.json` — sample archive input for the gate.
- HF-6: `data/hf6-case-catalog.json` (72 candidate cases, sealed 2026-07-21
  before any candidate evaluation), `data/hf6-tracks.json`, `data/hf6/`
  (16 sealed scenarios across 8 storms with two initializations each, their
  forcing and steering bins, and the prospective registry — currently empty,
  awaiting future storms), `hf6-observation-audit.json`, and `hf6-verify.mjs`
  writing `hf6-sealed-verification.json`.

Frozen artifacts — the contracts, candidate selections, `*-selected`
snapshots, `fidelity-catalog.json`, `fidelity-reference.json`,
`hf2a-ocean-reference.json`, the HF-6 catalogue and sealed scenarios, and
`satellite-cloud-validation.json` — were written before the evaluations they
gate. Regenerating them re-opens the corresponding seal; use the `:check`
commands, which verify without rewriting.

The physical-structure subset contains six-hour main-track tropical fixes only.
All position and structure values come from USA/JTWC columns. R34 is scored
from 2019 onward; R50 and R64 from 2022 onward. RMW is always exploratory and
never contributes to parameter selection. HF-1 separately retains every
available main-track USA/JTWC fix for its frozen storms so exact 12/24/48/72-hour
interpolation does not discard valid three-hour observations.

## Commands

```bash
# Re-extract the committed subset from the pinned raw source.
npm run data:structure

# Re-run searches and regenerate the generated reports.
npm run calibrate:structure
npm run calibrate:intensity
npm run fidelity
npm run profile:ensemble

# Re-run after capturing same-domain observed and simulated grayscale frames.
python3 bake/validate_satellite_structure.py --help

# Fail if structure, intensity, or HF-1 data, metrics, reports, or live
# parameters drift. This is what CI runs; HF-2+ gates are checked separately.
npm run calibrate:check

# Verify each frozen HF gate without rewriting its artifacts.
npm run hf2:gate:check
npm run hf2a:ocean:gate:check
npm run hf3:gate:check
npm run hf3:wander:check
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf5:gate:check
npm run hf6:verify:check
npm run hf6:gate:check
```

The extraction command requires `data/raw/ibtracs.NI.csv`; the normal bake
downloads it. CI needs no network because it evaluates the committed subset.

Rebuilding HF-1 from raw sources is a separate offline workflow:

```bash
npm run data:fidelity:catalog
npm run data:fidelity:fetch
npm run data:fidelity:bake
npm run fidelity
```

Only the fetch step needs a configured CDS API token and accepted ERA5 licence;
the bake also lazily caches the required NOAA WOA23 monthly profiles. Once the
compact bins are committed, `npm run fidelity:check` is deterministic and
network-free. It requires the catalogue checksum and validation track, wind,
and pressure sample counts to remain fixed, and rejects corresponding MAE
regressions over 5%.
The 18 development storms may support future tuning; the 6 validation storms
decide acceptance; the 6 permanent test storms are report-only final audits.

The HF-6 raw rebuild mirrors this (`data:hf6:catalog`, `data:hf6:fetch`,
`data:hf6:bake`, `hf6:observation-audit`), but the catalogue is sealed — run
`npm run data:hf6:catalog:check` instead of regenerating unless the seal is
deliberately being replaced.

Current decisions: the structure search candidate is accepted and deployed —
the held-out objective improved at least 4%, R34 MAE at least 10%, with
pressure and R50/R64 within bounds. The intensity hindcast candidate remains
rejected: it improves calibration storms but fails an untouched held-out gate,
so live intensity parameters stay on the baseline. Both runners assert
live-parameter consistency against the shipped defaults.
