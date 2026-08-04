# Realism R2a Measurement-Harness Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Revision 5 (2026-08-02). Codex review trail (gpt-5.6-sol): round 1 —
> 18 findings, REVISE, all verified against code, incorporated in rev 2.
> Round 2 — CLOSED 16/18 + 9 findings (1 P0), REVISE, incorporated in
> rev 3. Round 3 — CLOSED 7/9 + 2 P1 test gaps, REVISE, incorporated in
> rev 4. Round 4 (narrow closure check) — CLOSED 1/2; the single surviving
> P1 (a zero-gradient test fixture) is fixed in this revision by applying
> Codex's prescribed one-line fix verbatim. Rev 5 itself has not been
> re-reviewed. Full record in the Self-review section at the end.

**Goal:** Build `npm run realism` / `npm run realism:check` — the
deterministic sim-side half of the R2 measurement harness in
`calibration/realism/`: field-space metrics for the six shortlist entries
(RGR-001/002/003/004/006/013) over a frozen scenario set, gated against a
sealed reference, mirroring the fidelity-harness pattern.

**Naming discipline (Codex finding 17):** this plan is **R2a — the sim-side
scaffold**, and every status line it writes must say so. The R2 contract in
the spec also requires observed derived-statistics comparisons and a rain
metric versus GPM IMERG; those are **R2b**, a follow-up plan. "R2 landed /
complete" may only be claimed once R2b integrates observed references into
this harness. Nothing in this PR may describe R2 as done.

**Architecture:** A CPU "BT-proxy twin" of the IR shader's cloud composition
(`src/realism-proxy.ts`) rasterizes a deterministic 192×192 field from
flight-recorder frames + env bins + the shared render constants — never GPU
pixels. `src/realism-metrics.ts` computes the shortlist metrics on that
field. `calibration/realism/realism.mjs` replays the frozen scenario set
through the exact runtime engine via vite `ssrLoadModule`, samples frames
every 6 sim-hours, writes canonicalized results + a sealed reference + a
machine-generated `docs/realism-benchmark.md`, and verifies drift in
`--check` mode.

**Tech Stack:** Vanilla TypeScript (node-testable, no DOM), vitest, node
`--experimental-strip-types` + vite `ssrLoadModule` for the runner. Zero new
dependencies.

## Global Constraints

Copied from `docs/superpowers/specs/2026-07-30-realism-program-design.md` and
project rules; every task's requirements implicitly include these.

- "No change to `src/sim.ts`, `src/structure.ts`, calibrated constants, frozen
  acceptance files, or sealed cohorts." `npm run calibrate:check` and the three
  HF-6 checks must pass untouched after every task.
- "Metrics compute from deterministic CPU-side state … not from GPU pixels,
  which are not byte-stable across drivers."
- "All numbers pass through the existing `canonicalizeNumbers` path (9 decimal
  places) before being written." (`RESULT_DECIMAL_PLACES = 9`.)
- "Observed references are derived statistics + provenance manifest … not
  committed raw imagery." No new raw EUMETSAT frames, ever (register D2).
- "Gate semantics: regression-only." A fixed human A/B protocol accepts
  improvements; the harness only proves no-worse. "Rollout: advisory
  (report-only) in its first PR" — do **not** add realism checks to
  `.github/workflows/deploy.yml` in this PR.
- Zero runtime npm dependencies; dev deps stay vite/typescript/vitest only.
- The harness READS flight-recorder frames and baked bins; it must not alter
  any recorded output, tape byte, URL-hash behavior, or shipped shader bytes.
  Task 1's refactor must leave every emitted GLSL string byte-identical.
- Product honesty: every doc/report label says "simulated cloud-top
  brightness-temperature **proxy**", never "brightness temperature" bare,
  never "radiometric", never "probability", and status lines say "R2a
  sim-side scaffold", never "R2 complete".
- Determinism: a metric run is a pure function of (committed assets, committed
  scenario set, code). No `Math.random`, no `Date.now`, no device traits, and
  every directory listing or map iteration that reaches an artifact is
  explicitly sorted.
- The repo's tsconfig is strict with `noUnusedLocals`/`noImplicitAny`; all
  test code in this plan must typecheck under it. `test/node-fs.d.ts` types
  `readFileSync(path: string, ...)` — tests use root-relative string paths,
  not `URL` objects.
- Commit style: conventional commits, no AI attribution.

## File Structure

- Modify: `src/render/cloud-motion.ts` — export cloud-top component
  temperature constants (currently GLSL literals); splice back byte-identical.
- Create: `src/realism-proxy.ts` (~500 lines) — GLSL-semantics helpers, noise
  sampler mirror, debris recurrence mirror, quantized env-plane sampler,
  BT-proxy field builder. Measurement-only module: imported by tests and the
  runner, never by `main.ts`/render paths (same pattern as
  `src/hindcast-benchmark.ts`).
- Create: `src/realism-metrics.ts` (~300 lines) — shortlist metrics.
- Create: `test/helpers/realism.ts` — shared synthetic-frame fixtures.
- Create: `calibration/realism/realism-scenarios.json` — frozen scenario set.
- Create: `calibration/realism/realism.mjs` (~470 lines) — runner/check.
- Create: `calibration/realism/README.md` — flows, gate semantics, reseal,
  cross-platform seal protocol.
- Create: `calibration/realism/observed/README.md` +
  `calibration/realism/observed/EXAMPLE.derived-stats.json` — dimensional
  derived-statistics schema (extraction lands in R2b).
- Create: `test/realism-proxy.test.ts`, `test/realism-metrics.test.ts`,
  `test/realism-scenarios.test.ts`.
- Modify: `package.json` — `realism`, `realism:check` scripts.
- Generated (committed): `calibration/realism/realism-results.json`,
  `calibration/realism/realism-reference.json`, `docs/realism-benchmark.md`.
- Modify: `CLAUDE.md` (Commands), `docs/README.md` (index), `ROADMAP.md`
  (R2a status line).

Branch: `feat/realism-r2-harness` off `main`, pushed with `-u`. One PR.

## App-truth notes the implementer must not "simplify away"

These were verified against the code on 2026-08-02 and are load-bearing:

1. **Event display time is UNOFFSET.** The app's renderer samples the event
   environment at `eventTimeFraction(storm.ageH, scenario.windowH)`
   (`src/main.ts` FrameState `envTFrac`), while physics samples at
   `(ageH + hindcast.envOffsetH) / windowH` (via `eventSpawn`'s
   `tFracOffsetH`). The proxy mirrors the **renderer** (unoffset) for every
   visual input — per-cell RH/SST planes AND the centre shear/steer sample
   (`render/index.ts` `sampleEnv` uses `frame.envTFrac`). Physics replay keeps
   the offset. This display/physics inconsistency in the app is a candidate
   register entry for the repo owner; do NOT fix it in this PR.
2. **App hindcast spawns inject observed initial motion.** `src/main.ts`
   (spawn path, ~line 1030) reads `public/data/tracks.json`, finds
   `scenario.ghostId`, and adds
   `initialMotionUms/initialMotionVms = observedInitialMotionMs(track.points, hindcast.startIso)`
   when available. The runner must do the same.
3. **App land predicate is nearest-cell.** `ui.isLand` (`src/ui.ts` ~1621)
   uses `latLonToCell` + `Math.round` + clamp on the terrain `landmask`
   (`> 0.5`), NOT bilinear. The runner's engine `isLand` must mirror this.
4. **Steering bin path is derived, not synthesized.** The app derives it as
   `scenario.bin.replace(/(^|\/)env_/, '$1steering_')` (`src/main.ts:1199`).
   Use that exact rule, resolved under `public/`.
5. **R8 env textures quantize texels BEFORE filtering.** `buildR8Tex`
   (`src/render/textures.ts`) byte-quantizes each source texel
   (`rh: v/100`, `sst: (v - SST_MIN_C)/(SST_MAX_C - SST_MIN_C)`), then GL
   bilinears the bytes. Quantize-then-filter and filter-then-quantize do not
   commute; the proxy must quantize texels first. `latLonToCell` in
   `src/grid.ts` already uses the GL texel-centre convention (`- 0.5`), so a
   CPU sampler built on it matches GL exactly (CLAMP semantics at edges).
6. **`u_midlevelRh` precedence.** The shader uniform is
   `clamp01((diagnostics.ventilationMeanRhPct ?? envSample.midlevelRhPct ?? 55) / 100)`
   (`src/render/env.ts` ~826). `ventilationMeanRhPct` exists on
   `StormDiagnostics` (`src/types.ts:230`). Mirror the exact precedence.
7. **`rotate2` in the shader is CLOCKWISE for positive angles.** GLSL
   `mat2(c, -s, s, c)` is column-major: columns are `(c, -s)` and `(s, c)`,
   so `rotate2(a) * v = (c·x + s·y, -s·x + c·y)`. A textbook CCW JS rotation
   is the transpose — wrong sign. GLSL `fract(x) = x - floor(x)` including
   for negatives. Both are provided as tested helpers in Task 2; the Task 4
   transcription must use them, never ad-hoc math.
8. **`createSimEngine` defaults to the shipped physics profile** (verified in
   `src/sim.ts`); the app passes no `physicsProfile`, so neither does the
   runner.
9. **Land has TWO app semantics — mirror both, never merge them.** The
   engine's `isLand` is nearest-cell (`ui.isLand`: `latLonToCell` +
   `Math.round` + `> 0.5`). The SHADER's `land` input is different: the
   terrain landmask is binarized per texel at upload
   (`buildR8Tex(gl, landL, 0, (v) => (v > 0.5 ? 1 : 0), gl.LINEAR)`,
   `render/index.ts` ~680) and then LINEAR-filtered, so coastal cells see
   fractional land in `smoothstep(0.35, 0.65, land)` for `surfaceC`. The
   proxy therefore takes `land01At` (binarize-then-bilinear, GL convention,
   CLAMP) for the field, while the runner's engine uses the nearest-cell
   `isLand` for physics.

---

### Task 1: Export cloud-top component temperature constants

The BT-proxy must use the exact component top temperatures the shader embeds.
They currently live as literals inside `CLOUD_TOPS_GLSL`
(`src/render/cloud-motion.ts`: `-65.0/-82.0`, `-45.0/-62.0`, `-35.0/-48.0`).
Lift them to exported constants and splice them back so the emitted GLSL is
**byte-identical**, proven by a digest pin.

**Files:**
- Modify: `src/render/cloud-motion.ts`
- Test: `test/cloud-motion.test.ts` (extend)

**Interfaces:**
- Produces (exact names, used by Task 4):
  `CLOUD_TOP_CDO_DEVELOPING_C = -65`, `CLOUD_TOP_CDO_MATURE_C = -82`,
  `CLOUD_TOP_BAND_DEVELOPING_C = -45`, `CLOUD_TOP_BAND_MATURE_C = -62`,
  `CLOUD_TOP_CIRRUS_WARM_C = -35`, `CLOUD_TOP_CIRRUS_COLD_C = -48`
  (all `export const`, °C).

- [ ] **Step 1: Write the failing test**

Append to `test/cloud-motion.test.ts`. The file imports
`{ describe, expect, test }` from vitest — `it` is NOT imported and vitest
globals are off, so use `test(...)`; extend the existing
`../src/render/cloud-motion` import list and add the `node:crypto` import:

```ts
import { createHash } from 'node:crypto';
import {
  CLOUD_TOP_BAND_DEVELOPING_C,
  CLOUD_TOP_BAND_MATURE_C,
  CLOUD_TOP_CDO_DEVELOPING_C,
  CLOUD_TOP_CDO_MATURE_C,
  CLOUD_TOP_CIRRUS_COLD_C,
  CLOUD_TOP_CIRRUS_WARM_C,
  CLOUD_TOPS_GLSL,
} from '../src/render/cloud-motion';

describe('cloud-top component temperature constants', () => {
  test('pins the component grading endpoints', () => {
    expect(CLOUD_TOP_CDO_DEVELOPING_C).toBe(-65);
    expect(CLOUD_TOP_CDO_MATURE_C).toBe(-82);
    expect(CLOUD_TOP_BAND_DEVELOPING_C).toBe(-45);
    expect(CLOUD_TOP_BAND_MATURE_C).toBe(-62);
    expect(CLOUD_TOP_CIRRUS_WARM_C).toBe(-35);
    expect(CLOUD_TOP_CIRRUS_COLD_C).toBe(-48);
  });

  test('keeps the emitted CLOUD_TOPS_GLSL byte-identical (pre-refactor digest)', () => {
    // sha256 of CLOUD_TOPS_GLSL captured on 2026-08-02 BEFORE this refactor
    // (2259 chars). Any change to the emitted shader text fails here.
    const digest = createHash('sha256').update(CLOUD_TOPS_GLSL).digest('hex');
    expect(digest).toBe(
      '4ed94b08cad4d72e429210af66827336905407075bda5a3107d640062eb11ff5',
    );
    expect(CLOUD_TOPS_GLSL.length).toBe(2259);
  });
});
```

- [ ] **Step 2: Run the digest test BEFORE refactoring — it must already pass**

Run: `npx vitest run test/cloud-motion.test.ts`
Expected: the digest test PASSES against the untouched file (proving the
pinned digest is the true pre-refactor value); the constants test FAILS
(exports missing).

- [ ] **Step 3: Implement**

In `src/render/cloud-motion.ts`, directly above `CLOUD_TOPS_GLSL`, add:

```ts
/**
 * Component cloud-top grading endpoints, deg C. Exported so the R2a realism
 * BT-proxy (src/realism-proxy.ts) measures with the exact temperatures the
 * shader renders. The GLSL splice below must keep the emitted text
 * byte-identical (digest-pinned by test/cloud-motion.test.ts).
 */
export const CLOUD_TOP_CDO_DEVELOPING_C = -65;
export const CLOUD_TOP_CDO_MATURE_C = -82;
export const CLOUD_TOP_BAND_DEVELOPING_C = -45;
export const CLOUD_TOP_BAND_MATURE_C = -62;
export const CLOUD_TOP_CIRRUS_WARM_C = -35;
export const CLOUD_TOP_CIRRUS_COLD_C = -48;
```

Then inside `CLOUD_TOPS_GLSL`, replace the three literal lines with splices
that reproduce the exact same characters (`.toFixed(1)` renders `-65.0`):

```ts
  float cdoTopC = mix(${CLOUD_TOP_CDO_DEVELOPING_C.toFixed(1)}, ${CLOUD_TOP_CDO_MATURE_C.toFixed(1)}, development);
  float bandTopC = mix(${CLOUD_TOP_BAND_DEVELOPING_C.toFixed(1)}, ${CLOUD_TOP_BAND_MATURE_C.toFixed(1)}, development);
  float cirrusTopC = mix(${CLOUD_TOP_CIRRUS_WARM_C.toFixed(1)}, ${CLOUD_TOP_CIRRUS_COLD_C.toFixed(1)}, u_organization);
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — the unchanged digest proves the shader string did not move.

- [ ] **Step 5: Commit**

```bash
git add src/render/cloud-motion.ts test/cloud-motion.test.ts
git commit -m "refactor: export cloud-top grading constants for the R2a BT-proxy"
```

---

### Task 2: GLSL-semantics helpers + CPU cloud-noise sampler

Two deliverables: (a) tested CPU mirrors of the GLSL scalar semantics the
transcription depends on — `glslFract`, `glslRotate2` (CLOCKWISE, column-major
mirror), `glslHash21`, `smoothstep`, `mix`, `clamp01`; (b) `RealismNoise`, a
GL LINEAR+REPEAT sampler over `cloudNoiseBytes(128)` plus the `cloudNoise(p)`
helper mirror (env.ts: broad tap at `p*0.10`, fine tap at
`p*0.235 + (0.173, 0.619)`, fixed channel weights).

**Files:**
- Create: `src/realism-proxy.ts` (first section)
- Create: `test/helpers/realism.ts` (synthetic frame fixture)
- Test: `test/realism-proxy.test.ts`

**Interfaces:**
- Consumes: `cloudNoiseBytes` from `src/render/cloud-noise.ts`.
- Produces (used by Tasks 3-4):

```ts
export function clamp01(x: number): number;
export function mix(a: number, b: number, t: number): number;
export function smoothstep(e0: number, e1: number, x: number): number;
export function glslFract(x: number): number;              // x - floor(x), negatives included
export function glslRotate2(angle: number, x: number, y: number): { x: number; y: number };
// = GLSL mat2(c,-s,s,c) * vec2: (c*x + s*y, -s*x + c*y) — CW for +angle
export function glslHash21(px: number, py: number): number; // fract(sin(dot(p,(127.1,311.7)))*43758.5453)
export class RealismNoise {
  tap(u: number, v: number, channel: 0 | 1 | 2 | 3): number; // [0,1]
  cloudNoise(px: number, py: number): number;
}
```

- [ ] **Step 1: Write the shared fixture** `test/helpers/realism.ts`:

```ts
import type { FlightFrame } from '../../src/flight-recorder';

/** A mature open-ocean storm frame; override fields per test. */
export function syntheticFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  return {
    ageH: 24, lat: 18, lon: 62, vKt: 80, alive: true, organization: 0.9,
    coldWakeC: 0,
    diagnostics: {
      sstC: 29, effectiveSstC: 29, midlevelRhPct: 60, ohcKjCm2: 60,
      organization: 0.9, organizationTarget: 0.9, coldWakeC: 0,
      shearMs: 6, eyewallRainMmH: 18, rainbandRainMmH: 8,
      ventilationMeanRhPct: 58,
    } as FlightFrame['diagnostics'],
    structure: {
      maximumWindKt: 80, centralPressureHpa: 965, environmentalPressureHpa: 1008,
      rmwKm: 30, outerSizeKm: 220, outerWindScale: 1,
      outerBlendStartWindKt: 34, outerBlendFullWindKt: 64, hollandB: 1.4,
      motionUms: 2, motionVms: 2, translationAsymmetryKt: 4,
      shearUms: 4, shearVms: 2, shearAsymmetryFraction: 0.1,
      rainOffsetEastKm: 10, rainOffsetNorthKm: 5,
      r34Km: { ne: 150, se: 140, sw: 120, nw: 130 },
      r50Km: { ne: 80, se: 75, sw: 60, nw: 70 },
      r64Km: { ne: 40, se: 38, sw: 30, nw: 35 },
    },
    ...overrides,
  } as FlightFrame;
}

/** A weak, eyeless, disorganized frame (eyeStrength = 0 by construction). */
export function weakFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  return syntheticFrame({
    vKt: 35, organization: 0.3,
    structure: {
      ...syntheticFrame().structure,
      maximumWindKt: 35, rmwKm: 60, outerSizeKm: 180, hollandB: 1.2,
    },
    ...overrides,
  });
}
```

(If `FlightFrame`'s concrete shape rejects a field above, fix the fixture to
match `src/flight-recorder.ts` / `src/types.ts` — the fixture must satisfy the
real types without `any`.)

- [ ] **Step 2: Write the failing tests** — `test/realism-proxy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cloudNoiseBytes } from '../src/render/cloud-noise';
import {
  RealismNoise,
  glslFract,
  glslHash21,
  glslRotate2,
  smoothstep,
} from '../src/realism-proxy';

describe('GLSL-semantics helpers', () => {
  it('glslFract handles negatives like GLSL (x - floor(x))', () => {
    expect(glslFract(-1.25)).toBeCloseTo(0.75, 12);
    expect(glslFract(2.5)).toBeCloseTo(0.5, 12);
  });

  it('glslRotate2 is CLOCKWISE for positive angles (column-major mat2)', () => {
    // rotate (1, 0) by +90deg -> (0, -1) under mat2(c,-s,s,c) * v
    const r = glslRotate2(Math.PI / 2, 1, 0);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(-1, 12);
  });

  it('glslHash21 mirrors the shader hash', () => {
    const expected = (px: number, py: number) => {
      const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    expect(glslHash21(0.3, 0.7)).toBeCloseTo(expected(0.3, 0.7), 12);
    expect(glslHash21(-2.4, 5.1)).toBeCloseTo(expected(-2.4, 5.1), 12);
  });

  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('RealismNoise', () => {
  const noise = new RealismNoise();

  it('tap at a texel center returns that texel byte exactly', () => {
    const bytes = cloudNoiseBytes(128);
    const expected = bytes[(7 * 128 + 3) * 4 + 1] / 255;
    expect(noise.tap(3.5 / 128, 7.5 / 128, 1)).toBeCloseTo(expected, 12);
  });

  it('tap wraps REPEAT: uv and uv+1 are identical', () => {
    expect(noise.tap(0.113, 0.71, 0)).toBeCloseTo(noise.tap(1.113, -0.29, 0), 12);
  });

  it('tap interpolates midway between horizontal neighbours', () => {
    const bytes = cloudNoiseBytes(128);
    const a = bytes[(9 * 128 + 4) * 4] / 255;
    const b = bytes[(9 * 128 + 5) * 4] / 255;
    expect(noise.tap(5 / 128, 9.5 / 128, 0)).toBeCloseTo((a + b) / 2, 12);
  });

  it('cloudNoise is deterministic and in a plausible range', () => {
    const v1 = noise.cloudNoise(0.42, -1.7);
    const v2 = new RealismNoise().cloudNoise(0.42, -1.7);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(1);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module missing).

- [ ] **Step 4: Implement** — create `src/realism-proxy.ts`:

```ts
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
```

- [ ] **Step 5: Run, expect PASS; commit**

```bash
git add src/realism-proxy.ts test/realism-proxy.test.ts test/helpers/realism.ts
git commit -m "feat: GLSL-semantics helpers and cloud-noise sampler for the R2a BT-proxy"
```

---

### Task 3: Debris-field CPU recurrence mirror

Mirror `CLOUD_MEMORY_UPDATE_FS` (cloud-memory.ts) on CPU at the fixed
measurement grid: state(k) = up to 18 advect→source→decay passes from a zero
field, reading only boundary frames k-18..k-1. Storage is **Uint8Array bytes
(0..255)** — the honest mirror of the RGBA8 render target (Codex finding 8:
`byte/255` values are not float32-representable, so a Float32Array
round-trip assertion is unsound). Sampling normalizes `/255`. Measurement
pose: `reducedMotion = false`.

**Files:**
- Modify: `src/realism-proxy.ts` (append)
- Test: `test/realism-proxy.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 exports; from `src/render/cloud-memory.ts`:
  `CLOUD_MEMORY_DT_H`, `CLOUD_MEMORY_DECAY_TAU_H`, `CLOUD_MEMORY_MAX_ADVECT_KMH`,
  `CLOUD_MEMORY_OUTFLOW_KMH`, `CLOUD_MEMORY_WINDOW_H`, `sourceBoundaries`;
  from `src/render/cloud-motion.ts`: `cloudAngularRateRadPerH`, `cloudMetricX`;
  from `src/render/storm-radii.ts`: `stormRenderRadii`, `HALF_DOMAIN_HEIGHT_KM`,
  `RENDER_RADIUS_FLOOR`; from `src/grid.ts`: `DOMAIN`, `latLonToClip`;
  `FlightFrame` type.
- Produces (used by Task 4):

```ts
export interface DebrisState {
  densityBytes: Uint8Array;  // n*n, 0..255 — RGBA8 R channel mirror
  ageBytes: Uint8Array;      // n*n, 0..255 — RGBA8 G channel mirror
}
export function computeDebrisState(
  k: number,
  frameAtBoundary: (boundaryH: number) => FlightFrame | null,
  noise: RealismNoise,
  cloudSeed: number,
  n: number,
): DebrisState;
```

- [ ] **Step 1: Write the failing tests** (append; import `syntheticFrame`
from `./helpers/realism`):

```ts
import { computeDebrisState } from '../src/realism-proxy';
import { syntheticFrame } from './helpers/realism';

describe('computeDebrisState', () => {
  it('k=0 is an all-zero field (no source boundaries before spawn)', () => {
    const state = computeDebrisState(0, () => syntheticFrame(), new RealismNoise(), 0.4, 32);
    expect(Math.max(...state.densityBytes)).toBe(0);
    expect(Math.max(...state.ageBytes)).toBe(0);
  });

  it('an active storm deposits debris near its centre by k=6', () => {
    const state = computeDebrisState(
      6, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, 64,
    );
    // > 0.05 density in byte space
    expect(Math.max(...state.densityBytes)).toBeGreaterThan(13);
  });

  it('is deterministic', () => {
    const noise = new RealismNoise();
    const a = computeDebrisState(4, (b) => syntheticFrame({ ageH: b }), noise, 0.4, 32);
    const b = computeDebrisState(4, (b2) => syntheticFrame({ ageH: b2 }), noise, 0.4, 32);
    expect(a.densityBytes).toEqual(b.densityBytes);
    expect(a.ageBytes).toEqual(b.ageBytes);
  });

  it('age resets to zero wherever stored density is below the byte floor', () => {
    const state = computeDebrisState(
      3, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, 32,
    );
    for (let i = 0; i < state.densityBytes.length; i++) {
      if (state.densityBytes[i] === 0) expect(state.ageBytes[i]).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (append to `src/realism-proxy.ts`)

```ts
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
import {
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from './render/storm-radii';

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
```

- [ ] **Step 4: Run, expect PASS**; also `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/realism-proxy.ts test/realism-proxy.test.ts
git commit -m "feat: CPU debris-field recurrence mirror for the R2a BT-proxy"
```

---

### Task 4: BT-proxy field builder (`buildRealismField`)

Rasterize the measurement field: a CPU walk of env.ts `sampleCloud()`
morphology at `REALISM_GRID_N = 192`, measurement pose (reducedMotion=false,
cloudDetail=1, `stormPresence = frame.alive ? 1 : 0`, demo=false,
`cloudAgeH = ageH`). Documented skips: relief shading, palettes/compositing.

**Files:**
- Modify: `src/realism-proxy.ts` (append)
- Test: `test/realism-proxy.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1-3; `RAINBAND_*` + `EYEWALL_WIDTH_Q` from
  `src/rainband-profile.ts`; `PRECIPITATING_CLOUD_*`, `rainCenterClip` from
  `src/render/precipitating-cloud.ts`; `CANOPY_COEFFICIENT_DIVISOR` from
  `src/render/storm-radii.ts`; `CLOUD_TOP_*` + `DEBRIS_TOP_*` +
  `CLOUD_BAND_REFERENCE_Q` + `CLOUD_CROSSFADE_PERIOD_H` +
  `CLOUD_PULSE_PERIOD_H` + `CLOUD_ROTATION_CAP_RAD_PER_H` +
  `cloudSeedFromGenesis` from `src/render/cloud-motion.ts`;
  `CLOUD_MEMORY_MACRO_GAIN` + `DEBRIS_MAX_CLOUD` from
  `src/render/cloud-memory.ts`; `SST_MIN_C`/`SST_MAX_C` from
  `src/render/textures.ts`; `envMonthSuffix`/`eventMonthSuffix` from
  `src/env-sampler.ts`; `latLonToCell` from `src/grid.ts`; `BinLayer`,
  `ParsedBin`, `EnvSamplingMode` types.
- Produces (used by Task 5 and the runner):

```ts
export const REALISM_GRID_N = 192;
export function midlevelRhUniform(
  frame: FlightFrame,
  envSample: { midlevelRhPct: number } | null,
): number; // clamp01((diag.ventilationMeanRhPct ?? env.midlevelRhPct ?? 55) / 100)

export interface RealismFrameContext {
  frame: FlightFrame;
  genesis: { lat: number; lon: number } | null; // first track point (cloud seed)
  envShear: { u: number; v: number; magnitude: number }; // render-side env sample
  envSteer: { u: number; v: number };
  midlevelRh01: number;                 // via midlevelRhUniform
  monthIndex: number;
  displayTFrac: number;                 // UNOFFSET app render fraction; 0 in climatology
  samplingMode: EnvSamplingMode;
}
export interface RealismSources {
  envBin: ParsedBin | null;
  /** SHADER land mirror: binarize-then-bilinear over the landmask (App-truth
   * note 9). NOT the engine's nearest-cell isLand — that lives in the runner. */
  land01At: (lat: number, lon: number) => number;
  noise: RealismNoise;
  debris: DebrisState | null;
}
export interface RealismField {
  n: number;
  metricX: number;
  center: { x: number; y: number };     // clip
  cellKm: { x: number; y: number };     // metric cell size, km
  /** The shader's final `brightnessC`, quantized 0.01 C. Named btProxyC so it
   * cannot be confused with the shader's INTERNAL component-ladder local
   * `topC` (which excludes ambient cover and the warm-eye restoration). */
  btProxyC: Float32Array;
  cloud: Float32Array;                  // composite cover, quantized 1/1024
  stormCloud: Float32Array;
  ambientCloud: Float32Array;
  bands: Float32Array;                  // the shader's `rainbands` component
  /** The BAND arm of the shader's precipitatingCloud ONLY — precipBandEnvelope
   * * spiral mix * bandSupport * PRECIPITATING_CLOUD_BAND_MAX, times the
   * mix(TEXTURE_FLOOR, 1, macro) factor. The precipitation-EYEWALL arm is
   * deliberately excluded so RGR-004's band mask cannot be contaminated by
   * eyewall gradients (Codex r2 finding 1). */
  precipBandCloud: Float32Array;
  debris: Float32Array;
  oceanMask: Float32Array;              // 1 = ocean (land01At < 0.5)
}
export function buildRealismField(ctx: RealismFrameContext, sources: RealismSources): RealismField;
```

**Env-plane sampling (Codex finding 5 — quantize BEFORE filtering):** build a
per-field-plane byte view lazily: for layer L, plane t, normalization f
(`rh: v/100`, `sst: (v - 10) / 25`), the sampler reads the four surrounding
texels via `latLonToCell` (already GL texel-centre), byte-quantizes EACH texel
(`Math.round(clamp01(f(v)) * 255) / 255`), bilinears the quantized values
with CLAMP at edges, and in event mode blends plane `floor` and `ceil` of
`displayTFrac * (nt - 1)` by its fraction — filter-then-blend on quantized
texels, the exact GL pipeline order. In synoptic mode sample the single
selected plane. sst re-expands to °C via `sstC = q * 25 + 10`. Implement as:

```ts
function quantizedLayerSampler(
  layer: BinLayer,
  normalize: (v: number) => number,
): (plane: number, lat: number, lon: number) => number; // returns quantized [0,1]
```

**Per-cell composition:** transcribe `sampleCloud()` statement-by-statement,
keeping the shader's variable names (`canopyQ`, `bandEnvelope`,
`eyewallMaturity`, `towerPresence`, …) so review can diff against the GLSL.
Use ONLY the Task 2 helpers for `fract`/rotation/hash/smoothstep/mix. The
motion terms use `animGate = 1`, `u_cloudAgeH = u_ageH = frame.ageH`. The
debris read is `sources.debris` at crossfade fraction 0 (fields are sampled
at integer sim-hours): `memDensity = densityBytes[cell]/255`,
`memAge = ageBytes[cell]/255`, `u_hasCloudMemory = sources.debris ? 1 : 0`.
The CLOUD_TOPS ladder uses the Task 1 constants and `DEBRIS_TOP_*`; the eye
term restores `surfaceC - 4` — a mature storm's centre is WARM (the eye), not
cold. When `sources.envBin` is null: `localRh = 0.5` (already-quantized
value), `sstC = 28`; the runner always has bins — the null path exists for
unit tests only. Store quantized: `btProxyC` to 0.01 °C, cover fields to 1/1024
(cross-libm threshold-flip guard).

- [ ] **Step 1: Write the failing tests** (append; all code must typecheck
under strict/noUnusedLocals):

```ts
import { REALISM_GRID_N, buildRealismField, midlevelRhUniform } from '../src/realism-proxy';
import { weakFrame } from './helpers/realism';
import type { RealismField } from '../src/realism-proxy';

function contextFor(frame: ReturnType<typeof syntheticFrame>) {
  return {
    frame,
    genesis: { lat: 16, lon: 64 },
    envShear: {
      u: frame.structure.shearUms,
      v: frame.structure.shearVms,
      magnitude: Math.hypot(frame.structure.shearUms, frame.structure.shearVms),
    },
    envSteer: { u: -2, v: 3 },
    midlevelRh01: midlevelRhUniform(frame, null),
    monthIndex: 5,
    displayTFrac: 0,
    samplingMode: { kind: 'synoptic-plane', plane: 0 } as const,
  };
}

const openOcean = {
  envBin: null,
  land01At: () => 0,
  noise: new RealismNoise(),
  debris: null,
};

function centreCellIndex(field: RealismField): number {
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      const x = u * 2 - 1;
      const y = 1 - v * 2;
      const d = Math.hypot((x - field.center.x) * field.metricX, y - field.center.y);
      if (d < bestD) { bestD = d; best = j * field.n + i; }
    }
  }
  return best;
}

/** Coldest btProxyC in the eyewall annulus 0.8 <= r/rmw <= 1.3. */
function eyewallMinC(field: RealismField, rmwKm: number): number {
  let coldest = Infinity;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      const east = ((u * 2 - 1) - field.center.x) * field.metricX * 666;
      const north = ((1 - v * 2) - field.center.y) * 666;
      const q = Math.hypot(east, north) / rmwKm;
      if (q >= 0.8 && q <= 1.3) coldest = Math.min(coldest, field.btProxyC[j * field.n + i]);
    }
  }
  return coldest;
}

describe('midlevelRhUniform', () => {
  it('prefers ventilationMeanRhPct, then env sample, then 55', () => {
    const f = syntheticFrame();
    expect(midlevelRhUniform(f, { midlevelRhPct: 80 })).toBeCloseTo(0.58, 9);
    const noVent = syntheticFrame({
      diagnostics: { ...f.diagnostics, ventilationMeanRhPct: undefined },
    });
    expect(midlevelRhUniform(noVent, { midlevelRhPct: 80 })).toBeCloseTo(0.8, 9);
    expect(midlevelRhUniform(noVent, null)).toBeCloseTo(0.55, 9);
  });
});

describe('buildRealismField', () => {
  it('grid geometry: 192^2, metricX from frame latitude', () => {
    const field = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(field.n).toBe(REALISM_GRID_N);
    expect(field.btProxyC.length).toBe(REALISM_GRID_N * REALISM_GRID_N);
    expect(field.metricX).toBeCloseTo((20 * Math.cos((18 * Math.PI) / 180)) / 12, 9);
  });

  it('mature storm: eyewall annulus is far colder than the ambient far field', () => {
    const frame = syntheticFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const corner = field.btProxyC[0];
    expect(eyewallMinC(field, frame.structure.rmwKm)).toBeLessThan(corner - 40);
  });

  it('mature storm: the eye centre is WARMER than the eyewall (shader eye term)', () => {
    const frame = syntheticFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const centre = field.btProxyC[centreCellIndex(field)];
    expect(centre).toBeGreaterThan(eyewallMinC(field, frame.structure.rmwKm) + 20);
  });

  it('weak eyeless storm: centre is cold (no eye clearing)', () => {
    const frame = weakFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const centre = field.btProxyC[centreCellIndex(field)];
    expect(centre).toBeLessThan(-20);
  });

  it('stormCloud is zero everywhere when the frame is not alive', () => {
    const dead = syntheticFrame({ alive: false });
    const field = buildRealismField(contextFor(dead), openOcean);
    expect(Math.max(...field.stormCloud)).toBe(0);
  });

  it('is deterministic (two builds are byte-equal)', () => {
    const a = buildRealismField(contextFor(syntheticFrame()), openOcean);
    const b = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(a.btProxyC).toEqual(b.btProxyC);
    expect(a.cloud).toEqual(b.cloud);
  });

  it('precipBandCloud excludes the precipitation-eyewall arm', () => {
    // Eye-only rain: band support is zero, so a correct precipBandCloud is
    // zero EVERYWHERE even though the eyewall arm is strongly active. An
    // implementation that mistakenly stores the full precipitatingCloud
    // (max of both arms) fails here — this is the RGR-004 regression proof.
    const base = syntheticFrame();
    const eyeOnly = syntheticFrame({
      diagnostics: { ...base.diagnostics, eyewallRainMmH: 20, rainbandRainMmH: 0 },
    });
    const eyeField = buildRealismField(contextFor(eyeOnly), openOcean);
    expect(Math.max(...eyeField.precipBandCloud)).toBe(0);

    const bandOnly = syntheticFrame({
      diagnostics: { ...base.diagnostics, eyewallRainMmH: 0, rainbandRainMmH: 6 },
    });
    const bandField = buildRealismField(contextFor(bandOnly), openOcean);
    expect(Math.max(...bandField.precipBandCloud)).toBeGreaterThan(0);
  });
});
```


- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** the sampler, `midlevelRhUniform`, and the full
per-cell transcription (~200 lines) per the interface block above. Order of
statements and constant values must match the GLSL exactly as read in
`src/render/env.ts` lines 152-399 + the `CLOUD_CORE_GLSL`/`CLOUD_TOPS_GLSL`
splices; each transcription line keeps the shader's variable name.

- [ ] **Step 4: Run the new tests + full suite; expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/realism-proxy.ts test/realism-proxy.test.ts test/helpers/realism.ts
git commit -m "feat: realism BT-proxy field builder (CPU sampleCloud twin)"
```

---

### Task 5: Shortlist metrics (`src/realism-metrics.ts`)

One function per shortlist entry, faithful to the register's definitions
(Codex findings 1-3): RGR-001 thresholds the **BT-proxy** (`btProxyC`), not cover,
and is month-conditioned by the caller; RGR-004 masks to the **band
component**, not all storm cloud; RGR-006's weak bins are additionally
stage-split (pre-peak vs post-peak) by the caller.

**Files:**
- Create: `src/realism-metrics.ts`
- Test: `test/realism-metrics.test.ts`

**Interfaces:**

```ts
export const REALISM_ENV_CLOUDY_TOP_C = 0;     // RGR-001: cell is cloudy when btProxyC <= 0 C.
// Proxy threshold, sealed sim-side; the observed-side BT mapping is an R2b
// decision recorded against this constant's name.
export const REALISM_COLD_TOP_C = -60;         // cold-top threshold, deg C
export const REALISM_ENV_EXCLUSION_OUTER_MULT = 3;   // RGR-001 exclusion radius
export const REALISM_COLD_SEARCH_OUTER_MULT = 4;     // RGR-003/013 search radius
export const REALISM_EYE_CORE_Q = 0.35;        // RGR-002 eye disc, r/rmw
export const REALISM_EYEWALL_RING_Q_MIN = 0.8;
export const REALISM_EYEWALL_RING_Q_MAX = 1.3;
export const REALISM_BAND_MASK_MIN = 0.1;      // RGR-004 band-component mask
export const REALISM_INNER_OUTER_SPLIT_KM = 200;     // Hence & Houze regime break
export const REALISM_EDGE_OUTER_LIMIT_KM = 600;
export const REALISM_MIN_COLD_CELLS = 8;
/**
 * AT OR BELOW this shear-vector length (m/s) the display direction is the
 * shader's DECORATIVE fallback — env.ts keeps the physical direction only
 * for length STRICTLY greater than 0.05 (`length(u_shearVector) > 0.05`).
 * Shear-relative metrics therefore refuse to report a direction when
 * `length <= REALISM_MIN_SHEAR_DIR_MS`: centroid bearing and all four
 * quadrant means return null. The field itself still uses the fallback
 * direction, mirroring the display.
 */
export const REALISM_MIN_SHEAR_DIR_MS = 0.05;

export interface RealismFrameMetrics {
  ageH: number;
  vKt: number;
  environmentalCloudFraction: number | null;   // RGR-001 (null: no eligible ocean cells)
  eyeContrastC: number | null;                  // RGR-002 (null: eyeStrength <= 0.05)
  coldTop: {                                    // RGR-003/006/013
    areaKm2: number;
    centroidOffsetKm: number | null;
    centroidBearingRelToShearDeg: number | null; // (-180,180], 0 = downshear
  };
  bandEdgeEnergy: {                             // RGR-004, mean |grad btProxyC| C/km
    innerCPerKm: number | null;                 // band-masked, r <= 200 km
    outerCPerKm: number | null;                 // band-masked, 200 < r <= 600 km
    byShearQuadrant: {                          // band-masked, all radii <= 600 km
      dl: number | null; dr: number | null; ul: number | null; ur: number | null;
    };
  };
}
export function metricsForField(field: RealismField, ctx: RealismFrameContext): RealismFrameMetrics;
```

Definitions (also as code comments):
- Cell→storm geometry in metric km:
  `east = (cellClipX - center.x) * metricX * 666`,
  `north = (cellClipY - center.y) * 666`.
- **RGR-001**: over cells with `oceanMask = 1` and
  `distanceKm > 3 * outerSizeKm`: fraction with
  `btProxyC <= REALISM_ENV_CLOUDY_TOP_C`. (Month conditioning is aggregation-side:
  Task 7 groups by `monthIndex`.)
- **RGR-002**: mean `btProxyC` over `q <= 0.35` minus mean over
  `0.8 <= q <= 1.3`, `q = distanceKm / rmwKm` (unwobbled). Positive = warm
  eye against a cold eyewall. Null unless `eyeStrength > 0.05` with
  `eyeStrength = smoothstep(0.18, 0.56, intensity01 * organization) * smoothstep(0.62, 0.82, organization)`.
- **RGR-003/006/013**: cold mask = `btProxyC < -60` within `4 * outerSizeKm`;
  `areaKm2 = count * cellKm.x * cellKm.y`; centroid over the mask in
  (east, north) km; `offsetKm = hypot`; bearing relative to shear =
  `normalizeDeg(atan2(east, north) - atan2(shearU, shearV))` in degrees;
  centroid fields null when `count < 8`; the bearing (and every shear
  quadrant in RGR-004) additionally null when
  `envShear.u/v` vector length `<= REALISM_MIN_SHEAR_DIR_MS` (the shader's
  physical direction requires STRICTLY greater) — no direction is ever
  reported against the decorative fallback axis. `offsetKm` and `areaKm2`
  remain valid in calm shear.
- **RGR-004**: central-difference `|∇btProxyC|` in C/km, computed ONLY over
  band-masked cells: `max(bands[cell], precipBandCloud[cell]) >= 0.1` — the
  precipitation-eyewall arm is not part of either component, so eyewall
  gradients cannot leak in (test this: a strong gradient across unmasked
  cells contributes nothing). Central differences use only cells whose four
  neighbours are in-grid — the outermost grid ring never contributes
  (border policy, sealed). Inner/outer
  by the 200 km split (outer capped at 600 km); quadrants over all masked
  cells within 600 km, classified by the signed angle between the cell
  bearing and the shear bearing: |angle| <= 90 is downshear, left/right by
  the cross-product sign (`shear × cell` positive = left). Every mean is null
  when its masked cell count is 0.

- [ ] **Step 1: Write the failing tests**

Create `test/realism-metrics.test.ts` — synthetic 8×8 fields with
hand-computable values (all fixture code must typecheck; `syntheticFrame` /
`weakFrame` from `./helpers/realism`):

```ts
import { describe, expect, it } from 'vitest';
import type { RealismField } from '../src/realism-proxy';
import {
  REALISM_ENV_CLOUDY_TOP_C,
  metricsForField,
} from '../src/realism-metrics';
import { syntheticFrame, weakFrame } from './helpers/realism';

function blankField(): RealismField {
  const n = 8;
  const fill = (value: number) => new Float32Array(n * n).fill(value);
  return {
    n, metricX: 1, center: { x: 0, y: 0 },
    cellKm: { x: (2 / n) * 666, y: (2 / n) * 666 },
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
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/realism-metrics.ts`** per the definitions.
All helpers local and pure; no imports from render paths (only types +
constants from `realism-proxy`).

- [ ] **Step 4: Run both realism test files + `npm test`; expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/realism-metrics.ts test/realism-metrics.test.ts
git commit -m "feat: R2a shortlist metrics over the realism BT-proxy field"
```

---

### Task 6: Frozen scenario set

**Files:**
- Create: `calibration/realism/realism-scenarios.json`
- Test: `test/realism-scenarios.test.ts`

The set covers the R1 paired-session storms (event replays, the app's
hindcast mode) plus SEVEN fixed climatology storms — one per baked season
month (May..Nov = `bake/sources.py` `SEASON_MONTHS` monthIndex 4..10, the
same clamp range as `envMonthSuffix`) — arbitrary-but-frozen triplets so
RGR-001's month conditioning has a full-season simulation cohort.

- [ ] **Step 1: Write the file**

```json
{
  "version": 1,
  "comment": "Frozen R2a realism scenario set. Events replay the app's hindcast mode (public steering + monthly ocean + observed initial motion, default parameters). Climatology storms are fixed (spawn, month, seed) triplets - arbitrary but frozen before the first reference seal. Changing ANY entry re-opens the seal (delete realism-reference.json, rerun npm run realism in the same PR, record the A/B verdict in the register).",
  "sampleEveryH": 6,
  "climatologyMaxHours": 240,
  "events": ["gonu", "kyarr", "shaheen", "biparjoy", "ashobaa"],
  "climatology": [
    { "id": "clim-may", "monthIndex": 4, "lat": 15.8, "lon": 65.0, "seed": 11052026 },
    { "id": "clim-jun", "monthIndex": 5, "lat": 16.5, "lon": 64.0, "seed": 12062026 },
    { "id": "clim-jul", "monthIndex": 6, "lat": 17.0, "lon": 62.5, "seed": 13072026 },
    { "id": "clim-aug", "monthIndex": 7, "lat": 16.2, "lon": 66.5, "seed": 14082026 },
    { "id": "clim-sep", "monthIndex": 8, "lat": 17.5, "lon": 63.0, "seed": 15092026 },
    { "id": "clim-oct", "monthIndex": 9, "lat": 16.8, "lon": 61.5, "seed": 16102026 },
    { "id": "clim-nov", "monthIndex": 10, "lat": 16.0, "lon": 63.5, "seed": 17112026 }
  ]
}
```

- [ ] **Step 2: Write the validation test** — `test/realism-scenarios.test.ts`
(string paths per `test/node-fs.d.ts`; vitest cwd is the repo root):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMAIN, inBBox } from '../src/grid';

const spec = JSON.parse(
  readFileSync('calibration/realism/realism-scenarios.json', 'utf8'),
) as {
  version: number;
  sampleEveryH: number;
  climatologyMaxHours: number;
  events: string[];
  climatology: { id: string; monthIndex: number; lat: number; lon: number; seed: number }[];
};
const catalogue = JSON.parse(
  readFileSync('public/data/scenarios.json', 'utf8'),
) as { scenarios: { id: string; hindcast: unknown }[] };

describe('realism scenario set', () => {
  it('every event id exists in the app catalogue with hindcast metadata', () => {
    for (const id of spec.events) {
      const scenario = catalogue.scenarios.find((s) => s.id === id);
      expect(scenario, id).toBeDefined();
      expect(scenario?.hindcast, id).toBeTruthy();
    }
  });

  it('climatology triplets are in-domain, in-season, integer-seeded', () => {
    expect(spec.climatology).toHaveLength(7);
    expect(new Set(spec.climatology.map((c) => c.monthIndex)).size).toBe(7);
    for (const c of spec.climatology) {
      expect(Number.isInteger(c.seed)).toBe(true);
      expect(c.monthIndex).toBeGreaterThanOrEqual(4);
      expect(c.monthIndex).toBeLessThanOrEqual(10);
      expect(inBBox(c.lat, c.lon, DOMAIN)).toBe(true);
    }
  });

  it('cadence and horizon are frozen', () => {
    expect(spec.sampleEveryH).toBe(6);
    expect(spec.climatologyMaxHours).toBe(240);
  });
});
```

- [ ] **Step 3: Run it, expect PASS** (adjust spawns if any is out of the
15-27 N / 50-70 E domain).

- [ ] **Step 4: Commit**

```bash
git add calibration/realism/realism-scenarios.json test/realism-scenarios.test.ts
git commit -m "feat: frozen R2a realism scenario set"
```

---

### Task 7: Runner (`calibration/realism/realism.mjs`) + npm scripts + first seal

Mirror `calibration/fidelity.mjs`'s structure (ssrLoadModule block, artifact
manifests with sha256, `canonicalizeNumbers` copied with a provenance comment
— do NOT touch fidelity.mjs, `--check` mode, report template), with these
deliberate differences:

- **`ROOT` is two levels up** (`resolve(dirname(fileURLToPath(import.meta.url)), '../..')`)
  because this runner lives in `calibration/realism/`. Guard at startup:
  throw unless `package.json` and `public/data/scenarios.json` exist under
  ROOT.
- Replay wiring is the APP's, not fidelity's (see "App-truth notes"):
  - Events: scenario from `public/data/scenarios.json` via `parseScenarios`;
    env bin `resolve(ROOT, 'public', scenario.bin)`; steering bin path via
    `scenario.bin.replace(/(^|\/)env_/, '$1steering_')` under `public/`;
    tracks from `public/data/tracks.json` via `parseTracks`, and the spawn is
    `eventSpawn(scenario, null, 'hindcast')` **plus**
    `initialMotionUms/initialMotionVms` from
    `observedInitialMotionMs(track.points, scenario.hindcast.startIso)` when
    non-null; `makeEnvSampler(() => eventBin)` in `event-timeline` mode;
    `pressureWindSamplerFromBin(() => steeringBin, () => ({ kind: 'event-timeline' }))`;
    `oceanProfileSampler = (lat, lon, m) => sampleOceanProfileBin(oceanBin, lat, lon, m)`
    over `public/data/ocean.bin`; `isLand` = nearest-cell landmask mirror of
    `ui.isLand` (latLonToCell + Math.round + clamp + `> 0.5`);
    `terrainHeightM` from the `elev` layer (bilinear, as main.ts does);
    `createSimEngine` with NO `physicsProfile` and NO parameter overrides;
    tick 15-minute steps through `windowH - hindcast.envOffsetH` hours or
    death; record all frames with `FlightRecorder` (start meta as in
    `runDetailedHindcastCase`).
  - Climatology: env bin `public/data/env.bin`;
    `setSamplingMode(samplingModeForSpawn(false, seed, synopticCount(envBin, monthIndex)))`;
    steering getter returns null; same ocean/terrain/isLand; spawn
    `{ lat, lon, monthIndex, seed, isDemo: false }`; run to
    `climatologyMaxHours` or death.
- Sampling: frames at integer multiples of 6 sim-hours, `ageH >= 6`, alive.
  Per sampled frame: `computeDebrisState(Math.floor(ageH), frameAtOrBefore, noise, cloudSeed, 192)`
  where `frameAtOrBefore(b)` returns the last recorded frame with
  `frame.ageH <= b + 1e-9`; `cloudSeed = cloudSeedFromGenesis(firstFrame)`;
  then `buildRealismField` with
  `sources = { envBin (the scenario's event bin, or env.bin), land01At (the
  binarize-then-bilinear landmask sampler — App-truth note 9, distinct from
  the engine's nearest-cell isLand), noise (one shared RealismNoise), debris }`,
  then `metricsForField`.
- **Context time base (Codex finding 13):** `displayTFrac` and the centre
  env sample (`envShear`/`envSteer`, via `sampler.sample(lat, lon, monthIndex, displayTFrac)`)
  use the app's UNOFFSET render fraction
  `eventTimeFraction(ageH, scenario.windowH)` for events, 0 for climatology.
  Physics replay keeps `tFracOffsetH` — two different time bases, exactly
  like the shipped app. `midlevelRh01 = midlevelRhUniform(frame, centreEnvSample)`.
- Aggregation (per class `climatology` | `event`):
  - intensity bins `[20,35) [35,50) [50,64) [64,83) [83,100) [100,200)` kt:
    `{ count, median, mean }` for `eyeContrastC` and `coldTop.areaKm2`;
  - **month-conditioned** `{ count, median, mean }` of
    `environmentalCloudFraction` keyed by `monthIndex` (RGR-001's register
    definition);
  - **weak-bin × stage** (RGR-006): for vKt bins `[20,35)` and `[35,50)`
    crossed with stage `pre-peak` / `post-peak`. Sealed stage rule:
    `peakAgeH` = the ageH of the FIRST frame attaining the run's maximum vKt
    (first-maximum tie-break for plateaus); `stage = ageH <= peakAgeH ?
    'pre-peak' : 'post-peak'` — the peak frame itself counts pre-peak, so a
    storm whose maximum is its spawn frame still contributes a genesis-side
    sample:
    `{ count, median, mean }` of `coldTop.areaKm2` AND
    `coldTop.centroidOffsetKm`;
  - unbinned `{ count, median, mean }` for `coldTop.centroidOffsetKm`,
    `|centroidBearingRelToShearDeg|`, `bandEdgeEnergy.innerCPerKm`,
    `bandEdgeEnergy.outerCPerKm`, and the four quadrant means.
  - Median = sorted midpoint (mean of the two middles for even counts).
    Nulls are excluded before sorting; `count` counts non-null samples.
- Reference (`realism-reference.json`):
  `{ schemaVersion: 1, scenariosSha256, protocol: { maxDriftFraction: 0.05, numericPrecisionDecimalPlaces: 9 }, frameCounts: { [scenarioId]: n }, aggregate }`
  — written only when absent (first seal), else loaded frozen, exactly the
  fidelity.mjs pattern. Reseal flow documented in the README: delete the
  file, rerun `npm run realism`, record the A/B verdict in the register in
  the same PR.
- **Comparison (Codex finding 16):** fail when (a) `scenariosSha256`
  differs; (b) any `frameCounts` entry differs or is missing/extra; (c) the
  reference and current `aggregate` do not have IDENTICAL key trees (walk
  both; any missing/extra key fails); (d) any `count` leaf differs at all;
  (e) any `median`/`mean` leaf drifts `|current/ref - 1| > 0.05` (ref 0 →
  require exact 0; null vs number → fail). Both drift directions fail:
  descriptive stability, improvements go through reseal + A/B.
- Determinism hygiene: every directory listing (observed refs) sorted with
  `.sort()`; every map serialized through explicitly sorted keys; paths
  normalized `\\ → /` (fidelity.mjs's manifest pattern).
- Report (`docs/realism-benchmark.md`): title
  "# R2a realism benchmark — simulated-product field-space metrics
  (sim-side scaffold)"; "> Deterministic report generated by
  `npm run realism`…"; a verdict section (REFERENCE STABLE / DRIFT
  DETECTED); a protocol section (proxy definition, measurement pose, grid,
  cadence, thresholds, and verbatim: "The BT-proxy is a deterministic CPU
  twin of the simulated infrared layer — a **simulated cloud-top
  brightness-temperature proxy**, not radiometric data, and these metrics
  carry no forecast-skill claim. This is the R2a sim-side scaffold; R2 is
  complete only when R2b lands observed derived-statistics references and
  the IMERG rain-truth comparison."); the aggregate tables (per-bin eye
  contrast, cold-top area, month-conditioned environmental cloud fraction,
  weak-bin × stage tables, band edge energy inner/outer + quadrants); a
  per-scenario table (id, class, frames, run length); the shortlist
  traceability table (metric ↔ RGR id ↔ literature anchor, hedged anchors
  marked "order-of-relationship only"); an "Observed references" section
  listing sorted committed files under `calibration/realism/observed/`
  (excluding `EXAMPLE.*`) or stating none are committed yet (R2b); Limits
  (regression-only gate; A/B protocol accepts improvements; proxy caveats;
  climatology storms are synthetic; single-platform seal caveat until the
  cross-platform check below is done).
- `--check`: byte-compare all three artifacts + require
  `referenceComparison.passed`.

**Files:**
- Create: `calibration/realism/realism.mjs`, `calibration/realism/README.md`
- Modify: `package.json`
- Generated + committed: results, reference, report

- [ ] **Step 1: Write the runner** per the above, skeleton from fidelity.mjs
(paths → ROOT two levels up; ssrLoadModule list from this plan's
Interfaces; `canonicalizeNumbers` + `RESULT_DECIMAL_PLACES = 9` copied with
"copied from calibration/fidelity.mjs — keep in sync" comments).

- [ ] **Step 2: Add npm scripts** (after `"profile:ensemble"`):

```json
    "realism": "node --experimental-strip-types calibration/realism/realism.mjs",
    "realism:check": "node --experimental-strip-types calibration/realism/realism.mjs --check",
```

- [ ] **Step 3: First run + seal**

Run: `npm run realism`
Expected: writes results + reference + report; console
`[realism] wrote … gate=PASS scenarios=12`. If runtime exceeds ~5 minutes,
profile the field builder — do NOT lower the cadence or grid.

- [ ] **Step 4: Verify determinism + frozen gates untouched**

Run: `npm run realism:check` (byte-stable PASS), then `npm test`,
`npm run calibrate:check`, `npm run hf6:verify:check`, `npm run hf6:gate:check`,
`npm run hf6:prospective:check`, `npm run data:hf6:catalog:check`.
Expected: all PASS.

- [ ] **Step 5: Write `calibration/realism/README.md`** — files, commands,
reseal flow, gate semantics (regression-only; advisory — not in the CI
deploy gate), the validation-partition note (three events sit in the
hindcast validation partition; realism metrics tune nothing and must never
be cited as intensity evidence), and the **cross-platform seal protocol**:
the first seal is produced on one platform; before `realism:check` may be
promoted to CI-blocking, regenerate on a Linux runner and require
byte-equality with the committed artifacts; until then the report carries
the single-platform caveat.

- [ ] **Step 6: Commit**

```bash
git add calibration/realism/ package.json docs/realism-benchmark.md
git commit -m "feat: R2a realism measurement harness - runner, sealed reference, benchmark report"
```

---

### Task 8: Observed-reference schema (extraction deferred to R2b)

**Files:**
- Create: `calibration/realism/observed/README.md`
- Create: `calibration/realism/observed/EXAMPLE.derived-stats.json`

Dimensional schema v2 (Codex findings 18 + r2-2) — **one file per observed
source bundle**, carrying a `metrics` array so a bundle can serve several
shortlist entries; every value record is traceable to specific observed
frames through `provenanceIds`; metric parameters are structured, not prose:

```json
{
  "schemaVersion": 2,
  "source": {
    "bundleId": "eumetview-seviri-ir108-shaheen-2021",
    "product": "EUMETSAT Meteosat-9 IODC SEVIRI IR10.8 (EUMETView WMS)",
    "kind": "geostationary-ir"
  },
  "provenance": [
    {
      "id": "p1",
      "frameId": "shaheen/peak-obs",
      "validTime": "2021-10-02T09:00:00Z",
      "sourceUrl": "…",
      "acquisitionTimestamp": "2026-07-30T09:00:00Z",
      "accessDate": "2026-08-02",
      "licenceNote": "Derived statistic committed per register decision D2; no raw frame is committed.",
      "sha256OfSourceFrame": "computed at extraction time; the frame itself is NOT committed"
    }
  ],
  "metrics": [
    {
      "metricId": "environmentalCloudFraction",
      "registerEntry": "RGR-001",
      "metricVersion": "realism-metrics.ts@r2a-1",
      "parameters": {
        "observedBtThresholdK": null,
        "mapsToSimConstant": "REALISM_ENV_CLOUDY_TOP_C",
        "exclusionRadius": "3 * outerSizeKm"
      },
      "method": "verbatim description of the computation",
      "values": [
        {
          "dimensions": { "monthIndex": 9, "stage": "pre-peak" },
          "value": null,
          "sampleCount": 0,
          "uncertainty": null,
          "provenanceIds": ["p1"]
        }
      ]
    }
  ]
}
```

Rules stated in the README: every `dimensions` key
(`monthIndex`, `intensityBinKt`, `stage`, `radialRegion`, `shearQuadrant`)
is optional per record — absent = marginal over that dimension; `value`
MUST be `null` whenever `sampleCount` is 0; every value record MUST cite at
least one `provenanceIds` entry that exists in `provenance`; `parameters`
holds the actual thresholds/regions as data (nulls permitted until R2b
seals them), with `method` as the prose companion. The README also states
the D2 rule verbatim (derived statistics + provenance manifest, never new
raw EUMETSAT frames), the D1 IMERG decision for rain truth, and that
extraction tooling is R2b scope.

- [ ] **Step 1: Write both files.**
- [ ] **Step 2: Verify `npm run realism:check` still passes** (the
`EXAMPLE.` prefix is excluded by the runner's sorted listing).
- [ ] **Step 3: Commit**

```bash
git add calibration/realism/observed/
git commit -m "docs: dimensional observed derived-statistics schema for the realism harness"
```

---

### Task 9: Docs wiring

**Files:**
- Modify: `CLAUDE.md` — Commands: "`npm run realism` regenerates the R2a
  realism benchmark report; `npm run realism:check` verifies without writing
  (advisory — not yet a CI gate)." Add `docs/realism-benchmark.md` to the
  machine-generated never-hand-edit list.
- Modify: `docs/README.md` — index `docs/realism-benchmark.md` and
  `calibration/realism/README.md`.
- Modify: `ROADMAP.md` — under the realism program entry:
  "R2a sim-side harness scaffold landed (advisory). R2 completes only with
  R2b — observed derived-statistics references (EUMETSAT per D2) and the
  GPM IMERG rain-truth comparison (D1)." Name R2b as a forward item.

- [ ] **Step 1: Make the three edits** (match each file's voice).

- [ ] **Step 2: Full verification pass**

Run: `npm test && npm run build && npm run calibrate:check && npm run realism:check`
Expected: all PASS.

- [ ] **Step 3: Commit + push + PR**

```bash
git add CLAUDE.md docs/README.md ROADMAP.md
git commit -m "docs: wire the R2a realism harness into commands, docs index, roadmap"
git push -u origin feat/realism-r2-harness
```

PR body: summary (spec §"R2 — measurement harness" + register shortlist
citations; explicitly "R2a sim-side scaffold — R2b observed integration is a
named follow-up"), test plan (the Step 2 command list, `npm run realism`
reproducibility, and the cross-platform check as a pre-promotion — not
pre-merge — item), advisory-rollout note. Full-branch diff review
(`git diff main...HEAD`).

---

## Self-review + external-review record

**Codex round 1 (2026-08-02, gpt-5.6-sol, verdict REVISE):** 18 findings, all
verified against the code before acceptance, none refuted. Incorporated:
RGR-001/004/006 restored to their register definitions (findings 1-3);
`u_midlevelRh` precedence via `midlevelRhUniform` (4); quantize-then-filter
env-plane sampler + corrected half-texel claim (5); tested GLSL-semantics
helpers incl. clockwise `rotate2` and negative-safe `fract` (6); Task 1
digest pin `4ed94b08…` computed pre-refactor (7); debris storage moved to
Uint8Array (8); Task 4 tests rewritten to typecheck and to expect a WARM eye
centre with a weak eyeless counter-fixture (9, 10); string paths per
`test/node-fs.d.ts` (11); runner ROOT `../..` + startup guard (12); unoffset
display-time base for all proxy env inputs, physics keeps the offset, app
inconsistency flagged to the owner as a candidate register entry (13);
observed initial motion, nearest-cell `isLand`, steering path via the app's
replace rule (14); sorted listings + cross-platform seal protocol + report
caveat (15); exact key-tree/count parity, tolerance only on value leaves
(16); renamed R2a throughout — "R2 complete" reserved for R2b (17);
dimensional observed schema (18).

**Codex round 2 (2026-08-02, gpt-5.6-sol, CLOSED 16/18, verdict REVISE):**
9 findings, all verified against the code (the land-texture upload, the
vitest import list, and `bake/sources.py` SEASON_MONTHS were re-read
directly), none refuted; Codex independently reconfirmed the Task 1 digest.
Incorporated in revision 3: RGR-004's mask now uses a dedicated
`precipBandCloud` component that excludes the precipitation-eyewall arm,
closing original finding 2 for real (r2-1); observed schema v2 with
provenance-linked, parameterized metric records (r2-2, closing original 18);
Task 1 test uses the file's imported `test`, not `it` (r2-3); the field
takes `land01At` — the shader's binarize-then-LINEAR land — while the
engine keeps nearest-cell `isLand`, both recorded as App-truth note 9
(r2-4); the field's temperature array is `btProxyC` (the shader's final
`brightnessC`), no longer name-colliding with the shader's internal `topC`
ladder local (r2-5); `clim-nov` added — the baked season is May..Nov, 7
climatology storms, 12 scenarios (r2-6); `REALISM_MIN_SHEAR_DIR_MS = 0.05`
nulls direction-relative outputs in calm shear, with tests (r2-7); border
policy sealed — central differences only where all four neighbours exist,
with an in-radius border test (r2-8); stage rule sealed — first-maximum
peak counts as pre-peak (r2-9).

**Codex round 3 (2026-08-02, gpt-5.6-sol, CLOSED 7/9, verdict REVISE):**
two P1s, both accepted (the shader's `> 0.05` strictness re-verified in
env.ts). Incorporated in revision 4: (r3-1) regression-proof tests for
`precipBandCloud` — an eye-only-rain fixture must produce an all-zero
component and a band-only fixture a nonzero one, plus a metric test where
`precipBandCloud` alone activates the RGR-004 mask, so an implementation
that stores the full `precipitatingCloud` cannot pass; (r3-2) the shear
gate is `<= REALISM_MIN_SHEAR_DIR_MS` (null at exactly 0.05, matching the
shader's strictly-greater physical-direction condition), tested at 0, 0.04,
exactly 0.05, and 0.06, asserting the bearing and all four quadrants.
Round 3 independently confirmed the border-test geometry (588.666 km /
824.133 km), the calm-test centroid (117.733 km), the Task 6 type, the
schema-v2 example, and the absence of stale `topC` references.

**Codex round 4 (2026-08-02, narrow closure check, CLOSED 1/2, REVISE):**
r3-2 closed (strict-gate boundary and `Math.hypot(0.05, 0) === 0.05`
confirmed); the Task 4 regression-proof test confirmed valid (~2,300
positive band-envelope cells for the band-only fixture; a full
`precipitatingCloud` store fails the eye-only assertion). One P1 survived:
the Task 5 mask test perturbed only the masked cell, whose own value never
enters its central difference — gradient exactly zero, test unfailable-in-
reverse. Fixed in revision 5 by moving the temperature step to a neighbour
(Codex's prescribed fix, applied verbatim; the fixture's mask cell and
geometry are unchanged). Revision 5 = revision 4 + that one fixture line;
it has not itself been re-reviewed.

**Standing items for the repo owner (not resolved by this plan):**
1. The app's event-replay display/physics time-base inconsistency
   (render samples env at unoffset `eventTimeFraction`; physics offsets by
   `envOffsetH`) — candidate register entry; fixing it changes rendered
   output and needs its own A/B.
2. The 11 raw EUMETSAT frames committed under
   `docs/research/realism/captures/` remain flagged in the register and
   charter; this plan neither adds to nor resolves that exposure.

**Spec-coverage check (rev 2):** R2 contract items — location, commands,
field-space CPU metrics, canonicalization, regression-only gate + reseal,
advisory rollout: covered here. Observed derived statistics + rain truth:
explicitly R2b, with the naming discipline finding (17) applied so no
artifact claims R2 completion.

**Placeholder scan (rev 2):** Task 4's per-cell body is intentionally
specified as a statement-by-statement transcription of `sampleCloud()` with
its inputs, pose, sampler, and every non-obvious semantic (rotation
direction, fract, quantize-then-filter, unoffset time base, warm eye)
pinned by tests and the App-truth notes — the one place the plan directs
the implementer to the authoritative source (the shader text) instead of
duplicating ~200 lines that would then be the un-reviewed copy.

**Type-consistency check (rev 2):** `RealismField` now carries `bands`,
`precipBandCloud`, `oceanMask` from Task 4 onward; Task 5's `blankField` matches;
`DebrisState` byte arrays are consumed as `/255` in Task 4's debris read;
`midlevelRh01`/`displayTFrac` flow runner → context → builder.
