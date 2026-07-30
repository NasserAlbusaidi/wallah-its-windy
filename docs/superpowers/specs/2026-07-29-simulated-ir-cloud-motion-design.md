# Simulated IR cloud motion, height, and inner-core texture

**Date:** 2026-07-29
**Status:** SPEC_GATED — approved for implementation
**Scope:** Render-only simulated-cloud code and its focused tests/validation.
No sim, physics, replay-tape, calibration-acceptance, or data changes.

## Problem

Three realism gaps in the simulated satellite IR layer (`env.ts` mode 1, plus the
faint cloud context shared by terrain/wind/accum/rain-plate modes):

1. **Clouds read as static.** The procedural cloud field is glued to the storm:
   it translates with the center but does not visibly circulate. Its main noise
   coordinate rotates at only `0.028 rad/sim-hour` (~1.6°/h), while the two band
   sines turn even more slowly and at inconsistent effective rates because their
   phase coefficients differ. The drift terms are similarly imperceptible. A
   typical 72-hour storm turns the main texture only ~0.32 revolution.
2. **Cloud tops are flat.** `brightnessC` mixes one `stormTopC` for the whole
   storm: rainbands get nearly the same cold tops as the CDO. The existing
   `towerCooling` already provides a stationary −13 °C convective-cell cooling
   proxy, but it is neither component-graded nor a coherent transient lifecycle.
   The visible palette has no relief cue.
3. **The inner-core geometry is too radial.** The existing `convectiveCells`
   texture already breaks up eyewall *intensity*, but the eyewall radius and eye
   edge remain exact circles. The result still reads as a clean annulus instead
   of a dynamically irregular core.

## Display-rate context (drives the design)

Playback runs at `NORMAL_HOURS_PER_SEC = 3` sim-hours per real second
(`SLOWMO_HOURS_PER_SEC = 1` near coast). A representative 78-kt, ~30–40-km-RMW
eyewall has a physical angular velocity of roughly 4–5 rad/sim-hour, which
would display around or above two revolutions/second and alias into blur.
Farther-out or
weaker-storm bands can fall near 0.3 rad/sim-hour and read well uncapped.
Hence: cap the displayed rotation rate near the core and retain the Holland
rate where it naturally falls below the cap.

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

- Per-pixel angular velocity comes from the Holland profile already available
  in the shader (`u_vmaxMs`, `u_hollandB`, `u_rMax`). The unit conversion is
  load-bearing and must be explicit:

  `rKm = max(length(radial) * HALF_DOMAIN_HEIGHT_KM, epsilon)`

  `rmwKm = u_rMax * HALF_DOMAIN_HEIGHT_KM`

  `x = min(80, pow(rmwKm / rKm, u_hollandB))`

  `vMs = u_vmaxMs * sqrt(max(0, x * exp(1 - x)))`

  `ωraw = 3.6 * vMs / rKm` (rad/sim-hour), then
  `ω = min(ωraw, CLOUD_ROTATION_CAP_RAD_PER_H)`.

  `radial` is already aspect/latitude corrected by `u_metricX`, and
  `HALF_DOMAIN_HEIGHT_KM` is the shared 666-km render conversion. The named
  ~0.6-rad/sim-hour cap gives an eyewall lap of ~3.5 screen-seconds at 3 h/s;
  its comment must say it is a perception cap, not physics.
- Storm-relative noise (macro/fine) advects along this flow using **two
  phase-staggered samples on a ~45-sim-minute sawtooth, triangle-crossfaded**
  (standard flow-map technique). Each sample accumulates at most
  `cap × period ≈ 0.45 rad` before reset. Crossfade weights sum to one and each
  resetting sample has zero weight at its discontinuity, so neither the field
  nor its brightness pops at a phase boundary.
- Advection is Northern-Hemisphere counter-clockwise in the shader's
  east/north coordinates. Noise uses inverse mapping (sample at the
  backward-rotated coordinate). A band sine with azimuth coefficient `k` uses
  `k * (azimuth - θref)`, not a bare `+ θref`; otherwise the sign and apparent
  angular rate are both wrong.
- The large-scale band *pattern* (the `bandPhase` sines) rotates solid-body at
  the same **capped** ω evaluated at one reference radius, `2.5 × rMax` — no
  phase winding; the log-spiral term `-1.52 * bandQ` already encodes the wound
  shape. This reference is not guaranteed to be below the cap: with the current
  structure model a representative 78-kt storm is ~1.13 rad/h there before the
  0.6 cap. The noise texture riding on the bands streams differentially.
- Cirrus gains a slow outward radial drift component (upper-level outflow, a
  real IR signature). The ambient synoptic deck keeps its existing
  steering-vector drift.
- Fast decorative motion uses a new interpolated `u_cloudAgeH`
  `mix(prevStorm.ageH, storm.ageH, frame.alpha)`, with the current age as the
  no-previous-frame fallback. Feeding raw `storm.ageH` would jump by 0.25 h per
  fixed tick—up to 0.15 rad at the cap—and visibly stutter, especially at the
  1 h/s coast timescale.
- The existing raw `u_ageH` remains unchanged for `precipitatingCloud`, matching
  `radar.ts` at the same fixed storm frame. Reusing the interpolated decorative
  age there would create a small but real between-tick phase mismatch and break
  the shared rain-support geometry.
- All decorative motion remains a pure function of interpolated simulated age,
  while rain support remains a pure function of the shared fixed-frame age:
  pause freezes both, selecting the same replay frame reproduces the same
  pixels, and shared-URL replays are deterministic. No wall-clock input.
- `prefers-reduced-motion` is a separate uniform/gate from the mobile detail
  tier. It disables fast circulation, rotating mesovortices, cirrus outflow
  drift, and transient pulse cycling while preserving the non-animated cloud
  morphology. A narrow screen may use low detail and still animate; reduced
  motion may use a wide screen and must not.
- The rain-aligned `precipitatingCloud` geometry remains on
  `rainCenterClip` and `RAINBAND_SPIRAL_ROTATION_PER_H`. Only the independent
  decorative cloud morphology is flow-advected; the forced-support floor over
  modeled rain must not move away from the rain product.

### 2. Height

IR palettes (enhanced + grayscale):

- `brightnessC` becomes graded per component instead of one flat storm top:
  CDO −65…−82 °C by development; eyewall towers coldest; rainbands −45…−62 °C;
  cirrus edges −35…−48 °C. Where components overlap, the uppermost/coldest
  active component dominates before the result is mixed with surface/ambient
  temperature by final cloud opacity; do not average a cold tower back toward
  a warmer underlying band.
- **Overshooting tops:** transient cold pulses (−8…−14 °C below the local top)
  on strong convective cells (`convectiveCells` high AND rain energy high),
  replacing—not stacking on—the existing `towerCooling`. Cell identity is
  derived from the advected storm-relative coordinate plus `u_cloudSeed`, and
  its lifecycle reads `u_cloudAgeH`, never raw wall time.
  A cell-specific phase offset and a pulse envelope that is zero at lifecycle
  boundaries prevent all cells from reseeding or popping together when the
  ~2-sim-hour cycle index changes. The stretched lifetime is a display-honesty
  compromise covered by the layer's "simulated" label and the existing
  qualitative-proxy claim boundary.

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
  existing `shearDir`/`shearN` (documented real-storm structure). In the
  shader's east/north coordinates, left of a valid normalized downshear vector
  is `vec2(-shearDir.y, shearDir.x)`. This enhancement is gated off when
  `length(u_shearVector) <= 0.05`; the existing arbitrary fallback direction is
  acceptable for decorative canopy displacement but must not be presented as
  a physical downshear-left signal.
- The eye edge wobbles with the same noise — no more perfect pinhole.

### 4. Constraints

- **No new textures or samplers.** After the C2a upper-wind merge the env
  program uses exactly all 16 guaranteed WebGL2 fragment texture units
  (units 0–15). Every new signal derives from the existing `u_cloudNoise`.
  The straightforward flow-map budget is +4 raw cloud-noise texture lookups on
  the detail tier and +3 on mobile; visible relief adds at most +2 more only in
  that palette. Any implementation with a higher budget needs a new gate, and
  the measured browser trace—not sampler count alone—decides acceptance.
- **Render-only product diff:** expected product files are `src/render/env.ts`
  and, if needed, a small pure render helper/shared constant plus focused tests.
  `src/sim.ts`, the flight recorder, baked data, frozen acceptance/contract
  files, and physics reports stay untouched.
- The render change invalidates the *currentness* of the old simulated capture
  behind `calibration/satellite-cloud-validation.json`. Re-capture the fixed
  Shaheen 2.5-h grayscale frame and rerun the existing qualitative morphology
  screen with its unchanged thresholds. Regenerating that one report and
  updating `docs/satellite-cloud-validation.md` with the resulting metrics is
  allowed; retuning thresholds or changing the observed case is not. If the
  exact observed input cannot be lawfully recovered, acceptance stops rather
  than claiming the old report validates the new shader.
- The rainband-profile contract is untouched: env's band remains cloud
  morphology, deliberately NOT a rain product (per CLAUDE.md). Known accepted
  divergence: independent IR decorative band texture rotates faster while the
  radar product and minimum precipitating-cloud support retain their shared
  rain geometry. The products are mutually exclusive on screen, but that is
  not permission to move the minimum support away from modeled rain.
- New tuning constants (perception cap, crossfade period, temp bands, wobble
  amplitudes) are named GLSL constants with WHY comments.

## Verification

- Focused Vitest coverage pins render-age interpolation, the 666-km
  angular-rate conversion, representative capped/uncapped rates, and the two
  phase weights at/reset around the sawtooth boundary. Any new CPU-side helper
  in `draw()` is tested. The GLSL itself remains browser-verified because the
  suite has no GL harness.
- Browser QA (Playwright or the connected browser), with console and WebGL
  errors treated as failures:
  - after load fades settle, a paused frame and the same selected replay frame
    are pixel-stable on repeated capture;
  - a short, steady same-seed sequence shows counter-clockwise core motion
    without fixed-step stutter; captures at +6 h, +24 h, and a late ≥96 h frame
    show no phase-boundary pop or filamentation;
  - enhanced, grayscale, and visible palettes pass; visible relief disappears
    on detail tier 0;
  - narrow-screen detail tier 0 still moves, while a separate forced
    reduced-motion pass has no rapid circulation or transient pulsing;
  - the rain-support floor remains over the radar footprint at weak, mature,
    and sheared states.
- Capture a browser performance trace for the current build and candidate on
  the same machine, viewport, detail tier, storm frame, and 300-frame window.
  Candidate p95 main-thread frame work may not regress by more than the larger
  of 20% or 1 ms, and missed-frame fraction may not rise by more than five
  percentage points. Record the raw before/after numbers with the QA evidence.
- Re-run the unchanged Shaheen qualitative morphology screen described above;
  all five existing checks must remain true. A failure changes the renderer,
  not the thresholds.
- Full repository gates are run, not assumed:
  `npm test`, `npm run calibrate:check`, `npm run hf6:verify:check`,
  `npm run hf6:gate:check`, `npm run hf6:prospective:check`,
  `npm run data:hf6:catalog:check`, `npm run assets:check`, and
  `npm run build`. Diff inspection must show no frozen acceptance/contract,
  physics report, bake, or data changes; the regenerated satellite morphology
  report is the only permitted `calibration/` output.

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

## Gate record

Independent semantic review was performed against `origin/main` at `8ebb95b`
plus this design commit. Round 1 found eight P1 contradictions:
the stale 15-unit claim, pre-existing tower cooling and textured eyewall
intensity, missing angular unit/sign rules, an incorrectly uncapped 2.5-RMW
reference claim, fixed-tick age stutter, no separate reduced-motion contract,
an understated texture-fetch budget, and verification that neither refreshed
the existing morphology screen nor isolated replay/performance behavior.

Round 2 found one additional P1: replacing shared `u_ageH` with interpolated age
would desynchronize IR precipitating-cloud support from radar between fixed
ticks. The design now keeps raw `u_ageH` for shared rain geometry and introduces
interpolated `u_cloudAgeH` only for decorative cloud evolution.

Round 3 found **0 remaining P1 findings**. This seals the design boundary only;
implementation has not started.
