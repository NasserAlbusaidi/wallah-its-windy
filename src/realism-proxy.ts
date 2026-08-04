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

import { cloudNoiseBytes } from './render/cloud-noise';

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
