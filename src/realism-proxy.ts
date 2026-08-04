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

import type { FlightFrame } from './flight-recorder';
import { DOMAIN, latLonToClip } from './grid';
import {
  CLOUD_MEMORY_DECAY_TAU_H,
  CLOUD_MEMORY_DT_H,
  CLOUD_MEMORY_MAX_ADVECT_KMH,
  CLOUD_MEMORY_OUTFLOW_KMH,
  CLOUD_MEMORY_WINDOW_H,
  sourceBoundaries,
} from './render/cloud-memory';
import { cloudAngularRateRadPerH, cloudMetricX } from './render/cloud-motion';
import { cloudNoiseBytes } from './render/cloud-noise';
import {
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from './render/storm-radii';

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
