/** Reflectivity-style display of the simulated eyewall and spiral rainbands. */

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
} from '../rainband-profile';
import { TOKENS } from '../tokens';
import type { DrawCtx, RenderModule } from './context';
import { cloudMetricX } from './cloud-motion';
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
uniform float u_metricX;
uniform float u_eyeRate;
uniform float u_bandRate;
uniform float u_ageH;
uniform float u_visible;
uniform vec3 u_radar0;
uniform vec3 u_radar1;
uniform vec3 u_radar2;
uniform vec3 u_radar3;
uniform vec3 u_radar4;
uniform vec3 u_radar5;

vec3 radar(float value) {
  float x = clamp(value, 0.0, 1.0) * 5.0;
  if (x < 1.0) return mix(u_radar0, u_radar1, x);
  if (x < 2.0) return mix(u_radar1, u_radar2, x - 1.0);
  if (x < 3.0) return mix(u_radar2, u_radar3, x - 2.0);
  if (x < 4.0) return mix(u_radar3, u_radar4, x - 3.0);
  return mix(u_radar4, u_radar5, x - 4.0);
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
      ${RAINBAND_OUTER_FADE_Q.toFixed(1)},
      ${RAINBAND_OUTER_Q.toFixed(1)},
      q
    ));
  float azimuth = atan(radial.y, radial.x);
  float spiral = ${RAINBAND_AZIMUTHAL_MEAN} + ${RAINBAND_SPIRAL_AMPLITUDE} * sin(
    ${RAINBAND_SPIRAL_ARMS.toFixed(1)} * azimuth -
      ${RAINBAND_SPIRAL_PITCH} * q +
      u_ageH * ${RAINBAND_SPIRAL_ROTATION_PER_H}
  );
  float rainRate = u_eyeRate * eyewall + u_bandRate * envelope * spiral;
  // Marshall–Palmer-style reflectivity proxy: Z=200 R^1.6, rendered in dBZ.
  float dbz = rainRate > 0.01
    ? 10.0 * log(200.0 * pow(rainRate, 1.6)) / log(10.0)
    : 0.0;
  float normalized = clamp((dbz - 10.0) / 55.0, 0.0, 1.0);
  float alpha = smoothstep(0.03, 0.16, normalized) * 0.88 * u_visible;
  o = vec4(radar(normalized), alpha);
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
    gl.uniform1f(u('u_metricX'), cloudMetricX(storm.lat));
    gl.uniform1f(
      u('u_eyeRate'),
      storm.diagnostics.eyewallRainMmH,
    );
    gl.uniform1f(
      u('u_bandRate'),
      storm.diagnostics.rainbandRainMmH,
    );
    gl.uniform1f(u('u_ageH'), storm.ageH);
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
