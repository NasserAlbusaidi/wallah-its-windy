/**
 * main.ts — the app shell + fixed-dt accumulator loop (eng task T2 seam).
 *
 * This is a SKELETON: it boots the chrome, opens a WebGL2 context, clears to a
 * dark instrument background, loads baked data progressively, and runs the
 * deterministic simulation clock. The sim / render / ui modules plug into the
 * clearly marked TODO seams — nothing here fakes their behaviour.
 *
 * Time model (design doc): 1 real second = 3 simulated hours. Physics advances
 * on a FIXED dt of 15 simulated minutes via an accumulator; the renderer
 * interpolates between steps with `alpha` so motion stays smooth at any FPS.
 * The fixed step is what makes the sim a pure function of (spawn, month, seed).
 */

import './style.css';
import { injectCssVars, TOKENS } from './tokens';
import { readHash } from './rng';
import { DOMAIN, clipToLatLon, inBBox } from './grid';
import type { FrameState, UiState, EnvTextures } from './types';
import { AFTERMATH_FADE_MS } from './types';

// --- Time constants ---------------------------------------------------------
const SIM_DT_MIN = 15; // fixed physics step, simulated minutes
const SIM_HOURS_PER_REAL_SEC = 3; // 1 real s = 3 sim h
const SIM_MINUTES_PER_REAL_MS = (SIM_HOURS_PER_REAL_SEC * 60) / 1000; // = 0.18
const MAX_FRAME_MS = 250; // clamp long stalls (tab blur) so we never spiral

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
  // TODO(render): forward resize(w, h) to every RenderLayer.
}
window.addEventListener('resize', resize);
resize();

// --- UI state ---------------------------------------------------------------
let uiState: UiState = { kind: 'loading', progress: 0 };
let selectedMonth = Number(monthSelect.value) || 5; // default June (index 5)

/** Set the caption slot. Plain text only (no innerHTML) — `hint` dims it. */
function setCaption(text: string, hint = false): void {
  captionEl.textContent = text;
  captionEl.classList.toggle('hint', hint);
}

// --- Progressive data loading ----------------------------------------------
interface LoadItem {
  url: string;
  label: string;
  /** approximate bytes, used to weight aggregate progress before headers arrive */
  weight: number;
}

function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

// TODO(data): add terrain.bin, env.bin, flowacc.bin here once bake.py emits them.
// The mechanism below already handles per-file progress and aggregate weighting;
// only this manifest grows. genesis.json ships now (see public/data/genesis.json).
const MANIFEST: LoadItem[] = [{ url: asset('data/genesis.json'), label: 'genesis zones', weight: 1 }];

const loadedBytes = new Map<string, number>();

function reportProgress(): void {
  const total = MANIFEST.reduce((s, m) => s + m.weight, 0);
  const done = MANIFEST.reduce((s, m) => s + Math.min(loadedBytes.get(m.url) ?? 0, m.weight), 0);
  const frac = total > 0 ? done / total : 1;
  progressEl.style.setProperty('--progress', String(frac));
  if (uiState.kind === 'loading') uiState = { kind: 'loading', progress: frac };
}

/**
 * Fetch one file, reporting fractional progress [0,1] for it via `onProgress`.
 * Falls back gracefully when Content-Length is absent (progress jumps to 1 on
 * completion). Returns null (and logs) on failure so one missing file cannot
 * brick the boot during the data-baking phase.
 */
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

async function loadAll(): Promise<void> {
  await Promise.all(
    MANIFEST.map(async (item) => {
      const buf = await loadWithProgress(item, (frac) => {
        loadedBytes.set(item.url, frac * item.weight);
        reportProgress();
      });
      // TODO(data): route buf into parseBin (for .bin) or JSON.parse (genesis),
      // then hand parsed layers to the EnvSampler / render texture upload.
      void buf;
    }),
  );
  progressEl.setAttribute('data-done', 'true');
  // TODO(sim): spawn the ambient demo storm (fixed seed, dimmed) — design D3.
  // If the URL hash carries a shared storm, spawn THAT instead of the demo.
  const shared = readHash();
  uiState = { kind: 'idle-demo' };
  setCaption(
    shared ? 'shared storm loaded — click the sea to spawn your own' : 'click the sea to spawn your own',
    true,
  );
}

// --- Input seams ------------------------------------------------------------
// Click to spawn. Convert screen -> clip -> lat/lon through grid.ts (the only
// place coordinate math is allowed). Land clicks get a dim ripple, no storm.
glCanvas.addEventListener('pointerdown', (e) => {
  const rect = glCanvas.getBoundingClientRect();
  const clipX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const clipY = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // screen y is flipped
  const { lat, lon } = clipToLatLon(clipX, clipY);
  if (!inBBox(lat, lon, DOMAIN)) return;
  // TODO(sim/ui): if over land -> ripple (design D-land-click); else engine.spawn
  //   ({ lat, lon, monthIndex: selectedMonth, seed: randomSeed(), isDemo: false })
  //   then writeHash(...) and uiState = { kind: 'user-storm' }.
  console.debug(`[spawn seam] lat=${lat.toFixed(2)} lon=${lon.toFixed(2)} month=${selectedMonth}`);
});

// Space toggles pause.
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
  }
});

// Month picker.
monthSelect.addEventListener('change', () => {
  selectedMonth = Number(monthSelect.value);
  // TODO(sim): re-spawn the active storm in the new month at the same point.
});

// --- The loop ---------------------------------------------------------------
let accumulatorMin = 0;
let lastMs = performance.now();
let prevFrame: FrameState | null = null;
const envTextures: EnvTextures = new Map();

function render(alpha: number, nowMs: number): void {
  // Skeleton render: clear both canvases to the instrument background. Real
  // RenderLayers composite here in luminance order (terrain -> env -> track ->
  // particles -> rain), reading the FrameState below.
  gl!.clear(gl!.COLOR_BUFFER_BIT);
  overlay.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const frame: FrameState = {
    storm: null, // TODO(sim): engine.getState()
    prevStorm: prevFrame?.storm ?? null,
    alpha,
    envTextures,
    reducedMotion: prefersReducedMotion,
    isDemo: uiState.kind === 'idle-demo',
    nowMs,
  };
  // TODO(render): for (const layer of layers) layer.draw(frame);
  prevFrame = frame;

  // Aftermath fade bookkeeping seam.
  if (uiState.kind === 'aftermath' && nowMs - uiState.fadeStartMs > AFTERMATH_FADE_MS) {
    uiState = { kind: 'idle-demo' };
  }
}

function tickSim(): void {
  // TODO(sim): const events = engine.tick(SIM_DT_MIN); route events to ui (epitaph
  // on 'died', pacing on 'landfall'). Fixed dt keeps the sim deterministic.
}

function frame(nowMs: number): void {
  const dtRealMs = Math.min(nowMs - lastMs, MAX_FRAME_MS);
  lastMs = nowMs;

  if (!paused) {
    accumulatorMin += dtRealMs * SIM_MINUTES_PER_REAL_MS;
    while (accumulatorMin >= SIM_DT_MIN) {
      tickSim();
      accumulatorMin -= SIM_DT_MIN;
    }
  }

  const alpha = accumulatorMin / SIM_DT_MIN; // 0..1 between fixed steps
  render(alpha, nowMs);
  requestAnimationFrame(frame);
}

// --- Go ---------------------------------------------------------------------
requestAnimationFrame(frame);
void loadAll();
