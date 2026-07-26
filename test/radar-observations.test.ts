import { describe, expect, it } from 'vitest';
import {
  parseRadarTimeline,
  radarCoverageFractionFromRgba,
  radarCoverageTileUrl,
  radarFrameAgeMinutes,
  radarFrameIso,
  radarTileRange,
  radarTileUrl,
  recentRadarFrames,
} from '../src/radar-observations';

const rawTimeline = {
  version: '2.0',
  generated: 1_784_994_032,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: Array.from({ length: 13 }, (_, index) => ({
      time: 1_784_986_800 + index * 600,
      path: `/v2/radar/frame_${index}`,
    })),
    nowcast: [],
  },
};

describe('observed radar boundary', () => {
  it('parses a strict, chronological past-only timeline', () => {
    const parsed = parseRadarTimeline({
      ...rawTimeline,
      radar: {
        past: [
          rawTimeline.radar.past[1],
          { nope: true },
          rawTimeline.radar.past[0],
          rawTimeline.radar.past[1],
        ],
      },
    });
    expect(parsed?.frames).toEqual([
      rawTimeline.radar.past[0],
      rawTimeline.radar.past[1],
    ]);
    expect(parseRadarTimeline({
      ...rawTimeline,
      host: 'http://tilecache.rainviewer.com',
    })).toBeNull();
    expect(parseRadarTimeline({
      ...rawTimeline,
      host: 'https://tilecache.rainviewer.com/untrusted-prefix',
    })).toBeNull();
    expect(parseRadarTimeline({ version: '2.0', radar: { past: [] } })).toBeNull();
  });

  it('caps the desk loop to the most recent eight frames', () => {
    const parsed = parseRadarTimeline(rawTimeline)!;
    const frames = recentRadarFrames(parsed);
    expect(frames).toHaveLength(8);
    expect(frames[0]).toEqual(rawTimeline.radar.past[5]);
    expect(frames.at(-1)).toEqual(rawTimeline.radar.past[12]);
  });

  it('builds a bounded six-tile Arabian-Sea mosaic at zoom 5', () => {
    const range = radarTileRange();
    expect(range).toEqual({
      xMin: 20,
      xMax: 22,
      yMin: 13,
      yMax: 14,
      columns: 3,
      rows: 2,
    });
  });

  it('builds immutable radar and coverage tile URLs', () => {
    const parsed = parseRadarTimeline(rawTimeline)!;
    const frame = parsed.frames[0];
    expect(radarTileUrl(parsed, frame, 5, 21, 14)).toBe(
      'https://tilecache.rainviewer.com/v2/radar/frame_0/256/5/21/14/2/1_0.png',
    );
    expect(radarCoverageTileUrl(parsed.host, 5, 21, 14)).toBe(
      'https://tilecache.rainviewer.com/v2/coverage/0/256/5/21/14/0/0_0.png',
    );
  });

  it('publishes acquisition time and data age without calling a frame now', () => {
    const parsed = parseRadarTimeline(rawTimeline)!;
    const frame = parsed.frames[0];
    expect(radarFrameIso(frame)).toBe('2026-07-25T13:40:00.000Z');
    expect(radarFrameAgeMinutes(frame, frame.time * 1000 + 35 * 60_000)).toBe(35);
  });

  it('distinguishes transparent coverage from opaque no-coverage pixels', () => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    pixels.fill(255);
    // The four step-4 sample points are (2,2), (6,2), (2,6), and (6,6).
    pixels[(2 * 8 + 2) * 4 + 3] = 0;
    pixels[(6 * 8 + 6) * 4 + 3] = 0;
    expect(radarCoverageFractionFromRgba(pixels, 8, 8)).toBe(0.5);
    expect(() => radarCoverageFractionFromRgba(pixels, 7, 8)).toThrow(
      'valid RGBA coverage image required',
    );
  });
});
