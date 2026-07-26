/**
 * Display contracts for deterministic simulated-rain accumulation windows.
 *
 * Breaks are intentionally fixed, not dynamically stretched to each storm:
 * two shared URLs with the same millimetres must render the same colour.
 */

export type RainAccumulationWindow = '1h' | '3h' | '6h' | '24h' | 'storm';

export interface RainAccumulationDefinition {
  id: RainAccumulationWindow;
  label: string;
  hours: number | null;
  breaksMm: readonly [number, number, number, number, number];
}

export const RAIN_ACCUMULATION_WINDOWS: readonly RainAccumulationDefinition[] = [
  { id: '1h', label: '1 h', hours: 1, breaksMm: [0, 10, 25, 50, 80] },
  { id: '3h', label: '3 h', hours: 3, breaksMm: [0, 20, 50, 100, 150] },
  { id: '6h', label: '6 h', hours: 6, breaksMm: [0, 30, 75, 150, 250] },
  { id: '24h', label: '24 h', hours: 24, breaksMm: [0, 60, 150, 300, 500] },
  { id: 'storm', label: 'storm', hours: null, breaksMm: [0, 100, 250, 500, 750] },
] as const;

export const DEFAULT_RAIN_ACCUMULATION_WINDOW: RainAccumulationWindow = 'storm';

export function isRainAccumulationWindow(
  value: string,
): value is RainAccumulationWindow {
  return RAIN_ACCUMULATION_WINDOWS.some((definition) => definition.id === value);
}

export function rainAccumulationDefinition(
  id: RainAccumulationWindow,
): RainAccumulationDefinition {
  return RAIN_ACCUMULATION_WINDOWS.find((definition) => definition.id === id)!;
}

export function rainAccumulationLegend(
  id: RainAccumulationWindow,
): string {
  const breaks = rainAccumulationDefinition(id).breaksMm;
  return `${breaks.slice(0, -1).join(' · ')} · ${breaks.at(-1)}+`;
}

/** Piecewise-linear normalization onto the equal-interval five-stop shader. */
export function normalizeRainAccumulationMm(
  mm: number,
  breaks: readonly [number, number, number, number, number],
): number {
  if (!Number.isFinite(mm) || mm <= breaks[0]) return 0;
  const last = breaks.length - 1;
  if (mm >= breaks[last]) return 1;
  for (let index = 0; index < last; index++) {
    if (mm <= breaks[index + 1]) {
      const span = breaks[index + 1] - breaks[index];
      const within = span > 0 ? (mm - breaks[index]) / span : 0;
      return (index + within) / last;
    }
  }
  return 1;
}

