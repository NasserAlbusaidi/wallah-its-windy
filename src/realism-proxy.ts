/**
 * realism-proxy.ts — CPU "field-space twin" of the simulated-IR composition,
 * built for the R2a realism measurement harness (calibration/realism/).
 *
 * This module rasterizes a deterministic cloud-cover + cloud-top-temperature
 * PROXY field from flight-recorder frames, env bins, and the same exported
 * constants the env shader embeds. It is a measurement instrument, not a
 * renderer: it never runs on the GPU, is never imported by main.ts or any
 * render path, and is NOT pixel-identical to the shader (documented
 * approximations: no relief shading, no palette/compositing, single
 * per-frame metricX, debris at the fixed measurement grid). Metrics computed
 * from it are labeled "simulated cloud-top brightness-temperature proxy"
 * everywhere.
 *
 * Determinism: everything here is a pure function of its arguments; noise
 * comes from the seeded cloudNoiseBytes(128) lattice the renderer uploads.
 */

import { envMonthSuffix } from './env-sampler';
import type { FlightFrame } from './flight-recorder';
import { DOMAIN, clipToLatLon, latLonToCell, latLonToClip } from './grid';
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_PITCH,
  RAINBAND_SPIRAL_ROTATION_PER_H,
} from './rainband-profile';
import {
  CLOUD_MEMORY_DECAY_TAU_H,
  CLOUD_MEMORY_DT_H,
  CLOUD_MEMORY_MACRO_GAIN,
  CLOUD_MEMORY_MAX_ADVECT_KMH,
  CLOUD_MEMORY_OUTFLOW_KMH,
  CLOUD_MEMORY_WINDOW_H,
  DEBRIS_MAX_CLOUD,
  sourceBoundaries,
} from './render/cloud-memory';
import {
  CLOUD_BAND_REFERENCE_Q,
  CLOUD_CROSSFADE_PERIOD_H,
  CLOUD_PULSE_PERIOD_H,
  CLOUD_ROTATION_CAP_RAD_PER_H,
  CLOUD_TOP_BAND_DEVELOPING_C,
  CLOUD_TOP_BAND_MATURE_C,
  CLOUD_TOP_CDO_DEVELOPING_C,
  CLOUD_TOP_CDO_MATURE_C,
  CLOUD_TOP_CIRRUS_COLD_C,
  CLOUD_TOP_CIRRUS_WARM_C,
  DEBRIS_TOP_COLD_C,
  DEBRIS_TOP_WARM_C,
  LEGACY_CLOUD_ROTATION_RAD_PER_H,
  cloudAngularRateAtClipRadius,
  cloudAngularRateRadPerH,
  cloudMetricX,
  cloudSeedFromGenesis,
} from './render/cloud-motion';
import { cloudNoiseBytes } from './render/cloud-noise';
import {
  PRECIPITATING_CLOUD_BAND_FULL_MM_H,
  PRECIPITATING_CLOUD_BAND_MAX,
  PRECIPITATING_CLOUD_EYE_FULL_MM_H,
  PRECIPITATING_CLOUD_RAIN_START_MM_H,
  PRECIPITATING_CLOUD_SPIRAL_FLOOR,
  PRECIPITATING_CLOUD_TEXTURE_FLOOR,
  rainCenterClip,
} from './render/precipitating-cloud';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from './render/storm-radii';
import {
  SST_MAX_C,
  SST_MIN_C,
  environmentPlaneInterpolation,
  pickLayer,
} from './render/textures';
import type { BinLayer, EnvSamplingMode, ParsedBin } from './types';

const NOISE_SIZE = 128;

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** GLSL fract(): x - floor(x), correct for negative inputs. */
export function glslFract(x: number): number {
  return x - Math.floor(x);
}

/**
 * GLSL `mat2(c, -s, s, c) * v` mirror. Column-major: columns (c,-s), (s,c),
 * so the product is (c*x + s*y, -s*x + c*y) — CLOCKWISE for positive angle.
 * env.ts relies on this orientation; do not "fix" it to textbook CCW.
 */
export function glslRotate2(
  angle: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * x + s * y, y: -s * x + c * y };
}

/** Mirror of hash21 in CLOUD_MOTION_GLSL. */
export function glslHash21(px: number, py: number): number {
  return glslFract(Math.sin(px * 127.1 + py * 311.7) * 43758.5453);
}

/** GL LINEAR + REPEAT sampler over the shared 128^2 RGBA cloud-noise bytes. */
export class RealismNoise {
  private readonly bytes = cloudNoiseBytes(NOISE_SIZE);

  private texel(x: number, y: number, channel: 0 | 1 | 2 | 3): number {
    const n = NOISE_SIZE;
    const xi = ((x % n) + n) % n;
    const yi = ((y % n) + n) % n;
    return this.bytes[(yi * n + xi) * 4 + channel] / 255;
  }

  /** GL texture() convention: sample at uv*N - 0.5 with bilinear weights. */
  tap(u: number, v: number, channel: 0 | 1 | 2 | 3): number {
    const x = u * NOISE_SIZE - 0.5;
    const y = v * NOISE_SIZE - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const top =
      this.texel(x0, y0, channel) * (1 - fx) +
      this.texel(x0 + 1, y0, channel) * fx;
    const bottom =
      this.texel(x0, y0 + 1, channel) * (1 - fx) +
      this.texel(x0 + 1, y0 + 1, channel) * fx;
    return top * (1 - fy) + bottom * fy;
  }

  private tap4(u: number, v: number): [number, number, number, number] {
    return [this.tap(u, v, 0), this.tap(u, v, 1), this.tap(u, v, 2), this.tap(u, v, 3)];
  }

  /** Mirror of env.ts GLSL cloudNoise(p): broad + fine channel blends. */
  cloudNoise(px: number, py: number): number {
    const broad = this.tap4(px * 0.10, py * 0.10);
    const fine = this.tap4(px * 0.235 + 0.173, py * 0.235 + 0.619);
    return (
      broad[0] * 0.38 + broad[1] * 0.17 + broad[2] * 0.10 + broad[3] * 0.07 +
      fine[0] * 0.13 + fine[1] * 0.07 + fine[2] * 0.05 + fine[3] * 0.03
    );
  }
}

/**
 * Row order: index `j * n + i` with `u = (i+0.5)/n`, `v = (j+0.5)/n`, so j=0 is
 * the NORTH edge (`cellY = 1 - 2v`). That is vertically flipped relative to a
 * GPU readPixels dump, whose row 0 sits at `v_uv.y = 1`. Consumers must index
 * with this convention or the field reads north-for-south.
 */
export interface DebrisState {
  densityBytes: Uint8Array;
  ageBytes: Uint8Array;
}

/** uv of cell (i, j) on an n-grid — the shader's v_uv convention. */
function cellUv(i: number, j: number, n: number): { u: number; v: number } {
  return { u: (i + 0.5) / n, v: (j + 0.5) / n };
}

/** Bilinear CLAMP_TO_EDGE read of a byte grid at uv, normalized to [0,1]. */
function sampleByteGrid(grid: Uint8Array, n: number, u: number, v: number): number {
  const x = Math.min(n - 1, Math.max(0, u * n - 0.5));
  const y = Math.min(n - 1, Math.max(0, v * n - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = grid[y0 * n + x0] * (1 - fx) + grid[y0 * n + x1] * fx;
  const bottom = grid[y1 * n + x0] * (1 - fx) + grid[y1 * n + x1] * fx;
  return (top * (1 - fy) + bottom * fy) / 255;
}

/** RGBA8 store: round to the nearest byte. */
function toByte(x01: number): number {
  return Math.round(clamp01(x01) * 255);
}

/**
 * CPU mirror of CLOUD_MEMORY_UPDATE_FS at a fixed n-grid: state(k) from a
 * zero field via one advect→source→decay pass per boundary k-18..k-1, byte
 * stored at every pass exactly like the RGBA8 render target. Measurement
 * pose: reducedMotion=false.
 */
export function computeDebrisState(
  k: number,
  frameAtBoundary: (boundaryH: number) => FlightFrame | null,
  noise: RealismNoise,
  cloudSeed: number,
  n: number,
): DebrisState {
  let densityBytes = new Uint8Array(n * n);
  let ageBytes = new Uint8Array(n * n);
  const decay = Math.exp(-CLOUD_MEMORY_DT_H / CLOUD_MEMORY_DECAY_TAU_H);

  for (const boundary of sourceBoundaries(k)) {
    const frame = frameAtBoundary(boundary * CLOUD_MEMORY_DT_H);
    if (!frame) throw new Error(`realism debris: no tape frame at boundary ${boundary}`);
    const center = latLonToClip(frame.lat, frame.lon, DOMAIN);
    const radii = stormRenderRadii(frame.structure);
    const metricX = cloudMetricX(frame.lat);
    const vmaxMs = frame.structure.maximumWindKt * 0.514444;
    const intensity01 = clamp01((frame.vKt - 20) / 100);
    const development = clamp01(0.56 * frame.organization + 0.44 * intensity01);
    const rmwKm = Math.max(radii.rMax, 0.001) * HALF_DOMAIN_HEIGHT_KM;
    const omegaRmwKm =
      Math.max(radii.rMax, RENDER_RADIUS_FLOOR) * HALF_DOMAIN_HEIGHT_KM;

    const nextDensity = new Uint8Array(n * n);
    const nextAge = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const { u, v } = cellUv(i, j, n);
        const cellX = u * 2 - 1;
        const cellY = 1 - v * 2;
        const radialX = (cellX - center.x) * metricX;
        const radialY = cellY - center.y;
        const rLen = Math.hypot(radialX, radialY);
        const rKm = Math.max(rLen * HALF_DOMAIN_HEIGHT_KM, 1);

        // advect: capped Holland rotation + ramped radial outflow (FS mirror)
        const omega = cloudAngularRateRadPerH(
          rKm, omegaRmwKm, vmaxMs, frame.structure.hollandB,
        );
        const tangential = Math.min(omega * rKm, CLOUD_MEMORY_MAX_ADVECT_KMH);
        const outflow =
          CLOUD_MEMORY_OUTFLOW_KMH * smoothstep(1.2 * rmwKm, 2.5 * rmwKm, rKm);
        let velX = 0;
        let velY = 0;
        if (rLen > 1e-5) {
          const invLen = 1 / rLen;
          velX = -radialY * invLen * tangential + radialX * invLen * outflow;
          velY = radialX * invLen * tangential + radialY * invLen * outflow;
        }
        const dispClipX =
          (velX * CLOUD_MEMORY_DT_H) / HALF_DOMAIN_HEIGHT_KM / Math.max(metricX, 1e-5);
        const dispClipY = (velY * CLOUD_MEMORY_DT_H) / HALF_DOMAIN_HEIGHT_KM;
        const backU = u - dispClipX * 0.5;
        const backV = v + dispClipY * 0.5;
        const prevDensity = sampleByteGrid(densityBytes, n, backU, backV);
        const prevAge = sampleByteGrid(ageBytes, n, backU, backV);

        // source: analytic convection envelope, patchy via the shared noise.
        // GLSL: texture(u_cloudNoise, radial * 2.1 + u_seed * 13.0).r — the
        // scalar seed offset is added to BOTH components.
        const q = rLen / Math.max(radii.rMax, 0.001);
        const envelope = development * Math.exp(-((q / 2.6) ** 2));
        const cells = smoothstep(
          0.35, 0.8,
          noise.tap(radialX * 2.1 + cloudSeed * 13.0, radialY * 2.1 + cloudSeed * 13.0, 0),
        );
        const source = envelope * mix(0.35, 1.0, cells) * 0.55;

        // sealed combine rules, then decay + quantized-zero age reset
        let cellDensity = Math.min(1, prevDensity + source);
        let cellAge = (prevAge * prevDensity) / Math.max(prevDensity + source, 1e-5);
        cellDensity *= decay;
        cellAge = cellDensity < 0.5 / 255
          ? 0
          : Math.min(1, cellAge + CLOUD_MEMORY_DT_H / CLOUD_MEMORY_WINDOW_H);
        nextDensity[j * n + i] = toByte(cellDensity);
        nextAge[j * n + i] = toByte(cellAge);
      }
    }
    densityBytes = nextDensity;
    ageBytes = nextAge;
  }
  return { densityBytes, ageBytes };
}

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
    const texel = (r: number, c: number): number =>
      Math.round(clamp01(normalize(data[base + r * nx + c])) * 255) / 255;
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

/**
 * The env fragment shader's uniform block in the measurement pose, field names
 * matching the GLSL uniforms minus their `u_` prefix so the transcription below
 * diffs line-for-line against `sampleCloud()`.
 */
interface CloudUniforms {
  center: { x: number; y: number };
  rainCenter: { x: number; y: number };
  metricX: number;
  rMax: number;
  rCanopy: number;
  intensity: number;
  organization: number;
  ageH: number;
  cloudAgeH: number;
  vmaxMs: number;
  hollandB: number;
  stormPresence: number;
  shearVector: { x: number; y: number };
  shearAtStorm: number;
  steerAtStorm: { x: number; y: number };
  midlevelRh: number;
  eyewallRain: number;
  rainbandRain: number;
  cloudSeed: number;
  hasCloudMemory: number;
  /** 0 in the measurement pose - `animGate` is therefore 1. */
  reducedMotion: number;
  /** 1 in the measurement pose - the detail-tier `fine` branch. */
  cloudDetail: number;
}

/** Per-cell shader inputs the enclosing pass resolves before `sampleCloud()`. */
interface CloudCellInputs {
  /** `v_uv`. */
  u: number;
  v: number;
  /** `texture(u_land, v_uv).r` - binarized-then-bilinear (App-truth note 9). */
  land: number;
  /** main()'s blended, re-expanded `sstC`. */
  sstC: number;
  /** sampleCloud()'s `localRh`, hoisted so the env sampler stays out of it. */
  localRh: number;
  /** `memoryPacked.r` at crossfade fraction 0. */
  memDensity: number;
  /** `memoryPacked.g` at crossfade fraction 0. */
  memAge: number;
}

/** The GLSL `CloudField` struct plus the harness-only band arm. */
interface ProxyCloudField {
  cloud: number;
  stormCloud: number;
  ambientCloud: number;
  brightnessC: number;
  rainbands: number;
  precipBandCloud: number;
  debris: number;
}

/**
 * The GLSL emits these two through `toFixed(2)`; recomputing them in float64
 * would give 0.36000000000000004. Mirror the literals the shader compiles.
 */
const PRECIP_SPIRAL_MIN = Number(
  (RAINBAND_AZIMUTHAL_MEAN - RAINBAND_SPIRAL_AMPLITUDE).toFixed(2),
);
const PRECIP_SPIRAL_SPAN = Number((RAINBAND_SPIRAL_AMPLITUDE * 2).toFixed(2));

/** The GLSL pulse envelope's literal pi; NOT Math.PI (they differ at 1e-9). */
const GLSL_PI = 3.14159265;

/**
 * Statement-by-statement CPU transcription of `sampleCloud()` in
 * `src/render/env.ts` (lines 152-399) with the `CLOUD_CORE_GLSL.wobble`,
 * `CLOUD_CORE_GLSL.eyewall` and `CLOUD_TOPS_GLSL` splices from
 * `src/render/cloud-motion.ts` inlined at their documented splice points.
 *
 * Documented skips: `CLOUD_RELIEF_GLSL` (visible-palette shading only, never
 * reaches brightnessC) and the palette/compositing in `main()`.
 *
 * GLSL `pow(x, 2.0)` on a negative base (the eyewall/precipEyewall Gaussians)
 * is spec-undefined but universally folded to `x * x`; JS `**` with an integer
 * exponent does the same, so the mirror holds.
 */
function sampleCloudProxy(
  u: CloudUniforms,
  cell: CloudCellInputs,
  noise: RealismNoise,
): ProxyCloudField {
  const cellX = cell.u * 2 - 1;
  const cellY = 1 - cell.v * 2;
  const radialX = (cellX - u.center.x) * u.metricX;
  const radialY = cellY - u.center.y;
  const rainRadialX = (cellX - u.rainCenter.x) * u.metricX;
  const rainRadialY = cellY - u.rainCenter.y;
  const rMax = Math.max(RENDER_RADIUS_FLOOR, u.rMax);
  const rCanopy = Math.max(RENDER_RADIUS_FLOOR, u.rCanopy);
  // coreQ: eye and eyewall stay tied to the contracting inner core.
  const q = Math.hypot(radialX, radialY) / rMax;

  // ---- CLOUD_CORE_GLSL.wobble ----
  const coreAzimuth = Math.atan2(radialY, radialX);
  const wobble =
    0.6 * Math.sin(3.0 * coreAzimuth + u.cloudSeed * 37.7) +
    0.4 * Math.sin(5.0 * coreAzimuth + u.cloudSeed * 61.3);
  const wobbleAmp = mix(0.2, 0.05, smoothstep(0.38, 0.85, u.organization));
  const qCore = q * (1.0 + wobbleAmp * wobble);
  // ---- end wobble ----

  const shearLen = Math.hypot(u.shearVector.x, u.shearVector.y);
  const shearDirX = shearLen > 0.05 ? u.shearVector.x / shearLen : 0.78;
  const shearDirY = shearLen > 0.05 ? u.shearVector.y / shearLen : 0.62;
  const shearN = smoothstep(7.0, 27.0, u.shearAtStorm);
  const canopyOffset = rCanopy * shearN * (0.82 / CANOPY_COEFFICIENT_DIVISOR);
  const canopyRadialX = radialX - shearDirX * canopyOffset;
  const canopyRadialY = radialY - shearDirY * canopyOffset;
  const canopyLen = Math.hypot(canopyRadialX, canopyRadialY);
  const canopyQ = canopyLen / rCanopy;
  const bandQ = canopyLen / rMax;
  const azimuth = Math.atan2(canopyRadialY, canopyRadialX);

  // ---- decorative motion (independent of the rain-aligned geometry) ----
  const animGate = 1.0 - u.reducedMotion;
  const legacyRotation = u.ageH * LEGACY_CLOUD_ROTATION_RAD_PER_H;
  const omegaHere = cloudAngularRateAtClipRadius(
    canopyLen,
    rMax,
    u.vmaxMs,
    u.hollandB,
  );

  const tCycle = u.cloudAgeH / CLOUD_CROSSFADE_PERIOD_H;
  const phaseA = glslFract(tCycle);
  const phaseB = glslFract(tCycle + 0.5);
  const weightA = mix(1.0, 1.0 - Math.abs(2.0 * phaseA - 1.0), animGate);
  // GLSL declares weightB here; nothing downstream reads it and noUnusedLocals
  // forbids a dead local, so it is deliberately absent.

  const seed = u.cloudSeed;
  const twist =
    0.72 * Math.log(1.0 + canopyQ) - legacyRotation * (1.0 - animGate);
  const spiralBase = glslRotate2(
    twist,
    canopyRadialX / rCanopy,
    canopyRadialY / rCanopy,
  );
  const thetaA = animGate * omegaHere * phaseA * CLOUD_CROSSFADE_PERIOD_H;
  const thetaB = animGate * omegaHere * phaseB * CLOUD_CROSSFADE_PERIOD_H;
  const pA = glslRotate2(thetaA, spiralBase.x, spiralBase.y);
  const pB = glslRotate2(thetaB, spiralBase.x, spiralBase.y);

  const driftX = u.ageH * 0.012 + shearDirX * u.ageH * 0.005;
  const driftY = -u.ageH * 0.007 + shearDirY * u.ageH * 0.005;
  let macro = mix(
    noise.cloudNoise(
      pB.x * 0.62 + driftX + seed * 11.0,
      pB.y * 0.62 + driftY + seed * 11.0,
    ),
    noise.cloudNoise(
      pA.x * 0.62 + driftX + seed * 11.0,
      pA.y * 0.62 + driftY + seed * 11.0,
    ),
    weightA,
  );

  // ---- cloud memory: earth-fixed advected state, crossfaded RG/BA ----
  // GLSL: memFrac = fract(u_cloudAgeH / CLOUD_MEMORY_DT_H), then
  // memDensity = mix(packed.r, packed.b, memFrac) * u_hasCloudMemory and
  // memAge = mix(packed.g, packed.a, memFrac). The measurement pose samples at
  // integer sim-hours, so memFrac is 0 and both mixes collapse onto the
  // state(k) half - exactly DebrisState's density/age pair.
  const memDensity = cell.memDensity * u.hasCloudMemory;
  const memAge = cell.memAge;
  macro = clamp01(
    macro *
      (1.0 + CLOUD_MEMORY_MACRO_GAIN * smoothstep(0.15, 0.85, memDensity)),
  );
  // u_cloudDetail > 0.5 in the measurement pose: the two-tap detail branch.
  const fine =
    u.cloudDetail > 0.5
      ? mix(
          noise.cloudNoise(
            pB.x * 1.95 - driftX * 1.8 + macro * 2.4,
            pB.y * 1.95 - driftY * 1.8 + seed * 5.0,
          ),
          noise.cloudNoise(
            pA.x * 1.95 - driftX * 1.8 + macro * 2.4,
            pA.y * 1.95 - driftY * 1.8 + seed * 5.0,
          ),
          weightA,
        )
      : mix(
          noise.tap(
            pB.x * 0.022 - driftX * 0.018 + seed,
            pB.y * 0.022 - driftY * 0.018 + seed,
            1,
          ),
          noise.tap(
            pA.x * 0.022 - driftX * 0.018 + seed,
            pA.y * 0.022 - driftY * 0.018 + seed,
            1,
          ),
          weightA,
        );

  const synopticDriftX = u.steerAtStorm.x * u.ageH * 0.0012;
  const synopticDriftY = -u.steerAtStorm.y * u.ageH * 0.0012;
  const synopticPx = cell.u * 8.0 - synopticDriftX + seed * 3.0;
  const synopticPy = cell.v * 5.2 - synopticDriftY + seed * 3.0;
  const synopticNoise = noise.cloudNoise(
    synopticPx * 1.35 + 9.7,
    synopticPy * 1.35 + 9.7,
  );
  const localRh = cell.localRh;
  const ambientGate = synopticNoise + localRh * 0.38;
  const ambientCloud =
    smoothstep(0.59, 0.88, ambientGate) *
    mix(0.12, 0.52, smoothstep(0.35, 0.86, localRh));

  const moisture = clamp01((u.midlevelRh - 0.25) / 0.62);
  const rainEnergy = clamp01((u.eyewallRain + 0.7 * u.rainbandRain) / 28.0);
  const development = clamp01(0.56 * u.organization + 0.44 * u.intensity);
  const coreRadius =
    mix(
      2.25 / CANOPY_COEFFICIENT_DIVISOR,
      3.55 / CANOPY_COEFFICIENT_DIVISOR,
      development,
    ) * mix(1.0, 0.86, shearN);
  const coreIrregularity = mix(
    0.34,
    0.12,
    smoothstep(0.38, 0.82, u.organization),
  );
  const irregularCoreRadius =
    coreRadius * mix(1.0 - coreIrregularity, 1.0 + coreIrregularity, macro);
  const centralOvercast = Math.exp(-((canopyQ / irregularCoreRadius) ** 2));
  const eyewall = Math.exp(
    -(((qCore - 1.0) / mix(0.46, 0.27, u.organization)) ** 2),
  );
  const outerBandRadius = mix(6.35, 8.8, smoothstep(0.3, 0.84, development));
  const bandEnvelope =
    smoothstep(1.25, 1.85, bandQ) *
    (1.0 - smoothstep(outerBandRadius - 2.6, outerBandRadius, bandQ));
  const omegaBand = cloudAngularRateAtClipRadius(
    CLOUD_BAND_REFERENCE_Q * rMax,
    rMax,
    u.vmaxMs,
    u.hollandB,
  );
  const thetaBand = mix(
    -legacyRotation / 2.35,
    omegaBand * u.cloudAgeH,
    animGate,
  );
  const thetaBand2 = mix(
    legacyRotation / 7.4,
    omegaBand * u.cloudAgeH,
    animGate,
  );
  const bandPhase =
    2.35 * (azimuth - thetaBand) - 1.52 * bandQ + (macro - 0.5) * 4.6;
  const primaryBand = smoothstep(0.18, 0.76, 0.5 + 0.5 * Math.sin(bandPhase));
  const secondaryBand = smoothstep(
    0.3,
    0.82,
    0.5 + 0.5 * Math.sin(3.7 * (azimuth - thetaBand2) - 0.88 * bandQ + fine),
  );
  const convectiveCells = smoothstep(0.36, 0.78, fine * 0.74 + macro * 0.34);

  const rainQ = Math.hypot(rainRadialX, rainRadialY) / rMax;
  const rainAzimuth = Math.atan2(rainRadialY, rainRadialX);
  const precipEyewall = Math.exp(-(((rainQ - 1.0) / EYEWALL_WIDTH_Q) ** 2));
  const precipBandEnvelope =
    smoothstep(RAINBAND_INNER_Q, RAINBAND_INNER_FULL_Q, rainQ) *
    (1.0 - smoothstep(RAINBAND_OUTER_FADE_Q, RAINBAND_OUTER_Q, rainQ));
  const precipSpiral =
    RAINBAND_AZIMUTHAL_MEAN +
    RAINBAND_SPIRAL_AMPLITUDE *
      Math.sin(
        RAINBAND_SPIRAL_ARMS * rainAzimuth -
          RAINBAND_SPIRAL_PITCH * rainQ +
          u.ageH * RAINBAND_SPIRAL_ROTATION_PER_H,
      );
  const precipSpiralN = clamp01(
    (precipSpiral - PRECIP_SPIRAL_MIN) / PRECIP_SPIRAL_SPAN,
  );
  const precipEyeSupport = smoothstep(
    PRECIPITATING_CLOUD_RAIN_START_MM_H,
    PRECIPITATING_CLOUD_EYE_FULL_MM_H,
    u.eyewallRain,
  );
  const precipBandSupport = smoothstep(
    PRECIPITATING_CLOUD_RAIN_START_MM_H,
    PRECIPITATING_CLOUD_BAND_FULL_MM_H,
    u.rainbandRain,
  );
  // The band arm is hoisted out of the GLSL max() so the harness can store it
  // alone; precipitatingCloud below is the shader's expression verbatim.
  const precipBandArm =
    precipBandEnvelope *
    mix(PRECIPITATING_CLOUD_SPIRAL_FLOOR, 1.0, precipSpiralN) *
    precipBandSupport *
    PRECIPITATING_CLOUD_BAND_MAX;
  const precipTexture = mix(PRECIPITATING_CLOUD_TEXTURE_FLOOR, 1.0, macro);
  const precipitatingCloud =
    Math.max(precipEyewall * precipEyeSupport, precipBandArm) * precipTexture;
  const bandCoherence =
    smoothstep(0.42, 0.78, u.organization) *
    smoothstep(0.12, 0.52, u.intensity);
  const brokenBand =
    smoothstep(0.28, 0.72, macro * 0.62 + fine * 0.42) *
    mix(0.48, 1.0, primaryBand);
  const bandShape = mix(
    brokenBand,
    Math.max(primaryBand, secondaryBand * 0.58),
    bandCoherence,
  );

  const canopyDirX =
    canopyQ > 0.001 ? canopyRadialX / (canopyQ * rCanopy) : shearDirX;
  const canopyDirY =
    canopyQ > 0.001 ? canopyRadialY / (canopyQ * rCanopy) : shearDirY;
  const upshear = Math.max(0, canopyDirX * -shearDirX + canopyDirY * -shearDirY);
  const shearErosion = 1.0 - shearN * upshear * mix(0.28, 0.62, 1.0 - moisture);
  const eyewallMaturity =
    smoothstep(0.3, 0.68, u.intensity) * smoothstep(0.4, 0.72, u.organization);
  const coreCloud =
    centralOvercast * mix(0.7, 1.0, development) * mix(0.88, 1.0, macro);

  // ---- CLOUD_CORE_GLSL.eyewall ----
  const mesoTheta = animGate * CLOUD_ROTATION_CAP_RAD_PER_H * u.cloudAgeH;
  const meso =
    1.0 +
    0.24 *
      eyewallMaturity *
      Math.sin(5.0 * (coreAzimuth - mesoTheta) + u.cloudSeed * 17.9);
  // GLSL step(0.05, length(u_shearVector)): 0 below the edge, 1 at or above.
  const hasShearDir = shearLen < 0.05 ? 0 : 1;
  const dsl = Math.max(0, canopyDirX * -shearDirY + canopyDirY * shearDirX);
  const dslBoost = 1.0 + 0.22 * shearN * hasShearDir * dsl;
  const eyewallCloud =
    eyewall *
    meso *
    dslBoost *
    eyewallMaturity *
    mix(0.48, 1.0, rainEnergy) *
    mix(0.68, 1.0, convectiveCells);
  // ---- end eyewall ----

  const rainbands =
    bandEnvelope *
    bandShape *
    mix(0.42, 0.96, moisture) *
    mix(0.46, 1.0, convectiveCells) *
    mix(0.62, 1.0, development);

  const cirrusStream = animGate * u.cloudAgeH * 0.06;
  const cirrusTexture = smoothstep(
    0.24,
    0.74,
    noise.tap(
      (spiralBase.x * -shearDirY + spiralBase.y * shearDirX) * 0.029 +
        driftX * 0.018,
      (spiralBase.x * shearDirX + spiralBase.y * shearDirY) * 0.011 -
        cirrusStream +
        driftY * 0.018,
      2,
    ),
  );
  const cirrus =
    Math.exp(-((canopyQ / (5.8 / CANOPY_COEFFICIENT_DIVISOR)) ** 1.55)) *
    cirrusTexture *
    mix(0.16, 0.38, u.organization) *
    mix(0.82, 1.16, shearN);

  const eyeStrength =
    smoothstep(0.18, 0.56, u.intensity * u.organization) *
    smoothstep(0.62, 0.82, u.organization);
  const eye = 1.0 - smoothstep(0.18, mix(0.46, 0.68, eyeStrength), qCore);
  let stormCloud = clamp01(
    (coreCloud + eyewallCloud + rainbands + cirrus + precipitatingCloud) *
      shearErosion,
  );
  stormCloud *= 1.0 - eye * eyeStrength * 0.97;
  stormCloud *= u.stormPresence;
  let cloud = Math.max(
    ambientCloud * (1.0 - centralOvercast * u.stormPresence),
    stormCloud,
  );
  const debris = memDensity * (1.0 - 0.55 * memAge) * DEBRIS_MAX_CLOUD;
  cloud = Math.max(cloud, debris);

  const surfaceC = mix(cell.sstC, 34.0, smoothstep(0.35, 0.65, cell.land));
  const ambientTopC = mix(-8.0, -42.0, synopticNoise * localRh);

  // ---- CLOUD_TOPS_GLSL ----
  const cdoTopC = mix(
    CLOUD_TOP_CDO_DEVELOPING_C,
    CLOUD_TOP_CDO_MATURE_C,
    development,
  );
  const bandTopC = mix(
    CLOUD_TOP_BAND_DEVELOPING_C,
    CLOUD_TOP_BAND_MATURE_C,
    development,
  );
  const cirrusTopC = mix(
    CLOUD_TOP_CIRRUS_WARM_C,
    CLOUD_TOP_CIRRUS_COLD_C,
    u.organization,
  );

  const otCellX = Math.floor(pA.x * 6.0);
  const otCellY = Math.floor(pA.y * 6.0);
  const otOffset = glslHash21(
    otCellX * 1.73 + seed * 291.7,
    otCellY * 1.73 + seed * 291.7,
  );
  const otCycle = u.cloudAgeH / CLOUD_PULSE_PERIOD_H + otOffset;
  const otStrength = glslHash21(
    otCellX * 2.61 + Math.floor(otCycle) * 7.31,
    otCellY * 2.61 + Math.floor(otCycle) * 7.31,
  );
  let otEnv = Math.sin(GLSL_PI * glslFract(otCycle));
  otEnv *= otEnv;
  otEnv = mix(0.5, otEnv, animGate);
  const overshootC =
    mix(8.0, 14.0, otStrength) *
    otEnv *
    smoothstep(0.55, 0.8, convectiveCells) *
    smoothstep(0.3, 0.8, rainEnergy);

  const cirrusPresence = clamp01(cirrus * 2.6);
  const bandPresence = clamp01(Math.max(rainbands, precipitatingCloud) * 1.6);
  const corePresence = clamp01(coreCloud * 1.4);
  const towerPresence =
    clamp01(Math.max(eyewallCloud, precipitatingCloud) * 1.2) *
    smoothstep(0.55, 0.8, convectiveCells);

  let topC = ambientTopC;
  const debrisTopC = mix(DEBRIS_TOP_WARM_C, DEBRIS_TOP_COLD_C, 1.0 - memAge);
  const debrisPresence = clamp01(memDensity * 1.3) * u.hasCloudMemory;
  topC = mix(topC, debrisTopC, debrisPresence);
  topC = mix(topC, cirrusTopC, cirrusPresence);
  topC = mix(topC, bandTopC, bandPresence);
  topC = mix(topC, cdoTopC, corePresence);
  topC = mix(topC, Math.min(topC, cdoTopC) - overshootC, towerPresence);

  let brightnessC = mix(surfaceC, ambientTopC, ambientCloud);
  brightnessC = mix(brightnessC, topC, stormCloud);
  // The eye restores surfaceC - 4: a mature storm's centre is WARM, not cold.
  brightnessC = mix(
    brightnessC,
    surfaceC - 4.0,
    eye * eyeStrength * u.stormPresence,
  );
  // ---- end tops ----
  // CLOUD_RELIEF_GLSL is deliberately skipped: relief only shades the visible
  // palette and never reaches brightnessC or any cover component.

  return {
    cloud,
    stormCloud,
    ambientCloud,
    brightnessC,
    rainbands,
    precipBandCloud: precipBandArm * precipTexture,
    debris,
  };
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
