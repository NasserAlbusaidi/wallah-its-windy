/**
 * types.ts — the shared contract surface.
 *
 * This file is the seam between the four parallel builders (sim, render, ui,
 * data/bake). It contains interfaces and enums ONLY — no runtime logic — so a
 * builder can import a contract without importing anyone else's implementation.
 * If you need coordinate math, import from ./grid; if you need the palette,
 * import from ./tokens. Nothing here executes.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Geographic bounding box in degrees. Longitudes east-positive, lats north-positive. */
export interface BBox {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/**
 * A regular lat/lon raster. `nx` columns west->east, `ny` rows north->south
 * (see BINARY-FORMATS.md for the row-order convention). Cell (col,row) centers
 * are computed by grid.ts — do not derive cell geometry anywhere else.
 */
export interface GridSpec {
  nx: number;
  ny: number;
  bbox: BBox;
}

/** Continuous grid coordinate. Integer (col,row) lands on a cell center. */
export interface CellCoord {
  col: number;
  row: number;
}

/** WebGL clip-space coordinate, each axis in [-1, 1], y-up. */
export interface ClipCoord {
  x: number;
  y: number;
}

/** A point on the sphere in degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Binary data format (see BINARY-FORMATS.md + loader.ts)
// ---------------------------------------------------------------------------

/** Numeric dtype codes stored in a .bin layer header. */
export const DType = {
  int16: 0,
  uint16: 1,
  float32: 2,
  int8: 3,
  uint8: 4,
} as const;
export type DTypeCode = (typeof DType)[keyof typeof DType];

/**
 * One decoded layer from a .bin file. `data` is always dequantized to
 * Float32Array of length nx*ny*nt, laid out t-major then row (north->south)
 * then col (west->east): index = ((t*ny) + row)*nx + col.
 */
export interface BinLayer {
  name: string;
  dtype: DTypeCode;
  quantized: boolean;
  nx: number;
  ny: number;
  nt: number;
  bbox: BBox;
  scale: number;
  offset: number;
  data: Float32Array;
}

/** A fully parsed .bin file: format version + its layers keyed by name. */
export interface ParsedBin {
  version: number;
  layers: Map<string, BinLayer>;
}

// ---------------------------------------------------------------------------
// Environment sampling
// ---------------------------------------------------------------------------

/** Environmental conditions at a point, interpolated in space and time. */
export interface EnvSample {
  /** Sea-surface temperature, degrees Celsius. */
  sstC: number;
  /** Deep-layer steering wind, zonal (eastward) component, m/s. */
  steerU: number;
  /** Deep-layer steering wind, meridional (northward) component, m/s. */
  steerV: number;
  /** Deep-layer vertical wind shear magnitude, m/s. */
  shear: number;
}

/**
 * Reads the baked environment fields. `monthIndex` is 0=Jan..11=Dec.
 * `tFrac` in [0,1] selects a position along the layer's timestep axis and is
 * linearly interpolated between the two bracketing timesteps — v1.0 files carry
 * one timestep per month (climatology), v1.1 event files carry N timesteps over
 * a storm's life. Implementations must clamp out-of-domain queries, never throw.
 */
export interface EnvSampler {
  sample(lat: number, lon: number, monthIndex: number, tFrac: number): EnvSample;
}

// ---------------------------------------------------------------------------
// Storm state + lifecycle
// ---------------------------------------------------------------------------

/** One recorded point along a storm's track. */
export interface TrackPoint {
  lat: number;
  lon: number;
  vKt: number;
  ageH: number;
}

/** The live state of the single active storm. Pure data — no methods. */
export interface StormState {
  lat: number;
  lon: number;
  /** Maximum sustained wind, knots. */
  vKt: number;
  /** Age since spawn, simulated hours. */
  ageH: number;
  trackPoints: TrackPoint[];
  /** False once the storm has died; render fades it out during aftermath. */
  alive: boolean;
  /** The ambient first-load demo storm renders dimmed; user storms full. */
  isDemo: boolean;
}

/** Everything needed to reproduce a storm exactly: sim = f(spawn, month, seed). */
export interface SpawnParams {
  lat: number;
  lon: number;
  /** 0=Jan..11=Dec. */
  monthIndex: number;
  /** Seed for the storm's private RNG; goes in the URL hash for sharing. */
  seed: number;
  /** Marks the ambient demo storm (dimmed render, cleared on first user click). */
  isDemo: boolean;
}

/** Why a storm stopped being a storm. Drives the epitaph copy. */
export enum DeathReason {
  ColdWater = 'cold-water',
  Shear = 'shear',
  Land = 'land',
  DryAir = 'dry-air',
  ExitedDomain = 'exited-domain',
}

/** Muscat, for closest-approach reporting in the epitaph. */
export const MUSCAT: LatLon = { lat: 23.588, lon: 58.383 };

/** The epitaph payload assembled at death. */
export interface StormDeath {
  reason: DeathReason;
  /** Great-circle km of the storm's closest approach to Muscat over its life. */
  closestApproachKm: number;
  /** Total lifetime, simulated hours. */
  durationH: number;
  /** Peak intensity reached, knots. */
  peakKt: number;
}

/** Events emitted by a single tick, consumed by ui/render. Discriminated union. */
export type SimEvent =
  | { type: 'spawned'; state: StormState }
  | { type: 'landfall'; lat: number; lon: number }
  | { type: 'peak'; vKt: number }
  | { type: 'died'; death: StormDeath };

/**
 * The physics core. A pure function of (spawn, month, seed) once spawned:
 * calling tick() with the same fixed dt sequence always yields the same track.
 */
export interface SimEngine {
  /** Spawn (or replace) the active storm. Resets any existing storm. */
  spawn(params: SpawnParams): void;
  /** Advance one fixed physics step of `dtMin` simulated minutes; return events. */
  tick(dtMin: number): SimEvent[];
  /** Current storm state, or null when no storm is active. */
  getState(): StormState | null;
  /** True while the active storm is the ambient demo (mirrors StormState.isDemo). */
  readonly isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** GPU textures for the baked environment layers, keyed by layer name. */
export type EnvTextures = Map<string, WebGLTexture>;

/**
 * The immutable per-frame render input. main.ts builds this every animation
 * frame from the interpolated sim state; render layers only read it.
 */
export interface FrameState {
  /** Interpolated storm state for this frame, or null when none is active. */
  storm: StormState | null;
  /** Previous fixed-step storm state, for render-side interpolation. */
  prevStorm: StormState | null;
  /** Interpolation factor in [0,1] between prevStorm and the latest sim step. */
  alpha: number;
  /** Baked environment textures, uploaded once at load. */
  envTextures: EnvTextures;
  /** prefers-reduced-motion: draw track + halo instead of the particle swarm. */
  reducedMotion: boolean;
  /** The active storm is the demo storm: render dimmed. */
  isDemo: boolean;
  /** Wall-clock ms since page start; drives fades and the aftermath timer. */
  nowMs: number;
  /** Space-bar pause: the sim is frozen, so sim-coupled output (rain) must freeze too. */
  paused: boolean;
  /**
   * Synoptic-sample plane the active storm rides (seed-picked, D10): env.bin
   * u/v/shr layers carry nt=K real-year planes and the sim samples plane
   * seed % K. Render cues that read env at the storm (shear smear) must read
   * the SAME plane or cue and physics disagree. Absent/0 for nt=1 bakes.
   */
  synopticIndex?: number;
}

/**
 * A composited render pass (terrain, env glow, particles, rain, track...).
 * main.ts owns the list and calls them in luminance order each frame.
 */
export interface RenderLayer {
  init(gl: WebGL2RenderingContext): void;
  resize(width: number, height: number): void;
  draw(frame: FrameState): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// UI state machine
// ---------------------------------------------------------------------------

/** Top-level UI state. `aftermath` shows the epitaph then fades over ~10s. */
export type UiState =
  | { kind: 'loading'; progress: number }
  | { kind: 'idle-demo' }
  | { kind: 'user-storm' }
  | { kind: 'aftermath'; death: StormDeath; fadeStartMs: number };

/** Aftermath fade duration, ms — the track/flood glow lingers this long. */
export const AFTERMATH_FADE_MS = 10_000;
