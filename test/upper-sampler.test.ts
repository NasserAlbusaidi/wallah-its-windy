import { describe, expect, it } from 'vitest';
import { makeEnvSampler } from '../src/env-sampler';
import { parseBin } from '../src/loader';
import { sampleUpperWind } from '../src/upper-sampler';
import { buildWiwbBin } from './helpers/wiwb';

const BBOX = { lonMin: 50, lonMax: 52, latMin: 10, latMax: 12 };

function upperBin(
  uName = 'u200_04',
  vName = 'v200_04',
  u = new Float32Array([
    0, 10,
    20, 30,
    100, 110,
    120, 130,
  ]),
  v = new Float32Array([
    0, 20,
    40, 60,
    200, 220,
    240, 260,
  ]),
) {
  return parseBin(buildWiwbBin([
    { name: uName, nx: 2, ny: 2, nt: 2, bbox: BBOX, data: u },
    { name: vName, nx: 2, ny: 2, nt: 2, bbox: BBOX, data: v },
  ]));
}

describe('sampleUpperWind', () => {
  it('clamps off-season months to the committed 04..10 layer suffixes', () => {
    const lower = upperBin();
    const upper = upperBin('u200_10', 'v200_10');
    expect(sampleUpperWind(
      lower,
      12,
      50,
      3,
      { kind: 'synoptic-plane', plane: 0 },
    )).not.toBeNull();
    expect(sampleUpperWind(
      upper,
      12,
      50,
      11,
      { kind: 'synoptic-plane', plane: 0 },
    )).not.toBeNull();
  });

  it('selects the supplied synoptic plane and bilinearly samples both components', () => {
    const bin = upperBin();
    const first = sampleUpperWind(
      bin,
      11,
      51,
      4,
      { kind: 'synoptic-plane', plane: 0 },
    );
    const second = sampleUpperWind(
      bin,
      11,
      51,
      4,
      { kind: 'synoptic-plane', plane: 1 },
    );
    expect(first).toMatchObject({ uMs: 15, vMs: 30 });
    expect(second).toMatchObject({ uMs: 115, vMs: 230 });
  });

  it('returns null when either component is missing', () => {
    const bin = upperBin();
    bin.layers.delete('v200_04');
    expect(sampleUpperWind(
      bin,
      11,
      51,
      4,
      { kind: 'synoptic-plane', plane: 0 },
    )).toBeNull();
  });

  it('returns null in event-timeline mode instead of mixing climatology vintages', () => {
    expect(sampleUpperWind(
      upperBin(),
      11,
      51,
      4,
      { kind: 'event-timeline' },
    )).toBeNull();
  });

  it('reports speed and meteorological direction-from math', () => {
    const bin = upperBin(
      'u200_04',
      'v200_04',
      new Float32Array(8).fill(3),
      new Float32Array(8).fill(4),
    );
    const sample = sampleUpperWind(
      bin,
      11,
      51,
      4,
      { kind: 'synoptic-plane', plane: 0 },
    )!;
    expect(sample.speedMs).toBe(5);
    expect(sample.dirDeg).toBeCloseTo(216.86989764584402, 10);
  });

  it('throws loudly when a sampled output is non-finite', () => {
    const bad = upperBin(
      'u200_04',
      'v200_04',
      new Float32Array(8).fill(Number.NaN),
      new Float32Array(8).fill(1),
    );
    expect(() => sampleUpperWind(
      bad,
      11,
      51,
      4,
      { kind: 'synoptic-plane', plane: 0 },
    )).toThrow(/finite/i);
  });

  it('uses the env sampler active mode object as the plane-coherence source', () => {
    const bin = upperBin();
    const envSampler = makeEnvSampler(() => null);
    envSampler.setSamplingMode({ kind: 'synoptic-plane', plane: 1 });
    const activeMode = envSampler.getSamplingMode();
    expect(sampleUpperWind(bin, 11, 51, 4, activeMode)).toMatchObject({
      uMs: 115,
      vMs: 230,
    });
    expect(activeMode).toBe(envSampler.getSamplingMode());
  });
});
