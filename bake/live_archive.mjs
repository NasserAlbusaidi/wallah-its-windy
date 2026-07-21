#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateArchivedRun } from '../src/live-data.ts';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]+$/u.test(value)) {
    throw new Error(`${label} is not archive-path safe`);
  }
  return value.replaceAll(':', '');
}

export async function archiveForecastRun(run, archiveRoot) {
  const errors = validateArchivedRun(run);
  if (errors.length > 0) throw new Error(`invalid live run: ${errors.join('; ')}`);
  const date = new Date(run.cycle.analysisTime);
  const parts = [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    safeSegment(run.cycle.providerId, 'providerId'),
    safeSegment(run.cycle.cycleId, 'cycleId'),
    safeSegment(run.advisory.stormId, 'stormId'),
  ];
  const target = resolve(archiveRoot, ...parts, `${safeSegment(run.modelVersion, 'modelVersion')}.json`);
  const root = resolve(archiveRoot);
  if (!target.startsWith(`${root}/`)) throw new Error('archive target escapes archive root');
  const rendered = canonicalJson(run);
  const sha256 = createHash('sha256').update(rendered).digest('hex');
  await mkdir(dirname(target), { recursive: true });
  try {
    const existing = await readFile(target, 'utf8');
    if (existing !== rendered) {
      throw new Error(`immutable archive collision at ${target}`);
    }
    return { path: target, sha256, created: false };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('immutable archive collision')) throw error;
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(target), `.${safeSegment(run.modelVersion, 'modelVersion')}.${process.pid}.tmp`);
  const handle = await open(temporary, 'wx', 0o644);
  try {
    await handle.writeFile(rendered, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EEXIST') throw error;
    const existing = await readFile(target, 'utf8');
    if (existing !== rendered) throw new Error(`immutable archive collision at ${target}`);
    await unlink(temporary);
    return { path: target, sha256, created: false };
  }
  await unlink(temporary);
  return { path: target, sha256, created: true };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = argument('input');
  const archiveRoot = argument('archive-root');
  if (!input || !archiveRoot) {
    throw new Error('usage: live_archive.mjs --input=<run.json> --archive-root=<directory>');
  }
  const run = JSON.parse(await readFile(resolve(input), 'utf8'));
  const result = await archiveForecastRun(run, archiveRoot);
  console.log(JSON.stringify(result));
}
