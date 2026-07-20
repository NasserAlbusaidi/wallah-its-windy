/**
 * Shared HydroSHEDS D8 routing contract.
 *
 * Raster rows and WebGL texture-v coordinates both increase southward, so dy=1
 * means south. Keeping this table in TypeScript lets the renderer generate its
 * GLSL mapping from the same source used by the deterministic CPU oracle below.
 */
export const D8_DIRECTIONS = [
  { code: 1, dx: 1, dy: 0 },    // east
  { code: 2, dx: 1, dy: 1 },    // south-east
  { code: 4, dx: 0, dy: 1 },    // south
  { code: 8, dx: -1, dy: 1 },   // south-west
  { code: 16, dx: -1, dy: 0 },  // west
  { code: 32, dx: -1, dy: -1 }, // north-west
  { code: 64, dx: 0, dy: -1 },  // north
  { code: 128, dx: 1, dy: -1 }, // north-east
] as const;

export const HYDRO_ROUTE_CFL = 0.45;

export function d8Offset(code: number): { dx: number; dy: number } | null {
  const direction = D8_DIRECTIONS.find((candidate) => candidate.code === code);
  return direction ? { dx: direction.dx, dy: direction.dy } : null;
}

function glslFloat(value: number): string {
  return `${value.toFixed(1)}`;
}

/** Generate the shader's D8 decoder from the canonical direction table. */
export function flowOffsetGlsl(): string {
  const branches = D8_DIRECTIONS.map(
    ({ code, dx, dy }) =>
      `  if (code == ${code}) return vec2(${glslFloat(dx)}, ${glslFloat(dy)});`,
  ).join('\n');

  return `vec2 flowOffset(vec2 p) {
  int code = int(floor(texture(u_flowdir, p).r * 255.0 + 0.5));
${branches}
  return vec2(0.0);
}`;
}

export interface PulseGrid {
  width: number;
  height: number;
  water: Float32Array;
  flowDir: Uint8Array;
  travelMinutes: Uint8Array;
}

/**
 * Deterministic, source-free reference step for the GPU routing pass.
 *
 * It conserves water, moves each cell's routed share to exactly one downstream
 * neighbour, and leaves outlets/unrouted edges in place. Rain source and decay
 * are deliberately excluded so transport can be tested in isolation.
 */
export function routePulseStep(grid: PulseGrid, deltaHours: number): Float32Array {
  const { width, height, water, flowDir, travelMinutes } = grid;
  const size = width * height;
  if (water.length !== size || flowDir.length !== size || travelMinutes.length !== size) {
    throw new Error('Hydrology grid layers must have width × height cells');
  }
  if (!Number.isFinite(deltaHours) || deltaHours < 0) {
    throw new Error('Hydrology deltaHours must be finite and non-negative');
  }

  const next = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const amount = water[index] ?? 0;
    const direction = d8Offset(flowDir[index] ?? 0);
    if (!direction || amount === 0 || deltaHours === 0) {
      next[index] = (next[index] ?? 0) + amount;
      continue;
    }

    const x = index % width;
    const y = Math.floor(index / width);
    const downstreamX = x + direction.dx;
    const downstreamY = y + direction.dy;
    if (
      downstreamX < 0 ||
      downstreamX >= width ||
      downstreamY < 0 ||
      downstreamY >= height
    ) {
      next[index] = (next[index] ?? 0) + amount;
      continue;
    }

    const travelHours = Math.max(8, travelMinutes[index] ?? 0) / 60;
    const fraction = Math.min(HYDRO_ROUTE_CFL, deltaHours / travelHours);
    const routed = amount * fraction;
    const downstreamIndex = downstreamY * width + downstreamX;
    next[index] = (next[index] ?? 0) + amount - routed;
    next[downstreamIndex] = (next[downstreamIndex] ?? 0) + routed;
  }
  return next;
}
