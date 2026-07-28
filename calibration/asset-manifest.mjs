/**
 * SHA-256 manifest over every static replay file under public/data.
 *
 * A directory rule with two explicit volatile-prefix exclusions: a newly baked
 * static asset is covered the day it lands. The manifest lives in calibration/
 * rather than public/data/ so it cannot hash itself. Paths are canonical
 * forward-slash relative so the file is byte-identical on Windows and Linux CI.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DATA_ROOT = new URL('../public/data/', import.meta.url);
const MANIFEST_PATH = new URL('./asset-manifest.json', import.meta.url);
export const VOLATILE_ASSET_PREFIXES = Object.freeze(['live/', 'satellite/']);

function walk(dir, out) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function buildManifest(rootUrl) {
  const root = fileURLToPath(rootUrl);
  const files = walk(root, []);
  const manifest = {};
  for (const file of files) {
    const key = relative(root, file).split(sep).join('/');
    if (VOLATILE_ASSET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    manifest[key] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return Object.fromEntries(
    Object.keys(manifest)
      .sort()
      .map((key) => [key, manifest[key]]),
  );
}

export function diffManifest(actual, committed) {
  return {
    drifted: Object.keys(actual)
      .filter((key) => key in committed && actual[key] !== committed[key])
      .sort(),
    added: Object.keys(actual)
      .filter((key) => !(key in committed))
      .sort(),
    removed: Object.keys(committed)
      .filter((key) => !(key in actual))
      .sort(),
  };
}

function main() {
  const files = buildManifest(DATA_ROOT);
  const write = process.argv.includes('--write');
  if (write) {
    writeFileSync(MANIFEST_PATH, `${JSON.stringify({ files }, null, 2)}\n`);
    console.log(`wrote ${Object.keys(files).length} asset hashes`);
    return;
  }
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const { drifted, added, removed } = diffManifest(files, committed.files);
  if (drifted.length || added.length || removed.length) {
    console.error('asset manifest drift:', { drifted, added, removed });
    process.exit(1);
  }
  console.log(`asset manifest clean (${Object.keys(files).length} files)`);
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (import.meta.url === entryUrl) main();
