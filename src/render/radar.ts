/** Reflectivity-style display of the simulated eyewall and spiral rainbands. */

import {
  EYEWALL_WIDTH_Q,
  RAINBAND_AZIMUTHAL_MEAN,
  RAINBAND_INNER_FULL_Q,
  RAINBAND_INNER_Q,
  RAINBAND_SPIRAL_AMPLITUDE,
  RAINBAND_SPIRAL_ARMS,
  RAINBAND_SPIRAL_PITCH,
  RAINBAND_SPIRAL_ROTATION_PER_H,
  rainbandOuterBounds,
} from '../rainband-profile';
import { TOKENS } from '../tokens';
import {
  RADAR_DBZ_MAX,
  RADAR_DBZ_MIN,
  RADAR_DBZ_QUANTUM,
  RADAR_DBZ_STOPS,
  RADAR_ARM_SUPPORT_HI,
  RADAR_ARM_SUPPORT_LO,
  RADAR_CELL_SUPPORT_LO_ORGANIZED,
  RADAR_CELL_SUPPORT_LO_WEAK,
  RADAR_CELL_SUPPORT_WIDTH,
  RADAR_COVERAGE_FLOOR,
  RADAR_STRONG_ECHO_COVERAGE_FLOOR,
  RADAR_STRONG_ECHO_DBZ_HI,
  RADAR_STRONG_ECHO_DBZ_LO,
  RADAR_Z_COEFFICIENT,
  RADAR_Z_EXPONENT,
} from '../radar-reflectivity';
import type { DrawCtx, RenderModule } from './context';
import {
  cloudMetricX,
  cloudSeedFromGenesis,
  interpolatedCloudAgeH,
} from './cloud-motion';
import { VIEW_QUAD_VS, makeProgram, makeQuadVao, setViewUniform } from './gl-utils';
import { rainCenterClip } from './precipitating-cloud';
import { HALF_DOMAIN_HEIGHT_KM, RENDER_RADIUS_FLOOR } from './storm-radii';

const VS = VIEW_QUAD_VS;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_center;
uniform float u_rMax;
uniform float u_rainOuterFadeQ;
uniform float u_rainOuterQ;
uniform float u_metricX;
uniform float u_eyeRate;
uniform float u_bandRate;
uniform float u_ageH;
uniform float u_seed;
uniform vec2 u_shear;
uniform float u_organization;
uniform float u_visible;
uniform vec3 u_radar0;
uniform vec3 u_radar1;
uniform vec3 u_radar2;
uniform vec3 u_radar3;
uniform vec3 u_radar4;
uniform vec3 u_radar5;

vec3 radar(float dbz) {
  float value = clamp(dbz, ${RADAR_DBZ_MIN.toFixed(1)}, ${RADAR_DBZ_MAX.toFixed(1)});
  if (value < ${RADAR_DBZ_STOPS[1].toFixed(1)}) return mix(
    u_radar0,
    u_radar1,
    (value - ${RADAR_DBZ_STOPS[0].toFixed(1)}) /
      ${String(RADAR_DBZ_STOPS[1] - RADAR_DBZ_STOPS[0])}.0
  );
  if (value < ${RADAR_DBZ_STOPS[2].toFixed(1)}) return mix(
    u_radar1,
    u_radar2,
    (value - ${RADAR_DBZ_STOPS[1].toFixed(1)}) /
      ${String(RADAR_DBZ_STOPS[2] - RADAR_DBZ_STOPS[1])}.0
  );
  if (value < ${RADAR_DBZ_STOPS[3].toFixed(1)}) return mix(
    u_radar2,
    u_radar3,
    (value - ${RADAR_DBZ_STOPS[2].toFixed(1)}) /
      ${String(RADAR_DBZ_STOPS[3] - RADAR_DBZ_STOPS[2])}.0
  );
  if (value < ${RADAR_DBZ_STOPS[4].toFixed(1)}) return mix(
    u_radar3,
    u_radar4,
    (value - ${RADAR_DBZ_STOPS[3].toFixed(1)}) /
      ${String(RADAR_DBZ_STOPS[4] - RADAR_DBZ_STOPS[3])}.0
  );
  return mix(
    u_radar4,
    u_radar5,
    (value - ${RADAR_DBZ_STOPS[4].toFixed(1)}) /
      ${String(RADAR_DBZ_STOPS[5] - RADAR_DBZ_STOPS[4])}.0
  );
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), u.x),
    u.y
  );
}

float rainTexture(vec2 p) {
  float value = 0.0;
  float weight = 0.56;
  for (int octave = 0; octave < 4; octave++) {
    value += weight * valueNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(7.1, 3.7);
    weight *= 0.5;
  }
  return value;
}

void main() {
  vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
  vec2 radial = vec2(
    (cell.x - u_center.x) * u_metricX,
    cell.y - u_center.y
  );
  float q = length(radial) / max(0.008, u_rMax);
  float eyewall = exp(-pow((q - 1.0) / ${EYEWALL_WIDTH_Q}, 2.0));
  float envelope =
    smoothstep(${RAINBAND_INNER_Q}, ${RAINBAND_INNER_FULL_Q.toFixed(1)}, q) *
    (1.0 - smoothstep(
      u_rainOuterFadeQ,
      u_rainOuterQ,
      q
    ));
  float azimuth = atan(radial.y, radial.x);
  float spiral = ${RAINBAND_AZIMUTHAL_MEAN} + ${RAINBAND_SPIRAL_AMPLITUDE} * sin(
    ${RAINBAND_SPIRAL_ARMS.toFixed(1)} * azimuth -
      ${RAINBAND_SPIRAL_PITCH} * q +
      u_ageH * ${RAINBAND_SPIRAL_ROTATION_PER_H}
  );
  // Sample in storm-relative physical kilometres, not r/RMW. Cell sizes then
  // stay stable while the diagnosed RMW contracts or expands instead of
  // stretching with it. A genesis seed prevents every storm sharing one mask.
  vec2 stormKm = radial * ${HALF_DOMAIN_HEIGHT_KM.toFixed(1)};
  vec2 drift = vec2(u_ageH * 0.011, -u_ageH * 0.007);
  vec2 seedOffset = vec2(u_seed * 37.1, fract(u_seed * 17.7) * 29.3);
  float broadCells = rainTexture(stormKm / 72.0 + drift + seedOffset);
  float fineCells = rainTexture(stormKm / 24.0 - drift * 1.7 + seedOffset * 1.9);
  float cellular = mix(broadCells, fineCells, 0.46);

  float shearMagnitude = clamp(length(u_shear) / 25.0, 0.0, 1.0);
  vec2 shearDirection = length(u_shear) > 0.01
    ? normalize(u_shear)
    : vec2(0.0, 1.0);
  vec2 radialDirection = q > 0.001 ? normalize(radial) : vec2(0.0);
  float downshear = 0.5 + 0.5 * dot(radialDirection, shearDirection);
  float shearAsymmetry = mix(
    1.0,
    mix(0.68, 1.28, downshear),
    shearMagnitude * (1.0 - 0.45 * clamp(u_organization, 0.0, 1.0))
  );

  // Keep the numeric colour field on the exact shared eye + rainband rate.
  // Texture and shear alter only presentation support below; allowing them to
  // change dBZ here would make radar disagree with impact/rain diagnostics.
  float rainRate = max(
    0.0,
    u_eyeRate * eyewall + u_bandRate * envelope * spiral
  );
  // Marshall–Palmer-style reflectivity proxy; this remains explicitly modelled,
  // never observed radar data.
  float dbz = rainRate > 0.01
    ? 10.0 * log(${RADAR_Z_COEFFICIENT.toFixed(1)} * pow(rainRate, ${RADAR_Z_EXPONENT.toFixed(1)})) / log(10.0)
    : 0.0;
  float boundedDbz = clamp(dbz, ${RADAR_DBZ_MIN.toFixed(1)}, ${RADAR_DBZ_MAX.toFixed(1)});
  float steppedDbz = clamp(
    ${RADAR_DBZ_MIN.toFixed(1)} + floor(
      (boundedDbz - ${RADAR_DBZ_MIN.toFixed(1)}) /
        ${RADAR_DBZ_QUANTUM.toFixed(1)} + 0.5
    ) * ${RADAR_DBZ_QUANTUM.toFixed(1)},
    ${RADAR_DBZ_MIN.toFixed(1)},
    ${RADAR_DBZ_MAX.toFixed(1)}
  );
  float paletteDbz = mix(boundedDbz, steppedDbz, 0.68);
  float pixelGrain = mix(
    0.94,
    1.0,
    hash21(floor(v_uv * vec2(1800.0, 1100.0)))
  );
  float bandShare = envelope / max(0.001, envelope + eyewall);
  // The parametric band rate is an area mean. Opacity carries a deterministic
  // sub-grid coverage fraction so that low-level rain appears as broken arcs
  // and cells instead of a false solid 8-RMW pinwheel. Colour remains the
  // untouched shared dBZ value; strong echoes retain a readability floor.
  float organized = clamp(u_organization, 0.0, 1.0);
  float cellLo = mix(
    ${RADAR_CELL_SUPPORT_LO_WEAK.toFixed(2)},
    ${RADAR_CELL_SUPPORT_LO_ORGANIZED.toFixed(2)},
    organized
  );
  float armSupport = smoothstep(
    ${RADAR_ARM_SUPPORT_LO.toFixed(2)},
    ${RADAR_ARM_SUPPORT_HI.toFixed(2)},
    spiral
  );
  float cellSupport = smoothstep(
    cellLo,
    cellLo + ${RADAR_CELL_SUPPORT_WIDTH.toFixed(2)},
    cellular
  );
  float fragmentedCoverage = ${RADAR_COVERAGE_FLOOR.toFixed(2)} +
    ${(1 - RADAR_COVERAGE_FLOOR).toFixed(2)} * armSupport * cellSupport *
      clamp(shearAsymmetry, 0.0, 1.0);
  float strongEchoFloor = ${RADAR_STRONG_ECHO_COVERAGE_FLOOR.toFixed(2)} *
    smoothstep(
      ${RADAR_STRONG_ECHO_DBZ_LO.toFixed(1)},
      ${RADAR_STRONG_ECHO_DBZ_HI.toFixed(1)},
      dbz
    );
  float bandCoverage = max(fragmentedCoverage, strongEchoFloor);
  float eyewallCoverage = 0.88 + 0.12 * broadCells;
  float support = mix(eyewallCoverage, bandCoverage, bandShare);
  float alpha = smoothstep(8.0, 18.0, dbz) * 0.9 * pixelGrain * support * u_visible;
  o = vec4(radar(paletteDbz), alpha);
}`;

export class RadarLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.program);
  }

  resize(_width: number, _height: number): void {
    /* fullscreen pass */
  }

  draw(ctx: DrawCtx): void {
    const gl = this.gl;
    const storm = ctx.frame.storm;
    if (
      !this.program ||
      !this.vao ||
      !ctx.centerClip ||
      !ctx.structure ||
      !storm
    ) {
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const u = (name: string) => gl.getUniformLocation(this.program!, name);
    setViewUniform(gl, u('u_view'), ctx.view);
    const rainCenter = rainCenterClip(ctx.centerClip, ctx.structure);
    gl.uniform2f(
      u('u_center'),
      rainCenter.x,
      rainCenter.y,
    );
    gl.uniform1f(
      u('u_rMax'),
      Math.max(RENDER_RADIUS_FLOOR, ctx.structure.rmwKm / HALF_DOMAIN_HEIGHT_KM),
    );
    const rainbandBounds = rainbandOuterBounds(ctx.structure.rmwKm);
    gl.uniform1f(u('u_rainOuterFadeQ'), rainbandBounds.fadeQ);
    gl.uniform1f(u('u_rainOuterQ'), rainbandBounds.outerQ);
    gl.uniform1f(u('u_metricX'), cloudMetricX(storm.lat));
    gl.uniform1f(
      u('u_eyeRate'),
      storm.diagnostics.eyewallRainMmH,
    );
    gl.uniform1f(
      u('u_bandRate'),
      storm.diagnostics.rainbandRainMmH,
    );
    gl.uniform1f(
      u('u_ageH'),
      interpolatedCloudAgeH(
        ctx.frame.prevStorm?.ageH ?? null,
        storm.ageH,
        ctx.frame.alpha,
      ),
    );
    gl.uniform1f(u('u_seed'), cloudSeedFromGenesis(ctx.track?.[0]));
    gl.uniform2f(
      u('u_shear'),
      storm.diagnostics.shearUms,
      storm.diagnostics.shearVms,
    );
    gl.uniform1f(u('u_organization'), storm.diagnostics.organization);
    gl.uniform1f(u('u_visible'), ctx.weatherLayer === 'rain' ? 1 : 0);
    const radarTokens = [
      TOKENS.radar0,
      TOKENS.radar1,
      TOKENS.radar2,
      TOKENS.radar3,
      TOKENS.radar4,
      TOKENS.radar5,
    ] as const;
    for (let i = 0; i < radarTokens.length; i += 1) {
      gl.uniform3fv(
        u(`u_radar${i}`),
        radarTokens[i].rgba01.subarray(0, 3),
      );
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.program = null;
    this.vao = null;
  }
}
