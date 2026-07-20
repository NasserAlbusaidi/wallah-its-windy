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
}

export function chooseRenderProfile(input: RenderProfileInput): RenderProfile {
  const phone =
    input.width <= 520 ||
    (input.coarsePointer && input.width <= 740) ||
    input.hardwareConcurrency <= 4;
  if (phone) {
    return { dprCap: 1.25, particleBudget: 2_600, compact: true };
  }
  if (input.width <= 820 || input.coarsePointer) {
    return { dprCap: 1.5, particleBudget: 4_200, compact: true };
  }
  return { dprCap: 2, particleBudget: 8_000, compact: false };
}

