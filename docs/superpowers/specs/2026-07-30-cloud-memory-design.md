# Cloud memory: stateful advected debris field for the simulated cloud layer

**Date:** 2026-07-30
**Status:** DRAFT — pending independent gate review
**Scope:** Render-only. `src/render/` plus a read-only tape accessor and its
wiring; focused tests; the one permitted morphology re-capture. No sim,
physics, replay-tape recording, calibration-acceptance, or data changes.

## Problem

Flow-map motion (PR #36) made the simulated clouds circulate, but the field's
*composition* never changes: the same noise advects in a bounded sawtooth, no
cloud is ever born or dies, and a moving storm leaves no trace. Real IR shows
the opposite signature everywhere: convection blooms, decays downstream, and a
departing or dying storm leaves a decaying debris deck along its track for
many hours. This is approach C from
`docs/superpowers/specs/2026-07-29-simulated-ir-cloud-motion-design.md`,
deferred there because naive render state breaks the flight-recorder
scrub/replay contract. The pickup condition named there — flow-map motion has
shipped and the result still lacks life — is met.

## Why it was deferred, and the resolution

The flight recorder rebuilds a scrubbed frame from copied per-tick frames and
never re-drives the engine. A persistent ping-pong texture advanced once per
tick is therefore unreconstructable on scrub without replaying every step
since birth — unbounded in storm age. The compatible path named in the prior
spec is bounded reconstruction, and this design makes it the *definition* of
the state rather than a recovery mechanism:

> The memory state at boundary k is N bounded advection steps from a fixed
> deterministic init, computed identically whether playback arrived at k by
> playing forward or by scrubbing.

There is no incremental reuse across boundaries and no persistent evolving
state — nothing exists that *could* diverge from its reconstruction.

## Rejected alternatives

- **Incremental ping-pong from birth** (the classic form): cheapest per frame,
  but scrub replays from birth — unbounded in age, a rebuild per scrubber-drag
  position, and byte-identity is maintained rather than structural. This is
  the exact objection that deferred approach C; rejected again.
- **Stateless painted wake** (trailing lobes along recent track points passed
  as uniforms, hashed cell pulses for lifecycle): smallest diff, but no real
  advection — debris would not stream with the flow — and it half-duplicates
  the shipped overshooting-top pulses. Rejected as not answering the gap.

## Design

### 1. State definition and determinism contract

- **Field:** two channels — cloud density and debris age — in an earth-fixed
  texture over the same clip domain env renders. Fixed RGBA8: `makeRenderTarget`
  in gl-utils.ts prefers RGBA16F when `EXT_color_buffer_float` is present, so
  it gains a force-RGBA8 option for these targets (fixed format keeps the
  encoding identical across devices and cheap on mobile). Both channels are
  normalized [0,1]: density directly; debris age as `ageN`, incremented by
  `dt / W` per step and clamped — raw hours would saturate an 8-bit channel
  after one step — and decoded by ×W at display. Resolution is a render trait
  set per performance tier (named constants, `CLOUD_MEMORY_SIZE_DETAIL = 512`,
  `CLOUD_MEMORY_SIZE_MOBILE = 256`), like dprCap: per-device, never read by
  physics or recorded output.
- **Timeline:** memory boundaries at integer multiples of
  `CLOUD_MEMORY_DT_H = 1` sim-hour. Window `CLOUD_MEMORY_WINDOW_H = 18`
  sim-hours → `N = 18` update steps per boundary state.
- **Definition:** `state(k)` = start from a **zero field** at boundary
  `k − N`, apply N update steps. The step from boundary `t` to `t + 1` reads
  storm history (center, intensity, structure) from the tape frame at time
  `t`, and injects source for boundary `t` — so `state(k)` consumes tape
  frames at `k − N … k − 1` **only**. This is a causality seal: the display
  pair (state(k), state(k+1)) at display age `a ∈ [k, k+1)` needs frames no
  later than `k`, which exist the moment `a ≥ k`. No lookup can ever run past
  the tape, so there is no clamp; a missing frame is a thrown error, never a
  fallback. The cache key (run identity, k, tier, reduced-motion flag) is
  therefore complete — every other input is a frozen past frame. Zero init
  (not seeded
  noise) removes any init-noise mismatch between adjacent boundary states:
  their *source inputs* over the shared window are identical, and they differ
  by the oldest/newest injection plus one extra advect/decay step applied to
  every retained contribution. That per-step evolution is small by
  construction (bounded displacement, `exp(−1/6)` decay), and the display
  crossfade carries the remaining continuity. The seed still enters through
  `u_cloudNoise` source texturing.
- **Truncation is definitional, not approximate.** A parcel lives at most W
  sim-hours by definition. `W / τ ≥ 3` (see decay below) so the oldest parcel
  leaves the window at ≤ ~5 % amplitude; the display crossfade absorbs the
  residual at the wake tail. Tail-pop is a named QA watch item.
- **Storm edges:** boundaries before spawn contribute nothing (window clamps
  to spawn). Sim time stops at death — `sim.ts` `tick()` returns immediately
  once the storm is not alive — so no post-death timeline exists on the tape
  or anywhere else. The final frame, wake included, freezes on screen and is
  the last replayable frame; post-death decay is explicitly out of scope for
  this render-only change. A run-identity change (new seed/spawn/environment)
  invalidates all cached states, matching `interpolatedCloudAgeH`'s respawn
  snap semantics.
- **Caching:** each boundary state is cached **individually** per index k in
  a small LRU (k and k+1 for playback, plus recently scrubbed entries); a
  separate packing blit — one memory-resolution pass, two taps — combines
  the cached states into the RG/BA display texture once per boundary
  crossing and after any cold scrub. Individual caching means advancing
  k → k+1 recomputes exactly one new state, and a cold scrub recomputes at
  most two. The cache is a pure memoization of the definition — eviction can
  only cost recompute time, never change pixels.
- **Determinism boundary:** same device, same viewport/tier → byte-identical
  pixels for the same (seed, replay frame), exactly the shipped browser-QA
  contract. Cross-device pixel identity is not claimed (it never was for any
  GL output). No wall-clock, frame-rate, or device input reaches the state
  definition; the only device trait is texture resolution, which is a render
  trait like dprCap.

### 2. Update step (offscreen pass, own program)

One small fragment program ping-pongs two work textures; per step, per texel:

1. **Advect** — semi-Lagrangian single-tap backtrace: sample the previous
   step at `pos − v · dt`. The velocity field is the *display* flow, for
   coherence with the shipped motion layer, and has exactly two terms:
   - Capped `cloudOmega` rotation (same GLSL/CPU mirror as cloud-motion.ts)
     around that boundary's storm center, **under the same reduced-motion
     policy as the display path**: with reduced motion active the update pass
     uses `LEGACY_CLOUD_ROTATION_RAD_PER_H` instead of the capped Holland
     rate, exactly as env's animGate does. The reduced-motion flag is thereby
     a state-definition input — a render trait like tier — and toggling it
     invalidates the state cache.
   - A **new** radial outflow term (nothing shipped provides one — the
     decorative field's drift is shear-aligned, a recorded deviation from the
     prior spec): magnitude `CLOUD_MEMORY_OUTFLOW_KMH` (~12, named constant
     with WHY), ramping 0→full over `1.2×RMW → 2.5×RMW` via smoothstep,
     constant beyond. Debris therefore spreads outward and is left behind by
     the moving source; no steering term — translation is implicit in the
     earth-fixed frame.
   The rotation term is additionally bounded by a **linear speed cap**,
   `CLOUD_MEMORY_MAX_ADVECT_KMH = 30` (named, with WHY): the angular cap
   alone still permits ~57 km/h at 190 km radius and ~100 km/h far-field for
   strong storms, where the Holland profile is gradient wind — but debris
   physically rides the ambient flow, tens of km/h, not the gradient wind.
   The cap is therefore the honest debris model *and* the numerical bound:
   worst-case backtrace ≈ `√(30² + 12²) ≈ 32 km/h` ≈ **13 texels** per step
   at 512² (2.6 km/texel). Semi-Lagrangian backtracing is unconditionally
   stable at any displacement; the cost of a long tap is smearing, not
   blow-up. If browser QA shows swirl artifacts near large-RMW cores, a
   named substep constant (`CLOUD_MEMORY_SUBSTEPS`) divides the step — it is
   part of the state definition, so changing it is a visual retune, never a
   replay break.
2. **Source** — convection injected for the step's boundary `t` from the
   tape frame at `t`: an analytic envelope from vKt-derived development and
   the frame's `structure` radii (rmw, outer size), textured by seeded
   `u_cloudNoise` cells so injection is patchy, not a stamp.
3. **Decay** — after injection: density × `exp(−dt / CLOUD_MEMORY_DECAY_TAU_H)`,
   `τ = 6` sim-hours. Source-before-decay is deliberate: every contribution,
   the newest included, decays at least once, and the oldest injection in
   the window decays exactly N times. Because the state is stored RGBA8, the
   **tail contract is defined in encoded space**: a CPU mirror runs the
   byte-quantized recurrence (per-step ×`exp(−1/6)`, round to nearest of
   255ths) for N steps from a unit injection and asserts the final byte
   ≤ 13 (13/255 ≈ 5.1 %; the unquantized `exp(−3) ≈ 4.98 %` encodes to that
   same byte). The relation test pins this recurrence, not the float
   exponent, so format, order, or constant changes cannot silently pass in
   float while failing in the rendered state.

Sealed combine rules (each a formula, not a choice left to the implementer):

- Density after source: `min(1, advectedDensity + sourceDensity)` — additive
  convection with saturation; a sustained CDO core saturating to 1.0 is the
  intended look.
- Debris age after source:
  `advectedAge × advectedDensity / max(advectedDensity + sourceDensity, ε)` —
  density-weighted, so fresh convection smoothly rejuvenates the column
  toward age 0 with no threshold pop.
- Age then increments by `dt / W` (clamped to 1) where the decayed density's
  **stored byte after quantization** is ≥ 1; where the stored byte is 0, age
  resets to 0 — no cloud, no age. The test reads the encoded value, never the
  pre-quantization float (round-to-nearest can encode raw `0.5/255` as
  byte 1, so the float and byte tests genuinely differ).

The update program binds exactly **2 samplers** (previous state,
`u_cloudNoise`) — its own budget, independent of env's. All constants are
named GLSL/TS constants with WHY comments; CPU mirrors are vitest-pinned.

### 3. Display integration (env program)

- **Packing:** `state(k)` in RG, `state(k+1)` in BA of one RGBA texture, so
  env reads both boundary states in **one** `texture()` call and crossfades
  with `frac(u_cloudAgeH / CLOUD_MEMORY_DT_H)` — consuming the *same*
  `interpolatedCloudAgeH` value env already computes for `u_cloudAgeH`, one
  age source, no second path. In replay both navigation entry points pin
  alpha to 0 and prev to the tape's previous frame, so `u_cloudAgeH` — and
  therefore the boundary pair and fraction — is a pure function of the
  selected frame index. Pause freezes it; the same replay frame reproduces
  the same pixels. One shipped characteristic is inherited, not changed:
  paused-live and replay show slightly different cloud ages for the same tick
  (the live path's prev carries the *current* `ageH`, the replay path's prev
  is the tape's previous frame, and alpha is 0 in both) — so determinism and
  equivalence claims are **within-mode**, never across paused-live vs replay.
- **Sampler budget:** the env program currently uses all 16 guaranteed
  fragment texture units. The OHC month pair (`u_ohc`/`u_ohcNext`, blended
  once with `u_planeBlend`) is pre-blended into a single texture by a tiny
  per-frame blit pass sized from the loaded texture's own header dims (the
  runtime hardcodes no grid geometry). Net: 16 − 2 + 1 (ohcBlend) + 1
  (`u_cloudMemory`) = **16**. No unit over budget; the blit's cost is covered
  by the perf gate, not assumed.
- **Composition:** the shipped flow-map macro/fine advection stays. Memory
  contributes two things:
  - *Evolution:* memory density applies an enhancement-only gain to the macro
    decorative amplitude (`1.0 + CLOUD_MEMORY_MACRO_GAIN × smoothstep(density)`,
    named constant), so composition visibly blooms where convection has been
    active. Gain at zero density is exactly 1.0: an empty field — spawn, or any
    state before memory accumulates — reproduces the shipped look pixel-for-
    pixel apart from the debris component, which is likewise zero there.
  - *Debris:* a new `debrisCloud` component enters the presence ladder as the
    **warmest** storm component (decaying stratiform debris, ~10–15 °C warmer
    than fresh rainbands, graded by debris age; gray, flat in visible
    palette). Cold fresh components still win where they overlap — the
    ladder's cold-dominates rule is unchanged.
- **Relief untouched:** visible-palette relief keeps its shipped +2-tap
  budget and does not shade debris — flat stratiform debris is physically
  reasonable and keeps that budget sealed.
- **Coverage:** everywhere the storm cloud field renders — IR palettes and
  the faint cloud context under terrain/wind/accum/rain-plate modes — on both
  tiers, so the wake never vanishes on a layer switch.
- **Reduced motion:** the memory field stays active, but its update-pass
  rotation follows the same gate as the display path (legacy slow rate — see
  the advection term above), so the wake neither rotates fast internally nor
  adds pulsing. What remains evolves at the storm-translation speed class,
  which the shipped reduced-motion contract already permits for morphology.
  The existing animGate behavior of other components is unchanged.
- **Rainband contract:** `precipitatingCloud` support stays on
  `rainCenterClip` / `RAINBAND_SPIRAL_ROTATION_PER_H`, untouched. Memory is
  decorative morphology only and must not move the minimum rain-support floor.

### 4. Wiring

- `src/render/cloud-memory.ts` (new): pass orchestration, constants, CPU
  mirrors, GLSL strings — the cloud-motion.ts pattern.
- The render loop ensures `state(k)`/`state(k+1)` exist before the env draw.
  Storm history comes through a read-only accessor over the flight-recorder
  tape with nearest-frame-at-or-before-age semantics. Frames always advance
  `ageH` while the storm lives (dedup requires equal `ageH`, which only ever
  matches on identical post-death records), so 1-hour boundaries land exactly
  on tick ages. Because the causality seal (§1) bounds every lookup to
  frames at `k − N … k − 1`, a lookup can never run past the tape; a missing
  frame throws — there is no clamp and no fallback. The accessor observes;
  the recorder's recording path is untouched.
- Expected product diff: `src/render/cloud-memory.ts`, `src/render/env.ts`,
  `src/render/cloud-motion.ts` (shared constants if needed),
  `src/render/gl-utils.ts` (force-RGBA8 option on `makeRenderTarget`),
  `src/render/index.ts`, `src/main.ts` (accessor wiring),
  `src/flight-recorder.ts` (read-only accessor only),
  `test/cloud-memory.test.ts`, the regenerated morphology artefacts, this
  spec, and the plan. Anything else in the diff is a hard failure.

### 5. Cost model

- Steady-state playback: one N-pass recompute per boundary crossing (~3/s at
  normal speed, 1/s slow-mo; each pass ≤ 512² with ~4 taps) plus one
  two-tap packing blit per boundary crossing and the per-frame OHC blit.
  Display adds +1 texture lookup per env fragment.
- Cold scrub: one bounded recompute per landed boundary; budget under one
  desktop frame (16.7 ms) on the detail tier, measured not assumed.
  Scrubber dragging hits the per-k cache.

## Product honesty

The layer stays "simulated satellite infrared" / simulated cloud context;
debris is decorative morphology under the existing qualitative-proxy claim
boundary. No new product claims, no label changes, no probability framing.

## Verification

- **Vitest (no GL harness; GLSL is browser-verified):** boundary index/frac
  math from cloudAgeH; window clamp at spawn; the causality seal — the CPU
  boundary enumerator for `state(k)` must request tape frames at
  `k − N … k − 1` only, with a missing frame throwing, never falling back;
  normalized debris-age encode/decode round-trip; the linear advection speed
  cap; velocity mirror reuse of `cloudAngularRateRadPerH` including the
  reduced-motion legacy-rate branch; cache keying, run-identity
  invalidation, and reduced-motion-toggle invalidation; OHC pre-blend
  selection logic; the sealed combine rules (density additive-saturating,
  density-weighted age, encoded-zero age reset) as CPU mirrors; the tail
  contract pinned as the byte-quantized recurrence test — final byte ≤ 13
  after N steps from a unit injection under the Advect→Source→Decay order —
  so retuning a constant, reordering steps, or changing the storage format
  cannot silently pass in float while failing in the rendered state.
- **Browser QA (Playwright; console/WebGL errors are failures):**
  1. *Scrub equivalence (the new critical check), within replay mode:*
     scrub to a frame, capture; scrub far away (forcing cold recomputes);
     scrub back to the same frame, capture → byte-identical. Repeat across a
     memory-boundary crossing. Separately, a paused live frame captured twice
     is byte-identical. No cross-mode (paused-live vs replay) equality is
     claimed — the shipped `u_cloudAgeH` paths differ there by construction.
  2. Two separate within-mode repeat checks (shipped checks, now exercising
     the memory path): a paused live frame captured twice → byte-identical;
     the same replay frame selected twice → byte-identical. These are
     independent checks; no equality across the two modes is asserted.
  3. Wake: a moving mature storm shows a decaying debris deck along its
     track; after death the wake remains visible in the frozen final frame
     (sim time stops at death — there is no post-death decay to observe); no
     tail-pop at
     boundary crossings (two captures 0.15 s apart straddling a boundary).
  4. Layer-switch: wake present in IR (all three palettes) and in the faint
     cloud context modes.
  5. Reduced motion: memory field present; no new fast animation (two
     captures 2 s apart differ only at storm-translation scale).
  6. Rain alignment: radar vs IR at weak, mature, sheared states — the
     precipitating-cloud floor has not moved.
  7. OHC pre-blend equivalence: baseline vs candidate captures with
     `u_planeBlend` at 0, 0.5, and 1 — the pre-blended path must match the
     direct two-sampler mix within quantization (the blend intermediate is
     8-bit; a visible difference is a failure).
  8. Format assertion: a one-time debug readback confirms the memory render
     target's implementation-reported format is 8-bit unorm RGBA — CPU
     mirrors cannot see the GL side, so the force-RGBA8 path is asserted in
     the browser, mechanically.
- **Performance:** same sealed protocol as the IR round — same machine,
  viewport, tier, storm frame, 300-frame window; candidate p95 main-thread
  frame work ≤ baseline + max(20 %, 1 ms); missed-frame fraction rise ≤ 5 pp.
  Additionally the cold-boundary scrub recompute must fit one frame budget on
  the desktop detail tier, measured to **GPU completion** (disjoint timer
  query where available, else fence/readback or landed-frame latency) — draw
  submission time alone measures enqueueing and is not accepted. Raw numbers
  recorded in the PR.
- **Morphology screen:** re-capture the fixed Shaheen 2.5-h grayscale frame
  and re-run the unchanged qualitative screen per the recorded A/B-relative
  acceptance protocol; thresholds and the observed case are not retuned. A
  failure changes the renderer, not the screen.
- **Repo gates, run not assumed:** `npm test`, `npm run calibrate:check`,
  `npm run hf6:verify:check`, `npm run hf6:gate:check`,
  `npm run hf6:prospective:check`, `npm run data:hf6:catalog:check`,
  `npm run assets:check`, `npm run build`. Diff inspection: no frozen
  acceptance/contract, physics report, bake, or data changes; the regenerated
  satellite morphology report is the only permitted `calibration/` output.

## Process

Branch `feat/cloud-memory` off origin/main. This spec goes through
independent adversarial gate review (fresh-context Codex rounds, spec content
embedded, findings verified against code before acceptance) until a round
returns zero P1 findings; the gate record is appended below. Implementation
follows the plan one gated task at a time via sandboxed Codex workers, with
tests, full-diff review, and browser verification between tasks; each gated
task is committed from this seat. Gate failures surface as decision briefs.

## Gate record

Independent adversarial review by a second model (fresh context per round),
findings verified against code before acceptance.

- **Round 1** (full scope): reviewer stalled past its time budget before
  completing, but its partial trace flagged the post-death timeline. Verified
  against `sim.ts` `tick()` (returns immediately when not alive): the spec's
  original "wake outlives the storm" claim and QA check were contradicted by
  code — **1 P1, accepted and fixed** (frozen-final-frame stance).
- **Round 2a** (determinism/timeline/tape scope): 1 P1, 2 P2.
  - P1 "replay cloud age depends on scrub history" — **refuted with
    evidence**: both replay navigation entry points reset the fixed-step
    accumulator (alpha ≡ 0 in replay) and `storm-session.ts` derives
    prev from the tape (`stormAt(i−1)`), so `u_cloudAgeH` is a pure function
    of the selected frame index. The reviewer had not read
    `storm-session.ts`. Kernel kept: QA wording now says "pause at a frame",
    and the spec states the single-age-source rule explicitly.
  - P2 dedup-gap claim — accepted: dedup requires equal `ageH`; no age gaps
    exist while alive. Accessor claim simplified, test case replaced.
  - P2 zero-init "exactly" overclaim — accepted: reworded to identical
    source inputs + one-step evolution + crossfade continuity.
- **Round 2b** (GL/budget/render-contract scope): 4 P1, 1 P2, all accepted.
  - RGBA8 age saturation → normalized `ageN += dt/W` encoding.
  - `makeRenderTarget` RGBA16F preference → force-RGBA8 option; gl-utils.ts
    added to the permitted diff.
  - Texel-bound arithmetic → corrected to ~11 texels worst case
    (cap × 95 km RMW clamp); named substep constant as the QA fallback.
  - Reduced-motion conflict → update pass adopts the display path's gate;
    the flag is a state-definition input; toggle invalidates the cache.
  - P2 outflow provenance → specified as a new named term with formula; the
    shipped drift is shear-aligned (recorded prior-spec deviation), not
    radial.
  - Explicitly verified as holding: 16-sampler accounting and OHC pre-blend,
    RG/BA one-call packing, presence-ladder ordering, sealed +2 relief taps,
    `rainCenterClip` support, per-tier resolution as a legitimate render
    trait, header-sized OHC blit.
- **Round 3** (full scope, amended spec, `storm-session.ts` added to the
  reading list): 4 P1, 2 P2, all accepted.
  - P1 replay age off-by-one — accepted; it also falsified this seat's
    round-2a claim that paused-live and replay agree at the same age: the
    live path's prev spreads `...live` and keeps the *current* `ageH`, so
    paused-live shows `cur` while replay shows `cur − 0.25`. Equivalence
    claims are now within-mode only; the QA check compares replay with
    replay.
  - P1 causality seal — accepted (the sharpest find of the gate): sources
    now run `k − N … k − 1`, every input is a frozen past frame, the
    beyond-last-frame clamp is deleted (missing frame throws), and the cache
    key is complete without tape length.
  - P1 texel bound — accepted: the angular cap still permits ~57–100 km/h
    linear far-field flow. Fixed with `CLOUD_MEMORY_MAX_ADVECT_KMH = 30`,
    which is also the honest debris model (ambient flow, not gradient wind);
    worst case ~13 texels/step.
  - P1 tail off-by-one — accepted: source-after-decay gave the oldest parcel
    N−1 decays (5.88 %). Step order is now Advect→Source→Decay (exactly N
    decays, 4.98 %), pinned by the relation test.
  - P2 GPU-completion timing and P2 OHC blend-equivalence captures —
    accepted into verification.
  - Verified as holding: dedup semantics, normalized RGBA8 age, force-RGBA8
    targeting, reduced-motion cache input, outflow provenance, 16-sampler
    accounting, RG/BA packing, relief/rain-support preservation, tier/header
    sizing.
- **Round 4** (full scope, amended spec): 3 P1, 1 P2, all accepted. Two P1s
  were editing errors from earlier amendment passes, not design flaws: the
  §4 accessor still carried the beyond-last-frame clamp the round-3
  causality seal had deleted (now removed), and QA item 2 still read as a
  cross-mode equality check (now two explicit within-mode repeat checks).
  The third P1: `exp(−3)·255 = 12.696` encodes as byte 13 = 5.098 %, so a
  float ≤ 5 % relation test passes while the RGBA8 state fails — the tail
  contract is now defined and tested in encoded space (byte-quantized
  recurrence, final byte ≤ 13). P2 accepted: the source/density and
  debris-age combine rules are now sealed formulas (additive-saturating
  density, density-weighted age rejuvenation, encoded-zero age reset).
  Verified as holding: the 13-texel bound arithmetic and the
  Advect→Source→Decay decay-count fix.
- **Round 5** (full scope, amended spec): **ZERO P1 FINDINGS.** The reviewer
  explicitly confirmed the round-4 fixes effective: no end-clamping in the
  accessor, within-mode QA comparisons, the 18-step byte recurrence ending
  at 13, and explicit combine rules. Three P2 advisories, all accepted into
  the spec: the age-reset test reads the stored byte after quantization; a
  browser readback asserts the RGBA8 target format; per-boundary caching
  plus a budgeted two-tap packing blit are sealed (cold scrub recomputes at
  most two states).

**GATE SEALED 2026-07-30 — round 5 clean. This seals the design boundary
only; implementation has not started.**
