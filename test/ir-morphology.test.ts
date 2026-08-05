import { describe, expect, it } from 'vitest';
import type { FlightFrame } from '../src/flight-recorder';
import {
  REALISM_COLD_TOP_C,
  REALISM_EYE_CORE_Q,
  REALISM_EYEWALL_RING_Q_MAX,
  REALISM_EYEWALL_RING_Q_MIN,
} from '../src/realism-metrics';
import {
  RealismNoise,
  buildRealismField,
  midlevelRhUniform,
} from '../src/realism-proxy';
import type {
  RealismField,
  RealismFrameContext,
} from '../src/realism-proxy';
import { syntheticFrame } from './helpers/realism';

const DENSE_CDO_COVER = 0.85;
const MAX_DOWNSHEAR_AXIS_OFFSET_DEG = 30;
const PALETTE_COLD_CLIP_C = -85;
const MIN_DENSE_CORE_BT_IQR_C = 10;
const MAX_DENSE_CORE_CLIPPED_FRACTION = 0.15;
const MAX_SUPPRESSED_EYE_BT_CONTRAST_C = 40;
const MIN_MATURE_EYE_BT_CONTRAST_C = 50;
const MAX_SUPPRESSED_EYE_CLEARING = 0.4;
const MIN_MATURE_EYE_CLEARING = 0.42;

function openOcean() {
  return {
    envBin: null,
    land01At: () => 0,
    noise: new RealismNoise(),
    debris: null,
  };
}

function stormFrame(options: {
  vKt: number;
  organization: number;
  shearUms: number;
  shearVms: number;
  rmwKm?: number;
  outerSizeKm?: number;
}): FlightFrame {
  const base = syntheticFrame();
  const shearMs = Math.hypot(options.shearUms, options.shearVms);
  return syntheticFrame({
    ageH: 36,
    vKt: options.vKt,
    organization: options.organization,
    diagnostics: {
      ...base.diagnostics,
      organization: options.organization,
      organizationTarget: options.organization,
      shearMs,
      shearUms: options.shearUms,
      shearVms: options.shearVms,
    },
    structure: {
      ...base.structure,
      maximumWindKt: options.vKt,
      rmwKm: options.rmwKm ?? 36,
      outerSizeKm: options.outerSizeKm ?? 220,
      shearUms: options.shearUms,
      shearVms: options.shearVms,
    },
  });
}

function contextFor(frame: FlightFrame): RealismFrameContext {
  return {
    frame,
    genesis: { lat: 16, lon: 64 },
    envShear: {
      u: frame.structure.shearUms,
      v: frame.structure.shearVms,
      magnitude: Math.hypot(
        frame.structure.shearUms,
        frame.structure.shearVms,
      ),
    },
    envSteer: { u: -2, v: 3 },
    midlevelRh01: midlevelRhUniform(frame, null),
    monthIndex: 5,
    displayTFrac: 0,
    samplingMode: { kind: 'synoptic-plane', plane: 0 },
  };
}

function cellOffsetKm(field: RealismField, i: number, j: number) {
  const halfDomainHeightKm = (field.cellKm.y * field.n) / 2;
  return {
    east:
      (((i + 0.5) / field.n) * 2 - 1 - field.center.x) *
      field.metricX *
      halfDomainHeightKm,
    north:
      (1 - ((j + 0.5) / field.n) * 2 - field.center.y) *
      halfDomainHeightKm,
  };
}

function eyeSignature(field: RealismField, rmwKm: number) {
  let coreBtSum = 0;
  let coreCloudSum = 0;
  let coreCount = 0;
  let eyewallBtSum = 0;
  let eyewallCloudSum = 0;
  let eyewallCount = 0;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const q = Math.hypot(offset.east, offset.north) / rmwKm;
      if (q <= REALISM_EYE_CORE_Q) {
        coreBtSum += field.btProxyC[index];
        coreCloudSum += field.stormCloud[index];
        coreCount++;
      }
      if (
        q >= REALISM_EYEWALL_RING_Q_MIN &&
        q <= REALISM_EYEWALL_RING_Q_MAX
      ) {
        eyewallBtSum += field.btProxyC[index];
        eyewallCloudSum += field.stormCloud[index];
        eyewallCount++;
      }
    }
  }
  if (coreCount < 4 || eyewallCount < 20) {
    throw new Error('eye and eyewall are undersampled');
  }
  const coreMeanBtC = coreBtSum / coreCount;
  const eyewallMeanBtC = eyewallBtSum / eyewallCount;
  const coreMeanCloud = coreCloudSum / coreCount;
  const eyewallMeanCloud = eyewallCloudSum / eyewallCount;
  return {
    warmContrastC: coreMeanBtC - eyewallMeanBtC,
    clearingContrast: eyewallMeanCloud - coreMeanCloud,
  };
}

interface MaskShape {
  areaKm2: number;
  aspectRatio: number;
  centroidOffsetKm: number;
  /** Undirected major-axis angle from east, in radians. */
  majorAxisBearingRad: number;
}

function axisOffsetDeg(
  axisBearingRad: number,
  vector: { east: number; north: number },
) {
  const vectorBearingRad = Math.atan2(vector.north, vector.east);
  const halfTurnOffset = Math.abs(axisBearingRad - vectorBearingRad) % Math.PI;
  return (
    (Math.min(halfTurnOffset, Math.PI - halfTurnOffset) * 180) /
    Math.PI
  );
}

/**
 * Covariance about the mask's own centroid. A circular shield merely shifted
 * downshear therefore still measures 1:1 and cannot satisfy the shape test.
 */
function maskShape(
  field: RealismField,
  searchRadiusKm: number,
  included: (index: number) => boolean,
): MaskShape {
  const cells: Array<{ east: number; north: number }> = [];
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      if (Math.hypot(offset.east, offset.north) > searchRadiusKm) continue;
      if (included(index)) cells.push(offset);
    }
  }
  if (cells.length < 20) {
    throw new Error('morphology mask is too small to measure');
  }

  const centroid = cells.reduce(
    (sum, cell) => ({
      east: sum.east + cell.east,
      north: sum.north + cell.north,
    }),
    { east: 0, north: 0 },
  );
  centroid.east /= cells.length;
  centroid.north /= cells.length;

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const cell of cells) {
    const east = cell.east - centroid.east;
    const north = cell.north - centroid.north;
    xx += east * east;
    xy += east * north;
    yy += north * north;
  }
  xx /= cells.length;
  xy /= cells.length;
  yy /= cells.length;
  const trace = xx + yy;
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy);
  const major = (trace + spread) / 2;
  const minor = (trace - spread) / 2;
  return {
    areaKm2: cells.length * field.cellKm.x * field.cellKm.y,
    aspectRatio: Math.sqrt(major / Math.max(minor, Number.EPSILON)),
    centroidOffsetKm: Math.hypot(centroid.east, centroid.north),
    majorAxisBearingRad: 0.5 * Math.atan2(2 * xy, xx - yy),
  };
}

function coldShape(field: RealismField, searchRadiusKm: number): MaskShape {
  return maskShape(
    field,
    searchRadiusKm,
    (index) => field.btProxyC[index] < REALISM_COLD_TOP_C,
  );
}

function eyewallColdSectors(field: RealismField, rmwKm: number) {
  const btSum = new Array<number>(12).fill(0);
  const coldCount = new Array<number>(12).fill(0);
  const count = new Array<number>(12).fill(0);
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const q = Math.hypot(offset.east, offset.north) / rmwKm;
      if (q < 0.72 || q > 1.45) continue;
      const angle = Math.atan2(offset.north, offset.east);
      const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12) % 12;
      btSum[sector] += field.btProxyC[index];
      if (field.btProxyC[index] < REALISM_COLD_TOP_C) coldCount[sector]++;
      count[sector]++;
    }
  }
  if (Math.min(...count) === 0) {
    throw new Error('eyewall sectors are undersampled');
  }
  return {
    meanBtC: btSum.map((sum, sector) => sum / count[sector]),
    coldCoverage: coldCount.map((cells, sector) => cells / count[sector]),
  };
}

describe('simulated IR morphology', () => {
  const moderate = stormFrame({
    vKt: 70,
    organization: 0.7,
    shearUms: 16,
    shearVms: 8,
  });

  it('deforms a moderate sheared CDO instead of only displacing a circle', () => {
    const field = buildRealismField(contextFor(moderate), openOcean());
    const shape = maskShape(
      field,
      // outerSizeKm is the wind-structure scale, not a hard cloud edge. The
      // mature CDO is intentionally allowed to extend beyond it, so measure
      // the full shield instead of circularly clipping the anisotropic tail.
      moderate.structure.outerSizeKm * 1.8,
      (index) => field.stormCloud[index] >= DENSE_CDO_COVER,
    );
    const majorAxisToShearDeg = axisOffsetDeg(shape.majorAxisBearingRad, {
      east: moderate.structure.shearUms,
      north: moderate.structure.shearVms,
    });

    expect(shape.aspectRatio).toBeGreaterThan(1.3);
    expect(majorAxisToShearDeg).toBeLessThan(
      MAX_DOWNSHEAR_AXIS_OFFSET_DEG,
    );
  });

  it('leaves sector-scale cold-top variation and gaps around a moderate core', () => {
    const field = buildRealismField(contextFor(moderate), openOcean());
    const sectors = eyewallColdSectors(field, moderate.structure.rmwKm);
    const coldestMean = Math.min(...sectors.meanBtC);
    const warmestMean = Math.max(...sectors.meanBtC);
    const leastCold = Math.min(...sectors.coldCoverage);
    const mostCold = Math.max(...sectors.coldCoverage);

    expect(mostCold - leastCold).toBeGreaterThanOrEqual(0.35);
    expect(leastCold).toBeLessThanOrEqual(0.625);
    expect(warmestMean - coldestMean).toBeGreaterThan(18);
  });

  it('does not collapse the dense moderate core into a palette-clipped thermal disc', () => {
    const field = buildRealismField(contextFor(moderate), openOcean());
    const coreBtC: number[] = [];
    for (let j = 0; j < field.n; j++) {
      for (let i = 0; i < field.n; i++) {
        const index = j * field.n + i;
        const offset = cellOffsetKm(field, i, j);
        const q =
          Math.hypot(offset.east, offset.north) /
          moderate.structure.rmwKm;
        // Exclude the warm eye: it must not be able to fake thermal texture in
        // an otherwise uniform cold disc. The outer bound retains the CDO and
        // eyewall while excluding the already-tested cirrus shield.
        if (q < 0.75 || q > 4 || field.stormCloud[index] < DENSE_CDO_COVER) {
          continue;
        }
        coreBtC.push(field.btProxyC[index]);
      }
    }
    coreBtC.sort((a, b) => a - b);
    const q25 = coreBtC[Math.floor((coreBtC.length - 1) * 0.25)];
    const q75 = coreBtC[Math.floor((coreBtC.length - 1) * 0.75)];
    const clippedFraction = coreBtC.filter(
      (btC) => btC <= PALETTE_COLD_CLIP_C,
    ).length / coreBtC.length;

    expect(coreBtC.length).toBeGreaterThan(100);
    expect(q75 - q25).toBeGreaterThan(MIN_DENSE_CORE_BT_IQR_C);
    expect(clippedFraction).toBeLessThan(
      MAX_DENSE_CORE_CLIPPED_FRACTION,
    );
  });

  it('only carves a warm eye in mature low-shear storms', () => {
    const matureCalm = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 0,
      shearVms: 0,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const matureHighShear = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 22,
      shearVms: 0,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const moderateEye = eyeSignature(
      buildRealismField(contextFor(moderate), openOcean()),
      moderate.structure.rmwKm,
    );
    const matureCalmEye = eyeSignature(
      buildRealismField(contextFor(matureCalm), openOcean()),
      matureCalm.structure.rmwKm,
    );
    const matureHighShearEye = eyeSignature(
      buildRealismField(contextFor(matureHighShear), openOcean()),
      matureHighShear.structure.rmwKm,
    );

    expect(moderateEye.warmContrastC).toBeLessThan(
      MAX_SUPPRESSED_EYE_BT_CONTRAST_C,
    );
    expect(moderateEye.clearingContrast).toBeLessThan(
      MAX_SUPPRESSED_EYE_CLEARING,
    );
    expect(matureCalmEye.warmContrastC).toBeGreaterThan(
      MIN_MATURE_EYE_BT_CONTRAST_C,
    );
    expect(matureCalmEye.clearingContrast).toBeGreaterThan(
      MIN_MATURE_EYE_CLEARING,
    );
    expect(matureHighShearEye.warmContrastC).toBeLessThan(
      MAX_SUPPRESSED_EYE_BT_CONTRAST_C,
    );
    expect(matureHighShearEye.clearingContrast).toBeLessThan(
      MAX_SUPPRESSED_EYE_CLEARING,
    );
  });

  it('keeps a mature cold footprint in the same order and exactly deterministic', () => {
    const sheared = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 14,
      shearVms: 7,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const calm = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 0,
      shearVms: 0,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const shearedField = buildRealismField(contextFor(sheared), openOcean());
    const repeated = buildRealismField(contextFor(sheared), openOcean());
    const calmField = buildRealismField(contextFor(calm), openOcean());
    const shearedArea = coldShape(
      shearedField,
      sheared.structure.outerSizeKm,
    ).areaKm2;
    const calmArea = coldShape(calmField, calm.structure.outerSizeKm).areaKm2;

    expect(shearedArea / calmArea).toBeGreaterThan(0.45);
    expect(shearedArea / calmArea).toBeLessThan(2.2);
    expect(repeated.btProxyC).toEqual(shearedField.btProxyC);
    expect(repeated.stormCloud).toEqual(shearedField.stormCloud);
  });

  it('keeps a calm mature compact storm from becoming an extreme comma', () => {
    const calm = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 0,
      shearVms: 0,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const field = buildRealismField(contextFor(calm), openOcean());
    const shape = coldShape(field, calm.structure.outerSizeKm);

    expect(shape.aspectRatio).toBeLessThan(1.5);
    expect(shape.centroidOffsetKm).toBeLessThan(
      calm.structure.outerSizeKm * 0.25,
    );
  });
});
