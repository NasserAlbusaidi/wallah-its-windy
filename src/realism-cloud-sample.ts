/**
 * realism-cloud-sample.ts — the CPU twin of the env shader's `sampleCloud()`.
 *
 * One module, one job: a statement-by-statement transcription of the GLSL in
 * `src/render/env.ts` plus its `cloud-motion.ts` splices, kept apart from the
 * rasterizer (`realism-field.ts`) so this file can be diffed line-for-line
 * against the shader without any harness plumbing in the way. Import it through
 * `src/realism-proxy.ts`, the harness's single import surface.
 *
 * Nothing here reads the clock, a device trait, or global state: the field is a
 * pure function of (uniforms, cell inputs, noise).
 */

import {
  clamp01,
  glslFract,
  glslHash21,
  glslRotate2,
  mix,
  smoothstep,
} from './realism-glsl';
import type { RealismNoise } from './realism-glsl';
import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_OUTER_FADE_Q,
  RAINBAND_OUTER_Q,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_PITCH,
  RAINBAND_SPIRAL_ROTATION_PER_H,
} from './rainband-profile';
import {
  CLOUD_MEMORY_MACRO_GAIN,
  DEBRIS_MAX_CLOUD,
} from './render/cloud-memory';
import {
  CLOUD_BAND_REFERENCE_Q,
  CLOUD_CROSSFADE_PERIOD_H,
  CLOUD_PULSE_PERIOD_H,
  CLOUD_ROTATION_CAP_RAD_PER_H,
  CLOUD_TOP_BAND_DEVELOPING_C,
  CLOUD_TOP_BAND_MATURE_C,
  CLOUD_TOP_CDO_DEVELOPING_C,
  CLOUD_TOP_CDO_MATURE_C,
  CLOUD_TOP_CIRRUS_COLD_C,
  CLOUD_TOP_CIRRUS_WARM_C,
  DEBRIS_TOP_COLD_C,
  DEBRIS_TOP_WARM_C,
  LEGACY_CLOUD_ROTATION_RAD_PER_H,
  cloudAngularRateAtClipRadius,
} from './render/cloud-motion';
import {
  PRECIPITATING_CLOUD_BAND_FULL_MM_H,
  PRECIPITATING_CLOUD_BAND_MAX,
  PRECIPITATING_CLOUD_EYE_FULL_MM_H,
  PRECIPITATING_CLOUD_RAIN_START_MM_H,
  PRECIPITATING_CLOUD_SPIRAL_FLOOR,
  PRECIPITATING_CLOUD_TEXTURE_FLOOR,
} from './render/precipitating-cloud';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
} from './render/storm-radii';

/**
 * The env fragment shader's uniform block in the measurement pose, field names
 * matching the GLSL uniforms minus their `u_` prefix so the transcription below
 * diffs line-for-line against `sampleCloud()`.
 */
export interface CloudUniforms {
  center: { x: number; y: number };
  rainCenter: { x: number; y: number };
  metricX: number;
  rMax: number;
  rCanopy: number;
  intensity: number;
  organization: number;
  ageH: number;
  cloudAgeH: number;
  vmaxMs: number;
  hollandB: number;
  stormPresence: number;
  shearVector: { x: number; y: number };
  shearAtStorm: number;
  steerAtStorm: { x: number; y: number };
  midlevelRh: number;
  eyewallRain: number;
  rainbandRain: number;
  cloudSeed: number;
  hasCloudMemory: number;
  /** 0 in the measurement pose - `animGate` is therefore 1. */
  reducedMotion: number;
  /** 1 in the measurement pose - the detail-tier `fine` branch. */
  cloudDetail: number;
}

/** Per-cell shader inputs the enclosing pass resolves before `sampleCloud()`. */
export interface CloudCellInputs {
  /** `v_uv`. */
  u: number;
  v: number;
  /** `texture(u_land, v_uv).r` - binarized-then-bilinear (App-truth note 9). */
  land: number;
  /** main()'s blended, re-expanded `sstC`. */
  sstC: number;
  /** sampleCloud()'s `localRh`, hoisted so the env sampler stays out of it. */
  localRh: number;
  /** `memoryPacked.r` at crossfade fraction 0. */
  memDensity: number;
  /** `memoryPacked.g` at crossfade fraction 0. */
  memAge: number;
}

/** The GLSL `CloudField` struct plus the harness-only band arm. */
export interface ProxyCloudField {
  cloud: number;
  stormCloud: number;
  ambientCloud: number;
  brightnessC: number;
  rainbands: number;
  precipBandCloud: number;
  debris: number;
}

/**
 * The GLSL emits these two through `toFixed(2)`; recomputing them in float64
 * would give 0.36000000000000004. Mirror the literals the shader compiles.
 */
const PRECIP_SPIRAL_MIN = Number(
  (RAINBAND_AZIMUTHAL_MEAN - RAINBAND_SPIRAL_AMPLITUDE).toFixed(2),
);
const PRECIP_SPIRAL_SPAN = Number((RAINBAND_SPIRAL_AMPLITUDE * 2).toFixed(2));

/** The GLSL pulse envelope's literal pi; NOT Math.PI (they differ at 1e-9). */
const GLSL_PI = 3.14159265;

/**
 * Statement-by-statement CPU transcription of `sampleCloud()` in
 * `src/render/env.ts` (lines 152-399) with the `CLOUD_CORE_GLSL.wobble`,
 * `CLOUD_CORE_GLSL.eyewall` and `CLOUD_TOPS_GLSL` splices from
 * `src/render/cloud-motion.ts` inlined at their documented splice points.
 *
 * Documented skips: `CLOUD_RELIEF_GLSL` (visible-palette shading only, never
 * reaches brightnessC) and the palette/compositing in `main()`.
 *
 * GLSL `pow(x, 2.0)` on a negative base (the eyewall/precipEyewall Gaussians)
 * is spec-undefined but universally folded to `x * x`; JS `**` with an integer
 * exponent does the same, so the mirror holds.
 */
export function sampleCloudProxy(
  u: CloudUniforms,
  cell: CloudCellInputs,
  noise: RealismNoise,
): ProxyCloudField {
  const cellX = cell.u * 2 - 1;
  const cellY = 1 - cell.v * 2;
  const radialX = (cellX - u.center.x) * u.metricX;
  const radialY = cellY - u.center.y;
  const rainRadialX = (cellX - u.rainCenter.x) * u.metricX;
  const rainRadialY = cellY - u.rainCenter.y;
  const rMax = Math.max(RENDER_RADIUS_FLOOR, u.rMax);
  const rCanopy = Math.max(RENDER_RADIUS_FLOOR, u.rCanopy);
  // coreQ: eye and eyewall stay tied to the contracting inner core.
  const q = Math.hypot(radialX, radialY) / rMax;

  // ---- CLOUD_CORE_GLSL.wobble ----
  const coreAzimuth = Math.atan2(radialY, radialX);
  const wobble =
    0.6 * Math.sin(3.0 * coreAzimuth + u.cloudSeed * 37.7) +
    0.4 * Math.sin(5.0 * coreAzimuth + u.cloudSeed * 61.3);
  const wobbleAmp = mix(0.2, 0.05, smoothstep(0.38, 0.85, u.organization));
  const qCore = q * (1.0 + wobbleAmp * wobble);
  // ---- end wobble ----

  const shearLen = Math.hypot(u.shearVector.x, u.shearVector.y);
  const shearDirX = shearLen > 0.05 ? u.shearVector.x / shearLen : 0.78;
  const shearDirY = shearLen > 0.05 ? u.shearVector.y / shearLen : 0.62;
  const shearN = smoothstep(7.0, 27.0, u.shearAtStorm);
  const canopyOffset = rCanopy * shearN * (0.82 / CANOPY_COEFFICIENT_DIVISOR);
  const canopyRadialX = radialX - shearDirX * canopyOffset;
  const canopyRadialY = radialY - shearDirY * canopyOffset;
  const canopyLen = Math.hypot(canopyRadialX, canopyRadialY);
  const canopyQ = canopyLen / rCanopy;
  const bandQ = canopyLen / rMax;
  const azimuth = Math.atan2(canopyRadialY, canopyRadialX);

  // ---- decorative motion (independent of the rain-aligned geometry) ----
  const animGate = 1.0 - u.reducedMotion;
  const legacyRotation = u.ageH * LEGACY_CLOUD_ROTATION_RAD_PER_H;
  const omegaHere = cloudAngularRateAtClipRadius(
    canopyLen,
    rMax,
    u.vmaxMs,
    u.hollandB,
  );

  const tCycle = u.cloudAgeH / CLOUD_CROSSFADE_PERIOD_H;
  const phaseA = glslFract(tCycle);
  const phaseB = glslFract(tCycle + 0.5);
  const weightA = mix(1.0, 1.0 - Math.abs(2.0 * phaseA - 1.0), animGate);
  // GLSL declares weightB here; nothing downstream reads it and noUnusedLocals
  // forbids a dead local, so it is deliberately absent.

  const seed = u.cloudSeed;
  const twist =
    0.72 * Math.log(1.0 + canopyQ) - legacyRotation * (1.0 - animGate);
  const spiralBase = glslRotate2(
    twist,
    canopyRadialX / rCanopy,
    canopyRadialY / rCanopy,
  );
  const thetaA = animGate * omegaHere * phaseA * CLOUD_CROSSFADE_PERIOD_H;
  const thetaB = animGate * omegaHere * phaseB * CLOUD_CROSSFADE_PERIOD_H;
  const pA = glslRotate2(thetaA, spiralBase.x, spiralBase.y);
  const pB = glslRotate2(thetaB, spiralBase.x, spiralBase.y);

  const driftX = u.ageH * 0.012 + shearDirX * u.ageH * 0.005;
  const driftY = -u.ageH * 0.007 + shearDirY * u.ageH * 0.005;
  let macro = mix(
    noise.cloudNoise(
      pB.x * 0.62 + driftX + seed * 11.0,
      pB.y * 0.62 + driftY + seed * 11.0,
    ),
    noise.cloudNoise(
      pA.x * 0.62 + driftX + seed * 11.0,
      pA.y * 0.62 + driftY + seed * 11.0,
    ),
    weightA,
  );

  // ---- cloud memory: earth-fixed advected state, crossfaded RG/BA ----
  // GLSL: memFrac = fract(u_cloudAgeH / CLOUD_MEMORY_DT_H), then
  // memDensity = mix(packed.r, packed.b, memFrac) * u_hasCloudMemory and
  // memAge = mix(packed.g, packed.a, memFrac). The measurement pose samples at
  // integer sim-hours, so memFrac is 0 and both mixes collapse onto the
  // state(k) half - exactly DebrisState's density/age pair.
  const memDensity = cell.memDensity * u.hasCloudMemory;
  const memAge = cell.memAge;
  macro = clamp01(
    macro *
      (1.0 + CLOUD_MEMORY_MACRO_GAIN * smoothstep(0.15, 0.85, memDensity)),
  );
  // u_cloudDetail > 0.5 in the measurement pose: the two-tap detail branch.
  const fine =
    u.cloudDetail > 0.5
      ? mix(
          noise.cloudNoise(
            pB.x * 1.95 - driftX * 1.8 + macro * 2.4,
            pB.y * 1.95 - driftY * 1.8 + seed * 5.0,
          ),
          noise.cloudNoise(
            pA.x * 1.95 - driftX * 1.8 + macro * 2.4,
            pA.y * 1.95 - driftY * 1.8 + seed * 5.0,
          ),
          weightA,
        )
      : mix(
          noise.tap(
            pB.x * 0.022 - driftX * 0.018 + seed,
            pB.y * 0.022 - driftY * 0.018 + seed,
            1,
          ),
          noise.tap(
            pA.x * 0.022 - driftX * 0.018 + seed,
            pA.y * 0.022 - driftY * 0.018 + seed,
            1,
          ),
          weightA,
        );

  const synopticDriftX = u.steerAtStorm.x * u.ageH * 0.0012;
  const synopticDriftY = -u.steerAtStorm.y * u.ageH * 0.0012;
  const synopticPx = cell.u * 8.0 - synopticDriftX + seed * 3.0;
  const synopticPy = cell.v * 5.2 - synopticDriftY + seed * 3.0;
  const synopticNoise = noise.cloudNoise(
    synopticPx * 1.35 + 9.7,
    synopticPy * 1.35 + 9.7,
  );
  const localRh = cell.localRh;
  const ambientGate = synopticNoise + localRh * 0.38;
  const ambientCloud =
    smoothstep(0.59, 0.88, ambientGate) *
    mix(0.12, 0.52, smoothstep(0.35, 0.86, localRh));

  const moisture = clamp01((u.midlevelRh - 0.25) / 0.62);
  const rainEnergy = clamp01((u.eyewallRain + 0.7 * u.rainbandRain) / 28.0);
  const development = clamp01(0.56 * u.organization + 0.44 * u.intensity);
  const coreRadius =
    mix(
      2.25 / CANOPY_COEFFICIENT_DIVISOR,
      3.55 / CANOPY_COEFFICIENT_DIVISOR,
      development,
    ) * mix(1.0, 0.86, shearN);
  const coreIrregularity = mix(
    0.34,
    0.12,
    smoothstep(0.38, 0.82, u.organization),
  );
  const irregularCoreRadius =
    coreRadius * mix(1.0 - coreIrregularity, 1.0 + coreIrregularity, macro);
  const centralOvercast = Math.exp(-((canopyQ / irregularCoreRadius) ** 2));
  const eyewall = Math.exp(
    -(((qCore - 1.0) / mix(0.46, 0.27, u.organization)) ** 2),
  );
  const outerBandRadius = mix(6.35, 8.8, smoothstep(0.3, 0.84, development));
  const bandEnvelope =
    smoothstep(1.25, 1.85, bandQ) *
    (1.0 - smoothstep(outerBandRadius - 2.6, outerBandRadius, bandQ));
  const omegaBand = cloudAngularRateAtClipRadius(
    CLOUD_BAND_REFERENCE_Q * rMax,
    rMax,
    u.vmaxMs,
    u.hollandB,
  );
  const thetaBand = mix(
    -legacyRotation / 2.35,
    omegaBand * u.cloudAgeH,
    animGate,
  );
  const thetaBand2 = mix(
    legacyRotation / 7.4,
    omegaBand * u.cloudAgeH,
    animGate,
  );
  const bandPhase =
    2.35 * (azimuth - thetaBand) - 1.52 * bandQ + (macro - 0.5) * 4.6;
  const primaryBand = smoothstep(0.18, 0.76, 0.5 + 0.5 * Math.sin(bandPhase));
  const secondaryBand = smoothstep(
    0.3,
    0.82,
    0.5 + 0.5 * Math.sin(3.7 * (azimuth - thetaBand2) - 0.88 * bandQ + fine),
  );
  const convectiveCells = smoothstep(0.36, 0.78, fine * 0.74 + macro * 0.34);

  const rainQ = Math.hypot(rainRadialX, rainRadialY) / rMax;
  const rainAzimuth = Math.atan2(rainRadialY, rainRadialX);
  const precipEyewall = Math.exp(-(((rainQ - 1.0) / EYEWALL_WIDTH_Q) ** 2));
  const precipBandEnvelope =
    smoothstep(RAINBAND_INNER_Q, RAINBAND_INNER_FULL_Q, rainQ) *
    (1.0 - smoothstep(RAINBAND_OUTER_FADE_Q, RAINBAND_OUTER_Q, rainQ));
  const precipSpiral =
    RAINBAND_AZIMUTHAL_MEAN +
    RAINBAND_SPIRAL_AMPLITUDE *
      Math.sin(
        RAINBAND_SPIRAL_ARMS * rainAzimuth -
          RAINBAND_SPIRAL_PITCH * rainQ +
          u.ageH * RAINBAND_SPIRAL_ROTATION_PER_H,
      );
  const precipSpiralN = clamp01(
    (precipSpiral - PRECIP_SPIRAL_MIN) / PRECIP_SPIRAL_SPAN,
  );
  const precipEyeSupport = smoothstep(
    PRECIPITATING_CLOUD_RAIN_START_MM_H,
    PRECIPITATING_CLOUD_EYE_FULL_MM_H,
    u.eyewallRain,
  );
  const precipBandSupport = smoothstep(
    PRECIPITATING_CLOUD_RAIN_START_MM_H,
    PRECIPITATING_CLOUD_BAND_FULL_MM_H,
    u.rainbandRain,
  );
  // The band arm is hoisted out of the GLSL max() so the harness can store it
  // alone; precipitatingCloud below is the shader's expression verbatim.
  const precipBandArm =
    precipBandEnvelope *
    mix(PRECIPITATING_CLOUD_SPIRAL_FLOOR, 1.0, precipSpiralN) *
    precipBandSupport *
    PRECIPITATING_CLOUD_BAND_MAX;
  const precipTexture = mix(PRECIPITATING_CLOUD_TEXTURE_FLOOR, 1.0, macro);
  const precipitatingCloud =
    Math.max(precipEyewall * precipEyeSupport, precipBandArm) * precipTexture;
  const bandCoherence =
    smoothstep(0.42, 0.78, u.organization) *
    smoothstep(0.12, 0.52, u.intensity);
  const brokenBand =
    smoothstep(0.28, 0.72, macro * 0.62 + fine * 0.42) *
    mix(0.48, 1.0, primaryBand);
  const bandShape = mix(
    brokenBand,
    Math.max(primaryBand, secondaryBand * 0.58),
    bandCoherence,
  );

  const canopyDirX =
    canopyQ > 0.001 ? canopyRadialX / (canopyQ * rCanopy) : shearDirX;
  const canopyDirY =
    canopyQ > 0.001 ? canopyRadialY / (canopyQ * rCanopy) : shearDirY;
  const upshear = Math.max(0, canopyDirX * -shearDirX + canopyDirY * -shearDirY);
  const shearErosion = 1.0 - shearN * upshear * mix(0.28, 0.62, 1.0 - moisture);
  const eyewallMaturity =
    smoothstep(0.3, 0.68, u.intensity) * smoothstep(0.4, 0.72, u.organization);
  const coreCloud =
    centralOvercast * mix(0.7, 1.0, development) * mix(0.88, 1.0, macro);

  // ---- CLOUD_CORE_GLSL.eyewall ----
  const mesoTheta = animGate * CLOUD_ROTATION_CAP_RAD_PER_H * u.cloudAgeH;
  const meso =
    1.0 +
    0.24 *
      eyewallMaturity *
      Math.sin(5.0 * (coreAzimuth - mesoTheta) + u.cloudSeed * 17.9);
  // GLSL step(0.05, length(u_shearVector)): 0 below the edge, 1 at or above.
  const hasShearDir = shearLen < 0.05 ? 0 : 1;
  const dsl = Math.max(0, canopyDirX * -shearDirY + canopyDirY * shearDirX);
  const dslBoost = 1.0 + 0.22 * shearN * hasShearDir * dsl;
  const eyewallCloud =
    eyewall *
    meso *
    dslBoost *
    eyewallMaturity *
    mix(0.48, 1.0, rainEnergy) *
    mix(0.68, 1.0, convectiveCells);
  // ---- end eyewall ----

  const rainbands =
    bandEnvelope *
    bandShape *
    mix(0.42, 0.96, moisture) *
    mix(0.46, 1.0, convectiveCells) *
    mix(0.62, 1.0, development);

  const cirrusStream = animGate * u.cloudAgeH * 0.06;
  const cirrusTexture = smoothstep(
    0.24,
    0.74,
    noise.tap(
      (spiralBase.x * -shearDirY + spiralBase.y * shearDirX) * 0.029 +
        driftX * 0.018,
      (spiralBase.x * shearDirX + spiralBase.y * shearDirY) * 0.011 -
        cirrusStream +
        driftY * 0.018,
      2,
    ),
  );
  const cirrus =
    Math.exp(-((canopyQ / (5.8 / CANOPY_COEFFICIENT_DIVISOR)) ** 1.55)) *
    cirrusTexture *
    mix(0.16, 0.38, u.organization) *
    mix(0.82, 1.16, shearN);

  const eyeStrength =
    smoothstep(0.18, 0.56, u.intensity * u.organization) *
    smoothstep(0.62, 0.82, u.organization);
  const eye = 1.0 - smoothstep(0.18, mix(0.46, 0.68, eyeStrength), qCore);
  let stormCloud = clamp01(
    (coreCloud + eyewallCloud + rainbands + cirrus + precipitatingCloud) *
      shearErosion,
  );
  stormCloud *= 1.0 - eye * eyeStrength * 0.97;
  stormCloud *= u.stormPresence;
  let cloud = Math.max(
    ambientCloud * (1.0 - centralOvercast * u.stormPresence),
    stormCloud,
  );
  const debris = memDensity * (1.0 - 0.55 * memAge) * DEBRIS_MAX_CLOUD;
  cloud = Math.max(cloud, debris);

  const surfaceC = mix(cell.sstC, 34.0, smoothstep(0.35, 0.65, cell.land));
  const ambientTopC = mix(-8.0, -42.0, synopticNoise * localRh);

  // ---- CLOUD_TOPS_GLSL ----
  const cdoTopC = mix(
    CLOUD_TOP_CDO_DEVELOPING_C,
    CLOUD_TOP_CDO_MATURE_C,
    development,
  );
  const bandTopC = mix(
    CLOUD_TOP_BAND_DEVELOPING_C,
    CLOUD_TOP_BAND_MATURE_C,
    development,
  );
  const cirrusTopC = mix(
    CLOUD_TOP_CIRRUS_WARM_C,
    CLOUD_TOP_CIRRUS_COLD_C,
    u.organization,
  );

  const otCellX = Math.floor(pA.x * 6.0);
  const otCellY = Math.floor(pA.y * 6.0);
  const otOffset = glslHash21(
    otCellX * 1.73 + seed * 291.7,
    otCellY * 1.73 + seed * 291.7,
  );
  const otCycle = u.cloudAgeH / CLOUD_PULSE_PERIOD_H + otOffset;
  const otStrength = glslHash21(
    otCellX * 2.61 + Math.floor(otCycle) * 7.31,
    otCellY * 2.61 + Math.floor(otCycle) * 7.31,
  );
  let otEnv = Math.sin(GLSL_PI * glslFract(otCycle));
  otEnv *= otEnv;
  otEnv = mix(0.5, otEnv, animGate);
  const overshootC =
    mix(8.0, 14.0, otStrength) *
    otEnv *
    smoothstep(0.55, 0.8, convectiveCells) *
    smoothstep(0.3, 0.8, rainEnergy);

  const cirrusPresence = clamp01(cirrus * 2.6);
  const bandPresence = clamp01(Math.max(rainbands, precipitatingCloud) * 1.6);
  const corePresence = clamp01(coreCloud * 1.4);
  const towerPresence =
    clamp01(Math.max(eyewallCloud, precipitatingCloud) * 1.2) *
    smoothstep(0.55, 0.8, convectiveCells);

  let topC = ambientTopC;
  const debrisTopC = mix(DEBRIS_TOP_WARM_C, DEBRIS_TOP_COLD_C, 1.0 - memAge);
  const debrisPresence = clamp01(memDensity * 1.3) * u.hasCloudMemory;
  topC = mix(topC, debrisTopC, debrisPresence);
  topC = mix(topC, cirrusTopC, cirrusPresence);
  topC = mix(topC, bandTopC, bandPresence);
  topC = mix(topC, cdoTopC, corePresence);
  topC = mix(topC, Math.min(topC, cdoTopC) - overshootC, towerPresence);

  let brightnessC = mix(surfaceC, ambientTopC, ambientCloud);
  brightnessC = mix(brightnessC, topC, stormCloud);
  // The eye restores surfaceC - 4: a mature storm's centre is WARM, not cold.
  brightnessC = mix(
    brightnessC,
    surfaceC - 4.0,
    eye * eyeStrength * u.stormPresence,
  );
  // ---- end tops ----
  // CLOUD_RELIEF_GLSL is deliberately skipped: relief only shades the visible
  // palette and never reaches brightnessC or any cover component.

  return {
    cloud,
    stormCloud,
    ambientCloud,
    brightnessC,
    rainbands,
    precipBandCloud: precipBandArm * precipTexture,
    debris,
  };
}
