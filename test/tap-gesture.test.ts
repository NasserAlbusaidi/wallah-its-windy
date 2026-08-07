import { describe, expect, it } from 'vitest';
import { TapGesture } from '../src/tap-gesture';

describe('TapGesture', () => {
  it('accepts a short, steady contact', () => {
    const tap = new TapGesture();
    tap.start(1, 100, 100, 0);
    expect(tap.end(1, 104, 102, 180)).toBe(true);
  });

  it('rejects drag, long press, and a multi-touch gesture', () => {
    const tap = new TapGesture();
    tap.start(1, 100, 100, 0);
    tap.move(1, 140, 100);
    expect(tap.end(1, 140, 100, 100)).toBe(false);

    tap.start(2, 100, 100, 0);
    expect(tap.end(2, 100, 100, 900)).toBe(false);

    tap.start(3, 100, 100, 0);
    tap.start(4, 120, 100, 10);
    expect(tap.end(3, 100, 100, 80)).toBe(false);
    expect(tap.end(4, 120, 100, 80)).toBe(false);
  });

  it('invalidates a pending contact when the map layout changes', () => {
    const tap = new TapGesture();
    tap.start(1, 100, 100, 0);

    tap.cancelAll();

    expect(tap.end(1, 100, 100, 100)).toBe(false);
  });
});
