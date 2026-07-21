/**
 * Deterministic ensemble and sensitivity runner shared by the worker, tests,
 * and offline calibration. No DOM and no wall-clock input.
 */

import { DOMAIN, latLonToCell } from './grid';
import { makeRng, type Rng } from './rng';
import {
  createSimEngine,
  DEFAULT_INTENSITY_PARAMETERS,
  DEFAULT_TRACK_PARAMETERS,
  type IntensityParameters,
  type TrackParameters,
} from './sim';
import type {
  EnvSample,
  EnvSampler,
  PressureWindSampler,
  SpawnParams,
  StormDeath,
  TrackPoint,
} from './types';
import type { OceanProfileSampler } from './ocean-profile-sampler';

export type UncertaintySource =
  | 'initialization'
  | 'forcing'
  | 'parameters'
  | 'unresolved-physics';

export const ALL_UNCERTAINTY_SOURCES: readonly UncertaintySource[] = [
  'initialization',
  'forcing',
  'parameters',
  'unresolved-physics',
];

export interface UncertaintyComponents {
  enabled: UncertaintySource[];
  initialization: {
    latDeltaDeg: number;
    lonDeltaDeg: number;
    windDeltaKt: number;
    organizationDelta: number;
    timeDeltaH: number;
  };
  forcing: EnvironmentPerturbation;
  parameters: {
    intensifyScale: number;
    shearScale: number;
    organizationRecoveryScale: number;
    betaScale: number;
    steeringBlendDelta: number;
  };
  unresolvedPhysics: { enabled: boolean; seed: number };
}

export interface EnvironmentPerturbation {
  sstDeltaC: number;
  rhDeltaPct: number;
  shearDeltaMs: number;
  ohcScale: number;
}

export const NO_ENVIRONMENT_PERTURBATION: Readonly<EnvironmentPerturbation> = {
  sstDeltaC: 0,
  rhDeltaPct: 0,
  shearDeltaMs: 0,
  ohcScale: 1,
};

export interface StormRun {
  member: number;
  track: TrackPoint[];
  peakKt: number;
  durationH: number;
  closestApproachKm: number;
  landfall: boolean;
  landfallEvents: Array<{ lat: number; lon: number; ageH: number }>;
  death: StormDeath | null;
}

export interface EnsembleMember {
  member: number;
  spawn: SpawnParams;
  environment: EnvironmentPerturbation;
  intensityParameters: IntensityParameters;
  trackParameters: TrackParameters;
  uncertainty: UncertaintyComponents;
}

export interface EnsembleBaseline {
  intensityParameters?: Partial<IntensityParameters>;
  trackParameters?: Partial<TrackParameters>;
}

export interface EnsembleGrid {
  nx: number;
  ny: number;
  /** Fraction of members whose centre entered each grid cell. */
  probability: Float32Array;
}

export interface EnsembleResult {
  members: StormRun[];
  grid: EnsembleGrid;
  peakKt: { p10: number; median: number; p90: number };
  landfallProbability: number;
  tropicalStormProbability: number;
  hurricaneProbability: number;
  majorProbability: number;
  dissipationProbability: number;
  /** Remains frequency until HF-4 passes its out-of-sample calibration gate. */
  probabilityLabel: 'perturbation-frequency';
}

export interface RunStormOptions {
  member?: number;
  env: EnvSampler;
  isLand: (lat: number, lon: number) => boolean;
  spawn: SpawnParams;
  intensityParameters?: Partial<IntensityParameters>;
  trackParameters?: Partial<TrackParameters>;
  physicsProfile?: 'shipped' | 'hf2-experimental';
  pressureWindSampler?: PressureWindSampler;
  oceanProfileSampler?: OceanProfileSampler;
  terrainHeightM?: (lat: number, lon: number) => number;
  maxHours?: number;
  trackStepHours?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function gaussian(rng: Rng): number {
  const u1 = Math.max(Number.EPSILON, rng.next());
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function perturbEnvironment(
  base: EnvSampler,
  perturbation: EnvironmentPerturbation,
): EnvSampler {
  return {
    sample(lat, lon, monthIndex, tFrac): EnvSample {
      const source = base.sample(lat, lon, monthIndex, tFrac);
      const originalShear = Math.max(0, source.shear);
      const shear = Math.max(0, originalShear + perturbation.shearDeltaMs);
      const vectorScale = originalShear > 0 ? shear / originalShear : 0;
      return {
        ...source,
        sstC: source.sstC + perturbation.sstDeltaC,
        midlevelRhPct: clamp(
          source.midlevelRhPct + perturbation.rhDeltaPct,
          0,
          100,
        ),
        ohcKjCm2: Math.max(0, source.ohcKjCm2 * perturbation.ohcScale),
        shear,
        shearU: source.shearU * vectorScale,
        shearV: source.shearV * vectorScale,
      };
    },
  };
}

export function runStorm(options: RunStormOptions): StormRun {
  const engine = createSimEngine({
    env: options.env,
    isLand: options.isLand,
    intensityParameters: options.intensityParameters,
    trackParameters: options.trackParameters,
    physicsProfile: options.physicsProfile,
    pressureWindSampler: options.pressureWindSampler,
    oceanProfileSampler: options.oceanProfileSampler,
    terrainHeightM: options.terrainHeightM,
    structureDetail: 'dynamics',
  });
  engine.spawn(options.spawn);
  const dtMin = 15;
  const maxHours = options.maxHours ?? 360;
  const trackStepTicks = Math.max(
    1,
    Math.round(((options.trackStepHours ?? 3) * 60) / dtMin),
  );
  const maxTicks = Math.ceil((maxHours * 60) / dtMin);
  const track: TrackPoint[] = [];
  let peakKt = options.spawn.initialWindKt ?? 0;
  let landfall = false;
  const landfallEvents: Array<{ lat: number; lon: number; ageH: number }> = [];
  let death: StormDeath | null = null;

  for (let tick = 0; tick < maxTicks; tick++) {
    const events = engine.tick(dtMin);
    const state = engine.getState();
    if (!state) break;
    peakKt = Math.max(peakKt, state.vKt);
    if (tick % trackStepTicks === 0 || !state.alive) {
      track.push({
        lat: state.lat,
        lon: state.lon,
        vKt: state.vKt,
        ageH: state.ageH,
      });
    }
    for (const event of events) {
      if (event.type === 'landfall') {
        landfall = true;
        landfallEvents.push({ lat: event.lat, lon: event.lon, ageH: state.ageH });
      }
      if (event.type === 'died') death = event.death;
    }
    if (!state.alive) break;
  }

  const finalState = engine.getState();
  const finalAge = finalState?.ageH ?? 0;
  const closestApproachKm =
    death?.closestApproachKm ?? Number.POSITIVE_INFINITY;
  return {
    member: options.member ?? 0,
    track,
    peakKt,
    durationH: death?.durationH ?? finalAge,
    closestApproachKm,
    landfall,
    landfallEvents,
    death,
  };
}

export function makeEnsembleMembers(
  spawn: SpawnParams,
  count: number,
  ensembleSeed = spawn.seed,
  sources: readonly UncertaintySource[] = ALL_UNCERTAINTY_SOURCES,
  baseline: EnsembleBaseline = {},
): EnsembleMember[] {
  const size = clamp(Math.floor(count), 1, 100);
  const out: EnsembleMember[] = [];
  const enabled = new Set(sources);
  const baseIntensityParameters: IntensityParameters = {
    ...DEFAULT_INTENSITY_PARAMETERS,
    ...baseline.intensityParameters,
  };
  const baseTrackParameters: TrackParameters = {
    ...DEFAULT_TRACK_PARAMETERS,
    ...baseline.trackParameters,
  };
  for (let member = 0; member < size; member++) {
    if (member === 0) {
      out.push({
        member,
        spawn: { ...spawn },
        environment: { ...NO_ENVIRONMENT_PERTURBATION },
        intensityParameters: { ...baseIntensityParameters },
        trackParameters: { ...baseTrackParameters },
        uncertainty: {
          enabled: [],
          initialization: {
            latDeltaDeg: 0,
            lonDeltaDeg: 0,
            windDeltaKt: 0,
            organizationDelta: 0,
            timeDeltaH: 0,
          },
          forcing: { ...NO_ENVIRONMENT_PERTURBATION },
          parameters: {
            intensifyScale: 1,
            shearScale: 1,
            organizationRecoveryScale: 1,
            betaScale: 1,
            steeringBlendDelta: 0,
          },
          unresolvedPhysics: { enabled: false, seed: spawn.seed },
        },
      });
      continue;
    }
    const rngFor = (_source: UncertaintySource, salt: number) =>
      makeRng(
        (ensembleSeed + Math.imul(member, 0x9e3779b1) + Math.imul(salt, 0x85ebca6b)) >>> 0,
      );
    const initializationRng = rngFor('initialization', 1);
    const forcingRng = rngFor('forcing', 2);
    const parameterRng = rngFor('parameters', 3);
    const initEnabled = enabled.has('initialization');
    const forcingEnabled = enabled.has('forcing');
    const parameterEnabled = enabled.has('parameters');
    const unresolvedEnabled = enabled.has('unresolved-physics');
    const latDeltaDeg = initEnabled ? gaussian(initializationRng) * 0.08 : 0;
    const lonDeltaDeg = initEnabled ? gaussian(initializationRng) * 0.08 : 0;
    const windDeltaKt = initEnabled ? gaussian(initializationRng) * 2.5 : 0;
    const organizationDelta = initEnabled ? gaussian(initializationRng) * 0.04 : 0;
    const timeDeltaH = initEnabled ? gaussian(initializationRng) * 1.5 : 0;
    const initialOrganization = clamp(
      (spawn.initialOrganization ?? 0.45) + organizationDelta,
      0.05,
      0.95,
    );
    const environment: EnvironmentPerturbation = forcingEnabled
      ? {
          // Persistent member-wise biases are coherent across space and time.
          sstDeltaC: gaussian(forcingRng) * 0.35,
          rhDeltaPct: gaussian(forcingRng) * 4,
          shearDeltaMs: gaussian(forcingRng) * 1.5,
          ohcScale: clamp(1 + gaussian(forcingRng) * 0.1, 0.7, 1.3),
        }
      : { ...NO_ENVIRONMENT_PERTURBATION };
    const intensifyScale = parameterEnabled
      ? clamp(1 + gaussian(parameterRng) * 0.07, 0.82, 1.18)
      : 1;
    const shearScale = parameterEnabled
      ? clamp(1 + gaussian(parameterRng) * 0.1, 0.75, 1.25)
      : 1;
    const organizationRecoveryScale = parameterEnabled
      ? clamp(1 + gaussian(parameterRng) * 0.08, 0.8, 1.2)
      : 1;
    const betaScale = parameterEnabled
      ? clamp(1 + gaussian(parameterRng) * 0.12, 0.7, 1.3)
      : 1;
    const steeringBlendDelta = parameterEnabled
      ? gaussian(parameterRng) * 0.015
      : 0;
    const memberSeed = (spawn.seed + Math.imul(member, 2654435761)) >>> 0;
    out.push({
      member,
      spawn: {
        ...spawn,
        lat: clamp(spawn.lat + latDeltaDeg, DOMAIN.latMin, DOMAIN.latMax),
        lon: clamp(spawn.lon + lonDeltaDeg, DOMAIN.lonMin, DOMAIN.lonMax),
        seed: memberSeed,
        disableWander: !unresolvedEnabled,
        initialWindKt: Math.max(
          20,
          (spawn.initialWindKt ?? 30) + windDeltaKt,
        ),
        initialOrganization,
        tFracOffsetH: Math.max(
          0,
          (spawn.tFracOffsetH ?? 0) + timeDeltaH,
        ),
      },
      environment,
      intensityParameters: {
        ...baseIntensityParameters,
        intensifyKPerH:
          baseIntensityParameters.intensifyKPerH * intensifyScale,
        shearKtPerHPerMs:
          baseIntensityParameters.shearKtPerHPerMs * shearScale,
        organizationRecoveryH:
          baseIntensityParameters.organizationRecoveryH *
          organizationRecoveryScale,
      },
      trackParameters: {
        ...baseTrackParameters,
        betaDriftScale: baseTrackParameters.betaDriftScale * betaScale,
        environmentalSteeringBlend: clamp(
          baseTrackParameters.environmentalSteeringBlend + steeringBlendDelta,
          0,
          1,
        ),
      },
      uncertainty: {
        enabled: [...sources],
        initialization: {
          latDeltaDeg,
          lonDeltaDeg,
          windDeltaKt,
          organizationDelta,
          timeDeltaH,
        },
        forcing: { ...environment },
        parameters: {
          intensifyScale,
          shearScale,
          organizationRecoveryScale,
          betaScale,
          steeringBlendDelta,
        },
        unresolvedPhysics: { enabled: unresolvedEnabled, seed: memberSeed },
      },
    });
  }
  return out;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(position);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const weight = position - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

export function summarizeEnsemble(
  members: StormRun[],
  nx = 80,
  ny = 48,
): EnsembleResult {
  const counts = new Uint16Array(nx * ny);
  for (const run of members) {
    const visited = new Set<number>();
    let previous: { col: number; row: number } | null = null;
    for (const point of run.track) {
      const current = latLonToCell(
        { nx, ny, bbox: DOMAIN },
        point.lat,
        point.lon,
      );
      const steps = previous
        ? Math.max(
            1,
            Math.ceil(
              Math.max(
                Math.abs(current.col - previous.col),
                Math.abs(current.row - previous.row),
              ),
            ),
          )
        : 1;
      for (let step = 0; step <= steps; step += 1) {
        const fraction = step / steps;
        const col = clamp(
          Math.floor(
            (previous
              ? previous.col + (current.col - previous.col) * fraction
              : current.col) + 0.5,
          ),
          0,
          nx - 1,
        );
        const row = clamp(
          Math.floor(
            (previous
              ? previous.row + (current.row - previous.row) * fraction
              : current.row) + 0.5,
          ),
          0,
          ny - 1,
        );
        visited.add(row * nx + col);
      }
      previous = current;
    }
    for (const index of visited) counts[index]++;
  }
  const probability = new Float32Array(counts.length);
  const denominator = Math.max(1, members.length);
  for (let i = 0; i < counts.length; i++) probability[i] = counts[i] / denominator;
  const peaks = members.map((member) => member.peakKt).sort((a, b) => a - b);
  return {
    members,
    grid: { nx, ny, probability },
    peakKt: {
      p10: quantile(peaks, 0.1),
      median: quantile(peaks, 0.5),
      p90: quantile(peaks, 0.9),
    },
    landfallProbability:
      members.filter((member) => member.landfall).length / denominator,
    tropicalStormProbability:
      members.filter((member) => member.peakKt >= 34).length / denominator,
    hurricaneProbability:
      members.filter((member) => member.peakKt >= 64).length / denominator,
    majorProbability:
      members.filter((member) => member.peakKt >= 96).length / denominator,
    dissipationProbability:
      members.filter((member) => member.death !== null).length / denominator,
    probabilityLabel: 'perturbation-frequency',
  };
}

export function runEnsemble(
  env: EnvSampler,
  isLand: (lat: number, lon: number) => boolean,
  spawn: SpawnParams,
  count: number,
): EnsembleResult {
  const members = makeEnsembleMembers(spawn, count).map((member) =>
    runStorm({
      member: member.member,
      env: perturbEnvironment(env, member.environment),
      isLand,
      spawn: member.spawn,
      intensityParameters: member.intensityParameters,
      trackParameters: member.trackParameters,
    }),
  );
  return summarizeEnsemble(members);
}
