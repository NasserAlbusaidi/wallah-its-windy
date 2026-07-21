# Physical-structure calibration

This directory keeps the North Indian Ocean validation reproducible and
separate from the browser runtime.

## Files

- `data/ibtracs-ni-jtwc-2019-2024.json` — pinned normalized subset of the
  official IBTrACS v04r01 North Indian basin CSV.
- `run.mjs` — imports the exact runtime model, creates whole-storm splits,
  evaluates the baseline, searches calibration storms, and applies held-out
  acceptance gates.
- `results.json` — machine-readable metrics, slices, parameters, decision, and
  source manifest.
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

# Re-run search and regenerate both reports.
npm run calibrate:structure
npm run calibrate:intensity
npm run fidelity
npm run profile:ensemble

# Fail if data, metrics, reports, gates, or live parameters drift.
npm run calibrate:check
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

The current search candidate is deliberately rejected: it improves calibration
storms but worsens the untouched validation objective. Live parameters
therefore remain on the pre-calibration reference.
