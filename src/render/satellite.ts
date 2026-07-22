/** Observed satellite image pass. Pixels remain isolated from model physics. */

import type { SatelliteChannel } from '../satellite-observations';
import type { SatellitePaletteId } from '../weather-layers';
import { TOKENS } from '../tokens';
import { makeProgram, makeQuadVao } from './gl-utils';
import type { RenderModule } from './context';

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
uniform sampler2D u_frame;
uniform int u_palette;
uniform int u_channel;
uniform float u_opacity;
uniform vec3 u_palette0;
uniform vec3 u_palette1;
uniform vec3 u_palette2;
uniform vec3 u_palette3;
uniform vec3 u_palette4;

vec3 fiveStop(float value, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e) {
  float x = clamp(value, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(a, b, x);
  if (x < 2.0) return mix(b, c, x - 1.0);
  if (x < 3.0) return mix(c, d, x - 2.0);
  return mix(d, e, x - 3.0);
}

void main() {
  vec3 raw = texture(u_frame, v_uv).rgb;
  vec3 color = raw;
  // EUMETView IR is warm-dark/cold-bright. Recolour luminance only for the
  // enhanced palette; grayscale and true VIS0.6 remain provider pixels.
  if (u_channel == 0 && u_palette == 0) {
    float cold = dot(raw, vec3(0.299, 0.587, 0.114));
    color = fiveStop(cold, u_palette0, u_palette1, u_palette2, u_palette3, u_palette4);
  } else if (u_channel == 0 && u_palette == 1) {
    float luminance = dot(raw, vec3(0.299, 0.587, 0.114));
    color = vec3(luminance);
  }
  o = vec4(color, u_opacity);
}`;

const PALETTE_MODE: Record<SatellitePaletteId, number> = {
  enhanced: 0,
  grayscale: 1,
  visible: 2,
};

const IR_TOKENS = ['ir0', 'ir1', 'ir2', 'ir3', 'ir4'] as const;

export class ObservedSatelliteLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private palette: SatellitePaletteId = 'enhanced';
  private channel: SatelliteChannel = 'infrared';
  private ready = false;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    this.texture = gl.createTexture();
  }

  resize(_width: number, _height: number): void {
    /* full-screen domain pass */
  }

  setPalette(palette: SatellitePaletteId): void {
    this.palette = palette;
  }

  hasFrame(): boolean {
    return this.ready && this.texture !== null;
  }

  clearFrame(): void {
    this.ready = false;
  }

  setFrame(image: ImageBitmap, channel: SatelliteChannel): void {
    const gl = this.gl;
    if (!this.texture) this.texture = gl.createTexture();
    if (!this.texture) {
      image.close();
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.bindTexture(gl.TEXTURE_2D, null);
    image.close();
    this.channel = channel;
    this.ready = true;
  }

  draw(opacity: number): void {
    const gl = this.gl;
    if (!this.ready || !this.texture || !this.prog || !this.vao || opacity <= 0.001) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const u = (name: string) => gl.getUniformLocation(this.prog!, name);
    gl.uniform1i(u('u_frame'), 0);
    gl.uniform1i(u('u_palette'), PALETTE_MODE[this.palette]);
    gl.uniform1i(u('u_channel'), this.channel === 'infrared' ? 0 : 1);
    gl.uniform1f(u('u_opacity'), Math.max(0, Math.min(1, opacity)));
    for (let i = 0; i < IR_TOKENS.length; i += 1) {
      gl.uniform3fv(u(`u_palette${i}`), TOKENS[IR_TOKENS[i]].rgba01.subarray(0, 3));
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.texture) gl.deleteTexture(this.texture);
    this.prog = null;
    this.vao = null;
    this.texture = null;
    this.ready = false;
  }
}
