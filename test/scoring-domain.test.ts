import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCORING_DOMAIN } from '../src/scoring-domain';

describe('SCORING_DOMAIN', () => {
  it('is the frozen 50-70 E, 15-27 N box every sealed artifact was scored in', () => {
    expect(SCORING_DOMAIN).toEqual({
      lonMin: 50,
      lonMax: 70,
      latMin: 15,
      latMax: 27,
    });
  });

  it('is spelled out, never derived from the live DOMAIN', () => {
    // The whole point of the constant is that it must NOT move when grid.ts's
    // DOMAIN moves. An import from ./grid is the one edit that would silently
    // undo it, so the source text itself is the assertion.
    const source = readFileSync('src/scoring-domain.ts', 'utf8');
    expect(source).not.toMatch(/^\s*import[^\n]*'\.\/grid'/m);
  });
});
