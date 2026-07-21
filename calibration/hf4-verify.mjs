#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  scenarios: resolve(ROOT, 'calibration/data/fidelity-scenarios.json'),
  tracks: resolve(ROOT, 'calibration/data/fidelity-tracks.json'),
  terrain: resolve(ROOT, 'public/data/terrain.bin'),
  ocean: resolve(ROOT, 'public/data/ocean.bin'),
  eventOcean: resolve(ROOT, 'calibration/data/hf2a-event-ocean.bin'),
  eventOceanMeta: resolve(ROOT, 'calibration/data/hf2a-event-ocean.json'),
  steeringMeta: resolve(ROOT, 'calibration/data/hf3-steering-manifest.json'),
  initialStructure: resolve(ROOT, 'calibration/data/hf2-initial-structure.json'),
  hf2Selection: resolve(ROOT, 'calibration/hf2-candidate-selection.json'),
  hf3Selection: resolve(ROOT, 'calibration/hf3-candidate-selection.json'),
  runtimeEnsemble: resolve(ROOT, 'src/ensemble.ts'),
  runtimeEnsembleVerification: resolve(ROOT, 'src/ensemble-verification.ts'),
  runtimeSim: resolve(ROOT, 'src/sim.ts'),
  runtimeRng: resolve(ROOT, 'src/rng.ts'),
  runtimeSteering: resolve(ROOT, 'src/steering.ts'),
  runtimeUpperOcean: resolve(ROOT, 'src/upper-ocean.ts'),
  runtimeVentilation: resolve(ROOT, 'src/ventilation.ts'),
  runtimeVerifier: resolve(ROOT, 'calibration/hf4-verify.mjs'),
  contract: resolve(ROOT, 'calibration/hf4-contract.json'),
  output: resolve(ROOT, 'calibration/hf4-verification.json'),
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const parseBuffer = (parseBin, bytes) =>
  parseBin(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const round = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(9)) : null;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(item)]));
  }
  return value;
};

const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [
  { parseBin },
  { parseScenarios, eventSpawn },
  { parseTracks },
  { makeEnvSampler },
  {
    ALL_UNCERTAINTY_SOURCES,
    makeEnsembleMembers,
    perturbEnvironment,
    runStorm,
  },
  {
    aggregateEnsembleVerification,
    calibrateCone,
    verifyEnsembleLeads,
  },
  { pressureWindSamplerFromBin, observedInitialMotionMs },
  { sampleOceanProfileBin, sampleEventOceanProfileBin },
  { sampleLayerBilinear },
] = await Promise.all([
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
  vite.ssrLoadModule('/src/env-sampler.ts'),
  vite.ssrLoadModule('/src/ensemble.ts'),
  vite.ssrLoadModule('/src/ensemble-verification.ts'),
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
  vite.ssrLoadModule('/src/raster-sampler.ts'),
]);

const sourceEntries = await Promise.all(
  Object.entries(paths)
    .filter(([key]) => key !== 'output')
    .map(async ([key, path]) => [key, await readFile(path)]),
);
const sources = Object.fromEntries(sourceEntries);
const scenarios = parseScenarios(JSON.parse(sources.scenarios.toString('utf8')));
const tracks = parseTracks(JSON.parse(sources.tracks.toString('utf8')));
if (!scenarios || !tracks) throw new Error('invalid HF-4 benchmark inputs');
const steeringMetadata = JSON.parse(sources.steeringMeta.toString('utf8'));
const eventOceanMetadata = JSON.parse(sources.eventOceanMeta.toString('utf8'));
const initialStructure = JSON.parse(sources.initialStructure.toString('utf8'));
const hf2Selection = JSON.parse(sources.hf2Selection.toString('utf8'));
const hf3Selection = JSON.parse(sources.hf3Selection.toString('utf8'));
const contract = JSON.parse(sources.contract.toString('utf8'));
const terrain = parseBuffer(parseBin, sources.terrain);
const ocean = parseBuffer(parseBin, sources.ocean);
const eventOcean = parseBuffer(parseBin, sources.eventOcean);
const land = terrain.layers.get('landmask');
if (!land) throw new Error('terrain.bin is missing landmask');
const elevation = terrain.layers.get('elev');
const isLand = (lat, lon) => sampleLayerBilinear(land, 0, lat, lon) > 0.5;
const terrainHeightM = (lat, lon) =>
  elevation ? sampleLayerBilinear(elevation, 0, lat, lon) : 0;
const trackById = new Map(tracks.map((track) => [track.id, track]));
const prepared = new Map();

async function prepare(scenario) {
  const cached = prepared.get(scenario.id);
  if (cached) return cached;
  const track = trackById.get(scenario.ghostId);
  const steeringRecord = steeringMetadata.storms.find((item) => item.id === scenario.id);
  const structure = initialStructure.storms.find((item) => item.id === scenario.id);
  if (!track || !steeringRecord || !structure) throw new Error(`${scenario.id}: missing HF-4 input`);
  const [environmentBytes, steeringBytes] = await Promise.all([
    readFile(resolve(ROOT, scenario.bin)),
    readFile(resolve(ROOT, steeringRecord.path)),
  ]);
  const environmentBin = parseBuffer(parseBin, environmentBytes);
  const steeringBin = parseBuffer(parseBin, steeringBytes);
  const env = makeEnvSampler(() => environmentBin);
  env.setSamplingMode({ kind: 'event-timeline' });
  const pressureWindSampler = pressureWindSamplerFromBin(
    () => steeringBin,
    () => ({ kind: 'event-timeline' }),
  );
  const eventProfile = eventOceanMetadata.events.find((item) => item.id === scenario.id);
  const oceanProfileSampler = (lat, lon, monthIndex) =>
    (eventProfile
      ? sampleEventOceanProfileBin(eventOcean, lat, lon, eventProfile.layerIndex)
      : null) ?? sampleOceanProfileBin(ocean, lat, lon, monthIndex);
  const initialMotion = observedInitialMotionMs(track.points, scenario.hindcast.startIso);
  const spawn = {
    ...eventSpawn(scenario, null, 'hindcast'),
    initialRmwKm: structure.rmwKm ?? undefined,
    initialOuterSizeKm: structure.outerSizePriorKm ?? undefined,
    initialR34Km: structure.r34Km,
    initialR50Km: structure.r50Km,
    initialR64Km: structure.r64Km,
    initialMotionUms: initialMotion?.u,
    initialMotionVms: initialMotion?.v,
  };
  const value = {
    scenario,
    track,
    env,
    pressureWindSampler,
    oceanProfileSampler,
    spawn,
    manifest: {
      id: scenario.id,
      environmentSha256: digest(environmentBytes),
      pressureSteeringSha256: digest(steeringBytes),
    },
  };
  prepared.set(scenario.id, value);
  return value;
}

function runMembers(input, count, enabledSources) {
  const members = makeEnsembleMembers(
    input.spawn,
    count,
    input.spawn.seed,
    enabledSources,
    {
      intensityParameters: hf2Selection.candidate.parameters,
      trackParameters: hf3Selection.candidate.trackParameters,
    },
  );
  return members.map((member) =>
    runStorm({
      member: member.member,
      env: perturbEnvironment(input.env, member.environment),
      isLand,
      terrainHeightM,
      pressureWindSampler: input.pressureWindSampler,
      oceanProfileSampler: input.oceanProfileSampler,
      spawn: member.spawn,
      intensityParameters: member.intensityParameters,
      trackParameters: member.trackParameters,
      physicsProfile: 'hf2-experimental',
      maxHours: 96,
      trackStepHours: 3,
    }),
  );
}

const verificationRuns = new Map();
for (const scenario of scenarios.filter((item) => item.benchmarkPartition !== 'test')) {
  const input = await prepare(scenario);
  const runs = runMembers(input, contract.ensemble.verificationMembers, ALL_UNCERTAINTY_SOURCES);
  verificationRuns.set(scenario.id, { input, runs });
  console.log(`[hf4] ${scenario.id}: ${runs.length} verification members`);
}

const developmentRaw = scenarios
  .filter((item) => item.benchmarkPartition === 'development')
  .map((scenario) => {
    const { input, runs } = verificationRuns.get(scenario.id);
    return verifyEnsembleLeads(runs, input.track, scenario.hindcast.startIso);
  });
const coneCalibration = calibrateCone(developmentRaw);
const developmentCalibrated = scenarios
  .filter((item) => item.benchmarkPartition === 'development')
  .map((scenario) => {
    const { input, runs } = verificationRuns.get(scenario.id);
    return verifyEnsembleLeads(
      runs,
      input.track,
      scenario.hindcast.startIso,
      coneCalibration,
    );
  });
const eventClimatology = {};
for (const rows of developmentRaw) {
  for (const row of rows) {
    for (const event of row.intensityEvents) {
      const key = `${row.leadH}:${event.thresholdKt}`;
      const bucket = eventClimatology[key] ?? { events: 0, samples: 0 };
      bucket.events += Number(event.observed);
      bucket.samples += 1;
      eventClimatology[key] = bucket;
    }
  }
}
const eventClimatologyProbability = Object.fromEntries(
  Object.entries(eventClimatology).map(([key, value]) => [
    key,
    value.events / value.samples,
  ]),
);
const validationRows = scenarios
  .filter((item) => item.benchmarkPartition === 'validation')
  .map((scenario) => {
    const { input, runs } = verificationRuns.get(scenario.id);
    return verifyEnsembleLeads(
      runs,
      input.track,
      scenario.hindcast.startIso,
      coneCalibration,
    );
  });

const sourceAblations = {};
for (const source of ALL_UNCERTAINTY_SOURCES) {
  const rows = [];
  for (const scenario of scenarios.filter((item) => item.benchmarkPartition === 'development')) {
    const input = await prepare(scenario);
    const runs = runMembers(input, contract.ensemble.sourceAblationMembers, [source]);
    rows.push(verifyEnsembleLeads(runs, input.track, scenario.hindcast.startIso));
  }
  const summary = aggregateEnsembleVerification(rows);
  sourceAblations[source] = Object.fromEntries(
    summary.leads.map((lead) => [String(lead.leadH), lead.meanSpreadKm]),
  );
  console.log(`[hf4] source ablation: ${source}`);
}

function observedLandfall(input, horizonH = 96) {
  const start = Date.parse(input.scenario.hindcast.startIso);
  return input.track.points.some((point) => {
    const ageH = (Date.parse(point.iso) - start) / 3_600_000;
    return ageH >= 0 && ageH <= horizonH && isLand(point.lat, point.lon);
  });
}

const landfallVerification = scenarios
  .filter((item) => item.benchmarkPartition === 'validation')
  .map((scenario) => {
    const { input, runs } = verificationRuns.get(scenario.id);
    const probability = runs.filter((run) => run.landfall).length / runs.length;
    const observed = observedLandfall(input);
    const times = runs
      .flatMap((run) =>
        run.landfallEvents[0] ? [run.landfallEvents[0].ageH] : [],
      )
      .sort((a, b) => a - b);
    return {
      id: scenario.id,
      probability,
      observed,
      brier: (probability - Number(observed)) ** 2,
      memberLandfallTimesH: times,
    };
  });

const output = round({
  schemaVersion: 1,
  phase: 'HF-4',
  status: 'evaluated',
  members: contract.ensemble.verificationMembers,
  uncertaintySources: ALL_UNCERTAINTY_SOURCES,
  probabilityLabel: 'perturbation-frequency',
  coneCalibration,
  developmentEventClimatology: eventClimatologyProbability,
  development: aggregateEnsembleVerification(
    developmentCalibrated,
    eventClimatologyProbability,
  ),
  validation: aggregateEnsembleVerification(
    validationRows,
    eventClimatologyProbability,
  ),
  validationCases: scenarios
    .filter((item) => item.benchmarkPartition === 'validation')
    .map((scenario, index) => ({ id: scenario.id, leads: validationRows[index] })),
  sourceAblations,
  outcomes: {
    landfall: landfallVerification,
    meanLandfallBrier:
      landfallVerification.reduce((sum, item) => sum + item.brier, 0) /
      landfallVerification.length,
    genesis: 'not-applicable: every benchmark forecast initializes an existing tropical cyclone',
    dissipation: 'member death time is archived; independent best-track dissipation verification is deferred to HF-6 multi-initialization cases',
  },
  manifests: {
    ...Object.fromEntries(
      Object.entries(sources).map(([key, bytes]) => [
        `${key}Sha256`,
        digest(bytes),
      ]),
    ),
    cases: [...prepared.values()].map((item) => item.manifest),
  },
});
const rendered = `${JSON.stringify(output, null, 2)}\n`;
await vite.close();
if (process.argv.includes('--check')) {
  const existing = await readFile(paths.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-4 verification artifact is stale');
} else {
  await writeFile(paths.output, rendered);
  console.log('[hf4] wrote calibration/hf4-verification.json');
}
