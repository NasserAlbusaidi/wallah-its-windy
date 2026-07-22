/**
 * User-facing weather-map layer catalogue and scientific legend contracts.
 *
 * Order is load-bearing: it is the layer rail's top-to-bottom order AND the
 * Digit1..Digit9 keyboard mapping. Wind leads (the Windy-style default view);
 * the terrain instrument closes the list as the plain base chart.
 */

export type WeatherLayerId =
  | 'wind'
  | 'rain'
  | 'infrared'
  | 'accum'
  | 'sst'
  | 'humidity'
  | 'ohc'
  | 'shear'
  | 'terrain';

/** Rendering choices for both the simulated and observed satellite workspace. */
export type SatellitePaletteId = 'enhanced' | 'grayscale' | 'visible';

export interface SatellitePaletteDefinition {
  id: SatellitePaletteId;
  label: string;
  legend: string;
  unit: string;
}

export const SATELLITE_PALETTES: readonly SatellitePaletteDefinition[] = [
  {
    id: 'enhanced',
    label: 'enhanced IR',
    legend: 'warm surface · cold cloud · overshooting top',
    unit: 'brightness-temperature colour enhancement',
  },
  {
    id: 'grayscale',
    label: 'grayscale IR',
    legend: 'warm dark · cold bright',
    unit: 'brightness-temperature grayscale',
  },
  {
    id: 'visible',
    label: 'daytime visible',
    legend: 'surface · thin cloud · deep convection',
    unit: '0.6 μm observed or simulated reflectance style',
  },
] as const;

export const DEFAULT_SATELLITE_PALETTE: SatellitePaletteId = 'enhanced';

export function satellitePaletteDefinition(
  id: SatellitePaletteId,
): SatellitePaletteDefinition {
  return SATELLITE_PALETTES.find((palette) => palette.id === id)!;
}

export interface WeatherLayerDefinition {
  id: WeatherLayerId;
  label: string;
  shortLabel: string;
  legend: string;
  unit: string;
  simulated: boolean;
}

export const WEATHER_LAYERS: readonly WeatherLayerDefinition[] = [
  {
    id: 'wind',
    label: 'wind flow',
    shortLabel: 'wind',
    legend: '0 · 12 · 25 · 38 · 50+',
    unit: 'm/s · steering + storm vortex',
    simulated: true,
  },
  {
    id: 'rain',
    label: 'simulated rain radar',
    shortLabel: 'radar',
    legend: 'light · moderate · heavy · extreme',
    unit: 'reflectivity-style rain-rate proxy',
    simulated: true,
  },
  {
    id: 'infrared',
    label: 'simulated satellite infrared',
    shortLabel: 'satellite IR',
    legend: 'warm surface · cold cloud · overshooting top',
    unit: 'simulated brightness temperature · °C',
    simulated: true,
  },
  {
    id: 'accum',
    label: 'storm-total rainfall',
    shortLabel: 'rain accum',
    // Ticks sit at the shader's equal-interval color stops (linear 0-300 mm).
    legend: '0 · 75 · 150 · 225 · 300+',
    unit: 'mm · parametric storm-total proxy',
    simulated: true,
  },
  {
    id: 'sst',
    label: 'sea-surface temperature',
    shortLabel: 'sea temp',
    legend: '24 · 26 · 28 · 30 · 32',
    unit: '°C',
    simulated: false,
  },
  {
    id: 'humidity',
    label: 'mid-level humidity',
    shortLabel: 'humidity',
    legend: '20 · 40 · 60 · 80 · 100',
    unit: '% RH at 600/700 hPa',
    simulated: false,
  },
  {
    id: 'ohc',
    label: 'ocean heat content',
    shortLabel: 'ocean heat',
    legend: '0 · 30 · 60 · 90 · 120+',
    unit: 'kJ/cm² above 26 °C',
    simulated: false,
  },
  {
    id: 'shear',
    label: 'deep-layer wind shear',
    shortLabel: 'shear',
    legend: '0 · 10 · 20 · 30 · 40+',
    unit: 'm/s · 200–850 hPa',
    simulated: false,
  },
  {
    id: 'terrain',
    label: 'terrain instrument',
    shortLabel: 'terrain',
    legend: 'bathymetry · topography · storm structure',
    unit: 'bathymetry · topography',
    simulated: false,
  },
] as const;

/** The layer shown at boot — the Windy-style animated wind map. */
export const DEFAULT_WEATHER_LAYER: WeatherLayerId = 'wind';

const IDS = new Set<WeatherLayerId>(
  WEATHER_LAYERS.map((layer) => layer.id),
);

export function isWeatherLayerId(value: string): value is WeatherLayerId {
  return IDS.has(value as WeatherLayerId);
}

export function weatherLayerDefinition(
  id: WeatherLayerId,
): WeatherLayerDefinition {
  return WEATHER_LAYERS.find((layer) => layer.id === id)!;
}
