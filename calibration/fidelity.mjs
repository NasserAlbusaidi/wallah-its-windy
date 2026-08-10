#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(ROOT, 'calibration/fidelity-catalog.json');
const SCENARIOS_PATH = resolve(
  ROOT,
  'calibration/data/fidelity-scenarios.json',
);
const TRACKS_PATH = resolve(ROOT, 'calibration/data/fidelity-tracks.json');
const TERRAIN_PATH = resolve(ROOT, 'public/data/terrain.bin');
const OCEAN_PATH = resolve(ROOT, 'public/data/ocean.bin');
const EVENT_OCEAN_PATH = resolve(ROOT, 'calibration/data/hf2a-event-ocean.bin');
const EVENT_OCEAN_META_PATH = resolve(ROOT, 'calibration/data/hf2a-event-ocean.json');
const INITIAL_STRUCTURE_PATH = resolve(ROOT, 'calibration/data/hf2-initial-structure.json');
const HF3_STEERING_META_PATH = resolve(ROOT, 'calibration/data/hf3-steering-manifest.json');
const PARTITION_FILTER = process.argv
  .find((argument) => argument.startsWith('--partition='))
  ?.slice('--partition='.length);
if (
  PARTITION_FILTER &&
  !['development', 'validation', 'test'].includes(PARTITION_FILTER)
) {
  throw new Error(`invalid partition filter: ${PARTITION_FILTER}`);
}
const ACTIVE_PARTITIONS = PARTITION_FILTER
  ? [PARTITION_FILTER]
  : ['development', 'validation', 'test'];
const RESULT_TAG = process.argv
  .find((argument) => argument.startsWith('--tag='))
  ?.slice('--tag='.length);
if (RESULT_TAG && !/^[a-z0-9-]+$/.test(RESULT_TAG)) {
  throw new Error(`invalid result tag: ${RESULT_TAG}`);
}
const RESULTS_PATH = resolve(
  ROOT,
  PARTITION_FILTER
    ? `calibration/fidelity-${PARTITION_FILTER}${RESULT_TAG ? `-${RESULT_TAG}` : ''}.json`
    : 'calibration/fidelity-results.json',
);
const REFERENCE_PATH = resolve(ROOT, 'calibration/fidelity-reference.json');
const REPORT_PATH = resolve(ROOT, 'docs/fidelity-benchmark.md');
const CHECK = process.argv.includes('--check');
function numberArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isFinite(value)) throw new Error(`invalid ${name}: ${raw}`);
  return value;
}
// IEEE-754 trig differs by a few 1e-13 units between ARM64 and x86_64 libm.
// Nine decimal places remain many orders finer than the data/model resolution
// while making the machine artefact byte-stable across supported CI platforms.
const RESULT_DECIMAL_PLACES = 9;
const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});

const [
  { aggregateHindcasts, runDetailedHindcastCase },
  {
    aggregateLeadTimes,
    FIDELITY_BOOTSTRAP_REPLICATES,
    FIDELITY_LEAD_HOURS,
    PERSISTENCE_LOOKBACK_MAX_HOURS,
    trainClimatologyPersistence,
    verifyLeadTimes,
  },
  { parseBin },
  { parseScenarios },
  { DEFAULT_INTENSITY_PARAMETERS, DEFAULT_TRACK_PARAMETERS },
  { parseTracks },
  { inBBox },
  { scoreHindcast },
  { sampleOceanProfileBin, sampleEventOceanProfileBin },
  { observedInitialMotionMs, pressureWindSamplerFromBin },
  { SCORING_DOMAIN },
] = await Promise.all([
  vite.ssrLoadModule('/src/hindcast-benchmark.ts'),
  vite.ssrLoadModule('/src/fidelity-verification.ts'),
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
  vite.ssrLoadModule('/src/grid.ts'),
  vite.ssrLoadModule('/src/hindcast.ts'),
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);
const RUNTIME_INTENSITY_PARAMETERS = Object.freeze({
  ...DEFAULT_INTENSITY_PARAMETERS,
  intensifyKPerH: numberArgument(
    'intensify',
    DEFAULT_INTENSITY_PARAMETERS.intensifyKPerH,
  ),
  shearKtPerHPerMs: numberArgument(
    'shearK',
    DEFAULT_INTENSITY_PARAMETERS.shearKtPerHPerMs,
  ),
  dryAirK: numberArgument('dryK', DEFAULT_INTENSITY_PARAMETERS.dryAirK),
  organizationIntensification: numberArgument(
    'orgGain',
    DEFAULT_INTENSITY_PARAMETERS.organizationIntensification,
  ),
});
const RUNTIME_TRACK_PARAMETERS = Object.freeze({
  ...DEFAULT_TRACK_PARAMETERS,
  environmentalSteeringBlend: numberArgument(
    'steeringBlend',
    DEFAULT_TRACK_PARAMETERS.environmentalSteeringBlend,
  ),
  motionResponseHours: numberArgument(
    'motionResponseH',
    DEFAULT_TRACK_PARAMETERS.motionResponseHours,
  ),
  initialMotionBlendHours: numberArgument(
    'initialMotionBlendH',
    DEFAULT_TRACK_PARAMETERS.initialMotionBlendHours,
  ),
  betaDriftScale: numberArgument(
    'betaScale',
    DEFAULT_TRACK_PARAMETERS.betaDriftScale,
  ),
  terrainDriftMaxMs: numberArgument(
    'terrainDrift',
    DEFAULT_TRACK_PARAMETERS.terrainDriftMaxMs,
  ),
  wanderStepMs: numberArgument('wanderStep', DEFAULT_TRACK_PARAMETERS.wanderStepMs),
  wanderRevertFraction: numberArgument(
    'wanderRevert',
    DEFAULT_TRACK_PARAMETERS.wanderRevertFraction,
  ),
});

function contiguousInDomainTrack(track, startIso) {
  const startMs = Date.parse(startIso);
  const points = [];
  for (const point of track.points) {
    const time = Date.parse(point.iso);
    if (!Number.isFinite(time) || time < startMs) continue;
    if (!inBBox(point.lat, point.lon, SCORING_DOMAIN)) break;
    points.push(point);
  }
  return { ...track, points };
}

function parseBuffer(buffer) {
  return parseBin(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
}

async function loadBinArtifact(path) {
  const bytes = await readFile(path);
  return {
    parsed: parseBuffer(bytes),
    manifest: {
      // Artifact manifests are committed and checked byte-for-byte on Linux.
      // Normalize Windows separators so either platform generates the same JSON.
      path: path.slice(ROOT.length + 1).replaceAll('\\', '/'),
      bytes: bytes.byteLength,
      sha256: digest(bytes),
    },
  };
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function canonicalizeNumbers(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const rounded = Number(value.toFixed(RESULT_DECIMAL_PLACES));
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(canonicalizeNumbers);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        canonicalizeNumbers(item),
      ]),
    );
  }
  return value;
}

function n(value, digits = 1) {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}

function percent(value) {
  return value === null || value === undefined
    ? '—'
    : `${(value * 100).toFixed(1)}%`;
}

function interval(value, digits = 1) {
  return value === null
    ? '—'
    : `${value.low.toFixed(digits)}–${value.high.toFixed(digits)}`;
}

function aggregateTable(aggregates) {
  return [
    '| Partition | Storms | Track MAE km | Wind MAE kt | Pressure MAE hPa | |Peak bias| kt | Objective |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(aggregates).map(
      ([partition, value]) =>
        `| ${partition} | ${value.storms} | ${n(value.trackMaeKm)} | ${n(value.intensityMaeKt)} | ${n(value.pressureMaeHpa)} | ${n(value.peakAbsBiasKt)} | ${n(value.objective, 3)} |`,
    ),
  ].join('\n');
}

function leadTable(rows) {
  return [
    '**Track position**',
    '',
    '| Lead | n | Model MAE km (95% CI) | Median | Persistence MAE / median | Skill | FSP | Paired difference 95% CI | Along MAE / bias | Cross MAE / bias |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.leadH} h | ${row.model.samples} | ${n(row.model.trackMaeKm)} (${interval(row.model.trackMaeCi95)}) | ${n(row.model.trackMedianKm)} | ${n(row.persistence.trackMaeKm)} / ${n(row.persistence.trackMedianKm)} | ${percent(row.trackMaeSkillFraction)} | ${percent(row.trackFrequencySuperior)} | ${interval(row.trackDifferenceCi95)} | ${n(row.model.alongTrackMaeKm)} / ${n(row.model.alongTrackBiasKm)} | ${n(row.model.crossTrackMaeKm)} / ${n(row.model.crossTrackBiasKm)} |`,
    ),
    '',
    '**Maximum wind**',
    '',
    '| Lead | n model/base | Model MAE kt (95% CI) | Persistence | Paired skill | FSP | Paired difference 95% CI | Bias kt |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.leadH} h | ${row.model.intensitySamples}/${row.persistence.intensitySamples} | ${n(row.model.intensityMaeKt)} (${interval(row.model.intensityMaeCi95)}) | ${n(row.persistence.intensityMaeKt)} | ${percent(row.intensityMaeSkillFraction)} | ${percent(row.intensityFrequencySuperior)} | ${interval(row.intensityDifferenceCi95)} | ${n(row.model.intensityBiasKt)} |`,
    ),
    '',
    '**Central pressure**',
    '',
    '| Lead | n model/base | Model MAE hPa (95% CI) | Persistence | Paired skill | FSP | Paired difference 95% CI | Bias hPa |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.leadH} h | ${row.model.pressureSamples}/${row.persistence.pressureSamples} | ${n(row.model.pressureMaeHpa)} (${interval(row.model.pressureMaeCi95)}) | ${n(row.persistence.pressureMaeHpa)} | ${percent(row.pressureMaeSkillFraction)} | ${percent(row.pressureFrequencySuperior)} | ${interval(row.pressureDifferenceCi95)} | ${n(row.model.pressureBiasHpa)} |`,
    ),
  ].join('\n');
}

function stormTable(cases) {
  return [
    '| Storm | Split | Leads | Track MAE km | Wind MAE kt | Pressure MAE hPa | Peak bias kt |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...cases.map(
      (row) =>
        `| ${row.label} | ${row.partition} | ${row.leadTimes.map((lead) => lead.leadH).join('/')} | ${n(row.score.trackMaeKm)} | ${n(row.score.intensityMaeKt)} | ${n(row.score.pressureMaeHpa)} | ${n(row.score.peakBiasKt)} |`,
    ),
  ].join('\n');
}

function ratio(current, reference) {
  if (
    current === null ||
    reference === null ||
    reference === 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(reference)
  ) {
    return null;
  }
  return current / reference - 1;
}

function referenceOf(output) {
  return {
    schemaVersion: 1,
    catalogSha256: output.catalog.sha256,
    protocol: {
      maximumValidationRegressionFraction: 0.05,
      requiredLeadSampleRetentionFraction: 1,
      finalTestIsAcceptanceGate: false,
      numericPrecisionDecimalPlaces: RESULT_DECIMAL_PLACES,
    },
    validation: {
      aggregate: output.aggregate.validation,
      leadTimes: output.leadTimes.validation,
    },
  };
}

function compareReference(current, reference) {
  const regressions = [];
  const maxRegression = reference.protocol.maximumValidationRegressionFraction;
  const minimumSampleFraction =
    reference.protocol.requiredLeadSampleRetentionFraction;
  for (const metric of ['trackMaeKm', 'intensityMaeKt', 'pressureMaeHpa']) {
    const change = ratio(
      current.aggregate.validation[metric],
      reference.validation.aggregate[metric],
    );
    if (change !== null && change > maxRegression) {
      regressions.push({ scope: 'full-run', leadH: null, metric, change });
    }
  }
  const referenceLead = new Map(
    reference.validation.leadTimes.map((row) => [row.leadH, row]),
  );
  for (const row of current.leadTimes.validation) {
    const before = referenceLead.get(row.leadH);
    if (!before) {
      regressions.push({
        scope: 'lead-time',
        leadH: row.leadH,
        metric: 'missing-reference',
        change: null,
      });
      continue;
    }
    for (const sampleMetric of [
      'samples',
      'intensitySamples',
      'pressureSamples',
    ]) {
      if (
        row.model[sampleMetric] <
        before.model[sampleMetric] * minimumSampleFraction
      ) {
        regressions.push({
          scope: 'lead-time',
          leadH: row.leadH,
          metric: `${sampleMetric}-retention`,
          change:
            before.model[sampleMetric] === 0
              ? null
              : row.model[sampleMetric] / before.model[sampleMetric] - 1,
        });
      }
    }
    for (const metric of ['trackMaeKm', 'intensityMaeKt', 'pressureMaeHpa']) {
      const change = ratio(row.model[metric], before.model[metric]);
      if (change !== null && change > maxRegression) {
        regressions.push({
          scope: 'lead-time',
          leadH: row.leadH,
          metric,
          change,
        });
      }
    }
  }
  return {
    passed:
      current.catalog.sha256 === reference.catalogSha256 &&
      regressions.length === 0,
    catalogMatches: current.catalog.sha256 === reference.catalogSha256,
    regressions,
  };
}

function makeReport(output) {
  const testStorms = output.cases.filter((row) => row.partition === 'test');
  return `# HF-1 observational truth benchmark

> Deterministic report generated by \`npm run fidelity\`. Metric values and
> confidence intervals are not edited by hand.

## Verdict

**30-STORM REFERENCE ${output.referenceComparison.passed ? 'ESTABLISHED' : 'REGRESSION DETECTED'}.** The benchmark contains 18 development,
6 validation, and 6 permanent final-test storms. The live runtime
${output.referenceComparison.passed ? 'matches' : 'does not match'} the locked
validation reference and ${output.referenceComparison.catalogMatches ? 'uses' : 'does not use'}
the frozen catalogue.

This is a measurement baseline, not a claim of operational forecast skill.
Future parameter searches may use development storms, acceptance decisions may
use validation storms, and the six test storms are report-only final audits.

## Data contract

- Source: [NOAA IBTrACS v04r01 North Indian basin](https://www.ncei.noaa.gov/products/international-best-track-archive),
  pinned SHA-256 \`${output.source.ibtracsSha256}\`.
- Position, one-minute wind, and pressure use USA/JTWC columns consistently.
- The catalogue is a frozen, code-reviewed coverage set, not a random or
  exhaustive sample: ten featured cases plus twenty additional systems spanning
  1980–2024, seasons, and intensities. It was fixed before the new cases ran.
- Every replay starts at the first >=34 kt fix at least 1.2 degrees inside the
  50–70 E, 15–27 N product domain. NATURE is TS, or NR only where older archive
  rows do not report nature despite a valid USA/JTWC wind
  (${output.catalog.protocol.initialNatureCounts.TS} TS / ${output.catalog.protocol.initialNatureCounts.NR} NR starts).
- Atmospheric forcing is 3-hourly compact [ERA5 pressure-level and surface
  data](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels?tab=overview)
  on the current 0.5 degree grid. [NOAA WOA23](https://www.ncei.noaa.gov/products/world-ocean-atlas)
  supplies monthly OHC. No observed state is assimilated after initialization.
- Exact 12/24/48/72-hour errors are calculated by interpolation. Along/cross
  components use the local observed-track direction; positive along error is
  too fast and positive cross error is left of track. Only leads whose observed
  track stays inside the declared product domain through that lead are eligible.
- Full-run scores stop at the earlier of simulated death and the last observed
  fix before domain exit, exclude the assimilated initialization fix, and use
  a common valid horizon for peak and fix metrics.
- The persistence baseline extrapolates only pre-initialization motion at
  constant speed/bearing on a sphere and holds initial wind and pressure fixed.
  It is stationary when no prior fix exists within 24 hours and never reads a
  future fix.
- Skill is \`1 - model MAE / persistence MAE\` on paired available cases. FSP is
  the frequency of superior performance (strictly smaller model error); a
  negative paired-difference interval favors the model.
- Confidence intervals are deterministic 2,000-member storm-level bootstrap
  intervals. Storms, not individual fixes, are the sampling unit.
- Machine metrics retain ${RESULT_DECIMAL_PLACES} decimal places so ARM64 and
  x86_64 runs remain byte-identical despite sub-picometre libm differences.

## Full-run aggregate

${aggregateTable(output.aggregate)}

## Validation lead-time scorecard

${leadTable(output.leadTimes.validation)}

## Permanent final-test scorecard

${leadTable(output.leadTimes.test)}

The permanent test contains ${testStorms.map((row) => row.label).join(', ')}.
It was selected before these storms were simulated by the HF-1 harness and does
not participate in parameter selection or the automated acceptance decision.

## Development scorecard

${leadTable(output.leadTimes.development)}

## Per-storm results

${stormTable(output.cases)}

## Drift gate

- Catalogue identity must remain byte-for-byte stable.
- Validation track, wind, and pressure sample availability cannot decrease.
- Full-run and lead-time validation track, intensity, and pressure MAE may not
  regress by more than 5% from \`calibration/fidelity-reference.json\`.
- Test metrics are always reported but never used as an optimization gate.

Current gate: **${output.referenceComparison.passed ? 'PASS' : 'FAIL'}**.

## Limits

- IBTrACS best-track values are agency post-analysis estimates, not error-free
  ground truth. “Observational truth” here means the frozen verification
  reference.
- The 30 storms are deliberately stratified rather than randomly sampled, so
  aggregate confidence intervals describe this catalogue and must not be read
  as population-wide forecast uncertainty.
- The permanent test is policy-separated, not cryptographically blinded. If a
  future parameter choice is guided by its published results, those storms are
  contaminated for confirmatory use and a newly sealed test set is required.
- Older storms often lack USA/JTWC pressure, so pressure sample counts are
  smaller and shown explicitly.
- The product domain truncates storms before or after they cross the Arabian
  Sea instrument window; unavailable leads are omitted, never imputed.
- ERA5 forcing is vortex-filtered and the ocean is still monthly climatology.
  HF-2 will replace these forcing limitations; HF-1 exists to measure whether
  that replacement genuinely helps.
- A linear-motion persistence baseline is deliberately simple. A climatology-
  and-persistence baseline can be added later without changing the frozen test
  set.
`;
}

async function compare(path, expected) {
  try {
    return (await readFile(path, 'utf8')) === expected;
  } catch {
    return false;
  }
}

const catalogText = await readFile(CATALOG_PATH, 'utf8');
const catalog = JSON.parse(catalogText);
const scenariosText = await readFile(SCENARIOS_PATH, 'utf8');
const tracksText = await readFile(TRACKS_PATH, 'utf8');
const scenarios = parseScenarios(JSON.parse(scenariosText));
const tracks = parseTracks(JSON.parse(tracksText));
if (!scenarios || !tracks) throw new Error('invalid fidelity catalogue assets');
if (scenarios.length !== 30 || tracks.length !== 30) {
  throw new Error(
    `fidelity benchmark requires 30 scenarios/tracks, got ${scenarios.length}/${tracks.length}`,
  );
}
const splitCounts = Object.fromEntries(
  ['development', 'validation', 'test'].map((partition) => [
    partition,
    scenarios.filter(
      (scenario) => scenario.benchmarkPartition === partition,
    ).length,
  ]),
);
if (
  splitCounts.development !== 18 ||
  splitCounts.validation !== 6 ||
  splitCounts.test !== 6
) {
  throw new Error(`partition drift: ${JSON.stringify(splitCounts)}`);
}

const terrainArtifact = await loadBinArtifact(TERRAIN_PATH);
const terrain = terrainArtifact.parsed;
const oceanArtifact = await loadBinArtifact(OCEAN_PATH);
const eventOceanArtifact = await loadBinArtifact(EVENT_OCEAN_PATH);
const eventOceanMetadataText = await readFile(EVENT_OCEAN_META_PATH, 'utf8');
const eventOceanMetadata = JSON.parse(eventOceanMetadataText);
const initialStructureText = await readFile(INITIAL_STRUCTURE_PATH, 'utf8');
const initialStructure = JSON.parse(initialStructureText);
const hf3SteeringMetadataText = await readFile(HF3_STEERING_META_PATH, 'utf8');
const hf3SteeringMetadata = JSON.parse(hf3SteeringMetadataText);
const trackById = new Map(tracks.map((track) => [track.id, track]));
const CLIPER_MODEL = trainClimatologyPersistence(
  scenarios
    .filter((scenario) => scenario.benchmarkPartition === 'development')
    .map((scenario) => {
      const track = trackById.get(scenario.ghostId);
      if (!track) throw new Error(`${scenario.id}: missing CLIPER training track`);
      return { track, startIso: scenario.hindcast.startIso };
    }),
);
const cases = [];
const environmentManifest = [];
const pressureSteeringManifest = [];
for (const scenario of scenarios) {
  if (PARTITION_FILTER && scenario.benchmarkPartition !== PARTITION_FILTER) continue;
  const track = trackById.get(scenario.ghostId);
  if (!track) throw new Error(`${scenario.id}: missing ${scenario.ghostId}`);
  const environmentArtifact = await loadBinArtifact(resolve(ROOT, scenario.bin));
  const environment = environmentArtifact.parsed;
  environmentManifest.push({
    id: scenario.id,
    ...environmentArtifact.manifest,
  });
  const pressureSteeringRecord = hf3SteeringMetadata.storms.find(
    (item) => item.id === scenario.id,
  );
  if (!pressureSteeringRecord) {
    throw new Error(`${scenario.id}: missing HF-3 pressure steering metadata`);
  }
  const pressureSteeringArtifact = await loadBinArtifact(
    resolve(ROOT, pressureSteeringRecord.path),
  );
  pressureSteeringManifest.push({
    id: scenario.id,
    ...pressureSteeringArtifact.manifest,
  });
  const startIso = scenario.hindcast.startIso;
  const initialMotion = observedInitialMotionMs(track.points, startIso);
  const inDomainTrack = contiguousInDomainTrack(track, startIso);
  if (inDomainTrack.points.length === 0) {
    throw new Error(`${scenario.id}: no contiguous in-domain verification fixes`);
  }
  const detailed = runDetailedHindcastCase(
    { scenario, track: inDomainTrack, environment },
    terrain,
    RUNTIME_INTENSITY_PARAMETERS,
    (lat, lon, monthIndex) => {
      const eventProfile = eventOceanMetadata.events.find(
        (item) => item.id === scenario.id,
      );
      return (
        (eventProfile
          ? sampleEventOceanProfileBin(
              eventOceanArtifact.parsed,
              lat,
              lon,
              eventProfile.layerIndex,
            )
          : null) ??
        sampleOceanProfileBin(oceanArtifact.parsed, lat, lon, monthIndex)
      );
    },
    initialStructure.storms.find((item) => item.id === scenario.id),
    initialMotion ? { u: initialMotion.u, v: initialMotion.v } : undefined,
    pressureWindSamplerFromBin(
      () => pressureSteeringArtifact.parsed,
      () => ({ kind: 'event-timeline' }),
    ),
    RUNTIME_TRACK_PARAMETERS,
    'shipped',
  );
  const lastObservedMs = Date.parse(inDomainTrack.points.at(-1).iso);
  const commonEndH = (lastObservedMs - Date.parse(startIso)) / 3_600_000;
  const commonFrames = detailed.frames.filter(
    (frame) => frame.ageH > 0 && frame.ageH <= commonEndH + 1e-9,
  );
  const scoringTrack = {
    ...inDomainTrack,
    points: inDomainTrack.points.filter(
      (point) => Date.parse(point.iso) > Date.parse(startIso),
    ),
  };
  const commonScore = scoreHindcast(commonFrames, scoringTrack, startIso);
  if (!commonScore) throw new Error(`${scenario.id}: no common-domain score`);
  cases.push({
    ...detailed.result,
    score: commonScore,
    leadTimes: verifyLeadTimes(
      detailed.frames,
      track,
      startIso,
      undefined,
      CLIPER_MODEL,
    ),
  });
}

const byPartition = (partition) =>
  cases.filter((row) => row.partition === partition);
const outputBase = {
  schemaVersion: 1,
  generatedBy: 'calibration/fidelity.mjs',
  ...(PARTITION_FILTER ? { partitionFilter: PARTITION_FILTER } : {}),
  source: {
    tracks: 'NOAA IBTrACS v04r01 North Indian basin USA/JTWC fields',
    environment: 'ERA5 event fields and WOA23 monthly ocean heat content',
    ibtracsSha256: catalog.source.sha256,
  },
  catalog: {
    sha256: digest(catalogText),
    storms: scenarios.length,
    partitions: splitCounts,
    protocol: catalog.protocol,
  },
  artifactManifest: {
    scenarios: {
      path: 'calibration/data/fidelity-scenarios.json',
      bytes: Buffer.byteLength(scenariosText),
      sha256: digest(scenariosText),
    },
    tracks: {
      path: 'calibration/data/fidelity-tracks.json',
      bytes: Buffer.byteLength(tracksText),
      sha256: digest(tracksText),
    },
    terrain: terrainArtifact.manifest,
    oceanProfiles: oceanArtifact.manifest,
    eventOceanProfiles: eventOceanArtifact.manifest,
    eventOceanMetadata: {
      path: 'calibration/data/hf2a-event-ocean.json',
      bytes: Buffer.byteLength(eventOceanMetadataText),
      sha256: digest(eventOceanMetadataText),
    },
    initialStructure: {
      path: 'calibration/data/hf2-initial-structure.json',
      bytes: Buffer.byteLength(initialStructureText),
      sha256: digest(initialStructureText),
    },
    pressureLevelSteeringMetadata: {
      path: 'calibration/data/hf3-steering-manifest.json',
      bytes: Buffer.byteLength(hf3SteeringMetadataText),
      sha256: digest(hf3SteeringMetadataText),
    },
    pressureLevelSteering: pressureSteeringManifest,
    environments: environmentManifest,
  },
  runtimeParameters: RUNTIME_INTENSITY_PARAMETERS,
  runtimeTrackParameters: RUNTIME_TRACK_PARAMETERS,
  verificationProtocol: {
    leadHours: [...FIDELITY_LEAD_HOURS],
    domain: SCORING_DOMAIN,
    initializationFixScored: false,
    requiresContinuousObservedDomain: true,
    persistence: {
      motion: `constant spherical speed/bearing from the most recent pre-initialization fix within ${PERSISTENCE_LOOKBACK_MAX_HOURS} hours`,
      missingMotionFallback: 'stationary',
      wind: 'held at initialization',
      pressure: 'held at initialization when available',
      futureFixesAllowed: false,
    },
    climatologyPersistence: {
      trainingPartition: 'development',
      predictors: 'pre-initialization motion plus basin-mean displacement by lead',
      fit: CLIPER_MODEL,
      validationAndTestExcludedFromFit: true,
    },
    bootstrap: {
      samplingUnit: 'storm',
      replicates: FIDELITY_BOOTSTRAP_REPLICATES,
      deterministic: true,
    },
    numericPrecisionDecimalPlaces: RESULT_DECIMAL_PLACES,
  },
  cases,
  aggregate: Object.fromEntries(
    ACTIVE_PARTITIONS.map((partition) => [
      partition,
      aggregateHindcasts(byPartition(partition)),
    ]),
  ),
  leadTimes: Object.fromEntries(
    ACTIVE_PARTITIONS.map((partition) => [
      partition,
      aggregateLeadTimes(
        byPartition(partition).map((row) => row.leadTimes),
      ),
    ]),
  ),
};

const canonicalBase = canonicalizeNumbers(outputBase);
let reference;
try {
  reference = canonicalizeNumbers(
    JSON.parse(await readFile(REFERENCE_PATH, 'utf8')),
  );
} catch {
  reference = referenceOf(canonicalBase);
}
const output = canonicalizeNumbers(
  PARTITION_FILTER
    ? canonicalBase
    : {
        ...canonicalBase,
        referenceComparison: compareReference(canonicalBase, reference),
      },
);
const resultsText = `${JSON.stringify(output, null, 2)}\n`;
const referenceText = `${JSON.stringify(reference, null, 2)}\n`;
const reportText = PARTITION_FILTER ? '' : makeReport(output);

if (PARTITION_FILTER && CHECK) {
  const matches = await compare(RESULTS_PATH, resultsText);
  if (!matches) {
    console.error(`[fidelity] FAIL ${PARTITION_FILTER} artifact drift`);
    process.exitCode = 1;
  } else {
    console.log(`[fidelity] PASS ${PARTITION_FILTER} artifact stable`);
  }
} else if (PARTITION_FILTER) {
  await writeFile(RESULTS_PATH, resultsText);
  console.log(
    `[fidelity] wrote ${RESULTS_PATH.slice(ROOT.length + 1)} (${cases.length} ${PARTITION_FILTER} storms)`,
  );
} else if (CHECK) {
  const matches = await Promise.all([
    compare(RESULTS_PATH, resultsText),
    compare(REFERENCE_PATH, referenceText),
    compare(REPORT_PATH, reportText),
  ]);
  if (!matches.every(Boolean) || !output.referenceComparison.passed) {
    console.error(
      `[fidelity] FAIL results=${matches[0]} reference=${matches[1]} report=${matches[2]} gate=${output.referenceComparison.passed}`,
    );
    process.exitCode = 1;
  } else {
    console.log('[fidelity] PASS 30 storms; validation reference stable');
  }
} else {
  await writeFile(RESULTS_PATH, resultsText);
  await writeFile(REFERENCE_PATH, referenceText);
  await writeFile(REPORT_PATH, reportText);
  console.log(
    '[fidelity] wrote calibration/fidelity-results.json, calibration/fidelity-reference.json, and docs/fidelity-benchmark.md',
  );
  console.log(
    `[fidelity] gate=${output.referenceComparison.passed ? 'PASS' : 'FAIL'} splits=${splitCounts.development}/${splitCounts.validation}/${splitCounts.test}`,
  );
  if (!output.referenceComparison.passed) process.exitCode = 1;
}

await vite.close();
