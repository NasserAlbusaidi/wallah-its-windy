import { describe, expect, it } from 'vitest';
import { AUTO_ENSEMBLE_BUDGET, chooseRenderProfile } from '../src/performance';

describe('chooseRenderProfile', () => {
  it('keeps the full instrument budget on a capable desktop', () => {
    expect(
      chooseRenderProfile({
        width: 1440,
        dpr: 2,
        coarsePointer: false,
        hardwareConcurrency: 10,
      }),
    ).toEqual({
      dprCap: 2,
      particleBudget: 8_000,
      compact: false,
      autoEnsemble: true,
    });
  });

  it('caps DPR and particle work on a phone without changing physics', () => {
    expect(
      chooseRenderProfile({
        width: 390,
        dpr: 3,
        coarsePointer: true,
        hardwareConcurrency: 6,
      }),
    ).toEqual({
      dprCap: 1.25,
      particleBudget: 2_600,
      compact: true,
      autoEnsemble: false,
    });
  });

  it('mid tier keeps the explicit-run fallback (no auto ensemble)', () => {
    expect(
      chooseRenderProfile({
        width: 800,
        dpr: 2,
        coarsePointer: false,
        hardwareConcurrency: 8,
      }),
    ).toEqual({
      dprCap: 1.5,
      particleBudget: 4_200,
      compact: true,
      autoEnsemble: false,
    });
  });

  it('pins auto-ensemble budget v1: 20 members off the main thread', () => {
    expect(AUTO_ENSEMBLE_BUDGET).toEqual({
      version: 1,
      memberCount: 20,
      settleMs: 1_500,
    });
  });
});

