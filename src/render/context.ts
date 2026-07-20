/**
 * context.ts — internal seam shared by the render layer modules.
 *
 * types.ts owns the PUBLIC contract (RenderLayer, FrameState) that main.ts talks
 * to; the facade in ./index.ts implements that. INTERNALLY the layer modules
 * need more than a bare FrameState — the interpolated storm centre in clip space,
 * the sampled environment at the storm, the aftermath fade, the GPU texture
 * bundle — so the facade derives a richer {@link DrawCtx} once per frame and
 * hands it (plus the {@link GpuTextures} bundle) to each layer. Nothing here is
 * exported to other builders; it exists so the layers stay decoupled from the
 * facade's book-keeping.
 */

import type {
  FrameState,
  GridSpec,
  StormStructure,
  TrackPoint,
} from '../types';

/** Environment sampled at the storm centre (render's own CPU read of env.bin). */
export interface EnvAtStorm {
  sstC: number;
  /** Deep-layer shear magnitude, m/s. */
  shear: number;
  /** 200–850 hPa shear vector, upper minus lower wind. */
  shearU: number;
  shearV: number;
  steerU: number;
  steerV: number;
}

/** The GPU texture bundle the facade builds from the baked ParsedBins. */
export interface GpuTextures {
  /** Terrain grid shared by elev/land/acc/basin (all on the 2 km terrain grid). */
  terrainGrid: GridSpec | null;
  elev: WebGLTexture | null;
  land: WebGLTexture | null;
  acc: WebGLTexture | null;
  basin: WebGLTexture | null;
  hasBasin: boolean;
  /** HydroSHEDS D8 code and per-step travel minutes, both exact R8 textures. */
  flowDir: WebGLTexture | null;
  travelMin: WebGLTexture | null;
  hasFlowRouting: boolean;
  /** Env (0.5°) grid for the SST tint. */
  envGrid: GridSpec | null;
  sst: WebGLTexture | null;
  /** Genesis-zone points in clip space (x,y interleaved), or null when absent. */
  genesisClip: Float32Array | null;
}

/** Per-frame draw context derived by the facade from FrameState + its memory. */
export interface DrawCtx {
  gl: WebGL2RenderingContext;
  frame: FrameState;
  /** Device-pixel canvas size (matches gl.viewport). */
  width: number;
  height: number;
  /** width / height, for the aspect-correct (round-on-screen) particle vortex. */
  aspect: number;
  nowMs: number;
  /** Real seconds since the previous draw, clamped — drives particle advection. */
  dtSec: number;
  /** Interpolated storm centre in clip space, or null when no storm/aftermath track only. */
  centerClip: { x: number; y: number } | null;
  vKt: number;
  /** Interpolated parametric pressure/wind structure for the current frame. */
  structure: StormStructure | null;
  /** vKt mapped to [0,1] across the storm's plausible range. */
  intensity01: number;
  demo: boolean;
  reduced: boolean;
  /**
   * Aftermath presence in [0,1]: 1 while a storm is alive, decaying to 0 over
   * AFTERMATH_FADE_MS after death. Track + flood glow multiply their alpha by it.
   */
  aftermath: number;
  /** Current storm track, or the lingering track during aftermath, or null. */
  track: TrackPoint[] | null;
  /** Completed baseline shown beneath a controlled comparison run. */
  comparisonTrack: TrackPoint[] | null;
  /** Env sampled at the storm centre, or null when unavailable. */
  env: EnvAtStorm | null;
}

/** Lifecycle shared by every internal layer module. Draw signatures vary. */
export interface RenderModule {
  init(gl: WebGL2RenderingContext): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
