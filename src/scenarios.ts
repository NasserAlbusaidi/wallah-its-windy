/**
 * scenarios.ts — historic-event scenario catalogue + counterfactual decision
 * helpers (C8, the DOM-free half).
 *
 * data/scenarios.json (writer B1, shape C3) names each replayable historic event:
 * its env bin, the month it rode, the time window that maps sim-hours onto
 * event-hours, and the canonical spawn. This module validates that file and holds
 * the PURE decisions the scenario runtime makes on a switch (which synoptic index
 * to select, what to spawn) so main.ts stays a thin shell and the invariants are
 * node-testable without a DOM.
 *
 * Degradation contract (C8): a missing/404 scenarios.json is handled upstream (the
 * loader returns null); a downloaded-but-malformed file must NEVER throw — a bad
 * top-level shape degrades to `null` (the picker is then disabled), and individual
 * malformed entries are dropped, not fatal. The picker offers only climatology
 * when the catalogue is empty.
 */

/** The picker value + hash sentinel for the default (non-event) regime. */
export const CLIMATOLOGY_ID = 'climatology';

/** The canonical spawn point/seed for a historic event (first in-domain fix, C3). */
export interface ScenarioSpawn {
  lat: number;
  lon: number;
  seed: number;
}

/** One replayable historic event (shape C3). */
export interface Scenario {
  /** Stable id: the picker value AND the URL hash `env` key (e.g. "gonu"). */
  id: string;
  /** Lowercase option label, e.g. "gonu 2007". */
  label: string;
  /** Event env bin path relative to the asset base, e.g. "data/env_gonu.bin". */
  bin: string;
  /** 0-indexed month the event rode; pins the (disabled) picker + SST tint. */
  monthIndex: number;
  /** Hours between the bin's time planes (informational; the bake owns it). */
  stepH: number;
  /** (planes-1)*stepH: the tFrac horizon so sim-hours map 1:1 onto event-hours. */
  windowH: number;
  /** ISO of the first time plane (informational). */
  startIso: string;
  /** The canonical spawn used when no user storm is active on switch. */
  spawn: ScenarioSpawn;
  /** The tracks.json storm id to highlight as the active ghost (e.g. "gonu2007"). */
  ghostId: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function finiteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function parseSpawn(v: unknown): ScenarioSpawn | null {
  if (!isRecord(v)) return null;
  if (!finiteNum(v.lat) || !finiteNum(v.lon) || !finiteNum(v.seed)) return null;
  return { lat: v.lat, lon: v.lon, seed: v.seed };
}

function parseScenario(v: unknown): Scenario | null {
  if (!isRecord(v)) return null;
  if (!nonEmptyStr(v.id) || !nonEmptyStr(v.label) || !nonEmptyStr(v.bin)) return null;
  if (!nonEmptyStr(v.startIso) || !nonEmptyStr(v.ghostId)) return null;
  if (!finiteNum(v.monthIndex) || !finiteNum(v.stepH) || !finiteNum(v.windowH)) return null;
  // Range-check the numerics the runtime trusts: monthIndex indexes the env
  // layer suffix (0..11; anything else would silently clamp to a wrong month), and
  // a non-positive stepH/windowH would make tFrac = ageH/windowH divide-by-zero or
  // run the time axis backwards.
  if (!Number.isInteger(v.monthIndex) || v.monthIndex < 0 || v.monthIndex > 11) return null;
  if (v.stepH <= 0 || v.windowH <= 0) return null;
  const spawn = parseSpawn(v.spawn);
  if (!spawn) return null;
  return {
    id: v.id,
    label: v.label,
    bin: v.bin,
    monthIndex: v.monthIndex,
    stepH: v.stepH,
    windowH: v.windowH,
    startIso: v.startIso,
    spawn,
    ghostId: v.ghostId,
  };
}

/**
 * Validate parsed JSON into Scenario[], or null for a malformed file.
 *
 * Returns null ONLY for a top-level shape failure (non-object root, version !== 1,
 * non-array `scenarios`). A well-shaped file with individual bad entries yields the
 * surviving subset (possibly []); it never throws. Mirrors tracks.parseTracks.
 */
export function parseScenarios(json: unknown): Scenario[] | null {
  if (!isRecord(json)) return null;
  if (json.version !== 1) return null;
  if (!Array.isArray(json.scenarios)) return null;
  const out: Scenario[] = [];
  for (const s of json.scenarios) {
    const parsed = parseScenario(s);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Look up a scenario by id (the picker value / hash env key), or null. */
export function findScenario(scenarios: readonly Scenario[], id: string | null | undefined): Scenario | null {
  if (id == null || id === CLIMATOLOGY_ID) return null;
  return scenarios.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Pure mode-switch decisions (node-testable — no DOM, no fetch)
// ---------------------------------------------------------------------------

/**
 * The synoptic-plane index to set on the sampler BEFORE spawn.
 *
 * Event mode uses -1 to restore tFrac time-interpolation (the event bin's nt IS a
 * time axis — env-sampler nearestCell). Climatology uses the D10 regime pick
 * seed % planeCount, so a shared seed replays the same plane. This is THE sign
 * flip the mode-switch invariant tests pin: event < 0, climatology >= 0.
 */
export function synopticIndexForSpawn(inEvent: boolean, seed: number, planeCount: number): number {
  if (inEvent) return -1;
  const k = Math.max(1, Math.floor(planeCount));
  return (seed >>> 0) % k;
}

/** The spawn identity used when entering an event, minus isDemo/monthIndex glue. */
export interface EventSpawn {
  lat: number;
  lon: number;
  monthIndex: number;
  seed: number;
  /** The event window horizon threaded into SpawnParams (C4/C8). */
  tFracHorizonH: number;
  isDemo: false;
}

/** The lat/lon/seed identity of an active user storm (for the counterfactual). */
export interface StormIdentity {
  lat: number;
  lon: number;
  seed: number;
}

/**
 * What to spawn when switching TO an event. If a user storm is active, re-run its
 * SAME lat/lon/seed under the event's month + env (the counterfactual — "what if
 * your storm had been Gonu's season?"); otherwise spawn the scenario's canonical
 * historic point. The month is always PINNED to the scenario's, and windowH is
 * threaded as the tFrac horizon so sim-hours map onto event-hours.
 */
export function eventSpawn(scenario: Scenario, userStorm: StormIdentity | null): EventSpawn {
  const base = userStorm
    ? { lat: userStorm.lat, lon: userStorm.lon, seed: userStorm.seed }
    : { lat: scenario.spawn.lat, lon: scenario.spawn.lon, seed: scenario.spawn.seed };
  return {
    ...base,
    monthIndex: scenario.monthIndex,
    tFracHorizonH: scenario.windowH,
    isDemo: false,
  };
}

/**
 * The month to restore when returning to climatology: the month captured when the
 * user LEFT climatology, falling back to the active storm's month, then a supplied
 * default (the demo month). Keeps the deterministic June-vs-October comparison the
 * month picker offers intact across an event excursion.
 */
export function restoredMonth(preEventMonth: number | null, userMonth: number | null, fallback: number): number {
  if (preEventMonth != null && Number.isInteger(preEventMonth)) return preEventMonth;
  if (userMonth != null && Number.isInteger(userMonth)) return userMonth;
  return fallback;
}
