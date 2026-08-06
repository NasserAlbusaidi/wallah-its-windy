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
import { DOMAIN, latLonToCell, latLonToClip } from './grid';
import { TOKENS } from './tokens';
import { categoryRgba, intensityFraction, stormCategory } from './category';
import { IMPACT_CITIES, windAtPointKt } from './impact';
import type { ImpactSummary } from './impact';
import type { GhostLabelAnchor } from './tracks';
import type { RunComparison } from './comparison';
import {
  compassDirection,
  type FlightIntensityPoint,
  type ReplayMilestones,
  type StormDebrief,
} from './flight-recorder';
import { explainIntensity } from './narrative';
import { maxWindRadiusKm } from './structure';
import type { HindcastScore } from './hindcast';
import type { EventRunMode } from './scenarios';
import type { PointProbeReading } from './point-probe';
import type { HistoricalAnalog } from './historical-analog';
import {
  buildIntensitySparkline,
  nearestIntensityIndex,
  type IntensitySparklineGeometry,
} from './intensity-sparkline';
import { categoryGradientCss } from './timeline-gradient';
import {
  isWeatherLayerId,
  WEATHER_LAYERS,
  weatherLayerDefinition,
} from './weather-layers';
import { formatStormTag, type StormTagInput } from './storm-tag';
import {
  buildImpactBoardModel,
  formatLatLon,
  ImpactBoardView,
} from './impact-board';
import {
  SIMULATED_WIND_CONVENTION,
  northIndianOceanClassification,
  regionalCategoryChip,
} from './wind-conventions';

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

function dom<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`ui: missing #${id}`);
  return element as unknown as T;
}

// ---------------------------------------------------------------------------
// Tunables (by eye; the design doc owns the intent, these are the knobs)
// ---------------------------------------------------------------------------

/**
 * Fixed demo storm identity — same every visit. CURATED, not arbitrary: a seed
 * scan over the bilinearly sampled real May fields (HF-2A selector, 2026-07-21) picked
 * the storm that makes Omani landfall with the wadi payoff: spawn (17.5N, 61E),
 * May, seed 1727 (synoptic plane 3) -> ~5.8 d life, peak ~96.8 kt, dies over
 * southern Oman near 19.30N, 57.40E. The integration test pins this outcome so
 * a re-bake that reshuffles sample years cannot silently kill the demo.
 */
export const DEMO_SEED = 1727;
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
  hindcast: boolean;
  hindcastScore: HindcastScore | null;
  comparisonActive: boolean;
  comparison: RunComparison | null;
  /** Landfall-impact bookkeeping for this run (cities, rain, flood proxy). */
  impact: ImpactSummary | null;
  /** Sustained wind at the recorded landfall frame, or null (no landfall). */
  landfallKt: number | null;
  /** Stable immutable wind/age strip from the recorder. */
  intensitySeries: readonly FlightIntensityPoint[];
  /** Closest shipped track under the explicitly geometric similarity metric. */
  historicalAnalog: HistoricalAnalog | null;
}

export interface PointProbePlacement {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  pinned: boolean;
}

export interface StormTagView extends StormTagInput {
  lat: number;
  lon: number;
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
    coreRh: HTMLOutputElement;
    oceanDepth: HTMLOutputElement;
    rain: HTMLOutputElement;
    pressure: HTMLOutputElement;
    rmw: HTMLOutputElement;
    windRadii: HTMLOutputElement;
    outerShear: HTMLOutputElement;
    motion: HTMLOutputElement;
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
    hindcastScore: HTMLElement;
    hindcastTrack: HTMLElement;
    hindcastIntensity: HTMLElement;
    hindcastPressure: HTMLElement;
    hindcastPeak: HTMLElement;
    hindcastSamples: HTMLElement;
    toggle: HTMLButtonElement;
    scrubber: HTMLInputElement;
    jumps: HTMLElement;
    startJump: HTMLButtonElement;
    peakJump: HTMLButtonElement;
    landfallJump: HTMLButtonElement;
    endJump: HTMLButtonElement;
    timelineClock: HTMLElement;
    timelineNowKt: HTMLElement;
    timelineNowHpa: HTMLElement;
    timelineCategory: HTMLElement;
    timelineId: HTMLElement;
    category: HTMLElement;
    needleNow: HTMLElement;
    needlePotential: HTMLElement;
    intensityNote: HTMLElement;
    sparkline: HTMLElement;
    sparklinePath: SVGPathElement;
    sparklineCursor: SVGLineElement;
    sparklinePeak: SVGCircleElement;
    sparklineLandfall: SVGCircleElement;
    sparklineValue: HTMLOutputElement;
    analog: HTMLElement;
  };
  private state: UiState = { kind: 'loading', progress: 0 };
  private ripples: Ripple[] = [];
  /** Identity of the currently active storm, for month re-spawn + share hash. */
  private lastSpawn: SpawnParams | null = null;
  /** Last human/shared sandbox identity; hindcast initialization must not replace it. */
  private lastUserSpawn: SpawnParams | null = null;
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
  private readonly stormTag = dom('storm-tag');
  private readonly stormTagChip = dom('storm-tag-chip');
  private readonly stormTagLine1 = dom('storm-tag-line1');
  private readonly stormTagLine2 = dom('storm-tag-line2');
  private readonly cityMarkerRoot = dom('city-markers');
  private readonly cityDetail = dom('city-detail');
  private readonly cityDetailName = dom('city-detail-name');
  private readonly cityDetailCurrent = dom('city-detail-current');
  private readonly cityDetailRun = dom('city-detail-run');
  private readonly cityMarkers = new Map<string, HTMLButtonElement>();
  private cityImpact: ImpactSummary | null = null;
  private cityStorm: StormState | null = null;
  /** Displayed-frame parametric wind per city; markers, detail card and the
   * impact board all read this one computation (updateCityMarkers fills it). */
  private readonly cityNowWindsKt = new Map<string, number>();
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
  private readonly pointProbe = dom('point-probe');
  private readonly pointProbePin = dom<HTMLButtonElement>('point-probe-pin');
  private sparklineSeries: readonly FlightIntensityPoint[] = [];
  private sparklineGeometry: IntensitySparklineGeometry =
    buildIntensitySparkline([]);
  private sparklineDefaultIndex = 0;
  private sparklineInspectIndex: number | null = null;
  /** Last tape length painted into the category-coloured timeline track. */
  private timelineGradientFrameCount = -1;

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
      coreRh: dom('flight-core-rh'),
      oceanDepth: dom('flight-ocean-depth'),
      rain: dom('flight-rain'),
      pressure: dom('flight-pressure'),
      rmw: dom('flight-rmw'),
      windRadii: dom('flight-wind-radii'),
      outerShear: dom('flight-outer-shear'),
      motion: dom('flight-motion'),
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
      hindcastScore: dom('hindcast-score'),
      hindcastTrack: dom('hindcast-track'),
      hindcastIntensity: dom('hindcast-intensity'),
      hindcastPressure: dom('hindcast-pressure'),
      hindcastPeak: dom('hindcast-peak'),
      hindcastSamples: dom('hindcast-samples'),
      toggle: dom('flight-toggle'),
      scrubber: dom('flight-scrubber'),
      jumps: dom('flight-jumps'),
      startJump: dom('flight-start'),
      peakJump: dom('flight-peak'),
      landfallJump: dom('flight-landfall'),
      endJump: dom('flight-end'),
      timelineClock: dom('timeline-clock'),
      timelineNowKt: dom('timeline-now-kt'),
      timelineNowHpa: dom('timeline-now-hpa'),
      timelineCategory: dom('timeline-cat'),
      timelineId: dom('timeline-id'),
      category: dom('flight-category'),
      needleNow: dom('scale-needle-now'),
      needlePotential: dom('scale-needle-potential'),
      intensityNote: dom('intensity-note'),
      sparkline: dom('intensity-sparkline'),
      sparklinePath: dom<SVGPathElement>('intensity-sparkline-path'),
      sparklineCursor: dom<SVGLineElement>('intensity-sparkline-cursor'),
      sparklinePeak: dom<SVGCircleElement>('intensity-sparkline-peak'),
      sparklineLandfall: dom<SVGCircleElement>('intensity-sparkline-landfall'),
      sparklineValue: dom('intensity-sparkline-value'),
      analog: dom('historical-analog'),
    };
    for (const jump of [
      this.flight.startJump,
      this.flight.peakJump,
      this.flight.landfallJump,
      this.flight.endJump,
    ]) {
      jump.dataset.label = jump.textContent ?? '';
    }

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

    this.buildCityMarkers();
    dom<HTMLButtonElement>('city-detail-close').addEventListener('click', () => {
      this.cityDetail.hidden = true;
    });
    this.installLayerRailIcons();
    this.bindSparklineInspection();
  }

  // -------------------------------------------------------------------------
  // Geographic product overlays: city markers + point probe
  // -------------------------------------------------------------------------

  private installLayerRailIcons(): void {
    const root = dom('layer-buttons');
    let observer: MutationObserver | null = null;
    const decorate = (): void => {
      let mounted = 0;
      for (const button of root.querySelectorAll<HTMLButtonElement>('.layer-button')) {
        const layer = button.dataset.layer;
        if (!layer || !isWeatherLayerId(layer)) continue;
        // Trusted static catalogue markup: labels remain textContent in the
        // button factory, while only our compile-time SVG is parsed as HTML.
        button.querySelector(':scope > svg')?.remove();
        button.insertAdjacentHTML(
          'afterbegin',
          weatherLayerDefinition(layer).iconSvg,
        );
        mounted += 1;
      }
      if (mounted === WEATHER_LAYERS.length) observer?.disconnect();
    };

    // main.ts mounts the static rail after the controller is constructed.
    // Observe that one child-list change, decorate all ten rows, then detach.
    observer = new MutationObserver(decorate);
    observer.observe(root, { childList: true });
    decorate();
  }

  private buildCityMarkers(): void {
    this.cityMarkerRoot.replaceChildren();
    this.cityMarkers.clear();
    for (const city of IMPACT_CITIES) {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'city-marker';
      marker.dataset.city = city.id;
      marker.dataset.exposed = 'false';
      marker.textContent = city.label;
      marker.addEventListener('click', () => this.openCityDetail(city.id));
      this.cityMarkerRoot.appendChild(marker);
      this.cityMarkers.set(city.id, marker);
    }
    this.layoutCityMarkers();
  }

  /** Reproject all DOM labels after a chart resize (and later after pan/zoom). */
  layoutMapOverlays(): void {
    this.layoutGhostLabels();
    this.layoutCityMarkers();
  }

  private layoutCityMarkers(): void {
    const width = this.host.overlayCanvas.clientWidth;
    const height = this.host.overlayCanvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const placed: Array<{ x: number; y: number; side: string }> = [];
    for (const city of IMPACT_CITIES) {
      const marker = this.cityMarkers.get(city.id);
      if (!marker) continue;
      const x = this.pxX(city.lon, width);
      let y = this.pxY(city.lat, height);
      const side = city.lon >= 64.5 ? 'left' : 'right';
      // Static labels are sparse, but Muscat/Sur and the Makran cities can
      // collide on compact screens. Nudge only close neighbours on one side.
      for (const prior of placed) {
        if (
          prior.side === side &&
          Math.abs(prior.x - x) < 125 &&
          Math.abs(prior.y - y) < 14
        ) {
          y = Math.min(height - 9, prior.y + 14);
        }
      }
      marker.dataset.side = side;
      marker.style.left = `${x}px`;
      marker.style.top = `${y}px`;
      placed.push({ x, y, side });
    }
  }

  /** Update glow and exact accessible readings from the current displayed frame. */
  updateCityMarkers(
    storm: StormState | null,
    impact: ImpactSummary | null,
  ): void {
    this.cityStorm = storm;
    this.cityImpact = impact;
    const accumulated = new Map(
      (impact?.cities ?? []).map((entry) => [entry.city.id, entry]),
    );
    for (const city of IMPACT_CITIES) {
      const marker = this.cityMarkers.get(city.id);
      if (!marker) continue;
      const currentWindKt =
        storm && storm.alive ? windAtPointKt(storm, city) : 0;
      this.cityNowWindsKt.set(city.id, currentWindKt);
      const run = accumulated.get(city.id);
      const exposed = currentWindKt >= 34;
      marker.dataset.exposed = String(exposed);
      const exact =
        `${city.label}: ${currentWindKt.toFixed(1)} kt 1-min modeled now; ` +
        `run peak ${run ? run.peakWindKt.toFixed(1) : '0.0'} kt 1-min`;
      marker.setAttribute('aria-label', exact);
      marker.title = exact;
    }
  }

  private openCityDetail(cityId: string): void {
    const city = IMPACT_CITIES.find((candidate) => candidate.id === cityId);
    const marker = this.cityMarkers.get(cityId);
    if (!city || !marker) return;
    const run = this.cityImpact?.cities.find(
      (entry) => entry.city.id === cityId,
    );
    const currentWindKt =
      this.cityStorm && this.cityStorm.alive
        ? windAtPointKt(this.cityStorm, city)
        : 0;
    this.cityDetailName.textContent = city.label;
    this.cityDetailCurrent.textContent =
      `modeled now · ${currentWindKt.toFixed(1)} kt 1-min`;
    this.cityDetailRun.textContent = run
      ? `run peak ${run.peakWindKt.toFixed(1)} kt 1-min · closest ` +
        `${Number.isFinite(run.closestKm) ? `${Math.round(run.closestKm)} km` : '—'} · ` +
        `${Math.round(run.rainMm)} mm parametric rain`
      : 'run totals not available yet';
    this.cityDetail.style.left = marker.style.left;
    this.cityDetail.style.top = marker.style.top;
    this.cityDetail.hidden = false;
  }

  showPointProbe(
    reading: PointProbeReading,
    placement: PointProbePlacement,
  ): void {
    const cardWidth = Math.min(220, Math.max(0, placement.widthPx - 16));
    this.pointProbe.hidden = false;
    this.pointProbe.style.width = `${cardWidth}px`;
    this.pointProbePin.setAttribute('aria-pressed', String(placement.pinned));
    this.pointProbePin.textContent = placement.pinned ? 'pinned' : 'pin';
    dom('point-probe-coords').textContent =
      `${reading.lat.toFixed(2)}°n · ${reading.lon.toFixed(2)}°e`;
    dom('point-probe-wind').textContent =
      reading.modeledWindKt === null
        ? '—'
        : `${reading.modeledWindKt.toFixed(1)} kt · 1-min sustained`;
    dom('point-probe-sst').textContent = `${reading.sstC.toFixed(1)}°c`;
    dom('point-probe-rh').textContent = `${reading.midlevelRhPct.toFixed(0)}%`;
    dom('point-probe-shear').textContent = `${reading.shearMs.toFixed(1)} m/s`;
    dom('point-probe-ohc').textContent = `${reading.ohcKjCm2.toFixed(0)} kJ/cm²`;
    const upperAvailable =
      reading.upperSpeedMs !== null && reading.upperDirDeg !== null;
    dom('point-probe-upper-speed-row').hidden = !upperAvailable;
    dom('point-probe-upper-dir-row').hidden = !upperAvailable;
    dom('point-probe-upper-speed').textContent = upperAvailable
      ? `${reading.upperSpeedMs!.toFixed(1)} m/s`
      : '—';
    dom('point-probe-upper-dir').textContent = upperAvailable
      ? `${reading.upperDirDeg!.toFixed(0)}° from`
      : '—';
    dom('point-probe-rain-label').textContent =
      `model rain · ${reading.simulatedRainWindowLabel}`;
    dom('point-probe-rain').textContent =
      reading.simulatedRainMm === null
        ? '—'
        : `${reading.simulatedRainMm.toFixed(1)} mm`;
    dom('point-probe-source').textContent =
      `${reading.environmentKind} · ${reading.environmentLabel} · ` +
      `${reading.validTimeLabel} · surface wind + rain are simulated`;
    const cardHeight = this.pointProbe.offsetHeight;
    const preferredLeft =
      placement.xPx + 12 + cardWidth <= placement.widthPx
        ? placement.xPx + 12
        : placement.xPx - cardWidth - 12;
    const preferredTop =
      placement.yPx + 12 + cardHeight <= placement.heightPx
        ? placement.yPx + 12
        : placement.yPx - cardHeight - 12;
    this.pointProbe.style.left =
      `${Math.max(8, Math.min(placement.widthPx - cardWidth - 8, preferredLeft))}px`;
    this.pointProbe.style.top =
      `${Math.max(8, Math.min(placement.heightPx - cardHeight - 8, preferredTop))}px`;
  }

  hidePointProbe(): void {
    this.pointProbe.hidden = true;
  }

  setPointProbePinned(pinned: boolean): void {
    this.pointProbePin.setAttribute('aria-pressed', String(pinned));
    this.pointProbePin.textContent = pinned ? 'pinned' : 'pin';
  }

  // -------------------------------------------------------------------------
  // Intensity sparkline inspection
  // -------------------------------------------------------------------------

  private bindSparklineInspection(): void {
    const root = this.flight.sparkline;
    root.addEventListener('pointermove', (event) => {
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || this.sparklineSeries.length === 0) return;
      this.sparklineInspectIndex = nearestIntensityIndex(
        this.sparklineSeries,
        (event.clientX - rect.left) / rect.width,
      );
      this.paintSparklineCursor();
    });
    root.addEventListener('pointerleave', () => {
      this.sparklineInspectIndex = null;
      this.paintSparklineCursor();
    });
    root.addEventListener('keydown', (event) => {
      if (this.sparklineSeries.length === 0) return;
      const current = this.sparklineInspectIndex ?? this.sparklineDefaultIndex;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      this.sparklineInspectIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? this.sparklineSeries.length - 1
            : Math.max(
                0,
                Math.min(
                  this.sparklineSeries.length - 1,
                  current + (event.key === 'ArrowLeft' ? -1 : 1),
                ),
              );
      this.paintSparklineCursor();
    });
    root.addEventListener('blur', () => {
      this.sparklineInspectIndex = null;
      this.paintSparklineCursor();
    });
  }

  private updateSparkline(view: FlightRecorderView): void {
    if (this.sparklineSeries !== view.intensitySeries) {
      this.sparklineSeries = view.intensitySeries;
      this.sparklineGeometry = buildIntensitySparkline(view.intensitySeries);
      this.flight.sparklinePath.setAttribute('d', this.sparklineGeometry.path);
      for (const threshold of this.flight.sparkline.querySelectorAll<SVGLineElement>(
        '.sparkline-thresholds line',
      )) {
        const windKt = Number(threshold.dataset.kt);
        const y = 32 - (windKt / this.sparklineGeometry.maxWindKt) * 32;
        threshold.setAttribute('y1', y.toFixed(2));
        threshold.setAttribute('y2', y.toFixed(2));
      }
      const peak = this.sparklineGeometry.points[this.sparklineGeometry.peakIndex];
      if (peak) {
        this.flight.sparklinePeak.setAttribute('cx', peak.x.toFixed(2));
        this.flight.sparklinePeak.setAttribute('cy', peak.y.toFixed(2));
      }
    }
    this.sparklineDefaultIndex = Math.max(
      0,
      Math.min(view.intensitySeries.length - 1, view.frameIndex),
    );
    const landfallIndex = view.milestones?.landfall ?? null;
    const landfall =
      landfallIndex === null
        ? null
        : this.sparklineGeometry.points[landfallIndex] ?? null;
    if (landfall) this.flight.sparklineLandfall.removeAttribute('hidden');
    else this.flight.sparklineLandfall.setAttribute('hidden', '');
    if (landfall) {
      this.flight.sparklineLandfall.setAttribute('cx', landfall.x.toFixed(2));
      this.flight.sparklineLandfall.setAttribute('cy', landfall.y.toFixed(2));
    }
    this.paintSparklineCursor();
  }

  private paintSparklineCursor(): void {
    const index = this.sparklineInspectIndex ?? this.sparklineDefaultIndex;
    const point = this.sparklineGeometry.points[index];
    if (!point) return;
    this.flight.sparklineCursor.setAttribute('x1', point.x.toFixed(2));
    this.flight.sparklineCursor.setAttribute('x2', point.x.toFixed(2));
    const exact =
      `${point.ageH.toFixed(1)} h · ${point.vKt.toFixed(1)} kt 1-min`;
    this.flight.sparklineValue.textContent = exact;
    const peak = this.sparklineGeometry.points[this.sparklineGeometry.peakIndex];
    this.flight.sparkline.setAttribute(
      'aria-label',
      `Recorded storm intensity. Selected ${exact}. ` +
        `Peak ${peak ? `${peak.vKt.toFixed(1)} one-minute knots at ${peak.ageH.toFixed(1)} hours` : 'unavailable'}. ` +
        'Use left and right arrow keys to inspect exact recorded frames.',
    );
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
      this.lastUserSpawn = params;
      this.state = { kind: 'user-storm' };
      if (!this.dataError) this.setCaption(SHARED_HINT, true);
      return params;
    }
    const params = this.demoSpawnParams();
    this.lastSpawn = params;
    this.lastUserSpawn = null;
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
    this.lastUserSpawn = params;
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
    return this.lastUserSpawn ? { ...this.lastUserSpawn } : null;
  }

  /** Keep deterministic identity aligned when main starts a comparison directly. */
  rememberSpawn(params: SpawnParams, rememberAsUser = true): void {
    this.lastSpawn = { ...params };
    if (rememberAsUser && !params.isDemo) this.lastUserSpawn = { ...params };
    if (!params.isDemo) this.state = { kind: 'user-storm' };
  }

  /** Visible event-mode contract; documentation alone is not sufficient. */
  setScenarioContext(
    label: string | null,
    mode: EventRunMode = 'counterfactual',
  ): void {
    const contract = dom('scenario-contract');
    contract.hidden = label === null;
    contract.textContent = label
      ? mode === 'hindcast'
        ? `${label} · observed initialization · freely simulated · scored`
        : `${label} environment · counterfactual, not a reconstruction`
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
  scenarioEntered(label: string, mode: EventRunMode): void {
    this.setCaption(
      mode === 'hindcast'
        ? `${label} hindcast — initialized from the observed storm; no track nudging.`
        : `${label} — the counterfactual. click the sea to place your own.`,
      true,
    );
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
    // A hindcast must never replace the remembered sandbox identity, but the
    // opening ambient demo still needs to respond to the month picker. Only use
    // lastSpawn as a fallback when it is that curated demo—not an observed
    // hindcast initialization.
    const base =
      this.lastUserSpawn ??
      (this.lastSpawn?.isDemo ? this.lastSpawn : null);
    if (!base) return null;
    const monthIndex = this.readMonth(base.monthIndex);
    const params: SpawnParams = { ...base, monthIndex };
    this.lastSpawn = params;
    if (!params.isDemo) this.lastUserSpawn = params;
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
      this.timelineGradientFrameCount = -1;
      this.impactBoard.update(
        buildImpactBoardModel({
          storm: null,
          isDemo: true,
          impact: null,
          debrief: null,
          landfallKt: null,
          landfallAgeH: null,
          peakSoFarKt: 0,
          nowWindsKt: this.cityNowWindsKt,
        }),
      );
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
    const clock = flightClock(storm.ageH);
    f.clock.textContent = clock;
    f.timelineClock.textContent = clock;
    f.label.textContent = view.label;
    f.timelineId.textContent = view.label;
    if (view.frameCount !== this.timelineGradientFrameCount) {
      f.scrubber.style.setProperty(
        '--timeline-gradient',
        categoryGradientCss(view.intensitySeries),
      );
      f.jumps
        .querySelectorAll<HTMLElement>('[data-category-milestone]')
        .forEach((milestone) => milestone.remove());
      let previousCategory = northIndianOceanClassification(
        view.intensitySeries[0]?.vKt ?? storm.vKt,
        SIMULATED_WIND_CONVENTION.averagingMinutes,
      );
      const timelineEndH =
        view.intensitySeries[view.intensitySeries.length - 1]?.ageH || 1;
      for (let index = 1; index < view.intensitySeries.length; index++) {
        const point = view.intensitySeries[index];
        const nextCategory = northIndianOceanClassification(
          point.vKt,
          SIMULATED_WIND_CONVENTION.averagingMinutes,
        );
        if (nextCategory.category.id === previousCategory.category.id) continue;
        const milestone = document.createElement('span');
        milestone.className = 'timeline-category-milestone';
        milestone.dataset.categoryMilestone = '';
        milestone.dataset.label = regionalCategoryChip(nextCategory).toLowerCase();
        milestone.style.left =
          `${((point.ageH / timelineEndH) * 100).toFixed(1)}%`;
        milestone.style.background = categoryRgba(point.vKt, 1);
        milestone.setAttribute('aria-hidden', 'true');
        f.jumps.append(milestone);
        previousCategory = nextCategory;
      }
      this.timelineGradientFrameCount = view.frameCount;
    }
    this.updateSparkline(view);
    f.analog.hidden = view.historicalAnalog === null;
    if (view.historicalAnalog) {
      const analog = view.historicalAnalog;
      f.analog.textContent =
        `${analog.activePrefix ? 'closest so far' : 'historical analog'} · ` +
        `${analog.name} ${analog.year} · geometric match ${analog.score}/100`;
      f.analog.title =
        `Shape error ${analog.shapeErrorKm.toFixed(0)} km · ` +
        `direction error ${analog.directionErrorDeg.toFixed(0)}°` +
        (analog.intensityErrorKt === null
          ? ''
          : ` · intensity error ${analog.intensityErrorKt.toFixed(1)} kt`) +
        ' · similarity is not a causal or forecast claim';
    }

    const d = storm.diagnostics;
    const explanation = explainIntensity(d, storm.structure);
    f.explanation.dataset.tone = explanation.tone;
    f.explanationHeadline.textContent = explanation.headline;
    f.explanationDetail.textContent = explanation.detail;
    f.contract.hidden = !view.counterfactual && !view.hindcast;
    f.contract.textContent = view.hindcast
      ? 'hindcast tape · observed initialization · no track nudging'
      : 'counterfactual tape · the observed storm is the faint ghost track';
    f.trend.textContent = `${signed(d.netKtPerH)} kt/h`;
    f.trend.dataset.sign = d.netKtPerH > 0.05 ? 'up' : d.netKtPerH < -0.05 ? 'down' : 'flat';
    f.ocean.textContent = signed(d.oceanKtPerH);
    f.sst.textContent = `${d.sstC.toFixed(1)}°c · ${Math.round(d.mpiKt)} kt`;
    f.shear.textContent = `${loss(d.shearKtPerH)} · ${d.shearMs.toFixed(1)} m/s`;
    f.landDry.textContent = `${loss(d.landKtPerH)} / ${loss(d.dryAirKtPerH)}`;
    const steerSpeed = Math.hypot(d.steerU, d.steerV);
    f.steering.textContent = `${compactDirection(d.steerU, d.steerV)} · ${steerSpeed.toFixed(1)} m/s`;
    f.coreRh.textContent =
      `${Math.round(d.organization * 100)}% · ${Math.round(d.midlevelRhPct)}%`;
    f.oceanDepth.textContent =
      `${Math.round(d.ohcKjCm2)} kJ/cm² · −${d.coldWakeC.toFixed(1)}°c`;
    f.rain.textContent =
      `${d.eyewallRainMmH.toFixed(1)} / ${d.rainbandRainMmH.toFixed(1)} / ` +
      `${d.orographicRainMmH.toFixed(1)}`;
    const structure = storm.structure;
    const motionSpeed = Math.hypot(
      structure.motionUms,
      structure.motionVms,
    );
    f.pressure.textContent = `${Math.round(structure.centralPressureHpa)} hPa`;
    f.rmw.textContent =
      `${Math.round(structure.rmwKm)} km · b ${structure.hollandB.toFixed(2)}`;
    f.windRadii.textContent =
      `${Math.round(maxWindRadiusKm(structure.r34Km))} / ` +
      `${Math.round(maxWindRadiusKm(structure.r64Km))} km`;
    const rainOffsetKm = Math.hypot(
      structure.rainOffsetEastKm,
      structure.rainOffsetNorthKm,
    );
    f.outerShear.textContent =
      `${Math.round(structure.outerSizeKm)} km · ` +
      `${Math.round(structure.shearAsymmetryFraction * 100)}% · ` +
      `rain ${Math.round(rainOffsetKm)} km`;
    f.motion.textContent =
      `${compactDirection(structure.motionUms, structure.motionVms)} ` +
      `${motionSpeed.toFixed(1)} · ${structure.translationAsymmetryKt.toFixed(1)} kt`;

    // Regional chip + intensity scale, with the SSHS table retained only for
    // the secondary comparison colour.
    const category = stormCategory(storm.vKt);
    const regional = northIndianOceanClassification(
      storm.vKt,
      SIMULATED_WIND_CONVENTION.averagingMinutes,
    );
    const regionalChip = regionalCategoryChip(regional);
    const regionalTitle =
      `${regional.category.name} — indicative RSMC band from simulated ` +
      'one-minute sustained wind; no three-minute conversion applied';
    f.category.dataset.cat = category.id;
    f.category.textContent = regionalChip;
    f.category.title = regionalTitle;
    f.category.setAttribute('aria-label', regionalTitle);
    const categoryColor = categoryRgba(storm.vKt, 1);
    f.timelineNowKt.textContent = `${Math.round(storm.vKt)} kt 1m`;
    f.timelineNowHpa.textContent =
      `${Math.round(structure.centralPressureHpa)} hPa`;
    f.timelineCategory.dataset.cat = category.id;
    f.timelineCategory.textContent = regionalChip;
    f.timelineCategory.title = regionalTitle;
    f.timelineCategory.style.background = categoryColor;
    f.scrubber.style.setProperty('--timeline-current-color', categoryColor);
    f.needleNow.style.left = `${(intensityFraction(storm.vKt) * 100).toFixed(1)}%`;
    const potentialKt = d.mpiKt;
    const hasPotential = potentialKt > 1 && !d.overLand;
    f.needlePotential.hidden = !hasPotential;
    if (hasPotential) {
      f.needlePotential.style.left =
        `${(intensityFraction(potentialKt) * 100).toFixed(1)}%`;
    }
    if (d.overLand) {
      f.intensityNote.textContent =
        `${Math.round(storm.vKt)} kt 1-min · over land — no ocean fuel, decaying`;
    } else if (potentialKt <= storm.vKt + 3) {
      f.intensityNote.textContent =
        `${Math.round(storm.vKt)} kt 1-min · at its ceiling for this water ` +
        `(mpi ${Math.round(potentialKt)} kt 1-min)`;
    } else {
      const potentialCategory = northIndianOceanClassification(
        potentialKt,
        SIMULATED_WIND_CONVENTION.averagingMinutes,
      );
      f.intensityNote.textContent =
        `${Math.round(storm.vKt)} kt 1-min now · this ocean supports ` +
        `${regionalCategoryChip(potentialCategory).toLowerCase()} ` +
        `(indicative RSMC band · mpi ${Math.round(potentialKt)} kt 1-min)`;
    }

    // The always-visible impact board owns live exposure, vitals, and the
    // ranked city table (impact-board.ts).
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
        isDemo: false,
        impact: view.impact,
        debrief: view.debrief,
        landfallKt: view.landfallKt,
        landfallAgeH,
        peakSoFarKt,
        nowWindsKt: this.cityNowWindsKt,
      }),
    );

    f.scrubber.max = String(Math.max(0, view.frameCount - 1));
    f.scrubber.value = String(Math.max(0, view.frameIndex));
    f.scrubber.disabled = !complete || view.frameCount < 2;
    f.jumps.hidden = view.frameCount < 2;
    f.startJump.hidden = !complete;
    f.peakJump.hidden = !complete;
    f.landfallJump.hidden =
      !complete || view.milestones?.landfall == null;
    f.endJump.hidden = !complete;
    if (view.milestones && view.frameCount > 1) {
      const milestonePosition = (frameIndex: number): string =>
        `${((frameIndex / (view.frameCount - 1)) * 100).toFixed(1)}%`;
      f.startJump.style.left = milestonePosition(view.milestones.start);
      f.peakJump.style.left = milestonePosition(view.milestones.peak);
      f.endJump.style.left = milestonePosition(view.milestones.end);
      if (view.milestones.landfall !== null) {
        f.landfallJump.style.left =
          milestonePosition(view.milestones.landfall);
      }
    }
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
    f.peak.textContent = `${Math.round(summary.death.peakKt)} kt 1-min`;
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

    const score = view.hindcastScore;
    f.hindcastScore.hidden = !view.hindcast || score === null;
    if (score) {
      f.hindcastTrack.textContent =
        score.trackMaeKm === null ? '—' : `${Math.round(score.trackMaeKm)} km`;
      f.hindcastIntensity.textContent =
        score.intensityMaeKt === null
          ? '—'
          : `${score.intensityMaeKt.toFixed(1)} kt`;
      f.hindcastPressure.textContent =
        score.pressureMaeHpa === null
          ? '—'
          : `${score.pressureMaeHpa.toFixed(1)} hPa`;
      f.hindcastPeak.textContent =
        score.peakBiasKt === null
          ? '—'
          : `${score.peakBiasKt >= 0 ? '+' : '−'}${Math.abs(score.peakBiasKt).toFixed(1)} kt`;
      f.hindcastSamples.textContent =
        `${score.trackSamples} track · ${score.intensitySamples} intensity · ` +
        `${score.pressureSamples} pressure fixes`;
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
   * Wire the historic-storm labels from the current catalogue. ui owns these
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

  /**
   * Pin the live/replayed storm chip to the vortex eye. The anchor uses the
   * exact pxX/pxY projection path as ghost labels; only the chip body is
   * clamped so the eye ring never moves off the simulated centre.
   */
  updateStormTag(view: StormTagView | null): void {
    if (!view) {
      this.stormTag.hidden = true;
      return;
    }

    const canvas = this.host.overlayCanvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      this.stormTag.hidden = true;
      return;
    }

    const copy = formatStormTag(view);
    this.stormTagLine1.textContent = copy.line1;
    this.stormTagLine2.textContent = copy.line2;
    this.stormTag.style.setProperty(
      '--storm-category-border',
      categoryRgba(view.vKt, 0.55),
    );
    this.stormTag.style.setProperty(
      '--storm-category-solid',
      categoryRgba(view.vKt, 0.95),
    );
    this.stormTag.style.setProperty(
      '--storm-category-pulse',
      categoryRgba(view.vKt, 0.35),
    );
    this.stormTag.style.setProperty(
      '--storm-category-clear',
      categoryRgba(view.vKt, 0),
    );

    const x = this.pxX(view.lon, width);
    const y = this.pxY(view.lat, height);
    this.stormTag.style.left = `${x}px`;
    this.stormTag.style.top = `${y}px`;
    this.stormTag.hidden = false;

    const chipWidth = this.stormTagChip.offsetWidth;
    const chipHeight = this.stormTagChip.offsetHeight;
    const margin = 10;
    const desiredLeft = x - chipWidth - 20;
    const desiredTop = y - chipHeight - 34;
    const chipLeft = Math.min(
      Math.max(margin, width - chipWidth - margin),
      Math.max(margin, desiredLeft),
    );
    const chipTop = Math.min(
      Math.max(margin, height - chipHeight - margin),
      Math.max(margin, desiredTop),
    );
    this.stormTag.style.setProperty(
      '--storm-tag-chip-left',
      `${chipLeft - x}px`,
    );
    this.stormTag.style.setProperty(
      '--storm-tag-chip-top',
      `${chipTop - y}px`,
    );
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

    this.drawGraticule(ctx, w, h);

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

  /**
   * Faint 5° graticule + coordinate labels — the chart-frame furniture that
   * makes the letterboxed map read as a charted area rather than a screenshot.
   * Drawn beneath the genesis glow; deliberately near-invisible (chart lines,
   * not data). Canvas text is a deliberate exception to the DOM-type rule:
   * these labels reproject every frame with the map exactly like the grid.
   */
  private drawGraticule(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const line = trackRgba(0.05);
    const label = trackRgba(0.3);
    const font = Math.max(8, Math.round(h * 0.013));
    ctx.save();
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, h * 0.0008);
    ctx.fillStyle = label;
    ctx.font = `${font}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'bottom';
    for (let lon = DOMAIN.lonMin + 5; lon < DOMAIN.lonMax; lon += 5) {
      const x = this.pxX(lon, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(`${lon}°e`, x, h - font * 0.4);
    }
    for (let lat = DOMAIN.latMin + 5; lat < DOMAIN.latMax; lat += 5) {
      const y = this.pxY(lat, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(`${lat}°n`, font * 0.5, y - font * 0.2);
    }
    ctx.restore();
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
  const parts = [
    cause,
    approachPhrase(d.closestApproachKm),
    durationPhrase(d.durationH),
    `peak ${Math.round(d.peakKt)} kt 1-min`,
  ];
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
