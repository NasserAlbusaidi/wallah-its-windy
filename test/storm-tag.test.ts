import { describe, expect, it } from 'vitest';
import { formatStormTag } from '../src/storm-tag';

describe('formatStormTag', () => {
  it('formats an intensifying cat-3', () => {
    const t = formatStormTag({
      label: 'Shaheen',
      vKt: 111,
      hPa: 943,
      trendKtPerH: 0.9,
    });
    expect(t.line1).toBe('SHAHEEN · 111 kt');
    expect(t.line2).toBe('cat 3 · intensifying · 943 hPa');
  });

  it('names weakening and steady trends', () => {
    expect(
      formatStormTag({
        label: 'x',
        vKt: 40,
        hPa: 999,
        trendKtPerH: -1.2,
      }).line2,
    ).toBe('ts · weakening · 999 hPa');
    expect(
      formatStormTag({
        label: 'x',
        vKt: 20,
        hPa: 1005,
        trendKtPerH: 0.1,
      }).line2,
    ).toBe('td · steady · 1005 hPa');
  });
});
