import { describe, expect, it } from 'vitest';
import { cloudNoiseBytes } from '../src/render/cloud-noise';

describe('cloudNoiseBytes', () => {
  it('is deterministic for a fixed seed and size', () => {
    expect(cloudNoiseBytes(8, 42)).toEqual(cloudNoiseBytes(8, 42));
  });

  it('changes when the seed changes', () => {
    expect(cloudNoiseBytes(8, 42)).not.toEqual(cloudNoiseBytes(8, 43));
  });

  it('returns four independent channels per texel', () => {
    const bytes = cloudNoiseBytes(8, 7);
    expect(bytes).toHaveLength(8 * 8 * 4);
    expect(new Set(bytes).size).toBeGreaterThan(16);
  });

  it('keeps opposite texture edges continuous enough for GL_REPEAT', () => {
    const size = 128;
    const bytes = cloudNoiseBytes(size, 17);
    for (let channel = 0; channel < 4; channel += 1) {
      let horizontalDelta = 0;
      let verticalDelta = 0;
      for (let i = 0; i < size; i += 1) {
        horizontalDelta += Math.abs(
          bytes[(i * size) * 4 + channel] - bytes[(i * size + size - 1) * 4 + channel],
        );
        verticalDelta += Math.abs(
          bytes[i * 4 + channel] - bytes[((size - 1) * size + i) * 4 + channel],
        );
      }
      expect(horizontalDelta / size).toBeLessThan(35);
      expect(verticalDelta / size).toBeLessThan(35);
    }
  });

  it('rejects unsafe texture dimensions', () => {
    expect(() => cloudNoiseBytes(1)).toThrow(RangeError);
    expect(() => cloudNoiseBytes(513)).toThrow(RangeError);
    expect(() => cloudNoiseBytes(3.5)).toThrow(RangeError);
  });
});
