import { describe, it, expect } from 'vitest';
import { mulberry32, makeRng, readHash, encodeHash, isEnvHashKey } from '../src/rng';
import type { HashState } from '../src/rng';

describe('rng: mulberry32 is deterministic (sim = f(spawn,month,seed))', () => {
  it('same seed yields the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });

  it('stays in [0,1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('makeRng.range and .int respect bounds', () => {
    const r = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const f = r.range(5, 9);
      expect(f).toBeGreaterThanOrEqual(5);
      expect(f).toBeLessThan(9);
      const n = r.int(1, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

describe('rng: URL hash round-trips a shareable storm', () => {
  it('encode then read is identity (within lat/lon precision)', () => {
    const state: HashState = { lat: 18.234, lon: 63.512, monthIndex: 5, seed: 4242 };
    const back = readHash('#' + encodeHash(state));
    expect(back).not.toBeNull();
    expect(back!.monthIndex).toBe(5);
    expect(back!.seed).toBe(4242);
    expect(back!.lat).toBeCloseTo(18.234, 3);
    expect(back!.lon).toBeCloseTo(63.512, 3);
  });

  it('returns null for an empty or malformed hash', () => {
    expect(readHash('')).toBeNull();
    expect(readHash('#')).toBeNull();
    expect(readHash('#lat=1&lon=2')).toBeNull(); // missing month + seed
  });
});

describe('rng: optional scenario env key (C8) is backward compatible', () => {
  const LEGACY = 'lat=18.234&lon=63.512&month=5&seed=4242';

  it('a climatology storm serialises to the EXACT legacy string (byte-identical)', () => {
    const state: HashState = { lat: 18.234, lon: 63.512, monthIndex: 5, seed: 4242 };
    expect(encodeHash(state)).toBe(LEGACY);
    expect(encodeHash(state)).not.toContain('env');
  });

  it('a legacy URL (no env) reads back as climatology (env undefined)', () => {
    const back = readHash('#' + LEGACY);
    expect(back).not.toBeNull();
    expect(back!.env).toBeUndefined();
  });

  it('appends env ONLY for a known key, always last', () => {
    const enc = encodeHash({ lat: 16.2, lon: 63.4, monthIndex: 5, seed: 2007, env: 'gonu' });
    expect(enc).toBe('lat=16.200&lon=63.400&month=5&seed=2007&env=gonu');
  });

  it('round-trips a scenario env key', () => {
    const state: HashState = { lat: 16.2, lon: 63.4, monthIndex: 5, seed: 2007, env: 'shaheen' };
    const back = readHash('#' + encodeHash(state));
    expect(back).not.toBeNull();
    expect(back!.env).toBe('shaheen');
    expect(back!.seed).toBe(2007);
  });

  it('ignores an unknown/garbage env value (validated against the known set)', () => {
    expect(readHash('#' + LEGACY + '&env=bogus')!.env).toBeUndefined();
    expect(readHash('#' + LEGACY + '&env=')!.env).toBeUndefined();
    // A garbage env in state is dropped on encode, keeping the string legacy-shaped.
    const enc = encodeHash({ lat: 18.234, lon: 63.512, monthIndex: 5, seed: 4242, env: 'nope' as never });
    expect(enc).toBe(LEGACY);
  });

  it('isEnvHashKey validates the known set', () => {
    expect(isEnvHashKey('gonu')).toBe(true);
    expect(isEnvHashKey('shaheen')).toBe(true);
    expect(isEnvHashKey('climatology')).toBe(false);
    expect(isEnvHashKey('')).toBe(false);
    expect(isEnvHashKey(null)).toBe(false);
    expect(isEnvHashKey(undefined)).toBe(false);
  });
});
