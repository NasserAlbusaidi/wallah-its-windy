import { describe, expect, it } from 'vitest';
import committed from '../calibration/asset-manifest.json';
import {
  buildManifest,
  diffManifest,
  VOLATILE_ASSET_PREFIXES,
} from '../calibration/asset-manifest.mjs';

const DATA_ROOT = new URL('../public/data/', import.meta.url);

describe('asset manifest', () => {
  it('matches every static replay file under public/data byte-for-byte', () => {
    const actual = buildManifest(DATA_ROOT);
    expect(actual).toEqual(committed.files);
  });

  it('orders entries by canonical forward-slash relative path', () => {
    const actual = buildManifest(DATA_ROOT);
    const keys = Object.keys(actual);
    expect(keys).toEqual([...keys].sort());
    expect(keys.every((key) => !key.includes('\\'))).toBe(true);
  });

  it('covers the replay-critical assets by name', () => {
    const actual = buildManifest(DATA_ROOT);
    for (const required of ['env.bin', 'terrain.bin', 'scenarios.json']) {
      expect(Object.keys(actual)).toContain(required);
    }
  });

  it('excludes only the declared volatile observation namespaces', () => {
    expect(VOLATILE_ASSET_PREFIXES).toEqual(['live/', 'satellite/']);
    const keys = Object.keys(buildManifest(DATA_ROOT));
    expect(
      keys.some((key) =>
        VOLATILE_ASSET_PREFIXES.some((prefix) => key.startsWith(prefix)),
      ),
    ).toBe(false);
  });

  it('classifies drift without modifying a tracked asset', () => {
    expect(
      diffManifest(
        { 'env.bin': 'new', 'added.bin': 'added' },
        { 'env.bin': 'old', 'removed.bin': 'removed' },
      ),
    ).toEqual({
      drifted: ['env.bin'],
      added: ['added.bin'],
      removed: ['removed.bin'],
    });
  });
});
