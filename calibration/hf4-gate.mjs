import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = {
  contract: new URL('calibration/hf4-contract.json', root),
  verification: new URL('calibration/hf4-verification.json', root),
  performance: new URL('calibration/hf4-performance.json', root),
  output: new URL('calibration/hf4-acceptance.json', root),
};
const [contractText, verificationText, performanceText] = await Promise.all([
  readFile(files.contract, 'utf8'),
  readFile(files.verification, 'utf8'),
  readFile(files.performance, 'utf8'),
]);
const contract = JSON.parse(contractText);
const verification = JSON.parse(verificationText);
const performance = JSON.parse(performanceText);
const digest = (text) => createHash('sha256').update(text).digest('hex');
const checks = [];
const add = (id, pass, details = {}) => checks.push({ id, pass, ...details });
const lead = (leadH) => verification.validation.leads.find((item) => item.leadH === leadH);

add('preacceptance-label-is-perturbation-frequency',
  verification.probabilityLabel === 'perturbation-frequency', {
    actual: verification.probabilityLabel,
  });
for (const leadH of contract.gates.requiredLeadsH) {
  const item = lead(leadH);
  if (!item) throw new Error(`missing ${leadH} h HF-4 verification data`);
  add(`${leadH}h-positive-spread-error-correlation`,
    item.spreadErrorCorrelation > contract.gates.minimumSpreadErrorCorrelation, {
      actual: item.spreadErrorCorrelation,
    });
  add(`${leadH}h-intensity-crps-beats-deterministic`,
    item.meanIntensityCrpsKt < item.meanDeterministicIntensityAbsErrorKt, {
      ensemble: item.meanIntensityCrpsKt,
      deterministic: item.meanDeterministicIntensityAbsErrorKt,
    });
  const finiteSkills = Object.values(item.intensityBrierSkill)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  const meanBrierSkill = finiteSkills.reduce((sum, value) => sum + value, 0) /
    finiteSkills.length;
  add(`${leadH}h-mean-brier-skill-beats-development-climatology`,
    meanBrierSkill > contract.gates.minimumMeanBrierSkillAgainstDevelopmentClimatology, {
      actual: meanBrierSkill,
    });
  for (const nominal of contract.cone.nominalCoverage) {
    const key = String(nominal);
    const actual = item.coneCoverage[key];
    const tolerance = contract.cone.validationTolerance[key];
    add(`${leadH}h-${key}-cone-coverage-within-tolerance`,
      Math.abs(actual - nominal) <= tolerance, { nominal, actual, tolerance });
  }
  const positions = verification.validationCases
    .map((item) => item.leads.find((entry) => entry.leadH === leadH)?.memberPositions)
    .filter(Number.isFinite);
  const retention = Math.min(...positions) / verification.members;
  add(`${leadH}h-member-position-retention`,
    retention >= contract.gates.minimumMemberPositionRetentionFraction, {
      actual: retention,
    });
}
for (const [source, values] of Object.entries(verification.sourceAblations)) {
  const nonzero = contract.gates.requiredLeadsH.every((leadH) => values[String(leadH)] > 0);
  add(`${source}-produces-nonzero-spread`, nonzero, { actual: values });
}
const measuredDevices = performance.deviceMatrix.filter((item) => item.measuredMs);
for (const device of measuredDevices) {
  const within = Object.entries(performance.budgetsMs).every(
    ([members, budget]) => device.measuredMs[members] <= budget,
  );
  add(`${device.id}-performance-budget`, within, {
    measuredMs: device.measuredMs,
    budgetsMs: performance.budgetsMs,
  });
}
add('representative-device-matrix-complete',
  performance.deviceMatrix.every((item) => item.measuredMs), {
    unmeasured: performance.deviceMatrix
      .filter((item) => !item.measuredMs)
      .map((item) => item.id),
  });

const accepted = checks.every((check) => check.pass);
const output = {
  schemaVersion: 1,
  phase: 'HF-4',
  status: accepted ? 'accepted' : 'rejected',
  claimClass: 'legacy-validation-diagnostic',
  decision: accepted
    ? 'Frozen HF-4 gates passed; HF-6 independent and prospective confirmation remains required.'
    : 'Rejected without changing thresholds: the cone is overdispersed, 48 h mean Brier skill is negative, and the device matrix is incomplete. Keep perturbation-frequency labeling.',
  manifests: {
    contractSha256: digest(contractText),
    verificationSha256: digest(verificationText),
    performanceSha256: digest(performanceText),
  },
  checks,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(files.output, 'utf8');
  if (existing !== rendered) throw new Error('HF-4 acceptance artifact is stale');
} else {
  await writeFile(files.output, rendered);
  console.log(`[hf4] wrote calibration/hf4-acceptance.json (${output.status})`);
}
if (process.argv.includes('--require-accepted') && !accepted) process.exitCode = 1;
