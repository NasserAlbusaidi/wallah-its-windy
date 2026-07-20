/**
 * rng.ts — deterministic seeded randomness + shareable-storm URL hash.
 *
 * The sim is a pure function of (spawn, month, seed). All randomness flows
 * through a mulberry32 stream seeded from the spawn params, so the same URL
 * hash always replays the same storm. Never call Math.random() in sim code.
 */

/**
 * mulberry32 — a fast, tiny, well-distributed 32-bit PRNG. Given the same seed
 * it always yields the same sequence of floats in [0,1). Public-domain algorithm.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small stateful RNG bundle for sim convenience, all derived from one seed. */
export interface Rng {
  /** Next float in [0,1). */
  next(): number;
  /** Next float in [min,max). */
  range(min: number, max: number): number;
  /** Next integer in [min,max] inclusive. */
  int(min: number, max: number): number;
  /** The seed this stream was created from. */
  readonly seed: number;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    seed: seed >>> 0,
  };
}

/** A fresh non-deterministic seed for a brand-new user storm (before it's shared). */
export function randomSeed(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0;
}

// ---------------------------------------------------------------------------
// URL hash: shareable storms
// ---------------------------------------------------------------------------

/**
 * The scenario env keys the URL hash recognises (C8). This is the ONE coupling
 * point between the hash and the scenario catalogue: a shared URL carrying
 * `env=<key>` replays that historic event's env; any other value (or absence) is
 * climatology. Kept as a fixed known set here so readHash can validate without
 * importing the (async-loaded) scenario list. Must stay in sync with the scenario
 * ids in data/scenarios.json.
 */
export const ENV_HASH_KEYS = ['gonu', 'shaheen'] as const;
export type EnvHashKey = (typeof ENV_HASH_KEYS)[number];
const ENV_HASH_SET: ReadonlySet<string> = new Set(ENV_HASH_KEYS);

/** True when `v` is a recognised scenario env key (validated, tolerant of garbage). */
export function isEnvHashKey(v: string | null | undefined): v is EnvHashKey {
  return v != null && ENV_HASH_SET.has(v);
}

/** The reproducible identity of a storm, round-tripped through the URL hash. */
export interface HashState {
  lat: number;
  lon: number;
  /** 0=Jan..11=Dec. */
  monthIndex: number;
  seed: number;
  /**
   * Optional scenario env key (one of {@link ENV_HASH_KEYS}); absent = climatology.
   * Legacy shared URLs lack it entirely and must keep replaying as climatology.
   */
  env?: EnvHashKey;
}

/**
 * Parse the URL hash (e.g. "#lat=18.2&lon=63.5&month=5&seed=12345") into a
 * HashState, or null if any field is missing or unparseable. Tolerant of extra
 * keys and ordering; never throws.
 */
export function readHash(hash: string = location.hash): HashState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const latS = p.get('lat');
  const lonS = p.get('lon');
  const monthS = p.get('month');
  const seedS = p.get('seed');
  const envS = p.get('env');
  // Every field must be present — Number(null) is 0, so absent keys would
  // otherwise slip through as a bogus (0,0,Jan,0) storm.
  if (latS === null || lonS === null || monthS === null || seedS === null) return null;
  const lat = Number(latS);
  const lon = Number(lonS);
  const monthIndex = Number(monthS);
  const seed = Number(seedS);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isInteger(monthIndex) ||
    !Number.isFinite(seed)
  ) {
    return null;
  }
  // OPTIONAL scenario key: never part of the required-presence check above, so a
  // legacy `#lat=..&lon=..&month=..&seed=..` URL still parses as climatology. An
  // unknown/garbage value is ignored (validated against the known set).
  const env = isEnvHashKey(envS) ? envS : undefined;
  const state: HashState = { lat, lon, monthIndex, seed: seed >>> 0 };
  if (env) state.env = env;
  return state;
}

/** Serialize a HashState into the URL fragment (without leading '#'). */
export function encodeHash(state: HashState): string {
  const p = new URLSearchParams({
    lat: state.lat.toFixed(3),
    lon: state.lon.toFixed(3),
    month: String(state.monthIndex),
    seed: String(state.seed >>> 0),
  });
  // The scenario key is appended LAST and ONLY for a recognised non-climatology
  // value, so a plain storm serialises to the exact legacy string — existing
  // shared URLs stay byte-identical and no climatology storm churns its hash.
  if (isEnvHashKey(state.env)) p.set('env', state.env);
  return p.toString();
}

/**
 * Write the storm identity into the address bar without adding a history entry,
 * so copying the URL shares this exact storm.
 */
export function writeHash(state: HashState): void {
  const next = `#${encodeHash(state)}`;
  history.replaceState(null, '', next);
}
