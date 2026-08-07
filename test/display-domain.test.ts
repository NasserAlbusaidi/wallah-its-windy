import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DISPLAY_CONTEXT_ASSET_PATH,
  DISPLAY_CONTEXT_DOMAIN,
  DISPLAY_CONTEXT_GRID,
  DISPLAY_CONTEXT_ID,
  matchesDisplayContextGrid,
  rasterUvTransform,
} from '../src/display-domain';
import { DOMAIN, latLonToCell } from '../src/grid';
import { parseBin } from '../src/loader';
import type { BinLayer } from '../src/types';

function loadContextTerrain() {
  const bytes = readFileSync(`public/${DISPLAY_CONTEXT_ASSET_PATH}`);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return parseBin(buffer);
}

function nearest(layer: BinLayer, lat: number, lon: number): number {
  const at = latLonToCell(
    { nx: layer.nx, ny: layer.ny, bbox: layer.bbox },
    lat,
    lon,
  );
  const col = Math.max(0, Math.min(layer.nx - 1, Math.round(at.col)));
  const row = Math.max(0, Math.min(layer.ny - 1, Math.round(at.row)));
  return layer.data[row * layer.nx + col];
}

describe('display context contract', () => {
  it('is a versioned 0.04-degree box that contains the simulation domain', () => {
    expect(DISPLAY_CONTEXT_ID).toBe('arabian-sea-context-v1');
    expect(DISPLAY_CONTEXT_DOMAIN).toEqual({
      lonMin: 45,
      lonMax: 80,
      latMin: 8,
      latMax: 30,
    });
    expect(DISPLAY_CONTEXT_GRID.nx).toBe(875);
    expect(DISPLAY_CONTEXT_GRID.ny).toBe(550);
    expect(
      (DISPLAY_CONTEXT_DOMAIN.lonMax - DISPLAY_CONTEXT_DOMAIN.lonMin) /
        DISPLAY_CONTEXT_GRID.nx,
    ).toBeCloseTo(0.04, 12);
    expect(
      (DISPLAY_CONTEXT_DOMAIN.latMax - DISPLAY_CONTEXT_DOMAIN.latMin) /
        DISPLAY_CONTEXT_GRID.ny,
    ).toBeCloseTo(0.04, 12);
    expect(DISPLAY_CONTEXT_DOMAIN.lonMin).toBeLessThanOrEqual(DOMAIN.lonMin);
    expect(DISPLAY_CONTEXT_DOMAIN.lonMax).toBeGreaterThanOrEqual(DOMAIN.lonMax);
    expect(DISPLAY_CONTEXT_DOMAIN.latMin).toBeLessThanOrEqual(DOMAIN.latMin);
    expect(DISPLAY_CONTEXT_DOMAIN.latMax).toBeGreaterThanOrEqual(DOMAIN.latMax);
  });

  it('maps simulation UV into the correct context subrectangle without clamping', () => {
    const map = rasterUvTransform(DOMAIN, DISPLAY_CONTEXT_DOMAIN);
    const convert = (u: number, v: number) => ({
      u: u * map.scaleX + map.offsetX,
      v: v * map.scaleY + map.offsetY,
    });
    expect(convert(0, 0).u).toBeCloseTo(5 / 35, 12);
    expect(convert(0, 0).v).toBeCloseTo(3 / 22, 12);
    expect(convert(1, 1).u).toBeCloseTo(25 / 35, 12);
    expect(convert(1, 1).v).toBeCloseTo(15 / 22, 12);
    expect(convert(-0.25, -0.25).u).toBeLessThan(convert(0, 0).u);
  });
});

describe('context-terrain.bin', () => {
  const bin = loadContextTerrain();
  const elev = bin.layers.get('elev');
  const land = bin.layers.get('landmask');

  it('matches the declared display grid and required layers exactly', () => {
    expect([...bin.layers.keys()].sort()).toEqual(['elev', 'landmask']);
    expect(elev).toBeDefined();
    expect(land).toBeDefined();
    expect(matchesDisplayContextGrid(elev!)).toBe(true);
    expect(matchesDisplayContextGrid(land!)).toBe(true);
  });

  it('contains finite plausible GMRT relief and a strict land mask', () => {
    let min = Infinity;
    let max = -Infinity;
    let finite = true;
    for (const value of elev!.data) {
      finite &&= Number.isFinite(value);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(finite).toBe(true);
    expect(min).toBeGreaterThanOrEqual(-11_100);
    expect(max).toBeLessThanOrEqual(9_000);
    let binary = true;
    for (const value of land!.data) binary &&= value === 0 || value === 1;
    expect(binary).toBe(true);
    expect(nearest(land!, 23.588, 58.383)).toBe(1); // Muscat
    expect(nearest(land!, 19.076, 72.878)).toBe(1); // Mumbai
    expect(nearest(land!, 18, 62)).toBe(0); // central Arabian Sea
    expect(nearest(elev!, 18, 62)).toBeLessThan(0);
  });
});
