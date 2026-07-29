# Simulated IR Cloud Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-29-simulated-ir-cloud-motion-design.md` (SPEC_GATED — read it first; its constraints are binding).

**Goal:** Make the simulated IR cloud field visibly circulate (differential, Holland-profile-driven, perception-capped), grade cloud-top temperatures per component with transient overshooting tops, add visible-palette relief shading, and break up the too-perfect inner-core annulus — all render-only, deterministic, inside the existing env shader.

**Architecture:** A new pure CPU module `src/render/cloud-motion.ts` owns the motion constants, the scalar math (angular rate, phase weights, interpolated age) as testable CPU mirrors, and the GLSL chunk that the `env.ts` fragment shader embeds via template literal (same pattern as `rainband-profile.ts` constants). `env.ts` gains two uniforms (`u_cloudAgeH`, `u_reducedMotion`) and reworks `sampleCloud()`'s motion, temperature, and core-geometry blocks. No other runtime file changes.

**Tech Stack:** TypeScript + WebGL2 GLSL ES 3.00, vitest, Playwright (browser QA), Python (`bake/validate_satellite_structure.py`) for the morphology screen.

## Global Constraints

Copied from the gated spec — every task implicitly includes these:

- **No new textures or samplers.** The env program uses exactly all 16 guaranteed WebGL2 fragment texture units (0–15). Every new signal derives from the existing `u_cloudNoise`.
- **Raw texture-lookup budget:** +4 cloud-noise lookups on the detail tier, +3 on mobile; visible relief adds at most +2 more only in that palette. A higher budget needs a new gate.
- **Render-only product diff:** `src/render/env.ts`, a small pure render helper (`src/render/cloud-motion.ts`), focused tests. `src/sim.ts`, flight recorder, baked data, frozen acceptance/contract files, physics reports untouched. The regenerated satellite morphology report is the only permitted `calibration/` output.
- **Determinism:** decorative motion is a pure function of interpolated simulated age (`u_cloudAgeH`); rain support stays on raw `u_ageH` and `u_rainCenter` with `RAINBAND_SPIRAL_ROTATION_PER_H`. No wall-clock input. Pause freezes everything; the same replay frame reproduces the same pixels.
- **Reduced motion** (`prefers-reduced-motion`) is a separate uniform from the detail tier: it disables fast circulation, rotating mesovortices, cirrus streaming, and pulse cycling while preserving non-animated cloud morphology.
- **Rotation direction:** counter-clockwise apparent motion in the shader's east/north coordinates (Northern Hemisphere). Band sines use `k * (azimuth - thetaRef)`, never a bare `+ thetaRef`.
- **Perception cap** ~0.6 rad/sim-hour, named constant, commented as a perception cap, not physics. Unit conversion goes through `HALF_DOMAIN_HEIGHT_KM = 666` (`src/render/storm-radii.ts`).
- **Performance gate:** candidate p95 main-thread frame work may not regress more than the larger of 20% or 1 ms vs current build; missed-frame fraction may not rise more than 5 percentage points. Same machine/viewport/tier/frame/300-frame window; record raw numbers.
- **Morphology gate:** re-capture the Shaheen 2.5 h grayscale frame, rerun `bake/validate_satellite_structure.py` with unchanged thresholds; all five checks must stay true. A failure changes the renderer, not the thresholds. If the observed input cannot be lawfully recovered, acceptance stops.
- File size cap 800 lines (`env.ts` is ~739 — the GLSL chunk must live in `cloud-motion.ts`, not grow `env.ts` past the cap).

**One deliberate spec interpretation (flag to reviewer, do not silently change):** the spec asks for cirrus "outward radial drift". True radial outflow needs either unbounded zoom (blurs) or a third flow-map pair (+1 lookup, over budget). The plan implements cirrus **streaming along the shear direction** (unbounded pure translation of REPEAT noise — zero distortion, zero extra lookups), which reads as outward streaming on the downshear side where cirrus dominates. If the reviewer rejects this, the fallback is a new budget gate per the spec.

---

### Task 1: CPU motion contract (`cloud-motion.ts`)

**Files:**
- Create: `src/render/cloud-motion.ts`
- Test: `test/cloud-motion.test.ts`

**Interfaces:**
- Consumes: `HALF_DOMAIN_HEIGHT_KM` from `./storm-radii`.
- Produces (used verbatim by Task 2's shader wiring):
  - `CLOUD_ROTATION_CAP_RAD_PER_H = 0.6`
  - `CLOUD_CROSSFADE_PERIOD_H = 0.75`
  - `CLOUD_BAND_REFERENCE_Q = 2.5`
  - `CLOUD_PULSE_PERIOD_H = 2`
  - `LEGACY_CLOUD_ROTATION_RAD_PER_H = 0.028`
  - `interpolatedCloudAgeH(prevAgeH: number | null, ageH: number, alpha: number): number`
  - `cloudAngularRateRadPerH(rKm: number, rmwKm: number, vmaxMs: number, hollandB: number): number`
  - `cloudAngularRateAtClipRadius(rUnits: number, rmwUnits: number, vmaxMs: number, hollandB: number): number` — the exact GLSL mirror including the 666-km conversion
  - `flowPhaseState(cloudAgeH: number): { phaseA: number; phaseB: number; weightA: number; weightB: number }`
  - `CLOUD_MOTION_GLSL: string` (added in Task 2 — this task creates the module with constants + scalar helpers only)

- [ ] **Step 1: Write the failing test**

```ts
// test/cloud-motion.test.ts
import { describe, expect, test } from 'vitest';
import {
  CLOUD_CROSSFADE_PERIOD_H,
  CLOUD_ROTATION_CAP_RAD_PER_H,
  cloudAngularRateAtClipRadius,
  cloudAngularRateRadPerH,
  flowPhaseState,
  interpolatedCloudAgeH,
} from '../src/render/cloud-motion';

describe('interpolatedCloudAgeH', () => {
  test('interpolates between fixed steps', () => {
    expect(interpolatedCloudAgeH(10, 10.25, 0.4)).toBeCloseTo(10.1, 12);
  });

  test('falls back to current age without a previous frame', () => {
    expect(interpolatedCloudAgeH(null, 5, 0.7)).toBe(5);
  });

  test('clamps alpha into [0,1]', () => {
    expect(interpolatedCloudAgeH(10, 10.25, 1.7)).toBeCloseTo(10.25, 12);
    expect(interpolatedCloudAgeH(10, 10.25, -0.3)).toBeCloseTo(10, 12);
  });

  test('never runs backwards across a storm respawn', () => {
    // prev frame belonged to the old storm (age 87 h), new storm is 0.25 h old
    expect(interpolatedCloudAgeH(87, 0.25, 0.5)).toBe(0.25);
  });
});

describe('cloudAngularRateRadPerH', () => {
  test('caps the eyewall rate for display', () => {
    // 40 m/s at the 30-km RMW: raw 3.6*40/30 = 4.8 rad/h, far above the cap
    expect(cloudAngularRateRadPerH(30, 30, 40, 1.35)).toBe(
      CLOUD_ROTATION_CAP_RAD_PER_H,
    );
  });

  test('returns the true Holland rate where it falls below the cap', () => {
    // r=200 km, rmw=30 km, vmax=40 m/s, B=1.35 — recompute in closed form
    const x = Math.min(80, (30 / 200) ** 1.35);
    const v = 40 * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
    const expected = (3.6 * v) / 200;
    expect(expected).toBeLessThan(CLOUD_ROTATION_CAP_RAD_PER_H);
    expect(cloudAngularRateRadPerH(200, 30, 40, 1.35)).toBeCloseTo(expected, 12);
  });

  test('guards the r=0 singularity', () => {
    const rate = cloudAngularRateRadPerH(0, 30, 40, 1.35);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBe(CLOUD_ROTATION_CAP_RAD_PER_H);
  });

  test('clip-radius form applies the shared 666-km conversion', () => {
    // rUnits 0.3 at the 666-km half-domain height = 199.8 km; rmw 30 km
    const viaKm = cloudAngularRateRadPerH(0.3 * 666, 0.045045045 * 666, 40, 1.35);
    const viaClip = cloudAngularRateAtClipRadius(0.3, 0.045045045, 40, 1.35);
    expect(viaClip).toBeCloseTo(viaKm, 12);
  });
});

describe('flowPhaseState', () => {
  test('weights sum to one and the resetting phase has zero weight', () => {
    // exactly at a phase-A reset (cloudAgeH = k * period)
    const atReset = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3);
    expect(atReset.phaseA).toBeCloseTo(0, 12);
    expect(atReset.weightA).toBeCloseTo(0, 12);
    expect(atReset.weightA + atReset.weightB).toBeCloseTo(1, 12);

    // half a period later phase B is at ITS reset with zero weight
    const atBReset = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3.5);
    expect(atBReset.phaseB).toBeCloseTo(0, 12);
    expect(atBReset.weightB).toBeCloseTo(0, 12);
    expect(atBReset.weightA).toBeCloseTo(1, 12);
  });

  test('weights are continuous across the boundary', () => {
    const eps = 1e-6;
    const before = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3 - eps);
    const after = flowPhaseState(CLOUD_CROSSFADE_PERIOD_H * 3 + eps);
    expect(Math.abs(before.weightA - after.weightA)).toBeLessThan(1e-4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/cloud-motion.test.ts`
Expected: FAIL — `Cannot find module '../src/render/cloud-motion'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/render/cloud-motion.ts
/**
 * Decorative cloud-motion contract for the simulated IR layer.
 *
 * Owns the constants and scalar math the env fragment shader embeds via
 * template literals, plus CPU mirrors that vitest can pin — the suite has no
 * GL harness, so the GLSL sampling itself is browser-verified. Rain-aligned
 * geometry (precipitating-cloud.ts, RAINBAND_SPIRAL_ROTATION_PER_H) is a
 * separate contract and deliberately not touched here.
 */

import { HALF_DOMAIN_HEIGHT_KM } from './storm-radii';

/**
 * Display cap on cloud angular velocity, rad/sim-hour. PERCEPTION CAP, NOT
 * PHYSICS: a real eyewall (~4-5 rad/sim-h) at the 3 h/s playback timescale
 * would display above two revolutions per second and alias into blur. 0.6
 * gives an eyewall lap of ~3.5 screen-seconds.
 */
export const CLOUD_ROTATION_CAP_RAD_PER_H = 0.6;

/**
 * Flow-map sawtooth period, sim-hours. Bounds differential twist per phase to
 * cap x period = 0.45 rad so the advected noise never winds into filaments.
 * Tunable in [0.5, 1.5] against crossfade shimmer during browser QA; the
 * spec's bounded-distortion intent (<= ~1 rad) must hold.
 */
export const CLOUD_CROSSFADE_PERIOD_H = 0.75;

/** Band-pattern solid-body reference radius, in rMax units (spec: 2.5). */
export const CLOUD_BAND_REFERENCE_Q = 2.5;

/**
 * Overshooting-top lifecycle period, sim-hours. Real tops live ~30 min, which
 * is sub-second at 3 h/s; the stretch is a display-honesty compromise covered
 * by the layer's "simulated" label.
 */
export const CLOUD_PULSE_PERIOD_H = 2;

/** Pre-change solid-body rate, kept verbatim for the reduced-motion path. */
export const LEGACY_CLOUD_ROTATION_RAD_PER_H = 0.028;

/**
 * Interpolated decorative cloud age for u_cloudAgeH. Raw fixed-frame ageH
 * jumps 0.25 h per tick — up to 0.15 rad at the cap — and visibly stutters.
 * Runs monotonically forward: a respawn (prev age ahead of the new storm's)
 * snaps to the new age instead of interpolating backwards.
 */
export function interpolatedCloudAgeH(
  prevAgeH: number | null,
  ageH: number,
  alpha: number,
): number {
  if (prevAgeH === null || !Number.isFinite(prevAgeH) || prevAgeH > ageH) {
    return ageH;
  }
  const clamped = Math.min(1, Math.max(0, alpha));
  return prevAgeH + (ageH - prevAgeH) * clamped;
}

/**
 * Holland-profile angular rate at radius rKm, rad/sim-hour, display-capped.
 * 3.6 converts m/s to km/h; radii floor at 1 km to guard the singularity.
 */
export function cloudAngularRateRadPerH(
  rKm: number,
  rmwKm: number,
  vmaxMs: number,
  hollandB: number,
): number {
  const r = Math.max(rKm, 1);
  const x = Math.min(80, (Math.max(rmwKm, 1) / r) ** hollandB);
  const vMs = vmaxMs * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
  return Math.min((3.6 * vMs) / r, CLOUD_ROTATION_CAP_RAD_PER_H);
}

/**
 * cloudAngularRateRadPerH with metric-clip inputs — the exact mirror of the
 * GLSL cloudOmega(), including the shared 666-km half-domain conversion.
 */
export function cloudAngularRateAtClipRadius(
  rUnits: number,
  rmwUnits: number,
  vmaxMs: number,
  hollandB: number,
): number {
  return cloudAngularRateRadPerH(
    rUnits * HALF_DOMAIN_HEIGHT_KM,
    rmwUnits * HALF_DOMAIN_HEIGHT_KM,
    vmaxMs,
    hollandB,
  );
}

/**
 * Two-phase flow-map state. Triangle weights sum to one and each phase has
 * exactly zero weight at its own sawtooth reset, so neither the field nor its
 * brightness pops at a phase boundary.
 */
export function flowPhaseState(cloudAgeH: number): {
  phaseA: number;
  phaseB: number;
  weightA: number;
  weightB: number;
} {
  const t = cloudAgeH / CLOUD_CROSSFADE_PERIOD_H;
  const phaseA = t - Math.floor(t);
  const tB = t + 0.5;
  const phaseB = tB - Math.floor(tB);
  const weightA = 1 - Math.abs(2 * phaseA - 1);
  return { phaseA, phaseB, weightA, weightB: 1 - weightA };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/cloud-motion.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/cloud-motion.ts test/cloud-motion.test.ts
git commit -m "feat: add the decorative cloud-motion CPU contract"
```

---

### Task 2: Flow-map motion in the env shader

**Files:**
- Modify: `src/render/cloud-motion.ts` (add `CLOUD_MOTION_GLSL`)
- Modify: `src/render/env.ts` (shader motion block + two uniforms)

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: GLSL functions `cloudOmega(float rUnits)`, `hash21(vec2 p)` and uniforms `u_cloudAgeH`, `u_reducedMotion` that Tasks 3–5 use inside `sampleCloud()`.

**Orientation note for the implementer:** the existing GLSL `rotate2(a)` builds `mat2(c, -s, s, c)` with **column-major** constructor order, so `rotate2(a) * v` rotates `v` clockwise by `a` in the shader's east/north space. Inverse-mapping therefore means: to make the *apparent* cloud field rotate counter-clockwise by θ, sample at `rotate2(theta) * p`. Browser QA (Task 7) explicitly verifies CCW motion; if it renders clockwise, negate `theta` at the single marked line rather than touching `rotate2`.

- [ ] **Step 1: Add the GLSL chunk to `cloud-motion.ts`**

Append:

```ts
// extend the existing import to: 
// import { HALF_DOMAIN_HEIGHT_KM, RENDER_RADIUS_FLOOR } from './storm-radii';

/**
 * GLSL for the motion model, embedded by env.ts's fragment shader. Lives here
 * so the constants, their CPU mirrors, and the shader code cannot drift apart
 * (and so env.ts stays under the 800-line cap).
 */
export const CLOUD_MOTION_GLSL = /* glsl */ `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Holland-profile angular rate at a metric-clip radius, rad/sim-hour, capped
// for display. Mirrors cloudAngularRateRadPerH in cloud-motion.ts exactly.
float cloudOmega(float rUnits) {
  float rKm = max(rUnits * ${HALF_DOMAIN_HEIGHT_KM}.0, 1.0);
  float rmwKm = max(u_rMax, ${RENDER_RADIUS_FLOOR}) * ${HALF_DOMAIN_HEIGHT_KM}.0;
  float x = min(80.0, pow(max(rmwKm, 1.0) / rKm, u_hollandB));
  float vMs = u_vmaxMs * sqrt(max(0.0, x * exp(1.0 - x)));
  // 3.6: m/s -> km/h. min(): perception cap, not physics -- see cloud-motion.ts.
  return min(3.6 * vMs / rKm, ${CLOUD_ROTATION_CAP_RAD_PER_H});
}
`;
```

Note: `RENDER_RADIUS_FLOOR` is already exported by `storm-radii.ts` and imported by `env.ts` — reuse it, do not redefine.

- [ ] **Step 2: Add uniforms and wiring in `env.ts`**

In the uniform declaration block of `FS` (after `uniform float u_cloudSeed;`):

```glsl
uniform float u_cloudAgeH;
uniform float u_reducedMotion;
```

Embed the chunk right after the `rotate2` definition (before `struct CloudField`):

```ts
${CLOUD_MOTION_GLSL}
```

with `import { CLOUD_BAND_REFERENCE_Q, CLOUD_CROSSFADE_PERIOD_H, CLOUD_MOTION_GLSL, CLOUD_PULSE_PERIOD_H, CLOUD_ROTATION_CAP_RAD_PER_H, LEGACY_CLOUD_ROTATION_RAD_PER_H, interpolatedCloudAgeH } from './cloud-motion';` at the top of `env.ts`.

In `draw()`, after the `u_ageH` uniform upload:

```ts
gl.uniform1f(
  u('u_cloudAgeH'),
  interpolatedCloudAgeH(
    ctx.frame.prevStorm?.ageH ?? null,
    ctx.frame.storm?.ageH ?? 0,
    ctx.frame.alpha,
  ),
);
gl.uniform1f(u('u_reducedMotion'), ctx.reduced ? 1 : 0);
```

- [ ] **Step 3: Rework the motion block in `sampleCloud()`**

Replace the current block (the lines defining `rotation`, `twist`, `spiralSpace`, `drift`, `macro`, `fine` — currently `env.ts:162-174`) with:

```glsl
  // ---- decorative motion (independent of the rain-aligned geometry) ----
  // animGate 0 under prefers-reduced-motion: fall back to the legacy
  // imperceptible solid-body drift so morphology survives without animation.
  float animGate = 1.0 - u_reducedMotion;
  float legacyRotation = u_ageH * ${LEGACY_CLOUD_ROTATION_RAD_PER_H};
  float omegaHere = cloudOmega(length(canopyRadial));

  // Two phase-staggered advection samples on a sawtooth, triangle-crossfaded:
  // each phase accumulates at most cap*period (~0.45 rad) of differential
  // twist before resetting with zero weight, so the noise never filaments.
  float tCycle = u_cloudAgeH / ${CLOUD_CROSSFADE_PERIOD_H};
  float phaseA = fract(tCycle);
  float phaseB = fract(tCycle + 0.5);
  float weightA = mix(1.0, 1.0 - abs(2.0 * phaseA - 1.0), animGate);
  float weightB = 1.0 - weightA;

  float seed = u_cloudSeed;
  // Static log-spiral shaping; the time-dependent term moved into the phases.
  float twist = 0.72 * log(1.0 + canopyQ) - legacyRotation * (1.0 - animGate);
  vec2 spiralBase = rotate2(twist) * (canopyRadial / rCanopy);
  // CCW apparent motion: rotate2 is CW, inverse mapping needs +theta here.
  // (Single sign-flip point if browser QA shows clockwise motion.)
  float thetaA = animGate * omegaHere * phaseA * ${CLOUD_CROSSFADE_PERIOD_H};
  float thetaB = animGate * omegaHere * phaseB * ${CLOUD_CROSSFADE_PERIOD_H};
  vec2 pA = rotate2(thetaA) * spiralBase;
  vec2 pB = rotate2(thetaB) * spiralBase;

  vec2 drift = vec2(u_ageH * 0.012, -u_ageH * 0.007) + shearDir * u_ageH * 0.005;
  float macro = mix(
    cloudNoise(pB * 0.62 + drift + seed * 11.0),
    cloudNoise(pA * 0.62 + drift + seed * 11.0),
    weightA
  );
  float fine;
  if (u_cloudDetail > 0.5) {
    fine = mix(
      cloudNoise(pB * 1.95 - drift * 1.8 + vec2(macro * 2.4, seed * 5.0)),
      cloudNoise(pA * 1.95 - drift * 1.8 + vec2(macro * 2.4, seed * 5.0)),
      weightA
    );
  } else {
    fine = mix(
      texture(u_cloudNoise, pB * 0.022 - drift * 0.018 + seed).g,
      texture(u_cloudNoise, pA * 0.022 - drift * 0.018 + seed).g,
      weightA
    );
  }
```

Budget check this step must satisfy: reduced-motion path forces `weightA = 1`, but both samples are still fetched — the budget (+4 detail / +3 mobile) is the worst case and holds on every path.

- [ ] **Step 4: Rotate the band pattern solid-body**

Replace the `bandPhase` / `secondaryBand` lines (currently `env.ts:209-216`) with:

```glsl
  // Band pattern rotates solid-body at the capped rate of one reference
  // radius; differential streaming lives in the noise, not the sine phase,
  // so the pattern never winds up. k*(azimuth - theta) keeps sign and rate
  // correct for CCW motion. Reduced motion keeps the legacy phase verbatim.
  float omegaBand = cloudOmega(${CLOUD_BAND_REFERENCE_Q} * rMax);
  float thetaBand = mix(
    -legacyRotation / 2.35,
    omegaBand * u_cloudAgeH,
    animGate
  );
  float thetaBand2 = mix(
    legacyRotation / 7.4,
    omegaBand * u_cloudAgeH,
    animGate
  );
  float bandPhase =
    2.35 * (azimuth - thetaBand) - 1.52 * bandQ + (macro - 0.5) * 4.6;
  float primaryBand = smoothstep(0.18, 0.76, 0.5 + 0.5 * sin(bandPhase));
  float secondaryBand = smoothstep(
    0.30,
    0.82,
    0.5 + 0.5 * sin(3.7 * (azimuth - thetaBand2) - 0.88 * bandQ + fine)
  );
```

(The old `float rotation = u_ageH * 0.028;` line was already removed by Step 3's replacement — `legacyRotation` is its successor; nothing else may reference `rotation`.)

- [ ] **Step 5: Stream the cirrus**

Replace the `cirrusTexture` lookup coordinate (currently `env.ts:286-294`) with:

```glsl
  // Cirrus streams along the shear axis (outflow proxy -- pure translation of
  // REPEAT noise: zero distortion, zero extra lookups; see plan note).
  // Reduced motion freezes the stream, keeping only the legacy slow drift.
  float cirrusStream = animGate * u_cloudAgeH * 0.06;
  float cirrusTexture = smoothstep(
    0.24,
    0.74,
    texture(
      u_cloudNoise,
      vec2(dot(spiralBase, vec2(-shearDir.y, shearDir.x)) * 0.029,
           dot(spiralBase, shearDir) * 0.011 - cirrusStream) + drift * 0.018
    ).b
  );
```

(`spiralSpace` no longer exists — every remaining reference to it in `sampleCloud()` must now read `spiralBase`.)

- [ ] **Step 6: Typecheck, test, and eyeball**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx vitest run` — expected all green (no test reads the shader string's motion block).
Run: `npm run dev`, open the app, press `3` (satellite IR), spawn a storm.
Expected: clouds visibly circulate counter-clockwise; core laps in a few seconds; outer bands slower; no stutter at normal speed; pausing (space) freezes clouds completely. If motion is clockwise, negate `thetaA`/`thetaB`/`thetaBand`/`thetaBand2`'s animated terms at the marked lines.

- [ ] **Step 7: Commit**

```bash
git add src/render/cloud-motion.ts src/render/env.ts
git commit -m "feat: advect simulated IR clouds along the capped Holland flow"
```

---

### Task 3: Graded cloud-top temperatures + overshooting tops

**Files:**
- Modify: `src/render/env.ts` (temperature block in `sampleCloud()`)

**Interfaces:**
- Consumes: `hash21`, `u_cloudAgeH`, `animGate`, `pA` from Task 2; `CLOUD_PULSE_PERIOD_H` from Task 1.
- Produces: the final `brightnessC` construction Tasks 4–5 leave untouched.

- [ ] **Step 1: Replace the flat storm-top block**

Replace the current temperature tail of `sampleCloud()` (the lines from `float stormTopC = mix(` through the `brightnessC` mixes, currently `env.ts:316-325`) with:

```glsl
  // Component-graded cloud tops: warmest first, coldest mixed last so a cold
  // tower is never averaged back toward a warmer underlying band.
  float cdoTopC = mix(-65.0, -82.0, development);
  float bandTopC = mix(-45.0, -62.0, development);
  float cirrusTopC = mix(-35.0, -48.0, u_organization);

  // Overshooting tops: deterministic per-cell pulses. Cell identity comes from
  // the advected storm-relative coordinate + seed; the lifecycle reads the
  // interpolated cloud age, never wall time. Each cell's cycle is offset so
  // cells never reseed together, and the sin^2 envelope is zero at both
  // lifecycle boundaries, so reseeds cannot pop.
  vec2 otCell = floor(pA * 6.0);
  float otOffset = hash21(otCell * 1.73 + seed * 291.7);
  float otCycle = u_cloudAgeH / ${CLOUD_PULSE_PERIOD_H.toFixed(1)} + otOffset;
  float otStrength = hash21(otCell * 2.61 + floor(otCycle) * 7.31);
  float otEnv = sin(3.14159265 * fract(otCycle));
  otEnv *= otEnv;
  // Reduced motion: no transient cycling -- hold a constant mid-envelope.
  otEnv = mix(0.5, otEnv, animGate);
  float overshootC = mix(8.0, 14.0, otStrength) * otEnv *
    smoothstep(0.55, 0.80, convectiveCells) *
    smoothstep(0.30, 0.80, rainEnergy);

  // Presence ladder (tuning constants: how strongly each component claims the
  // column before opacity compositing).
  float cirrusPresence = clamp(cirrus * 2.6, 0.0, 1.0);
  float bandPresence = clamp(max(rainbands, precipitatingCloud) * 1.6, 0.0, 1.0);
  float corePresence = clamp(coreCloud * 1.4, 0.0, 1.0);
  float towerPresence = clamp(max(eyewallCloud, precipitatingCloud) * 1.2, 0.0, 1.0) *
    smoothstep(0.55, 0.80, convectiveCells);

  float topC = ambientTopC;
  topC = mix(topC, cirrusTopC, cirrusPresence);
  topC = mix(topC, bandTopC, bandPresence);
  topC = mix(topC, cdoTopC, corePresence);
  topC = mix(topC, min(topC, cdoTopC) - overshootC, towerPresence);

  float brightnessC = mix(surfaceC, ambientTopC, ambientCloud);
  brightnessC = mix(brightnessC, topC, stormCloud);
  brightnessC = mix(brightnessC, surfaceC - 4.0, eye * eyeStrength * u_stormPresence);
```

This **removes** `stormTopC` and `towerCooling` entirely (the spec: overshooting tops replace, not stack on, the old −13 °C proxy). Delete both old lines; nothing else references them.

- [ ] **Step 2: Typecheck, test, eyeball**

Run: `npx tsc --noEmit && npx vitest run` — expected clean/green.
Run: `npm run dev`, IR layer, enhanced palette: the CDO should read colder (deeper orange/red) than the bands, cirrus edges warmer gray, and slow cold pulses should appear over the eyewall and strong band cells (~1 screen-second each). Grayscale palette: same structure in luminance.

- [ ] **Step 3: Commit**

```bash
git add src/render/env.ts
git commit -m "feat: grade simulated cloud-top temperatures with overshooting tops"
```

---

### Task 4: Visible-palette relief shading

**Files:**
- Modify: `src/render/env.ts`

**Interfaces:**
- Consumes: `pA`, `drift`, `seed`, `macro`, `centralOvercast`, `irregularCoreRadius`, `canopyQ`, `canopyRadial` from earlier tasks.
- Produces: `CloudField.relief` (float, 1.0 = flat), consumed by the visible-palette branch in `main()`.

- [ ] **Step 1: Extend the struct and compute relief**

Change the struct:

```glsl
struct CloudField {
  float cloud;
  float stormCloud;
  float ambientCloud;
  float brightnessC;
  float convectiveCells;
  float relief;
};
```

In `sampleCloud()` just before the `return`, add:

```glsl
  // Visible-palette relief: Lambert shading from a height proxy. Two raw
  // broad-channel taps give the noise gradient; the CDO envelope derivative
  // is analytic. Detail tier + visible palette only (budget: +2 lookups).
  float relief = 1.0;
  if (u_mode == 1 && u_satellitePalette == 2 && u_cloudDetail > 0.5) {
    vec2 noiseP = (pA * 0.62 + drift + seed * 11.0) * 0.10;
    float e = 0.012;
    // Two raw taps; macro stands in for the centre height (its broad .r term
    // dominates, and the bias is absorbed by the gradient gain + mix range).
    // A third centre tap would break the +2 relief budget.
    float hx = texture(u_cloudNoise, noiseP + vec2(e, 0.0)).r;
    float hy = texture(u_cloudNoise, noiseP + vec2(0.0, e)).r;
    vec2 noiseGrad = (vec2(hx, hy) - macro) * 6.0;
    // Analytic CDO envelope slope, outward-negative (the dome falls off).
    float envSlope = -2.0 * (canopyQ / (irregularCoreRadius * irregularCoreRadius)) *
      centralOvercast;
    vec2 radialDir = canopyQ > 0.001
      ? canopyRadial / (canopyQ * rCanopy)
      : vec2(0.0, 1.0);
    vec2 grad = noiseGrad + radialDir * envSlope * 0.8;
    // Standard height-field normal, lit by a fixed NW sun in east/north space.
    vec3 normal = normalize(vec3(-grad, 1.4));
    vec3 sunDir = normalize(vec3(-0.707, 0.707, 1.2));
    float lambert = clamp(dot(normal, sunDir), 0.0, 1.0);
    relief = mix(0.74, 1.18, lambert);
  }
  return CloudField(cloud, stormCloud, ambientCloud, brightnessC, convectiveCells, relief);
```

- [ ] **Step 2: Apply relief in the visible branch of `main()`**

In the `u_mode == 1`, `u_satellitePalette == 2` branch:

```glsl
      vec3 litCloud = mix(vec3(0.64, 0.67, 0.67), vec3(0.98), field.convectiveCells) *
        field.relief;
      color = mix(surface, litCloud, pow(field.cloud, 0.70));
```

Every other `CloudField(...)` constructor-site and the other palettes pass `1.0` implicitly via the single constructor — verify the constructor call has six arguments and all palettes except visible ignore `field.relief`.

- [ ] **Step 3: Typecheck, test, eyeball**

Run: `npx tsc --noEmit && npx vitest run` — clean/green.
Run: `npm run dev`, IR layer, `visible` style, wide window: cloud towers should show NW-lit shading and read three-dimensional. Shrink the window below 720 px: relief must disappear (flat like today). Enhanced/grayscale: pixel-identical to Task 3's result.

- [ ] **Step 4: Commit**

```bash
git add src/render/env.ts
git commit -m "feat: shade visible-palette cloud relief on the detail tier"
```

---

### Task 5: Inner-core irregularity

**Files:**
- Modify: `src/render/env.ts`

**Interfaces:**
- Consumes: `azimuth`, `q`, `animGate`, `u_cloudAgeH`, `shearDir`, `shearN`, `canopyDir`, `eyewallMaturity` from earlier tasks; `CLOUD_ROTATION_CAP_RAD_PER_H` constant.
- Produces: wobbled `qCore` used by the `eyewall` and `eye` terms; modulated `eyewallCloud`.

- [ ] **Step 1: Wobble the eyewall radius and eye edge**

Immediately after `float q = length(radial) / rMax;` add:

```glsl
  // Azimuthal wobble: sin-composed pseudo-noise (zero texture cost, periodic
  // by construction). Weak/organizing storms are ragged; mature storms round.
  float coreAzimuth = atan(radial.y, radial.x);
  float wobble = 0.6 * sin(3.0 * coreAzimuth + u_cloudSeed * 37.7) +
    0.4 * sin(5.0 * coreAzimuth + u_cloudSeed * 61.3);
  float wobbleAmp = mix(0.20, 0.05, smoothstep(0.38, 0.85, u_organization));
  float qCore = q * (1.0 + wobbleAmp * wobble);
```

Then change the eyewall and eye lines to use `qCore` instead of `q`:

```glsl
  float eyewall = exp(-pow((qCore - 1.0) / mix(0.46, 0.27, u_organization), 2.0));
```
```glsl
  float eye = 1.0 - smoothstep(0.18, mix(0.46, 0.68, eyeStrength), qCore);
```

- [ ] **Step 2: Add rotating mesovortex lumps and the shear asymmetry**

Change the `eyewallCloud` assignment to:

```glsl
  // Mesovortex lumps churn at the capped core rate; static under reduced
  // motion. Wavenumber 5 sits in the observed 4-6 range.
  float mesoTheta = animGate * ${CLOUD_ROTATION_CAP_RAD_PER_H} * u_cloudAgeH;
  float meso = 1.0 + 0.24 * eyewallMaturity *
    sin(5.0 * (coreAzimuth - mesoTheta) + u_cloudSeed * 17.9);
  // Downshear-left enhancement (documented wavenumber-1 structure). Gated off
  // when the shear vector is too weak to define a direction -- the fallback
  // shearDir is decorative and must not masquerade as a physical signal.
  float hasShearDir = step(0.05, length(u_shearVector));
  float dsl = max(0.0, dot(canopyDir, vec2(-shearDir.y, shearDir.x)));
  float dslBoost = 1.0 + 0.22 * shearN * hasShearDir * dsl;
  float eyewallCloud = eyewall * meso * dslBoost * eyewallMaturity *
    mix(0.48, 1.0, rainEnergy) * mix(0.68, 1.0, convectiveCells);
```

Note `eyewallMaturity` is currently declared *after* `eyewallCloud` — move the `eyewallMaturity` declaration above this block. `canopyDir` is currently declared after the band block — move the `canopyDir`/`upshear`/`shearErosion` trio above the `coreCloud`/`eyewallCloud` block (they have no dependency on anything between).

- [ ] **Step 3: Typecheck, test, eyeball**

Run: `npx tsc --noEmit && npx vitest run` — clean/green.
Run: `npm run dev`, IR enhanced, mature storm: the eyewall ring should be visibly lumpy and churning, the eye non-circular, one quadrant (left of the shear vector) brighter. Weak storm: raggedness stronger, ring less defined. Screenshot-compare against the screenshot from this conversation's opening: the perfect annulus must be gone.

- [ ] **Step 4: Commit**

```bash
git add src/render/env.ts
git commit -m "feat: break up the simulated eyewall annulus with wobble and mesovortices"
```

---

### Task 6: Shaheen morphology re-capture and re-screen

**Files:**
- Regenerate: `calibration/satellite-cloud-validation.json` (only permitted calibration output)
- Modify: `docs/satellite-cloud-validation.md` (Result section metrics only)

**Interfaces:**
- Consumes: the finished shader (Tasks 2–5).
- Produces: a passing morphology JSON that Task 7's evidence references.

**Context the implementer needs:** the observed Shaheen frame is NOT archived in the repo (`public/data/satellite/manifest.json` has zero frames). The spec's stop rule: if the exact observed input (Meteosat-8 IODC SEVIRI IR10.8, 2021-10-01 02:30 UTC, domain 50–70 E / 15–27 N) cannot be lawfully recovered from the public EUMETView WMS, acceptance STOPS — report that honestly instead of validating against a substitute.

- [ ] **Step 1: Recover the observed frame**

Read `bake/satellite_frames.py --help` and `bake/fetch`-style helpers first; prefer the repo's own tooling. Fallback is a direct EUMETView WMS GetMap request for layer `msg_iodc:ir108` at `TIME=2021-10-01T02:30:00Z`, BBOX `50,15,70,27` (EPSG:4326), grayscale PNG, saved to the scratchpad. Verify the response is an image with plausible cloud structure, not a service error tile. If the service no longer serves 2021 imagery: STOP this task, mark acceptance blocked in the plan, and surface to the user.

- [ ] **Step 2: Capture the simulated frame**

Using Playwright against `npm run dev`:
1. Navigate to the app, activate the `shaheen-2021-hindcast` scenario (scenario UI; the hash `env` key encodes it — check `src/rng.ts` `readHash` for the exact key if driving by URL).
2. Let the sim run to model age 2.5 h, then pause (Space). The debrief/pin readout shows model age; 2.5 h is the frozen case's age.
3. Select satellite IR, `gray` style, hide overlays (turn off other layers).
4. Element-screenshot the WebGL canvas only. The canvas maps exactly to the 50–70 E / 15–27 N domain.
5. Save as grayscale PNG in the scratchpad.

- [ ] **Step 3: Run the screen**

```bash
python bake/validate_satellite_structure.py \
  --observed <scratchpad>/shaheen-observed-grayscale.png \
  --simulated <scratchpad>/shaheen-simulated-grayscale.png \
  --center-lat 23.191736897213236 \
  --center-lon 65.09515530527648 \
  --radius-deg 3.5 \
  --observed-at 2021-10-01T02:30:00Z \
  --scenario shaheen-2021-hindcast \
  --output calibration/satellite-cloud-validation.json
```

(Use the repo venv via `node bake/run-python.mjs` if the script imports baked deps — check its imports first.)

Expected: `"passed": true` with all five checks true. If any check fails: fix the renderer (tuning constants from Tasks 2–5), never the thresholds, and re-run.

- [ ] **Step 4: Update the doc**

Edit `docs/satellite-cloud-validation.md` — replace the five metric values in the Result section with the new JSON's numbers. Do not change thresholds, claim boundary, or any other section.

- [ ] **Step 5: Commit**

```bash
git add calibration/satellite-cloud-validation.json docs/satellite-cloud-validation.md
git commit -m "test: re-screen Shaheen cloud morphology against the advected renderer"
```

---

### Task 7: Full QA, performance gate, repo gates, PR

**Files:** none created (evidence goes in the PR body).

- [ ] **Step 1: Repo gates**

Run each; all must pass untouched:

```bash
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run data:hf6:catalog:check
npm run assets:check
npm run build
```

Then `git diff origin/main...HEAD --stat` — confirm the only changed files are: `src/render/cloud-motion.ts`, `src/render/env.ts`, `test/cloud-motion.test.ts`, `calibration/satellite-cloud-validation.json`, `docs/satellite-cloud-validation.md`, the spec, and this plan. Any frozen acceptance/contract, physics report, bake, or data file in the diff is a hard failure.

- [ ] **Step 2: Browser QA (Playwright, console/WebGL errors are failures)**

Each pass on `npm run dev` (or `preview` of the build), capturing screenshots as evidence:

1. **Determinism:** load a seeded URL, pause after fades settle, capture the same frame twice → byte-identical. Select the same replay frame twice → identical.
2. **Motion:** normal playback, 3 captures 1 s apart → core rotates counter-clockwise between frames, no fixed-step stutter visible in a short screen recording.
3. **Longevity:** same seed at +6 h, +24 h, and ≥96 h → no filamentation, no phase-boundary pop (capture straddling a sawtooth boundary: two frames 0.15 s apart must not jump).
4. **Palettes:** enhanced, grayscale, visible all render; visible relief present on wide viewport, absent at <720 px width.
5. **Reduced motion:** `emulateMedia({ reducedMotion: 'reduce' })`, reload → clouds present, no fast circulation, no pulsing, no cirrus streaming (two captures 2 s apart nearly identical apart from storm translation). Narrow viewport WITHOUT reduced motion → still animates (tier and motion gates are independent).
6. **Rain alignment:** radar layer vs IR layer at weak, mature, and sheared states → the IR cloud floor still covers the radar footprint (the `precipitatingCloud` support did not move).

- [ ] **Step 3: Performance trace**

On the same machine/viewport/tier/storm frame, 300-frame window, using `browser_run_code_unsafe` (or DevTools trace) to collect rAF-to-rAF main-thread work:
- baseline: build `origin/main` in a separate worktree (`git worktree add ../wiw-perf-base origin/main && cd ../wiw-perf-base && npm ci && npm run build && npm run preview`), measure.
- candidate: `npm run build && npm run preview` on the branch, measure.
- Gate: candidate p95 frame work ≤ baseline p95 + max(20%, 1 ms); missed-frame fraction rise ≤ 5 pp. Record both raw numbers in the PR body. Remove the worktree afterwards (`git worktree remove ../wiw-perf-base`).

- [ ] **Step 4: PR**

```bash
git push -u origin feat/ir-cloud-motion
gh pr create --title "feat: living simulated IR clouds (flow-map motion, graded tops, irregular core)" --body "<summary + full test plan + QA evidence + perf numbers + morphology result>"
```

PR body must include: the spec path, the cirrus-streaming interpretation note, before/after screenshots, the perf table, and the morphology screen result.

---

## Self-review record

- **Spec coverage:** motion (Task 2), height/OT (Task 3), relief (Task 4), core (Task 5), morphology re-screen (Task 6), determinism/reduced-motion/rain-alignment/perf/repo gates (Tasks 2–5 inline + Task 7). Cloud memory: future work, no task — intentional.
- **Deviation flagged:** cirrus streams along shear instead of radial outflow (budget); called out in Global Constraints and the PR body requirement.
- **Type consistency:** `interpolatedCloudAgeH(prevAgeH, ageH, alpha)` used identically in Tasks 1–2; `CloudField` gains `relief` only in Task 4 and its constructor call is updated in the same task; `qCore`/`coreAzimuth` introduced and consumed only in Task 5.
- **Known sequencing edits in Task 5** (moving `eyewallMaturity` and the `canopyDir` trio up) are stated explicitly so the implementer does not discover them as compile errors.
