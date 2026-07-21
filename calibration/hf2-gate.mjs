import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const paths = {
  contract: new URL('calibration/hf2-contract.json', root),
  selection: new URL('calibration/hf2-candidate-selection.json', root),
  validation: new URL('calibration/fidelity-validation-hf2-selected.json', root),
  reference: new URL('calibration/fidelity-reference.json', root),
  ocean: new URL('calibration/hf2a-ocean-acceptance.json', root),
  structure: new URL('calibration/results.json', root),
  output: new URL('calibration/hf2-acceptance.json', root),
};

const [contractText, selectionText, validationText, referenceText, oceanText, structureText] =
  await Promise.all([
    readFile(paths.contract, 'utf8'),
    readFile(paths.selection, 'utf8'),
    readFile(paths.validation, 'utf8'),
    readFile(paths.reference, 'utf8'),
    readFile(paths.ocean, 'utf8'),
    readFile(paths.structure, 'utf8'),
  ]);
const contract = JSON.parse(contractText);
const selection = JSON.parse(selectionText);
const validation = JSON.parse(validationText);
const reference = JSON.parse(referenceText);
const ocean = JSON.parse(oceanText);
const structure = JSON.parse(structureText);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const lead = (source, leadH) => source.find((item) => item.leadH === leadH);
const checks = [];
const add = (id, pass, details) => checks.push({ id, pass, ...details });

const selectedText = await readFile(new URL(selection.candidate.artifact, root), 'utf8');
add('development-candidate-hash', digest(selectedText) === selection.candidate.sha256, {
  expected: selection.candidate.sha256,
  actual: digest(selectedText),
});
add('runtime-parameters-match-selection',
  JSON.stringify(validation.runtimeParameters) === JSON.stringify(selection.candidate.parameters), {
    expected: selection.candidate.parameters,
    actual: validation.runtimeParameters,
  });
add('ocean-component-accepted', ocean.status === 'accepted', {
  actual: ocean.status,
});
add('structure-component-accepted', structure.calibration?.accepted === true, {
  actual: structure.calibration?.accepted ?? null,
});

for (const leadH of contract.requiredLeadsH) {
  const candidate = lead(validation.leadTimes.validation, leadH);
  const baseline = lead(reference.validation.leadTimes, leadH);
  if (!candidate || !baseline) throw new Error(`missing ${leadH} h gate data`);
  const retention = candidate.model.intensitySamples / baseline.model.intensitySamples;
  add(`${leadH}h-sample-retention`,
    retention >= contract.gates.minimumSampleRetentionFraction, { actual: retention });
  add(`${leadH}h-positive-intensity-skill`,
    candidate.intensityMaeSkillFraction > contract.gates.minimumIntensitySkillFractionAgainstPersistence,
    { actual: candidate.intensityMaeSkillFraction });
  add(`${leadH}h-positive-pressure-skill`,
    candidate.pressureMaeSkillFraction > contract.gates.minimumPressureSkillFractionAgainstPersistence,
    { actual: candidate.pressureMaeSkillFraction });
  add(`${leadH}h-intensity-absolute-bias-improved`,
    Math.abs(candidate.model.intensityBiasKt) < Math.abs(candidate.persistence.intensityBiasKt),
    { candidate: Math.abs(candidate.model.intensityBiasKt), persistence: Math.abs(candidate.persistence.intensityBiasKt) });
  add(`${leadH}h-pressure-absolute-bias-improved`,
    Math.abs(candidate.model.pressureBiasHpa) < Math.abs(candidate.persistence.pressureBiasHpa),
    { candidate: Math.abs(candidate.model.pressureBiasHpa), persistence: Math.abs(candidate.persistence.pressureBiasHpa) });
}

const accepted = checks.every((check) => check.pass);
const output = {
  schemaVersion: 1,
  phase: 'HF-2',
  status: accepted ? 'accepted' : 'rejected',
  claimClass: 'legacy-validation-diagnostic',
  decision: accepted
    ? 'All frozen gates passed, but a new sealed cohort is still required for a confirmatory claim.'
    : 'Rejected without changing thresholds; retain the implementation as experimental and retest only on a new sealed cohort.',
  manifests: {
    contractSha256: digest(contractText),
    selectionSha256: digest(selectionText),
    validationSha256: digest(validationText),
    hf1ReferenceSha256: digest(referenceText),
  },
  checks,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(paths.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-2 acceptance artifact is stale');
} else {
  await writeFile(paths.output, rendered);
  console.log(`[hf2] wrote calibration/hf2-acceptance.json (${output.status})`);
}
if (process.argv.includes('--require-accepted') && !accepted) process.exitCode = 1;
