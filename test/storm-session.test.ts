import { describe, expect, it } from 'vitest';
import { StormSession } from '../src/storm-session';
import { DeathReason, type StormDiagnostics, type StormState } from '../src/types';

const diagnostics: StormDiagnostics = {
  sstC: 29,
  mpiKt: 100,
  steerU: 1,
  steerV: 2,
  shearMs: 5,
  overLand: false,
  oceanKtPerH: 1,
  shearKtPerH: 0,
  landKtPerH: 0,
  dryAirKtPerH: 0,
  netKtPerH: 1,
};

function state(ageH: number, alive = true): StormState {
  return {
    lat: 17,
    lon: 62,
    vKt: alive ? 40 + ageH : 19,
    ageH,
    alive,
    isDemo: false,
    diagnostics,
    trackPoints: [{ lat: 17, lon: 62, vKt: 40, ageH: 0 }],
  };
}

function meta(label: string) {
  return {
    spawn: { lat: 17, lon: 62, seed: 7, monthIndex: 4, isDemo: false },
    environmentId: 'climatology',
    monthIndex: 4,
    seed: 7,
    isDemo: false,
    label,
    counterfactual: false,
  };
}

describe('StormSession', () => {
  it('owns pause, seek, and deterministic replay playback', () => {
    const session = new StormSession(100);
    session.start(meta('may'), state(0));
    session.record(state(1), []);
    session.record(state(2, false), [{
      type: 'died',
      death: {
        reason: DeathReason.Shear,
        closestApproachKm: 200,
        durationH: 2,
        peakKt: 41,
      },
    }]);
    session.toggle();
    expect(session.replayIndex).toBe(0);
    expect(session.replayPlaying).toBe(true);
    session.advanceReplay(100);
    expect(session.replayIndex).toBe(2);
    expect(session.replayPlaying).toBe(false);
    session.seek(1);
    expect(session.stormView(null).storm?.ageH).toBe(1);
  });

  it('keeps a completed baseline only for an intentional comparison run', () => {
    const session = new StormSession();
    session.start(meta('may'), state(0));
    session.record(state(1, false), [{
      type: 'died',
      death: {
        reason: DeathReason.ColdWater,
        closestApproachKm: 300,
        durationH: 1,
        peakKt: 40,
      },
    }]);
    expect(session.beginComparison()?.meta.label).toBe('may');
    expect(session.comparison()).toBeNull();
    session.start({ ...meta('october'), monthIndex: 9 }, state(0), true);
    expect(session.comparisonBaseline?.meta.label).toBe('may');
    session.start(meta('fresh'), state(0));
    expect(session.comparisonBaseline).toBeNull();
  });
});
