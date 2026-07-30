# Cloud Memory (stateful debris field) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **This repo's execution mode:** sandboxed Codex workers driven one task at a
> time from the lead seat; the lead re-runs tests, reads the full diff against
> this plan, and browser-verifies between tasks, and commits each gated task.

**Goal:** An earth-fixed, byte-reproducible cloud-memory texture — convection
blooms, advects, decays, and leaves a debris wake along the storm track —
sampled by the env shader everywhere the simulated cloud field renders.

**Architecture:** `state(k)` at each 1-sim-hour boundary is *defined* as 18
bounded advect→source→decay passes from a zero field, reading only frozen
flight-recorder frames at boundaries `k−18 … k−1` (causality seal). A small
LRU caches per-boundary states; a two-tap blit packs (k, k+1) into one RG/BA
texture; env crossfades with `fract(u_cloudAgeH / 1h)`. One sampler is freed
by pre-blending the OHC month pair.

**Tech Stack:** Vite + vanilla TypeScript + WebGL2 (no runtime deps), vitest,
Playwright MCP for browser QA.

**Spec:** `docs/superpowers/specs/2026-07-30-cloud-memory-design.md`
(gate-sealed 2026-07-30, round 5 clean). The spec is the authority; if this
plan and the spec disagree, STOP and raise it — do not silently pick one.

## Global Constraints

- Render-only diff. Allowed files: `src/render/cloud-memory.ts` (new),
  `src/render/env.ts`, `src/render/cloud-motion.ts`, `src/render/gl-utils.ts`
  (force-RGBA8 option only), `src/render/index.ts`, `src/main.ts` (wiring
  only), `src/flight-recorder.ts` (read-only accessor only),
  `test/cloud-memory.test.ts` (new), `docs/satellite-cloud-validation.md`
  (currency note only), the spec, this plan. Anything else in the diff is a
  hard failure. `src/types.ts` is deliberately NOT allowed — the tape reaches
  the facade via a setter method, not a FrameState field.
- No `Math.random`, no `Date.now`, no wall-clock or frame-rate input anywhere
  in the memory state definition. The only device traits allowed are texture
  resolution (per performance tier) and the reduced-motion flag, both cache
  inputs.
- The env fragment program must bind exactly 16 samplers after the change:
  the OHC pair (units 4, 5) becomes `u_ohcBlend` (unit 4) + `u_cloudMemory`
  (unit 5). No other unit moves.
- All new tuning constants are named `CLOUD_MEMORY_*` exports in
  `src/render/cloud-memory.ts` with WHY comments; the GLSL embeds them via
  template literals exactly like `cloud-motion.ts` does.
- Errors are never swallowed: a tape lookup that finds no frame THROWS.
- Conventional commits, no AI attribution.
- Frozen gates untouched: no file under `calibration/` changes except the
  documented morphology currency note in `docs/`; machine-generated reports
  are never hand-edited.

## File Structure

- `src/render/cloud-memory.ts` (new, ~350 lines): constants, pure CPU math
  (boundary enumeration, encode/decode, combine rules, quantized tail
  recurrence, LRU), the update/pack GLSL strings, and the `CloudMemoryPass`
  GL module. CPU math is vitest-pinned; GLSL is browser-verified (repo has no
  GL harness).
- `src/flight-recorder.ts` (+~35 lines): `frameAtOrBeforeAge()` binary
  search + `runKey()`; observation only.
- `src/render/gl-utils.ts` (+~10 lines): `makeRenderTarget` gains an
  optional `forceRgba8` flag.
- `src/render/env.ts` (~+80/−15 lines): OHC pre-blend pass, `u_ohcBlend` +
  `u_cloudMemory` samplers, memory sampling in `sampleCloud`, macro gain,
  `debris` CloudField member, ladder insertion.
- `src/render/index.ts` (+~25 lines): `CloudMemoryPass` lifecycle,
  `ensure()` call in `draw()`, `setCloudTape()` facade setter.
- `src/main.ts` (+~10 lines): one-time `setCloudTape` wiring.
- `test/cloud-memory.test.ts` (new): all CPU mirrors.

---

### Task 1: Constants, CPU mirrors, and the quantized tail contract

**Files:**
- Create: `src/render/cloud-memory.ts` (math half only; GL half is Task 3)
- Test: `test/cloud-memory.test.ts`

**Interfaces:**
- Consumes: `cloudAngularRateRadPerH(rKm, rmwKm, vmaxMs, hollandB)` and
  `LEGACY_CLOUD_ROTATION_RAD_PER_H` from `./cloud-motion`;
  `HALF_DOMAIN_HEIGHT_KM` from `./storm-radii`.
- Produces (exact exports later tasks rely on):
  - `CLOUD_MEMORY_DT_H = 1`, `CLOUD_MEMORY_WINDOW_H = 18`,
    `CLOUD_MEMORY_STEPS = 18`, `CLOUD_MEMORY_DECAY_TAU_H = 6`,
    `CLOUD_MEMORY_MAX_ADVECT_KMH = 30`, `CLOUD_MEMORY_OUTFLOW_KMH = 12`,
    `CLOUD_MEMORY_SIZE_DETAIL = 512`, `CLOUD_MEMORY_SIZE_MOBILE = 256`,
    `CLOUD_MEMORY_MACRO_GAIN = 0.3`, `CLOUD_MEMORY_SUBSTEPS = 1`,
    `DEBRIS_TOP_WARM_C = -28`, `DEBRIS_TOP_COLD_C = -45`,
    `DEBRIS_MAX_CLOUD = 0.55`
  - `memoryBoundaryPair(cloudAgeH: number): { k: number; frac: number }`
  - `sourceBoundaries(k: number): number[]`
  - `encodeDebrisAge(ageH: number): number` / `decodeDebrisAge(n: number): number`
  - `memoryAdvectSpeedKmH(rKm: number, rmwKm: number, vmaxMs: number, hollandB: number, reducedMotion: boolean): number`
  - `densityAfterSource(advected: number, source: number): number`
  - `ageAfterSource(advectedAge: number, advectedDensity: number, sourceDensity: number): number`
  - `quantizeByte(x: number): number`
  - `tailResidualByte(): number`
  - `class CloudMemoryLru` with
    `keyFor(runKey: string, k: number, sizePx: number, reducedMotion: boolean): string`,
    `get(key: string): T | null`, `set(key: string, value: T): T | null`
    (returns the evicted value or null), constructor `(capacity: number)`.

- [ ] **Step 1: Write the failing tests**

Create `test/cloud-memory.test.ts`. Follow the house test style in
`test/cloud-motion.test.ts` (plain vitest `describe`/`it`/`expect`, no
mocking framework):

```ts
import { describe, expect, it } from 'vitest';
import {
  CLOUD_MEMORY_DT_H,
  CLOUD_MEMORY_STEPS,
  CLOUD_MEMORY_WINDOW_H,
  CLOUD_MEMORY_DECAY_TAU_H,
  CLOUD_MEMORY_MAX_ADVECT_KMH,
  CloudMemoryLru,
  ageAfterSource,
  decodeDebrisAge,
  densityAfterSource,
  encodeDebrisAge,
  memoryAdvectSpeedKmH,
  memoryBoundaryPair,
  quantizeByte,
  sourceBoundaries,
  tailResidualByte,
} from '../src/render/cloud-memory';
import { cloudAngularRateRadPerH } from '../src/render/cloud-motion';

describe('cloud-memory: boundary math', () => {
  it('splits cloud age into boundary index and fraction', () => {
    expect(memoryBoundaryPair(0)).toEqual({ k: 0, frac: 0 });
    expect(memoryBoundaryPair(7.25)).toEqual({ k: 7, frac: 0.25 });
    expect(memoryBoundaryPair(17.999999)).toEqual({
      k: 17,
      frac: expect.closeTo(0.999999, 5),
    });
  });

  it('enumerates source boundaries k-N..k-1, floored at spawn (0)', () => {
    expect(sourceBoundaries(2)).toEqual([0, 1]);
    expect(sourceBoundaries(0)).toEqual([]);
    const full = sourceBoundaries(30);
    expect(full).toHaveLength(CLOUD_MEMORY_STEPS);
    expect(full[0]).toBe(12);
    expect(full[full.length - 1]).toBe(29);
  });

  it('causality seal: no source boundary is ever >= k', () => {
    for (const k of [1, 5, 18, 19, 40]) {
      for (const b of sourceBoundaries(k)) expect(b).toBeLessThan(k);
    }
  });
});

describe('cloud-memory: debris age encoding', () => {
  it('round-trips within one byte step', () => {
    for (const h of [0, 3, 9, 17.5, 18]) {
      const decoded = decodeDebrisAge(quantizeByte(encodeDebrisAge(h)));
      expect(Math.abs(decoded - Math.min(h, CLOUD_MEMORY_WINDOW_H))).toBeLessThan(
        CLOUD_MEMORY_WINDOW_H / 255 + 1e-9,
      );
    }
  });

  it('clamps beyond the window', () => {
    expect(encodeDebrisAge(40)).toBe(1);
  });
});

describe('cloud-memory: advection speed', () => {
  it('applies the linear cap where the angular cap alone would exceed it', () => {
    // 0.3 rad/h at 190 km = 57 km/h uncapped; the linear cap must bind.
    const v = memoryAdvectSpeedKmH(190, 95, 50, 1.35, false);
    expect(v).toBe(CLOUD_MEMORY_MAX_ADVECT_KMH);
  });

  it('matches omega*r below both caps', () => {
    const rKm = 40;
    const omega = cloudAngularRateRadPerH(rKm, 30, 20, 1.35);
    expect(memoryAdvectSpeedKmH(rKm, 30, 20, 1.35, false)).toBeCloseTo(
      Math.min(omega * rKm, CLOUD_MEMORY_MAX_ADVECT_KMH),
      9,
    );
  });

  it('uses the legacy slow rate under reduced motion', () => {
    const rKm = 40;
    const fast = memoryAdvectSpeedKmH(rKm, 30, 50, 1.35, false);
    const slow = memoryAdvectSpeedKmH(rKm, 30, 50, 1.35, true);
    expect(slow).toBeLessThan(fast);
    expect(slow).toBeCloseTo(0.028 * rKm, 9);
  });
});

describe('cloud-memory: sealed combine rules', () => {
  it('density is additive with saturation', () => {
    expect(densityAfterSource(0.7, 0.5)).toBe(1);
    expect(densityAfterSource(0.2, 0.3)).toBeCloseTo(0.5, 9);
  });

  it('age is density-weighted toward 0 under fresh source', () => {
    expect(ageAfterSource(0.8, 0.4, 0.4)).toBeCloseTo(0.4, 9);
    expect(ageAfterSource(0.8, 0.4, 0)).toBeCloseTo(0.8, 9);
    expect(ageAfterSource(0.8, 0, 0.6)).toBeCloseTo(0, 6);
  });
});

describe('cloud-memory: quantized tail contract (spec gate record, round 4)', () => {
  it('a unit injection ends at byte <= 13 after N quantized decay steps', () => {
    expect(tailResidualByte()).toBeLessThanOrEqual(13);
  });

  it('relation: the float exponent alone would round UP to that byte', () => {
    // Documents WHY the contract is byte-space: exp(-3)*255 = 12.696 -> 13.
    const floatResidual = Math.exp(
      (-CLOUD_MEMORY_STEPS * CLOUD_MEMORY_DT_H) / CLOUD_MEMORY_DECAY_TAU_H,
    );
    expect(Math.round(floatResidual * 255)).toBe(13);
  });
});

describe('cloud-memory: LRU', () => {
  it('keys on run, boundary, size, and reduced motion', () => {
    const lru = new CloudMemoryLru<number>(4);
    const a = lru.keyFor('run1', 5, 512, false);
    expect(lru.keyFor('run1', 5, 512, false)).toBe(a);
    expect(lru.keyFor('run2', 5, 512, false)).not.toBe(a);
    expect(lru.keyFor('run1', 6, 512, false)).not.toBe(a);
    expect(lru.keyFor('run1', 5, 256, false)).not.toBe(a);
    expect(lru.keyFor('run1', 5, 512, true)).not.toBe(a);
  });

  it('evicts least-recently-used and returns the evicted value', () => {
    const lru = new CloudMemoryLru<number>(2);
    expect(lru.set('a', 1)).toBeNull();
    expect(lru.set('b', 2)).toBeNull();
    expect(lru.get('a')).toBe(1); // refresh a
    expect(lru.set('c', 3)).toBe(2); // b evicted
    expect(lru.get('b')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/cloud-memory.test.ts`
Expected: FAIL — module `../src/render/cloud-memory` not found.

- [ ] **Step 3: Implement the math half of `src/render/cloud-memory.ts`**

```ts
/**
 * cloud-memory.ts — stateful advected debris field for the simulated clouds.
 *
 * state(k) at each 1-sim-hour boundary is DEFINED as N bounded
 * advect->source->decay passes from a zero field, reading only frozen
 * flight-recorder frames at boundaries k-N..k-1 (causality seal: nothing
 * later than k-1 is ever read, so live play and cold scrub compute the
 * identical texture). CPU mirrors here are vitest-pinned; the GLSL is
 * browser-verified because the suite has no GL harness.
 * Spec: docs/superpowers/specs/2026-07-30-cloud-memory-design.md
 */

import {
  LEGACY_CLOUD_ROTATION_RAD_PER_H,
  cloudAngularRateRadPerH,
} from './cloud-motion';

/** Memory boundary spacing, sim-hours. The crossfade denominator in env. */
export const CLOUD_MEMORY_DT_H = 1;
/**
 * Reconstruction window, sim-hours. A parcel lives at most this long BY
 * DEFINITION (truncation is definitional, not approximate); also bounds the
 * cold-scrub rebuild to CLOUD_MEMORY_STEPS passes regardless of storm age.
 */
export const CLOUD_MEMORY_WINDOW_H = 18;
export const CLOUD_MEMORY_STEPS = CLOUD_MEMORY_WINDOW_H / CLOUD_MEMORY_DT_H;
/**
 * Debris e-folding time, sim-hours. WINDOW/TAU = 3 so the oldest parcel
 * leaves the window at byte 13 (~5.1%) — pinned by tailResidualByte().
 */
export const CLOUD_MEMORY_DECAY_TAU_H = 6;
/**
 * Linear advection speed cap, km/h. The angular perception cap alone still
 * permits ~57-100 km/h linear far-field flow (gradient wind), but debris
 * physically rides the ambient flow at tens of km/h — this constant is both
 * the honest debris model and the ~13-texel backtrace bound at 512^2.
 */
export const CLOUD_MEMORY_MAX_ADVECT_KMH = 30;
/**
 * New radial outflow term, km/h (nothing shipped provides one; the
 * decorative field's drift is shear-aligned). Spreads debris outward so the
 * moving source leaves it behind. Ramps 0->full over 1.2..2.5 x RMW.
 */
export const CLOUD_MEMORY_OUTFLOW_KMH = 12;
/** State texture edge, px — a render trait per tier, like dprCap. */
export const CLOUD_MEMORY_SIZE_DETAIL = 512;
export const CLOUD_MEMORY_SIZE_MOBILE = 256;
/**
 * Enhancement-only macro gain: gain(0) = 1 exactly, so an empty field
 * reproduces the shipped look pixel-for-pixel apart from debris.
 */
export const CLOUD_MEMORY_MACRO_GAIN = 0.3;
/** Backtrace substeps; >1 only if browser QA shows swirl artifacts. */
export const CLOUD_MEMORY_SUBSTEPS = 1;
/** Debris cloud-top grading, deg C — warmer than fresh bands (-45..-62). */
export const DEBRIS_TOP_WARM_C = -28;
export const DEBRIS_TOP_COLD_C = -45;
/** Max cloud fraction debris alone can claim (decaying stratiform, not CDO). */
export const DEBRIS_MAX_CLOUD = 0.55;

/** Boundary index and crossfade fraction for a cloud age. */
export function memoryBoundaryPair(cloudAgeH: number): {
  k: number;
  frac: number;
} {
  const t = Math.max(0, cloudAgeH) / CLOUD_MEMORY_DT_H;
  const k = Math.floor(t);
  return { k, frac: t - k };
}

/** Source boundaries for state(k): k-N..k-1, floored at spawn (age 0). */
export function sourceBoundaries(k: number): number[] {
  const out: number[] = [];
  for (let b = Math.max(0, k - CLOUD_MEMORY_STEPS); b < k; b++) out.push(b);
  return out;
}

/** Normalized [0,1] debris age; raw hours would saturate RGBA8 in one step. */
export function encodeDebrisAge(ageH: number): number {
  return Math.min(1, Math.max(0, ageH / CLOUD_MEMORY_WINDOW_H));
}

export function decodeDebrisAge(encoded: number): number {
  return Math.min(1, Math.max(0, encoded)) * CLOUD_MEMORY_WINDOW_H;
}

/** Round-to-nearest 255ths — the RGBA8 store the GL pipeline performs. */
export function quantizeByte(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 255) / 255;
}

/**
 * Advection speed at radius rKm, km/h: display-coherent capped rotation
 * under the same reduced-motion policy as env's animGate, then the linear
 * debris cap.
 */
export function memoryAdvectSpeedKmH(
  rKm: number,
  rmwKm: number,
  vmaxMs: number,
  hollandB: number,
  reducedMotion: boolean,
): number {
  const omega = reducedMotion
    ? LEGACY_CLOUD_ROTATION_RAD_PER_H
    : cloudAngularRateRadPerH(rKm, rmwKm, vmaxMs, hollandB);
  return Math.min(omega * Math.max(rKm, 1), CLOUD_MEMORY_MAX_ADVECT_KMH);
}

/** Sealed combine rule: additive convection with saturation. */
export function densityAfterSource(advected: number, source: number): number {
  return Math.min(1, advected + source);
}

/** Sealed combine rule: density-weighted age — fresh source rejuvenates. */
export function ageAfterSource(
  advectedAge: number,
  advectedDensity: number,
  sourceDensity: number,
): number {
  return (
    (advectedAge * advectedDensity) /
    Math.max(advectedDensity + sourceDensity, 1e-5)
  );
}

/**
 * The tail contract, in encoded space: run the byte-quantized decay
 * recurrence a unit injection experiences (Advect->Source->Decay order =
 * exactly N decays) and return the final stored byte. Spec: <= 13.
 */
export function tailResidualByte(): number {
  const decay = Math.exp(-CLOUD_MEMORY_DT_H / CLOUD_MEMORY_DECAY_TAU_H);
  let stored = 1;
  for (let step = 0; step < CLOUD_MEMORY_STEPS; step++) {
    stored = quantizeByte(stored * decay);
  }
  return Math.round(stored * 255);
}

/** Pure LRU keyed on everything that can change pixels. */
export class CloudMemoryLru<T> {
  private map = new Map<string, T>();

  constructor(private capacity: number) {}

  keyFor(
    runKey: string,
    k: number,
    sizePx: number,
    reducedMotion: boolean,
  ): string {
    return `${runKey}|${k}|${sizePx}|${reducedMotion ? 1 : 0}`;
  }

  get(key: string): T | null {
    const value = this.map.get(key);
    if (value === undefined) return null;
    this.map.delete(key);
    this.map.set(key, value); // refresh recency
    return value;
  }

  /** Insert; returns the evicted value (caller disposes GL resources). */
  set(key: string, value: T): T | null {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size <= this.capacity) return null;
    const oldest = this.map.keys().next().value as string;
    const evicted = this.map.get(oldest) as T;
    this.map.delete(oldest);
    return evicted;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cloud-memory.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test` then `npm run build`
Expected: both green; the build catches type errors (`tsc --noEmit`).

- [ ] **Step 6: Commit**

```bash
git add src/render/cloud-memory.ts test/cloud-memory.test.ts
git commit -m "feat: cloud-memory constants, boundary math, and quantized tail contract"
```

---

### Task 2: Flight-recorder read-only tape accessor

**Files:**
- Modify: `src/flight-recorder.ts` (append methods inside `class FlightRecorder`, after `milestones()` ~line 261)
- Test: `test/cloud-memory.test.ts` (append a describe)

**Interfaces:**
- Consumes: existing `FlightRecorder.frames` / `meta` privates.
- Produces:
  - `frameAtOrBeforeAge(ageH: number): FlightFrame | null` — latest frame
    with `frame.ageH <= ageH`, null when none or not started.
  - `runKey(): string | null` — stable per `start()` call, null before the
    first start. Later tasks treat it as an opaque cache-key component.

- [ ] **Step 1: Write the failing tests**

Append to `test/cloud-memory.test.ts` (the recorder is constructible in
node — see existing usage in `test/` for `FlightRecorder` if present; build
frames through `start()`/`record()` with minimal `StormState` literals,
following whatever fixture style existing recorder tests use; if none exist,
construct a minimal `StormState` via the same object-literal shape
`frameOf()` reads: lat, lon, vKt, ageH, alive, organization, coldWakeC,
diagnostics, structure, trackPoints, isDemo):

```ts
describe('flight-recorder: cloud-memory tape accessor', () => {
  function makeRecorder(): FlightRecorder {
    const recorder = new FlightRecorder();
    const base = makeStormState({ ageH: 0 }); // helper built in this test file
    recorder.start(makeMeta(), base);
    for (const ageH of [0.25, 0.5, 0.75, 1.0, 1.25, 1.5]) {
      recorder.record(makeStormState({ ageH }), []);
    }
    return recorder;
  }

  it('returns the latest frame at or before the requested age', () => {
    const recorder = makeRecorder();
    expect(recorder.frameAtOrBeforeAge(1.0)?.ageH).toBe(1.0);
    expect(recorder.frameAtOrBeforeAge(1.1)?.ageH).toBe(1.0);
    expect(recorder.frameAtOrBeforeAge(0)?.ageH).toBe(0);
  });

  it('returns null before any frame and before start', () => {
    expect(new FlightRecorder().frameAtOrBeforeAge(5)).toBeNull();
    expect(makeRecorder().frameAtOrBeforeAge(-0.5)).toBeNull();
  });

  it('runKey is stable within a run and changes across starts', () => {
    const recorder = makeRecorder();
    const key = recorder.runKey();
    expect(key).toBe(recorder.runKey());
    recorder.start(makeMeta(), makeStormState({ ageH: 0 }));
    expect(recorder.runKey()).not.toBe(key);
  });

  it('runKey is null before the first start', () => {
    expect(new FlightRecorder().runKey()).toBeNull();
  });
});
```

`makeStormState` / `makeMeta` are small literal-building helpers written in
this test file — copy the field shape from `frameOf()` in
`src/flight-recorder.ts:108` and `FlightRunMeta` at line 21. Do not import
sim machinery.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/cloud-memory.test.ts`
Expected: FAIL — `frameAtOrBeforeAge is not a function`.

- [ ] **Step 3: Implement in `src/flight-recorder.ts`**

Add a private counter and two methods (observation only — no recording-path
change):

```ts
  private startCounter = 0; // initialize alongside the other privates

  // inside start(), first line after the meta assignment:
  this.startCounter += 1;

  /**
   * Latest frame at or before ageH (binary search), or null. Read-only tape
   * observation for the render-side cloud-memory pass; boundaries land on
   * exact tick ages, and the caller (causality seal) never asks past the
   * tape — asking past the last frame still answers, but the cloud-memory
   * enumerator treats a null as a thrown error at its own layer.
   */
  frameAtOrBeforeAge(ageH: number): FlightFrame | null {
    if (this.frames.length === 0) return null;
    if (ageH < this.frames[0].ageH) return null;
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[mid].ageH <= ageH) lo = mid;
      else hi = mid - 1;
    }
    return this.frames[lo];
  }

  /** Opaque per-run cache key; changes on every start(), null before one. */
  runKey(): string | null {
    if (!this.meta) return null;
    return `${this.startCounter}:${this.meta.seed}:${this.meta.environmentId}:${this.meta.monthIndex}`;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/cloud-memory.test.ts` → PASS.

- [ ] **Step 5: Full suite**

Run: `npm test` → green (existing recorder tests untouched).

- [ ] **Step 6: Commit**

```bash
git add src/flight-recorder.ts test/cloud-memory.test.ts
git commit -m "feat: read-only flight-recorder accessor for cloud-memory boundaries"
```

---

### Task 3: CloudMemoryPass GL module + force-RGBA8 render targets

**Files:**
- Modify: `src/render/gl-utils.ts:93` (`makeRenderTarget` signature)
- Modify: `src/render/cloud-memory.ts` (append the GL half)
- Test: `test/cloud-memory.test.ts` (planner logic only — GL is browser-verified)

**Interfaces:**
- Consumes: Task 1 math + Task 2 accessor shape; `makeProgram`, `makeQuadVao`,
  `makeRenderTarget`, `disposeRenderTarget` from `./gl-utils`;
  `latLonToClip`, `DOMAIN` from `../grid`; `stormRenderRadii` from
  `./storm-radii`; `FlightFrame` type from `../flight-recorder`.
- Produces:
  - `interface CloudTape { frameAtOrBeforeAge(ageH: number): FlightFrame | null; runKey(): string | null }`
  - `class CloudMemoryPass` implementing the `RenderModule` lifecycle
    (`init(gl)`, `resize(width, height)`, `dispose()`) plus:
    - `setTape(tape: CloudTape | null): void`
    - `ensure(cloudAgeH: number, reducedMotion: boolean, metricX: number, cloudNoiseTex: WebGLTexture | null, cloudSeed: number): void`
    - `get texture(): WebGLTexture | null` — the packed RG/BA display
      texture, null until the first successful ensure.
  - `planEnsure(cloudAgeH: number, cached: (k: number) => boolean): number[]`
    — pure: boundary indices that must be computed (of k, k+1), in order.

- [ ] **Step 1: Write the failing planner test**

```ts
describe('cloud-memory: ensure planner', () => {
  it('requests only uncached boundaries of the display pair', () => {
    expect(planEnsure(7.3, () => false)).toEqual([7, 8]);
    expect(planEnsure(7.3, (k) => k === 7)).toEqual([8]);
    expect(planEnsure(7.3, () => true)).toEqual([]);
  });
});
```

Run: `npx vitest run test/cloud-memory.test.ts` → FAIL (`planEnsure` missing).

- [ ] **Step 2: Add the `forceRgba8` option to `makeRenderTarget`**

In `src/render/gl-utils.ts`, change the signature (last optional parameter —
existing call sites in `rain.ts`/`wind.ts` stay valid untouched):

```ts
export function makeRenderTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  caps: GlCaps,
  forceRgba8 = false,
): RenderTarget {
  const wantFloat = caps.colorBufferFloat && !forceRgba8;
```

(The rest of the function body is unchanged — the `wantFloat` gate already
routes both allocation and the FBO-incomplete fallback.) Update the doc
comment: cloud-memory REQUIRES 8-bit unorm storage because its tail and
age-reset contracts are defined on stored bytes (spec §2).

- [ ] **Step 3: Implement `planEnsure` + `CloudMemoryPass` in `src/render/cloud-memory.ts`**

`planEnsure` (pure):

```ts
/** Boundary indices of the display pair that need computing, in order. */
export function planEnsure(
  cloudAgeH: number,
  cached: (k: number) => boolean,
): number[] {
  const { k } = memoryBoundaryPair(cloudAgeH);
  return [k, k + 1].filter((boundary) => !cached(boundary));
}
```

`CloudMemoryPass` structure (follow `rain.ts`'s offscreen-pass idioms — VAO
quad, program, ping-pong between two work targets):

- **GLSL — update program** (embedded template literal, constants spliced):
  - Uniforms: `u_prev` (sampler), `u_cloudNoise` (sampler), `u_center`
    (vec2 clip), `u_metricX`, `u_rMax` (clip units), `u_rCanopy` (clip
    units), `u_vmaxMs`, `u_hollandB`, `u_development`, `u_seed`,
    `u_reducedMotion`.
  - Fragment main, per texel:

```glsl
// clip coords of this texel (same uv convention as env.ts VS)
vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
float rKm = max(length(radial) * ${HALF_DOMAIN_HEIGHT_KM}.0, 1.0);

// -- advect: display-coherent capped rotation under the reduced-motion
//    policy, then the linear debris cap (see memoryAdvectSpeedKmH mirror).
float omega = mix(cloudOmegaMem(rKm), ${LEGACY_CLOUD_ROTATION_RAD_PER_H}, u_reducedMotion);
float tangential = min(omega * rKm, ${CLOUD_MEMORY_MAX_ADVECT_KMH}.0);
// -- new radial outflow, ramping 0->full over 1.2..2.5 x RMW
float rmwKm = max(u_rMax, 0.001) * ${HALF_DOMAIN_HEIGHT_KM}.0;
float outflow = ${CLOUD_MEMORY_OUTFLOW_KMH}.0 *
  smoothstep(1.2 * rmwKm, 2.5 * rmwKm, rKm);
// CCW tangential + outward radial, in metric km/h
vec2 tangentialDir = length(radial) > 1e-5
  ? normalize(vec2(-radial.y, radial.x))
  : vec2(0.0);
vec2 radialDir = length(radial) > 1e-5 ? normalize(radial) : vec2(0.0);
vec2 velocityKmH = tangentialDir * tangential + radialDir * outflow;
// km -> clip -> uv backtrace over dt (x undoes metricX; uv y is flipped)
vec2 dispClip = velocityKmH * ${CLOUD_MEMORY_DT_H}.0 / ${HALF_DOMAIN_HEIGHT_KM}.0;
dispClip.x /= max(u_metricX, 1e-5);
vec2 backUv = v_uv - vec2(dispClip.x * 0.5, -dispClip.y * 0.5);
vec2 prev = texture(u_prev, backUv).rg;

// -- source: analytic convection envelope at this boundary's storm,
//    patchy via the shared cloud noise (seeded; no wall-clock input).
float q = length(radial) / max(u_rMax, 0.001);
float envelope = u_development * exp(-pow(q / 2.6, 2.0));
float cells = smoothstep(0.35, 0.8,
  texture(u_cloudNoise, radial * 2.1 + u_seed * 13.0).r);
float source = envelope * mix(0.35, 1.0, cells) * 0.55;

// -- sealed combine rules (Task 1 CPU mirrors), then decay
float density = min(1.0, prev.r + source);
float age = prev.g * prev.r / max(prev.r + source, 1e-5);
density *= ${Math.exp(-CLOUD_MEMORY_DT_H / CLOUD_MEMORY_DECAY_TAU_H)};
// age-reset reads the STORED byte: emulate the quantized zero test
age = density < (0.5 / 255.0) ? 0.0 : min(1.0, age + ${CLOUD_MEMORY_DT_H / CLOUD_MEMORY_WINDOW_H});
o = vec4(density, age, 0.0, 0.0);
```

  `cloudOmegaMem` is the same Holland expression as `CLOUD_MOTION_GLSL`'s
  `cloudOmega` but parameterized on `rKm` directly — copy the body, cite the
  mirror (`memoryAdvectSpeedKmH`). Zero-storm steps (no frame → the
  enumerator SKIPS boundaries before spawn entirely; there is no "empty"
  source path in-shader).

- **GLSL — pack program**: two samplers `u_stateA`, `u_stateB`; output
  `o = vec4(texture(u_stateA, v_uv).rg, texture(u_stateB, v_uv).rg);`

- **ensure() control flow** (CPU):

```ts
ensure(cloudAgeH, reducedMotion, metricX, cloudNoiseTex, cloudSeed): void {
  if (!this.gl || !this.tape || !cloudNoiseTex) return;
  const runKey = this.tape.runKey();
  if (runKey === null) return;
  const sizePx = /* CLOUD_MEMORY_SIZE_DETAIL or _MOBILE via the same
                    performance-tier trait the facade passes to init/resize */;
  const need = planEnsure(
    cloudAgeH,
    (k) => this.lru.get(this.lru.keyFor(runKey, k, sizePx, reducedMotion)) !== null,
  );
  for (const k of need) this.computeState(k, ...); // N update passes -> cached RT
  // pack the display texture whenever the (k, k+1) pair identity changed
}
```

  `computeState(k)`: zero-clear work target A (`gl.clearColor(0,0,0,0)`),
  then for each boundary `b` of `sourceBoundaries(k)`: look up
  `tape.frameAtOrBeforeAge(b * CLOUD_MEMORY_DT_H)`; a null here means the
  causality seal was violated — `throw new Error('cloud-memory: no tape frame at boundary ' + b)`
  (never swallow). Compute per-boundary uniforms CPU-side:
  `latLonToClip(frame.lat, frame.lon, DOMAIN)` for `u_center`;
  `stormRenderRadii(frame.structure /* match env.ts's exact call shape at its
  renderRadii site — read env.ts lines 690-700 */)` for `u_rMax`/`u_rCanopy`;
  `frame.structure.maximumWindKt * 0.514444` for `u_vmaxMs`;
  `frame.structure.hollandB`; development =
  `clamp(0.56 * frame.organization + 0.44 * intensity01(frame.vKt), 0, 1)` —
  mirror the exact `development` formula env.ts:210 uses, sourcing
  intensity01 the same way the facade's `buildCtx` does (read
  `src/render/index.ts` for its `intensity01` derivation and reuse the same
  helper or expression). Draw quad into work target B reading A; swap; after
  the last boundary, copy the final work target into this boundary's cached
  render target (or render the last step directly into the cache slot).
  All work/cache targets: `makeRenderTarget(gl, sizePx, sizePx, caps, true)`
  (force RGBA8). LRU capacity 6; evicted entries are disposed via
  `disposeRenderTarget`.

- **Cache invalidation**: the LRU key embeds runKey, sizePx, reducedMotion —
  a change in any of them simply misses. On `dispose()` free everything.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/cloud-memory.test.ts` → planner PASS.
Run: `npm test && npm run build` → green (build type-checks the GL half).

- [ ] **Step 5: Commit**

```bash
git add src/render/cloud-memory.ts src/render/gl-utils.ts test/cloud-memory.test.ts
git commit -m "feat: cloud-memory GL pass with windowed recompute and RGBA8 targets"
```

---

### Task 4: OHC pre-blend — free env sampler unit 5

**Files:**
- Modify: `src/render/env.ts` (FS uniforms ~lines 42-43, OHC read ~line 433,
  bind calls ~lines 648-649, EnvLayer class members)
- Test: existing suites only (GLSL browser-verified; QA item 7 covers output
  equivalence)

**Interfaces:**
- Consumes: `makeRenderTarget(gl, w, h, caps, true)` from Task 3's gl-utils
  change; `gpu.ohc`, `gpu.ohcNext`, `gpu.envBlend`, `gpu.envGrid` from
  `GpuTextures`.
- Produces: env FS uniform `u_ohcBlend` on unit 4; **unit 5 is now free**
  (Task 5 claims it). Env binds exactly 15 samplers after this task — the
  transient 15-sampler state is fine; Task 5 restores 16.

- [ ] **Step 1: Add the blend pass to `EnvLayer`**

- New private members: a tiny blend program (VS = existing `VS`; FS below),
  a `RenderTarget | null` sized from `gpu.envGrid` dims (recreate when dims
  change — dims come from the loaded file header via envGrid, never
  hardcoded), and the quad VAO it shares with the main draw.

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_blend;
void main() {
  o = vec4(mix(texture(u_a, v_uv).r, texture(u_b, v_uv).r, u_blend), 0.0, 0.0, 1.0);
}
```

- At the top of `EnvLayer.draw()` (before the main-program `useProgram`):
  if `gpu.ohc && gpu.ohcNext && gpu.envGrid`, run the blend pass into the
  RT with `u_blend = gpu.envBlend`, then restore
  `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` and the main viewport
  (`gl.viewport(0, 0, width, height)` — mirror how `rain.ts` restores state
  after its offscreen update).

- [ ] **Step 2: Swap the shader and bindings**

- FS: delete `uniform sampler2D u_ohc;` and `uniform sampler2D u_ohcNext;`
  (lines 42-43); add `uniform sampler2D u_ohcBlend;`.
- At the OHC read (~line 433-437): replace
  `mix(texture(u_ohc, v_uv).r, texture(u_ohcNext, v_uv).r, u_planeBlend)`
  with `texture(u_ohcBlend, v_uv).r`.
- Bind sites: replace `bind(4, gpu.ohc, 'u_ohc')` and
  `bind(5, gpu.ohcNext, 'u_ohcNext')` with
  `bind(4, this.ohcBlendTarget?.tex ?? gpu.land, 'u_ohcBlend')`. Leave the
  early-return guard list (lines 620-631) checking `gpu.ohc`/`gpu.ohcNext`
  unchanged — the inputs are still required.

- [ ] **Step 3: Verify**

Run: `npm test && npm run build` → green.
Manual sanity is deferred to QA item 7 (blend 0 / 0.5 / 1 equivalence
captures) in Task 7 — note this in the commit body.

- [ ] **Step 4: Commit**

```bash
git add src/render/env.ts
git commit -m "feat: pre-blend the OHC month pair, freeing env sampler unit 5"
```

---

### Task 5: env samples the memory field — debris, macro gain, graded tops

**Files:**
- Modify: `src/render/env.ts` (FS uniform block, `CloudField` struct
  ~line 115, `sampleCloud` ~lines 124-358, ladder inside `CLOUD_TOPS_GLSL`
  consumption region, bind sites, uniform upload in draw)
- Modify: `src/render/cloud-motion.ts` (`CLOUD_TOPS_GLSL` gains the debris
  rung — same file so the ladder stays in one place)
- Test: existing suites (GLSL browser-verified; determinism QA in Task 7)

**Interfaces:**
- Consumes: `CloudMemoryPass.texture` (Task 3), constants
  `CLOUD_MEMORY_DT_H`, `CLOUD_MEMORY_MACRO_GAIN`, `DEBRIS_TOP_WARM_C`,
  `DEBRIS_TOP_COLD_C`, `DEBRIS_MAX_CLOUD` from `./cloud-memory`.
- Produces: env FS uniforms `u_cloudMemory` (sampler, unit 5) and
  `u_hasCloudMemory` (float 0/1); `CloudField` member `debris`;
  `EnvLayer.draw(ctx, gpu, fade)` gains a fourth optional parameter
  `memoryTex: WebGLTexture | null = null` that Task 6's facade call site
  passes.

- [ ] **Step 1: Wire the sampler**

- FS: add `uniform sampler2D u_cloudMemory;` and
  `uniform float u_hasCloudMemory;`.
- Bind: `bind(5, memoryTex ?? gpu.land, 'u_cloudMemory')` next to the other
  bind calls; `gl.uniform1f(u('u_hasCloudMemory'), memoryTex ? 1 : 0);`.
  (16 samplers total again — count them in review.)

- [ ] **Step 2: Sample and compose in `sampleCloud`**

Immediately after `float macro = mix(...)` (env.ts ~line 178-182):

```glsl
  // ---- cloud memory: earth-fixed advected state, crossfaded RG/BA ----
  vec4 memoryPacked = texture(u_cloudMemory, v_uv);
  float memFrac = fract(u_cloudAgeH / ${CLOUD_MEMORY_DT_H}.0);
  float memDensity = mix(memoryPacked.r, memoryPacked.b, memFrac) * u_hasCloudMemory;
  float memAge = mix(memoryPacked.g, memoryPacked.a, memFrac);
  // Enhancement-only gain: gain(0) = 1 exactly — an empty field reproduces
  // the shipped look pixel-for-pixel (spec, gate-sealed).
  macro = clamp(macro * (1.0 + ${CLOUD_MEMORY_MACRO_GAIN} *
    smoothstep(0.15, 0.85, memDensity)), 0.0, 1.0);
```

After the `cloud = max(ambientCloud * ..., stormCloud)` line (~line 351):

```glsl
  // Debris: decaying stratiform deck the storm leaves behind. Deliberately
  // outside stormCloud so shear erosion and storm presence cannot erase the
  // wake the storm already shed.
  float debris = memDensity * (1.0 - 0.55 * memAge) * ${DEBRIS_MAX_CLOUD};
  cloud = max(cloud, debris);
```

- `CloudField` struct gains `float debris;` and the constructor call at
  ~line 357 appends `debris` (update the struct comment). Keep member order:
  cloud, stormCloud, ambientCloud, brightnessC, convectiveCells, relief,
  debris.

- [ ] **Step 3: Debris rung in the tops ladder (`cloud-motion.ts`)**

In `CLOUD_TOPS_GLSL` (cloud-motion.ts ~line 180), insert between the
`float topC = ambientTopC;` line and the cirrus mix — debris is the WARMEST
storm component, so it must be mixed FIRST (the ladder mixes warm→cold so
cold dominates):

```glsl
  float debrisTopC = mix(${DEBRIS_TOP_WARM_C.toFixed(1)}, ${DEBRIS_TOP_COLD_C.toFixed(1)},
    1.0 - memAge);
  float debrisPresence = clamp(memDensity * 1.3, 0.0, 1.0) * u_hasCloudMemory;
  topC = mix(topC, debrisTopC, debrisPresence);
```

(`CLOUD_TOPS_GLSL` already references sampleCloud locals in place by
documented convention — extend its doc comment to name `memDensity`,
`memAge`, and `u_hasCloudMemory` as new required in-scope symbols.)
Import the two `DEBRIS_TOP_*` constants into cloud-motion.ts from
`./cloud-memory` — WAIT: that would create a cycle
(cloud-memory imports cloud-motion). Instead MOVE the two `DEBRIS_TOP_*`
constants into `cloud-motion.ts` (exported there, re-exported by
cloud-memory.ts so Task 1's test imports keep working), keeping the
dependency one-directional. Update the Task 1 constants' home accordingly —
this is the one sanctioned deviation, note it in the commit body.

- [ ] **Step 4: Verify + commit**

Run: `npm test && npm run build` → green.

```bash
git add src/render/env.ts src/render/cloud-motion.ts src/render/cloud-memory.ts
git commit -m "feat: env samples the cloud-memory field - debris deck, macro gain, warm-top rung"
```

---

### Task 6: Facade + main wiring

**Files:**
- Modify: `src/render/index.ts` (module construction ~line 217, `draw()`
  ~line 279-317, facade setter near `setObservedSatelliteFrame` ~line 418,
  init/resize/dispose fan-outs)
- Modify: `src/main.ts` (one-time tape wiring after the render facade is
  resolved — the facade-resolution block starts ~line 2933)
- Test: existing suites; behavior QA is Task 7

**Interfaces:**
- Consumes: `CloudMemoryPass`, `CloudTape` (Task 3);
  `interpolatedCloudAgeH` from `./cloud-motion`; `session.recorder`
  accessors (Task 2).
- Produces: `RenderPipeline.setCloudTape(tape: CloudTape | null): void` on
  the facade (and its optional-call use `renderCtrl?.setCloudTape?.(...)`
  in main.ts).

- [ ] **Step 1: Facade integration (`src/render/index.ts`)**

- `private cloudMemory = new CloudMemoryPass();` beside
  `private env = new EnvLayer()` (line 217); add it to the same init /
  resize / dispose fan-outs the other modules use (find where
  `this.env.init(gl)` etc. run and mirror).
- `setCloudTape(tape: CloudTape | null): void { this.cloudMemory.setTape(tape); }`
- In `draw()`, after `const ctx = this.buildCtx(frame);` (line 284) and
  before the layer sequence:

```ts
    const cloudAgeH = interpolatedCloudAgeH(
      frame.prevStorm?.ageH ?? null,
      frame.storm?.ageH ?? 0,
      frame.alpha,
    ); // SAME inputs as env.ts's u_cloudAgeH upload — single age source.
    if (frame.storm) {
      this.cloudMemory.ensure(
        cloudAgeH,
        ctx.reduced,
        /* metricX: copy the exact expression env.ts uses for u_metricX
           (env.ts ~line 777) — extract it into a small shared helper in
           cloud-motion.ts if it is more than one expression, and use that
           helper from BOTH env.ts and here so they cannot drift. */
        this.envMetricX(ctx),
        this.gpu /* the same cloud-noise texture env binds on unit 14 —
                    pass the texture the facade owns for it */.cloudNoise ??
          null,
        /* cloudSeed: the same value env uploads as u_cloudSeed — find its
           source in env.draw and pass the identical value. */
        this.cloudSeedFor(ctx),
      );
    }
```

  (The two `/* ... */` lookups are deliberate: env.ts is the single source
  of truth for metricX/cloudSeed; the implementer reads its draw() and
  extracts shared helpers rather than duplicating expressions. If
  `gpu.cloudNoise` is not on `GpuTextures`, find where env's unit-14 texture
  is created/owned and expose it to the pass the same way — do NOT create a
  second noise texture.)
- Pass the packed texture into env:
  `this.env.draw(ctx, this.gpu, glowFade * simulatedWeight, this.cloudMemory.texture);`
  (line 317).
- A thrown ensure() error must propagate — main.ts's per-layer try/catch
  (main.ts:2835-2839) already logs-and-skips a failing layer draw; do not
  add another swallow inside the facade.

- [ ] **Step 2: main.ts wiring**

Where the render facade is resolved and constructed (the block starting
~line 2933, after `renderCtrl` exists), add once:

```ts
renderCtrl?.setCloudTape?.({
  frameAtOrBeforeAge: (ageH) => session.recorder.frameAtOrBeforeAge(ageH),
  runKey: () => session.recorder.runKey(),
});
```

(`session` is module-scoped and its `recorder` is reused across runs —
`runKey()` changing on every `start()` is what invalidates the cache, so
one-time wiring is correct.)

- [ ] **Step 3: Verify + commit**

Run: `npm test && npm run build` → green.
Run: `npm run dev`, open the app, spawn a storm, let it run 20+ sim-hours:
console must be free of WebGL errors and the `[render]` layer-throw warning.

```bash
git add src/render/index.ts src/main.ts
git commit -m "feat: wire the cloud-memory pass through the render facade and tape"
```

---

### Task 7: Browser QA, performance, morphology re-screen, repo gates, PR

**Files:**
- Modify: `docs/satellite-cloud-validation.md` (append a currency-note
  entry, same format as the 2026-07-29 note)
- No product-code changes except tuning fixes QA forces (each goes through
  its own mini test-diff-commit cycle)

- [ ] **Step 1: Repo gates (all must pass untouched)**

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

Then `git diff origin/main...HEAD --stat` — the only files changed are those
in the Global Constraints allowlist. Any frozen acceptance/contract, physics
report, bake, or data file present is a hard failure.

- [ ] **Step 2: Browser QA (Playwright MCP on `npm run dev`; console or WebGL errors are failures; screenshots saved as evidence)**

1. **Scrub equivalence (within replay):** seeded URL, run ≥ 24 sim-hours,
   enter replay; scrub to a frame past age 19 h, capture `#gl-canvas`;
   scrub to age ~2 h (evicts nothing? — scrub far repeatedly to force LRU
   eviction of the first frame's pair), scrub back to the exact same frame,
   capture → byte-identical buffers. Repeat with the two captures straddling
   a memory-boundary crossing (frames at ages x.9 and x+1.1).
2. **Within-mode repeats:** paused live frame captured twice →
   byte-identical; same replay frame selected twice → byte-identical. (No
   cross-mode comparison — spec seals these as separate checks.)
3. **Wake:** mature storm with clear translation ≥ 18 sim-hours old — IR
   enhanced palette shows a decaying debris deck along the track behind the
   storm (compare against `origin/main` build side-by-side); after death the
   frozen final frame retains the wake; two captures 0.15 s apart straddling
   a boundary show no tail-pop.
4. **Layer-switch:** wake visible in all three IR palettes AND in the faint
   cloud context of terrain/wind modes at the same frame.
5. **Reduced motion:** `emulateMedia({ reducedMotion: 'reduce' })`, reload
   same seed → wake present; no fast rotation in the wake (two captures 2 s
   apart differ only at storm-translation scale); narrow viewport WITHOUT
   reduced motion still animates.
6. **Rain alignment:** radar vs IR at weak, mature, sheared states — the
   precipitating-cloud floor unchanged (memory must not move it).
7. **OHC pre-blend equivalence:** on a frame with `u_planeBlend` at 0, at
   ~0.5, and at 1 (pick month-times accordingly), baseline `origin/main`
   vs candidate captures of any mode that visualizes OHC must match within
   quantization (no visible banding/shift).
8. **Format assertion:** via `browser_run_code_unsafe`, read the memory
   render target's implementation format
   (`gl.getParameter` on a bound FBO / `getFramebufferAttachmentParameter`)
   and assert 8-bit unorm RGBA.
9. **Cold-scrub GPU timing:** with `EXT_disjoint_timer_query_webgl2` when
   available (else a `gl.fenceSync` + busy-wait readback), time one cold
   boundary recompute (18 passes + pack) at 512² → must be < 16.7 ms.

- [ ] **Step 3: Performance trace**

Same protocol as the IR round (plan 2026-07-29, Task 7 Step 3): baseline
worktree at `origin/main` (`git worktree add ../wiw-perf-base origin/main &&
cd ../wiw-perf-base && npm ci && npm run build && npm run preview`),
candidate `npm run build && npm run preview`; same machine, viewport, tier,
storm frame, 300-frame window; collect rAF-to-rAF main-thread work.
Gate: candidate p95 ≤ baseline p95 + max(20 %, 1 ms); missed-frame fraction
rise ≤ 5 pp. Record raw numbers for the PR. Remove the worktree after
(`git worktree remove ../wiw-perf-base`).

- [ ] **Step 4: Morphology re-screen (A/B-relative protocol)**

Repeat the documented 2026-07-29 controlled A/B exactly
(docs/satellite-cloud-validation.md "Currency note"): pinned observed frame
(WMS re-fetch), scenario `shaheen` hindcast scrubbed to frame 10 (2.5 h),
grayscale palette, UI hidden, `#gl-canvas` element capture; renderer the
only variable (baseline = `origin/main` build, candidate = this branch).
Compute the same five checks with unchanged thresholds. Acceptance is
relative: the candidate must pass at least the checks the baseline passes.
Append the measured numbers as a new currency-note entry in
`docs/satellite-cloud-validation.md` (thresholds untouched). If the
candidate regresses a passing check → fix the renderer, not the screen; if
the observed input cannot be lawfully re-fetched → STOP and surface it as a
decision brief.

- [ ] **Step 5: Commit QA artefacts + PR**

```bash
git add docs/satellite-cloud-validation.md
git commit -m "docs: record the cloud-memory morphology A/B and QA evidence"
git push -u origin feat/cloud-memory
gh pr create --title "feat: cloud memory - advected debris wake with byte-reproducible windowed state" --body "<summary + spec path + full test plan + QA evidence + perf table + morphology A/B numbers>"
```

PR body must include: the spec path and its sealed gate record summary,
before/after wake screenshots, the perf table (baseline/candidate p95 +
missed-frame), the cold-scrub GPU timing, the morphology A/B result, and the
statement that the diff was inspected against the Global Constraints
allowlist.

---

## Self-review record

- **Spec coverage:** state definition/causality/cache (Task 1 + 3), tape
  accessor semantics (Task 2), RGBA8 + force flag + encode rules (Tasks 1,
  3), advection with linear cap + outflow + reduced-motion gate (Tasks 1,
  3), sealed combine rules + byte tail (Task 1 tests, Task 3 GLSL), OHC
  pre-blend accounting (Task 4), packing/crossfade/single-age-source,
  macro gain, debris rung, coverage-everywhere (Task 5 + 6), all QA items
  1-8 of the spec's verification section (Task 7 steps 2-4), repo gates
  (Task 7 step 1). Post-death: no task claims post-death evolution — the
  frozen-final-frame stance is QA item 3 only. No gaps found.
- **Type consistency:** `CloudTape` defined once in cloud-memory.ts,
  consumed by index.ts and main.ts; `frameAtOrBeforeAge(ageH)` /
  `runKey()` signatures identical in Tasks 2, 3, 6;
  `ensure(cloudAgeH, reducedMotion, metricX, cloudNoiseTex, cloudSeed)`
  matches between Tasks 3 and 6; `env.draw` gains the optional 4th param in
  Task 5 and its caller updates in Task 6 (transient default-null keeps
  Task 5 compiling standalone).
- **Known sanctioned deviation:** `DEBRIS_TOP_*` constants live in
  cloud-motion.ts (re-exported by cloud-memory.ts) to avoid an import
  cycle — stated inside Task 5 so the implementer does not discover it as a
  compile error.
- **Deliberate openness:** metricX/cloudSeed/cloudNoise-texture extraction
  points in Task 6 direct the implementer to env.ts as the single source
  rather than duplicating expressions the plan cannot see verbatim without
  risking drift; each is bounded ("read env.draw, extract a shared
  helper").
