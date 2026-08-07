/**
 * render/index.ts — the render facade behind which the layer modules live.
 *
 * The composition root (main.ts, a sibling builder authored in parallel) has been
 * seen wiring rendering two different ways during the build. This facade supports
 * BOTH so it stays green whichever main ships:
 *
 *   A. Injection    — createRenderer() then
 *        r.init(gl, overlay2d, { terrain, env, genesis });  // resources injected
 *        r.setResources({...}); r.setMonth(m); r.resize(w,h); r.draw(frame);
 *      main hands over the merged terrain+flowacc ParsedBin, env.bin, genesis, the
 *      2D overlay context, and the month.
 *
 *   B. Bare layers  — createRenderLayers(gl): RenderLayer[] then
 *        layer.init(gl); layer.resize; layer.draw(frame); layer.dispose();
 *      main gives ONLY gl + FrameState (data routed to sim/ui). The facade then
 *      SELF-SOURCES: it fetches terrain.bin/flowacc.bin/env.bin/genesis.json,
 *      parses them via loader.ts (the only .bin reader), acquires the
 *      #overlay-canvas 2D context (getContext('2d') returns the same instance),
 *      and reads/follows #month.
 *
 *      Mode B is a DEGRADED FALLBACK: main prefers mode A, because concurrent
 *      identical GETs are NOT coalesced by the browser cache — if both main AND
 *      the facade fetched the four bins, first-load wire cost would double. With
 *      mode A the facade never self-fetches (see init: selfLoad runs only when no
 *      resources were injected).
 *
 * Either way the facade owns every GPU texture (built from the ParsedBins — the
 * only place that knows the right internal formats; FrameState.envTextures is
 * intentionally unused), clears BOTH surfaces when it draws, and composites in
 * luminance order: terrain (opaque) -> diagnostic weather ->
 * wind flow where selected -> track+halo on the overlay (ui ripples land on top
 * afterwards). The old generic storm-particle swarm is deliberately not
 * composited over diagnostic products because it obscures their values.
 * ui.ts confirms this division: the facade owns the track overlay while UI
 * interaction hints are added last.
 */

import { AFTERMATH_FADE_MS } from '../types';
import type {
  BinLayer,
  FrameState,
  LatLon,
  ParsedBin,
  RenderLayer,
  StormStructure,
  TrackPoint,
} from '../types';
import { TOKENS } from '../tokens';
import { DOMAIN, latLonToClip } from '../grid';
import {
  DISPLAY_CONTEXT_ASSET_PATH,
  matchesDisplayContextGrid,
} from '../display-domain';
import { parseBin } from '../loader';
import { probeCaps } from './gl-utils';
import type { GlCaps } from './gl-utils';
import {
  buildBasinRG8Tex,
  buildElevationTex,
  buildR8Tex,
  buildUpperWindRG8Tex,
  environmentPlaneInterpolation,
  hasTimedFlowRouting,
  pickLayer,
  planeMax,
  normalizeLoggedFlowAccumulation,
  SST_MAX_C,
  SST_MIN_C,
  upperWindTexturePlane,
} from './textures';
import { sampleEnvBin } from '../env-sampler';
import { upperWindLayers } from '../upper-sampler';
import { sampleLayerBilinear } from '../raster-sampler';
import type { DrawCtx, EnvAtStorm, GpuTextures } from './context';
import { TerrainLayer } from './terrain';
import { domainCanvasRect, domainScissorRect } from '../domain-clip';
import { EnvLayer } from './env';
import { WindLayer } from './wind';
import { RainLayer } from './rain';
import { RadarLayer } from './radar';
import { TrackLayer } from './track';
import { GhostLayer } from './ghosts';
import { EnsembleLayer } from './ensemble';
import type { EnsembleResult } from '../ensemble';
import type { EnsembleEnvelope } from '../ensemble-envelope';
import { parseTracks, toGhostPolylines } from '../tracks';
import type { GhostPolyline } from '../tracks';
import {
  cloneStormStructure,
  interpolateStormStructure,
} from '../structure';
import type { WeatherLayerId } from '../weather-layers';
import type { SatellitePaletteId } from '../weather-layers';
import type {
  SatelliteChannel,
  SatelliteSourceMode,
} from '../satellite-observations';
import { ObservedSatelliteLayer } from './satellite';
import { normalizeRainAccumulationMm } from '../rain-accumulation';
import type { RadarSourceMode } from '../radar-observations';
import { ObservedRadarLayer } from './observed-radar';
import { CloudMemoryPass } from './cloud-memory';
import type { CloudTape } from './cloud-memory';
import { cloudSeedFromGenesis, interpolatedCloudAgeH } from './cloud-motion';

/** Baked data handed to the renderer (mode A); any field may arrive progressively. */
export interface RenderResources {
  /** terrain.bin + flowacc.bin merged: elev + landmask + flowacc + basin layers. */
  terrain: ParsedBin | null;
  /** Regional GMRT display context. Presentation-only; optional during progressive load. */
  contextTerrain?: ParsedBin | null;
  /** env.bin: sst/steering/shear magnitude+vector layers (MM = 04..10). */
  env: ParsedBin | null;
  /** upper.bin: plane-aligned ERA5 u200/v200 climatology sidecar. */
  upper: ParsedBin | null;
  /** genesis.json points (historic genesis zones). */
  genesis: LatLon[];
  /** tracks.json historic-storm polylines (ghost tracks, C7). Empty when absent. */
  tracks: GhostPolyline[];
}

export interface RadarPresentation {
  observed: boolean;
  simulated: boolean;
}

/**
 * Resolve radar presentation without silently crossing the observation/model
 * boundary. An observed request with no frame stays empty; it never falls back
 * to simulated reflectivity or the model rain-accumulation composite.
 */
export function radarPresentation(
  layer: WeatherLayerId,
  source: RadarSourceMode,
  hasObservedFrame: boolean,
): RadarPresentation {
  if (layer !== 'rain') return { observed: false, simulated: false };
  if (source === 'observed') {
    return { observed: hasObservedFrame, simulated: false };
  }
  return { observed: false, simulated: true };
}

const ELEV_NAMES = ['elev', 'elevation', 'dem', 'z'];
const LAND_NAMES = ['landmask', 'land', 'mask', 'lsm'];
const ACC_NAMES = ['flowacc', 'acc', 'accum', 'facc'];
const BASIN_NAMES = ['basin', 'basinid', 'basin_id', 'catchment'];
const FLOW_DIR_NAMES = ['flowdir', 'dir'];
const TRAVEL_NAMES = ['travmin', 'travel'];

const LOAD_FADE_MS = 700; // data-arrival fade-in (design D2)
const MAX_DT_SEC = 0.05;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * env.bin encodes the month in the layer NAME: bake writes
 * `sst_MM/u_MM/v_MM/shr_MM/shu_MM/shv_MM`
 * where MM is the 0-indexed monthIndex (bake SEASON_MONTHS = [4..10] = May..Nov),
 * zero-padded — so the suffix is monthIndex itself, NOT monthIndex+1. Off-season
 * months clamp to the nearest season month. Mirror of env-sampler.envMonthSuffix.
 */
function envMonthNames(monthIndex: number): {
  sst: string;
  u: string;
  v: string;
  shr: string;
  shu: string;
  shv: string;
  rh: string;
  ohc: string;
} {
  const mm = String(Math.min(10, Math.max(4, monthIndex))).padStart(2, '0');
  return {
    sst: `sst_${mm}`,
    u: `u_${mm}`,
    v: `v_${mm}`,
    shr: `shr_${mm}`,
    shu: `shu_${mm}`,
    shv: `shv_${mm}`,
    rh: `rh_${mm}`,
    ohc: `ohc_${mm}`,
  };
}

function emptyGpu(): GpuTextures {
  return {
    terrainGrid: null,
    elev: null,
    land: null,
    contextTerrainGrid: null,
    contextElev: null,
    contextLand: null,
    acc: null,
    basin: null,
    hasBasin: false,
    flowDir: null,
    travelMin: null,
    hasFlowRouting: false,
    envGrid: null,
    sst: null,
    sstNext: null,
    humidity: null,
    humidityNext: null,
    ohc: null,
    ohcNext: null,
    shear: null,
    shearNext: null,
    steerU: null,
    steerUNext: null,
    steerV: null,
    steerVNext: null,
    upperUV: null,
    rainAccum: null,
    envBlend: 0,
    genesisClip: null,
  };
}

/** Merge two ParsedBins (later loses on name collisions). Used to bridge B-mode. */
function mergeBins(a: ParsedBin | null, b: ParsedBin | null): ParsedBin | null {
  if (!a && !b) return null;
  const layers = new Map<string, BinLayer>();
  if (a) for (const [k, v] of a.layers) layers.set(k, v);
  if (b) for (const [k, v] of b.layers) if (!layers.has(k)) layers.set(k, v);
  return { version: a?.version ?? b?.version ?? 1, layers };
}

export class RenderPipeline implements RenderLayer {
  private gl: WebGL2RenderingContext | null = null;
  private overlay: CanvasRenderingContext2D | null = null;
  private caps: GlCaps = { colorBufferFloat: false, floatLinear: false };
  private res: RenderResources = { terrain: null, env: null, upper: null, genesis: [], tracks: [] };
  private gpu: GpuTextures = emptyGpu();
  private monthIndex = 5;
  private weatherLayer: WeatherLayerId = 'terrain';
  private satellitePalette: SatellitePaletteId = 'enhanced';
  private satelliteSource: SatelliteSourceMode = 'simulated';
  private satelliteHandoffStartAgeH = 0;
  private radarSource: RadarSourceMode = 'simulated';
  private envPlane = -1;
  private envNextPlane = -1;
  private envPlaneMode = '';
  private upperPlane: number | null = null;
  private injected = false;

  // Self-source (mode B) holders.
  private monthSelect: HTMLSelectElement | null = null;
  private terrBin: ParsedBin | null = null;
  private flowBin: ParsedBin | null = null;

  private terrain = new TerrainLayer();
  private env = new EnvLayer();
  private cloudMemory = new CloudMemoryPass();
  private satellite = new ObservedSatelliteLayer();
  private observedRadar = new ObservedRadarLayer();
  private wind = new WindLayer();
  private upperWind = new WindLayer('upper');
  private rain = new RainLayer();
  private radar = new RadarLayer();
  private ghosts = new GhostLayer();
  private ensemble = new EnsembleLayer();
  private track = new TrackLayer();
  /** Version of the impact rain grid currently uploaded (-1 = none). */
  private accumVersion = -1;

  private width = 1;
  private height = 1;
  private lastNowMs = -1;
  private contextLost = false;
  private terrainReadyMs = -1;
  private contextTerrainReadyMs = -1;
  private glowReadyMs = -1;

  private deathMs: number | null = null;
  private memCenter: { x: number; y: number } | null = null;
  private memTrack: TrackPoint[] | null = null;
  private memVkt = 0;
  private memIntensity = 0;
  private memDemo = false;
  private memStructure: StormStructure | null = null;

  // --- public RenderLayer contract (init/resize/draw/dispose) ----------------

  init(gl: WebGL2RenderingContext, overlay?: CanvasRenderingContext2D, resources?: RenderResources): void {
    this.gl = gl;
    this.overlay = overlay ?? this.acquireOverlay();
    if (resources) {
      this.res = resources;
      this.injected = true;
    }
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initGl();
    if (!this.injected) {
      this.acquireMonthFromDom();
      void this.selfLoad();
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.env.resize(this.width, this.height);
    this.cloudMemory.resize(this.width, this.height);
    this.satellite.resize(this.width, this.height);
    this.observedRadar.resize(this.width, this.height);
    this.wind.resize(this.width, this.height);
    this.upperWind.resize(this.width, this.height);
    this.rain.resize(this.width, this.height);
    this.radar.resize(this.width, this.height);
    this.ghosts.resize(this.width, this.height);
    this.ensemble.resize(this.width, this.height);
    this.track.resize(this.width, this.height);
  }

  draw(frame: FrameState): void {
    const gl = this.gl;
    if (!gl || this.contextLost) return;
    // Recover from any previous layer exception before offscreen state passes.
    // Screen-space scissoring is presentation-only and must never leak into a
    // cloud-memory, OHC, rain, or trail framebuffer on the next frame.
    gl.disable(gl.SCISSOR_TEST);
    this.syncEnvPlane(frame);
    this.syncRainAccum(frame);
    const ctx = this.buildCtx(frame);
    const cloudAgeH = interpolatedCloudAgeH(
      frame.prevStorm?.ageH ?? null,
      frame.storm?.ageH ?? 0,
      frame.alpha,
    );
    if (frame.storm) {
      this.cloudMemory.ensure(
        cloudAgeH,
        ctx.reduced,
        this.env.cloudNoiseTexture,
        cloudSeedFromGenesis(ctx.track?.[0]),
      );
    }
    const terrainFade = this.fadeSince(this.terrainReadyMs, ctx.nowMs);
    const contextTerrainFade = this.fadeSince(this.contextTerrainReadyMs, ctx.nowMs);
    const glowFade = this.fadeSince(this.glowReadyMs, ctx.nowMs);

    // The facade owns both surfaces: clear the GL base and the overlay. (A second
    // clear from main in mode B is harmless.)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const bg = TOKENS.oceanDeep.rgba01;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Luminance order (back to front). Rain updates offscreen, then composites.
    this.terrain.draw(ctx, this.gpu, terrainFade, contextTerrainFade);
    // Every atmospheric/state texture below is valid only inside grid.ts
    // DOMAIN. The camera may show a larger real-terrain context, so clip these
    // passes instead of repeating their edge texels into unsupported geography.
    // A one-pixel inset leaves the terrain shader's simulation boundary visible.
    const weatherClip = domainScissorRect(ctx.view, this.width, this.height);
    const applyWeatherClip = (): void => {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        weatherClip.x,
        weatherClip.y,
        weatherClip.width,
        weatherClip.height,
      );
    };
    let observedWeight = 0;
    let simulatedWeight = 1;
    if (ctx.weatherLayer === 'infrared' && this.satellite.hasFrame()) {
      if (this.satelliteSource === 'observed') {
        observedWeight = 1;
        simulatedWeight = 0;
      } else if (this.satelliteSource === 'handoff') {
        const elapsedH = Math.max(
          0,
          (ctx.frame.storm?.ageH ?? this.satelliteHandoffStartAgeH) -
            this.satelliteHandoffStartAgeH,
        );
        const linear = clamp01(elapsedH / 6);
        simulatedWeight = linear * linear * (3 - 2 * linear);
        observedWeight = 1 - simulatedWeight;
      }
    }
    applyWeatherClip();
    this.satellite.draw(observedWeight, ctx.view);
    // env.draw includes an earth-fixed OHC framebuffer pass. Its final shader
    // rejects out-of-domain UVs, so do not apply a screen-space scissor while
    // the offscreen target is bound.
    gl.disable(gl.SCISSOR_TEST);
    this.env.draw(
      ctx,
      this.gpu,
      glowFade * simulatedWeight,
      this.cloudMemory.texture,
    );
    const radarMode = radarPresentation(
      ctx.weatherLayer,
      this.radarSource,
      this.observedRadar.hasFrame(),
    );
    applyWeatherClip();
    if (radarMode.observed) this.observedRadar.draw(0.94, ctx.view);
    else if (radarMode.simulated) this.radar.draw(ctx);
    // Rain accumulation is an earth-fixed DOMAIN target. Screen scissoring is
    // invalid while its offscreen framebuffer is active; restore it only for
    // the visible composite and the remaining presentation layers.
    gl.disable(gl.SCISSOR_TEST);
    this.rain.update(ctx, this.gpu);
    applyWeatherClip();
    if (radarMode.simulated || ctx.weatherLayer !== 'rain') {
      this.rain.composite(ctx, this.gpu, terrainFade);
    }
    gl.disable(gl.SCISSOR_TEST);
    // Diagnostic layers own their pixels. Do not lay the generic white storm
    // swarm over radar, terrain, or scalar fields; it obscures numeric colours
    // and made the map look illustrative rather than operational.
    if (ctx.weatherLayer === 'wind') {
      this.wind.draw(ctx);
    } else if (ctx.weatherLayer === 'upper') {
      this.upperWind.draw(ctx);
    }
    gl.disable(gl.SCISSOR_TEST);

    if (this.overlay) {
      this.overlay.clearRect(0, 0, this.width, this.height);
      // Ghosts sit BELOW the live track in luminance: dimmer, drawn first (C7).
      this.ghosts.draw(ctx.view);
      // The ensemble wash sits between: brighter than the static ghosts,
      // below the live storm track it contextualizes (phase 4).
      const overlayClip = domainCanvasRect(ctx.view, this.width, this.height);
      this.overlay.save();
      this.overlay.beginPath();
      this.overlay.rect(
        overlayClip.x,
        overlayClip.y,
        overlayClip.width,
        overlayClip.height,
      );
      this.overlay.clip();
      this.ensemble.draw(ctx.view);
      this.track.draw(ctx); // ripples land on top when ui.drawOverlay runs after
      this.overlay.restore();
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      const canvas = gl.canvas as HTMLCanvasElement;
      canvas.removeEventListener('webglcontextlost', this.onLost);
      canvas.removeEventListener('webglcontextrestored', this.onRestored);
    }
    if (this.monthSelect) this.monthSelect.removeEventListener('change', this.onMonthChange);
    this.disposeTextures();
    this.terrain.dispose();
    this.env.dispose();
    this.cloudMemory.dispose();
    this.satellite.dispose();
    this.observedRadar.dispose();
    this.wind.dispose();
    this.upperWind.dispose();
    this.rain.dispose();
    this.radar.dispose();
    this.ghosts.dispose();
    this.ensemble.dispose();
    this.track.dispose();
    this.gl = null;
    this.overlay = null;
  }

  // --- data injection (mode A) ----------------------------------------------

  setResources(resources: RenderResources): void {
    const previous = this.res;
    this.injected = true;
    this.res = resources;
    const terrainChanged = previous.terrain !== resources.terrain;
    const contextChanged = previous.contextTerrain !== resources.contextTerrain;
    const environmentChanged =
      previous.env !== resources.env || previous.upper !== resources.upper;
    const genesisChanged = previous.genesis !== resources.genesis;
    const tracksChanged = previous.tracks !== resources.tracks;

    // Scenario switches replace environment resources but retain the two static
    // terrain rasters. Updating only changed groups avoids a visible context
    // fade/flicker and needless re-upload on every switch.
    if (terrainChanged) this.applyTerrain();
    if (contextChanged) this.applyContextTerrain();
    if (environmentChanged) {
      this.envPlane = -1;
      this.envNextPlane = -1;
      this.envPlaneMode = '';
      this.upperPlane = null;
      if (this.gl && this.gpu.rainAccum) {
        this.gl.deleteTexture(this.gpu.rainAccum);
        this.gpu.rainAccum = null;
      }
      this.accumVersion = -1;
      this.applyEnv(0, 0, null);
    }
    if (genesisChanged) this.applyGenesis();
    if (tracksChanged) this.applyTracks();
  }

  /** Ghost tracks are Canvas2D data (no GL state) — apply straight to the layer. */
  private applyTracks(): void {
    this.ghosts.setTracks(this.res.tracks ?? []);
  }

  setMonth(monthIndex: number): void {
    this.monthIndex = monthIndex;
    this.envPlane = -1;
    this.envNextPlane = -1;
    this.envPlaneMode = '';
    this.upperPlane = null;
    this.applyEnv(0, 0, null);
  }

  setWeatherLayer(layer: WeatherLayerId): void {
    if (layer !== this.weatherLayer) {
      this.wind.clearTrails();
      this.upperWind.clearTrails();
    }
    this.weatherLayer = layer;
  }

  setSatellitePalette(palette: SatellitePaletteId): void {
    this.satellitePalette = palette;
    this.env.setSatellitePalette(palette);
    this.satellite.setPalette(palette);
  }

  setSatelliteSource(source: SatelliteSourceMode, handoffStartAgeH = 0): void {
    this.satelliteSource = source;
    this.satelliteHandoffStartAgeH = Number.isFinite(handoffStartAgeH)
      ? Math.max(0, handoffStartAgeH)
      : 0;
  }

  setObservedSatelliteFrame(image: ImageBitmap | null, channel: SatelliteChannel = 'infrared'): void {
    if (!image) {
      this.satellite.clearFrame();
      return;
    }
    this.satellite.setFrame(image, channel);
  }

  setCloudTape(tape: CloudTape | null): void {
    this.cloudMemory.setTape(tape);
  }

  setRadarSource(source: RadarSourceMode): void {
    this.radarSource = source;
  }

  setObservedRadarFrame(image: TexImageSource | null): void {
    if (!image) {
      this.observedRadar.clearFrame();
      return;
    }
    this.observedRadar.setFrame(image);
  }

  setObservedRadarCoverage(image: TexImageSource | null): void {
    this.observedRadar.setCoverage(image);
  }

  /** Decorative workload only; deterministic physics and flight tapes are untouched. */
  setParticleBudget(count: number): void {
    this.wind.setBudget(count);
    this.upperWind.setBudget(count);
  }

  /** Camera moved: screen-registered trail history no longer matches the map. */
  clearWindTrails(): void {
    this.wind.clearTrails();
    this.upperWind.clearTrails();
  }

  /** Highlight one ghost polyline (~2x alpha) as the active scenario; null clears
   *  it. The matching DOM label is highlighted separately via ui.highlightGhost. */
  /** Push (or clear) the ensemble overlay: result + precomputed envelope. */
  setEnsemble(
    result: EnsembleResult | null,
    envelope: EnsembleEnvelope | null,
  ): void {
    this.ensemble.setEnsemble(result, envelope);
  }

  /** Member spaghetti is on-demand; the envelope stays the default product. */
  setEnsembleMembersVisible(visible: boolean): void {
    this.ensemble.setShowMembers(visible);
  }

  setActiveGhost(id: string | null): void {
    this.ghosts.setActiveGhostId(id);
  }

  // --- self-source (mode B) --------------------------------------------------

  private acquireOverlay(): CanvasRenderingContext2D | null {
    const cv = typeof document !== 'undefined' ? (document.getElementById('overlay-canvas') as HTMLCanvasElement | null) : null;
    return cv ? cv.getContext('2d') : null;
  }

  private acquireMonthFromDom(): void {
    if (typeof document === 'undefined') return;
    const sel = document.getElementById('month') as HTMLSelectElement | null;
    if (!sel) return;
    this.monthSelect = sel;
    this.monthIndex = Number(sel.value) || 5;
    sel.addEventListener('change', this.onMonthChange);
  }

  private onMonthChange = (): void => {
    if (this.monthSelect) this.monthIndex = Number(this.monthSelect.value) || 5;
    this.envPlane = -1;
    this.envNextPlane = -1;
    this.envPlaneMode = '';
    this.upperPlane = null;
    this.applyEnv(0, 0, null);
  };

  private assetUrl(path: string): string {
    const base = import.meta.env.BASE_URL || '/';
    return `${base}${path}`;
  }

  private async fetchBin(path: string): Promise<ParsedBin | null> {
    try {
      const res = await fetch(this.assetUrl(path));
      if (!res.ok) return null;
      return parseBin(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  private async selfLoad(): Promise<void> {
    // Deliberate degraded mode-B boundary: upper.bin is not self-fetched here.
    // Mode A is the product path and injects its plane-aligned sidecar from main.
    await Promise.all([
      this.fetchBin(DISPLAY_CONTEXT_ASSET_PATH).then((b) => {
        this.res.contextTerrain = b;
        this.applyContextTerrain();
      }),
      this.fetchBin('data/terrain.bin').then((b) => {
        this.terrBin = b;
        this.mergeAndApplyTerrain();
      }),
      this.fetchBin('data/flowacc.bin').then((b) => {
        this.flowBin = b;
        this.mergeAndApplyTerrain();
      }),
      this.fetchBin('data/env.bin').then((b) => {
        if (b) {
          this.res.env = b;
          this.envPlane = -1;
          this.envNextPlane = -1;
          this.envPlaneMode = '';
          this.upperPlane = null;
          this.applyEnv(0, 0, null);
        }
      }),
      this.loadGenesis().then((pts) => {
        this.res.genesis = pts;
        this.applyGenesis();
      }),
      this.loadTracks().then((polys) => {
        this.res.tracks = polys;
        this.applyTracks();
      }),
    ]);
  }

  /** Mode B: self-fetch tracks.json for ghost parity. Missing/bad -> no ghosts. */
  private async loadTracks(): Promise<GhostPolyline[]> {
    try {
      const res = await fetch(this.assetUrl('data/tracks.json'));
      if (!res.ok) return [];
      const parsed = parseTracks((await res.json()) as unknown);
      return parsed ? toGhostPolylines(parsed) : [];
    } catch {
      return [];
    }
  }

  private mergeAndApplyTerrain(): void {
    this.res.terrain = mergeBins(this.terrBin, this.flowBin);
    this.applyTerrain();
  }

  private async loadGenesis(): Promise<LatLon[]> {
    try {
      const res = await fetch(this.assetUrl('data/genesis.json'));
      if (!res.ok) return [];
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json)) return [];
      const out: LatLon[] = [];
      for (const p of json) {
        const r = p as { lat?: unknown; lon?: unknown };
        if (typeof r.lat === 'number' && typeof r.lon === 'number') out.push({ lat: r.lat, lon: r.lon });
      }
      return out;
    } catch {
      return [];
    }
  }

  // --- GL + texture lifecycle ------------------------------------------------

  private initGl(): void {
    const gl = this.gl;
    if (!gl) return;
    this.caps = probeCaps(gl);
    this.terrain.init(gl);
    this.env.init(gl);
    this.cloudMemory.init(gl);
    this.satellite.init(gl);
    this.observedRadar.init(gl);
    this.env.setSatellitePalette(this.satellitePalette);
    this.satellite.setPalette(this.satellitePalette);
    this.wind.init(gl, this.caps);
    this.upperWind.init(gl, this.caps);
    this.rain.init(gl, this.caps);
    this.radar.init(gl);
    if (this.overlay) {
      this.ghosts.init(this.overlay);
      this.ensemble.init(this.overlay);
      this.track.init(this.overlay);
    }
    this.env.resize(this.width, this.height);
    this.cloudMemory.resize(this.width, this.height);
    this.satellite.resize(this.width, this.height);
    this.wind.resize(this.width, this.height);
    this.upperWind.resize(this.width, this.height);
    this.rain.resize(this.width, this.height);
    this.radar.resize(this.width, this.height);
    this.ghosts.resize(this.width, this.height);
    this.ensemble.resize(this.width, this.height);
    this.track.resize(this.width, this.height);
    this.rebuildAllTextures();
    this.applyTracks(); // re-seed ghost polylines after (re)init (e.g. context loss)
  }

  private onLost = (e: Event): void => {
    e.preventDefault(); // required so 'restored' fires
    this.contextLost = true;
  };

  private onRestored = (): void => {
    this.contextLost = false;
    this.gpu = emptyGpu();
    this.accumVersion = -1; // impact grid texture must re-upload post-restore
    this.initGl(); // resources still held — rebuild GPU state, no re-fetch
  };

  private rebuildAllTextures(): void {
    this.disposeTextures();
    this.gpu = emptyGpu();
    this.accumVersion = -1;
    this.applyTerrain();
    this.applyContextTerrain();
    this.envPlane = -1;
    this.envNextPlane = -1;
    this.envPlaneMode = '';
    this.upperPlane = null;
    this.applyEnv(0, 0, null);
    this.applyGenesis();
  }

  /** elev + landmask + flowacc + basin all live in the merged `terrain` bin. */
  private applyTerrain(): void {
    const gl = this.gl;
    const bin = this.res.terrain;
    if (!gl) return;
    const elevL = pickLayer(bin, ELEV_NAMES);
    const landL = pickLayer(bin, LAND_NAMES);
    const accL = pickLayer(bin, ACC_NAMES);
    const basinL = pickLayer(bin, BASIN_NAMES);
    const flowDirL = pickLayer(bin, FLOW_DIR_NAMES);
    const travelL = pickLayer(bin, TRAVEL_NAMES);
    for (const t of [
      this.gpu.elev,
      this.gpu.land,
      this.gpu.acc,
      this.gpu.basin,
      this.gpu.flowDir,
      this.gpu.travelMin,
    ]) {
      if (t) gl.deleteTexture(t);
    }
    this.gpu.elev = this.gpu.land = this.gpu.acc = this.gpu.basin = null;
    this.gpu.flowDir = this.gpu.travelMin = null;
    this.gpu.terrainGrid = null;
    this.gpu.hasBasin = false;
    this.gpu.hasFlowRouting = false;
    if (!bin) {
      this.terrainReadyMs = -1;
      return;
    }

    const grid = elevL ?? landL ?? accL ?? flowDirL ?? travelL ?? basinL;
    if (grid) this.gpu.terrainGrid = { nx: grid.nx, ny: grid.ny, bbox: grid.bbox };
    if (elevL) this.gpu.elev = buildElevationTex(gl, elevL);
    if (landL) this.gpu.land = buildR8Tex(gl, landL, 0, (v) => (v > 0.5 ? 1 : 0), gl.LINEAR);
    if (accL) {
      const mx = planeMax(accL) || 1;
      this.gpu.acc = buildR8Tex(
        gl,
        accL,
        0,
        (v) => normalizeLoggedFlowAccumulation(v, mx),
        gl.LINEAR,
      );
    }
    if (basinL) {
      // RG8 (id&255, id>>8): thousands of basins, so a single R8 channel would
      // alias every 256th id and leak basin-glow transport across unrelated
      // drainage boundaries. The rain shader compares both channels.
      this.gpu.basin = buildBasinRG8Tex(gl, basinL, 0);
      this.gpu.hasBasin = true;
    }
    const hasRouteValues = hasTimedFlowRouting(flowDirL, travelL);
    if (flowDirL && travelL) {
      this.gpu.flowDir = buildR8Tex(
        gl,
        flowDirL,
        0,
        (value) => value / 255,
        gl.NEAREST,
      );
      this.gpu.travelMin = buildR8Tex(
        gl,
        travelL,
        0,
        (value) => value / 255,
        gl.NEAREST,
      );
      // Explicit offline-fallback bakes retain zero-filled layers for a stable
      // binary schema. Treat those as absent so old basin/elevation transport
      // remains functional instead of selecting an inert DIR path.
      this.gpu.hasFlowRouting = hasRouteValues;
    }
    if ((this.gpu.elev || this.gpu.land) && this.terrainReadyMs < 0) this.terrainReadyMs = performance.now();
  }

  /**
   * Upload the presentation-only regional terrain sidecar. Its header must
   * exactly match config/display-domain.json; rejecting a mismatched raster is
   * safer than stretching or edge-clamping it into apparently real geography.
   */
  private applyContextTerrain(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const texture of [this.gpu.contextElev, this.gpu.contextLand]) {
      if (texture) gl.deleteTexture(texture);
    }
    this.gpu.contextTerrainGrid = null;
    this.gpu.contextElev = null;
    this.gpu.contextLand = null;
    this.contextTerrainReadyMs = -1;

    const bin = this.res.contextTerrain;
    if (!bin) return;
    const elev = pickLayer(bin, ELEV_NAMES);
    const land = pickLayer(bin, LAND_NAMES);
    if (!elev || !land) {
      console.warn('[render] context terrain missing elev/landmask; regional context disabled');
      return;
    }
    if (!matchesDisplayContextGrid(elev) || !matchesDisplayContextGrid(land)) {
      console.warn('[render] context terrain header does not match display-domain.json; regional context disabled');
      return;
    }

    this.gpu.contextTerrainGrid = { nx: elev.nx, ny: elev.ny, bbox: elev.bbox };
    this.gpu.contextElev = buildElevationTex(gl, elev);
    this.gpu.contextLand = buildR8Tex(
      gl,
      land,
      0,
      (value) => (value > 0.5 ? 1 : 0),
      gl.LINEAR,
    );
    this.contextTerrainReadyMs = performance.now();
  }

  private applyEnv(
    plane: number,
    nextPlane: number,
    upperPlane: number | null,
  ): void {
    const gl = this.gl;
    const bin = this.res.env;
    if (!gl) return;
    for (const texture of [
      this.gpu.sst,
      this.gpu.sstNext,
      this.gpu.humidity,
      this.gpu.humidityNext,
      this.gpu.ohc,
      this.gpu.ohcNext,
      this.gpu.shear,
      this.gpu.shearNext,
      this.gpu.steerU,
      this.gpu.steerUNext,
      this.gpu.steerV,
      this.gpu.steerVNext,
      this.gpu.upperUV,
    ]) {
      if (texture) gl.deleteTexture(texture);
    }
    this.gpu.sst = null;
    this.gpu.sstNext = null;
    this.gpu.humidity = null;
    this.gpu.humidityNext = null;
    this.gpu.ohc = null;
    this.gpu.ohcNext = null;
    this.gpu.shear = null;
    this.gpu.shearNext = null;
    this.gpu.steerU = null;
    this.gpu.steerUNext = null;
    this.gpu.steerV = null;
    this.gpu.steerVNext = null;
    this.gpu.upperUV = null;
    this.gpu.envGrid = null;
    this.gpu.envBlend = 0;
    if (!bin) {
      this.envPlane = plane;
      this.envNextPlane = nextPlane;
      this.upperPlane = upperPlane;
      return;
    }
    const n = envMonthNames(this.monthIndex);
    const sstL = pickLayer(bin, [n.sst, 'sst']);
    const rhL = pickLayer(bin, [n.rh, 'rh']);
    const ohcL = pickLayer(bin, [n.ohc, 'ohc']);
    const shearL = pickLayer(bin, [n.shr, 'shear', 'shr']);
    const steerUL = pickLayer(bin, [n.u, 'u']);
    const steerVL = pickLayer(bin, [n.v, 'v']);
    const upper = upperWindLayers(this.res.upper, this.monthIndex);
    if (sstL) {
      this.gpu.envGrid = { nx: sstL.nx, ny: sstL.ny, bbox: sstL.bbox };
      this.gpu.sst = buildR8Tex(
        gl,
        sstL,
        Math.min(plane, sstL.nt - 1),
        (v) => (v - SST_MIN_C) / (SST_MAX_C - SST_MIN_C),
        gl.LINEAR,
      );
      this.gpu.sstNext = buildR8Tex(
        gl,
        sstL,
        Math.min(nextPlane, sstL.nt - 1),
        (v) => (v - SST_MIN_C) / (SST_MAX_C - SST_MIN_C),
        gl.LINEAR,
      );
      if (this.glowReadyMs < 0) this.glowReadyMs = performance.now();
    }
    if (rhL) {
      this.gpu.humidity = buildR8Tex(
        gl,
        rhL,
        Math.min(plane, rhL.nt - 1),
        (value) => value / 100,
        gl.LINEAR,
      );
      this.gpu.humidityNext = buildR8Tex(
        gl,
        rhL,
        Math.min(nextPlane, rhL.nt - 1),
        (value) => value / 100,
        gl.LINEAR,
      );
    }
    if (ohcL) {
      this.gpu.ohc = buildR8Tex(
        gl,
        ohcL,
        Math.min(plane, ohcL.nt - 1),
        (value) => value / 140,
        gl.LINEAR,
      );
      this.gpu.ohcNext = buildR8Tex(
        gl,
        ohcL,
        Math.min(nextPlane, ohcL.nt - 1),
        (value) => value / 140,
        gl.LINEAR,
      );
    }
    if (shearL) {
      this.gpu.shear = buildR8Tex(
        gl,
        shearL,
        Math.min(plane, shearL.nt - 1),
        (value) => value / 40,
        gl.LINEAR,
      );
      this.gpu.shearNext = buildR8Tex(
        gl,
        shearL,
        Math.min(nextPlane, shearL.nt - 1),
        (value) => value / 40,
        gl.LINEAR,
      );
    }
    // Steering components for the wind fill: [-25, +25] m/s -> [0, 1].
    const steerNorm = (value: number) => (value + 25) / 50;
    if (steerUL && steerVL) {
      this.gpu.steerU = buildR8Tex(
        gl,
        steerUL,
        Math.min(plane, steerUL.nt - 1),
        steerNorm,
        gl.LINEAR,
      );
      this.gpu.steerUNext = buildR8Tex(
        gl,
        steerUL,
        Math.min(nextPlane, steerUL.nt - 1),
        steerNorm,
        gl.LINEAR,
      );
      this.gpu.steerV = buildR8Tex(
        gl,
        steerVL,
        Math.min(plane, steerVL.nt - 1),
        steerNorm,
        gl.LINEAR,
      );
      this.gpu.steerVNext = buildR8Tex(
        gl,
        steerVL,
        Math.min(nextPlane, steerVL.nt - 1),
        steerNorm,
        gl.LINEAR,
      );
    }
    if (upper && upperPlane !== null) {
      const upperNorm = (value: number) => (value + 50) / 100;
      this.gpu.upperUV = buildUpperWindRG8Tex(
        gl,
        upper.u,
        upper.v,
        upperPlane,
        upperNorm,
      );
    }
    this.envPlane = plane;
    this.envNextPlane = nextPlane;
    this.upperPlane = upperPlane;
  }

  /**
   * Upload the impact tracker's active rain-ledger window when its version
   * moves. R8 stores a fixed, piecewise physical mm scale; the grid is only
   * 200×120, so deterministic per-tick re-uploads remain trivial.
   */
  private syncRainAccum(frame: FrameState): void {
    const gl = this.gl;
    if (!gl) return;
    const view = frame.rainAccum;
    if (!view) {
      if (this.gpu.rainAccum) {
        gl.deleteTexture(this.gpu.rainAccum);
        this.gpu.rainAccum = null;
      }
      this.accumVersion = -1;
      return;
    }
    if (view.version === this.accumVersion && this.gpu.rainAccum) return;
    const bytes = new Uint8Array(view.nx * view.ny);
    for (let i = 0; i < bytes.length; i++) {
      const n = normalizeRainAccumulationMm(view.mm[i], view.breaksMm);
      bytes[i] = n <= 0 ? 0 : n >= 1 ? 255 : Math.round(n * 255);
    }
    if (!this.gpu.rainAccum) {
      const tex = gl.createTexture();
      if (!tex) return;
      this.gpu.rainAccum = tex;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.gpu.rainAccum);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      view.nx,
      view.ny,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.accumVersion = view.version;
  }

  private syncEnvPlane(frame: FrameState): void {
    const bin = this.res.env;
    if (!bin) return;
    const names = envMonthNames(this.monthIndex);
    const reference = pickLayer(bin, [names.u, names.rh, names.sst]);
    if (!reference) return;
    const interpolation = environmentPlaneInterpolation(
      reference.nt,
      frame.envSamplingMode,
      frame.envTFrac,
    );
    const plane = interpolation.current;
    const upper = upperWindLayers(this.res.upper, this.monthIndex);
    const requestedUpperPlane = upper
      ? upperWindTexturePlane(upper.u.nt, frame.envSamplingMode)
      : null;
    const nextPlane = interpolation.next;
    this.gpu.envBlend = interpolation.blend;
    const modeKey =
      frame.envSamplingMode.kind === 'event-timeline'
        ? 'event'
        : `synoptic:${frame.envSamplingMode.plane}`;
    if (
      plane !== this.envPlane ||
      nextPlane !== this.envNextPlane ||
      modeKey !== this.envPlaneMode ||
      requestedUpperPlane !== this.upperPlane
    ) {
      this.envPlaneMode = modeKey;
      this.applyEnv(plane, nextPlane, requestedUpperPlane);
    }
  }

  private applyGenesis(): void {
    const pts = this.res.genesis;
    if (!pts || pts.length === 0) {
      this.gpu.genesisClip = null;
      return;
    }
    const out = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      const c = latLonToClip(pts[i].lat, pts[i].lon, DOMAIN);
      out[i * 2] = c.x;
      out[i * 2 + 1] = c.y;
    }
    this.gpu.genesisClip = out;
    if (this.glowReadyMs < 0) this.glowReadyMs = performance.now();
  }

  private disposeTextures(): void {
    const gl = this.gl;
    if (!gl) return;
    const g = this.gpu;
    for (const t of [
      g.elev,
      g.land,
      g.contextElev,
      g.contextLand,
      g.acc,
      g.basin,
      g.flowDir,
      g.travelMin,
      g.sst,
      g.sstNext,
      g.humidity,
      g.humidityNext,
      g.ohc,
      g.ohcNext,
      g.shear,
      g.shearNext,
      g.steerU,
      g.steerUNext,
      g.steerV,
      g.steerVNext,
      g.upperUV,
      g.rainAccum,
    ]) {
      if (t) gl.deleteTexture(t);
    }
  }

  // --- per-frame context -----------------------------------------------------

  /** Read the exact environment mode/time used by physics at the storm centre. */
  private sampleEnv(
    lat: number,
    lon: number,
    frame: FrameState,
  ): EnvAtStorm | null {
    const bin = this.res.env;
    if (!bin) return null;
    return sampleEnvBin(
      bin,
      lat,
      lon,
      this.monthIndex,
      frame.envTFrac,
      frame.envSamplingMode,
    );
  }

  private buildCtx(frame: FrameState): DrawCtx {
    const nowMs = frame.nowMs;
    const dtSec = this.lastNowMs < 0 ? 0 : Math.min((nowMs - this.lastNowMs) / 1000, MAX_DT_SEC);
    this.lastNowMs = nowMs;

    let center: { x: number; y: number } | null = null;
    let track: TrackPoint[] | null = null;
    let vKt = 0;
    let structure: StormStructure | null = null;
    let intensity = 0;
    let aftermath = 0;
    let demo = frame.isDemo;
    let env: EnvAtStorm | null = null;

    const s = frame.storm;
    if (s) {
      const pv = frame.prevStorm;
      const a = frame.alpha;
      const lat = pv ? pv.lat + (s.lat - pv.lat) * a : s.lat;
      const lon = pv ? pv.lon + (s.lon - pv.lon) * a : s.lon;
      vKt = pv ? pv.vKt + (s.vKt - pv.vKt) * a : s.vKt;
      structure = pv
        ? interpolateStormStructure(pv.structure, s.structure, a)
        : cloneStormStructure(s.structure);
      center = latLonToClip(lat, lon, DOMAIN);
      track = s.trackPoints;
      intensity = clamp01((vKt - 20) / 100);
      demo = s.isDemo;
      env = this.sampleEnv(lat, lon, frame);
      if (frame.replayMode) {
        // Recorded frames are an immutable flight tape, not a fresh aftermath:
        // keep the selected track/centre fully legible even at the final frame.
        aftermath = 1;
        this.deathMs = null;
      } else if (s.alive) {
        aftermath = 1;
        this.deathMs = null;
      } else {
        if (this.deathMs == null) this.deathMs = nowMs;
        aftermath = 1 - clamp01((nowMs - this.deathMs) / AFTERMATH_FADE_MS);
      }
      this.memCenter = center;
      this.memTrack = track;
      this.memVkt = vKt;
      this.memIntensity = intensity;
      this.memDemo = demo;
      this.memStructure = cloneStormStructure(s.structure);
    } else if (this.memCenter) {
      if (this.deathMs == null) this.deathMs = nowMs;
      aftermath = 1 - clamp01((nowMs - this.deathMs) / AFTERMATH_FADE_MS);
      if (aftermath <= 0) {
        this.deathMs = null;
        this.memCenter = null;
        this.memTrack = null;
        this.memStructure = null;
      } else {
        center = this.memCenter;
        track = this.memTrack;
        vKt = this.memVkt;
        intensity = this.memIntensity;
        demo = this.memDemo;
        structure = this.memStructure
          ? cloneStormStructure(this.memStructure)
          : null;
      }
    }

    return {
      gl: this.gl!,
      frame,
      width: this.width,
      height: this.height,
      aspect: this.width / this.height,
      view: frame.view,
      nowMs,
      dtSec,
      centerClip: center,
      vKt,
      structure,
      intensity01: intensity,
      demo,
      reduced: frame.reducedMotion,
      aftermath,
      track,
      comparisonTrack: frame.comparisonTrack,
      env,
      weatherLayer: this.weatherLayer,
      steeringAt: this.buildSteeringSampler(),
      upperAt: this.buildUpperSampler(),
    };
  }

  /**
   * CPU steering sampler for the wind particle layer, reading the SAME
   * plane pair + blend the wind fill shader shows (kept fresh by
   * syncEnvPlane) so trails and fill never disagree mid-interpolation.
   * Returns null before env.bin lands — wind flow then rides vortex-only.
   */
  private buildSteeringSampler():
    | ((lat: number, lon: number) => { u: number; v: number })
    | null {
    const bin = this.res.env;
    if (!bin) return null;
    const names = envMonthNames(this.monthIndex);
    const uL = pickLayer(bin, [names.u, 'u']);
    const vL = pickLayer(bin, [names.v, 'v']);
    if (!uL || !vL) return null;
    const plane = Math.max(0, this.envPlane);
    const nextPlane = Math.max(plane, this.envNextPlane);
    const blend = this.gpu.envBlend;
    const read = (layer: BinLayer, lat: number, lon: number): number => {
      const a = sampleLayerBilinear(
        layer,
        Math.min(plane, layer.nt - 1),
        lat,
        lon,
      );
      if (blend <= 0) return a;
      const b = sampleLayerBilinear(
        layer,
        Math.min(nextPlane, layer.nt - 1),
        lat,
        lon,
      );
      return a + (b - a) * blend;
    };
    return (lat: number, lon: number) => ({
      u: read(uL, lat, lon),
      v: read(vL, lat, lon),
    });
  }

  /** CPU upper-wind sampler from the same frame-selected plane as the fill. */
  private buildUpperSampler():
    | ((lat: number, lon: number) => { u: number; v: number })
    | null {
    const upper = upperWindLayers(this.res.upper, this.monthIndex);
    const plane = this.upperPlane;
    if (!upper || plane === null) return null;
    return (lat: number, lon: number) => {
      const u = sampleLayerBilinear(upper.u, plane, lat, lon);
      const v = sampleLayerBilinear(upper.v, plane, lat, lon);
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        throw new Error('render: upper-wind sample must be finite');
      }
      return { u, v };
    };
  }

  private fadeSince(readyMs: number, nowMs: number): number {
    if (readyMs < 0) return 0;
    return clamp01((nowMs - readyMs) / LOAD_FADE_MS);
  }
}

/** Mode A entry: main injects gl + overlay + resources afterwards. */
export function createRenderer(): RenderPipeline {
  return new RenderPipeline();
}

/** Mode B entry: a single-element RenderLayer[]; the facade self-sources data. */
export function createRenderLayers(_gl: WebGL2RenderingContext): RenderLayer[] {
  return [new RenderPipeline()];
}
