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
  /** 200–850 hPa shear vector, upper minus lower wind, east/north m/s. */
  shearU: number;
  shearV: number;
  /** ERA5 600/700-hPa mean relative humidity, percent. */
  midlevelRhPct: number;
  /** WOA23 tropical-cyclone heat potential above 26 C, kJ/cm². */
  ohcKjCm2: number;
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

/** Vortex-filtered pressure-level winds used by HF-3 steering. */
export interface PressureLevelWinds {
  u850: number;
  v850: number;
  u500: number;
  v500: number;
  u250: number;
  v250: number;
}

export type PressureWindSampler = (
  lat: number,
  lon: number,
  monthIndex: number,
  tFrac: number,
) => PressureLevelWinds | null;

/**
 * How a multi-plane environment layer must interpret its `nt` axis.
 *
 * Climatology bins carry alternative synoptic regimes and freeze on one
 * seed-picked plane. Historic-event bins carry a chronological timeline and
 * interpolate it using the `tFrac` supplied to EnvSampler.sample().
 */
export type EnvSamplingMode =
  | { kind: 'synoptic-plane'; plane: number }
  | { kind: 'event-timeline' };

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

/**
 * The exact environmental sample and intensity-budget terms used by the latest
 * physics tick. Positive ocean values strengthen the storm; the three penalty
 * values are non-negative losses, all in knots per simulated hour.
 */
export interface StormDiagnostics {
  /** Undisturbed environmental SST before the storm's own wake, Celsius. */
  sstC: number;
  /** SST available to the vortex after its persistent cold wake, Celsius. */
  effectiveSstC: number;
  midlevelRhPct: number;
  ohcKjCm2: number;
  /** Persistent convective-core health, 0=collapsed and 1=fully organized. */
  organization: number;
  organizationTarget: number;
  /** Storm-induced centre cooling sampled from the persistent wake, Celsius. */
  coldWakeC: number;
  /**
   * HF-2A retained-column diagnostics. These are optional only so archived
   * HF-1 fixtures remain readable; the live engine records every field.
   */
  oceanInitializationTier?:
    | 'event-analysis'
    | 'climatological-subsurface'
    | 'analytic-fallback';
  oceanSourceValidTime?: string | null;
  oceanCoupledSstC?: number;
  oceanMixedLayerDepthM?: number;
  oceanIsotherm26DepthM?: number;
  oceanTemperatureBelowMixedLayerC?: number;
  oceanCurrentSpeedMs?: number;
  oceanCurrentDirectionDeg?: number;
  oceanInertialPeriodH?: number;
  oceanWindStressPa?: number;
  oceanBulkRichardson?: number | null;
  oceanEntrainmentDepthM?: number;
  oceanHeatMovedThisStepJm2?: number;
  oceanCumulativeMixingHeatJm2?: number;
  oceanCumulativeRecoveryHeatJm2?: number;
  oceanActiveColumnCount?: number;
  oceanHardBoundFlag?: boolean;
  oceanMissingSourceFlag?: boolean;
  mpiKt: number;
  steerU: number;
  steerV: number;
  /** HF-3 motion-budget diagnostics, all east/north m/s unless noted. */
  steering850Weight?: number;
  steering500Weight?: number;
  steering250Weight?: number;
  environmentalSteeringUms?: number;
  environmentalSteeringVms?: number;
  betaDriftUms?: number;
  betaDriftVms?: number;
  terrainDriftUms?: number;
  terrainDriftVms?: number;
  resolvedMotionUms?: number;
  resolvedMotionVms?: number;
  steeringAnnulusRadiusKm?: number;
  steeringPressureLevelsAvailable?: boolean;
  shearMs: number;
  /** 200–850 hPa shear vector used by structure and rainfall. */
  shearUms: number;
  shearVms: number;
  /** HF-2B annular environment; absent only on archived HF-1 frames. */
  ventilationIndex?: number;
  ventilationAnnulusRadiusKm?: number;
  ventilationMeanRhPct?: number;
  ventilationUpshearRhPct?: number;
  ventilationShearUms?: number;
  ventilationShearVms?: number;
  ventilationShearCoherence?: number;
  coastalCoreLandFraction?: number;
  coastalOuterLandFraction?: number;
  coastalMeanLandElevationM?: number;
  coastalRoughnessExposure?: number;
  overLand: boolean;
  oceanKtPerH: number;
  shearKtPerH: number;
  landKtPerH: number;
  dryAirKtPerH: number;
  netKtPerH: number;
  /** Separated precipitation components used by the rainfall renderer. */
  eyewallRainMmH: number;
  rainbandRainMmH: number;
  orographicRainMmH: number;
  totalRainMmH: number;
}

/** Maximum radial extent of a wind threshold in each geographic quadrant. */
export interface WindRadiiKm {
  ne: number;
  se: number;
  sw: number;
  nw: number;
}

/**
 * Parametric inner- and outer-core structure derived from the simulated
 * intensity, latitude, environment, and translation vector.
 *
 * These values make the renderer and recorder physically coherent; they are
 * not aircraft observations or an operational wind-field analysis.
 */
export interface StormStructure {
  /** The reported maximum sustained surface wind carried by StormState. */
  maximumWindKt: number;
  /** Parametric minimum sea-level pressure at the storm centre. */
  centralPressureHpa: number;
  /** Fixed surrounding pressure used by the Holland pressure deficit. */
  environmentalPressureHpa: number;
  /** Radius of maximum surface wind—the eyewall scale. */
  rmwKm: number;
  /** Source of the initial size state; carried for provenance. */
  rmwSource?: 'agency-observed' | 'climatological-prior';
  /** Slowly evolving outer-core size state, independent of the instantaneous RMW. */
  outerSizeKm: number;
  outerSizeSource?: 'agency-observed' | 'climatological-prior';
  /** Provenance for threshold radii in this snapshot. */
  windRadiiSource?: 'agency-observed' | 'model-derived';
  /** Radial stretch applied outside the inner core by the two-region profile. */
  outerWindScale: number;
  /** Wind-speed bounds over which the inner and outer profiles are blended. */
  outerBlendStartWindKt: number;
  outerBlendFullWindKt: number;
  /** Holland radial-profile shape parameter. */
  hollandB: number;
  /** Actual simulated translation vector, east/north, m/s. */
  motionUms: number;
  motionVms: number;
  /** Motion-induced maximum-wind asymmetry applied to the symmetric vortex. */
  translationAsymmetryKt: number;
  /** Actual 200–850 hPa shear vector carried by this structure snapshot. */
  shearUms: number;
  shearVms: number;
  /** Maximum downshear-left outer-core radial stretch fraction. */
  shearAsymmetryFraction: number;
  /** Rain-source displacement from the wind centre, east/north, kilometres. */
  rainOffsetEastKm: number;
  rainOffsetNorthKm: number;
  r34Km: WindRadiiKm;
  r50Km: WindRadiiKm;
  r64Km: WindRadiiKm;
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
  /** Persistent convective organization state carried between physics ticks. */
  organization: number;
  /** Storm-induced cooling under the current centre, Celsius. */
  coldWakeC: number;
  /** Why the storm is strengthening or weakening at this instant. */
  diagnostics: StormDiagnostics;
  /** Pressure, eyewall scale, motion asymmetry, and threshold wind radii. */
  structure: StormStructure;
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
  /** Observed initialization used by hindcasts; default is SIM.SPAWN_VKT. */
  initialWindKt?: number;
  /** Optional observed/core-state initialization in [0,1]. */
  initialOrganization?: number;
  /** Agency-consistent structure values at the same initialization fix. */
  initialRmwKm?: number;
  initialOuterSizeKm?: number;
  /** Agency quadrant radii at the exact initialization fix, when reported. */
  initialR34Km?: Partial<WindRadiiKm>;
  initialR50Km?: Partial<WindRadiiKm>;
  initialR64Km?: Partial<WindRadiiKm>;
  /** Pre-initialization agency motion derived without future fixes. */
  initialMotionUms?: number;
  initialMotionVms?: number;
  /** Offset into an event timeline, hours from its first baked plane. */
  tFracOffsetH?: number;
  /** Hindcasts disable stochastic wander while sandbox runs retain it. */
  disableWander?: boolean;
  /**
   * Optional age→tFrac horizon, hours. tick() maps
   * `clamp01((ageH + tFracOffsetH) / horizon)` onto the environment axis.
   * Omitted for climatology storms (falls
   * back to SIM.EVENT_TFRAC_HORIZON_H); event mode passes the scenario's windowH
   * so sim-hours map 1:1 onto the event's real timesteps (C4). Past the window
   * the storm rides the final plane (persistence).
   */
  tFracHorizonH?: number;
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
 * Read-only view of the impact tracker's storm-total rain grid (mm), for the
 * accumulated-rainfall map layer. `version` increments whenever the grid
 * changes so the renderer re-uploads its texture only when needed. Row order
 * matches BinLayer (row 0 = north edge).
 */
export interface RainAccumView {
  nx: number;
  ny: number;
  bbox: BBox;
  /** Active fixed-window or storm-total rain per cell, millimetres. */
  mm: Float32Array;
  /** Stable five-stop physical scale used to encode this view. */
  breaksMm: readonly [number, number, number, number, number];
  version: number;
}

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
  /** A recorded frame is being inspected instead of the live engine state. */
  replayMode: boolean;
  /** Completed baseline track retained while a same-storm comparison runs. */
  comparisonTrack: TrackPoint[] | null;
  /** Simulated hours advanced since the previous rendered frame, for hydrology. */
  hydroDeltaH: number;
  /**
   * Explicit interpretation of the active environment's `nt` axis. Render cues
   * must use the same mode as physics or event timelines freeze visually.
   */
  envSamplingMode: EnvSamplingMode;
  /** Current normalized event time; ignored in synoptic-plane mode. */
  envTFrac: number;
  /** Storm-total rain grid for the accumulated-rainfall layer, or null. */
  rainAccum: RainAccumView | null;
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
