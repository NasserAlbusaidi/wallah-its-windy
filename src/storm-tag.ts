/**
 * storm-tag.ts — pure copy for the map chip pinned to the simulated eye.
 *
 * Category vocabulary comes from the shared SSHS table; this module only
 * formats the two compact lines and classifies the instantaneous wind trend.
 */
import { stormCategory } from './category';

export interface StormTagInput {
  label: string;
  vKt: number;
  hPa: number;
  trendKtPerH: number;
}

export interface StormTagCopy {
  line1: string;
  line2: string;
}

export function formatStormTag(input: StormTagInput): StormTagCopy {
  const category = stormCategory(input.vKt).chip.toLowerCase();
  const trend =
    input.trendKtPerH >= 0.5
      ? 'intensifying'
      : input.trendKtPerH <= -0.5
        ? 'weakening'
        : 'steady';

  return {
    line1: `${input.label.trim().toUpperCase()} · ${Math.round(input.vKt)} kt`,
    line2: `${category} · ${trend} · ${Math.round(input.hPa)} hPa`,
  };
}
