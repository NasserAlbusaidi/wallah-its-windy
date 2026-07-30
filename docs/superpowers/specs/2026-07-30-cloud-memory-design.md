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
  texture over the same clip domain env renders. RGBA8. Resolution is a
  render trait set per performance tier (named constants,
  `CLOUD_MEMORY_SIZE_DETAIL = 512`, `CLOUD_MEMORY_SIZE_MOBILE = 256`), like
  dprCap: per-device, never read by physics or recorded output.
- **Timeline:** memory boundaries at integer multiples of
  `CLOUD_MEMORY_DT_H = 1` sim-hour. Window `CLOUD_MEMORY_WINDOW_H = 18`
  sim-hours → `N = 18` update steps per boundary state.
- **Definition:** `state(k)` = start from a **zero field** at boundary
  `k − N`, apply N update steps; step j reads storm history at boundary time
  `(k − N + j) · dt` from the flight-recorder tape. Zero init (not seeded
  noise) means state(k) and state(k+1) share all overlapping source history
  exactly and differ only by the single oldest/newest step — no init-mismatch
  shimmer to crossfade away. The seed still enters through `u_cloudNoise`
  source texturing.
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
- **Caching:** computed states are cached per boundary index k in a small LRU
  (k and k+1 for playback, plus recently scrubbed entries). The cache is a
  pure memoization of the definition — eviction can only cost recompute time,
  never change pixels.
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
   coherence with the shipped motion layer: capped `cloudOmega` rotation
   (same GLSL/CPU mirror as cloud-motion.ts) around that boundary's storm
   center, the shipped outward outflow drift near the storm, and the ambient
   steering drift far-field. Storm translation is implicit — the field is
   earth-fixed and the source moves. The rotation cap bounds the backtrace to
   ~3.5 texels/step at 512², safe for a single tap.
2. **Decay** — density × `exp(−dt / CLOUD_MEMORY_DECAY_TAU_H)`,
   `τ = 6` sim-hours; the debris-age channel increments by dt where density
   is present.
3. **Source** — convection injected from that boundary's tape frame: an
   analytic envelope from vKt-derived development and the frame's
   `structure` radii (rmw, outer size), textured by seeded `u_cloudNoise`
   cells so injection is patchy, not a stamp.

The update program binds exactly **2 samplers** (previous state,
`u_cloudNoise`) — its own budget, independent of env's. All constants are
named GLSL/TS constants with WHY comments; CPU mirrors are vitest-pinned.

### 3. Display integration (env program)

- **Packing:** `state(k)` in RG, `state(k+1)` in BA of one RGBA texture, so
  env reads both boundary states in **one** `texture()` call and crossfades
  with `frac(u_cloudAgeH / CLOUD_MEMORY_DT_H)` — a pure function of the
  already-shipped interpolated cloud age. Pause freezes it; the same replay
  frame reproduces the same pixels.
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
- **Reduced motion:** the memory field stays active. It evolves at the
  storm-translation speed class, which the shipped reduced-motion contract
  already permits for morphology; no fast circulation or pulsing is added by
  this feature. The existing animGate behavior of other components is
  unchanged.
- **Rainband contract:** `precipitatingCloud` support stays on
  `rainCenterClip` / `RAINBAND_SPIRAL_ROTATION_PER_H`, untouched. Memory is
  decorative morphology only and must not move the minimum rain-support floor.

### 4. Wiring

- `src/render/cloud-memory.ts` (new): pass orchestration, constants, CPU
  mirrors, GLSL strings — the cloud-motion.ts pattern.
- The render loop ensures `state(k)`/`state(k+1)` exist before the env draw.
  Storm history comes through a read-only accessor over the flight-recorder
  tape with nearest-frame-at-or-before-age semantics (frames are per fixed
  tick, boundaries land on tick ages except across stationary-frame dedup).
  The accessor observes; the recorder's recording path is untouched.
- Expected product diff: `src/render/cloud-memory.ts`, `src/render/env.ts`,
  `src/render/cloud-motion.ts` (shared constants if needed),
  `src/render/index.ts`, `src/main.ts` (accessor wiring),
  `src/flight-recorder.ts` (read-only accessor only),
  `test/cloud-memory.test.ts`, the regenerated morphology artefacts, this
  spec, and the plan. Anything else in the diff is a hard failure.

### 5. Cost model

- Steady-state playback: one N-pass recompute per boundary crossing (~3/s at
  normal speed, 1/s slow-mo; each pass ≤ 512² with ~4 taps) plus the
  per-frame OHC blit. Display adds +1 texture lookup per env fragment.
- Cold scrub: one bounded recompute per landed boundary; budget under one
  desktop frame (16.7 ms) on the detail tier, measured not assumed.
  Scrubber dragging hits the per-k cache.

## Product honesty

The layer stays "simulated satellite infrared" / simulated cloud context;
debris is decorative morphology under the existing qualitative-proxy claim
boundary. No new product claims, no label changes, no probability framing.

## Verification

- **Vitest (no GL harness; GLSL is browser-verified):** boundary index/frac
  math from cloudAgeH; window clamp at spawn; nearest-≤ tape lookup including
  the dedup gap case; velocity mirror reuse of `cloudAngularRateRadPerH`;
  cache keying and run-identity invalidation; OHC pre-blend selection logic;
  W/τ ≥ 3 pinned as a relation test so retuning one constant cannot silently
  break the tail contract.
- **Browser QA (Playwright; console/WebGL errors are failures):**
  1. *Scrub equivalence (the new critical check):* play forward to a frame,
     capture; cold-scrub away and back to the same frame, capture →
     byte-identical. Repeat across a memory-boundary crossing.
  2. Paused-frame and same-replay-frame captures byte-identical (shipped
     check, now exercising the memory path).
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
- **Performance:** same sealed protocol as the IR round — same machine,
  viewport, tier, storm frame, 300-frame window; candidate p95 main-thread
  frame work ≤ baseline + max(20 %, 1 ms); missed-frame fraction rise ≤ 5 pp.
  Additionally the cold-boundary scrub recompute is timed and must fit one
  frame budget on the desktop detail tier. Raw numbers recorded in the PR.
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

Pending — to be appended after review rounds.
