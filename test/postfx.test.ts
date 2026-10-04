import { describe, expect, it } from 'vitest';
import { POSTFX_LOOK } from '../src/render/postfx';
import { WEATHER_LAYERS } from '../src/weather-layers';

describe('post-effects look', () => {
  it('covers every weather layer', () => {
    for (const layer of WEATHER_LAYERS) {
      expect(POSTFX_LOOK[layer.id]).toBeDefined();
    }
  });

  it('never glows or darkens a product whose colour is its value', () => {
    for (const id of ['sst', 'humidity', 'ohc', 'shear', 'accum'] as const) {
      expect(POSTFX_LOOK[id]).toEqual({ bloom: 0, vignette: 0 });
    }
  });

  it('vignettes only the legend-free terrain instrument', () => {
    for (const layer of WEATHER_LAYERS) {
      if (layer.id === 'terrain') continue;
      expect(POSTFX_LOOK[layer.id].vignette).toBe(0);
    }
  });

  it('keeps every look inside a sane range', () => {
    for (const look of Object.values(POSTFX_LOOK)) {
      expect(look.bloom).toBeGreaterThanOrEqual(0);
      expect(look.bloom).toBeLessThanOrEqual(1);
      expect(look.vignette).toBeGreaterThanOrEqual(0);
      expect(look.vignette).toBeLessThan(0.5);
    }
  });
});
