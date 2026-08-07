/// <reference lib="webworker" />

import {
  makeEnsembleMembers,
  perturbEnvironment,
  runStorm,
  summarizeEnsemble,
} from './ensemble';
import { makeEnvSampler } from './env-sampler';
import { parseBin } from './loader';
import { sampleLayerBilinear } from './raster-sampler';
import { pressureWindSamplerFromBin } from './steering';
import { sampleOceanProfileBin } from './ocean-profile-sampler';
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  CancelWorkerRequest,
} from './ensemble-protocol';
import type { ParsedBin } from './types';

const scope = self as DedicatedWorkerGlobalScope;
const binCache = new Map<string, Promise<ParsedBin>>();
const ANALYSIS_HORIZON_H = 240;
/** Request ids whose remaining computation should be abandoned. */
const cancelled = new Set<number>();

/**
 * Yield one macrotask so queued messages (a 'cancel' for the running
 * request, typically) deliver between members. Scheduling only — member
 * results are unaffected.
 */
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadBin(url: string): Promise<ParsedBin> {
  let pending = binCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return parseBin(await response.arrayBuffer());
    });
    binCache.set(url, pending);
  }
  return pending;
}

function post(response: AnalysisWorkerResponse): void {
  if (response.type === 'ensemble-result') {
    scope.postMessage(response, [response.result.grid.probability.buffer]);
  } else {
    scope.postMessage(response);
  }
}

async function handle(
  request: Exclude<AnalysisWorkerRequest, CancelWorkerRequest>,
): Promise<void> {
  // Request ids are minted monotonically and the client always posts a
  // request before it can post that request's cancel, so any cancelled entry
  // older than the request now starting belongs to a finished run whose
  // cancel lost the race — purge them or the set grows for the session.
  for (const id of cancelled) {
    if (id < request.requestId) cancelled.delete(id);
  }
  const [envBin, terrainBin, steeringBin, oceanBin] = await Promise.all([
    loadBin(request.envUrl),
    loadBin(request.terrainUrl),
    request.steeringUrl ? loadBin(request.steeringUrl) : Promise.resolve(null),
    request.oceanUrl ? loadBin(request.oceanUrl) : Promise.resolve(null),
  ]);
  const land = terrainBin.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
  const isLand = (lat: number, lon: number): boolean =>
    sampleLayerBilinear(land, 0, lat, lon) > 0.5;
  const elevation = terrainBin.layers.get('elev');
  const sampler = makeEnvSampler(() => envBin);
  sampler.setSamplingMode(request.samplingMode);
  const physicalDependencies = {
    pressureWindSampler: pressureWindSamplerFromBin(
      () => steeringBin,
      () => request.samplingMode,
    ),
    oceanProfileSampler: (lat: number, lon: number, monthIndex: number) =>
      sampleOceanProfileBin(oceanBin, lat, lon, monthIndex),
    terrainHeightM: (lat: number, lon: number) =>
      elevation ? sampleLayerBilinear(elevation, 0, lat, lon) : 0,
  };

  if (request.type === 'ensemble') {
    const members = makeEnsembleMembers(request.spawn, request.count);
    const runs = [];
    for (const member of members) {
      if (cancelled.has(request.requestId)) {
        cancelled.delete(request.requestId);
        post({ type: 'cancelled', requestId: request.requestId });
        return;
      }
      runs.push(
        runStorm({
          member: member.member,
          env: perturbEnvironment(sampler, member.environment),
          isLand,
          spawn: member.spawn,
          intensityParameters: member.intensityParameters,
          trackParameters: member.trackParameters,
          ...physicalDependencies,
          maxHours: ANALYSIS_HORIZON_H,
        }),
      );
      post({
        type: 'progress',
        requestId: request.requestId,
        completed: runs.length,
        total: members.length,
      });
      await yieldToMessages();
    }
    cancelled.delete(request.requestId);
    post({
      type: 'ensemble-result',
      requestId: request.requestId,
      result: summarizeEnsemble(runs),
    });
    return;
  }

  const baseline = runStorm({
    env: sampler,
    isLand,
    spawn: request.spawn,
    ...physicalDependencies,
    maxHours: ANALYSIS_HORIZON_H,
  });
  const perturbed = runStorm({
    env: perturbEnvironment(sampler, request.perturbation),
    isLand,
    spawn: {
      ...request.spawn,
      initialOrganization: Math.max(
        0,
        Math.min(
          1,
          (request.spawn.initialOrganization ?? 0.45) +
            request.organizationDelta,
        ),
      ),
    },
    ...physicalDependencies,
    maxHours: ANALYSIS_HORIZON_H,
  });
  post({
    type: 'sensitivity-result',
    requestId: request.requestId,
    result: { baseline, perturbed },
  });
}

scope.addEventListener('message', (event: MessageEvent<AnalysisWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    cancelled.add(event.data.requestId);
    return;
  }
  void handle(event.data).catch((error: unknown) => {
    post({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
