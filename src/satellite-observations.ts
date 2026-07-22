import { DOMAIN } from './grid';
import type { SatellitePaletteId } from './weather-layers';

export type SatelliteSourceMode = 'simulated' | 'observed' | 'handoff';
export type SatelliteProviderId = 'meteosat' | 'insat';
export type SatelliteChannel = 'infrared' | 'visible';

export interface ObservedSatelliteFrame {
  id: string;
  provider: SatelliteProviderId;
  satellite: string;
  product: string;
  observedAt: string;
  channel: SatelliteChannel;
  imageUrl: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  bbox: { west: number; south: number; east: number; north: number };
  /** True for a frame baked into public/data; false for a remote WMS request. */
  cached: boolean;
}

export interface SatelliteFrameManifest {
  version: 1;
  frames: ObservedSatelliteFrame[];
}

export interface InsatCatalogEntry {
  identifier: string;
  id: string;
  updated: string;
  enclosureLink: string;
}

const METEOSAT_ARCHIVE_START_MS = Date.parse('2020-08-01T00:00:00Z');
const EUMETVIEW_WMS = 'https://view.eumetsat.int/geoserver/wms';
const MOSDAC_SEARCH = 'https://mosdac.gov.in/apios/datasets.json';

function finiteIso(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProvider(value: unknown): value is SatelliteProviderId {
  return value === 'meteosat' || value === 'insat';
}

function isChannel(value: unknown): value is SatelliteChannel {
  return value === 'infrared' || value === 'visible';
}

function parseFrame(value: unknown): ObservedSatelliteFrame | null {
  if (!isRecord(value)) return null;
  const bbox = value.bbox;
  if (!isRecord(bbox)) return null;
  const nums = [bbox.west, bbox.south, bbox.east, bbox.north];
  if (nums.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    !isProvider(value.provider) ||
    typeof value.satellite !== 'string' ||
    typeof value.product !== 'string' ||
    typeof value.observedAt !== 'string' ||
    !finiteIso(value.observedAt) ||
    !isChannel(value.channel) ||
    typeof value.imageUrl !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.attribution !== 'string' ||
    typeof value.license !== 'string' ||
    typeof value.cached !== 'boolean'
  ) {
    return null;
  }
  return {
    id: value.id,
    provider: value.provider,
    satellite: value.satellite,
    product: value.product,
    observedAt: value.observedAt,
    channel: value.channel,
    imageUrl: value.imageUrl,
    sourceUrl: value.sourceUrl,
    attribution: value.attribution,
    license: value.license,
    cached: value.cached,
    bbox: {
      west: bbox.west as number,
      south: bbox.south as number,
      east: bbox.east as number,
      north: bbox.north as number,
    },
  };
}

export function parseSatelliteManifest(value: unknown): SatelliteFrameManifest | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.frames)) {
    return null;
  }
  return {
    version: 1,
    frames: value.frames.map(parseFrame).filter((frame): frame is ObservedSatelliteFrame => frame !== null),
  };
}

/** Nearest frame within a bounded window; deterministic tie-break favours earlier. */
export function matchObservedFrame(
  frames: readonly ObservedSatelliteFrame[],
  targetIso: string,
  provider: SatelliteProviderId,
  channel: SatelliteChannel,
  maxDeltaMinutes = 90,
): ObservedSatelliteFrame | null {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs) || maxDeltaMinutes < 0) return null;
  let best: ObservedSatelliteFrame | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (frame.provider !== provider || frame.channel !== channel) continue;
    const frameMs = Date.parse(frame.observedAt);
    const delta = Math.abs(frameMs - targetMs);
    if (delta < bestDelta || (delta === bestDelta && frameMs < Date.parse(best!.observedAt))) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best && bestDelta <= maxDeltaMinutes * 60_000 ? best : null;
}

/** Floor to a stable UTC acquisition slot so fast simulation cannot flood a provider. */
export function acquisitionSlotIso(target: Date, cadenceMinutes: number): string {
  if (!Number.isFinite(target.getTime()) || !Number.isFinite(cadenceMinutes) || cadenceMinutes <= 0) {
    throw new Error('valid target and positive cadenceMinutes are required');
  }
  const cadenceMs = cadenceMinutes * 60_000;
  return new Date(Math.floor(target.getTime() / cadenceMs) * cadenceMs).toISOString();
}

export function channelForPalette(palette: SatellitePaletteId): SatelliteChannel {
  return palette === 'visible' ? 'visible' : 'infrared';
}

/**
 * Build a domain-cropped, timestamp-locked EUMETView request. EUMETView marks
 * the time dimension nearestValue=1; we still request an exact 15-minute slot
 * and reject dates outside the published archive rather than accepting a remote
 * nearest frame from a different storm.
 */
export function meteosatWmsFrame(
  targetIso: string,
  palette: SatellitePaletteId,
  nowMs = Date.now(),
): ObservedSatelliteFrame | null {
  const targetMs = Date.parse(targetIso);
  if (
    !Number.isFinite(targetMs) ||
    targetMs < METEOSAT_ARCHIVE_START_MS ||
    targetMs > nowMs + 30 * 60_000
  ) {
    return null;
  }
  const observedAt = acquisitionSlotIso(new Date(targetMs), 15);
  const channel = channelForPalette(palette);
  const layer = channel === 'visible' ? 'msg_iodc:vis006' : 'msg_iodc:ir108';
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: layer,
    styles: '',
    crs: 'EPSG:4326',
    // WMS 1.3 EPSG:4326 uses latitude,longitude axis order.
    bbox: `${DOMAIN.latMin},${DOMAIN.lonMin},${DOMAIN.latMax},${DOMAIN.lonMax}`,
    width: '1000',
    height: '600',
    format: 'image/png',
    transparent: 'false',
    time: observedAt,
  });
  const imageUrl = `${EUMETVIEW_WMS}?${params.toString()}`;
  return {
    id: `meteosat-${channel}-${observedAt}`,
    provider: 'meteosat',
    satellite: targetMs >= Date.parse('2022-06-01T00:00:00Z') ? 'Meteosat-9 IODC' : 'Meteosat-8 IODC',
    product: channel === 'visible' ? 'SEVIRI VIS0.6 μm' : 'SEVIRI IR10.8 μm',
    observedAt,
    channel,
    imageUrl,
    sourceUrl: 'https://user.eumetsat.int/data-access/eumetview',
    attribution: 'EUMETSAT EUMETView',
    license: 'EUMETSAT data policy',
    bbox: { west: DOMAIN.lonMin, south: DOMAIN.latMin, east: DOMAIN.lonMax, north: DOMAIN.latMax },
    cached: false,
  };
}

export function insatCatalogSearchUrl(targetIso: string): string | null {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return null;
  const day = new Date(targetMs).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    datasetId: '3DIMG_L1C_ASIA_MER',
    startTime: day,
    endTime: day,
    count: '100',
    boundingBox: `${DOMAIN.lonMin},${DOMAIN.latMin},${DOMAIN.lonMax},${DOMAIN.latMax}`,
  });
  return `${MOSDAC_SEARCH}?${params.toString()}`;
}

export function parseInsatCatalog(value: unknown): InsatCatalogEntry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) return [];
  return value.entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.identifier !== 'string' ||
      typeof entry.id !== 'string' ||
      typeof entry.updated !== 'string' ||
      !finiteIso(entry.updated) ||
      typeof entry.enclosureLink !== 'string'
    ) {
      return [];
    }
    return [{
      identifier: entry.identifier,
      id: entry.id,
      updated: entry.updated,
      enclosureLink: entry.enclosureLink,
    }];
  });
}

export function matchInsatCatalogEntry(
  entries: readonly InsatCatalogEntry[],
  targetIso: string,
  maxDeltaMinutes = 90,
): InsatCatalogEntry | null {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return null;
  let best: InsatCatalogEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const delta = Math.abs(Date.parse(entry.updated) - targetMs);
    if (delta < bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }
  return best && bestDelta <= maxDeltaMinutes * 60_000 ? best : null;
}

/** Cross-origin-safe decoder used by main; caller owns and closes the bitmap. */
export async function loadObservedFrameImage(
  frame: ObservedSatelliteFrame,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const response = await fetch(frame.imageUrl, { mode: 'cors', signal });
  if (!response.ok) throw new Error(`satellite frame HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`satellite frame returned ${type || 'non-image data'}`);
  return createImageBitmap(await response.blob());
}
