import { describe, it, expect } from 'vitest';
import { mulberry32, makeRng, readHash, encodeHash } from '../src/rng';
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
