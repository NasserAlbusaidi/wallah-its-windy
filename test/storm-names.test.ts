import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  NORTH_INDIAN_OCEAN_NAMES,
  simulatedStormName,
  STORM_NAME_CATALOG_SHA256,
  STORM_NAME_CATALOG_VERSION,
} from '../src/storm-names';

describe('North Indian Ocean simulated storm names', () => {
  it('pins all 169 WMO/ESCAP names in official column-wise order', () => {
    expect(NORTH_INDIAN_OCEAN_NAMES).toHaveLength(169);
    expect(NORTH_INDIAN_OCEAN_NAMES.slice(0, 4)).toEqual([
      'Nisarga',
      'Gati',
      'Nivar',
      'Burevi',
    ]);
    expect(NORTH_INDIAN_OCEAN_NAMES.slice(13, 17)).toEqual([
      'Biparjoy',
      'Tej',
      'Hamoon',
      'Midhili',
    ]);
    expect(NORTH_INDIAN_OCEAN_NAMES.at(-1)).toBe('Samhah');
    const checksum = createHash('sha256')
      .update(
        NORTH_INDIAN_OCEAN_NAMES.map((name) => name.toLowerCase()).join('\n'),
      )
      .digest('hex');
    expect(checksum).toBe(STORM_NAME_CATALOG_SHA256);
  });

  it('maps a seed deterministically and labels it as simulated', () => {
    expect(simulatedStormName(13)).toEqual({
      name: 'Biparjoy',
      label: 'Simulated Cyclone Biparjoy',
      catalogueIndex: 13,
      catalogueVersion: STORM_NAME_CATALOG_VERSION,
      official: false,
    });
    expect(simulatedStormName(13)).toEqual(simulatedStormName(13));
    expect(simulatedStormName(-1).name).toBe(
      NORTH_INDIAN_OCEAN_NAMES[0xffffffff % 169],
    );
  });
});
