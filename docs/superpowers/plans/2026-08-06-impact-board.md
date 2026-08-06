# Impact Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One always-visible impact-board panel that shows ranked city exposure, rain/flood vitals, and a live threat headline from spawn through replay — replacing the buried debrief impact report and the conditional impact-live line.

**Architecture:** New `src/impact-board.ts` follows the intensity-sparkline pattern: a pure, node-testable `buildImpactBoardModel()` view-model builder plus a thin `ImpactBoardView` DOM writer keyed on a change-detection string. `ui.ts` builds the model inside `updateFlightRecorder()` (the `FlightRecorderView` already carries everything needed) and deletes the two superseded impact surfaces. Zero changes to `main.ts`, `sim.ts`, `impact.ts`, or any render/calibration surface.

**Tech Stack:** Vanilla TypeScript, vitest (node environment — no DOM in tests), CSS via `src/style.css` P1 section with `src/tokens.ts` custom properties only.

**Worktree:** `D:\personal\wallah-its-windy\.claude\worktrees\feat-impact-hud` (branch `worktree-feat-impact-hud`, based on main `b843cbe`). All commands run from the worktree root.

## Global Constraints

- Zero runtime npm dependencies; dev deps stay vite/typescript/vitest only.
- No `Math.random`, `Date.now`, or device traits anywhere in the new code — the board is pure presentation over recorded/derived views.
- Colours only via tokens: CSS uses existing `--` custom properties from `src/tokens.ts`; TS uses `categoryRgba` from `src/category.ts`. Never hardcode a colour literal in style.css.
- Product honesty copy is load-bearing and must appear exactly: board tag `parametric proxy`; flood line prefix `flash-flood proxy `; no ETA / predicted-landfall strings anywhere (landfall is recorded fact only).
- The masthead `#guidance-chip`, `SIMULATED` timeline stamp, and `#model-dialog` copy are untouched.
- `npm test` and `npm run build` must pass after every task. Machine-generated docs (`docs/fidelity-benchmark.md` etc.) are never hand-edited.
- Conventional commits, no AI attribution.

## File Structure

- **Create `src/impact-board.ts`** — model types, `buildImpactBoardModel()`, `formatLatLon()` (moved from ui.ts), `ImpactBoardView` DOM class. One responsibility: the impact board surface.
- **Create `test/impact-board.test.ts`** — model-builder unit tests (node, no DOM).
- **Modify `src/ui.ts`** — instantiate/feed the board; delete `#impact-live` + `#impact-report` write paths and the `impactCitiesKey` field; share per-city now-winds; re-import `formatLatLon`.
- **Modify `index.html`** — add `#impact-board` skeleton; remove `#impact-report` section (lines ~427–432) and `#impact-live` (line ~348).
- **Modify `src/style.css`** — board styles + analysis-dock shift + responsive strip, appended to the P1 section.
- **Modify `docs/architecture.md`** — impact-presentation row points at the new module.
- **Modify `ROADMAP.md`** — record UX-v2 phase 1 as the shipped step of the at-a-glance program.

---

### Task 1: Model builder (pure logic, TDD)

**Files:**
- Create: `src/impact-board.ts` (model half only — no DOM in this task)
- Create: `test/impact-board.test.ts`
- Modify: `src/ui.ts` (move `formatLatLon` out, re-import; no other change)

**Interfaces:**
- Consumes: `StormState` (`src/types.ts`), `ImpactSummary`, `CityImpact`, `IMPACT_CITIES`, `experiencedWindPhrase`, `floodRiskTier` types (`src/impact.ts`), `StormDebrief` (`src/flight-recorder.ts`), `northIndianOceanClassification`, `SIMULATED_WIND_CONVENTION` (`src/wind-conventions.ts`), `categoryRgba` (`src/category.ts`), `greatCircleKm` (`src/grid.ts`).
- Produces (later tasks rely on these exact names):

```ts
export function formatLatLon(lat: number, lon: number): string; // moved verbatim from ui.ts

export interface ImpactBoardInput {
  storm: StormState | null;
  isDemo: boolean;
  impact: ImpactSummary | null;
  debrief: StormDebrief | null;      // null while the storm is running
  landfallKt: number | null;
  landfallAgeH: number | null;       // hours into the run at landfall, or null
  peakSoFarKt: number;               // max recorded 1-min wind so far
  nowWindsKt: ReadonlyMap<string, number>; // city id -> displayed-frame wind
}

export interface ImpactBoardCityRow {
  id: string;
  label: string;
  nowText: string;   // "62 kt" | "—" when 0
  peakText: string;  // "97 kt"
  rainText: string;  // "182 mm"
  tint: string | null; // categoryRgba(peakKt, 0.18) when peakKt >= 20, else null
}

export interface ImpactBoardModel {
  visible: boolean;              // false -> every other field is empty/default
  headline: string;
  peakText: string;              // "97 kt 1-min"
  landfallText: string;          // fact only, see rules below
  rainText: string;              // "max 182 mm over land"
  floodRisk: 'minimal' | 'moderate' | 'high' | 'extreme' | null;
  floodText: string;             // "flash-flood proxy high"
  rows: ImpactBoardCityRow[];    // always all 8 cities when visible
  allClearText: string | null;   // "no damaging winds reached any city"
  key: string;                   // change-detection key over all displayed text
}

export function buildImpactBoardModel(input: ImpactBoardInput): ImpactBoardModel;
```

**Model rules (implement exactly):**
- `visible` is false when `storm === null`, `isDemo`, or `impact === null`.
- Headline, storm running (`debrief === null`): reuse the logic currently at `src/ui.ts:1146–1163` — if `impact.live` and `live.peakWindKt >= 20`: `` `${live.city.label} · ${km} km · ${experiencedWindPhrase(live.peakWindKt)} so far · ${rain} mm rain` `` (km = `Math.round(greatCircleKm(storm, live.city))`, rain = `Math.round(live.rainMm)`); if `impact.live` under 20 kt: `` `watching ${live.city.label} · ${km} km out` ``; if `impact.live === null`: `` `open water · no city in the storm's reach` ``.
- Headline, complete (`debrief !== null`): move the logic at `src/ui.ts:1219–1235` verbatim — landfall + `landfallKt` branch produces `` `ashore in the indicative ${name} band · ${kt} kt 1-min near ${formatLatLon(...)}` ``; otherwise the `stayed offshore …` muscat-distance branches.
- `peakText`: `` `${Math.round(debrief ? debrief.death.peakKt : peakSoFarKt)} kt 1-min` ``.
- `landfallText`: if `debrief?.landfall` → `` `ashore${landfallAgeH === null ? '' : ` +${Math.round(landfallAgeH)} h`} near ${formatLatLon(debrief.landfall.lat, debrief.landfall.lon)}` ``; else if `debrief` (complete, no landfall) → `none · stayed offshore`; else → `over water`. NEVER an ETA.
- `rainText`: `` `max ${Math.round(impact.maxLandRainMm)} mm over land` ``; `floodText`: `` `flash-flood proxy ${impact.floodRisk}` ``.
- Rows: one per `IMPACT_CITIES` entry (all 8). `nowKt = nowWindsKt.get(city.id) ?? 0`; peak/rain/closest come from the matching `impact.cities` entry (missing → 0/0/Infinity). Sort: nowKt desc, then peakKt desc, then closestKm asc, then catalogue order. `nowText` is `—` when `Math.round(nowKt) === 0`, else `` `${Math.round(nowKt)} kt` ``. `tint = peakKt >= 20 ? categoryRgba(peakKt, 0.18) : null`.
- `allClearText` = `no damaging winds reached any city` when every peak < 20 kt, else null.
- `key`: `[headline, peakText, landfallText, rainText, floodText, allClearText ?? '', ...rows.map(r => `${r.id}:${r.nowText}:${r.peakText}:${r.rainText}`)].join('|')` — every displayed string participates.

- [ ] **Step 1: Write the failing tests**

Create `test/impact-board.test.ts`. Build inputs with a tiny helper; you need a minimal `StormState` and `ImpactSummary` — construct plain objects with only the fields the builder reads (`storm.lat/lon`), cast through `as unknown as StormState` like other suites do for view fixtures. Real code (adapt city ids to the catalogue: muscat, sur, masirah, duqm, salalah, gwadar, karachi, chabahar):

```ts
import { describe, expect, it } from 'vitest';
import {
  buildImpactBoardModel,
  formatLatLon,
  type ImpactBoardInput,
} from '../src/impact-board';
import { IMPACT_CITIES, type ImpactSummary } from '../src/impact';
import type { StormState } from '../src/types';
import type { StormDebrief } from '../src/flight-recorder';

const storm = { lat: 20.0, lon: 60.0, alive: true } as unknown as StormState;

function summaryWith(over: Partial<ImpactSummary> = {}): ImpactSummary {
  return {
    cities: IMPACT_CITIES.map((city) => ({
      city,
      peakWindKt: 0,
      closestKm: Number.POSITIVE_INFINITY,
      rainMm: 0,
    })),
    maxLandRainMm: 0,
    floodRisk: 'minimal',
    live: null,
    ...over,
  };
}

function inputWith(over: Partial<ImpactBoardInput> = {}): ImpactBoardInput {
  return {
    storm,
    isDemo: false,
    impact: summaryWith(),
    debrief: null,
    landfallKt: null,
    landfallAgeH: null,
    peakSoFarKt: 45,
    nowWindsKt: new Map(),
    ...over,
  };
}

describe('impact board model', () => {
  it('hides without a storm, on demo, or without impact data', () => {
    expect(buildImpactBoardModel(inputWith({ storm: null })).visible).toBe(false);
    expect(buildImpactBoardModel(inputWith({ isDemo: true })).visible).toBe(false);
    expect(buildImpactBoardModel(inputWith({ impact: null })).visible).toBe(false);
    expect(buildImpactBoardModel(inputWith()).visible).toBe(true);
  });

  it('ranks rows by now-wind, then peak, then closest approach, then catalogue', () => {
    const impact = summaryWith();
    const sur = impact.cities.find((c) => c.city.id === 'sur')!;
    const duqm = impact.cities.find((c) => c.city.id === 'duqm')!;
    const masirah = impact.cities.find((c) => c.city.id === 'masirah')!;
    sur.peakWindKt = 80;      // high peak, no current wind
    duqm.peakWindKt = 40;     // lower peak but current wind below
    masirah.peakWindKt = 40;  // ties duqm on peak, closer approach
    duqm.closestKm = 120;
    masirah.closestKm = 60;
    const model = buildImpactBoardModel(
      inputWith({ impact, nowWindsKt: new Map([['duqm', 55], ['masirah', 55]]) }),
    );
    const order = model.rows.map((row) => row.id);
    // duqm & masirah lead on now-wind (tie) -> equal peaks -> masirah closer
    expect(order.slice(0, 3)).toEqual(['masirah', 'duqm', 'sur']);
    expect(model.rows).toHaveLength(IMPACT_CITIES.length);
  });

  it('live headline tracks the most exposed city and never shows an ETA', () => {
    const impact = summaryWith();
    const live = impact.cities.find((c) => c.city.id === 'masirah')!;
    live.peakWindKt = 52;
    live.rainMm = 31.6;
    impact.live = live;
    const model = buildImpactBoardModel(inputWith({ impact }));
    expect(model.headline).toContain('masirah');
    expect(model.headline).toContain('so far');
    expect(model.landfallText).toBe('over water');
    expect(model.key).not.toContain('eta');
  });

  it('watching-state headline when the live city is under 20 kt', () => {
    const impact = summaryWith();
    const live = impact.cities.find((c) => c.city.id === 'sur')!;
    live.peakWindKt = 8;
    impact.live = live;
    const model = buildImpactBoardModel(inputWith({ impact }));
    expect(model.headline).toMatch(/^watching sur · \d+ km out$/);
  });

  it('open-water headline when nothing is in reach', () => {
    const model = buildImpactBoardModel(inputWith());
    expect(model.headline).toBe("open water · no city in the storm's reach");
  });

  it('landfall vitals are recorded fact, with hour offset when known', () => {
    const debrief = {
      death: { peakKt: 97.2, durationH: 139, closestApproachKm: 42, reason: 0 },
      landfall: { lat: 19.71, lon: 57.42 },
    } as unknown as StormDebrief;
    const withAge = buildImpactBoardModel(
      inputWith({ debrief, landfallKt: 88, landfallAgeH: 38.4 }),
    );
    expect(withAge.landfallText).toBe(
      `ashore +38 h near ${formatLatLon(19.71, 57.42)}`,
    );
    const noAge = buildImpactBoardModel(
      inputWith({ debrief, landfallKt: 88, landfallAgeH: null }),
    );
    expect(noAge.landfallText).toBe(`ashore near ${formatLatLon(19.71, 57.42)}`);
    expect(withAge.peakText).toBe('97 kt 1-min');
  });

  it('no-landfall completion reads none · stayed offshore', () => {
    const debrief = {
      death: { peakKt: 61, durationH: 80, closestApproachKm: 310, reason: 0 },
      landfall: null,
    } as unknown as StormDebrief;
    const model = buildImpactBoardModel(inputWith({ debrief }));
    expect(model.landfallText).toBe('none · stayed offshore');
    expect(model.headline).toContain('stayed offshore');
  });

  it('flood vitals pass through every tier', () => {
    for (const [mm, tier] of [
      [10, 'minimal'],
      [45, 'moderate'],
      [110, 'high'],
      [220, 'extreme'],
    ] as const) {
      const impact = summaryWith({ maxLandRainMm: mm, floodRisk: tier });
      const model = buildImpactBoardModel(inputWith({ impact }));
      expect(model.floodRisk).toBe(tier);
      expect(model.floodText).toBe(`flash-flood proxy ${tier}`);
      expect(model.rainText).toBe(`max ${mm} mm over land`);
    }
  });

  it('all-clear line appears only when no city peak reaches 20 kt', () => {
    expect(buildImpactBoardModel(inputWith()).allClearText).toBe(
      'no damaging winds reached any city',
    );
    const impact = summaryWith();
    impact.cities[0].peakWindKt = 25;
    expect(buildImpactBoardModel(inputWith({ impact })).allClearText).toBeNull();
  });

  it('key is stable for identical inputs and moves on any visible change', () => {
    const a = buildImpactBoardModel(inputWith());
    const b = buildImpactBoardModel(inputWith());
    expect(a.key).toBe(b.key);
    const c = buildImpactBoardModel(
      inputWith({ nowWindsKt: new Map([['muscat', 30]]) }),
    );
    expect(c.key).not.toBe(a.key);
  });

  it('now column follows the provided frame winds (replay scrub)', () => {
    const model = buildImpactBoardModel(
      inputWith({ nowWindsKt: new Map([['muscat', 41.6]]) }),
    );
    const muscat = model.rows.find((row) => row.id === 'muscat')!;
    expect(muscat.nowText).toBe('42 kt');
    const zero = buildImpactBoardModel(inputWith());
    expect(zero.rows.every((row) => row.nowText === '—')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with "Cannot find module '../src/impact-board'"**

Run: `npx vitest run test/impact-board.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the model half of `src/impact-board.ts`**

Move `formatLatLon` from `src/ui.ts` (find it with `grep -n "function formatLatLon" src/ui.ts`; move the function body verbatim, `export` it) and add `import { formatLatLon } from './impact-board';` to ui.ts's import block. Then implement the interfaces and `buildImpactBoardModel` per the Model rules above. Module header comment: one paragraph saying this is the single always-visible impact surface, pure view-model + thin DOM view, and that recorded output never reads it.

- [ ] **Step 4: Run the new tests and the full suite**

Run: `npx vitest run test/impact-board.test.ts` → all pass.
Run: `npm test` → 614 + new tests pass (formatLatLon move must not break ui.ts).
Run: `npm run build` → tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/impact-board.ts test/impact-board.test.ts src/ui.ts
git commit -m "feat: add impact-board view-model builder"
```

---

### Task 2: DOM skeleton + wiring (board in, old surfaces out)

**Files:**
- Modify: `src/impact-board.ts` (add `ImpactBoardView` class)
- Modify: `index.html` (add board aside; remove `#impact-report` section ~lines 427–432 and `#impact-live` ~line 348)
- Modify: `src/ui.ts` (feed the board from `updateFlightRecorder`; delete superseded write paths)

**Interfaces:**
- Consumes: `buildImpactBoardModel`, `ImpactBoardModel` from Task 1; `openCityDetail(cityId)` (private method, `src/ui.ts:529`).
- Produces:

```ts
export interface ImpactBoardElements {
  root: HTMLElement;          // #impact-board
  headline: HTMLElement;      // #impact-board-headline
  peak: HTMLElement;          // #impact-board-peak
  landfall: HTMLElement;      // #impact-board-landfall
  rain: HTMLElement;          // #impact-board-rain
  flood: HTMLElement;         // #impact-board-flood
  cities: HTMLElement;        // #impact-board-cities
  allClear: HTMLElement;      // #impact-board-allclear
}
export class ImpactBoardView {
  constructor(elements: ImpactBoardElements, onCitySelect: (cityId: string) => void);
  update(model: ImpactBoardModel): void; // no-op unless model.key changed
}
```

- [ ] **Step 1: Add the skeleton to `index.html`**

Insert after the `#flight-recorder` section closes (after line ~485), before `#analysis-dock`:

```html
<!-- Impact board: the ONE always-visible storm-effects surface. Appears on
     spawn, persists through completion and replay; parametric proxies only,
     never observations (see spec 2026-08-06-impact-board-ux-v2-design). -->
<aside id="impact-board" class="chrome" aria-label="Storm impact board" hidden>
  <header class="impact-board-head">
    <span>impact board</span>
    <span class="impact-board-tag">parametric proxy</span>
  </header>
  <p id="impact-board-headline" aria-live="polite">—</p>
  <dl class="impact-board-vitals">
    <div><dt>peak</dt><dd id="impact-board-peak">—</dd></div>
    <div><dt>landfall</dt><dd id="impact-board-landfall">—</dd></div>
    <div><dt>rain</dt><dd id="impact-board-rain">—</dd></div>
  </dl>
  <p id="impact-board-flood" data-risk="minimal">—</p>
  <div id="impact-board-cities" role="list" aria-label="Ranked city exposure"></div>
  <p id="impact-board-allclear" hidden></p>
</aside>
```

Remove the whole `<section id="impact-report" …>…</section>` block and the `<p id="impact-live" hidden></p>` line from the flight recorder.

- [ ] **Step 2: Implement `ImpactBoardView` in `src/impact-board.ts`**

```ts
export class ImpactBoardView {
  private key = '';
  constructor(
    private readonly el: ImpactBoardElements,
    private readonly onCitySelect: (cityId: string) => void,
  ) {}

  update(model: ImpactBoardModel): void {
    this.el.root.hidden = !model.visible;
    if (!model.visible) {
      this.key = '';
      return;
    }
    if (model.key === this.key) return;
    this.key = model.key;
    this.el.headline.textContent = model.headline;
    this.el.peak.textContent = model.peakText;
    this.el.landfall.textContent = model.landfallText;
    this.el.rain.textContent = model.rainText;
    this.el.flood.dataset.risk = model.floodRisk ?? 'minimal';
    this.el.flood.textContent = model.floodText;
    this.el.allClear.hidden = model.allClearText === null;
    this.el.allClear.textContent = model.allClearText ?? '';
    this.el.cities.replaceChildren(
      ...model.rows.map((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'impact-board-row';
        button.setAttribute('role', 'listitem');
        if (row.tint) button.style.setProperty('--row-tint', row.tint);
        const label = document.createElement('span');
        label.textContent = row.label;
        const now = document.createElement('output');
        now.textContent = row.nowText;
        const peak = document.createElement('span');
        peak.textContent = row.peakText;
        const rain = document.createElement('span');
        rain.textContent = row.rainText;
        button.append(label, now, peak, rain);
        button.addEventListener('click', () => this.onCitySelect(row.id));
        return button;
      }),
    );
  }
}
```

- [ ] **Step 3: Wire it in `src/ui.ts`**

1. Import `buildImpactBoardModel` and `ImpactBoardView` (formatLatLon import exists from Task 1).
2. Add a field and construct in the constructor (near the other `dom()` lookups):

```ts
private readonly impactBoard = new ImpactBoardView(
  {
    root: dom('impact-board'),
    headline: dom('impact-board-headline'),
    peak: dom('impact-board-peak'),
    landfall: dom('impact-board-landfall'),
    rain: dom('impact-board-rain'),
    flood: dom('impact-board-flood'),
    cities: dom('impact-board-cities'),
    allClear: dom('impact-board-allclear'),
  },
  (cityId) => this.openCityDetail(cityId),
);
```

3. Share now-winds: add `private cityNowWindsKt = new Map<string, number>();` and inside `updateCityMarkers` (the existing per-city loop at ~L513) write `this.cityNowWindsKt.set(city.id, currentWindKt);` — one computation feeds markers, detail card, and board.
4. In `updateFlightRecorder`: in the early-return branch (`!storm || storm.isDemo`, ~L966) add `this.impactBoard.update(buildImpactBoardModel({ storm: null, isDemo: true, impact: null, debrief: null, landfallKt: null, landfallAgeH: null, peakSoFarKt: 0, nowWindsKt: this.cityNowWindsKt }));` before the return. After the debrief block, add:

```ts
const landfallAgeH =
  view.milestones?.landfall != null
    ? (view.intensitySeries[view.milestones.landfall]?.ageH ?? null)
    : null;
let peakSoFarKt = storm.vKt;
for (const point of view.intensitySeries) {
  if (point.vKt > peakSoFarKt) peakSoFarKt = point.vKt;
}
this.impactBoard.update(
  buildImpactBoardModel({
    storm,
    isDemo: storm.isDemo === true,
    impact: view.impact,
    debrief: view.debrief,
    landfallKt: view.landfallKt,
    landfallAgeH,
    peakSoFarKt,
    nowWindsKt: this.cityNowWindsKt,
  }),
);
```

5. Delete the `#impact-live` block (~L1146–1163), the `#impact-report` block (~L1215–1270), the `impactCitiesKey` field (~L295), and the corresponding `impactLive`/`impactReport`/`impactHeadline`/`impactCities`/`impactFlood` entries from the `flight` struct type and its `dom()` initializers. `tsc` (via `npm run build`) is the safety net for leftovers.

- [ ] **Step 4: Verify**

Run: `npm test` → green. Run: `npm run build` → tsc clean (this catches any missed struct field). Run `grep -rn "impact-report\|impact-live\|impactCitiesKey" src/ index.html` → zero hits (style.css hits get cleaned in Task 3).

- [ ] **Step 5: Commit**

```bash
git add index.html src/impact-board.ts src/ui.ts
git commit -m "feat: mount the always-visible impact board, retire buried report"
```

---

### Task 3: Styling + layout (desktop row, dock shift, mobile strip)

**Files:**
- Modify: `src/style.css` (append to the P1 section at the end of the file; delete orphaned `#impact-report`/`#impact-live` rules)

**Interfaces:**
- Consumes: DOM structure from Task 2; existing custom properties (inspect `:root` output of `injectCssVars` in `src/tokens.ts` — use the same var names neighbouring chrome panels use, e.g. the recorder's background/border/text vars); existing `#impact-flood[data-risk=…]` colour pattern (copy its var usage for `#impact-board-flood`).
- Produces: final selectors `#app #impact-board`, `.impact-board-head`, `.impact-board-tag`, `.impact-board-vitals`, `#impact-board-flood[data-risk]`, `.impact-board-row`, mobile `#impact-board[data-expanded]`.

- [ ] **Step 1: Find the mechanism the analysis dock uses to sit beside the recorder**

Run: `grep -n "analysis-dock" src/style.css | tail -20` and read the rule near line ~3044 (`left: 404px` when the recorder is visible). Note the exact selector mechanism (`:has()` or sibling class) — reuse the identical mechanism for the board.

- [ ] **Step 2: Append the board styles**

Desktop (mirror the recorder's chrome look — same background/border/backdrop vars it uses; read `#app #flight-recorder`'s P1 block first and copy its var choices):

```css
/* Impact board: bottom instrument row, physics (recorder) -> effects (board). */
#app #impact-board {
  left: 404px;
  bottom: 96px;
  width: 340px;
  max-height: min(60dvh, 520px);
  overflow-y: auto;
  z-index: 6;
  /* background/border/padding: copy the exact declarations from #app #flight-recorder */
}
#app #impact-board .impact-board-tag { /* small caps tag, same treatment as .rail-head second span */ }
#app #impact-board .impact-board-vitals { display: grid; grid-template-columns: repeat(3, 1fr); }
#app #impact-board .impact-board-row {
  display: grid;
  grid-template-columns: 1fr 3.5em 3.5em 4em;
  background: var(--row-tint, transparent);
}
```

Flood chip: copy the existing `#impact-flood[data-risk='…']` rules (they will be orphaned after Task 2) and re-target them to `#impact-board-flood[data-risk='…']`, then delete the orphaned `#impact-report` / `#impact-live` / old `#impact-flood` / `.impact-grid` rules.

Analysis dock: using the mechanism found in Step 1, when recorder AND board are both visible move the dock to `left: 768px` (404 + 340 + 24 gap); when only the recorder is visible it stays at 404px.

- [ ] **Step 3: Responsive rules**

- `max-width: 1282px`: board `width: 300px`; dock shift becomes `left: 728px`.
- `max-width: 820px`: board becomes the strip — `left: 8px; right: 8px; width: auto; bottom: 148px` (recorder sits at bottom:78 spanning full width; the strip stacks above it); hide `.impact-board-vitals`, `#impact-board-cities`, `#impact-board-allclear` unless `#impact-board[data-expanded='true']`; header row + headline + flood chip always visible. Add a tap handler in Task 2's view? No — simplest: make the whole header a toggle only on coarse pointers via a click listener added in `ImpactBoardView`'s constructor (`this.el.root.querySelector('header')`) that flips `data-expanded`; it is inert on desktop because the CSS only reacts under the breakpoint. Add that listener now (edit `src/impact-board.ts`, 3 lines) if not already present.
- `max-width: 600px`: same strip; expanded state `max-height: 50dvh; overflow-y: auto`.
- Check the `#hint-chips` / recorder stacking rules at ~style.css:2917–2929 and :3311 — if the strip overlaps hint chips at ≤820px, hide `#hint-chips` when the board is visible using the same mechanism as the existing recorder-visibility rule at :3311.

- [ ] **Step 4: Visual verification (real app)**

Run: `npm run dev` (background), open http://localhost:5173, spawn a storm (click the sea), confirm: board appears beside the recorder; rows rank live; flood chip colours; completion keeps the panel; replay scrub moves the now column; narrow the window to phone width and confirm the strip + expand toggle. Take it through the layer rail states (satellite workbench open) at 1280×800 to confirm no overlap. Kill the dev server after.

- [ ] **Step 5: Full check + commit**

Run: `npm test && npm run build`. Then:

```bash
git add src/style.css src/impact-board.ts
git commit -m "feat: style the impact board row and mobile strip"
```

---

### Task 4: Docs, roadmap, PR

**Files:**
- Modify: `docs/architecture.md` (the "where to change what" table: impact/city row now points at `src/impact-board.ts` for presentation; note the report/live-line removal)
- Modify: `ROADMAP.md` (record UX-v2 phase 1 shipped; phases 2–4 reference the spec `docs/superpowers/specs/2026-08-06-impact-board-ux-v2-design.md`)

- [ ] **Step 1: Update the two docs**

In `docs/architecture.md`, find the impact-presentation row (`grep -n "impact" docs/architecture.md`) and rewrite it to: presentation lives in `src/impact-board.ts` (model + view) fed from `ui.ts:updateFlightRecorder`; `impact.ts` remains the deterministic ledger; the debrief impact report and `#impact-live` no longer exist. In `ROADMAP.md`, under the delivered-record section add one line for the impact board (date, PR) and under "Next" annotate the pan/zoom camera item as phase 2 of the UX-v2 spec.

- [ ] **Step 2: Final verification sweep**

```bash
npm test && npm run build
git log --oneline main..HEAD          # docs spec + 3 feature commits expected
git diff main...HEAD --stat           # confirm no file outside the planned set
```

Also confirm untouched: `src/sim.ts`, `src/impact.ts`, `src/main.ts`, `calibration/`, `bake/` — `git diff main...HEAD --name-only` must not list them (except `src/ui.ts`, `src/impact-board.ts`, `test/impact-board.test.ts`, `index.html`, `src/style.css`, the two docs, and the spec/plan files).

- [ ] **Step 3: Commit docs, push, open PR**

```bash
git add docs/architecture.md ROADMAP.md
git commit -m "docs: record the impact board in architecture map and roadmap"
git push -u origin worktree-feat-impact-hud:feat/impact-board
gh pr create --head feat/impact-board --title "feat: always-visible impact board (UX v2 phase 1)" --body "<summary + test plan per repo convention>"
```

PR body: what/why (spec link), the four-phase UX-v2 framing, test plan (new unit suite, full `npm test`, `npm run build`, manual visual pass incl. mobile strip), and the explicit note that sim/calibration surfaces are untouched so `calibrate:check` and HF-6 gates are unaffected.

---

## Self-Review (performed at write time)

- **Spec coverage:** placement/dock-shift (T3), header+tag (T2/T3), headline states (T1), vitals incl. landfall-fact rule (T1), ranked 8-city table + tint + row-click→city-detail (T1/T2), dedupe removals (T2), responsive strip (T3), error states (T1 visibility rules), testing section (T1 tests + T3 manual pass), acceptance criteria (T4 sweep). Phases 2–4 are contract-only in the spec — no tasks, correct.
- **Placeholders:** the two "copy the exact declarations from…" notes are deliberate read-the-neighbour instructions with exact source locations, not TBDs; CSS var names intentionally deferred to the token source of truth rather than guessed wrong here.
- **Type consistency:** `ImpactBoardInput`/`ImpactBoardModel`/`ImpactBoardElements`/`ImpactBoardView.update` names match across Tasks 1–3; `openCityDetail` exists at ui.ts:529; `FlightRecorderView` fields used (milestones, intensitySeries, landfallKt, impact, debrief) all exist at ui.ts:146–169.
