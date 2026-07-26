import { describe, expect, it } from 'vitest';
import {
  isRainAccumulationWindow,
  normalizeRainAccumulationMm,
  rainAccumulationDefinition,
  rainAccumulationLegend,
} from '../src/rain-accumulation';

describe('rain accumulation display contract', () => {
  it('ships fixed windows and honest millimetre legends', () => {
    expect(rainAccumulationDefinition('1h').hours).toBe(1);
    expect(rainAccumulationDefinition('24h').breaksMm).toEqual([
      0, 60, 150, 300, 500,
    ]);
    expect(rainAccumulationDefinition('storm').hours).toBeNull();
    expect(rainAccumulationLegend('3h')).toBe('0 · 20 · 50 · 100 · 150+');
  });

  it('validates only known ledger windows', () => {
    for (const value of ['1h', '3h', '6h', '24h', 'storm']) {
      expect(isRainAccumulationWindow(value)).toBe(true);
    }
    expect(isRainAccumulationWindow('48h')).toBe(false);
  });

  it('maps physical breaks onto equal palette stops without dynamic stretching', () => {
    const breaks = rainAccumulationDefinition('1h').breaksMm;
    expect(normalizeRainAccumulationMm(0, breaks)).toBe(0);
    expect(normalizeRainAccumulationMm(10, breaks)).toBe(0.25);
    expect(normalizeRainAccumulationMm(37.5, breaks)).toBe(0.625);
    expect(normalizeRainAccumulationMm(80, breaks)).toBe(1);
    expect(normalizeRainAccumulationMm(800, breaks)).toBe(1);
  });
});
