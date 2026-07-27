# Layer-Integrity Remediation (E + A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every static replay asset's bytes in CI, then fix three shipped
layer defects: stop the infrared CDO/cirrus canopy and its texture from shrinking
with the inner core, align three rain products on one rainband-strength contract,
and stop a missing `ocean.bin` from being labelled as WOA23 climatology. The
cloud-rainband extent remains an explicitly documented follow-up rather than an
unvalidated QPF change.

**Architecture:** Radial geometry arithmetic moves out of duplicated GLSL
literals into two pure TypeScript modules (`src/render/storm-radii.ts`,
`src/rainband-profile.ts`) so the invariants become unit tests instead of
comments. The cloud canopy gains a second radius derived from `outerSizeKm`
alone; rain products keep their existing `rMax` normalization and converge on
one mean, envelope, eyewall width, arm count, and pitch. Ocean provenance moves
from an assumption made before sampling to a tag returned by the sampler.

**Tech Stack:** Vite, vanilla TypeScript, WebGL2, vitest. Node `.mjs` scripts for gates. Python bake pipeline (not touched by this plan).

**Source spec:** `docs/superpowers/specs/2026-07-27-layer-integrity-remediation-design.md`

## Global Constraints

- **Zero runtime dependencies.** `package.json` has no `dependencies` block and must not gain one. Dev deps stay vite/typescript/vitest. Even `@types/node` is avoided — `test/node-fs.d.ts` is the scoped shim for fs typing.
- **Determinism is the core invariant.** No `Math.random` or `Date.now` in `src/sim.ts`. Physics advances in fixed 15-sim-minute steps. Render/UI may adapt to the device; physics and recorded results never do.
- **Render changes must not touch physics.** Tasks 2, 3, 5 change pixels only. If any of them changes a recorded number, the task is wrong.
- **Task 6 must be numerically neutral.** It is a constant-extraction refactor. Any change to a deposited rain value means it was done wrong.
- **Run the task-local checks before each concern commit, and the complete gate
  set after Task 9:** `npm test`, `npm run build`,
  `npm run calibrate:check`, `npm run assets:check`,
  `npm run hf4:verify:check`, `npm run hf4:gate:check`,
  `npm run hf6:verify:check`, `npm run hf6:gate:check`,
  `npm run hf6:prospective:check`, `npm run hf2a:ocean:reference:check`, and
  `npm run hf2a:ocean:gate:check`. `assets:check` begins after Task 1 exists.
- **Never hand-edit machine-generated reports:** `docs/fidelity-benchmark.md`, `docs/hindcast-benchmark.md`, `docs/structure-calibration.md`, `docs/hf6-scorecard.md`.
- **Sealed-artefact regeneration requires human authorization.** Task 7 Step 10 is the only step that rewrites a sealed artefact. No agent may run it unattended; see the approval gate in that step.
- **Rejected scientific verdicts remain rejected permanently.** Never retune a
  threshold, cohort, metric, or verdict. A numerically neutral change to a
  runtime source hashed by HF-4/HF-6 still requires the documented
  reproduction-artifact refresh: regenerate verification and acceptance through
  their scripts, then prove that only source/verification hashes changed.
- **Colours come only from `src/tokens.ts`.** Never hardcode a colour in a shader or `style.css`.
- **Write exact quotients in code** (`2.25 / 4.5`), never the rounded decimals shown in tables.
- **Conventional commits, no AI attribution.** One concern per commit.

---

## File Structure

**Created:**
- `calibration/asset-manifest.mjs` — generates/verifies the SHA-256 manifest over
  static replay assets under `public/data/`, explicitly excluding the volatile
  `live/` and `satellite/` namespaces. Node script, no deps beyond Node builtins.
- `calibration/asset-manifest.d.mts` — the narrow TypeScript declaration for
  the `.mjs` exports consumed by the Vitest gate.
- `calibration/asset-manifest.json` — the committed manifest. Lives outside `public/data/` so it cannot hash itself.
- `test/asset-manifest.test.ts` — the CI gate; rides in `npm test` so no new workflow step is needed.
- `src/render/storm-radii.ts` — pure radial geometry for the render path. One responsibility: turn a `StormStructure` into the two clip-space radii the shaders need.
- `test/storm-radii.test.ts`
- `src/rainband-profile.ts` — the shared rainband spatial contract for the three rain products. Lives in `src/` (not `src/render/`) because `impact.ts` is not a render module.
- `test/rainband-profile.test.ts`

**Modified:**
- `src/render/env.ts` — uniform plumbing (`:535-538`) and the cloud shader's radial coordinates.
- `src/render/radar.ts` — adopt the shared rainband contract (`:48-56`, `:108-111`).
- `src/render/rain.ts` — import shared constants (`:148-154`). No numeric change.
- `src/impact.ts` — import shared constants (`:46-47`, `:249-259`). No numeric change.
- `src/ocean-profile-sampler.ts` — tagged return type.
- `src/main.ts` — degraded-input identity wiring; its existing ocean sampler
  pass-through is verified during Task 7 but needs no source edit for the tag.
- `src/sim.ts` — reset callback tier derivation (`:1031-1043`).
- `src/upper-ocean.ts` — `createColumn` downgrade on absent profile.
- `src/product-identity.ts` — degraded-data indication.
- `index.html` — degraded-input chip anchor.
- `src/style.css` — token-coloured degraded-input chip styling.
- `calibration/hf2a-ocean-reference.mjs` — untyped caller migration (`:501-522`).
- `test/ocean-profile-sampler.test.ts` — unwrap the tagged profile and assert its tier.
- `test/physics.test.ts` — the assertion at `:201` flips.
- `test/upper-ocean.test.ts` — defensive downgrade of both tier and source time.
- `test/product-identity.test.ts` — degraded-input identity coverage.
- `calibration/hf4-verification.json`, `calibration/hf4-acceptance.json`,
  `calibration/hf6-sealed-verification.json`,
  `calibration/hf6-acceptance.json` — generated hash-only reproducibility
  refresh after Task 7; metrics and verdicts must not change.
- `package.json` — two new scripts.

---

## Task 1: Static replay-asset byte manifest and CI gate

Nothing currently pins the *values* of the static baked assets —
`test/integration-bins.test.ts` checks presence, bounds and plane diversity only.
A one-LSB quantization flip from a re-bake would be silent and would break the
promise that shared URLs replay identically. The scheduled workflow deliberately
rewrites `public/data/live/**` before tests, and observed satellite caches are
also mutable; those two namespaces are excluded and remain governed by their
own source manifests. This must land before anything else so later tasks are
provably data-neutral.

**Files:**
- Create: `calibration/asset-manifest.mjs`
- Create: `calibration/asset-manifest.d.mts`
- Create: `calibration/asset-manifest.json`
- Create: `test/asset-manifest.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run assets:manifest` (rewrites the manifest),
  `npm run assets:check` (verifies). `calibration/asset-manifest.mjs` exports
  `buildManifest(rootUrl: URL): Record<string, string>` mapping canonical relative
  path → SHA-256 hex and `diffManifest(actual, committed)` for testable drift
  classification.

- [ ] **Step 1: Write the failing test**

Create `test/asset-manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import committed from '../calibration/asset-manifest.json';
import {
  buildManifest,
  diffManifest,
  VOLATILE_ASSET_PREFIXES,
} from '../calibration/asset-manifest.mjs';

const DATA_ROOT = new URL('../public/data/', import.meta.url);

describe('asset manifest', () => {
  it('matches every static replay file under public/data byte-for-byte', () => {
    const actual = buildManifest(DATA_ROOT);
    expect(actual).toEqual(committed.files);
  });

  it('orders entries by canonical forward-slash relative path', () => {
    const actual = buildManifest(DATA_ROOT);
    const keys = Object.keys(actual);
    expect(keys).toEqual([...keys].sort());
    expect(keys.every((k) => !k.includes('\\'))).toBe(true);
  });

  it('covers the replay-critical assets by name', () => {
    const actual = buildManifest(DATA_ROOT);
    for (const required of ['env.bin', 'terrain.bin', 'scenarios.json']) {
      expect(Object.keys(actual)).toContain(required);
    }
  });

  it('excludes only the declared volatile observation namespaces', () => {
    expect(VOLATILE_ASSET_PREFIXES).toEqual(['live/', 'satellite/']);
    const keys = Object.keys(buildManifest(DATA_ROOT));
    expect(keys.some((key) =>
      VOLATILE_ASSET_PREFIXES.some((prefix) => key.startsWith(prefix))
    )).toBe(false);
  });

  it('classifies drift without modifying a tracked asset', () => {
    expect(diffManifest(
      { 'env.bin': 'new', 'added.bin': 'added' },
      { 'env.bin': 'old', 'removed.bin': 'removed' },
    )).toEqual({
      drifted: ['env.bin'],
      added: ['added.bin'],
      removed: ['removed.bin'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/asset-manifest.test.ts`
Expected: FAIL — the manifest module and committed JSON do not exist yet.

- [ ] **Step 3: Write the manifest builder**

Create `calibration/asset-manifest.mjs`:

```js
/**
 * SHA-256 manifest over every static replay file under public/data.
 *
 * A directory rule with two explicit volatile-prefix exclusions: a newly baked
 * static asset is covered the day it lands. The manifest lives in calibration/
 * rather than public/data/ so it cannot hash itself. Paths are canonical
 * forward-slash relative so the file is byte-identical on Windows and Linux CI.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

const DATA_ROOT = new URL('../public/data/', import.meta.url);
const MANIFEST_PATH = new URL('./asset-manifest.json', import.meta.url);
export const VOLATILE_ASSET_PREFIXES = Object.freeze(['live/', 'satellite/']);

function walk(dir, out) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function buildManifest(rootUrl) {
  const root = fileURLToPath(rootUrl);
  const files = walk(root, []);
  const manifest = {};
  for (const file of files) {
    const key = relative(root, file).split(sep).join('/');
    if (VOLATILE_ASSET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    manifest[key] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
}

export function diffManifest(actual, committed) {
  return {
    drifted: Object.keys(actual)
      .filter((key) => key in committed && actual[key] !== committed[key])
      .sort(),
    added: Object.keys(actual).filter((key) => !(key in committed)).sort(),
    removed: Object.keys(committed).filter((key) => !(key in actual)).sort(),
  };
}

function main() {
  const files = buildManifest(DATA_ROOT);
  const write = process.argv.includes('--write');
  if (write) {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify({ files }, null, 2)}\n`);
    console.log(`wrote ${Object.keys(files).length} asset hashes`);
    return;
  }
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const { drifted, added, removed } = diffManifest(files, committed.files);
  if (drifted.length || added.length || removed.length) {
    console.error('asset manifest drift:', { drifted, added, removed });
    process.exit(1);
  }
  console.log(`asset manifest clean (${Object.keys(files).length} files)`);
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (import.meta.url === entryUrl) main();
```

Create `calibration/asset-manifest.d.mts` beside it so the test remains
strictly typed without adding `@types/node` or turning on `allowJs`:

```ts
export const VOLATILE_ASSET_PREFIXES: readonly ['live/', 'satellite/'];

export function buildManifest(rootUrl: URL): Record<string, string>;

export function diffManifest(
  actual: Record<string, string>,
  committed: Record<string, string>,
): {
  drifted: string[];
  added: string[];
  removed: string[];
};
```

- [ ] **Step 4: Generate the manifest**

Run: `node calibration/asset-manifest.mjs --write`
Expected: prints `wrote N asset hashes`; `calibration/asset-manifest.json` now exists.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/asset-manifest.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the npm scripts**

In `package.json`, add to `"scripts"` immediately after `"calibrate:demo"`:

```json
"assets:manifest": "node calibration/asset-manifest.mjs --write",
"assets:check": "node calibration/asset-manifest.mjs",
```

- [ ] **Step 7: Verify the script gate independently**

Run: `npm run assets:check`
Expected: `asset manifest clean (N files)`, exit 0.

- [ ] **Step 8: Prove drift classification without touching tracked data**

Run the focused test containing the synthetic old/new maps:

```bash
npx vitest run test/asset-manifest.test.ts -t "classifies drift"
```

Expected: PASS. The assertion must show one changed, one added, and one removed
path in separate arrays. Do not mutate `public/data/scenarios.json` and do not
use `git checkout --` as test cleanup.

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: PASS including the 5 new tests.

```bash
git add calibration/asset-manifest.mjs calibration/asset-manifest.d.mts calibration/asset-manifest.json test/asset-manifest.test.ts package.json
git commit -m "test: pin public/data asset bytes with a sha-256 manifest gate"
```

---

## Task 2: Storm render radii module

The cloud shield currently expresses every feature as a multiple of `rmwKm`, which contracts as the storm intensifies. This task builds the pure arithmetic that gives the canopy its own scale. No shader changes yet — this task's deliverable is a tested function.

**Files:**
- Create: `src/render/storm-radii.ts`
- Test: `test/storm-radii.test.ts`

**Interfaces:**
- Consumes: `StormStructure` from `src/types.ts` (fields used: `rmwKm`, `outerSizeKm`).
- Produces:
  `stormRenderRadii(structure: Pick<StormStructure, 'rmwKm' | 'outerSizeKm'>)` returning
  `{ rMax, rCanopy }`. Also exports `HALF_DOMAIN_HEIGHT_KM = 666`,
  `RENDER_RADIUS_FLOOR = 0.008`, and
  `CANOPY_COEFFICIENT_DIVISOR = 4.5`. Task 3 consumes them.

- [ ] **Step 1: Write the failing test**

Create `test/storm-radii.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from '../src/render/storm-radii';

describe('stormRenderRadii', () => {
  it('derives the canopy from outer size alone, never from RMW', () => {
    const wide = stormRenderRadii({ rmwKm: 12, outerSizeKm: 300 });
    const tight = stormRenderRadii({ rmwKm: 95, outerSizeKm: 300 });
    expect(wide.rCanopy).toBe(tight.rCanopy);
  });

  it('never contracts the canopy while outer size grows, even as RMW contracts', () => {
    // The exact defect: intensification shrinks RMW while outer size grows.
    let previous = 0;
    for (let step = 0; step <= 20; step += 1) {
      const rmwKm = 95 - step * 4;        // contracting inner core
      const outerSizeKm = 60 + step * 18; // expanding outer circulation
      const { rCanopy } = stormRenderRadii({ rmwKm, outerSizeKm });
      expect(rCanopy).toBeGreaterThanOrEqual(previous);
      previous = rCanopy;
    }
  });

  it('applies the numerical floor without reintroducing an RMW dependence', () => {
    const degenerate = stormRenderRadii({ rmwKm: 95, outerSizeKm: 0 });
    expect(degenerate.rCanopy).toBe(RENDER_RADIUS_FLOOR);
  });

  it('pins the reference structure so the render is unchanged', () => {
    const { rMax, rCanopy } = stormRenderRadii({ rmwKm: 40, outerSizeKm: 180 });
    expect(rMax).toBeCloseTo(40 / 666, 12);
    expect(rCanopy).toBeCloseTo(180 / 666, 12);
    // Canopy coefficients are the old rMax multiples divided by this ratio.
    expect(rCanopy / rMax).toBeCloseTo(CANOPY_COEFFICIENT_DIVISOR, 12);
  });

  it('allows the canopy to fall below the core for broad weak storms', () => {
    // Reachable: structure.ts clamps rmwKm to [12,95] and outerSizeKm to [60,420].
    const { rMax, rCanopy } = stormRenderRadii({ rmwKm: 95, outerSizeKm: 60 });
    expect(rCanopy).toBeLessThan(rMax);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/storm-radii.test.ts`
Expected: FAIL — cannot resolve `../src/render/storm-radii`.

- [ ] **Step 3: Write the implementation**

Create `src/render/storm-radii.ts`:

```ts
/**
 * Radial scales the cloud and rain shaders normalize by.
 *
 * The inner core (rMax) contracts as a storm intensifies; the canopy must not.
 * rCanopy is therefore a function of outerSizeKm ALONE — deliberately with no
 * rMax floor. An earlier design floored it against rMax as an "inversion
 * guard"; because structure.ts clamps rmwKm to [12,95] and outerSizeKm to
 * [60,420], that floor binds for broad weak storms and re-couples the canopy to
 * the contracting core, reintroducing the exact bug it was meant to prevent.
 * rCanopy < rMax is a real morphology (a broad ragged core), not an error.
 */

import type { StormStructure } from '../types';

/** Half the domain height in km — converts km to clip-y units. */
export const HALF_DOMAIN_HEIGHT_KM = 666;

/** Shared numerical floor; matches the existing guards in env.ts and radar.ts. */
export const RENDER_RADIUS_FLOOR = 0.008;

/**
 * Reference outerSizeKm / rmwKm (180 / 40). Canopy coefficients are the former
 * rMax multiples divided by this, so the reference geometry is mathematically
 * unchanged. Rendered QA checks for implementation/precision drift.
 */
export const CANOPY_COEFFICIENT_DIVISOR = 4.5;

export interface StormRenderRadii {
  /** Inner core, clip units. Eye, eyewall, vortex wind, rainband envelopes. */
  rMax: number;
  /** Canopy, clip units. Central overcast, cirrus, canopy offset, noise space. */
  rCanopy: number;
}

export function stormRenderRadii(
  structure: Pick<StormStructure, 'rmwKm' | 'outerSizeKm'>,
): StormRenderRadii {
  return {
    rMax: Math.max(RENDER_RADIUS_FLOOR, structure.rmwKm / HALF_DOMAIN_HEIGHT_KM),
    rCanopy: Math.max(
      RENDER_RADIUS_FLOOR,
      structure.outerSizeKm / HALF_DOMAIN_HEIGHT_KM,
    ),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/storm-radii.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/storm-radii.ts test/storm-radii.test.ts
git commit -m "feat: add storm render radii with an outer-size canopy scale"
```

---

## Task 3: Give the CDO and cirrus canopy their own scale

Wire `rCanopy` into `env.ts` and split the shader's radial coordinates. This
stops the central dense overcast, cirrus, canopy displacement, and cloud texture
from contracting with the inner core. The cloud-rainband envelope deliberately
remains on `rMax`; this task is a scoped partial repair, not a claim that every
visible cloud component has been decoupled.

**Files:**
- Modify: `src/render/env.ts`

**Interfaces:**
- Consumes: `stormRenderRadii`, `RENDER_RADIUS_FLOOR`, and
  `CANOPY_COEFFICIENT_DIVISOR` from Task 2.
- Produces: a new `u_rCanopy` uniform. No new exports.

**This task has no unit test.** Its arithmetic was tested in Task 2; what remains is shader plumbing whose only honest gate is `npm run build` plus rendered inspection. Do not fake a unit test for it — record the visual check instead.

- [ ] **Step 1: Add the uniform declaration**

In `src/render/env.ts`, after the existing `uniform float u_rMax;` (line 54), add:

```glsl
uniform float u_rCanopy;
```

- [ ] **Step 2: Split the radial coordinates in `sampleCloud`**

Replace lines 110-120 (from `float rMax = ...` through `float canopyQ = ...`) with:

```glsl
  float rMax = max(${RENDER_RADIUS_FLOOR}, u_rMax);
  float rCanopy = max(${RENDER_RADIUS_FLOOR}, u_rCanopy);
  // coreQ: eye and eyewall stay tied to the contracting inner core.
  float q = length(radial) / rMax;

  // The cold canopy drifts downshear while the eye and eyewall remain tied to
  // the surface vortex. This creates the asymmetric shield visible in real IR.
  vec2 shearDir = length(u_shearVector) > 0.05
    ? normalize(u_shearVector)
    : vec2(0.78, 0.62);
  float shearN = smoothstep(7.0, 27.0, u_shearAtStorm);
  vec2 canopyRadial = radial - shearDir * rCanopy * shearN *
    (${0.82 / CANOPY_COEFFICIENT_DIVISOR});
  // canopyQ drives the overcast and cirrus; bandQ keeps the rainbands on the
  // inner core so they stay consistent with radar, rain and the impact ledger.
  float canopyQ = length(canopyRadial) / rCanopy;
  float bandQ = length(canopyRadial) / rMax;
```

- [ ] **Step 3: Move the noise space to the canopy scale**

Replace line 129 (`vec2 spiralSpace = ...`) with:

```glsl
  vec2 spiralSpace = rotate2(twist) * (canopyRadial / rCanopy);
```

This is what stops cloud *texture granularity* from contracting with the inner core. It is intentionally canopy-scaled while band position is core-scaled; see the spec's coordinate table before "simplifying" it.

- [ ] **Step 4: Re-anchor the overcast and cirrus coefficients**

Replace line 150 (`float coreRadius = ...`) with:

```glsl
  float coreRadius = mix(
    ${2.25 / CANOPY_COEFFICIENT_DIVISOR},
    ${3.55 / CANOPY_COEFFICIENT_DIVISOR},
    development
  ) * mix(1.0, 0.86, shearN);
```

Replace line 204 (`float cirrus = ...`) with:

```glsl
  float cirrus = exp(-pow(
    canopyQ / (${5.8 / CANOPY_COEFFICIENT_DIVISOR}),
    1.55
  )) * cirrusTexture *
    mix(0.16, 0.38, u_organization) * mix(0.82, 1.16, shearN);
```

Exact quotients, not rounded decimals — rounding here is how a reference regression drifts on day one.

- [ ] **Step 5: Put the band envelope and band pitch on `bandQ`**

Replace lines 163-172 (`float bandEnvelope = ...` through the `secondaryBand` closing paren) with:

```glsl
  float bandEnvelope = smoothstep(1.25, 1.85, bandQ) *
    (1.0 - smoothstep(outerBandRadius - 2.6, outerBandRadius, bandQ));
  float bandPhase =
    2.35 * azimuth - 1.52 * bandQ + rotation + (macro - 0.5) * 4.6;
  float primaryBand = smoothstep(0.18, 0.76, 0.5 + 0.5 * sin(bandPhase));
  float secondaryBand = smoothstep(
    0.30,
    0.82,
    0.5 + 0.5 * sin(3.7 * azimuth - 0.88 * bandQ - rotation * 0.5 + fine)
  );
```

Band *pitch* moves with band *extent* so they cannot disagree. Only the `macro`/`fine` stochastic offsets remain canopy-scaled, which is what keeps bands ragged without letting their wavelength drift from their envelope.

- [ ] **Step 6: Fix `canopyDir` to use one consistent scale**

Replace line 192 (`vec2 canopyDir = ...`) with:

```glsl
  vec2 canopyDir = canopyQ > 0.001 ? canopyRadial / (canopyQ * rCanopy) : shearDir;
```

- [ ] **Step 7: Pass the new uniform**

In the draw method, replace lines 535-538 with:

```ts
    const renderRadii = ctx.structure
      ? stormRenderRadii(ctx.structure)
      : { rMax: 0.04, rCanopy: 0.18 };
    gl.uniform1f(u('u_rMax'), renderRadii.rMax);
    gl.uniform1f(u('u_rCanopy'), renderRadii.rCanopy);
```

The stormless fallback keeps the previous `0.04` core and adds a canopy at the same 4.5 reference ratio (`0.04 * 4.5 = 0.18`).

- [ ] **Step 8: Add the import**

At the top of `src/render/env.ts`, alongside the other relative imports:

```ts
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from './storm-radii';
```

The fragment source is already a template literal, so these TypeScript
expressions are evaluated into GLSL once at module load. This keeps the tested
constants and shader constants identical.

- [ ] **Step 9: Verify the build and the full suite**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean, vite build succeeds.

Run: `npm test`
Expected: PASS. If any test changed, stop: this task must not alter recorded output.

- [ ] **Step 10: Rendered QA at both clamp corners (required, cannot be automated)**

Run `npm run dev`. Spawn storms and confirm by eye:

1. **Intensifying storm** — as wind rises, the eye and eyewall tighten while
   the CDO, cirrus outer envelope, downshear displacement, and texture scale do
   **not** collapse with RMW. The cloud-rainband component may still contract;
   record it as the known scope boundary rather than declaring the entire shield
   fixed.
2. **Broad weak corner** (`outerSizeKm → 60`, `rmwKm → 95`) — the eye may exceed the central overcast. Expected and accepted, but confirm it does not render as a hole or an inverted texture.
3. **Wide mature corner** (`outerSizeKm → 420`, `rmwKm → 12`) — confirm the canopy is large without the bands tearing away from their texture.

Record what you saw in the commit body. "Looks fine" is not a record.

- [ ] **Step 11: Commit**

```bash
git add src/render/env.ts
git commit -m "fix: scale the cloud canopy by outer size instead of the inner core"
```

---

## Task 4: Shared rainband contract

Three rain products disagree: `radar.ts` has an azimuthal mean of 0.54, `rain.ts` and `impact.ts` use 0.68. This task builds the shared contract; Tasks 5 and 6 adopt it.

**Files:**
- Create: `src/rainband-profile.ts`
- Test: `test/rainband-profile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RAINBAND_AZIMUTHAL_MEAN`,
  `RAINBAND_SPIRAL_AMPLITUDE`, `RAINBAND_SPIRAL_ARMS`,
  `RAINBAND_SPIRAL_PITCH`, `RAINBAND_SPIRAL_ROTATION_PER_H`,
  `RAINBAND_INNER_Q`, `RAINBAND_INNER_FULL_Q`,
  `RAINBAND_OUTER_FADE_Q`, `RAINBAND_OUTER_Q`, `EYEWALL_WIDTH_Q`, and
  `rainbandSpiral(azimuth, q, ageH)`. Tasks 5 and 6 consume the constants
  relevant to their shader; the CPU ledger consumes the azimuthal mean because
  it is deliberately angle-averaged.

- [ ] **Step 1: Write the failing test**

Create `test/rainband-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_PITCH,
  RAINBAND_SPIRAL_ROTATION_PER_H,
  rainbandSpiral,
} from '../src/rainband-profile';

describe('rainband profile', () => {
  it('documents the mean the impact ledger actually deposits', () => {
    expect(RAINBAND_AZIMUTHAL_MEAN).toBe(0.68);
  });

  it('keeps the numerically integrated mean equal to the documented constant', () => {
    // The comment in impact.ts drifted from the radar shader for exactly this
    // reason. Integrate rather than trust the constant.
    const samples = 20000;
    let total = 0;
    for (let i = 0; i < samples; i += 1) {
      const azimuth = (i / samples) * 2 * Math.PI - Math.PI;
      total += rainbandSpiral(azimuth, 3.0, 0);
    }
    expect(total / samples).toBeCloseTo(RAINBAND_AZIMUTHAL_MEAN, 3);
  });

  it('never goes negative anywhere on the azimuth', () => {
    for (let i = 0; i <= 720; i += 1) {
      const azimuth = (i / 720) * 2 * Math.PI - Math.PI;
      expect(rainbandSpiral(azimuth, 3.0, 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('pins the four envelope edges the impact ledger already uses', () => {
    expect(RAINBAND_INNER_Q).toBe(1.45);
    expect(RAINBAND_INNER_FULL_Q).toBe(2.0);
    expect(RAINBAND_OUTER_FADE_Q).toBe(6.0);
    expect(RAINBAND_OUTER_Q).toBe(8.0);
    expect(EYEWALL_WIDTH_Q).toBe(0.38);
  });

  it('keeps amplitude and mean consistent so the spiral peaks at 1', () => {
    expect(RAINBAND_AZIMUTHAL_MEAN + RAINBAND_SPIRAL_AMPLITUDE).toBeCloseTo(1, 12);
    expect(RAINBAND_AZIMUTHAL_MEAN - RAINBAND_SPIRAL_AMPLITUDE).toBeCloseTo(0.36, 12);
  });

  it('pins the shared arm geometry and radar rotation rate', () => {
    expect(RAINBAND_SPIRAL_ARMS).toBe(3);
    expect(RAINBAND_SPIRAL_PITCH).toBe(1.35);
    expect(RAINBAND_SPIRAL_ROTATION_PER_H).toBe(0.035);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rainband-profile.test.ts`
Expected: FAIL — cannot resolve `../src/rainband-profile`.

- [ ] **Step 3: Write the implementation**

Create `src/rainband-profile.ts`:

```ts
/**
 * The one rainband spatial contract shared by the three RAIN products:
 * src/render/radar.ts, src/render/rain.ts and src/impact.ts.
 *
 * src/render/env.ts is deliberately NOT a consumer. Its band is cloud
 * morphology, not a quantitative rain product, and it keeps its own
 * development-dependent outer radius and organization-dependent eyewall width.
 *
 * These values are INTERNALLY CONSISTENT, NOT VALIDATED against observed
 * rainfall. They exist so three products stop disagreeing, not because 0.68 is
 * a measured quantity.
 */

/** Azimuthal mean of the spiral. The value the impact ledger deposits. */
export const RAINBAND_AZIMUTHAL_MEAN = 0.68;

/** Spiral amplitude. Mean + amplitude = 1, so the spiral peaks at unity. */
export const RAINBAND_SPIRAL_AMPLITUDE = 0.32;

/** Envelope: ramps in over INNER_Q→INNER_FULL_Q, out over OUTER_FADE_Q→OUTER_Q. */
export const RAINBAND_INNER_Q = 1.45;
export const RAINBAND_INNER_FULL_Q = 2.0;
export const RAINBAND_OUTER_FADE_Q = 6.0;
export const RAINBAND_OUTER_Q = 8.0;

/** Gaussian eyewall half-width in RMW multiples. */
export const EYEWALL_WIDTH_Q = 0.38;

/** Spiral arm count. */
export const RAINBAND_SPIRAL_ARMS = 3;
/** Radial pitch of the arms. */
export const RAINBAND_SPIRAL_PITCH = 1.35;
/** Arm rotation rate, radians per simulated hour. */
export const RAINBAND_SPIRAL_ROTATION_PER_H = 0.035;

/**
 * Azimuthal modulation of the rainband, in [mean - amplitude, mean + amplitude].
 * `q` is the radius in RMW multiples; `ageH` rotates the arms.
 */
export function rainbandSpiral(azimuth: number, q: number, ageH: number): number {
  return (
    RAINBAND_AZIMUTHAL_MEAN +
    RAINBAND_SPIRAL_AMPLITUDE *
      Math.sin(
        RAINBAND_SPIRAL_ARMS * azimuth -
          RAINBAND_SPIRAL_PITCH * q +
          ageH * RAINBAND_SPIRAL_ROTATION_PER_H,
      )
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/rainband-profile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/rainband-profile.ts test/rainband-profile.test.ts
git commit -m "feat: add the shared rainband spatial contract"
```

---

## Task 5: Radar adopts the shared contract

`radar.ts` is the outlier: azimuthal mean 0.54 against the ledger's 0.68, plus a different inner edge (1.4 vs 1.45) and eyewall width (0.34 vs 0.38). This is a display change only — the radar shader feeds no recorded number.

**Files:**
- Modify: `src/render/radar.ts`

**Interfaces:**
- Consumes: the Task 4 constants.
- Produces: nothing new.

- [ ] **Step 1: Add the import**

At the top of `src/render/radar.ts`, after the `TOKENS` import:

```ts
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_PITCH,
  RAINBAND_SPIRAL_ROTATION_PER_H,
} from '../rainband-profile';
```

- [ ] **Step 2: Make the shader source a template so the constants are injected**

The fragment shader is a plain `const FS = /* glsl */ \`...\`` string. Change it to a template interpolating the shared constants — the same technique `tokens.ts` already uses to feed colour uniforms, so the numbers cannot drift.

Replace lines 49-55 (from `float eyewall = ...` through the closing `));` of `spiral`) with:

```glsl
  float eyewall = exp(-pow((q - 1.0) / ${EYEWALL_WIDTH_Q}, 2.0));
  float envelope =
    smoothstep(${RAINBAND_INNER_Q}, ${RAINBAND_INNER_FULL_Q.toFixed(1)}, q) *
    (1.0 - smoothstep(
      ${RAINBAND_OUTER_FADE_Q.toFixed(1)},
      ${RAINBAND_OUTER_Q.toFixed(1)},
      q
    ));
  float azimuth = atan(radial.y, radial.x);
  float spiral = ${RAINBAND_AZIMUTHAL_MEAN} + ${RAINBAND_SPIRAL_AMPLITUDE} * sin(
    ${RAINBAND_SPIRAL_ARMS.toFixed(1)} * azimuth -
      ${RAINBAND_SPIRAL_PITCH} * q +
      u_ageH * ${RAINBAND_SPIRAL_ROTATION_PER_H}
  );
```

Note the `max(0.08, ...)` clamp is dropped: with mean 0.68 and amplitude
0.32 the spiral bottoms out at 0.36. The old 0.54/0.46 expression bottomed at
0.08, so its clamp was mathematically redundant. Keeping an unrelated floor
would obscure the shared mean contract.

GLSL requires a decimal point in float literals. Integral constants use
`.toFixed(1)` in the snippet above; inspect the generated shader and confirm no
interpolated float appears as an integer token.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Verify no recorded output moved**

Run: `npm test && npm run calibrate:check`
Expected: PASS, no diffs. The radar shader feeds no recorded number; a diff here means something else was touched.

- [ ] **Step 5: Rendered check**

Run `npm run dev`, select the simulated rain radar on an active storm, and confirm the bands read as bands — continuous spiral arms, no hard black gaps where the old `max(0.08, …)` floor used to sit.

- [ ] **Step 6: Commit**

```bash
git add src/render/radar.ts
git commit -m "fix: align the radar rainband with the shared 0.68 azimuthal mean"
```

---

## Task 6: Rain shader and impact ledger consume the shared constants

Pure constant extraction. **Every deposited number must be identical afterwards.** This is what stops the three products drifting apart again.

**Files:**
- Modify: `src/render/rain.ts`
- Modify: `src/impact.ts`
- Test: `test/impact.test.ts` (add a regression pin)

**Interfaces:**
- Consumes: the Task 4 constants.
- Produces: nothing new.

- [ ] **Step 1: Write a regression test that pins a deposited value**

`test/impact.test.ts` currently asserts only inequalities and determinism, so it cannot detect a numeric change. Add this test to that file, so the refactor is provably neutral:

```ts
it('deposits an unchanged rain total after the constant extraction', () => {
  const tracker = new ImpactTracker();
  const stationary = storm(22, 60, 80);
  for (let i = 0; i < 24; i++) tracker.record(stationary, 0.25);
  const total = tracker.rainView().mm.reduce((sum, mm) => sum + mm, 0);
  // Pinned before extracting the shared constants; this value must not move.
  expect(total).toBeCloseTo(0, 9);
});
```

This uses the file's existing `ImpactTracker`, the `storm(lat, lon, vKt)` helper
defined at `test/impact.test.ts:37`, and `rainView()` as used at `:121`. No new
fixture is needed.

- [ ] **Step 2: Capture the real pinned value**

The assertion above is deliberately written against `0` so it fails and reports the true total. Read that number from the failure output and substitute it for the `0`. This is the one step where a failing assertion is a measuring device rather than a specification — the value cannot be known without running the current code.

Run: `npx vitest run test/impact.test.ts`
Expected: FAIL — `expected <actual total> to be close to 0`. Substitute `<actual total>`, re-run, expect PASS.

- [ ] **Step 3: Commit the pin before changing anything**

```bash
git add test/impact.test.ts
git commit -m "test: pin the impact ledger rain total before refactoring"
```

- [ ] **Step 4: Point `impact.ts` at the shared constants**

Replace lines 45-47 of `src/impact.ts`:

```ts
/** Rainband spatial envelope bounds in RMW multiples (mirror of rain.ts). */
const BAND_INNER_Q = 1.45;
const BAND_OUTER_Q = 8;
```

with:

```ts
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
} from './rainband-profile';
```

(placing the import with the other imports at the top of the file), then replace lines 249-259:

```ts
          const eyewall = Math.exp(-(((q - 1) / EYEWALL_WIDTH_Q) ** 2));
          const bandEnvelope =
            smoothstep(RAINBAND_INNER_Q, RAINBAND_INNER_FULL_Q, q) *
            (1 - smoothstep(RAINBAND_OUTER_FADE_Q, RAINBAND_OUTER_Q, q));
          const index = row * this.nx + col;
          const onLand = this.land[index] === 1;
          const rateMmH =
            d.eyewallRainMmH * eyewall +
            d.rainbandRainMmH * bandEnvelope * RAINBAND_AZIMUTHAL_MEAN +
            (onLand ? d.orographicRainMmH * bandEnvelope : 0);
```

The old comment "Azimuthal mean of the shader's 0.68+0.32·sin spiral is 0.68" is deleted — it named no shader and was the ambiguity that let radar drift. The constant now carries its own documentation.

Update the remaining `BAND_OUTER_Q` reference at line 224 to `RAINBAND_OUTER_Q`.

- [ ] **Step 5: Point `rain.ts` at the shared constants**

In `src/render/rain.ts`, add the same import (path
`'../rainband-profile'`), including `RAINBAND_SPIRAL_ARMS` and
`RAINBAND_SPIRAL_PITCH` as well as `RAINBAND_SPIRAL_AMPLITUDE`. Convert the
shader string to a template as in Task 5, and replace lines 149-154:

```glsl
  float eyewall = exp(-pow((q - 1.0) / ${EYEWALL_WIDTH_Q}, 2.0));
  float bandEnvelope =
    smoothstep(${RAINBAND_INNER_Q}, ${RAINBAND_INNER_FULL_Q.toFixed(1)}, q) *
    (1.0 - smoothstep(
      ${RAINBAND_OUTER_FADE_Q.toFixed(1)},
      ${RAINBAND_OUTER_Q.toFixed(1)},
      q
    ));
  float azimuth = atan(radial.y, radial.x);
  float spiral = ${RAINBAND_AZIMUTHAL_MEAN} +
    ${RAINBAND_SPIRAL_AMPLITUDE} * sin(
      ${RAINBAND_SPIRAL_ARMS.toFixed(1)} * azimuth -
        ${RAINBAND_SPIRAL_PITCH} * q
    );
  float rainband = bandEnvelope * spiral;
```

The `max(0.18, spiral)` clamp is dropped because the shared spiral minimum is
0.36, so the clamp is unreachable and removing it is numerically neutral. The
land/wadi accumulator intentionally has no age uniform; it uses the same arm
geometry at phase zero, while the radar rotates that geometry with simulation
age. Both retain the same azimuthal mean.

- [ ] **Step 6: Verify nothing moved**

Run: `npm test`
Expected: PASS, **including the Step 2 pin unchanged.** If that pin moved, the extraction changed a number and must be corrected — not re-pinned.

Run: `npm run build && npm run calibrate:check && npm run assets:check`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/impact.ts src/render/rain.ts
git commit -m "refactor: consume the shared rainband contract in rain and impact"
```

---

## Task 7: Tagged ocean profile provenance

A missing or failed `data/ocean.bin` currently yields tier `climatological-subsurface` with `missingSourceFlag: false` while the column is an analytic fabrication. The tier is assigned at `sim.ts:1036`, before the sampler at `:1041` has returned. Provenance must be tagged by whatever actually supplied the data.

**Files:**
- Modify: `src/ocean-profile-sampler.ts`
- Modify: `src/sim.ts:1031-1043`
- Modify: `src/upper-ocean.ts` (`createColumn`)
- Modify: `calibration/hf2a-ocean-reference.mjs:501-522`
- Modify: `test/ocean-profile-sampler.test.ts`
- Modify: `test/physics.test.ts:201`
- Test: `test/upper-ocean.test.ts` (add the defensive downgrade test)
- Verify unchanged pass-throughs: `src/main.ts`, `src/ensemble.worker.ts`,
  `calibration/fidelity.mjs`, `calibration/hf4-verify.mjs`, and
  `calibration/hf6-verify.mjs`
- Generated refresh: `calibration/hf4-verification.json`,
  `calibration/hf4-acceptance.json`,
  `calibration/hf6-sealed-verification.json`, and
  `calibration/hf6-acceptance.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OceanProfileSample { profile: OceanProfile; tier: 'event-analysis' | 'climatological-subsurface'; sourceValidTime?: string }` and `OceanProfileSampler = (lat, lon, monthIndex) => OceanProfileSample | null`.

- [ ] **Step 1: Write the failing tests**

These go in `test/physics.test.ts`, not `test/upper-ocean.test.ts` — the
behaviour under test is the sim engine's tier derivation, and `physics.test.ts`
already has the `createSimEngine` / `env()` / `NO_LAND` / `spawnParams()` /
`DT` helpers (see its usage at `:182-188`). `profileFromSstAndOhc` is exported
from `src/upper-ocean.ts` and supplies a well-formed profile-shaped fixture;
the tests are about tag propagation, not a claim that the fixture is observed.

```ts
describe('ocean provenance tagging', () => {
  const profile = () => profileFromSstAndOhc(28, 60);

  it('reports analytic-fallback and raises the flag when no profile exists', () => {
    // No oceanProfileSampler at all: this is the missing-ocean.bin path.
    const engine = createSimEngine({ env: env({ sstC: 30 }), isLand: NO_LAND });
    engine.spawn(spawnParams());
    engine.tick(DT);
    const { diagnostics } = engine.getState()!;
    expect(diagnostics.oceanInitializationTier).toBe('analytic-fallback');
    expect(diagnostics.oceanMissingSourceFlag).toBe(true);
  });

  it('reports climatological-subsurface when the sampler tags a climatology profile', () => {
    const engine = createSimEngine({
      env: env({ sstC: 30 }),
      isLand: NO_LAND,
      oceanProfileSampler: () => ({
        profile: profile(),
        tier: 'climatological-subsurface' as const,
      }),
    });
    engine.spawn(spawnParams());
    engine.tick(DT);
    const { diagnostics } = engine.getState()!;
    expect(diagnostics.oceanInitializationTier).toBe('climatological-subsurface');
    expect(diagnostics.oceanMissingSourceFlag).toBe(false);
  });

  it('reports event-analysis only when the sampler says so', () => {
    const engine = createSimEngine({
      env: env({ sstC: 30 }),
      isLand: NO_LAND,
      oceanProfileSampler: () => ({
        profile: profile(),
        tier: 'event-analysis' as const,
      }),
    });
    engine.spawn(spawnParams());
    engine.tick(DT);
    expect(engine.getState()!.diagnostics.oceanInitializationTier).toBe('event-analysis');
  });
});
```

Add `profileFromSstAndOhc` to the existing `../src/upper-ocean` import in that file.

Also add this direct test to `test/upper-ocean.test.ts`, covering the Step 5 downgrade at the class level rather than through the engine:

```ts
it('downgrades to analytic-fallback when the background supplies no profile', () => {
  const ocean = new SparseUpperOcean();
  ocean.reset(() => ({
    sstC: 29.5,
    ohcKjCm2: 65,
    // A caller claiming climatology while supplying no profile must not be believed.
    initializationTier: 'climatological-subsurface',
    sourceValidTime: '2020-06-01T00:00:00Z',
  }));
  const diagnostics = ocean.sample(20, 60, 0);
  expect(diagnostics.initializationTier).toBe('analytic-fallback');
  expect(diagnostics.sourceValidTime).toBeNull();
});
```

Update `test/ocean-profile-sampler.test.ts` for the source-breaking return
shape. Wherever it currently treats `sampleOceanProfileBin(...)` as a bare
profile, assert the tag and then unwrap:

```ts
const sample = sampleOceanProfileBin(loadOcean(), 19, 62, 5);
expect(sample).not.toBeNull();
expect(sample!.tier).toBe('climatological-subsurface');
const profile = sample!.profile;
```

The null-path assertion remains unchanged. This test is part of the migration,
not optional cleanup: otherwise `npm run build` fails on `.temperatureC` and
`.salinityPsu` accesses against `OceanProfileSample`.

**Expected side effect, not a regression:** the file's existing
`configuredOcean()` helper (`test/upper-ocean.test.ts:45-53`) also resets with
`'climatological-subsurface'` and no profile, so its columns now report
`analytic-fallback`. No test should assert the old tier and no sealed numeric
field records `initializationTier`; the runtime source-hash refresh required by
this code change is handled explicitly in Steps 9–10.

- [ ] **Step 2: Run to verify they fail**

Run:
`npx vitest run test/upper-ocean.test.ts test/physics.test.ts test/ocean-profile-sampler.test.ts`

Expected: the new provenance tests fail before implementation. The existing
profile-sampler shape tests may also fail until Step 3 is complete.

- [ ] **Step 3: Introduce the tagged type**

In `src/ocean-profile-sampler.ts`, replace lines 11-15:

```ts
/** A profile plus the provenance of whatever actually supplied it. */
export interface OceanProfileSample {
  profile: OceanProfile;
  tier: 'event-analysis' | 'climatological-subsurface';
  sourceValidTime?: string;
}

/**
 * `null` means no profile was available. That is the ONLY state from which
 * 'analytic-fallback' may be inferred — a bare profile carries no provenance,
 * so the tier must travel with the data that justifies it.
 */
export type OceanProfileSampler = (
  lat: number,
  lon: number,
  monthIndex: number,
) => OceanProfileSample | null;
```

Change `sampleOceanProfileBin` to return `OceanProfileSample | null`, wrapping its result as `{ profile, tier: 'climatological-subsurface' }`, and `sampleEventOceanProfileBin` to wrap as `{ profile, tier: 'event-analysis' }`. `sampleProfileLayers` keeps returning a bare `OceanProfile | null`.

Audit every caller before proceeding:

- `main.ts` and `ensemble.worker.ts` are typed pass-throughs and should return
  the tagged object unchanged.
- `ensemble.ts`, `hindcast-benchmark.ts`, and `sim.ts` carry the typed sampler.
- `calibration/fidelity.mjs`, `hf4-verify.mjs`, and `hf6-verify.mjs` are untyped
  pass-throughs. Their coalescing expressions preserve the returned tag, but
  their verification commands must run below.
- `calibration/hf2a-ocean-reference.mjs` directly builds an
  `OceanBackgroundSample` and must be unwrapped explicitly in Step 7.

- [ ] **Step 4: Derive the tier from the sample in `sim.ts`**

Replace lines 1031-1043 of `src/sim.ts`:

```ts
    upperOcean.reset((oceanLat, oceanLon) => {
      const sample = sampleEnv(oceanLat, oceanLon, initialTFrac);
      // Sample FIRST, then derive provenance from what came back. Assigning the
      // tier before the sampler returns is how a missing ocean.bin used to be
      // labelled as WOA23 climatology.
      const profileSample = deps.oceanProfileSampler?.(
        oceanLat,
        oceanLon,
        monthIndex,
      );
      return {
        sstC: sample.sstC,
        ohcKjCm2: sample.ohcKjCm2,
        initializationTier: profileSample?.tier ?? 'analytic-fallback',
        sourceValidTime: profileSample?.sourceValidTime,
        profile: profileSample?.profile,
      };
    });
```

The `samplingMode` lookup at `:1028-1030` becomes unused here — remove it if nothing else in scope references it, otherwise leave it.

- [ ] **Step 5: Make `createColumn` enforce the downgrade**

In `src/upper-ocean.ts`, in `createColumn`, replace the
`initializationTier`/`sourceValidTime` lines inside the `background` object with
a form that downgrades whenever no profile arrived, so no caller can claim
provenance or retain a source timestamp for data it does not have:

```ts
      initializationTier: sampled.profile
        ? (sampled.initializationTier ?? 'analytic-fallback')
        : 'analytic-fallback',
      sourceValidTime: sampled.profile
        ? sampled.sourceValidTime
        : undefined,
```

- [ ] **Step 6: Verify the typed browser and worker wiring**

In `src/main.ts:488-489` and `src/ensemble.worker.ts:63-64` the call signature
is unchanged: `sampleOceanProfileBin` now returns the tagged object and
`sim.ts` consumes it directly. No edit is required unless type-checking exposes
one. Verify with `npm run build`, not by eye.

- [ ] **Step 7: Migrate the untyped gate runner**

`calibration/hf2a-ocean-reference.mjs` is `.mjs` — **TypeScript will not catch this caller.** Replace lines 501-522 so the tag comes from the branch that actually returned data:

```js
    const eventSampleRaw = eventProfile
      ? sampleEventOceanProfileBin(
          eventOceanProfiles,
          lat,
          lon,
          eventProfile.layerIndex,
        )
      : null;
    const eventSample = eventSampleRaw && eventProfile
      ? { ...eventSampleRaw, sourceValidTime: eventProfile.sourceMonth }
      : null;
    const climatologySample = sampleOceanProfileBin(
      oceanProfiles,
      lat,
      lon,
      scenario.monthIndex,
    );
    const selectedSample = eventSample ?? climatologySample;
    return {
      sstC: pixel?.backgroundSstC ?? sampled.sstC,
      ohcKjCm2: sampled.ohcKjCm2,
      // Every provenance field comes from the same branch that supplied data.
      initializationTier: selectedSample?.tier ?? 'analytic-fallback',
      sourceValidTime: selectedSample?.sourceValidTime,
      profile: selectedSample?.profile,
    };
```

Do not use `scenario.hindcast.startIso` as a climatological ocean valid time.
It is the storm initialization time, not the WOA23 source time.

- [ ] **Step 8: Flip the test that encoded the bug**

In `test/physics.test.ts:201`, replace:

```ts
    expect(diagnostics.oceanInitializationTier).toBe('climatological-subsurface');
```

with:

```ts
    // This engine is built with no oceanProfileSampler (see the createSimEngine
    // call above), so its column is an analytic fabrication. The previous
    // expectation of 'climatological-subsurface' encoded the provenance bug.
    expect(diagnostics.oceanInitializationTier).toBe('analytic-fallback');
```

- [ ] **Step 9: Verify numeric neutrality and identify expected manifest drift**

Run:
`npx vitest run test/upper-ocean.test.ts test/physics.test.ts test/ocean-profile-sampler.test.ts`
Expected: PASS.

Run: `npm test && npm run build`
Expected: PASS.

Run: `npm run hf2a:ocean:reference:check && npm run hf2a:ocean:gate:check`
Expected: PASS with identical numeric output. The committed bins supply real
event profiles, so the numbers must not move. If they do, stop and report the
diff; do not update an expected value.

Run:

```bash
npm run calibrate:check
npm run hf4:verify:check
npm run hf6:verify:check
```

`calibrate:check` must pass. The two sealed verification checks are expected to
fail on runtime source manifests only because Task 7 changed `sim.ts` and
`upper-ocean.ts`. If either reports a numeric section difference, stop.

- [ ] **Step 10: Refresh hashed reproduction artefacts without changing science**

> **HUMAN APPROVAL GATE — decided 2026-07-27, do not automate.**
> An implementing agent MUST NOT run the four regeneration commands below.
> Halt here, show the repository owner the exact diff the refresh would
> produce, and wait for explicit authorization.
>
> Reason: this is the only step in the plan that rewrites a sealed artefact.
> CLAUDE.md states that regenerating a frozen artefact re-opens its seal, and
> the refresh is legitimate *only* because the diff is confined to source
> hashes. That distinction is invisible to a mechanical check — a genuine
> numeric change could be laundered through a step labelled "hash-only". The
> owner authorizes this personally, or it does not happen.

Once authorized, regenerate through the scripts — never hand-edit a hash:

```bash
npm run hf4:verify
npm run hf4:gate
npm run hf6:verify
npm run hf6:gate
```

Inspect the JSON diff before continuing. The permitted changes are:

- HF-4 verification: runtime source hashes for `sim.ts` and
  `upper-ocean.ts`; HF-4 acceptance: the verification hash only.
- HF-6 sealed verification: `runtimeSimSha256` and
  `runtimeUpperOceanSha256`; HF-6 acceptance: `verificationSha256` and
  `hf4Sha256` only. The latter changes because HF-6 correctly binds the refreshed
  HF-4 acceptance artefact.
- `docs/hf6-scorecard.md`: no diff.

Every metric, case, threshold, status, decision, and rejected verdict must be
unchanged. Any additional diff is a stop condition.

Now run:

```bash
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
```

Expected: all PASS. This restores reproducibility of the rejected results; it
does not reopen or promote either scientific gate.

- [ ] **Step 11: Commit**

```bash
git add src/ocean-profile-sampler.ts src/sim.ts src/upper-ocean.ts \
  calibration/hf2a-ocean-reference.mjs \
  calibration/hf4-verification.json calibration/hf4-acceptance.json \
  calibration/hf6-sealed-verification.json calibration/hf6-acceptance.json \
  test/ocean-profile-sampler.test.ts test/upper-ocean.test.ts test/physics.test.ts
git commit -m "fix: derive ocean provenance from the sampled profile"
```

---

## Task 8: Surface the degraded data state

`missingSourceFlag` is now correct but only reaches exports. A user running on a fabricated ocean column should be able to see that.

**Files:**
- Modify: `src/product-identity.ts`
- Modify: `src/main.ts`
- Modify: `index.html`
- Modify: `src/style.css`
- Test: `test/product-identity.test.ts`

**Interfaces:**
- Consumes: `oceanMissingSourceFlag` from the Task 7 diagnostics.
- Produces: a `degradedInputs: readonly string[]` field on `ProductIdentity`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildProductIdentity, type ProductIdentityInput } from '../src/product-identity';

// Matches ProductIdentityInput at src/product-identity.ts:14-23.
const BASE: ProductIdentityInput = {
  runMode: 'hindcast',
  ageH: 12,
  scenarioLabel: null,
  scenarioStartIso: null,
  hindcastStartIso: '2007-06-01T00:00:00Z',
  observation: null,
};

describe('degraded input reporting', () => {
  it('names the degraded subsurface when the ocean profile is absent', () => {
    const identity = buildProductIdentity({ ...BASE, oceanMissingSourceFlag: true });
    expect(identity.degradedInputs).toContain('subsurface ocean: analytic fallback');
  });

  it('reports no degraded inputs when every source is present', () => {
    const identity = buildProductIdentity({ ...BASE, oceanMissingSourceFlag: false });
    expect(identity.degradedInputs).toEqual([]);
  });
});
```

`EventRunMode` is `'hindcast' | 'counterfactual'`
(`src/scenarios.ts:32`). `buildProductIdentity` currently takes the input object
as its only parameter.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/product-identity.test.ts`
Expected: FAIL — `degradedInputs` undefined.

- [ ] **Step 3: Implement**

Add `oceanMissingSourceFlag?: boolean` to `ProductIdentityInput`, add `degradedInputs: readonly string[]` to `ProductIdentity`, and populate it in `buildProductIdentity`:

```ts
  const degradedInputs: string[] = [];
  if (input.oceanMissingSourceFlag) {
    degradedInputs.push('subsurface ocean: analytic fallback');
  }
```

Return it from every branch of `buildProductIdentity`; the required interface
field makes a missed branch a type error.

- [ ] **Step 4: Wire the live diagnostic into the identity builder**

In `refreshProductIdentity` in `src/main.ts`, add the diagnostic to the existing
input object:

```ts
    oceanMissingSourceFlag:
      storm?.diagnostics.oceanMissingSourceFlag ?? false,
```

The other `buildProductIdentity` calls are for acknowledgement/export wording
and may omit the optional flag. The permanent identity bar is the user-visible
degradation surface.

- [ ] **Step 5: Add and bind the exact chip anchor**

In `index.html`, immediately after `#product-source-state`, add:

```html
<span id="product-degraded-state" hidden></span>
```

In `src/main.ts`, bind it beside the other product identity elements:

```ts
const productDegradedStateEl = must(
  document.getElementById('product-degraded-state'),
  '#product-degraded-state',
);
```

At the end of `refreshProductIdentity`, render the state:

```ts
  const degraded = identity.degradedInputs;
  const hasDegradedInputs = degraded.length > 0;
  productIdentityEl.dataset.degraded = hasDegradedInputs ? 'true' : 'false';
  productDegradedStateEl.hidden = !hasDegradedInputs;
  productDegradedStateEl.textContent = hasDegradedInputs
    ? `DEGRADED INPUT · ${degraded.join(' · ')}`
    : '';
```

- [ ] **Step 6: Style the visible state using existing tokens**

Add `#product-degraded-state` to the product-identity grid using only injected
token variables:

```css
#app #product-degraded-state {
  grid-column: 1 / -1;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.035em;
  line-height: 1.25;
}
```

Do not add raw RGB/RGBA values.

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: PASS.

Run `npm run dev` in a separate terminal. Confirm
`git status --short public/data/ocean.bin` is empty, then use this PowerShell
test so restoration is guaranteed:

```powershell
$oceanPath = (Resolve-Path 'public/data/ocean.bin').Path
$backupPath = "$oceanPath.provenance-test"
if (Test-Path -LiteralPath $backupPath) {
  throw "temporary backup already exists: $backupPath"
}
Move-Item -LiteralPath $oceanPath -Destination $backupPath
try {
  Read-Host 'Reload, spawn a storm, confirm the DEGRADED INPUT chip, then press Enter'
} finally {
  Move-Item -LiteralPath $backupPath -Destination $oceanPath
}
if (-not (Test-Path -LiteralPath $oceanPath)) {
  throw "ocean.bin was not restored"
}
```

Reload again and confirm the chip disappears. Do not use `git checkout --` as
cleanup. `npm run assets:check` must be clean because `ocean.bin` is a static
replay asset.

- [ ] **Step 8: Commit**

```bash
git add src/product-identity.ts src/main.ts src/style.css index.html \
  test/product-identity.test.ts
git commit -m "feat: surface degraded data inputs in the product identity bar"
```

---

## Task 9: Documentation and final verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/oman-dgm-operational-readiness-audit.md`

- [ ] **Step 1: Record the new modules in the architecture map**

Add `src/render/storm-radii.ts` and `src/rainband-profile.ts` to `docs/architecture.md`, each with one line on its responsibility and its consumers.

- [ ] **Step 2: Record the scope boundary honestly**

In the audit addendum, note which findings are now closed and which are not.
**A1 fixed the overcast, cirrus, canopy offset and texture; it did not stop the
rainband component of the cloud shield contracting.** Say that plainly rather
than marking the finding or the entire cloud-shield shrinkage resolved. Record
the static-manifest exclusions too: live and observed satellite assets are
validated by their cycle/provider manifests rather than frozen to committed
bytes.

- [ ] **Step 3: Add the new invariants to CLAUDE.md**

Two rules a future session would otherwise break:

```markdown
- `src/rainband-profile.ts` is the ONE rainband spatial contract for the three
  RAIN products (`render/radar.ts`, `render/rain.ts`, `impact.ts`).
  `render/env.ts` is deliberately NOT a consumer — its band is cloud
  morphology, not a rain product. The mean is internally consistent, NOT
  validated against observed rainfall.
- `rCanopy` in `src/render/storm-radii.ts` has NO `rMax` floor, deliberately.
  Because `structure.ts` clamps `rmwKm` to [12,95] and `outerSizeKm` to
  [60,420], such a floor binds for broad weak storms and re-couples the canopy
  to the contracting core — the exact bug it appears to prevent.
```

- [ ] **Step 4: Index the new docs**

Add this plan to the `docs/superpowers/` table in `docs/README.md`.

- [ ] **Step 5: Full gate run**

```bash
npm test
npm run build
npm run calibrate:check
npm run assets:check
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run hf2a:ocean:reference:check
npm run hf2a:ocean:gate:check
```

Expected: all PASS. Report any failure verbatim rather than summarizing it.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: record the layer-integrity fixes and their scope boundary"
```

---

## Verification Summary

| Workstream | Spec requirement | Task |
|---|---|---|
| E | SHA-256 manifest over every static replay file in `public/data/` | 1 |
| E | Explicit tested exclusions for volatile `live/` and `satellite/` namespaces | 1 |
| E | Manifest outside `public/data/`, recursive, canonical ordering, Windows-safe CLI | 1 |
| A1 | `stormRenderRadii` with no `rMax` floor, monotone in `outerSizeKm` | 2 |
| A1 | Exact quotients, reference render unchanged | 2, 3 |
| A1 | Four coordinates; band pitch on `bandQ` | 3 |
| A1 | Rendered QA at both clamp corners | 3 |
| A1 | Scope boundary documented, not claimed as a full fix | 9 |
| A2 | Shared contract, four edges, mean 0.68 | 4 |
| A2 | `radar.ts` adopts; `env.ts` deliberately excluded | 5, 4 |
| A2 | `rain.ts`/`impact.ts` numerically neutral | 6 |
| A3 | `OceanProfileSample \| null` tagged type | 7 |
| A3 | Untyped `.mjs` caller migrated by hand | 7 |
| A3 | Three branch tests; `physics.test.ts` flipped | 7 |
| A3 | All typed, untyped, and direct-shape sampler consumers migrated or checked | 7 |
| A3 | Profile, tier, and source time selected from one successful branch | 7 |
| A3 | HF-2A numeric check unchanged; HF-4/HF-6 hash-only artefact refresh verified | 7 |
| A3 | Visible degraded-data indication | 8 |
