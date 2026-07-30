import { describe, expect, it } from 'vitest';
import {
  CLOUD_MEMORY_DT_H,
  CLOUD_MEMORY_STEPS,
  CLOUD_MEMORY_WINDOW_H,
  CLOUD_MEMORY_DECAY_TAU_H,
  CLOUD_MEMORY_MAX_ADVECT_KMH,
  CloudMemoryLru,
  ageAfterSource,
  decodeDebrisAge,
  densityAfterSource,
  encodeDebrisAge,
  memoryAdvectSpeedKmH,
  memoryBoundaryPair,
  quantizeByte,
  sourceBoundaries,
  tailResidualByte,
} from '../src/render/cloud-memory';
import { cloudAngularRateRadPerH } from '../src/render/cloud-motion';
import {
  FlightRecorder,
  type FlightRunMeta,
} from '../src/flight-recorder';
import type { StormState } from '../src/types';

describe('cloud-memory: boundary math', () => {
  it('splits cloud age into boundary index and fraction', () => {
    expect(memoryBoundaryPair(0)).toEqual({ k: 0, frac: 0 });
    expect(memoryBoundaryPair(7.25)).toEqual({ k: 7, frac: 0.25 });
    expect(memoryBoundaryPair(17.999999)).toEqual({
      k: 17,
      frac: expect.closeTo(0.999999, 5),
    });
  });

  it('enumerates source boundaries k-N..k-1, floored at spawn (0)', () => {
    expect(sourceBoundaries(2)).toEqual([0, 1]);
    expect(sourceBoundaries(0)).toEqual([]);
    const full = sourceBoundaries(30);
    expect(full).toHaveLength(CLOUD_MEMORY_STEPS);
    expect(full[0]).toBe(12);
    expect(full[full.length - 1]).toBe(29);
  });

  it('causality seal: no source boundary is ever >= k', () => {
    for (const k of [1, 5, 18, 19, 40]) {
      for (const b of sourceBoundaries(k)) expect(b).toBeLessThan(k);
    }
  });
});

describe('cloud-memory: debris age encoding', () => {
  it('round-trips within one byte step', () => {
    for (const h of [0, 3, 9, 17.5, 18]) {
      const decoded = decodeDebrisAge(quantizeByte(encodeDebrisAge(h)));
      expect(Math.abs(decoded - Math.min(h, CLOUD_MEMORY_WINDOW_H))).toBeLessThan(
        CLOUD_MEMORY_WINDOW_H / 255 + 1e-9,
      );
    }
  });

  it('clamps beyond the window', () => {
    expect(encodeDebrisAge(40)).toBe(1);
  });
});

describe('cloud-memory: advection speed', () => {
  it('applies the linear cap where the angular cap alone would exceed it', () => {
    // 0.3 rad/h at 190 km = 57 km/h uncapped; the linear cap must bind.
    const v = memoryAdvectSpeedKmH(190, 95, 50, 1.35, false);
    expect(v).toBe(CLOUD_MEMORY_MAX_ADVECT_KMH);
  });

  it('matches omega*r below both caps', () => {
    const rKm = 40;
    const omega = cloudAngularRateRadPerH(rKm, 30, 20, 1.35);
    expect(memoryAdvectSpeedKmH(rKm, 30, 20, 1.35, false)).toBeCloseTo(
      Math.min(omega * rKm, CLOUD_MEMORY_MAX_ADVECT_KMH),
      9,
    );
  });

  it('uses the legacy slow rate under reduced motion', () => {
    const rKm = 40;
    const fast = memoryAdvectSpeedKmH(rKm, 30, 50, 1.35, false);
    const slow = memoryAdvectSpeedKmH(rKm, 30, 50, 1.35, true);
    expect(slow).toBeLessThan(fast);
    expect(slow).toBeCloseTo(0.028 * rKm, 9);
  });
});

describe('cloud-memory: sealed combine rules', () => {
  it('density is additive with saturation', () => {
    expect(densityAfterSource(0.7, 0.5)).toBe(1);
    expect(densityAfterSource(0.2, 0.3)).toBeCloseTo(0.5, 9);
  });

  it('age is density-weighted toward 0 under fresh source', () => {
    expect(ageAfterSource(0.8, 0.4, 0.4)).toBeCloseTo(0.4, 9);
    expect(ageAfterSource(0.8, 0.4, 0)).toBeCloseTo(0.8, 9);
    expect(ageAfterSource(0.8, 0, 0.6)).toBeCloseTo(0, 6);
  });
});

describe('cloud-memory: quantized tail contract (spec gate record, round 4)', () => {
  it('a unit injection ends at byte <= 13 after N quantized decay steps', () => {
    expect(tailResidualByte()).toBeLessThanOrEqual(13);
  });

  it('relation: the float exponent alone would round UP to that byte', () => {
    // Documents WHY the contract is byte-space: exp(-3)*255 = 12.696 -> 13.
    const floatResidual = Math.exp(
      (-CLOUD_MEMORY_STEPS * CLOUD_MEMORY_DT_H) / CLOUD_MEMORY_DECAY_TAU_H,
    );
    expect(Math.round(floatResidual * 255)).toBe(13);
  });
});

describe('cloud-memory: LRU', () => {
  it('keys on run, boundary, size, and reduced motion', () => {
    const lru = new CloudMemoryLru<number>(4);
    const a = lru.keyFor('run1', 5, 512, false);
    expect(lru.keyFor('run1', 5, 512, false)).toBe(a);
    expect(lru.keyFor('run2', 5, 512, false)).not.toBe(a);
    expect(lru.keyFor('run1', 6, 512, false)).not.toBe(a);
    expect(lru.keyFor('run1', 5, 256, false)).not.toBe(a);
    expect(lru.keyFor('run1', 5, 512, true)).not.toBe(a);
  });

  it('evicts least-recently-used and returns the evicted value', () => {
    const lru = new CloudMemoryLru<number>(2);
    expect(lru.set('a', 1)).toBeNull();
    expect(lru.set('b', 2)).toBeNull();
    expect(lru.get('a')).toBe(1); // refresh a
    expect(lru.set('c', 3)).toBe(2); // b evicted
    expect(lru.get('b')).toBeNull();
  });
});

function makeStormState(overrides: Partial<StormState> = {}): StormState {
  return {
    lat: 18,
    lon: 62,
    vKt: 40,
    ageH: 0,
    alive: true,
    organization: 0.7,
    coldWakeC: 0,
    diagnostics: {
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
    },
    structure: {
      maximumWindKt: 40,
      centralPressureHpa: 990,
      environmentalPressureHpa: 1010,
      rmwKm: 30,
      outerSizeKm: 180,
      outerWindScale: 1,
      outerBlendStartWindKt: 34,
      outerBlendFullWindKt: 64,
      hollandB: 1.35,
      motionUms: -2,
      motionVms: 3,
      translationAsymmetryKt: 0,
      shearUms: 6,
      shearVms: 5,
      shearAsymmetryFraction: 0,
      rainOffsetEastKm: 0,
      rainOffsetNorthKm: 0,
      r34Km: { ne: 100, se: 100, sw: 100, nw: 100 },
      r50Km: { ne: 60, se: 60, sw: 60, nw: 60 },
      r64Km: { ne: 30, se: 30, sw: 30, nw: 30 },
    },
    trackPoints: [],
    isDemo: false,
    ...overrides,
  };
}

function makeMeta(): FlightRunMeta {
  return {
    spawn: {
      lat: 18,
      lon: 62,
      monthIndex: 5,
      seed: 42,
      isDemo: false,
    },
    environmentId: 'climatology',
    monthIndex: 5,
    seed: 42,
    isDemo: false,
    label: 'cloud-memory accessor fixture',
    counterfactual: false,
  };
}

describe('flight-recorder: cloud-memory tape accessor', () => {
  function makeRecorder(): FlightRecorder {
    const recorder = new FlightRecorder();
    const base = makeStormState({ ageH: 0 });
    recorder.start(makeMeta(), base);
    for (const ageH of [0.25, 0.5, 0.75, 1.0, 1.25, 1.5]) {
      recorder.record(makeStormState({ ageH }), []);
    }
    return recorder;
  }

  it('returns the latest frame at or before the requested age', () => {
    const recorder = makeRecorder();
    expect(recorder.frameAtOrBeforeAge(1.0)?.ageH).toBe(1.0);
    expect(recorder.frameAtOrBeforeAge(1.1)?.ageH).toBe(1.0);
    expect(recorder.frameAtOrBeforeAge(0)?.ageH).toBe(0);
  });

  it('returns null before any frame and before start', () => {
    expect(new FlightRecorder().frameAtOrBeforeAge(5)).toBeNull();
    expect(makeRecorder().frameAtOrBeforeAge(-0.5)).toBeNull();
  });

  it('runKey is stable within a run and changes across starts', () => {
    const recorder = makeRecorder();
    const key = recorder.runKey();
    expect(key).toBe(recorder.runKey());
    recorder.start(makeMeta(), makeStormState({ ageH: 0 }));
    expect(recorder.runKey()).not.toBe(key);
  });

  it('runKey is null before the first start', () => {
    expect(new FlightRecorder().runKey()).toBeNull();
  });
});
