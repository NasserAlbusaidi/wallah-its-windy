/**
 * narrative.ts — translate an exact intensity budget into ordinary language.
 *
 * The flight tape keeps every scientific number. This layer adds one causal
 * sentence so a first-time visitor can understand which term currently wins.
 */

import type { StormDiagnostics } from './types';

export type CausalTone = 'strengthening' | 'weakening' | 'steady';

export interface CausalNarrative {
  tone: CausalTone;
  headline: string;
  detail: string;
}

const EPSILON_KT_PER_H = 0.08;

export function explainIntensity(d: StormDiagnostics): CausalNarrative {
  const losses = [
    { key: 'shear', value: d.shearKtPerH },
    { key: 'land', value: d.landKtPerH },
    { key: 'dry air', value: d.dryAirKtPerH },
  ] as const;
  const dominant = losses.reduce((best, term) =>
    term.value > best.value ? term : best,
  );
  const totalLoss = losses.reduce((sum, term) => sum + term.value, 0);

  if (Math.abs(d.netKtPerH) <= EPSILON_KT_PER_H) {
    return {
      tone: 'steady',
      headline: 'The storm is holding nearly steady.',
      detail:
        totalLoss <= EPSILON_KT_PER_H
          ? 'Ocean support is weak, but so are the losses.'
          : `Ocean energy and ${dominant.key} are almost balanced.`,
    };
  }

  if (d.netKtPerH > 0) {
    return {
      tone: 'strengthening',
      headline: 'Warm water is winning.',
      detail:
        totalLoss <= EPSILON_KT_PER_H
          ? 'The ocean is strengthening the core with little resistance.'
          : `Ocean energy is arriving faster than ${dominant.key} can remove it.`,
    };
  }

  if (dominant.key === 'land') {
    return {
      tone: 'weakening',
      headline: 'Land is collapsing the circulation.',
      detail: 'Friction and the loss of warm-water fuel now dominate the budget.',
    };
  }
  if (dominant.key === 'dry air') {
    return {
      tone: 'weakening',
      headline: 'Dry desert air is eroding the core.',
      detail: 'Coastal dry-air entrainment now outweighs the ocean’s support.',
    };
  }
  return {
    tone: 'weakening',
    headline: 'Wind shear is overpowering the warm ocean.',
    detail: 'The tilted circulation is losing intensity faster than water can restore it.',
  };
}

