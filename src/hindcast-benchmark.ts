/**
 * Deterministic multi-storm replay benchmark shared by offline calibration and
 * tests. It drives the exact browser simulation against frozen event bins; no
 * observed position or intensity is assimilated after initialization.
 */

import { FlightRecorder } from './flight-recorder';
import type { FlightFrame } from './flight-recorder';
import { scoreHindcast, type HindcastScore } from './hindcast';
import { makeEnvSampler } from './env-sampler';
import { sampleLayerBilinear } from './raster-sampler';
import { eventSpawn, type BenchmarkPartition, type Scenario } from './scenarios';
import {
  createSimEngine,
  type IntensityParameters,
  type TrackParameters,
} from './sim';
import type {
  ParsedBin,
  PressureWindSampler,
  SimEvent,
  StormDeath,
  WindRadiiKm,
} from './types';
import type { OceanProfileSampler } from './ocean-profile-sampler';
import type { StormTrack } from './tracks';

export interface HindcastCase {
  scenario: Scenario;
  track: StormTrack;
  environment: ParsedBin;
}

export interface HindcastCaseResult {
  id: string;
  label: string;
  partition: BenchmarkPartition;
  score: HindcastScore;
}

export interface DetailedHindcastCaseResult {
  result: HindcastCaseResult;
  frames: FlightFrame[];
  firstLandfall: { lat: number; lon: number; ageH: number } | null;
  death: StormDeath | null;
}

export interface HindcastAggregate {
  storms: number;
  trackMaeKm: number | null;
  intensityMaeKt: number | null;
  intensityBiasKt: number | null;
  pressureMaeHpa: number | null;
  peakAbsBiasKt: number | null;
  /** Equal-storm objective; no long-lived storm can dominate by fix count. */
  objective: number | null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function values(
  results: readonly HindcastCaseResult[],
  pick: (score: HindcastScore) => number | null,
): number[] {
  return results
    .map(({ score }) => pick(score))
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

export function aggregateHindcasts(
  results: readonly HindcastCaseResult[],
): HindcastAggregate {
  const perStormObjectives = results
    .map(({ score }) => {
      if (
        score.intensityMaeKt === null ||
        score.peakBiasKt === null ||
        score.pressureMaeHpa === null
      ) {
        return null;
      }
      return (
        score.intensityMaeKt / 20 +
        Math.abs(score.peakBiasKt) / 25 +
        score.pressureMaeHpa / 20
      ) / 3;
    })
    .filter((value): value is number => value !== null);
  return {
    storms: results.length,
    trackMaeKm: mean(values(results, (score) => score.trackMaeKm)),
    intensityMaeKt: mean(values(results, (score) => score.intensityMaeKt)),
    intensityBiasKt: mean(values(results, (score) => score.intensityBiasKt)),
    pressureMaeHpa: mean(values(results, (score) => score.pressureMaeHpa)),
    peakAbsBiasKt: mean(
      values(results, (score) =>
        score.peakBiasKt === null ? null : Math.abs(score.peakBiasKt),
      ),
    ),
    objective: mean(perStormObjectives),
  };
}

export function runDetailedHindcastCase(
  benchmarkCase: HindcastCase,
  terrain: ParsedBin,
  intensityParameters?: Partial<IntensityParameters>,
  oceanProfileSampler?: OceanProfileSampler,
  structureInitialization?: {
    rmwKm?: number;
    outerSizePriorKm?: number;
    r34Km?: Partial<WindRadiiKm>;
    r50Km?: Partial<WindRadiiKm>;
    r64Km?: Partial<WindRadiiKm>;
  },
  motionInitialization?: { u: number; v: number },
  pressureWindSampler?: PressureWindSampler,
  trackParameters?: Partial<TrackParameters>,
): DetailedHindcastCaseResult {
  const { scenario, environment, track } = benchmarkCase;
  if (!scenario.hindcast || !scenario.benchmarkPartition) {
    throw new Error(`${scenario.id}: incomplete benchmark metadata`);
  }
  const land = terrain.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
  const elevation = terrain.layers.get('elev');
  const isLand = (lat: number, lon: number): boolean =>
    sampleLayerBilinear(land, 0, lat, lon) > 0.5;
  const sampler = makeEnvSampler(() => environment);
  sampler.setSamplingMode({ kind: 'event-timeline' });
  const engine = createSimEngine({
    env: sampler,
    isLand,
    physicsProfile: 'hf2-experimental',
    terrainHeightM: (lat, lon) =>
      elevation ? sampleLayerBilinear(elevation, 0, lat, lon) : 0,
    intensityParameters,
    trackParameters,
    pressureWindSampler,
    oceanProfileSampler,
  });
  const spawn = {
    ...eventSpawn(scenario, null, 'hindcast'),
    initialRmwKm: structureInitialization?.rmwKm,
    initialOuterSizeKm: structureInitialization?.outerSizePriorKm,
    initialR34Km: structureInitialization?.r34Km,
    initialR50Km: structureInitialization?.r50Km,
    initialR64Km: structureInitialization?.r64Km,
    initialMotionUms: motionInitialization?.u,
    initialMotionVms: motionInitialization?.v,
  };
  engine.spawn(spawn);
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
    engine.getState()!,
  );

  const durationH = Math.max(
    0,
    scenario.windowH - scenario.hindcast.envOffsetH,
  );
  const maxTicks = Math.ceil((durationH * 60) / 15);
  let firstLandfall: { lat: number; lon: number; ageH: number } | null = null;
  let death: StormDeath | null = null;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const events: SimEvent[] = engine.tick(15);
    const state = engine.getState()!;
    recorder.record(state, events);
    for (const event of events) {
      if (event.type === 'landfall' && !firstLandfall) {
        firstLandfall = { lat: event.lat, lon: event.lon, ageH: state.ageH };
      }
      if (event.type === 'died') death = { ...event.death };
    }
    if (events.some((event) => event.type === 'died')) break;
  }

  const frames = recorder.framesSnapshot();
  const score = scoreHindcast(
    frames,
    track,
    scenario.hindcast.startIso,
  );
  if (!score) throw new Error(`${scenario.id}: hindcast produced no score`);
  return {
    result: {
      id: scenario.id,
      label: scenario.label,
      partition: scenario.benchmarkPartition,
      score,
    },
    frames,
    firstLandfall,
    death,
  };
}

export function runHindcastCase(
  benchmarkCase: HindcastCase,
  terrain: ParsedBin,
  intensityParameters?: Partial<IntensityParameters>,
): HindcastCaseResult {
  return runDetailedHindcastCase(
    benchmarkCase,
    terrain,
    intensityParameters,
  ).result;
}

export function evaluateHindcastCases(
  cases: readonly HindcastCase[],
  terrain: ParsedBin,
  intensityParameters?: Partial<IntensityParameters>,
): HindcastCaseResult[] {
  return cases.map((benchmarkCase) =>
    runHindcastCase(benchmarkCase, terrain, intensityParameters),
  );
}
