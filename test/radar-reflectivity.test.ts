import { describe, expect, it } from 'vitest';
import {
  normalizeRadarDbz,
  quantizeRadarDbz,
  quantizeRadarNormalized,
  radarBandCoverage,
  radarCssGradient,
  radarLegendText,
  rainRateToDbz,
} from '../src/radar-reflectivity';

describe('simulated radar reflectivity presentation', () => {
  it('uses the declared Marshall–Palmer rain-rate proxy', () => {
    expect(rainRateToDbz(0)).toBe(0);
    expect(rainRateToDbz(1)).toBeCloseTo(23.0103, 4);
    expect(rainRateToDbz(10)).toBeCloseTo(39.0103, 4);
    expect(rainRateToDbz(50)).toBeCloseTo(50.1938, 4);
  });

  it('normalizes and quantizes bounded presentation values', () => {
    expect(normalizeRadarDbz(10)).toBe(0);
    expect(normalizeRadarDbz(65)).toBe(1);
    expect(normalizeRadarDbz(37.5)).toBe(0.5);
    expect(quantizeRadarNormalized(-1)).toBe(0);
    expect(quantizeRadarNormalized(0.5)).toBeCloseTo(6 / 11, 12);
    expect(quantizeRadarNormalized(2)).toBe(1);
    expect(quantizeRadarDbz(37.4)).toBe(35);
    expect(quantizeRadarDbz(37.6)).toBe(40);
  });

  it('derives the text and CSS ramp from one physical stop table', () => {
    expect(radarLegendText()).toBe('10 · 20 · 30 · 40 · 50 · 65+ dBZ proxy');
    expect(radarCssGradient()).toContain('var(--radar-1) 18.182%');
    expect(radarCssGradient()).toContain('var(--radar-5) 100.000%');
  });

  it('breaks low-level bands into sub-grid echoes without hiding strong cores', () => {
    expect(radarBandCoverage(0.4, 0.2, 0.2, 0.8, 22)).toBeCloseTo(0.06, 12);
    expect(radarBandCoverage(1, 1, 0.8, 1, 30)).toBeCloseTo(1, 12);
    expect(radarBandCoverage(0.4, 0.2, 0.2, 0.8, 48)).toBeGreaterThanOrEqual(0.72);
  });

  it('keeps radar coverage bounded across extreme inputs', () => {
    expect(radarBandCoverage(-10, -10, -10, -10, -10)).toBeGreaterThanOrEqual(0);
    expect(radarBandCoverage(10, 10, 10, 10, 100)).toBeLessThanOrEqual(1);
  });
});
