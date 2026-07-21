import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArchivedRun } from '../src/live-data.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRegistry = resolve(ROOT, 'calibration/data/hf6/prospective-registry.json');
const argument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? null;
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const registryPath = resolve(argument('registry') ?? defaultRegistry);
const registry = JSON.parse(await readFile(registryPath, 'utf8'));

function validateRegistry(document) {
  const errors = [];
  const ids = new Set();
  for (const entry of document.issuedRuns) {
    if (ids.has(entry.id)) errors.push(`duplicate issued-run id ${entry.id}`);
    ids.add(entry.id);
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256)) errors.push(`${entry.id}: invalid SHA-256`);
    if (Date.parse(entry.registeredAt) < Date.parse(entry.analysisTime)) {
      errors.push(`${entry.id}: registration predates analysis`);
    }
    if (Date.parse(entry.registeredAt) > Date.parse(entry.verificationAvailableAfter)) {
      errors.push(`${entry.id}: registered after observations could mature`);
    }
  }
  if (document.counts.issued !== document.issuedRuns.length) errors.push('issued count drift');
  if (document.counts.matured !== document.maturedRuns.length) errors.push('matured count drift');
  return errors;
}

const registerPath = argument('register');
if (registerPath) {
  const bytes = await readFile(resolve(registerPath));
  const run = JSON.parse(bytes.toString('utf8'));
  const errors = validateArchivedRun(run);
  if (errors.length > 0) throw new Error(`invalid issued run: ${errors.join('; ')}`);
  const guidance = Object.values(run.guidance).flat();
  const verificationAvailableAfter = guidance.length > 0
    ? guidance.reduce(
        (latest, point) => Date.parse(point.validTime) > Date.parse(latest)
          ? point.validTime
          : latest,
        guidance[0].validTime,
      )
    : run.cycle.analysisTime;
  const id = `${run.cycle.providerId}:${run.cycle.cycleId}:${run.advisory.stormId}:${run.modelVersion}`;
  const entry = {
    id,
    stormId: run.advisory.stormId,
    providerId: run.cycle.providerId,
    cycleId: run.cycle.cycleId,
    analysisTime: run.cycle.analysisTime,
    registeredAt: run.createdAt,
    verificationAvailableAfter,
    modelVersion: run.modelVersion,
    sha256: digest(bytes),
  };
  const existing = registry.issuedRuns.find((item) => item.id === id);
  if (existing && existing.sha256 !== entry.sha256) {
    throw new Error(`immutable prospective registry collision for ${id}`);
  }
  if (!existing) registry.issuedRuns.push(entry);
  registry.counts = {
    issued: registry.issuedRuns.length,
    matured: registry.maturedRuns.length,
    distinctStorms: new Set(registry.issuedRuns.map((item) => item.stormId)).size,
  };
  registry.status = registry.counts.issued > 0 ? 'collecting' : 'awaiting-future-storms';
  registry.claim = `${registry.counts.matured} prospective cases have matured; no skill claim is permitted until the frozen HF-6 minimum passes.`;
  const temporary = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`);
  await rename(temporary, registryPath);
}
const errors = validateRegistry(registry);
if (errors.length > 0) throw new Error(`invalid prospective registry: ${errors.join('; ')}`);
console.log(`[hf6-prospective] issued=${registry.counts.issued} matured=${registry.counts.matured}`);
