import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const hash = (bytes: string | Uint8Array): string =>
  createHash('sha256').update(bytes as string).digest('hex');

describe('HF-6 frozen expansion contract', () => {
  const contract = readJson('calibration/hf6-contract.json') as any;
  const catalogText = readFileSync('calibration/data/hf6-case-catalog.json', 'utf8');
  const tracksText = readFileSync('calibration/data/hf6-tracks.json', 'utf8');
  const catalog = JSON.parse(catalogText) as any;
  const audit = readJson('calibration/hf6-observation-audit.json') as any;
  const legacy = readJson('calibration/fidelity-catalog.json') as any;
  const prospective = readJson('calibration/data/hf6/prospective-registry.json') as any;

  it('contains 60-100 storms and multiple initializations without selection leakage', () => {
    expect(catalog.cases.length).toBeGreaterThanOrEqual(contract.catalogue.minimumStorms);
    expect(catalog.cases.length).toBeLessThanOrEqual(contract.catalogue.maximumStorms);
    expect(catalog.cases.every((item: any) =>
      item.initializations.length >= contract.catalogue.minimumInitializationsPerStorm,
    )).toBe(true);
    expect(catalog.sealedBeforeCandidateEvaluation).toBe(true);
    expect(catalog.protocol.selection).toContain('no simulated outcome');
  });

  it('keeps an independent canonical sealed cohort', () => {
    const sealed = catalog.cases.filter(
      (item: any) => item.partition === 'sealed-confirmation',
    );
    const legacySids = new Set(legacy.storms.map((item: any) => item.sid));
    expect(sealed).toHaveLength(contract.catalogue.minimumSealedCanonicalStorms);
    expect(sealed.every((item: any) => !legacySids.has(item.sid))).toBe(true);
    expect(sealed.every((item: any) =>
      item.initializations.every((initialization: any) =>
        initialization.windCanonicalOneMinute &&
        initialization.availableObservationH >= 48,
      ),
    )).toBe(true);
  });

  it('binds the observation audit to exact catalog and track bytes', () => {
    expect(audit.manifests.catalogSha256).toBe(hash(catalogText));
    expect(audit.manifests.tracksSha256).toBe(hash(tracksText));
    expect(audit.storms).toBe(catalog.cases.length);
    expect(audit.initializations).toBe(144);
    expect(Object.values(audit.outcomeAvailability).every(
      (value) => typeof value === 'number' && value > 0,
    )).toBe(true);
  });

  it('does not invent prospective evidence', () => {
    expect(prospective.counts).toEqual({ issued: 0, matured: 0, distinctStorms: 0 });
    expect(prospective.status).toBe('awaiting-future-storms');
    expect(prospective.claim).toContain('Zero prospective cases');
  });
});
