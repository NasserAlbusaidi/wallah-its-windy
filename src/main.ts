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
import { readHash, writeHash } from './rng';
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
} from './types';
import { UiController } from './ui';
import { createSimEngine } from './sim';
import { makeEnvSampler, synopticCount } from './env-sampler';
import { parseTracks, toGhostPolylines, computeLabelAnchors } from './tracks';
import type { GhostPolyline, StormTrack } from './tracks';
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

// --- Environment sampler (sim dependency) -----------------------------------
// The sim requires an EnvSampler. It closes over a live holder: once env.bin
// loads, `envBin` is set and the sampler reads the real baked fields (REAL OISST
// SST + SYNTHETIC_V0 steering/shear — see bake/README.md); before it lands, or if
// the fetch 404s, it falls back to a deterministic analytic Arabian-Sea
// climatology so the demo and user storms still form, drift and die. Both
// branches are pure in (lat,lon,month), so the sim stays a pure function of
// (spawn,month,seed). See src/env-sampler.ts.
let envBin: ParsedBin | null = null;
const envSampler = makeEnvSampler(() => envBin);

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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(glCanvas.clientWidth * dpr);
  const h = Math.floor(glCanvas.clientHeight * dpr);
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
];

const loadedWeight = new Map<string, number>();
let genesisPoints: LatLon[] = [];
/** Parsed historic tracks, or null when the file is absent/malformed (no ghosts). */
let parsedTracks: StormTrack[] | null = null;

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
  const terrain = mergedTerrain(bins);
  ui.setLandMask(findLandMask(terrain));
  ui.setGenesis(genesisPoints);
  envBin = bins.get('env') ?? null;

  // Ghost tracks (C7): the facade draws the polylines; ui owns the DOM labels.
  // parsedTracks is null when tracks.json is absent/malformed -> empty everywhere.
  const ghostTracks: GhostPolyline[] = parsedTracks ? toGhostPolylines(parsedTracks) : [];
  ui.setGhostLabels(parsedTracks ? computeLabelAnchors(parsedTracks) : []);

  // Inject the single parsed copy into the render facade (mode A): the exact
  // bytes main just loaded feed BOTH the sim sampler and the GPU textures, so no
  // URL is fetched twice and no bin is dequantized twice (the double-load seam).
  renderCtrl?.setResources?.({ terrain, env: envBin, genesis: genesisPoints, tracks: ghostTracks });

  // First storm: a shared storm from the URL hash replays exactly; otherwise the
  // ambient demo (design T1). The demo is fast-forwarded so it opens mid-life.
  const shared = readHash();
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
}
let prevHead: Head | null = null;
let currHead: Head | null = null;
let accumulatorMin = 0;

function headOf(s: StormState): Head {
  return { lat: s.lat, lon: s.lon, vKt: s.vKt };
}

/** Spawn (replacing any active storm), reset interpolation, and share via the hash. */
function doSpawn(params: SpawnParams): void {
  if (!engine) return;
  // Seed picks the synoptic regime (D10): env.bin u/v/shr carry nt=K real-year
  // planes; select BEFORE spawn so the whole life (incl. warmup ticks) rides one
  // coherent regime and sim = f(spawn, month, seed) holds. K=1 -> always plane 0.
  envSampler.setSynopticIndex(params.seed % synopticCount(envBin, params.monthIndex));
  try {
    engine.spawn(params);
  } catch (err) {
    console.warn('[spawn] engine.spawn threw:', err);
    return;
  }
  const s = engine.getState();
  currHead = s ? headOf(s) : null;
  prevHead = currHead;
  accumulatorMin = 0;
  if (!params.isDemo) {
    writeHash({ lat: params.lat, lon: params.lon, monthIndex: params.monthIndex, seed: params.seed });
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

// --- Input ------------------------------------------------------------------
// Click to spawn. Screen -> clip -> lat/lon through grid.ts (the only coordinate
// owner). Ocean -> despawn + fresh spawn; land -> ripple, no storm (design T2).
glCanvas.addEventListener('pointerdown', (e) => {
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
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const t = e.target as HTMLElement | null;
  if (t instanceof HTMLSelectElement || t instanceof HTMLInputElement || t instanceof HTMLButtonElement) return;
  e.preventDefault();
  paused = !paused;
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
  currHead = s ? headOf(s) : null;
  for (const ev of events) ui.onSimEvent(ev, nowMs);
}

/** Build the interpolated storm view for this frame from the fixed-step heads. */
function buildStorm(): { storm: StormState | null; prev: StormState | null } {
  const live = engine ? engine.getState() : null;
  if (!live) return { storm: null, prev: null };
  const prev: StormState =
    prevHead && currHead
      ? { ...live, lat: prevHead.lat, lon: prevHead.lon, vKt: prevHead.vKt }
      : live;
  return { storm: live, prev };
}

function render(alpha: number, nowMs: number): void {
  const { storm, prev } = buildStorm();
  const frame: FrameState = {
    storm,
    prevStorm: prev ?? prevFrameStorm,
    alpha,
    envTextures,
    reducedMotion: prefersReducedMotion,
    isDemo: storm?.isDemo ?? false,
    nowMs,
    paused,
    synopticIndex: Math.max(0, envSampler.getSynopticIndex()),
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
  prevFrameStorm = storm;

  ui.drawOverlay(nowMs); // genesis glow + ripples, on top of the track
  ui.update(nowMs); // expire the aftermath fade back to the rarity copy
}

function frame(nowMs: number): void {
  const dtRealMs = Math.min(nowMs - lastMs, MAX_FRAME_MS);
  lastMs = nowMs;
  dbgFrames++;
  dbgLastDt = dtRealMs;

  if (!paused) {
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
    if (ticks >= MAX_TICKS_PER_FRAME) accumulatorMin = 0; // shed backlog, stay real-time
  }

  const alpha = accumulatorMin / SIM_DT_MIN; // 0..1 between fixed steps
  render(alpha, nowMs);
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
  get: () => ({
    paused,
    accumulatorMin,
    lastMs,
    dbgFrames,
    dbgTicks,
    dbgLastDt,
    hasEngine: engine !== null,
    layerCount: layers.length,
    hoursPerSec: ui.timescaleHoursPerSec(engine ? engine.getState() : null),
    storm: engine ? engine.getState() : null,
  }),
});
requestAnimationFrame(frame);
void loadAll();
