import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const files = {
  contract: new URL('calibration/hf6-contract.json', root),
  catalog: new URL('calibration/data/hf6-case-catalog.json', root),
  audit: new URL('calibration/hf6-observation-audit.json', root),
  verification: new URL('calibration/hf6-sealed-verification.json', root),
  prospective: new URL('calibration/data/hf6/prospective-registry.json', root),
  hf2: new URL('calibration/hf2-acceptance.json', root),
  hf3: new URL('calibration/hf3-acceptance.json', root),
  hf4: new URL('calibration/hf4-acceptance.json', root),
  modelCard: new URL('docs/model-card-hf6.md', root),
  output: new URL('calibration/hf6-acceptance.json', root),
  scorecard: new URL('docs/hf6-scorecard.md', root),
};
const names = Object.keys(files).filter((key) => !['output', 'scorecard'].includes(key));
const texts = Object.fromEntries(await Promise.all(
  names.map(async (key) => [key, await readFile(files[key], 'utf8')]),
));
const data = Object.fromEntries(
  names.filter((key) => key !== 'modelCard').map((key) => [key, JSON.parse(texts[key])]),
);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const checks = [];
const add = (scope, id, pass, details = {}) => checks.push({ scope, id, pass, ...details });
const { contract, catalog, audit, verification, prospective } = data;
const sealed = catalog.cases.filter((item) => item.partition === 'sealed-confirmation');
add('implementation', 'catalogue-size',
  catalog.cases.length >= contract.catalogue.minimumStorms &&
    catalog.cases.length <= contract.catalogue.maximumStorms,
  { actual: catalog.cases.length });
add('implementation', 'multiple-initializations',
  catalog.cases.every((item) =>
    item.initializations.length >= contract.catalogue.minimumInitializationsPerStorm),
  { actual: Math.min(...catalog.cases.map((item) => item.initializations.length)) });
add('implementation', 'sealed-independent-canonical-cohort',
  sealed.length >= contract.catalogue.minimumSealedCanonicalStorms &&
    sealed.every((item) => item.legacyId === null && item.initializations.every(
      (initialization) => initialization.windCanonicalOneMinute &&
        initialization.availableObservationH >= 48,
    )), { actual: sealed.length });
add('implementation', 'selection-sealed-before-first-look',
  catalog.sealedBeforeCandidateEvaluation === true && catalog.sealId === contract.sealId, {});
add('implementation', 'observation-audit-bound-to-catalog',
  audit.manifests.catalogSha256 === digest(texts.catalog) &&
    audit.storms === catalog.cases.length &&
    audit.initializations === catalog.protocol.actualInitializations, {});
for (const outcome of Object.entries(audit.outcomeAvailability)) {
  add('implementation', `outcome-${outcome[0]}-audited`, outcome[1] > 0, { actual: outcome[1] });
}
for (const stratum of contract.strata) {
  const key = {
    'initial-intensity': 'initialIntensity',
    'land-interaction': 'landInteraction',
    'data-era': 'dataEra',
    'forecast-difficulty': 'forecastDifficulty',
    'observation-availability': 'observationAvailability',
  }[stratum] ?? stratum;
  add('implementation', `stratum-${stratum}`, Object.keys(audit.strataCounts[key] ?? {}).length >= 2, {
    actual: audit.strataCounts[key] ?? null,
  });
}
add('implementation', 'immutable-prospective-registry-present',
  prospective.archivePolicy.includes('before verifying observations exist') &&
    prospective.claim.includes('no prospective skill claim'), {});
add('implementation', 'model-card-published', texts.modelCard.includes('HF-6 model card'), {});

add('sealed-evidence', 'sealed-storm-count', verification.storms === sealed.length, {
  expected: sealed.length,
  actual: verification.storms,
});
add('sealed-evidence', 'sealed-initialization-count',
  verification.initializations === sealed.reduce((sum, item) => sum + item.initializations.length, 0), {
    actual: verification.initializations,
  });
const lead = (leadH) => verification.leads.find((item) => item.leadH === leadH);
for (const leadH of contract.sealedConfirmation.hf2IntensityLeadsH) {
  const item = lead(leadH);
  add('sealed-evidence', `hf2-${leadH}h-positive-intensity-skill`,
    item?.intensityMaeSkillFraction > contract.sealedConfirmation.minimumSkillAgainstLinearPersistence,
    { actual: item?.intensityMaeSkillFraction ?? null });
  add('sealed-evidence', `hf2-${leadH}h-positive-pressure-skill`,
    item?.pressureMaeSkillFraction > contract.sealedConfirmation.minimumSkillAgainstLinearPersistence,
    { actual: item?.pressureMaeSkillFraction ?? null });
}
for (const leadH of contract.sealedConfirmation.hf3TrackLeadsH) {
  const item = lead(leadH);
  add('sealed-evidence', `hf3-${leadH}h-positive-track-skill`,
    item?.trackMaeSkillFraction > contract.sealedConfirmation.minimumSkillAgainstLinearPersistence,
    { actual: item?.trackMaeSkillFraction ?? null });
  const retention = item && item.persistence.samples > 0
    ? item.model.samples / item.persistence.samples
    : 0;
  add('sealed-evidence', `hf3-${leadH}h-sample-retention`,
    retention >= contract.sealedConfirmation.minimumSampleRetentionFraction,
    { actual: retention });
}
for (const [key, value] of Object.entries(verification.outcomes)) {
  add('sealed-evidence', `outcome-score-${key}`, value !== null, { actual: value });
}
for (const [key, value] of Object.entries(verification.outcomes.structureMaeKm)) {
  add('sealed-evidence', `outcome-score-structure-${key}`,
    value !== null && Number.isFinite(value), { actual: value });
}
for (const [key, value] of Object.entries(verification.outcomes.thresholdEventAccuracy)) {
  add('sealed-evidence', `outcome-score-threshold-${key}`,
    value !== null && Number.isFinite(value), { actual: value });
}
add('prospective-evidence', 'minimum-matured-forecasts',
  prospective.counts.matured >= contract.prospective.minimumMaturedForecastsBeforeSkillClaim, {
    expected: contract.prospective.minimumMaturedForecastsBeforeSkillClaim,
    actual: prospective.counts.matured,
  });
add('prospective-evidence', 'minimum-distinct-storms',
  prospective.counts.distinctStorms >= contract.prospective.minimumDistinctStorms, {
    expected: contract.prospective.minimumDistinctStorms,
    actual: prospective.counts.distinctStorms,
  });
add('honesty', 'hf4-label-not-promoted',
  data.hf4.status === 'rejected' && data.hf4.decision.includes('perturbation-frequency'), {});
add('honesty', 'prior-negative-results-preserved',
  data.hf2.status === 'rejected' && data.hf3.status === 'rejected', {
    hf2: data.hf2.status,
    hf3: data.hf3.status,
  });

const implementationComplete = checks
  .filter((item) => item.scope === 'implementation' || item.scope === 'honesty')
  .every((item) => item.pass);
const sealedAccepted = checks
  .filter((item) => item.scope === 'sealed-evidence')
  .every((item) => item.pass);
const prospectiveAccepted = checks
  .filter((item) => item.scope === 'prospective-evidence')
  .every((item) => item.pass);
const output = {
  schemaVersion: 1,
  phase: 'HF-6',
  implementationStatus: implementationComplete ? 'complete' : 'incomplete',
  sealedRetrospectiveStatus: sealedAccepted ? 'accepted' : 'rejected',
  prospectiveStatus: prospectiveAccepted ? 'accepted' : 'awaiting-future-storms',
  productClaim: prospectiveAccepted
    ? 'prospectively evaluated experimental forecast companion'
    : 'experimental simulator and retrospective forecast-companion prototype; no prospective skill claim',
  decision: implementationComplete
    ? 'HF-6 implementation is complete. The frozen sealed first look is reported without retuning; prospective acceptance remains open until future forecasts mature.'
    : 'HF-6 implementation is incomplete.',
  manifests: Object.fromEntries(names.map((key) => [`${key}Sha256`, digest(texts[key])])),
  checks,
};
const fmt = (value, digits = 3) => value === null || value === undefined
  ? '—'
  : Number(value).toFixed(digits);
const scorecard = `# HF-6 versioned scorecard

> Generated by \`npm run hf6:gate\`. Do not edit metric values by hand.

## Verdict

**Implementation: ${output.implementationStatus.toUpperCase()}. Sealed first look: ${output.sealedRetrospectiveStatus.toUpperCase()}. Prospective evidence: ${output.prospectiveStatus.toUpperCase()}.**

${output.decision} The product claim remains: **${output.productClaim}**.

## Scope and availability

- ${catalog.cases.length} Arabian Sea storms, ${catalog.protocol.actualInitializations} initializations, 1940–2024.
- ${sealed.length} independent USA/JTWC-compatible sealed storms and ${verification.initializations} first-look initializations.
- Exact track samples at 12/24/48/72 h: ${[12, 24, 48, 72].map((hour) => audit.leadAvailability[String(hour)].track).join('/')}.
- Canonical one-minute wind samples at 12/24/48/72 h: ${[12, 24, 48, 72].map((hour) => audit.leadAvailability[String(hour)].oneMinuteWind).join('/')}.
- Prospective matured forecasts: ${prospective.counts.matured}; required before a skill claim: ${contract.prospective.minimumMaturedForecastsBeforeSkillClaim}.

## Sealed lead-time verification

| Lead | n track | Track MAE / persistence km | Track skill | Wind MAE / persistence kt | Wind skill | Pressure MAE / persistence hPa | Pressure skill |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${verification.leads.map((item) => `| ${item.leadH} h | ${item.model.samples} | ${fmt(item.model.trackMaeKm, 1)} / ${fmt(item.persistence.trackMaeKm, 1)} | ${fmt(item.trackMaeSkillFraction)} | ${fmt(item.model.intensityMaeKt, 1)} / ${fmt(item.persistence.intensityMaeKt, 1)} | ${fmt(item.intensityMaeSkillFraction)} | ${fmt(item.model.pressureMaeHpa, 1)} / ${fmt(item.persistence.pressureMaeHpa, 1)} | ${fmt(item.pressureMaeSkillFraction)} |`).join('\n')}

## Additional outcomes

| Metric | Result |
| --- | ---: |
| Landfall position MAE | ${fmt(verification.outcomes.landfallPositionMaeKm, 1)} km |
| Landfall time MAE | ${fmt(verification.outcomes.landfallTimeMaeH, 1)} h |
| Landfall event accuracy | ${fmt(verification.outcomes.landfallEventAccuracy)} |
| Peak intensity MAE | ${fmt(verification.outcomes.peakIntensityMaeKt, 1)} kt |
| Peak time MAE | ${fmt(verification.outcomes.peakTimeMaeH, 1)} h |
| Rapid-intensification event accuracy | ${fmt(verification.outcomes.rapidIntensificationEventAccuracy)} |
| Dissipation event accuracy | ${fmt(verification.outcomes.dissipationEventAccuracy)} |
| RMW MAE | ${fmt(verification.outcomes.structureMaeKm.rmwKm, 1)} km |
| R34 / R50 / R64 MAE | ${fmt(verification.outcomes.structureMaeKm.r34Km, 1)} / ${fmt(verification.outcomes.structureMaeKm.r50Km, 1)} / ${fmt(verification.outcomes.structureMaeKm.r64Km, 1)} km |

## Interpretation limits

- This is the first look at the sealed cohort; thresholds were not changed after viewing it.
- ERA5 is reanalysis, not an archived real-time forecast, so retrospective scores can be optimistic.
- Non-USA wind periods in the broad catalogue remain report-only; they are never silently compared with one-minute model wind.
- Coarse best-track landfall time is a proxy, and sparse RMW/radii samples are reported rather than imputed.
- A zero-case prospective registry cannot establish live forecast skill. Official agency warnings remain authoritative.
`;
const rendered = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const [existing, existingScorecard] = await Promise.all([
    readFile(files.output, 'utf8'),
    readFile(files.scorecard, 'utf8'),
  ]);
  if (existing !== rendered || existingScorecard !== scorecard) {
    throw new Error('HF-6 gate or scorecard artifact is stale');
  }
} else {
  await Promise.all([
    writeFile(files.output, rendered),
    writeFile(files.scorecard, scorecard),
  ]);
  console.log(`[hf6] wrote gate: implementation=${output.implementationStatus} sealed=${output.sealedRetrospectiveStatus} prospective=${output.prospectiveStatus}`);
}
if (process.argv.includes('--require-implementation-complete') && !implementationComplete) {
  process.exitCode = 1;
}
