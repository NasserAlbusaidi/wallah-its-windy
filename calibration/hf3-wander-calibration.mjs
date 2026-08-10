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
  steering: resolve(ROOT, 'calibration/data/hf3-steering-manifest.json'),
  output: resolve(ROOT, 'calibration/hf3-wander-calibration.json'),
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const parseBuffer = (parseBin, bytes) =>
  parseBin(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [
  { parseBin },
  { parseScenarios },
  { parseTracks },
  { makeEnvSampler },
  { pressureWindSamplerFromBin, sampleEnvironmentalSteering },
  { betaDriftMs },
  { SCORING_DOMAIN },
] = await Promise.all([
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
  vite.ssrLoadModule('/src/env-sampler.ts'),
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);

const [scenarioText, trackText, steeringText] = await Promise.all([
  readFile(paths.scenarios, 'utf8'),
  readFile(paths.tracks, 'utf8'),
  readFile(paths.steering, 'utf8'),
]);
const scenarios = parseScenarios(JSON.parse(scenarioText));
const tracks = parseTracks(JSON.parse(trackText));
const steeringManifest = JSON.parse(steeringText);
if (!scenarios || !tracks) throw new Error('invalid HF-3 calibration inputs');
const trackById = new Map(tracks.map((track) => [track.id, track]));
const groupedResiduals = [];
const sourceArtifacts = [];
for (const scenario of scenarios.filter((item) => item.benchmarkPartition === 'development')) {
  const track = trackById.get(scenario.ghostId);
  const steeringRecord = steeringManifest.storms.find((item) => item.id === scenario.id);
  if (!track || !steeringRecord) throw new Error(`${scenario.id}: missing calibration input`);
  const [environmentBytes, steeringBytes] = await Promise.all([
    readFile(resolve(ROOT, scenario.bin)),
    readFile(resolve(ROOT, steeringRecord.path)),
  ]);
  const environment = parseBuffer(parseBin, environmentBytes);
  const steeringBin = parseBuffer(parseBin, steeringBytes);
  const env = makeEnvSampler(() => environment);
  env.setSamplingMode({ kind: 'event-timeline' });
  const pressure = pressureWindSamplerFromBin(
    () => steeringBin,
    () => ({ kind: 'event-timeline' }),
  );
  const startMs = Date.parse(scenario.hindcast.startIso);
  const eventStartMs = Date.parse(scenario.startIso);
  const rows = [];
  const points = track.points
    .filter((point) => Date.parse(point.iso) >= startMs)
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const previousMs = Date.parse(previous.iso);
    const currentMs = Date.parse(current.iso);
    const intervalHours = (currentMs - previousMs) / 3_600_000;
    const midpointMs = (previousMs + currentMs) / 2;
    const ageH = (midpointMs - startMs) / 3_600_000;
    if (!(intervalHours > 0) || ageH < 36) continue;
    const lat = (previous.lat + current.lat) / 2;
    const lon = (previous.lon + current.lon) / 2;
    if (
      lon < SCORING_DOMAIN.lonMin ||
      lon > SCORING_DOMAIN.lonMax ||
      lat < SCORING_DOMAIN.latMin ||
      lat > SCORING_DOMAIN.latMax
    ) {
      break;
    }
    const meanLatitudeRad = (lat * Math.PI) / 180;
    const observedU =
      ((current.lon - previous.lon) * 111.195 * Math.cos(meanLatitudeRad) * 1000) /
      (intervalHours * 3600);
    const observedV =
      ((current.lat - previous.lat) * 111.195 * 1000) /
      (intervalHours * 3600);
    const tFrac = clamp(
      (midpointMs - eventStartMs) / (scenario.windowH * 3_600_000),
      0,
      1,
    );
    const centre = env.sample(lat, lon, scenario.monthIndex, tFrac);
    const windKt =
      previous.windKt === null && current.windKt === null
        ? 50
        : ((previous.windKt ?? current.windKt) + (current.windKt ?? previous.windKt)) / 2;
    const organization = clamp(0.35 + 0.45 * ((windKt - 25) / 90), 0.25, 0.9);
    const annular = sampleEnvironmentalSteering(
      env,
      pressure,
      lat,
      lon,
      scenario.monthIndex,
      tFrac,
      windKt,
      organization,
      180,
    );
    const beta = betaDriftMs(lat, 180, windKt, 0.5);
    const targetU = centre.steerU * 0.95 + annular.u * 0.05 + beta.u;
    const targetV = centre.steerV * 0.95 + annular.v * 0.05 + beta.v;
    rows.push({ u: observedU - targetU, v: observedV - targetV, intervalHours });
  }
  if (rows.length > 0) groupedResiduals.push({ id: scenario.id, rows });
  sourceArtifacts.push({
    id: scenario.id,
    environmentSha256: digest(environmentBytes),
    pressureSteeringSha256: digest(steeringBytes),
  });
}
await vite.close();

const components = groupedResiduals.flatMap((group) =>
  group.rows.flatMap((row) => [row.u, row.v]),
);
const mean = components.reduce((sum, value) => sum + value, 0) / components.length;
const variance =
  components.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
  Math.max(1, components.length - 1);
let covariance = 0;
let lagPairs = 0;
for (const group of groupedResiduals) {
  for (let index = 1; index < group.rows.length; index += 1) {
    covariance +=
      (group.rows[index - 1].u - mean) * (group.rows[index].u - mean) +
      (group.rows[index - 1].v - mean) * (group.rows[index].v - mean);
    lagPairs += 2;
  }
}
covariance /= Math.max(1, lagPairs);
const intervalHours =
  groupedResiduals.flatMap((group) => group.rows).reduce(
    (sum, row) => sum + row.intervalHours,
    0,
  ) / groupedResiduals.flatMap((group) => group.rows).length;
const lagCorrelation = clamp(covariance / variance, 0.05, 0.99);
const tickHours = 0.25;
const tickPersistence = lagCorrelation ** (tickHours / intervalHours);
const rawRevertFraction = 1 - tickPersistence;
const rawUniformStepMs = Math.sqrt(3 * variance * (1 - tickPersistence ** 2));
const selected = {
  wanderStepMs: clamp(rawUniformStepMs, 0.05, 0.6),
  wanderRevertFraction: clamp(rawRevertFraction, 0.005, 0.15),
};
const output = {
  schemaVersion: 1,
  phase: 'HF-3',
  partition: 'development',
  method: 'Fit an isotropic Ornstein-Uhlenbeck unresolved-motion term to post-36h observed segment-velocity residuals after selected deterministic steering. Convert pooled lag correlation and stationary variance to the 15-minute uniform-innovation engine parameterization.',
  exclusions: [
    'validation and permanent test storms',
    'the first 36 hours represented by the explicit pre-advisory motion correction',
    'segments outside the product domain',
  ],
  bounds: {
    wanderStepMs: [0.05, 0.6],
    wanderRevertFraction: [0.005, 0.15],
  },
  diagnostics: {
    storms: groupedResiduals.length,
    vectorSegments: groupedResiduals.reduce((sum, group) => sum + group.rows.length, 0),
    componentSamples: components.length,
    meanResidualMs: mean,
    componentStdDevMs: Math.sqrt(variance),
    meanSegmentHours: intervalHours,
    lagPairs,
    lagCorrelation,
    rawUniformStepMs,
    rawRevertFraction,
  },
  selected,
  manifests: {
    scenariosSha256: digest(scenarioText),
    tracksSha256: digest(trackText),
    steeringManifestSha256: digest(steeringText),
    sourceArtifacts,
  },
  usage: 'Wander is disabled in deterministic hindcasts. These parameters apply only to sandbox stochastic paths and the HF-4 unresolved-physics ensemble component.',
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(paths.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-3 wander calibration is stale');
} else {
  await writeFile(paths.output, rendered);
  console.log(`[hf3] wrote calibration/hf3-wander-calibration.json (${output.diagnostics.vectorSegments} segments)`);
}
