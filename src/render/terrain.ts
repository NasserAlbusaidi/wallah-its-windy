/**
 * terrain.ts — the opaque instrument base: hillshaded land + ocean depth tint.
 *
 * A single fullscreen pass reconstructs SIMULATION-domain UV from clip space
 * (north at the top, matching the BINARY-FORMATS row order). UV may be outside
 * [0,1] when the presentation-only camera shows the larger context domain. Those
 * coordinates are explicitly remapped into context-terrain.bin; they are never
 * clamped back onto the simulation edge. Inside the simulation box the original
 * higher-resolution terrain remains authoritative.
 */

import { TOKENS } from '../tokens';
import { DOMAIN } from '../grid';
import {
  DISPLAY_CONTEXT_DOMAIN,
  rasterUvTransform,
} from '../display-domain';
import { VIEW_QUAD_VS, makeProgram, makeQuadVao, setViewUniform } from './gl-utils';
import type { DrawCtx, GpuTextures, RenderModule } from './context';

/** Dimensionless vertical exaggeration applied after physical slope recovery. */
const RELIEF_EXAGGERATION = 10;
const KM_PER_LAT_DEGREE = 111.195;
const SIM_TO_CONTEXT_UV = rasterUvTransform(DOMAIN, DISPLAY_CONTEXT_DOMAIN);

const VS = VIEW_QUAD_VS;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;

uniform sampler2D u_elev;
uniform sampler2D u_land;
uniform sampler2D u_contextElev;
uniform sampler2D u_contextLand;
uniform vec2 u_detailTexel;
uniform vec2 u_contextTexel;
uniform vec2 u_detailCellKm;
uniform vec2 u_contextCellKm;
uniform vec4 u_simToContextUv;
uniform float u_detailRelief;
uniform float u_contextRelief;
uniform float u_detailFade;
uniform float u_contextFade;
uniform float u_hasDetail;
uniform float u_hasContext;
uniform vec4 u_oceanDeep;
uniform vec4 u_oceanShallow;
uniform vec4 u_terrain;
uniform vec4 u_ridgeHi;
uniform vec4 u_simBoundary;

float insideUnit(vec2 uv) {
  return step(0.0, uv.x) * step(uv.x, 1.0) *
         step(0.0, uv.y) * step(uv.y, 1.0);
}

vec3 surfaceColour(
  sampler2D elevTex,
  sampler2D landTex,
  vec2 uv,
  vec2 texel,
  vec2 cellKm,
  float relief,
  float showBathymetry
) {
  float centreElev = texture(elevTex, uv).r;
  float land = texture(landTex, uv).r;
  float eE = texture(elevTex, uv + vec2(texel.x, 0.0)).r;
  float eW = texture(elevTex, uv - vec2(texel.x, 0.0)).r;
  float eN = texture(elevTex, uv + vec2(0.0, -texel.y)).r;
  float eS = texture(elevTex, uv + vec2(0.0,  texel.y)).r;
  float eE4 = texture(elevTex, uv + vec2(texel.x * 4.0, 0.0)).r;
  float eW4 = texture(elevTex, uv - vec2(texel.x * 4.0, 0.0)).r;
  float eN4 = texture(elevTex, uv + vec2(0.0, -texel.y * 4.0)).r;
  float eS4 = texture(elevTex, uv + vec2(0.0,  texel.y * 4.0)).r;
  vec2 slopeFine = vec2(
    (eE - eW) / max(1.0, 2.0 * cellKm.x * 1000.0),
    (eN - eS) / max(1.0, 2.0 * cellKm.y * 1000.0)
  );
  vec2 slopeBroad = vec2(
    (eE4 - eW4) / max(1.0, 8.0 * cellKm.x * 1000.0),
    (eN4 - eS4) / max(1.0, 8.0 * cellKm.y * 1000.0)
  );
  vec3 nFine = normalize(vec3(-slopeFine * relief, 1.0));
  vec3 nBroad = normalize(vec3(
    -slopeBroad.x * relief,
    -slopeBroad.y * relief,
    1.0
  ));
  vec3 L = normalize(vec3(-0.6, 0.6, 0.8));
  float shade = mix(
    clamp(dot(nBroad, L), 0.0, 1.0),
    clamp(dot(nFine, L), 0.0, 1.0),
    0.68
  );
  shade = 0.35 + 0.65 * shade;
  float elevationTint = smoothstep(120.0, 3400.0, max(centreElev, 0.0));
  vec3 landBase = mix(u_terrain.rgb, u_ridgeHi.rgb, 0.12 + elevationTint * 0.5);
  vec3 landCol = landBase * mix(0.78, 1.18, shade);

  // Coastal shallow tint: blur the land mask a few texels to widen the band.
  float prox = 0.25 * (
    texture(landTex, uv + vec2( texel.x * 3.0, 0.0)).r +
    texture(landTex, uv + vec2(-texel.x * 3.0, 0.0)).r +
    texture(landTex, uv + vec2(0.0,  texel.y * 3.0)).r +
    texture(landTex, uv + vec2(0.0, -texel.y * 3.0)).r);
  float coastalShelf = smoothstep(0.05, 0.6, prox);

  // The context sidecar contains real negative GMRT elevations. Let depth and
  // its shaded gradient expose broad shelf/ridge structure instead of painting
  // every offshore context pixel as an invented flat ocean.
  float depth01 = clamp(max(-centreElev, 0.0) / 6000.0, 0.0, 1.0);
  float shelfFromDepth = (1.0 - smoothstep(0.02, 0.82, depth01)) * showBathymetry;
  float shallow = max(coastalShelf, shelfFromDepth * 0.58);
  vec3 oceanCol = mix(u_oceanDeep.rgb, u_oceanShallow.rgb, shallow);
  oceanCol *= mix(1.0, mix(0.78, 1.04, shade), showBathymetry);

  // Subtle real-depth contours improve chart legibility without inventing a
  // vector coastline or implying a nautical sounding product.
  float depthM = max(-centreElev, 0.0);
  float contourCoordinate = depthM / 500.0;
  float contourPhase = fract(contourCoordinate);
  float contourDistance = min(contourPhase, 1.0 - contourPhase);
  float contourWidth = clamp(fwidth(contourCoordinate) * 0.85, 0.003, 0.09);
  float depthContour =
    (1.0 - smoothstep(contourWidth, contourWidth * 2.2, contourDistance)) *
    smoothstep(80.0, 420.0, depthM) *
    showBathymetry;
  oceanCol = mix(oceanCol, u_oceanShallow.rgb, depthContour * 0.075);

  float coastline = 1.0 - smoothstep(0.025, 0.2, abs(land - 0.5));
  vec3 surface = land > 0.5 ? landCol : oceanCol;
  surface = mix(surface, u_ridgeHi.rgb, coastline * 0.24);

  return surface;
}

float simulationBoundary(vec2 uv) {
  float widthUv = max(max(fwidth(uv.x), fwidth(uv.y)), 0.00001);
  float verticalDistance = min(abs(uv.x), abs(uv.x - 1.0));
  float horizontalDistance = min(abs(uv.y), abs(uv.y - 1.0));
  float vertical = 1.0 - smoothstep(widthUv * 0.7, widthUv * 1.8, verticalDistance);
  float horizontal = 1.0 - smoothstep(widthUv * 0.7, widthUv * 1.8, horizontalDistance);
  vertical *= step(-widthUv, uv.y) * step(uv.y, 1.0 + widthUv);
  horizontal *= step(-widthUv, uv.x) * step(uv.x, 1.0 + widthUv);
  return max(vertical, horizontal);
}

void main() {
  vec2 contextUv = v_uv * u_simToContextUv.xy + u_simToContextUv.zw;
  float inSimulation = insideUnit(v_uv);
  float inContext = insideUnit(contextUv);

  vec3 contextCol = u_oceanDeep.rgb;
  if (u_hasContext > 0.5 && inContext > 0.5) {
    contextCol = surfaceColour(
      u_contextElev,
      u_contextLand,
      contextUv,
      u_contextTexel,
      u_contextCellKm,
      u_contextRelief,
      1.0
    );
    contextCol = mix(u_oceanDeep.rgb, contextCol, u_contextFade);
  }

  vec3 col = contextCol;
  if (u_hasDetail > 0.5 && inSimulation > 0.5) {
    vec3 detailCol = surfaceColour(
      u_elev,
      u_land,
      v_uv,
      u_detailTexel,
      u_detailCellKm,
      u_detailRelief,
      0.85
    );
    detailCol = mix(u_oceanDeep.rgb, detailCol, u_detailFade);
    float insideDistance = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    float feather = max(max(fwidth(v_uv.x), fwidth(v_uv.y)) * 1.5, 0.00001);
    float detailWeight = smoothstep(0.0, feather, insideDistance);
    col = mix(contextCol, detailCol, detailWeight);
  }

  float boundary = simulationBoundary(v_uv);
  float boundaryStrength = 0.2 * max(u_detailFade, u_contextFade);
  col = mix(col, u_simBoundary.rgb, boundary * boundaryStrength);
  o = vec4(col, 1.0);
}`;

interface Uniforms {
  view: WebGLUniformLocation | null;
  elev: WebGLUniformLocation | null;
  land: WebGLUniformLocation | null;
  contextElev: WebGLUniformLocation | null;
  contextLand: WebGLUniformLocation | null;
  detailTexel: WebGLUniformLocation | null;
  contextTexel: WebGLUniformLocation | null;
  detailCellKm: WebGLUniformLocation | null;
  contextCellKm: WebGLUniformLocation | null;
  simToContextUv: WebGLUniformLocation | null;
  detailRelief: WebGLUniformLocation | null;
  contextRelief: WebGLUniformLocation | null;
  detailFade: WebGLUniformLocation | null;
  contextFade: WebGLUniformLocation | null;
  hasDetail: WebGLUniformLocation | null;
  hasContext: WebGLUniformLocation | null;
  oceanDeep: WebGLUniformLocation | null;
  oceanShallow: WebGLUniformLocation | null;
  terrain: WebGLUniformLocation | null;
  ridgeHi: WebGLUniformLocation | null;
  simBoundary: WebGLUniformLocation | null;
}

export class TerrainLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private u!: Uniforms;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    const u = (n: string) => gl.getUniformLocation(this.prog!, n);
    this.u = {
      view: u('u_view'),
      elev: u('u_elev'),
      land: u('u_land'),
      contextElev: u('u_contextElev'),
      contextLand: u('u_contextLand'),
      detailTexel: u('u_detailTexel'),
      contextTexel: u('u_contextTexel'),
      detailCellKm: u('u_detailCellKm'),
      contextCellKm: u('u_contextCellKm'),
      simToContextUv: u('u_simToContextUv'),
      detailRelief: u('u_detailRelief'),
      contextRelief: u('u_contextRelief'),
      detailFade: u('u_detailFade'),
      contextFade: u('u_contextFade'),
      hasDetail: u('u_hasDetail'),
      hasContext: u('u_hasContext'),
      oceanDeep: u('u_oceanDeep'),
      oceanShallow: u('u_oceanShallow'),
      terrain: u('u_terrain'),
      ridgeHi: u('u_ridgeHi'),
      simBoundary: u('u_simBoundary'),
    };
  }

  resize(): void {
    /* fullscreen pass — nothing resolution-dependent to cache */
  }

  draw(
    ctx: DrawCtx,
    gpu: GpuTextures,
    detailFade: number,
    contextFade: number,
  ): void {
    const gl = this.gl;
    const hasDetail = Boolean(gpu.elev && gpu.land && gpu.terrainGrid);
    const hasContext = Boolean(
      gpu.contextElev && gpu.contextLand && gpu.contextTerrainGrid,
    );
    if (!this.prog || (!hasDetail && !hasContext)) return;
    const detailElev = gpu.elev ?? gpu.contextElev!;
    const detailLand = gpu.land ?? gpu.contextLand!;
    const detailGrid = gpu.terrainGrid ?? gpu.contextTerrainGrid!;
    const contextElev = gpu.contextElev ?? gpu.elev!;
    const contextLand = gpu.contextLand ?? gpu.land!;
    const contextGrid = gpu.contextTerrainGrid ?? gpu.terrainGrid!;
    gl.disable(gl.BLEND); // opaque base
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, detailElev);
    gl.uniform1i(this.u.elev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, detailLand);
    gl.uniform1i(this.u.land, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, contextElev);
    gl.uniform1i(this.u.contextElev, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, contextLand);
    gl.uniform1i(this.u.contextLand, 3);

    setViewUniform(gl, this.u.view, ctx.view);
    gl.uniform2f(this.u.detailTexel, 1 / detailGrid.nx, 1 / detailGrid.ny);
    gl.uniform2f(this.u.contextTexel, 1 / contextGrid.nx, 1 / contextGrid.ny);
    const cellKm = (grid: typeof detailGrid): { x: number; y: number } => {
      const centreLat = (grid.bbox.latMin + grid.bbox.latMax) / 2;
      return {
        x:
          ((grid.bbox.lonMax - grid.bbox.lonMin) * KM_PER_LAT_DEGREE *
            Math.cos((centreLat * Math.PI) / 180)) /
          grid.nx,
        y:
          ((grid.bbox.latMax - grid.bbox.latMin) * KM_PER_LAT_DEGREE) /
          grid.ny,
      };
    };
    const detailCellKm = cellKm(detailGrid);
    const contextCellKm = cellKm(contextGrid);
    gl.uniform2f(this.u.detailCellKm, detailCellKm.x, detailCellKm.y);
    gl.uniform2f(this.u.contextCellKm, contextCellKm.x, contextCellKm.y);
    gl.uniform4f(
      this.u.simToContextUv,
      SIM_TO_CONTEXT_UV.scaleX,
      SIM_TO_CONTEXT_UV.scaleY,
      SIM_TO_CONTEXT_UV.offsetX,
      SIM_TO_CONTEXT_UV.offsetY,
    );
    gl.uniform1f(this.u.detailRelief, RELIEF_EXAGGERATION);
    gl.uniform1f(this.u.contextRelief, RELIEF_EXAGGERATION);
    gl.uniform1f(this.u.detailFade, detailFade);
    gl.uniform1f(this.u.contextFade, contextFade);
    gl.uniform1f(this.u.hasDetail, hasDetail ? 1 : 0);
    gl.uniform1f(this.u.hasContext, hasContext ? 1 : 0);
    gl.uniform4fv(this.u.oceanDeep, TOKENS.oceanDeep.rgba01);
    gl.uniform4fv(this.u.oceanShallow, TOKENS.oceanShallow.rgba01);
    gl.uniform4fv(this.u.terrain, TOKENS.terrain.rgba01);
    gl.uniform4fv(this.u.ridgeHi, TOKENS.ridgeHi.rgba01);
    gl.uniform4fv(this.u.simBoundary, TOKENS.textDim.rgba01);

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
