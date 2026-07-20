import { describe, expect, it } from 'vitest';
import { chooseRenderProfile } from '../src/performance';

describe('chooseRenderProfile', () => {
  it('keeps the full instrument budget on a capable desktop', () => {
    expect(
      chooseRenderProfile({
        width: 1440,
        dpr: 2,
        coarsePointer: false,
        hardwareConcurrency: 10,
      }),
    ).toEqual({ dprCap: 2, particleBudget: 8_000, compact: false });
  });

  it('caps DPR and particle work on a phone without changing physics', () => {
    expect(
      chooseRenderProfile({
        width: 390,
        dpr: 3,
        coarsePointer: true,
        hardwareConcurrency: 6,
      }),
    ).toEqual({ dprCap: 1.25, particleBudget: 2_600, compact: true });
  });
});

