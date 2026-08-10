/**
 * bin-domain-guard.test.ts — silent path 1 (design spec section 3.5).
 *
 * raster-sampler.ts resolves cells through each layer's OWN header bbox and
 * clamps to that layer's edges, so a bin baked at the wrong extent renders and
 * simulates without a single diagnostic. This is the guard that makes a
 * wrong-extent bin a visible failure.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWiwbBin } from './helpers/wiwb';
import { parseBin } from '../src/loader';
import { assertBinDomain, validateBinDomain } from '../src/bin-domain-guard';
import { DOMAIN } from '../src/grid';
import type { BBox, ParsedBin } from '../src/types';

const NEW_DOMAIN: BBox = { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 };

function bin(nx: number, ny: number, bbox: BBox, names = ['sst_05', 'u_05']): ParsedBin {
  return parseBin(
    buildWiwbBin(
      names.map((name) => ({
        name,
        nx,
        ny,
        nt: 1,
        bbox,
        data: new Float32Array(nx * ny),
      })),
    ),
  );
}

describe('validateBinDomain', () => {
  it('accepts a bin whose every layer sits on the live domain', () => {
    expect(validateBinDomain(bin(40, 24, DOMAIN), 'env')).toBeNull();
  });

  it('rejects a bin baked at the post-expansion extent while DOMAIN is the old box', () => {
    const message = validateBinDomain(bin(110, 60, NEW_DOMAIN), 'env');
    expect(message).toMatch(/env/);
    expect(message).toMatch(/sst_05/);
    expect(message).toMatch(/45,100,0,30/);
    expect(message).toMatch(/50,70,15,27/);
  });

  it('rejects the shipped 40x24 Arabian Sea grid once the domain has moved', () => {
    // The design spec Phase 10 acceptance criterion, provable today by passing
    // the expected box explicitly instead of moving DOMAIN.
    const message = validateBinDomain(bin(40, 24, DOMAIN), 'env_gonu', NEW_DOMAIN);
    expect(message).toMatch(/env_gonu/);
    expect(message).toMatch(/50,70,15,27/);
    expect(message).toMatch(/45,100,0,30/);
    // Both boxes appearing is not enough — pin which is the ACTUAL bin bbox
    // (50,70,15,27, the shipped grid) and which is the EXPECTED domain
    // (45,100,0,30, the passed-in override): a reversed actual/expected in
    // the message construction would still contain both substrings but fail
    // this ordered match.
    expect(message).toMatch(
      /bbox \(50,70,15,27\) disagrees with the simulation domain \(45,100,0,30\)/,
    );
  });

  it('rejects a bin whose layers disagree with each other on nx/ny', () => {
    const mixed = parseBin(
      buildWiwbBin([
        { name: 'sst_05', nx: 40, ny: 24, nt: 1, bbox: DOMAIN, data: new Float32Array(960) },
        { name: 'u_05', nx: 20, ny: 24, nt: 1, bbox: DOMAIN, data: new Float32Array(480) },
      ]),
    );
    const message = validateBinDomain(mixed, 'env');
    expect(message).toMatch(/u_05/);
    expect(message).toMatch(/20x24/);
    expect(message).toMatch(/40x24/);
  });

  it('rejects an empty bin instead of vacuously passing', () => {
    const empty = { layers: new Map() } as unknown as ParsedBin;
    expect(validateBinDomain(empty, 'env')).toMatch(/no layers/);
  });
});

describe('assertBinDomain', () => {
  it('throws the validate message verbatim', () => {
    expect(() => assertBinDomain(bin(110, 60, NEW_DOMAIN), 'env')).toThrow(/45,100,0,30/);
  });

  it('is silent for a good bin', () => {
    expect(() => assertBinDomain(bin(40, 24, DOMAIN), 'env')).not.toThrow();
  });
});

describe('every shipped physics bin passes the guard', () => {
  function load(name: string): ParsedBin {
    const buf = readFileSync(`public/data/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return parseBin(ab);
  }
  const names = [
    'terrain.bin', 'env.bin', 'ocean.bin', 'upper.bin', 'flowacc.bin', 'regions.bin',
    'env_gonu.bin', 'env_shaheen.bin', 'steering_gonu.bin',
  ];
  for (const name of names) {
    it(name, () => {
      expect(validateBinDomain(load(name), name)).toBeNull();
    });
  }
});

describe('the ensemble worker actually calls the guard', () => {
  // The worker cannot be imported in a node test (it references
  // DedicatedWorkerGlobalScope), so pin the call site by source text.
  const source = readFileSync('src/ensemble.worker.ts', 'utf8');
  it('imports it', () => {
    expect(source).toMatch(/from '\.\/bin-domain-guard'/);
  });
  it('asserts every bin it loads', () => {
    expect(source.match(/assertBinDomain\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
