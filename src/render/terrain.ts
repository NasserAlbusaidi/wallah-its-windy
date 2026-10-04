/**
 * terrain.ts — the opaque instrument base: hillshaded land + ocean depth tint.
 *
 * A single fullscreen pass reconstructs SIMULATION-domain UV from clip space
 * (north at the top, matching the BINARY-FORMATS row order). UV may be outside
 * [0,1] when the presentation-only camera shows the larger context domain. Those
 * coordinates are explicitly remapped into context-terrain.bin; they are never
 * clamped back onto the simulation edge. Inside the simulation box the original
 * higher-resolution terrain remains authoritative.
 *
 * The elevation and land textures are uploaded NEAREST because other passes
 * read them as exact values; this pass binds its own LINEAR sampler object so
 * relief and the coastline stay smooth under camera zoom without changing what
 * any other consumer of those textures sees.
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
/** Texture units this pass samples; its LINEAR sampler binds to each. */
const TERRAIN_UNITS = [0, 1, 2, 3] as const;

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
uniform vec4 u_abyss;
uniform vec4 u_basin;
uniform vec4 u_shelf;
uniform vec4 u_landLow;
uniform vec4 u_landHigh;
uniform vec4 u_landPeak;
uniform vec4 u_coast;
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

  // Anti-aliased land/sea split. A bilinear binary mask stair-steps at the
  // texel scale, so inside the one-texel coastal band (0 < mask < 1) the
  // continuous elevation takes over the 0.5 crossing. Away from the band the
  // mask alone decides, so below-sea-level land still reads as land.
  // The baked mask already carries multi-texel stair steps, so a small tent
  // blur (four diagonal bilinear taps) rounds them before the crossing.
  float landSoft = 0.2 * land + 0.2 * (
    texture(landTex, uv + texel * vec2( 0.9,  0.9)).r +
    texture(landTex, uv + texel * vec2(-0.9,  0.9)).r +
    texture(landTex, uv + texel * vec2( 0.9, -0.9)).r +
    texture(landTex, uv + texel * vec2(-0.9, -0.9)).r);
  float coastBand = 1.0 - abs(2.0 * landSoft - 1.0);
  float landField = mix(landSoft, 0.5 + 0.5 * clamp(centreElev / 12.0, -1.0, 1.0), coastBand * 0.5);
  float landAa = max(fwidth(landField), 1e-4);
  float landW = smoothstep(0.5 - landAa, 0.5 + landAa, landField);
  float coastPx = abs(landField - 0.5) / landAa;

  // Cartographic relief: a north-west key light plus a softer overhead-north
  // fill, normalised so flat ground shades to exactly 1. Sea-floor slopes are
  // far gentler than mountain flanks, so bathymetry gets extra exaggeration to
  // surface ridges and fracture zones that the depth tint alone flattens.
  // The sea floor leans on the broad normal: fine bathymetric gradients carry
  // survey-swath seams that a strong light would draw as straight scratches.
  float reliefGain = mix(relief * 3.4, relief, landW);
  vec3 nFine = normalize(vec3(-slopeFine * reliefGain, 1.0));
  vec3 nBroad = normalize(vec3(-slopeBroad * reliefGain, 1.0));
  vec3 n = normalize(mix(nBroad, nFine, mix(0.22, 0.62, landW)));
  vec3 keyL = normalize(vec3(-0.62, 0.62, 0.48));
  vec3 fillL = normalize(vec3(0.0, 0.45, 1.0));
  float lit = 0.66 * max(dot(n, keyL), 0.0) + 0.34 * max(dot(n, fillL), 0.0);
  float flatLit = 0.66 * keyL.z + 0.34 * fillL.z;
  float shade = clamp(lit / flatLit, 0.18, 1.7);

  // Broad curvature as cheap ambient occlusion: valleys (neighbours above the
  // centre) sink, crests catch light. Scaled per km² so both grids agree.
  float laplacian = (eE4 + eW4 + eN4 + eS4 - 4.0 * centreElev) /
    max(1.0, 16.0 * cellKm.x * cellKm.y);
  float occlusion = clamp(1.0 - laplacian * 0.010, 0.72, 1.18);

  // Hypsometric land: dark sand lowland, weathered-rock highland, pale summits.
  float elev = max(centreElev, 0.0);
  vec3 landBase = mix(u_landLow.rgb, u_landHigh.rgb, smoothstep(40.0, 1400.0, elev));
  landBase = mix(landBase, u_landPeak.rgb, smoothstep(1500.0, 3300.0, elev));
  vec3 landCol = landBase * mix(0.30, 1.0, smoothstep(0.18, 1.0, shade)) *
    mix(1.0, 1.32, smoothstep(1.0, 1.7, shade)) * occlusion;

  // Ocean: luminous continental shelf, a blue continental slope, a near-black
  // abyss. The coastal proximity term keeps the shelf readable where the
  // simulation terrain carries less fine bathymetry.
  float prox = 0.25 * (
    texture(landTex, uv + vec2( texel.x * 3.0, 0.0)).r +
    texture(landTex, uv + vec2(-texel.x * 3.0, 0.0)).r +
    texture(landTex, uv + vec2(0.0,  texel.y * 3.0)).r +
    texture(landTex, uv + vec2(0.0, -texel.y * 3.0)).r);
  float coastalShelf = smoothstep(0.04, 0.7, prox);
  float depthM = max(-centreElev, 0.0);
  float shelfFromDepth = (1.0 - smoothstep(60.0, 420.0, depthM)) * showBathymetry;
  float slopeFromDepth = (1.0 - smoothstep(300.0, 4600.0, depthM)) * showBathymetry;
  vec3 oceanCol = mix(u_abyss.rgb, u_basin.rgb, max(slopeFromDepth, coastalShelf * 0.6));
  oceanCol = mix(oceanCol, u_shelf.rgb, max(coastalShelf * 0.55, shelfFromDepth * 0.8));
  float seaShade = mix(1.0, clamp(shade, 0.4, 1.6), showBathymetry);
  oceanCol *= mix(0.62, 1.0, smoothstep(0.4, 1.0, seaShade)) *
    mix(1.0, 1.55, smoothstep(1.0, 1.6, seaShade));

  // Real-depth contours every 500 m, plus a stronger shelf-break line at
  // 200 m. Chart legibility only — never a nautical sounding product.
  float contourCoordinate = depthM / 500.0;
  float contourPhase = fract(contourCoordinate);
  float contourDistance = min(contourPhase, 1.0 - contourPhase);
  float contourWidth = clamp(fwidth(contourCoordinate) * 0.85, 0.003, 0.09);
  float depthContour =
    (1.0 - smoothstep(contourWidth, contourWidth * 2.2, contourDistance)) *
    smoothstep(80.0, 420.0, depthM) *
    showBathymetry;
  float breakDistance = abs(depthM - 200.0) / max(fwidth(depthM), 1.0);
  float shelfBreak = (1.0 - smoothstep(0.6, 1.6, breakDistance)) * showBathymetry;
  oceanCol = mix(oceanCol, u_shelf.rgb * 1.5, depthContour * 0.12 + shelfBreak * 0.16);

  vec3 surface = mix(oceanCol, landCol, landW);
  // A one-pixel luminous coastline with a soft seaward halo.
  float coastLine = 1.0 - smoothstep(0.6, 1.5, coastPx);
  float coastHalo = (1.0 - smoothstep(1.0, 6.0, coastPx)) * (1.0 - landW);
  surface = mix(surface, u_coast.rgb, coastLine * 0.42 + coastHalo * 0.07);

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
    // The context is presentation-only geography: keep it legible but
    // recessed, so the lit simulation box reads as the stage.
    float luma = dot(contextCol, vec3(0.299, 0.587, 0.114));
    contextCol = mix(vec3(luma), contextCol, 0.55) * 0.68;
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
  float boundaryStrength = 0.34 * max(u_detailFade, u_contextFade);
  col = mix(col, u_simBoundary.rgb, boundary * boundaryStrength);
  o = vec4(col, 1.0);
}`;

const COLOUR_UNIFORMS = {
  oceanDeep: 'u_oceanDeep',
  abyss: 'u_abyss',
  basin: 'u_basin',
  shelf: 'u_shelf',
  landLow: 'u_landLow',
  landHigh: 'u_landHigh',
  landPeak: 'u_landPeak',
  coast: 'u_coast',
} as const satisfies Partial<Record<keyof typeof TOKENS, string>>;

type ColourKey = keyof typeof COLOUR_UNIFORMS;

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
  colours: Record<ColourKey, WebGLUniformLocation | null>;
  simBoundary: WebGLUniformLocation | null;
}

export class TerrainLayer implements RenderModule {
  private gl!: WebGL2RenderingContext;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sampler: WebGLSampler | null = null;
  private u!: Uniforms;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = makeProgram(gl, VS, FS);
    this.vao = makeQuadVao(gl, this.prog);
    this.sampler = gl.createSampler();
    if (this.sampler) {
      gl.samplerParameteri(this.sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.samplerParameteri(this.sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(this.sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(this.sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    const u = (n: string) => gl.getUniformLocation(this.prog!, n);
    const colours = {} as Record<ColourKey, WebGLUniformLocation | null>;
    for (const key of Object.keys(COLOUR_UNIFORMS) as ColourKey[]) {
      colours[key] = u(COLOUR_UNIFORMS[key]);
    }
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
      colours,
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
    for (const unit of TERRAIN_UNITS) gl.bindSampler(unit, this.sampler);

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
    for (const key of Object.keys(COLOUR_UNIFORMS) as ColourKey[]) {
      gl.uniform4fv(this.u.colours[key], TOKENS[key].rgba01);
    }
    gl.uniform4fv(this.u.simBoundary, TOKENS.textDim.rgba01);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    for (const unit of TERRAIN_UNITS) gl.bindSampler(unit, null);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.sampler) gl.deleteSampler(this.sampler);
    this.prog = null;
    this.vao = null;
    this.sampler = null;
  }
}
