#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = resolve(ROOT, 'calibration/hf2a-contract.json');
const SELECTION_PATH = resolve(ROOT, 'calibration/hf2a-candidate-selection.json');
const REFERENCE_PATH = resolve(ROOT, 'calibration/hf2a-ocean-reference.json');
const VALIDATION_PATH = resolve(ROOT, 'calibration/hf2a-ocean-candidate-validation.json');
const OUTPUT_PATH = resolve(ROOT, 'calibration/hf2a-ocean-acceptance.json');

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function lead(document, partition, leadH) {
  const row = document.aggregate[partition].leads.find((item) => item.leadH === leadH);
  if (!row) throw new Error(`missing ${partition} ${leadH}h ocean metric`);
  return row;
}

const [contractBytes, selectionBytes, referenceBytes, validationBytes] =
  await Promise.all([
    readFile(CONTRACT_PATH),
    readFile(SELECTION_PATH),
    readFile(REFERENCE_PATH),
    readFile(VALIDATION_PATH),
  ]);
const contract = JSON.parse(contractBytes);
const selection = JSON.parse(selectionBytes);
const reference = JSON.parse(referenceBytes);
const validation = JSON.parse(validationBytes);
const developmentBytes = await readFile(resolve(ROOT, selection.developmentArtifact.path));

const checks = [];
checks.push({
  id: 'candidate-frozen-before-validation',
  pass: digest(developmentBytes) === selection.developmentArtifact.sha256,
  expectedSha256: selection.developmentArtifact.sha256,
  actualSha256: digest(developmentBytes),
});
checks.push({
  id: 'minimum-validation-storms',
  pass:
    validation.aggregate.validation.storms >=
    contract.oceanBenchmark.acceptance.minimumValidationStorms,
  actual: validation.aggregate.validation.storms,
});

const leads = contract.oceanBenchmark.acceptance.requiredLeadsH.map((leadH) => {
  const candidate = lead(validation, 'validation', leadH);
  const baseline = lead(reference, 'validation', leadH);
  const skillFraction = 1 - candidate.deltaSstMaeC / baseline.deltaSstMaeC;
  const absoluteBiasImprovementC =
    Math.abs(baseline.deltaSstBiasC) - Math.abs(candidate.deltaSstBiasC);
  const sampleRetentionFraction = candidate.pixels / baseline.pixels;
  const result = {
    leadH,
    candidateMaeC: candidate.deltaSstMaeC,
    referenceMaeC: baseline.deltaSstMaeC,
    skillFraction,
    candidateBiasC: candidate.deltaSstBiasC,
    referenceBiasC: baseline.deltaSstBiasC,
    absoluteBiasImprovementC,
    sampleRetentionFraction,
    gates: {
      positivePairedSkill:
        skillFraction > contract.oceanBenchmark.acceptance.minimumPairedSkillFraction,
      absoluteBiasImproved: absoluteBiasImprovementC > 0,
      allSamplesRetained:
        sampleRetentionFraction >=
        contract.oceanBenchmark.acceptance.requiredSampleRetentionFraction,
    },
  };
  checks.push({
    id: `${leadH}h-positive-paired-skill`,
    pass: result.gates.positivePairedSkill,
    actual: skillFraction,
  });
  checks.push({
    id: `${leadH}h-absolute-bias-improved`,
    pass: result.gates.absoluteBiasImproved,
    actual: absoluteBiasImprovementC,
  });
  checks.push({
    id: `${leadH}h-sample-retention`,
    pass: result.gates.allSamplesRetained,
    actual: sampleRetentionFraction,
  });
  return result;
});

const passed = checks.every((check) => check.pass);
const report = {
  schemaVersion: 1,
  phase: 'HF-2A',
  evaluatedAt: '2026-07-21',
  status: passed ? 'accepted' : 'rejected',
  decision: passed
    ? 'Eligible to proceed to the coupled HF-2A gate.'
    : 'Rejected without changing thresholds; a revised candidate requires a new sealed acceptance cohort.',
  manifests: {
    contract: { path: 'calibration/hf2a-contract.json', sha256: digest(contractBytes) },
    selection: {
      path: 'calibration/hf2a-candidate-selection.json',
      sha256: digest(selectionBytes),
    },
    reference: {
      path: 'calibration/hf2a-ocean-reference.json',
      sha256: digest(referenceBytes),
    },
    validation: {
      path: 'calibration/hf2a-ocean-candidate-validation.json',
      sha256: digest(validationBytes),
    },
  },
  leads,
  checks,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => '');
  if (current !== text) throw new Error('[hf2a-ocean-gate] acceptance artifact drift');
} else {
  await writeFile(OUTPUT_PATH, text);
}
process.stdout.write(`[hf2a-ocean-gate] ${report.status.toUpperCase()}\n`);
for (const check of checks) {
  process.stdout.write(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.id}\n`);
}
if (process.argv.includes('--enforce') && !passed) process.exitCode = 1;
