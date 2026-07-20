/** Reflectivity-style display of the simulated eyewall and spiral rainbands. */

import { TOKENS } from '../tokens';
import { makeProgram, makeQuadVao } from './gl-utils';
import type { DrawCtx, RenderModule } from './context';

const VS = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

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
  float eyewall = exp(-pow((q - 1.0) / 0.34, 2.0));
  float envelope =
    smoothstep(1.4, 2.0, q) * (1.0 - smoothstep(6.0, 8.0, q));
  float azimuth = atan(radial.y, radial.x);
  float spiral = max(0.08, 0.54 + 0.46 * sin(
    3.0 * azimuth - 1.35 * q + u_ageH * 0.035
  ));
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
    const latRadians = (storm.lat * Math.PI) / 180;
    const offsetX =
      (2 * ctx.structure.rainOffsetEastKm) /
      (20 * 111 * Math.max(0.2, Math.cos(latRadians)));
    const offsetY = (2 * ctx.structure.rainOffsetNorthKm) / (12 * 111);
    gl.uniform2f(
      u('u_center'),
      ctx.centerClip.x + offsetX,
      ctx.centerClip.y + offsetY,
    );
    gl.uniform1f(
      u('u_rMax'),
      Math.max(0.008, ctx.structure.rmwKm / 666),
    );
    gl.uniform1f(
      u('u_metricX'),
      (20 * Math.cos(latRadians)) / 12,
    );
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
