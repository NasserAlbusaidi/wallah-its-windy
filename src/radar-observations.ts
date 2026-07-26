/**
 * Recent observed weather-radar boundary.
 *
 * RainViewer is deliberately isolated from model physics: this module parses
 * its public timeline, builds bounded tile URLs, and reprojects the selected
 * Web-Mercator frame onto the app's equirectangular Arabian-Sea domain. The
 * resulting pixels are display-only and never enter the simulation.
 */

import { DOMAIN } from './grid';
import type { BBox } from './types';

export const RAINVIEWER_MANIFEST_URL =
  'https://api.rainviewer.com/public/weather-maps.json';
export const RAINVIEWER_ATTRIBUTION_URL = 'https://www.rainviewer.com/';
export const RADAR_ZOOM = 5;
export const RADAR_FRAME_LIMIT = 8;
export type RadarSourceMode = 'simulated' | 'observed';

const TILE_SIZE = 256;
const OUTPUT_WIDTH = 1000;
const OUTPUT_HEIGHT = 600;
const UNIVERSAL_BLUE_SCHEME = 2;

export interface RadarTimelineFrame {
  time: number;
  path: string;
}

export interface RadarTimeline {
  version: string;
  generated: number;
  host: string;
  frames: RadarTimelineFrame[];
}

export interface RadarTileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  columns: number;
  rows: number;
}

export interface RadarCoverageMask {
  image: HTMLCanvasElement;
  fraction: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validHttpsHost(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function validFrame(value: unknown): value is RadarTimelineFrame {
  return (
    isRecord(value) &&
    typeof value.time === 'number' &&
    Number.isInteger(value.time) &&
    value.time > 0 &&
    typeof value.path === 'string' &&
    /^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(value.path)
  );
}

export function parseRadarTimeline(value: unknown): RadarTimeline | null {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    typeof value.generated !== 'number' ||
    !Number.isInteger(value.generated) ||
    !validHttpsHost(value.host) ||
    !isRecord(value.radar) ||
    !Array.isArray(value.radar.past)
  ) {
    return null;
  }
  const unique = new Map<number, RadarTimelineFrame>();
  for (const candidate of value.radar.past) {
    if (validFrame(candidate)) unique.set(candidate.time, candidate);
  }
  const frames = [...unique.values()].sort((a, b) => a.time - b.time);
  if (frames.length === 0) return null;
  return {
    version: value.version,
    generated: value.generated,
    host: value.host,
    frames,
  };
}

/** Keep a bounded recent loop so one desk visit stays well below provider limits. */
export function recentRadarFrames(
  timeline: RadarTimeline,
  limit = RADAR_FRAME_LIMIT,
): RadarTimelineFrame[] {
  const safeLimit = Math.max(1, Math.min(12, Math.floor(limit)));
  return timeline.frames.slice(-safeLimit);
}

export function radarFrameIso(frame: RadarTimelineFrame): string {
  return new Date(frame.time * 1000).toISOString();
}

export function radarFrameAgeMinutes(
  frame: RadarTimelineFrame,
  nowMs = Date.now(),
): number {
  return Math.max(0, (nowMs - frame.time * 1000) / 60_000);
}

function mercatorPixelX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function mercatorPixelY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const radians = (clamped * Math.PI) / 180;
  const normalized =
    (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
  return normalized * TILE_SIZE * 2 ** zoom;
}

export function radarTileRange(
  bbox: BBox = DOMAIN,
  zoom = RADAR_ZOOM,
): RadarTileRange {
  if (
    !Number.isInteger(zoom) ||
    zoom < 0 ||
    zoom > 7 ||
    bbox.lonMin >= bbox.lonMax ||
    bbox.latMin >= bbox.latMax
  ) {
    throw new Error('valid bbox and RainViewer zoom 0..7 are required');
  }
  const xMin = Math.floor(mercatorPixelX(bbox.lonMin, zoom) / TILE_SIZE);
  const xMax = Math.floor(
    (mercatorPixelX(bbox.lonMax, zoom) - Number.EPSILON) / TILE_SIZE,
  );
  const yMin = Math.floor(mercatorPixelY(bbox.latMax, zoom) / TILE_SIZE);
  const yMax = Math.floor(
    (mercatorPixelY(bbox.latMin, zoom) - Number.EPSILON) / TILE_SIZE,
  );
  return {
    xMin,
    xMax,
    yMin,
    yMax,
    columns: xMax - xMin + 1,
    rows: yMax - yMin + 1,
  };
}

export function radarTileUrl(
  timeline: Pick<RadarTimeline, 'host'>,
  frame: RadarTimelineFrame,
  zoom: number,
  x: number,
  y: number,
): string {
  if (!validHttpsHost(timeline.host)) {
    throw new Error('valid HTTPS radar host required');
  }
  const host = timeline.host.replace(/\/+$/, '');
  return (
    `${host}${frame.path}/${TILE_SIZE}/${zoom}/${x}/${y}/` +
    `${UNIVERSAL_BLUE_SCHEME}/1_0.png`
  );
}

export function radarCoverageTileUrl(
  hostValue: string,
  zoom: number,
  x: number,
  y: number,
): string {
  if (!validHttpsHost(hostValue)) throw new Error('valid HTTPS radar host required');
  const host = hostValue.replace(/\/+$/, '');
  return `${host}/v2/coverage/0/${TILE_SIZE}/${zoom}/${x}/${y}/0/0_0.png`;
}

async function loadTile(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    cache: 'force-cache',
    signal,
  });
  if (!response.ok) throw new Error(`radar tile HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) {
    throw new Error(`radar tile returned ${type || 'non-image data'}`);
  }
  return createImageBitmap(await response.blob());
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('radar mosaics require a browser canvas');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadReprojectedMosaic(
  urls: readonly string[],
  range: RadarTileRange,
  bbox: BBox,
  zoom: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const tiles = await Promise.all(urls.map((url) => loadTile(url, signal)));
  try {
    const mosaic = makeCanvas(range.columns * TILE_SIZE, range.rows * TILE_SIZE);
    const mosaicCtx = mosaic.getContext('2d', { alpha: true });
    if (!mosaicCtx) throw new Error('radar mosaic canvas unavailable');
    mosaicCtx.imageSmoothingEnabled = true;
    for (let index = 0; index < tiles.length; index++) {
      const col = index % range.columns;
      const row = Math.floor(index / range.columns);
      mosaicCtx.drawImage(tiles[index], col * TILE_SIZE, row * TILE_SIZE);
    }

    const output = makeCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
    const outputCtx = output.getContext('2d', { alpha: true });
    if (!outputCtx) throw new Error('radar output canvas unavailable');
    outputCtx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    outputCtx.imageSmoothingEnabled = true;

    const sourceX =
      mercatorPixelX(bbox.lonMin, zoom) - range.xMin * TILE_SIZE;
    const sourceWidth =
      mercatorPixelX(bbox.lonMax, zoom) - mercatorPixelX(bbox.lonMin, zoom);

    // Longitude is linear in both projections. Latitude is not: sample one
    // output row at a time so radar echoes stay registered to the equirectangular
    // terrain instead of drifting north/south under a stretched Mercator crop.
    for (let row = 0; row < OUTPUT_HEIGHT; row++) {
      const lat =
        bbox.latMax -
        ((row + 0.5) / OUTPUT_HEIGHT) * (bbox.latMax - bbox.latMin);
      const sourceY =
        mercatorPixelY(lat, zoom) - range.yMin * TILE_SIZE;
      outputCtx.drawImage(
        mosaic,
        sourceX,
        sourceY,
        sourceWidth,
        1,
        0,
        row,
        OUTPUT_WIDTH,
        1,
      );
    }
    return output;
  } finally {
    for (const tile of tiles) tile.close();
  }
}

export async function loadRadarMosaic(
  timeline: RadarTimeline,
  frame: RadarTimelineFrame,
  signal?: AbortSignal,
  bbox: BBox = DOMAIN,
  zoom = RADAR_ZOOM,
): Promise<HTMLCanvasElement> {
  const range = radarTileRange(bbox, zoom);
  const urls: string[] = [];
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      urls.push(radarTileUrl(timeline, frame, zoom, x, y));
    }
  }
  return loadReprojectedMosaic(urls, range, bbox, zoom, signal);
}

/**
 * Fraction of the fixed map domain covered by radar according to RainViewer's
 * coverage mask. Transparent pixels are covered; opaque black pixels are not.
 */
export function radarCoverageFractionFromRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sampleStep = 4,
): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length !== width * height * 4 ||
    !Number.isInteger(sampleStep) ||
    sampleStep <= 0
  ) {
    throw new Error('valid RGBA coverage image required');
  }
  let covered = 0;
  let sampled = 0;
  const offset = Math.floor(sampleStep / 2);
  for (let y = offset; y < height; y += sampleStep) {
    for (let x = offset; x < width; x += sampleStep) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < 24) covered++;
      sampled++;
    }
  }
  return sampled > 0 ? covered / sampled : 0;
}

export async function loadRadarCoverageMask(
  host: string,
  signal?: AbortSignal,
  bbox: BBox = DOMAIN,
  zoom = RADAR_ZOOM,
): Promise<RadarCoverageMask> {
  const range = radarTileRange(bbox, zoom);
  const urls: string[] = [];
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      urls.push(radarCoverageTileUrl(host, zoom, x, y));
    }
  }
  const canvas = await loadReprojectedMosaic(urls, range, bbox, zoom, signal);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('radar coverage canvas unavailable');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // One sample per 4x4 block is enough for a status readout and avoids a
  // 600k-pixel scan on every manifest refresh. Retain the full mask for the
  // renderer: blank outside coverage must not masquerade as zero precipitation.
  return {
    image: canvas,
    fraction: radarCoverageFractionFromRgba(
      pixels,
      canvas.width,
      canvas.height,
    ),
  };
}

export async function loadRadarCoverageFraction(
  host: string,
  signal?: AbortSignal,
  bbox: BBox = DOMAIN,
  zoom = RADAR_ZOOM,
): Promise<number> {
  return (await loadRadarCoverageMask(host, signal, bbox, zoom)).fraction;
}
