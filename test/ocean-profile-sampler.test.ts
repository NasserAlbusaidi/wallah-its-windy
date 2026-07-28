import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBin } from '../src/loader';
import { sampleOceanProfileBin } from '../src/ocean-profile-sampler';
import {
  OCEAN_DEPTH_INTERFACES_M,
  seawaterDensityKgM3,
} from '../src/upper-ocean';

function loadOcean() {
  const bytes = readFileSync('public/data/ocean.bin');
  return parseBin(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
}

describe('WOA23 upper-ocean profile artifact', () => {
  it('carries finite monthly temperature and salinity on every locked level', () => {
    const sample = sampleOceanProfileBin(loadOcean(), 19, 62, 5);
    expect(sample).not.toBeNull();
    expect(sample!.tier).toBe('climatological-subsurface');
    const profile = sample!.profile;
    expect(profile.temperatureC).toHaveLength(OCEAN_DEPTH_INTERFACES_M.length - 1);
    expect(profile.salinityPsu).toHaveLength(OCEAN_DEPTH_INTERFACES_M.length - 1);
    expect(profile.temperatureC.every(Number.isFinite)).toBe(true);
    expect(profile.salinityPsu.every(Number.isFinite)).toBe(true);
    expect(profile.temperatureC[0]).toBeGreaterThan(profile.temperatureC.at(-1)!);
    expect(profile.salinityPsu.every((value) => value >= 20 && value <= 45)).toBe(true);
  });

  it('resolves a physically stable Arabian Sea thermocline at an open-ocean point', () => {
    const sample = sampleOceanProfileBin(loadOcean(), 19, 62, 5)!;
    expect(sample.tier).toBe('climatological-subsurface');
    const profile = sample.profile;
    const surfaceDensity = seawaterDensityKgM3(
      profile.temperatureC[1],
      profile.salinityPsu[1],
    );
    const deepDensity = seawaterDensityKgM3(
      profile.temperatureC.at(-1)!,
      profile.salinityPsu.at(-1)!,
    );
    expect(deepDensity).toBeGreaterThan(surfaceDensity);
    expect(profile.temperatureC.at(-1)).toBeGreaterThan(10);
  });

  it('returns null rather than inventing levels from an incompatible bin', () => {
    expect(sampleOceanProfileBin(null, 19, 62, 5)).toBeNull();
  });
});
