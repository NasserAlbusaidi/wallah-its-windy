/**
 * Cross-platform launcher for the repository-owned Python virtual environment.
 *
 * Data and scientific-integrity scripts must run under bake/.venv rather than
 * silently falling back to whichever Python happens to be on PATH. The venv
 * layout differs by platform, so package.json invokes this launcher instead of
 * hardcoding the POSIX-only bin/python path.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function venvPythonRelativePath(platform = process.platform) {
  return platform === 'win32'
    ? 'bake/.venv/Scripts/python.exe'
    : 'bake/.venv/bin/python';
}

export function resolveVenvPython({
  platform = process.platform,
  repositoryRoot = REPOSITORY_ROOT,
  pathExists = existsSync,
} = {}) {
  const relativePath = venvPythonRelativePath(platform);
  const absolutePath = resolve(repositoryRoot, relativePath);
  return pathExists(absolutePath) ? absolutePath : null;
}

export function runPython(
  args = process.argv.slice(2),
  {
    platform = process.platform,
    repositoryRoot = REPOSITORY_ROOT,
    pathExists = existsSync,
    spawn = spawnSync,
  } = {},
) {
  const python = resolveVenvPython({
    platform,
    repositoryRoot,
    pathExists,
  });
  if (!python) {
    const expected = venvPythonRelativePath(platform);
    console.error(
      `[python-runner] missing ${expected}\n` +
      'Create the pinned environment first:\n' +
      '  python -m venv bake/.venv\n' +
      '  node bake/run-python.mjs -m pip install -r bake/requirements.txt',
    );
    return 1;
  }
  if (args.length === 0) {
    console.error(
      '[python-runner] no Python module, script, or arguments were supplied',
    );
    return 2;
  }
  const result = spawn(python, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[python-runner] failed to start ${python}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runPython();
}
