/**
 * tracks.test.ts — the tracks.json parse/validation + label-anchor contract (C7).
 *
 * Ghost tracks are static IBTrACS polylines loaded from data/tracks.json. This
 * module is the pure (DOM-free) half of that feature: it parses + validates the
 * file into StormTrack[], derives the render polylines, and picks each storm's
 * label anchor (its peak-wind fix INSIDE the domain, not the global peak). The
 * tests are fixture-driven — the real bake output need not exist — and pin the
 * two invariants the renderer/labels depend on: bad shapes degrade to null (no
 * throw, no ghosts) and the anchor is the in-domain peak.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTracks, toGhostPolylines, computeLabelAnchors } from '../src/tracks';
import { inBBox, DOMAIN } from '../src/grid';
import type { StormTrack } from '../src/tracks';

// cwd = repo root during vitest (mirrors integration-bins.test.ts).
function loadFixture(): unknown {
  return JSON.parse(readFileSync('test/tracks.fixture.json', 'utf8'));
}

describe('parseTracks: valid fixture', () => {
  it('parses the two synthetic storms with all in-domain + off-domain fixes', () => {
    const tracks = parseTracks(loadFixture());
    expect(tracks).not.toBeNull();
    expect(tracks!.length).toBe(2);
    expect(tracks![0].id).toBe('alpha2007');
    expect(tracks![0].name).toBe('alpha');
    expect(tracks![0].year).toBe(2007);
    expect(tracks![0].points.length).toBe(4);
    // The off-domain Bay-of-Bengal-style fix is KEPT (C1: canvas clipping handles it).
    expect(tracks![0].points.some((p) => !inBBox(p.lat, p.lon, DOMAIN))).toBe(true);
  });

  it('preserves null windKt/presMb (blank CSV cells) as null, not 0', () => {
    const tracks = parseTracks({
      version: 1,
      storms: [{ id: 's', name: 's', year: 2020, points: [{ lat: 20, lon: 60, windKt: null, presMb: null }] }],
    });
    expect(tracks).not.toBeNull();
    expect(tracks![0].points[0].windKt).toBeNull();
    expect(tracks![0].points[0].presMb).toBeNull();
  });
});

describe('parseTracks: bad shapes degrade to null (never throw)', () => {
  const bad: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'nope'],
    ['empty object', {}],
    ['wrong version', { version: 2, storms: [] }],
    ['missing version', { storms: [] }],
    ['storms not array', { version: 1, storms: 'nope' }],
  ];
  for (const [label, input] of bad) {
    it(`${label} -> null`, () => {
      expect(() => parseTracks(input)).not.toThrow();
      expect(parseTracks(input)).toBeNull();
    });
  }

  it('empty storms array is valid (yields no ghosts, not null)', () => {
    expect(parseTracks({ version: 1, storms: [] })).toEqual([]);
  });
});

describe('parseTracks: per-storm / per-point sanitisation', () => {
  it('drops fixes with non-finite lat/lon but keeps the storm', () => {
    const tracks = parseTracks({
      version: 1,
      storms: [
        {
          id: 's',
          name: 's',
          year: 2020,
          points: [
            { lat: 20, lon: 60, windKt: 50, presMb: 990 },
            { lat: NaN, lon: 60, windKt: 60, presMb: 985 },
            { lat: 21, lon: 'x', windKt: 70, presMb: 980 },
          ],
        },
      ],
    });
    expect(tracks).not.toBeNull();
    expect(tracks![0].points.length).toBe(1);
  });

  it('drops a malformed storm (no id / no points) but keeps siblings', () => {
    const tracks = parseTracks({
      version: 1,
      storms: [
        { name: 'noid', year: 2020, points: [{ lat: 20, lon: 60 }] },
        { id: 'ok', name: 'ok', year: 2021, points: [{ lat: 22, lon: 61 }] },
        { id: 'empty', name: 'empty', year: 2022, points: [] },
      ],
    });
    expect(tracks).not.toBeNull();
    expect(tracks!.map((t) => t.id)).toEqual(['ok']);
  });
});

describe('toGhostPolylines', () => {
  it('maps each storm to an id + {lat,lon} polyline (all fixes, off-domain included)', () => {
    const tracks = parseTracks(loadFixture())!;
    const polys = toGhostPolylines(tracks);
    expect(polys.length).toBe(2);
    expect(polys[0].id).toBe('alpha2007');
    expect(polys[0].points.length).toBe(4);
    expect(polys[0].points[1]).toEqual({ lat: 18, lon: 63 });
  });
});

describe('computeLabelAnchors: peak-wind fix INSIDE the domain', () => {
  it('ignores the global (off-domain) peak and anchors at the in-domain peak', () => {
    const tracks = parseTracks(loadFixture())!;
    const anchors = computeLabelAnchors(tracks);
    expect(anchors.length).toBe(2);
    // alpha global peak is 140 kt at (30,72) OFF-domain; in-domain peak is 120 kt at (18,63).
    const alpha = anchors.find((a) => a.id === 'alpha2007')!;
    expect(alpha.text).toBe('alpha 2007');
    expect(alpha.lat).toBe(18);
    expect(alpha.lon).toBe(63);
    expect(inBBox(alpha.lat, alpha.lon, DOMAIN)).toBe(true);
    const beta = anchors.find((a) => a.id === 'beta2021')!;
    expect(beta.text).toBe('beta 2021');
    expect(beta.lat).toBe(24);
    expect(beta.lon).toBe(58);
  });

  it('lowercases the label text', () => {
    const tracks: StormTrack[] = [
      { id: 'g', name: 'GONU', year: 2007, points: [{ iso: '', lat: 20, lon: 60, windKt: 100, presMb: 950 }] },
    ];
    expect(computeLabelAnchors(tracks)[0].text).toBe('gonu 2007');
  });

  it('skips a storm with no in-domain fix (no anchor)', () => {
    const tracks: StormTrack[] = [
      { id: 'x', name: 'x', year: 2020, points: [{ iso: '', lat: 30, lon: 72, windKt: 100, presMb: 950 }] },
    ];
    expect(computeLabelAnchors(tracks)).toEqual([]);
  });

  it('falls back to the first in-domain fix when every windKt is null', () => {
    const tracks: StormTrack[] = [
      {
        id: 'x',
        name: 'x',
        year: 2020,
        points: [
          { iso: '', lat: 20, lon: 60, windKt: null, presMb: null },
          { iso: '', lat: 22, lon: 61, windKt: null, presMb: null },
        ],
      },
    ];
    const a = computeLabelAnchors(tracks)[0];
    expect(a.lat).toBe(20);
    expect(a.lon).toBe(60);
  });
});
