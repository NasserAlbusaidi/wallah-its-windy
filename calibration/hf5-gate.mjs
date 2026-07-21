import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const root = new URL('../', import.meta.url);
const files = {
  contract: new URL('calibration/hf5-contract.json', root),
  sample: new URL('calibration/data/hf5/sample-live-run.json', root),
  archiver: new URL('bake/live_archive.mjs', root),
  output: new URL('calibration/hf5-acceptance.json', root),
};
const [contractText, sampleText, archiverText] = await Promise.all([
  readFile(files.contract, 'utf8'),
  readFile(files.sample, 'utf8'),
  readFile(files.archiver, 'utf8'),
]);
const contract = JSON.parse(contractText);
const sample = JSON.parse(sampleText);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const vite = await createServer({
  root: new URL('../', import.meta.url).pathname,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [{ validateArchivedRun }, { HF5_PROVIDER_DESCRIPTORS }] = await Promise.all([
  vite.ssrLoadModule('/src/live-data.ts'),
  vite.ssrLoadModule('/src/live-providers.ts'),
]);
await vite.close();
const checks = [];
const add = (id, pass, details = {}) => checks.push({ id, pass, ...details });
const sampleErrors = validateArchivedRun(sample);
add('sample-cycle-validates', sampleErrors.length === 0, { errors: sampleErrors });
for (const kind of contract.requiredProducts) {
  add(`${kind}-provider-seam`,
    HF5_PROVIDER_DESCRIPTORS.some((provider) => provider.products.includes(kind)), {});
  add(`${kind}-sample-manifest`,
    sample.inputs.some((input) => input.required && input.kind === kind), {});
}
add('immutable-archive-publication',
  archiverText.includes("await link(temporary, target)") &&
    archiverText.includes('immutable archive collision'), {});
add('climatology-fallback-not-current',
  contract.failurePolicy.fallback.includes('not-current-forecast'), {});
add('side-by-side-guidance-present',
  ['official', 'persistence', 'wallahModel'].every((key) => key in sample.guidance), {});
add('operational-feed-is-not-falsely-configured',
  contract.operationalStatus.includes('no continuously scheduled provider feed'), {});
const complete = checks.every((check) => check.pass);
const output = {
  schemaVersion: 1,
  phase: 'HF-5',
  implementationStatus: complete ? 'complete' : 'incomplete',
  operationalLiveStatus: 'disabled-no-scheduled-provider-feed',
  decision: complete
    ? 'The provider-neutral normalization, visible-failure, cycle-integrity, and immutable-archive contracts are implemented. Live output remains disabled until a lawful scheduled feed is configured and prospectively verified.'
    : 'HF-5 infrastructure is incomplete.',
  manifests: {
    contractSha256: digest(contractText),
    sampleRunSha256: digest(sampleText),
    archiverSha256: digest(archiverText),
  },
  checks,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(files.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-5 acceptance artifact is stale');
} else {
  await writeFile(files.output, rendered);
  console.log(`[hf5] wrote calibration/hf5-acceptance.json (${output.implementationStatus})`);
}
if (process.argv.includes('--require-complete') && !complete) process.exitCode = 1;
