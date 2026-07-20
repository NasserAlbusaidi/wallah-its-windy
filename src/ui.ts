/**
 * ui.ts — the instrument's UI brain (design tasks T1–T3, T6; eng task T8 UI half).
 *
 * main.ts is the composition root: it owns the GL context, the fixed-dt loop and
 * the sim/render wiring. This module owns everything the human reads or clicks —
 * the loading progress, the demo-vs-idle captions, the land-click ripple, the
 * storm epitaph, the landfall-rarity copy, the month re-spawn, the slow-mo
 * pacing decision and the spawn-identity bookkeeping — as one cohesive controller
 * so main stays a thin shell.
 *
 * Everything here is pure presentation + intent: it never touches WebGL and never
 * runs physics. It returns SpawnParams for main to feed the SimEngine, and reads
 * back StormState / SimEvent to narrate what the physics decided.
 *
 * Contracts consumed: types.ts (LAW), grid.ts (all coordinate math), rng.ts
 * (HashState). No coordinate arithmetic is done inline — it routes through grid.
 */

import type {
  BinLayer,
  LatLon,
  SimEvent,
  SpawnParams,
  StormDeath,
  StormState,
  UiState,
} from './types';
import { DeathReason, AFTERMATH_FADE_MS } from './types';
import { randomSeed, type HashState } from './rng';
import { latLonToCell, latLonToClip } from './grid';
import { TOKENS } from './tokens';
import type { GhostLabelAnchor } from './tracks';
import type { RunComparison } from './comparison';
import {
  compassDirection,
  type ReplayMilestones,
  type StormDebrief,
} from './flight-recorder';
import { explainIntensity } from './narrative';

// Overlay colours are DERIVED from the one token source (design task T5) — never
// hardcoded — so retuning tokens.ts moves the genesis glow and the ripple too.
const GENESIS_RGB = channels(TOKENS.genesis.rgba01);
const GENESIS_ALPHA = TOKENS.genesis.rgba01[3];
const TRACK_RGB = channels(TOKENS.track.rgba01);

function channels(rgba01: Float32Array): string {
  return `${Math.round(rgba01[0] * 255)},${Math.round(rgba01[1] * 255)},${Math.round(rgba01[2] * 255)}`;
}
/** `rgba(...)` from the genesis token's channels at alpha `a`. */
function genesisRgba(a: number): string {
  return `rgba(${GENESIS_RGB},${a})`;
}
/** `rgba(...)` from the track token's channels at alpha `a`. */
function trackRgba(a: number): string {
  return `rgba(${TRACK_RGB},${a})`;
}

function dom<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`ui: missing #${id}`);
  return element as T;
}

// ---------------------------------------------------------------------------
// Tunables (by eye; the design doc owns the intent, these are the knobs)
// ---------------------------------------------------------------------------

/**
 * Fixed demo storm identity — same every visit. CURATED, not arbitrary: a seed
 * scan over the bilinearly sampled real May fields (test probe, 2026-07-20) picked
 * the storm that makes Omani landfall with the wadi payoff: spawn (17.5N, 61E),
 * May, seed 671 (synoptic plane 3) -> ~7.7 d life, peak ~109 kt, dies over the
 * Sharqiya coast ~246 km from Muscat. The integration test pins this outcome so
 * a re-bake that reshuffles sample years cannot silently kill the demo.
 */
export const DEMO_SEED = 671;
export const DEMO_GENESIS: LatLon = { lat: 17.5, lon: 61.0 };
/** Demo month (May, 0-indexed 4): the real pre-monsoon cyclone window. */
export const DEMO_MONTH = 4;

/** Storm center this close to a coast → drop to landfall-climax slow-mo. */
const SLOWMO_COAST_KM = 150;
/** Normal pacing and landfall-climax pacing, simulated hours per real second. */
export const NORMAL_HOURS_PER_SEC = 3;
export const SLOWMO_HOURS_PER_SEC = 1;

/** Land-click acknowledgement ripple lifetime, ms. */
const RIPPLE_MS = 700;
/** How long a transient caption (e.g. land-click ack) shows before reverting, ms. */
const ACK_MS = 1600;

/** Post-demo idle copy — frames landfall rarity as the lesson (eng task T8). */
const RARITY_COPY = "most storms miss — that's why Gonu was historic. click the sea to try again.";
const FIRST_HINT = 'click the sea to spawn your own.';
const SHARED_HINT = 'shared storm loaded. click the sea to spawn your own.';
const LAND_ACK = 'storms are born at sea. click the open water.';
const ALIVE_HINT = 'let it take course…';

// ---------------------------------------------------------------------------
// Host wiring
// ---------------------------------------------------------------------------

/** The DOM + environment handles main hands the controller at construction. */
export interface UiHost {
  captionEl: HTMLElement;
  progressEl: HTMLElement;
  overlayCanvas: HTMLCanvasElement;
  overlayCtx: CanvasRenderingContext2D;
  monthSelect: HTMLSelectElement;
  /** prefers-reduced-motion: dampens ripple animation here, drives FrameState in main. */
  reducedMotion: boolean;
}

/** Per-frame presentation state for the live tape and post-storm transport. */
export interface FlightRecorderView {
  storm: StormState | null;
  label: string;
  frameIndex: number;
  frameCount: number;
  debrief: StormDebrief | null;
  milestones: ReplayMilestones | null;
  paused: boolean;
  replayMode: boolean;
  replayPlaying: boolean;
  counterfactual: boolean;
  comparisonActive: boolean;
  comparison: RunComparison | null;
}

interface Ripple {
  lat: number;
  lon: number;
  startMs: number;
}

/**
 * The single UI controller. main constructs one, forwards DOM events to it, and
 * asks it (a) what to spawn and (b) what to draw on the 2D overlay each frame.
 */
export class UiController {
  private readonly host: UiHost;
  private readonly flight: {
    root: HTMLElement;
    status: HTMLElement;
    clock: HTMLOutputElement;
    label: HTMLElement;
    explanation: HTMLElement;
    explanationHeadline: HTMLElement;
    explanationDetail: HTMLElement;
    contract: HTMLElement;
    trend: HTMLOutputElement;
    ocean: HTMLOutputElement;
    sst: HTMLOutputElement;
    shear: HTMLOutputElement;
    landDry: HTMLOutputElement;
    steering: HTMLOutputElement;
    debrief: HTMLElement;
    verdict: HTMLElement;
    peak: HTMLElement;
    life: HTMLElement;
    muscat: HTMLElement;
    landfall: HTMLElement;
    compareRow: HTMLElement;
    compare: HTMLElement;
    comparisonRoot: HTMLElement;
    comparisonLabels: HTMLElement;
    comparisonPeak: HTMLElement;
    comparisonLife: HTMLElement;
    comparisonMuscat: HTMLElement;
    comparisonLandfall: HTMLElement;
    compareClear: HTMLButtonElement;
    toggle: HTMLButtonElement;
    scrubber: HTMLInputElement;
    jumps: HTMLElement;
    landfallJump: HTMLButtonElement;
  };
  private state: UiState = { kind: 'loading', progress: 0 };
  private ripples: Ripple[] = [];
  /** Identity of the currently active storm, for month re-spawn + share hash. */
  private lastSpawn: SpawnParams | null = null;
  /** Baked land mask once terrain.bin lands; until then the analytic fallback runs. */
  private landMask: BinLayer | null = null;
  /** Historic genesis points (IBTrACS); drawn as a faint glow on the overlay. */
  private genesis: LatLon[] = [];
  private ackTimer: number | null = null;
  /** A baked file failed to parse (stale/corrupt): pin an error caption over hints. */
  private dataError = false;
  /** Ghost-track label anchors (peak-wind in-domain point per historic storm). */
  private ghostAnchors: GhostLabelAnchor[] = [];
  /** DOM label elements keyed by storm id, inside {@link ghostContainer}. */
  private ghostLabels = new Map<string, HTMLElement>();
  /** Lazily-created wrapper that holds the ghost label elements. */
  private ghostContainer: HTMLElement | null = null;
  /** Which ghost is the active scenario (brighter label); null = none. */
  private activeGhostId: string | null = null;

  constructor(host: UiHost) {
    this.host = host;
    this.flight = {
      root: dom('flight-recorder'),
      status: dom('flight-status'),
      clock: dom('flight-clock'),
      label: dom('flight-label'),
      explanation: dom('flight-explanation'),
      explanationHeadline:
        dom('flight-explanation').querySelector<HTMLElement>('strong')!,
      explanationDetail:
        dom('flight-explanation').querySelector<HTMLElement>('span')!,
      contract: dom('flight-contract'),
      trend: dom('flight-trend'),
      ocean: dom('flight-ocean'),
      sst: dom('flight-sst'),
      shear: dom('flight-shear'),
      landDry: dom('flight-land-dry'),
      steering: dom('flight-steering'),
      debrief: dom('flight-debrief'),
      verdict: dom('flight-verdict'),
      peak: dom('debrief-peak'),
      life: dom('debrief-life'),
      muscat: dom('debrief-muscat'),
      landfall: dom('debrief-landfall'),
      compareRow: dom('debrief-compare-row'),
      compare: dom('debrief-compare'),
      comparisonRoot: dom('run-comparison'),
      comparisonLabels: dom('comparison-labels'),
      comparisonPeak: dom('comparison-peak'),
      comparisonLife: dom('comparison-life'),
      comparisonMuscat: dom('comparison-muscat'),
      comparisonLandfall: dom('comparison-landfall'),
      compareClear: dom('compare-clear'),
      toggle: dom('flight-toggle'),
      scrubber: dom('flight-scrubber'),
      jumps: dom('flight-jumps'),
      landfallJump: dom('flight-landfall'),
    };

    const details = dom<HTMLButtonElement>('flight-details-toggle');
    details.addEventListener('click', () => {
      const expanded = this.flight.root.dataset.expanded !== 'true';
      this.flight.root.dataset.expanded = String(expanded);
      details.setAttribute('aria-expanded', String(expanded));
      details.textContent = expanded ? 'less' : 'details';
    });

    const modelToggle = dom<HTMLButtonElement>('model-toggle');
    const modelDialog = dom<HTMLDialogElement>('model-dialog');
    modelToggle.addEventListener('click', () => modelDialog.showModal());
  }

  // -------------------------------------------------------------------------
  // Loading (design task T2)
  // -------------------------------------------------------------------------

  /** Update the thin cyan progress line and the loading state. `frac` in [0,1]. */
  reportProgress(frac: number): void {
    const clamped = Math.max(0, Math.min(1, frac));
    this.host.progressEl.style.setProperty('--progress', String(clamped));
    if (this.state.kind === 'loading') this.state = { kind: 'loading', progress: clamped };
  }

  /**
   * A baked .bin downloaded but failed to parse (a stale cached file after a
   * format change — loader.ts throws a version/magic error rather than render
   * garbage, decision D4). Surface ONE clear caption instead of only a console
   * warning, and pin it so the loading hints don't paper over it.
   */
  notifyDataError(): void {
    this.dataError = true;
    this.setCaption('map data is stale — hard-refresh to re-download.', false);
  }

  /**
   * Loading finished. Reveal the map, hide the progress line, and decide the
   * first storm: a shared storm from the URL hash, else the ambient demo.
   * Returns the SpawnParams for main to feed the engine (never null in practice —
   * there is always either a shared storm or the demo).
   */
  finishLoading(shared: HashState | null): SpawnParams {
    this.host.progressEl.setAttribute('data-done', 'true');
    if (shared) {
      // Reflect the shared month in the picker so a re-spawn keeps it.
      this.host.monthSelect.value = String(shared.monthIndex);
      const params: SpawnParams = {
        lat: shared.lat,
        lon: shared.lon,
        monthIndex: shared.monthIndex,
        seed: shared.seed,
        isDemo: false,
      };
      this.lastSpawn = params;
      this.state = { kind: 'user-storm' };
      if (!this.dataError) this.setCaption(SHARED_HINT, true);
      return params;
    }
    const params = this.demoSpawnParams();
    this.lastSpawn = params;
    this.state = { kind: 'idle-demo' };
    if (!this.dataError) this.setCaption(FIRST_HINT, true);
    return params;
  }

  /**
   * The fixed-seed, dimmed ambient demo (design task T1 / D3). The month is
   * FORCED to DEMO_MONTH, not read from the picker: browsers that restore form
   * state across reloads (Firefox notably) would otherwise hand the curated
   * seed a different month's fields and turn the first-load storm into a dud.
   * The picker is written back so what the user sees matches what runs.
   */
  demoSpawnParams(): SpawnParams {
    this.host.monthSelect.value = String(DEMO_MONTH);
    return { ...DEMO_GENESIS, monthIndex: DEMO_MONTH, seed: DEMO_SEED, isDemo: true };
  }

  // -------------------------------------------------------------------------
  // Click handling (design task T2 land-click; T1 despawn+spawn)
  // -------------------------------------------------------------------------

  /**
   * A pointer landed at (lat,lon) inside the domain. Ocean → returns fresh
   * user-storm SpawnParams (main despawns + spawns + writes the share hash).
   * Land → queues a dim ripple, acknowledges "born at sea", returns null.
   * `hasEngine` false (sim module absent/half-done) → ocean clicks still ripple
   * as an acknowledgement instead of silently doing nothing.
   */
  handlePointer(lat: number, lon: number, hasEngine: boolean, nowMs: number): SpawnParams | null {
    // Still loading: the analytic fallback env + coarse SEA_RING mask are live and
    // will be replaced by the real baked data any moment. A spawn now would (a)
    // run physics no shared URL can reproduce and (b) publish a share hash that
    // loadAll reads straight back and force-restarts as a "shared" storm from age
    // 0 — the storm visibly resets. Acknowledge with a ripple, spawn nothing.
    if (this.state.kind === 'loading') {
      this.addRipple(lat, lon, nowMs);
      return null;
    }
    if (this.isLand(lat, lon)) {
      this.addRipple(lat, lon, nowMs);
      this.transientCaption(LAND_ACK);
      return null;
    }
    if (!hasEngine) {
      this.addRipple(lat, lon, nowMs);
      return null;
    }
    const monthIndex = this.readMonth(DEMO_MONTH);
    const params: SpawnParams = {
      lat,
      lon,
      monthIndex,
      seed: randomSeed(),
      isDemo: false,
    };
    this.lastSpawn = params;
    this.ripples = []; // a fresh storm clears lingering acks instantly (design T3)
    this.clearAck();
    this.state = { kind: 'user-storm' };
    this.setCaption(ALIVE_HINT, true);
    return params;
  }

  /**
   * The active NON-demo user storm's spawn identity, or null. B4 uses it to build
   * the counterfactual on a scenario switch (re-run the same lat/lon/seed under the
   * event's month + env) and to restore the storm when returning to climatology.
   * The ambient demo is excluded — a scenario switch replaces it with the event's
   * canonical spawn, not a counterfactual of the demo.
   */
  activeUserSpawn(): SpawnParams | null {
    return this.lastSpawn && !this.lastSpawn.isDemo ? { ...this.lastSpawn } : null;
  }

  /** Keep deterministic identity aligned when main starts a comparison directly. */
  rememberSpawn(params: SpawnParams): void {
    this.lastSpawn = { ...params };
    if (!params.isDemo) this.state = { kind: 'user-storm' };
  }

  /** Visible event-mode contract; documentation alone is not sufficient. */
  setScenarioContext(label: string | null): void {
    const contract = dom('scenario-contract');
    contract.hidden = label === null;
    contract.textContent = label
      ? `${label} environment · counterfactual, not a historical reconstruction`
      : '';
  }

  /** Add validated event environments to the controlled-comparison chooser. */
  setComparisonScenarios(
    scenarios: readonly { id: string; label: string }[],
  ): void {
    const select = dom<HTMLSelectElement>('compare-target');
    for (const old of Array.from(select.querySelectorAll('option[data-scenario]'))) {
      old.remove();
    }
    for (const scenario of scenarios) {
      const option = document.createElement('option');
      option.value = `scenario:${scenario.id}`;
      option.textContent = `${scenario.label} counterfactual`;
      option.dataset.scenario = 'true';
      select.appendChild(option);
    }
  }

  comparisonMessage(message: string): void {
    this.setCaption(message, true);
  }

  setExportStatus(message: string, busy = false): void {
    dom<HTMLOutputElement>('export-status').textContent = message;
    dom<HTMLButtonElement>('export-card').disabled = busy;
    dom<HTMLButtonElement>('export-replay').disabled = busy;
  }

  /** Transient status while an event bin is fetched, e.g. "loading gonu 2007…". */
  scenarioLoading(label: string): void {
    this.setCaption(`loading ${label}…`, true);
  }

  /** Status once an event is live (the counterfactual is spawned). Lowercase tone. */
  scenarioEntered(label: string): void {
    this.setCaption(`${label} — the counterfactual. click the sea to place your own.`, true);
  }

  /**
   * The event bin was missing/404 (mid-session toggle or a shared event URL opened
   * before the bake shipped it). Visible, pinned message — never a silent replay of
   * the wrong physics. The copy makes no claim about what IS on screen: a
   * mid-session event->event 404 stays on the current event, while the shared-URL
   * path falls back to climatology, so "showing climatology" would be false in the
   * first case. State only that the requested event is unavailable.
   */
  scenarioError(label: string): void {
    this.setCaption(`${label} data unavailable.`, false);
  }

  /** Status when a user storm is restored into climatology after an event. */
  climatologyRestored(): void {
    this.setCaption(RARITY_COPY, true);
  }

  /**
   * Month picker changed. Re-spawn the active storm at the same point + seed in
   * the new month (deterministic new track); returns the params for main, or null
   * when nothing is active. A fresh seed is NOT drawn — only the month varies, so
   * June-vs-October at one click is a controlled comparison.
   */
  onMonthChange(): SpawnParams | null {
    if (!this.lastSpawn) return null;
    const monthIndex = this.readMonth(this.lastSpawn.monthIndex);
    const params: SpawnParams = { ...this.lastSpawn, monthIndex };
    this.lastSpawn = params;
    return params;
  }

  // -------------------------------------------------------------------------
  // Storm narration (design task T3 epitaph; eng task T8 rarity copy)
  // -------------------------------------------------------------------------

  /** Route one sim event to the caption slot / state machine. */
  onSimEvent(ev: SimEvent, nowMs: number): void {
    switch (ev.type) {
      case 'spawned':
        return; // main already set the caption on spawn
      case 'landfall':
        this.transientCaption('landfall — the coast takes over.');
        return;
      case 'peak':
        return; // peak is narrated in the epitaph, not mid-life
      case 'died':
        this.state = { kind: 'aftermath', death: ev.death, fadeStartMs: nowMs };
        this.clearAck();
        this.setCaption(epitaph(ev.death), false);
        return;
    }
  }

  /** Render the live intensity budget or a recorded post-storm frame. */
  updateFlightRecorder(view: FlightRecorderView): void {
    const { storm } = view;
    const f = this.flight;
    if (!storm || storm.isDemo) {
      f.root.hidden = true;
      return;
    }

    f.root.hidden = false;
    const complete = view.debrief !== null;
    const mode = view.replayMode
      ? view.replayPlaying
        ? 'replaying'
        : 'replay-held'
      : complete
        ? 'complete'
        : view.paused
          ? 'held'
          : 'live';
    f.root.dataset.mode = mode;
    f.status.textContent =
      mode === 'replaying'
        ? 'replay'
        : mode === 'replay-held'
          ? 'replay held'
          : mode === 'complete'
            ? 'tape complete'
            : mode === 'held'
              ? 'live held'
              : 'live tape';
    f.clock.textContent = flightClock(storm.ageH);
    f.label.textContent = view.label;

    const d = storm.diagnostics;
    const explanation = explainIntensity(d);
    f.explanation.dataset.tone = explanation.tone;
    f.explanationHeadline.textContent = explanation.headline;
    f.explanationDetail.textContent = explanation.detail;
    f.contract.hidden = !view.counterfactual;
    f.trend.textContent = `${signed(d.netKtPerH)} kt/h`;
    f.trend.dataset.sign = d.netKtPerH > 0.05 ? 'up' : d.netKtPerH < -0.05 ? 'down' : 'flat';
    f.ocean.textContent = signed(d.oceanKtPerH);
    f.sst.textContent = `${d.sstC.toFixed(1)}°c · ${Math.round(d.mpiKt)} kt`;
    f.shear.textContent = `${loss(d.shearKtPerH)} · ${d.shearMs.toFixed(1)} m/s`;
    f.landDry.textContent = `${loss(d.landKtPerH)} / ${loss(d.dryAirKtPerH)}`;
    const steerSpeed = Math.hypot(d.steerU, d.steerV);
    f.steering.textContent = `${compactDirection(d.steerU, d.steerV)} · ${steerSpeed.toFixed(1)} m/s`;

    f.scrubber.max = String(Math.max(0, view.frameCount - 1));
    f.scrubber.value = String(Math.max(0, view.frameIndex));
    f.scrubber.disabled = !complete || view.frameCount < 2;
    f.jumps.hidden = !complete;
    f.landfallJump.disabled = view.milestones?.landfall == null;
    f.toggle.textContent = complete
      ? view.replayMode
        ? view.replayPlaying
          ? 'pause replay'
          : view.frameIndex >= view.frameCount - 1
            ? 'replay'
            : 'resume replay'
        : 'replay'
      : view.paused
        ? 'resume'
        : 'pause';

    f.debrief.hidden = !complete;
    if (!view.debrief) return;
    const summary = view.debrief;
    f.verdict.textContent = deathReasonPhrase(summary.death.reason);
    f.peak.textContent = `${Math.round(summary.death.peakKt)} kt`;
    f.life.textContent = durationPhrase(summary.death.durationH);
    f.muscat.textContent = approachDistance(summary.death.closestApproachKm);
    f.landfall.textContent = summary.landfall
      ? formatLatLon(summary.landfall.lat, summary.landfall.lon)
      : 'none';
    f.compareRow.hidden = summary.historicalPeakKt === undefined;
    if (summary.historicalPeakKt !== undefined) {
      f.compare.textContent = historicalComparison(
        summary.historicalDeltaKt ?? 0,
        summary.historicalPeakKt,
      );
    }

    f.comparisonRoot.hidden = view.comparison === null;
    f.compareClear.hidden = !view.comparisonActive;
    if (view.comparison) {
      const comparison = view.comparison;
      f.comparisonLabels.textContent =
        `${comparison.baseline.meta.label} → ${comparison.candidate.meta.label}`;
      f.comparisonPeak.textContent = delta(
        comparison.peakDeltaKt,
        'kt',
        'stronger',
        'weaker',
      );
      f.comparisonLife.textContent = delta(
        comparison.lifeDeltaH,
        'h',
        'longer',
        'shorter',
      );
      f.comparisonMuscat.textContent = distanceDelta(comparison.muscatDeltaKm);
      f.comparisonLandfall.textContent = comparison.landfallChanged
        ? comparison.candidate.debrief.landfall
          ? 'candidate made landfall'
          : 'candidate stayed offshore'
        : comparison.candidate.debrief.landfall
          ? 'both made landfall'
          : 'both stayed offshore';
    }
  }

  /**
   * Per-frame housekeeping: expire the aftermath fade (~10s) back to a quiet idle
   * that shows the landfall-rarity copy (eng task T8). The track + flood glow
   * linger over this window; render reads FrameState during aftermath to fade them.
   */
  update(nowMs: number): void {
    if (
      this.state.kind === 'aftermath' &&
      this.lastSpawn?.isDemo !== false &&
      nowMs - this.state.fadeStartMs > AFTERMATH_FADE_MS
    ) {
      this.state = { kind: 'idle-demo' };
      this.lastSpawn = null;
      this.setCaption(RARITY_COPY, true);
    }
  }

  // -------------------------------------------------------------------------
  // Pacing (task 8 — landfall-climax slow-mo)
  // -------------------------------------------------------------------------

  /**
   * Simulated-hours-per-real-second for this frame. Drops to slow-mo when a live,
   * non-demo storm's center is within {@link SLOWMO_COAST_KM} of a coast, so the
   * landfall payoff is not over in a blink. The fixed-dt loop makes this a pure
   * timescale knob — determinism is untouched.
   */
  timescaleHoursPerSec(storm: StormState | null): number {
    if (!storm || !storm.alive || storm.isDemo) return NORMAL_HOURS_PER_SEC;
    return this.nearCoast(storm.lat, storm.lon) ? SLOWMO_HOURS_PER_SEC : NORMAL_HOURS_PER_SEC;
  }

  // -------------------------------------------------------------------------
  // Overlay (2D) — the land-click ripple (design task T2)
  // -------------------------------------------------------------------------

  /** Wire the historic genesis points (from genesis.json) for the faint glow. */
  setGenesis(points: LatLon[]): void {
    this.genesis = points;
  }

  // -------------------------------------------------------------------------
  // Ghost-track labels (C7) — DOM `.chrome` type, NOT canvas text
  // -------------------------------------------------------------------------

  /**
   * Wire the historic-storm labels ("gonu 2007", "shaheen 2021"). ui owns these
   * DOM elements (the facade owns the ghost polyline pixels — the owners don't
   * overlap). Each anchor pins one lowercase, low-opacity `.chrome` label at the
   * storm's peak-wind in-domain point. Called once after tracks.json parses;
   * pass [] to clear. Positioning happens in {@link layoutGhostLabels}.
   */
  setGhostLabels(anchors: GhostLabelAnchor[]): void {
    this.ghostAnchors = anchors;
    if (!this.ghostContainer) {
      const parent = this.host.overlayCanvas.parentElement ?? document.body;
      const c = document.createElement('div');
      c.className = 'ghost-labels';
      parent.appendChild(c);
      this.ghostContainer = c;
    }
    // Rebuild the element set (labels are few + static, so a full rebuild is fine).
    this.ghostContainer.replaceChildren();
    this.ghostLabels.clear();
    for (const a of anchors) {
      const el = document.createElement('span');
      el.className = 'chrome ghost-label';
      el.textContent = a.text;
      if (a.id === this.activeGhostId) el.classList.add('active');
      this.ghostContainer.appendChild(el);
      this.ghostLabels.set(a.id, el);
    }
    this.layoutGhostLabels();
  }

  /**
   * Reposition the ghost labels in CSS pixels. DOM elements do not auto-reproject
   * like the canvas layers, so main calls this on every resize. Uses the canvas's
   * CLIENT size (CSS px), not its device-pixel backing size, so dpr is handled by
   * the browser — the same grid.ts projection as the overlay, just in CSS units.
   */
  layoutGhostLabels(): void {
    if (this.ghostAnchors.length === 0) return;
    const cv = this.host.overlayCanvas;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    for (const a of this.ghostAnchors) {
      const el = this.ghostLabels.get(a.id);
      if (!el) continue;
      el.style.left = `${this.pxX(a.lon, w)}px`;
      el.style.top = `${this.pxY(a.lat, h)}px`;
    }
  }

  /**
   * Highlight one ghost's label as the active scenario (B4 calls this on a
   * scenario switch); null clears the highlight. The GhostLayer draws the matching
   * polyline brighter via its own setActiveGhostId — this only styles the label.
   */
  highlightGhost(id: string | null): void {
    this.activeGhostId = id;
    for (const [gid, el] of this.ghostLabels) el.classList.toggle('active', gid === id);
  }

  private addRipple(lat: number, lon: number, nowMs: number): void {
    this.ripples.push({ lat, lon, startMs: nowMs });
    if (this.ripples.length > 8) this.ripples.shift();
  }

  /**
   * Draw the overlay marks onto the 2D canvas: the faint historic-genesis-zone
   * glow (eng task T8 — nudges spawns toward interesting outcomes without biasing
   * physics) beneath the transient land-click ripples (design task T2). main
   * clears the overlay each frame and calls this LAST (after the render layers),
   * so these marks sit on top of the storm track. We only add marks; we never
   * clear. Reduced motion freezes the ripple animation to a static tick. Owning
   * the glow here (a UI concern per task T8's file list, on the overlay we
   * control) keeps it robust regardless of the render module's data intake; at
   * ~12% alpha it stays faint, honouring the luminance ranking.
   */
  drawOverlay(nowMs: number): void {
    const { overlayCtx: ctx, overlayCanvas: cv } = this.host;
    const w = cv.width;
    const h = cv.height;

    if (this.genesis.length > 0) {
      const glowR = Math.max(w, h) * 0.06;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const g of this.genesis) {
        const px = this.pxX(g.lon, w);
        const py = this.pxY(g.lat, h);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
        grad.addColorStop(0, genesisRgba(GENESIS_ALPHA));
        grad.addColorStop(1, genesisRgba(0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (this.ripples.length === 0) return;
    const maxR = Math.max(w, h) * 0.035;
    this.ripples = this.ripples.filter((r) => nowMs - r.startMs < RIPPLE_MS);
    for (const r of this.ripples) {
      const t = (nowMs - r.startMs) / RIPPLE_MS; // 0..1
      const px = this.pxX(r.lon, w);
      const py = this.pxY(r.lat, h);
      const radius = this.host.reducedMotion ? maxR * 0.6 : maxR * (0.2 + t);
      const alpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.strokeStyle = trackRgba(Number(alpha.toFixed(3)));
      ctx.lineWidth = Math.max(1, w * 0.0015);
      ctx.stroke();
    }
  }

  /** lon -> device-pixel x, via grid.ts clip space (the only coordinate owner). */
  private pxX(lon: number, w: number): number {
    return ((latLonToClip(0, lon).x + 1) / 2) * w;
  }

  /** lat -> device-pixel y (clip y is up; canvas y is down). */
  private pxY(lat: number, h: number): number {
    return ((1 - latLonToClip(lat, 0).y) / 2) * h;
  }

  // -------------------------------------------------------------------------
  // Land / coast test
  // -------------------------------------------------------------------------

  /** Wire the baked land mask once terrain.bin is parsed; replaces the fallback. */
  setLandMask(layer: BinLayer | null): void {
    this.landMask = layer;
  }

  /**
   * Is (lat,lon) over land? Prefers the baked land mask (terrain.bin `landmask`
   * layer, >0.5 = land) sampled through grid.ts; falls back to an analytic
   * coastline polygon until the mask is baked. The fallback is deliberately
   * coarse — good enough to route obvious Oman/Iran/Pakistan clicks to a ripple
   * and open-sea clicks to a spawn; the real mask supersedes it.
   */
  isLand(lat: number, lon: number): boolean {
    const m = this.landMask;
    if (m) {
      const { col, row } = latLonToCell({ nx: m.nx, ny: m.ny, bbox: m.bbox }, lat, lon);
      const c = Math.max(0, Math.min(m.nx - 1, Math.round(col)));
      const rr = Math.max(0, Math.min(m.ny - 1, Math.round(row)));
      return m.data[rr * m.nx + c] > 0.5;
    }
    return !pointInSea(lon, lat);
  }

  /** Sea point within {@link SLOWMO_COAST_KM} of land in any direction. */
  private nearCoast(lat: number, lon: number): boolean {
    if (this.isLand(lat, lon)) return true; // already ashore
    const stepDeg = SLOWMO_COAST_KM / 111; // ~km per degree lat
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      const plat = lat + Math.sin(th) * stepDeg;
      const plon = lon + (Math.cos(th) * stepDeg) / Math.max(0.2, Math.cos(lat * (Math.PI / 180)));
      if (this.isLand(plat, plon)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Caption plumbing
  // -------------------------------------------------------------------------

  private setCaption(text: string, hint: boolean): void {
    this.host.captionEl.textContent = text;
    this.host.captionEl.classList.toggle('hint', hint);
  }

  /** Show `text` briefly, then revert to whatever the current state should read. */
  private transientCaption(text: string): void {
    this.clearAck();
    const prev = this.host.captionEl.textContent ?? '';
    const prevHint = this.host.captionEl.classList.contains('hint');
    this.setCaption(text, false);
    this.ackTimer = window.setTimeout(() => {
      this.ackTimer = null;
      // Only revert if nothing else has taken over the caption meanwhile.
      if (this.host.captionEl.textContent === text) this.setCaption(prev, prevHint);
    }, ACK_MS);
  }

  private clearAck(): void {
    if (this.ackTimer !== null) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private readMonth(fallback: number): number {
    const v = Number(this.host.monthSelect.value);
    return Number.isInteger(v) && v >= 0 && v <= 11 ? v : fallback;
  }
}

// ---------------------------------------------------------------------------
// Epitaph copy (design task T3)
// ---------------------------------------------------------------------------

const REASON_PHRASE: Record<DeathReason, string> = {
  [DeathReason.ColdWater]: 'starved over cool water',
  [DeathReason.Shear]: 'torn apart by wind shear',
  [DeathReason.Land]: 'wrung out over land',
  [DeathReason.DryAir]: 'choked on dry desert air',
  [DeathReason.ExitedDomain]: 'drifted off the map',
};

export function deathReasonPhrase(reason: DeathReason): string {
  return REASON_PHRASE[reason] ?? 'dissipated';
}

/**
 * One-line epitaph: cause · closest approach to Muscat · duration · peak, e.g.
 * "torn apart by wind shear · 340 km short of Muscat · 6 days · peak 85 kt".
 */
export function epitaph(d: StormDeath): string {
  const cause = deathReasonPhrase(d.reason);
  const parts = [cause, approachPhrase(d.closestApproachKm), durationPhrase(d.durationH), `peak ${Math.round(d.peakKt)} kt`];
  return parts.join(' · ');
}

function signed(value: number): string {
  if (Math.abs(value) < 0.05) return '0.0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}

function loss(value: number): string {
  return value < 0.05 ? '0.0' : `−${value.toFixed(1)}`;
}

function flightClock(ageH: number): string {
  const totalMinutes = Math.max(0, Math.round(ageH * 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${String(hours).padStart(2, '0')} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')} m`;
}

function formatLatLon(lat: number, lon: number): string {
  const ns = lat < 0 ? 's' : 'n';
  const ew = lon < 0 ? 'w' : 'e';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

function compactDirection(steerU: number, steerV: number): string {
  const direction = compassDirection(steerU, steerV);
  if (direction === 'calm') return direction;
  return direction
    .replace('north', 'n')
    .replace('south', 's')
    .replace('east', 'e')
    .replace('west', 'w');
}

function approachDistance(km: number): string {
  if (!Number.isFinite(km)) return '—';
  if (km <= 25) return 'direct hit';
  return `${Math.round(km)} km`;
}

function historicalComparison(deltaKt: number, historicalPeakKt: number): string {
  const difference = Math.round(Math.abs(deltaKt));
  const reference = `${Math.round(historicalPeakKt)} kt ghost`;
  if (difference === 0) return `matched ${reference}`;
  return `${deltaKt > 0 ? '+' : '−'}${difference} kt vs ${reference}`;
}

function delta(
  value: number,
  unit: string,
  positive: string,
  negative: string,
): string {
  const rounded = Math.round(Math.abs(value));
  if (rounded === 0) return `no change`;
  return `${value > 0 ? '+' : '−'}${rounded} ${unit} · ${value > 0 ? positive : negative}`;
}

function distanceDelta(valueKm: number): string {
  const rounded = Math.round(Math.abs(valueKm));
  if (rounded === 0) return 'same approach';
  return `${rounded} km ${valueKm < 0 ? 'closer' : 'farther'}`;
}

function approachPhrase(km: number): string {
  if (!Number.isFinite(km)) return 'never neared Muscat';
  if (km <= 25) return 'a direct hit on Muscat';
  return `${Math.round(km)} km short of Muscat`;
}

function durationPhrase(h: number): string {
  if (!Number.isFinite(h) || h < 0) return 'a brief life';
  if (h < 24) return `${Math.round(h)} h`;
  const days = h / 24;
  return days >= 2 ? `${Math.round(days)} days` : `${days.toFixed(1)} days`;
}

// ---------------------------------------------------------------------------
// Analytic coastline fallback (placeholder until terrain.bin's land mask lands)
// ---------------------------------------------------------------------------

/**
 * A coarse ring around the open Arabian Sea inside the 50–70°E / 15–27°N domain,
 * hand-traced to hug the Oman + Makran + Pakistan coasts. Point inside → sea;
 * outside → land. Vertices are [lon, lat]. This is a UI convenience only — the
 * physics land decay uses the baked mask, never this. Replace via setLandMask()
 * the moment terrain.bin is available.
 */
const SEA_RING: ReadonlyArray<readonly [number, number]> = [
  [50.0, 15.0], // SW corner
  [70.0, 15.0], // SE corner
  [70.0, 24.6], // up the east edge toward the Pakistan coast
  [66.5, 24.8], // Karachi approach
  [61.5, 25.0], // Makran coast
  [57.2, 25.3], // western Makran / Hormuz approach
  [56.7, 26.4], // into the Gulf of Oman (Iran side, water)
  [56.3, 24.6], // back across to the Oman side (Musandam / Batinah)
  [57.6, 23.9], // Oman coast
  [58.5, 23.6], // Muscat
  [59.8, 22.3],
  [59.0, 20.6], // Masirah
  [57.9, 19.4], // Duqm
  [55.2, 17.3], // Salalah
  [53.0, 16.6], // Yemen coast
];

/** Standard ray-casting point-in-polygon over {@link SEA_RING} (lon,lat space). */
function pointInSea(lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = SEA_RING.length - 1; i < SEA_RING.length; j = i++) {
    const [xi, yi] = SEA_RING[i];
    const [xj, yj] = SEA_RING[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
