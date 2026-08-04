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
- `metricVersion` names the sim-side implementation the observed value was
  matched against. Bump it whenever `src/realism-metrics.ts` or the aggregation
  in `calibration/realism/aggregate.mjs` changes what a metric means, and record
  the bump in `docs/realism-gap-register.md` alongside the reseal it forces. A
  value carrying a stale `metricVersion` is not comparable to the current seal,
  and the string is the only thing that says so.

### Dimension vocabulary

Grounded in the sealed sim-side aggregate (`calibration/realism/aggregate.mjs`),
so an observed record binned on one of these keys lines up with a sealed sim
cell of the same name. The keys are shared vocabulary, **not** a claim that
every metric is binned on every key — each metric's sealed binning is listed in
the `metricId` table below, and an observed record binned on a key the sim side
never binned that metric by has no sealed counterpart to compare against.

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

The ids are the **aggregate's flattened leaf keys**, minted in
`calibration/realism/aggregate.mjs` (lines 93–159). They are not the per-frame
field names in `src/realism-metrics.ts` — the aggregation flattens and renames
as it goes (`coldTop.areaKm2` → `coldTopAreaKm2`,
`bandEdgeEnergy.byShearQuadrant.dl` → `bandEdgeQuadrantDownshearLeftCPerKm`).
Read `aggregate.mjs`, not the per-frame interface, when deciding what an
observed number has to match.

| `metricId` | Sealed binning |
| --- | --- |
| `environmentalCloudFraction` | month only — the block is `environmentalCloudFractionByMonth` |
| `eyeContrastC` | intensity bin only |
| `coldTopAreaKm2` | intensity bin, **and** weak bin × stage |
| `coldTopCentroidOffsetKm` | weak bin × stage, **and** unbinned |
| `coldTopAbsCentroidBearingRelToShearDeg` | unbinned |
| `bandEdgeInnerCPerKm`, `bandEdgeOuterCPerKm` | unbinned |
| `bandEdgeQuadrant{DownshearLeft,DownshearRight,UpshearLeft,UpshearRight}CPerKm` | unbinned |

Two traps in that vocabulary, both of which produce a schema-legal file holding
a silently incomparable number:

- **`coldTopAbsCentroidBearingRelToShearDeg` is the ABSOLUTE bearing.** The
  per-frame field `centroidBearingRelToShearDeg` is signed — compass-framed and
  clockwise-positive, so downshear-left reads negative
  (`src/realism-metrics.ts:98-105`) — and the aggregation takes `Math.abs()` of
  it **per frame, before summarizing** (`aggregate.mjs:136-141`). Observed
  extraction MUST take `|bearing|` per frame before aggregating. Averaging
  signed bearings instead turns a real one-sided displacement into nothing: a
  set of {-80°, +80°} means 0 against a sealed 80.
- **The band-edge ids already encode region and quadrant.** For
  `bandEdgeInnerCPerKm`, `bandEdgeOuterCPerKm`, and the four
  `bandEdgeQuadrant*CPerKm` ids, the radial region and the shear quadrant live
  in the **id**, not in `dimensions`. `dimensions.radialRegion` and
  `dimensions.shearQuadrant` are invalid on band-edge records — a record with
  `metricId: "bandEdgeInnerCPerKm"` and `radialRegion: "outer"` is
  self-contradictory even though nothing in the schema shape rejects it.

### Unresolved before any comparison is meaningful

The sim side measures a **brightness-temperature proxy in °C** — a
deterministic CPU twin of the render, not radiometric data. Observed IR is
radiometric brightness temperature in K. `parameters.observedBtThresholdK`
and `parameters.mapsToSimConstant` sit side by side in the schema precisely
because that correspondence is **not established**. R2b must define and
justify it. A committed observed number does not become comparable to a sealed
sim number just because both files validate against this schema.

This does not have a difference-metric escape hatch. `btProxyC` is the output
of the render's cloud composition, not an affine remap of kelvin, so its
transfer function is unknown and non-linear. Differences, gradients, and
contrasts (`eyeContrastC`, the `bandEdge*` gradients) therefore do **not**
cancel the offset the way they would between two affine-related scales.

## Licence rules

### D2 — derived statistics, never new raw EUMETSAT frames

The D2 rule (`docs/realism-gap-register.md`, resolved 2026-08-02), verbatim —
D2 is a longer decision and this is its operative clause:

> commit derived statistics + a provenance manifest (source URL, product,
> acquisition timestamp, access date — the same fields
> `src/satellite-observations.ts` already tracks per frame) computed from
> EUMETSAT frames; do not commit new raw EUMETSAT frames to the repository.

EUMETSAT's general Terms of Use grant only personal, non-commercial download
and copying by default, **require `© EUMETSAT [year]` attribution**, and require
explicit authorization for redistribution; satellite data and products are
excluded from the CC BY-SA Learning Zone carve-out. The Data Policy's ">= 1 hour
latency, without charge for any use" tier may cover this case but could not be
verified from the primary text, so the rule stays conservative. Live in-app WMS
requests to EUMETView are unaffected — that is direct end-user access, not
redistribution.

**The attribution requirement survives derivation.** Every EUMETSAT-derived
bundle MUST carry `© EUMETSAT <year>` in each relevant `provenance[].licenceNote`
— the same attribution `NOTICE.md` and both paired session logs already carry.
`EXAMPLE.derived-stats.json`'s `licenceNote` is deliberately minimal and is
**incomplete on this axis**: copying it verbatim into a real EUMETSAT bundle
would drop the attribution. Extend it there.

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
