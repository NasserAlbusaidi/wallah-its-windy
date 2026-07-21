/**
 * category.ts — Saffir–Simpson classification of a sustained wind, in one place.
 *
 * The chip in the storm panel, the intensity bar, and the category-coloured
 * track all read this table, so a threshold retune moves every surface at once.
 * SSHS (not the IMD scale) is deliberate: the app already speaks
 * "hurricane"/"major" in the ensemble copy, and Cat 1–5 is the vocabulary most
 * visitors know. Winds are 1-minute sustained knots, matching StormState.vKt.
 */

import { TOKENS } from './tokens';
import type { Token } from './tokens';

export interface StormCategory {
  /** Stable id, also used as a data-attribute for CSS: td, ts, c1..c5. */
  id: 'td' | 'ts' | 'c1' | 'c2' | 'c3' | 'c4' | 'c5';
  /** Compact chip text, e.g. "TD", "TS", "CAT 3". */
  chip: string;
  /** Spoken name, e.g. "tropical storm", "category 3 cyclone". */
  name: string;
  /** Inclusive lower bound of the class, knots. */
  minKt: number;
  /** The shared palette token for this class. */
  token: Token;
}

/** Ordered weakest -> strongest; thresholds are the standard SSHS bounds. */
export const CATEGORIES: readonly StormCategory[] = [
  { id: 'td', chip: 'TD', name: 'tropical depression', minKt: 0, token: TOKENS.catTd },
  { id: 'ts', chip: 'TS', name: 'tropical storm', minKt: 34, token: TOKENS.catTs },
  { id: 'c1', chip: 'CAT 1', name: 'category 1 cyclone', minKt: 64, token: TOKENS.cat1 },
  { id: 'c2', chip: 'CAT 2', name: 'category 2 cyclone', minKt: 83, token: TOKENS.cat2 },
  { id: 'c3', chip: 'CAT 3', name: 'category 3 cyclone', minKt: 96, token: TOKENS.cat3 },
  { id: 'c4', chip: 'CAT 4', name: 'category 4 cyclone', minKt: 113, token: TOKENS.cat4 },
  { id: 'c5', chip: 'CAT 5', name: 'category 5 cyclone', minKt: 137, token: TOKENS.cat5 },
] as const;

/** Top of the intensity bar's wind axis, knots (a Cat-5 still fits inside). */
export const INTENSITY_SCALE_MAX_KT = 160;

/** Classify a sustained wind. Non-finite/negative winds classify as TD. */
export function stormCategory(vKt: number): StormCategory {
  const wind = Number.isFinite(vKt) ? vKt : 0;
  let match = CATEGORIES[0];
  for (const category of CATEGORIES) {
    if (wind >= category.minKt) match = category;
  }
  return match;
}

/** `rgba(...)` for the class of `vKt` at alpha `a` — track segment colouring. */
export function categoryRgba(vKt: number, a: number): string {
  const [r, g, b] = stormCategory(vKt).token.rgba01;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/** Position of a wind on the intensity bar, clamped fraction of the axis. */
export function intensityFraction(vKt: number): number {
  if (!Number.isFinite(vKt) || vKt <= 0) return 0;
  return Math.min(1, vKt / INTENSITY_SCALE_MAX_KT);
}
