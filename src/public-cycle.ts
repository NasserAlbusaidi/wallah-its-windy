/** Fail-closed presentation boundary for the scheduled public-source monitor. */

export type PublicCycleStatus = 'forecast-disabled' | 'forecast-ready';

export interface PublicCycleSource {
  id: string;
  kind: string;
  authority: string;
  status: string;
  usable: boolean;
  fetchedAt: string;
  validTime: string | null;
  maxAgeHours: number;
  detail: string;
}

export interface PublicCycleManifest {
  schemaVersion: 1;
  product: 'public-source-monitor';
  generatedAt: string;
  cycle: {
    id: string;
    analysisTime: string | null;
    forecastLeadHours: number[];
  };
  status: PublicCycleStatus;
  statusLabel: string;
  gates: {
    deterministicAtmosphere: boolean;
    seaSurfaceTemperature: boolean;
    officialAdvisory: boolean;
    upperOcean: boolean;
    ensembleAtmosphere: boolean;
    readyForForecast: boolean;
  };
  sources: PublicCycleSource[];
  failures: string[];
  fallback: {
    mode: 'climatology-sandbox';
    label: string;
  };
  prospective: {
    issued: boolean;
    registered: boolean;
    reason: string;
  };
}

export interface PublicCycleView {
  status: PublicCycleStatus | 'unavailable';
  headline: string;
  cycleLabel: string;
  updatedLabel: string;
  sourceRows: Array<{
    id: string;
    label: string;
    state: 'available' | 'blocked' | 'stale';
    detail: string;
  }>;
  failures: string[];
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function source(value: unknown): PublicCycleSource | null {
  const item = record(value);
  if (
    !item
    || typeof item.id !== 'string'
    || typeof item.kind !== 'string'
    || typeof item.authority !== 'string'
    || typeof item.status !== 'string'
    || typeof item.usable !== 'boolean'
    || !validIso(item.fetchedAt)
    || (item.validTime !== null && !validIso(item.validTime))
    || typeof item.maxAgeHours !== 'number'
    || !Number.isFinite(item.maxAgeHours)
    || item.maxAgeHours < 0
    || typeof item.detail !== 'string'
  ) {
    return null;
  }
  return item as unknown as PublicCycleSource;
}

/**
 * Validate only the monitor fields the browser consumes. Any inconsistency
 * rejects the whole document; the caller then displays "monitor unavailable".
 */
export function parsePublicCycleManifest(value: unknown): PublicCycleManifest | null {
  const item = record(value);
  const cycle = record(item?.cycle);
  const gates = record(item?.gates);
  const fallback = record(item?.fallback);
  const prospective = record(item?.prospective);
  const status = item?.status;
  const sources = Array.isArray(item?.sources) ? item.sources.map(source) : [];
  const gateNames = [
    'deterministicAtmosphere',
    'seaSurfaceTemperature',
    'officialAdvisory',
    'upperOcean',
    'ensembleAtmosphere',
    'readyForForecast',
  ] as const;
  if (
    item?.schemaVersion !== 1
    || item.product !== 'public-source-monitor'
    || !validIso(item.generatedAt)
    || !cycle
    || typeof cycle.id !== 'string'
    || (cycle.analysisTime !== null && !validIso(cycle.analysisTime))
    || !Array.isArray(cycle.forecastLeadHours)
    || !cycle.forecastLeadHours.every(
      (lead) => typeof lead === 'number' && Number.isInteger(lead) && lead >= 0,
    )
    || (status !== 'forecast-disabled' && status !== 'forecast-ready')
    || typeof item.statusLabel !== 'string'
    || !gates
    || !gateNames.every((name) => typeof gates[name] === 'boolean')
    || sources.length === 0
    || sources.some((entry) => entry === null)
    || !Array.isArray(item.failures)
    || !item.failures.every((failure) => typeof failure === 'string')
    || !fallback
    || fallback.mode !== 'climatology-sandbox'
    || typeof fallback.label !== 'string'
    || !prospective
    || typeof prospective.issued !== 'boolean'
    || typeof prospective.registered !== 'boolean'
    || typeof prospective.reason !== 'string'
  ) {
    return null;
  }

  const allRequiredGates = gateNames
    .filter((name) => name !== 'readyForForecast')
    .every((name) => gates[name] === true);
  if (
    gates.readyForForecast !== allRequiredGates
    || (status === 'forecast-ready') !== gates.readyForForecast
    || prospective.registered && !prospective.issued
  ) {
    return null;
  }
  return item as unknown as PublicCycleManifest;
}

function ageHours(validTime: string, nowIso: string): number {
  return (Date.parse(nowIso) - Date.parse(validTime)) / 3_600_000;
}

export function buildPublicCycleView(
  manifest: PublicCycleManifest,
  nowIso: string,
): PublicCycleView {
  const sourceRows = manifest.sources.map((item) => {
    const stale = item.validTime !== null
      && ageHours(item.validTime, nowIso) > item.maxAgeHours;
    return {
      id: item.id,
      label: `${item.kind.replaceAll('-', ' ')} · ${item.status.replaceAll('-', ' ')}`,
      state: stale ? 'stale' as const : item.usable ? 'available' as const : 'blocked' as const,
      detail: item.detail,
    };
  });
  const updatedHours = Math.max(0, ageHours(manifest.generatedAt, nowIso));
  return {
    status: manifest.status,
    headline: manifest.statusLabel,
    cycleLabel: manifest.cycle.analysisTime
      ? `${manifest.cycle.id} · ${manifest.cycle.analysisTime}`
      : 'no complete atmospheric cycle',
    updatedLabel: updatedHours < 1
      ? `updated ${Math.round(updatedHours * 60)} min ago`
      : `updated ${updatedHours.toFixed(1)} h ago`,
    sourceRows,
    failures: manifest.failures,
  };
}

export async function fetchPublicCycleManifest(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicCycleManifest> {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`public cycle: HTTP ${response.status}`);
  const expected = Number(response.headers.get('content-length'));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (Number.isFinite(expected) && expected > 0 && bytes.byteLength !== expected) {
    throw new Error(`public cycle: partial response ${bytes.byteLength}/${expected}`);
  }
  const parsed = parsePublicCycleManifest(JSON.parse(new TextDecoder().decode(bytes)));
  if (!parsed) throw new Error('public cycle: invalid manifest');
  return parsed;
}
