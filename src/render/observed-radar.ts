/** Display-only pass for a timestamped observed radar mosaic. */

import { makeProgram, makeQuadVao } from './gl-utils';

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
uniform sampler2D u_coverage;
uniform float u_opacity;
uniform bool u_has_coverage;
uniform vec2 u_view_size;
void main() {
  vec4 observed = texture(u_frame, v_uv);
  // Provider alpha owns the distinction between no echo and colored return.
  // Pixels are never thresholded or converted into model rain rates here.
  float observedAlpha = observed.a * u_opacity;

  // RainViewer's coverage mask is transparent where radar coverage exists and
  // opaque where it does not. A sparse instrument hatch makes "not observed"
  // spatially distinct from a genuine transparent/no-echo radar pixel.
  float unavailable = u_has_coverage ? texture(u_coverage, v_uv).a : 0.0;
  vec2 instrumentPx = gl_FragCoord.xy *
    (600.0 / max(1.0, u_view_size.y));
  float diagonal = smoothstep(
    0.91,
    0.97,
    fract((instrumentPx.x + instrumentPx.y) / 32.0)
  );
  float hatchAlpha =
    unavailable * (0.012 + 0.07 * diagonal) * u_opacity;
  vec3 hatchColor = vec3(0.18, 0.52, 0.61);
  float outAlpha = observedAlpha + hatchAlpha * (1.0 - observedAlpha);
  vec3 premultiplied =
    observed.rgb * observedAlpha +
    hatchColor * hatchAlpha * (1.0 - observedAlpha);
  o = outAlpha > 0.0001
    ? vec4(premultiplied / outAlpha, outAlpha)
    : vec4(0.0);
}`;

export class ObservedRadarLayer {
  private gl!: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private coverageTexture: WebGLTexture | null = null;
  private ready = false;
  private coverageReady = false;
  private width = 1;
  private height = 1;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.program);
    this.texture = this.makeEmptyTexture();
    this.coverageTexture = this.makeEmptyTexture();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  hasFrame(): boolean {
    return this.ready && this.texture !== null;
  }

  clearFrame(): void {
    this.ready = false;
  }

  setFrame(image: TexImageSource): void {
    if (!this.texture) this.texture = this.makeEmptyTexture();
    if (!this.texture) return;
    this.upload(this.texture, image);
    this.ready = true;
  }

  setCoverage(image: TexImageSource | null): void {
    if (!image) {
      this.coverageReady = false;
      return;
    }
    if (!this.coverageTexture) this.coverageTexture = this.makeEmptyTexture();
    if (!this.coverageTexture) return;
    this.upload(this.coverageTexture, image);
    this.coverageReady = true;
  }

  draw(opacity: number): void {
    const gl = this.gl;
    if (
      !this.ready ||
      !this.texture ||
      !this.program ||
      !this.vao ||
      opacity <= 0.001
    ) {
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.coverageTexture);
    const u = (name: string) => gl.getUniformLocation(this.program!, name);
    gl.uniform1i(u('u_frame'), 0);
    gl.uniform1i(u('u_coverage'), 1);
    gl.uniform1f(u('u_opacity'), Math.max(0, Math.min(1, opacity)));
    gl.uniform1i(u('u_has_coverage'), this.coverageReady ? 1 : 0);
    gl.uniform2f(u('u_view_size'), this.width, this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  private makeEmptyTexture(): WebGLTexture | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private upload(texture: WebGLTexture, image: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.coverageTexture) gl.deleteTexture(this.coverageTexture);
    this.program = null;
    this.vao = null;
    this.texture = null;
    this.coverageTexture = null;
    this.ready = false;
    this.coverageReady = false;
  }
}
