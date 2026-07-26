# Windy-Grade Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the app chrome to the approved Windy-grade direction (spec:
`docs/superpowers/specs/2026-07-26-windy-grade-reskin-design.md`) — glass panels,
real type scale, icon layer rail, storm tag on the eye, category-coloured timeline —
with zero physics/determinism/data changes.

**Architecture:** Pure presentation work in four shippable phases: (P1) tokens +
type + panel material restyled in place; (P2) structural HTML moves (brand pill,
bottom timeline bar, recorder card); (P3) rail icons + storm-tag overlay; (P4)
wind-palette retune. All colour flows through `src/tokens.ts` (single source for
CSS vars AND shader uniforms). DOM ids are kept stable so `main.ts`/`ui.ts` wiring
survives untouched except where a task says otherwise.

**Tech Stack:** Vite + vanilla TypeScript + WebGL2, vitest. No runtime deps — do
not add any. No webfonts beyond the existing self-hosted IBM Plex Mono.

**Visual truth:** the approved mock is
`C:\Users\nasse\AppData\Local\Temp\claude\D--personal-wallah-its-windy\0f728493-b063-4e3b-a40a-bfde29244bf4\scratchpad\mockups\direction-e.html`
(rendered: `test-e.png` beside it). When a styling step is ambiguous, open the mock
and copy its choices (colours, radii, sizes are all in its `<style>` block).

## Global Constraints

- Gates at the end of EVERY task: `npm test` and `npm run build` fully green, PLUS
  no-new-drift on calibration: `node --experimental-strip-types calibration/run.mjs --check`
  must print `[structure-calibration] PASS`, and the two KNOWN-RED baselines must
  remain byte-identical to baseline (pre-existing on main e213119, discovered
  2026-07-26, tracked separately — NOT this branch's concern):
  `[hindcast-calibration] FAIL results=false report=false liveParameters=false`
  and `[fidelity] FAIL results=false reference=true report=false gate=false`.
  Any DIFFERENT output from those two checks means this branch caused new drift → stop.
- Never edit: `src/sim.ts`, `src/rng.ts`, `src/loader.ts`, anything in `calibration/`, `bake/`, machine-generated docs (`docs/fidelity-benchmark.md`, `docs/hindcast-benchmark.md`, `docs/structure-calibration.md`, `docs/hf6-scorecard.md`).
- Honesty strings survive verbatim and visible: `simulated` labels on simulated products, `HF-6 research build`, `experimental forecast companion — not official guidance`, ensemble copy stays frequency-not-probability.
- URL-hash format untouched (`test/rng.test.ts` guards it — do not modify that test).
- Chrome accent is `uiAccent` teal `#59d8e6`; the amber `--accent` stays for map-space instrument marks (RMW ring, survey ticks, genesis glow). Do not swap amber out of map marks.
- All numerals render in `var(--mono)` with `font-variant-numeric: tabular-nums`; chrome prose uses the new `--sans`.
- Conventional commits, no AI attribution lines.

## File Map

- `src/tokens.ts` — modify: new chrome tokens (T1), wind ramp retune (T7).
- `test/tokens.test.ts` — create (T1).
- `src/style.css` — modify heavily (T2, T3, T5, T6); stays one file (repo pattern).
- `index.html` — modify (T3): brand pill, hint chips, timeline bar skeleton.
- `src/timeline-gradient.ts` + `test/timeline-gradient.test.ts` — create (T4).
- `src/main.ts` — modify (T4 timeline wiring, T6 storm-tag update call).
- `src/ui.ts` — modify (T4 milestone dots, T5 rail icons, T6 storm-tag DOM).
- `src/weather-layers.ts` + `test/weather-layers.test.ts` — modify (T5 `iconSvg`).
- `src/storm-tag.ts` + `test/storm-tag.test.ts` — create (T6).
- `src/render/particles.ts` — modify one alpha constant (T7).

Key existing APIs (do not re-invent):
- `src/category.ts`: `stormCategory(vKt): StormCategory`, `categoryRgba(vKt, a): string`, `INTENSITY_SCALE_MAX_KT`.
- `src/flight-recorder.ts`: `FlightFrame extends TrackPoint` (`vKt`, `ageH`), `FlightRunSnapshot.frames: FlightFrame[]`, `ReplayMilestones`.
- `src/tokens.ts`: `TOKENS`, `uniform(key)`, `injectCssVars()` — pattern to extend.
- `src/ui.ts:393` — labels reproject after resize; ghost labels reproject per frame (`ui.ts:1325`); the storm tag follows the same projection path.

---

### Task 1: Chrome tokens (P1)

**Files:**
- Modify: `src/tokens.ts` (RAW array + a non-palette export)
- Test: `test/tokens.test.ts` (create)

**Interfaces:**
- Produces: token keys `uiAccent`, `panelEdge`, `textHi`, `textMut`, `textDim`
  (in `RAW`, so `TOKENS.<key>.css` and CSS vars `--ui-accent`, `--panel-edge`,
  `--text-hi`, `--text-mut`, `--text-dim` exist), plus exported const
  `PANEL_GLASS = 'rgba(11,16,26,0.82)'` and new CSS vars `--radius-panel: 10px`,
  `--radius-ctl: 7px` injected by `injectCssVars`.

- [x] **Step 1: Write the failing test** — create `test/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PANEL_GLASS, TOKENS, injectCssVars } from '../src/tokens';

describe('windy-grade chrome tokens', () => {
  it('defines the chrome palette additions', () => {
    expect(TOKENS.uiAccent.css).toBe('#59d8e6');
    expect(TOKENS.panelEdge.cssVar).toBe('--panel-edge');
    expect(TOKENS.textHi.css).toBe('#e8f1f8');
    expect(TOKENS.textMut.css).toBe('#8fa3b8');
    expect(TOKENS.textDim.css).toBe('#6d8296');
    expect(PANEL_GLASS).toBe('rgba(11,16,26,0.82)');
  });

  it('injects the new radii and vars onto a target element', () => {
    const el = document.createElement('div');
    injectCssVars(el);
    expect(el.style.getPropertyValue('--ui-accent')).toBe('#59d8e6');
    expect(el.style.getPropertyValue('--radius-panel')).toBe('10px');
    expect(el.style.getPropertyValue('--radius-ctl')).toBe('7px');
  });
});
```

- [x] **Step 2: Run it, expect failure** — `npx vitest run test/tokens.test.ts` →
  fails (`uiAccent` missing / `PANEL_GLASS` not exported).
- [x] **Step 3: Implement** — in `src/tokens.ts` RAW array append (keep the file's
  comment style):

```ts
  // Windy-grade chrome (design spec 2026-07-26): panel/typography tokens. The
  // amber --accent stays map-side; chrome accent is this teal.
  { key: 'uiAccent', cssVar: '--ui-accent', rgb: [89, 216, 230], a: 1 },
  { key: 'panelEdge', cssVar: '--panel-edge', rgb: [146, 190, 224], a: 0.14 },
  { key: 'textHi', cssVar: '--text-hi', rgb: [232, 241, 248], a: 1 },
  { key: 'textMut', cssVar: '--text-mut', rgb: [143, 163, 184], a: 1 },
  { key: 'textDim', cssVar: '--text-dim', rgb: [109, 130, 150], a: 1 },
```

Export the glass fill (it is an rgba string with alpha baked, not a palette
entry): `export const PANEL_GLASS = 'rgba(11,16,26,0.82)';`
In `injectCssVars`, after the `--radius` line add:

```ts
  target.style.setProperty('--radius-panel', '10px');
  target.style.setProperty('--radius-ctl', '7px');
  target.style.setProperty('--panel-glass', PANEL_GLASS);
```

- [x] **Step 4: Tests pass** — `npx vitest run test/tokens.test.ts` → PASS.
- [ ] **Step 5: Full gates** — `npm test`, `npm run build`, `npm run calibrate:check` → all green.
- [ ] **Step 6: Commit** — `git add src/tokens.ts test/tokens.test.ts && git commit -m "feat: add windy-grade chrome tokens"`

---

### Task 2: Material + type restyle in place (P1)

**Files:**
- Modify: `src/style.css` only. No HTML, no TS.

**Interfaces:**
- Consumes: Task 1 vars (`--ui-accent`, `--panel-glass`, `--panel-edge`,
  `--text-hi`, `--text-mut`, `--text-dim`, `--radius-panel`, `--radius-ctl`).
- Produces: `.chrome` panels share one glass recipe; class contract unchanged.

- [x] **Step 1: Add the sans stack + base type** — in `:root` add
  `--sans: 'Segoe UI Variable Display', 'Segoe UI', system-ui, -apple-system, sans-serif;`
  Switch `body` `font-family` to `var(--sans)`; keep `--mono` for every selector
  that renders numbers/readouts (`output`, `dd`, `.flight-readouts`, clock,
  legend scale, probe values — grep `var(--mono)` and keep those on mono, but
  raise their sizes per the ramp below).
- [x] **Step 2: One glass recipe** — update the shared panel styling (the
  `.chrome` blocks and each panel's own rules) to:
  `background: var(--panel-glass); border: 1px solid var(--panel-edge); border-radius: var(--radius-panel); box-shadow: 0 8px 28px rgba(0,0,0,0.45); backdrop-filter: blur(10px);`
  Buttons/selects/inputs move to `border-radius: var(--radius-ctl)` and
  `background: rgba(146,190,224,0.10)`.
- [x] **Step 3: Type ramp sweep** — raise chrome sizes: eyebrows/labels
  10px→uppercase tracked 0.08em, hints 11px, controls 12.5px, body 13px,
  explanation lead 14.5px/700, panel headers 11px/650. Kill every 7–9px
  font-size in chrome (map-space labels — city markers, graticule — may stay
  9–11px). Primary text colour: `var(--text-hi)`; secondary `var(--text-mut)`;
  keys/hints `var(--text-dim)`; active/focus/links `var(--ui-accent)`.
  The old cyan `var(--text)` remains ONLY in map-space overlays.
- [x] **Step 4: Focus + reduced motion** — every interactive element keeps a
  visible `:focus-visible` outline (`2px solid var(--ui-accent)`); confirm
  existing animations are inside `prefers-reduced-motion` guards (add guards
  where missing — e.g. `city-exposure-pulse`).
- [x] **Step 5: Visual check** — `npm run dev`, screenshot idle + storm
  (`#lat=15.5&lon=64.5&month=4&seed=7`, wait for CAT 3) with the session driver
  (`scratchpad\driver\capture.mjs` pattern: headless Chrome +
  `--use-gl=angle --use-angle=d3d11 --enable-gpu`); compare against
  `test-e.png` for material/type feel. Fix obvious misses.
  **Deviation:** skipped by worker brief; the reviewing judge performs this
  visual check after Task 2.
- [x] **Step 6: Full gates** — `npm test`, `npm run build`, `npm run calibrate:check`.
- [ ] **Step 7: Commit** — `git commit -am "feat: windy-grade panel material and type scale"`

---

### Task 3: Brand pill, hint chips, timeline skeleton (P2)

**Files:**
- Modify: `index.html`, `src/style.css`
- Modify: `src/main.ts` / `src/ui.ts` ONLY if an id lookup breaks (keep ids).

**Interfaces:**
- Produces: `#timeline` bar containing the existing `#flight-toggle`,
  `#flight-scrubber`, `#flight-jumps` (ids unchanged — `main.ts:170-171` and
  `ui.ts:331-332` keep working), plus new empty spans
  `#timeline-clock`, `#timeline-now-kt`, `#timeline-now-hpa`, `#timeline-cat`,
  `#timeline-id` for Task 4.

- [x] **Step 1: Masthead → brand pill** — restructure `#masthead` in
  `index.html`: keep `<h1 id="title">`, `#model-toggle`, and the
  `HF-6 research build` text; arrange as one horizontal pill (wordmark ·
  divider · live dot · build tag · methodology). Add beneath it
  `<p id="guidance-chip" class="chrome">experimental forecast companion — not official guidance</p>`
  (copy exact string from `src/live-product.ts` usage).
- [x] **Step 2: Caption/guide → hint chips** — replace `#interaction-guide`'s
  3-step layout with two chips: `click the sea to spawn your own` (merge with
  `#caption`'s role — keep the `#caption` element itself, main.ts writes to it)
  and `hover · hold to inspect`; move `keys 1–9` into the layer rail footer.
- [x] **Step 3: Timeline bar skeleton** — move the `.flight-transport` block out
  of `#flight-recorder` to the end of `#app` as
  `<footer id="timeline" class="chrome"> [play] [#timeline-clock] [ruler: #flight-scrubber + #flight-jumps] [#timeline-now-kt #timeline-now-hpa #timeline-cat] [#timeline-id + SIMULATED stamp] </footer>`.
  Style full-width bottom, recorder card sits above-left of it. The scrubber
  input styles into the category track container (gradient arrives in Task 4).
- [x] **Step 4: Verify wiring by hand** — `npm run dev`; spawn a storm; pause,
  scrub, and milestone buttons must all still work (they will if ids moved
  intact — `document.getElementById` does not care about position).
- [x] **Step 5: Full gates** — `npm test`, `npm run build`, `npm run calibrate:check`.
- [ ] **Step 6: Commit** — `git commit -am "feat: brand pill, hint chips, bottom timeline bar"`

---

### Task 4: Category-coloured timeline (P2)

**Files:**
- Create: `src/timeline-gradient.ts`
- Test: `test/timeline-gradient.test.ts` (create)
- Modify: `src/main.ts` (or `src/ui.ts`, wherever the flight recorder UI updates
  live — follow the existing `flight-clock`/scrubber update site), `src/style.css`.

**Interfaces:**
- Consumes: `FlightFrame[]` (`vKt`, `ageH`), `stormCategory(vKt).cssVar`-style
  colours via `categoryRgba(vKt, 1)` from `src/category.ts`; Task 3 span ids.
- Produces: `categoryGradientCss(frames: readonly {vKt: number; ageH: number}[]): string`
  returning a `linear-gradient(90deg, ...)` with hard stops.

- [ ] **Step 1: Failing test** — `test/timeline-gradient.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { categoryGradientCss } from '../src/timeline-gradient';

describe('categoryGradientCss', () => {
  it('returns a flat gradient for a single-category tape', () => {
    const css = categoryGradientCss([
      { vKt: 25, ageH: 0 }, { vKt: 30, ageH: 6 }, { vKt: 30, ageH: 12 },
    ]);
    expect(css.startsWith('linear-gradient(90deg,')).toBe(true);
    // one category → exactly one colour, two stops (0% and 100%)
    expect(css.match(/rgba?\(/g)!.length).toBe(2);
  });

  it('emits hard stops at category boundaries in tape order', () => {
    const css = categoryGradientCss([
      { vKt: 25, ageH: 0 },   // td
      { vKt: 45, ageH: 12 },  // ts from 50% of the tape
      { vKt: 70, ageH: 24 },  // cat1 (last frame)
    ]);
    // td colour holds to 50%, ts starts at 50% — hard stop pair present
    expect(css).toContain('50%');
  });

  it('handles an empty tape', () => {
    expect(categoryGradientCss([])).toBe('none');
  });
});
```

- [ ] **Step 2: Run, expect module-not-found fail.**
- [ ] **Step 3: Implement** — `src/timeline-gradient.ts`:

```ts
/**
 * timeline-gradient.ts — paints the flight-recorder tape as a CSS gradient.
 * Pure: frames in, `linear-gradient(...)` string out. The scrubber track uses
 * it so the storm's whole life is category-readable at a glance (design spec
 * 2026-07-26). Hard stops, no blending: category boundaries are discrete.
 */
import { categoryRgba, stormCategory } from './category';

export function categoryGradientCss(
  frames: readonly { vKt: number; ageH: number }[],
): string {
  if (frames.length === 0) return 'none';
  const endH = frames[frames.length - 1].ageH || 1;
  const stops: string[] = [];
  let currentName = stormCategory(frames[0].vKt).name;
  let currentColor = categoryRgba(frames[0].vKt, 1);
  stops.push(`${currentColor} 0%`);
  for (const f of frames) {
    const cat = stormCategory(f.vKt);
    if (cat.name !== currentName) {
      const pct = ((f.ageH / endH) * 100).toFixed(1).replace(/\.0$/, '');
      stops.push(`${currentColor} ${pct}%`, `${categoryRgba(f.vKt, 1)} ${pct}%`);
      currentName = cat.name;
      currentColor = categoryRgba(f.vKt, 1);
    }
  }
  stops.push(`${currentColor} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
```

(Adjust to `StormCategory`'s real field names — check `src/category.ts:14-38`;
if the interface exposes `label` not `name`, use that. The test drives it.)

- [ ] **Step 4: Tests pass** — `npx vitest run test/timeline-gradient.test.ts`.
- [ ] **Step 5: Wire it** — at the existing per-frame flight-recorder UI update
  site (where `#flight-clock` is written): set the ruler track's
  `style.background` from `categoryGradientCss(snapshot.frames)` — regenerate
  only when frame COUNT changes (cache the last count). Fill Task 3's spans:
  `#timeline-clock` ← same string as `#flight-clock`; `#timeline-now-kt` ←
  `${Math.round(vKt)} kt`; `#timeline-now-hpa` ← the pressure readout;
  `#timeline-cat` ← category short label, background `categoryRgba(vKt, 1)`,
  dark text. `#timeline-id` ← the storm label already shown in
  `#flight-label` + a `[SIMULATED]` bordered stamp span (static HTML).
  Style `#flight-jumps` buttons as milestone dots on the ruler.
- [ ] **Step 6: Hand-verify** — dev server: gradient grows live, colours match
  the category chip, scrubbing still works, replay unaffected (tape is
  read-only input).
- [ ] **Step 7: Full gates.**
- [ ] **Step 8: Commit** — `git commit -am "feat: category-coloured timeline track and live cluster"`

---

### Task 5: Layer-rail icons (P3)

**Files:**
- Modify: `src/weather-layers.ts`, `test/weather-layers.test.ts`,
  `src/ui.ts` (button factory near where `#layer-buttons` children are built),
  `src/style.css`.

**Interfaces:**
- Produces: `WeatherLayerDefinition.iconSvg: string` (inline `<svg viewBox="0 0 16 16">…</svg>`, stroke-based, `stroke="currentColor" fill="none"`).

- [ ] **Step 1: Failing test** — extend `test/weather-layers.test.ts`:

```ts
it('every layer carries an inline svg icon', () => {
  for (const layer of WEATHER_LAYERS) {
    expect(layer.iconSvg).toContain('<svg');
    expect(layer.iconSvg).toContain('viewBox="0 0 16 16"');
  }
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — add `iconSvg` to the interface and each of the 9
  definitions. Use the mock's icons verbatim (`direction-e.html`, the
  `.rail .row svg` blocks — wind curves, radar arcs, satellite box, raindrop,
  thermometer, humidity drop, ocean-heat waves, shear arrows, terrain peaks);
  wrap each as
  `<svg viewBox="0 0 16 16" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">…</svg>`.
- [ ] **Step 4: Render them** — in the `ui.ts` layer-button factory, prepend
  `iconSvg` via `insertAdjacentHTML` (trusted static string from our own
  catalogue — note this in a comment), keep label + key numeral. Style rows per
  mock: active row filled `var(--ui-accent)` with dark text + glow; compact
  breakpoints (`style.css:1950`, `style.css:2153`) go icon-only ~40px.
- [ ] **Step 5: Hand-verify** — rail matches mock; keys 1–9 unchanged.
- [ ] **Step 6: Full gates.**
- [ ] **Step 7: Commit** — `git commit -am "feat: icon layer rail"`

---

### Task 6: Storm tag on the eye (P3)

**Files:**
- Create: `src/storm-tag.ts`
- Test: `test/storm-tag.test.ts` (create)
- Modify: `src/ui.ts` (DOM + reprojection), `src/main.ts` (per-frame call),
  `index.html` (container `<div id="storm-tag" hidden>`), `src/style.css`.

**Interfaces:**
- Consumes: storm head state (name/label, `vKt`, pressure hPa, trend kt/h,
  lat/lon) and the existing CSS-pixel projection used by ghost labels
  (`ui.ts:1325` region) — reuse that exact projection helper.
- Produces: `formatStormTag(input: {label: string; vKt: number; hPa: number; trendKtPerH: number}): {line1: string; line2: string}`.

- [ ] **Step 1: Failing test** — `test/storm-tag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatStormTag } from '../src/storm-tag';

describe('formatStormTag', () => {
  it('formats an intensifying cat-3', () => {
    const t = formatStormTag({ label: 'Shaheen', vKt: 111, hPa: 943, trendKtPerH: 0.9 });
    expect(t.line1).toBe('SHAHEEN · 111 kt');
    expect(t.line2).toBe('cat 3 · intensifying · 943 hPa');
  });
  it('names weakening and steady trends', () => {
    expect(formatStormTag({ label: 'x', vKt: 40, hPa: 999, trendKtPerH: -1.2 }).line2)
      .toBe('ts · weakening · 999 hPa');
    expect(formatStormTag({ label: 'x', vKt: 20, hPa: 1005, trendKtPerH: 0.1 }).line2)
      .toBe('td · steady · 1005 hPa');
  });
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — `src/storm-tag.ts` pure module: category short
  label from `stormCategory(vKt)` (lowercased; check its real short-name field),
  trend word: `>= 0.5 → 'intensifying'`, `<= -0.5 → 'weakening'`, else
  `'steady'`.
- [ ] **Step 4: Tests pass.**
- [ ] **Step 5: DOM + projection** — `#storm-tag` chip (two lines + pulsing eye
  ring, border `categoryRgba(vKt, 0.55)`); position each frame alongside the
  ghost-label reprojection using the same lat/lon→CSS-px path, offset above the
  eye, clamped inside the map frame; `hidden` when no live/replay storm. Pulse
  animation inside `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Step 6: Hand-verify** — tag rides the eye during a run and while
  scrubbing a replay; hides on death/reset.
- [ ] **Step 7: Full gates.**
- [ ] **Step 8: Commit** — `git commit -am "feat: storm tag pinned to the eye"`

---

### Task 7: Wind palette retune (P4)

**Files:**
- Modify: `src/tokens.ts` (`wind0..wind4` rgb values), `src/render/particles.ts`
  (trail alpha constant only).

**Interfaces:**
- Consumes: nothing new. Legend gradient + shaders follow tokens automatically.

- [ ] **Step 1: Capture BEFORE** — driver screenshot of the seed-7 Cat-3 wind view.
- [ ] **Step 2: Retune** — raise saturation/luminance of `wind0..wind4` toward
  the mock's filtered look (mock applied `saturate(1.18) brightness(1.06)`
  over `#28386e #2e8796 #58ab58 #e3b939 #cc4078`). Start with:
  `wind0 [45,66,133] · wind1 [46,152,168] · wind2 [94,190,94] · wind3 [242,187,48] · wind4 [224,62,126]`,
  then eyeball against the mock capture and adjust once. In
  `src/render/particles.ts` raise the trail alpha constant modestly (≤ +20%);
  it is render-only — confirm the constant feeds draw colour, not physics.
- [ ] **Step 3: Capture AFTER + compare** — same driver shot; the field should
  read vivid WITHOUT any CSS filter. No `filter:` rules on canvases in
  style.css.
- [ ] **Step 4: Full gates** — including `npm run calibrate:check` and
  `npm run fidelity:check` (palettes are render-only; green proves it).
- [ ] **Step 5: Commit** — `git commit -am "feat: retune wind palette for windy-grade vividness"`

---

### Task 8: Final QA sweep (P4)

**Files:** none new — fixes land where found.

- [ ] **Step 1: Honesty grep** — all of these must appear in rendered UI source:
  `rg -n "simulated rain radar|simulated satellite|HF-6 research build|not official guidance|SIMULATED" index.html src/` — every pre-reskin honesty string still present.
- [ ] **Step 2: Screenshot matrix** — driver captures: idle demo, seed-7 Cat 3
  (wind, ir via key 3, radar via key 2), replay-scrub state, compact viewport
  (900×700). Read each PNG; fix visual bugs found (overlaps, contrast, focus
  rings).
- [ ] **Step 3: A11y pass** — keyboard-only walk: layer keys, tab order through
  timeline controls, dialog open/close; `:focus-visible` visible everywhere.
- [ ] **Step 4: Full gates one last time** — `npm test`, `npm run build`,
  `npm run calibrate:check`, `npm run fidelity:check`.
- [ ] **Step 5: Commit any fixes** — `git commit -am "fix: windy-grade QA sweep"`

---

## Self-review notes

- Spec coverage: P1→T1/T2, P2→T3/T4, P3→T5/T6, P4→T7, verification→T8.
  Compact mode folded into T2/T5. Dialog restyle folded into T2 (glass recipe
  applies to `dialog` selectors). Non-goals excluded.
- Category-scale bar relocation (spec item 4/5): handled in T3 Step 3 by leaving
  `#intensity-scale` inside the recorder's expandable details region — no task
  deletes it.
- Type consistency: `categoryGradientCss` name used in T4 test+impl+wiring;
  `formatStormTag` in T6 test+impl; token keys in T1 test+impl+T2 consumption.
