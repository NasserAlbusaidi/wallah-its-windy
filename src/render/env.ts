/**
 * GPU weather-map pass.
 *
 * Terrain mode retains the original faint SST fuel glow. Scalar modes expose
 * the exact baked plane physics is reading. Infrared is explicitly a simulated
 * cloud-top brightness-temperature proxy derived from the live vortex—not
 * satellite data. Rain mode darkens the base so the separate rain accumulator
 * reads like an operational reflectivity product.
 */

import { TOKENS } from '../tokens';
import type { WeatherLayerId } from '../weather-layers';
import { SST_MAX_C, SST_MIN_C } from './textures';
import { makeProgram, makeQuadVao } from './gl-utils';
import type { DrawCtx, GpuTextures, RenderModule } from './context';

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
uniform sampler2D u_sst;
uniform sampler2D u_sstNext;
uniform sampler2D u_rh;
uniform sampler2D u_rhNext;
uniform sampler2D u_ohc;
uniform sampler2D u_ohcNext;
uniform sampler2D u_shear;
uniform sampler2D u_shearNext;
uniform sampler2D u_land;
uniform float u_planeBlend;
uniform vec2 u_sstRange;
uniform vec4 u_warm;
uniform float u_fade;
uniform int u_mode;
uniform float u_hasStorm;
uniform vec2 u_center;
uniform float u_rMax;
uniform float u_intensity;
uniform float u_organization;
uniform float u_ageH;
uniform float u_metricX;
uniform vec3 u_palette0;
uniform vec3 u_palette1;
uniform vec3 u_palette2;
uniform vec3 u_palette3;
uniform vec3 u_palette4;
uniform vec3 u_rainPlate;

vec3 fiveStop(float value, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e) {
  float x = clamp(value, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(a, b, x);
  if (x < 2.0) return mix(b, c, x - 1.0);
  if (x < 3.0) return mix(c, d, x - 2.0);
  return mix(d, e, x - 3.0);
}

void main() {
  float land = texture(u_land, v_uv).r;
  float sstN = mix(
    texture(u_sst, v_uv).r,
    texture(u_sstNext, v_uv).r,
    u_planeBlend
  );
  float sstC = sstN * (u_sstRange.y - u_sstRange.x) + u_sstRange.x;

  if (u_mode == 0) {
    float warm = smoothstep(26.0, 30.0, sstC);
    float alpha = u_warm.a * warm * (1.0 - smoothstep(0.4, 0.6, land)) * u_fade;
    o = vec4(u_warm.rgb, alpha);
    return;
  }

  if (u_mode == 1) {
    vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
    vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
    float q = length(radial) / max(0.008, u_rMax);
    float azimuth = atan(radial.y, radial.x);
    float rotation = u_ageH * 0.035;
    float denseOvercast = exp(-pow(q / 4.8, 1.6));
    float centralDense = exp(-pow(q / 1.7, 2.0));
    float bandEnvelope =
      smoothstep(1.1, 2.0, q) * (1.0 - smoothstep(5.5, 8.5, q));
    float spiral = 0.5 + 0.5 * sin(3.0 * azimuth - 1.35 * q + rotation);
    float cloud = u_hasStorm * clamp(
      centralDense * (0.55 + 0.45 * u_organization) +
      denseOvercast * 0.34 +
      bandEnvelope * spiral * 0.58,
      0.0,
      1.0
    );
    float coldTopC = mix(-38.0, -82.0, u_intensity * u_organization);
    float brightnessC = mix(sstC, coldTopC, cloud);
    float enhanced = clamp((8.0 - brightnessC) / 88.0, 0.0, 1.0);
    vec3 color = fiveStop(
      enhanced,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    o = vec4(color, (0.58 + 0.38 * cloud) * u_fade);
    return;
  }

  if (u_mode == 2) {
    float value = clamp((sstC - 24.0) / 8.0, 0.0, 1.0);
    vec3 color = fiveStop(
      value,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    o = vec4(color, (1.0 - step(0.5, land)) * 0.84 * u_fade);
    return;
  }

  if (u_mode == 3) {
    float value = mix(
      texture(u_rh, v_uv).r,
      texture(u_rhNext, v_uv).r,
      u_planeBlend
    );
    vec3 color = fiveStop(
      value,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    o = vec4(color, 0.82 * u_fade);
    return;
  }

  if (u_mode == 4) {
    float value = mix(
      texture(u_ohc, v_uv).r,
      texture(u_ohcNext, v_uv).r,
      u_planeBlend
    );
    vec3 color = fiveStop(
      value,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    o = vec4(color, (1.0 - step(0.5, land)) * 0.84 * u_fade);
    return;
  }

  if (u_mode == 5) {
    float value = mix(
      texture(u_shear, v_uv).r,
      texture(u_shearNext, v_uv).r,
      u_planeBlend
    );
    vec3 color = fiveStop(
      value,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    o = vec4(color, 0.80 * u_fade);
    return;
  }

  // Rain-radar mode: a cold, low-luminance plate beneath the rain accumulator.
  o = vec4(u_rainPlate, 0.72 * u_fade);
}`;

const MODE: Record<WeatherLayerId, number> = {
  terrain: 0,
  infrared: 1,
  sst: 2,
  humidity: 3,
  ohc: 4,
  shear: 5,
  rain: 6,
};

const PALETTE: Record<WeatherLayerId, readonly [
  keyof typeof TOKENS,
  keyof typeof TOKENS,
  keyof typeof TOKENS,
  keyof typeof TOKENS,
  keyof typeof TOKENS,
]> = {
  terrain: ['sst0', 'sst1', 'sst2', 'sst3', 'sst4'],
  infrared: ['ir0', 'ir1', 'ir2', 'ir3', 'ir4'],
  sst: ['sst0', 'sst1', 'sst2', 'sst3', 'sst4'],
  humidity: ['rh0', 'rh1', 'rh2', 'rh3', 'rh4'],
  ohc: ['ohc0', 'ohc1', 'ohc2', 'ohc3', 'ohc4'],
  shear: ['shear0', 'shear1', 'shear2', 'shear3', 'shear4'],
  rain: ['radar0', 'radar1', 'radar2', 'radar3', 'radar4'],
};

export class EnvLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
  }

  resize(_width: number, _height: number): void {
    /* fullscreen pass */
  }

  draw(ctx: DrawCtx, gpu: GpuTextures, fade: number): void {
    const gl = this.gl;
    if (
      !this.prog ||
      !gpu.sst ||
      !gpu.sstNext ||
      !gpu.land ||
      !gpu.humidity ||
      !gpu.humidityNext ||
      !gpu.ohc ||
      !gpu.ohcNext ||
      !gpu.shear ||
      !gpu.shearNext
    ) {
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const u = (name: string) => gl.getUniformLocation(this.prog!, name);
    const bind = (unit: number, texture: WebGLTexture, name: string): void => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(u(name), unit);
    };
    bind(0, gpu.sst, 'u_sst');
    bind(1, gpu.sstNext, 'u_sstNext');
    bind(2, gpu.humidity, 'u_rh');
    bind(3, gpu.humidityNext, 'u_rhNext');
    bind(4, gpu.ohc, 'u_ohc');
    bind(5, gpu.ohcNext, 'u_ohcNext');
    bind(6, gpu.shear, 'u_shear');
    bind(7, gpu.shearNext, 'u_shearNext');
    bind(8, gpu.land, 'u_land');
    gl.uniform1f(u('u_planeBlend'), gpu.envBlend);
    gl.uniform2f(u('u_sstRange'), SST_MIN_C, SST_MAX_C);
    gl.uniform4fv(u('u_warm'), TOKENS.sstWarm.rgba01);
    gl.uniform1f(u('u_fade'), fade);
    gl.uniform1i(u('u_mode'), MODE[ctx.weatherLayer]);
    gl.uniform1f(u('u_hasStorm'), ctx.centerClip ? 1 : 0);
    gl.uniform2f(
      u('u_center'),
      ctx.centerClip?.x ?? 0,
      ctx.centerClip?.y ?? 0,
    );
    gl.uniform1f(
      u('u_rMax'),
      ctx.structure ? Math.max(0.008, ctx.structure.rmwKm / 666) : 0.04,
    );
    gl.uniform1f(u('u_intensity'), ctx.intensity01);
    gl.uniform1f(
      u('u_organization'),
      ctx.frame.storm?.organization ?? 0,
    );
    gl.uniform1f(u('u_ageH'), ctx.frame.storm?.ageH ?? 0);
    const palette = PALETTE[ctx.weatherLayer];
    for (let i = 0; i < palette.length; i += 1) {
      gl.uniform3fv(
        u(`u_palette${i}`),
        TOKENS[palette[i]].rgba01.subarray(0, 3),
      );
    }
    gl.uniform3fv(
      u('u_rainPlate'),
      TOKENS.rainPlate.rgba01.subarray(0, 3),
    );
    const latitude = ctx.frame.storm?.lat ?? 21;
    gl.uniform1f(
      u('u_metricX'),
      (20 * Math.cos((latitude * Math.PI) / 180)) / 12,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.prog = null;
    this.vao = null;
  }
}
