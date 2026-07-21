import { describe, expect, it } from 'vitest';
import { findHistoricalAnalog } from '../src/historical-analog';
import type { StormTrack } from '../src/tracks';
import type { TrackPoint } from '../src/types';

const SIMULATED: TrackPoint[] = [
  { lat: 17, lon: 65, vKt: 35, ageH: 0 },
  { lat: 18, lon: 63, vKt: 55, ageH: 6 },
  { lat: 20, lon: 60, vKt: 85, ageH: 12 },
  { lat: 22, lon: 58, vKt: 100, ageH: 18 },
];

function historical(
  id: string,
  offsets: Array<[number, number]>,
  winds: number[],
): StormTrack {
  return {
    id,
    name: id,
    year: 2007,
    points: offsets.map(([lat, lon], index) => ({
      iso: new Date(Date.UTC(2007, 5, 1, index * 6)).toISOString(),
      lat,
      lon,
      windKt: winds[index],
      presMb: null,
    })),
  };
}

describe('historical analog', () => {
  it('finds an identical translated shape and intensity deterministically', () => {
    const sameShape = historical(
      'same',
      SIMULATED.map((point) => [point.lat, point.lon - 1]),
      SIMULATED.map((point) => point.vKt),
    );
    const different = historical(
      'different',
      [[17, 65], [17, 66], [17, 67], [17, 68]],
      [35, 35, 35, 35],
    );
    const result = findHistoricalAnalog(SIMULATED, [different, sameShape], {
      complete: false,
    });
    expect(result?.trackId).toBe('same');
    expect(result?.shapeErrorKm).toBeCloseTo(0, 8);
    expect(result?.activePrefix).toBe(true);
    expect(result).toEqual(
      findHistoricalAnalog(SIMULATED, [different, sameShape], { complete: false }),
    );
  });

  it('does not inspect future historic fixes for an active storm', () => {
    const track: StormTrack = {
      id: 'future-turn',
      name: 'future-turn',
      year: 2020,
      points: [
        { iso: '2020-01-01T00:00:00Z', lat: 17, lon: 65, windKt: 35, presMb: null },
        { iso: '2020-01-01T06:00:00Z', lat: 18, lon: 63, windKt: 55, presMb: null },
        { iso: '2020-01-01T12:00:00Z', lat: 20, lon: 60, windKt: 85, presMb: null },
        { iso: '2020-01-01T18:00:00Z', lat: 22, lon: 58, windKt: 100, presMb: null },
        { iso: '2020-01-02T00:00:00Z', lat: 30, lon: 70, windKt: 150, presMb: null },
      ],
    };
    const active = SIMULATED.slice(0, 3);
    const result = findHistoricalAnalog(active, [track], { complete: false });
    expect(result?.comparedThroughH).toBe(12);
    expect(result?.shapeErrorKm).toBeCloseTo(0, 8);
  });

  it('normalizes unequal sampling intervals before comparing shape', () => {
    const unevenSimulation: TrackPoint[] = [
      { lat: 17, lon: 65, vKt: 40, ageH: 0 },
      { lat: 17.25, lon: 64.5, vKt: 50, ageH: 6 },
      { lat: 17.75, lon: 63.5, vKt: 70, ageH: 18 },
      { lat: 18, lon: 63, vKt: 80, ageH: 24 },
    ];
    const sparseHistory: StormTrack = {
      id: 'sparse',
      name: 'sparse',
      year: 2020,
      points: [
        { iso: '2020-01-01T00:00:00Z', lat: 17, lon: 65, windKt: 40, presMb: null },
        { iso: '2020-01-01T12:00:00Z', lat: 17.5, lon: 64, windKt: 60, presMb: null },
        { iso: '2020-01-02T00:00:00Z', lat: 18, lon: 63, windKt: 80, presMb: null },
      ],
    };
    const result = findHistoricalAnalog(unevenSimulation, [sparseHistory], {
      complete: true,
    });
    expect(result?.shapeErrorKm).toBeCloseTo(0, 8);
    expect(result?.intensityErrorKt).toBeCloseTo(0, 8);
  });

  it('returns null when there is not enough track to compare', () => {
    expect(findHistoricalAnalog(SIMULATED.slice(0, 1), [], { complete: true })).toBeNull();
  });
});
