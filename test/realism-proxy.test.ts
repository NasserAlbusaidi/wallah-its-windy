import { describe, expect, it } from 'vitest';
import { cloudNoiseBytes } from '../src/render/cloud-noise';
import {
  RealismNoise,
  glslFract,
  glslHash21,
  glslRotate2,
  smoothstep,
} from '../src/realism-proxy';
import { syntheticFrame, weakFrame } from './helpers/realism';

describe('GLSL-semantics helpers', () => {
  it('glslFract handles negatives like GLSL (x - floor(x))', () => {
    expect(glslFract(-1.25)).toBeCloseTo(0.75, 12);
    expect(glslFract(2.5)).toBeCloseTo(0.5, 12);
  });

  it('glslRotate2 is CLOCKWISE for positive angles (column-major mat2)', () => {
    // rotate (1, 0) by +90deg -> (0, -1) under mat2(c,-s,s,c) * v
    const r = glslRotate2(Math.PI / 2, 1, 0);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(-1, 12);
  });

  it('glslHash21 mirrors the shader hash', () => {
    const expected = (px: number, py: number) => {
      const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    expect(glslHash21(0.3, 0.7)).toBeCloseTo(expected(0.3, 0.7), 12);
    expect(glslHash21(-2.4, 5.1)).toBeCloseTo(expected(-2.4, 5.1), 12);
  });

  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('RealismNoise', () => {
  const noise = new RealismNoise();

  it('tap at a texel center returns that texel byte exactly', () => {
    const bytes = cloudNoiseBytes(128);
    const expected = bytes[(7 * 128 + 3) * 4 + 1] / 255;
    expect(noise.tap(3.5 / 128, 7.5 / 128, 1)).toBeCloseTo(expected, 12);
  });

  it('tap wraps REPEAT: uv and uv+1 are identical', () => {
    expect(noise.tap(0.113, 0.71, 0)).toBeCloseTo(noise.tap(1.113, -0.29, 0), 12);
  });

  it('tap interpolates midway between horizontal neighbours', () => {
    const bytes = cloudNoiseBytes(128);
    const a = bytes[(9 * 128 + 4) * 4] / 255;
    const b = bytes[(9 * 128 + 5) * 4] / 255;
    expect(noise.tap(5 / 128, 9.5 / 128, 0)).toBeCloseTo((a + b) / 2, 12);
  });

  it('cloudNoise is deterministic and in a plausible range', () => {
    const v1 = noise.cloudNoise(0.42, -1.7);
    const v2 = new RealismNoise().cloudNoise(0.42, -1.7);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(1);
  });
});

// A proxy metric may read a quantity from the frame, the diagnostics, or the
// structure. If those disagree, a test asserting "weak storm => X" can pass or
// fail for a reason unrelated to what it claims. These invariants are asserted
// rather than promised in a doc comment.
describe('frame fixtures are internally self-consistent', () => {
  for (const [name, frame] of [
    ['syntheticFrame', syntheticFrame()],
    ['weakFrame', weakFrame()],
  ] as const) {
    it(`${name}: the same quantity carries one value everywhere`, () => {
      expect(frame.organization).toBe(frame.diagnostics.organization);
      expect(frame.organization).toBe(frame.diagnostics.organizationTarget);
      expect(frame.coldWakeC).toBe(frame.diagnostics.coldWakeC);
      expect(frame.vKt).toBe(frame.structure.maximumWindKt);
      expect(frame.diagnostics.shearUms).toBe(frame.structure.shearUms);
      expect(frame.diagnostics.shearVms).toBe(frame.structure.shearVms);
    });

    it(`${name}: scalars equal the quantities they summarize`, () => {
      const { diagnostics } = frame;
      expect(Math.hypot(diagnostics.shearUms, diagnostics.shearVms))
        .toBeCloseTo(diagnostics.shearMs, 12);
      expect(diagnostics.totalRainMmH).toBeCloseTo(
        diagnostics.eyewallRainMmH + diagnostics.rainbandRainMmH +
          diagnostics.orographicRainMmH,
        12,
      );
      expect(diagnostics.netKtPerH).toBeCloseTo(
        diagnostics.oceanKtPerH - diagnostics.shearKtPerH -
          diagnostics.landKtPerH - diagnostics.dryAirKtPerH,
        12,
      );
    });

    it(`${name}: wind radii nest and never exceed the intensity`, () => {
      const { r34Km, r50Km, r64Km, maximumWindKt } = frame.structure;
      for (const q of ['ne', 'se', 'sw', 'nw'] as const) {
        expect(r34Km[q]).toBeGreaterThanOrEqual(r50Km[q]);
        expect(r50Km[q]).toBeGreaterThanOrEqual(r64Km[q]);
        if (maximumWindKt < 50) expect(r50Km[q]).toBe(0);
        if (maximumWindKt < 64) expect(r64Km[q]).toBe(0);
      }
    });

    it(`${name}: the core is deeper than its environment`, () => {
      const { centralPressureHpa, environmentalPressureHpa } = frame.structure;
      expect(centralPressureHpa).toBeLessThan(environmentalPressureHpa);
    });
  }

  it('weakFrame is weaker than syntheticFrame on every intensity axis', () => {
    const strong = syntheticFrame();
    const weak = weakFrame();
    expect(weak.vKt).toBeLessThan(strong.vKt);
    expect(weak.organization).toBeLessThan(strong.organization);
    expect(weak.structure.centralPressureHpa)
      .toBeGreaterThan(strong.structure.centralPressureHpa);
    expect(weak.diagnostics.totalRainMmH)
      .toBeLessThan(strong.diagnostics.totalRainMmH);
  });

  it('overrides still apply on top of a coherent base', () => {
    expect(syntheticFrame({ ageH: 96 }).ageH).toBe(96);
    expect(weakFrame({ lat: -5 }).lat).toBe(-5);
    // The plan pins these; a coherence edit must not have moved them.
    const weak = weakFrame();
    expect(weak.vKt).toBe(35);
    expect(weak.organization).toBe(0.3);
    expect(weak.structure.maximumWindKt).toBe(35);
    expect(weak.structure.rmwKm).toBe(60);
    expect(weak.structure.outerSizeKm).toBe(180);
    expect(weak.structure.hollandB).toBe(1.2);
  });
});
