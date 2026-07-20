/**
 * storm-session.ts — lifecycle and replay transport for one deterministic run.
 *
 * The composition root advances physics; this controller owns everything about
 * observing that run: recording, pause state, seeking, replay playback, and an
 * optional paired-run baseline. Recorded frames never drive the live engine.
 */

import { compareRuns, type RunComparison } from './comparison';
import {
  FlightRecorder,
  type FlightRunMeta,
  type FlightRunSnapshot,
} from './flight-recorder';
import type { SimEvent, StormState, TrackPoint } from './types';

const DEFAULT_REPLAY_DURATION_MS = 12_000;

export class StormSession {
  readonly recorder = new FlightRecorder();
  private pausedValue = false;
  private replayIndexValue: number | null = null;
  private replayPlayingValue = false;
  private replayCursor = 0;
  private comparisonBaselineValue: FlightRunSnapshot | null = null;
  private comparisonAwaitingCandidate = false;

  constructor(private readonly replayDurationMs = DEFAULT_REPLAY_DURATION_MS) {}

  start(meta: FlightRunMeta, initial: StormState, preserveComparison = false): void {
    if (!preserveComparison) {
      this.comparisonBaselineValue = null;
      this.comparisonAwaitingCandidate = false;
    } else {
      this.comparisonAwaitingCandidate = false;
    }
    this.pausedValue = false;
    this.replayIndexValue = null;
    this.replayPlayingValue = false;
    this.replayCursor = 0;
    this.recorder.start(meta, initial);
  }

  record(state: StormState, events: readonly SimEvent[]): void {
    this.recorder.record(state, events);
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get replayIndex(): number | null {
    return this.replayIndexValue;
  }

  get replayPlaying(): boolean {
    return this.replayPlayingValue;
  }

  get replayMode(): boolean {
    return this.replayIndexValue !== null;
  }

  get frameIndex(): number {
    return this.replayIndexValue ?? Math.max(0, this.recorder.frameCount - 1);
  }

  get complete(): boolean {
    return this.recorder.debrief() !== null;
  }

  get comparisonBaseline(): FlightRunSnapshot | null {
    return this.comparisonBaselineValue;
  }

  get comparisonTrack(): TrackPoint[] | null {
    return this.comparisonBaselineValue?.track ?? null;
  }

  beginComparison(): FlightRunSnapshot | null {
    const completed = this.recorder.snapshot();
    if (!completed || completed.meta.isDemo) return null;
    this.comparisonBaselineValue = completed;
    this.comparisonAwaitingCandidate = true;
    return completed;
  }

  clearComparison(): void {
    this.comparisonBaselineValue = null;
    this.comparisonAwaitingCandidate = false;
  }

  comparison(): RunComparison | null {
    const current = this.recorder.snapshot();
    if (
      !this.comparisonBaselineValue ||
      this.comparisonAwaitingCandidate ||
      !current
    ) {
      return null;
    }
    return compareRuns(this.comparisonBaselineValue, current);
  }

  seek(index: number): void {
    if (this.recorder.frameCount === 0) return;
    this.replayIndexValue = Math.max(
      0,
      Math.min(this.recorder.frameCount - 1, Math.round(index)),
    );
    this.replayCursor = this.replayIndexValue;
    this.replayPlayingValue = false;
    this.pausedValue = true;
  }

  toggle(): void {
    if (!this.complete) {
      this.pausedValue = !this.pausedValue;
      return;
    }
    const end = this.recorder.frameCount - 1;
    if (this.replayIndexValue === null || this.replayIndexValue >= end) {
      this.replayIndexValue = 0;
      this.replayCursor = 0;
      this.replayPlayingValue = true;
      this.pausedValue = true;
      return;
    }
    this.replayPlayingValue = !this.replayPlayingValue;
    this.replayCursor = this.replayIndexValue;
    this.pausedValue = true;
  }

  advanceReplay(dtRealMs: number): void {
    if (!this.replayPlayingValue || this.replayIndexValue === null) return;
    const end = this.recorder.frameCount - 1;
    this.replayCursor += (dtRealMs / this.replayDurationMs) * end;
    this.replayIndexValue = Math.min(end, Math.floor(this.replayCursor));
    if (this.replayIndexValue >= end) {
      this.replayIndexValue = end;
      this.replayCursor = end;
      this.replayPlayingValue = false;
    }
  }

  stormView(live: StormState | null): {
    storm: StormState | null;
    prev: StormState | null;
  } {
    if (this.replayIndexValue !== null) {
      return {
        storm: this.recorder.stormAt(this.replayIndexValue),
        prev: this.recorder.stormAt(Math.max(0, this.replayIndexValue - 1)),
      };
    }
    return { storm: live, prev: null };
  }
}
