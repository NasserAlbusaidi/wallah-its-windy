/**
 * cell-index.test.ts — the containing-cell index rule (nio-v1 Phase 1).
 *
 * upper-ocean.ts used to index cells with Math.round on the continuous cell
 * coordinate, whose value is an exact half-integer for every 0.1-degree
 * coordinate; the rounding direction was then decided by last-bit float error.
 * grid.ts now owns an explicit containing-cell rule indexed off the bbox
 * origin. Two properties are pinned here:
 *   1. at snapEpsilon = 0 the new rule is BIT-IDENTICAL to the old expression,
 *      which is what makes the change safe to land inside a zero-diff phase;
 *   2. at STABLE_CELL_SNAP_EPSILON a 0.1-degree walk yields 0,1,2,...,n-1 with
 *      every step exactly 1 — no duplicate, no skip. That is the behaviour the
 *      domain flip needs; it is measured NOT to be zero-diff (38 of 81 shipped
 *      spawn points move one cell), so it stays off until Phase 8.
 */

import { describe, it, expect } from 'vitest';
import {
  STABLE_CELL_SNAP_EPSILON,
  cellIndexFromOrigin,
  columnIndex,
  latLonToCell,
  rowIndex,
} from '../src/grid';
import type { GridSpec } from '../src/types';

/**
 * The runtime ocean grid: 0.1 degrees over today's DOMAIN (upper-ocean.ts:139-143).
 * Bare literals, not `bbox: DOMAIN` — this fixture pins today's grid shape as
 * one frozen unit. Deriving bbox from DOMAIN would silently follow the Phase 8
 * domain change and stop pinning anything; nx/ny would then disagree with the
 * new bbox instead of failing loudly.
 */
const OCEAN_GRID: GridSpec = {
  nx: 200,
  ny: 120,
  bbox: { lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 },
};

/** Verbatim reproduction of the pre-fix upper-ocean.ts:564-570 expression. */
function legacyCell(lat: number, lon: number): { col: number; row: number } {
  const at = latLonToCell(OCEAN_GRID, lat, lon);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    col: clamp(Math.round(at.col), 0, OCEAN_GRID.nx - 1),
    row: clamp(Math.round(at.row), 0, OCEAN_GRID.ny - 1),
  };
}

describe('cellIndexFromOrigin at snapEpsilon 0 is bit-identical to the old rule', () => {
  it('agrees over a dense sweep of the ocean grid', () => {
    let checked = 0;
    for (let i = 0; i <= 20000; i++) {
      const lon = 50 + (i * 20) / 20000;
      const lat = 15 + (i * 12) / 20000;
      expect(columnIndex(OCEAN_GRID, lon), `lon ${lon}`).toBe(legacyCell(lat, lon).col);
      expect(rowIndex(OCEAN_GRID, lat), `lat ${lat}`).toBe(legacyCell(lat, lon).row);
      checked++;
    }
    expect(checked).toBe(20001);
  });

  it('agrees on every 0.1-degree coordinate, ties included', () => {
    for (let k = 0; k <= 200; k++) {
      const lon = 50 + k / 10;
      expect(columnIndex(OCEAN_GRID, lon), `lon ${lon}`).toBe(legacyCell(21, lon).col);
    }
    for (let k = 0; k <= 120; k++) {
      const lat = 15 + k / 10;
      expect(rowIndex(OCEAN_GRID, lat), `lat ${lat}`).toBe(legacyCell(lat, 60).row);
    }
  });

  it('clamps outside the box instead of returning a negative index', () => {
    expect(columnIndex(OCEAN_GRID, 40)).toBe(0);
    expect(columnIndex(OCEAN_GRID, 90)).toBe(199);
    expect(rowIndex(OCEAN_GRID, 40)).toBe(0);
    expect(rowIndex(OCEAN_GRID, 5)).toBe(119);
  });
});

describe('the snapped rule gives a stable 0.1-degree walk', () => {
  it('advances the column by exactly one per 0.1 degree of longitude', () => {
    const seen: number[] = [];
    for (let k = 0; k < 200; k++) {
      seen.push(columnIndex(OCEAN_GRID, 50 + k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 200 }, (_, k) => k));
  });

  it('advances the row by exactly one per 0.1 degree of latitude, north to south', () => {
    const seen: number[] = [];
    for (let k = 0; k < 120; k++) {
      seen.push(rowIndex(OCEAN_GRID, 27 - k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 120 }, (_, k) => k));
  });

  it('is stable on the post-expansion grid shape too', () => {
    const NEW_GRID: GridSpec = {
      nx: 550,
      ny: 300,
      bbox: { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 },
    };
    const seen: number[] = [];
    for (let k = 0; k < 550; k++) {
      seen.push(columnIndex(NEW_GRID, 45 + k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 550 }, (_, k) => k));
  });

  it('records that the snap is a behaviour change, not a refactor', () => {
    // gonu's hindcast fix (scenarios.json). Measured 2026-08-10: one of 38 of
    // the 81 shipped spawn points that move a cell when the snap is enabled.
    expect(columnIndex(OCEAN_GRID, 67.1)).toBe(170);
    expect(columnIndex(OCEAN_GRID, 67.1, STABLE_CELL_SNAP_EPSILON)).toBe(171);
  });
});

describe('cellIndexFromOrigin: the raw axis helper', () => {
  it('returns the containing cell, west/north edge inclusive', () => {
    expect(cellIndexFromOrigin(0, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(0.999, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(1, 0, 1, 4)).toBe(1);
    expect(cellIndexFromOrigin(3.5, 0, 1, 4)).toBe(3);
  });

  it('clamps to [0, count-1]', () => {
    expect(cellIndexFromOrigin(-5, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(99, 0, 1, 4)).toBe(3);
  });
});
