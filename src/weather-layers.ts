/**
 * User-facing weather-map layer catalogue and scientific legend contracts.
 *
 * Order is load-bearing: it is the layer rail's top-to-bottom order AND the
 * Digit1..Digit0 keyboard mapping. Wind leads (the Windy-style default view);
 * the terrain instrument closes the list as the plain base chart.
 */

import { radarLegendText } from './radar-reflectivity';

export type WeatherLayerId =
  | 'wind'
  | 'rain'
  | 'infrared'
  | 'accum'
  | 'sst'
  | 'humidity'
  | 'ohc'
  | 'shear'
  | 'upper'
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
  iconSvg: string;
  legend: string;
  unit: string;
  simulated: boolean;
}

function railIcon(body: string): string {
  return (
    '<svg viewBox="0 0 16 16" stroke="currentColor" fill="none" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true">${body}</svg>`
  );
}

export const WEATHER_LAYERS: readonly WeatherLayerDefinition[] = [
  {
    id: 'wind',
    label: 'wind flow',
    shortLabel: 'wind',
    iconSvg: railIcon(
      '<path d="M1.5 5.5h8a2 2 0 1 0-2-2.5"/><path d="M1.5 8.5h11a2 2 0 1 1-2 2.5"/><path d="M1.5 11.5h5"/>',
    ),
    legend: '0 · 12 · 25 · 38 · 50+',
    unit: 'm/s · steering + storm vortex',
    simulated: true,
  },
  {
    id: 'rain',
    label: 'simulated rain radar',
    shortLabel: 'radar',
    iconSvg: railIcon(
      '<path d="M2 13a7 7 0 0 1 12-5"/><path d="M5 13a4.5 4.5 0 0 1 7.5-3.4"/><circle cx="8.6" cy="10.6" r="1.1"/>',
    ),
    legend: radarLegendText(),
    unit: 'Marshall–Palmer reflectivity proxy · simulated',
    simulated: true,
  },
  {
    id: 'infrared',
    label: 'simulated satellite infrared',
    shortLabel: 'satellite IR',
    iconSvg: railIcon(
      '<rect x="5" y="5" width="6" height="6" rx="1"/><path d="M1.5 6.5 5 8m6 0 3.5-1.5M8 11v3"/>',
    ),
    legend: 'warm surface · cold cloud · overshooting top',
    unit: 'simulated brightness temperature · °C',
    simulated: true,
  },
  {
    id: 'accum',
    label: 'rain accumulation',
    shortLabel: 'rain accum',
    iconSvg: railIcon(
      '<path d="M8 2.5s-4 4.4-4 7a4 4 0 0 0 8 0c0-2.6-4-7-4-7Z"/>',
    ),
    legend: '0 · 100 · 250 · 500 · 750+',
    unit: 'mm · deterministic simulated-rain ledger',
    simulated: true,
  },
  {
    id: 'sst',
    label: 'sea-surface temperature',
    shortLabel: 'sea temp',
    iconSvg: railIcon(
      '<path d="M7 2.5v7a2.5 2.5 0 1 0 2 0v-7a1 1 0 0 0-2 0Z"/>',
    ),
    legend: '24 · 26 · 28 · 30 · 32',
    unit: '°C',
    simulated: false,
  },
  {
    id: 'humidity',
    label: 'mid-level humidity',
    shortLabel: 'humidity',
    iconSvg: railIcon(
      '<path d="M4.5 3.5c2-2 5-2 7 0s2 5 0 7l-3.5 3-3.5-3c-2-2-2-5 0-7Z"/><path d="M6.5 8h3"/>',
    ),
    legend: '20 · 40 · 60 · 80 · 100',
    unit: '% RH at 600/700 hPa',
    simulated: false,
  },
  {
    id: 'ohc',
    label: 'ocean heat content',
    shortLabel: 'ocean heat',
    iconSvg: railIcon(
      '<path d="M1.5 5c2-2 3.5 2 5.5 0s3.5 2 5.5 0"/><path d="M1.5 9c2-2 3.5 2 5.5 0s3.5 2 5.5 0"/><path d="M1.5 13c2-2 3.5 2 5.5 0s3.5 2 5.5 0"/>',
    ),
    legend: '0 · 30 · 60 · 90 · 120+',
    unit: 'kJ/cm² above 26 °C',
    simulated: false,
  },
  {
    id: 'shear',
    label: 'deep-layer wind shear · vector ventilation diagnostic only',
    shortLabel: 'shear',
    iconSvg: railIcon(
      '<path d="M2 5h9m0 0-2.5-2.5M11 5 8.5 7.5"/><path d="M14 11H5m0 0 2.5-2.5M5 11l2.5 2.5"/>',
    ),
    legend: '0 · 10 · 20 · 30 · 40+',
    unit: 'm/s · 200–850 hPa',
    simulated: false,
  },
  {
    id: 'upper',
    label: '200-hPa upper winds · ERA5 climatology sample',
    shortLabel: 'upper winds',
    iconSvg: railIcon(
      '<path d="M1.5 4.5h9a2 2 0 1 0-2-2.5"/><path d="M1.5 8h12"/><path d="M1.5 11.5h7a2 2 0 1 1-2 2"/>',
    ),
    legend: '0 · 12 · 25 · 38 · 50+',
    unit: 'm/s · 200 hPa · ERA5',
    simulated: false,
  },
  {
    id: 'terrain',
    label: 'terrain instrument',
    shortLabel: 'terrain',
    iconSvg: railIcon(
      '<path d="m1.5 13 4.5-8 3 5 2-3 3.5 6Z"/>',
    ),
    legend: 'bathymetry · 500 m contours · topography',
    unit: 'GMRT regional relief · metres',
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

/** Digit1→0 … Digit9→8, Digit0→9 for the ten-entry catalogue. */
export function layerIndexForDigitCode(code: string): number | null {
  if (!/^Digit[0-9]$/.test(code)) return null;
  const digit = Number(code.slice(-1));
  return (digit + 9) % 10;
}

/** Keyboard badge for a catalogue index; the tenth layer is reached by 0. */
export function digitHintForLayerIndex(index: number): string {
  return String((index + 1) % 10);
}

export function weatherLayerDefinition(
  id: WeatherLayerId,
): WeatherLayerDefinition {
  return WEATHER_LAYERS.find((layer) => layer.id === id)!;
}
