/**
 * Deterministic multi-storm replay benchmark shared by offline calibration and
 * tests. It drives the exact browser simulation against frozen event bins; no
 * observed position or intensity is assimilated after initialization.
 */

import { FlightRecorder } from './flight-recorder';
import { scoreHindcast, type HindcastScore } from './hindcast';
import { makeEnvSampler } from './env-sampler';
import { sampleLayerBilinear } from './raster-sampler';
import { eventSpawn, type BenchmarkPartition, type Scenario } from './scenarios';
import {
  createSimEngine,
  type IntensityParameters,
} from './sim';
import type { ParsedBin, SimEvent } from './types';
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

export function runHindcastCase(
  benchmarkCase: HindcastCase,
  terrain: ParsedBin,
  intensityParameters?: Partial<IntensityParameters>,
): HindcastCaseResult {
  const { scenario, environment, track } = benchmarkCase;
  if (!scenario.hindcast || !scenario.benchmarkPartition) {
    throw new Error(`${scenario.id}: incomplete benchmark metadata`);
  }
  const land = terrain.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
  const isLand = (lat: number, lon: number): boolean =>
    sampleLayerBilinear(land, 0, lat, lon) > 0.5;
  const sampler = makeEnvSampler(() => environment);
  sampler.setSamplingMode({ kind: 'event-timeline' });
  const engine = createSimEngine({
    env: sampler,
    isLand,
    intensityParameters,
  });
  const spawn = eventSpawn(scenario, null, 'hindcast');
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
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const events: SimEvent[] = engine.tick(15);
    recorder.record(engine.getState()!, events);
    if (events.some((event) => event.type === 'died')) break;
  }

  const score = scoreHindcast(
    recorder.framesSnapshot(),
    track,
    scenario.hindcast.startIso,
  );
  if (!score) throw new Error(`${scenario.id}: hindcast produced no score`);
  return {
    id: scenario.id,
    label: scenario.label,
    partition: scenario.benchmarkPartition,
    score,
  };
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
