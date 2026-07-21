import { describe, expect, it } from 'vitest';
import {
  buildIntensitySparkline,
  nearestIntensityIndex,
} from '../src/intensity-sparkline';

describe('intensity sparkline geometry', () => {
  const series = [
    { ageH: 0, vKt: 30 },
    { ageH: 6, vKt: 70 },
    { ageH: 18, vKt: 110 },
    { ageH: 24, vKt: 80 },
  ];

  it('maps every immutable tape point and finds the exact peak', () => {
    const geometry = buildIntensitySparkline(series);
    expect(geometry.points).toHaveLength(series.length);
    expect(geometry.peakIndex).toBe(2);
    expect(geometry.points[0].x).toBe(0);
    expect(geometry.points.at(-1)?.x).toBe(100);
    expect(geometry.path).toContain('L75.00,10.00');
  });

  it('uses age, not array index, on the horizontal axis', () => {
    const geometry = buildIntensitySparkline(series);
    expect(geometry.points[1].x).toBe(25);
    expect(geometry.points[2].x).toBe(75);
  });

  it('selects the nearest exact recorded value for pointer/keyboard inspection', () => {
    expect(nearestIntensityIndex(series, 0)).toBe(0);
    expect(nearestIntensityIndex(series, 0.7)).toBe(2);
    expect(nearestIntensityIndex(series, 1)).toBe(3);
  });
});
