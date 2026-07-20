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
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
} from './ensemble-protocol';
import type { ParsedBin } from './types';

const scope = self as DedicatedWorkerGlobalScope;
const binCache = new Map<string, Promise<ParsedBin>>();
const ANALYSIS_HORIZON_H = 240;

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

async function handle(request: AnalysisWorkerRequest): Promise<void> {
  const [envBin, terrainBin] = await Promise.all([
    loadBin(request.envUrl),
    loadBin(request.terrainUrl),
  ]);
  const land = terrainBin.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
  const isLand = (lat: number, lon: number): boolean =>
    sampleLayerBilinear(land, 0, lat, lon) > 0.5;
  const sampler = makeEnvSampler(() => envBin);
  sampler.setSamplingMode(request.samplingMode);

  if (request.type === 'ensemble') {
    const members = makeEnsembleMembers(request.spawn, request.count);
    const runs = [];
    for (const member of members) {
      runs.push(
        runStorm({
          member: member.member,
          env: perturbEnvironment(sampler, member.environment),
          isLand,
          spawn: member.spawn,
          intensityParameters: member.intensityParameters,
          maxHours: ANALYSIS_HORIZON_H,
        }),
      );
      post({
        type: 'progress',
        requestId: request.requestId,
        completed: runs.length,
        total: members.length,
      });
    }
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
    maxHours: ANALYSIS_HORIZON_H,
  });
  post({
    type: 'sensitivity-result',
    requestId: request.requestId,
    result: { baseline, perturbed },
  });
}

scope.addEventListener('message', (event: MessageEvent<AnalysisWorkerRequest>) => {
  void handle(event.data).catch((error: unknown) => {
    post({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
