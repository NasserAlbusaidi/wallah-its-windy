import { describe, expect, it } from 'vitest';
import {
  acquisitionSlotIso,
  channelForPalette,
  insatCatalogSearchUrl,
  matchInsatCatalogEntry,
  matchObservedFrame,
  meteosatWmsFrame,
  parseInsatCatalog,
  parseSatelliteManifest,
  type ObservedSatelliteFrame,
} from '../src/satellite-observations';

const frame = (observedAt: string): ObservedSatelliteFrame => ({
  id: observedAt,
  provider: 'insat',
  satellite: 'INSAT-3D',
  product: 'TIR1',
  observedAt,
  channel: 'infrared',
  imageUrl: `data/satellite/${observedAt}.png`,
  sourceUrl: 'https://mosdac.gov.in',
  attribution: 'MOSDAC / ISRO',
  license: 'research use',
  bbox: { west: 50, south: 15, east: 70, north: 27 },
  cached: true,
});

describe('satellite observation contracts', () => {
  it('floors targets to stable acquisition slots', () => {
    expect(acquisitionSlotIso(new Date('2023-06-12T12:14:59Z'), 15)).toBe('2023-06-12T12:00:00.000Z');
    expect(acquisitionSlotIso(new Date('2023-06-12T12:59:59Z'), 60)).toBe('2023-06-12T12:00:00.000Z');
  });

  it('matches a bounded nearest cached frame and rejects distant imagery', () => {
    const frames = [frame('2023-06-12T11:30:00Z'), frame('2023-06-12T12:30:00Z')];
    expect(matchObservedFrame(frames, '2023-06-12T12:10:00Z', 'insat', 'infrared', 60)?.observedAt)
      .toBe('2023-06-12T12:30:00Z');
    expect(matchObservedFrame(frames, '2023-06-13T12:10:00Z', 'insat', 'infrared', 60)).toBeNull();
  });

  it('builds axis-correct EUMETView requests and selects the visible channel', () => {
    const ir = meteosatWmsFrame('2023-06-12T12:07:00Z', 'enhanced', Date.parse('2026-01-01T00:00:00Z'))!;
    expect(ir.imageUrl).toContain('layers=msg_iodc%3Air108');
    expect(ir.imageUrl).toContain('bbox=15%2C50%2C27%2C70');
    expect(ir.observedAt).toBe('2023-06-12T12:00:00.000Z');
    expect(channelForPalette('visible')).toBe('visible');
    expect(meteosatWmsFrame('2019-10-26T00:00:00Z', 'grayscale')).toBeNull();
  });

  it('parses strict manifests while dropping malformed entries', () => {
    const parsed = parseSatelliteManifest({ version: 1, frames: [frame('2023-06-12T12:00:00Z'), { id: 4 }] });
    expect(parsed?.frames).toHaveLength(1);
    expect(parseSatelliteManifest({ version: 2, frames: [] })).toBeNull();
  });

  it('builds and parses the public MOSDAC catalogue query', () => {
    const url = insatCatalogSearchUrl('2023-06-12T12:10:00Z')!;
    expect(url).toContain('datasetId=3DIMG_L1C_ASIA_MER');
    const entries = parseInsatCatalog({ entries: [{
      identifier: '3DIMG_12JUN2023_1200_L1C_ASIA_MER_V01R00.h5',
      id: '1178',
      updated: '2023-06-12T12:00:00Z',
      enclosureLink: 'https://mosdac.gov.in/uops/?metaid=1178',
    }] });
    expect(matchInsatCatalogEntry(entries, '2023-06-12T12:10:00Z')?.id).toBe('1178');
  });
});
