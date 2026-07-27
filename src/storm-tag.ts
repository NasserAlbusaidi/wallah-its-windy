/**
 * storm-tag.ts — pure copy for the map chip pinned to the simulated eye.
 *
 * Regional vocabulary comes from the North Indian Ocean table. The asterisk
 * remains important: simulator wind is one-minute sustained, so the RSMC
 * three-minute band is indicative and no conversion is implied.
 */
import {
  SIMULATED_WIND_CONVENTION,
  northIndianOceanClassification,
  regionalCategoryChip,
} from './wind-conventions';

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
  const category = regionalCategoryChip(
    northIndianOceanClassification(
      input.vKt,
      SIMULATED_WIND_CONVENTION.averagingMinutes,
    ),
  ).toLowerCase();
  const trend =
    input.trendKtPerH >= 0.5
      ? 'intensifying'
      : input.trendKtPerH <= -0.5
        ? 'weakening'
        : 'steady';

  return {
    line1:
      `${input.label.trim().toUpperCase()} · ${Math.round(input.vKt)} kt 1-min`,
    line2: `${category} · ${trend} · ${Math.round(input.hPa)} hPa`,
  };
}
