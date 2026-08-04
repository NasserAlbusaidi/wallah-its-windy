# Observed derived-statistics references

Schema only. **Nothing is extracted yet** — this directory currently holds its
own contract (`EXAMPLE.derived-stats.json`) and this README, and no reference
bundle. R2a is the sim-side scaffold; **R2b lands extraction**, the first real
bundles, and the IMERG rain-truth comparison. Until then every number in
`docs/realism-benchmark.md` is sim-side only and has no observed counterpart.

Building the extraction tooling is R2b scope. Do not add a fetcher, a
converter, or a checked-in observed bundle under R2a — the schema is frozen
first so the extractor is written against a fixed target, not the other way
round.

## What lands here

Derived statistics plus a provenance manifest. **No raw imagery, ever** — not
even from sources whose licence would permit it (see Licence rules below).

One file per observed source bundle, named
`<bundleId>.derived-stats.json`. A bundle carries a `metrics` array, so one
source bundle can serve several shortlist entries without duplicating its
provenance block.

The runner lists this directory into the report's "Observed references"
section (`calibration/realism/realism.mjs`, `OBSERVED_DIR`). Two names are
excluded from that listing because they are documentation, not references:
anything starting with `EXAMPLE.`, and `README.md`. A real bundle must
therefore **not** use the `EXAMPLE.` prefix, or the report will silently omit
it.

## Schema v2

`EXAMPLE.derived-stats.json` is the normative shape. Fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `2`. Bump only with a matching update to this README. |
| `source.bundleId` | Stable slug; also the file's basename. |
| `source.product` | Full product name, instrument and access route included. |
| `source.kind` | Coarse class, e.g. `geostationary-ir`, `polar-vis`, `precip-retrieval`. |
| `provenance[]` | One entry per observed frame the statistics were computed from. |
| `provenance[].id` | Local id, referenced by `values[].provenanceIds`. |
| `provenance[].frameId` | The session/stage label the frame corresponds to. |
| `provenance[].validTime` | Observation valid time, ISO 8601 UTC. |
| `provenance[].sourceUrl` | The exact request the frame was retrieved with. |
| `provenance[].acquisitionTimestamp` | When the frame was fetched. |
| `provenance[].accessDate` | Date the source was accessed, for the licence trail. |
| `provenance[].licenceNote` | Why committing this derived statistic is permitted. |
| `provenance[].sha256OfSourceFrame` | Digest of the frame the statistic came from. The frame itself is NOT committed; the digest is what makes the derivation auditable. |
| `metrics[].metricId` | The sim-side metric this is comparable to (vocabulary below). |
| `metrics[].registerEntry` | The `docs/realism-gap-register.md` entry it tests, e.g. `RGR-001`. |
| `metrics[].metricVersion` | Which sim-side metric implementation the value is comparable to. |
| `metrics[].parameters` | The thresholds and regions, **as data**. |
| `metrics[].method` | Prose companion to `parameters` — how the number was computed. |
| `metrics[].values[]` | The statistics themselves, one record per dimension cell. |

### Rules

- Every `dimensions` key — `monthIndex`, `intensityBinKt`, `stage`,
  `radialRegion`, `shearQuadrant` — is **optional per record**. An absent key
  means the record is **marginal** over that dimension, not that the dimension
  is unknown. A record with no `dimensions` at all is the fully marginal
  statistic.
- `value` MUST be `null` whenever `sampleCount` is `0`. A zero-sample cell is
  recorded rather than dropped, so a coverage gap is visible instead of
  inferred from a missing key.
- Every value record MUST cite at least one `provenanceIds` entry, and every id
  it cites MUST exist in this file's `provenance` array. A statistic that
  cannot be traced back to specific observed frames does not belong here.
- `parameters` holds the actual thresholds and regions **as data** — nulls are
  permitted until R2b seals them, prose is not. `method` is the prose
  companion, never the only place a threshold appears. A threshold that lives
  only in `method` cannot be diffed, and re-deriving the statistic later would
  be guesswork.

### Dimension vocabulary

Grounded in the sealed sim-side aggregate (`calibration/realism/aggregate.mjs`)
so the two sides bin identically:

- `monthIndex` — **0-indexed**, matching `realism-scenarios.json` and env.bin's
  layer convention. October is `9`, not `10`.
- `intensityBinKt` — one of the sealed bin ids `020-035`, `035-050`, `050-064`,
  `064-083`, `083-100`, `100-200`, half-open `[minKt, maxKt)`.
- `stage` — `pre-peak` or `post-peak`.
- `radialRegion` — `inner` (r <= 200 km) or `outer` (200 < r <= 600 km), the
  `REALISM_INNER_OUTER_SPLIT_KM` / `REALISM_EDGE_OUTER_LIMIT_KM` split.
- `shearQuadrant` — `dl`, `dr`, `ul`, `ur` (downshear-left/right,
  upshear-left/right), the `RealismShearQuadrantMeans` convention.

### `metricId` vocabulary

The sim-side ids an observed bundle can be compared against are the per-frame
metric names in `src/realism-metrics.ts` (`RealismFrameMetrics`), which are
also the sealed aggregate's leaf keys: `environmentalCloudFraction`,
`eyeContrastC`, `coldTopAreaKm2`, `coldTopCentroidOffsetKm`,
`coldTopAbsCentroidBearingRelToShearDeg`, `bandEdgeInnerCPerKm`,
`bandEdgeOuterCPerKm`, `bandEdgeQuadrantDownshearLeftCPerKm`,
`bandEdgeQuadrantDownshearRightCPerKm`, `bandEdgeQuadrantUpshearLeftCPerKm`,
`bandEdgeQuadrantUpshearRightCPerKm`.

One exception to that correspondence: `environmentalCloudFraction` appears in
`realism-reference.json` only as the block `environmentalCloudFractionByMonth`,
because RGR-001 is conditioned on month rather than intensity. Use the
per-frame id as `metricId` and carry the month in `dimensions.monthIndex`.

### Unresolved before any comparison is meaningful

The sim side measures a **brightness-temperature proxy in °C** — a
deterministic CPU twin of the render, not radiometric data. Observed IR is
radiometric brightness temperature in K. `parameters.observedBtThresholdK`
and `parameters.mapsToSimConstant` sit side by side in the schema precisely
because that correspondence is **not established**. R2b must define and
justify it. A committed observed number does not become comparable to a sealed
sim number just because both files validate against this schema.

## Licence rules

### D2 — derived statistics, never new raw EUMETSAT frames

`docs/realism-gap-register.md` decision D2 (resolved 2026-08-02), verbatim:

> commit derived statistics + a provenance manifest (source URL, product,
> acquisition timestamp, access date — the same fields
> `src/satellite-observations.ts` already tracks per frame) computed from
> EUMETSAT frames; do not commit new raw EUMETSAT frames to the repository.

EUMETSAT's general Terms of Use grant only personal, non-commercial download
and copying by default and require explicit authorization for redistribution;
satellite data and products are excluded from the CC BY-SA Learning Zone
carve-out. The Data Policy's ">= 1 hour latency, without charge for any use"
tier may cover this case but could not be verified from the primary text, so
the rule stays conservative. Live in-app WMS requests to EUMETView are
unaffected — that is direct end-user access, not redistribution.

NASA Worldview/GIBS is licence-clean to commit as raw frames (with the "NASA
Worldview" + permalink citation the existing captures already carry), but that
changes nothing here: this directory holds derived statistics for every source
so the schema and the audit trail stay uniform. Raw reference captures live
under `docs/research/realism/captures/`.

D2 also carries an open flag for the repo owner about 11 raw EUMETSAT SEVIRI
frames already committed under `docs/research/realism/captures/` before D2 was
written. Resolving that exposure is follow-up work tracked in the register, not
in this directory.

### D1 — IMERG is the rain-truth reference

`docs/realism-gap-register.md` decision D1 (resolved 2026-08-02): **GPM IMERG
(NASA GES DISC/PPS) is R2's observed rain-truth reference.** IMERG is
satellite-based, so it covers the open Arabian Sea the same as the coast, with
no ground-radar dependency. Access needs a free NASA Earthdata Login; formats
are HDF5/NetCDF4/GeoTIFF; native grid 0.1°×0.1° (~10 km) at 30-minute cadence.
The **Final Run** (research-grade, gauge-adjusted, ~3.5-month latency) is the
right tier — the paired sessions are archival, not live.

RainViewer was investigated and rejected: it ingests land-based radar only and
its own documentation states open-ocean regions are not covered, so it would
see the coastal edge of an Arabian Sea storm and never its core. It remains
fine as the runtime UI-parity reference for the coastal fringe.

The IMERG comparison itself is R2b. Nothing in R2a reads it.
