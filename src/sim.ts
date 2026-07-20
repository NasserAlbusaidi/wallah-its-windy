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
   * Base relaxation rate toward thermodynamically adjusted MPI. Persistent
   * organization and OHC multiply this rate nonlinearly, so 0.08 is not itself
   * a storm-wide e-folding time.
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
  /** Weakening per m/s of shear above threshold, kt/h (same recalibration). */
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
  /**
   * Per-tick stochastic steering wander (design step 4 remedy): a mean-reverting
   * random walk in steering-velocity space (m/s), so identical clicks with
   * different seeds diverge while same (spawn,month,seed) stays EXACT. Assumes
   * the fixed 15-min tick cadence of the accumulator loop.
   */
  WANDER_STEP_MS: 0.28,
  WANDER_REVERT: 0.05,

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

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
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
export function shearPenaltyKtPerH(shearMs: number): number {
  const excess = shearMs - SIM.SHEAR_THRESHOLD_MS;
  return excess <= 0 ? 0 : excess * SIM.SHEAR_K_KT_PER_H_PER_MS;
}

/** Intensity loss rate over land — kt/h, proportional to current intensity. */
export function landDecayKtPerH(vKt: number): number {
  return SIM.LAND_DECAY_PER_H * Math.max(0, vKt);
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
export function betaDriftMs(): { u: number; v: number } {
  const speed = SIM.BETA_DRIFT_KT * MS_PER_KT;
  return { u: -speed * SQRT1_2, v: speed * SQRT1_2 };
}

interface IntensityArgs {
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
  // Over land there is no ocean heat source, so MPI collapses to 0 regardless of
  // whatever SST the sampler returns there — the relaxation term then decays V.
  const organization = clamp01(a.organization ?? 1);
  const ohcSupport = clamp01(((a.ohcKjCm2 ?? 70) - 10) / 70);
  const mpi = a.overLand
    ? 0
    : mpiKt(a.sstC) * (0.72 + 0.28 * ohcSupport);
  const potentialGap = mpi - a.vKt;
  const organizedExcess = clamp01((organization - 0.45) / 0.1);
  const organizationCoupling =
    potentialGap >= 0
      ? 0.08 + 0.5 * organizedExcess * organizedExcess
      : 1;
  const oceanDepthCoupling =
    potentialGap >= 0
      ? 0.8 + 0.55 * clamp01(((a.ohcKjCm2 ?? 70) - 40) / 35)
      : 1;
  const coreCoupling = organizationCoupling * oceanDepthCoupling;
  const relax = SIM.INTENSIFY_K_PER_H * potentialGap * coreCoupling;
  const graceRamp = a.ageH === undefined ? 1 : Math.min(1, a.ageH / SIM.SHEAR_GRACE_H);
  const shearPen =
    graceRamp *
    shearPenaltyKtPerH(a.shearMs) *
    (1.15 - 0.3 * organization);
  const landPen = a.overLand ? landDecayKtPerH(a.vKt) : 0;
  const dryFraction = clamp01(
    (SIM.RH_DRY_THRESHOLD_PCT - (a.midlevelRhPct ?? 75)) /
      SIM.RH_DRY_RANGE_PCT,
  );
  // Ambient dry air only reaches the inner core efficiently when shear opens a
  // ventilation pathway and organization is already weak. This prevents a dry
  // monthly-mean free troposphere from unrealistically killing an otherwise
  // vertically aligned cyclone in calm flow.
  const coreExposure = Math.pow(1 - organization, 1.5);
  const shearExposure = clamp01((a.shearMs - 12) / 8);
  const dryPen =
    a.overLand
      ? 0
      : SIM.DRYAIR_K *
        dryFraction *
        (0.25 + 1.5 * coreExposure) *
        shearExposure;
  const net = relax - shearPen - landPen - dryPen;
  return { mpi, relax, shearPen, landPen, dryPen, net };
}

/** Equilibrium convective organization implied by the current environment. */
export function organizationTarget(
  sample: Pick<EnvSample, 'shear' | 'midlevelRhPct' | 'ohcKjCm2'>,
  effectiveSstC: number,
  overLand: boolean,
): number {
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

/** Asymmetric relaxation: cores collapse quickly and rebuild slowly. */
export function advanceOrganization(
  current: number,
  target: number,
  dtH: number,
): number {
  const tau =
    target < current
      ? SIM.ORGANIZATION_DISRUPTION_H
      : SIM.ORGANIZATION_RECOVERY_H;
  const weight = 1 - Math.exp(-Math.max(0, dtH) / tau);
  return clamp01(current + (target - current) * weight);
}

export interface RainRates {
  eyewallMmH: number;
  rainbandMmH: number;
  orographicMmH: number;
  totalMmH: number;
}

/** Separated, bounded precipitation components for rendering and debrief. */
export function precipitationRates(
  vKt: number,
  organization: number,
  midlevelRhPct: number,
): RainRates {
  const moisture = clamp01((midlevelRhPct - 30) / 50);
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
}

export function createSimEngine(deps: SimDeps): SimEngine {
  const { env, isLand } = deps;
  const beta = betaDriftMs();

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

  let lat = 0;
  let lon = 0;
  let vKt = 0;
  let ageH = 0;
  let alive = false;
  let organization = 0.3;
  let organizationTargetValue = 0.3;
  let coldWakeC = 0;
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

  interface WakePatch {
    lat: number;
    lon: number;
    coolingC: number;
    radiusKm: number;
    ageH: number;
  }
  let wakePatches: WakePatch[] = [];

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

  /** Instantaneous storm motion at a point (steering + beta + seeded wander). */
  function motionAt(
    atLat: number,
    atLon: number,
    tFrac: number,
  ): { u: number; v: number; dLat: number; dLon: number } {
    const e = sampleEnv(atLat, atLon, tFrac);
    const u = e.steerU + beta.u + pu; // m/s eastward
    const v = e.steerV + beta.v + pv; // m/s northward
    return { u, v, ...windToDegPerHour(u, v, atLat) };
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
    effectiveSstC: number,
    overLand: boolean,
    terms: IntensityTerms,
  ): void {
    const rain = precipitationRates(vKt, organization, sample.midlevelRhPct);
    diagnostics = {
      sstC: sample.sstC,
      effectiveSstC,
      midlevelRhPct: sample.midlevelRhPct,
      ohcKjCm2: sample.ohcKjCm2,
      organization,
      organizationTarget: organizationTargetValue,
      coldWakeC,
      mpiKt: terms.mpi,
      steerU: sample.steerU,
      steerV: sample.steerV,
      shearMs: sample.shear,
      shearUms: sample.shearU,
      shearVms: sample.shearV,
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

  function decayWake(dtH: number): void {
    const decay = Math.exp(-dtH / SIM.COLD_WAKE_RECOVERY_H);
    for (const patch of wakePatches) {
      patch.coolingC *= decay;
      patch.ageH += dtH;
    }
    wakePatches = wakePatches.filter(
      (patch) =>
        patch.ageH <= SIM.COLD_WAKE_MAX_AGE_H && patch.coolingC >= 1e-9,
    );
  }

  function sampleWake(atLat: number, atLon: number): number {
    let cooling = 0;
    for (const patch of wakePatches) {
      const distance = greatCircleKm(
        { lat: atLat, lon: atLon },
        { lat: patch.lat, lon: patch.lon },
      );
      const sigma = Math.max(20, patch.radiusKm * 0.5);
      cooling +=
        patch.coolingC *
        Math.exp(-(distance * distance) / (2 * sigma * sigma));
    }
    return Math.min(SIM.COLD_WAKE_MAX_C, Math.max(0, cooling));
  }

  function depositWake(
    atLat: number,
    atLon: number,
    sample: EnvSample,
    motionSpeedMs: number,
    radiusKm: number,
    dtH: number,
  ): void {
    if (isLand(atLat, atLon) || vKt < 25) return;
    const intensity = clamp01((vKt - 20) / 90);
    const shallowOcean = Math.max(
      0.35,
      Math.min(2, 50 / Math.max(10, sample.ohcKjCm2)),
    );
    const stagnation = Math.max(
      0.35,
      Math.min(2, 5 / Math.max(1, motionSpeedMs + 0.5)),
    );
    const added =
      SIM.COLD_WAKE_K_C_PER_H *
      intensity *
      intensity *
      shallowOcean *
      stagnation *
      dtH;
    if (added <= 0) return;

    let nearest: WakePatch | null = null;
    let nearestKm = Infinity;
    for (const patch of wakePatches) {
      const distance = greatCircleKm(
        { lat: atLat, lon: atLon },
        { lat: patch.lat, lon: patch.lon },
      );
      if (distance < nearestKm) {
        nearest = patch;
        nearestKm = distance;
      }
    }
    const mergeRadiusKm = Math.max(15, radiusKm * 0.2);
    if (nearest && nearestKm <= mergeRadiusKm) {
      nearest.coolingC = Math.min(
        SIM.COLD_WAKE_MAX_C,
        nearest.coolingC + added,
      );
      nearest.radiusKm = Math.max(nearest.radiusKm, radiusKm);
      nearest.ageH = 0;
    } else {
      wakePatches.push({
        lat: atLat,
        lon: atLon,
        coolingC: added,
        radiusKm: Math.max(45, radiusKm),
        ageH: 0,
      });
    }
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
    wakePatches = [];
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
    const initialEnv = sampleEnv(lat, lon, initialTFrac);
    organizationTargetValue = organizationTarget(
      initialEnv,
      initialEnv.sstC,
      prevOverLand,
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
      sstC: initialEnv.sstC,
      shearMs: initialEnv.shear,
      midlevelRhPct: initialEnv.midlevelRhPct,
      ohcKjCm2: initialEnv.ohcKjCm2,
      organization,
      overLand: prevOverLand,
      lat,
      lon,
      monthIndex,
      ageH,
    });
    updateDiagnostics(initialEnv, initialEnv.sstC, prevOverLand, initialTerms);
    const initialMotion = motionAt(lat, lon, initialTFrac);
    structure = deriveStormStructure({
      vKt,
      lat,
      lon,
      shearMs: initialEnv.shear,
      shearUms: initialEnv.shearU,
      shearVms: initialEnv.shearV,
      overLand: prevOverLand,
      motionUms: initialMotion.u,
      motionVms: initialMotion.v,
    });
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

    // 1) Advance the wander ONCE per tick (2 draws) — used for both RK2 stages.
    if (stochasticWander) {
      pu +=
        (rng.next() * 2 - 1) * SIM.WANDER_STEP_MS -
        pu * SIM.WANDER_REVERT;
      pv +=
        (rng.next() * 2 - 1) * SIM.WANDER_STEP_MS -
        pv * SIM.WANDER_REVERT;
    }

    // 2) RK2 (midpoint) position integration, in lat/lon degrees.
    const k1 = motionAt(lat, lon, tFrac);
    const k2 = motionAt(
      lat + (k1.dLat * dtH) / 2,
      lon + (k1.dLon * dtH) / 2,
      tFrac,
    );
    lat = guardFinite(lat + k2.dLat * dtH, 'lat');
    lon = guardFinite(lon + k2.dLon * dtH, 'lon');
    ageH = guardFinite(ageH + dtH, 'ageH');

    // 3) Intensity ODE at the new position.
    const e = sampleEnv(lat, lon, tFrac);
    const overLand = isLand(lat, lon);
    decayWake(dtH);
    coldWakeC = overLand ? 0 : sampleWake(lat, lon);
    const effectiveSstC = e.sstC - coldWakeC;
    organizationTargetValue = organizationTarget(
      e,
      effectiveSstC,
      overLand,
    );
    organization = advanceOrganization(
      organization,
      organizationTargetValue,
      dtH,
    );
    const terms = intensityTerms({
      vKt,
      sstC: effectiveSstC,
      shearMs: e.shear,
      midlevelRhPct: e.midlevelRhPct,
      ohcKjCm2: e.ohcKjCm2,
      organization,
      overLand,
      lat,
      lon,
      monthIndex,
      ageH,
    });
    vKt = guardFinite(Math.max(0, vKt + terms.net * dtH), 'vKt');
    structure = deriveStormStructure({
      vKt,
      lat,
      lon,
      shearMs: e.shear,
      shearUms: e.shearU,
      shearVms: e.shearV,
      overLand,
      motionUms: k2.u,
      motionVms: k2.v,
      previousRmwKm: structure.rmwKm,
      previousOuterSizeKm: structure.outerSizeKm,
      deltaHours: dtH,
    });
    depositWake(
      lat,
      lon,
      e,
      Math.hypot(k2.u, k2.v),
      structure.outerSizeKm,
      dtH,
    );
    updateDiagnostics(e, effectiveSstC, overLand, terms);

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
