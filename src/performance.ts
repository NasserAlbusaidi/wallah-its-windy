/**
 * performance.ts — deterministic render budgets from observable device traits.
 *
 * Physics and recorded output never change. Only backing resolution and the
 * decorative particle count adapt, keeping phone interaction responsive.
 */

export interface RenderProfileInput {
  width: number;
  dpr: number;
  coarsePointer: boolean;
  hardwareConcurrency: number;
}

export interface RenderProfile {
  dprCap: number;
  particleBudget: number;
  compact: boolean;
  /**
   * Whether the automatic post-spawn ensemble may run on this device
   * (AUTO_ENSEMBLE_BUDGET). Gates SCHEDULING only — never the request
   * payload, so a manual run computes identical results on every tier.
   */
  autoEnsemble: boolean;
}

/**
 * Versioned auto-ensemble budget (ROADMAP "Automatic ensemble envelope").
 * v1: 20 members, computed entirely on the analysis worker thread, envelope
 * derived once per result on arrival; auto-run only where autoEnsemble is
 * true (desktop tier) — phone/mid tiers keep the explicit Run fallback.
 * Bump `version` whenever member count, thread placement, or eligibility
 * changes, and record the change in ROADMAP.md.
 */
export const AUTO_ENSEMBLE_BUDGET = {
  version: 1,
  memberCount: 20,
  /** Post-spawn settle debounce before the auto run fires, ms. */
  settleMs: 1_500,
} as const;

export function chooseRenderProfile(input: RenderProfileInput): RenderProfile {
  const phone =
    input.width <= 520 ||
    (input.coarsePointer && input.width <= 740) ||
    input.hardwareConcurrency <= 4;
  if (phone) {
    return {
      dprCap: 1.25,
      particleBudget: 2_600,
      compact: true,
      autoEnsemble: false,
    };
  }
  if (input.width <= 820 || input.coarsePointer) {
    return {
      dprCap: 1.5,
      particleBudget: 4_200,
      compact: true,
      autoEnsemble: false,
    };
  }
  return {
    dprCap: 2,
    particleBudget: 8_000,
    compact: false,
    autoEnsemble: true,
  };
}

