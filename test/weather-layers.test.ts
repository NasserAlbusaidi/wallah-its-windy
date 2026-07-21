import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEATHER_LAYER,
  isWeatherLayerId,
  WEATHER_LAYERS,
  weatherLayerDefinition,
} from '../src/weather-layers';

describe('weather layer catalogue', () => {
  it('ships nine unique operational views with honest provenance labels', () => {
    expect(WEATHER_LAYERS).toHaveLength(9);
    expect(new Set(WEATHER_LAYERS.map(({ id }) => id)).size).toBe(9);
    expect(weatherLayerDefinition('infrared').simulated).toBe(true);
    expect(weatherLayerDefinition('rain').simulated).toBe(true);
    // The wind view mixes real steering with the parametric vortex, and the
    // storm-total rainfall view is a pure model product — both must carry the
    // simulated flag so no one mistakes them for observations.
    expect(weatherLayerDefinition('wind').simulated).toBe(true);
    expect(weatherLayerDefinition('accum').simulated).toBe(true);
    for (const layer of WEATHER_LAYERS) {
      expect(layer.label.length).toBeGreaterThan(3);
      expect(layer.legend.length).toBeGreaterThan(3);
    }
  });

  it('opens on the wind view and keys 1-9 stay in catalogue order', () => {
    expect(DEFAULT_WEATHER_LAYER).toBe('wind');
    expect(WEATHER_LAYERS[0].id).toBe('wind');
    expect(WEATHER_LAYERS[WEATHER_LAYERS.length - 1].id).toBe('terrain');
  });

  it('validates only catalogue ids', () => {
    for (const layer of WEATHER_LAYERS) {
      expect(isWeatherLayerId(layer.id)).toBe(true);
    }
    expect(isWeatherLayerId('satellite-observation')).toBe(false);
    expect(isWeatherLayerId('')).toBe(false);
  });
});
