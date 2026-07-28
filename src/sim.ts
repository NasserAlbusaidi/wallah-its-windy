/**
 * sim.ts — the physics core (eng tasks T2, T6; design steps 4 + D12 seam).
 *
 * A storm centre advected by baked steering + beta drift + optional seeded
 * wander, with persistent convective organization, ERA5 humidity, WOA23 OHC, a
 * spatial cold wake, a DeMaria–Kaplan-based intensity ODE, and a deterministic
 * Holland-style pressure/wind structure. The whole thing is
 * a PURE function of (spawn, month, seed): given the same SpawnParams and the
 * same fixed-dt tick sequence it always produces the identical track. All
 * randomness flows through the seeded RNG in rng.ts — there is NO Math.random in
 * this file, by design (design doc step 3).
 *
 * Coordinate + wind math is NEVER done inline here: every latlon/cell/clip and
 * m/s→deg/h conversion goes through grid.ts (the cos-lat correction lives there).
 * Sim state is carried entirely in lat/lon degrees and knots.
 *
 * --- Dependency seam -------------------------------------------------------
 * The SimEngine interface in types.ts specifies no constructor, so this module
 * owns how the engine is built. `createSimEngine(deps)` takes the baked
 * EnvSampler (SST/OHC/RH/steering/shear) plus an `isLand(lat,lon)` predicate (from the
 * terrain.bin land mask). main.ts must supply both when it wires the engine —
 * EnvSample carries no land flag, so land detection cannot come through it.
 * See BUILDREPORT-sim.md.
 */

import type {
  EnvSample,
  EnvSampler,
  PressureWindSampler,
  SimEngine,
  SimEvent,
  SpawnParams,
  StormDiagnostics,
  StormState,
  StormStructure,
  TrackPoint,
} from './types';
import { DeathReason, MUSCAT } from './types';
import { makeRng } from './rng';
import type { Rng } from './rng';
import { DOMAIN, inBBox, greatCircleKm, offsetKm, windToDegPerHour } from './grid';
import { cloneStormStructure, deriveStormStructure } from './structure';
import type { StructureDetail } from './structure';
import {
  SparseUpperOcean,
  type OceanColumnDiagnostics,
  type UpperOceanParameters,
} from './upper-ocean';
import type { OceanProfileSampler } from './ocean-profile-sampler';
import {
  sampleVentilationEnvironment,
  type VentilationDiagnostics,
} from './ventilation';
import {
  sampleCoastalExposure,
  type CoastalExposure,
} from './coastal-exposure';
import {
  sampleEnvironmentalSteering,
  sampleTerrainDrift,
  type EnvironmentalSteering,
} from './steering';

// ---------------------------------------------------------------------------
// Tunable constants — the ONE place to tune the model by eye (design: "tunable
// but only here"). Every magic number the physics uses lives in this block.
// ---------------------------------------------------------------------------

/** Knots per m/s (exact). */
const KT_PER_MS = 1.943844;
/** m/s per knot (exact inverse). */
const MS_PER_KT = 0.514444;
const SQRT1_2 = Math.SQRT1_2;

export const SIM = {
  /** Intensity a fresh storm spawns at, knots (a strong depression). */
  SPAWN_VKT: 30,
  /** Storm dies below this sustained wind, knots (design lifecycle rule). */
  DESPAWN_VKT: 20,

  // -- Intensity ODE: dV/dt = k*(MPI(SST) - V) - shear - land - dryair --------
  /**
   * Base relaxation rate toward thermodynamically adjusted MPI. Dynamic ocean
   * coupling and persistent organization modulate the realized tendency, so
   * this coefficient is not itself a storm-wide e-folding time. The shipped
   * sandbox retains its pre-HF-2 value; the rejected HF-2 candidate is exported
   * separately below so verification can reproduce it without deploying it.
   */
  INTENSIFY_K_PER_H: 0.08,
  /**
   * Deep-layer shear below this (m/s) does no harm. The classic instantaneous
   * onset is ~10 m/s, but env.bin's per-year planes carry |V200 - V850| of
   * MONTHLY-MEAN winds — smoother than any instantaneous shear (a vector mean
   * under-counts variability), yet persistently high wherever the flow is
   * steady (the monsoon). The constants are therefore calibrated EMPIRICALLY
   * against the shipped field's distribution (genesis-belt cores, by plane):
   * May ~3-9 m/s -> majors possible; June splits by sampled year (~10 free vs
   * ~23 lethal); Jul-Aug ~27-32 -> everything shredded. Recalibrate from
   * scratch if the env source ever moves to daily/hourly fields.
   *
   * November diagnosis (C6): the original shr_10 planes all sat
   * 14.7-19.6 m/s in the genesis belt, so seed%K could never land on a calm
   * regime and 0/32 probe storms reached Cat-1 — the "November fizzle". This was
   * NOT a constant to tune here: Nov's hostile band (14-19) overlaps June's
   * surviving planes (18-20), so no SHEAR_THRESHOLD_MS/SHEAR_K change lifts Nov
   * without also un-shredding June/Sep. The fix was DATA-SIDE: the raw ERA5
   * record does hold survivable November regimes. Once RH became explicit, the
   * wind-only calmest year proved too dry; the current bake jointly selects two
   * real years for low shear and moisture. The integration guard intentionally
   * pins a narrow, multi-plane Cat-1 tail rather than a broad artificial rescue.
   */
  SHEAR_THRESHOLD_MS: 14,
  /** Shipped weakening above threshold, kt/h per m/s. */
  SHEAR_K_KT_PER_H_PER_MS: 0.45,
  /**
   * Shear penalty ramps in linearly over a young storm's first hours (full
   * strength at this age). Physical fig leaf: a fresh depression takes ~half a
   * day to be torn apart. Real reason (D11 legibility): in a hostile plane a
   * 30 kt spawn otherwise dies in ~2 sim-hours — under ONE real second at
   * 3 h/s, an epitaph before the downshear smear cue can even render its cause.
   * The verdict is unchanged; it just becomes watchable (~15-20 sim-h).
   */
  SHEAR_GRACE_H: 12,
  /** Fractional intensity lost per hour over land (rapid decay, ~9 h e-fold). */
  LAND_DECAY_PER_H: 0.1,

  // -- Persistent convective organization ----------------------------------
  /** Core-health recovery is deliberately slower than disruption. */
  ORGANIZATION_RECOVERY_H: 30,
  ORGANIZATION_DISRUPTION_H: 10,
  /** Mid-level humidity below this begins a ventilation/dry-air penalty. */
  RH_DRY_THRESHOLD_PCT: 58,
  RH_DRY_RANGE_PCT: 28,

  // -- MPI: DeMaria & Kaplan (1994) empirical SST fit ------------------------
  // V_mpi(m/s) = A + B*exp(C*(T - T0)); source coefficients below.
  MPI_A_MS: 28.2,
  MPI_B_MS: 55.8,
  MPI_C: 0.1813,
  MPI_T0_C: 30.0,
  /**
   * Maintenance-SST taper multiplying MPI to 0 below ~24.5 °C, full above
   * ~27 °C. DeMaria–Kaplan alone floors at A=28.2 m/s (~55 kt) even over ice,
   * so with the given two-term ODE a storm could never die of cold water — the
   * design explicitly wants a cold-water death ("dissipated over 24° water").
   * This linear taper is the documented departure that supplies it; it encodes
   * the well-known ~26.5 °C TC genesis/maintenance threshold. Tune here.
   */
  SST_FLOOR_C: 24.5,
  SST_FULL_C: 27.0,

  // -- Motion ---------------------------------------------------------------
  /**
   * Beta-drift speed, knots, directed toward the NORTHWEST (u<0, v>0). The
   * beta effect (advection of planetary vorticity by the storm's own gyres)
   * pushes NH cyclones WNW–NW relative to the steering flow. Literature puts it
   * at ~1–3 m/s; the task asked for ~1–2 kt, so we use 1.5 kt — gentle but,
   * integrated over a multi-day life, worth ~2° of NW drift. Tune here.
   */
  BETA_DRIFT_KT: 1.5,
  // -- ERA5 humidity / ventilation -------------------------------------------
  /**
   * Nominal dry-air weakening coefficient, kt/h. The live engine multiplies it
   * by ERA5 RH deficit, shear ventilation, and weak-core exposure.
   */
  DRYAIR_K: 0.9,
  /**
   * Compatibility-only knobs for dryAirPenaltyKtPerH's old geometric diagnostic.
   * The engine no longer calls that helper; these do not affect live intensity.
   */
  DRYAIR_RANGE_KM: 190,
  /** Compatibility-only ray step for the legacy geometric diagnostic. */
  DRYAIR_STEP_KM: 34,

  // -- Coupled upper ocean / storm wake -------------------------------------
  /** Peak local cooling tendency for a strong, slow storm over modest OHC. */
  COLD_WAKE_K_C_PER_H: 0.035,
  /** Exponential recovery time of a deposited wake patch. */
  COLD_WAKE_RECOVERY_H: 120,
  /** Hard physical/numerical ceiling on combined centre cooling. */
  COLD_WAKE_MAX_C: 4,
  /** Patches older than this are both negligible and removed. */
  COLD_WAKE_MAX_AGE_H: 360,

  // -- Bookkeeping ----------------------------------------------------------
  /** EMA retention per tick for "which term dominated recent decay". */
  RECENT_DECAY: 0.94,
  /** Announce a 'peak' event only once the storm is at least this strong. */
  PEAK_MIN_KT: 35,
  /**
   * Nominal storm-life horizon (h) mapping age→tFrac in [0,1]. v1.0 env files
   * carry one timestep/month so tFrac is ignored (sampler clamps); v1.1 event
   * files with N timesteps use it to progress through the storm's life.
   */
  EVENT_TFRAC_HORIZON_H: 240,
} as const;

/** Constrained intensity coefficients that offline calibration and ensembles vary. */
export interface IntensityParameters {
  intensifyKPerH: number;
  shearThresholdMs: number;
  shearKtPerHPerMs: number;
  dryAirK: number;
  organizationRecoveryH: number;
  organizationDisruptionH: number;
  /** @deprecated HF-1 replay metadata only; HF-2A never reads this value. */
  ohcMpiWeight: number;
  /** Strength of the organized-core multiplier during intensification. */
  organizationIntensification: number;
}

/** Bounded HF-3 motion parameters, calibrated independently of intensity. */
export interface TrackParameters {
  /** Blend from legacy centre deep-layer flow (0) to annular level flow (1). */
  environmentalSteeringBlend: number;
  /** First-order response time for curved/accelerating motion. */
  motionResponseHours: number;
  /** Cosine-tapered pre-advisory motion correction lifetime. */
  initialMotionBlendHours: number;
  /** Multiplier on the size/intensity-dependent beta drift. */
  betaDriftScale: number;
  /** Maximum explicitly diagnosed coastal terrain correction, m/s. */
  terrainDriftMaxMs: number;
  /** Unresolved-motion OU innovation and reversion; disabled in hindcasts. */
  wanderStepMs: number;
  wanderRevertFraction: number;
}

export type PhysicsProfile = 'shipped' | 'hf2-experimental';

/**
 * Shipped sandbox motion contract. A research phase only replaces this object
 * after its frozen gate accepts the candidate.
 */
export const DEFAULT_TRACK_PARAMETERS: Readonly<TrackParameters> = {
  environmentalSteeringBlend: 0,
  motionResponseHours: 0,
  initialMotionBlendHours: 0,
  betaDriftScale: 1,
  terrainDriftMaxMs: 0,
  wanderStepMs: 0.28,
  wanderRevertFraction: 0.05,
};

/** Shipped coefficients. Calibration compares candidates against this contract. */
export const DEFAULT_INTENSITY_PARAMETERS: Readonly<IntensityParameters> = {
  intensifyKPerH: SIM.INTENSIFY_K_PER_H,
  shearThresholdMs: SIM.SHEAR_THRESHOLD_MS,
  shearKtPerHPerMs: SIM.SHEAR_K_KT_PER_H_PER_MS,
  dryAirK: SIM.DRYAIR_K,
  organizationRecoveryH: SIM.ORGANIZATION_RECOVERY_H,
  organizationDisruptionH: SIM.ORGANIZATION_DISRUPTION_H,
  ohcMpiWeight: 0.28,
  organizationIntensification: 0.5,
};

/**
 * Frozen HF-2 development candidate. It failed the subsequent validation gate,
 * so only phase verification may opt into it explicitly.
 */
export const HF2_EXPERIMENTAL_INTENSITY_PARAMETERS: Readonly<IntensityParameters> = {
  ...DEFAULT_INTENSITY_PARAMETERS,
  intensifyKPerH: 0.055,
  shearKtPerHPerMs: 0.65,
  organizationIntensification: 0.05,
};

/**
 * Frozen HF-3 development candidate. It failed validation and therefore is not
 * the simulator default; sealed scientific runs name it explicitly.
 */
export const HF3_EXPERIMENTAL_TRACK_PARAMETERS: Readonly<TrackParameters> = {
  ...DEFAULT_TRACK_PARAMETERS,
  environmentalSteeringBlend: 0.05,
  initialMotionBlendHours: 36,
  betaDriftScale: 0.5,
  terrainDriftMaxMs: 0.15,
  wanderStepMs: 0.6,
  wanderRevertFraction: 0.013192982509869888,
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp(x: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, x));
}

/**
 * A non-finite value anywhere in sim state is a bug (design rule 5), never a
 * recoverable condition — fail loud rather than render garbage.
 */
function guardFinite(v: number, label: string): number {
  if (!Number.isFinite(v)) throw new Error(`sim: non-finite ${label} (${v})`);
  return v;
}

// ---------------------------------------------------------------------------
// Physics — exported pure functions (the table-driven tests hit these directly)
// ---------------------------------------------------------------------------

/**
 * Maximum potential intensity, KNOTS, as a function of SST (°C).
 *
 * Base curve: DeMaria, M., and J. Kaplan, 1994: "Sea Surface Temperature and
 * the Maximum Intensity of Atlantic Tropical Cyclones." J. Climate, 7,
 * 1324–1334 — V_mpi(m/s) = 28.2 + 55.8·exp(0.1813·(T − 30)).
 * Multiplied by a maintenance-SST taper (see SIM.SST_FLOOR_C) so MPI reaches 0
 * over cool water, which the two-term design ODE needs for a cold-water death.
 */
export function mpiKt(sstC: number): number {
  const dk =
    SIM.MPI_A_MS + SIM.MPI_B_MS * Math.exp(SIM.MPI_C * (sstC - SIM.MPI_T0_C));
  const warmth = clamp01((sstC - SIM.SST_FLOOR_C) / (SIM.SST_FULL_C - SIM.SST_FLOOR_C));
  return guardFinite(dk * KT_PER_MS * warmth, 'mpiKt');
}

/** Intensity loss rate from vertical wind shear (m/s) — kt/h, ≥ 0. */
export function shearPenaltyKtPerH(
  shearMs: number,
  parameters: Readonly<IntensityParameters> = DEFAULT_INTENSITY_PARAMETERS,
): number {
  const excess = shearMs - parameters.shearThresholdMs;
  return excess <= 0 ? 0 : excess * parameters.shearKtPerHPerMs;
}

/** Intensity loss rate over land — kt/h, proportional to current intensity. */
export function landDecayKtPerH(vKt: number, roughnessExposure = 1): number {
  return (
    SIM.LAND_DECAY_PER_H *
    Math.max(0, vKt) *
    clamp01(roughnessExposure)
  );
}

/**
 * Dry (desert-air) bearings as unit (east, north) vectors: the Arabian landmass
 * lies to the N / NW / W of the genesis belt, so those are the directions along
 * which dry continental air is entrained into an approaching storm.
 */
const DRY_BEARINGS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // N
  [-SQRT1_2, SQRT1_2], // NW
  [-1, 0], // W
];

/**
 * Legacy geometric dry-air diagnostic in [0,1]. Retained for older exported
 * tests/tools; the engine uses ERA5 RH and never calls it. Walks isLand outward
 * along each dry bearing in DRYAIR_STEP_KM increments up
 * to DRYAIR_RANGE_KM (via grid.offsetKm — no inline lat/lon math here); the min
 * hit distance across bearings sets proximity = (RANGE − dist)/RANGE. 0 when no
 * land within range (open sea); the probe starts one DRYAIR_STEP_KM out, so the
 * nearest resolvable land sits that step away and proximity tops out near
 * (RANGE − STEP)/RANGE ≈ 0.82 — never a full 1. Deterministic: a fixed step
 * grid, no RNG, and no wall-clock.
 */
function dryLandProximity(
  lat: number,
  lon: number,
  isLand: (lat: number, lon: number) => boolean,
): number {
  let nearestKm: number = SIM.DRYAIR_RANGE_KM;
  for (const [east, north] of DRY_BEARINGS) {
    for (let d: number = SIM.DRYAIR_STEP_KM; d <= SIM.DRYAIR_RANGE_KM; d += SIM.DRYAIR_STEP_KM) {
      const p = offsetKm(lat, lon, east, north, d);
      if (isLand(p.lat, p.lon)) {
        if (d < nearestKm) nearestKm = d;
        break; // nearest land along this bearing is all that matters
      }
    }
  }
  return clamp01((SIM.DRYAIR_RANGE_KM - nearestKm) / SIM.DRYAIR_RANGE_KM);
}

/**
 * Compatibility-only geometric dry-air diagnostic, kt/h. Live intensity uses
 * the ERA5 RH ventilation term in intensityTerms instead.
 */
export function dryAirPenaltyKtPerH(
  lat: number,
  lon: number,
  _monthIndex: number,
  isLand: (lat: number, lon: number) => boolean,
): number {
  if (SIM.DRYAIR_K <= 0) return 0;
  return guardFinite(SIM.DRYAIR_K * dryLandProximity(lat, lon, isLand), 'dryAirPenalty');
}

/** Beta-drift steering vector (m/s), directed NW: u west-negative, v north-positive. */
export function betaDriftMs(
  latitudeDeg = 20,
  outerSizeKm = 180,
  maximumWindKt = 70,
  scale = 1,
): { u: number; v: number } {
  const baseSpeed = SIM.BETA_DRIFT_KT * MS_PER_KT;
  const sizeFactor = clamp(outerSizeKm / 180, 0.65, 1.45);
  const intensityFactor = 0.78 + 0.22 * clamp01((maximumWindKt - 25) / 80);
  const latitudeFactor = clamp(Math.cos((latitudeDeg * Math.PI) / 180) / 0.94, 0.82, 1.06);
  const speed = clamp(
    baseSpeed * sizeFactor * intensityFactor * latitudeFactor * scale,
    0,
    1.45,
  );
  return { u: -speed * SQRT1_2, v: speed * SQRT1_2 };
}

export interface IntensityArgs {
  vKt: number;
  sstC: number;
  shearMs: number;
  overLand: boolean;
  lat: number;
  lon: number;
  monthIndex: number;
  /** Storm age in hours; omitted = mature (full shear penalty, no grace). */
  ageH?: number;
  /** ERA5 600/700-hPa mean RH; omitted tests assume a moist environment. */
  midlevelRhPct?: number;
  /** WOA23 OHC26; omitted tests assume robust upper-ocean support. */
  ohcKjCm2?: number;
  /** Persistent convective organization in [0,1]. */
  organization?: number;
  /** HF-2B vector-aware annular ventilation. */
  ventilation?: Readonly<VentilationDiagnostics>;
  /** HF-2C continuous vortex land/terrain exposure. */
  coastalExposure?: Readonly<CoastalExposure>;
  /** Optional candidate coefficients for calibration/sensitivity work. */
  parameters?: Readonly<IntensityParameters>;
  /** Pure helpers default to the physical research formulation. */
  physicsProfile?: PhysicsProfile;
}

/** The four ODE terms plus their net dV/dt (kt/h). Internal — drives attribution. */
interface IntensityTerms {
  mpi: number;
  relax: number;
  shearPen: number;
  landPen: number;
  dryPen: number;
  net: number;
}

function intensityTerms(a: IntensityArgs): IntensityTerms {
  const parameters = a.parameters ?? DEFAULT_INTENSITY_PARAMETERS;
  const physical = (a.physicsProfile ?? 'hf2-experimental') === 'hf2-experimental';
  // Over land there is no ocean heat source, so MPI collapses to 0 regardless of
  // whatever SST the sampler returns there — the relaxation term then decays V.
  const organization = clamp01(a.organization ?? 1);
  const landCoreExposure =
    a.coastalExposure?.coreLandFraction ?? (a.overLand ? 1 : 0);
  const ohcSupport = clamp01(((a.ohcKjCm2 ?? 70) - 10) / 70);
  // HF-2A removes the legacy OHC multiplier because the dynamic column's
  // surface temperature is already the ocean pathway. The shipped profile
  // retains it until that candidate passes its scientific gate.
  const mpi = physical
    ? mpiKt(a.sstC) * (1 - landCoreExposure)
    : a.overLand
      ? 0
      : mpiKt(a.sstC) *
        (1 - parameters.ohcMpiWeight + parameters.ohcMpiWeight * ohcSupport);
  const potentialGap = mpi - a.vKt;
  const organizedExcess = clamp01((organization - 0.45) / 0.1);
  const organizationCoupling =
    potentialGap >= 0
      ? 0.08 +
        parameters.organizationIntensification *
          organizedExcess *
          organizedExcess
      : 1;
  const oceanDepthCoupling =
    potentialGap >= 0
      ? 0.8 + 0.55 * clamp01(((a.ohcKjCm2 ?? 70) - 40) / 35)
      : 1;
  const coreCoupling =
    organizationCoupling * (physical ? 1 : oceanDepthCoupling);
  const relax = parameters.intensifyKPerH * potentialGap * coreCoupling;
  const graceRamp = a.ageH === undefined ? 1 : Math.min(1, a.ageH / SIM.SHEAR_GRACE_H);
  const effectiveShearMs =
    physical ? (a.ventilation?.shearMs ?? a.shearMs) : a.shearMs;
  const shearPen =
    graceRamp *
    shearPenaltyKtPerH(effectiveShearMs, parameters) *
    (1.15 - 0.3 * organization);
  const landPen = physical
    ? landDecayKtPerH(
        a.vKt,
        a.coastalExposure?.roughnessExposure ?? (a.overLand ? 1 : 0),
      )
    : a.overLand
      ? landDecayKtPerH(a.vKt)
      : 0;
  const dryFraction = clamp01(
    (SIM.RH_DRY_THRESHOLD_PCT -
      (a.ventilation?.meanRhPct ?? a.midlevelRhPct ?? 75)) /
      SIM.RH_DRY_RANGE_PCT,
  );
  // Ambient dry air only reaches the inner core efficiently when shear opens a
  // ventilation pathway and organization is already weak. This prevents a dry
  // monthly-mean free troposphere from unrealistically killing an otherwise
  // vertically aligned cyclone in calm flow.
  const coreExposure = Math.pow(1 - organization, 1.5);
  const shearExposure = clamp01((effectiveShearMs - 12) / 8);
  const ventilationExposure = physical && a.ventilation
    ? clamp01(a.ventilation.ventilationIndex / 0.18)
    : dryFraction * shearExposure;
  const dryPen =
    a.overLand
      ? 0
      : parameters.dryAirK *
        ventilationExposure *
        (0.25 + 1.5 * coreExposure);
  const net = relax - shearPen - landPen - dryPen;
  return { mpi, relax, shearPen, landPen, dryPen, net };
}

/** Equilibrium convective organization implied by the current environment. */
export function organizationTarget(
  sample: Pick<EnvSample, 'shear' | 'midlevelRhPct' | 'ohcKjCm2'>,
  effectiveSstC: number,
  overLand: boolean,
  ventilation?: Readonly<VentilationDiagnostics>,
  coastalExposure?: Readonly<CoastalExposure>,
  physicsProfile: PhysicsProfile = 'hf2-experimental',
): number {
  if (physicsProfile === 'shipped') {
    if (overLand) return 0.02;
    const warmth = clamp01((effectiveSstC - 25.5) / 3.5);
    const moisture = clamp01((sample.midlevelRhPct - 35) / 45);
    const oceanDepth = clamp01((sample.ohcKjCm2 - 15) / 65);
    const shearVentilation = 1 - clamp01((sample.shear - 7) / 23);
    return clamp01(
      (0.45 * warmth + 0.25 * moisture + 0.3 * oceanDepth) *
        shearVentilation,
    );
  }
  if (overLand && !coastalExposure) return 0.02;
  const warmth = clamp01((effectiveSstC - 25.5) / 3.5);
  const moisture = clamp01(
    ((ventilation?.meanRhPct ?? sample.midlevelRhPct) - 35) / 45,
  );
  const shearVentilation = ventilation
    ? 1 - clamp01(ventilation.ventilationIndex / 0.18)
    : 1 - clamp01((sample.shear - 7) / 23);
  const oceanTarget = clamp01(
    (0.62 * warmth + 0.38 * moisture) *
      shearVentilation,
  );
  const landFraction =
    coastalExposure?.coreLandFraction ?? (overLand ? 1 : 0);
  return clamp01(oceanTarget * (1 - landFraction) + 0.02 * landFraction);
}

/** Asymmetric relaxation: cores collapse quickly and rebuild slowly. */
export function advanceOrganization(
  current: number,
  target: number,
  dtH: number,
  parameters: Readonly<IntensityParameters> = DEFAULT_INTENSITY_PARAMETERS,
): number {
  const tau =
    target < current
      ? parameters.organizationDisruptionH
      : parameters.organizationRecoveryH;
  const weight = 1 - Math.exp(-Math.max(0, dtH) / tau);
  return clamp01(current + (target - current) * weight);
}

export interface RainRates {
  eyewallMmH: number;
  rainbandMmH: number;
  orographicMmH: number;
  totalMmH: number;
}

/**
 * Moisture support available to the parametric rain model, in [0,1].
 *
 * The environmental term represents imported mid-level moisture. The vortex
 * term represents storm-scale convergence and moisture recycling: it grows
 * only when a real circulation and an organized convective core coexist, and
 * fills part of the deficit left by dry ambient air. This deliberately avoids
 * treating a monthly environmental RH value as the storm core's humidity.
 *
 * This remains a reduced-order diagnostic, not forecast QPF. Its role is to
 * keep the rain proxy internally consistent with a strong organized vortex
 * while preserving a genuinely dry, weak, disorganized state.
 */
export function precipitationMoistureSupport(
  vKt: number,
  organization: number,
  midlevelRhPct: number,
): number {
  const ambient = clamp01((midlevelRhPct - 20) / 60);
  const circulation = clamp01((vKt - 20) / 60);
  const organizedCore = clamp01(organization);
  const vortexConvergence = 0.72 * circulation * organizedCore;
  return clamp01(ambient + (1 - ambient) * vortexConvergence);
}

/** Separated, bounded precipitation components for rendering and debrief. */
export function precipitationRates(
  vKt: number,
  organization: number,
  midlevelRhPct: number,
): RainRates {
  const moisture = precipitationMoistureSupport(
    vKt,
    organization,
    midlevelRhPct,
  );
  const core = 0.15 + 0.85 * clamp01(organization);
  const eyewallMmH =
    vKt < 34
      ? 0
      : Math.min(32, (5.5 + 0.16 * (vKt - 34)) * core * moisture);
  const rainbandMmH = Math.min(
    13,
    (1.2 + 0.048 * Math.max(0, vKt)) * (0.35 + 0.65 * core) * moisture,
  );
  const orographicMmH = Math.min(
    7,
    (0.7 + 0.026 * Math.max(0, vKt)) * (0.5 + 0.5 * core) * moisture,
  );
  return {
    eyewallMmH,
    rainbandMmH,
    orographicMmH,
    totalMmH: eyewallMmH + rainbandMmH + orographicMmH,
  };
}

/** Net intensity change rate, kt/h (dV/dt). Positive = intensifying. */
export function intensityRateKtPerH(a: IntensityArgs): number {
  return guardFinite(intensityTerms(a).net, 'intensityRate');
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** What the engine needs from the rest of the app to run. */
export interface SimDeps {
  /** Baked environment sampler (SST + deep-layer steering + shear). */
  env: EnvSampler;
  /** Land mask predicate, from terrain.bin — true where (lat,lon) is land. */
  isLand: (lat: number, lon: number) => boolean;
  /** Optional deterministic coefficient override for calibration/ensembles. */
  intensityParameters?: Partial<IntensityParameters>;
  /** Optional HF-3 motion override for calibration and ensembles. */
  trackParameters?: Partial<TrackParameters>;
  /** Rejected research physics must be selected explicitly. */
  physicsProfile?: PhysicsProfile;
  /** Vortex-filtered, temporally coherent 850/500/250 hPa sidecar sampler. */
  pressureWindSampler?: PressureWindSampler;
  /** Skip non-coupled wind-radius inversions for non-rendered ensemble members. */
  structureDetail?: StructureDetail;
  /** Optional bounded HF-2A ocean parameters for calibration. */
  upperOceanParameters?: Partial<UpperOceanParameters>;
  /** Analysis/test injection seam; normal runtime constructs its own model. */
  upperOcean?: SparseUpperOcean;
  /** Immutable WOA/analysis T/S profile initialization. */
  oceanProfileSampler?: OceanProfileSampler;
  /** Optional terrain elevation sampler used by continuous coastal decay. */
  terrainHeightM?: (lat: number, lon: number) => number;
}

export function createSimEngine(deps: SimDeps): SimEngine {
  const { env, isLand } = deps;
  const intensityParameters: IntensityParameters = {
    ...DEFAULT_INTENSITY_PARAMETERS,
    ...deps.intensityParameters,
  };
  const trackParameters: TrackParameters = {
    ...DEFAULT_TRACK_PARAMETERS,
    ...deps.trackParameters,
  };
  const physicsProfile = deps.physicsProfile ?? 'shipped';
  const structureDetail = deps.structureDetail ?? 'full';
  const upperOcean =
    deps.upperOcean ?? new SparseUpperOcean(deps.upperOceanParameters);
  // --- Mutable run state (all reset by spawn) ------------------------------
  let current: StormState | null = null;
  let track: TrackPoint[] = [];
  let rng: Rng = makeRng(0);
  let monthIndex = 0;
  let seed = 0;
  let demo = false;
  let tFracHorizonH: number = SIM.EVENT_TFRAC_HORIZON_H;
  let tFracOffsetH = 0;
  let stochasticWander = true;
  let resolvedMotionUms = 0;
  let resolvedMotionVms = 0;
  let initialMotionCorrectionUms = 0;
  let initialMotionCorrectionVms = 0;

  let lat = 0;
  let lon = 0;
  let vKt = 0;
  let ageH = 0;
  let alive = false;
  let organization = 0.3;
  let organizationTargetValue = 0.3;
  let coldWakeC = 0;
  let oceanDiagnostics: OceanColumnDiagnostics | null = null;
  let diagnostics: StormDiagnostics = {
    sstC: 0,
    effectiveSstC: 0,
    midlevelRhPct: 0,
    ohcKjCm2: 0,
    organization: 0,
    organizationTarget: 0,
    coldWakeC: 0,
    mpiKt: 0,
    steerU: 0,
    steerV: 0,
    shearMs: 0,
    shearUms: 0,
    shearVms: 0,
    overLand: false,
    oceanKtPerH: 0,
    shearKtPerH: 0,
    landKtPerH: 0,
    dryAirKtPerH: 0,
    netKtPerH: 0,
    eyewallRainMmH: 0,
    rainbandRainMmH: 0,
    orographicRainMmH: 0,
    totalRainMmH: 0,
  };
  let structure: StormStructure = deriveStormStructure({
    vKt: 0,
    lat: 20,
    shearMs: 0,
    overLand: false,
    motionUms: 0,
    motionVms: 0,
  });

  // wander (steering-velocity perturbation, m/s)
  let pu = 0;
  let pv = 0;

  // death attribution — EMAs of each decay channel's recent contribution
  let recentCold = 0;
  let recentShear = 0;
  let recentLand = 0;
  let recentDry = 0;

  // event bookkeeping
  let justSpawned = false;
  let prevOverLand = false;
  let peakKt = 0;
  let prevVKtForPeak = 0;
  let rising = false;
  let closestKm = Infinity;

  function sampleEnv(atLat: number, atLon: number, tFrac: number): EnvSample {
    const e = env.sample(atLat, atLon, monthIndex, tFrac);
    // Boundary validation: baked data must be finite (design: validate at edges).
    guardFinite(e.sstC, 'env.sstC');
    guardFinite(e.steerU, 'env.steerU');
    guardFinite(e.steerV, 'env.steerV');
    guardFinite(e.shear, 'env.shear');
    guardFinite(e.shearU, 'env.shearU');
    guardFinite(e.shearV, 'env.shearV');
    guardFinite(e.midlevelRhPct, 'env.midlevelRhPct');
    guardFinite(e.ohcKjCm2, 'env.ohcKjCm2');
    return e;
  }

  interface MotionBudget {
    u: number;
    v: number;
    steering: EnvironmentalSteering;
    beta: { u: number; v: number };
    terrain: { u: number; v: number };
  }
  let lastMotionBudget: MotionBudget | null = null;

  /** Diagnosed motion target at one point before finite response-time smoothing. */
  function motionTargetAt(
    atLat: number,
    atLon: number,
    tFrac: number,
  ): MotionBudget {
    const e = sampleEnv(atLat, atLon, tFrac);
    const steering = sampleEnvironmentalSteering(
      env,
      deps.pressureWindSampler,
      atLat,
      atLon,
      monthIndex,
      tFrac,
      vKt,
      organization,
      structure.outerSizeKm,
    );
    const blend = clamp(trackParameters.environmentalSteeringBlend, 0, 1);
    const environmentalU = e.steerU + (steering.u - e.steerU) * blend;
    const environmentalV = e.steerV + (steering.v - e.steerV) * blend;
    const beta = physicsProfile === 'shipped'
      ? {
          u: -SIM.BETA_DRIFT_KT * MS_PER_KT * SQRT1_2,
          v: SIM.BETA_DRIFT_KT * MS_PER_KT * SQRT1_2,
        }
      : betaDriftMs(
          atLat,
          structure.outerSizeKm,
          vKt,
          trackParameters.betaDriftScale,
        );
    const terrain = sampleTerrainDrift(
      atLat,
      atLon,
      structure.outerSizeKm,
      isLand,
      deps.terrainHeightM,
      trackParameters.terrainDriftMaxMs,
    );
    const correctionHours = Math.max(0, trackParameters.initialMotionBlendHours);
    const correctionWeight =
      correctionHours > 0 && ageH < correctionHours
        ? 0.5 * (1 + Math.cos((Math.PI * ageH) / correctionHours))
        : 0;
    return {
      u:
        environmentalU +
        beta.u +
        terrain.u +
        pu +
        initialMotionCorrectionUms * correctionWeight,
      v:
        environmentalV +
        beta.v +
        terrain.v +
        pv +
        initialMotionCorrectionVms * correctionWeight,
      steering,
      beta,
      terrain,
    };
  }

  function snapshot(): StormState {
    return {
      lat,
      lon,
      vKt,
      ageH,
      trackPoints: track,
      alive,
      isDemo: demo,
      organization,
      coldWakeC,
      diagnostics: { ...diagnostics },
      structure: cloneStormStructure(structure),
    };
  }

  function updateDiagnostics(
    sample: EnvSample,
    ocean: OceanColumnDiagnostics,
    ventilation: VentilationDiagnostics,
    coastalExposure: CoastalExposure,
    coupledSstC: number,
    overLand: boolean,
    terms: IntensityTerms,
  ): void {
    const rain = precipitationRates(vKt, organization, sample.midlevelRhPct);
    diagnostics = {
      sstC: ocean.backgroundSstC,
      effectiveSstC: ocean.surfaceSstC,
      midlevelRhPct: sample.midlevelRhPct,
      ohcKjCm2: ocean.ohcKjCm2,
      organization,
      organizationTarget: organizationTargetValue,
      coldWakeC,
      oceanInitializationTier: ocean.initializationTier,
      oceanSourceValidTime: ocean.sourceValidTime,
      oceanCoupledSstC: coupledSstC,
      oceanMixedLayerDepthM: ocean.mixedLayerDepthM,
      oceanIsotherm26DepthM: ocean.isotherm26DepthM,
      oceanTemperatureBelowMixedLayerC: ocean.temperatureBelowMixedLayerC,
      oceanCurrentSpeedMs: ocean.mixedLayerCurrentSpeedMs,
      oceanCurrentDirectionDeg: ocean.mixedLayerCurrentDirectionDeg,
      oceanInertialPeriodH: ocean.inertialPeriodH,
      oceanWindStressPa: ocean.windStressPa,
      oceanBulkRichardson: ocean.bulkRichardson,
      oceanEntrainmentDepthM: ocean.entrainmentDepthM,
      oceanHeatMovedThisStepJm2: ocean.heatMovedThisStepJm2,
      oceanCumulativeMixingHeatJm2: ocean.cumulativeMixingHeatJm2,
      oceanCumulativeRecoveryHeatJm2: ocean.cumulativeRecoveryHeatJm2,
      oceanActiveColumnCount: ocean.activeColumnCount,
      oceanHardBoundFlag: ocean.hardBoundFlag,
      oceanMissingSourceFlag: ocean.missingSourceFlag,
      mpiKt: terms.mpi,
      steerU: sample.steerU,
      steerV: sample.steerV,
      steering850Weight: lastMotionBudget?.steering.weights.w850,
      steering500Weight: lastMotionBudget?.steering.weights.w500,
      steering250Weight: lastMotionBudget?.steering.weights.w250,
      environmentalSteeringUms: lastMotionBudget?.steering.u,
      environmentalSteeringVms: lastMotionBudget?.steering.v,
      betaDriftUms: lastMotionBudget?.beta.u,
      betaDriftVms: lastMotionBudget?.beta.v,
      terrainDriftUms: lastMotionBudget?.terrain.u,
      terrainDriftVms: lastMotionBudget?.terrain.v,
      resolvedMotionUms,
      resolvedMotionVms,
      steeringAnnulusRadiusKm: lastMotionBudget?.steering.annulusRadiusKm,
      steeringPressureLevelsAvailable:
        lastMotionBudget?.steering.pressureLevelsAvailable,
      shearMs: sample.shear,
      shearUms: sample.shearU,
      shearVms: sample.shearV,
      ventilationIndex: ventilation.ventilationIndex,
      ventilationAnnulusRadiusKm: ventilation.annulusRadiusKm,
      ventilationMeanRhPct: ventilation.meanRhPct,
      ventilationUpshearRhPct: ventilation.upshearRhPct,
      ventilationShearUms: ventilation.shearUms,
      ventilationShearVms: ventilation.shearVms,
      ventilationShearCoherence: ventilation.shearVectorCoherence,
      coastalCoreLandFraction: coastalExposure.coreLandFraction,
      coastalOuterLandFraction: coastalExposure.outerLandFraction,
      coastalMeanLandElevationM: coastalExposure.meanLandElevationM,
      coastalRoughnessExposure: coastalExposure.roughnessExposure,
      overLand,
      oceanKtPerH: terms.relax,
      shearKtPerH: terms.shearPen,
      landKtPerH: terms.landPen,
      dryAirKtPerH: terms.dryPen,
      netKtPerH: terms.net,
      eyewallRainMmH: rain.eyewallMmH,
      rainbandRainMmH: rain.rainbandMmH,
      orographicRainMmH: rain.orographicMmH,
      totalRainMmH: rain.totalMmH,
    };
  }

  function recordTrackPoint(): void {
    track.push({ lat, lon, vKt, ageH });
  }

  function reasonFromRecent(): DeathReason {
    const m = Math.max(recentLand, recentShear, recentCold, recentDry);
    if (m <= 0) return DeathReason.ColdWater; // starved with no clear driver
    if (recentLand === m) return DeathReason.Land;
    if (recentShear === m) return DeathReason.Shear;
    if (recentDry === m) return DeathReason.DryAir;
    return DeathReason.ColdWater;
  }

  function die(reason: DeathReason, events: SimEvent[]): void {
    // tick() already recorded the final track point at this position; just flip
    // the flag and re-snapshot so getState() reflects the death.
    alive = false;
    current = snapshot();
    events.push({
      type: 'died',
      death: {
        reason,
        closestApproachKm: guardFinite(closestKm, 'closestApproachKm'),
        durationH: guardFinite(ageH, 'durationH'),
        peakKt: guardFinite(peakKt, 'peakKt'),
      },
    });
  }

  function spawn(params: SpawnParams): void {
    lat = guardFinite(params.lat, 'spawn.lat');
    lon = guardFinite(params.lon, 'spawn.lon');
    monthIndex = params.monthIndex;
    seed = params.seed >>> 0;
    demo = params.isDemo;
    // Optional per-storm horizon (C4). A non-finite/≤0 value would make tFrac
    // divide-by-zero or NaN, so fall back to the default in that case.
    tFracHorizonH =
      params.tFracHorizonH !== undefined &&
      Number.isFinite(params.tFracHorizonH) &&
      params.tFracHorizonH > 0
        ? params.tFracHorizonH
        : SIM.EVENT_TFRAC_HORIZON_H;
    tFracOffsetH =
      params.tFracOffsetH !== undefined &&
      Number.isFinite(params.tFracOffsetH) &&
      params.tFracOffsetH >= 0
        ? params.tFracOffsetH
        : 0;
    stochasticWander = params.disableWander !== true;

    rng = makeRng(seed);
    vKt =
      params.initialWindKt !== undefined &&
      Number.isFinite(params.initialWindKt) &&
      params.initialWindKt > 0
        ? params.initialWindKt
        : SIM.SPAWN_VKT;
    ageH = 0;
    alive = true;
    pu = 0;
    pv = 0;
    resolvedMotionUms = 0;
    resolvedMotionVms = 0;
    initialMotionCorrectionUms = 0;
    initialMotionCorrectionVms = 0;
    organization =
      params.initialOrganization !== undefined &&
      Number.isFinite(params.initialOrganization)
        ? clamp01(params.initialOrganization)
        : clamp01(0.35 + 0.35 * clamp01((vKt - 20) / 80));
    coldWakeC = 0;
    recentCold = 0;
    recentShear = 0;
    recentLand = 0;
    recentDry = 0;
    peakKt = vKt;
    prevVKtForPeak = vKt;
    rising = false;
    prevOverLand = isLand(lat, lon);
    const initialTFrac = clamp01(tFracOffsetH / tFracHorizonH);
    upperOcean.reset((oceanLat, oceanLon) => {
      const sample = sampleEnv(oceanLat, oceanLon, initialTFrac);
      // Sample FIRST, then derive provenance from what came back. Assigning the
      // tier before the sampler returns is how a missing ocean.bin used to be
      // labelled as WOA23 climatology.
      const profileSample = deps.oceanProfileSampler?.(
        oceanLat,
        oceanLon,
        monthIndex,
      );
      return {
        sstC: sample.sstC,
        ohcKjCm2: sample.ohcKjCm2,
        initializationTier: profileSample?.tier ?? 'analytic-fallback',
        sourceValidTime: profileSample?.sourceValidTime,
        profile: profileSample?.profile,
      };
    });
    const initialEnv = sampleEnv(lat, lon, initialTFrac);
    oceanDiagnostics = upperOcean.sample(lat, lon, ageH);
    coldWakeC = oceanDiagnostics.coolingC;
    const initialMotion = motionTargetAt(lat, lon, initialTFrac);
    initialMotionCorrectionUms =
      params.initialMotionUms !== undefined &&
      Number.isFinite(params.initialMotionUms)
        ? params.initialMotionUms - initialMotion.u
        : 0;
    initialMotionCorrectionVms =
      params.initialMotionVms !== undefined &&
      Number.isFinite(params.initialMotionVms)
        ? params.initialMotionVms - initialMotion.v
        : 0;
    resolvedMotionUms =
      params.initialMotionUms !== undefined &&
      Number.isFinite(params.initialMotionUms)
        ? params.initialMotionUms
        : initialMotion.u;
    resolvedMotionVms =
      params.initialMotionVms !== undefined &&
      Number.isFinite(params.initialMotionVms)
        ? params.initialMotionVms
        : initialMotion.v;
    lastMotionBudget = initialMotion;
    const preliminaryStructure = deriveStormStructure(
      {
        vKt,
        lat,
        lon,
        shearMs: initialEnv.shear,
        shearUms: initialEnv.shearU,
        shearVms: initialEnv.shearV,
        overLand: prevOverLand,
        motionUms: resolvedMotionUms,
        motionVms: resolvedMotionVms,
        previousRmwKm: params.initialRmwKm,
        previousOuterSizeKm: params.initialOuterSizeKm,
        rmwSource:
          params.initialRmwKm === undefined
            ? 'climatological-prior'
            : 'agency-observed',
        outerSizeSource:
          params.initialOuterSizeKm === undefined
            ? 'climatological-prior'
            : 'agency-observed',
        initialR34Km: params.initialR34Km,
        initialR50Km: params.initialR50Km,
        initialR64Km: params.initialR64Km,
        deltaHours: 0,
      },
      undefined,
      structureDetail,
    );
    const initialCoastalExposure = sampleCoastalExposure(
      lat,
      lon,
      preliminaryStructure.rmwKm,
      preliminaryStructure.outerSizeKm,
      isLand,
      deps.terrainHeightM,
    );
    const initialVentilation = sampleVentilationEnvironment(
      env,
      lat,
      lon,
      monthIndex,
      initialTFrac,
      preliminaryStructure.outerSizeKm,
      mpiKt(oceanDiagnostics.surfaceSstC),
    );
    structure = deriveStormStructure(
      {
        vKt,
        lat,
        lon,
        shearMs: initialVentilation.shearMs,
        shearUms: initialVentilation.shearUms,
        shearVms: initialVentilation.shearVms,
        overLand: prevOverLand,
        landExposureFraction: initialCoastalExposure.roughnessExposure,
        motionUms: resolvedMotionUms,
        motionVms: resolvedMotionVms,
        previousRmwKm: params.initialRmwKm,
        previousOuterSizeKm: params.initialOuterSizeKm,
        rmwSource:
          params.initialRmwKm === undefined
            ? 'climatological-prior'
            : 'agency-observed',
        outerSizeSource:
          params.initialOuterSizeKm === undefined
            ? 'climatological-prior'
            : 'agency-observed',
        initialR34Km: params.initialR34Km,
        initialR50Km: params.initialR50Km,
        initialR64Km: params.initialR64Km,
        deltaHours: 0,
      },
      undefined,
      structureDetail,
    );
    organizationTargetValue = organizationTarget(
      initialEnv,
      oceanDiagnostics.surfaceSstC,
      prevOverLand,
      initialVentilation,
      initialCoastalExposure,
      physicsProfile,
    );
    organization =
      params.initialOrganization !== undefined &&
      Number.isFinite(params.initialOrganization)
        ? clamp01(params.initialOrganization)
        : clamp01(
            0.34 +
              0.34 * organizationTargetValue +
              0.32 * clamp01((vKt - 20) / 80),
          );
    const initialTerms = intensityTerms({
      vKt,
      sstC: oceanDiagnostics.surfaceSstC,
      shearMs: initialEnv.shear,
      midlevelRhPct: initialEnv.midlevelRhPct,
      ohcKjCm2: oceanDiagnostics.ohcKjCm2,
      organization,
      ventilation: initialVentilation,
      coastalExposure: initialCoastalExposure,
      parameters: intensityParameters,
      physicsProfile,
      overLand: prevOverLand,
      lat,
      lon,
      monthIndex,
      ageH,
    });
    updateDiagnostics(
      initialEnv,
      oceanDiagnostics,
      initialVentilation,
      initialCoastalExposure,
      oceanDiagnostics.surfaceSstC,
      prevOverLand,
      initialTerms,
    );
    closestKm = greatCircleKm(MUSCAT, { lat, lon });

    track = [];
    recordTrackPoint();
    current = snapshot();
    justSpawned = true; // first tick emits the 'spawned' event (spawn() is void)
  }

  function tick(dtMin: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (!alive || current === null) return events;

    if (justSpawned) {
      justSpawned = false;
      events.push({ type: 'spawned', state: current });
    }

    const dtH = dtMin / 60;
    const tFrac = clamp01((ageH + tFracOffsetH) / tFracHorizonH);
    const previousLat = lat;
    const previousLon = lon;
    const previousStructure = cloneStormStructure(structure);
    const coupledOcean = upperOcean.sample(lat, lon, ageH);
    const coupledSstC = coupledOcean.surfaceSstC;

    // 1) Advance the wander ONCE per tick (2 draws) — used for both RK2 stages.
    if (stochasticWander) {
      pu +=
        (rng.next() * 2 - 1) * trackParameters.wanderStepMs -
        pu * trackParameters.wanderRevertFraction;
      pv +=
        (rng.next() * 2 - 1) * trackParameters.wanderStepMs -
        pv * trackParameters.wanderRevertFraction;
    }

    // 2) Curved motion with a finite response time. Environmental targets are
    // sampled at the RK2 midpoint, while the resolved vortex motion accelerates
    // smoothly toward that flow instead of changing discontinuously per cell.
    const responseHours = Math.max(0, trackParameters.motionResponseHours);
    const response = responseHours <= 1e-9 ? 1 : 1 - Math.exp(-dtH / responseHours);
    const target1 = motionTargetAt(lat, lon, tFrac);
    const provisionalU = resolvedMotionUms + (target1.u - resolvedMotionUms) * response;
    const provisionalV = resolvedMotionVms + (target1.v - resolvedMotionVms) * response;
    const provisionalDegrees = windToDegPerHour(
      (resolvedMotionUms + provisionalU) / 2,
      (resolvedMotionVms + provisionalV) / 2,
      lat,
    );
    const midpointLat = lat + (provisionalDegrees.dLat * dtH) / 2;
    const midpointLon = lon + (provisionalDegrees.dLon * dtH) / 2;
    const target2 = motionTargetAt(midpointLat, midpointLon, tFrac);
    resolvedMotionUms += (target2.u - resolvedMotionUms) * response;
    resolvedMotionVms += (target2.v - resolvedMotionVms) * response;
    lastMotionBudget = target2;
    const k2 = {
      u: resolvedMotionUms,
      v: resolvedMotionVms,
      ...windToDegPerHour(resolvedMotionUms, resolvedMotionVms, midpointLat),
    };
    lat = guardFinite(lat + k2.dLat * dtH, 'lat');
    lon = guardFinite(lon + k2.dLon * dtH, 'lon');
    ageH = guardFinite(ageH + dtH, 'ageH');

    // 3) Intensity ODE at the new position.
    const e = sampleEnv(lat, lon, tFrac);
    const overLand = isLand(lat, lon);
    const intensitySstC =
      physicsProfile === 'hf2-experimental' ? coupledSstC : e.sstC;
    const ventilation = sampleVentilationEnvironment(
      env,
      lat,
      lon,
      monthIndex,
      tFrac,
      structure.outerSizeKm,
      mpiKt(coupledSstC),
    );
    const coastalExposure = sampleCoastalExposure(
      lat,
      lon,
      structure.rmwKm,
      structure.outerSizeKm,
      isLand,
      deps.terrainHeightM,
    );
    organizationTargetValue = organizationTarget(
      e,
      intensitySstC,
      overLand,
      ventilation,
      coastalExposure,
      physicsProfile,
    );
    organization = advanceOrganization(
      organization,
      organizationTargetValue,
      dtH,
      intensityParameters,
    );
    const terms = intensityTerms({
      vKt,
      sstC: intensitySstC,
      shearMs: e.shear,
      midlevelRhPct: e.midlevelRhPct,
      ohcKjCm2: coupledOcean.ohcKjCm2,
      organization,
      ventilation,
      coastalExposure,
      parameters: intensityParameters,
      physicsProfile,
      overLand,
      lat,
      lon,
      monthIndex,
      ageH,
    });
    vKt = guardFinite(Math.max(0, vKt + terms.net * dtH), 'vKt');
    structure = deriveStormStructure(
      {
        vKt,
        lat,
        lon,
        shearMs: ventilation.shearMs,
        shearUms: ventilation.shearUms,
        shearVms: ventilation.shearVms,
        overLand,
        landExposureFraction: coastalExposure.roughnessExposure,
        motionUms: k2.u,
        motionVms: k2.v,
        previousRmwKm: structure.rmwKm,
        previousOuterSizeKm: structure.outerSizeKm,
        rmwSource: structure.rmwSource,
        outerSizeSource: structure.outerSizeSource,
        deltaHours: dtH,
      },
      undefined,
      structureDetail,
    );
    upperOcean.forceSegment(
      { lat: previousLat, lon: previousLon, structure: previousStructure },
      { lat, lon, structure },
      dtH,
      ageH,
      isLand,
    );
    oceanDiagnostics = upperOcean.sample(lat, lon, ageH);
    coldWakeC = overLand ? 0 : oceanDiagnostics.coolingC;
    // Keep the environment timeline's externally observable last sample on the
    // actual physics time, not on the ocean's frozen initialization snapshot.
    const currentEnvironment = sampleEnv(lat, lon, tFrac);
    updateDiagnostics(
      currentEnvironment,
      oceanDiagnostics,
      ventilation,
      coastalExposure,
      coupledSstC,
      overLand,
      terms,
    );

    // 4) Attribute this tick's weakening to a channel (recent-weighted EMA).
    const coldHere = overLand ? 0 : Math.max(0, -terms.relax);
    const landHere = overLand ? Math.max(0, -terms.relax) + terms.landPen : 0;
    const shearHere = terms.shearPen;
    const dryHere = terms.dryPen;
    recentCold = recentCold * SIM.RECENT_DECAY + coldHere;
    recentShear = recentShear * SIM.RECENT_DECAY + shearHere;
    recentLand = recentLand * SIM.RECENT_DECAY + landHere;
    recentDry = recentDry * SIM.RECENT_DECAY + dryHere;

    // 5) Trackers + narrative events.
    if (vKt > peakKt) peakKt = vKt;
    closestKm = Math.min(closestKm, greatCircleKm(MUSCAT, { lat, lon }));

    if (overLand && !prevOverLand) events.push({ type: 'landfall', lat, lon });
    prevOverLand = overLand;

    if (vKt > prevVKtForPeak + 1e-9) {
      rising = true;
    } else if (rising && vKt < prevVKtForPeak - 1e-9 && peakKt >= SIM.PEAK_MIN_KT) {
      events.push({ type: 'peak', vKt: peakKt });
      rising = false;
    }
    prevVKtForPeak = vKt;

    recordTrackPoint();
    current = snapshot();

    // 6) Lifecycle: exit-domain wins over intensity; then the <20 kt floor.
    if (!inBBox(lat, lon, DOMAIN)) {
      die(DeathReason.ExitedDomain, events);
    } else if (vKt < SIM.DESPAWN_VKT) {
      die(reasonFromRecent(), events);
    }

    return events;
  }

  return {
    spawn,
    tick,
    getState: () => current,
    get isDemo() {
      return current?.isDemo ?? false;
    },
  };
}
