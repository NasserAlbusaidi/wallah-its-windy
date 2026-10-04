/**
 * cloud-light.ts — sun lighting and cast shadows for the SIMULATED visible
 * palette.
 *
 * The env pass evaluates the cloud field once into a screen-registered
 * offscreen target (cloud cover, cloud-top height proxy, convective texture,
 * visible relief); this pass reads that packed field back and shades it:
 * normals from smooth central differences of cloud-top height, a fixed
 * north-west sun matching the terrain key light, and shadows marched toward
 * the sun so tall tops darken lower decks and the sea beside them.
 *
 * Display-only. It re-reads the proxy field after the fact and never feeds
 * anything back, so the realism harness (which mirrors the field itself, not
 * its colouring) is unaffected. Height-proxy scale lives in
 * {@link CLOUD_TOP_PACK_KM}; slopes are converted to per-km so the lighting
 * holds under camera zoom.
 */

import { TOKENS } from '../tokens';
import { DOMAIN } from '../grid';
import {
  VIEW_QUAD_VS,
  disposeRenderTarget,
  makeProgram,
  makeQuadVao,
  makeRenderTarget,
  setViewUniform,
} from './gl-utils';
import type { GlCaps, RenderTarget } from './gl-utils';
import type { ViewTransform } from '../types';

/** Cloud-top height proxy packed as height / CLOUD_TOP_PACK_KM into [0,1]. */
export const CLOUD_TOP_PACK_KM = 18;
/** Visible relief is packed scaled by this so its ~[0.74,1.18] range fits [0,1]. */
export const CLOUD_RELIEF_PACK = 0.8;

const KM_PER_DEGREE = 111.195;
const DOMAIN_HEIGHT_KM = (DOMAIN.latMax - DOMAIN.latMin) * KM_PER_DEGREE;
const DOMAIN_WIDTH_KM =
  (DOMAIN.lonMax - DOMAIN.lonMin) * KM_PER_DEGREE *
  Math.cos((((DOMAIN.latMin + DOMAIN.latMax) / 2) * Math.PI) / 180);

/**
 * Vertical exaggeration of cloud-top slopes. True tops change ~15 km over
 * tens of km, which lights almost flat at true scale.
 */
const RELIEF_GAIN = 4.0;
/** Tangent of the decorative sun elevation (~24°): sets shadow length. */
const SUN_TAN_ELEVATION = 0.45;
/** Normal sampling radius in km (clamped to at least one target texel). */
const NORMAL_RADIUS_KM = 3.5;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_data;
uniform sampler2D u_land;
uniform vec2 u_texel;
uniform vec2 u_kmPerPx;
uniform float u_fade;
uniform float u_detail;
uniform vec3 u_sea;
uniform vec3 u_landTint;
uniform vec3 u_shade;
uniform vec3 u_lit;
uniform vec3 u_shadowTint;

const vec2 SUN_XY = vec2(-0.7071, 0.7071);
const vec3 SUN_DIR = vec3(-0.5486, 0.5486, 0.6310);

float topKm(vec2 st) {
  return texture(u_data, st).g * ${CLOUD_TOP_PACK_KM.toFixed(1)};
}

void main() {
  if (any(lessThan(v_uv, vec2(0.0))) || any(greaterThan(v_uv, vec2(1.0)))) discard;
  vec2 st = gl_FragCoord.xy * u_texel;
  vec4 packed = texture(u_data, st);
  float cloudA = packed.r;
  float h = packed.g * ${CLOUD_TOP_PACK_KM.toFixed(1)};
  float cells = packed.b;
  float relief = packed.a / ${CLOUD_RELIEF_PACK.toFixed(2)};

  // Smooth central-difference normal over a fixed physical radius.
  vec2 radiusPx = max(vec2(1.0), vec2(${NORMAL_RADIUS_KM.toFixed(1)}) / u_kmPerPx);
  vec2 dx = vec2(radiusPx.x * u_texel.x, 0.0);
  vec2 dy = vec2(0.0, radiusPx.y * u_texel.y);
  vec2 grad = vec2(
    (topKm(st + dx) - topKm(st - dx)) / (2.0 * radiusPx.x * u_kmPerPx.x),
    (topKm(st + dy) - topKm(st - dy)) / (2.0 * radiusPx.y * u_kmPerPx.y)
  );
  vec3 normal = normalize(vec3(-grad * ${RELIEF_GAIN.toFixed(1)}, 1.0));
  float sun = max(dot(normal, SUN_DIR), 0.0) / SUN_DIR.z;

  // Shadow: march toward the sun; a top that rises above this point's sun
  // ray occludes it. Detail tier only (six taps).
  float occlusion = 0.0;
  if (u_detail > 0.5) {
    for (int i = 1; i <= 6; i++) {
      float tKm = float(i) * 5.5;
      vec2 tap = st + SUN_XY * (tKm / u_kmPerPx) * u_texel;
      float rise = topKm(tap) - (h + tKm * ${SUN_TAN_ELEVATION.toFixed(2)});
      occlusion = max(occlusion, smoothstep(0.0, 2.2, rise) * (1.0 - float(i) * 0.09));
    }
  }

  float land = texture(u_land, v_uv).r;
  vec3 surface = mix(u_sea, u_landTint, land) * mix(1.0, 0.38, occlusion);
  // Reflectance follows optical depth, not cover: thin high veils stay
  // translucent and grey; deep towers (tall tops, convective texture) whiten.
  float depth = smoothstep(1.5, 14.0, h);
  float opacity = clamp(cloudA * mix(0.55, 1.0, depth) * mix(0.8, 1.0, cells), 0.0, 1.0);
  vec3 cloud = mix(u_shade, u_lit, clamp(cells * 0.6 + depth * 0.6, 0.0, 1.0)) * relief;
  cloud = mix(cloud * u_shadowTint, cloud * 1.12, smoothstep(0.15, 1.45, sun));
  cloud *= mix(1.0, 0.58, occlusion);
  vec3 color = mix(surface, cloud, opacity);
  cloudA = opacity;
  float clearAlpha = mix(0.46, 0.8, occlusion);
  o = vec4(color, mix(clearAlpha, 0.99, cloudA) * u_fade);
}`;

/** Uniform name -> token for this pass's palette. */
const COLOURS = [
  ['u_sea', 'visSea'],
  ['u_landTint', 'visLand'],
  ['u_shade', 'visCloudShade'],
  ['u_lit', 'visCloudLit'],
  ['u_shadowTint', 'visShadowTint'],
] as const satisfies readonly (readonly [string, keyof typeof TOKENS])[];

export class CloudLightPass {
  private gl!: WebGL2RenderingContext;
  private caps: GlCaps = { colorBufferFloat: false, floatLinear: false };
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private target: RenderTarget | null = null;
  private targetW = 0;
  private targetH = 0;

  init(gl: WebGL2RenderingContext, caps: GlCaps): void {
    this.gl = gl;
    this.caps = caps;
    this.prog = makeProgram(gl, VIEW_QUAD_VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    this.target = null;
    this.targetW = 0;
    this.targetH = 0;
  }

  /**
   * Bind (creating or resizing) the packed-field target and clear it. The
   * caller draws the env pass in pack mode, then calls {@link composite}.
   */
  begin(width: number, height: number): boolean {
    const gl = this.gl;
    if (!this.prog) return false;
    if (!this.target || this.targetW !== width || this.targetH !== height) {
      disposeRenderTarget(gl, this.target);
      // Height needs better than 8-bit steps or the normals terrace.
      this.target = makeRenderTarget(gl, width, height, this.caps);
      this.targetW = width;
      this.targetH = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  /** Shade the packed field onto the default framebuffer. */
  composite(
    view: ViewTransform,
    land: WebGLTexture,
    fade: number,
    detail: boolean,
  ): void {
    const gl = this.gl;
    if (!this.prog || !this.target) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.targetW, this.targetH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const u = (name: string) => gl.getUniformLocation(this.prog!, name);
    setViewUniform(gl, u('u_view'), view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target.tex);
    gl.uniform1i(u('u_data'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, land);
    gl.uniform1i(u('u_land'), 1);
    gl.uniform2f(u('u_texel'), 1 / this.targetW, 1 / this.targetH);
    gl.uniform2f(
      u('u_kmPerPx'),
      DOMAIN_WIDTH_KM / Math.max(1e-6, view.scaleX * this.targetW),
      DOMAIN_HEIGHT_KM / Math.max(1e-6, view.scaleY * this.targetH),
    );
    gl.uniform1f(u('u_fade'), fade);
    gl.uniform1f(u('u_detail'), detail ? 1 : 0);
    for (const [name, key] of COLOURS) {
      gl.uniform3fv(u(name), TOKENS[key].rgba01.subarray(0, 3));
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    disposeRenderTarget(gl, this.target);
    this.prog = null;
    this.vao = null;
    this.target = null;
    this.targetW = 0;
    this.targetH = 0;
  }
}
