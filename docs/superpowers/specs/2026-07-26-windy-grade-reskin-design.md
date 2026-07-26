# Windy-grade reskin — design spec

Status: draft for review · 2026-07-26
Mockup: claude.ai artifact "Wallah It's Windy — Visual Direction Study", Direction 05
(built over a real captured frame: seed 7, May climatology, hour 24, "Simulated
Cyclone Shaheen", Cat 3, 111 kt / 943 hPa).

## Goal

Reskin the app's chrome to the approved Windy-grade direction: floating dark-glass
panels, a real type scale (11–14px, not 7–10px), an icon layer rail, a storm tag
pinned to the eye, and a category-coloured timeline as the scrubber. The map does
the talking; the chrome gets out of the way.

## Non-goals (explicitly out)

- Noctiluca-style WebGL wind ribbons (possible later pass; not this work).
- Live layer preview thumbnails in the rail (needs offscreen multi-layer renders).
- Atlas/Astrolabe special modes, light theme, export-card restyling.
- Any physics, calibration, data-format, or URL-hash change.

## Invariants (from CLAUDE.md — restated because this work brushes against them)

- Determinism untouched: no sim/RNG/dt code is edited. This is DOM + CSS + tokens.
- `npm test`, `npm run build`, `npm run calibrate:check` stay green at every phase.
- Honesty labels survive verbatim and visibly: "simulated" on every simulated
  product, "HF-6 research build", "experimental forecast companion — not official
  guidance", non-official storm-name marking, ensemble copy stays
  frequency-not-probability.
- Zero new runtime dependencies. No webfonts added — system sans stack + the
  existing self-hosted IBM Plex Mono.
- Machine-generated reports untouched.

## Visual system

### Tokens (tokens.ts — the single source; chrome consumes CSS vars, shaders consume uniforms)

New chrome tokens:

| token | value | role |
|---|---|---|
| `uiAccent` | `#59d8e6` | chrome accent: active states, live dot, play button, links |
| `panelGlass` | `rgba(11,16,26,0.82)` | panel fill (backdrop-blur 10px in CSS) |
| `panelEdge` | `rgba(146,190,224,0.14)` | panel border |
| `textHi` | `#e8f1f8` | primary chrome text (replaces cyan `--text` in chrome) |
| `textMut` | `#8fa3b8` | secondary chrome text |
| `textDim` | `#6d8296` | tertiary/keys/hints |

Changed tokens (render-only; legend gradients follow automatically):

- `wind0..wind4` retuned brighter/more saturated so the flow map reads vivid
  without CSS filters (mock used `saturate(1.18) brightness(1.06)` as the target;
  final values eyeballed against capture, then frozen). Particle-trail alpha may
  rise slightly in render/particles.ts constants — render-only.
- `--accent` (amber) is NOT removed: it remains the map-instrument colour (RMW
  ring, survey marks, genesis glow). Chrome stops using it; `uiAccent` takes over.
- Category ramp `catTd..cat5` unchanged (already the standard tracker palette).

Radius: chrome moves from 4px to 10px panels / 7px controls (new `--radius-panel`,
`--radius-ctl`; the 4px `--radius` stays for map-space marks). Spacing unit stays 8.

### Type

- New `--sans`: `'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, sans-serif`.
- Chrome text: sans. Ramp: 10px eyebrow/uppercase-tracked · 11px hints/labels ·
  12.5px controls · 13–14.5px body/lead · 16px brand · 19px timeline kt readout.
- ALL numerals stay `--mono` (IBM Plex Mono) with `tabular-nums` — the instrument
  voice survives in the numbers.

## Component treatments (information architecture unchanged unless noted)

1. **Masthead → brand pill** (top-left): one glass pill — wordmark
   `wallah it's windy` (windy in uiAccent), divider, live dot, "HF-6 research
   build", "methodology" link. `<h1>` semantics kept. The "not official guidance"
   line becomes a small pill directly beneath.
2. **Run environment** (top-right, left of rail): the two selects restyled as glass
   pills; scenario-mode select and contract line keep their show/hide logic.
3. **Layer rail** (right): rows = icon (inline SVG, ~15px, stroke 1.5) + label +
   key numeral. Active row: uiAccent fill, dark text, soft glow. Icons are a new
   `iconSvg` field on `WeatherLayerDefinition` (weather-layers.ts is the
   user-facing catalogue; order stays load-bearing). Legend docks under the rail
   as today but restyled; satellite/radar/accum workbenches become glass sections
   with every control and honesty `<output>` intact.
4. **Flight recorder → bottom-left card**: header (live-tape dot · "flight
   recorder" · mono clock), explanation lead + body, sparkline (uiAccent line,
   soft area fill, peak dot in current cat colour), 6-readout grid (pressure,
   sst/mpi, shear, steering, eyewall/b, 34/64kt). The existing "details" toggle
   expands the full readout + structure grids and the debrief/impact/hindcast/
   comparison sections (all kept, restyled). Category scale bar stays inside the
   expanded view (the timeline now carries category at a glance).
5. **Transport → timeline bar** (new, full-width bottom): play/pause circle,
   mono clock, the scrubber as a category-coloured track built from the recorded
   tape (per-frame Saffir–Simpson colour, painted as a CSS linear-gradient with
   hard stops regenerated when the tape grows — no canvas), 6h ticks, milestone dots (ts/1/2/…/landfall from
   existing jump logic), diamond playhead, right cluster: `NNN kt · NNNN hPa`,
   cat chip, storm id + `[SIMULATED]` stamp. Replaces the in-panel
   `.flight-transport`; `#flight-jumps` buttons become the milestone dots.
6. **Storm tag** (new map overlay): DOM chip projected at the storm head each
   frame (same projection path as city markers): name + kt on line one, "cat N ·
   trend-word · hPa" on line two, cat-colour border, small pulsing eye ring
   (reduced-motion-gated). Hidden when no live/replayed storm.
7. **City markers / point probe / city detail**: restyled to the new material and
   type; probe keeps its dl grid, mono values.
8. **Caption + interaction guide**: two glass hint chips above the recorder
   ("click the sea to spawn your own", "hover · hold to inspect"); the 3-step
   guide collapses into these (step 3 lives in the rail's "keys 1–9" hint).
9. **Forecast laboratory / model dialog**: same behavior, glass restyle; dialog
   gets the sans/type ramp.
10. **Compact mode** (performance.ts signals, existing breakpoints): rail becomes
    icon-only (40px), timeline right-cluster drops to kt+cat, recorder card
    becomes collapsed-by-default. Restyle of existing compact behavior, not new
    logic where avoidable.

## Technical shape

- `src/tokens.ts`: new tokens + wind retune (single source; CSS + uniforms derive).
- `src/style.css`: the bulk. Rewritten section-by-section per phase; selectors and
  ids stay stable so ui.ts/main.ts wiring is untouched wherever possible.
- `index.html`: structural moves for brand pill, timeline bar, hint chips.
- `src/ui.ts` / `src/main.ts`: timeline paint (from flight-recorder frames),
  storm-tag projection + content, milestone dots wiring. No engine changes.
- `src/weather-layers.ts`: `iconSvg` per layer.
- `src/render/particles.ts`: trail-alpha constant only (render).

## Phases (each ships independently, all gates green)

1. **P1 material+type**: tokens, sans ramp, glass panels — restyle in place, zero
   structural HTML change. Biggest visible win, lowest risk.
2. **P2 structure**: timeline bar + recorder card + brand pill + hint chips.
3. **P3 rail icons + storm tag.**
4. **P4 wind-palette retune** (tokens + particle alpha), then delete any interim
   CSS filter. Fidelity/calibration checks prove no drift (they don't read
   palettes, but run them anyway).

## Verification

- Per phase: `npm test`, `npm run build`, `npm run calibrate:check`.
- Visual: the Playwright driver from the mockup session (scratchpad
  `driver/capture.mjs`, GPU flags) reruns seed 7 / May / (15.5, 64.5) and
  screenshots idle + Cat-3 states; eyeball against the approved mock. Driver gets
  committed under `tools/` or stays session-side — reviewer's call (default:
  session-side, not committed).
- Honesty-label checklist walked per phase (grep for the exact strings).

## Open decisions taken (state here, not re-litigated later)

- Chrome accent is teal `#59d8e6`; amber stays map-side. If the two ever collide
  visually (e.g. amber RMW ring under a teal-active rail), map wins — chrome yields.
- No leader line on the storm tag in v1 (chip offset above the eye); add only if
  the chip ambiguity shows up in testing.
- The category scale bar (now/potential needles) moves inside the expanded
  recorder; the timeline carries at-a-glance category instead.
