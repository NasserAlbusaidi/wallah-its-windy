/**
 * sim.ts — the physics core (eng tasks T2, T6; design steps 4 + D12 seam).
 *
 * A point-vortex storm advected by climatological steering + beta drift + a
 * gentle seeded wander, with a DeMaria–Kaplan intensity ODE. The whole thing is
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
 * EnvSampler (SST/steering/shear) plus an `isLand(lat,lon)` predicate (from the
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
  StormState,
  TrackPoint,
} from './types';
import { DeathReason, MUSCAT } from './types';
import { makeRng } from './rng';
import type { Rng } from './rng';
import { DOMAIN, inBBox, greatCircleKm, windToDegPerHour } from './grid';

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
   * Relaxation rate toward MPI, per hour. Time constant ~83 h: a storm over
   * 30 °C water climbs from spawn to ~85 kt in ~2 sim-days and ~105 kt in
   * ~3 sim-days — "spins up over 2–3 sim days" per the task.
   */
  INTENSIFY_K_PER_H: 0.012,
  /**
   * Deep-layer shear below this (m/s) does no harm. The classic instantaneous
   * onset is ~10 m/s, but env.bin feeds MONTHLY-MEAN-OF-MAGNITUDES ERA5 shear,
   * which is biased high vs the synoptic windows storms actually use (a calm
   * fortnight and a jet fortnight average to "hostile"). Recalibrated against
   * the real fields so the seasonal shape matches climatology: May regimes
   * (median 4-11) intensify freely, June/Oct split by sampled year (14-16
   * marginal vs ~29 lethal), Jul-Aug (18-26) shred everything.
   */
  SHEAR_THRESHOLD_MS: 14,
  /** Weakening per m/s of shear above threshold, kt/h (same recalibration). */
  SHEAR_K_KT_PER_H_PER_MS: 0.45,
  /** Fractional intensity lost per hour over land (rapid decay, ~9 h e-fold). */
  LAND_DECAY_PER_H: 0.1,

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

  // -- v1.1 dry-air seam (eng task T11) — NO-OP in v1.0 ----------------------
  /**
   * Dry-air decay strength. ZERO in v1.0 (the term is a wired no-op). Weekend
   * two sets this > 0 and fills in dryAirPenaltyKtPerH with
   * f(distance-to-Arabian-landmass upwind), tuned against Gonu/Shaheen's real
   * coastal weakening. Kept as a live seam so the ODE shape never changes.
   */
  DRYAIR_K: 0,

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
 * Dry-air intrusion penalty — kt/h. v1.0 NO-OP (returns 0): the seam for eng
 * task T11 (v1.1). Weekend two replaces the body with a distance-to-Arabian-
 * landmass term and sets SIM.DRYAIR_K > 0. Params are the future inputs.
 */
export function dryAirPenaltyKtPerH(_lat: number, _lon: number, _monthIndex: number): number {
  return SIM.DRYAIR_K; // 0 → term contributes nothing until v1.1 tuning.
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
}

/** The four ODE terms plus their net dV/dt (kt/h). Internal — drives attribution. */
function intensityTerms(a: IntensityArgs): {
  relax: number;
  shearPen: number;
  landPen: number;
  dryPen: number;
  net: number;
} {
  // Over land there is no ocean heat source, so MPI collapses to 0 regardless of
  // whatever SST the sampler returns there — the relaxation term then decays V.
  const mpi = a.overLand ? 0 : mpiKt(a.sstC);
  const relax = SIM.INTENSIFY_K_PER_H * (mpi - a.vKt);
  const shearPen = shearPenaltyKtPerH(a.shearMs);
  const landPen = a.overLand ? landDecayKtPerH(a.vKt) : 0;
  const dryPen = dryAirPenaltyKtPerH(a.lat, a.lon, a.monthIndex);
  const net = relax - shearPen - landPen - dryPen;
  return { relax, shearPen, landPen, dryPen, net };
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

  let lat = 0;
  let lon = 0;
  let vKt = 0;
  let ageH = 0;
  let alive = false;

  // wander (steering-velocity perturbation, m/s)
  let pu = 0;
  let pv = 0;

  // death attribution — EMAs of each decay channel's recent contribution
  let recentCold = 0;
  let recentShear = 0;
  let recentLand = 0;

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
    return e;
  }

  /** Instantaneous storm velocity in deg/h at a point (steering+beta+wander). */
  function velDegPerH(atLat: number, atLon: number, tFrac: number): { dLat: number; dLon: number } {
    const e = sampleEnv(atLat, atLon, tFrac);
    const u = e.steerU + beta.u + pu; // m/s eastward
    const v = e.steerV + beta.v + pv; // m/s northward
    return windToDegPerHour(u, v, atLat); // grid.ts owns the cos-lat correction
  }

  function snapshot(): StormState {
    return { lat, lon, vKt, ageH, trackPoints: track, alive, isDemo: demo };
  }

  function recordTrackPoint(): void {
    track.push({ lat, lon, vKt, ageH });
  }

  function reasonFromRecent(): DeathReason {
    const m = Math.max(recentLand, recentShear, recentCold);
    if (m <= 0) return DeathReason.ColdWater; // starved with no clear driver
    if (recentLand === m) return DeathReason.Land;
    if (recentShear === m) return DeathReason.Shear;
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

    rng = makeRng(seed);
    vKt = SIM.SPAWN_VKT;
    ageH = 0;
    alive = true;
    pu = 0;
    pv = 0;
    recentCold = 0;
    recentShear = 0;
    recentLand = 0;
    peakKt = vKt;
    prevVKtForPeak = vKt;
    rising = false;
    prevOverLand = isLand(lat, lon);
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
    const tFrac = clamp01(ageH / SIM.EVENT_TFRAC_HORIZON_H);

    // 1) Advance the wander ONCE per tick (2 draws) — used for both RK2 stages.
    pu += (rng.next() * 2 - 1) * SIM.WANDER_STEP_MS - pu * SIM.WANDER_REVERT;
    pv += (rng.next() * 2 - 1) * SIM.WANDER_STEP_MS - pv * SIM.WANDER_REVERT;

    // 2) RK2 (midpoint) position integration, in lat/lon degrees.
    const k1 = velDegPerH(lat, lon, tFrac);
    const k2 = velDegPerH(lat + (k1.dLat * dtH) / 2, lon + (k1.dLon * dtH) / 2, tFrac);
    lat = guardFinite(lat + k2.dLat * dtH, 'lat');
    lon = guardFinite(lon + k2.dLon * dtH, 'lon');
    ageH = guardFinite(ageH + dtH, 'ageH');

    // 3) Intensity ODE at the new position.
    const e = sampleEnv(lat, lon, tFrac);
    const overLand = isLand(lat, lon);
    const terms = intensityTerms({
      vKt,
      sstC: e.sstC,
      shearMs: e.shear,
      overLand,
      lat,
      lon,
      monthIndex,
    });
    vKt = guardFinite(Math.max(0, vKt + terms.net * dtH), 'vKt');

    // 4) Attribute this tick's weakening to a channel (recent-weighted EMA).
    const coldHere = overLand ? 0 : Math.max(0, -terms.relax);
    const landHere = overLand ? Math.max(0, -terms.relax) + terms.landPen : 0;
    const shearHere = terms.shearPen;
    recentCold = recentCold * SIM.RECENT_DECAY + coldHere;
    recentShear = recentShear * SIM.RECENT_DECAY + shearHere;
    recentLand = recentLand * SIM.RECENT_DECAY + landHere;

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
