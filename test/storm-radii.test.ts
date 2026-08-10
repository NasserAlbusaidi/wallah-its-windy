import { describe, expect, it } from 'vitest';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  RENDER_RADIUS_FLOOR_KM,
  stormRenderRadii,
} from '../src/render/storm-radii';
import {
  DOMAIN,
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_KM_PER_LAT_DEG,
} from '../src/grid';

describe('stormRenderRadii', () => {
  it('derives the canopy from outer size alone, never from RMW', () => {
    const wide = stormRenderRadii({ rmwKm: 12, outerSizeKm: 300 });
    const tight = stormRenderRadii({ rmwKm: 95, outerSizeKm: 300 });
    expect(wide.rCanopy).toBe(tight.rCanopy);
  });

  it('never contracts the canopy while outer size grows, even as RMW contracts', () => {
    // The exact defect: intensification shrinks RMW while outer size grows.
    let previous = 0;
    for (let step = 0; step <= 20; step += 1) {
      const rmwKm = 95 - step * 4;
      const outerSizeKm = 60 + step * 18;
      const { rCanopy } = stormRenderRadii({ rmwKm, outerSizeKm });
      expect(rCanopy).toBeGreaterThanOrEqual(previous);
      previous = rCanopy;
    }
  });

  it('applies the numerical floor without reintroducing an RMW dependence', () => {
    const degenerate = stormRenderRadii({ rmwKm: 95, outerSizeKm: 0 });
    expect(degenerate.rCanopy).toBe(RENDER_RADIUS_FLOOR);
  });

  it('pins the reference structure so the render is unchanged', () => {
    const { rMax, rCanopy } = stormRenderRadii({
      rmwKm: 40,
      outerSizeKm: 180,
    });
    // DELIBERATE bare 666, kept after the constant was derived from DOMAIN.
    // This is the ONE absolute pin of today's rendered geometry. Importing
    // HALF_DOMAIN_HEIGHT_KM here would make both lines restate
    // stormRenderRadii's own arithmetic, and a domain change would rescale
    // every cloud, rainband and radar radius with a green suite. A domain
    // change MUST fail here and be decided, not absorbed.
    expect(rMax).toBeCloseTo(40 / 666, 12);
    expect(rCanopy).toBeCloseTo(180 / 666, 12);
    // Canopy coefficients are the old rMax multiples divided by this ratio.
    expect(rCanopy / rMax).toBeCloseTo(CANOPY_COEFFICIENT_DIVISOR, 12);
  });

  it('allows the canopy to fall below the core for broad weak storms', () => {
    // Reachable: structure.ts clamps rmwKm to [12,95] and outerSizeKm to [60,420].
    const { rMax, rCanopy } = stormRenderRadii({
      rmwKm: 95,
      outerSizeKm: 60,
    });
    expect(rCanopy).toBeLessThan(rMax);
  });
});

describe('HALF_DOMAIN_HEIGHT_KM', () => {
  it('is exactly half the domain height at the render km-per-degree', () => {
    // The identity, written domain-agnostically so it survives a domain
    // change untouched. The absolute value is pinned exactly once, in
    // 'pins the reference structure so the render is unchanged' above.
    expect(HALF_DOMAIN_HEIGHT_KM).toBe(
      ((DOMAIN.latMax - DOMAIN.latMin) / 2) * RENDER_KM_PER_LAT_DEG,
    );
  });

  it('reproduces the legacy 666 at the current 15-27 N domain', () => {
    // Proof that the derivation is a no-op TODAY. This assertion is the one
    // the domain expansion must delete deliberately, in the same commit that
    // moves DOMAIN, so the rescale cannot happen by accident.
    expect(HALF_DOMAIN_HEIGHT_KM).toBe(666);
    expect(RENDER_KM_PER_LAT_DEG).toBe(111);
  });
});

describe('render radius floors are denominated in km', () => {
  it('RENDER_RADIUS_FLOOR is exactly the km floor over the half-domain height', () => {
    expect(RENDER_RADIUS_FLOOR_KM).toBe(5.328);
    expect(RENDER_RADIUS_FLOOR).toBe(RENDER_RADIUS_FLOOR_KM / HALF_DOMAIN_HEIGHT_KM);
    // Bit-exact round trip: the derived double IS the old 0.008 literal, so
    // the GLSL template literals in env.ts, cloud-motion.ts and cloud-memory.ts
    // still emit the string "0.008" and their digest pins are untouched.
    expect(RENDER_RADIUS_FLOOR).toBe(0.008);
    expect(String(RENDER_RADIUS_FLOOR)).toBe('0.008');
  });

  it('the floor stays below the RMW clamp, which is why it never binds', () => {
    // structure.ts clamps rmwKm to [12, 95]. Expressed in km the floor is
    // domain-invariant, so this stays true after a domain change; expressed in
    // clip units it would become 13.3 km at 0-30 N and start overriding the
    // 12 km RMW floor -- the re-coupling CLAUDE.md's rCanopy note warns about.
    expect(RENDER_RADIUS_FLOOR_KM).toBeLessThan(12);
  });
});
