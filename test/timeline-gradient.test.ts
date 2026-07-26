import { describe, expect, it } from 'vitest';
import { categoryGradientCss } from '../src/timeline-gradient';

describe('categoryGradientCss', () => {
  it('returns a flat gradient for a single-category tape', () => {
    const css = categoryGradientCss([
      { vKt: 25, ageH: 0 },
      { vKt: 30, ageH: 6 },
      { vKt: 30, ageH: 12 },
    ]);
    expect(css.startsWith('linear-gradient(90deg,')).toBe(true);
    // one category → exactly one colour, two stops (0% and 100%)
    expect(css.match(/rgba?\(/g)!.length).toBe(2);
  });

  it('emits hard stops at category boundaries in tape order', () => {
    const css = categoryGradientCss([
      { vKt: 25, ageH: 0 }, // td
      { vKt: 45, ageH: 12 }, // ts from 50% of the tape
      { vKt: 70, ageH: 24 }, // cat1 (last frame)
    ]);
    // td colour holds to 50%, ts starts at 50% — hard stop pair present
    expect(css).toContain('50%');
  });

  it('handles an empty tape', () => {
    expect(categoryGradientCss([])).toBe('none');
  });
});
