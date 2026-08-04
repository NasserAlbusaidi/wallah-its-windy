#!/usr/bin/env node

/**
 * realism.mjs — the R2a realism measurement harness.
 *
 * Replays the frozen scenario set (calibration/realism/realism-scenarios.json)
 * through the REAL engine, rasterizes the simulated cloud-top
 * brightness-temperature PROXY field on the CPU at a fixed cadence, reduces it
 * with the R2a shortlist metrics, and seals the aggregate as a descriptive
 * regression reference.
 *
 * The gate is regression-only: it proves the simulated product did not move,
 * never that it is right. Improvements go through a human A/B protocol plus a
 * reseal (see calibration/realism/README.md).
 *
 * Determinism: every number passes through canonicalizeNumbers, every dynamic
 * map is serialized through explicitly sorted keys, every directory listing is
 * sorted, and manifest paths are normalized to forward slashes.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import {
  MAX_DRIFT_FRACTION,
  RESULT_DECIMAL_PLACES,
  RUN_CLASSES,
  aggregateClass,
  canonicalizeNumbers,
  compareReference,
  referenceOf,
  sortedMap,
} from './aggregate.mjs';
import { makeReport } from './report.mjs';

// This runner lives two levels below the repository root, not one.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK = process.argv.includes('--check');

const SCENARIO_SET_PATH = 'calibration/realism/realism-scenarios.json';
const APP_SCENARIOS_PATH = 'public/data/scenarios.json';
const TRACKS_PATH = 'public/data/tracks.json';
const TERRAIN_PATH = 'public/data/terrain.bin';
const OCEAN_PATH = 'public/data/ocean.bin';
const CLIMATOLOGY_ENV_PATH = 'public/data/env.bin';
const OBSERVED_DIR = 'calibration/realism/observed';
const RESULTS_PATH = resolve(ROOT, 'calibration/realism/realism-results.json');
const REFERENCE_PATH = resolve(ROOT, 'calibration/realism/realism-reference.json');
const REPORT_PATH = resolve(ROOT, 'docs/realism-benchmark.md');

/** Physics step, minutes — the app's SIM_DT_MIN. */
const TICK_MIN = 15;

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function readRootFile(relative) {
  return readFile(resolve(ROOT, relative));
}

// Startup guard: a wrong ROOT must fail loudly, not silently measure nothing.
for (const required of ['package.json', APP_SCENARIOS_PATH]) {
  try {
    await readRootFile(required);
  } catch {
    throw new Error(`realism: ROOT resolved to ${ROOT}, which has no ${required}`);
  }
}

const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});

const [
  { parseBin },
  { parseScenarios, eventSpawn, eventTimeFraction, samplingModeForSpawn },
  { parseTracks },
  { makeEnvSampler, synopticCount },
  { createSimEngine },
  { FlightRecorder },
  { observedInitialMotionMs, pressureWindSamplerFromBin },
  { sampleOceanProfileBin },
  { sampleLayerBilinear },
  { latLonToCell },
  {
    REALISM_GRID_N,
    RealismNoise,
    buildRealismField,
    computeDebrisState,
    midlevelRhUniform,
    quantizedLayerSampler,
  },
  { metricsForField },
  // The only render-path import: the pure genesis-seed helper the field
  // builder and the shipped cloud-memory pass both derive their seed from.
  { cloudSeedFromGenesis },
] = await Promise.all([
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
  vite.ssrLoadModule('/src/env-sampler.ts'),
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/flight-recorder.ts'),
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
  vite.ssrLoadModule('/src/raster-sampler.ts'),
  vite.ssrLoadModule('/src/grid.ts'),
  vite.ssrLoadModule('/src/realism-proxy.ts'),
  vite.ssrLoadModule('/src/realism-metrics.ts'),
  vite.ssrLoadModule('/src/render/cloud-motion.ts'),
]);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const artifactManifest = [];

function parseBuffer(buffer) {
  return parseBin(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
}

async function loadBin(relative, id) {
  const bytes = await readRootFile(relative);
  artifactManifest.push({
    id,
    // Artifact manifests are committed and checked byte-for-byte on Linux.
    // Normalize Windows separators so either platform generates the same JSON.
    path: relative.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: digest(bytes),
  });
  return parseBuffer(bytes);
}

async function loadJson(relative, id) {
  const text = await readRootFile(relative).then((bytes) => bytes.toString('utf8'));
  artifactManifest.push({
    id,
    path: relative.replaceAll('\\', '/'),
    bytes: Buffer.byteLength(text),
    sha256: digest(text),
  });
  return { text, value: JSON.parse(text) };
}

const scenarioSet = await loadJson(SCENARIO_SET_PATH, 'realism-scenarios');
const scenariosSha256 = digest(scenarioSet.text);
const spec = scenarioSet.value;
const appScenarios = parseScenarios((await loadJson(APP_SCENARIOS_PATH, 'app-scenarios')).value);
const tracks = parseTracks((await loadJson(TRACKS_PATH, 'tracks')).value);
if (!appScenarios || !tracks) throw new Error('realism: malformed scenarios/tracks assets');

// Runner-side validation the frozen scenario-set test cannot hold.
if (!Array.isArray(spec.events) || spec.events.length === 0) {
  throw new Error('realism: the scenario set must declare at least one event');
}
if (!Array.isArray(spec.climatology)) {
  throw new Error('realism: the scenario set must declare a climatology array');
}
const declaredIds = [...spec.events, ...spec.climatology.map((entry) => entry.id)];
const duplicateId = declaredIds.find((id, index) => declaredIds.indexOf(id) !== index);
if (duplicateId) throw new Error(`realism: duplicate scenario id ${duplicateId}`);

const terrain = await loadBin(TERRAIN_PATH, 'terrain');
const oceanBin = await loadBin(OCEAN_PATH, 'ocean-profiles');
const climatologyEnvBin = await loadBin(CLIMATOLOGY_ENV_PATH, 'climatology-env');

const landLayer = terrain.layers.get('landmask');
if (!landLayer) throw new Error('realism: terrain.bin is missing landmask');
const elevationLayer = terrain.layers.get('elev') ?? null;

/** Engine land predicate: the app's NEAREST-CELL `ui.isLand` (App-truth 3). */
function isLand(lat, lon) {
  const { col, row } = latLonToCell(
    { nx: landLayer.nx, ny: landLayer.ny, bbox: landLayer.bbox },
    lat,
    lon,
  );
  const c = Math.max(0, Math.min(landLayer.nx - 1, Math.round(col)));
  const r = Math.max(0, Math.min(landLayer.ny - 1, Math.round(row)));
  return landLayer.data[r * landLayer.nx + c] > 0.5;
}

/**
 * SHADER land input: binarize per texel, THEN bilinear (App-truth 9). Distinct
 * from `isLand` on purpose — coastal cells see fractional land in the field.
 */
const landTexel = quantizedLayerSampler(landLayer, (v) => (v > 0.5 ? 1 : 0));
const land01At = (lat, lon) => landTexel(0, lat, lon);

const terrainHeightM = (lat, lon) =>
  elevationLayer ? sampleLayerBilinear(elevationLayer, 0, lat, lon) : 0;
const oceanProfileSampler = (lat, lon, monthIndex) =>
  sampleOceanProfileBin(oceanBin, lat, lon, monthIndex);

/** One shared noise lattice: the renderer uploads exactly one texture. */
const noise = new RealismNoise();

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

function driveRun(engine, recorder, maxTicks) {
  let death = null;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const events = engine.tick(TICK_MIN);
    const state = engine.getState();
    if (!state) break;
    recorder.record(state, events);
    for (const event of events) if (event.type === 'died') death = { ...event.death };
    if (death) break;
  }
  return death;
}

async function replayEvent(scenarioId) {
  const scenario = appScenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`realism: unknown event scenario ${scenarioId}`);
  if (!scenario.hindcast) throw new Error(`realism: ${scenarioId} has no hindcast block`);
  const envBin = await loadBin(`public/${scenario.bin}`, `env-${scenarioId}`);
  // The app derives the sidecar path, never synthesizes it (App-truth 4).
  const steeringRelative = scenario.bin.replace(/(^|\/)env_/, '$1steering_');
  const steeringBin = await loadBin(`public/${steeringRelative}`, `steering-${scenarioId}`);
  const track = tracks.find((candidate) => candidate.id === scenario.ghostId);
  if (!track) throw new Error(`realism: ${scenarioId} has no ${scenario.ghostId} track`);

  const sampler = makeEnvSampler(() => envBin);
  sampler.setSamplingMode({ kind: 'event-timeline' });
  const engine = createSimEngine({
    env: sampler,
    isLand,
    terrainHeightM,
    pressureWindSampler: pressureWindSamplerFromBin(
      () => steeringBin,
      () => ({ kind: 'event-timeline' }),
    ),
    oceanProfileSampler,
  });
  // The app's hindcast spawn injects observed initial motion (App-truth 2).
  const motion = observedInitialMotionMs(track.points, scenario.hindcast.startIso);
  const spawn = {
    ...eventSpawn(scenario, null, 'hindcast'),
    ...(motion ? { initialMotionUms: motion.u, initialMotionVms: motion.v } : {}),
  };
  engine.spawn(spawn);
  const state = engine.getState();
  if (!state) throw new Error(`realism: ${scenarioId} did not spawn`);
  const recorder = new FlightRecorder();
  recorder.start(
    {
      spawn,
      environmentId: scenario.id,
      monthIndex: scenario.monthIndex,
      seed: spawn.seed,
      isDemo: false,
      label: `${scenario.label} hindcast`,
      counterfactual: false,
      hindcast: true,
      hindcastStartIso: scenario.hindcast.startIso,
    },
    state,
  );
  const durationH = Math.max(0, scenario.windowH - scenario.hindcast.envOffsetH);
  const death = driveRun(engine, recorder, Math.ceil((durationH * 60) / TICK_MIN));
  return {
    id: scenario.id,
    label: scenario.label,
    runClass: 'event',
    monthIndex: scenario.monthIndex,
    windowH: scenario.windowH,
    envBin,
    samplingMode: sampler.getSamplingMode(),
    sampler,
    frames: recorder.framesSnapshot(),
    death,
  };
}

function replayClimatology(entry) {
  const sampler = makeEnvSampler(() => climatologyEnvBin);
  sampler.setSamplingMode(
    samplingModeForSpawn(
      false,
      entry.seed,
      synopticCount(climatologyEnvBin, entry.monthIndex),
    ),
  );
  const engine = createSimEngine({
    env: sampler,
    isLand,
    terrainHeightM,
    // Climatology has no pressure-level sidecar: the app's holder is null.
    pressureWindSampler: pressureWindSamplerFromBin(
      () => null,
      () => sampler.getSamplingMode(),
    ),
    oceanProfileSampler,
  });
  const spawn = {
    lat: entry.lat,
    lon: entry.lon,
    monthIndex: entry.monthIndex,
    seed: entry.seed,
    isDemo: false,
  };
  engine.spawn(spawn);
  const state = engine.getState();
  if (!state) throw new Error(`realism: ${entry.id} did not spawn`);
  const recorder = new FlightRecorder();
  recorder.start(
    {
      spawn,
      environmentId: 'climatology',
      monthIndex: entry.monthIndex,
      seed: entry.seed,
      isDemo: false,
      label: entry.id,
      counterfactual: false,
    },
    state,
  );
  const death = driveRun(
    engine,
    recorder,
    Math.ceil((spec.climatologyMaxHours * 60) / TICK_MIN),
  );
  return {
    id: entry.id,
    label: entry.id,
    runClass: 'climatology',
    monthIndex: entry.monthIndex,
    windowH: null,
    envBin: climatologyEnvBin,
    samplingMode: sampler.getSamplingMode(),
    sampler,
    frames: recorder.framesSnapshot(),
    death,
  };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Last recorded frame at or before a cloud-memory boundary hour. */
function frameFinder(frames) {
  return (boundaryH) => {
    let found = null;
    for (const frame of frames) {
      if (frame.ageH > boundaryH + 1e-9) break;
      found = frame;
    }
    return found;
  };
}

/** ageH of the FIRST frame attaining the run's maximum vKt (sealed tie-break). */
function peakAgeHOf(frames) {
  let peakKt = -Infinity;
  let peakAgeH = 0;
  for (const frame of frames) {
    if (frame.vKt > peakKt) {
      peakKt = frame.vKt;
      peakAgeH = frame.ageH;
    }
  }
  return peakAgeH;
}

function measureRun(run) {
  const frames = run.frames;
  const genesis = frames.length > 0 ? { lat: frames[0].lat, lon: frames[0].lon } : null;
  const cloudSeed = cloudSeedFromGenesis(genesis);
  const atOrBefore = frameFinder(frames);
  const peakAgeH = peakAgeHOf(frames);
  const samples = [];
  for (const frame of frames) {
    if (!frame.alive) continue;
    if (frame.ageH < spec.sampleEveryH - 1e-9) continue;
    const steps = frame.ageH / spec.sampleEveryH;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) continue;

    // Display time base: the app's renderer samples the event environment
    // UNOFFSET while physics keeps tFracOffsetH (App-truth 1).
    const displayTFrac =
      run.runClass === 'event' ? eventTimeFraction(frame.ageH, run.windowH) : 0;
    const centre = run.sampler.sample(frame.lat, frame.lon, run.monthIndex, displayTFrac);
    const context = {
      frame,
      genesis,
      envShear: { u: centre.shearU, v: centre.shearV, magnitude: centre.shear },
      envSteer: { u: centre.steerU, v: centre.steerV },
      midlevelRh01: midlevelRhUniform(frame, centre),
      monthIndex: run.monthIndex,
      displayTFrac,
      samplingMode: run.samplingMode,
    };
    const debris = computeDebrisState(
      Math.floor(frame.ageH),
      atOrBefore,
      noise,
      cloudSeed,
      REALISM_GRID_N,
    );
    const field = buildRealismField(context, {
      envBin: run.envBin,
      land01At,
      noise,
      debris,
    });
    const metrics = metricsForField(field, context);
    samples.push({
      runClass: run.runClass,
      monthIndex: run.monthIndex,
      stage: frame.ageH <= peakAgeH + 1e-9 ? 'pre-peak' : 'post-peak',
      metrics,
    });
  }
  return {
    scenario: {
      id: run.id,
      label: run.label,
      class: run.runClass,
      monthIndex: run.monthIndex,
      tapeFrames: frames.length,
      runLengthH: frames.length > 0 ? frames[frames.length - 1].ageH : 0,
      peakAgeH,
      peakKt: frames.reduce((best, frame) => Math.max(best, frame.vKt), 0),
      died: run.death !== null,
      deathReason: run.death ? run.death.reason : null,
      sampledFrames: samples.length,
    },
    samples,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const measured = [];
for (const scenarioId of spec.events) {
  measured.push(measureRun(await replayEvent(scenarioId)));
  const last = measured[measured.length - 1].scenario;
  console.log(
    `[realism] ${last.id}: ${last.sampledFrames} sampled frames over ${last.runLengthH} h`,
  );
}
for (const entry of spec.climatology) {
  measured.push(measureRun(replayClimatology(entry)));
  const last = measured[measured.length - 1].scenario;
  console.log(
    `[realism] ${last.id}: ${last.sampledFrames} sampled frames over ${last.runLengthH} h`,
  );
}

const allSamples = measured.flatMap((row) => row.samples);
const outputBase = {
  schemaVersion: 1,
  generatedBy: 'calibration/realism/realism.mjs',
  scenariosSha256,
  protocol: {
    proxy:
      'simulated cloud-top brightness-temperature proxy (CPU twin of the env shader sampleCloud)',
    measurementPose: 'reducedMotion=false, cloudDetail=1, isDemo=false',
    gridN: REALISM_GRID_N,
    sampleEveryH: spec.sampleEveryH,
    minimumSampleAgeH: spec.sampleEveryH,
    climatologyMaxHours: spec.climatologyMaxHours,
    physicsTickMinutes: TICK_MIN,
    physicsProfile:
      'shipped physics profile (createSimEngine default, no parameter overrides)',
    displayTimeBase: 'eventTimeFraction(ageH, windowH), unoffset; 0 for climatology',
    landSemantics:
      'engine isLand = nearest-cell landmask; field land01At = binarize-then-bilinear',
    maxDriftFraction: MAX_DRIFT_FRACTION,
    numericPrecisionDecimalPlaces: RESULT_DECIMAL_PLACES,
  },
  artifactManifest: [...artifactManifest].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  ),
  // Sorted so the listing cannot depend on filesystem order. The schema
  // example and the directory's own README are documentation, not references.
  observedReferences: (await readdir(resolve(ROOT, OBSERVED_DIR)).catch(() => []))
    .filter((name) => !name.startsWith('EXAMPLE.') && name !== 'README.md')
    .sort(),
  scenarios: measured.map((row) => row.scenario),
  frameCounts: sortedMap(
    measured.map((row) => [row.scenario.id, row.scenario.sampledFrames]),
  ),
  aggregate: sortedMap(
    RUN_CLASSES.map((runClass) => [
      runClass,
      aggregateClass(allSamples.filter((sample) => sample.runClass === runClass)),
    ]),
  ),
};

const canonicalBase = canonicalizeNumbers(outputBase);
let reference;
try {
  reference = canonicalizeNumbers(JSON.parse(await readFile(REFERENCE_PATH, 'utf8')));
} catch {
  reference = referenceOf(canonicalBase);
}
const output = canonicalizeNumbers({
  ...canonicalBase,
  referenceComparison: compareReference(canonicalBase, reference),
});

const resultsText = `${JSON.stringify(output, null, 2)}\n`;
const referenceText = `${JSON.stringify(reference, null, 2)}\n`;
const reportText = makeReport(output);

async function matches(path, expected) {
  try {
    return (await readFile(path, 'utf8')) === expected;
  } catch {
    return false;
  }
}

if (CHECK) {
  const [resultsMatch, referenceMatch, reportMatch] = await Promise.all([
    matches(RESULTS_PATH, resultsText),
    matches(REFERENCE_PATH, referenceText),
    matches(REPORT_PATH, reportText),
  ]);
  if (
    !resultsMatch ||
    !referenceMatch ||
    !reportMatch ||
    !output.referenceComparison.passed
  ) {
    console.error(
      `[realism] FAIL results=${resultsMatch} reference=${referenceMatch} ` +
        `report=${reportMatch} gate=${output.referenceComparison.passed}`,
    );
    for (const issue of output.referenceComparison.issues.slice(0, 20)) {
      console.error(`[realism]   ${issue.kind} at ${issue.path}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `[realism] PASS ${output.scenarios.length} scenarios; sealed reference stable`,
    );
  }
} else {
  await writeFile(RESULTS_PATH, resultsText);
  await writeFile(REFERENCE_PATH, referenceText);
  await writeFile(REPORT_PATH, reportText);
  console.log(
    '[realism] wrote calibration/realism/realism-results.json, ' +
      'calibration/realism/realism-reference.json, and docs/realism-benchmark.md ' +
      `gate=${output.referenceComparison.passed ? 'PASS' : 'FAIL'} ` +
      `scenarios=${output.scenarios.length}`,
  );
  if (!output.referenceComparison.passed) process.exitCode = 1;
}

await vite.close();
