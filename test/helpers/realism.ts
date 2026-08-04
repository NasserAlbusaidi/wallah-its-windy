/**
 * realism.ts — synthetic flight-recorder frames for the R2a realism harness.
 *
 * The BT-proxy is a pure function of a FlightFrame, so its tests need frames,
 * not a simulation run. These fixtures satisfy the real FlightFrame contract
 * with no type assertions, so a field the proxy reads can never be silently
 * undefined behind a cast.
 */

import type { FlightFrame } from '../../src/flight-recorder';

/** A mature open-ocean storm frame; override fields per test. */
export function syntheticFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  return {
    ageH: 24, lat: 18, lon: 62, vKt: 80, alive: true, organization: 0.9,
    coldWakeC: 0,
    diagnostics: {
      sstC: 29, effectiveSstC: 29, midlevelRhPct: 60, ohcKjCm2: 60,
      organization: 0.9, organizationTarget: 0.9, coldWakeC: 0,
      mpiKt: 140, steerU: -5, steerV: 2,
      shearMs: 6, shearUms: 4, shearVms: 2,
      ventilationMeanRhPct: 58,
      overLand: false,
      oceanKtPerH: 1.2, shearKtPerH: 0.3, landKtPerH: 0, dryAirKtPerH: 0.2,
      netKtPerH: 0.7,
      eyewallRainMmH: 18, rainbandRainMmH: 8, orographicRainMmH: 0,
      totalRainMmH: 26,
    },
    structure: {
      maximumWindKt: 80, centralPressureHpa: 965, environmentalPressureHpa: 1008,
      rmwKm: 30, outerSizeKm: 220, outerWindScale: 1,
      outerBlendStartWindKt: 34, outerBlendFullWindKt: 64, hollandB: 1.4,
      motionUms: 2, motionVms: 2, translationAsymmetryKt: 4,
      shearUms: 4, shearVms: 2, shearAsymmetryFraction: 0.1,
      rainOffsetEastKm: 10, rainOffsetNorthKm: 5,
      r34Km: { ne: 150, se: 140, sw: 120, nw: 130 },
      r50Km: { ne: 80, se: 75, sw: 60, nw: 70 },
      r64Km: { ne: 40, se: 38, sw: 30, nw: 35 },
    },
    ...overrides,
  };
}

/** A weak, eyeless, disorganized frame (eyeStrength = 0 by construction). */
export function weakFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  return syntheticFrame({
    vKt: 35, organization: 0.3,
    structure: {
      ...syntheticFrame().structure,
      maximumWindKt: 35, rmwKm: 60, outerSizeKm: 180, hollandB: 1.2,
    },
    ...overrides,
  });
}
