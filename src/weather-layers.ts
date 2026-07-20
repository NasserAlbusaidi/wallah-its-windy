/** User-facing weather-map layer catalogue and scientific legend contracts. */

export type WeatherLayerId =
  | 'terrain'
  | 'infrared'
  | 'sst'
  | 'humidity'
  | 'ohc'
  | 'shear'
  | 'rain';

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
    id: 'terrain',
    label: 'terrain instrument',
    shortLabel: 'terrain',
    legend: 'bathymetry · topography · storm structure',
    unit: '',
    simulated: false,
  },
  {
    id: 'infrared',
    label: 'simulated infrared',
    shortLabel: 'infrared',
    legend: 'warm surface → cold convective cloud tops',
    unit: '°C brightness temperature proxy',
    simulated: true,
  },
  {
    id: 'sst',
    label: 'sea-surface temperature',
    shortLabel: 'sst',
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
    id: 'rain',
    label: 'simulated rain radar',
    shortLabel: 'rain radar',
    legend: 'light · moderate · heavy · extreme',
    unit: 'reflectivity-style rain-rate proxy',
    simulated: true,
  },
] as const;

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
