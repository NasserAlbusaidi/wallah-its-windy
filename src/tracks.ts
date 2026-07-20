/**
 * tracks.ts — historic-storm (IBTrACS) track parsing + label anchoring (C7).
 *
 * data/tracks.json is baked by the bake pipeline (writer B1). This module is the
 * DOM-free half of the ghost-track feature: it validates that file into
 * {@link StormTrack}[], projects it into the render polylines the GhostLayer
 * draws, and picks each storm's label anchor. Kept small + pure so it is unit-
 * testable in node (no canvas, no fetch) and so main.ts/ui.ts churn stays low.
 *
 * Degradation contract (C7): a missing/404 file is handled upstream (the loader
 * returns null); a downloaded-but-malformed file must NEVER throw — a bad shape
 * (wrong version, non-array storms, non-object root) degrades to `null` so the
 * app simply shows no ghosts. Individual bad fixes/storms are dropped, not fatal.
 *
 * All coordinate/domain math routes through grid.ts (the single coordinate owner);
 * off-domain fixes are DELIBERATELY kept (canvas clipping handles them — C1).
 */

import type { LatLon } from './types';
import { DOMAIN, inBBox } from './grid';

/** One IBTrACS fix. windKt/presMb are null when the source CSV cell was blank. */
export interface TrackFix {
  iso: string;
  lat: number;
  lon: number;
  windKt: number | null;
  presMb: number | null;
}

/** One historic storm: an id, display name/year, and a time-ordered track. */
export interface StormTrack {
  id: string;
  name: string;
  year: number;
  points: TrackFix[];
}

/** A ghost polyline as the GhostLayer consumes it: an id + lat/lon vertices. */
export interface GhostPolyline {
  id: string;
  points: LatLon[];
}

/** A DOM label anchor: where ui.ts pins "<name> <year>" for one storm. */
export interface GhostLabelAnchor {
  id: string;
  /** Lowercase display text, e.g. "gonu 2007". */
  text: string;
  lat: number;
  lon: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseFix(p: unknown): TrackFix | null {
  if (!isRecord(p)) return null;
  const { lat, lon } = p;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lon !== 'number' || !Number.isFinite(lon)) return null;
  return {
    iso: typeof p.iso === 'string' ? p.iso : '',
    lat,
    lon,
    windKt: numOrNull(p.windKt),
    presMb: numOrNull(p.presMb),
  };
}

function parseStorm(s: unknown): StormTrack | null {
  if (!isRecord(s)) return null;
  if (typeof s.id !== 'string' || s.id.length === 0) return null;
  if (!Array.isArray(s.points)) return null;
  const points: TrackFix[] = [];
  for (const p of s.points) {
    const fix = parseFix(p);
    if (fix) points.push(fix);
  }
  if (points.length === 0) return null;
  return {
    id: s.id,
    name: typeof s.name === 'string' ? s.name : s.id,
    year: typeof s.year === 'number' && Number.isFinite(s.year) ? s.year : 0,
    points,
  };
}

/**
 * Validate parsed JSON into StormTrack[], or null for a malformed file.
 *
 * Returns null ONLY for a top-level shape failure (non-object root, version !== 1,
 * non-array `storms`). A well-shaped file with individual bad storms/fixes yields
 * the surviving subset (possibly []); it never throws.
 */
export function parseTracks(json: unknown): StormTrack[] | null {
  if (!isRecord(json)) return null;
  if (json.version !== 1) return null;
  if (!Array.isArray(json.storms)) return null;
  const out: StormTrack[] = [];
  for (const s of json.storms) {
    const st = parseStorm(s);
    if (st) out.push(st);
  }
  return out;
}

/** Project storms into GhostLayer polylines (all fixes, off-domain included). */
export function toGhostPolylines(tracks: StormTrack[]): GhostPolyline[] {
  return tracks.map((t) => ({
    id: t.id,
    points: t.points.map((p) => ({ lat: p.lat, lon: p.lon })),
  }));
}

/** The storm's peak-wind fix that lies INSIDE the domain, or null if none do. */
function peakInDomainFix(points: TrackFix[]): TrackFix | null {
  let best: TrackFix | null = null;
  let bestW = -Infinity;
  for (const p of points) {
    if (!inBBox(p.lat, p.lon, DOMAIN)) continue;
    const w = p.windKt ?? -Infinity;
    if (best === null || w > bestW) {
      best = p;
      bestW = w;
    }
  }
  return best;
}

/**
 * One label anchor per storm, at its peak-wind fix INSIDE the domain (not the
 * global peak — the historic peak often lands off-map). Storms with no in-domain
 * fix get no anchor (their label would sit outside the canvas).
 */
export function computeLabelAnchors(tracks: StormTrack[]): GhostLabelAnchor[] {
  const out: GhostLabelAnchor[] = [];
  for (const t of tracks) {
    const anchor = peakInDomainFix(t.points);
    if (!anchor) continue;
    out.push({
      id: t.id,
      text: `${t.name} ${t.year}`.toLowerCase(),
      lat: anchor.lat,
      lon: anchor.lon,
    });
  }
  return out;
}
