import { describe, it, expect } from 'vitest';
import {
  DOMAIN,
  cellToLatLon,
  latLonToCell,
  latLonToClip,
  clipToLatLon,
  msToDegPerHourZonal,
  msToDegPerHourMeridional,
  greatCircleKm,
  inBBox,
  worldMetricX,
} from '../src/grid';
import type { GridSpec } from '../src/types';

const DEG2RAD = Math.PI / 180;

// env-like 0.5-deg grid over the domain, and a coarse off-square grid to prove
// the math is spec-driven, not domain-hardcoded.
const ENV: GridSpec = { nx: 40, ny: 24, bbox: DOMAIN };
const ODD: GridSpec = { nx: 7, ny: 3, bbox: { lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 } };

describe('grid: latlon <-> cell roundtrip is exact', () => {
  const cases: Array<{ spec: GridSpec; col: number; row: number }> = [
    { spec: ENV, col: 0, row: 0 },
    { spec: ENV, col: 39, row: 23 },
    { spec: ENV, col: 20, row: 12 },
    { spec: ENV, col: 12.5, row: 7.25 }, // fractional
    { spec: ODD, col: 0, row: 0 },
    { spec: ODD, col: 6, row: 2 },
    { spec: ODD, col: 3.3, row: 1.1 },
  ];
  for (const { spec, col, row } of cases) {
    it(`cell(${col},${row}) -> latlon -> cell`, () => {
      const ll = cellToLatLon(spec, col, row);
      const back = latLonToCell(spec, ll.lat, ll.lon);
      expect(back.col).toBeCloseTo(col, 10);
      expect(back.row).toBeCloseTo(row, 10);
    });
  }

  it('integer cell 0,0 sits at the NW cell center (row 0 = north)', () => {
    const ll = cellToLatLon(ENV, 0, 0);
    // NW cell center: half a cell in from lonMin (west) and latMax (north).
    expect(ll.lon).toBeCloseTo(DOMAIN.lonMin + 0.5 * ((70 - 50) / 40), 10);
    expect(ll.lat).toBeCloseTo(DOMAIN.latMax - 0.5 * ((27 - 15) / 24), 10);
    expect(ll.lat).toBeGreaterThan(DOMAIN.latMin); // north, not south
  });
});

describe('grid: clip-space corners map to bbox corners', () => {
  const cases: Array<{ lat: number; lon: number; x: number; y: number; label: string }> = [
    { lat: DOMAIN.latMin, lon: DOMAIN.lonMin, x: -1, y: -1, label: 'SW' },
    { lat: DOMAIN.latMax, lon: DOMAIN.lonMax, x: 1, y: 1, label: 'NE' },
    { lat: DOMAIN.latMax, lon: DOMAIN.lonMin, x: -1, y: 1, label: 'NW' },
    { lat: DOMAIN.latMin, lon: DOMAIN.lonMax, x: 1, y: -1, label: 'SE' },
    { lat: (15 + 27) / 2, lon: (50 + 70) / 2, x: 0, y: 0, label: 'center' },
  ];
  for (const c of cases) {
    it(`${c.label} corner`, () => {
      const clip = latLonToClip(c.lat, c.lon);
      expect(clip.x).toBeCloseTo(c.x, 12);
      expect(clip.y).toBeCloseTo(c.y, 12);
      const back = clipToLatLon(clip.x, clip.y);
      expect(back.lat).toBeCloseTo(c.lat, 12);
      expect(back.lon).toBeCloseTo(c.lon, 12);
    });
  }
});

describe('grid: zonal deg/h carries the cos-lat correction', () => {
  const u = 10; // m/s eastward
  const lats = [0, 15, 21, 27];
  for (const lat of lats) {
    it(`zonal(${lat}) * cos(lat) == meridional (lat-invariant) at u=${u}`, () => {
      const zonal = msToDegPerHourZonal(u, lat);
      const meridional = msToDegPerHourMeridional(u);
      expect(zonal * Math.cos(lat * DEG2RAD)).toBeCloseTo(meridional, 10);
    });
  }

  it('same ground speed spans more longitude-degrees/h at higher latitude', () => {
    expect(msToDegPerHourZonal(u, 27)).toBeGreaterThan(msToDegPerHourZonal(u, 15));
    expect(msToDegPerHourZonal(u, 15)).toBeGreaterThan(msToDegPerHourZonal(u, 0.0001));
  });

  it('meridional conversion is independent of latitude', () => {
    // there is no lat argument; the value is fixed for a given speed.
    expect(msToDegPerHourMeridional(u)).toBeCloseTo((u * 3600) / 111320, 12);
  });
});

describe('grid: great-circle distance + domain membership', () => {
  it('one degree of latitude is ~111 km', () => {
    const d = greatCircleKm({ lat: 20, lon: 60 }, { lat: 21, lon: 60 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
  it('zero distance for identical points', () => {
    expect(greatCircleKm({ lat: 23.588, lon: 58.383 }, { lat: 23.588, lon: 58.383 })).toBeCloseTo(0, 9);
  });
  it('inBBox respects the domain edges', () => {
    expect(inBBox(21, 60)).toBe(true);
    expect(inBBox(15, 50)).toBe(true); // inclusive corner
    expect(inBBox(28, 60)).toBe(false); // north of domain
    expect(inBBox(21, 49.9)).toBe(false); // west of domain
  });
});

describe('grid: world east-west metric', () => {
  it('is the domain aspect ratio at the equator', () => {
    expect(worldMetricX(0)).toBe(
      (DOMAIN.lonMax - DOMAIN.lonMin) / (DOMAIN.latMax - DOMAIN.latMin),
    );
  });

  it('scales by cos(lat) and is symmetric about the equator', () => {
    expect(worldMetricX(60)).toBeCloseTo(worldMetricX(0) * Math.cos(Math.PI / 3), 12);
    expect(worldMetricX(-21)).toBeCloseTo(worldMetricX(21), 15);
  });

  it('keeps the radian conversion the sealed realism reference was measured with', () => {
    // (lat * Math.PI) / 180, NOT lat * (Math.PI / 180). The two forms differ by
    // up to ~1.4 ULP on about 2 % of latitudes in 0..30 N, and the first form
    // is the one calibration/realism/realism-reference.json was produced with.
    expect(worldMetricX(21)).toBe(
      ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos((21 * Math.PI) / 180)) /
        (DOMAIN.latMax - DOMAIN.latMin),
    );
  });
});
