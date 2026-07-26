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
import type { SatellitePaletteId, WeatherLayerId } from '../weather-layers';
import { cloudNoiseBytes } from './cloud-noise';
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
uniform sampler2D u_steerU;
uniform sampler2D u_steerUNext;
uniform sampler2D u_steerV;
uniform sampler2D u_steerVNext;
uniform sampler2D u_rainTotal;
uniform sampler2D u_land;
uniform sampler2D u_cloudNoise;
uniform float u_hasSteer;
uniform float u_hasAccum;
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
uniform float u_vmaxMs;
uniform float u_hollandB;
uniform float u_stormPresence;
uniform vec2 u_shearVector;
uniform float u_shearAtStorm;
uniform vec2 u_steerAtStorm;
uniform float u_midlevelRh;
uniform float u_eyewallRain;
uniform float u_rainbandRain;
uniform float u_cloudDetail;
uniform float u_cloudSeed;
uniform int u_satellitePalette;
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

float cloudNoise(vec2 p) {
  vec4 broad = texture(u_cloudNoise, p * 0.10);
  vec4 fine = texture(u_cloudNoise, p * 0.235 + vec2(0.173, 0.619));
  return dot(broad, vec4(0.38, 0.17, 0.10, 0.07)) +
    dot(fine, vec4(0.13, 0.07, 0.05, 0.03));
}

mat2 rotate2(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

struct CloudField {
  float cloud;
  float stormCloud;
  float ambientCloud;
  float brightnessC;
  float convectiveCells;
};

CloudField sampleCloud(float land, float sstC) {
  vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
  vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
  float rMax = max(0.008, u_rMax);
  float q = length(radial) / rMax;

  // The cold canopy drifts downshear while the eye and eyewall remain tied to
  // the surface vortex. This creates the asymmetric shield visible in real IR.
  vec2 shearDir = length(u_shearVector) > 0.05
    ? normalize(u_shearVector)
    : vec2(0.78, 0.62);
  float shearN = smoothstep(7.0, 27.0, u_shearAtStorm);
  vec2 canopyRadial = radial - shearDir * rMax * shearN * 0.82;
  float canopyQ = length(canopyRadial) / rMax;
  float azimuth = atan(canopyRadial.y, canopyRadial.x);
  float rotation = u_ageH * 0.028;

  // Domain-warped, storm-relative noise keeps clouds spatially coherent as
  // the vortex moves. The lower mobile tier uses one fine noise sample rather
  // than a second four-octave field.
  float seed = u_cloudSeed;
  float twist = 0.72 * log(1.0 + canopyQ) - rotation;
  vec2 spiralSpace = rotate2(twist) * (canopyRadial / rMax);
  vec2 drift = vec2(u_ageH * 0.012, -u_ageH * 0.007) + shearDir * u_ageH * 0.005;
  float macro = cloudNoise(spiralSpace * 0.62 + drift + seed * 11.0);
  float fine = u_cloudDetail > 0.5
    ? cloudNoise(spiralSpace * 1.95 - drift * 1.8 + vec2(macro * 2.4, seed * 5.0))
    : texture(u_cloudNoise, spiralSpace * 0.022 - drift * 0.018 + seed).g;

  // A faint synoptic deck prevents the ocean outside the cyclone from
  // becoming an implausibly empty plate. It follows the exact baked humidity
  // plane and advects with the sampled steering vector.
  vec2 synopticDrift = vec2(u_steerAtStorm.x, -u_steerAtStorm.y) * u_ageH * 0.0012;
  vec2 synopticP = v_uv * vec2(8.0, 5.2) - synopticDrift + seed * 3.0;
  float synopticNoise = cloudNoise(synopticP * 1.35 + 9.7);
  float localRh = mix(texture(u_rh, v_uv).r, texture(u_rhNext, v_uv).r, u_planeBlend);
  float ambientGate = synopticNoise + localRh * 0.38;
  float ambientCloud = smoothstep(0.59, 0.88, ambientGate) *
    mix(0.12, 0.52, smoothstep(0.35, 0.86, localRh));

  float moisture = clamp((u_midlevelRh - 0.25) / 0.62, 0.0, 1.0);
  float rainEnergy = clamp((u_eyewallRain + 0.7 * u_rainbandRain) / 28.0, 0.0, 1.0);
  float development = clamp(0.56 * u_organization + 0.44 * u_intensity, 0.0, 1.0);
  float coreRadius = mix(2.25, 3.55, development) * mix(1.0, 0.86, shearN);
  // Incipient and sheared systems form a lopsided, ragged CDO rather than a
  // mathematically circular disc. Mature organization gradually suppresses
  // that radial perturbation without removing the underlying cloud texture.
  float coreIrregularity = mix(0.34, 0.12, smoothstep(0.38, 0.82, u_organization));
  float irregularCoreRadius = coreRadius * mix(
    1.0 - coreIrregularity,
    1.0 + coreIrregularity,
    macro
  );
  float centralOvercast = exp(-pow(canopyQ / irregularCoreRadius, 2.0));
  float eyewall = exp(-pow((q - 1.0) / mix(0.46, 0.27, u_organization), 2.0));
  float outerBandRadius = mix(6.35, 8.8, smoothstep(0.30, 0.84, development));
  float bandEnvelope = smoothstep(1.25, 1.85, canopyQ) *
    (1.0 - smoothstep(outerBandRadius - 2.6, outerBandRadius, canopyQ));
  float bandPhase =
    2.35 * azimuth - 1.52 * canopyQ + rotation + (macro - 0.5) * 4.6;
  float primaryBand = smoothstep(0.18, 0.76, 0.5 + 0.5 * sin(bandPhase));
  float secondaryBand = smoothstep(
    0.30,
    0.82,
    0.5 + 0.5 * sin(3.7 * azimuth - 0.88 * canopyQ - rotation * 0.5 + fine)
  );
  float convectiveCells = smoothstep(0.36, 0.78, fine * 0.74 + macro * 0.34);
  float bandCoherence = smoothstep(0.42, 0.78, u_organization) *
    smoothstep(0.12, 0.52, u_intensity);
  float brokenBand = smoothstep(0.28, 0.72, macro * 0.62 + fine * 0.42) *
    mix(0.48, 1.0, primaryBand);
  float bandShape = mix(brokenBand, max(primaryBand, secondaryBand * 0.58), bandCoherence);

  float coreCloud = centralOvercast *
    mix(0.70, 1.0, development) * mix(0.88, 1.0, macro);
  float eyewallMaturity = smoothstep(0.30, 0.68, u_intensity) *
    smoothstep(0.40, 0.72, u_organization);
  float eyewallCloud = eyewall * eyewallMaturity * mix(0.48, 1.0, rainEnergy) *
    mix(0.68, 1.0, convectiveCells);
  float rainbands = bandEnvelope *
    bandShape *
    mix(0.42, 0.96, moisture) *
    mix(0.46, 1.0, convectiveCells) *
    mix(0.62, 1.0, development);

  vec2 canopyDir = canopyQ > 0.001 ? canopyRadial / (canopyQ * rMax) : shearDir;
  float upshear = max(0.0, dot(canopyDir, -shearDir));
  float shearErosion = 1.0 - shearN * upshear * mix(0.28, 0.62, 1.0 - moisture);
  float cirrusTexture = smoothstep(
    0.24,
    0.74,
    texture(
      u_cloudNoise,
      vec2(dot(spiralSpace, vec2(-shearDir.y, shearDir.x)) * 0.029,
           dot(spiralSpace, shearDir) * 0.011) + drift * 0.018
    ).b
  );
  float cirrus = exp(-pow(canopyQ / 5.8, 1.55)) * cirrusTexture *
    mix(0.16, 0.38, u_organization) * mix(0.82, 1.16, shearN);

  float eyeStrength = smoothstep(0.18, 0.56, u_intensity * u_organization) *
    smoothstep(0.62, 0.82, u_organization);
  float eye = 1.0 - smoothstep(0.18, mix(0.46, 0.68, eyeStrength), q);
  float stormCloud = clamp(
    (coreCloud + eyewallCloud + rainbands + cirrus) * shearErosion,
    0.0,
    1.0
  );
  stormCloud *= 1.0 - eye * eyeStrength * 0.97;
  stormCloud *= u_stormPresence;
  float cloud = max(ambientCloud * (1.0 - centralOvercast * u_stormPresence), stormCloud);

  float surfaceC = mix(sstC, 34.0, smoothstep(0.35, 0.65, land));
  float ambientTopC = mix(-8.0, -42.0, synopticNoise * localRh);
  float stormTopC = mix(
    -35.0,
    -82.0,
    clamp(0.52 * u_intensity + 0.48 * u_organization, 0.0, 1.0)
  );
  float towerCooling = 13.0 * convectiveCells * rainEnergy *
    max(eyewall, rainbands);
  float brightnessC = mix(surfaceC, ambientTopC, ambientCloud);
  brightnessC = mix(brightnessC, stormTopC - towerCooling, stormCloud);
  brightnessC = mix(brightnessC, surfaceC - 4.0, eye * eyeStrength * u_stormPresence);
  return CloudField(cloud, stormCloud, ambientCloud, brightnessC, convectiveCells);
}

vec4 addCloudContext(vec3 baseColor, float baseAlpha, CloudField field, float strength) {
  float textureLift = mix(0.68, 1.0, field.convectiveCells);
  float cloudAlpha = pow(field.cloud, 0.76) * strength * textureLift;
  vec3 cloudColor = mix(vec3(0.61, 0.66, 0.68), vec3(0.93, 0.95, 0.94), field.stormCloud);
  return vec4(mix(baseColor, cloudColor, cloudAlpha), max(baseAlpha, cloudAlpha * 0.86));
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
    CloudField field = sampleCloud(land, sstC);
    vec4 composed = addCloudContext(u_warm.rgb, alpha / max(u_fade, 0.001), field, 0.26);
    o = vec4(composed.rgb, composed.a * u_fade);
    return;
  }

  if (u_mode == 1) {
    CloudField field = sampleCloud(land, sstC);
    // Stretch roughly +20…-70 C into display luminance. This preserves dark
    // land/sea while letting deep convective tops reach the white end of both
    // operational grayscale and enhanced-IR palettes.
    float enhanced = clamp((20.0 - field.brightnessC) / 90.0, 0.0, 1.0);
    vec3 color;
    if (u_satellitePalette == 1) {
      color = vec3(pow(enhanced, 0.82));
    } else if (u_satellitePalette == 2) {
      vec3 surface = mix(vec3(0.025, 0.075, 0.105), vec3(0.22, 0.19, 0.14), land);
      vec3 litCloud = mix(vec3(0.64, 0.67, 0.67), vec3(0.98), field.convectiveCells);
      color = mix(surface, litCloud, pow(field.cloud, 0.70));
    } else {
      color = fiveStop(
        enhanced,
        u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
      );
    }
    o = vec4(color, (0.62 + 0.36 * field.cloud) * u_fade);
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

  // Wind-flow fill: |baked steering + a symmetric Holland vortex| in m/s,
  // coloured 0..50. The particle trails on top carry direction; this plate
  // carries magnitude, Windy-style.
  if (u_mode == 7) {
    vec2 steer = u_hasSteer * (vec2(
      mix(texture(u_steerU, v_uv).r, texture(u_steerUNext, v_uv).r, u_planeBlend),
      mix(texture(u_steerV, v_uv).r, texture(u_steerVNext, v_uv).r, u_planeBlend)
    ) * 50.0 - vec2(25.0));
    vec2 wind = steer;
    if (u_hasStorm > 0.5) {
      vec2 cell = vec2(v_uv.x * 2.0 - 1.0, 1.0 - v_uv.y * 2.0);
      vec2 radial = vec2((cell.x - u_center.x) * u_metricX, cell.y - u_center.y);
      float r = length(radial);
      if (r > 1e-5) {
        float x = min(80.0, pow(max(0.008, u_rMax) / r, u_hollandB));
        float spd = u_vmaxMs * sqrt(max(0.0, x * exp(1.0 - x)));
        vec2 ru = radial / r;
        vec2 t = vec2(-ru.y, ru.x); // CCW tangential
        vec2 dir = 0.94 * t - 0.34 * ru; // ~20-degree low-level inflow
        wind += dir * spd;
      }
    }
    float speed = length(wind);
    float speedN = clamp(speed / 50.0, 0.0, 1.0);
    vec3 color = fiveStop(
      speedN,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    // Calm stays near-transparent so the chart shows through; strong wind
    // saturates — the Windy read where the field glows only where it matters.
    CloudField field = sampleCloud(land, sstC);
    vec4 composed = addCloudContext(color, 0.22 + 0.5 * speedN, field, 0.13);
    o = vec4(composed.rgb, composed.a * u_fade);
    return;
  }

  // Fixed-window or storm-total rainfall. The CPU ledger maps each window's
  // physical mm breaks onto 0..1 before this texture reaches the shader.
  if (u_mode == 8) {
    float mmN = u_hasAccum * texture(u_rainTotal, v_uv).r;
    vec3 color = fiveStop(
      mmN,
      u_palette0, u_palette1, u_palette2, u_palette3, u_palette4
    );
    float alpha = smoothstep(0.008, 0.07, mmN) * 0.85;
    CloudField field = sampleCloud(land, sstC);
    vec4 composed = addCloudContext(color, alpha, field, 0.10);
    o = vec4(composed.rgb, composed.a * u_fade);
    return;
  }

  // Rain-radar mode: a cold, low-luminance plate beneath the rain accumulator.
  CloudField field = sampleCloud(land, sstC);
  vec4 composed = addCloudContext(u_rainPlate, 0.72, field, 0.18);
  o = vec4(composed.rgb, composed.a * u_fade);
}`;

const MODE: Record<WeatherLayerId, number> = {
  terrain: 0,
  infrared: 1,
  sst: 2,
  humidity: 3,
  ohc: 4,
  shear: 5,
  rain: 6,
  wind: 7,
  accum: 8,
};

const SATELLITE_PALETTE_MODE: Record<SatellitePaletteId, number> = {
  enhanced: 0,
  grayscale: 1,
  visible: 2,
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
  wind: ['wind0', 'wind1', 'wind2', 'wind3', 'wind4'],
  accum: ['precip0', 'precip1', 'precip2', 'precip3', 'precip4'],
};

export class EnvLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private cloudNoise: WebGLTexture | null = null;
  private satellitePalette: SatellitePaletteId = 'enhanced';

  setSatellitePalette(palette: SatellitePaletteId): void {
    this.satellitePalette = palette;
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    this.cloudNoise = this.createCloudNoiseTexture();
  }

  private createCloudNoiseTexture(): WebGLTexture | null {
    const gl = this.gl;
    const size = 128;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      cloudNoiseBytes(size),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
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
      !gpu.shearNext ||
      !this.cloudNoise
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
    // Dummy-bind absent steering/accum textures (sampling them is gated by
    // u_hasSteer / near-zero alpha) so no unit is left on a stale texture.
    const hasSteer = Boolean(
      gpu.steerU && gpu.steerUNext && gpu.steerV && gpu.steerVNext,
    );
    bind(9, gpu.steerU ?? gpu.land, 'u_steerU');
    bind(10, gpu.steerUNext ?? gpu.land, 'u_steerUNext');
    bind(11, gpu.steerV ?? gpu.land, 'u_steerV');
    bind(12, gpu.steerVNext ?? gpu.land, 'u_steerVNext');
    bind(13, gpu.rainAccum ?? gpu.land, 'u_rainTotal');
    bind(14, this.cloudNoise, 'u_cloudNoise');
    gl.uniform1f(u('u_hasSteer'), hasSteer ? 1 : 0);
    gl.uniform1f(u('u_hasAccum'), gpu.rainAccum ? 1 : 0);
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
    gl.uniform1f(u('u_vmaxMs'), (ctx.structure?.maximumWindKt ?? 0) * 0.514444);
    gl.uniform1f(u('u_hollandB'), ctx.structure?.hollandB ?? 1.35);
    gl.uniform1f(
      u('u_stormPresence'),
      ctx.centerClip ? ctx.aftermath * (ctx.demo ? 0.78 : 1) : 0,
    );
    gl.uniform2f(
      u('u_shearVector'),
      ctx.env?.shearU ?? ctx.structure?.shearUms ?? 0,
      ctx.env?.shearV ?? ctx.structure?.shearVms ?? 0,
    );
    gl.uniform1f(
      u('u_shearAtStorm'),
      ctx.env?.shear ?? ctx.frame.storm?.diagnostics.shearMs ?? 0,
    );
    gl.uniform2f(
      u('u_steerAtStorm'),
      ctx.env?.steerU ?? 0,
      ctx.env?.steerV ?? 0,
    );
    gl.uniform1f(
      u('u_midlevelRh'),
      Math.max(
        0,
        Math.min(
          1,
          (ctx.frame.storm?.diagnostics.ventilationMeanRhPct ??
            ctx.env?.midlevelRhPct ??
            55) / 100,
        ),
      ),
    );
    gl.uniform1f(
      u('u_eyewallRain'),
      ctx.frame.storm?.diagnostics.eyewallRainMmH ?? 0,
    );
    gl.uniform1f(
      u('u_rainbandRain'),
      ctx.frame.storm?.diagnostics.rainbandRainMmH ?? 0,
    );
    gl.uniform1f(
      u('u_cloudDetail'),
      !ctx.reduced && ctx.width >= 720 ? 1 : 0,
    );
    const genesis = ctx.track?.[0];
    const seedWave = genesis
      ? Math.sin(genesis.lon * 12.9898 + genesis.lat * 78.233) * 43758.5453
      : 0.417;
    gl.uniform1f(u('u_cloudSeed'), seedWave - Math.floor(seedWave));
    gl.uniform1i(
      u('u_satellitePalette'),
      SATELLITE_PALETTE_MODE[this.satellitePalette],
    );
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
    if (this.cloudNoise) gl.deleteTexture(this.cloudNoise);
    this.prog = null;
    this.vao = null;
    this.cloudNoise = null;
  }
}
