import type { EventRunMode } from './scenarios';

export type ProductMode =
  | 'climatology-sandbox'
  | 'historical-hindcast'
  | 'historical-counterfactual';

export type ObservationTimeState =
  | 'simulation-only'
  | 'pending'
  | 'time-matched'
  | 'unsynced';

export interface ProductIdentityInput {
  scenarioLabel?: string | null;
  scenarioStartIso?: string | null;
  hindcastStartIso?: string | null;
  runMode: EventRunMode;
  ageH: number | null;
  observation?: {
    label: string;
    validTimeIso: string | null;
  } | null;
}

export interface ProductIdentity {
  mode: ProductMode;
  modeLabel: string;
  validTimeIso: string | null;
  validTimeLabel: string;
  observationState: ObservationTimeState;
  sourceLabel: string;
}

const OBSERVATION_MATCH_TOLERANCE_MS = 90 * 60_000;

function finiteAgeH(ageH: number | null): number {
  return typeof ageH === 'number' && Number.isFinite(ageH)
    ? Math.max(0, ageH)
    : 0;
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function formatUtc(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ][date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hour}:${minute} UTC`;
}

export function productMode(
  scenarioLabel: string | null | undefined,
  runMode: EventRunMode,
): { mode: ProductMode; label: string } {
  if (!scenarioLabel) {
    return {
      mode: 'climatology-sandbox',
      label: 'CLIMATOLOGY SANDBOX',
    };
  }
  if (runMode === 'hindcast') {
    return {
      mode: 'historical-hindcast',
      label: `RETROSPECTIVE REANALYSIS HINDCAST · ${scenarioLabel.toUpperCase()}`,
    };
  }
  return {
    mode: 'historical-counterfactual',
    label: `HISTORICAL COUNTERFACTUAL · ${scenarioLabel.toUpperCase()}`,
  };
}

/**
 * Resolve the model-valid time for event-backed runs. Climatology is deliberately
 * unanchored: assigning it wall-clock time would misrepresent monthly fields as
 * a current forecast.
 */
export function modelValidTimeIso(input: ProductIdentityInput): string | null {
  if (!input.scenarioLabel) return null;
  const baseIso = input.runMode === 'hindcast'
    ? input.hindcastStartIso ?? input.scenarioStartIso
    : input.scenarioStartIso;
  const baseMs = parseIsoMs(baseIso);
  if (baseMs === null) return null;
  return new Date(baseMs + finiteAgeH(input.ageH) * 3_600_000).toISOString();
}

export function buildProductIdentity(
  input: ProductIdentityInput,
): ProductIdentity {
  const resolvedMode = productMode(input.scenarioLabel, input.runMode);
  const validTimeIso = modelValidTimeIso(input);
  const validTimeLabel = validTimeIso
    ? `MODEL VALID ${formatUtc(validTimeIso)}`
    : `MODEL +${finiteAgeH(input.ageH).toFixed(1)} H · NO UTC VALID TIME`;

  if (!input.observation) {
    return {
      mode: resolvedMode.mode,
      modeLabel: resolvedMode.label,
      validTimeIso,
      validTimeLabel,
      observationState: 'simulation-only',
      sourceLabel: 'SIMULATION ONLY',
    };
  }

  const observationMs = parseIsoMs(input.observation.validTimeIso);
  if (observationMs === null) {
    return {
      mode: resolvedMode.mode,
      modeLabel: resolvedMode.label,
      validTimeIso,
      validTimeLabel,
      observationState: 'pending',
      sourceLabel: `${input.observation.label.toUpperCase()} · VALID TIME PENDING`,
    };
  }
  const modelMs = parseIsoMs(validTimeIso);
  if (
    modelMs !== null &&
    Math.abs(modelMs - observationMs) <= OBSERVATION_MATCH_TOLERANCE_MS
  ) {
    return {
      mode: resolvedMode.mode,
      modeLabel: resolvedMode.label,
      validTimeIso,
      validTimeLabel,
      observationState: 'time-matched',
      sourceLabel: `${input.observation.label.toUpperCase()} · TIME-MATCHED DISPLAY`,
    };
  }
  return {
    mode: resolvedMode.mode,
    modeLabel: resolvedMode.label,
    validTimeIso,
    validTimeLabel,
    observationState: 'unsynced',
    sourceLabel: `${input.observation.label.toUpperCase()} · UNSYNCED OBS OVERLAY`,
  };
}

export function requiresObservationAcknowledgement(
  stormActive: boolean,
  requestedSource: 'simulated' | 'observed' | 'handoff',
  alreadyAcknowledged: boolean,
): boolean {
  return stormActive && requestedSource !== 'simulated' && !alreadyAcknowledged;
}
