/**
 * scoring-domain.ts — the FROZEN box every sealed scoring artifact was written
 * against.
 *
 * `DOMAIN` in grid.ts is the LIVE simulation box and is scheduled to move (the
 * northern Indian Ocean expansion widens it to 45..100 E, 0..30 N). Every
 * catalogue, split, initialization list and sealed result under `calibration/`
 * was produced by truncating observed tracks against 50..70 E, 15..27 N.
 * Re-deriving those truncations from a wider box would change cohort
 * membership and the frozen 18/6/6 and 7/3 splits — holdout leakage, not a bug
 * fix (calibration/README.md, CLAUDE.md "Frozen scientific gates").
 *
 * So the numbers are written out in full, ON PURPOSE. This module must never
 * import grid.ts, never be derived from `DOMAIN`, and never be "unified" with
 * it. It is equal to `DOMAIN` today; that equality is an accident of history,
 * not an invariant, and `test/scoring-domain.test.ts` asserts the file text
 * rather than the equality for exactly that reason.
 */

import type { BBox } from './types';

export const SCORING_DOMAIN: BBox = {
  lonMin: 50,
  lonMax: 70,
  latMin: 15,
  latMax: 27,
};
