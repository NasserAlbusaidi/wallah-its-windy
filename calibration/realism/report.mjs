/**
 * report.mjs — the R2a realism benchmark's generated markdown.
 *
 * Split out of `realism.mjs` to keep each file inside the repository's
 * file-size cap. Prose and table formatting only: every number it prints was
 * already canonicalized by `aggregate.mjs`, and it computes no statistic of its
 * own. `docs/realism-benchmark.md` is machine-generated from here and must
 * never be hand-edited.
 */

import {
  INTENSITY_BINS,
  RUN_CLASSES,
  STAGES,
  WEAK_BIN_IDS,
} from './aggregate.mjs';

function n(value, digits = 2) {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}

function statRow(label, stat, digits) {
  return `| ${label} | ${stat.count} | ${n(stat.median, digits)} | ${n(stat.mean, digits)} |`;
}

function binTable(aggregate, pick, digits) {
  return [
    '| Intensity bin (kt) | n | Median | Mean |',
    '| --- | ---: | ---: | ---: |',
    ...INTENSITY_BINS.map((bin) =>
      statRow(
        `${bin.minKt}–${bin.maxKt}`,
        pick(aggregate.intensityBins[bin.id]),
        digits,
      ),
    ),
  ].join('\n');
}

function monthTable(aggregate) {
  const entries = Object.entries(aggregate.environmentalCloudFractionByMonth);
  if (entries.length === 0) return '_No samples in this class._';
  return [
    '| Month key | n | Median | Mean |',
    '| --- | ---: | ---: | ---: |',
    // Printed verbatim so a report row and its sealed key are the same string.
    ...entries.map(([month, stat]) => statRow(month, stat, 4)),
  ].join('\n');
}

function weakStageTable(aggregate) {
  return [
    '| Bin (kt) | Stage | n | Median area km² | Mean area km² | n | Median offset km | Mean offset km |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...WEAK_BIN_IDS.flatMap((binId) =>
      STAGES.map((stage) => {
        const bin = INTENSITY_BINS.find((candidate) => candidate.id === binId);
        const row = aggregate.weakBinByStage[`${binId}|${stage}`];
        return (
          `| ${bin.minKt}–${bin.maxKt} | ${stage} | ${row.coldTopAreaKm2.count} | ` +
          `${n(row.coldTopAreaKm2.median, 1)} | ${n(row.coldTopAreaKm2.mean, 1)} | ` +
          `${row.coldTopCentroidOffsetKm.count} | ${n(row.coldTopCentroidOffsetKm.median, 2)} | ` +
          `${n(row.coldTopCentroidOffsetKm.mean, 2)} |`
        );
      }),
    ),
  ].join('\n');
}

const UNBINNED_LABELS = [
  ['coldTopCentroidOffsetKm', 'Cold-top centroid offset (km)', 2],
  // The pipes must stay escaped: a raw `|` splits the row in a 4-column table.
  ['coldTopAbsCentroidBearingRelToShearDeg', '\\|Centroid bearing rel. shear\\| (deg)', 2],
  ['bandEdgeInnerCPerKm', 'Band edge energy, inner ≤200 km (°C/km)', 4],
  ['bandEdgeOuterCPerKm', 'Band edge energy, outer 200–600 km (°C/km)', 4],
  ['bandEdgeQuadrantDownshearLeftCPerKm', 'Band edge energy, downshear-left (°C/km)', 4],
  ['bandEdgeQuadrantDownshearRightCPerKm', 'Band edge energy, downshear-right (°C/km)', 4],
  ['bandEdgeQuadrantUpshearLeftCPerKm', 'Band edge energy, upshear-left (°C/km)', 4],
  ['bandEdgeQuadrantUpshearRightCPerKm', 'Band edge energy, upshear-right (°C/km)', 4],
];

function unbinnedTable(aggregate) {
  return [
    '| Metric | n | Median | Mean |',
    '| --- | ---: | ---: | ---: |',
    ...UNBINNED_LABELS.map(([key, label, digits]) =>
      statRow(label, aggregate.unbinned[key], digits),
    ),
  ].join('\n');
}

function scenarioTable(rows) {
  return [
    '| Scenario | Class | Month | Sampled frames | Run length h | Peak kt | Ended |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.class} | ${String(row.monthIndex).padStart(2, '0')} | ` +
        `${row.sampledFrames} | ${n(row.runLengthH, 2)} | ${n(row.peakKt, 1)} | ` +
        `${row.died ? row.deathReason : 'horizon'} |`,
    ),
  ].join('\n');
}

function observedSection(names) {
  if (names.length === 0) {
    return (
      'No observed derived-statistics references are committed yet. Landing them ' +
      '(and the IMERG rain-truth comparison) is R2b; until then every number ' +
      'above is sim-side only and has no observed counterpart.'
    );
  }
  return ['Committed under `calibration/realism/observed/`:', '', ...names.map((name) => `- \`${name}\``)].join('\n');
}

/**
 * RGR-002's population can be empty for a whole seal: the shader draws no warm
 * eye below its organization gate, so `eyeContrastC` is null for every frame.
 * Say so in the report rather than leaving a table of dashes unexplained.
 */
function eyeContrastNote(result) {
  const total = RUN_CLASSES.reduce(
    (sum, runClass) =>
      sum +
      INTENSITY_BINS.reduce(
        (binSum, bin) =>
          binSum + result.aggregate[runClass].intensityBins[bin.id].eyeContrastC.count,
        0,
      ),
    0,
  );
  if (total > 0) return `Measured on ${total} frames across both classes.`;
  return (
    'No sampled frame in this seal produced an eye-contrast value: the shader ' +
    'draws no warm eye until organization crosses its onset gate, and no ' +
    'sampled frame in the frozen set reaches it. The metric is not vacuous — a ' +
    'change that makes an eye appear turns these nulls into numbers and fails ' +
    'the gate — but this seal carries no eye-contrast baseline to regress from.'
  );
}

export function makeReport(result) {
  const passed = result.referenceComparison.passed;
  const events = result.scenarios.filter((row) => row.class === 'event').length;
  const climatology = result.scenarios.length - events;
  const frames = result.aggregate.event.samples + result.aggregate.climatology.samples;
  const verdict = `**${passed ? 'REFERENCE STABLE' : 'DRIFT DETECTED'}.** ${result.scenarios.length} scenarios (${events} event replays, ${climatology} climatology runs) produced ${frames} measured frames. The live proxy ${passed ? 'matches' : 'does not match'} the sealed aggregate in \`calibration/realism/realism-reference.json\`, and the scenario set ${result.referenceComparison.scenarioSetMatches ? 'is' : 'is NOT'} the sealed one.`;
  return `# R2a realism benchmark — simulated-product field-space metrics (sim-side scaffold)

> Deterministic report generated by \`npm run realism\`. Metric values are a
> pure function of the committed assets, the frozen scenario set, and the code;
> they are never edited by hand.

## Verdict

${verdict}

Current gate: **${passed ? 'PASS' : 'FAIL'}** (${result.referenceComparison.issues.length} issue(s)).

## Protocol

- **Proxy.** ${result.protocol.proxy}. Metrics come from deterministic CPU-side
  state, never from GPU pixels, which are not byte-stable across drivers.
- **Measurement pose.** \`${result.protocol.measurementPose}\`. Physics runs on the
  ${result.protocol.physicsProfile}.
- **Grid.** ${result.protocol.gridN}×${result.protocol.gridN} cells over the whole product domain.
- **Cadence.** One field every ${result.protocol.sampleEveryH} sim-hours from age
  ${result.protocol.minimumSampleAgeH} h, alive frames only. Climatology runs stop at
  ${result.protocol.climatologyMaxHours} h or death; event replays stop at
  \`windowH - envOffsetH\` or death. Physics advances in
  ${result.protocol.physicsTickMinutes}-minute steps.
- **Time bases.** Display fraction is \`${result.protocol.displayTimeBase}\`; the proxy
  mirrors the RENDERER while physics keeps the event offset, exactly as the
  shipped app does.
- **Land.** ${result.protocol.landSemantics}.
- **Thresholds.** Counts must match exactly; medians and means may not drift by
  more than ${(result.protocol.maxDriftFraction * 100).toFixed(0)}% in EITHER direction.
  Numbers are canonicalized to ${result.protocol.numericPrecisionDecimalPlaces} decimal places.

The BT-proxy is a deterministic CPU twin of the simulated infrared layer — a
**simulated cloud-top brightness-temperature proxy**, not radiometric data, and
these metrics carry no forecast-skill claim. This is the R2a sim-side scaffold;
R2 is complete only when R2b lands observed derived-statistics references and
the IMERG rain-truth comparison.

## Eye contrast by intensity bin (RGR-002)

${eyeContrastNote(result)}

**Event replays** (°C, warm eye positive)

${binTable(result.aggregate.event, (bin) => bin.eyeContrastC, 3)}

**Climatology runs** (°C)

${binTable(result.aggregate.climatology, (bin) => bin.eyeContrastC, 3)}

## Cold-top area by intensity bin (RGR-013)

**Event replays** (km², BT-proxy < -60 °C within 4× outer size)

${binTable(result.aggregate.event, (bin) => bin.coldTopAreaKm2, 1)}

**Climatology runs** (km²)

${binTable(result.aggregate.climatology, (bin) => bin.coldTopAreaKm2, 1)}

## Environmental cloud fraction by month (RGR-001)

**Event replays** (fraction of eligible ocean cells with BT-proxy ≤ 0 °C)

${monthTable(result.aggregate.event)}

**Climatology runs**

${monthTable(result.aggregate.climatology)}

## Weak-bin × stage cold-top (RGR-006)

**Event replays**

${weakStageTable(result.aggregate.event)}

**Climatology runs**

${weakStageTable(result.aggregate.climatology)}

Stage is sealed as: \`peakAgeH\` is the age of the FIRST frame attaining the
run's maximum wind, and \`ageH <= peakAgeH\` is pre-peak.

## Band edge energy and unbinned statistics (RGR-003 / RGR-004)

**Event replays**

${unbinnedTable(result.aggregate.event)}

**Climatology runs**

${unbinnedTable(result.aggregate.climatology)}

## Per-scenario

${scenarioTable(result.scenarios)}

## Shortlist traceability

| Metric | Register entry | Literature anchor |
| --- | --- | --- |
| Environmental cloud fraction, month-conditioned | RGR-001 | Wonsick, Pinker & Govaerts (2009) monsoon/post-monsoon cloud-cycle shape — order-of-relationship only (single numeric target needs verification) |
| Eye contrast by intensity bin | RGR-002 | Dvorak (1984) / Velden et al. (2006) / Olander & Velden (2007) eye-onset climatology — order-of-relationship only (T4.5 ≈ 77 kt and T5.0 ≈ 90 kt need verification) |
| Cold-top centroid offset and bearing rel. shear | RGR-003 | Hence & Houze (2012) shear-quadrant convective organization |
| Band edge energy, inner/outer split and shear quadrants | RGR-004 | Hence & Houze (2012) 200 km regime break plus shear-quadrant organization |
| Cold-top area and centroid offset, weak bins × stage | RGR-006 | Wang (2018) displaced/centered pre-genesis regimes and Chang et al. (2017) multiday convective bursts — qualitative distribution only (North Indian Ocean-specific frequency unverified) |
| Cold-top area by intensity bin | RGR-013 | Merrill (1984) weak size–intensity correlation — order-of-relationship only (the ~550–600 km shield-radius figure needs verification) |

## Observed references

${observedSection(result.observedReferences)}

## Limits

- The gate is **regression-only**. It proves the simulated product did not move;
  it cannot say the product is realistic. A metric moving toward the observed
  world still fails, and is accepted through the fixed human A/B protocol plus a
  reseal (see \`calibration/realism/README.md\`).
- The proxy is not pixel-identical to the shipped shader: no relief shading, no
  palette or compositing, a single per-frame \`metricX\`, and debris rasterized at
  the measurement grid. It measures the same field-space composition, not the
  same framebuffer.
- Climatology storms are synthetic (fixed spawn/month/seed triplets). They are
  not events, not observed, and carry no verification value on their own.
- **Months 05–07 sealed with 0 measured frames.** \`clim-jun\`, \`clim-jul\` and
  \`clim-aug\` die of monsoon shear before the first 6-hour sample — calibrated
  model output, on a cohort frozen before any replay ran — so RGR-001's month
  conditioning currently covers 4 of the 7 season months. Coverage returns only
  through the documented reseal + A/B flow, for which R2b is the natural moment.
- Every run stops at simulated death, and the register's RGR-014 records that
  event-mode hindcasts collapse well before the observed storm ends. Scenarios
  that die early contribute few or no measured frames, so several bins rest on
  small populations. The per-scenario table above is the honest sample budget —
  read a bin's \`n\` before reading its median.
- Three of the five event replays sit in the hindcast validation partition.
  These realism metrics tune nothing and must never be cited as intensity or
  track evidence.
- The reference was sealed on a single platform. Until it is regenerated on a
  Linux runner and shown byte-equal, \`npm run realism:check\` stays advisory and
  is not part of the CI deploy gate.
`;
}
