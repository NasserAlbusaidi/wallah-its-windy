# Simulated IR cloud motion, height, and inner-core texture

**Date:** 2026-07-29
**Status:** Approved design, pre-implementation
**Scope:** `src/render/env.ts` fragment shader (render-only). No sim/physics changes.

## Problem

Three realism gaps in the simulated satellite IR layer (`env.ts` mode 1, plus the
faint cloud context shared by terrain/wind/accum/rain-plate modes):

1. **Clouds read as static.** The procedural cloud field is glued to the storm:
   it translates with the center but does not visibly circulate. Rotation exists
   (`rotation = u_ageH * 0.028`) but at ~1.6°/sim-hour it is ~150× slower than a
   real eyewall's cloud motion and is solid-body — one rate for core and bands.
   The texture drift terms are similarly imperceptible. Over a full storm life
   the pattern turns less than half a revolution.
2. **Cloud tops are flat.** `brightnessC` mixes one `stormTopC` for the whole
   storm: rainbands get nearly the same cold tops as the CDO. No overshooting
   tops, no graded canopy, no relief cue in the visible palette.
3. **The inner core is a perfect donut.** The eyewall term
   `exp(-((q-1)/σ)²)` is purely radial; with a circular eye hole it renders as
   a mathematically clean annulus no real 78-kt storm shows.

## Display-rate context (drives the design)

Playback runs at `NORMAL_HOURS_PER_SEC = 3` sim-hours per real second
(`SLOWMO_HOURS_PER_SEC = 1` near coast). Physically true eyewall angular
velocity (~4.8 rad/sim-h) would display at >2 revolutions/second — aliased
blur. Outer bands (~0.3 rad/sim-h → one lap per ~8 screen-seconds) look right
at their true rate. Hence: cap the display rotation rate near the core, use
true rates outside the cap radius.

## Chosen approach: flow-map advection in the existing shader

Rejected alternatives:

- **A. Retune existing constants** (faster solid-body spin + radial falloff):
  unbounded differential winding filaments the noise texture into spiral mush
  after a few sim-hours. Would be redone as B.
- **C. Stateful cloud memory** (ping-pong FBO, clouds form/advect/decay):
  most physical, but render state that flight-recorder scrubbing cannot cheaply
  rebuild — breaks the replay/scrub contract unless reconstruction machinery is
  added. Deferred, not dropped: see Future work.

### 1. Motion

- Per-pixel angular velocity from the Holland profile already available in the
  shader (`u_vmaxMs`, `u_hollandB`, `u_rMax`):
  ω(r) = v(r)/r converted to rad/sim-hour, clamped to a perceptual cap
  (named constant, ~0.6 rad/sim-h ⇒ eyewall lap ≈ 3.5 screen-seconds at 3 h/s;
  comment must state it is a perception cap, not physics).
- Storm-relative noise (macro/fine) advects along this flow using **two
  phase-staggered samples on a ~45-sim-minute sawtooth, triangle-crossfaded**
  (standard flow-map technique). Each sample accumulates ≤ ~0.5 rad of
  differential twist before its reset, so distortion stays bounded forever.
- The large-scale band *pattern* (the `bandPhase` sines) rotates solid-body at
  ω evaluated at one reference radius, 2.5 × rMax (inside the band envelope,
  well below the perception cap) — no phase winding; the log-spiral term
  `-1.52 * bandQ` already encodes the wound shape. The noise texture
  riding on the bands streams differentially via the flow map.
- Cirrus gains a slow outward radial drift component (upper-level outflow, a
  real IR signature). The ambient synoptic deck keeps its existing
  steering-vector drift.
- All motion is a pure function of `u_ageH`: pause freezes clouds, scrubbing
  and shared-URL replays are deterministic. No wall-clock input.

### 2. Height

IR palettes (enhanced + grayscale):

- `brightnessC` becomes graded per component instead of one flat storm top:
  CDO −65…−82 °C by development; eyewall towers coldest; rainbands −45…−62 °C;
  cirrus edges −35…−48 °C.
- **Overshooting tops:** transient cold pulses (−8…−14 °C below the local top)
  on strong convective cells (`convectiveCells` high AND rain energy high),
  lifecycle driven by a deterministic hash of (storm-relative cell id,
  quantized `u_ageH`). Lifetime stretched to ~2 sim-hours so pulses read at
  3 h/s playback — a display-honesty compromise covered by the layer's
  "simulated" label.

Visible palette:

- Lambert relief shading from a height proxy (coldness × cloud). Normals from
  two extra `u_cloudNoise` taps plus the analytic envelope derivative; fixed
  NW sun direction. **Detail tier only** (`u_cloudDetail == 1`); the mobile
  tier keeps the current flat look.

### 3. Inner core

- **Azimuthal eyewall wobble:** eyewall radius modulated by low-wavenumber
  azimuthal noise; amplitude shrinks as organization rises (weak storms
  ragged, mature storms rounder) — mirrors the existing `coreIrregularity`
  convention.
- **Mesovortex lumps:** eyewall intensity modulated by a wavenumber-4…6 sine
  rotating at the capped core rate, so the eyewall visibly churns.
- **Wavenumber-1 shear asymmetry:** downshear-left quadrant enhanced using the
  existing `shearDir`/`shearN` (documented real-storm structure).
- The eye edge wobbles with the same noise — no more perfect pinhole.

### 4. Constraints

- **No new textures or samplers.** The env program sits at 15 of 16 texture
  units after the RG8-packing fix; every new signal derives from extra taps of
  the existing `u_cloudNoise` (+2–3 taps detail tier, +1–2 mobile tier).
- **Render-only diff:** `src/render/env.ts` (possibly a shared constant in
  `storm-radii.ts`). Sim, calibration, and data files untouched, so
  `calibrate:check`, the HF-6 sealed checks, and fidelity stay green by
  construction.
- The rainband-profile contract is untouched: env's band remains cloud
  morphology, deliberately NOT a rain product (per CLAUDE.md). Known accepted
  divergence: IR band texture rotates while the radar product's bands do not;
  the two layers are mutually exclusive on screen.
- New tuning constants (perception cap, crossfade period, temp bands, wobble
  amplitudes) are named GLSL constants with WHY comments.

## Verification

- `npm test` and `npm run build` green; no calibration/report files modified.
- Browser QA (Playwright): same-seed screenshots at t, t+6 h, t+24 h —
  rotation visible in frame diffs, no filamentation at t+24 h; all three
  palettes (enhanced / grayscale / visible); forced mobile-tier pass
  (`u_cloudDetail == 0`); frame-time sanity check against current build.
- Any new CPU-side helper in `draw()` gets a vitest unit test; the shader
  itself is verified visually (no GL harness in the test suite).

## Future work (deferred, not dropped)

**Cloud memory (approach C).** A stateful advected cloud texture — clouds form
under convection, advect with the flow, decay downstream, leaving debris cloud
behind the track. Deliberately deferred because render state breaks the cheap
scrub/replay rebuild: the flight recorder rebuilds frames from copied state and
never re-drives the engine, so a stateful texture must either be reconstructable
from (seed, ageH) alone — e.g. re-advecting N bounded steps from a deterministic
init on every scrub — or be captured per-frame, which the tape deliberately
avoids. Pick this up only after flow-map motion ships and if the result still
lacks life; the bounded-reconstruction variant is the compatible path.
