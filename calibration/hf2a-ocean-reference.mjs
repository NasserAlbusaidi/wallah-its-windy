#!/usr/bin/env node

/** Freeze the empirical HF-1 wake on the independent HF-2A SST observations.
 *
 * The observed best track and wind force both the legacy and future candidate
 * ocean models.  This isolates ocean response from track/intensity forecast
 * error.  The coupled cyclone is evaluated separately by fidelity.mjs.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(ROOT, 'calibration/fidelity-catalog.json');
const TRACKS_PATH = resolve(ROOT, 'calibration/data/fidelity-tracks.json');
const SCENARIOS_PATH = resolve(ROOT, 'calibration/data/fidelity-scenarios.json');
const OBS_META_PATH = resolve(
  ROOT,
  'calibration/data/hf2a-ocean-observations.json',
);
const OBS_BIN_PATH = resolve(
  ROOT,
  'calibration/data/hf2a-ocean-observations.bin',
);
const TERRAIN_PATH = resolve(ROOT, 'public/data/terrain.bin');
const OCEAN_PATH = resolve(ROOT, 'public/data/ocean.bin');
const EVENT_OCEAN_PATH = resolve(ROOT, 'calibration/data/hf2a-event-ocean.bin');
const EVENT_OCEAN_META_PATH = resolve(ROOT, 'calibration/data/hf2a-event-ocean.json');
const CANDIDATE = process.argv.includes('--candidate');
const PARTITION_FILTER = process.argv
  .find((argument) => argument.startsWith('--partition='))
  ?.slice('--partition='.length);
if (
  PARTITION_FILTER &&
  !['development', 'validation', 'test'].includes(PARTITION_FILTER)
) {
  throw new Error(`invalid partition filter: ${PARTITION_FILTER}`);
}
const STORM_FILTER = process.argv
  .find((argument) => argument.startsWith('--storm='))
  ?.slice('--storm='.length);
const OUTPUT_PATH = resolve(
  ROOT,
  CANDIDATE
    ? `calibration/hf2a-ocean-candidate${PARTITION_FILTER ? `-${PARTITION_FILTER}` : ''}${STORM_FILTER ? `-${STORM_FILTER}` : ''}.json`
    : 'calibration/hf2a-ocean-reference.json',
);
const CHECK = process.argv.includes('--check');
const DT_H = 0.25;
const EARTH_KM_PER_DEG = 111.195;
const PRECISION = 6;

const vite = await createServer({
  root: ROOT,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});

const [
  { parseBin },
  { sampleEnvBin },
  { sampleLayerBilinear },
  { deriveStormStructure },
  { greatCircleKm, inBBox, DOMAIN },
  { SIM },
  { SparseUpperOcean, DEFAULT_UPPER_OCEAN_PARAMETERS },
  { sampleOceanProfileBin, sampleEventOceanProfileBin },
] = await Promise.all([
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/env-sampler.ts'),
  vite.ssrLoadModule('/src/raster-sampler.ts'),
  vite.ssrLoadModule('/src/structure.ts'),
  vite.ssrLoadModule('/src/grid.ts'),
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/upper-ocean.ts'),
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
]);

function numberArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isFinite(value)) throw new Error(`invalid ${name}: ${raw}`);
  return value;
}

const CANDIDATE_PARAMETERS = Object.freeze({
  bulkRichardsonCritical: numberArgument(
    'ri',
    DEFAULT_UPPER_OCEAN_PARAMETERS.bulkRichardsonCritical,
  ),
  momentumDampingInertialPeriods: numberArgument(
    'damping',
    DEFAULT_UPPER_OCEAN_PARAMETERS.momentumDampingInertialPeriods,
  ),
  thermalRecoveryHours: numberArgument(
    'recovery',
    DEFAULT_UPPER_OCEAN_PARAMETERS.thermalRecoveryHours,
  ),
});

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseBuffer(buffer) {
  return parseBin(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  );
}

function roundNumbers(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return value;
    const rounded = Number(value.toFixed(PRECISION));
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, roundNumbers(item)]),
    );
  }
  return value;
}

function mean(values) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * fraction;
  const lower = Math.floor(at);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const weight = at - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function contiguousTrack(track, startIso) {
  const startMs = Date.parse(startIso);
  const points = [];
  let started = false;
  for (const point of track.points) {
    const timeMs = Date.parse(point.iso);
    if (!Number.isFinite(timeMs) || timeMs < startMs) continue;
    if (!inBBox(point.lat, point.lon, DOMAIN)) {
      if (started) break;
      continue;
    }
    started = true;
    points.push({ ...point, timeMs });
  }
  if (points.length < 2) throw new Error(`${track.id}: insufficient scored track`);
  return points;
}

function valueBetween(left, right, key, weight) {
  const a = left[key];
  const b = right[key];
  if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * weight;
  if (Number.isFinite(a)) return a;
  if (Number.isFinite(b)) return b;
  return 0;
}

function trackAt(points, timeMs, cursor) {
  while (
    cursor.index < points.length - 2 &&
    points[cursor.index + 1].timeMs < timeMs
  ) {
    cursor.index += 1;
  }
  const left = points[cursor.index];
  const right = points[Math.min(points.length - 1, cursor.index + 1)];
  const span = Math.max(1, right.timeMs - left.timeMs);
  const weight = Math.max(0, Math.min(1, (timeMs - left.timeMs) / span));
  const lat = valueBetween(left, right, 'lat', weight);
  const lon = valueBetween(left, right, 'lon', weight);
  const meanLatRad = ((left.lat + right.lat) * 0.5 * Math.PI) / 180;
  const seconds = span / 1000;
  const motionUms =
    ((right.lon - left.lon) * EARTH_KM_PER_DEG * Math.cos(meanLatRad) * 1000) /
    seconds;
  const motionVms =
    ((right.lat - left.lat) * EARTH_KM_PER_DEG * 1000) / seconds;
  return {
    lat,
    lon,
    vKt: Math.max(0, valueBetween(left, right, 'windKt', weight)),
    motionUms,
    motionVms,
  };
}

function readObservationStorms(metadata, bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'HF2O' || view.getUint16(4, true) !== 1) {
    throw new Error('unsupported HF-2A observation binary');
  }
  const recordBytes = view.getUint16(6, true);
  if (recordBytes !== 56) throw new Error(`unexpected observation record ${recordBytes}`);
  const output = new Map();
  for (const manifest of metadata.binary.storms) {
    const pixels = [];
    let offset = manifest.byteOffset;
    for (let index = 0; index < manifest.records; index += 1) {
      const lat = view.getFloat32(offset, true);
      const lon = view.getFloat32(offset + 4, true);
      const distanceToTrackKm = view.getFloat32(offset + 8, true);
      const backgroundSstC = view.getFloat32(offset + 12, true);
      const passageUnixS = Number(view.getBigInt64(offset + 16, true));
      const lead24 = {
        deltaSstC: view.getFloat32(offset + 24, true),
        analysisErrorC: view.getFloat32(offset + 28, true),
        validUnixS: Number(view.getBigInt64(offset + 32, true)),
      };
      const lead48 = {
        deltaSstC: view.getFloat32(offset + 40, true),
        analysisErrorC: view.getFloat32(offset + 44, true),
        validUnixS: Number(view.getBigInt64(offset + 48, true)),
      };
      pixels.push({
        lat,
        lon,
        distanceToTrackKm,
        backgroundSstC,
        passageUnixS,
        leads: { 24: lead24, 48: lead48 },
      });
      offset += recordBytes;
    }
    if (offset !== manifest.byteOffset + manifest.byteLength) {
      throw new Error(`${manifest.id}: observation binary length mismatch`);
    }
    output.set(manifest.id, pixels);
  }
  return output;
}

function decayPatches(patches, dtH) {
  if (dtH <= 0) return patches;
  const factor = Math.exp(-dtH / SIM.COLD_WAKE_RECOVERY_H);
  for (const patch of patches) {
    patch.coolingC *= factor;
    patch.ageH += dtH;
  }
  return patches.filter(
    (patch) =>
      patch.ageH <= SIM.COLD_WAKE_MAX_AGE_H && patch.coolingC >= 1e-9,
  );
}

function samplePatches(patches, lat, lon) {
  let cooling = 0;
  for (const patch of patches) {
    const distanceKm = greatCircleKm(
      { lat, lon },
      { lat: patch.lat, lon: patch.lon },
    );
    const sigmaKm = Math.max(20, patch.radiusKm * 0.5);
    cooling +=
      patch.coolingC *
      Math.exp(-(distanceKm * distanceKm) / (2 * sigmaKm * sigmaKm));
  }
  return Math.min(SIM.COLD_WAKE_MAX_C, Math.max(0, cooling));
}

function depositPatch(patches, state, environment, radiusKm, dtH, isLand) {
  if (isLand(state.lat, state.lon) || state.vKt < 25) return;
  const intensity = Math.max(0, Math.min(1, (state.vKt - 20) / 90));
  const shallowOcean = Math.max(
    0.35,
    Math.min(2, 50 / Math.max(10, environment.ohcKjCm2)),
  );
  const motionSpeedMs = Math.hypot(state.motionUms, state.motionVms);
  const stagnation = Math.max(
    0.35,
    Math.min(2, 5 / Math.max(1, motionSpeedMs + 0.5)),
  );
  const added =
    SIM.COLD_WAKE_K_C_PER_H *
    intensity *
    intensity *
    shallowOcean *
    stagnation *
    dtH;
  if (added <= 0) return;
  let nearest = null;
  let nearestKm = Infinity;
  for (const patch of patches) {
    const distanceKm = greatCircleKm(
      { lat: state.lat, lon: state.lon },
      { lat: patch.lat, lon: patch.lon },
    );
    if (distanceKm < nearestKm) {
      nearest = patch;
      nearestKm = distanceKm;
    }
  }
  const mergeRadiusKm = Math.max(15, radiusKm * 0.2);
  if (nearest && nearestKm <= mergeRadiusKm) {
    nearest.coolingC = Math.min(
      SIM.COLD_WAKE_MAX_C,
      nearest.coolingC + added,
    );
    nearest.radiusKm = Math.max(nearest.radiusKm, radiusKm);
    nearest.ageH = 0;
  } else {
    patches.push({
      lat: state.lat,
      lon: state.lon,
      coolingC: added,
      radiusKm: Math.max(45, radiusKm),
      ageH: 0,
    });
  }
}

function scoreLead(pixels, predictions, leadH) {
  const observedDelta = pixels.map((pixel) => pixel.leads[leadH].deltaSstC);
  const predictedDelta = predictions.map((cooling) => -cooling);
  const errors = predictedDelta.map((value, index) => value - observedDelta[index]);
  const observedCooling = observedDelta.map((value) => Math.max(0, -value));
  return {
    pixels: pixels.length,
    deltaSstMaeC: mean(errors.map(Math.abs)),
    deltaSstBiasC: mean(errors),
    observedMeanCoolingC: mean(observedCooling),
    predictedMeanCoolingC: mean(predictions),
    meanCoolingAbsErrorC: Math.abs(mean(predictions) - mean(observedCooling)),
    observedPeakCoolingP95C: percentile(observedCooling, 0.95),
    predictedPeakCoolingP95C: percentile(predictions, 0.95),
    peakCoolingAbsErrorC: Math.abs(
      percentile(predictions, 0.95) - percentile(observedCooling, 0.95),
    ),
  };
}

async function legacyStorm({ scenario, track, pixels, environment, isLand }) {
  const points = contiguousTrack(track, scenario.hindcast.startIso);
  const startMs = points[0].timeMs;
  const stopMs = points.at(-1).timeMs;
  const observationEvents = new Map();
  for (const leadH of [24, 48]) {
    for (let index = 0; index < pixels.length; index += 1) {
      const timeMs = pixels[index].leads[leadH].validUnixS * 1000;
      const key = `${timeMs}`;
      const event = observationEvents.get(key) ?? {
        timeMs,
        samples: [],
      };
      event.samples.push({ index, leadH });
      observationEvents.set(key, event);
    }
  }
  const events = [...observationEvents.values()].sort((a, b) => a.timeMs - b.timeMs);
  const predictions = {
    24: new Float64Array(pixels.length),
    48: new Float64Array(pixels.length),
  };
  let eventIndex = 0;
  let timeMs = startMs;
  let patches = [];
  const cursor = { index: 0 };
  let state = trackAt(points, timeMs, cursor);
  const initialTfrac = Math.max(
    0,
    Math.min(1, (timeMs - Date.parse(scenario.startIso)) / 3_600_000 / scenario.windowH),
  );
  let env = sampleEnvBin(
    environment,
    state.lat,
    state.lon,
    scenario.monthIndex,
    initialTfrac,
    { kind: 'event-timeline' },
  );
  if (!env) throw new Error(`${scenario.id}: environment sampling failed`);
  let structure = deriveStormStructure({
    ...state,
    shearMs: env.shear,
    shearUms: env.shearU,
    shearVms: env.shearV,
    overLand: isLand(state.lat, state.lon),
  });

  const finishMs = Math.max(stopMs, events.at(-1)?.timeMs ?? stopMs);
  while (timeMs < finishMs - 1) {
    const nextTickMs = timeMs < stopMs ? Math.min(stopMs, timeMs + DT_H * 3_600_000) : Infinity;
    const nextEventMs = events[eventIndex]?.timeMs ?? Infinity;
    const nextMs = Math.min(nextTickMs, nextEventMs, finishMs);
    patches = decayPatches(patches, (nextMs - timeMs) / 3_600_000);
    timeMs = nextMs;
    if (nextTickMs === nextMs && timeMs <= stopMs) {
      state = trackAt(points, timeMs, cursor);
      const tfrac = Math.max(
        0,
        Math.min(1, (timeMs - Date.parse(scenario.startIso)) / 3_600_000 / scenario.windowH),
      );
      env = sampleEnvBin(
        environment,
        state.lat,
        state.lon,
        scenario.monthIndex,
        tfrac,
        { kind: 'event-timeline' },
      );
      if (!env) throw new Error(`${scenario.id}: environment sampling failed`);
      structure = deriveStormStructure({
        ...state,
        shearMs: env.shear,
        shearUms: env.shearU,
        shearVms: env.shearV,
        overLand: isLand(state.lat, state.lon),
        previousRmwKm: structure.rmwKm,
        previousOuterSizeKm: structure.outerSizeKm,
        deltaHours: DT_H,
      });
      depositPatch(patches, state, env, structure.outerSizeKm, DT_H, isLand);
    }
    while (events[eventIndex]?.timeMs === timeMs) {
      for (const sample of events[eventIndex].samples) {
        const pixel = pixels[sample.index];
        predictions[sample.leadH][sample.index] = samplePatches(
          patches,
          pixel.lat,
          pixel.lon,
        );
      }
      eventIndex += 1;
    }
  }
  return {
    leads: [24, 48].map((leadH) => ({
      leadH,
      ...scoreLead(pixels, [...predictions[leadH]], leadH),
    })),
  };
}

function oceanCellKey(lat, lon) {
  const col = Math.max(0, Math.min(199, Math.round((lon - 50) / 0.1 - 0.5)));
  const row = Math.max(0, Math.min(119, Math.round((27 - lat) / 0.1 - 0.5)));
  return `${col}:${row}`;
}

async function dynamicStorm({
  scenario,
  track,
  pixels,
  environment,
  oceanProfiles,
  eventOceanProfiles,
  eventOcean,
  isLand,
}) {
  const points = contiguousTrack(track, scenario.hindcast.startIso);
  const startMs = points[0].timeMs;
  const stopMs = points.at(-1).timeMs;
  const initialTfrac = Math.max(
    0,
    Math.min(1, (startMs - Date.parse(scenario.startIso)) / 3_600_000 / scenario.windowH),
  );
  const pixelByCell = new Map();
  for (const pixel of pixels) pixelByCell.set(oceanCellKey(pixel.lat, pixel.lon), pixel);
  const eventProfile = eventOcean.events.find((item) => item.id === scenario.id);
  const ocean = new SparseUpperOcean(CANDIDATE_PARAMETERS);
  ocean.reset((lat, lon) => {
    const pixel = pixelByCell.get(oceanCellKey(lat, lon));
    const sampled = sampleEnvBin(
      environment,
      lat,
      lon,
      scenario.monthIndex,
      initialTfrac,
      { kind: 'event-timeline' },
    );
    if (!sampled) throw new Error(`${scenario.id}: ocean initialization failed`);
    const eventSampleRaw = eventProfile
      ? sampleEventOceanProfileBin(
          eventOceanProfiles,
          lat,
          lon,
          eventProfile.layerIndex,
        )
      : null;
    const eventSample = eventSampleRaw && eventProfile
      ? { ...eventSampleRaw, sourceValidTime: eventProfile.sourceMonth }
      : null;
    const climatologySample = sampleOceanProfileBin(
      oceanProfiles,
      lat,
      lon,
      scenario.monthIndex,
    );
    const selectedSample = eventSample ?? climatologySample;
    return {
      sstC: pixel?.backgroundSstC ?? sampled.sstC,
      ohcKjCm2: sampled.ohcKjCm2,
      // Every provenance field comes from the same branch that supplied data.
      initializationTier: selectedSample?.tier ?? 'analytic-fallback',
      sourceValidTime: selectedSample?.sourceValidTime,
      profile: selectedSample?.profile,
    };
  });

  const observationEvents = new Map();
  for (const leadH of [24, 48]) {
    for (let index = 0; index < pixels.length; index += 1) {
      const timeMs = pixels[index].leads[leadH].validUnixS * 1000;
      const key = `${timeMs}`;
      const event = observationEvents.get(key) ?? { timeMs, samples: [] };
      event.samples.push({ index, leadH });
      observationEvents.set(key, event);
    }
  }
  const events = [...observationEvents.values()].sort((a, b) => a.timeMs - b.timeMs);
  const predictions = {
    24: new Float64Array(pixels.length),
    48: new Float64Array(pixels.length),
  };
  const cursor = { index: 0 };
  let eventIndex = 0;
  let timeMs = startMs;
  let state = trackAt(points, timeMs, cursor);
  let env = sampleEnvBin(
    environment,
    state.lat,
    state.lon,
    scenario.monthIndex,
    initialTfrac,
    { kind: 'event-timeline' },
  );
  if (!env) throw new Error(`${scenario.id}: environment sampling failed`);
  let structure = deriveStormStructure({
    ...state,
    shearMs: env.shear,
    shearUms: env.shearU,
    shearVms: env.shearV,
    overLand: isLand(state.lat, state.lon),
  });
  const finishMs = Math.max(stopMs, events.at(-1)?.timeMs ?? stopMs);
  while (timeMs < finishMs - 1) {
    const nextTickMs =
      timeMs < stopMs
        ? Math.min(stopMs, timeMs + DT_H * 3_600_000)
        : Infinity;
    const nextEventMs = events[eventIndex]?.timeMs ?? Infinity;
    const nextMs = Math.min(nextTickMs, nextEventMs, finishMs);
    timeMs = nextMs;
    if (nextTickMs === nextMs && timeMs <= stopMs) {
      const previousState = state;
      const previousStructure = structure;
      state = trackAt(points, timeMs, cursor);
      const tfrac = Math.max(
        0,
        Math.min(1, (timeMs - Date.parse(scenario.startIso)) / 3_600_000 / scenario.windowH),
      );
      env = sampleEnvBin(
        environment,
        state.lat,
        state.lon,
        scenario.monthIndex,
        tfrac,
        { kind: 'event-timeline' },
      );
      if (!env) throw new Error(`${scenario.id}: environment sampling failed`);
      structure = deriveStormStructure({
        ...state,
        shearMs: env.shear,
        shearUms: env.shearU,
        shearVms: env.shearV,
        overLand: isLand(state.lat, state.lon),
        previousRmwKm: structure.rmwKm,
        previousOuterSizeKm: structure.outerSizeKm,
        deltaHours: DT_H,
      });
      ocean.forceSegment(
        {
          lat: previousState.lat,
          lon: previousState.lon,
          structure: previousStructure,
        },
        { lat: state.lat, lon: state.lon, structure },
        DT_H,
        (timeMs - startMs) / 3_600_000,
        isLand,
      );
    }
    while (events[eventIndex]?.timeMs === timeMs) {
      for (const sample of events[eventIndex].samples) {
        const pixel = pixels[sample.index];
        predictions[sample.leadH][sample.index] = ocean.sample(
          pixel.lat,
          pixel.lon,
          (timeMs - startMs) / 3_600_000,
        ).coolingC;
      }
      eventIndex += 1;
    }
  }
  return {
    leads: [24, 48].map((leadH) => ({
      leadH,
      ...scoreLead(pixels, [...predictions[leadH]], leadH),
    })),
  };
}

function aggregatePartition(cases, partition) {
  const selected = cases.filter((item) => item.partition === partition);
  return {
    storms: selected.length,
    leads: [24, 48].map((leadH) => {
      const rows = selected.map((item) => item.leads.find((lead) => lead.leadH === leadH));
      return {
        leadH,
        storms: rows.length,
        pixels: rows.reduce((sum, row) => sum + row.pixels, 0),
        deltaSstMaeC: mean(rows.map((row) => row.deltaSstMaeC)),
        deltaSstBiasC: mean(rows.map((row) => row.deltaSstBiasC)),
        meanCoolingAbsErrorC: mean(rows.map((row) => row.meanCoolingAbsErrorC)),
        peakCoolingAbsErrorC: mean(rows.map((row) => row.peakCoolingAbsErrorC)),
      };
    }),
  };
}

const [
  catalogBytes,
  tracksBytes,
  scenariosBytes,
  metadataBytes,
  observationBytes,
  terrainBytes,
  oceanBytes,
  eventOceanBytes,
  eventOceanMetaBytes,
] =
  await Promise.all([
    readFile(CATALOG_PATH),
    readFile(TRACKS_PATH),
    readFile(SCENARIOS_PATH),
    readFile(OBS_META_PATH),
    readFile(OBS_BIN_PATH),
    readFile(TERRAIN_PATH),
    readFile(OCEAN_PATH),
    readFile(EVENT_OCEAN_PATH),
    readFile(EVENT_OCEAN_META_PATH),
  ]);
const catalog = JSON.parse(catalogBytes);
const tracksDoc = JSON.parse(tracksBytes);
const scenariosDoc = JSON.parse(scenariosBytes);
const metadata = JSON.parse(metadataBytes);
if (digest(observationBytes) !== metadata.binary.sha256) {
  throw new Error('HF-2A observation binary checksum mismatch');
}
const observations = readObservationStorms(metadata, observationBytes);
const trackById = new Map(tracksDoc.storms.map((track) => [track.id, track]));
const scenarioById = new Map(scenariosDoc.scenarios.map((scenario) => [scenario.id, scenario]));
const catalogById = new Map(catalog.storms.map((storm) => [storm.id, storm]));
const terrain = parseBuffer(terrainBytes);
const oceanProfiles = parseBuffer(oceanBytes);
const eventOceanProfiles = parseBuffer(eventOceanBytes);
const eventOcean = JSON.parse(eventOceanMetaBytes);
const land = terrain.layers.get('landmask');
if (!land) throw new Error('terrain.bin missing landmask');
const isLand = (lat, lon) => sampleLayerBilinear(land, 0, lat, lon) > 0.5;

const cases = [];
const environmentManifest = [];
for (const [id, pixels] of observations) {
  const scenario = scenarioById.get(id);
  const track = trackById.get(id);
  const storm = catalogById.get(id);
  if (!scenario || !scenario.hindcast || !track || !storm) {
    throw new Error(`${id}: benchmark metadata incomplete`);
  }
  if (PARTITION_FILTER && storm.partition !== PARTITION_FILTER) continue;
  if (STORM_FILTER && id !== STORM_FILTER) continue;
  const environmentPath = resolve(ROOT, scenario.bin);
  const environmentBytes = await readFile(environmentPath);
  const environment = parseBuffer(environmentBytes);
  environmentManifest.push({
    id,
    path: scenario.bin,
    sha256: digest(environmentBytes),
  });
  const result = await (CANDIDATE ? dynamicStorm : legacyStorm)({
    scenario,
    track,
    pixels,
    environment,
    oceanProfiles,
    eventOceanProfiles,
    eventOcean,
    isLand,
  });
  cases.push({
    id,
    label: storm.label,
    partition: storm.partition,
    pixels: pixels.length,
    ...result,
  });
  process.stdout.write(
    `[hf2a-ocean-${CANDIDATE ? 'candidate' : 'reference'}] ${id} ${storm.partition}\n`,
  );
}

const output = roundNumbers({
  schemaVersion: 1,
  generatedBy: 'calibration/hf2a-ocean-reference.mjs',
  ...(CANDIDATE ? { candidateParameters: CANDIDATE_PARAMETERS } : {}),
  ...(PARTITION_FILTER ? { partitionFilter: PARTITION_FILTER } : {}),
  protocol: {
    forcing: 'observed IBTrACS/JTWC track and wind, 15-minute interpolation',
    purpose: 'ocean-only validation; coupled forecast errors are scored separately',
    baseline: CANDIDATE
      ? 'HF-2A retained conservative upper-ocean columns on a wake-free satellite background'
      : 'HF-1 empirical Gaussian wake on a wake-free satellite background',
    aggregation: 'pixels to one score per storm, then equal-storm partition mean',
    evaluationLeadsAfterLocalPassageH: [24, 48],
    parameterSelectionPartition: 'development',
    acceptancePartition: 'validation',
    reportOnlyPartition: 'test',
  },
  manifests: {
    catalog: { path: 'calibration/fidelity-catalog.json', sha256: digest(catalogBytes) },
    tracks: { path: 'calibration/data/fidelity-tracks.json', sha256: digest(tracksBytes) },
    scenarios: { path: 'calibration/data/fidelity-scenarios.json', sha256: digest(scenariosBytes) },
    observations: { path: 'calibration/data/hf2a-ocean-observations.json', sha256: digest(metadataBytes) },
    observationBinary: { path: 'calibration/data/hf2a-ocean-observations.bin', sha256: digest(observationBytes) },
    terrain: { path: 'public/data/terrain.bin', sha256: digest(terrainBytes) },
    ...(CANDIDATE
      ? {
          oceanProfiles: { path: 'public/data/ocean.bin', sha256: digest(oceanBytes) },
          eventOceanProfiles: {
            path: 'calibration/data/hf2a-event-ocean.bin',
            sha256: digest(eventOceanBytes),
          },
          eventOceanMetadata: {
            path: 'calibration/data/hf2a-event-ocean.json',
            sha256: digest(eventOceanMetaBytes),
          },
        }
      : {}),
    environments: environmentManifest,
  },
  cases,
  aggregate: {
    development: aggregatePartition(cases, 'development'),
    validation: aggregatePartition(cases, 'validation'),
    testReportOnly: aggregatePartition(cases, 'test'),
  },
});
const text = `${JSON.stringify(output, null, 2)}\n`;
if (CHECK) {
  const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => '');
  if (current !== text) {
    throw new Error('[hf2a-ocean-reference] reference drift');
  }
  process.stdout.write(
      `[hf2a-ocean-${CANDIDATE ? 'candidate' : 'reference'}] PASS ${cases.length} storms; artifact stable\n`,
  );
} else {
  await writeFile(OUTPUT_PATH, text);
  process.stdout.write(
      `[hf2a-ocean-${CANDIDATE ? 'candidate' : 'reference'}] wrote ${OUTPUT_PATH.slice(ROOT.length + 1)} (${cases.length} storms)\n`,
  );
}
await vite.close();
