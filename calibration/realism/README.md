# R2a realism measurement harness

Field-space metrics over the **simulated cloud-top brightness-temperature
proxy** — a deterministic CPU twin of the simulated infrared layer. Not
radiometric data, no forecast-skill claim. This is the R2a sim-side scaffold;
R2 is complete only when R2b lands observed derived-statistics references and
the IMERG rain-truth comparison.

## Files

| Path | Role |
| --- | --- |
| `realism.mjs` | Runner entry point: asset loading, replay, per-frame measurement, artifact I/O. |
| `aggregate.mjs` | Numeric protocol: canonicalization, sealed bin edges, the reduction, the reference comparison. |
| `report.mjs` | Markdown generation only — it computes no statistic of its own. |
| `realism-scenarios.json` | **Frozen** scenario set: 5 event replays + 7 climatology triplets, cadence, horizon. |
| `realism-reference.json` | **Sealed** aggregate. Written once, on the first run with no reference present. |
| `realism-results.json` | Full generated run: manifests, per-scenario records, aggregate, gate verdict. |
| `observed/` | R2b observed derived-statistics references + provenance. No raw imagery, ever. |
| `../../docs/realism-benchmark.md` | Generated report. Never hand-edit — the next run reverts it. |

The measurement code lives in `src/realism-proxy.ts` (single import surface,
internally `realism-glsl` / `realism-cloud-sample` / `realism-field`) and
`src/realism-metrics.ts`. Both are measurement-only modules: nothing in
`main.ts` or any render path imports them.

## Commands

```bash
npm run realism         # replay, measure, write results + report (seals on first run)
npm run realism:check   # byte-compare all three artifacts and require gate=PASS
```

Both need `node --experimental-strip-types` (already in the npm script) because
the runner loads the runtime `.ts` through an in-process Vite server.

A full run replays 12 scenarios and rasterizes one 192×192 proxy field every 6
sim-hours; expect roughly a minute on a developer machine.

## What the gate does and does not say

**Regression-only.** `realism:check` proves the simulated product did not move.
It cannot say the product is realistic, and it never will — the observed side
of that comparison is R2b.

Because the gate is descriptive, **drift fails in both directions**. A metric
moving toward the observed world fails exactly like a metric moving away from
it. That is deliberate: an improvement is a claim, and claims go through the
human A/B protocol plus a reseal, not through a silently green check.

The comparison fails when any of these hold:

- the scenario set's SHA-256 differs from the sealed one;
- any `frameCounts` entry differs, is missing, or is extra;
- the sealed and current `aggregate` key trees differ in any key;
- any `count` (or any non-`median`/`mean`) leaf differs at all;
- any `median`/`mean` leaf drifts more than 5% in either direction. A sealed 0
  requires an exact 0, and null-versus-number is always a failure.

**Rollout is advisory.** `realism:check` is deliberately NOT in
`.github/workflows/deploy.yml`. Run it by hand alongside a change that touches
the render composition, the storm structure, or the environment fields.

## Reseal flow

The reference is written only when it is absent. To reseal:

1. Delete `calibration/realism/realism-reference.json`.
2. Run `npm run realism`. It writes a fresh reference from the current code.
3. Record the A/B verdict in `docs/realism-gap-register.md` **in the same PR**.
   A reseal without a recorded human A/B judgement is an unexplained baseline
   move, which is the one thing this harness exists to prevent.

Changing any entry in `realism-scenarios.json` — an id, a spawn, the cadence,
the horizon — re-opens the seal and requires the same three steps.

### Known coverage gap: months 05–07 sealed with 0 frames

`clim-jun`, `clim-jul` and `clim-aug` die of monsoon shear before the first
6-hour sample, so they contribute no measured frames and RGR-001's month
conditioning covers 4 of the 7 season months. This is calibrated model output on
a cohort frozen before any replay ran, and it is sealed as-is deliberately —
re-picking the triplets to make them survive would be tuning the cohort to the
result. Coverage returns through the reseal + A/B flow above; R2b is the natural
moment to revisit it.

## Validation-partition note

Three of the five event replays sit in the hindcast **validation** partition.
These realism metrics tune nothing: no parameter is selected from them, no
acceptance decision reads them, and they must never be cited as track or
intensity evidence. They measure how the simulated *picture* is composed, which
is a different question from how well the storm is forecast. Citing a realism
number in an intensity argument would leak the validation split.

## Cross-platform seal protocol

The first reference was sealed on a single platform (Windows, Node 24.18.0).
Every number passes through `canonicalizeNumbers` at 9 decimal places, which is
what makes cross-platform byte equality plausible — but plausible is not
verified.

Before `realism:check` may be promoted to a CI-blocking gate:

1. Regenerate the artifacts on a Linux runner from the same commit.
2. Require byte-equality with the committed `realism-results.json`,
   `realism-reference.json`, and `docs/realism-benchmark.md`.
3. Only then wire the check into the deploy workflow.

Until that is done, the report carries the single-platform caveat and the check
stays advisory.
