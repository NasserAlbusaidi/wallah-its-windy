import { describe, expect, it } from 'vitest';
import { normalizeLoggedFlowAccumulation } from '../src/render/textures';

describe('flow-accumulation texture contract', () => {
  it('linearly normalizes the already-log10 baked values exactly once', () => {
    expect(normalizeLoggedFlowAccumulation(0, 5)).toBe(0);
    expect(normalizeLoggedFlowAccumulation(2.5, 5)).toBe(0.5);
    expect(normalizeLoggedFlowAccumulation(5, 5)).toBe(1);
  });
});
