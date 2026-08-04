/**
 * realism-field.ts — the R2a measurement-field rasterizer.
 *
 * Owns the quantized env-plane sampler and `buildRealismField`, which walks the
 * `sampleCloud()` twin in `realism-cloud-sample.ts` over a fixed measurement
 * grid. Import it through `src/realism-proxy.ts`, the harness's single import
 * surface.
 *
 * The only edge back to `realism-proxy.ts` is `import type { DebrisState }`,
 * which TypeScript erases — the runtime module graph stays acyclic.
 */

import { envMonthSuffix } from './env-sampler';
import type { FlightFrame } from './flight-recorder';
import { DOMAIN, clipToLatLon, latLonToCell, latLonToClip } from './grid';
import { sampleCloudProxy } from './realism-cloud-sample';
import type { CloudUniforms } from './realism-cloud-sample';
import { cellUv, clamp01, mix } from './realism-glsl';
import type { RealismNoise } from './realism-glsl';
import type { DebrisState } from './realism-proxy';
import { cloudMetricX, cloudSeedFromGenesis } from './render/cloud-motion';
import { rainCenterClip } from './render/precipitating-cloud';
import {
  HALF_DOMAIN_HEIGHT_KM,
  stormRenderRadii,
} from './render/storm-radii';
import {
  SST_MAX_C,
  SST_MIN_C,
  environmentPlaneInterpolation,
  pickLayer,
} from './render/textures';
import type { BinLayer, EnvSamplingMode, ParsedBin } from './types';

// ---------------------------------------------------------------------------
// Quantized env-plane sampling (App-truth note 5: quantize BEFORE filtering)
// ---------------------------------------------------------------------------

/**
 * CPU twin of one R8 env-texture read. `buildR8Tex` byte-quantizes EVERY source
 * texel and GL then bilinears the BYTES; quantize-then-filter and
 * filter-then-quantize do not commute, so this order is load-bearing.
 * `latLonToCell` already carries the GL texel-centre convention (`- 0.5`) and
 * the clamped col/row mirror CLAMP_TO_EDGE, so the result matches GL exactly.
 * Returns the quantized NORMALIZED value; degC re-expansion is the caller's.
 */
export function quantizedLayerSampler(
  layer: BinLayer,
  normalize: (v: number) => number,
): (plane: number, lat: number, lon: number) => number {
  const { nx, ny, nt, bbox, data } = layer;
  const spec = { nx, ny, bbox };
  return (plane: number, lat: number, lon: number): number => {
    const cell = latLonToCell(spec, lat, lon);
    const col = Math.max(0, Math.min(nx - 1, cell.col));
    const row = Math.max(0, Math.min(ny - 1, cell.row));
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const c1 = Math.min(nx - 1, c0 + 1);
    const r1 = Math.min(ny - 1, r0 + 1);
    const fx = col - c0;
    const fy = row - r0;
    // Per-layer plane clamp, exactly as applyEnv does (`min(plane, nt - 1)`).
    const t = Math.max(0, Math.min(Math.floor(plane), nt - 1));
    const base = t * nx * ny;
    const texel = (r: number, c: number): number => {
      // buildR8Tex's exact byte expression, including its NaN behaviour: a
      // non-finite value falls past both range tests into Math.round(NaN), and
      // the Uint8Array store then coerces that to 0. Here the byte is a plain
      // number, so the coercion has to be written out or a single NaN texel
      // would propagate through the filter into the whole field.
      const n = normalize(data[base + r * nx + c]);
      const byte = n <= 0 ? 0 : n >= 1 ? 255 : Math.round(n * 255);
      return (Number.isFinite(byte) ? byte : 0) / 255;
    };
    const north = texel(r0, c0) * (1 - fx) + texel(r0, c1) * fx;
    const south = texel(r1, c0) * (1 - fx) + texel(r1, c1) * fx;
    return north * (1 - fy) + south * fy;
  };
}

/** The env texture pair the renderer has bound, plus its `u_planeBlend`. */
interface EnvPlaneRead {
  rhAt: (plane: number, lat: number, lon: number) => number;
  sstAt: (plane: number, lat: number, lon: number) => number;
  current: number;
  next: number;
  blend: number;
}

/**
 * Renderer mirror of `RenderRoot.applyEnv` + `syncEnvPlane`: the plane pair and
 * blend come from the reference layer's `nt`, and each field re-clamps that
 * plane to its own `nt`.
 *
 * DELIBERATE: the layer suffix is `envMonthSuffix` (season-clamped 04..10) in
 * BOTH sampling modes, because `envMonthNames` in `src/render/index.ts` clamps
 * unconditionally - the proxy mirrors what the RENDERER uploads, not what
 * physics reads through `eventMonthSuffix`. Diverging here would measure a
 * plane the app never draws.
 */
function envPlaneRead(
  bin: ParsedBin,
  monthIndex: number,
  mode: EnvSamplingMode,
  displayTFrac: number,
): EnvPlaneRead {
  const mm = envMonthSuffix(monthIndex);
  const rhL = pickLayer(bin, [`rh_${mm}`, 'rh']);
  const sstL = pickLayer(bin, [`sst_${mm}`, 'sst']);
  const reference = pickLayer(bin, [`u_${mm}`, `rh_${mm}`, `sst_${mm}`]);
  if (!rhL || !sstL || !reference) {
    throw new Error(
      `realism field: env bin lacks the rh/sst/reference layers for month ${mm}`,
    );
  }
  const interpolation = environmentPlaneInterpolation(
    reference.nt,
    mode,
    displayTFrac,
  );
  return {
    rhAt: quantizedLayerSampler(rhL, (v) => v / 100),
    sstAt: quantizedLayerSampler(
      sstL,
      (v) => (v - SST_MIN_C) / (SST_MAX_C - SST_MIN_C),
    ),
    current: interpolation.current,
    next: interpolation.next,
    blend: interpolation.blend,
  };
}

// ---------------------------------------------------------------------------
// Measurement field
// ---------------------------------------------------------------------------

/** Measurement grid edge. 192^2 cells over the whole DOMAIN. */
export const REALISM_GRID_N = 192;

/**
 * `u_midlevelRh` exactly as `EnvLayer.draw` computes it (App-truth note 6):
 * the storm's own ventilation RH wins, then the centre env sample, then 55%.
 */
export function midlevelRhUniform(
  frame: FlightFrame,
  envSample: { midlevelRhPct: number } | null,
): number {
  return clamp01(
    (frame.diagnostics.ventilationMeanRhPct ?? envSample?.midlevelRhPct ?? 55) /
      100,
  );
}

export interface RealismFrameContext {
  frame: FlightFrame;
  /** First track point - the cloud seed (`cloudSeedFromGenesis`). */
  genesis: { lat: number; lon: number } | null;
  /** Render-side env sample at the storm centre (`u_shearVector`). */
  envShear: { u: number; v: number; magnitude: number };
  envSteer: { u: number; v: number };
  /** Via {@link midlevelRhUniform}. */
  midlevelRh01: number;
  monthIndex: number;
  /** UNOFFSET app render fraction (App-truth note 1); 0 in climatology. */
  displayTFrac: number;
  samplingMode: EnvSamplingMode;
}

export interface RealismSources {
  envBin: ParsedBin | null;
  /**
   * SHADER land mirror: binarize-then-bilinear over the landmask (App-truth
   * note 9). NOT the engine's nearest-cell isLand - that lives in the runner.
   */
  land01At: (lat: number, lon: number) => number;
  noise: RealismNoise;
  debris: DebrisState | null;
}

export interface RealismField {
  n: number;
  metricX: number;
  /** Storm centre, clip units. */
  center: { x: number; y: number };
  /** Metric cell size, km. */
  cellKm: { x: number; y: number };
  /**
   * The shader's final `brightnessC`, quantized 0.01 C. Named btProxyC so it
   * cannot be confused with the shader's INTERNAL component-ladder local
   * `topC` (which excludes ambient cover and the warm-eye restoration).
   */
  btProxyC: Float32Array;
  /** Composite cover, quantized 1/1024. */
  cloud: Float32Array;
  stormCloud: Float32Array;
  ambientCloud: Float32Array;
  /** The shader's `rainbands` component. */
  bands: Float32Array;
  /**
   * The BAND arm of the shader's precipitatingCloud ONLY - precipBandEnvelope
   * * spiral mix * bandSupport * PRECIPITATING_CLOUD_BAND_MAX, times the
   * mix(TEXTURE_FLOOR, 1, macro) factor. The precipitation-EYEWALL arm is
   * deliberately excluded so RGR-004's band mask cannot be contaminated by
   * eyewall gradients.
   */
  precipBandCloud: Float32Array;
  debris: Float32Array;
  /** 1 = ocean (land01At < 0.5). */
  oceanMask: Float32Array;
}

/** 0.01 C store - the cross-libm threshold-flip guard for temperatures. */
function quantizeC(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 1/1024 store - the same guard for cover fractions. */
function quantizeCover(value: number): number {
  return Math.round(value * 1024) / 1024;
}

/**
 * Rasterize the measurement field: a CPU walk of `sampleCloud()` over a
 * REALISM_GRID_N^2 grid covering the whole DOMAIN, in the measurement pose
 * (reducedMotion false, cloudDetail 1, demo false, stormPresence = alive).
 *
 * Row order is `j * n + i` with `v = (j + 0.5) / n`, so j = 0 is the NORTH edge
 * - the same convention {@link DebrisState} documents, which is why the debris
 * read below is a straight index rather than a resample.
 */
export function buildRealismField(
  ctx: RealismFrameContext,
  sources: RealismSources,
): RealismField {
  const n = REALISM_GRID_N;
  const frame = ctx.frame;
  const radii = stormRenderRadii(frame.structure);
  const center = latLonToClip(frame.lat, frame.lon, DOMAIN);
  const metricX = cloudMetricX(frame.lat);
  const u: CloudUniforms = {
    center,
    rainCenter: rainCenterClip(center, frame.structure),
    metricX,
    rMax: radii.rMax,
    rCanopy: radii.rCanopy,
    intensity: clamp01((frame.vKt - 20) / 100),
    organization: frame.organization,
    ageH: frame.ageH,
    cloudAgeH: frame.ageH,
    vmaxMs: frame.structure.maximumWindKt * 0.514444,
    hollandB: frame.structure.hollandB,
    stormPresence: frame.alive ? 1 : 0,
    shearVector: { x: ctx.envShear.u, y: ctx.envShear.v },
    shearAtStorm: ctx.envShear.magnitude,
    steerAtStorm: { x: ctx.envSteer.u, y: ctx.envSteer.v },
    midlevelRh: ctx.midlevelRh01,
    eyewallRain: frame.diagnostics.eyewallRainMmH,
    rainbandRain: frame.diagnostics.rainbandRainMmH,
    cloudSeed: cloudSeedFromGenesis(ctx.genesis),
    hasCloudMemory: sources.debris ? 1 : 0,
    reducedMotion: 0,
    cloudDetail: 1,
  };
  const env = sources.envBin
    ? envPlaneRead(
        sources.envBin,
        ctx.monthIndex,
        ctx.samplingMode,
        ctx.displayTFrac,
      )
    : null;

  const size = n * n;
  // The debris read below is a straight `j * n + i` index, not a resample, so a
  // grid built at any other resolution would silently read the wrong cells (and
  // out of range past the end). Same throw-don't-lie rule as envPlaneRead.
  if (
    sources.debris &&
    (sources.debris.densityBytes.length !== size ||
      sources.debris.ageBytes.length !== size)
  ) {
    throw new Error(
      `realism field: debris grid must be ${n}x${n}; got density ` +
        `${sources.debris.densityBytes.length}, age ${sources.debris.ageBytes.length}`,
    );
  }
  const field: RealismField = {
    n,
    metricX,
    center,
    cellKm: {
      x: (2 / n) * metricX * HALF_DOMAIN_HEIGHT_KM,
      y: (2 / n) * HALF_DOMAIN_HEIGHT_KM,
    },
    btProxyC: new Float32Array(size),
    cloud: new Float32Array(size),
    stormCloud: new Float32Array(size),
    ambientCloud: new Float32Array(size),
    bands: new Float32Array(size),
    precipBandCloud: new Float32Array(size),
    debris: new Float32Array(size),
    oceanMask: new Float32Array(size),
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const index = j * n + i;
      const { u: cellU, v: cellV } = cellUv(i, j, n);
      const geo = clipToLatLon(cellU * 2 - 1, 1 - cellV * 2, DOMAIN);
      const land = sources.land01At(geo.lat, geo.lon);
      // main(): both plane reads are quantized, then blended, then re-expanded.
      // Without a bin this is the unit-test path: an already-quantized 0.5 RH
      // over a flat 28 C ocean.
      const localRh = env
        ? mix(
            env.rhAt(env.current, geo.lat, geo.lon),
            env.rhAt(env.next, geo.lat, geo.lon),
            env.blend,
          )
        : 0.5;
      const sstC = env
        ? mix(
            env.sstAt(env.current, geo.lat, geo.lon),
            env.sstAt(env.next, geo.lat, geo.lon),
            env.blend,
          ) *
            (SST_MAX_C - SST_MIN_C) +
          SST_MIN_C
        : 28;
      const result = sampleCloudProxy(
        u,
        {
          u: cellU,
          v: cellV,
          land,
          sstC,
          localRh,
          memDensity: sources.debris
            ? sources.debris.densityBytes[index] / 255
            : 0,
          memAge: sources.debris ? sources.debris.ageBytes[index] / 255 : 0,
        },
        sources.noise,
      );
      field.btProxyC[index] = quantizeC(result.brightnessC);
      field.cloud[index] = quantizeCover(result.cloud);
      field.stormCloud[index] = quantizeCover(result.stormCloud);
      field.ambientCloud[index] = quantizeCover(result.ambientCloud);
      field.bands[index] = quantizeCover(result.rainbands);
      field.precipBandCloud[index] = quantizeCover(result.precipBandCloud);
      field.debris[index] = quantizeCover(result.debris);
      field.oceanMask[index] = land < 0.5 ? 1 : 0;
    }
  }
  return field;
}
