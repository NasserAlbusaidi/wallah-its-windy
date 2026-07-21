import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = {
  contract: new URL('calibration/hf3-contract.json', root),
  selection: new URL('calibration/hf3-candidate-selection.json', root),
  validation: new URL('calibration/fidelity-validation-hf3-selected.json', root),
  baseline: new URL('calibration/fidelity-validation-hf2-selected.json', root),
  output: new URL('calibration/hf3-acceptance.json', root),
};
const [contractText, selectionText, validationText, baselineText] = await Promise.all([
  readFile(files.contract, 'utf8'),
  readFile(files.selection, 'utf8'),
  readFile(files.validation, 'utf8'),
  readFile(files.baseline, 'utf8'),
]);
const contract = JSON.parse(contractText);
const selection = JSON.parse(selectionText);
const validation = JSON.parse(validationText);
const baseline = JSON.parse(baselineText);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const selectedText = await readFile(new URL(selection.candidate.artifact, root), 'utf8');
const lead = (document, partition, leadH) =>
  document.leadTimes[partition].find((item) => item.leadH === leadH);
const checks = [];
const add = (id, pass, details) => checks.push({ id, pass, ...details });

add('development-candidate-hash', digest(selectedText) === selection.candidate.sha256, {
  expected: selection.candidate.sha256,
  actual: digest(selectedText),
});
add(
  'runtime-track-parameters-match-selection',
  JSON.stringify(validation.runtimeTrackParameters) ===
    JSON.stringify(selection.candidate.trackParameters),
  { expected: selection.candidate.trackParameters, actual: validation.runtimeTrackParameters },
);
for (const leadH of contract.requiredLeadsH) {
  const candidate = lead(validation, 'validation', leadH);
  const reference = lead(baseline, 'validation', leadH);
  if (!candidate || !reference) throw new Error(`missing ${leadH} h gate data`);
  const retention = candidate.model.samples / reference.model.samples;
  add(`${leadH}h-sample-retention`, retention >= contract.gates.minimumSampleRetentionFraction, {
    actual: retention,
  });
  add(
    `${leadH}h-positive-skill-linear-persistence`,
    candidate.trackMaeSkillFraction > contract.gates.minimumTrackSkillAgainstLinearPersistence,
    { actual: candidate.trackMaeSkillFraction },
  );
  add(
    `${leadH}h-positive-skill-climatology-persistence`,
    candidate.trackMaeSkillFractionAgainstCliper >
      contract.gates.minimumTrackSkillAgainstClimatologyPersistence,
    { actual: candidate.trackMaeSkillFractionAgainstCliper },
  );
  if (leadH === 12 || leadH === 24) {
    const candidateBias = Math.hypot(
      candidate.model.alongTrackBiasKm,
      candidate.model.crossTrackBiasKm,
    );
    const referenceBias = Math.hypot(
      reference.model.alongTrackBiasKm,
      reference.model.crossTrackBiasKm,
    );
    add(`${leadH}h-combined-track-bias-improved`, candidateBias < referenceBias, {
      candidate: candidateBias,
      reference: referenceBias,
    });
  }
}
const candidateAggregate = validation.aggregate.validation;
const referenceAggregate = baseline.aggregate.validation;
add(
  'aggregate-intensity-mae-regression-within-limit',
  candidateAggregate.intensityMaeKt <=
    referenceAggregate.intensityMaeKt *
      (1 + contract.gates.maximumAggregateIntensityMaeRegressionFraction),
  {
    candidate: candidateAggregate.intensityMaeKt,
    reference: referenceAggregate.intensityMaeKt,
    regressionFraction:
      candidateAggregate.intensityMaeKt / referenceAggregate.intensityMaeKt - 1,
  },
);
add(
  'aggregate-pressure-mae-regression-within-limit',
  candidateAggregate.pressureMaeHpa <=
    referenceAggregate.pressureMaeHpa *
      (1 + contract.gates.maximumAggregatePressureMaeRegressionFraction),
  {
    candidate: candidateAggregate.pressureMaeHpa,
    reference: referenceAggregate.pressureMaeHpa,
    regressionFraction:
      candidateAggregate.pressureMaeHpa / referenceAggregate.pressureMaeHpa - 1,
  },
);

const accepted = checks.every((check) => check.pass);
const output = {
  schemaVersion: 1,
  phase: 'HF-3',
  status: accepted ? 'accepted' : 'rejected',
  claimClass: 'legacy-validation-diagnostic',
  decision: accepted
    ? 'All frozen diagnostic gates passed; HF-6 independent confirmation is still required.'
    : 'Rejected without changing thresholds; preserve the implementation and evaluate revisions only on a newly sealed cohort.',
  manifests: {
    contractSha256: digest(contractText),
    selectionSha256: digest(selectionText),
    validationSha256: digest(validationText),
    hf2BaselineSha256: digest(baselineText),
  },
  checks,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(files.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-3 acceptance artifact is stale');
} else {
  await writeFile(files.output, rendered);
  console.log(`[hf3] wrote calibration/hf3-acceptance.json (${output.status})`);
}
if (process.argv.includes('--require-accepted') && !accepted) process.exitCode = 1;
