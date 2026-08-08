/**
 * Decorative cloud-motion contract for the simulated IR layer.
 *
 * Owns the constants and scalar math the env fragment shader embeds via
 * template literals, plus CPU mirrors that vitest can pin — the suite has no
 * GL harness, so the GLSL sampling itself is browser-verified. Rain-aligned
 * geometry (precipitating-cloud.ts, RAINBAND_SPIRAL_ROTATION_PER_H) is a
 * separate contract and deliberately not touched here.
 */

import { HALF_DOMAIN_HEIGHT_KM, RENDER_RADIUS_FLOOR } from './storm-radii';

/**
 * Display cap on cloud angular velocity, rad/sim-hour. PERCEPTION CAP, NOT
 * PHYSICS: a real eyewall (~4-5 rad/sim-h) at the 3 h/s playback timescale
 * would display above two revolutions per second and alias into blur. 0.3
 * gives an eyewall lap of ~7 screen-seconds — halved from the design's 0.6
 * after hardware-GL review judged that lap rate too fast to read as clouds.
 */
export const CLOUD_ROTATION_CAP_RAD_PER_H = 0.3;

/**
 * Flow-map sawtooth period, sim-hours. Bounds differential twist per phase to
 * cap x period = 0.45 rad so the advected noise never winds into filaments.
 * Tunable in [0.5, 1.5] against crossfade shimmer during browser QA; the
 * spec's bounded-distortion intent (<= ~1 rad) must hold.
 */
export const CLOUD_CROSSFADE_PERIOD_H = 0.75;

/** Band-pattern solid-body reference radius, in rMax units (spec: 2.5). */
export const CLOUD_BAND_REFERENCE_Q = 2.5;

/**
 * Cellular rainband presentation (RGR-004). A multiscale cloud-noise sample
 * resolves roughly 35-70 km structures without exposing a single underlying
 * value-noise lattice. The radial transition follows the observed inner/outer
 * band regime break near 200 km.
 * These constants change only simulated cloud presentation; rain support and
 * the physical rain footprint remain owned by rainband-profile.ts.
 */
export const CLOUD_BAND_CELL_SCALE = 12;
export const CLOUD_BAND_CELL_GATE_LO = 0.54;
export const CLOUD_BAND_CELL_GATE_HI = 0.66;
export const CLOUD_BAND_CELL_RIGHT_BONUS = 0.03;
export const CLOUD_BAND_CELL_PRESENCE_GAIN = 2.2;
export const CLOUD_BAND_CELL_LEFT_RETENTION = 0.35;
export const CLOUD_BAND_CELL_RIGHT_GAIN = 1.35;
export const CLOUD_BAND_CELL_SHEAR_ORGANIZATION_LO_MS = 7;
export const CLOUD_BAND_CELL_SHEAR_ORGANIZATION_HI_MS = 15;
export const CLOUD_BAND_REGIME_INNER_KM = 170;
export const CLOUD_BAND_REGIME_OUTER_KM = 230;
export const CLOUD_BAND_OUTER_STRATIFORM_FLOOR = 0;
export const CLOUD_BAND_OUTER_CELL_GAIN = 6;
/** Maximum cold-cell versus warm-stratiform BT separation. */
export const CLOUD_BAND_THERMAL_CONTRAST_DEVELOPING_C = 14;
export const CLOUD_BAND_THERMAL_CONTRAST_MATURE_C = 22;

/**
 * Weak-stage convective-burst morphology (RGR-006).
 *
 * The developing CDO used to be the mature radial shield scaled down, which
 * produced a centred bullseye before a storm had organized one. The gates
 * below combine an unconditional weak-wind gate with an organization gate
 * that is capped by intensity. The complex is therefore fully active through
 * 40 kt and exactly off at 55 kt, preserving the accepted R3 moderate/mature
 * field bit-for-bit. The activity gate is separate so a dissipated low-rain
 * vortex keeps only a faint remnant carrier rather than being redrawn as fresh
 * genesis convection.
 */
export const CLOUD_WEAK_BURST_ORGANIZATION_GATE_LO = 0.32;
export const CLOUD_WEAK_BURST_ORGANIZATION_GATE_HI = 0.55;
export const CLOUD_WEAK_BURST_INTENSITY_GATE_LO = 0.2;
export const CLOUD_WEAK_BURST_INTENSITY_GATE_HI = 0.3;
export const CLOUD_WEAK_BURST_DISORGANIZED_INTENSITY_GATE_LO = 0.3;
export const CLOUD_WEAK_BURST_DISORGANIZED_INTENSITY_GATE_HI = 0.35;
export const CLOUD_WEAK_BURST_ACTIVITY_LO = 0.1;
export const CLOUD_WEAK_BURST_ACTIVITY_HI = 0.23;
export const CLOUD_WEAK_RAINBAND_RETENTION = 0.12;
export const CLOUD_WEAK_WARM_BAND_THERMAL_RETENTION = 0.2;
export const CLOUD_WEAK_COLD_BAND_THERMAL_RETENTION = 0.06;

function smoothUnit(lo: number, hi: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** CPU pin for the exact weakMorphology expression emitted in env.ts. */
export function weakBurstMorphologyWeight(
  intensity: number,
  organization: number,
): number {
  const weakWind =
    1 -
    smoothUnit(
      CLOUD_WEAK_BURST_INTENSITY_GATE_LO,
      CLOUD_WEAK_BURST_INTENSITY_GATE_HI,
      intensity,
    );
  const weakDisorganization =
    1 -
    smoothUnit(
      CLOUD_WEAK_BURST_ORGANIZATION_GATE_LO,
      CLOUD_WEAK_BURST_ORGANIZATION_GATE_HI,
      organization,
    );
  const disorganizationIntensityCeiling =
    1 -
    smoothUnit(
      CLOUD_WEAK_BURST_DISORGANIZED_INTENSITY_GATE_LO,
      CLOUD_WEAK_BURST_DISORGANIZED_INTENSITY_GATE_HI,
      intensity,
    );
  return Math.max(
    weakWind,
    weakDisorganization * disorganizationIntensityCeiling,
  );
}

/**
 * Overshooting-top lifecycle period, sim-hours. Real tops live ~30 min, which
 * is sub-second at 3 h/s; the stretch is a display-honesty compromise covered
 * by the layer's "simulated" label.
 */
export const CLOUD_PULSE_PERIOD_H = 2;

/** Pre-change solid-body rate, kept verbatim for the reduced-motion path. */
export const LEGACY_CLOUD_ROTATION_RAD_PER_H = 0.028;

/** Debris cloud-top grading, deg C — warmer than fresh bands (-45..-62). */
export const DEBRIS_TOP_WARM_C = -28;
export const DEBRIS_TOP_COLD_C = -45;

/**
 * Environmental-deck moisture window (RGR-001). rhDrive is the deck's month
 * and space signal — a smoothstep over the baked mid-level RH plane, which
 * already carries the monsoon-vs-post-monsoon contrast the register demands.
 * Below LO a column reads post-monsoon dry (sparse shallow cumulus only);
 * above HI it reads monsoon moist (patch decks and congestus clusters).
 *
 * ANCHORED TO THE BAKED PLANES, NOT LITERATURE RH: env.bin's monthly-mean
 * mid-level RH over ocean spans ~0.08-0.65 (May p50 0.24, Jul p50 0.45,
 * Kyarr's October event plane p50 0.13) — monthly means sit far below
 * instantaneous sounding values, exactly the SHEAR_THRESHOLD_MS lesson in
 * src/sim.ts. Moving the env source to daily/hourly fields re-opens these
 * two constants.
 */
export const AMBIENT_RH_DRIVE_LO = 0.16;
export const AMBIENT_RH_DRIVE_HI = 0.52;

/**
 * Environmental cloud-top grading, deg C. Shallow marine cumulus stays warm
 * (it reads as VIS texture, not cold IR shield); congestus claims mid-cold
 * tops only in moist columns; veils sit high but thin. The congestus floor
 * must stay far above the -60 C realism cold-top mask
 * (REALISM_COLD_TOP_C in src/realism-metrics.ts) so the environment can never
 * masquerade as storm canopy in the RGR-003/006/013 metrics.
 */
export const AMBIENT_TOP_CUMULUS_WARM_C = -2;
export const AMBIENT_TOP_CUMULUS_COLD_C = -16;
export const AMBIENT_TOP_CONGESTUS_WARM_C = -26;
export const AMBIENT_TOP_CONGESTUS_COLD_C = -52;
export const AMBIENT_TOP_VEIL_C = -40;

/**
 * Interpolated decorative cloud age for u_cloudAgeH. Raw fixed-frame ageH
 * jumps 0.25 h per tick — up to 0.15 rad at the cap — and visibly stutters.
 * Runs monotonically forward: a respawn (prev age ahead of the new storm's)
 * snaps to the new age instead of interpolating backwards.
 */
export function interpolatedCloudAgeH(
  prevAgeH: number | null,
  ageH: number,
  alpha: number,
): number {
  if (prevAgeH === null || !Number.isFinite(prevAgeH) || prevAgeH > ageH) {
    return ageH;
  }
  const clamped = Math.min(1, Math.max(0, alpha));
  return prevAgeH + (ageH - prevAgeH) * clamped;
}

/** East-west metric correction shared by env and cloud-memory uploads. */
export function cloudMetricX(latitude: number): number {
  return (20 * Math.cos((latitude * Math.PI) / 180)) / 12;
}

/** Deterministic genesis-point seed shared by env and cloud-memory uploads. */
export function cloudSeedFromGenesis(
  genesis: { lat: number; lon: number } | null | undefined,
): number {
  const seedWave = genesis
    ? Math.sin(genesis.lon * 12.9898 + genesis.lat * 78.233) * 43758.5453
    : 0.417;
  return seedWave - Math.floor(seedWave);
}

/**
 * Holland-profile angular rate at radius rKm, rad/sim-hour, display-capped.
 * 3.6 converts m/s to km/h; radii floor at 1 km to guard the singularity.
 */
export function cloudAngularRateRadPerH(
  rKm: number,
  rmwKm: number,
  vmaxMs: number,
  hollandB: number,
): number {
  if (rKm <= 0) return CLOUD_ROTATION_CAP_RAD_PER_H;
  const r = Math.max(rKm, 1);
  const x = Math.min(80, (Math.max(rmwKm, 1) / r) ** hollandB);
  const vMs = vmaxMs * Math.sqrt(Math.max(0, x * Math.exp(1 - x)));
  return Math.min((3.6 * vMs) / r, CLOUD_ROTATION_CAP_RAD_PER_H);
}

/**
 * cloudAngularRateRadPerH with metric-clip inputs — the exact mirror of the
 * GLSL cloudOmega(), including the shared 666-km half-domain conversion.
 */
export function cloudAngularRateAtClipRadius(
  rUnits: number,
  rmwUnits: number,
  vmaxMs: number,
  hollandB: number,
): number {
  return cloudAngularRateRadPerH(
    rUnits * HALF_DOMAIN_HEIGHT_KM,
    rmwUnits * HALF_DOMAIN_HEIGHT_KM,
    vmaxMs,
    hollandB,
  );
}

/**
 * Two-phase flow-map state. Triangle weights sum to one and each phase has
 * exactly zero weight at its own sawtooth reset, so neither the field nor its
 * brightness pops at a phase boundary.
 */
export function flowPhaseState(cloudAgeH: number): {
  phaseA: number;
  phaseB: number;
  weightA: number;
  weightB: number;
} {
  const t = cloudAgeH / CLOUD_CROSSFADE_PERIOD_H;
  const phaseA = t - Math.floor(t);
  const tB = t + 0.5;
  const phaseB = tB - Math.floor(tB);
  const weightA = 1 - Math.abs(2 * phaseA - 1);
  return { phaseA, phaseB, weightA, weightB: 1 - weightA };
}

/**
 * GLSL for the motion model, embedded by env.ts's fragment shader. Lives here
 * so the constants, their CPU mirrors, and the shader code cannot drift apart
 * (and so env.ts stays under the 800-line cap).
 */
export const CLOUD_MOTION_GLSL = /* glsl */ `
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Holland-profile angular rate at a metric-clip radius, rad/sim-hour, capped
// for display. Mirrors cloudAngularRateRadPerH in cloud-motion.ts exactly.
float cloudOmega(float rUnits) {
  float rKm = max(rUnits * ${HALF_DOMAIN_HEIGHT_KM}.0, 1.0);
  float rmwKm = max(u_rMax, ${RENDER_RADIUS_FLOOR}) * ${HALF_DOMAIN_HEIGHT_KM}.0;
  float x = min(80.0, pow(max(rmwKm, 1.0) / rKm, u_hollandB));
  float vMs = u_vmaxMs * sqrt(max(0.0, x * exp(1.0 - x)));
  // 3.6: m/s -> km/h. min(): perception cap, not physics -- see cloud-motion.ts.
  return min(3.6 * vMs / rKm, ${CLOUD_ROTATION_CAP_RAD_PER_H});
}
`;

/**
 * GLSL for inner-core irregularity, split across two documented sampleCloud()
 * splice points so env.ts stays below its 800-line cap:
 * - wobble: immediately after `float q = length(radial) / rMax;`; defines
 *   coreAzimuth and qCore for the later eyewall and eye terms.
 * - eyewall: immediately after coreCloud, once moisture, rainEnergy,
 *   convectiveCells, eyewallMaturity, canopyDir, shearDir, and shearN are in
 *   scope; defines the final mesovortex/shear-modulated eyewallCloud consumed
 *   by the cloud-top presence ladder.
 */
export const CLOUD_CORE_GLSL = {
  wobble: /* glsl */ `
  // Azimuthal wobble: sin-composed pseudo-noise (zero texture cost, periodic
  // by construction). Weak/organizing storms are ragged; mature storms round.
  float coreAzimuth = atan(radial.y, radial.x);
  float wobble = 0.6 * sin(3.0 * coreAzimuth + u_cloudSeed * 37.7) +
    0.4 * sin(5.0 * coreAzimuth + u_cloudSeed * 61.3);
  float wobbleAmp = mix(0.20, 0.05, smoothstep(0.38, 0.85, u_organization));
  float qCore = q * (1.0 + wobbleAmp * wobble);
`,
  eyewall: /* glsl */ `
  // Mesovortex lumps churn at the capped core rate; static under reduced
  // motion. Wavenumber 5 sits in the observed 4-6 range.
  float mesoTheta = animGate * ${CLOUD_ROTATION_CAP_RAD_PER_H} * u_cloudAgeH;
  float meso = 1.0 + 0.24 * eyewallMaturity *
    sin(5.0 * (coreAzimuth - mesoTheta) + u_cloudSeed * 17.9);
  // Downshear-left enhancement (documented wavenumber-1 structure). Gated off
  // when the shear vector is too weak to define a direction -- the fallback
  // shearDir is decorative and must not masquerade as a physical signal.
  float hasShearDir = step(0.05, length(u_shearVector));
  float dsl = max(0.0, dot(canopyDir, vec2(-shearDir.y, shearDir.x)));
  float dslBoost = 1.0 + 0.22 * shearN * hasShearDir * dsl;
  float eyewallCloud = eyewall * meso * dslBoost * eyewallMaturity *
    mix(0.48, 1.0, rainEnergy) * mix(0.28, 1.0, convectiveCells);
`,
} as const;

/**
 * Component cloud-top grading endpoints, deg C. Exported so the R2a realism
 * BT-proxy (src/realism-proxy.ts) measures with the exact temperatures the
 * shader renders. The GLSL splice below must keep the emitted text
 * byte-identical (digest-pinned by test/cloud-motion.test.ts).
 */
export const CLOUD_TOP_CDO_DEVELOPING_C = -65;
export const CLOUD_TOP_CDO_MATURE_C = -82;
export const CLOUD_TOP_BAND_DEVELOPING_C = -45;
export const CLOUD_TOP_BAND_MATURE_C = -62;
export const CLOUD_TOP_CIRRUS_WARM_C = -35;
export const CLOUD_TOP_CIRRUS_COLD_C = -48;

/**
 * GLSL for component-graded cloud tops and deterministic overshooting-top
 * pulses. env.ts must splice this inside sampleCloud() immediately after the
 * surfaceC/ambientTopC declarations: it intentionally references that
 * function's Task 2 motion locals and cloud-component geometry in place,
 * including memDensity, memAge, and u_hasCloudMemory.
 */
export const CLOUD_TOPS_GLSL = /* glsl */ `
  // Component-graded cloud tops: warmest first, coldest mixed last so a cold
  // tower is never averaged back toward a warmer underlying band.
  float cdoTopC = mix(${CLOUD_TOP_CDO_DEVELOPING_C.toFixed(1)}, ${CLOUD_TOP_CDO_MATURE_C.toFixed(1)}, development);
  // The broad shield is not one isothermal slab. Embedded advected cells keep
  // the physical CDO top while the intercell/stratiform canopy is warmer.
  float localCdoTopC = cdoTopC + mix(6.0, 12.0, development) *
    (1.0 - cellularColdTops);
  float bandTopC = mix(${CLOUD_TOP_BAND_DEVELOPING_C.toFixed(1)}, ${CLOUD_TOP_BAND_MATURE_C.toFixed(1)}, development);
  // Broad stratiform band cloud stays visible, but only embedded cells claim
  // the established cold band-top grade. The one-sided warm offset keeps the
  // base cell grade bounded by bandTopC; the later tower pass may still add a
  // rare, physically plausible overshoot.
  float warmBandTopC = bandTopC + mix(
    ${CLOUD_BAND_THERMAL_CONTRAST_DEVELOPING_C.toFixed(1)},
    ${CLOUD_BAND_THERMAL_CONTRAST_MATURE_C.toFixed(1)},
    development
  );
  float organizedCirrusTopC = mix(${CLOUD_TOP_CIRRUS_WARM_C.toFixed(1)}, ${CLOUD_TOP_CIRRUS_COLD_C.toFixed(1)}, u_organization);
  // Weak broad anvils carry a mid-cold top around the embedded deeper bursts.
  // The carrier follows lifecycle/rain activity and never claims the CDO's
  // mature -65..-82 C grade.
  float weakBurstAnvilTopC = mix(-34.0, -39.0, weakBurstCarrierActivity);
  float weakBurstMidTopC = mix(-44.0, -49.0, weakBurstCarrierActivity);
  float cirrusTopC = mix(
    organizedCirrusTopC,
    weakBurstAnvilTopC,
    weakMorphology
  );

  // Overshooting tops: deterministic per-cell pulses. Cell identity comes from
  // the advected storm-relative coordinate + seed; the lifecycle reads the
  // interpolated cloud age, never wall time. Each cell's cycle is offset so
  // cells never reseed together, and the sin^2 envelope is zero at both
  // lifecycle boundaries, so reseeds cannot pop.
  vec2 otCell = floor(pA * 6.0);
  float otOffset = hash21(otCell * 1.73 + seed * 291.7);
  float otCycle = u_cloudAgeH / ${CLOUD_PULSE_PERIOD_H.toFixed(1)} + otOffset;
  float otStrength = hash21(otCell * 2.61 + floor(otCycle) * 7.31);
  float otEnv = sin(3.14159265 * fract(otCycle));
  otEnv *= otEnv;
  // Reduced motion: no transient cycling -- hold a constant mid-envelope.
  otEnv = mix(0.5, otEnv, animGate);
  float overshootC = mix(8.0, 14.0, otStrength) * otEnv *
    smoothstep(0.55, 0.80, convectiveCells) *
    smoothstep(0.30, 0.80, rainEnergy);

  // Presence ladder (tuning constants: how strongly each component claims the
  // column before opacity compositing).
  float cirrusPresence = clamp(cirrus * 2.6, 0.0, 1.0);
  float weakBurstMidPresence = clamp(
    weakBurstMidThermal * 1.34 * weakMorphology,
    0.0,
    1.0
  );
  float bandSource = max(rainbands, precipBandCloud);
  // Outer bands are sparser and more cell-dominant: retain a small warm cloud
  // fringe between cells, but concentrate the thermal signature around the
  // convective gate. Raw precipitating-cloud opacity remains unchanged.
  float outerWarmRetention = mix(
    1.0,
    mix(
      ${CLOUD_BAND_OUTER_STRATIFORM_FLOOR.toFixed(1)},
      1.0,
      bandCellGate * bandCellGate
    ),
    outerBandRegime
  );
  float weakWarmBandThermalGate = mix(
    1.0,
    ${CLOUD_WEAK_WARM_BAND_THERMAL_RETENTION.toFixed(2)},
    weakMorphology
  );
  float weakColdBandThermalGate = mix(
    1.0,
    ${CLOUD_WEAK_COLD_BAND_THERMAL_RETENTION.toFixed(2)},
    weakMorphology
  );
  float bandPresence = clamp(
    bandSource * outerWarmRetention * 1.45 * weakWarmBandThermalGate,
    0.0,
    1.0
  );
  float coldBandCellPresence = clamp(
    bandSource * organizedBandCell * ${CLOUD_BAND_CELL_PRESENCE_GAIN.toFixed(1)} *
      mix(1.0, ${CLOUD_BAND_OUTER_CELL_GAIN.toFixed(1)}, outerBandRegime) *
      weakColdBandThermalGate,
    0.0,
    1.0
  );
  float corePresence = clamp(mix(
    organizedCoreCloud * 1.28,
    weakBurstThermalCore * 1.36,
    weakMorphology
  ), 0.0, 1.0);
  float towerCell = smoothstep(0.58, 0.86, fine);
  float organizedTowerSource = max(eyewallCloud, precipColdCloud);
  float weakTowerSource = weakBurstThermalCore * convectiveCells;
  float towerPresence = clamp(mix(
    organizedTowerSource,
    weakTowerSource,
    weakMorphology
  ) * 1.1, 0.0, 1.0) *
    towerCell * towerCell;

  float topC = ambientTopC;
  float debrisTopC = mix(${DEBRIS_TOP_WARM_C.toFixed(1)}, ${DEBRIS_TOP_COLD_C.toFixed(1)},
    1.0 - memAge);
  float debrisPresence = clamp(memDensity * 1.3, 0.0, 1.0) * u_hasCloudMemory;
  topC = mix(topC, debrisTopC, debrisPresence);
  topC = mix(topC, cirrusTopC, cirrusPresence);
  topC = mix(
    topC,
    min(topC, weakBurstMidTopC),
    weakBurstMidPresence
  );
  // Warm stratiform cloud must not warm colder cirrus already above it. A
  // second, cell-gated pass gives optically deeper embedded towers the cold
  // band-top floor without punching holes in the broad cloud shield.
  topC = mix(topC, min(topC, warmBandTopC), bandPresence);
  topC = mix(topC, min(topC, bandTopC), coldBandCellPresence);
  topC = mix(topC, localCdoTopC, corePresence);
  topC = mix(topC, min(topC, localCdoTopC) - overshootC, towerPresence);

  float brightnessC = mix(surfaceC, ambientTopC, ambientCloud);
  brightnessC = mix(brightnessC, topC, stormCloud);
  brightnessC = mix(brightnessC, surfaceC - 4.0, eye * eyeStrength * u_stormPresence);
`;

/**
 * GLSL for visible-palette relief shading. env.ts must splice this inside
 * sampleCloud() immediately after CLOUD_TOPS_GLSL and before the CloudField
 * constructor: it intentionally references that function's advected noise and
 * CDO-envelope locals in place.
 */
export const CLOUD_RELIEF_GLSL = /* glsl */ `
  // Visible-palette relief: Lambert shading from a height proxy. Two raw
  // broad-channel taps give the noise gradient; the CDO envelope derivative
  // is analytic. Detail tier + visible palette only (budget: +2 lookups).
  float relief = 1.0;
  if (u_mode == 1 && u_satellitePalette == 2 && u_cloudDetail > 0.5) {
    vec2 noiseP = (pA * 0.62 + drift + seed * 11.0) * 0.10;
    float e = 0.012;
    // Two raw taps; macro stands in for the centre height (its broad .r term
    // dominates, and the bias is absorbed by the gradient gain + mix range).
    // A third centre tap would break the +2 relief budget.
    float hx = texture(u_cloudNoise, noiseP + vec2(e, 0.0)).r;
    float hy = texture(u_cloudNoise, noiseP + vec2(0.0, e)).r;
    vec2 noiseGrad = (vec2(hx, hy) - macro) * 6.0;
    // Analytic slope of 1-smoothstep(coreEdge0, coreEdge1, warpedCoreQ).
    // The direction follows the anisotropic CDO metric; texture-warp and the
    // downshear scale derivative are intentionally left to noiseGrad.
    float coreEnvelopeT = clamp(
      (warpedCoreQ - coreEdge0) / max(coreEdge1 - coreEdge0, 0.001),
      0.0,
      1.0
    );
    float envSlope = -6.0 * coreEnvelopeT * (1.0 - coreEnvelopeT) /
      max(coreEdge1 - coreEdge0, 0.001) * (1.0 - weakMorphology);
    vec2 anisotropicCoreGrad = anisotropicCoreQ > 0.001
      ? shearDir * (canopyAlong /
          (coreAlongScale * coreAlongScale * anisotropicCoreQ)) +
        shearCrossDir * (canopyCross /
          (coreCrossScale * coreCrossScale * anisotropicCoreQ))
      : vec2(0.0);
    vec2 grad = noiseGrad + anisotropicCoreGrad * envSlope * 0.45;
    // Standard height-field normal, lit by a fixed NW sun in east/north space.
    vec3 normal = normalize(vec3(-grad, 1.4));
    vec3 sunDir = normalize(vec3(-0.707, 0.707, 1.2));
    float lambert = clamp(dot(normal, sunDir), 0.0, 1.0);
    relief = mix(0.74, 1.18, lambert);
  }
`;
