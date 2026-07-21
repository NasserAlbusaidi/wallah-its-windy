/** Provider-neutral HF-5 live-data boundary. No network or filesystem access. */

export type LiveProductKind =
  | 'agency-advisory'
  | 'atmospheric-grid'
  | 'sea-surface-temperature'
  | 'upper-ocean'
  | 'satellite';

export type WindAveragingMinutes = 1 | 3 | 10;
export type SpeedUnit = 'kt' | 'km/h' | 'm/s';
export type PressureUnit = 'hPa' | 'Pa';

export interface ForecastCycleIdentity {
  providerId: string;
  cycleId: string;
  analysisTime: string;
  issuedAt: string;
}

export interface SourceArtifact {
  id: string;
  kind: LiveProductKind;
  providerId: string;
  cycleId: string;
  sourceUrl: string;
  validTime: string;
  fetchedAt: string;
  license: string;
  sha256: string;
  expectedBytes: number;
  receivedBytes: number;
  maxAgeHours: number;
  required: boolean;
  compatibility: 'compatible' | 'incompatible';
  incompatibilityReason?: string;
  normalizedGrid?: NormalizedGridDescriptor;
}

export interface RawGridDescriptor {
  calendar: string;
  analysisTime: string;
  validTimes: string[];
  pressureLevels: number[];
  pressureUnit: 'hPa' | 'Pa';
  bbox: { west: number; east: number; south: number; north: number };
  nx: number;
  ny: number;
  scanning: 'north-to-south-west-to-east' | 'south-to-north-west-to-east';
}

export interface NormalizedGridDescriptor {
  calendar: 'proleptic-gregorian';
  analysisTime: string;
  validTimes: string[];
  leadHours: number[];
  pressureLevelsHpa: number[];
  bbox: { west: number; east: number; south: number; north: number };
  nx: number;
  ny: number;
  scanning: 'north-to-south-west-to-east';
  sourceScanning: RawGridDescriptor['scanning'];
}

export interface RawAdvisorySnapshot {
  providerId: string;
  cycleId: string;
  advisoryId: string;
  stormId: string;
  stormName: string | null;
  analysisTime: string;
  issuedAt: string;
  lat: number;
  lon: number;
  motionDirectionDeg: number | null;
  motionSpeed: number | null;
  motionSpeedUnit: SpeedUnit;
  maximumWind: number;
  windUnit: SpeedUnit;
  windAveragingMinutes: WindAveragingMinutes;
  centralPressure: number | null;
  pressureUnit: PressureUnit;
  rmw: number | null;
  windRadii: {
    r34: number | null;
    r50: number | null;
    r64: number | null;
  };
  radiusUnit: 'km' | 'nm';
  organization: number | null;
}

export interface WindAveragingPolicy {
  canonicalMinutes: 1;
  /** Multiplier from each provider averaging period to one-minute wind. */
  toOneMinute: Record<WindAveragingMinutes, number>;
  source: string;
  version: string;
}

export interface NormalizedAdvisorySnapshot {
  providerId: string;
  cycleId: string;
  advisoryId: string;
  stormId: string;
  stormName: string | null;
  analysisTime: string;
  issuedAt: string;
  lat: number;
  lon: number;
  motionDirectionDeg: number | null;
  motionSpeedMs: number | null;
  maximumWindOneMinuteKt: number;
  originalMaximumWind: {
    value: number;
    unit: SpeedUnit;
    averagingMinutes: WindAveragingMinutes;
  };
  windConversion: {
    factorToOneMinute: number;
    source: string;
    version: string;
  };
  centralPressureHpa: number | null;
  rmwKm: number | null;
  r34Km: number | null;
  r50Km: number | null;
  r64Km: number | null;
  organization: number | null;
}

export type InputFailureCode =
  | 'missing'
  | 'partial-download'
  | 'checksum-invalid'
  | 'stale'
  | 'future-valid-time'
  | 'cycle-mismatch'
  | 'provider-mismatch'
  | 'incompatible';

export interface InputFailure {
  artifactId: string;
  code: InputFailureCode;
  message: string;
}

export interface LiveInputDecision {
  status: 'ready' | 'degraded' | 'unavailable';
  currentForecastAllowed: boolean;
  failures: InputFailure[];
  fallback: {
    mode: 'climatology-sandbox' | null;
    label: string | null;
  };
}

export interface GuidanceTrackPoint {
  validTime: string;
  leadH: number;
  lat: number;
  lon: number;
  windOneMinuteKt: number | null;
}

export interface ArchivedForecastRun {
  schemaVersion: 1;
  product: 'experimental-forecast-companion';
  cycle: ForecastCycleIdentity;
  advisory: NormalizedAdvisorySnapshot;
  inputs: SourceArtifact[];
  inputDecision: LiveInputDecision;
  guidance: {
    official: GuidanceTrackPoint[];
    persistence: GuidanceTrackPoint[];
    wallahModel: GuidanceTrackPoint[];
  };
  labels: {
    official: 'official agency guidance';
    persistence: 'baseline';
    wallahModel: 'experimental Wallah model';
    satellite: 'observed imagery';
    simulatedImagery: 'simulated proxy';
  };
  modelVersion: string;
  createdAt: string;
}

export interface LiveProviderAdapter<RawCycle> {
  readonly providerId: string;
  fetchCycle(cycle: ForecastCycleIdentity, signal?: AbortSignal): Promise<RawCycle>;
  normalize(raw: RawCycle, cycle: ForecastCycleIdentity): Promise<{
    advisory: RawAdvisorySnapshot;
    artifacts: SourceArtifact[];
    officialGuidance: GuidanceTrackPoint[];
  }>;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function validIso(value: string, label: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

export function speedToKt(value: number, unit: SpeedUnit): number {
  finite(value, 'speed');
  if (unit === 'kt') return value;
  if (unit === 'km/h') return value / 1.852;
  return value * 1.9438444924;
}

export function speedToMs(value: number, unit: SpeedUnit): number {
  finite(value, 'speed');
  if (unit === 'm/s') return value;
  if (unit === 'kt') return value * 0.5144444444;
  return value / 3.6;
}

function distanceToKm(value: number | null, unit: 'km' | 'nm'): number | null {
  if (value === null) return null;
  finite(value, 'radius');
  if (value < 0) throw new Error('radius cannot be negative');
  return unit === 'km' ? value : value * 1.852;
}

export function normalizeAdvisory(
  raw: RawAdvisorySnapshot,
  windPolicy: WindAveragingPolicy,
): NormalizedAdvisorySnapshot {
  validIso(raw.analysisTime, 'analysisTime');
  validIso(raw.issuedAt, 'issuedAt');
  if (!raw.providerId || !raw.cycleId || !raw.advisoryId || !raw.stormId) {
    throw new Error('advisory identity fields are required');
  }
  if (raw.lat < -90 || raw.lat > 90 || raw.lon < -180 || raw.lon > 180) {
    throw new Error('advisory position is outside geographic bounds');
  }
  if (raw.organization !== null && (raw.organization < 0 || raw.organization > 1)) {
    throw new Error('organization must be within 0..1');
  }
  const factor = windPolicy.toOneMinute[raw.windAveragingMinutes];
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`no wind conversion for ${raw.windAveragingMinutes}-minute averaging`);
  }
  const centralPressureHpa = raw.centralPressure === null
    ? null
    : raw.pressureUnit === 'Pa'
      ? raw.centralPressure / 100
      : raw.centralPressure;
  return {
    providerId: raw.providerId,
    cycleId: raw.cycleId,
    advisoryId: raw.advisoryId,
    stormId: raw.stormId,
    stormName: raw.stormName,
    analysisTime: raw.analysisTime,
    issuedAt: raw.issuedAt,
    lat: finite(raw.lat, 'latitude'),
    lon: finite(raw.lon, 'longitude'),
    motionDirectionDeg: raw.motionDirectionDeg,
    motionSpeedMs: raw.motionSpeed === null
      ? null
      : speedToMs(raw.motionSpeed, raw.motionSpeedUnit),
    maximumWindOneMinuteKt:
      speedToKt(raw.maximumWind, raw.windUnit) * factor,
    originalMaximumWind: {
      value: raw.maximumWind,
      unit: raw.windUnit,
      averagingMinutes: raw.windAveragingMinutes,
    },
    windConversion: {
      factorToOneMinute: factor,
      source: windPolicy.source,
      version: windPolicy.version,
    },
    centralPressureHpa,
    rmwKm: distanceToKm(raw.rmw, raw.radiusUnit),
    r34Km: distanceToKm(raw.windRadii.r34, raw.radiusUnit),
    r50Km: distanceToKm(raw.windRadii.r50, raw.radiusUnit),
    r64Km: distanceToKm(raw.windRadii.r64, raw.radiusUnit),
    organization: raw.organization,
  };
}

export function normalizeGridDescriptor(
  raw: RawGridDescriptor,
): NormalizedGridDescriptor {
  if (!['gregorian', 'standard', 'proleptic-gregorian'].includes(raw.calendar)) {
    throw new Error(`unsupported live grid calendar ${raw.calendar}`);
  }
  const analysisMs = Date.parse(validIso(raw.analysisTime, 'grid analysisTime'));
  if (!Number.isInteger(raw.nx) || raw.nx < 2 || !Number.isInteger(raw.ny) || raw.ny < 2) {
    throw new Error('live grid dimensions must be integers >= 2');
  }
  const pressureLevelsHpa = raw.pressureLevels.map((level) => {
    finite(level, 'pressure level');
    const hpa = raw.pressureUnit === 'Pa' ? level / 100 : level;
    if (hpa <= 0 || hpa > 1100) throw new Error(`invalid pressure level ${hpa} hPa`);
    return hpa;
  });
  const normalizeLongitude = (longitude: number) => {
    finite(longitude, 'longitude');
    return longitude > 180 ? longitude - 360 : longitude;
  };
  const validTimes = raw.validTimes.map((value) => validIso(value, 'grid validTime'));
  const leadHours = validTimes.map((value) => (Date.parse(value) - analysisMs) / 3_600_000);
  if (leadHours.some((lead) => !Number.isFinite(lead) || lead < 0)) {
    throw new Error('grid valid times must not precede analysis time');
  }
  return {
    calendar: 'proleptic-gregorian',
    analysisTime: raw.analysisTime,
    validTimes,
    leadHours,
    pressureLevelsHpa,
    bbox: {
      west: normalizeLongitude(raw.bbox.west),
      east: normalizeLongitude(raw.bbox.east),
      south: finite(raw.bbox.south, 'south latitude'),
      north: finite(raw.bbox.north, 'north latitude'),
    },
    nx: raw.nx,
    ny: raw.ny,
    scanning: 'north-to-south-west-to-east',
    sourceScanning: raw.scanning,
  };
}

export function evaluateLiveInputs(
  cycle: ForecastCycleIdentity,
  artifacts: readonly SourceArtifact[],
  nowIso: string,
): LiveInputDecision {
  const now = Date.parse(validIso(nowIso, 'now'));
  const failures: InputFailure[] = [];
  const requiredKinds: LiveProductKind[] = [
    'agency-advisory',
    'atmospheric-grid',
    'sea-surface-temperature',
    'upper-ocean',
  ];
  for (const kind of requiredKinds) {
    if (!artifacts.some((artifact) => artifact.required && artifact.kind === kind)) {
      failures.push({
        artifactId: kind,
        code: 'missing',
        message: `required ${kind} product is missing`,
      });
    }
  }
  for (const artifact of artifacts) {
    const fail = (code: InputFailureCode, message: string) =>
      failures.push({ artifactId: artifact.id, code, message });
    if (artifact.receivedBytes !== artifact.expectedBytes) {
      fail('partial-download',
        `received ${artifact.receivedBytes} of ${artifact.expectedBytes} bytes`);
    }
    if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      fail('checksum-invalid', 'SHA-256 must be 64 lowercase hexadecimal characters');
    }
    if (artifact.cycleId !== cycle.cycleId) {
      fail('cycle-mismatch', `${artifact.cycleId} does not match ${cycle.cycleId}`);
    }
    if (artifact.providerId !== cycle.providerId && artifact.kind === 'agency-advisory') {
      fail('provider-mismatch', 'advisory provider does not match forecast-cycle provider');
    }
    if (artifact.compatibility === 'incompatible') {
      fail('incompatible', artifact.incompatibilityReason ?? 'product is incompatible');
    }
    const validTime = Date.parse(artifact.validTime);
    if (!Number.isFinite(validTime)) {
      fail('incompatible', 'validTime is invalid');
    } else {
      const ageHours = (now - validTime) / 3_600_000;
      if (ageHours < -0.25) fail('future-valid-time', 'product valid time is in the future');
      if (ageHours > artifact.maxAgeHours) {
        fail('stale', `product age ${ageHours.toFixed(1)} h exceeds ${artifact.maxAgeHours} h`);
      }
    }
  }
  const requiredIds = new Set(artifacts.filter((item) => item.required).map((item) => item.id));
  const blocking = failures.some((failure) =>
    requiredIds.has(failure.artifactId) || requiredKinds.includes(failure.artifactId as LiveProductKind));
  const status = blocking ? 'unavailable' : failures.length > 0 ? 'degraded' : 'ready';
  return {
    status,
    currentForecastAllowed: status === 'ready',
    failures,
    fallback: status === 'ready'
      ? { mode: null, label: null }
      : {
          mode: 'climatology-sandbox',
          label: 'climatology sandbox — live inputs unavailable; not a current forecast',
        },
  };
}

export function validateArchivedRun(run: ArchivedForecastRun): string[] {
  const errors: string[] = [];
  if (run.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (run.product !== 'experimental-forecast-companion') {
    errors.push('product label must remain experimental-forecast-companion');
  }
  if (run.advisory.providerId !== run.cycle.providerId) {
    errors.push('advisory provider does not match cycle provider');
  }
  if (run.advisory.cycleId !== run.cycle.cycleId) {
    errors.push('advisory cycle does not match run cycle');
  }
  if (run.advisory.analysisTime !== run.cycle.analysisTime) {
    errors.push('advisory analysis time does not match run cycle');
  }
  const decision = evaluateLiveInputs(run.cycle, run.inputs, run.createdAt);
  if (JSON.stringify(decision) !== JSON.stringify(run.inputDecision)) {
    errors.push('inputDecision is stale or does not match the archived inputs');
  }
  if (!run.modelVersion) errors.push('modelVersion is required');
  for (const [name, track] of Object.entries(run.guidance)) {
    for (const point of track) {
      if (!Number.isFinite(point.leadH) || point.leadH < 0) {
        errors.push(`${name} contains an invalid lead time`);
      }
      if (!Number.isFinite(Date.parse(point.validTime))) {
        errors.push(`${name} contains an invalid valid time`);
      }
    }
  }
  return errors;
}
