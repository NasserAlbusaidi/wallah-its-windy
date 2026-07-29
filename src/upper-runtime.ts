/** Pure product-state boundary for upper-wind resource and layer availability. */

import {
  DEFAULT_WEATHER_LAYER,
  type WeatherLayerId,
} from './weather-layers';

export interface UpperWindModeState<T> {
  activeLayer: WeatherLayerId;
  upper: T | null;
  disabled: boolean;
  caption: string | null;
  degraded: boolean;
}

/**
 * Resolve both defenses at the climatology/event boundary: event mode receives no
 * upper resource and cannot keep the upper layer active; a missing sidecar is a
 * visible degradation, whereas the designed event absence is not.
 */
export function resolveUpperWindMode<T>(
  activeLayer: WeatherLayerId,
  upper: T | null,
  eventMode: boolean,
): UpperWindModeState<T> {
  const disabled = eventMode || upper === null;
  return {
    activeLayer:
      disabled && activeLayer === 'upper'
        ? DEFAULT_WEATHER_LAYER
        : activeLayer,
    upper: eventMode ? null : upper,
    disabled,
    caption: eventMode
      ? 'no aligned upper-level analysis for this event'
      : upper === null
        ? 'upper-wind data unavailable'
        : null,
    degraded: !eventMode && upper === null,
  };
}
