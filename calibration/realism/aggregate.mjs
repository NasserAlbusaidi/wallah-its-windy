/**
 * aggregate.mjs — the R2a realism harness's numeric protocol: sealed bin
 * definitions, the per-class reduction, and the reference comparison.
 *
 * Split out of `realism.mjs` to keep each file inside the repository's
 * file-size cap. This module owns every number that reaches an artifact:
 * canonicalization precision, the drift threshold, the bin edges, and the
 * count/median/mean reduction. `realism.mjs` owns replay and I/O; `report.mjs`
 * owns prose. Nothing here reads the filesystem, the clock, or a device trait.
 */

// copied from calibration/fidelity.mjs — keep in sync.
// IEEE-754 trig differs by a few 1e-13 units between ARM64 and x86_64 libm.
// Nine decimal places remain many orders finer than the data/model resolution
// while making the machine artefact byte-stable across supported CI platforms.
export const RESULT_DECIMAL_PLACES = 9;

/** Regression-only tolerance on median/mean leaves, applied in BOTH directions. */
export const MAX_DRIFT_FRACTION = 0.05;

// copied from calibration/fidelity.mjs — keep in sync.
export function canonicalizeNumbers(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const rounded = Number(value.toFixed(RESULT_DECIMAL_PLACES));
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(canonicalizeNumbers);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, canonicalizeNumbers(item)]),
    );
  }
  return value;
}

/** Serialize a dynamic map through explicitly sorted keys. */
export function sortedMap(entries) {
  return Object.fromEntries(
    [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** Sealed intensity bins, kt, half-open `[minKt, maxKt)`. Ids sort numerically. */
export const INTENSITY_BINS = [
  { id: '020-035', minKt: 20, maxKt: 35 },
  { id: '035-050', minKt: 35, maxKt: 50 },
  { id: '050-064', minKt: 50, maxKt: 64 },
  { id: '064-083', minKt: 64, maxKt: 83 },
  { id: '083-100', minKt: 83, maxKt: 100 },
  { id: '100-200', minKt: 100, maxKt: 200 },
];
/** RGR-006 conditions on the two weak bins only. */
export const WEAK_BIN_IDS = ['020-035', '035-050'];
export const STAGES = ['post-peak', 'pre-peak'];
export const RUN_CLASSES = ['climatology', 'event'];

/** count/median/mean over non-null samples; median is the sorted midpoint. */
export function summarize(values) {
  const present = values
    .filter((value) => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const count = present.length;
  if (count === 0) return { count: 0, median: null, mean: null };
  const middle = count >> 1;
  return {
    count,
    median:
      count % 2 === 1 ? present[middle] : (present[middle - 1] + present[middle]) / 2,
    mean: present.reduce((sum, value) => sum + value, 0) / count,
  };
}

function inBin(sample, bin) {
  const vKt = sample.metrics.vKt;
  return vKt >= bin.minKt && vKt < bin.maxKt;
}

/** Reduce one run class's frame samples to the sealed aggregate shape. */
export function aggregateClass(samples) {
  const months = [...new Set(samples.map((sample) => sample.monthIndex))].sort(
    (a, b) => a - b,
  );
  return {
    samples: samples.length,
    intensityBins: sortedMap(
      INTENSITY_BINS.map((bin) => {
        const rows = samples.filter((sample) => inBin(sample, bin));
        return [
          bin.id,
          {
            eyeContrastC: summarize(rows.map((row) => row.metrics.eyeContrastC)),
            coldTopAreaKm2: summarize(rows.map((row) => row.metrics.coldTop.areaKm2)),
          },
        ];
      }),
    ),
    // RGR-001 is defined per MONTH, not per intensity bin. The `m` prefix is
    // load-bearing: a bare "04"/"10" is an array-index-like key, which JSON
    // serialization emits in ascending NUMERIC order ahead of every other key,
    // so the sealed block and the report would read out of season order no
    // matter how carefully sortedMap sorted them.
    environmentalCloudFractionByMonth: sortedMap(
      months.map((monthIndex) => [
        `m${String(monthIndex).padStart(2, '0')}`,
        summarize(
          samples
            .filter((sample) => sample.monthIndex === monthIndex)
            .map((sample) => sample.metrics.environmentalCloudFraction),
        ),
      ]),
    ),
    weakBinByStage: sortedMap(
      WEAK_BIN_IDS.flatMap((binId) => {
        const bin = INTENSITY_BINS.find((candidate) => candidate.id === binId);
        return STAGES.map((stage) => {
          const rows = samples.filter(
            (sample) => inBin(sample, bin) && sample.stage === stage,
          );
          return [
            `${binId}|${stage}`,
            {
              coldTopAreaKm2: summarize(rows.map((row) => row.metrics.coldTop.areaKm2)),
              coldTopCentroidOffsetKm: summarize(
                rows.map((row) => row.metrics.coldTop.centroidOffsetKm),
              ),
            },
          ];
        });
      }),
    ),
    unbinned: {
      coldTopCentroidOffsetKm: summarize(
        samples.map((sample) => sample.metrics.coldTop.centroidOffsetKm),
      ),
      coldTopAbsCentroidBearingRelToShearDeg: summarize(
        samples.map((sample) => {
          const bearing = sample.metrics.coldTop.centroidBearingRelToShearDeg;
          return bearing === null ? null : Math.abs(bearing);
        }),
      ),
      bandEdgeInnerCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.innerCPerKm),
      ),
      bandEdgeOuterCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.outerCPerKm),
      ),
      bandEdgeQuadrantDownshearLeftCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.byShearQuadrant.dl),
      ),
      bandEdgeQuadrantDownshearRightCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.byShearQuadrant.dr),
      ),
      bandEdgeQuadrantUpshearLeftCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.byShearQuadrant.ul),
      ),
      bandEdgeQuadrantUpshearRightCPerKm: summarize(
        samples.map((sample) => sample.metrics.bandEdgeEnergy.byShearQuadrant.ur),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Reference + comparison
// ---------------------------------------------------------------------------

/** The sealed subset of a run: scenario identity, frame budget, aggregate. */
export function referenceOf(output) {
  return {
    schemaVersion: 1,
    scenariosSha256: output.scenariosSha256,
    protocol: {
      maxDriftFraction: MAX_DRIFT_FRACTION,
      numericPrecisionDecimalPlaces: RESULT_DECIMAL_PLACES,
    },
    frameCounts: output.frameCounts,
    aggregate: output.aggregate,
  };
}

const DRIFT_LEAVES = new Set(['median', 'mean']);

function walkAggregate(path, current, reference, issues) {
  const currentIsNode =
    current !== null && typeof current === 'object' && !Array.isArray(current);
  const referenceIsNode =
    reference !== null && typeof reference === 'object' && !Array.isArray(reference);
  if (currentIsNode !== referenceIsNode) {
    issues.push({ path, kind: 'shape', current: null, reference: null });
    return;
  }
  if (currentIsNode) {
    const keys = [
      ...new Set([...Object.keys(current), ...Object.keys(reference)]),
    ].sort();
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in current)) {
        issues.push({ path: next, kind: 'missing-in-current', current: null, reference: null });
        continue;
      }
      if (!(key in reference)) {
        issues.push({ path: next, kind: 'missing-in-reference', current: null, reference: null });
        continue;
      }
      walkAggregate(next, current[key], reference[key], issues);
    }
    return;
  }
  const leaf = path.slice(path.lastIndexOf('.') + 1);
  if (!DRIFT_LEAVES.has(leaf)) {
    // Counts and every other leaf are exact-match: a changed population is a
    // changed measurement, not a tolerable wobble.
    if (current !== reference) {
      issues.push({ path, kind: 'exact', current, reference });
    }
    return;
  }
  if (current === null && reference === null) return;
  if (current === null || reference === null) {
    issues.push({ path, kind: 'nullability', current, reference });
    return;
  }
  if (!Number.isFinite(current) || !Number.isFinite(reference)) {
    issues.push({ path, kind: 'non-finite', current, reference });
    return;
  }
  if (reference === 0) {
    if (current !== 0) issues.push({ path, kind: 'zero-reference', current, reference });
    return;
  }
  const drift = current / reference - 1;
  // Both directions fail: this is a descriptive stability gate, and an
  // improvement is accepted by the human A/B protocol plus a reseal.
  if (Math.abs(drift) > MAX_DRIFT_FRACTION) {
    issues.push({ path, kind: 'drift', current, reference, drift });
  }
}

/** Compare a run against the sealed reference; empty `issues` means PASS. */
export function compareReference(current, reference) {
  const issues = [];
  const scenariosMatch = current.scenariosSha256 === reference.scenariosSha256;
  if (!scenariosMatch) {
    issues.push({
      path: 'scenariosSha256',
      kind: 'exact',
      current: current.scenariosSha256,
      reference: reference.scenariosSha256,
    });
  }
  const frameKeys = [
    ...new Set([
      ...Object.keys(current.frameCounts),
      ...Object.keys(reference.frameCounts),
    ]),
  ].sort();
  for (const key of frameKeys) {
    const path = `frameCounts.${key}`;
    if (!(key in current.frameCounts)) {
      issues.push({
        path,
        kind: 'missing-in-current',
        current: null,
        reference: reference.frameCounts[key],
      });
    } else if (!(key in reference.frameCounts)) {
      issues.push({
        path,
        kind: 'missing-in-reference',
        current: current.frameCounts[key],
        reference: null,
      });
    } else if (current.frameCounts[key] !== reference.frameCounts[key]) {
      issues.push({
        path,
        kind: 'exact',
        current: current.frameCounts[key],
        reference: reference.frameCounts[key],
      });
    }
  }
  walkAggregate('aggregate', current.aggregate, reference.aggregate, issues);
  return {
    passed: issues.length === 0,
    scenarioSetMatches: scenariosMatch,
    maxDriftFraction: MAX_DRIFT_FRACTION,
    issues,
  };
}
