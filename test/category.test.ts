import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  categoryRgba,
  INTENSITY_SCALE_MAX_KT,
  intensityFraction,
  stormCategory,
} from '../src/category';

describe('Saffir–Simpson classification', () => {
  // Table-driven: the exact SSHS boundaries in knots. Off-by-one here would
  // mislabel every chip, track segment, and impact phrase at once.
  const CASES: Array<[number, string]> = [
    [0, 'td'],
    [33.9, 'td'],
    [34, 'ts'],
    [63.9, 'ts'],
    [64, 'c1'],
    [82.9, 'c1'],
    [83, 'c2'],
    [95.9, 'c2'],
    [96, 'c3'],
    [112.9, 'c3'],
    [113, 'c4'],
    [136.9, 'c4'],
    [137, 'c5'],
    [200, 'c5'],
  ];
  it.each(CASES)('%s kt classifies as %s', (vKt, id) => {
    expect(stormCategory(vKt).id).toBe(id);
  });

  it('is defensive about junk winds (non-finite classifies as TD)', () => {
    expect(stormCategory(Number.NaN).id).toBe('td');
    expect(stormCategory(-5).id).toBe('td');
    expect(stormCategory(Infinity).id).toBe('td');
  });

  it('orders categories weakest to strongest with unique ids', () => {
    const thresholds = CATEGORIES.map((category) => category.minKt);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
    expect(new Set(CATEGORIES.map((category) => category.id)).size).toBe(
      CATEGORIES.length,
    );
  });

  it('maps winds onto the clamped intensity axis', () => {
    expect(intensityFraction(0)).toBe(0);
    expect(intensityFraction(INTENSITY_SCALE_MAX_KT / 2)).toBeCloseTo(0.5);
    expect(intensityFraction(INTENSITY_SCALE_MAX_KT * 3)).toBe(1);
    expect(intensityFraction(Number.NaN)).toBe(0);
  });

  it('emits css-ready rgba strings from the token palette', () => {
    expect(categoryRgba(140, 0.5)).toMatch(
      /^rgba\(\d{1,3},\d{1,3},\d{1,3},0\.5\)$/,
    );
  });
});
