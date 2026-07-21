/**
 * flight-recorder.ts — immutable per-tick storm history for debrief and replay.
 *
 * Recording observes the engine; it never drives or rewinds physics. A scrubbed
 * StormState is rebuilt from compact copied frames, so replay cannot mutate the
 * deterministic run that produced it.
 */

import type {
  LatLon,
  SimEvent,
  SpawnParams,
  StormDeath,
  StormDiagnostics,
  StormState,
  StormStructure,
  TrackPoint,
} from './types';
import { cloneStormStructure } from './structure';

export interface FlightRunMeta {
  /** Exact genesis identity used to reproduce and compare this run. */
  spawn: SpawnParams;
  /** Stable environment key: `climatology` or a historic scenario id. */
  environmentId: string;
  monthIndex: number;
  seed: number;
  isDemo: boolean;
  label: string;
  /** Deterministic simulated identity; absent only for official-history hindcasts. */
  stormName?: string;
  stormNameCatalogueVersion?: string;
  stormNameOfficial?: false;
  /** True only for the user-authored event-environment sandbox. */
  counterfactual: boolean;
  /** Observed initialization, free simulation, and post-run fix scoring. */
  hindcast?: boolean;
  hindcastStartIso?: string;
  historicalPeakKt?: number;
}

export interface FlightFrame extends TrackPoint {
  alive: boolean;
  organization: number;
  coldWakeC: number;
  diagnostics: StormDiagnostics;
  structure: StormStructure;
}

export interface FlightIntensityPoint {
  ageH: number;
  vKt: number;
}

export interface FlightLandfall extends LatLon {
  frameIndex: number;
}

export interface StormDebrief {
  label: string;
  monthIndex: number;
  seed: number;
  death: StormDeath;
  landfall: FlightLandfall | null;
  historicalPeakKt?: number;
  historicalDeltaKt?: number;
}

export interface ReplayMilestones {
  start: number;
  peak: number;
  landfall: number | null;
  end: number;
}

/** A detached, immutable-by-convention result suitable for comparison/export. */
export interface FlightRunSnapshot {
  meta: FlightRunMeta;
  debrief: StormDebrief;
  frames: FlightFrame[];
  track: TrackPoint[];
}

function clampIndex(index: number, length: number): number {
  if (length <= 1) return 0;
  if (!Number.isFinite(index)) return length - 1;
  return Math.max(0, Math.min(length - 1, Math.round(index)));
}

const COMPASS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

/** Name an east/north steering vector with an eight-point compass label. */
export function compassDirection(steerU: number, steerV: number): string {
  if (Math.hypot(steerU, steerV) < 0.1) return 'calm';
  const octant = Math.round(Math.atan2(steerU, steerV) / (Math.PI / 4));
  return COMPASS[(octant + 8) % 8];
}

function frameOf(state: StormState): FlightFrame {
  return {
    lat: state.lat,
    lon: state.lon,
    vKt: state.vKt,
    ageH: state.ageH,
    alive: state.alive,
    organization: state.organization,
    coldWakeC: state.coldWakeC,
    diagnostics: { ...state.diagnostics },
    structure: cloneStormStructure(state.structure),
  };
}

export class FlightRecorder {
  private frames: FlightFrame[] = [];
  private meta: FlightRunMeta | null = null;
  private landfall: FlightLandfall | null = null;
  private death: StormDeath | null = null;
  private intensityCache: readonly FlightIntensityPoint[] = [];

  start(meta: FlightRunMeta, initial: StormState): void {
    this.meta = { ...meta, spawn: { ...meta.spawn } };
    this.frames = [frameOf(initial)];
    this.intensityCache = [];
    this.landfall = null;
    this.death = null;
  }

  record(state: StormState, events: readonly SimEvent[]): void {
    if (!this.meta) return;
    const next = frameOf(state);
    const last = this.frames[this.frames.length - 1];
    const duplicate =
      !!last &&
      last.ageH === next.ageH &&
      last.lat === next.lat &&
      last.lon === next.lon &&
      last.vKt === next.vKt &&
      last.alive === next.alive;
    if (!duplicate) this.frames.push(next);
    for (const event of events) {
      if (event.type === 'landfall' && !this.landfall) {
        this.landfall = {
          lat: event.lat,
          lon: event.lon,
          frameIndex: this.frames.length - 1,
        };
      }
      if (event.type === 'died') this.death = { ...event.death };
    }
  }

  get frameCount(): number {
    return this.frames.length;
  }

  stormAt(index: number): StormState | null {
    if (!this.meta || this.frames.length === 0) return null;
    const at = clampIndex(index, this.frames.length);
    const frame = this.frames[at];
    const trackPoints: TrackPoint[] = this.frames
      .slice(0, at + 1)
      .map(({ lat, lon, vKt, ageH }) => ({ lat, lon, vKt, ageH }));
    return {
      lat: frame.lat,
      lon: frame.lon,
      vKt: frame.vKt,
      ageH: frame.ageH,
      trackPoints,
      alive: frame.alive,
      isDemo: this.meta.isDemo,
      organization: frame.organization,
      coldWakeC: frame.coldWakeC,
      diagnostics: { ...frame.diagnostics },
      structure: cloneStormStructure(frame.structure),
    };
  }

  debrief(): StormDebrief | null {
    if (!this.meta || !this.death) return null;
    const historicalPeakKt = this.meta.historicalPeakKt;
    return {
      label: this.meta.label,
      monthIndex: this.meta.monthIndex,
      seed: this.meta.seed,
      death: { ...this.death },
      landfall: this.landfall ? { ...this.landfall } : null,
      ...(historicalPeakKt === undefined
        ? {}
        : {
            historicalPeakKt,
            historicalDeltaKt: this.death.peakKt - historicalPeakKt,
          }),
    };
  }

  snapshot(): FlightRunSnapshot | null {
    const debrief = this.debrief();
    if (!this.meta || !debrief) return null;
    const frames = this.frames.map((frame) => ({
      ...frame,
      diagnostics: { ...frame.diagnostics },
      structure: cloneStormStructure(frame.structure),
    }));
    return {
      meta: { ...this.meta, spawn: { ...this.meta.spawn } },
      debrief: {
        ...debrief,
        death: { ...debrief.death },
        landfall: debrief.landfall ? { ...debrief.landfall } : null,
      },
      frames,
      track: frames.map(({ lat, lon, vKt, ageH }) => ({ lat, lon, vKt, ageH })),
    };
  }

  /**
   * Detached frames for offline verification while a fixed-duration hindcast
   * is still alive. Unlike snapshot(), this deliberately does not require a
   * death event and therefore cannot be mistaken for a completed debrief.
   */
  framesSnapshot(): FlightFrame[] {
    return this.frames.map((frame) => ({
      ...frame,
      diagnostics: { ...frame.diagnostics },
      structure: cloneStormStructure(frame.structure),
    }));
  }

  /** Detached geographic tape for similarity/verification consumers. */
  trackSnapshot(): TrackPoint[] {
    return this.frames.map(({ lat, lon, vKt, ageH }) => ({
      lat,
      lon,
      vKt,
      ageH,
    }));
  }

  /**
   * Stable immutable wind/age series. Reuses the same frozen array until a new
   * physics frame lands, so per-animation-frame UI updates do not copy the tape.
   */
  intensitySeries(): readonly FlightIntensityPoint[] {
    if (this.intensityCache.length !== this.frames.length) {
      this.intensityCache = Object.freeze(
        this.frames.map(({ ageH, vKt }) => Object.freeze({ ageH, vKt })),
      );
    }
    return this.intensityCache;
  }

  milestones(): ReplayMilestones | null {
    if (this.frames.length === 0) return null;
    let peak = 0;
    for (let index = 1; index < this.frames.length; index++) {
      if (this.frames[index].vKt > this.frames[peak].vKt) peak = index;
    }
    return {
      start: 0,
      peak,
      landfall: this.landfall?.frameIndex ?? null,
      end: this.frames.length - 1,
    };
  }
}
