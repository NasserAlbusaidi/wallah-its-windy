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
- `ensemble.bench.ts` — steady-state 20/40/80-member performance profile.

The committed subset contains six-hour main-track tropical fixes only. All
position and structure values come from USA/JTWC columns. R34 is scored from
2019 onward; R50 and R64 from 2022 onward. RMW is always exploratory and never
contributes to parameter selection.

## Commands

```bash
# Re-extract the committed subset from the pinned raw source.
npm run data:structure

# Re-run search and regenerate both reports.
npm run calibrate:structure
npm run calibrate:intensity
npm run profile:ensemble

# Fail if data, metrics, reports, gates, or live parameters drift.
npm run calibrate:check
```

The extraction command requires `data/raw/ibtracs.NI.csv`; the normal bake
downloads it. CI needs no network because it evaluates the committed subset.

The current search candidate is deliberately rejected: it improves calibration
storms but worsens the untouched validation objective. Live parameters
therefore remain on the pre-calibration reference.
