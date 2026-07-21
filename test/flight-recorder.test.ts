import { describe, expect, it } from 'vitest';
import { compassDirection, FlightRecorder } from '../src/flight-recorder';
import type { StormDiagnostics, StormState } from '../src/types';
import { DeathReason } from '../src/types';
import { deriveStormStructure } from '../src/structure';

const DIAGNOSTICS: StormDiagnostics = {
  sstC: 29,
  effectiveSstC: 29,
  midlevelRhPct: 70,
  ohcKjCm2: 60,
  organization: 0.7,
  organizationTarget: 0.8,
  coldWakeC: 0,
  mpiKt: 120,
  steerU: -2,
  steerV: 3,
  shearMs: 8,
  shearUms: 6,
  shearVms: 5,
  overLand: false,
  oceanKtPerH: 1,
  shearKtPerH: 0,
  landKtPerH: 0,
  dryAirKtPerH: 0,
  netKtPerH: 1,
  eyewallRainMmH: 10,
  rainbandRainMmH: 4,
  orographicRainMmH: 2,
  totalRainMmH: 16,
};

function state(ageH: number, vKt: number, alive = true): StormState {
  return {
    lat: 18 + ageH / 10,
    lon: 62 - ageH / 10,
    vKt,
    ageH,
    trackPoints: [],
    alive,
    isDemo: false,
    organization: DIAGNOSTICS.organization,
    coldWakeC: DIAGNOSTICS.coldWakeC,
    diagnostics: { ...DIAGNOSTICS },
    structure: deriveStormStructure({
      vKt,
      lat: 18 + ageH / 10,
      shearMs: DIAGNOSTICS.shearMs,
      overLand: false,
      motionUms: DIAGNOSTICS.steerU,
      motionVms: DIAGNOSTICS.steerV,
    }),
  };
}

function meta(
  label: string,
  monthIndex = 5,
  seed = 42,
  extra: { historicalPeakKt?: number; counterfactual?: boolean } = {},
) {
  return {
    spawn: { lat: 18, lon: 62, monthIndex, seed, isDemo: false },
    environmentId: extra.counterfactual ? 'gonu' : 'climatology',
    monthIndex,
    seed,
    isDemo: false,
    label,
    counterfactual: extra.counterfactual ?? false,
    ...(extra.historicalPeakKt === undefined
      ? {}
      : { historicalPeakKt: extra.historicalPeakKt }),
  };
}

describe('FlightRecorder replay snapshots', () => {
  it('exposes a stable immutable wind/age series until a new frame lands', () => {
    const recorder = new FlightRecorder();
    recorder.start(meta('simulated cyclone'), state(0, 30));
    const initial = recorder.intensitySeries();
    expect(initial).toEqual([{ ageH: 0, vKt: 30 }]);
    expect(recorder.intensitySeries()).toBe(initial);

    recorder.record(state(1, 40), []);
    const advanced = recorder.intensitySeries();
    expect(advanced).not.toBe(initial);
    expect(advanced).toEqual([
      { ageH: 0, vKt: 30 },
      { ageH: 1, vKt: 40 },
    ]);
    expect(initial).toEqual([{ ageH: 0, vKt: 30 }]);
    expect(recorder.trackSnapshot().map((point) => point.vKt)).toEqual([30, 40]);
  });

  it('rebuilds a scrubbed storm with only the track recorded up to that frame', () => {
    const recorder = new FlightRecorder();
    recorder.start(
      meta('june climatology'),
      state(0, 30),
    );
    recorder.record(state(1, 40), []);
    recorder.record(state(2, 50), []);

    const scrubbed = recorder.stormAt(1)!;
    expect(scrubbed.ageH).toBe(1);
    expect(scrubbed.vKt).toBe(40);
    expect(scrubbed.trackPoints.map((point) => point.ageH)).toEqual([0, 1]);

    scrubbed.trackPoints[0].vKt = 999;
    scrubbed.structure.r34Km.ne = 999;
    expect(recorder.stormAt(0)!.vKt).toBe(30);
    expect(recorder.stormAt(1)!.structure.r34Km.ne).not.toBe(999);
    expect(recorder.stormAt(99)!.ageH).toBe(2);
  });

  it('ignores repeated no-op snapshots after the engine has stopped', () => {
    const recorder = new FlightRecorder();
    recorder.start(
      meta('june climatology'),
      state(0, 30),
    );
    const dead = state(1, 19, false);
    recorder.record(dead, []);
    recorder.record(dead, []);
    recorder.record(dead, []);

    expect(recorder.frameCount).toBe(2);
  });
});

describe('FlightRecorder debrief', () => {
  it('reports landfall, death, and the active historical comparison', () => {
    const recorder = new FlightRecorder();
    recorder.start(
      meta('gonu 2007 counterfactual', 5, 2007, {
        historicalPeakKt: 127,
        counterfactual: true,
      }),
      state(0, 30),
    );
    recorder.record(state(24, 60), [
      { type: 'landfall', lat: 22.1, lon: 59.4 },
    ]);
    recorder.record(state(30, 19, false), [
      {
        type: 'died',
        death: {
          reason: DeathReason.Land,
          closestApproachKm: 82,
          durationH: 30,
          peakKt: 60,
        },
      },
    ]);

    expect(recorder.debrief()).toEqual({
      label: 'gonu 2007 counterfactual',
      monthIndex: 5,
      seed: 2007,
      death: {
        reason: DeathReason.Land,
        closestApproachKm: 82,
        durationH: 30,
        peakKt: 60,
      },
      landfall: { lat: 22.1, lon: 59.4, frameIndex: 1 },
      historicalPeakKt: 127,
      historicalDeltaKt: -67,
    });
  });
});

describe('FlightRecorder replay milestones', () => {
  it('finds the peak, first landfall, and final recorded frame', () => {
    const recorder = new FlightRecorder();
    recorder.start(
      meta('may climatology', 4, 7),
      state(0, 30),
    );
    recorder.record(state(12, 70), []);
    recorder.record(state(24, 95), []);
    recorder.record(state(30, 80), [
      { type: 'landfall', lat: 22.5, lon: 59.2 },
    ]);
    recorder.record(state(36, 19, false), []);

    expect(recorder.milestones()).toEqual({
      start: 0,
      peak: 2,
      landfall: 3,
      end: 4,
    });
  });
});

describe('compassDirection', () => {
  it('names the environmental steering vector without inventing motion in calm air', () => {
    expect(compassDirection(0, 0)).toBe('calm');
    expect(compassDirection(0, 5)).toBe('north');
    expect(compassDirection(5, 0)).toBe('east');
    expect(compassDirection(-4, 4)).toBe('northwest');
    expect(compassDirection(4, -4)).toBe('southeast');
  });
});
