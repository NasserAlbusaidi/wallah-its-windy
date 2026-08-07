import { describe, expect, it } from 'vitest';
import {
  buildEnsembleEnvelope,
  ENVELOPE_RADIUS_PERCENTILE,
} from '../src/ensemble-envelope';
import type { StormRun } from '../src/ensemble';
import { greatCircleKm } from '../src/grid';
import type { TrackPoint } from '../src/types';

/** Track points as runStorm records them: ageH = 0.25 + 3k while alive. */
function aliveTrack(
  points: Array<{ lat: number; lon: number }>,
  vKt = 60,
): TrackPoint[] {
  return points.map((p, k) => ({ ...p, vKt, ageH: 0.25 + 3 * k }));
}

function run(member: number, track: TrackPoint[]): StormRun {
  return {
    member,
    track,
    peakKt: Math.max(0, ...track.map((p) => p.vKt)),
    durationH: track.length ? track[track.length - 1].ageH : 0,
    closestApproachKm: Number.POSITIVE_INFINITY,
    landfall: false,
    landfallEvents: [],
    death: null,
  };
}

/**
 * A parallel-lane fixture: members translate north-west together, offset in
 * longitude so per-lead spread is entirely zonal and easy to hand-check.
 */
function laneMembers(lonOffsets: number[], leads = 5): StormRun[] {
  return lonOffsets.map((dLon, m) =>
    run(
      m,
      aliveTrack(
        Array.from({ length: leads }, (_, k) => ({
          lat: 18 + 0.5 * k,
          lon: 62 - 0.4 * k + dLon,
        })),
      ),
    ),
  );
}

describe('buildEnsembleEnvelope', () => {
  it('returns null when fewer than two usable leads exist', () => {
    expect(buildEnsembleEnvelope([])).toBeNull();
    // One shared lead only.
    const single = laneMembers([0, 0.1, -0.1, 0.05, 0.2, -0.2], 1);
    expect(buildEnsembleEnvelope(single)).toBeNull();
  });

  it('uses the per-lead median centre and percentile radius', () => {
    const offsets = [0, 0.1, -0.1, 0.3, -0.3, 0.05, -0.05, 0.2];
    const members = laneMembers(offsets, 4);
    const envelope = buildEnsembleEnvelope(members)!;
    expect(envelope).not.toBeNull();
    expect(envelope.nodes).toHaveLength(4);

    const node = envelope.nodes[2];
    expect(node.ageH).toBeCloseTo(0.25 + 6, 9);
    expect(node.members).toBe(offsets.length);
    // Median centre: lat is shared; lon median of the offset list.
    const sorted = [...offsets].sort((a, b) => a - b);
    const medianOffset = (sorted[3] + sorted[4]) / 2;
    expect(node.lat).toBeCloseTo(19, 9);
    expect(node.lon).toBeCloseTo(62 - 0.8 + medianOffset, 9);
    // Radius: the configured percentile of great-circle distances to centre.
    const centre = { lat: node.lat, lon: node.lon };
    const distances = offsets
      .map((dLon) =>
        greatCircleKm(centre, { lat: 19, lon: 62 - 0.8 + dLon }),
      )
      .sort((a, b) => a - b);
    const rank = ENVELOPE_RADIUS_PERCENTILE * (distances.length - 1);
    const lo = Math.floor(rank);
    const expected =
      distances[lo] + (distances[Math.min(lo + 1, distances.length - 1)] - distances[lo]) * (rank - lo);
    expect(node.radiusKm).toBeCloseTo(expected, 9);
  });

  it('excludes off-step death points from lead matching', () => {
    const members = laneMembers([0, 0.1, -0.1, 0.05, -0.05, 0.2], 5);
    // Member 0 dies mid-flight: replace its tail with an off-step death point.
    const dead = members[0].track.slice(0, 3);
    dead.push({ lat: 30, lon: 40, vKt: 18, ageH: 7.75 });
    members[0] = run(0, dead);
    const envelope = buildEnsembleEnvelope(members)!;
    // Lead 2 (ageH 6.25) still counts member 0; leads 3+ do not, and the
    // wild death position never contaminates any node centre.
    expect(envelope.nodes[2].members).toBe(6);
    const later = envelope.nodes.filter((n) => n.ageH > 6.5);
    for (const node of later) {
      expect(node.members).toBe(5);
      expect(Math.abs(node.lon - 62)).toBeLessThan(3);
    }
  });

  it('truncates when alive membership falls below the floor', () => {
    // 8 members, floor = max(4, ceil(0.3*8)) = 4. Kill five after lead 1.
    const members = laneMembers([0, 0.1, -0.1, 0.05, -0.05, 0.2, -0.2, 0.15], 6);
    for (let m = 0; m < 5; m++) {
      members[m] = run(m, members[m].track.slice(0, 2));
    }
    const envelope = buildEnsembleEnvelope(members)!;
    // Leads 0..1 have 8 members; leads 2+ have only 3 < 4 -> truncated.
    expect(envelope.nodes).toHaveLength(2);
    expect(envelope.nodes[1].members).toBe(8);
  });

  it('builds a closed ribbon polygon around the centreline', () => {
    const members = laneMembers([0, 0.15, -0.15, 0.08, -0.08, 0.3], 6);
    const envelope = buildEnsembleEnvelope(members)!;
    const polygon = envelope.polygon;
    expect(polygon.length).toBeGreaterThan(envelope.nodes.length * 2);
    // Every node centre lies strictly inside the polygon's bounding box.
    const lats = polygon.map((p) => p.lat);
    const lons = polygon.map((p) => p.lon);
    for (const node of envelope.nodes) {
      expect(node.lat).toBeGreaterThan(Math.min(...lats));
      expect(node.lat).toBeLessThan(Math.max(...lats));
      expect(node.lon).toBeGreaterThan(Math.min(...lons));
      expect(node.lon).toBeLessThan(Math.max(...lons));
    }
    // The ribbon is wider than the raw member spread at its widest node.
    const widest = Math.max(...envelope.nodes.map((n) => n.radiusKm));
    expect(widest).toBeGreaterThan(0);
  });

  it('caps bulge outward: start cap behind the first node, end cap past the last', () => {
    // Members travel due north so the along-track axis is pure latitude.
    const members = [0, 0.1, -0.1, 0.05, -0.05, 0.2].map((dLon, m) =>
      run(
        m,
        aliveTrack(
          Array.from({ length: 5 }, (_, k) => ({ lat: 18 + 0.6 * k, lon: 62 + dLon })),
        ),
      ),
    );
    const envelope = buildEnsembleEnvelope(members)!;
    const first = envelope.nodes[0];
    const lastNode = envelope.nodes[envelope.nodes.length - 1];
    // Some polygon point sits behind the start (lat < first node) and some
    // past the end (lat > last node); none of the cap points may fall in the
    // ribbon interior column between the first and last node centres.
    const lats = envelope.polygon.map((p) => p.lat);
    expect(Math.min(...lats)).toBeLessThan(first.lat);
    expect(Math.max(...lats)).toBeGreaterThan(lastNode.lat);
  });

  it('is deterministic: identical inputs give deeply equal envelopes', () => {
    const build = () =>
      buildEnsembleEnvelope(laneMembers([0, 0.1, -0.1, 0.05, -0.05, 0.2], 5));
    expect(build()).toEqual(build());
  });

  it('ignores members with empty tracks without crashing', () => {
    const members = laneMembers([0, 0.1, -0.1, 0.05, -0.05], 4);
    members.push(run(5, []));
    const envelope = buildEnsembleEnvelope(members)!;
    expect(envelope.nodes[0].members).toBe(5);
  });
});
