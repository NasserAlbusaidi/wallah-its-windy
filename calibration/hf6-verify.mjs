import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  catalog: resolve(ROOT, 'calibration/data/hf6-case-catalog.json'),
  tracks: resolve(ROOT, 'calibration/data/hf6-tracks.json'),
  scenarios: resolve(ROOT, 'calibration/data/hf6/sealed-scenarios.json'),
  steering: resolve(ROOT, 'calibration/data/hf6/steering-manifest.json'),
  terrain: resolve(ROOT, 'public/data/terrain.bin'),
  ocean: resolve(ROOT, 'public/data/ocean.bin'),
  hf2Selection: resolve(ROOT, 'calibration/hf2-candidate-selection.json'),
  hf3Selection: resolve(ROOT, 'calibration/hf3-candidate-selection.json'),
  runtimeSim: resolve(ROOT, 'src/sim.ts'),
  runtimeSteering: resolve(ROOT, 'src/steering.ts'),
  runtimeUpperOcean: resolve(ROOT, 'src/upper-ocean.ts'),
  runtimeVentilation: resolve(ROOT, 'src/ventilation.ts'),
  runtimeStructure: resolve(ROOT, 'src/structure.ts'),
  runtimeCoastalExposure: resolve(ROOT, 'src/coastal-exposure.ts'),
  runtimeHindcast: resolve(ROOT, 'src/hindcast-benchmark.ts'),
  runtimeVerifier: resolve(ROOT, 'calibration/hf6-verify.mjs'),
  output: resolve(ROOT, 'calibration/hf6-sealed-verification.json'),
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
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
  { aggregateHindcasts, runDetailedHindcastCase },
  { aggregateLeadTimes, verifyLeadTimes },
  { parseBin },
  { inBBox, greatCircleKm, DOMAIN },
  { scoreHindcast },
  { sampleOceanProfileBin },
  { observedInitialMotionMs, pressureWindSamplerFromBin },
] = await Promise.all([
  vite.ssrLoadModule('/src/hindcast-benchmark.ts'),
  vite.ssrLoadModule('/src/fidelity-verification.ts'),
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/grid.ts'),
  vite.ssrLoadModule('/src/hindcast.ts'),
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
  vite.ssrLoadModule('/src/steering.ts'),
]);
const entries = await Promise.all(
  Object.entries(paths)
    .filter(([key]) => key !== 'output')
    .map(async ([key, path]) => [key, await readFile(path)]),
);
const sources = Object.fromEntries(entries);
const catalog = JSON.parse(sources.catalog.toString('utf8'));
const tracksDocument = JSON.parse(sources.tracks.toString('utf8'));
const scenariosDocument = JSON.parse(sources.scenarios.toString('utf8'));
const steeringManifest = JSON.parse(sources.steering.toString('utf8'));
const hf2Selection = JSON.parse(sources.hf2Selection.toString('utf8'));
const hf3Selection = JSON.parse(sources.hf3Selection.toString('utf8'));
const parseBuffer = (bytes) => parseBin(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const terrain = parseBuffer(sources.terrain);
const ocean = parseBuffer(sources.ocean);
const trackById = new Map(tracksDocument.storms.map((track) => [track.id, track]));
const binCache = new Map();
const loadBin = async (path) => {
  if (!binCache.has(path)) {
    const bytes = await readFile(resolve(ROOT, path));
    binCache.set(path, { parsed: parseBuffer(bytes), bytes });
  }
  return binCache.get(path);
};
function canonicalTrack(track) {
  return {
    ...track,
    points: track.points.map((point) => ({
      iso: point.iso,
      lat: point.lat,
      lon: point.lon,
      windKt: point.windCanonicalOneMinute ? point.windKt : null,
      presMb: point.pressureCanonicalUsa ? point.presMb : null,
    })),
  };
}
function contiguous(track, startIso) {
  const points = [];
  for (const point of track.points) {
    if (Date.parse(point.iso) < Date.parse(startIso)) continue;
    if (!inBBox(point.lat, point.lon, DOMAIN)) break;
    points.push(point);
  }
  return { ...track, points };
}
const mean = (values) => {
  const finite = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return finite.length > 0
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
};
const radiiMean = (radii) =>
  radii ? mean([radii.ne, radii.se, radii.sw, radii.nw]) : null;
const maximum24HourChange = (values) => {
  let maximum = null;
  for (const start of values) {
    const end = values.find((item) => Math.abs(item.ageH - start.ageH - 24) < 1e-9);
    if (!end) continue;
    const change = end.windKt - start.windKt;
    maximum = maximum === null ? change : Math.max(maximum, change);
  }
  return maximum;
};
function outcomeVerification(rawTrack, scenario, detailed, frames) {
  const startMs = Date.parse(scenario.hindcast.startIso);
  const observedPoints = rawTrack.points
    .map((point) => ({ ...point, ageH: (Date.parse(point.iso) - startMs) / 3_600_000 }))
    .filter((point) => point.ageH >= 0 && point.ageH <= frames.at(-1).ageH + 1e-9);
  const observedCanonical = observedPoints
    .filter((point) => point.windCanonicalOneMinute && point.windKt !== null)
    .map((point) => ({ ageH: point.ageH, windKt: point.windKt }));
  const modelWind = frames.map((frame) => ({ ageH: frame.ageH, windKt: frame.vKt }));
  const observedPeak = observedCanonical.reduce(
    (best, item) => !best || item.windKt > best.windKt ? item : best,
    null,
  );
  const modelPeak = modelWind.reduce(
    (best, item) => !best || item.windKt > best.windKt ? item : best,
    null,
  );
  const observedLandfall = observedPoints.find(
    (point) => point.distanceToLandKm === 0 || point.nextLandfallDistanceKm === 0,
  ) ?? null;
  const modelLandfall = detailed.firstLandfall;
  const structureErrors = { rmwKm: [], r34Km: [], r50Km: [], r64Km: [] };
  for (const point of observedPoints) {
    const frame = frames.find((item) => Math.abs(item.ageH - point.ageH) < 1e-9);
    if (!frame) continue;
    if (point.rmwKm !== null) structureErrors.rmwKm.push(Math.abs(frame.structure.rmwKm - point.rmwKm));
    for (const threshold of ['r34Km', 'r50Km', 'r64Km']) {
      if (point[threshold] !== null) {
        structureErrors[threshold].push(
          Math.abs(radiiMean(frame.structure[threshold]) - point[threshold]),
        );
      }
    }
  }
  const observedRi = maximum24HourChange(observedCanonical);
  const modelRi = maximum24HourChange(modelWind);
  const observedDissipation = observedCanonical.length > 0 &&
    observedCanonical.some((item) => item.windKt >= 34) &&
    observedCanonical.at(-1).windKt < 34;
  const modelDissipation = detailed.death !== null && detailed.death.durationH <= frames.at(-1).ageH;
  return {
    landfall: {
      observed: observedLandfall !== null,
      model: modelLandfall !== null,
      positionErrorKm: observedLandfall && modelLandfall
        ? greatCircleKm(observedLandfall, modelLandfall)
        : null,
      timeErrorH: observedLandfall && modelLandfall
        ? modelLandfall.ageH - observedLandfall.ageH
        : null,
    },
    peak: {
      intensityErrorKt: observedPeak && modelPeak ? modelPeak.windKt - observedPeak.windKt : null,
      timeErrorH: observedPeak && modelPeak ? modelPeak.ageH - observedPeak.ageH : null,
    },
    rapidIntensification: {
      observed: observedRi === null ? null : observedRi >= 30,
      model: modelRi === null ? null : modelRi >= 30,
      maximum24HourChangeErrorKt: observedRi === null || modelRi === null
        ? null
        : modelRi - observedRi,
    },
    dissipation: { observed: observedDissipation, model: modelDissipation },
    structureMaeKm: Object.fromEntries(
      Object.entries(structureErrors).map(([key, values]) => [key, mean(values)]),
    ),
    thresholdEvents: Object.fromEntries([34, 64, 96].map((threshold) => [
      String(threshold),
      {
        observed: observedPeak ? observedPeak.windKt >= threshold : null,
        model: modelPeak ? modelPeak.windKt >= threshold : null,
      },
    ])),
  };
}
const cases = [];
for (const scenario of scenariosDocument.scenarios) {
  const rawTrack = trackById.get(scenario.ghostId);
  if (!rawTrack) throw new Error(`${scenario.id}: missing HF-6 track`);
  const verificationTrack = contiguous(canonicalTrack(rawTrack), scenario.hindcast.startIso);
  const fullCanonicalTrack = canonicalTrack(rawTrack);
  const [environmentArtifact, steeringArtifact] = await Promise.all([
    loadBin(scenario.bin),
    loadBin(scenario.steeringBin),
  ]);
  const motion = observedInitialMotionMs(fullCanonicalTrack.points, scenario.hindcast.startIso);
  const detailed = runDetailedHindcastCase(
    { scenario, track: verificationTrack, environment: environmentArtifact.parsed },
    terrain,
    hf2Selection.candidate.parameters,
    (lat, lon, monthIndex) => sampleOceanProfileBin(ocean, lat, lon, monthIndex),
    scenario.structureInitialization,
    motion ? { u: motion.u, v: motion.v } : undefined,
    pressureWindSamplerFromBin(
      () => steeringArtifact.parsed,
      () => ({ kind: 'event-timeline' }),
    ),
    hf3Selection.candidate.trackParameters,
  );
  const endH = (Date.parse(verificationTrack.points.at(-1).iso) -
    Date.parse(scenario.hindcast.startIso)) / 3_600_000;
  const commonFrames = detailed.frames.filter((frame) => frame.ageH <= endH + 1e-9);
  const frames = commonFrames.filter((frame) => frame.ageH > 0);
  const scoringTrack = {
    ...verificationTrack,
    points: verificationTrack.points.filter(
      (point) => Date.parse(point.iso) > Date.parse(scenario.hindcast.startIso),
    ),
  };
  const score = scoreHindcast(frames, scoringTrack, scenario.hindcast.startIso);
  if (!score) throw new Error(`${scenario.id}: no sealed score`);
  cases.push({
    id: scenario.id,
    caseId: scenario.caseId,
    initializationId: scenario.initializationId,
    score,
    outcomes: outcomeVerification(rawTrack, scenario, detailed, commonFrames),
    leads: verifyLeadTimes(
      detailed.frames,
      fullCanonicalTrack,
      scenario.hindcast.startIso,
    ),
  });
  console.log(`[hf6] ${scenario.id}`);
}
const output = round({
  schemaVersion: 1,
  phase: 'HF-6',
  claimClass: 'first-look-sealed-confirmation',
  sealId: catalog.sealId,
  evaluatedCandidates: {
    hf2: {
      selectionSha256: digest(sources.hf2Selection),
      parameters: hf2Selection.candidate.parameters,
    },
    hf3: {
      selectionSha256: digest(sources.hf3Selection),
      trackParameters: hf3Selection.candidate.trackParameters,
    },
  },
  storms: new Set(cases.map((item) => item.caseId)).size,
  initializations: cases.length,
  aggregate: aggregateHindcasts(cases.map((item) => ({
    id: item.id,
    label: item.id,
    partition: 'validation',
    score: item.score,
  }))),
  leads: aggregateLeadTimes(cases.map((item) => item.leads)),
  outcomes: {
    landfallPositionMaeKm: mean(cases.map((item) => item.outcomes.landfall.positionErrorKm)),
    landfallTimeMaeH: mean(cases.map((item) => {
      const error = item.outcomes.landfall.timeErrorH;
      return error === null ? null : Math.abs(error);
    })),
    landfallEventAccuracy: mean(cases.map((item) =>
      Number(item.outcomes.landfall.observed === item.outcomes.landfall.model))),
    peakIntensityMaeKt: mean(cases.map((item) => {
      const error = item.outcomes.peak.intensityErrorKt;
      return error === null ? null : Math.abs(error);
    })),
    peakTimeMaeH: mean(cases.map((item) => {
      const error = item.outcomes.peak.timeErrorH;
      return error === null ? null : Math.abs(error);
    })),
    rapidIntensificationEventAccuracy: mean(cases
      .filter((item) => item.outcomes.rapidIntensification.observed !== null)
      .map((item) => Number(
        item.outcomes.rapidIntensification.observed ===
        item.outcomes.rapidIntensification.model,
      ))),
    dissipationEventAccuracy: mean(cases.map((item) =>
      Number(item.outcomes.dissipation.observed === item.outcomes.dissipation.model))),
    structureMaeKm: Object.fromEntries(['rmwKm', 'r34Km', 'r50Km', 'r64Km'].map((key) => [
      key,
      mean(cases.map((item) => item.outcomes.structureMaeKm[key])),
    ])),
    thresholdEventAccuracy: Object.fromEntries([34, 64, 96].map((threshold) => {
      const key = String(threshold);
      const eligible = cases.filter((item) => item.outcomes.thresholdEvents[key].observed !== null);
      return [key, mean(eligible.map((item) => Number(
        item.outcomes.thresholdEvents[key].observed === item.outcomes.thresholdEvents[key].model,
      )))];
    })),
  },
  cases,
  manifests: {
    ...Object.fromEntries(
      Object.entries(sources).map(([key, bytes]) => [`${key}Sha256`, digest(bytes)]),
    ),
    forcing: [...binCache.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, item]) => ({
        path,
        bytes: item.bytes.byteLength,
        sha256: digest(item.bytes),
      })),
    steeringRecords: steeringManifest.storms.map((item) => ({
      id: item.id,
      sha256: item.sha256,
    })),
  },
});
const rendered = `${JSON.stringify(output, null, 2)}\n`;
await vite.close();
if (process.argv.includes('--check')) {
  const existing = await readFile(paths.output, 'utf8');
  if (existing !== rendered) {
    const previous = JSON.parse(existing);
    const current = JSON.parse(rendered);
    const differingKeys = Object.keys(current).filter(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
    );
    throw new Error(
      `HF-6 sealed verification is stale (${differingKeys.join(', ') || 'formatting'})`,
    );
  }
} else {
  await writeFile(paths.output, rendered);
  console.log('[hf6] wrote calibration/hf6-sealed-verification.json');
}
