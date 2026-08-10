/**
 * bin-domain-guard.ts — the ONE place a .bin's grid is checked against DOMAIN.
 *
 * loader.ts stays domain-agnostic on purpose: dims and bbox come from the file
 * header and the parser hardcodes no geometry. That is what makes a
 * wrong-extent bin silent — raster-sampler.ts resolves cells through each
 * layer's own header bbox and clamps to that layer's edges, so a bin baked over
 * the wrong box simulates and renders without one diagnostic.
 *
 * This module closes that. It is applied ONLY to bins the runtime feeds to
 * physics (scenario event bins; the four bins the ensemble worker loads). It is
 * deliberately NOT applied to context-terrain.bin, which is presentation-only
 * and carries 875x550 / (45,80,8,30) by design.
 *
 * Rejecting a wrong-extent bin loudly is not a fallback — it is the visible
 * failure the rebake plan assumes already exists.
 */

import { DOMAIN } from './grid';
import type { BBox, ParsedBin } from './types';

function describeBBox(b: BBox): string {
  return `${b.lonMin},${b.lonMax},${b.latMin},${b.latMax}`;
}

function sameBBox(a: BBox, b: BBox): boolean {
  // Exact equality, no tolerance: bake and runtime write the same literals, and
  // a bbox that is 'nearly' right is a rebake bug, not a rounding artifact.
  return (
    a.lonMin === b.lonMin &&
    a.lonMax === b.lonMax &&
    a.latMin === b.latMin &&
    a.latMax === b.latMax
  );
}

/**
 * Human-readable incompatibility, or null when every layer sits on `expected`
 * and every layer agrees with the first on nx/ny.
 */
export function validateBinDomain(
  bin: ParsedBin,
  label: string,
  expected: BBox = DOMAIN,
): string | null {
  const layers = [...bin.layers.values()];
  if (layers.length === 0) return `${label}: no layers`;
  const first = layers[0];
  for (const layer of layers) {
    if (!sameBBox(layer.bbox, expected)) {
      return (
        `${label}: layer ${layer.name} bbox (${describeBBox(layer.bbox)}) ` +
        `disagrees with the simulation domain (${describeBBox(expected)})`
      );
    }
    if (layer.nx !== first.nx || layer.ny !== first.ny) {
      return (
        `${label}: layer ${layer.name} is ${layer.nx}x${layer.ny}, ` +
        `but ${first.name} is ${first.nx}x${first.ny}`
      );
    }
  }
  return null;
}

/** Same check, as a throw. For call sites with no warn channel (the worker). */
export function assertBinDomain(bin: ParsedBin, label: string, expected: BBox = DOMAIN): void {
  const message = validateBinDomain(bin, label, expected);
  if (message !== null) throw new Error(message);
}
