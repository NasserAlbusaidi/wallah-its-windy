import { describe, expect, it } from 'vitest';
import { resolveUpperWindMode } from '../src/upper-runtime';

describe('upper-wind runtime mode wiring', () => {
  const upper = { id: 'parsed-upper-bin' };

  it('keeps the loaded resource and active layer in climatology mode', () => {
    expect(resolveUpperWindMode('upper', upper, false)).toEqual({
      activeLayer: 'upper',
      upper,
      disabled: false,
      caption: null,
      degraded: false,
    });
  });

  it('force-switches an active upper layer and nulls the event resource', () => {
    expect(resolveUpperWindMode('upper', upper, true)).toEqual({
      activeLayer: 'wind',
      upper: null,
      disabled: true,
      caption: 'no aligned upper-level analysis for this event',
      degraded: false,
    });
  });

  it('disables and degrades honestly when the sidecar is unavailable', () => {
    expect(resolveUpperWindMode('upper', null, false)).toEqual({
      activeLayer: 'wind',
      upper: null,
      disabled: true,
      caption: 'upper-wind data unavailable',
      degraded: true,
    });
  });
});
