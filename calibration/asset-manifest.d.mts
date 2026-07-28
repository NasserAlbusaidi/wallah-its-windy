export const VOLATILE_ASSET_PREFIXES: readonly ['live/', 'satellite/'];

export function buildManifest(rootUrl: URL): Record<string, string>;

export function diffManifest(
  actual: Record<string, string>,
  committed: Record<string, string>,
): {
  drifted: string[];
  added: string[];
  removed: string[];
};
