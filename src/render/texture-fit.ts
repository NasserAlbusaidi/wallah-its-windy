/**
 * texture-fit.ts — fit a baked plane inside gl.MAX_TEXTURE_SIZE, for DISPLAY.
 *
 * A device whose MAX_TEXTURE_SIZE is below the baked grid width silently gets an
 * incomplete texture that samples as black — land would read as ocean and the
 * whole basin would draw as sea. This module shrinks a COPY of the plane so that
 * cannot happen.
 *
 * SCOPE, and it is a hard boundary. Nothing here may reach physics:
 *   - it takes plain Float32Array + dims, never a decoded layer object;
 *   - loader.ts must never import it, and it must never import loader.ts;
 *   - it always allocates; the caller's buffer is never written.
 * The land predicates the sim uses (ui.ts isLand on the main thread,
 * ensemble.worker.ts in the worker) read the decoded plane at full baked
 * resolution. A worker has no WebGL context, so it cannot observe the cap even
 * in principle: tracks, landfall and recorded output are identical on a floor
 * device and on a desktop. Only the drawn coastline coarsens.
 *
 * REDUCER CHOICE IS PER-LAYER SEMANTICS, not taste:
 *   - continuous fields (elevation, SST)          -> boxReduce
 *   - the landmask                                -> binarize THEN majorityReduce
 *   - categorical ids (regions, flow direction)   -> strideReduce
 * Averaging a categorical id invents an id that means nothing. Averaging the
 * landmask and thresholding afterwards is NOT the same as voting on binarized
 * cells: [0.4,0.4,0.4,1.0] votes to sea (1 of 4 land) but means 0.55, which
 * thresholds to land. Binarize first, always.
 */

/** Cell count along one axis after reducing by `f`, rounding up. */
function axisLength(n: number, f: number): number {
  return Math.ceil(n / f);
}

/** Reduced dimensions for `f`. No row or column is ever dropped. */
export function reducedDims(nx: number, ny: number, f: number): { nx: number; ny: number } {
  return { nx: axisLength(nx, f), ny: axisLength(ny, f) };
}

/**
 * Smallest integer f >= 1 for which both reduced axes fit inside `maxSize`.
 * fitFactor(2860, 1670, 2048) === 2.
 */
export function fitFactor(nx: number, ny: number, maxSize: number): number {
  if (!Number.isFinite(maxSize) || maxSize < 1) return 1;
  const limit = Math.max(nx, ny, 1);
  let f = 1;
  while (axisLength(nx, f) > maxSize || axisLength(ny, f) > maxSize) {
    f += 1;
    if (f > limit) return limit; // degenerate input; never loop forever
  }
  return f;
}

/** 1 where value > threshold, else 0. Always a new array. */
export function binarize(src: Float32Array, threshold: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] > threshold ? 1 : 0;
  return out;
}

/** Arithmetic mean of each f x f block. Partial edge blocks average what they have. */
export function boxReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      let sum = 0;
      let count = 0;
      for (let dr = 0; dr < f; dr++) {
        const sr = r * f + dr;
        if (sr >= ny) break;
        for (let dc = 0; dc < f; dc++) {
          const sc = c * f + dc;
          if (sc >= nx) break;
          sum += src[sr * nx + sc];
          count++;
        }
      }
      out[r * dims.nx + c] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/**
 * Majority vote of an ALREADY BINARIZED plane. Ties resolve to 0 (sea): drawing
 * land that is not there is the worse error. Throws on non-binary input rather
 * than silently voting on a continuous field — see the module note.
 */
export function majorityReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== 0 && src[i] !== 1) {
      throw new Error(
        `texture-fit: majorityReduce needs a binarized plane; index ${i} is ${src[i]}. ` +
          'Call binarize() first — binarize-then-vote and vote-then-binarize differ.',
      );
    }
  }
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      let ones = 0;
      let total = 0;
      for (let dr = 0; dr < f; dr++) {
        const sr = r * f + dr;
        if (sr >= ny) break;
        for (let dc = 0; dc < f; dc++) {
          const sc = c * f + dc;
          if (sc >= nx) break;
          ones += src[sr * nx + sc];
          total++;
        }
      }
      out[r * dims.nx + c] = ones * 2 > total ? 1 : 0;
    }
  }
  return out;
}

/** Top-left sample of each f x f block. The only safe reducer for categorical ids. */
export function strideReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      out[r * dims.nx + c] = src[r * f * nx + c * f];
    }
  }
  return out;
}
