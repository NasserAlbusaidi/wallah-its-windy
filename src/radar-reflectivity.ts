/** Presentation-only Marshall–Palmer rain-rate → reflectivity proxy. */

export const RADAR_Z_COEFFICIENT = 200;
export const RADAR_Z_EXPONENT = 1.6;
export const RADAR_DBZ_MIN = 10;
export const RADAR_DBZ_MAX = 65;
export const RADAR_PALETTE_STEPS = 11;
export const RADAR_DBZ_QUANTUM = 5;

/** Six colour knots, one for each radar token (`radar0` … `radar5`). */
export const RADAR_DBZ_STOPS = [10, 20, 30, 40, 50, 65] as const;

export function radarLegendText(): string {
  return `${RADAR_DBZ_STOPS.slice(0, -1).join(' · ')} · ${RADAR_DBZ_STOPS.at(-1)}+ dBZ proxy`;
}

/** CSS gradient derived from the same physical stops as the GLSL palette. */
export function radarCssGradient(): string {
  const span = RADAR_DBZ_MAX - RADAR_DBZ_MIN;
  const stops = RADAR_DBZ_STOPS.map((dbz, index) => {
    const percentage = ((dbz - RADAR_DBZ_MIN) / span) * 100;
    return `var(--radar-${index}) ${percentage.toFixed(3)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * Presentation-only sub-grid support transfer. Colour remains the unmodified
 * shared rain-rate dBZ; alpha indicates the fraction of each broad parametric
 * rainband cell occupied by resolved-looking echoes. This avoids presenting a
 * smooth full-annulus proxy as observed-looking solid precipitation.
 */
export const RADAR_ARM_SUPPORT_LO = 0.76;
export const RADAR_ARM_SUPPORT_HI = 0.96;
export const RADAR_CELL_SUPPORT_LO_WEAK = 0.62;
export const RADAR_CELL_SUPPORT_LO_ORGANIZED = 0.48;
export const RADAR_CELL_SUPPORT_WIDTH = 0.18;
export const RADAR_COVERAGE_FLOOR = 0.06;
export const RADAR_STRONG_ECHO_DBZ_LO = 36;
export const RADAR_STRONG_ECHO_DBZ_HI = 48;
export const RADAR_STRONG_ECHO_COVERAGE_FLOOR = 0.72;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

/** CPU mirror of the simulated-radar band alpha contract embedded in GLSL. */
export function radarBandCoverage(
  spiral: number,
  cellular: number,
  organization: number,
  shearAsymmetry: number,
  dbz: number,
): number {
  const organized = clamp01(organization);
  const cellLo =
    RADAR_CELL_SUPPORT_LO_WEAK * (1 - organized) +
    RADAR_CELL_SUPPORT_LO_ORGANIZED * organized;
  const armSupport = smoothstep(
    RADAR_ARM_SUPPORT_LO,
    RADAR_ARM_SUPPORT_HI,
    spiral,
  );
  const cellSupport = smoothstep(
    cellLo,
    cellLo + RADAR_CELL_SUPPORT_WIDTH,
    cellular,
  );
  const fragmented =
    RADAR_COVERAGE_FLOOR +
    (1 - RADAR_COVERAGE_FLOOR) *
      armSupport * cellSupport * clamp01(shearAsymmetry);
  const strongEchoFloor =
    RADAR_STRONG_ECHO_COVERAGE_FLOOR *
    smoothstep(RADAR_STRONG_ECHO_DBZ_LO, RADAR_STRONG_ECHO_DBZ_HI, dbz);
  return Math.max(fragmented, strongEchoFloor);
}

export function rainRateToDbz(rainRateMmH: number): number {
  if (!Number.isFinite(rainRateMmH) || rainRateMmH <= 0.01) return 0;
  return 10 * Math.log10(
    RADAR_Z_COEFFICIENT * rainRateMmH ** RADAR_Z_EXPONENT,
  );
}

export function normalizeRadarDbz(dbz: number): number {
  if (!Number.isFinite(dbz)) return 0;
  return Math.max(
    0,
    Math.min(1, (dbz - RADAR_DBZ_MIN) / (RADAR_DBZ_MAX - RADAR_DBZ_MIN)),
  );
}

export function quantizeRadarNormalized(normalized: number): number {
  const value = Math.max(0, Math.min(1, normalized));
  return Math.floor(value * RADAR_PALETTE_STEPS + 0.5) /
    RADAR_PALETTE_STEPS;
}

export function quantizeRadarDbz(dbz: number): number {
  const bounded = Math.max(RADAR_DBZ_MIN, Math.min(RADAR_DBZ_MAX, dbz));
  return Math.max(
    RADAR_DBZ_MIN,
    Math.min(
      RADAR_DBZ_MAX,
      RADAR_DBZ_MIN +
        Math.round((bounded - RADAR_DBZ_MIN) / RADAR_DBZ_QUANTUM) *
          RADAR_DBZ_QUANTUM,
    ),
  );
}
