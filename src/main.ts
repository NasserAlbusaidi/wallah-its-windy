/**
 * main.ts — the app shell + fixed-dt accumulator loop (eng task T2) + wiring.
 *
 * This is the composition root: it boots the chrome, opens a WebGL2 context and a
 * 2D overlay context, loads baked data progressively, constructs the sim engine
 * and the render pipeline, and runs the deterministic simulation clock —
 * delegating everything the human reads or clicks to the UiController in ./ui.
 *
 * Time model (design doc): 1 real second = 3 simulated hours by default, dropping
 * to 1 real second = 1 sim hour for landfall-climax slow-mo (a pure timescale
 * knob — see ui.timescaleHoursPerSec). Physics always advances on a FIXED dt of
 * 15 simulated minutes via an accumulator; the renderer interpolates between
 * steps with `alpha`. The fixed step is what makes the sim a pure function of
 * (spawn, month, seed); slow-mo changes only wall-clock pacing, never the track.
 *
 * Parallel-build note: ./sim and ./render are authored by sibling builders. main
 * constructs them behind try/catch so a half-done module that throws at
 * construction or draw degrades to a still-usable instrument (chrome + loading +
 * captions + ripples) instead of a blank crash. The render facade owns its own
 * GPU textures + the 2D overlay (it clears the overlay and draws the track);
 * main draws the land-click ripples on top afterwards.
 */

import './style.css';
import { injectCssVars, TOKENS } from './tokens';
import { readHash, writeHash, clearHash, isEnvHashKey } from './rng';
import { DOMAIN, inBBox } from './grid';
import type { RegionNamesTable } from './impact';
import {
  HOME_VIEW,
  computeViewTransform,
  latLonToScreen,
  screenToLatLon,
  viewKey,
  viewStateOf,
} from './camera';
import type { ViewTransform } from './camera';
import { CameraGestureController } from './camera-gestures';
import { parseBin } from './loader';
import type {
  BinLayer,
  EnvTextures,
  FrameState,
  LatLon,
  ParsedBin,
  RenderLayer,
  SimEngine,
  SpawnParams,
  StormState,
  StormStructure,
} from './types';
import { UiController, DEMO_MONTH } from './ui';
import { createSimEngine } from './sim';
import { makeEnvSampler, sampleEnvBin, synopticCount } from './env-sampler';
import { sampleOceanProfileBin } from './ocean-profile-sampler';
import {
  observedInitialMotionMs,
  pressureWindSamplerFromBin,
} from './steering';
import { sampleLayerBilinear } from './raster-sampler';
import { parseTracks, toGhostPolylines, computeLabelAnchors } from './tracks';
import type { GhostPolyline, StormTrack } from './tracks';
import {
  parseScenarios,
  findScenario,
  eventSpawn,
  samplingModeForSpawn,
  eventTimeFraction,
  acceptEventBinForScenario,
  restoredMonth,
  CLIMATOLOGY_ID,
} from './scenarios';
import type { EventRunMode, Scenario } from './scenarios';
import { StormSession } from './storm-session';
import {
  downloadBlob,
  exportFileStem,
  makeDebriefCard,
  makeReplayVideo,
} from './export';
import { AUTO_ENSEMBLE_BUDGET, chooseRenderProfile } from './performance';
import { TapGesture } from './tap-gesture';
import { cloneStormStructure } from './structure';
import { scoreHindcast, type HindcastScore } from './hindcast';
import {
  DEFAULT_SATELLITE_PALETTE,
  DEFAULT_WEATHER_LAYER,
  digitHintForLayerIndex,
  layerIndexForDigitCode,
  SATELLITE_PALETTES,
  satellitePaletteDefinition,
  weatherLayerDefinition,
  WEATHER_LAYERS,
  type SatellitePaletteId,
  type WeatherLayerId,
} from './weather-layers';
import {
  acquisitionSlotIso,
  channelForPalette,
  loadObservedFrameImage,
  matchObservedFrame,
  meteosatWmsFrame,
  parseSatelliteManifest,
  type ObservedSatelliteFrame,
  type SatelliteChannel,
  type SatelliteFrameManifest,
  type SatelliteProviderId,
  type SatelliteSourceMode,
} from './satellite-observations';
import { ImpactTracker } from './impact';
import {
  DEFAULT_RAIN_ACCUMULATION_WINDOW,
  isRainAccumulationWindow,
  rainAccumulationDefinition,
  rainAccumulationLegend,
  type RainAccumulationWindow,
} from './rain-accumulation';
import {
  RAINVIEWER_ATTRIBUTION_URL,
  RAINVIEWER_MANIFEST_URL,
  loadRadarCoverageMask,
  loadRadarMosaic,
  parseRadarTimeline,
  radarFrameAgeMinutes,
  radarFrameIso,
  recentRadarFrames,
  type RadarSourceMode,
  type RadarTimeline,
  type RadarTimelineFrame,
} from './radar-observations';
import { createPointProbeReading } from './point-probe';
import { sampleUpperWind, upperWindLayers } from './upper-sampler';
import { resolveUpperWindMode } from './upper-runtime';
import { neutralSimulatedStormName } from './storm-names';
import { findHistoricalAnalog, type HistoricalAnalog } from './historical-analog';
import {
  buildProductIdentity,
  requiresObservationAcknowledgement,
} from './product-identity';
import {
  EnsembleCancelledError,
  requestEnsemble,
  requestSensitivity,
} from './ensemble-client';
import type { EnsembleRunHandle } from './ensemble-client';
import { buildEnsembleEnvelope } from './ensemble-envelope';
import type { EnsembleEnvelope } from './ensemble-envelope';
import type { EnsembleBoardSummary } from './impact-board';
import type {
  EnsembleResult,
  EnvironmentPerturbation,
} from './ensemble';
import {
  buildPublicCycleView,
  fetchPublicCycleManifest,
} from './public-cycle';

// Render facade. Composited passes in luminance order (terrain -> env glow ->
// rain -> particles -> track), each with init/resize/draw/dispose, driven by main.
// main resolves the module by a namespace probe (acquireRender) and PREFERS mode A
// (createRenderer): main owns the single data-load path and injects the parsed
// bins via setResources()/setMonth(), so the facade never self-fetches the same
// four URLs (the double-download seam). It falls back to createRenderLayers (mode
// B, self-sourcing) only if createRenderer is absent. Either way storm particles +
// track render from FrameState.storm.
import * as renderModule from './render';
import type { CloudTape } from './render/cloud-memory';

// --- Time constants ---------------------------------------------------------
const SIM_DT_MIN = 15; // fixed physics step, simulated minutes
const MAX_FRAME_MS = 250; // clamp long stalls (tab blur) so we never spiral
const MAX_TICKS_PER_FRAME = 48; // hard cap on catch-up ticks per frame
const DEMO_WARMUP_H = 18; // fast-forward the demo so it opens mid-life (design T1)

// --- Boot -------------------------------------------------------------------
injectCssVars();

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`boot: missing ${what}`);
  return v;
}

const glCanvas = must(document.getElementById('gl-canvas') as HTMLCanvasElement | null, '#gl-canvas');
const overlayCanvas = must(document.getElementById('overlay-canvas') as HTMLCanvasElement | null, '#overlay-canvas');
const progressEl = must(document.getElementById('progress'), '#progress');
const captionEl = must(document.getElementById('caption'), '#caption');
const monthSelect = must(document.getElementById('month') as HTMLSelectElement | null, '#month');
const scenarioSelect = must(document.getElementById('scenario') as HTMLSelectElement | null, '#scenario');
const scenarioModeSelect = must(
  document.getElementById('scenario-mode') as HTMLSelectElement | null,
  '#scenario-mode',
);
const scenarioModeLabel = must(
  document.getElementById('scenario-mode-label') as HTMLLabelElement | null,
  '#scenario-mode-label',
);
const flightToggle = must(document.getElementById('flight-toggle') as HTMLButtonElement | null, '#flight-toggle');
const flightScrubber = must(document.getElementById('flight-scrubber') as HTMLInputElement | null, '#flight-scrubber');
const flightStart = must(document.getElementById('flight-start') as HTMLButtonElement | null, '#flight-start');
const flightPeak = must(document.getElementById('flight-peak') as HTMLButtonElement | null, '#flight-peak');
const flightLandfall = must(document.getElementById('flight-landfall') as HTMLButtonElement | null, '#flight-landfall');
const flightEnd = must(document.getElementById('flight-end') as HTMLButtonElement | null, '#flight-end');
const compareTarget = must(document.getElementById('compare-target') as HTMLSelectElement | null, '#compare-target');
const compareRun = must(document.getElementById('compare-run') as HTMLButtonElement | null, '#compare-run');
const compareClear = must(document.getElementById('compare-clear') as HTMLButtonElement | null, '#compare-clear');
const exportCard = must(document.getElementById('export-card') as HTMLButtonElement | null, '#export-card');
const exportReplay = must(document.getElementById('export-replay') as HTMLButtonElement | null, '#export-replay');
const mapFrame = must(document.getElementById('map-frame'), '#map-frame');
const layerButtons = must(document.getElementById('layer-buttons'), '#layer-buttons');
const weatherLegend = must(document.getElementById('weather-legend'), '#weather-legend');
const weatherLegendName = must(
  document.getElementById('weather-legend-name'),
  '#weather-legend-name',
);
const weatherLegendUnit = must(
  document.getElementById('weather-legend-unit'),
  '#weather-legend-unit',
);
const weatherLegendScale = must(
  document.getElementById('weather-legend-scale'),
  '#weather-legend-scale',
);
const satelliteWorkbench = must(
  document.getElementById('satellite-workbench'),
  '#satellite-workbench',
);
const satelliteKind = must(document.getElementById('satellite-kind'), '#satellite-kind');
const satelliteSourceControls = must(
  document.getElementById('satellite-source'),
  '#satellite-source',
);
const satelliteProviderControls = must(
  document.getElementById('satellite-provider'),
  '#satellite-provider',
);
const satellitePaletteControls = must(
  document.getElementById('satellite-palette'),
  '#satellite-palette',
);
const satelliteStatus = must(
  document.getElementById('satellite-status') as HTMLOutputElement | null,
  '#satellite-status',
);
const satelliteAttribution = must(
  document.getElementById('satellite-attribution') as HTMLAnchorElement | null,
  '#satellite-attribution',
);
const radarWorkbench = must(document.getElementById('radar-workbench'), '#radar-workbench');
const radarKind = must(document.getElementById('radar-kind'), '#radar-kind');
const radarSourceControls = must(document.getElementById('radar-source'), '#radar-source');
const radarObservedControls = must(
  document.getElementById('radar-observed-controls'),
  '#radar-observed-controls',
);
const radarPrev = must(
  document.getElementById('radar-prev') as HTMLButtonElement | null,
  '#radar-prev',
);
const radarPlay = must(
  document.getElementById('radar-play') as HTMLButtonElement | null,
  '#radar-play',
);
const radarNext = must(
  document.getElementById('radar-next') as HTMLButtonElement | null,
  '#radar-next',
);
const radarTimelineInput = must(
  document.getElementById('radar-timeline') as HTMLInputElement | null,
  '#radar-timeline',
);
const radarTime = must(
  document.getElementById('radar-time') as HTMLOutputElement | null,
  '#radar-time',
);
const radarAge = must(document.getElementById('radar-age'), '#radar-age');
const radarStatus = must(
  document.getElementById('radar-status') as HTMLOutputElement | null,
  '#radar-status',
);
const radarAttribution = must(
  document.getElementById('radar-attribution') as HTMLAnchorElement | null,
  '#radar-attribution',
);
const accumWorkbench = must(document.getElementById('accum-workbench'), '#accum-workbench');
const accumWindowControls = must(document.getElementById('accum-window'), '#accum-window');
const accumStatus = must(
  document.getElementById('accum-status') as HTMLOutputElement | null,
  '#accum-status',
);
const ensembleSize = must(
  document.getElementById('ensemble-size') as HTMLSelectElement | null,
  '#ensemble-size',
);
const ensembleRun = must(
  document.getElementById('ensemble-run') as HTMLButtonElement | null,
  '#ensemble-run',
);
const ensembleStatus = must(
  document.getElementById('ensemble-status') as HTMLOutputElement | null,
  '#ensemble-status',
);
const ensembleResults = must(
  document.getElementById('ensemble-results'),
  '#ensemble-results',
);
const ensemblePeak = must(document.getElementById('ensemble-peak'), '#ensemble-peak');
const ensembleHurricane = must(
  document.getElementById('ensemble-hurricane'),
  '#ensemble-hurricane',
);
const ensembleMajor = must(document.getElementById('ensemble-major'), '#ensemble-major');
const ensembleLandfall = must(
  document.getElementById('ensemble-landfall'),
  '#ensemble-landfall',
);
const sensitivityRun = must(
  document.getElementById('sensitivity-run') as HTMLButtonElement | null,
  '#sensitivity-run',
);
const sensitivityStatus = must(
  document.getElementById('sensitivity-status') as HTMLOutputElement | null,
  '#sensitivity-status',
);
const sensitivitySst = must(
  document.getElementById('sensitivity-sst') as HTMLInputElement | null,
  '#sensitivity-sst',
);
const sensitivityRh = must(
  document.getElementById('sensitivity-rh') as HTMLInputElement | null,
  '#sensitivity-rh',
);
const sensitivityShear = must(
  document.getElementById('sensitivity-shear') as HTMLInputElement | null,
  '#sensitivity-shear',
);
const sensitivityOhc = must(
  document.getElementById('sensitivity-ohc') as HTMLInputElement | null,
  '#sensitivity-ohc',
);
const sensitivityOrg = must(
  document.getElementById('sensitivity-org') as HTMLInputElement | null,
  '#sensitivity-org',
);
const sensitivitySstValue = must(
  document.getElementById('sensitivity-sst-value'),
  '#sensitivity-sst-value',
);
const sensitivityRhValue = must(
  document.getElementById('sensitivity-rh-value'),
  '#sensitivity-rh-value',
);
const sensitivityShearValue = must(
  document.getElementById('sensitivity-shear-value'),
  '#sensitivity-shear-value',
);
const sensitivityOhcValue = must(
  document.getElementById('sensitivity-ohc-value'),
  '#sensitivity-ohc-value',
);
const sensitivityOrgValue = must(
  document.getElementById('sensitivity-org-value'),
  '#sensitivity-org-value',
);
const pointProbeEl = must(document.getElementById('point-probe'), '#point-probe');
const pointProbePin = must(
  document.getElementById('point-probe-pin') as HTMLButtonElement | null,
  '#point-probe-pin',
);
const productIdentityEl = must(
  document.getElementById('product-identity'),
  '#product-identity',
);
const productModeEl = must(document.getElementById('product-mode'), '#product-mode');
const productValidTimeEl = must(
  document.getElementById('product-valid-time'),
  '#product-valid-time',
);
const productSourceStateEl = must(
  document.getElementById('product-source-state'),
  '#product-source-state',
);
const productDegradedStateEl = must(
  document.getElementById('product-degraded-state'),
  '#product-degraded-state',
);
const publicDataMonitorEl = must(
  document.getElementById('public-data-monitor') as HTMLDetailsElement | null,
  '#public-data-monitor',
);
const publicDataHeadlineEl = must(
  document.getElementById('public-data-headline'),
  '#public-data-headline',
);
const publicDataCycleEl = must(
  document.getElementById('public-data-cycle'),
  '#public-data-cycle',
);
const publicDataUpdatedEl = must(
  document.getElementById('public-data-updated'),
  '#public-data-updated',
);
const publicDataSourcesEl = must(
  document.getElementById('public-data-sources'),
  '#public-data-sources',
);

const gl = glCanvas.getContext('webgl2', { antialias: true, alpha: false });
if (!gl) {
  captionEl.textContent = 'This browser has no WebGL2 — the map cannot render.';
  throw new Error('WebGL2 unavailable');
}
const overlay = must(overlayCanvas.getContext('2d'), '2d overlay context');

const clearColor = TOKENS.oceanDeep.rgba01;
gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);

// --- UI controller (constructed first: sim depends on ui.isLand) ------------
const ui = new UiController({
  captionEl,
  progressEl,
  overlayCanvas,
  overlayCtx: overlay,
  monthSelect,
  reducedMotion: prefersReducedMotion,
});
// Impact-board "show member tracks" toggle: presentation state only — the
// ensemble result itself never changes with visibility.
ui.onEnsembleMembersToggle(() => {
  ensembleMembersShown = !ensembleMembersShown;
  renderCtrl?.setEnsembleMembersVisible?.(ensembleMembersShown);
});
const session = new StormSession();
// Deterministic landfall-impact bookkeeping (rain grid + city exposure); reset
// per spawn, fed the same fixed ticks the recorder sees.
const impact = new ImpactTracker();

// --- Environment sampler (sim dependency) -----------------------------------
// The sim requires an EnvSampler. It closes over a live holder: once env.bin
// loads, `envBin` is set and the sampler reads the real baked fields (REAL OISST
// SST + real ERA5 steering/shear — see bake/README.md); before it lands, or if
// the fetch 404s, it falls back to a deterministic analytic Arabian-Sea
// climatology so the demo and user storms still form, drift and die. Both
// branches are pure in (lat,lon,month), so the sim stays a pure function of
// (spawn,month,seed). See src/env-sampler.ts.
// `envBin` is the LIVE holder the sampler closes over: reassigning it (never
// rebuilding the sampler) instantly re-points the sim at a new env (climatology
// vs a historic event bin — C8). `climatologyBin` retains the default env.bin so
// returning from an event restores it.
let envBin: ParsedBin | null = null;
let climatologyBin: ParsedBin | null = null;
let upperBin: ParsedBin | null = null;
let oceanBin: ParsedBin | null = null;
let steeringBin: ParsedBin | null = null;
/** Merged terrain+flowacc bin, retained so a scenario switch can re-inject it. */
let mergedTerrainBin: ParsedBin | null = null;
const envSampler = makeEnvSampler(() => envBin);
const pressureWindSampler = pressureWindSamplerFromBin(
  () => steeringBin,
  () => envSampler.getSamplingMode(),
);

// --- Scenario runtime (counterfactual event replays, C8) --------------------
/** Validated scenario catalogue (data/scenarios.json); empty disables the picker. */
let scenarios: Scenario[] = [];
/** Parsed event bins, cached so re-toggling a scenario never refetches. */
const eventBinCache = new Map<string, ParsedBin>();
const eventSteeringBinCache = new Map<string, ParsedBin>();
/** The active event, or null for climatology (the default sandbox). */
let activeScenario: Scenario | null = null;
let activeRunMode: EventRunMode = 'counterfactual';
/** The month the picker showed when the user LEFT climatology, to restore on return. */
let preEventMonth: number | null = null;
/** Monotonic guard so a slow event fetch can't clobber a newer switch. */
let scenarioReqSeq = 0;
let currentSpawn: SpawnParams | null = null;
let activeWeatherLayer: WeatherLayerId = 'terrain';
let activeSatellitePalette: SatellitePaletteId = DEFAULT_SATELLITE_PALETTE;
let activeSatelliteSource: SatelliteSourceMode = 'simulated';
let activeSatelliteProvider: SatelliteProviderId = 'meteosat';
let satelliteManifest: SatelliteFrameManifest = { version: 1, frames: [] };
let satelliteFrame: ObservedSatelliteFrame | null = null;
let satelliteRequestKey = '';
let satelliteRequestSeq = 0;
let satelliteRequestAbort: AbortController | null = null;
let satelliteHandoffStartAgeH = 0;
let satelliteHandoffStarted = false;
let satelliteHandoffSettled = false;
let activeRadarSource: RadarSourceMode = 'simulated';
let satelliteOverlayAcknowledged = false;
let radarOverlayAcknowledged = false;
let radarManifest: RadarTimeline | null = null;
let radarFrames: RadarTimelineFrame[] = [];
let radarFrameIndex = 0;
const radarFrameCache = new Map<number, HTMLCanvasElement>();
let radarRequestSeq = 0;
let radarManifestAbort: AbortController | null = null;
let radarFrameAbort: AbortController | null = null;
let radarCoverageFraction: number | null = null;
let radarManifestFetchedAtMs = 0;
let radarPlaying = false;
let radarPlayTimer: number | null = null;
let activeRainAccumulationWindow: RainAccumulationWindow =
  DEFAULT_RAIN_ACCUMULATION_WINDOW;
let analysisRequestSeq = 0;
/** In-flight ensemble run (manual or auto) — cancelled on supersession. */
let activeEnsembleRun: EnsembleRunHandle | null = null;
/** Board-facing ensemble state (running progress or done counts). */
let ensembleBoardSummary: EnsembleBoardSummary | null = null;
/** Member-spaghetti toggle — reset off on every spawn. */
let ensembleMembersShown = false;
/** Pending post-spawn settle timer for the automatic ensemble. */
let autoEnsembleTimer: number | null = null;

/**
 * Device eligibility for the auto run (AUTO_ENSEMBLE_BUDGET), evaluated at
 * scheduling time — a boot-time cache would freeze whatever tier the first
 * pre-layout resize() saw and never recover on windows that never resize.
 */
function autoEnsembleAllowed(): boolean {
  return chooseRenderProfile({
    width: glCanvas.clientWidth,
    dpr: window.devicePixelRatio || 1,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency || 8,
  }).autoEnsemble;
}

// --- Sim + render construction (defensive against half-done siblings) --------
let engine: SimEngine | null = null;
try {
  engine = createSimEngine({
    env: envSampler,
    isLand: (lat, lon) => ui.isLand(lat, lon),
    terrainHeightM: (lat, lon) => {
      const elevation = mergedTerrainBin?.layers.get('elev');
      return elevation ? sampleLayerBilinear(elevation, 0, lat, lon) : 0;
    },
    pressureWindSampler,
    oceanProfileSampler: (lat, lon, monthIndex) =>
      sampleOceanProfileBin(oceanBin, lat, lon, monthIndex),
  });
} catch (err) {
  console.warn('[boot] sim engine unavailable — running as a static map:', err);
}

let layers: RenderLayer[] = [];
let renderCtrl: RenderController | null = null;
try {
  const acquired = acquireRender(gl);
  layers = acquired.layers;
  renderCtrl = acquired.ctrl;
  const emptyResources: RenderResourcesLike = { terrain: null, env: null, upper: null, genesis: [], tracks: [] };
  for (const layer of layers) {
    try {
      if (layer === renderCtrl) {
        // Mode A: hand the facade the overlay + a present (empty-for-now)
        // resources object so it marks itself INJECTED and does NOT self-fetch
        // the four bins main is already loading (the double-download seam, eng
        // review). Real data arrives via setResources() once loadAll() parses it.
        renderCtrl.init(gl, overlay, emptyResources);
      } else {
        layer.init(gl);
      }
    } catch (err) {
      console.warn('[boot] a render layer failed to init:', err);
    }
  }
  renderCtrl?.setSatellitePalette?.(activeSatellitePalette);
  renderCtrl?.setSatelliteSource?.(activeSatelliteSource, satelliteHandoffStartAgeH);
  renderCtrl?.setCloudTape?.({
    frameAtOrBeforeAge: (ageH) =>
      session.recorder.frameAtOrBeforeAge(ageH),
    runKey: () => session.recorder.runKey(),
  });
} catch (err) {
  console.warn('[boot] render layers unavailable — map will not composite:', err);
  layers = [];
  renderCtrl = null;
}

// --- Canvas sizing ----------------------------------------------------------
/**
 * Edge-to-edge canvas (UX v2 phase 2): the frame fills the window and the
 * cover-fit camera (src/camera.ts) owns aspect correctness — the visible bbox
 * is chosen so ground metres per pixel are equal in x and y at every zoom.
 * The old letterboxed MAP_ASPECT frame died here; the camera replaces it.
 */
function layoutMapFrame(): void {
  mapFrame.style.left = '0px';
  mapFrame.style.top = '0px';
  mapFrame.style.width = `${Math.round(window.innerWidth)}px`;
  // The compact breakpoint pushes the frame below the header stack with an
  // !important top override — read the resolved top so the frame never
  // overflows the viewport bottom.
  const top = mapFrame.offsetTop;
  mapFrame.style.height = `${Math.max(1, Math.round(window.innerHeight - top))}px`;
}

// --- Camera (presentation-only; never enters sim state or recorded output) --
const cameraGestures = new CameraGestureController(HOME_VIEW);
let lastRenderedViewKey = '';

// Dev-only deterministic camera for headless visual QA (?camera=cx,cy,zoom).
// A SEARCH param, never a hash key — the frozen URL-hash contract is not
// touched — and the whole branch is dead-stripped from production builds.
if (import.meta.env.DEV) {
  const qa = new URLSearchParams(window.location.search).get('camera');
  if (qa) {
    const [cx, cy, zoom] = qa.split(',').map(Number);
    if ([cx, cy, zoom].every(Number.isFinite)) {
      cameraGestures.reset({ center: { x: cx, y: cy }, zoom });
    }
  }
}

/** Aspect from CSS px (identical ratio in device px). */
function canvasAspect(): number {
  const w = glCanvas.clientWidth || 1;
  const h = glCanvas.clientHeight || 1;
  return w / h;
}

/** Derive (and clamp) the current frame's view transform. */
function currentViewTransform(): ViewTransform {
  return computeViewTransform(cameraGestures.view(), canvasAspect());
}

function resize(): void {
  layoutMapFrame();
  const profile = chooseRenderProfile({
    width: glCanvas.clientWidth,
    dpr: window.devicePixelRatio || 1,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    hardwareConcurrency: navigator.hardwareConcurrency || 8,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
  const w = Math.floor(glCanvas.clientWidth * dpr);
  const h = Math.floor(glCanvas.clientHeight * dpr);
  document.documentElement.dataset.compact = String(profile.compact);
  renderCtrl?.setParticleBudget?.(profile.particleBudget);
  for (const c of [glCanvas, overlayCanvas]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  gl!.viewport(0, 0, w, h);
  for (const layer of layers) {
    try {
      layer.resize(w, h);
    } catch (err) {
      console.warn('[resize] render layer resize failed:', err);
    }
  }
  // DOM ghost labels are positioned in CSS px and do not auto-reproject like the
  // canvas layers — re-layout them on every resize so they track the map.
  ui.layoutMapOverlays();
}
window.addEventListener('resize', resize);
// The compact breakpoint moves #map-frame's CSS top when the scenario
// contract appears (`:has(#scenario-contract:not([hidden]))`) — no resize
// event fires, but the inline frame height derived from offsetTop must
// follow or the canvas bottom over/under-fills by the 60px delta.
new MutationObserver(() => resize()).observe(
  must(document.getElementById('scenario-contract'), '#scenario-contract'),
  { attributes: true, attributeFilter: ['hidden'] },
);
resize();

// --- Progressive data loading (design task T2 — map assembles as data arrives) --
interface LoadItem {
  url: string;
  label: string;
  kind: 'bin' | 'json';
  key: string;
  /** approximate weight for aggregate progress before Content-Length is known */
  weight: number;
}

function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function refreshPublicCycleMonitor(): Promise<void> {
  try {
    const manifest = await fetchPublicCycleManifest(asset('data/live/current.json'));
    const view = buildPublicCycleView(manifest, new Date().toISOString());
    publicDataMonitorEl.dataset.status = view.status;
    publicDataHeadlineEl.textContent = view.headline;
    publicDataCycleEl.textContent = view.cycleLabel;
    publicDataUpdatedEl.textContent = view.updatedLabel;
    publicDataSourcesEl.replaceChildren(
      ...view.sourceRows.map((row) => {
        const item = document.createElement('li');
        item.dataset.state = row.state;
        item.title = row.detail;
        item.textContent = row.label;
        return item;
      }),
    );
  } catch (error) {
    publicDataMonitorEl.dataset.status = 'unavailable';
    publicDataHeadlineEl.textContent = 'PUBLIC INPUTS · MONITOR UNAVAILABLE';
    publicDataCycleEl.textContent = 'scheduled source manifest could not be verified';
    publicDataUpdatedEl.textContent = '';
    publicDataSourcesEl.replaceChildren();
    console.warn('[public-cycle] monitor unavailable:', error);
  }
}

async function loadSatelliteManifest(): Promise<void> {
  try {
    const response = await fetch(asset('data/satellite/manifest.json'));
    if (!response.ok) return;
    const parsed = parseSatelliteManifest((await response.json()) as unknown);
    if (parsed) satelliteManifest = parsed;
  } catch {
    // Optional local observed-frame cache. Remote Meteosat remains available.
  }
}

// terrain/env/flowacc are listed now even though bake.py may not emit them yet:
// loadWithProgress swallows a 404 and returns null, so a missing artifact cannot
// brick the boot — the map simply assembles with whatever landed.
const MANIFEST: LoadItem[] = [
  { url: asset('data/terrain.bin'), label: 'terrain', kind: 'bin', key: 'terrain', weight: 3 },
  { url: asset('data/env.bin'), label: 'environment', kind: 'bin', key: 'env', weight: 2 },
  { url: asset('data/upper.bin'), label: 'upper winds', kind: 'bin', key: 'upper', weight: 1 },
  { url: asset('data/ocean.bin'), label: 'upper ocean', kind: 'bin', key: 'ocean', weight: 2 },
  { url: asset('data/flowacc.bin'), label: 'wadi network', kind: 'bin', key: 'flowacc', weight: 2 },
  { url: asset('data/genesis.json'), label: 'genesis zones', kind: 'json', key: 'genesis', weight: 1 },
  // Historic ghost tracks (C7). Missing/404 degrades to null -> no ghosts, no labels.
  { url: asset('data/tracks.json'), label: 'historic tracks', kind: 'json', key: 'tracks', weight: 1 },
  // Scenario catalogue (C8). Missing/404 -> null -> the scenario picker disables.
  { url: asset('data/scenarios.json'), label: 'scenarios', kind: 'json', key: 'scenarios', weight: 1 },
  // Regional rain ledger geography (UX v2 phase 3). Either file missing/404
  // degrades to null -> the impact board's regions block simply hides.
  { url: asset('data/regions.bin'), label: 'regions', kind: 'bin', key: 'regions', weight: 1 },
  { url: asset('data/regions.json'), label: 'region names', kind: 'json', key: 'regionNames', weight: 1 },
];

const loadedWeight = new Map<string, number>();
let genesisPoints: LatLon[] = [];
/** Parsed historic tracks, or null when the file is absent/malformed (no ghosts). */
let parsedTracks: StormTrack[] | null = null;
/** Parsed scenario catalogue, or null when the file is absent/malformed. */
let parsedScenarios: Scenario[] | null = null;
/** Parsed regions.json name tables, or null when absent/malformed. */
let parsedRegionNames: RegionNamesTable | null = null;
/** Ghost polylines for the render facade, retained across scenario switches. */
let ghostTracks: GhostPolyline[] = [];

function reportProgress(): void {
  const total = MANIFEST.reduce((s, m) => s + m.weight, 0);
  const done = MANIFEST.reduce((s, m) => s + (loadedWeight.get(m.url) ?? 0), 0);
  ui.reportProgress(total > 0 ? done / total : 1);
}

async function loadWithProgress(item: LoadItem, onProgress: (frac: number) => void): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const totalStr = res.headers.get('Content-Length');
    const total = totalStr ? Number(totalStr) : 0;
    if (!res.body || total === 0) {
      const buf = await res.arrayBuffer();
      onProgress(1);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress(Math.min(received / total, 1));
      }
    }
    const out = new Uint8Array(received);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    onProgress(1);
    return out.buffer;
  } catch (err) {
    console.warn(`[load] ${item.label} (${item.url}) failed:`, err);
    onProgress(1); // don't stall the aggregate bar on a missing bake artifact
    return null;
  }
}

/** Route one loaded buffer to its parsed home. Never throws — logs and skips. */
function routeLoaded(item: LoadItem, buf: ArrayBuffer, bins: Map<string, ParsedBin>): void {
  try {
    if (item.kind === 'bin') {
      bins.set(item.key, parseBin(buf));
    } else {
      const json = JSON.parse(new TextDecoder().decode(buf)) as unknown;
      if (item.key === 'genesis') genesisPoints = parseGenesis(json);
      else if (item.key === 'tracks') parsedTracks = parseTracks(json);
      else if (item.key === 'scenarios') parsedScenarios = parseScenarios(json);
      else if (item.key === 'regionNames') parsedRegionNames = parseRegionNames(json);
    }
  } catch (err) {
    console.warn(`[load] ${item.label} parsed badly, skipping:`, err);
    // A .bin that downloaded but won't parse is a stale/corrupt cached file
    // (loader throws a version/magic error, decision D4). Surface one caption
    // instead of silently degrading to the analytic fallback + sea-ring mask.
    if (item.kind === 'bin') ui.notifyDataError();
  }
}

/** Validate regions.json's id->name tables (BINARY-FORMATS.md schema). */
function parseRegionNames(json: unknown): RegionNamesTable | null {
  const rec = json as {
    admin1?: unknown;
    wadi?: unknown;
  } | null;
  const table = (value: unknown): Record<string, string> | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v !== 'string' || !/^\d+$/.test(k)) return null;
      out[k] = v;
    }
    return out;
  };
  const admin1 = table(rec?.admin1);
  const wadi = table(rec?.wadi);
  if (!admin1 || !wadi) return null;
  return { admin1, wadi };
}

/** Validate genesis.json into LatLon[] (BINARY-FORMATS.md schema). */
function parseGenesis(json: unknown): LatLon[] {
  if (!Array.isArray(json)) return [];
  const out: LatLon[] = [];
  for (const p of json as unknown[]) {
    const rec = p as { lat?: unknown; lon?: unknown };
    if (typeof rec.lat === 'number' && typeof rec.lon === 'number') out.push({ lat: rec.lat, lon: rec.lon });
  }
  return out;
}

/**
 * Merge terrain.bin + flowacc.bin layers into one ParsedBin for the renderer,
 * which looks up elev/land/acc/basin all inside its single `terrain` resource.
 * If bake splits flow-accumulation/basin into flowacc.bin, this bridges them;
 * if it bakes them into terrain.bin, flowacc's names simply don't overwrite.
 */
function mergedTerrain(bins: Map<string, ParsedBin>): ParsedBin | null {
  const terr = bins.get('terrain');
  const flow = bins.get('flowacc');
  if (!terr && !flow) return null;
  const layers = new Map<string, BinLayer>();
  if (terr) for (const [k, v] of terr.layers) layers.set(k, v);
  if (flow) for (const [k, v] of flow.layers) if (!layers.has(k)) layers.set(k, v);
  return { version: terr?.version ?? flow?.version ?? 1, layers };
}

/** Find a land-mask layer in the parsed terrain bin, whatever it is named. */
function findLandMask(terrain: ParsedBin | null): BinLayer | null {
  if (!terrain) return null;
  return terrain.layers.get('landmask') ?? terrain.layers.get('land') ?? null;
}

function populateScenarioPicker(items: readonly Scenario[]): void {
  scenarioSelect.replaceChildren();
  const climatology = document.createElement('option');
  climatology.value = CLIMATOLOGY_ID;
  climatology.textContent = CLIMATOLOGY_ID;
  scenarioSelect.append(climatology);
  for (const scenario of items) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = `${scenario.label} environment`;
    scenarioSelect.append(option);
  }
}

async function loadAll(): Promise<void> {
  const bins = new Map<string, ParsedBin>();
  await Promise.all(
    MANIFEST.map(async (item) => {
      const buf = await loadWithProgress(item, (frac) => {
        loadedWeight.set(item.url, frac * item.weight);
        reportProgress();
      });
      if (buf) routeLoaded(item, buf, bins);
    }),
  );

  // Hand parsed data to its consumers. terrain's land mask sharpens land-click
  // detection + land decay; env.bin (when baked) drives the real sampler live;
  // genesis points drive the faint glow the UI draws on the overlay. Uploading
  // terrain/env layers to render GPU textures is the unsettled render data seam
  // (see build report) — not wired here; storm particles/track still render.
  mergedTerrainBin = mergedTerrain(bins);
  ui.setLandMask(findLandMask(mergedTerrainBin));
  impact.setLandMask(findLandMask(mergedTerrainBin));
  impact.setRegions(bins.get('regions') ?? null, parsedRegionNames);
  ui.setGenesis(genesisPoints);
  climatologyBin = bins.get('env') ?? null;
  envBin = climatologyBin;
  upperBin = bins.get('upper') ?? null;
  oceanBin = bins.get('ocean') ?? null;

  // Ghost tracks (C7): the facade draws the polylines; ui owns the DOM labels.
  // parsedTracks is null when tracks.json is absent/malformed -> empty everywhere.
  ghostTracks = parsedTracks ? toGhostPolylines(parsedTracks) : [];
  ui.setGhostLabels(parsedTracks ? computeLabelAnchors(parsedTracks) : []);

  // Scenario catalogue (C8): an absent/empty catalogue disables the picker (only
  // climatology is reachable — we have no event bin paths to fetch).
  scenarios = parsedScenarios ?? [];
  populateScenarioPicker(scenarios);
  scenarioSelect.disabled = scenarios.length === 0;
  ui.setComparisonScenarios(scenarios);

  // Inject the single parsed copy into the render facade (mode A): the exact
  // bytes main just loaded feed BOTH the sim sampler and the GPU textures, so no
  // URL is fetched twice and no bin is dequantized twice (the double-load seam).
  const upperState = updateUpperWindLayerState();
  renderCtrl?.setResources?.({ terrain: mergedTerrainBin, env: envBin, upper: upperState.upper, genesis: genesisPoints, tracks: ghostTracks });

  // First storm. A shared storm from the URL hash replays exactly; if it carries a
  // known scenario key, fetch that event bin BEFORE the first spawn so the replay
  // rides the right physics (never a silent climatology fallback — C8). Otherwise
  // the ambient demo (design T1), fast-forwarded so it opens mid-life.
  const shared = readHash();
  const sharedScenario = shared ? findScenario(scenarios, shared.env) : null;
  if (shared && sharedScenario) {
    const bin = await loadEventBin(sharedScenario);
    if (bin) {
      const first = ui.finishLoading(shared); // establishes user-storm state + lastSpawn
      // Preserve legacy shared-event URL semantics: hashes created before the
      // hindcast selector existed remain counterfactual experiments.
      applyEventEnv(sharedScenario, bin, 'counterfactual');
      // Force the event's canonical month: the event bin's layers are suffixed with
      // it, and the picker is disabled — a mismatched hand-crafted `month=` in the
      // hash must not resolve to a missing layer + silent analytic fallback.
      doSpawn({ ...first, monthIndex: sharedScenario.monthIndex, tFracHorizonH: sharedScenario.windowH });
      return;
    }
    // Event bin unbaked/404: replay in climatology so the storm still forms, then
    // pin the error caption. scenarioError must fire AFTER finishLoading — the
    // latter unconditionally writes SHARED_HINT in the same tick and would bury a
    // caption set beforehand, which C8 forbids (never a silent wrong-physics
    // replay: the recipient must SEE that the requested event physics is missing).
    scenarioSelect.value = CLIMATOLOGY_ID;
    const climFirst = ui.finishLoading(shared);
    renderCtrl?.setMonth?.(climFirst.monthIndex);
    doSpawn(climFirst);
    ui.scenarioError(sharedScenario.label);
    return;
  }
  const first = ui.finishLoading(shared);
  renderCtrl?.setMonth?.(first.monthIndex); // SST tint follows the spawned month
  doSpawn(first);
  if (first.isDemo) warmUp(DEMO_WARMUP_H);
}

// --- Spawn + interpolation snapshots ----------------------------------------
interface Head {
  lat: number;
  lon: number;
  vKt: number;
  structure: StormStructure;
}
let prevHead: Head | null = null;
let currHead: Head | null = null;
let accumulatorMin = 0;
let currentRunLabel = '';
let currentRunName: ReturnType<typeof neutralSimulatedStormName> | null = null;
let hindcastScoreCache: HindcastScore | null = null;
let hindcastScoreFrameCount = -1;
/** vKt at the recorded landfall frame, resolved once per landfall. */
let landfallKtCache: { frameIndex: number; vKt: number } | null = null;
/** A frame snapshot plus the camera view it was composited with. */
interface MapCapture {
  canvas: HTMLCanvasElement;
  view: ViewTransform;
}
const pendingMapCaptures: Array<(capture: MapCapture) => void> = [];
let analogCache: {
  frameBucket: number;
  complete: boolean;
  result: HistoricalAnalog | null;
} | null = null;

function headOf(s: StormState): Head {
  return {
    lat: s.lat,
    lon: s.lon,
    vKt: s.vKt,
    structure: cloneStormStructure(s.structure),
  };
}

/**
 * Resolve on the next freshly composited GL frame. WebGL does not preserve its
 * drawing buffer after presentation, so copying from a later click task may
 * produce a black export. This captures once, in-frame, without imposing the
 * permanent cost of `preserveDrawingBuffer: true`.
 */
function captureMapFrame(): Promise<MapCapture> {
  return new Promise((resolve) => pendingMapCaptures.push(resolve));
}

function flushMapCaptures(): void {
  if (pendingMapCaptures.length === 0) return;
  const snapshot = document.createElement('canvas');
  snapshot.width = glCanvas.width;
  snapshot.height = glCanvas.height;
  // Exports annotate what the camera showed: the view rides with the pixels.
  const capture: MapCapture = { canvas: snapshot, view: currentViewTransform() };
  const ctx = snapshot.getContext('2d');
  if (!ctx) {
    pendingMapCaptures.splice(0).forEach((resolve) => resolve(capture));
    return;
  }
  ctx.drawImage(glCanvas, 0, 0);
  pendingMapCaptures.splice(0).forEach((resolve) => resolve(capture));
}

function labelForRun(params: SpawnParams): string {
  if (activeScenario && activeRunMode === 'hindcast') {
    return `${activeScenario.label} hindcast`;
  }
  const option = Array.from(monthSelect.options).find(
    (candidate) => Number(candidate.value) === params.monthIndex,
  );
  const environment = activeScenario
    ? `${activeScenario.label} counterfactual`
    : `${(option?.textContent ?? 'season').toLowerCase()} climatology`;
  const identity = currentRunName ?? neutralSimulatedStormName(params.seed);
  return `${identity.label} · ${environment}`;
}

function activeAnalog(): HistoricalAnalog | null {
  if (!parsedTracks || parsedTracks.length === 0) return null;
  const complete = session.complete;
  // During a live run, update on each simulated hour (four 15-minute frames).
  // Completion always receives an exact final comparison.
  const frameBucket = complete
    ? session.recorder.frameCount
    : Math.floor(session.recorder.frameCount / 4);
  if (
    analogCache &&
    analogCache.frameBucket === frameBucket &&
    analogCache.complete === complete
  ) {
    return analogCache.result;
  }
  const result = findHistoricalAnalog(
    session.recorder.trackSnapshot(),
    parsedTracks,
    { complete },
  );
  analogCache = { frameBucket, complete, result };
  return result;
}

function activeHistoricalPeakKt(): number | undefined {
  if (!activeScenario || !parsedTracks) return undefined;
  const track = parsedTracks.find((candidate) => candidate.id === activeScenario!.ghostId);
  if (!track) return undefined;
  const winds = track.points
    .map((point) => point.windKt)
    .filter((wind): wind is number => wind !== null);
  return winds.length > 0 ? Math.max(...winds) : undefined;
}

function activeHindcastScore(): HindcastScore | null {
  if (
    !activeScenario ||
    activeRunMode !== 'hindcast' ||
    !activeScenario.hindcast ||
    !parsedTracks
  ) {
    return null;
  }
  if (
    hindcastScoreFrameCount === session.recorder.frameCount &&
    hindcastScoreCache
  ) {
    return hindcastScoreCache;
  }
  const run = session.recorder.snapshot();
  if (!run) return null;
  const track = parsedTracks.find(
    (candidate) => candidate.id === activeScenario!.ghostId,
  );
  if (!track) return null;
  hindcastScoreCache = scoreHindcast(
    run.frames,
    track,
    activeScenario.hindcast.startIso,
  );
  hindcastScoreFrameCount = session.recorder.frameCount;
  return hindcastScoreCache;
}

/** Spawn (replacing any active storm), reset interpolation, and share via the hash. */
function doSpawn(
  params: SpawnParams,
  options: { preserveComparison?: boolean; rememberAsUser?: boolean } = {},
): void {
  if (!engine) return;
  // Select the environment-axis meaning BEFORE spawn. Climatology freezes one
  // seed-picked real-year regime; event mode treats nt as chronological time.
  const inEvent = activeScenario !== null;
  envSampler.setSamplingMode(
    samplingModeForSpawn(
      inEvent,
      params.seed,
      synopticCount(envBin, params.monthIndex),
    ),
  );
  // In event mode, thread the scenario window as the tFrac horizon so sim-hours map
  // onto event-hours (C4). Ambient clicks in event mode inherit it too, so they
  // read the same time axis as the canonical replay.
  let spawn: SpawnParams =
    inEvent && params.tFracHorizonH === undefined
      ? { ...params, tFracHorizonH: activeScenario!.windowH }
      : params;
  if (
    inEvent &&
    activeRunMode === 'hindcast' &&
    activeScenario?.hindcast &&
    parsedTracks
  ) {
    const track = parsedTracks.find(
      (candidate) => candidate.id === activeScenario!.ghostId,
    );
    const motion = track
      ? observedInitialMotionMs(
          track.points,
          activeScenario.hindcast.startIso,
        )
      : null;
    if (motion) {
      spawn = {
        ...spawn,
        initialMotionUms: motion.u,
        initialMotionVms: motion.v,
      };
    }
  }
  try {
    engine.spawn(spawn);
  } catch (err) {
    console.warn('[spawn] engine.spawn threw:', err);
    return;
  }
  currentSpawn = { ...spawn };
  // ROADMAP "Automatic ensemble envelope": a respawn or environment change
  // cancels the stale job for real (worker abandons remaining members), not
  // just its result.
  clearAutoEnsembleTimer();
  activeEnsembleRun?.cancel();
  activeEnsembleRun = null;
  ensembleBoardSummary = null;
  ensembleMembersShown = false;
  renderCtrl?.setEnsemble?.(null, null);
  renderCtrl?.setEnsembleMembersVisible?.(false);
  analysisRequestSeq++;
  ensembleResults.hidden = true;
  ensembleStatus.value = spawn.isDemo
    ? 'spawn or select a storm'
    : 'ready · worker cache will reuse this environment';
  if (!spawn.isDemo && autoEnsembleAllowed()) {
    const spawnRef = currentSpawn;
    autoEnsembleTimer = window.setTimeout(() => {
      autoEnsembleTimer = null;
      if (currentSpawn !== spawnRef) return;
      startEnsembleRun(spawnRef, AUTO_ENSEMBLE_BUDGET.memberCount, 'auto');
    }, AUTO_ENSEMBLE_BUDGET.settleMs);
  }
  const s = engine.getState();
  const generatedName = neutralSimulatedStormName(spawn.seed);
  currentRunName =
    activeScenario && activeRunMode === 'hindcast'
      ? null
      : generatedName;
  currentRunLabel = labelForRun(spawn);
  if (s) {
    session.start(
      {
        spawn: { ...spawn },
        environmentId: activeScenario?.id ?? CLIMATOLOGY_ID,
        monthIndex: spawn.monthIndex,
        seed: spawn.seed,
        isDemo: spawn.isDemo,
        label: currentRunLabel,
        stormName: currentRunName?.name,
        stormNameCatalogueVersion: currentRunName?.catalogueVersion,
        stormNameOfficial: currentRunName?.official,
        counterfactual:
          activeScenario !== null && activeRunMode === 'counterfactual',
        hindcast: activeScenario !== null && activeRunMode === 'hindcast',
        hindcastStartIso:
          activeRunMode === 'hindcast'
            ? activeScenario?.hindcast?.startIso
            : undefined,
        historicalPeakKt: activeHistoricalPeakKt(),
      },
      s,
      options.preserveComparison ?? false,
    );
  }
  ui.rememberSpawn(
    spawn,
    options.rememberAsUser ??
      !(activeScenario !== null && activeRunMode === 'hindcast'),
  );
  hindcastScoreCache = null;
  hindcastScoreFrameCount = -1;
  landfallKtCache = null;
  analogCache = null;
  satelliteOverlayAcknowledged = false;
  radarOverlayAcknowledged = false;
  if (activeSatelliteSource !== 'simulated') setSatelliteSource('simulated');
  if (activeRadarSource !== 'simulated') setRadarSource('simulated');
  impact.reset();
  currHead = s ? headOf(s) : null;
  prevHead = currHead;
  accumulatorMin = 0;
  if (!spawn.isDemo) {
    // The scenario id doubles as the hash env key; validate it so a
    // catalogue that ever adds an id outside the known set can't emit a bad hash.
    const env = activeScenario && isEnvHashKey(activeScenario.id) ? activeScenario.id : undefined;
    writeHash({
      lat: spawn.lat,
      lon: spawn.lon,
      monthIndex: spawn.monthIndex,
      seed: spawn.seed,
      env,
      stormName: currentRunName?.name,
      stormNameCatalogueVersion: currentRunName?.catalogueVersion,
    });
  }
}

/** Fast-forward the active storm so the demo opens mid-life. Stops on death. */
function warmUp(hours: number): void {
  if (!engine) return;
  const steps = Math.floor((hours * 60) / SIM_DT_MIN);
  for (let i = 0; i < steps; i++) {
    let dead = false;
    try {
      const events = engine.tick(SIM_DT_MIN);
      const state = engine.getState();
      if (state) {
        session.record(state, events);
        impact.record(state, SIM_DT_MIN / 60);
      }
      dead = events.some((e) => e.type === 'died');
    } catch (err) {
      console.warn('[warmup] tick threw:', err);
      return;
    }
    if (dead) break;
  }
  const s = engine.getState();
  currHead = s ? headOf(s) : null;
  prevHead = currHead;
}

// --- Scenario switching (counterfactual event replays, C8) ------------------

/**
 * Lazily fetch + parse a scenario's event bin, cached so re-toggling never
 * refetches. Re-shows the thin loading line for the duration. Returns null on a
 * 404 or a parse failure (the caller shows a visible caption and stays put) —
 * loadWithProgress already swallows the network error into a null buffer.
 */
async function loadEventBin(scenario: Scenario): Promise<ParsedBin | null> {
  const cached = eventBinCache.get(scenario.id);
  if (cached) {
    await loadEventSteeringBin(scenario);
    return cached;
  }
  const item: LoadItem = { url: asset(scenario.bin), label: scenario.label, kind: 'bin', key: 'event', weight: 2 };
  progressEl.removeAttribute('data-done'); // re-reveal the progress line for the toggle
  const buf = await loadWithProgress(item, (frac) => ui.reportProgress(frac));
  progressEl.setAttribute('data-done', 'true');
  if (!buf) return null;
  try {
    const parsed = parseBin(buf);
    const bin = acceptEventBinForScenario(
      parsed,
      scenario,
      (message) => console.warn(`[scenario] ${message}`),
    );
    if (!bin) return null;
    eventBinCache.set(scenario.id, bin);
    await loadEventSteeringBin(scenario);
    return bin;
  } catch (err) {
    console.warn(`[scenario] ${scenario.label} bin parsed badly:`, err);
    return null;
  }
}

/** Load optional HF-3 pressure-level winds without making them a hard runtime
 * dependency; diagnostics expose the deep-layer fallback when absent. */
async function loadEventSteeringBin(
  scenario: Scenario,
): Promise<ParsedBin | null> {
  const cached = eventSteeringBinCache.get(scenario.id);
  if (cached) return cached;
  const relative = scenario.bin.replace(/(^|\/)env_/, '$1steering_');
  try {
    const response = await fetch(asset(relative));
    if (!response.ok) return null;
    const parsed = parseBin(await response.arrayBuffer());
    const required = ['u850', 'v850', 'u500', 'v500', 'u250', 'v250'];
    if (!required.every((name) => parsed.layers.has(name))) return null;
    eventSteeringBinCache.set(scenario.id, parsed);
    return parsed;
  } catch (error) {
    console.warn(`[scenario] ${scenario.label} pressure steering unavailable:`, error);
    return null;
  }
}

/**
 * Apply an event's environment WITHOUT spawning: swap the live env holder (never
 * rebuild the sampler), pin + disable the month picker at the historic month, feed
 * the render facade the event env + month, and light the active ghost + its label.
 * Captures the pre-event month once, on the transition out of climatology.
 */
function applyEventEnv(
  scenario: Scenario,
  bin: ParsedBin,
  mode: EventRunMode,
): void {
  if (!activeScenario) preEventMonth = readPickerMonth();
  activeScenario = scenario;
  activeRunMode = mode;
  envBin = bin; // sampler live-swap — the sim reads the event env on its next tick
  steeringBin = eventSteeringBinCache.get(scenario.id) ?? null;
  // Sync the scenario picker to the active event (C8 fidelity). On the shared-URL
  // boot path nothing else sets it, so without this the picker keeps its DOM
  // default 'climatology' while the event runs — and, because selecting the
  // already-shown 'climatology' fires no 'change', the user can't leave the event.
  // On interactive switches the value already matches, so this stays idempotent.
  scenarioSelect.value = scenario.id;
  const canHindcast = scenario.hindcast !== null;
  scenarioModeLabel.hidden = !canHindcast;
  scenarioModeSelect.hidden = !canHindcast;
  scenarioModeSelect.value = canHindcast ? mode : 'counterfactual';
  monthSelect.value = String(scenario.monthIndex);
  monthSelect.disabled = true; // a historic event is pinned to its real month
  const upperState = updateUpperWindLayerState(scenario.monthIndex);
  renderCtrl?.setResources?.({ terrain: mergedTerrainBin, env: bin, upper: upperState.upper, genesis: genesisPoints, tracks: ghostTracks });
  renderCtrl?.setMonth?.(scenario.monthIndex);
  renderCtrl?.setActiveGhost?.(scenario.ghostId);
  ui.highlightGhost(scenario.ghostId);
  ui.setScenarioContext(scenario.label, mode);
}

/** Enter an event interactively (from the picker): apply its env, then spawn the
 *  counterfactual (active user storm re-run in the event) or the canonical spawn. */
function enterScenario(scenario: Scenario, bin: ParsedBin): void {
  const mode: EventRunMode = scenario.hindcast ? 'hindcast' : 'counterfactual';
  const userStorm = ui.activeUserSpawn();
  applyEventEnv(scenario, bin, mode);
  doSpawn(eventSpawn(scenario, userStorm, mode), {
    rememberAsUser: mode !== 'hindcast',
  });
  ui.scenarioEntered(scenario.label, mode);
}

/**
 * Return to the climatology sandbox: restore the default env, re-enable + restore
 * the month picker, clear the ghost highlight, and re-spawn — the active user storm
 * at the restored month (so it becomes an ordinary storm again), or the ambient
 * demo when none was active.
 */
function applyClimatologyEnv(month: number): void {
  activeScenario = null;
  activeRunMode = 'counterfactual';
  envBin = climatologyBin;
  steeringBin = null;
  monthSelect.disabled = false;
  monthSelect.value = String(month);
  scenarioSelect.value = CLIMATOLOGY_ID;
  scenarioModeLabel.hidden = true;
  scenarioModeSelect.hidden = true;
  renderCtrl?.setActiveGhost?.(null);
  ui.highlightGhost(null);
  ui.setScenarioContext(null);
  renderCtrl?.setResources?.({
    terrain: mergedTerrainBin,
    env: climatologyBin,
    upper: updateUpperWindLayerState(month).upper,
    genesis: genesisPoints,
    tracks: ghostTracks,
  });
  renderCtrl?.setMonth?.(month);
}

function returnToClimatology(): void {
  if (!activeScenario) return; // already climatology
  const user = ui.activeUserSpawn();
  const month = restoredMonth(preEventMonth, user ? user.monthIndex : null, DEMO_MONTH);
  preEventMonth = null;
  applyClimatologyEnv(month);
  if (user) {
    doSpawn({ lat: user.lat, lon: user.lon, monthIndex: month, seed: user.seed, isDemo: false });
    ui.climatologyRestored();
  } else {
    // No user storm to restore -> the ambient demo (which force-pins its own month).
    const demo = ui.demoSpawnParams();
    renderCtrl?.setMonth?.(demo.monthIndex);
    doSpawn(demo);
    warmUp(DEMO_WARMUP_H);
    // Entering the event wrote '#...&env=gonu' (canonical spawn, isDemo:false); the
    // demo is hash-free, so strip that stale fragment and reset the caption off the
    // event copy, or a reload/share would replay the event the user just left.
    clearHash();
    ui.climatologyRestored();
  }
}

/** Snap the picker back to whatever is actually active (after a failed/aborted switch). */
function revertScenarioPicker(): void {
  scenarioSelect.value = activeScenario ? activeScenario.id : CLIMATOLOGY_ID;
}

/** The picker changed. Climatology returns home; a known event lazy-loads then
 *  switches; an unknown value or a 404 reverts the picker with a visible caption. */
async function onScenarioChange(id: string): Promise<void> {
  const seq = ++scenarioReqSeq;
  if (id === CLIMATOLOGY_ID) {
    returnToClimatology();
    return;
  }
  const scenario = findScenario(scenarios, id);
  if (!scenario) {
    revertScenarioPicker();
    return;
  }
  ui.scenarioLoading(scenario.label);
  const bin = await loadEventBin(scenario);
  if (seq !== scenarioReqSeq) return; // a newer switch superseded this one
  if (!bin) {
    // Mid-session 404: stay on the current env, say so, revert the selection.
    ui.scenarioError(scenario.label);
    revertScenarioPicker();
    return;
  }
  enterScenario(scenario, bin);
}

/** Read the month picker as a valid 0-indexed month, else the demo month. */
function readPickerMonth(): number {
  const v = Number(monthSelect.value);
  return Number.isInteger(v) && v >= 0 && v <= 11 ? v : DEMO_MONTH;
}

// --- Input ------------------------------------------------------------------
// Tap to spawn. A small recognizer rejects drag, long-press, and pinch contacts
// before screen -> clip -> lat/lon conversion. Ocean -> fresh deterministic
// storm; land -> ripple, no storm.
const mapTap = new TapGesture();
let probePosition: LatLon | null = null;
let probePinned = false;
let probeTouch: {
  id: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  timer: number;
} | null = null;

function mapPointFromClient(clientX: number, clientY: number): LatLon | null {
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const point = screenToLatLon(
    currentViewTransform(),
    clientX - rect.left,
    clientY - rect.top,
    rect.width,
    rect.height,
  );
  // Data-validity gate, applied AFTER the camera inverse: the view is clamped
  // inside the domain, so this only trims float noise at the exact edge.
  return inBBox(point.lat, point.lon, DOMAIN) ? point : null;
}

function probePlacement(point: LatLon): {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  pinned: boolean;
} {
  const rect = glCanvas.getBoundingClientRect();
  const px = latLonToScreen(
    currentViewTransform(),
    point.lat,
    point.lon,
    rect.width,
    rect.height,
  );
  return {
    xPx: px.x,
    yPx: px.y,
    widthPx: rect.width,
    heightPx: rect.height,
    pinned: probePinned,
  };
}

function displayedStorm(): StormState | null {
  const live = engine ? engine.getState() : null;
  return session.stormView(live).storm;
}

function activeObservationProduct(): {
  label: string;
  validTimeIso: string | null;
} | null {
  if (
    activeWeatherLayer === 'infrared' &&
    activeSatelliteSource !== 'simulated' &&
    !(activeSatelliteSource === 'handoff' && satelliteHandoffSettled)
  ) {
    return {
      label: `${activeSatelliteProvider} observed`,
      validTimeIso: satelliteFrame?.observedAt ?? null,
    };
  }
  if (activeWeatherLayer === 'rain' && activeRadarSource === 'observed') {
    const frame = radarFrames[radarFrameIndex];
    return {
      label: 'RainViewer observed',
      validTimeIso: frame ? radarFrameIso(frame) : null,
    };
  }
  return null;
}

function refreshProductIdentity(storm: StormState | null = displayedStorm()): void {
  const identity = buildProductIdentity({
    scenarioLabel: activeScenario?.label,
    scenarioStartIso: activeScenario?.startIso,
    hindcastStartIso: activeScenario?.hindcast?.startIso,
    runMode: activeRunMode,
    ageH: storm?.ageH ?? null,
    oceanMissingSourceFlag:
      storm?.diagnostics.oceanMissingSourceFlag ?? false,
    upperWindMissingSourceFlag:
      activeScenario === null && availableUpperBin(readPickerMonth()) === null,
    observation: activeObservationProduct(),
  });
  productIdentityEl.dataset.mode = identity.mode;
  productIdentityEl.dataset.observationState = identity.observationState;
  productModeEl.textContent = identity.modeLabel;
  productValidTimeEl.textContent = identity.validTimeLabel;
  productSourceStateEl.textContent = identity.sourceLabel;
  const degraded = identity.degradedInputs;
  const hasDegradedInputs = degraded.length > 0;
  productIdentityEl.dataset.degraded = hasDegradedInputs ? 'true' : 'false';
  productDegradedStateEl.hidden = !hasDegradedInputs;
  productDegradedStateEl.textContent = hasDegradedInputs
    ? `DEGRADED INPUT · ${degraded.join(' · ')}`
    : '';
}

function acknowledgeObservationOverlay(
  kind: 'satellite' | 'radar',
  source: 'observed' | 'handoff',
): boolean {
  const alreadyAcknowledged = kind === 'satellite'
    ? satelliteOverlayAcknowledged
    : radarOverlayAcknowledged;
  if (!requiresObservationAcknowledgement(
    displayedStorm() !== null,
    source,
    alreadyAcknowledged,
  )) {
    return true;
  }
  const identity = buildProductIdentity({
    scenarioLabel: activeScenario?.label,
    scenarioStartIso: activeScenario?.startIso,
    hindcastStartIso: activeScenario?.hindcast?.startIso,
    runMode: activeRunMode,
    ageH: displayedStorm()?.ageH ?? null,
  });
  const accepted = window.confirm(
    `Observed ${kind} pixels are a display layer, not model input.\n\n` +
    `${identity.modeLabel}\n${identity.validTimeLabel}\n\n` +
    'The observation valid time may not match the model clock. Continue with ' +
    'an explicitly labelled observation overlay?',
  );
  if (accepted) {
    if (kind === 'satellite') satelliteOverlayAcknowledged = true;
    else radarOverlayAcknowledged = true;
  }
  return accepted;
}

function pointProbeReadingAt(point: LatLon, storm: StormState | null) {
  const monthIndex = currentSpawn?.monthIndex ?? readPickerMonth();
  const tFrac =
    activeScenario && storm
      ? eventTimeFraction(storm.ageH, activeScenario.windowH)
      : 0;
  const direct = envBin
    ? sampleEnvBin(
        envBin,
        point.lat,
        point.lon,
        monthIndex,
        tFrac,
        envSampler.getSamplingMode(),
      )
    : null;
  const environment =
    direct ?? envSampler.sample(point.lat, point.lon, monthIndex, tFrac);
  const upper =
    climatologyBin && upperBin
      ? sampleUpperWind(
          upperBin,
          point.lat,
          point.lon,
          monthIndex,
          envSampler.getSamplingMode(),
        )
      : null;
  const monthLabel = Array.from(monthSelect.options).find(
    (option) => Number(option.value) === monthIndex,
  )?.textContent;
  const environmentKind = direct
    ? activeScenario
      ? 'analysis' as const
      : 'climatology' as const
    : 'fallback' as const;
  const identity = buildProductIdentity({
    scenarioLabel: activeScenario?.label,
    scenarioStartIso: activeScenario?.startIso,
    hindcastStartIso: activeScenario?.hindcast?.startIso,
    runMode: activeRunMode,
    ageH: storm?.ageH ?? null,
  });
  return createPointProbeReading({
    ...point,
    environment,
    storm,
    upper,
    environmentKind,
    environmentLabel: activeScenario
      ? `${activeScenario.label} event fields`
      : direct
        ? `${(monthLabel ?? 'season').toLowerCase()} monthly fields`
        : 'analytic degraded mode',
    validTimeLabel: identity.validTimeLabel.toLowerCase(),
    simulatedRainMm: session.replayMode
      ? null
      : impact.displayRainAtMm(point.lat, point.lon),
    simulatedRainWindowLabel: rainAccumulationDefinition(
      activeRainAccumulationWindow,
    ).label,
  });
}

function refreshPointProbe(storm: StormState | null = displayedStorm()): void {
  if (!probePosition || pointProbeEl.hidden) return;
  ui.showPointProbe(
    pointProbeReadingAt(probePosition, storm),
    probePlacement(probePosition),
  );
}

function showPointProbeAt(clientX: number, clientY: number): void {
  const point = mapPointFromClient(clientX, clientY);
  if (!point) {
    if (!probePinned) ui.hidePointProbe();
    return;
  }
  probePosition = point;
  const storm = displayedStorm();
  ui.showPointProbe(
    pointProbeReadingAt(point, storm),
    probePlacement(point),
  );
}

function clearProbeTouch(pointerId?: number): void {
  if (!probeTouch || (pointerId !== undefined && probeTouch.id !== pointerId)) return;
  window.clearTimeout(probeTouch.timer);
  probeTouch = null;
}

pointProbePin.addEventListener('click', () => {
  if (!probePosition) return;
  probePinned = !probePinned;
  ui.setPointProbePinned(probePinned);
  if (!probePinned && !pointProbeEl.matches(':hover')) ui.hidePointProbe();
});
pointProbeEl.addEventListener('pointerleave', () => {
  if (!probePinned) ui.hidePointProbe();
});

// Minimal stroke icons for the layer rail — one glyph per layer id.
const LAYER_ICONS: Record<WeatherLayerId, string> = {
  wind: '<path d="M1.5 5.5h7.6a2 2 0 1 0-1.9-2.6M1.5 8.5h11a2 2 0 1 1-1.9 2.6M1.5 11.5h5.5"/>',
  rain: '<circle cx="8" cy="9.5" r="1.1"/><path d="M8 6a3.5 3.5 0 0 1 3.5 3.5M8 2.5a7 7 0 0 1 7 7"/>',
  infrared:
    '<path d="M4.6 11.5h6.9a2.5 2.5 0 0 0 .4-4.97A4 4 0 0 0 4.2 6.6a2.5 2.5 0 0 0 .4 4.9Z"/>',
  accum:
    '<path d="M8 2.2C8 2.2 4.9 6 4.9 8.5a3.1 3.1 0 0 0 6.2 0C11.1 6 8 2.2 8 2.2Z"/><path d="M3 14h10"/>',
  sst: '<path d="M6.8 2.8a1.2 1.2 0 0 1 2.4 0v6a2.8 2.8 0 1 1-2.4 0Z"/>',
  humidity:
    '<path d="M8 2.5C8 2.5 4.8 6.4 4.8 8.9a3.2 3.2 0 0 0 6.4 0C11.2 6.4 8 2.5 8 2.5Z"/><path d="M6.4 9.2a1.6 1.6 0 0 0 1.6 1.6"/>',
  ohc: '<path d="M2 10.5q1.5-1.5 3 0t3 0t3 0t3 0M2 13q1.5-1.5 3 0t3 0t3 0t3 0"/><path d="M6 3q1 1.2 0 2.4q-1 1.2 0 2.4M10 3q1 1.2 0 2.4q-1 1.2 0 2.4"/>',
  shear:
    '<path d="M2 5.5h9M11 5.5 8.8 3.3M11 5.5 8.8 7.7M14 10.5H5M5 10.5l2.2-2.2M5 10.5l2.2 2.2"/>',
  upper:
    '<path d="M1.5 4.5h9a2 2 0 1 0-2-2.5M1.5 8h12M1.5 11.5h7a2 2 0 1 1-2 2"/>',
  terrain: '<path d="M1.5 12.5 6 5l2.4 4 2.1-3 4 6.5Z"/>',
};

function layerIconSvg(id: WeatherLayerId): string {
  return (
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true">${LAYER_ICONS[id]}</svg>`
  );
}

function setSatelliteStatus(
  message: string,
  tone: 'simulated' | 'loading' | 'observed' | 'unavailable',
): void {
  satelliteStatus.value = message;
  satelliteStatus.textContent = message;
  satelliteStatus.dataset.tone = tone;
  satelliteAttribution.hidden = true;
  satelliteAttribution.removeAttribute('href');
}

function updateSatelliteButtons(): void {
  for (const button of satelliteSourceControls.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.source === activeSatelliteSource));
  }
  for (const button of satelliteProviderControls.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.provider === activeSatelliteProvider));
  }
  for (const button of satellitePaletteControls.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.palette === activeSatellitePalette));
  }
  satelliteKind.textContent = activeSatelliteSource === 'handoff'
    ? 'observed → simulated'
    : activeSatelliteSource;
}

function setRadarStatus(
  message: string,
  tone: 'simulated' | 'loading' | 'observed' | 'stale' | 'unavailable',
): void {
  radarStatus.value = message;
  radarStatus.textContent = message;
  radarStatus.dataset.tone = tone;
  radarAttribution.hidden = tone !== 'observed' && tone !== 'stale';
}

function updateRadarButtons(): void {
  for (const button of radarSourceControls.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.source === activeRadarSource));
  }
  radarKind.textContent = activeRadarSource;
  radarObservedControls.hidden = activeRadarSource !== 'observed';
  radarPlay.setAttribute('aria-pressed', String(radarPlaying));
  radarPlay.textContent = radarPlaying ? 'pause' : 'play';
}

function updateRadarTimelineUi(): void {
  const frame = radarFrames[radarFrameIndex] ?? null;
  radarTimelineInput.max = String(Math.max(0, radarFrames.length - 1));
  radarTimelineInput.value = String(Math.min(radarFrameIndex, Math.max(0, radarFrames.length - 1)));
  radarTimelineInput.disabled = radarFrames.length === 0;
  radarPrev.disabled = radarFrames.length < 2;
  radarNext.disabled = radarFrames.length < 2;
  radarPlay.disabled = radarFrames.length < 2;
  if (!frame) {
    radarTime.value = '—';
    radarTime.textContent = '—';
    radarAge.textContent = 'past composite';
    return;
  }
  const iso = radarFrameIso(frame);
  const ageMinutes = radarFrameAgeMinutes(frame);
  radarTime.value = formatObservedTime(iso);
  radarTime.textContent = formatObservedTime(iso);
  radarAge.textContent = `${Math.round(ageMinutes)} min behind wall clock`;
}

function selectedRadarStatus(): void {
  const frame = radarFrames[radarFrameIndex];
  if (!frame || activeRadarSource !== 'observed') return;
  const ageMinutes = radarFrameAgeMinutes(frame);
  const coverage = radarCoverageFraction == null
    ? 'coverage mask loading'
    : `${Math.round(radarCoverageFraction * 100)}% provider-mask coverage`;
  const tone = ageMinutes > 30 ? 'stale' : 'observed';
  setRadarStatus(
    `${coverage} · ${Math.round(ageMinutes)} min old · display only · not assimilated`,
    tone,
  );
  radarAttribution.href = RAINVIEWER_ATTRIBUTION_URL;
  radarAttribution.textContent = 'weather data by RainViewer ↗';
  radarAttribution.hidden = false;
}

async function showRadarFrame(index: number): Promise<void> {
  if (activeRadarSource !== 'observed' || radarFrames.length === 0 || !radarManifest) return;
  radarFrameIndex = Math.max(0, Math.min(radarFrames.length - 1, Math.round(index)));
  updateRadarTimelineUi();
  const frame = radarFrames[radarFrameIndex];
  const cached = radarFrameCache.get(frame.time);
  if (cached) {
    renderCtrl?.setObservedRadarFrame?.(cached);
    selectedRadarStatus();
    return;
  }

  const requestSeq = ++radarRequestSeq;
  radarFrameAbort?.abort();
  const abort = new AbortController();
  radarFrameAbort = abort;
  setRadarStatus(
    `loading ${formatObservedTime(radarFrameIso(frame))} · 6 bounded tiles…`,
    'loading',
  );
  try {
    const canvas = await loadRadarMosaic(radarManifest, frame, abort.signal);
    if (
      abort.signal.aborted ||
      requestSeq !== radarRequestSeq ||
      activeRadarSource !== 'observed' ||
      radarFrames[radarFrameIndex]?.time !== frame.time
    ) {
      return;
    }
    radarFrameCache.set(frame.time, canvas);
    renderCtrl?.setObservedRadarFrame?.(canvas);
    selectedRadarStatus();
  } catch (error) {
    if (!abort.signal.aborted && requestSeq === radarRequestSeq) {
      renderCtrl?.setObservedRadarFrame?.(null);
      setRadarStatus(
        `observed tiles unavailable · simulated pixels are not substituted · ${String(error)}`,
        'unavailable',
      );
    }
  }
}

async function refreshRadarTimeline(force = false): Promise<void> {
  if (activeRadarSource !== 'observed' || activeWeatherLayer !== 'rain') return;
  if (
    !force &&
    radarManifest &&
    Date.now() - radarManifestFetchedAtMs < 5 * 60_000
  ) {
    await showRadarFrame(radarFrameIndex);
    return;
  }

  radarManifestAbort?.abort();
  const abort = new AbortController();
  radarManifestAbort = abort;
  setRadarStatus('requesting RainViewer past-radar timeline…', 'loading');
  const selectedTime = radarFrames[radarFrameIndex]?.time ?? null;
  try {
    const response = await fetch(RAINVIEWER_MANIFEST_URL, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`timeline HTTP ${response.status}`);
    const parsed = parseRadarTimeline(await response.json());
    if (!parsed) throw new Error('timeline schema was not recognised');
    if (abort.signal.aborted || activeRadarSource !== 'observed') return;

    if (radarManifest && radarManifest.host !== parsed.host) radarFrameCache.clear();
    if (radarManifest && radarManifest.host !== parsed.host) {
      radarCoverageFraction = null;
      renderCtrl?.setObservedRadarCoverage?.(null);
    }
    radarManifest = parsed;
    radarFrames = recentRadarFrames(parsed);
    const preservedIndex = selectedTime == null
      ? -1
      : radarFrames.findIndex((frame) => frame.time === selectedTime);
    radarFrameIndex = preservedIndex >= 0 ? preservedIndex : radarFrames.length - 1;
    radarManifestFetchedAtMs = Date.now();
    updateRadarTimelineUi();

    void loadRadarCoverageMask(parsed.host, abort.signal)
      .then((coverage) => {
        if (abort.signal.aborted || radarManifest !== parsed) return;
        radarCoverageFraction = coverage.fraction;
        renderCtrl?.setObservedRadarCoverage?.(coverage.image);
        selectedRadarStatus();
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          radarCoverageFraction = null;
          renderCtrl?.setObservedRadarCoverage?.(null);
          console.warn('[radar] coverage mask unavailable:', error);
        }
      });
    await showRadarFrame(radarFrameIndex);
  } catch (error) {
    if (!abort.signal.aborted) {
      radarFrames = [];
      updateRadarTimelineUi();
      renderCtrl?.setObservedRadarFrame?.(null);
      setRadarStatus(
        `observed timeline unavailable · simulated pixels are not substituted · ${String(error)}`,
        'unavailable',
      );
    }
  }
}

function stopRadarLoop(): void {
  radarPlaying = false;
  if (radarPlayTimer != null) {
    window.clearTimeout(radarPlayTimer);
    radarPlayTimer = null;
  }
  updateRadarButtons();
}

async function advanceRadarLoop(): Promise<void> {
  if (!radarPlaying || radarFrames.length < 2) return;
  await showRadarFrame((radarFrameIndex + 1) % radarFrames.length);
  if (radarPlaying) {
    radarPlayTimer = window.setTimeout(() => void advanceRadarLoop(), 650);
  }
}

function setRadarPlaying(playing: boolean): void {
  stopRadarLoop();
  if (!playing || activeRadarSource !== 'observed' || radarFrames.length < 2) return;
  radarPlaying = true;
  updateRadarButtons();
  radarPlayTimer = window.setTimeout(() => void advanceRadarLoop(), 250);
}

function setRadarSource(source: RadarSourceMode): void {
  if (source === 'simulated') radarOverlayAcknowledged = false;
  activeRadarSource = source;
  renderCtrl?.setRadarSource?.(source);
  updateRadarButtons();
  updateWeatherLegend();
  if (source === 'simulated') {
    stopRadarLoop();
    radarManifestAbort?.abort();
    radarFrameAbort?.abort();
    renderCtrl?.setObservedRadarFrame?.(null);
    setRadarStatus(
      'MODEL RAIN PROXY · generated from deterministic storm rain rates · no observed pixels',
      'simulated',
    );
    return;
  }
  void refreshRadarTimeline();
}

function setRainAccumulationWindow(windowId: RainAccumulationWindow): void {
  activeRainAccumulationWindow = windowId;
  impact.setRainWindow(windowId);
  for (const button of accumWindowControls.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.window === windowId));
  }
  const definition = rainAccumulationDefinition(windowId);
  const period = definition.hours == null
    ? 'storm lifetime'
    : `trailing ${definition.label}`;
  const message = `MODEL RAIN PROXY · ${period} · fixed 15 min integration · no radar assimilation`;
  accumStatus.value = message;
  accumStatus.textContent = message;
  updateWeatherLegend();
  refreshPointProbe();
}

function updateWeatherLegend(): void {
  const definition = weatherLayerDefinition(activeWeatherLayer);
  weatherLegend.dataset.layer = activeWeatherLayer;
  if (activeWeatherLayer === 'infrared') {
    const palette = satellitePaletteDefinition(activeSatellitePalette);
    weatherLegendName.textContent = palette.label;
    weatherLegendUnit.textContent = activeSatelliteSource === 'simulated'
      ? `simulated · ${palette.unit}`
      : `${activeSatelliteProvider} · ${palette.unit}`;
    weatherLegendScale.textContent = palette.legend;
  } else if (activeWeatherLayer === 'rain' && activeRadarSource === 'observed') {
    weatherLegendName.textContent = 'observed radar';
    weatherLegendUnit.textContent = 'RainViewer composite · display only';
    weatherLegendScale.textContent = 'light · moderate · heavy · intense';
  } else if (activeWeatherLayer === 'accum') {
    const accumulation = rainAccumulationDefinition(activeRainAccumulationWindow);
    weatherLegendName.textContent = `${accumulation.label} accumulation`;
    weatherLegendUnit.textContent = 'mm · deterministic simulated-rain ledger';
    weatherLegendScale.textContent = rainAccumulationLegend(activeRainAccumulationWindow);
  } else if (activeWeatherLayer === 'rain') {
    weatherLegendName.textContent = 'model rain proxy';
    weatherLegendUnit.textContent = 'simulated structure · not observed dBZ';
    weatherLegendScale.textContent = definition.legend;
  } else {
    weatherLegendName.textContent = definition.shortLabel;
    weatherLegendUnit.textContent = definition.unit;
    weatherLegendScale.textContent = definition.legend;
  }
}

function satelliteTargetTime(storm: StormState | null): Date {
  if (activeScenario && storm) {
    const startIso = activeRunMode === 'hindcast'
      ? activeScenario.hindcast?.startIso ?? activeScenario.startIso
      : activeScenario.startIso;
    return new Date(Date.parse(startIso) + storm.ageH * 3_600_000);
  }
  // NRT imagery generally trails wall clock. A 30-minute latency target stays
  // within the latest complete 15-minute slot without labelling it as "now".
  return new Date(Date.now() - 30 * 60_000);
}

function satelliteTargetSlot(storm: StormState | null): string {
  const target = satelliteTargetTime(storm);
  // Accelerated historical playback uses the event environment's three-hour
  // cadence so it does not stampede a public WMS. As soon as playback pauses,
  // resolve the actual model timestamp to the satellite's 15-minute cadence;
  // inspection and validation are therefore timestamp-matched, not merely
  // "same day" approximations.
  return acquisitionSlotIso(target, activeScenario && !session.paused ? 180 : 15);
}

function formatObservedTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

async function showObservedFrame(
  frame: ObservedSatelliteFrame,
  requestSeq: number,
  signal: AbortSignal,
): Promise<void> {
  const bitmap = await loadObservedFrameImage(frame, signal);
  if (requestSeq !== satelliteRequestSeq || signal.aborted) {
    bitmap.close();
    return;
  }
  satelliteFrame = frame;
  renderCtrl?.setObservedSatelliteFrame?.(bitmap, frame.channel);
  if (activeSatelliteSource === 'handoff' && !satelliteHandoffStarted) {
    // The six-hour clock begins only after the initial pixels have arrived.
    // On a fast simulation, network latency must not consume the handoff before
    // the first observed frame is ever visible.
    satelliteHandoffStartAgeH = displayedStorm()?.ageH ?? 0;
    satelliteHandoffStarted = true;
    renderCtrl?.setSatelliteSource?.('handoff', satelliteHandoffStartAgeH);
  }
  const transition = activeSatelliteSource === 'handoff'
    ? ' · crossfades to simulation over 6 model hours'
    : '';
  setSatelliteStatus(
    `${frame.satellite} · ${frame.product} · ${formatObservedTime(frame.observedAt)}${transition}`,
    'observed',
  );
  satelliteAttribution.href = frame.sourceUrl;
  satelliteAttribution.textContent = `${frame.attribution} source ↗`;
  satelliteAttribution.hidden = false;
}

async function refreshSatelliteObservation(force = false): Promise<void> {
  if (
    activeWeatherLayer !== 'infrared' ||
    activeSatelliteSource === 'simulated' ||
    (activeSatelliteSource === 'handoff' && (satelliteHandoffStarted || satelliteHandoffSettled))
  ) {
    return;
  }
  const targetIso = satelliteTargetSlot(displayedStorm());
  const channel = channelForPalette(activeSatellitePalette);
  const key = `${activeSatelliteProvider}|${channel}|${targetIso}`;
  if (!force && key === satelliteRequestKey) return;
  satelliteRequestKey = key;
  const requestSeq = ++satelliteRequestSeq;
  satelliteRequestAbort?.abort();
  const abort = new AbortController();
  satelliteRequestAbort = abort;
  satelliteFrame = null;
  renderCtrl?.setObservedSatelliteFrame?.(null);
  setSatelliteStatus(
    `${activeSatelliteProvider} · matching ${formatObservedTime(targetIso)}…`,
    'loading',
  );

  const cached = matchObservedFrame(
    satelliteManifest.frames,
    targetIso,
    activeSatelliteProvider,
    channel,
    activeSatelliteProvider === 'insat' ? 40 : 20,
  );
  if (cached) {
    try {
      await showObservedFrame(cached, requestSeq, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted && requestSeq === satelliteRequestSeq) {
        setSatelliteStatus(`cached frame failed · ${String(error)}`, 'unavailable');
      }
    }
    return;
  }

  if (activeSatelliteProvider === 'meteosat') {
    const frame = meteosatWmsFrame(targetIso, activeSatellitePalette);
    if (!frame) {
      setSatelliteStatus(
        'outside EUMETView archive (starts 01 Aug 2020) · showing simulated fallback',
        'unavailable',
      );
      return;
    }
    try {
      await showObservedFrame(frame, requestSeq, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted && requestSeq === satelliteRequestSeq) {
        setSatelliteStatus(`Meteosat request failed · simulated fallback · ${String(error)}`, 'unavailable');
      }
    }
    return;
  }

  // MOSDAC's catalogue is public but is not CORS-enabled, and pixel downloads
  // require a registered account. Static clients therefore consume only
  // reviewed INSAT frames from the provenance manifest rather than generating
  // noisy browser failures or routing credentials through an untrusted proxy.
  setSatelliteStatus(
    `no cached INSAT frame at ${formatObservedTime(targetIso)} · registered MOSDAC ingest required · simulated fallback`,
    'unavailable',
  );
}

function setSatellitePalette(palette: SatellitePaletteId): void {
  activeSatellitePalette = palette;
  renderCtrl?.setSatellitePalette?.(palette);
  if (activeSatelliteSource === 'handoff') {
    satelliteHandoffStarted = false;
    satelliteHandoffSettled = false;
    satelliteFrame = null;
    renderCtrl?.setObservedSatelliteFrame?.(null);
  }
  updateSatelliteButtons();
  updateWeatherLegend();
  satelliteRequestKey = '';
  if (activeSatelliteSource === 'simulated') {
    const definition = satellitePaletteDefinition(palette);
    setSatelliteStatus(
      `${definition.label} generated from storm structure · no observed pixels`,
      'simulated',
    );
  } else {
    void refreshSatelliteObservation(true);
  }
}

function setSatelliteSource(source: SatelliteSourceMode): void {
  if (source === 'simulated') satelliteOverlayAcknowledged = false;
  activeSatelliteSource = source;
  satelliteHandoffStartAgeH = displayedStorm()?.ageH ?? 0;
  satelliteHandoffStarted = false;
  satelliteHandoffSettled = false;
  renderCtrl?.setSatelliteSource?.(source, satelliteHandoffStartAgeH);
  updateSatelliteButtons();
  updateWeatherLegend();
  satelliteRequestKey = '';
  if (source === 'simulated') {
    satelliteRequestAbort?.abort();
    setSatelliteStatus(
      `${satellitePaletteDefinition(activeSatellitePalette).label} generated from storm structure · no observed pixels`,
      'simulated',
    );
  } else {
    void refreshSatelliteObservation(true);
  }
}

function setSatelliteProvider(provider: SatelliteProviderId): void {
  activeSatelliteProvider = provider;
  if (activeSatelliteSource === 'handoff') {
    satelliteHandoffStartAgeH = displayedStorm()?.ageH ?? 0;
    satelliteHandoffStarted = false;
    satelliteHandoffSettled = false;
    satelliteFrame = null;
    renderCtrl?.setObservedSatelliteFrame?.(null);
    renderCtrl?.setSatelliteSource?.('handoff', satelliteHandoffStartAgeH);
  }
  updateSatelliteButtons();
  updateWeatherLegend();
  satelliteRequestKey = '';
  if (activeSatelliteSource !== 'simulated') void refreshSatelliteObservation(true);
}

function setWeatherLayer(layer: WeatherLayerId): void {
  if (
    layer === 'upper' &&
    resolveUpperWindMode(layer, availableUpperBin(readPickerMonth()), activeScenario !== null).disabled
  ) return;
  activeWeatherLayer = layer;
  renderCtrl?.setWeatherLayer?.(layer);
  satelliteWorkbench.hidden = layer !== 'infrared';
  radarWorkbench.hidden = layer !== 'rain';
  accumWorkbench.hidden = layer !== 'accum';
  if (layer !== 'rain') stopRadarLoop();
  updateWeatherLegend();
  for (const button of layerButtons.querySelectorAll<HTMLButtonElement>('.layer-button')) {
    button.setAttribute('aria-pressed', String(button.dataset.layer === layer));
  }
  if (layer === 'infrared' && activeSatelliteSource !== 'simulated') {
    void refreshSatelliteObservation();
  }
  if (layer === 'rain' && activeRadarSource === 'observed') {
    void refreshRadarTimeline();
  }
}

function availableUpperBin(monthIndex: number): ParsedBin | null {
  if (!climatologyBin || !upperBin) return null;
  return upperWindLayers(upperBin, monthIndex) ? upperBin : null;
}

function updateUpperWindLayerState(monthIndex = readPickerMonth()) {
  const state = resolveUpperWindMode(
    activeWeatherLayer,
    availableUpperBin(monthIndex),
    activeScenario !== null,
  );
  if (state.activeLayer !== activeWeatherLayer) {
    setWeatherLayer(state.activeLayer);
  }
  const button = layerButtons.querySelector<HTMLButtonElement>(
    '.layer-button[data-layer="upper"]',
  );
  if (button) {
    const definition = weatherLayerDefinition('upper');
    button.disabled = state.disabled;
    button.title = state.caption ?? definition.label;
    button.setAttribute(
      'aria-label',
      state.caption ? definition.label + ' · ' + state.caption : definition.label,
    );
    const label = button.querySelector<HTMLElement>('.label');
    if (label) label.textContent = state.caption ?? definition.shortLabel;
  }
  return state;
}

// Build the Windy-style rail: one button per catalogue layer, in order, with
// the Digit1..Digit0 key hint the keyboard handler mirrors.
layerButtons.replaceChildren(
  ...WEATHER_LAYERS.map((definition, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer-button';
    button.dataset.layer = definition.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', definition.label);
    button.title = definition.label;
    // The SVG markup is a compile-time constant (LAYER_ICONS above); the
    // catalogue text goes through textContent so it is never parsed as HTML.
    button.innerHTML = layerIconSvg(definition.id);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = definition.shortLabel;
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = digitHintForLayerIndex(index);
    button.append(label, key);
    button.addEventListener('click', () => {
      setWeatherLayer(definition.id);
      // Drop focus so the keydown form-control guard doesn't eat the very
      // Digit1-0 shortcuts this button advertises in its key hint.
      button.blur();
    });
    return button;
  }),
);
updateUpperWindLayerState();
for (const button of satelliteSourceControls.querySelectorAll<HTMLButtonElement>('button[data-source]')) {
  button.addEventListener('click', () => {
    const source = button.dataset.source;
    if (source === 'simulated' || source === 'observed' || source === 'handoff') {
      if (
        source !== 'simulated' &&
        !acknowledgeObservationOverlay('satellite', source)
      ) {
        updateSatelliteButtons();
        return;
      }
      setSatelliteSource(source);
    }
  });
}
for (const button of satelliteProviderControls.querySelectorAll<HTMLButtonElement>('button[data-provider]')) {
  button.addEventListener('click', () => {
    const provider = button.dataset.provider;
    if (provider === 'meteosat' || provider === 'insat') {
      setSatelliteProvider(provider);
    }
  });
}
for (const button of satellitePaletteControls.querySelectorAll<HTMLButtonElement>('button[data-palette]')) {
  button.addEventListener('click', () => {
    const palette = button.dataset.palette;
    if (SATELLITE_PALETTES.some((candidate) => candidate.id === palette)) {
      setSatellitePalette(palette as SatellitePaletteId);
    }
  });
}
for (const button of radarSourceControls.querySelectorAll<HTMLButtonElement>('button[data-source]')) {
  button.addEventListener('click', () => {
    const source = button.dataset.source;
    if (
      source === 'observed' &&
      !acknowledgeObservationOverlay('radar', source)
    ) {
      updateRadarButtons();
      return;
    }
    if (source === 'simulated' || source === 'observed') setRadarSource(source);
  });
}
radarPrev.addEventListener('click', () => {
  stopRadarLoop();
  void showRadarFrame(radarFrameIndex - 1);
});
radarNext.addEventListener('click', () => {
  stopRadarLoop();
  void showRadarFrame(radarFrameIndex + 1);
});
radarPlay.addEventListener('click', () => setRadarPlaying(!radarPlaying));
radarTimelineInput.addEventListener('input', () => {
  stopRadarLoop();
  void showRadarFrame(Number(radarTimelineInput.value));
});
for (const button of accumWindowControls.querySelectorAll<HTMLButtonElement>('button[data-window]')) {
  button.addEventListener('click', () => {
    const windowId = button.dataset.window ?? '';
    if (isRainAccumulationWindow(windowId)) setRainAccumulationWindow(windowId);
  });
}
setSatellitePalette(DEFAULT_SATELLITE_PALETTE);
setSatelliteSource('simulated');
setRadarSource('simulated');
setRainAccumulationWindow(DEFAULT_RAIN_ACCUMULATION_WINDOW);
setWeatherLayer(DEFAULT_WEATHER_LAYER);
window.setInterval(() => {
  if (activeWeatherLayer === 'rain' && activeRadarSource === 'observed') {
    void refreshRadarTimeline(true);
  }
}, 5 * 60_000);

function currentAnalysisUrls(): {
  envUrl: string;
  terrainUrl: string;
  steeringUrl?: string;
  oceanUrl: string;
} {
  const envPath = activeScenario?.bin ?? 'data/env.bin';
  const steeringPath = activeScenario
    ? activeScenario.bin.replace(/(^|\/)env_/, '$1steering_')
    : null;
  return {
    envUrl: new URL(asset(envPath), window.location.href).href,
    terrainUrl: new URL(asset('data/terrain.bin'), window.location.href).href,
    ...(steeringPath
      ? { steeringUrl: new URL(asset(steeringPath), window.location.href).href }
      : {}),
    oceanUrl: new URL(asset('data/ocean.bin'), window.location.href).href,
  };
}

/** "13 of 20 members" — frequencies are exact member fractions. */
function memberCount(frequency: number, members: number): string {
  return `${Math.round(frequency * members)} of ${members} members`;
}

function clearAutoEnsembleTimer(): void {
  if (autoEnsembleTimer !== null) {
    window.clearTimeout(autoEnsembleTimer);
    autoEnsembleTimer = null;
  }
}

/**
 * Start a worker ensemble run — the manual dock click or the automatic
 * post-spawn run. Cancels any in-flight run and any pending auto-run first.
 * The request payload is identical for both origins, so what an ensemble
 * computes never depends on how it was started; AUTO_ENSEMBLE_BUDGET gates
 * scheduling only.
 */
function startEnsembleRun(
  spawn: SpawnParams,
  count: number,
  origin: 'manual' | 'auto',
): void {
  clearAutoEnsembleTimer();
  activeEnsembleRun?.cancel();
  const label = origin === 'auto' ? 'auto ensemble · ' : '';
  const requestSeq = ++analysisRequestSeq;
  const startedAt = performance.now();
  ensembleRun.disabled = true;
  ensembleResults.hidden = true;
  ensembleStatus.value = `${label}starting ${count}-member worker ensemble…`;
  ensembleBoardSummary = {
    state: 'running',
    memberCount: count,
    completed: 0,
    hurricaneCount: 0,
    landfallCount: 0,
  };
  const urls = currentAnalysisUrls();
  const handle = requestEnsemble(
    {
      type: 'ensemble',
      ...urls,
      spawn,
      samplingMode: envSampler.getSamplingMode(),
      count,
    },
    (completed, total) => {
      if (requestSeq === analysisRequestSeq) {
        ensembleStatus.value = `${label}running members ${completed}/${total}`;
        ensembleBoardSummary = {
          state: 'running',
          memberCount: total,
          completed,
          hurricaneCount: 0,
          landfallCount: 0,
        };
      }
    },
  );
  activeEnsembleRun = handle;
  void handle.result
    .then((result) => {
      if (requestSeq !== analysisRequestSeq) return;
      const envelope = buildEnsembleEnvelope(result.members);
      renderCtrl?.setEnsemble?.(result, envelope);
      const members = result.members.length;
      // Frequencies are exact member fractions; rounding recovers the counts.
      ensembleBoardSummary = {
        state: 'done',
        memberCount: members,
        completed: members,
        hurricaneCount: Math.round(result.hurricaneProbability * members),
        landfallCount: Math.round(result.landfallProbability * members),
      };
      ensemblePeak.textContent =
        `${result.peakKt.p10.toFixed(0)}–${result.peakKt.p90.toFixed(0)} kt ` +
        `(median ${result.peakKt.median.toFixed(0)})`;
      // Counts, not percentages: HF-4 rejected the calibrated-probability
      // claim, and the auto run surfaces these without a user click.
      ensembleHurricane.textContent = memberCount(result.hurricaneProbability, members);
      ensembleMajor.textContent = memberCount(result.majorProbability, members);
      ensembleLandfall.textContent = memberCount(result.landfallProbability, members);
      ensembleResults.hidden = false;
      ensembleStatus.value =
        `${label}${currentRunName?.label ?? 'historical hindcast'} · ` +
        `${result.members.length} deterministic members · ` +
        `${((performance.now() - startedAt) / 1000).toFixed(1)} s · ` +
        (envelope
          ? 'perturbation-frequency envelope on map'
          : 'perturbation-frequency field on map · members dissipated before an envelope formed');
    })
    .catch((error: unknown) => {
      if (error instanceof EnsembleCancelledError) return;
      if (requestSeq !== analysisRequestSeq) return;
      renderCtrl?.setEnsemble?.(null, null);
      ensembleBoardSummary = null;
      ensembleStatus.value =
        error instanceof Error ? `ensemble failed · ${error.message}` : 'ensemble failed';
    })
    .finally(() => {
      if (activeEnsembleRun === handle) activeEnsembleRun = null;
      ensembleRun.disabled = false;
    });
}

ensembleRun.addEventListener('click', () => {
  const spawn = currentSpawn;
  if (!spawn || spawn.isDemo) {
    ensembleStatus.value = 'spawn or select a non-demo storm first';
    return;
  }
  startEnsembleRun(spawn, Number(ensembleSize.value), 'manual');
});

function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits);
  return `${value >= 0 ? '+' : '−'}${text}`;
}

function updateSensitivityLabels(): void {
  sensitivitySstValue.textContent = `${signed(Number(sensitivitySst.value), 1)} °C`;
  sensitivityRhValue.textContent = `${signed(Number(sensitivityRh.value), 0)}%`;
  sensitivityShearValue.textContent =
    `${signed(Number(sensitivityShear.value), 0)} m/s`;
  sensitivityOhcValue.textContent = `×${Number(sensitivityOhc.value).toFixed(1)}`;
  sensitivityOrgValue.textContent = signed(Number(sensitivityOrg.value), 2);
}
for (const control of [
  sensitivitySst,
  sensitivityRh,
  sensitivityShear,
  sensitivityOhc,
  sensitivityOrg,
]) {
  control.addEventListener('input', updateSensitivityLabels);
}
updateSensitivityLabels();

sensitivityRun.addEventListener('click', () => {
  const spawn = currentSpawn;
  if (!spawn || spawn.isDemo) {
    sensitivityStatus.value = 'spawn or select a non-demo storm first';
    return;
  }
  const perturbation: EnvironmentPerturbation = {
    sstDeltaC: Number(sensitivitySst.value),
    rhDeltaPct: Number(sensitivityRh.value),
    shearDeltaMs: Number(sensitivityShear.value),
    ohcScale: Number(sensitivityOhc.value),
  };
  // The shared seq would discard the ensemble's result anyway; cancel it so
  // the worker frees up for this run instead of finishing dead members. The
  // canceller owns the cleanup: without the summary/status reset the board
  // would claim "computing members k/20…" forever.
  clearAutoEnsembleTimer();
  if (activeEnsembleRun) {
    activeEnsembleRun.cancel();
    activeEnsembleRun = null;
    ensembleBoardSummary = null;
    ensembleStatus.value = 'cancelled · sensitivity run took the worker';
  }
  const requestSeq = ++analysisRequestSeq;
  const startedAt = performance.now();
  sensitivityRun.disabled = true;
  sensitivityStatus.value = 'running baseline + perturbed storm in worker…';
  void requestSensitivity({
    type: 'sensitivity',
    ...currentAnalysisUrls(),
    spawn,
    samplingMode: envSampler.getSamplingMode(),
    perturbation,
    organizationDelta: Number(sensitivityOrg.value),
  })
    .then(({ baseline, perturbed }) => {
      if (requestSeq !== analysisRequestSeq) return;
      const peakDelta = perturbed.peakKt - baseline.peakKt;
      const lifeDelta = perturbed.durationH - baseline.durationH;
      sensitivityStatus.value =
        `peak ${signed(peakDelta, 1)} kt · life ${signed(lifeDelta, 0)} h · ` +
        `${perturbed.landfall === baseline.landfall ? 'landfall unchanged' : perturbed.landfall ? 'landfall gained' : 'landfall lost'} · ` +
        `${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
    })
    .catch((error: unknown) => {
      if (requestSeq !== analysisRequestSeq) return;
      sensitivityStatus.value =
        error instanceof Error ? `experiment failed · ${error.message}` : 'experiment failed';
    })
    .finally(() => {
      sensitivityRun.disabled = false;
    });
});

/** Canvas-relative CSS-px coordinates for the camera gesture controller. */
function canvasPoint(event: PointerEvent | WheelEvent): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const rect = glCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    w: Math.max(1, rect.width),
    h: Math.max(1, rect.height),
  };
}

glCanvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const p = canvasPoint(event);
    cameraGestures.wheel(
      currentViewTransform(),
      event.deltaY,
      p.x,
      p.y,
      p.w,
      p.h,
    );
  },
  { passive: false },
);

// A second pinch finger can land on a city-marker button (they sit above the
// canvas and are prominent when zoomed). Adopt that pointer into the active
// camera gesture instead of letting it click the marker mid-pinch; pointer
// capture retargets its stream to glCanvas and cancelling the pointerdown
// suppresses the compatibility click.
window.addEventListener(
  'pointerdown',
  (event) => {
    if (cameraGestures.activePointers() === 0) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('.city-marker')) return;
    const p = canvasPoint(event);
    cameraGestures.pointerDown(event.pointerId, p.x, p.y);
    try {
      glCanvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    clearProbeTouch();
    event.preventDefault();
  },
  { capture: true },
);

glCanvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (event.pointerType === 'touch' && probePinned) {
    probePinned = false;
    probePosition = null;
    ui.hidePointProbe();
    return;
  }
  const p = canvasPoint(event);
  cameraGestures.pointerDown(event.pointerId, p.x, p.y);
  // Keep pan/pinch streams flowing when the pointer leaves the window.
  try {
    glCanvas.setPointerCapture(event.pointerId);
  } catch {
    /* capture is best-effort (synthetic events in tests lack it) */
  }
  if (cameraGestures.activePointers() >= 2) {
    // Second finger = pinch: this finger never becomes a tap or a probe
    // press, and the first finger's tap is suppressed on release.
    mapTap.cancel(event.pointerId);
    clearProbeTouch();
    return;
  }
  mapTap.start(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  if (event.pointerType === 'touch') {
    clearProbeTouch();
    const id = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const timer = window.setTimeout(() => {
      if (!probeTouch || probeTouch.id !== id) return;
      mapTap.cancel(id);
      probePinned = true;
      showPointProbeAt(probeTouch.latestX, probeTouch.latestY);
      ui.setPointProbePinned(true);
      probeTouch = null;
    }, 650);
    probeTouch = {
      id,
      startX,
      startY,
      latestX: startX,
      latestY: startY,
      timer,
    };
  }
});
glCanvas.addEventListener('pointermove', (event) => {
  mapTap.move(event.pointerId, event.clientX, event.clientY);
  const p = canvasPoint(event);
  const update = cameraGestures.pointerMove(
    currentViewTransform(),
    event.pointerId,
    p.x,
    p.y,
    p.w,
    p.h,
  );
  if (update.becamePan) {
    // The drag is now the camera's: cancel the pending tap + probe timers.
    mapTap.cancel(event.pointerId);
    clearProbeTouch(event.pointerId);
  }
  if (event.pointerType === 'mouse' && event.buttons === 0 && !probePinned) {
    showPointProbeAt(event.clientX, event.clientY);
  }
  if (probeTouch?.id === event.pointerId) {
    probeTouch.latestX = event.clientX;
    probeTouch.latestY = event.clientY;
    if (
      Math.hypot(
        event.clientX - probeTouch.startX,
        event.clientY - probeTouch.startY,
      ) > 10
    ) {
      clearProbeTouch(event.pointerId);
    }
  }
});
glCanvas.addEventListener('pointercancel', (event) => {
  cameraGestures.pointerCancel(event.pointerId);
  clearProbeTouch(event.pointerId);
  mapTap.cancel(event.pointerId);
});
glCanvas.addEventListener('pointerleave', (event) => {
  if (
    !probePinned &&
    !(event.relatedTarget instanceof Node && pointProbeEl.contains(event.relatedTarget))
  ) {
    ui.hidePointProbe();
  }
});
glCanvas.addEventListener('pointerup', (e) => {
  const wasCameraGesture = cameraGestures.pointerUp(e.pointerId);
  clearProbeTouch(e.pointerId);
  if (wasCameraGesture) {
    // The press panned or pinched the camera — it is not a spawn tap.
    mapTap.cancel(e.pointerId);
    return;
  }
  if (!mapTap.end(e.pointerId, e.clientX, e.clientY, e.timeStamp)) return;
  const point = mapPointFromClient(e.clientX, e.clientY);
  if (!point) return;
  const { lat, lon } = point;
  const params = ui.handlePointer(lat, lon, engine !== null, performance.now());
  if (params) {
    if (activeScenario) {
      activeRunMode = 'counterfactual';
      scenarioModeSelect.value = 'counterfactual';
      ui.setScenarioContext(activeScenario.label, 'counterfactual');
    }
    doSpawn(params);
  }
});

// Space toggles pause — but never when a form control is focused, so the native
// month picker stays keyboard-operable (a11y floor, design task T6).
function setReplayFrame(index: number): void {
  session.seek(index);
  accumulatorMin = 0;
}

function toggleTransport(): void {
  session.toggle();
  accumulatorMin = 0;
}

window.addEventListener('keydown', (e) => {
  // A focused widget already consumed this key (e.g. the sparkline scrubber
  // preventDefaults its arrows) — don't ALSO drive the camera or transport.
  if (e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (
    t instanceof HTMLSelectElement ||
    t instanceof HTMLInputElement ||
    t instanceof HTMLButtonElement
  ) {
    return;
  }
  const digitIndex = layerIndexForDigitCode(e.code);
  if (digitIndex !== null) {
    const index = digitIndex;
    const definition = WEATHER_LAYERS[index];
    if (definition) {
      e.preventDefault();
      setWeatherLayer(definition.id);
    }
    return;
  }
  if (e.code === 'Escape' && probePinned) {
    probePinned = false;
    probePosition = null;
    ui.hidePointProbe();
    return;
  }
  // Camera keys: arrows pan, +/- zoom about the centre, h/Home = full domain.
  // Modified keys stay the browser's (Ctrl+/- page zoom is an a11y feature;
  // Alt+arrows is history navigation).
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const rect = glCanvas.getBoundingClientRect();
    const camera = cameraGestures.key(
      currentViewTransform(),
      e.code,
      Math.max(1, rect.width),
      Math.max(1, rect.height),
    );
    if (camera) {
      e.preventDefault();
      return;
    }
  }
  if (e.code !== 'Space') return;
  e.preventDefault();
  toggleTransport();
});

flightToggle.addEventListener('click', toggleTransport);
flightScrubber.addEventListener('input', () => {
  setReplayFrame(Number(flightScrubber.value));
});
flightStart.addEventListener('click', () => {
  const milestone = session.recorder.milestones();
  if (milestone) setReplayFrame(milestone.start);
});
flightPeak.addEventListener('click', () => {
  const milestone = session.recorder.milestones();
  if (milestone) setReplayFrame(milestone.peak);
});
flightLandfall.addEventListener('click', () => {
  const milestone = session.recorder.milestones();
  if (milestone?.landfall != null) setReplayFrame(milestone.landfall);
});
flightEnd.addEventListener('click', () => {
  const milestone = session.recorder.milestones();
  if (milestone) setReplayFrame(milestone.end);
});

async function runControlledComparison(): Promise<void> {
  const completed = session.recorder.snapshot();
  if (!completed || completed.meta.isDemo) return;
  const [kind, id] = compareTarget.value.split(':', 2);

  if (
    (kind === 'month' &&
      completed.meta.environmentId === CLIMATOLOGY_ID &&
      completed.meta.monthIndex === Number(id)) ||
    (kind === 'scenario' && completed.meta.environmentId === id)
  ) {
    ui.comparisonMessage('choose a different environment for a useful comparison.');
    return;
  }

  const baseline = session.beginComparison();
  if (!baseline) return;
  const identity = baseline.meta.spawn;
  compareRun.disabled = true;

  if (kind === 'month') {
    const monthIndex = Number(id);
    if (!Number.isInteger(monthIndex) || monthIndex < 4 || monthIndex > 10) {
      session.clearComparison();
      compareRun.disabled = false;
      return;
    }
    preEventMonth = null;
    applyClimatologyEnv(monthIndex);
    doSpawn(
      {
        lat: identity.lat,
        lon: identity.lon,
        seed: identity.seed,
        monthIndex,
        isDemo: false,
      },
      { preserveComparison: true },
    );
    ui.comparisonMessage(
      `comparison running · same genesis and seed in ${labelForRun({
        ...identity,
        monthIndex,
      })}.`,
    );
    compareRun.disabled = false;
    return;
  }

  if (kind === 'scenario') {
    const scenario = findScenario(scenarios, id);
    if (!scenario) {
      session.clearComparison();
      compareRun.disabled = false;
      return;
    }
    ui.scenarioLoading(scenario.label);
    const bin = await loadEventBin(scenario);
    if (!bin) {
      session.clearComparison();
      ui.scenarioError(scenario.label);
      compareRun.disabled = false;
      return;
    }
    applyEventEnv(scenario, bin, 'counterfactual');
    doSpawn(eventSpawn(scenario, identity, 'counterfactual'), {
      preserveComparison: true,
    });
    ui.comparisonMessage(
      `comparison running · same genesis and seed in the ${scenario.label} environment.`,
    );
  }
  compareRun.disabled = false;
}

compareRun.addEventListener('click', () => {
  void runControlledComparison();
});
compareClear.addEventListener('click', () => {
  session.clearComparison();
  ui.comparisonMessage('comparison cleared. the current storm remains on tape.');
});

exportCard.addEventListener('click', () => {
  const run = session.recorder.snapshot();
  if (!run) return;
  ui.setExportStatus('drawing debrief card…', true);
  void captureMapFrame()
    .then((capture) =>
      makeDebriefCard({
        run,
        comparison: session.comparison(),
        mapCanvas: capture.canvas,
        view: capture.view,
      }),
    )
    .then((blob) => {
      downloadBlob(blob, `${exportFileStem(run)}.png`);
      ui.setExportStatus('PNG saved.', false);
    })
    .catch((error: unknown) => {
      console.warn('[export] debrief card failed:', error);
      ui.setExportStatus('card export failed.', false);
    });
});

exportReplay.addEventListener('click', () => {
  const run = session.recorder.snapshot();
  if (!run) return;
  ui.setExportStatus('recording 10 s replay…', true);
  void captureMapFrame()
    .then((capture) =>
      makeReplayVideo({
        run,
        comparison: session.comparison(),
        mapCanvas: capture.canvas,
        view: capture.view,
      }),
    )
    .then((blob) => {
      downloadBlob(blob, `${exportFileStem(run)}.webm`);
      ui.setExportStatus('WebM replay saved.', false);
    })
    .catch((error: unknown) => {
      console.warn('[export] replay failed:', error);
      ui.setExportStatus('replay unsupported here; the PNG card still works.', false);
    });
});

// Month picker → re-spawn the active storm at the same point + seed in the new
// month (deterministic June-vs-October compare). The new month reaches the sim
// via SpawnParams.monthIndex; render's month-dependent SST tint is part of the
// unsettled render data seam.
monthSelect.addEventListener('change', () => {
  const m = Number(monthSelect.value);
  if (Number.isInteger(m)) renderCtrl?.setMonth?.(m); // refresh SST tint even with no active storm
  const params = ui.onMonthChange();
  if (params) doSpawn(params);
});

// Scenario picker → switch environment regime (climatology sandbox vs a historic
// event replay). main owns the change listener + the async event-bin fetch (C8);
// the swap re-points the live env holder without rebuilding the sampler.
scenarioSelect.addEventListener('change', () => {
  void onScenarioChange(scenarioSelect.value);
});
scenarioModeSelect.addEventListener('change', () => {
  if (!activeScenario) return;
  const mode: EventRunMode =
    scenarioModeSelect.value === 'hindcast' && activeScenario.hindcast
      ? 'hindcast'
      : 'counterfactual';
  const userStorm = ui.activeUserSpawn();
  activeRunMode = mode;
  ui.setScenarioContext(activeScenario.label, mode);
  doSpawn(eventSpawn(activeScenario, userStorm, mode), {
    rememberAsUser: mode !== 'hindcast',
  });
  ui.scenarioEntered(activeScenario.label, mode);
});

// --- The loop ---------------------------------------------------------------
let lastMs = performance.now();
let prevFrameStorm: StormState | null = null;
let dbgFrames = 0;
let dbgTicks = 0;
let dbgLastDt = 0;
// Public-contract field the render facade ignores (it owns its own textures);
// still built every frame so FrameState conforms to types.ts.
const envTextures: EnvTextures = new Map();

/** Advance one fixed physics step and route its events to the UI. */
function tickSim(nowMs: number): void {
  if (!engine) return;
  prevHead = currHead;
  let events;
  try {
    events = engine.tick(SIM_DT_MIN);
  } catch (err) {
    console.warn('[tick] engine.tick threw:', err);
    return;
  }
  const s = engine.getState();
  if (s) {
    session.record(s, events);
    impact.record(s, SIM_DT_MIN / 60);
  }
  currHead = s ? headOf(s) : null;
  for (const ev of events) ui.onSimEvent(ev, nowMs);
}

/** Build the interpolated storm view for this frame from the fixed-step heads. */
function buildStorm(): { storm: StormState | null; prev: StormState | null } {
  const live = engine ? engine.getState() : null;
  const recorded = session.stormView(live);
  if (session.replayMode) return recorded;
  if (!live) return { storm: null, prev: null };
  const prev: StormState =
    prevHead && currHead
      ? {
          ...live,
          lat: prevHead.lat,
          lon: prevHead.lon,
          vKt: prevHead.vKt,
          structure: cloneStormStructure(prevHead.structure),
        }
      : live;
  return { storm: live, prev };
}

function render(alpha: number, nowMs: number, hydroDeltaH: number): void {
  const { storm, prev } = buildStorm();
  const handoffComplete = activeSatelliteSource === 'handoff' &&
    satelliteHandoffStarted &&
    storm !== null &&
    storm.ageH - satelliteHandoffStartAgeH >= 6;
  if (handoffComplete && !satelliteHandoffSettled) {
    satelliteHandoffSettled = true;
    satelliteRequestAbort?.abort();
    renderCtrl?.setObservedSatelliteFrame?.(null);
    const initialization = satelliteFrame
      ? ` · initialized from ${satelliteFrame.satellite} ${formatObservedTime(satelliteFrame.observedAt)}`
      : '';
    setSatelliteStatus(`simulated evolution${initialization}`, 'simulated');
  } else if (activeWeatherLayer === 'infrared' && activeSatelliteSource !== 'simulated') {
    void refreshSatelliteObservation();
  }
  const view = currentViewTransform();
  // Clamp feedback: keep the gesture state exactly what the screen shows, so
  // panning against a domain edge never accumulates invisible offset.
  cameraGestures.reset(viewStateOf(view));
  const vk = viewKey(view);
  if (vk !== lastRenderedViewKey) {
    lastRenderedViewKey = vk;
    // Trail history is screen-registered; a camera move invalidates it.
    renderCtrl?.clearWindTrails?.();
  }
  ui.setView(view);
  const frame: FrameState = {
    storm,
    prevStorm: prev ?? prevFrameStorm,
    alpha,
    envTextures,
    reducedMotion: prefersReducedMotion,
    isDemo: storm?.isDemo ?? false,
    nowMs,
    paused: session.paused || session.replayMode,
    replayMode: session.replayMode,
    comparisonTrack: session.comparisonTrack,
    hydroDeltaH,
    envSamplingMode: envSampler.getSamplingMode(),
    envTFrac:
      activeScenario && storm
        ? eventTimeFraction(storm.ageH, activeScenario.windowH)
        : 0,
    rainAccum: impact.rainView(),
    view,
  };

  // main owns the base clear of both canvases (guards against any render layer
  // forgetting to clear the overlay it draws the track on). Layers composite in
  // luminance order; then the UI draws genesis glow + ripples on top.
  gl!.clear(gl!.COLOR_BUFFER_BIT);
  overlay.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  for (const layer of layers) {
    try {
      layer.draw(frame);
    } catch (err) {
      console.warn('[render] layer draw threw (skipping this frame):', err);
    }
  }
  flushMapCaptures();
  prevFrameStorm = storm;

  ui.drawOverlay(nowMs); // genesis glow + ripples, on top of the track
  ui.update(nowMs); // expire the aftermath fade back to the rarity copy
  const impactSummary = impact.summary(storm);
  ui.updateCityMarkers(storm, impactSummary);
  refreshPointProbe(storm);
  refreshProductIdentity(storm);
  ui.updateStormTag(
    storm && !storm.isDemo && (storm.alive || session.replayMode)
      ? {
          label:
            currentRunName?.name ??
            activeScenario?.label ??
            currentRunLabel,
          vKt: storm.vKt,
          hPa: storm.structure.centralPressureHpa,
          trendKtPerH: storm.diagnostics.netKtPerH,
          lat: storm.lat,
          lon: storm.lon,
        }
      : null,
  );
  ui.updateFlightRecorder({
    storm,
    label: currentRunLabel,
    frameIndex: session.frameIndex,
    frameCount: session.recorder.frameCount,
    debrief: session.recorder.debrief(),
    milestones: session.recorder.milestones(),
    paused: session.paused,
    replayMode: session.replayMode,
    replayPlaying: session.replayPlaying,
    counterfactual:
      activeScenario !== null && activeRunMode === 'counterfactual',
    hindcast: activeScenario !== null && activeRunMode === 'hindcast',
    hindcastScore: activeHindcastScore(),
    comparisonActive: session.comparisonBaseline !== null,
    comparison: session.comparison(),
    impact: impactSummary,
    landfallKt: landfallWindKt(),
    intensitySeries: session.recorder.intensitySeries(),
    historicalAnalog: storm?.isDemo ? null : activeAnalog(),
    ensemble: ensembleBoardSummary,
    ensembleMembersShown,
  });
}

/** Wind at the recorded landfall frame, cached per landfall (stormAt is O(n)). */
function landfallWindKt(): number | null {
  const landfall = session.recorder.debrief()?.landfall ?? null;
  if (!landfall) return null;
  if (landfallKtCache?.frameIndex !== landfall.frameIndex) {
    const at = session.recorder.stormAt(landfall.frameIndex);
    landfallKtCache = {
      frameIndex: landfall.frameIndex,
      vKt: at?.vKt ?? 0,
    };
  }
  return landfallKtCache.vKt;
}

function frame(nowMs: number): void {
  const dtRealMs = Math.min(nowMs - lastMs, MAX_FRAME_MS);
  lastMs = nowMs;
  dbgFrames++;
  dbgLastDt = dtRealMs;

  let hydroDeltaH = 0;
  if (session.replayPlaying) {
    session.advanceReplay(dtRealMs);
  } else if (!session.paused && !session.replayMode) {
    const live = engine ? engine.getState() : null;
    const hoursPerSec = ui.timescaleHoursPerSec(live);
    const simMinutesPerMs = (hoursPerSec * 60) / 1000;
    accumulatorMin += dtRealMs * simMinutesPerMs;
    let ticks = 0;
    while (accumulatorMin >= SIM_DT_MIN && ticks < MAX_TICKS_PER_FRAME) {
      tickSim(nowMs);
      accumulatorMin -= SIM_DT_MIN;
      ticks++;
    }
    dbgTicks += ticks;
    hydroDeltaH = ticks * (SIM_DT_MIN / 60);
    if (ticks >= MAX_TICKS_PER_FRAME) accumulatorMin = 0; // shed backlog, stay real-time
  }

  const alpha = accumulatorMin / SIM_DT_MIN; // 0..1 between fixed steps
  render(alpha, nowMs, hydroDeltaH);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Render-facade resolution (defensive against the module's oscillating export)
// ---------------------------------------------------------------------------

function isRenderLayer(v: unknown): v is RenderLayer {
  return (
    !!v &&
    typeof (v as RenderLayer).init === 'function' &&
    typeof (v as RenderLayer).draw === 'function' &&
    typeof (v as RenderLayer).resize === 'function'
  );
}

/** Baked data injected into the render facade (mode A). Structural mirror of
 *  render's RenderResources so main need not import across the build boundary. */
interface RenderResourcesLike {
  terrain: ParsedBin | null;
  env: ParsedBin | null;
  upper: ParsedBin | null;
  genesis: LatLon[];
  tracks: GhostPolyline[];
}

/** A render facade that also accepts injected resources + a month (mode A). */
type RenderController = RenderLayer & {
  init(gl: WebGL2RenderingContext, overlay?: CanvasRenderingContext2D, resources?: RenderResourcesLike): void;
  setResources?(resources: RenderResourcesLike): void;
  setMonth?(monthIndex: number): void;
  setWeatherLayer?(layer: WeatherLayerId): void;
  setSatellitePalette?(palette: SatellitePaletteId): void;
  setSatelliteSource?(source: SatelliteSourceMode, handoffStartAgeH?: number): void;
  setObservedSatelliteFrame?(image: ImageBitmap | null, channel?: SatelliteChannel): void;
  setRadarSource?(source: RadarSourceMode): void;
  setObservedRadarFrame?(image: TexImageSource | null): void;
  setObservedRadarCoverage?(image: TexImageSource | null): void;
  setParticleBudget?(count: number): void;
  setCloudTape?(tape: CloudTape | null): void;
  /** Highlight the active-scenario ghost polyline (C7/C8); null clears. */
  setActiveGhost?(id: string | null): void;
  /** Ensemble overlay: result + precomputed percentile envelope; null clears. */
  setEnsemble?(result: EnsembleResult | null, envelope: EnsembleEnvelope | null): void;
  /** Member spaghetti on demand (the envelope is the default product). */
  setEnsembleMembersVisible?(visible: boolean): void;
  /** Screen-registered wind-trail history is stale after any camera move. */
  clearWindTrails?(): void;
};

function hasInjectionApi(v: RenderLayer): v is RenderController {
  const r = v as RenderController;
  return typeof r.setResources === 'function' && typeof r.setMonth === 'function';
}

/**
 * Resolve the render module and prefer MODE A (`createRenderer`): main owns the
 * single data-load path and injects the parsed bins via setResources(), so the
 * facade never self-fetches the same four URLs (the double-download seam). Falls
 * back to `createRenderLayers` (mode B, self-sourcing) only if createRenderer is
 * absent — a degraded path kept for resilience. Returns the draw list plus the
 * injectable controller (null in mode B).
 */
function acquireRender(glCtx: WebGL2RenderingContext): { layers: RenderLayer[]; ctrl: RenderController | null } {
  const mod = renderModule as Record<string, unknown>;
  const makeA = mod.createRenderer as (() => unknown) | undefined;
  if (typeof makeA === 'function') {
    const built = makeA();
    if (isRenderLayer(built) && hasInjectionApi(built)) return { layers: [built], ctrl: built };
  }
  const makeB = mod.createRenderLayers as ((gl: WebGL2RenderingContext) => unknown) | undefined;
  if (typeof makeB === 'function') {
    const built = makeB(glCtx);
    const layers = Array.isArray(built) ? built.filter(isRenderLayer) : isRenderLayer(built) ? [built] : [];
    return { layers, ctrl: null };
  }
  return { layers: [], ctrl: null };
}

// --- Go ---------------------------------------------------------------------
// Read-only live-state probe for the browser console (tuning/diagnosis aid).
// Note: in a hidden/background tab Chrome suspends rAF entirely, so the sim
// clock freezes and __cyc reads a static state — that is expected, not a hang;
// the MAX_FRAME_MS clamp resumes cleanly on re-focus.
Object.defineProperty(window, '__cyc', {
  get: () => {
    const storm = engine ? engine.getState() : null;
    return {
      paused: session.paused,
      accumulatorMin,
      lastMs,
      dbgFrames,
      dbgTicks,
      dbgLastDt,
      hasEngine: engine !== null,
      layerCount: layers.length,
      replayIndex: session.replayIndex,
      replayPlaying: session.replayPlaying,
      flightFrameCount: session.recorder.frameCount,
      debrief: session.recorder.debrief(),
      hoursPerSec: ui.timescaleHoursPerSec(storm),
      activeScenario: activeScenario?.id ?? null,
      weatherLayer: activeWeatherLayer,
      satellite: {
        source: activeSatelliteSource,
        provider: activeSatelliteProvider,
        palette: activeSatellitePalette,
        frame: satelliteFrame?.id ?? null,
        observedAt: satelliteFrame?.observedAt ?? null,
      },
      envSamplingMode: envSampler.getSamplingMode(),
      envTFrac:
        activeScenario && storm
          ? eventTimeFraction(storm.ageH, activeScenario.windowH)
          : 0,
      storm,
    };
  },
});
requestAnimationFrame(frame);
void loadSatelliteManifest().then(() => {
  if (activeWeatherLayer === 'infrared' && activeSatelliteSource !== 'simulated') {
    satelliteRequestKey = '';
    void refreshSatelliteObservation(true);
  }
});
void refreshPublicCycleMonitor();
void loadAll();
