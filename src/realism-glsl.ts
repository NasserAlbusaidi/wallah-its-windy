/**
 * realism-glsl.ts — GLSL-semantics primitives for the R2a realism harness.
 *
 * The leaf of the realism modules: everything here mirrors a GLSL builtin or
 * the shared cloud-noise sampler, and it imports nothing from its siblings so
 * the harness module graph stays acyclic. Import it through
 * `src/realism-proxy.ts`, which re-exports every symbol as the harness's single
 * import surface.
 *
 * These are semantics mirrors, not conveniences: `glslFract` is correct for
 * negative inputs and `glslRotate2` is CLOCKWISE, because that is what the
 * shader does. Never substitute ad-hoc JS math for them.
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

/** uv of cell (i, j) on an n-grid — the shader's v_uv convention. */
export function cellUv(i: number, j: number, n: number): { u: number; v: number } {
  return { u: (i + 0.5) / n, v: (j + 0.5) / n };
}
