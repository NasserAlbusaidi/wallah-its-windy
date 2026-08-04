import { describe, expect, it } from 'vitest';
import { cloudNoiseBytes } from '../src/render/cloud-noise';
import {
  REALISM_GRID_N,
  RealismNoise,
  buildRealismField,
  computeDebrisState,
  glslFract,
  glslHash21,
  glslRotate2,
  midlevelRhUniform,
  smoothstep,
} from '../src/realism-proxy';
import type { RealismField } from '../src/realism-proxy';
import { syntheticFrame, weakFrame } from './helpers/realism';

describe('GLSL-semantics helpers', () => {
  it('glslFract handles negatives like GLSL (x - floor(x))', () => {
    expect(glslFract(-1.25)).toBeCloseTo(0.75, 12);
    expect(glslFract(2.5)).toBeCloseTo(0.5, 12);
  });

  it('glslRotate2 is CLOCKWISE for positive angles (column-major mat2)', () => {
    // rotate (1, 0) by +90deg -> (0, -1) under mat2(c,-s,s,c) * v
    const r = glslRotate2(Math.PI / 2, 1, 0);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(-1, 12);
  });

  it('glslHash21 mirrors the shader hash', () => {
    const expected = (px: number, py: number) => {
      const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    expect(glslHash21(0.3, 0.7)).toBeCloseTo(expected(0.3, 0.7), 12);
    expect(glslHash21(-2.4, 5.1)).toBeCloseTo(expected(-2.4, 5.1), 12);
  });

  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('RealismNoise', () => {
  const noise = new RealismNoise();

  it('tap at a texel center returns that texel byte exactly', () => {
    const bytes = cloudNoiseBytes(128);
    const expected = bytes[(7 * 128 + 3) * 4 + 1] / 255;
    expect(noise.tap(3.5 / 128, 7.5 / 128, 1)).toBeCloseTo(expected, 12);
  });

  it('tap wraps REPEAT: uv and uv+1 are identical', () => {
    expect(noise.tap(0.113, 0.71, 0)).toBeCloseTo(noise.tap(1.113, -0.29, 0), 12);
  });

  it('tap interpolates midway between horizontal neighbours', () => {
    const bytes = cloudNoiseBytes(128);
    const a = bytes[(9 * 128 + 4) * 4] / 255;
    const b = bytes[(9 * 128 + 5) * 4] / 255;
    expect(noise.tap(5 / 128, 9.5 / 128, 0)).toBeCloseTo((a + b) / 2, 12);
  });

  it('cloudNoise is deterministic and in a plausible range', () => {
    const v1 = noise.cloudNoise(0.42, -1.7);
    const v2 = new RealismNoise().cloudNoise(0.42, -1.7);
    expect(v1).toBe(v2);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(1);
  });
});

// A proxy metric may read a quantity from the frame, the diagnostics, or the
// structure. If those disagree, a test asserting "weak storm => X" can pass or
// fail for a reason unrelated to what it claims. These invariants are asserted
// rather than promised in a doc comment.
describe('frame fixtures are internally self-consistent', () => {
  for (const [name, frame] of [
    ['syntheticFrame', syntheticFrame()],
    ['weakFrame', weakFrame()],
  ] as const) {
    it(`${name}: the same quantity carries one value everywhere`, () => {
      expect(frame.organization).toBe(frame.diagnostics.organization);
      expect(frame.organization).toBe(frame.diagnostics.organizationTarget);
      expect(frame.coldWakeC).toBe(frame.diagnostics.coldWakeC);
      expect(frame.vKt).toBe(frame.structure.maximumWindKt);
      expect(frame.diagnostics.shearUms).toBe(frame.structure.shearUms);
      expect(frame.diagnostics.shearVms).toBe(frame.structure.shearVms);
    });

    it(`${name}: scalars equal the quantities they summarize`, () => {
      const { diagnostics } = frame;
      expect(Math.hypot(diagnostics.shearUms, diagnostics.shearVms))
        .toBeCloseTo(diagnostics.shearMs, 12);
      expect(diagnostics.totalRainMmH).toBeCloseTo(
        diagnostics.eyewallRainMmH + diagnostics.rainbandRainMmH +
          diagnostics.orographicRainMmH,
        12,
      );
      expect(diagnostics.netKtPerH).toBeCloseTo(
        diagnostics.oceanKtPerH - diagnostics.shearKtPerH -
          diagnostics.landKtPerH - diagnostics.dryAirKtPerH,
        12,
      );
    });

    it(`${name}: wind radii nest and never exceed the intensity`, () => {
      const { r34Km, r50Km, r64Km, maximumWindKt } = frame.structure;
      for (const q of ['ne', 'se', 'sw', 'nw'] as const) {
        expect(r34Km[q]).toBeGreaterThanOrEqual(r50Km[q]);
        expect(r50Km[q]).toBeGreaterThanOrEqual(r64Km[q]);
        if (maximumWindKt < 50) expect(r50Km[q]).toBe(0);
        if (maximumWindKt < 64) expect(r64Km[q]).toBe(0);
      }
    });

    it(`${name}: the core is deeper than its environment`, () => {
      const { centralPressureHpa, environmentalPressureHpa } = frame.structure;
      expect(centralPressureHpa).toBeLessThan(environmentalPressureHpa);
    });
  }

  it('weakFrame is weaker than syntheticFrame on every intensity axis', () => {
    const strong = syntheticFrame();
    const weak = weakFrame();
    expect(weak.vKt).toBeLessThan(strong.vKt);
    expect(weak.organization).toBeLessThan(strong.organization);
    expect(weak.structure.centralPressureHpa)
      .toBeGreaterThan(strong.structure.centralPressureHpa);
    expect(weak.diagnostics.totalRainMmH)
      .toBeLessThan(strong.diagnostics.totalRainMmH);
  });

  it('overrides still apply on top of a coherent base', () => {
    expect(syntheticFrame({ ageH: 96 }).ageH).toBe(96);
    expect(weakFrame({ lat: -5 }).lat).toBe(-5);
    // The plan pins these; a coherence edit must not have moved them.
    const weak = weakFrame();
    expect(weak.vKt).toBe(35);
    expect(weak.organization).toBe(0.3);
    expect(weak.structure.maximumWindKt).toBe(35);
    expect(weak.structure.rmwKm).toBe(60);
    expect(weak.structure.outerSizeKm).toBe(180);
    expect(weak.structure.hollandB).toBe(1.2);
  });
});

describe('computeDebrisState', () => {
  it('k=0 is an all-zero field (no source boundaries before spawn)', () => {
    const state = computeDebrisState(0, () => syntheticFrame(), new RealismNoise(), 0.4, 32);
    expect(Math.max(...state.densityBytes)).toBe(0);
    expect(Math.max(...state.ageBytes)).toBe(0);
  });

  it('an active storm deposits debris near its centre by k=6', () => {
    const state = computeDebrisState(
      6, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, 64,
    );
    // > 0.05 density in byte space
    expect(Math.max(...state.densityBytes)).toBeGreaterThan(13);
  });

  it('is deterministic', () => {
    // Separate RealismNoise instances: a shared one would also pass if the
    // result depended on sampler state rather than on the arguments alone.
    const a = computeDebrisState(
      4, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, 32,
    );
    const b = computeDebrisState(
      4, (b2) => syntheticFrame({ ageH: b2 }), new RealismNoise(), 0.4, 32,
    );
    expect(a.densityBytes).toEqual(b.densityBytes);
    expect(a.ageBytes).toEqual(b.ageBytes);
  });

  it('age resets to zero wherever stored density is below the byte floor', () => {
    const state = computeDebrisState(
      3, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, 32,
    );
    let zeroCount = 0;
    for (let i = 0; i < state.densityBytes.length; i++) {
      if (state.densityBytes[i] === 0) {
        zeroCount++;
        expect(state.ageBytes[i]).toBe(0);
      }
    }
    // Without this the loop body could never run and the test pass vacuously.
    expect(zeroCount).toBeGreaterThan(0);
  });
});

/**
 * The ONE mechanical pin on every mirrored shader term.
 *
 * Human reading is what verified this module against CLOUD_MEMORY_UPDATE_FS;
 * this vector is what keeps it verified. The behavioural tests above all stay
 * green under real mirror breakages — flipping cellY's sign, flipping backV's
 * sign, dropping the max(metricX, 1e-5) divisor, or dropping the cloudSeed*13
 * noise offset each leave k=0 zero, the peak above 13, the run deterministic
 * and the age-reset predicate intact. Only these bytes catch them.
 *
 * Captured from the implementation (like BINARY-FORMATS.md's golden hex
 * vector, these are recorded values, not re-derivable by hand): n=16, k=3, so
 * three advect->source->decay passes; syntheticFrame at every boundary;
 * cloudSeed 0.4. syntheticFrame's centre (18N, 62E) projects to clip
 * (0.2, -0.5) = row 11.5, col 9.1, which is exactly where the debris sits.
 *
 * A diff here means a mirrored term moved. Re-check it against the GLSL in
 * src/render/cloud-memory.ts before re-recording.
 */
const GOLDEN_N = 16;

const GOLDEN_DENSITY = [
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  2, 14,  2,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0, 10, 74,  8,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  7, 57, 10,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  2, 11,  2,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
];

const GOLDEN_AGE = [
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0, 16,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0, 27, 28, 29,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0, 30, 26, 28,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0, 29, 26, 31,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0, 30, 30, 28,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0, 17,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
];

describe('computeDebrisState golden byte vector', () => {
  const state = computeDebrisState(
    3, (b) => syntheticFrame({ ageH: b }), new RealismNoise(), 0.4, GOLDEN_N,
  );

  it('reproduces the recorded density bytes exactly', () => {
    expect(Array.from(state.densityBytes)).toEqual(GOLDEN_DENSITY);
  });

  it('reproduces the recorded age bytes exactly', () => {
    expect(Array.from(state.ageBytes)).toEqual(GOLDEN_AGE);
  });

  // A vector of all zeros, or one whose ages are all the same, would pin
  // nothing. These assert the recorded field actually exercises the terms:
  // varied ages mean the density-weighted rejuvenation rule ran (three passes
  // of pure accumulation would give a uniform 3/18 -> byte 43), and the
  // left/right and up/down asymmetry around the peak is the advection.
  it('is a non-degenerate field that exercises advection and rejuvenation', () => {
    const peak = 11 * GOLDEN_N + 9;
    expect(state.densityBytes[peak]).toBe(74);
    expect(state.densityBytes[peak - 1]).not.toBe(state.densityBytes[peak + 1]);
    expect(state.densityBytes[peak - GOLDEN_N])
      .not.toBe(state.densityBytes[peak + GOLDEN_N]);
    const ages = new Set(Array.from(state.ageBytes).filter((x) => x !== 0));
    expect(ages.size).toBeGreaterThan(1);
    expect(ages.has(43)).toBe(false);
  });
});

function contextFor(frame: ReturnType<typeof syntheticFrame>) {
  return {
    frame,
    genesis: { lat: 16, lon: 64 },
    envShear: {
      u: frame.structure.shearUms,
      v: frame.structure.shearVms,
      magnitude: Math.hypot(frame.structure.shearUms, frame.structure.shearVms),
    },
    envSteer: { u: -2, v: 3 },
    midlevelRh01: midlevelRhUniform(frame, null),
    monthIndex: 5,
    displayTFrac: 0,
    samplingMode: { kind: 'synoptic-plane', plane: 0 } as const,
  };
}

const openOcean = {
  envBin: null,
  land01At: () => 0,
  noise: new RealismNoise(),
  debris: null,
};

function centreCellIndex(field: RealismField): number {
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      const x = u * 2 - 1;
      const y = 1 - v * 2;
      const d = Math.hypot((x - field.center.x) * field.metricX, y - field.center.y);
      if (d < bestD) { bestD = d; best = j * field.n + i; }
    }
  }
  return best;
}

/** Coldest btProxyC in the eyewall annulus 0.8 <= r/rmw <= 1.3. */
function eyewallMinC(field: RealismField, rmwKm: number): number {
  let coldest = Infinity;
  for (let j = 0; j < field.n; j++) {
    for (let i = 0; i < field.n; i++) {
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      const east = ((u * 2 - 1) - field.center.x) * field.metricX * 666;
      const north = ((1 - v * 2) - field.center.y) * 666;
      const q = Math.hypot(east, north) / rmwKm;
      if (q >= 0.8 && q <= 1.3) coldest = Math.min(coldest, field.btProxyC[j * field.n + i]);
    }
  }
  return coldest;
}

describe('midlevelRhUniform', () => {
  it('prefers ventilationMeanRhPct, then env sample, then 55', () => {
    const f = syntheticFrame();
    expect(midlevelRhUniform(f, { midlevelRhPct: 80 })).toBeCloseTo(0.58, 9);
    const noVent = syntheticFrame({
      diagnostics: { ...f.diagnostics, ventilationMeanRhPct: undefined },
    });
    expect(midlevelRhUniform(noVent, { midlevelRhPct: 80 })).toBeCloseTo(0.8, 9);
    expect(midlevelRhUniform(noVent, null)).toBeCloseTo(0.55, 9);
  });
});

describe('buildRealismField', () => {
  it('grid geometry: 192^2, metricX from frame latitude', () => {
    const field = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(field.n).toBe(REALISM_GRID_N);
    expect(field.btProxyC.length).toBe(REALISM_GRID_N * REALISM_GRID_N);
    expect(field.metricX).toBeCloseTo((20 * Math.cos((18 * Math.PI) / 180)) / 12, 9);
  });

  it('mature storm: eyewall annulus is far colder than the ambient far field', () => {
    const frame = syntheticFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const corner = field.btProxyC[0];
    expect(eyewallMinC(field, frame.structure.rmwKm)).toBeLessThan(corner - 40);
  });

  it('mature storm: the eye centre is WARMER than the eyewall (shader eye term)', () => {
    const frame = syntheticFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const centre = field.btProxyC[centreCellIndex(field)];
    expect(centre).toBeGreaterThan(eyewallMinC(field, frame.structure.rmwKm) + 20);
  });

  it('weak eyeless storm: centre is cold (no eye clearing)', () => {
    const frame = weakFrame();
    const field = buildRealismField(contextFor(frame), openOcean);
    const centre = field.btProxyC[centreCellIndex(field)];
    expect(centre).toBeLessThan(-20);
  });

  it('stormCloud is zero everywhere when the frame is not alive', () => {
    const dead = syntheticFrame({ alive: false });
    const field = buildRealismField(contextFor(dead), openOcean);
    expect(Math.max(...field.stormCloud)).toBe(0);
  });

  it('is deterministic (two builds are byte-equal)', () => {
    const a = buildRealismField(contextFor(syntheticFrame()), openOcean);
    const b = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(a.btProxyC).toEqual(b.btProxyC);
    expect(a.cloud).toEqual(b.cloud);
  });

  it('precipBandCloud excludes the precipitation-eyewall arm', () => {
    // Eye-only rain: band support is zero, so a correct precipBandCloud is
    // zero EVERYWHERE even though the eyewall arm is strongly active. An
    // implementation that mistakenly stores the full precipitatingCloud
    // (max of both arms) fails here — this is the RGR-004 regression proof.
    const base = syntheticFrame();
    const eyeOnly = syntheticFrame({
      diagnostics: { ...base.diagnostics, eyewallRainMmH: 20, rainbandRainMmH: 0 },
    });
    const eyeField = buildRealismField(contextFor(eyeOnly), openOcean);
    expect(Math.max(...eyeField.precipBandCloud)).toBe(0);

    const bandOnly = syntheticFrame({
      diagnostics: { ...base.diagnostics, eyewallRainMmH: 0, rainbandRainMmH: 6 },
    });
    const bandField = buildRealismField(contextFor(bandOnly), openOcean);
    expect(Math.max(...bandField.precipBandCloud)).toBeGreaterThan(0);
  });
});
