/**
 * realism.ts — synthetic flight-recorder frames for the R2a realism harness.
 *
 * The BT-proxy is a pure function of a FlightFrame, so its tests need frames,
 * not a simulation run. These fixtures satisfy the real FlightFrame contract
 * with no type assertions, so a field the proxy reads can never be silently
 * undefined behind a cast.
 *
 * Every frame is internally self-consistent: a quantity carried in two places
 * (frame.organization vs diagnostics.organization, shearMs vs the shear vector,
 * vKt vs structure.maximumWindKt and its pressure/radii) holds the SAME value.
 * A proxy metric must produce the same answer whichever field it happens to
 * read, or a test asserting "weak storm ⇒ X" can pass for the wrong reason.
 */

import type { FlightFrame } from '../../src/flight-recorder';

/**
 * A mature open-ocean storm frame; override fields per test.
 *
 * `overrides` is a SHALLOW top-level merge: passing `{ vKt }` does not update
 * `diagnostics` or `structure`. Override those objects explicitly (as
 * weakFrame does) whenever the intensity changes, or the frame contradicts
 * itself.
 */
export function syntheticFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  return {
    ageH: 24, lat: 18, lon: 62, vKt: 80, alive: true, organization: 0.9,
    coldWakeC: 0,
    diagnostics: {
      sstC: 29, effectiveSstC: 29, midlevelRhPct: 60, ohcKjCm2: 60,
      organization: 0.9, organizationTarget: 0.9, coldWakeC: 0,
      mpiKt: 140, steerU: -5, steerV: 2,
      // hypot(4.8, 3.6) === 6 exactly, so the scalar and the vector agree.
      shearMs: 6, shearUms: 4.8, shearVms: 3.6,
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
      shearUms: 4.8, shearVms: 3.6, shearAsymmetryFraction: 0.1,
      rainOffsetEastKm: 10, rainOffsetNorthKm: 5,
      r34Km: { ne: 150, se: 140, sw: 120, nw: 130 },
      r50Km: { ne: 80, se: 75, sw: 60, nw: 70 },
      r64Km: { ne: 40, se: 38, sw: 30, nw: 35 },
    },
    ...overrides,
  };
}

/**
 * A weak, disorganized 35 kt frame — the low-intensity end of the range.
 *
 * Below hurricane force by construction, so the 50 kt and 64 kt radii are
 * zero and the core is shallow (1000 hPa against a 1008 hPa environment,
 * the Holland deficit for 35 kt at B = 1.2). Whether Task 4's eye term
 * evaluates to exactly 0 here is for that task's own tests to assert — this
 * fixture supplies a weak storm, it does not establish an eye result.
 */
export function weakFrame(overrides: Partial<FlightFrame> = {}): FlightFrame {
  const base = syntheticFrame();
  return syntheticFrame({
    vKt: 35, organization: 0.3,
    diagnostics: {
      ...base.diagnostics,
      organization: 0.3, organizationTarget: 0.3,
      oceanKtPerH: 0.6, shearKtPerH: 0.3, landKtPerH: 0, dryAirKtPerH: 0.2,
      netKtPerH: 0.1,
      eyewallRainMmH: 6, rainbandRainMmH: 3, orographicRainMmH: 0,
      totalRainMmH: 9,
    },
    structure: {
      ...base.structure,
      maximumWindKt: 35, rmwKm: 60, outerSizeKm: 180, hollandB: 1.2,
      centralPressureHpa: 1000,
      r34Km: { ne: 70, se: 65, sw: 50, nw: 55 },
      r50Km: { ne: 0, se: 0, sw: 0, nw: 0 },
      r64Km: { ne: 0, se: 0, sw: 0, nw: 0 },
    },
    ...overrides,
  });
}
