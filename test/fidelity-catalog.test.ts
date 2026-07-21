import { describe, expect, it } from 'vitest';
import catalog from '../calibration/fidelity-catalog.json';
import tracksDocument from '../calibration/data/fidelity-tracks.json';
import { parseTracks } from '../src/tracks';

const TEST_SIDS = [
  '1985148N15067',
  '1993316N11070',
  '1999135N12073',
  '2001141N14068',
  '2019301N05081',
  '2024238N25077',
];

describe('HF-1 frozen fidelity catalogue', () => {
  it('keeps the permanent 18/6/6 complete-storm split', () => {
    expect(catalog.storms).toHaveLength(30);
    expect(
      catalog.storms.filter((storm) => storm.partition === 'development'),
    ).toHaveLength(18);
    expect(
      catalog.storms.filter((storm) => storm.partition === 'validation'),
    ).toHaveLength(6);
    expect(
      catalog.storms.filter((storm) => storm.partition === 'test'),
    ).toHaveLength(6);
    expect(
      catalog.storms
        .filter((storm) => storm.partition === 'test')
        .map((storm) => storm.sid)
        .sort(),
    ).toEqual([...TEST_SIDS].sort());
  });

  it('reserves previously unshipped storms for the final test', () => {
    const test = catalog.storms.filter((storm) => storm.partition === 'test');
    expect(test.every((storm) => storm.publicEventId === null)).toBe(true);
    expect(catalog.protocol.testPolicy).toContain('never used');
    expect(catalog.protocol.selectionPolicy).toContain('not random or exhaustive');
    expect(catalog.protocol.initialNature).toEqual(['TS', 'NR']);
    expect(catalog.protocol.initialNatureCounts).toEqual({ TS: 26, NR: 4 });
  });

  it('uses unique identities and exact safely interior observed starts', () => {
    const tracks = parseTracks(tracksDocument);
    expect(tracks).not.toBeNull();
    expect(tracks).toHaveLength(30);
    const ids = catalog.storms.map((storm) => storm.id);
    expect(new Set(ids).size).toBe(ids.length);
    const byId = new Map(tracks!.map((track) => [track.id, track]));
    for (const storm of catalog.storms) {
      const track = byId.get(storm.id);
      expect(track, storm.id).toBeDefined();
      const fix = track!.points.find(
        (point) => point.iso === storm.initialFix.iso,
      );
      expect(fix, storm.id).toMatchObject(storm.initialFix);
      expect(storm.initialFix.windKt, storm.id).toBeGreaterThanOrEqual(34);
      expect(storm.initialFix.lon, storm.id).toBeGreaterThanOrEqual(51.2);
      expect(storm.initialFix.lon, storm.id).toBeLessThanOrEqual(68.8);
      expect(storm.initialFix.lat, storm.id).toBeGreaterThanOrEqual(16.2);
      expect(storm.initialFix.lat, storm.id).toBeLessThanOrEqual(25.8);
      expect(Date.parse(storm.lastDomainFixIso), storm.id).toBeGreaterThan(
        Date.parse(storm.initialFix.iso),
      );
      const initialIndex = track!.points.findIndex(
        (point) => point.iso === storm.initialFix.iso,
      );
      const contiguous = track!.points.slice(initialIndex).filter((point, index, points) => {
        const priorStayedInside = points
          .slice(0, index)
          .every(
            (candidate) =>
              candidate.lon >= 50 &&
              candidate.lon <= 70 &&
              candidate.lat >= 15 &&
              candidate.lat <= 27,
          );
        return (
          priorStayedInside &&
          point.lon >= 50 &&
          point.lon <= 70 &&
          point.lat >= 15 &&
          point.lat <= 27
        );
      });
      expect(storm.lastDomainFixIso, storm.id).toBe(contiguous.at(-1)!.iso);
    }
  });

  it('pins one agency-consistent source snapshot', () => {
    expect(catalog.source.agency).toBe('USA/JTWC columns only');
    expect(catalog.source.sha256).toBe(
      '02f6af3b7e12ee76e88866995b4451b85867a2b7f20ed2666f8561024d671b62',
    );
  });
});
