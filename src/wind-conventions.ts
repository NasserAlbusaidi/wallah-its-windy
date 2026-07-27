/**
 * Wind conventions and North Indian Ocean cyclone terminology.
 *
 * The simulator state remains calibrated to USA/JTWC one-minute maximum
 * sustained surface wind. RSMC New Delhi classifies North Indian Ocean
 * systems with three-minute maximum sustained surface wind. Because this
 * project does not have a validated one-to-three-minute conversion, regional
 * bands derived from simulator wind are explicitly indicative and preserve the
 * original one-minute value.
 */

import type { WindAveragingMinutes } from './live-data';

export interface WindConvention {
  averagingMinutes: WindAveragingMinutes;
  heightM: number;
  exposure: 'over-sea' | 'over-land' | 'mixed' | 'unknown';
  measure: 'sustained' | 'gust';
  source: string;
  conversion:
    | {
        applied: true;
        fromMinutes: WindAveragingMinutes;
        factor: number;
        source: string;
        version: string;
      }
    | {
        applied: false;
        reason: string;
      };
}

export const SIMULATED_WIND_CONVENTION: Readonly<WindConvention> = {
  averagingMinutes: 1,
  heightM: 10,
  exposure: 'over-sea',
  measure: 'sustained',
  source: 'Wallah simulator · USA/JTWC one-minute calibration convention',
  conversion: {
    applied: false,
    reason: 'No validated one-to-three-minute conversion is applied.',
  },
};

export type NorthIndianOceanCategoryId =
  | 'l'
  | 'd'
  | 'dd'
  | 'cs'
  | 'scs'
  | 'vscs'
  | 'escs'
  | 'sucs';

export interface NorthIndianOceanCategory {
  id: NorthIndianOceanCategoryId;
  chip: string;
  name: string;
  minKt: number;
}

/** RSMC New Delhi three-minute maximum sustained surface-wind thresholds. */
export const NORTH_INDIAN_OCEAN_CATEGORIES:
readonly NorthIndianOceanCategory[] = [
  { id: 'l', chip: 'L', name: 'low-pressure area', minKt: 0 },
  { id: 'd', chip: 'D', name: 'depression', minKt: 17 },
  { id: 'dd', chip: 'DD', name: 'deep depression', minKt: 28 },
  { id: 'cs', chip: 'CS', name: 'cyclonic storm', minKt: 34 },
  { id: 'scs', chip: 'SCS', name: 'severe cyclonic storm', minKt: 48 },
  { id: 'vscs', chip: 'VSCS', name: 'very severe cyclonic storm', minKt: 64 },
  { id: 'escs', chip: 'ESCS', name: 'extremely severe cyclonic storm', minKt: 90 },
  { id: 'sucs', chip: 'SuCS', name: 'super cyclonic storm', minKt: 120 },
] as const;

export interface RegionalWindClassification {
  category: NorthIndianOceanCategory;
  windKt: number;
  averagingMinutes: WindAveragingMinutes;
  /** True only when the supplied value already uses the RSMC three-minute period. */
  compatible: boolean;
}

/**
 * Classify against the regional thresholds while retaining the input period.
 * Non-three-minute results are an indicative band, never a converted wind.
 */
export function northIndianOceanClassification(
  windKt: number,
  averagingMinutes: WindAveragingMinutes,
): RegionalWindClassification {
  const wind = Number.isFinite(windKt) && windKt > 0 ? windKt : 0;
  let category = NORTH_INDIAN_OCEAN_CATEGORIES[0];
  for (const candidate of NORTH_INDIAN_OCEAN_CATEGORIES) {
    if (wind >= candidate.minKt) category = candidate;
  }
  return {
    category,
    windKt: wind,
    averagingMinutes,
    compatible: averagingMinutes === 3,
  };
}

export function regionalCategoryChip(
  classification: RegionalWindClassification,
): string {
  return `${classification.category.chip}${classification.compatible ? '' : '*'}`;
}

export function windConventionLabel(convention: Readonly<WindConvention>): string {
  const averaging = `${convention.averagingMinutes}-min`;
  const exposure = convention.exposure.replace('over-', '');
  const conversion = convention.conversion.applied
    ? `converted ×${convention.conversion.factor}`
    : 'no period/gust conversion';
  return `${averaging} ${convention.measure} · ${convention.heightM} m · ` +
    `${exposure} · ${conversion}`;
}
