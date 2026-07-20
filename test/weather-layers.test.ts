import { describe, expect, it } from 'vitest';
import {
  isWeatherLayerId,
  WEATHER_LAYERS,
  weatherLayerDefinition,
} from '../src/weather-layers';

describe('weather layer catalogue', () => {
  it('ships seven unique operational views with honest provenance labels', () => {
    expect(WEATHER_LAYERS).toHaveLength(7);
    expect(new Set(WEATHER_LAYERS.map(({ id }) => id)).size).toBe(7);
    expect(weatherLayerDefinition('infrared').simulated).toBe(true);
    expect(weatherLayerDefinition('rain').simulated).toBe(true);
    for (const layer of WEATHER_LAYERS) {
      expect(layer.label.length).toBeGreaterThan(3);
      expect(layer.legend.length).toBeGreaterThan(3);
    }
  });

  it('validates only catalogue ids', () => {
    for (const layer of WEATHER_LAYERS) {
      expect(isWeatherLayerId(layer.id)).toBe(true);
    }
    expect(isWeatherLayerId('satellite-observation')).toBe(false);
    expect(isWeatherLayerId('')).toBe(false);
  });
});
