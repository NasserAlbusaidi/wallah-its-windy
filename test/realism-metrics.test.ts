import { describe, expect, it } from 'vitest';
import type { RealismField } from '../src/realism-proxy';
import {
  REALISM_ENV_CLOUDY_TOP_C,
  metricsForField,
} from '../src/realism-metrics';
import { syntheticFrame, weakFrame } from './helpers/realism';
// The MODULE takes HALF_DOMAIN_HEIGHT_KM from grid.ts (below the render layer);
// this TEST imports it through the render re-export, which is the path every
// render consumer uses. Same value, both routes — that is the point.
import { HALF_DOMAIN_HEIGHT_KM } from '../src/render/storm-radii';

function blankField(): RealismField {
  const n = 8;
  const fill = (value: number) => new Float32Array(n * n).fill(value);
  return {
    n, metricX: 1, center: { x: 0, y: 0 },
    // Fixture construction, not a drift guard: cellKm must track what
    // buildRealismField produces or the fixture stops being a real field.
    cellKm: {
      x: (2 / n) * HALF_DOMAIN_HEIGHT_KM,
      y: (2 / n) * HALF_DOMAIN_HEIGHT_KM,
    },
    btProxyC: fill(20), cloud: fill(0), stormCloud: fill(0),
    ambientCloud: fill(0), bands: fill(0), precipBandCloud: fill(0),
    debris: fill(0), oceanMask: fill(1),
  };
}

function ctxFor(frame = syntheticFrame()) {
  return {
    frame,
    genesis: { lat: 16, lon: 64 },
    envShear: { u: 1, v: 0, magnitude: 10 },
    envSteer: { u: 0, v: 0 },
    midlevelRh01: 0.58,
    monthIndex: 5,
    displayTFrac: 0,
    samplingMode: { kind: 'synoptic-plane', plane: 0 } as const,
  };
}

/**
 * Eight cold cells due EAST of the centre (rows j=3,4 straddle the axis, so the
 * centroid's north component is exactly 0) with mean clip x = 0.5. Exactly
 * REALISM_MIN_COLD_CELLS, so the centroid is reported.
 */
function eastLobeField(): RealismField {
  const field = blankField();
  for (const j of [3, 4]) for (let i = 4; i <= 7; i++) field.btProxyC[j * 8 + i] = -70;
  return field;
}

describe('metricsForField', () => {
  it('cold-top area counts thresholded cells times cell area', () => {
    const field = blankField();
    field.btProxyC[0 * 8 + 4] = -70;
    field.btProxyC[4 * 8 + 4] = -70;
    const m = metricsForField(field, ctxFor());
    expect(m.coldTop.areaKm2).toBeCloseTo(2 * field.cellKm.x * field.cellKm.y, 6);
    expect(m.coldTop.centroidOffsetKm).toBeNull(); // below REALISM_MIN_COLD_CELLS
  });

  it('environmental cloud fraction thresholds btProxyC, not cover', () => {
    const field = blankField();
    field.btProxyC.fill(REALISM_ENV_CLOUDY_TOP_C - 5); // everything cold enough
    const m = metricsForField(field, ctxFor());
    expect(m.environmentalCloudFraction).toBe(1);
    field.btProxyC.fill(REALISM_ENV_CLOUDY_TOP_C + 5); // everything too warm
    expect(metricsForField(field, ctxFor()).environmentalCloudFraction).toBe(0);
  });

  it('centroid bearing is relative to the shear vector', () => {
    const field = blankField();
    for (let j = 3; j <= 5; j++) for (let i = 5; i <= 7; i++) {
      field.btProxyC[j * 8 + i] = -70; // 9 cold cells due EAST; shear points east
    }
    const m = metricsForField(field, ctxFor());
    expect(m.coldTop.centroidOffsetKm).toBeGreaterThan(0);
    expect(Math.abs(m.coldTop.centroidBearingRelToShearDeg ?? 999)).toBeLessThan(30);
  });

  it('band edge energy only sees band-masked cells', () => {
    const field = blankField();
    for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) field.btProxyC[j * 8 + i] = -80;
    // no band mask anywhere -> all nulls despite the huge gradient
    let m = metricsForField(field, ctxFor());
    expect(m.bandEdgeEnergy.innerCPerKm).toBeNull();
    // mask one inner column straddling the step -> non-null inner energy
    field.bands[3 * 8 + 4] = 0.5;
    m = metricsForField(field, ctxFor());
    expect(m.bandEdgeEnergy.innerCPerKm).toBeGreaterThan(0);
  });

  it('eye contrast is null for an eyeless weak storm', () => {
    const m = metricsForField(blankField(), ctxFor(weakFrame()));
    expect(m.eyeContrastC).toBeNull();
  });

  it('eye contrast is the warm core minus the cold eyewall ring', () => {
    const base = syntheticFrame();
    // An 8x8 grid has 166.5 km cells, so a physical 30 km rmw resolves neither
    // the q <= 0.35 disc nor the 0.8..1.3 ring. Centre the field on cell (4,4)
    // and stretch rmwKm so the disc is that one cell (q = 0) and the ring is
    // the four diagonals (235.5 km -> q = 0.94); every other cell falls in the
    // gap or past 1.3. This is a unit test of the reduction, not of a storm.
    const frame = syntheticFrame({
      structure: { ...base.structure, rmwKm: 250 },
    });
    const field = blankField();
    field.center = { x: 0.125, y: -0.125 };
    field.btProxyC[4 * 8 + 4] = 10; // warm eye
    for (const j of [3, 5]) for (const i of [3, 5]) field.btProxyC[j * 8 + i] = -70;
    const m = metricsForField(field, ctxFor(frame));
    expect(m.eyeContrastC).toBeCloseTo(80, 6); // 10 - (-70)

    // Same frame at the default centre: eyeStrength is unchanged and high, but
    // no cell resolves the disc, so there is no contrast to report.
    expect(metricsForField(blankField(), ctxFor(frame)).eyeContrastC).toBeNull();
  });

  it('environmental cloud fraction is null with no eligible ocean cells', () => {
    const overLand = blankField();
    overLand.oceanMask.fill(0);
    expect(metricsForField(overLand, ctxFor()).environmentalCloudFraction).toBeNull();

    // 3 * 400 km exceeds the 824 km corner distance, so the exclusion disc
    // swallows the whole grid.
    const base = syntheticFrame();
    const broad = syntheticFrame({
      structure: { ...base.structure, outerSizeKm: 400 },
    });
    expect(
      metricsForField(blankField(), ctxFor(broad)).environmentalCloudFraction,
    ).toBeNull();
  });

  it('shear at or below the display gate nulls every direction-relative output', () => {
    const field = blankField();
    for (let j = 3; j <= 5; j++) for (let i = 3; i <= 5; i++) {
      field.btProxyC[j * 8 + i] = -70; // 9 cells >= REALISM_MIN_COLD_CELLS
    }
    field.bands[3 * 8 + 4] = 0.5;
    // 0 (calm), 0.04 (sub-threshold), 0.05 (EXACTLY the gate — the shader
    // keeps the physical direction only strictly above 0.05, so the metric
    // must null here too; the literal 0.05 compares exactly).
    for (const u of [0, 0.04, 0.05]) {
      const m = metricsForField(field, {
        ...ctxFor(),
        envShear: { u, v: 0, magnitude: u },
      });
      expect(m.coldTop.areaKm2).toBeGreaterThan(0);
      expect(m.coldTop.centroidOffsetKm).not.toBeNull();
      expect(m.coldTop.centroidBearingRelToShearDeg).toBeNull();
      expect(m.bandEdgeEnergy.byShearQuadrant.dl).toBeNull();
      expect(m.bandEdgeEnergy.byShearQuadrant.dr).toBeNull();
      expect(m.bandEdgeEnergy.byShearQuadrant.ul).toBeNull();
      expect(m.bandEdgeEnergy.byShearQuadrant.ur).toBeNull();
    }
    // Just above the gate the direction is physical again.
    const above = metricsForField(field, {
      ...ctxFor(),
      envShear: { u: 0.06, v: 0, magnitude: 0.06 },
    });
    expect(above.coldTop.centroidBearingRelToShearDeg).not.toBeNull();
  });

  it('assigns quadrants with the documented shear handedness', () => {
    const field = blankField();
    // Shear is due EAST (ctxFor's default). Masked cell (i=4, j=3) sits
    // north-east of the centre: dot = +83.25 (downshear) and
    // cross = shear x cell = +83.25 (left) -> dl. Masked cell (i=3, j=5) sits
    // south-west: dot = -83.25 (upshear), cross = -249.75 (right) -> ur.
    // Exactly two buckets may be populated, so ANY pairwise label swap —
    // dl/dr, ul/ur, or downshear/upshear — nulls a bucket asserted non-null.
    field.btProxyC[3 * 8 + 3] = -40; // west neighbour of (4,3): a gradient to read
    field.btProxyC[5 * 8 + 2] = -40; // west neighbour of (3,5)
    field.bands[3 * 8 + 4] = 0.5;
    field.bands[5 * 8 + 3] = 0.5;
    const q = metricsForField(field, ctxFor()).bandEdgeEnergy.byShearQuadrant;
    expect(q.dl).toBeGreaterThan(0);
    expect(q.ur).toBeGreaterThan(0);
    expect(q.dr).toBeNull();
    expect(q.ul).toBeNull();
  });

  it('centroid bearing is compass-framed, clockwise-positive from the shear', () => {
    // Shear due NORTH, cold centroid due EAST: east is a quarter turn
    // CLOCKWISE from north, so the compass-framed bearing
    // (atan2(east, north) - atan2(u, v)) is +90. The math convention
    // (atan2(north, east) - atan2(v, u)) would report -90 on this same
    // fixture, which is what makes the sign here discriminating.
    const m = metricsForField(eastLobeField(), {
      ...ctxFor(),
      envShear: { u: 0, v: 1, magnitude: 1 },
    });
    expect(m.coldTop.centroidBearingRelToShearDeg).toBeCloseTo(90, 6);
  });

  it('the km mapping tracks the field builder\'s half-domain height', () => {
    // Guards fieldGeometry's clip->km mapping (realism-metrics.ts):
    // centroidOffsetKm comes from clip offset * metricX * HALF_DOMAIN_HEIGHT_KM
    // computed inside fieldGeometry, which never reads field.cellKm — so this
    // is NOT a cross-check against buildRealismField's cellKm mapping. What it
    // does catch: wrong cell selection, a dropped metricX factor, or a
    // wrong-axis bug in fieldGeometry. The cold centroid sits at clip
    // (0.5, 0), so its offset must be exactly half the domain height.
    const m = metricsForField(eastLobeField(), ctxFor());
    expect(m.coldTop.centroidOffsetKm).toBeCloseTo(0.5 * HALF_DOMAIN_HEIGHT_KM, 6);
  });

  it('precipBandCloud alone activates the RGR-004 band mask', () => {
    const field = blankField();
    // Masked interior cell (i=4, j=3): ~118 km from centre, all four
    // neighbours in-grid; bands stays 0 so the mask can only come from
    // precipBandCloud. The temperature step goes on a NEIGHBOUR — a central
    // difference never reads the masked cell's own value, so perturbing
    // only (4,3) would leave the gradient exactly zero.
    field.btProxyC[3 * 8 + 3] = -40;
    field.precipBandCloud[3 * 8 + 4] = 0.5;
    const m = metricsForField(field, ctxFor());
    expect(m.bandEdgeEnergy.innerCPerKm).toBeGreaterThan(0);
  });

  it('border ring never contributes to central-difference gradients', () => {
    const field = blankField();
    // cell (i=4, j=0): top edge, ~589 km from centre — INSIDE the 600 km
    // outer limit (a corner cell would sit outside it and pass vacuously).
    field.btProxyC[0 * 8 + 4] = -80; // huge step against its 20 C neighbours
    field.bands[0 * 8 + 4] = 0.5;    // masked, but on the border ring
    const m = metricsForField(field, ctxFor());
    expect(m.bandEdgeEnergy.innerCPerKm).toBeNull();
    expect(m.bandEdgeEnergy.outerCPerKm).toBeNull();
  });
});
