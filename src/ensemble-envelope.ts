/**
 * Time-indexed percentile track envelope for ensemble runs.
 *
 * Pure geometry over StormRun tracks: no DOM, no clock, no camera. Everything
 * here happens in lat/lon; the render layer projects the finished polygon
 * through the view each frame. Computed once per EnsembleResult, never per
 * frame.
 *
 * Wording contract: this is a PERTURBATION-FREQUENCY envelope (HF-4 gate
 * rejection binding) — it describes where perturbed members went, not a
 * calibrated probability cone.
 */
import type { StormRun } from './ensemble';
import { greatCircleKm, offsetKm } from './grid';
import type { LatLon } from './types';

export interface EnsembleEnvelopeNode {
  /** Sim age of this lead, hours (runStorm records at base + 3k). */
  ageH: number;
  /** Component-wise median centre of member positions at this lead. */
  lat: number;
  lon: number;
  /** Percentile great-circle radius of member spread around the centre, km. */
  radiusKm: number;
  /** Members contributing at this lead (alive with an on-step point). */
  members: number;
}

export interface EnsembleEnvelope {
  nodes: EnsembleEnvelopeNode[];
  /** Closed ribbon outline (left boundary, end cap, right boundary, start cap). */
  polygon: LatLon[];
}

/** Fraction of members the envelope radius encloses at each lead. */
export const ENVELOPE_RADIUS_PERCENTILE = 0.9;

/** A lead needs max(this, 30% of the ensemble) live members to be drawn. */
const MIN_MEMBERS_ABS = 4;
/** Tolerance for matching a track point to its expected lead age. */
const AGE_EPS = 1e-6;
/** Hard lead cap — 360 h at 3-h steps, plus slack; a runaway-loop backstop. */
const MAX_LEADS = 200;
/** Visual floor so a tight ensemble still draws a readable ribbon. */
const RIBBON_MIN_KM = 12;
/** Points per semicircular end cap. */
const CAP_STEPS = 8;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sortedAscending: number[], p: number): number {
  const rank = p * (sortedAscending.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sortedAscending.length - 1);
  return sortedAscending[lo] + (sortedAscending[hi] - sortedAscending[lo]) * (rank - lo);
}

/**
 * Build the percentile envelope from member tracks, or null when fewer than
 * two leads clear the membership floor. Tracks are ragged: members die early
 * and runStorm appends one off-step death point, so points are matched by
 * expected age (base + k*step), never by raw index alone.
 */
export function buildEnsembleEnvelope(
  members: readonly StormRun[],
): EnsembleEnvelope | null {
  const tracks = members.map((m) => m.track).filter((t) => t.length > 0);
  if (tracks.length === 0) return null;

  // Derive the recording cadence from the data itself (0.25 + 3k today, but
  // the envelope must not hardcode runStorm internals).
  const baseAge = Math.min(...tracks.map((t) => t[0].ageH));
  const longest = tracks.reduce((a, b) => (b.length > a.length ? b : a));
  const stepH = longest.length > 1 ? longest[1].ageH - longest[0].ageH : 0;
  if (stepH <= 0) return null;

  const floor = Math.max(MIN_MEMBERS_ABS, Math.ceil(0.3 * members.length));
  const nodes: EnsembleEnvelopeNode[] = [];
  for (let k = 0; k < MAX_LEADS; k++) {
    const expected = baseAge + k * stepH;
    const points: LatLon[] = [];
    for (const track of tracks) {
      const point = track[k];
      if (point && Math.abs(point.ageH - expected) < AGE_EPS) {
        points.push(point);
      }
    }
    if (points.length < floor) break;
    const centre = {
      lat: median(points.map((p) => p.lat)),
      lon: median(points.map((p) => p.lon)),
    };
    const distances = points
      .map((p) => greatCircleKm(centre, p))
      .sort((a, b) => a - b);
    nodes.push({
      ageH: expected,
      lat: centre.lat,
      lon: centre.lon,
      radiusKm: percentile(distances, ENVELOPE_RADIUS_PERCENTILE),
      members: points.length,
    });
  }
  if (nodes.length < 2) return null;

  return { nodes, polygon: ribbon(nodes) };
}

/** Unit travel direction at node i in local east/north km space. */
function direction(nodes: EnsembleEnvelopeNode[], i: number): { e: number; n: number } {
  const from = nodes[Math.max(0, i - 1)];
  const to = nodes[Math.min(nodes.length - 1, i + 1)];
  const midLat = ((from.lat + to.lat) / 2) * (Math.PI / 180);
  const e = (to.lon - from.lon) * Math.cos(midLat);
  const n = to.lat - from.lat;
  const len = Math.hypot(e, n);
  // A stalled centreline has no travel direction; point it north so the
  // perpendicular stays defined.
  return len > 1e-9 ? { e: e / len, n: n / len } : { e: 0, n: 1 };
}

function ribbon(nodes: EnsembleEnvelopeNode[]): LatLon[] {
  const left: LatLon[] = [];
  const right: LatLon[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const dir = direction(nodes, i);
    const radius = Math.max(RIBBON_MIN_KM, node.radiusKm);
    // Perpendicular: left of travel = (-n, e).
    left.push(offsetKm(node.lat, node.lon, -dir.n, dir.e, radius));
    right.push(offsetKm(node.lat, node.lon, dir.n, -dir.e, radius));
  }

  // Bearing convention: theta = atan2(east, north); left of travel is
  // theta - pi/2. Each cap starts at one ribbon edge and sweeps +pi so the
  // end cap bulges forward past the last node and the start cap bulges
  // backward behind the first — never across the ribbon interior.
  const cap = (
    node: EnsembleEnvelopeNode,
    dir: { e: number; n: number },
    startSide: 1 | -1,
  ): LatLon[] => {
    const radius = Math.max(RIBBON_MIN_KM, node.radiusKm);
    const theta0 = Math.atan2(dir.e, dir.n) + (startSide * Math.PI) / 2;
    const points: LatLon[] = [];
    for (let s = 1; s < CAP_STEPS; s++) {
      const theta = theta0 + (Math.PI * s) / CAP_STEPS;
      points.push(
        offsetKm(node.lat, node.lon, Math.sin(theta), Math.cos(theta), radius),
      );
    }
    return points;
  };

  const last = nodes.length - 1;
  return [
    ...left,
    ...cap(nodes[last], direction(nodes, last), -1),
    ...right.reverse(),
    ...cap(nodes[0], direction(nodes, 0), 1),
  ];
}
