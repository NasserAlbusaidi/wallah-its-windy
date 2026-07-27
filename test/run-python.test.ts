import { describe, expect, it, vi } from 'vitest';
// The launcher is intentionally plain .mjs so package scripts can run it under
// Node without a TypeScript loader.
// @ts-expect-error no declaration file is needed by the production launcher.
import { resolveVenvPython, runPython, venvPythonRelativePath } from '../bake/run-python.mjs';

describe('cross-platform bake Python launcher', () => {
  it('selects the standard virtual-environment layout by platform', () => {
    expect(venvPythonRelativePath('win32')).toBe(
      'bake/.venv/Scripts/python.exe',
    );
    expect(venvPythonRelativePath('linux')).toBe(
      'bake/.venv/bin/python',
    );
    expect(venvPythonRelativePath('darwin')).toBe(
      'bake/.venv/bin/python',
    );
  });

  it('returns only a repository-owned interpreter that exists', () => {
    expect(resolveVenvPython({
      platform: 'win32',
      repositoryRoot: '/repo',
      pathExists: () => true,
    })).toMatch(/bake[\\/]\.venv[\\/]Scripts[\\/]python\.exe$/);
    expect(resolveVenvPython({
      platform: 'linux',
      repositoryRoot: '/repo',
      pathExists: () => false,
    })).toBeNull();
  });

  it('fails closed instead of falling back to a system interpreter', () => {
    const spawn = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runPython(['script.py'], {
      platform: 'win32',
      repositoryRoot: 'C:\\repo',
      pathExists: () => false,
      spawn,
    })).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('bake/.venv/Scripts/python.exe'),
    );
    error.mockRestore();
  });

  it('forwards Python arguments unchanged from the repository root', () => {
    const spawn = vi.fn(() => ({ status: 7 }));
    expect(runPython(['-u', 'bake/job.py', '--check'], {
      platform: 'linux',
      repositoryRoot: '/repo',
      pathExists: () => true,
      spawn,
    })).toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/bake[\\/]\.venv[\\/]bin[\\/]python$/),
      ['-u', 'bake/job.py', '--check'],
      { cwd: '/repo', stdio: 'inherit' },
    );
  });
});
