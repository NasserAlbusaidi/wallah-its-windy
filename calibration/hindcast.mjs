#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'public/data');
const RESULTS_PATH = resolve(ROOT, 'calibration/hindcast-results.json');
const REPORT_PATH = resolve(ROOT, 'docs/hindcast-benchmark.md');
const CHECK = process.argv.includes('--check');
const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [
  { aggregateHindcasts, evaluateHindcastCases },
  { parseBin },
  { parseScenarios },
  { DEFAULT_INTENSITY_PARAMETERS },
  { parseTracks },
] = await Promise.all([
  vite.ssrLoadModule('/src/hindcast-benchmark.ts'),
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
]);

// Frozen pre-search reference. Do not replace this with the live defaults: the
// report must continue to show whether the accepted calibration earned a gain.
const BASELINE = Object.freeze({
  intensifyKPerH: 0.08,
  shearThresholdMs: 14,
  shearKtPerHPerMs: 0.45,
  dryAirK: 0.9,
  organizationRecoveryH: 30,
  organizationDisruptionH: 10,
  ohcMpiWeight: 0.28,
  organizationIntensification: 0.5,
});

function parseBuffer(buffer) {
  return parseBin(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
}

async function loadBin(path) {
  return parseBuffer(await readFile(path));
}

function sameParameters(a, b) {
  return Object.keys(BASELINE).every((key) => a[key] === b[key]);
}

function candidateKey(parameters) {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${key}:${parameters[key]}`)
    .join('|');
}

function candidates() {
  const unique = new Map();
  const add = (parameters) =>
    unique.set(candidateKey(parameters), Object.freeze(parameters));
  add({ ...BASELINE });
  for (const intensifyKPerH of [0.07, 0.08, 0.09, 0.1]) {
    for (const shearKtPerHPerMs of [0.35, 0.45, 0.55]) {
      for (const ohcMpiWeight of [0.2, 0.28, 0.36]) {
        for (const organizationIntensification of [0.4, 0.5, 0.6]) {
          add({
            ...BASELINE,
            intensifyKPerH,
            shearKtPerHPerMs,
            ohcMpiWeight,
            organizationIntensification,
          });
        }
      }
    }
  }
  // Refine around the best physically plausible corner of the broad grid
  // without changing the predeclared held-out gates after seeing their result.
  for (const intensifyKPerH of [0.09, 0.095, 0.1]) {
    for (const shearKtPerHPerMs of [0.35, 0.375, 0.4]) {
      for (const ohcMpiWeight of [0.2, 0.24, 0.28]) {
        for (const organizationIntensification of [0.55, 0.575, 0.6]) {
          add({
            ...BASELINE,
            intensifyKPerH,
            shearKtPerHPerMs,
            ohcMpiWeight,
            organizationIntensification,
          });
        }
      }
    }
  }
  return [...unique.values()];
}

function improvement(before, after) {
  if (before === null || after === null || before === 0) return 0;
  return (before - after) / before;
}

function worstIntensityRegression(baseline, proposed) {
  const baselineById = new Map(
    baseline.map((result) => [result.id, result.score.intensityMaeKt]),
  );
  return Math.max(
    ...proposed.map((result) => {
      const before = baselineById.get(result.id);
      const after = result.score.intensityMaeKt;
      return before === null || before === undefined || after === null
        ? 0
        : after - before;
    }),
  );
}

function n(value, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function resultTable(baseline, proposed, deployed) {
  const byId = (results) => new Map(results.map((result) => [result.id, result]));
  const b = byId(baseline);
  const p = byId(proposed);
  const d = byId(deployed);
  return [
    '| Storm | Split | Track MAE km | Wind MAE kt | Pressure MAE hPa | Peak bias kt | Deployed wind MAE kt |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...baseline.map((row) => {
      const before = b.get(row.id).score;
      const candidate = p.get(row.id).score;
      const live = d.get(row.id).score;
      return `| ${row.label} | ${row.partition} | ${n(live.trackMaeKm)} | ${n(before.intensityMaeKt)} → ${n(candidate.intensityMaeKt)} | ${n(before.pressureMaeHpa)} → ${n(candidate.pressureMaeHpa)} | ${n(before.peakBiasKt)} → ${n(candidate.peakBiasKt)} | ${n(live.intensityMaeKt)} |`;
    }),
  ].join('\n');
}

function parameterTable(baseline, proposed, deployed) {
  return [
    '| Parameter | Baseline | Proposed | Deployed |',
    '| --- | ---: | ---: | ---: |',
    ...Object.keys(baseline).map(
      (key) =>
        `| \`${key}\` | ${baseline[key]} | ${proposed[key]} | ${deployed[key]} |`,
    ),
  ].join('\n');
}

function makeReport(output) {
  const verdict = output.decision.accepted ? 'ACCEPTED' : 'REJECTED';
  return `# Ten-storm historical hindcast benchmark

> Deterministic report generated by \`npm run calibrate:intensity\`. Metric
> values are not edited by hand.

## Verdict

**${verdict}.** ${output.decision.reason}

Seven complete storms were used for the constrained parameter search. Kyarr
2019, Shaheen 2021, and Biparjoy 2023 remained untouched until the candidate was
chosen. The held-out equal-storm objective changed by
**${(output.decision.validationImprovementFraction * 100).toFixed(1)}%**.

## Protocol

- Each replay starts from the first IBTrACS tropical-storm fix at least 1.2°
  inside the map, preventing a bbox-edge death from masquerading as model skill.
- ERA5 steering, deep-layer shear, 600/700-hPa humidity, and SST advance on the
  historical timeline. WOA23 supplies monthly ocean heat content.
- The simulation then runs freely: no observed position, motion, wind, or
  pressure is assimilated after initialization.
- The objective gives every storm equal weight and averages normalized wind MAE
  (20 kt), absolute peak bias (25 kt), and pressure MAE (20 hPa).
- Track error is reported but not optimized because the search changes only
  intensity/organization coefficients.
- Acceptance requires at least 3% held-out objective improvement, no held-out
  storm wind-MAE regression above 3 kt, pressure-MAE regression below 2 hPa,
  and track-MAE drift below 1 km.

Source tracks are the official
[NOAA IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive)
North Indian basin archive. Historical environmental inputs are
[ERA5](https://www.ecmwf.int/en/forecasts/datasets/era5-hourly-data-pressure-levels-1940-present)
plus WOA23. These are hindcasts, not operational forecasts.

## Results

${resultTable(
  output.baseline.all,
  output.proposed.all,
  output.deployed.all,
)}

Held-out aggregate: baseline wind MAE **${n(output.baseline.validationAggregate.intensityMaeKt)} kt**,
proposed **${n(output.proposed.validationAggregate.intensityMaeKt)} kt**;
baseline pressure MAE **${n(output.baseline.validationAggregate.pressureMaeHpa)} hPa**,
proposed **${n(output.proposed.validationAggregate.pressureMaeHpa)} hPa**.

## Parameters

${parameterTable(
  output.parameters.baseline,
  output.parameters.proposed,
  output.parameters.deployed,
)}

The search evaluated ${output.search.evaluatedCandidates} bounded candidates.
The live defaults exactly match the deployed decision:
**${output.liveParametersMatch ? 'yes' : 'no'}**.

## Structural validation

Intensity calibration is deliberately separate from the 39-storm JTWC
structure validation in [structure-calibration.md](./structure-calibration.md).
That report independently scores central pressure, RMW, and quadrant R34/R50/R64
wind radii on a frozen storm-level holdout.

## Important limits

- Simulated infrared and radar layers are structural proxies, not satellite or
  radar observations.
- The event grid is 0.5° and three-hourly after vortex filtering; it cannot
  resolve an eyewall.
- IBTrACS pressure and wind coverage varies by storm.
- A three-storm holdout is meaningful regression protection, not enough to claim
  operational forecast skill.
- Rain and cold-wake behavior remain physics- and sensitivity-validated; this
  benchmark does not score them against satellite rainfall or ocean-glider data.
`;
}

async function compare(path, expected) {
  try {
    return (await readFile(path, 'utf8')) === expected;
  } catch {
    return false;
  }
}

const scenarios = parseScenarios(
  JSON.parse(await readFile(resolve(DATA, 'scenarios.json'), 'utf8')),
);
const tracks = parseTracks(
  JSON.parse(await readFile(resolve(DATA, 'tracks.json'), 'utf8')),
);
if (!scenarios || !tracks) throw new Error('invalid benchmark catalogues');
if (scenarios.length !== 10) {
  throw new Error(`benchmark requires exactly 10 scenarios, got ${scenarios.length}`);
}
const terrain = await loadBin(resolve(DATA, 'terrain.bin'));
const trackById = new Map(tracks.map((track) => [track.id, track]));
const cases = await Promise.all(
  scenarios.map(async (scenario) => {
    const track = trackById.get(scenario.ghostId);
    if (!track) throw new Error(`${scenario.id}: missing ${scenario.ghostId}`);
    return {
      scenario,
      track,
      environment: await loadBin(resolve(ROOT, 'public', scenario.bin)),
    };
  }),
);
const calibrationCases = cases.filter(
  ({ scenario }) => scenario.benchmarkPartition === 'calibration',
);
const validationCases = cases.filter(
  ({ scenario }) => scenario.benchmarkPartition === 'validation',
);
if (calibrationCases.length !== 7 || validationCases.length !== 3) {
  throw new Error(
    `expected frozen 7/3 split, got ${calibrationCases.length}/${validationCases.length}`,
  );
}

const baselineAll = evaluateHindcastCases(cases, terrain, BASELINE, 'shipped');
const baselineCalibration = baselineAll.filter(
  ({ partition }) => partition === 'calibration',
);
const baselineValidation = baselineAll.filter(
  ({ partition }) => partition === 'validation',
);
let bestParameters = BASELINE;
let bestCalibration = aggregateHindcasts(baselineCalibration);
let evaluatedCandidates = 0;
for (const parameters of candidates()) {
  evaluatedCandidates += 1;
  const results = evaluateHindcastCases(
    calibrationCases,
    terrain,
    parameters,
    'shipped',
  );
  const aggregate = aggregateHindcasts(results);
  if (
    aggregate.objective !== null &&
    (bestCalibration.objective === null ||
      aggregate.objective < bestCalibration.objective)
  ) {
    bestParameters = parameters;
    bestCalibration = aggregate;
  }
}

const proposedAll = evaluateHindcastCases(
  cases,
  terrain,
  bestParameters,
  'shipped',
);
const proposedValidation = proposedAll.filter(
  ({ partition }) => partition === 'validation',
);
const baselineValidationAggregate = aggregateHindcasts(baselineValidation);
const proposedValidationAggregate = aggregateHindcasts(proposedValidation);
const validationImprovementFraction = improvement(
  baselineValidationAggregate.objective,
  proposedValidationAggregate.objective,
);
const maximumIntensityRegressionKt = worstIntensityRegression(
  baselineValidation,
  proposedValidation,
);
const pressureRegressionHpa =
  (proposedValidationAggregate.pressureMaeHpa ?? Infinity) -
  (baselineValidationAggregate.pressureMaeHpa ?? Infinity);
const trackRegressionKm =
  (proposedValidationAggregate.trackMaeKm ?? Infinity) -
  (baselineValidationAggregate.trackMaeKm ?? Infinity);
const accepted =
  validationImprovementFraction >= 0.03 &&
  maximumIntensityRegressionKt <= 3 &&
  pressureRegressionHpa <= 2 &&
  trackRegressionKm <= 1;
const deployedParameters = accepted ? bestParameters : BASELINE;
const deployedAll = accepted ? proposedAll : baselineAll;
const liveParametersMatch = sameParameters(
  DEFAULT_INTENSITY_PARAMETERS,
  deployedParameters,
);
const reason = accepted
  ? 'The calibration winner cleared every untouched validation gate.'
  : `The calibration winner failed at least one untouched gate (improvement ${(validationImprovementFraction * 100).toFixed(1)}%, worst wind-MAE regression ${maximumIntensityRegressionKt.toFixed(1)} kt, pressure regression ${pressureRegressionHpa.toFixed(1)} hPa, track regression ${trackRegressionKm.toFixed(2)} km).`;

const output = {
  schemaVersion: 1,
  source: {
    tracks: 'NOAA IBTrACS v04r01 North Indian basin USA/WMO fields',
    environment: 'ERA5 event fields and WOA23 monthly ocean heat content',
  },
  split: {
    calibration: calibrationCases.map(({ scenario }) => scenario.id),
    validation: validationCases.map(({ scenario }) => scenario.id),
  },
  protocol: {
    objective:
      'equal-storm mean of wind MAE/20 kt, absolute peak bias/25 kt, pressure MAE/20 hPa',
    minimumValidationImprovementFraction: 0.03,
    maximumPerStormWindMaeRegressionKt: 3,
    maximumMeanPressureMaeRegressionHpa: 2,
    maximumMeanTrackMaeRegressionKm: 1,
  },
  search: { evaluatedCandidates },
  parameters: {
    baseline: BASELINE,
    proposed: bestParameters,
    deployed: deployedParameters,
  },
  baseline: {
    all: baselineAll,
    calibrationAggregate: aggregateHindcasts(baselineCalibration),
    validationAggregate: baselineValidationAggregate,
  },
  proposed: {
    all: proposedAll,
    calibrationAggregate: bestCalibration,
    validationAggregate: proposedValidationAggregate,
  },
  deployed: {
    all: deployedAll,
    calibrationAggregate: aggregateHindcasts(
      deployedAll.filter(({ partition }) => partition === 'calibration'),
    ),
    validationAggregate: aggregateHindcasts(
      deployedAll.filter(({ partition }) => partition === 'validation'),
    ),
  },
  decision: {
    accepted,
    reason,
    validationImprovementFraction,
    maximumIntensityRegressionKt,
    pressureRegressionHpa,
    trackRegressionKm,
  },
  liveParametersMatch,
};
const resultsText = `${JSON.stringify(output, null, 2)}\n`;
const reportText = makeReport(output);

if (CHECK) {
  const resultsMatch = await compare(RESULTS_PATH, resultsText);
  const reportMatches = await compare(REPORT_PATH, reportText);
  if (!resultsMatch || !reportMatches || !liveParametersMatch) {
    console.error(
      `[hindcast-calibration] FAIL results=${resultsMatch} report=${reportMatches} liveParameters=${liveParametersMatch}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[hindcast-calibration] PASS 10 storms; held-out objective ${output.deployed.validationAggregate.objective.toFixed(3)}`,
    );
  }
} else {
  await writeFile(RESULTS_PATH, resultsText);
  await writeFile(REPORT_PATH, reportText);
  console.log(
    `[hindcast-calibration] wrote calibration/hindcast-results.json and docs/hindcast-benchmark.md`,
  );
  console.log(
    `[hindcast-calibration] proposed=${accepted ? 'ACCEPTED' : 'REJECTED'} held-out change=${(validationImprovementFraction * 100).toFixed(1)}% liveParameters=${liveParametersMatch}`,
  );
}
await vite.close();
