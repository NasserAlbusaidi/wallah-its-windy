/** DOM-free HF-5 presentation model for an immutable issued forecast cycle. */

import { evaluateLiveInputs, validateArchivedRun, type ArchivedForecastRun } from './live-data';

export interface LiveGuidanceRow {
  id: 'official' | 'persistence' | 'wallahModel';
  label: string;
  role: 'official' | 'baseline' | 'experimental';
  points: ArchivedForecastRun['guidance']['official'];
}

export interface LiveProductView {
  title: string;
  analysisTime: string;
  cycleId: string;
  providerId: string;
  issuedAt: string;
  horizonH: number;
  status: 'current-experimental' | 'unavailable';
  statusLabel: string;
  guidance: LiveGuidanceRow[];
  inputAgesHours: Array<{
    id: string;
    kind: string;
    validTime: string;
    ageHours: number;
  }>;
  failures: string[];
  imageryLabels: {
    satellite: string;
    simulated: string;
  };
}

export function buildLiveProductView(
  run: ArchivedForecastRun,
  nowIso: string,
): LiveProductView {
  const archiveErrors = validateArchivedRun(run);
  if (archiveErrors.length > 0) {
    throw new Error(`invalid issued live run: ${archiveErrors.join('; ')}`);
  }
  const decision = evaluateLiveInputs(run.cycle, run.inputs, nowIso);
  const now = Date.parse(nowIso);
  const allPoints = Object.values(run.guidance).flat();
  const horizonH = allPoints.reduce((maximum, point) => Math.max(maximum, point.leadH), 0);
  const ready = decision.currentForecastAllowed;
  return {
    title: `${run.advisory.stormName ?? run.advisory.stormId} · experimental companion`,
    analysisTime: run.cycle.analysisTime,
    cycleId: run.cycle.cycleId,
    providerId: run.cycle.providerId,
    issuedAt: run.cycle.issuedAt,
    horizonH,
    status: ready ? 'current-experimental' : 'unavailable',
    statusLabel: ready
      ? 'experimental forecast companion — not official guidance'
      : decision.fallback.label ?? 'live inputs unavailable',
    guidance: [
      {
        id: 'official',
        label: run.labels.official,
        role: 'official',
        points: run.guidance.official,
      },
      {
        id: 'persistence',
        label: run.labels.persistence,
        role: 'baseline',
        points: run.guidance.persistence,
      },
      {
        id: 'wallahModel',
        label: run.labels.wallahModel,
        role: 'experimental',
        points: run.guidance.wallahModel,
      },
    ],
    inputAgesHours: run.inputs.map((input) => ({
      id: input.id,
      kind: input.kind,
      validTime: input.validTime,
      ageHours: (now - Date.parse(input.validTime)) / 3_600_000,
    })),
    failures: decision.failures.map((failure) => `${failure.artifactId}: ${failure.message}`),
    imageryLabels: {
      satellite: run.labels.satellite,
      simulated: run.labels.simulatedImagery,
    },
  };
}

export async function fetchIssuedLiveRun(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchivedForecastRun> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`live cycle: HTTP ${response.status}`);
  const expected = Number(response.headers.get('content-length'));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(expected) && bytes.byteLength !== expected) {
    throw new Error(`live cycle: partial response ${bytes.byteLength}/${expected}`);
  }
  const run = JSON.parse(new TextDecoder().decode(bytes)) as ArchivedForecastRun;
  const errors = validateArchivedRun(run);
  if (errors.length > 0) throw new Error(`live cycle: ${errors.join('; ')}`);
  return run;
}
