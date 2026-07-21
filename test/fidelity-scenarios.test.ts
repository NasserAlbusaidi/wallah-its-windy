/**
 * fidelity-scenarios.test.ts — generated HF-1 artefact integration guard.
 *
 * This deliberately opens every committed event bin with the production reader
 * and sampler. It catches catalogue/scenario drift, missing assets, a wrong
 * chronological axis, or a bake whose values silently fall back to climatology.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eventMonthSuffix, makeEnvSampler } from '../src/env-sampler';
import { parseBin } from '../src/loader';
import { parseScenarios, validateEventBinForScenario } from '../src/scenarios';

interface CatalogStorm {
  id: string;
  partition: 'development' | 'validation' | 'test';
  publicEventId: string | null;
  initialFix: {
    iso: string;
    lat: number;
    lon: number;
    windKt: number;
  };
}

interface FidelityCatalog {
  storms: CatalogStorm[];
}

interface FidelityTracks {
  storms: Array<{ id: string }>;
}

interface FidelityReference {
  protocol: { finalTestIsAcceptanceGate: boolean };
  validation: unknown;
  test?: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function readBin(path: string) {
  const bytes = readFileSync(path);
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return parseBin(exact);
}

const catalog = readJson('calibration/fidelity-catalog.json') as FidelityCatalog;
const tracks = readJson('calibration/data/fidelity-tracks.json') as FidelityTracks;
const reference = readJson(
  'calibration/fidelity-reference.json',
) as FidelityReference;
const scenarios = parseScenarios(
  readJson('calibration/data/fidelity-scenarios.json'),
);

describe('HF-1 generated scenario assets', () => {
  it('freezes 30 unique storms into the 18/6/6 split', () => {
    expect(scenarios).not.toBeNull();
    expect(scenarios).toHaveLength(30);

    const ids = scenarios!.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(30);
    expect(new Set(catalog.storms.map((storm) => storm.id))).toEqual(
      new Set(ids),
    );
    expect(new Set(tracks.storms.map((storm) => storm.id))).toEqual(
      new Set(ids),
    );

    const counts = { development: 0, validation: 0, test: 0 };
    for (const scenario of scenarios!) {
      if (
        scenario.benchmarkPartition === 'development' ||
        scenario.benchmarkPartition === 'validation' ||
        scenario.benchmarkPartition === 'test'
      ) {
        counts[scenario.benchmarkPartition] += 1;
      }
    }
    expect(counts).toEqual({ development: 18, validation: 6, test: 6 });
    expect(reference.protocol.finalTestIsAcceptanceGate).toBe(false);
    expect(reference.validation).toBeDefined();
    expect(reference.test).toBeUndefined();
  });

  it('keeps scenario initialization and asset routing tied to the catalogue', () => {
    let publicBins = 0;
    let offlineBins = 0;

    for (const scenario of scenarios!) {
      const storm = catalog.storms.find((candidate) => candidate.id === scenario.id);
      expect(storm, scenario.id).toBeDefined();
      expect(scenario.ghostId).toBe(scenario.id);
      expect(scenario.benchmarkPartition).toBe(storm!.partition);
      expect(scenario.hindcast).not.toBeNull();
      expect(scenario.hindcast!.startIso).toBe(storm!.initialFix.iso);
      expect(scenario.hindcast!.lat).toBe(storm!.initialFix.lat);
      expect(scenario.hindcast!.lon).toBe(storm!.initialFix.lon);
      expect(scenario.hindcast!.initialWindKt).toBe(storm!.initialFix.windKt);

      if (storm!.publicEventId === null) {
        offlineBins += 1;
        expect(scenario.bin).toBe(
          `calibration/data/fidelity/env_${scenario.id}.bin`,
        );
      } else {
        publicBins += 1;
        expect(scenario.bin).toBe(`public/data/env_${storm!.publicEventId}.bin`);
      }
    }

    expect({ publicBins, offlineBins }).toEqual({ publicBins: 10, offlineBins: 20 });
  });

  it('parses and physically samples every event bin without fallback', () => {
    for (const scenario of scenarios!) {
      const bin = readBin(scenario.bin);
      expect(validateEventBinForScenario(bin, scenario), scenario.id).toBeNull();

      const mm = eventMonthSuffix(scenario.monthIndex);
      expect(bin.layers.has(`sst_${mm}`), scenario.id).toBe(true);
      const sampler = makeEnvSampler(() => bin);
      sampler.setSamplingMode({ kind: 'event-timeline' });
      const tFrac = scenario.hindcast!.envOffsetH / scenario.windowH;
      const sample = sampler.sample(
        scenario.hindcast!.lat,
        scenario.hindcast!.lon,
        scenario.monthIndex,
        tFrac,
      );

      for (const [field, value] of Object.entries(sample)) {
        expect(Number.isFinite(value), `${scenario.id} ${field}`).toBe(true);
      }
      expect(sample.sstC, scenario.id).toBeGreaterThanOrEqual(0);
      expect(sample.sstC, scenario.id).toBeLessThanOrEqual(40);
      expect(Math.abs(sample.steerU), scenario.id).toBeLessThan(100);
      expect(Math.abs(sample.steerV), scenario.id).toBeLessThan(100);
      expect(sample.shear, scenario.id).toBeGreaterThanOrEqual(0);
      expect(sample.shear, scenario.id).toBeLessThan(100);
      expect(Math.abs(sample.shearU), scenario.id).toBeLessThan(100);
      expect(Math.abs(sample.shearV), scenario.id).toBeLessThan(100);
      expect(sample.midlevelRhPct, scenario.id).toBeGreaterThanOrEqual(0);
      expect(sample.midlevelRhPct, scenario.id).toBeLessThanOrEqual(100);
      expect(sample.ohcKjCm2, scenario.id).toBeGreaterThanOrEqual(0);
      expect(sample.ohcKjCm2, scenario.id).toBeLessThanOrEqual(250);
    }

    const december = scenarios!.find((scenario) => scenario.id === 'as1998dec')!;
    const decemberBin = readBin(december.bin);
    expect(december.monthIndex).toBe(11);
    for (const field of ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc']) {
      expect(decemberBin.layers.has(`${field}_11`), field).toBe(true);
    }
  });
});
