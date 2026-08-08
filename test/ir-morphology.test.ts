import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FlightFrame } from '../src/flight-recorder';
import { DOMAIN } from '../src/grid';
import { DType } from '../src/types';
import type { BinLayer, ParsedBin } from '../src/types';
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

/**
 * A moisture-starved flat environment (RH 20%, below AMBIENT_RH_DRIVE_LO;
 * SST 28 C, the null-envBin value). The wave-2 environmental deck reads only
 * localRh from the plane, so this keeps every OTHER input byte-identical to
 * openOcean while silencing ambient cloud — for pins that must measure the
 * storm's own morphology, not storm-plus-environment.
 */
function uniformEnvironment(rhPct: number) {
  const layer = (name: string, value: number): BinLayer => ({
    name,
    dtype: DType.float32,
    quantized: false,
    nx: 2,
    ny: 1,
    nt: 1,
    bbox: DOMAIN,
    scale: 1,
    offset: 0,
    data: new Float32Array([value, value]),
  });
  const layers = [layer('rh_05', rhPct), layer('sst_05', 28)];
  return {
    envBin: {
      version: 1,
      layers: new Map(layers.map((l) => [l.name, l])),
    } as ParsedBin,
    land01At: () => 0,
    noise: new RealismNoise(),
    debris: null,
  };
}

function dryEnvironment() {
  return uniformEnvironment(20);
}

function moistEnvironment() {
  return uniformEnvironment(65);
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

function contextFor(
  frame: FlightFrame,
  genesis = { lat: 16, lon: 64 },
): RealismFrameContext {
  return {
    frame,
    genesis,
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

function connectedComponentSizes(active: Uint8Array, n: number): number[] {
  const seen = new Uint8Array(active.length);
  const componentSizes: number[] = [];
  for (let start = 0; start < active.length; start++) {
    if (!active[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      size++;
      const x = index % n;
      const y = Math.floor(index / n);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const neighbour = ny * n + nx;
          if (active[neighbour] && !seen[neighbour]) {
            seen[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }
    }
    componentSizes.push(size);
  }
  return componentSizes.sort((a, b) => b - a);
}

interface WeakColdTopology {
  cells: number;
  meaningfulCells: number;
  centroidOffsetKm: number;
  meaningfulComponents: number;
  largestComponentShare: number;
  maxAnnularClosure: number;
}

const MIN_WEAK_COMPONENT_CELLS = 8;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function weakColdTopology(
  field: RealismField,
  thresholdC: number,
): WeakColdTopology {
  const active = new Uint8Array(field.n * field.n);
  const sectorCold = Array.from({ length: 15 }, () => new Uint16Array(24));
  const sectorTotal = Array.from({ length: 15 }, () => new Uint16Array(24));
  let cells = 0;
  let eastSum = 0;
  let northSum = 0;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const radiusKm = Math.hypot(offset.east, offset.north);
      if (radiusKm > 360) continue;
      const annulus = Math.floor(radiusKm / 25);
      const angle = Math.atan2(offset.north, offset.east);
      const sector = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 24) % 24;
      sectorTotal[annulus][sector]++;
      const brightnessC = field.btProxyC[index];
      if (!Number.isFinite(brightnessC)) {
        throw new Error('weak cold-top field contains a non-finite value');
      }
      if (brightnessC > thresholdC) continue;
      sectorCold[annulus][sector]++;
      active[index] = 1;
      cells++;
      eastSum += offset.east;
      northSum += offset.north;
    }
  }
  if (cells === 0) {
    return {
      cells: 0,
      meaningfulCells: 0,
      centroidOffsetKm: 0,
      meaningfulComponents: 0,
      largestComponentShare: 1,
      maxAnnularClosure: 0,
    };
  }
  const componentSizes = connectedComponentSizes(active, field.n);
  const meaningfulComponentSizes = componentSizes.filter(
    (size) => size >= MIN_WEAK_COMPONENT_CELLS,
  );
  const meaningfulCells = meaningfulComponentSizes.reduce(
    (sum, size) => sum + size,
    0,
  );
  let maxAnnularClosure = 0;
  for (let annulus = 1; annulus < sectorTotal.length; annulus++) {
    let covered = 0;
    let sampled = 0;
    for (let sector = 0; sector < 24; sector++) {
      if (sectorTotal[annulus][sector] === 0) continue;
      sampled++;
      if (
        sectorCold[annulus][sector] / sectorTotal[annulus][sector] >= 0.25
      ) {
        covered++;
      }
    }
    if (sampled >= 12) {
      maxAnnularClosure = Math.max(maxAnnularClosure, covered / sampled);
    }
  }
  return {
    cells,
    meaningfulCells,
    centroidOffsetKm: Math.hypot(eastSum / cells, northSum / cells),
    meaningfulComponents: meaningfulComponentSizes.length,
    largestComponentShare:
      meaningfulCells > 0 ? meaningfulComponentSizes[0] / meaningfulCells : 1,
    maxAnnularClosure,
  };
}

function fieldDigest(values: Float32Array): string {
  return createHash('sha256')
    .update(
      new Uint8Array(
        values.buffer,
        values.byteOffset,
        values.byteLength,
      ) as unknown as string,
    )
    .digest('hex');
}

interface RenderedBandTexture {
  maskedCells: number;
  coldCells: number;
  warmFringeCells: number;
  meaningfulColdComponents: number;
  largestColdComponentShare: number;
  meanHighPassC: number;
}

// Mechanically selected nearest integer genesis lat/lon for cloud-seed targets
// 0.05, 0.15, ... 0.95 across the Arabian Sea search box; not hand-picked for
// favorable morphology.
const RGR004_SEED_DECILES = [
  { lat: 9, lon: 72 },
  { lat: 21, lon: 53 },
  { lat: 24, lon: 52 },
  { lat: 24, lon: 71 },
  { lat: 19, lon: 51 },
  { lat: 25, lon: 54 },
  { lat: 23, lon: 66 },
  { lat: 19, lon: 77 },
  { lat: 14, lon: 75 },
  { lat: 21, lon: 71 },
] as const;

interface ThermalCounts {
  support: number;
  active: number;
  convective: number;
}

function thermalCounts(
  field: RealismField,
  innerRadiusKm: number,
  outerRadiusKm: number,
): ThermalCounts {
  let support = 0;
  let active = 0;
  let convective = 0;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const radiusKm = Math.hypot(offset.east, offset.north);
      if (radiusKm < innerRadiusKm || radiusKm >= outerRadiusKm) continue;
      if (Math.max(field.bands[index], field.precipBandCloud[index]) < 0.1) {
        continue;
      }
      support++;
      if (field.btProxyC[index] <= -20) active++;
      if (field.btProxyC[index] <= -30) convective++;
    }
  }
  return { support, active, convective };
}

function addThermalCounts(target: ThermalCounts, source: ThermalCounts): void {
  target.support += source.support;
  target.active += source.active;
  target.convective += source.convective;
}

interface SideColdCounts {
  support: number;
  cold: number;
}

function shearSideColdCounts(
  field: RealismField,
  shearUms: number,
  shearVms: number,
): { right: SideColdCounts; left: SideColdCounts } {
  const shearLength = Math.hypot(shearUms, shearVms);
  if (shearLength <= 0) throw new Error('shear direction is undefined');
  const right = { support: 0, cold: 0 };
  const left = { support: 0, cold: 0 };
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const radiusKm = Math.hypot(offset.east, offset.north);
      if (radiusKm < 230 || radiusKm >= 400) continue;
      if (Math.max(field.bands[index], field.precipBandCloud[index]) < 0.1) {
        continue;
      }
      const normalizedRightDot =
        (offset.east * shearVms - offset.north * shearUms) /
        (radiusKm * shearLength);
      const target =
        normalizedRightDot >= 0.5
          ? right
          : normalizedRightDot <= -0.5
            ? left
            : null;
      if (!target) continue;
      target.support++;
      if (field.btProxyC[index] <= -25) target.cold++;
    }
  }
  return { right, left };
}

function addSideCounts(target: SideColdCounts, source: SideColdCounts): void {
  target.support += source.support;
  target.cold += source.cold;
}

function coldRate(counts: SideColdCounts): number {
  return counts.cold / counts.support;
}

function precipBandDigest(field: RealismField): string {
  const bytes = new Uint8Array(field.precipBandCloud.length * 2);
  field.precipBandCloud.forEach((value, index) => {
    const quantized = Math.round(value * 1024);
    bytes[index * 2] = quantized & 0xff;
    bytes[index * 2 + 1] = quantized >>> 8;
  });
  // The repo's minimal node:crypto shim types update() as string-only, while
  // Node accepts Uint8Array at runtime (the same pattern as hf6-contract.test).
  return createHash('sha256')
    .update(bytes as unknown as string)
    .digest('hex');
}

/** Final BT-proxy topology inside the same band mask used by R2a. */
function renderedBandTexture(
  field: RealismField,
  coldThresholdC = -45,
  innerRadiusKm = 200,
): RenderedBandTexture {
  const cold = new Uint8Array(field.n * field.n);
  const bandMask = new Uint8Array(field.n * field.n);
  let maskedCells = 0;
  let coldCells = 0;
  let warmFringeCells = 0;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const index = j * field.n + i;
      const offset = cellOffsetKm(field, i, j);
      const radiusKm = Math.hypot(offset.east, offset.north);
      if (radiusKm < innerRadiusKm || radiusKm > 500) continue;
      if (Math.max(field.bands[index], field.precipBandCloud[index]) < 0.1) {
        continue;
      }
      bandMask[index] = 1;
      maskedCells++;
      if (field.btProxyC[index] <= coldThresholdC) {
        cold[index] = 1;
        coldCells++;
      }
      if (field.btProxyC[index] >= -20) warmFringeCells++;
    }
  }
  const componentSizes = connectedComponentSizes(cold, field.n);
  let highPassSum = 0;
  let textureCount = 0;
  for (let j = 1; j < field.n - 1; j++) {
    for (let i = 1; i < field.n - 1; i++) {
      const index = j * field.n + i;
      if (!bandMask[index]) continue;
      if (
        !bandMask[index + 1] ||
        !bandMask[index - 1] ||
        !bandMask[index - field.n] ||
        !bandMask[index + field.n]
      ) {
        continue;
      }
      const east = field.btProxyC[index + 1];
      const west = field.btProxyC[index - 1];
      const north = field.btProxyC[index - field.n];
      const south = field.btProxyC[index + field.n];
      highPassSum += Math.abs(
        field.btProxyC[index] - (east + west + north + south) / 4,
      );
      textureCount++;
    }
  }
  if (maskedCells === 0) {
    throw new Error('rendered band mask is undersampled');
  }
  return {
    maskedCells,
    coldCells,
    warmFringeCells,
    meaningfulColdComponents: componentSizes.filter((size) => size >= 3).length,
    largestColdComponentShare:
      coldCells > 0 && componentSizes[0] !== undefined
        ? componentSizes[0] / coldCells
        : 0,
    meanHighPassC: highPassSum / textureCount,
  };
}

describe('simulated IR morphology', () => {
  const moderate = stormFrame({
    vKt: 70,
    organization: 0.7,
    shearUms: 16,
    shearVms: 8,
  });

  it('renders weak systems as displaced multi-lobe burst complexes', () => {
    const baseWeak = stormFrame({
      vKt: 35,
      organization: 0.3,
      shearUms: 12,
      shearVms: 6,
      rmwKm: 60,
      outerSizeKm: 180,
    });
    const weak: FlightFrame = {
      ...baseWeak,
      diagnostics: {
        ...baseWeak.diagnostics,
        eyewallRainMmH: 6,
        rainbandRainMmH: 3,
        totalRainMmH: 9,
      },
      structure: {
        ...baseWeak.structure,
        centralPressureHpa: 1000,
        hollandB: 1.2,
      },
    };
    const sources = dryEnvironment();
    const fields = RGR004_SEED_DECILES.map((genesis) =>
      buildRealismField(contextFor(weak, genesis), sources),
    );
    const midCold = fields.map((field) => weakColdTopology(field, -40));
    const deepLobes = fields.map((field) => weakColdTopology(field, -50));
    const repeated = buildRealismField(
      contextFor(weak, RGR004_SEED_DECILES[0]),
      sources,
    );

    const nonemptyDeepLobes = deepLobes.filter((value) => value.cells > 0);

    // The -40 C field must remain displaced and open without demanding the
    // broad, smooth cold shield that produced the rejected Gaussian bridge.
    // The -50 C mask resolves embedded towers. Seed-dependent dominance is
    // expected, so fragmentation is guarded by prevalence across the decile
    // sample instead of forcing every case into equal-sized clover lobes.
    expect(median(midCold.map((value) => value.cells))).toBeGreaterThanOrEqual(
      75,
    );
    expect(median(midCold.map((value) => value.cells))).toBeLessThanOrEqual(
      300,
    );
    expect(
      median(midCold.map((value) => value.centroidOffsetKm)),
    ).toBeGreaterThanOrEqual(70);
    expect(
      median(midCold.map((value) => value.maxAnnularClosure)),
    ).toBeLessThanOrEqual(0.5);
    expect(
      midCold.filter((value) => value.maxAnnularClosure < 0.7).length,
    ).toBeGreaterThanOrEqual(9);
    expect(nonemptyDeepLobes.length).toBeGreaterThanOrEqual(9);
    expect(
      deepLobes.filter(
        (value) =>
          value.meaningfulComponents >= 2 &&
          value.largestComponentShare <= 0.85,
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      deepLobes.filter((value) => value.meaningfulCells > 0).length,
    ).toBeGreaterThanOrEqual(7);
    expect(
      median(nonemptyDeepLobes.map((value) => value.centroidOffsetKm)),
    ).toBeGreaterThanOrEqual(70);
    expect(
      median(deepLobes.map((value) => value.meaningfulCells)),
    ).toBeGreaterThanOrEqual(35);
    expect(
      median(deepLobes.map((value) => value.meaningfulCells)),
    ).toBeLessThanOrEqual(200);

    // Rain support is owned by the physical precipitation branch and remains
    // byte-identical while only presentation morphology changes.
    expect(precipBandDigest(fields[0])).toBe(
      'a4fd804aa3d5e53973f8d6950e298173f34a3504871303a78e1a2d52b5269b06',
    );
    expect(repeated.btProxyC).toEqual(fields[0].btProxyC);
    expect(fields[1].btProxyC).not.toEqual(fields[0].btProxyC);
  }, 30_000);

  it('keeps the accepted moderate and mature fields byte-identical', () => {
    const mature = stormFrame({
      vKt: 100,
      organization: 0.93,
      shearUms: 14,
      shearVms: 7,
      rmwKm: 26,
      outerSizeKm: 180,
    });
    const moderateField = buildRealismField(contextFor(moderate), openOcean());
    const matureField = buildRealismField(contextFor(mature), openOcean());

    expect(fieldDigest(moderateField.btProxyC)).toBe(
      'a7fe758147bcf9aae4616cf245a552af6159b5ef97598f3d96465e4644c81264',
    );
    expect(fieldDigest(moderateField.stormCloud)).toBe(
      'b2735085fd1b765566ec3e8786365598c053a4f983abb46c61683ab6af76ac61',
    );
    expect(fieldDigest(matureField.btProxyC)).toBe(
      'a278bebe0b2fd219a12075444665f71655586a4d01910794903954139c1cf8ce',
    );
    expect(fieldDigest(matureField.stormCloud)).toBe(
      '8812994758fcbeeffb5377a222e73bbdf9c5be5ffc1a2577b4980466f7eb7c5f',
    );
  });

  it('does not carve a dark burst-shaped hole after moist zero-rain decay', () => {
    const baseDecay = stormFrame({
      vKt: 19,
      organization: 0.1,
      shearUms: 24,
      shearVms: 10,
      rmwKm: 80,
      outerSizeKm: 180,
    });
    const decay: FlightFrame = {
      ...baseDecay,
      diagnostics: {
        ...baseDecay.diagnostics,
        eyewallRainMmH: 0,
        rainbandRainMmH: 0,
        totalRainMmH: 0,
      },
      structure: {
        ...baseDecay.structure,
        centralPressureHpa: 1007,
        hollandB: 1.1,
      },
    };
    const field = buildRealismField(contextFor(decay), moistEnvironment());
    let maxStormCloud = 0;
    let maxAmbientDeficit = 0;
    let ambientDeficitSum = 0;
    let coldCells = 0;
    for (let index = 0; index < field.cloud.length; index++) {
      maxStormCloud = Math.max(maxStormCloud, field.stormCloud[index]);
      const deficit = Math.max(
        0,
        field.ambientCloud[index] - field.cloud[index],
      );
      maxAmbientDeficit = Math.max(maxAmbientDeficit, deficit);
      ambientDeficitSum += deficit;
      if (field.btProxyC[index] <= -40) coldCells++;
    }

    expect(coldCells).toBe(0);
    expect(maxStormCloud).toBeLessThan(0.35);
    expect(maxAmbientDeficit).toBeLessThan(0.12);
    expect(ambientDeficitSum / field.cloud.length).toBeLessThan(0.005);
  });

  it('renders discrete cold cells inside a broad warm stratiform band', () => {
    const field = buildRealismField(contextFor(moderate), dryEnvironment());
    const compactBandFrame = stormFrame({
      vKt: 70,
      organization: 0.7,
      shearUms: 16,
      shearVms: 8,
      rmwKm: 50,
      outerSizeKm: 120,
    });
    const compactContext = contextFor(compactBandFrame);
    const compactBandField = buildRealismField(
      compactContext,
      dryEnvironment(),
    );
    const repeated = buildRealismField(compactContext, dryEnvironment());
    const alternateSeed = buildRealismField(
      { ...compactContext, genesis: { lat: 17, lon: 65 } },
      dryEnvironment(),
    );
    // Keep the compact CDO inside this 4+ RMW annulus so the gate measures
    // final rendered band BT rather than a connected cold core or an
    // intermediate mask. On the sealed pre-RGR-004 baseline this same ROI had
    // 154 cold cells in four components, with 46.1% in the largest component
    // and a 0.920 °C one-cell high-pass residual.
    const rendered = renderedBandTexture(compactBandField, -25, 200);
    let precipSupportSum = 0;
    let precipSupportMax = 0;
    let precipSupportNonzero = 0;
    for (const value of field.precipBandCloud) {
      const quantized = Math.round(value * 1024);
      precipSupportSum += quantized;
      precipSupportMax = Math.max(precipSupportMax, quantized);
      if (quantized > 0) precipSupportNonzero++;
    }
    expect(rendered.maskedCells).toBeGreaterThan(3_500);
    expect(rendered.warmFringeCells / rendered.maskedCells).toBeGreaterThan(
      0.91,
    );
    expect(rendered.warmFringeCells / rendered.maskedCells).toBeLessThan(0.95);
    expect(rendered.coldCells).toBeGreaterThanOrEqual(160);
    expect(rendered.coldCells).toBeLessThanOrEqual(230);
    expect(rendered.meaningfulColdComponents).toBeGreaterThanOrEqual(7);
    expect(rendered.largestColdComponentShare).toBeLessThanOrEqual(0.35);
    expect(rendered.meanHighPassC).toBeGreaterThan(1.8);
    expect(rendered.meanHighPassC).toBeLessThan(2.1);
    // RGR-004 is presentation-only: the exact rain-aligned cloud-support arm
    // stays byte-for-byte on the pre-change footprint.
    expect(precipSupportSum).toBe(889_779);
    expect(precipSupportMax).toBe(528);
    expect(precipSupportNonzero).toBe(3_264);
    expect(precipBandDigest(field)).toBe(
      'cf8c31d5db1710f07a059b0bbbd4ab57f67255c1610978802d07348fdadbdd00',
    );
    expect(repeated.btProxyC).toEqual(compactBandField.btProxyC);
    expect(alternateSeed.btProxyC).not.toEqual(compactBandField.btProxyC);
  });

  it('organizes final cold cells right of every cardinal shear direction', () => {
    const directions = [
      { u: 18, v: 0 },
      { u: 0, v: 18 },
      { u: -18, v: 0 },
      { u: 0, v: -18 },
    ];
    const sources = dryEnvironment();
    for (const direction of directions) {
      const frame = stormFrame({
        vKt: 70,
        organization: 0.7,
        shearUms: direction.u,
        shearVms: direction.v,
        rmwKm: 50,
        outerSizeKm: 70,
      });
      const pooledRight = { support: 0, cold: 0 };
      const pooledLeft = { support: 0, cold: 0 };
      let positiveSeeds = 0;
      for (const genesis of RGR004_SEED_DECILES) {
        const field = buildRealismField(
          contextFor(frame, genesis),
          sources,
        );
        const sides = shearSideColdCounts(
          field,
          direction.u,
          direction.v,
        );
        addSideCounts(pooledRight, sides.right);
        addSideCounts(pooledLeft, sides.left);
        if (coldRate(sides.right) > coldRate(sides.left)) positiveSeeds++;
      }
      const rightRate = coldRate(pooledRight);
      const leftRate = coldRate(pooledLeft);
      expect(pooledRight.support).toBeGreaterThan(500);
      expect(pooledLeft.support).toBeGreaterThan(500);
      expect(rightRate / leftRate).toBeGreaterThanOrEqual(1.1);
      expect(rightRate - leftRate).toBeGreaterThanOrEqual(0.003);
      expect(positiveSeeds).toBeGreaterThanOrEqual(7);
    }
  }, 60_000);

  it('makes outer bands sparser and more convectively concentrated', () => {
    const calmFrame = stormFrame({
      vKt: 70,
      organization: 0.7,
      shearUms: 0,
      shearVms: 0,
      rmwKm: 50,
      outerSizeKm: 70,
    });
    const sources = dryEnvironment();
    const pooledInner = { support: 0, active: 0, convective: 0 };
    const pooledOuter = { support: 0, active: 0, convective: 0 };
    let outerPurerSeeds = 0;
    for (const genesis of RGR004_SEED_DECILES) {
      const field = buildRealismField(
        contextFor(calmFrame, genesis),
        sources,
      );
      const inner = thermalCounts(field, 100, 170);
      const outer = thermalCounts(field, 230, 330);
      addThermalCounts(pooledInner, inner);
      addThermalCounts(pooledOuter, outer);
      if (
        outer.convective / outer.active >
        inner.convective / inner.active
      ) {
        outerPurerSeeds++;
      }
    }
    const innerOccupancy = pooledInner.active / pooledInner.support;
    const outerOccupancy = pooledOuter.active / pooledOuter.support;
    const innerPurity = pooledInner.convective / pooledInner.active;
    const outerPurity = pooledOuter.convective / pooledOuter.active;
    expect(pooledInner.active).toBeGreaterThanOrEqual(500);
    expect(pooledOuter.active).toBeGreaterThanOrEqual(500);
    expect(outerOccupancy / innerOccupancy).toBeLessThanOrEqual(0.7);
    expect(outerPurity / innerPurity).toBeGreaterThanOrEqual(1.05);
    expect(outerPurerSeeds).toBeGreaterThanOrEqual(7);
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
    // Dry environment: the RGR-001 deck legitimately fills cloud gaps with
    // ambient cloud (that is its job), which narrows sector BT contrast. This
    // pin is about the STORM leaving gaps, so it measures against a sky the
    // deck cannot populate.
    const field = buildRealismField(contextFor(moderate), dryEnvironment());
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
