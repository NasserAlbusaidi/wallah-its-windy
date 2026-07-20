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
import { DOMAIN, clipToLatLon, inBBox } from './grid';
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
import { makeEnvSampler, synopticCount } from './env-sampler';
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
import type { Scenario } from './scenarios';
import { StormSession } from './storm-session';
import {
  downloadBlob,
  exportFileStem,
  makeDebriefCard,
  makeReplayVideo,
} from './export';
import { chooseRenderProfile } from './performance';
import { TapGesture } from './tap-gesture';
import { cloneStormStructure } from './structure';

// Render facade. Composited passes in luminance order (terrain -> env glow ->
// rain -> particles -> track), each with init/resize/draw/dispose, driven by main.
// main resolves the module by a namespace probe (acquireRender) and PREFERS mode A
// (createRenderer): main owns the single data-load path and injects the parsed
// bins via setResources()/setMonth(), so the facade never self-fetches the same
// four URLs (the double-download seam). It falls back to createRenderLayers (mode
// B, self-sourcing) only if createRenderer is absent. Either way storm particles +
// track render from FrameState.storm.
import * as renderModule from './render';

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
const session = new StormSession();

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
const envSampler = makeEnvSampler(() => envBin);

// --- Scenario runtime (counterfactual event replays, C8) --------------------
/** Validated scenario catalogue (data/scenarios.json); empty disables the picker. */
let scenarios: Scenario[] = [];
/** Parsed event bins, cached so re-toggling a scenario never refetches. */
const eventBinCache = new Map<string, ParsedBin>();
/** The active event, or null for climatology (the default sandbox). */
let activeScenario: Scenario | null = null;
/** The month the picker showed when the user LEFT climatology, to restore on return. */
let preEventMonth: number | null = null;
/** Monotonic guard so a slow event fetch can't clobber a newer switch. */
let scenarioReqSeq = 0;

// --- Sim + render construction (defensive against half-done siblings) --------
let engine: SimEngine | null = null;
try {
  engine = createSimEngine({ env: envSampler, isLand: (lat, lon) => ui.isLand(lat, lon) });
} catch (err) {
  console.warn('[boot] sim engine unavailable — running as a static map:', err);
}

let layers: RenderLayer[] = [];
let renderCtrl: RenderController | null = null;
try {
  const acquired = acquireRender(gl);
  layers = acquired.layers;
  renderCtrl = acquired.ctrl;
  const emptyResources: RenderResourcesLike = { terrain: null, env: null, genesis: [], tracks: [] };
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
} catch (err) {
  console.warn('[boot] render layers unavailable — map will not composite:', err);
  layers = [];
  renderCtrl = null;
}

// --- Canvas sizing ----------------------------------------------------------
function resize(): void {
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
  ui.layoutGhostLabels();
}
window.addEventListener('resize', resize);
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

// terrain/env/flowacc are listed now even though bake.py may not emit them yet:
// loadWithProgress swallows a 404 and returns null, so a missing artifact cannot
// brick the boot — the map simply assembles with whatever landed.
const MANIFEST: LoadItem[] = [
  { url: asset('data/terrain.bin'), label: 'terrain', kind: 'bin', key: 'terrain', weight: 3 },
  { url: asset('data/env.bin'), label: 'environment', kind: 'bin', key: 'env', weight: 2 },
  { url: asset('data/flowacc.bin'), label: 'wadi network', kind: 'bin', key: 'flowacc', weight: 2 },
  { url: asset('data/genesis.json'), label: 'genesis zones', kind: 'json', key: 'genesis', weight: 1 },
  // Historic ghost tracks (C7). Missing/404 degrades to null -> no ghosts, no labels.
  { url: asset('data/tracks.json'), label: 'historic tracks', kind: 'json', key: 'tracks', weight: 1 },
  // Scenario catalogue (C8). Missing/404 -> null -> the scenario picker disables.
  { url: asset('data/scenarios.json'), label: 'scenarios', kind: 'json', key: 'scenarios', weight: 1 },
];

const loadedWeight = new Map<string, number>();
let genesisPoints: LatLon[] = [];
/** Parsed historic tracks, or null when the file is absent/malformed (no ghosts). */
let parsedTracks: StormTrack[] | null = null;
/** Parsed scenario catalogue, or null when the file is absent/malformed. */
let parsedScenarios: Scenario[] | null = null;
/** Merged terrain+flowacc bin, retained so a scenario switch can re-inject it. */
let mergedTerrainBin: ParsedBin | null = null;
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
    }
  } catch (err) {
    console.warn(`[load] ${item.label} parsed badly, skipping:`, err);
    // A .bin that downloaded but won't parse is a stale/corrupt cached file
    // (loader throws a version/magic error, decision D4). Surface one caption
    // instead of silently degrading to the analytic fallback + sea-ring mask.
    if (item.kind === 'bin') ui.notifyDataError();
  }
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
  ui.setGenesis(genesisPoints);
  climatologyBin = bins.get('env') ?? null;
  envBin = climatologyBin;

  // Ghost tracks (C7): the facade draws the polylines; ui owns the DOM labels.
  // parsedTracks is null when tracks.json is absent/malformed -> empty everywhere.
  ghostTracks = parsedTracks ? toGhostPolylines(parsedTracks) : [];
  ui.setGhostLabels(parsedTracks ? computeLabelAnchors(parsedTracks) : []);

  // Scenario catalogue (C8): an absent/empty catalogue disables the picker (only
  // climatology is reachable — we have no event bin paths to fetch).
  scenarios = parsedScenarios ?? [];
  scenarioSelect.disabled = scenarios.length === 0;
  ui.setComparisonScenarios(scenarios);

  // Inject the single parsed copy into the render facade (mode A): the exact
  // bytes main just loaded feed BOTH the sim sampler and the GPU textures, so no
  // URL is fetched twice and no bin is dequantized twice (the double-load seam).
  renderCtrl?.setResources?.({ terrain: mergedTerrainBin, env: envBin, genesis: genesisPoints, tracks: ghostTracks });

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
      applyEventEnv(sharedScenario, bin); // pins the picker to the event month (authoritative)
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
const pendingMapCaptures: Array<(canvas: HTMLCanvasElement) => void> = [];

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
function captureMapFrame(): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => pendingMapCaptures.push(resolve));
}

function flushMapCaptures(): void {
  if (pendingMapCaptures.length === 0) return;
  const snapshot = document.createElement('canvas');
  snapshot.width = glCanvas.width;
  snapshot.height = glCanvas.height;
  const ctx = snapshot.getContext('2d');
  if (!ctx) {
    pendingMapCaptures.splice(0).forEach((resolve) => resolve(snapshot));
    return;
  }
  ctx.drawImage(glCanvas, 0, 0);
  pendingMapCaptures.splice(0).forEach((resolve) => resolve(snapshot));
}

function labelForRun(params: SpawnParams): string {
  if (activeScenario) return `${activeScenario.label} counterfactual`;
  const option = Array.from(monthSelect.options).find(
    (candidate) => Number(candidate.value) === params.monthIndex,
  );
  return `${(option?.textContent ?? 'season').toLowerCase()} climatology`;
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

/** Spawn (replacing any active storm), reset interpolation, and share via the hash. */
function doSpawn(
  params: SpawnParams,
  options: { preserveComparison?: boolean } = {},
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
  const spawn: SpawnParams =
    inEvent && params.tFracHorizonH === undefined
      ? { ...params, tFracHorizonH: activeScenario!.windowH }
      : params;
  try {
    engine.spawn(spawn);
  } catch (err) {
    console.warn('[spawn] engine.spawn threw:', err);
    return;
  }
  const s = engine.getState();
  currentRunLabel = labelForRun(spawn);
  ui.rememberSpawn(spawn);
  if (s) {
    session.start(
      {
        spawn: { ...spawn },
        environmentId: activeScenario?.id ?? CLIMATOLOGY_ID,
        monthIndex: spawn.monthIndex,
        seed: spawn.seed,
        isDemo: spawn.isDemo,
        label: currentRunLabel,
        counterfactual: activeScenario !== null,
        historicalPeakKt: activeHistoricalPeakKt(),
      },
      s,
      options.preserveComparison ?? false,
    );
  }
  currHead = s ? headOf(s) : null;
  prevHead = currHead;
  accumulatorMin = 0;
  if (!spawn.isDemo) {
    // The scenario id doubles as the hash env key (gonu/shaheen); validate it so a
    // catalogue that ever adds an id outside the known set can't emit a bad hash.
    const env = activeScenario && isEnvHashKey(activeScenario.id) ? activeScenario.id : undefined;
    writeHash({ lat: spawn.lat, lon: spawn.lon, monthIndex: spawn.monthIndex, seed: spawn.seed, env });
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
      if (state) session.record(state, events);
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
  if (cached) return cached;
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
    return bin;
  } catch (err) {
    console.warn(`[scenario] ${scenario.label} bin parsed badly:`, err);
    return null;
  }
}

/**
 * Apply an event's environment WITHOUT spawning: swap the live env holder (never
 * rebuild the sampler), pin + disable the month picker at the historic month, feed
 * the render facade the event env + month, and light the active ghost + its label.
 * Captures the pre-event month once, on the transition out of climatology.
 */
function applyEventEnv(scenario: Scenario, bin: ParsedBin): void {
  if (!activeScenario) preEventMonth = readPickerMonth();
  activeScenario = scenario;
  envBin = bin; // sampler live-swap — the sim reads the event env on its next tick
  // Sync the scenario picker to the active event (C8 fidelity). On the shared-URL
  // boot path nothing else sets it, so without this the picker keeps its DOM
  // default 'climatology' while the event runs — and, because selecting the
  // already-shown 'climatology' fires no 'change', the user can't leave the event.
  // On interactive switches the value already matches, so this stays idempotent.
  scenarioSelect.value = scenario.id;
  monthSelect.value = String(scenario.monthIndex);
  monthSelect.disabled = true; // a historic event is pinned to its real month
  renderCtrl?.setResources?.({ terrain: mergedTerrainBin, env: bin, genesis: genesisPoints, tracks: ghostTracks });
  renderCtrl?.setMonth?.(scenario.monthIndex);
  renderCtrl?.setActiveGhost?.(scenario.ghostId);
  ui.highlightGhost(scenario.ghostId);
  ui.setScenarioContext(scenario.label);
}

/** Enter an event interactively (from the picker): apply its env, then spawn the
 *  counterfactual (active user storm re-run in the event) or the canonical spawn. */
function enterScenario(scenario: Scenario, bin: ParsedBin): void {
  applyEventEnv(scenario, bin);
  doSpawn(eventSpawn(scenario, ui.activeUserSpawn()));
  ui.scenarioEntered(scenario.label);
}

/**
 * Return to the climatology sandbox: restore the default env, re-enable + restore
 * the month picker, clear the ghost highlight, and re-spawn — the active user storm
 * at the restored month (so it becomes an ordinary storm again), or the ambient
 * demo when none was active.
 */
function applyClimatologyEnv(month: number): void {
  activeScenario = null;
  envBin = climatologyBin;
  monthSelect.disabled = false;
  monthSelect.value = String(month);
  scenarioSelect.value = CLIMATOLOGY_ID;
  renderCtrl?.setActiveGhost?.(null);
  ui.highlightGhost(null);
  ui.setScenarioContext(null);
  renderCtrl?.setResources?.({
    terrain: mergedTerrainBin,
    env: climatologyBin,
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
glCanvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  mapTap.start(event.pointerId, event.clientX, event.clientY, event.timeStamp);
});
glCanvas.addEventListener('pointermove', (event) => {
  mapTap.move(event.pointerId, event.clientX, event.clientY);
});
glCanvas.addEventListener('pointercancel', (event) => {
  mapTap.cancel(event.pointerId);
});
glCanvas.addEventListener('pointerup', (e) => {
  if (!mapTap.end(e.pointerId, e.clientX, e.clientY, e.timeStamp)) return;
  const rect = glCanvas.getBoundingClientRect();
  const clipX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const clipY = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // screen y is flipped
  const { lat, lon } = clipToLatLon(clipX, clipY);
  if (!inBBox(lat, lon, DOMAIN)) return;
  const params = ui.handlePointer(lat, lon, engine !== null, performance.now());
  if (params) doSpawn(params);
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
  if (e.code !== 'Space') return;
  const t = e.target as HTMLElement | null;
  if (t instanceof HTMLSelectElement || t instanceof HTMLInputElement || t instanceof HTMLButtonElement) return;
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
    applyEventEnv(scenario, bin);
    doSpawn(eventSpawn(scenario, identity), { preserveComparison: true });
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
    .then((mapCanvas) =>
      makeDebriefCard({
        run,
        comparison: session.comparison(),
        mapCanvas,
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
    .then((mapCanvas) =>
      makeReplayVideo({
        run,
        comparison: session.comparison(),
        mapCanvas,
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
  if (s) session.record(s, events);
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
    counterfactual: activeScenario !== null,
    comparisonActive: session.comparisonBaseline !== null,
    comparison: session.comparison(),
  });
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
  genesis: LatLon[];
  tracks: GhostPolyline[];
}

/** A render facade that also accepts injected resources + a month (mode A). */
type RenderController = RenderLayer & {
  init(gl: WebGL2RenderingContext, overlay?: CanvasRenderingContext2D, resources?: RenderResourcesLike): void;
  setResources?(resources: RenderResourcesLike): void;
  setMonth?(monthIndex: number): void;
  setParticleBudget?(count: number): void;
  /** Highlight the active-scenario ghost polyline (C7/C8); null clears. */
  setActiveGhost?(id: string | null): void;
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
void loadAll();
