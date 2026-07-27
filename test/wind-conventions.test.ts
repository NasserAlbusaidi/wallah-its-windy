import { describe, expect, it } from 'vitest';
import {
  NORTH_INDIAN_OCEAN_CATEGORIES,
  SIMULATED_WIND_CONVENTION,
  northIndianOceanClassification,
  regionalCategoryChip,
  windConventionLabel,
} from '../src/wind-conventions';

describe('North Indian Ocean wind classification', () => {
  const cases: Array<[number, string]> = [
    [0, 'l'],
    [16.9, 'l'],
    [17, 'd'],
    [27.9, 'd'],
    [28, 'dd'],
    [33.9, 'dd'],
    [34, 'cs'],
    [47.9, 'cs'],
    [48, 'scs'],
    [63.9, 'scs'],
    [64, 'vscs'],
    [89.9, 'vscs'],
    [90, 'escs'],
    [119.9, 'escs'],
    [120, 'sucs'],
  ];

  it.each(cases)('%s kt classifies as %s', (windKt, id) => {
    expect(northIndianOceanClassification(windKt, 3).category.id).toBe(id);
  });

  it('marks only native three-minute values as regionally compatible', () => {
    const native = northIndianOceanClassification(90, 3);
    const simulated = northIndianOceanClassification(90, 1);

    expect(native.compatible).toBe(true);
    expect(regionalCategoryChip(native)).toBe('ESCS');
    expect(simulated.compatible).toBe(false);
    expect(regionalCategoryChip(simulated)).toBe('ESCS*');
    expect(simulated.windKt).toBe(90);
  });

  it('keeps the regional table ordered and unique', () => {
    const thresholds = NORTH_INDIAN_OCEAN_CATEGORIES.map(({ minKt }) => minKt);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
    expect(new Set(NORTH_INDIAN_OCEAN_CATEGORIES.map(({ id }) => id)).size)
      .toBe(NORTH_INDIAN_OCEAN_CATEGORIES.length);
  });

  it('publishes the simulator convention without implying a conversion', () => {
    expect(windConventionLabel(SIMULATED_WIND_CONVENTION)).toBe(
      '1-min sustained · 10 m · sea · no period/gust conversion',
    );
    expect(SIMULATED_WIND_CONVENTION.conversion.applied).toBe(false);
  });
});
