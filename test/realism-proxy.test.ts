import { describe, expect, it } from 'vitest';
import { cloudNoiseBytes } from '../src/render/cloud-noise';
import {
  RealismNoise,
  glslFract,
  glslHash21,
  glslRotate2,
  smoothstep,
} from '../src/realism-proxy';

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
