import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface FidelityLead {
  leadH: number;
  model: Record<string, number>;
  persistence: Record<string, number>;
  intensityMaeSkillFraction: number;
  pressureMaeSkillFraction: number;
}

interface FidelityReference {
  catalogSha256: string;
  validation: {
    aggregate: Record<string, number>;
    leadTimes: FidelityLead[];
  };
}

interface CatalogStorm {
  id: string;
  year: number;
  partition: 'development' | 'validation' | 'test';
}

interface FidelityCatalog {
  protocol: {
    partitions: Record<'development' | 'validation' | 'test', number>;
  };
  storms: CatalogStorm[];
}

interface ContractLead {
  leadH: number;
  samples: number;
  intensitySamples: number;
  pressureSamples: number;
  trackMaeKm: number;
  intensityMaeKt: number;
  intensityBiasKt: number;
  intensityMaeSkillFraction: number;
  persistenceIntensityMaeKt: number;
  persistenceIntensityBiasKt: number;
  pressureMaeHpa: number;
  pressureBiasHpa: number;
  pressureMaeSkillFraction: number;
  persistencePressureMaeHpa: number;
  persistencePressureBiasHpa: number;
}

interface Hf2aContract {
  schemaVersion: number;
  status: string;
  frozenInputs: {
    fidelityCatalog: {
      path: string;
      sha256: string;
      partitions: Record<'development' | 'validation' | 'test', number>;
    };
    fidelityReference: { path: string; sha256: string };
  };
  hf1ValidationBaseline: {
    aggregate: Record<string, number>;
    leadTimes: ContractLead[];
  };
  oceanBenchmark: {
    referenceArtifact: string;
    referenceSha256: string;
    requiredBeforePhysicsImplementation: boolean;
    currentStatus: string;
    partitions: {
      development: string[];
      validation: string[];
      testReportOnly: string[];
    };
    acceptance: {
      minimumValidationStorms: number;
      requiredLeadsH: number[];
      minimumPairedSkillFraction: number;
      strictlyGreaterThanMinimum: boolean;
      absoluteBiasMustImprove: boolean;
      requiredSampleRetentionFraction: number;
    };
  };
  physicsContract: {
    horizontalGridDegrees: number;
    fixedConstants: Record<string, number | string>;
    verticalLevelsM: number[];
    tunableParameters: Record<string, unknown>;
    forbiddenDirectIntensityTerms: string[];
    selectedParameters: Record<string, number>;
    selectionArtifact: string;
  };
  gates: {
    hf2aCandidate: Record<string, number | boolean>;
    hf2Completion: Record<string, number | boolean | number[]>;
  };
  workflow: {
    parameterSelectionPartition: string;
    acceptancePartition: string;
    reportOnlyPartition: string;
    candidateMustBeHashedBeforeValidation: boolean;
    validationAttemptsMustBeLogged: boolean;
    validationGuidedChangesInvalidateConfirmatoryUse: boolean;
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function modernIds(catalog: FidelityCatalog, partition: CatalogStorm['partition']): string[] {
  return catalog.storms
    .filter((storm) => storm.partition === partition && storm.year >= 2002)
    .map((storm) => storm.id);
}

describe('HF-2A locked scientific contract', () => {
  const contract = readJson<Hf2aContract>('calibration/hf2a-contract.json');
  const referenceText = readFileSync(contract.frozenInputs.fidelityReference.path, 'utf8');
  const catalogText = readFileSync(contract.frozenInputs.fidelityCatalog.path, 'utf8');
  const reference = JSON.parse(referenceText) as FidelityReference;
  const catalog = JSON.parse(catalogText) as FidelityCatalog;

  it('pins the exact HF-1 catalogue and reference bytes', () => {
    expect(contract.schemaVersion).toBe(2);
    expect(contract.status).toBe('candidate-selection-locked');
    expect(sha256(catalogText)).toBe(contract.frozenInputs.fidelityCatalog.sha256);
    expect(sha256(referenceText)).toBe(contract.frozenInputs.fidelityReference.sha256);
    expect(reference.catalogSha256).toBe(contract.frozenInputs.fidelityCatalog.sha256);
    expect(contract.frozenInputs.fidelityCatalog.partitions).toEqual(
      catalog.protocol.partitions,
    );
  });

  it('copies the acceptance baseline without rounding or hand-edited drift', () => {
    for (const [metric, value] of Object.entries(contract.hf1ValidationBaseline.aggregate)) {
      expect(value, metric).toBe(reference.validation.aggregate[metric]);
    }

    for (const snapshot of contract.hf1ValidationBaseline.leadTimes) {
      const lead = reference.validation.leadTimes.find((row) => row.leadH === snapshot.leadH);
      expect(lead, `missing ${snapshot.leadH} h reference`).toBeDefined();
      expect(snapshot).toEqual({
        leadH: lead!.leadH,
        samples: lead!.model.samples,
        intensitySamples: lead!.model.intensitySamples,
        pressureSamples: lead!.model.pressureSamples,
        trackMaeKm: lead!.model.trackMaeKm,
        intensityMaeKt: lead!.model.intensityMaeKt,
        intensityBiasKt: lead!.model.intensityBiasKt,
        intensityMaeSkillFraction: lead!.intensityMaeSkillFraction,
        persistenceIntensityMaeKt: lead!.persistence.intensityMaeKt,
        persistenceIntensityBiasKt: lead!.persistence.intensityBiasKt,
        pressureMaeHpa: lead!.model.pressureMaeHpa,
        pressureBiasHpa: lead!.model.pressureBiasHpa,
        pressureMaeSkillFraction: lead!.pressureMaeSkillFraction,
        persistencePressureMaeHpa: lead!.persistence.pressureMaeHpa,
        persistencePressureBiasHpa: lead!.persistence.pressureBiasHpa,
      });
    }
  });

  it('freezes all MUR-era storms by the existing scientific partitions', () => {
    expect(contract.oceanBenchmark.partitions.development).toEqual(
      modernIds(catalog, 'development'),
    );
    expect(contract.oceanBenchmark.partitions.validation).toEqual(
      modernIds(catalog, 'validation'),
    );
    expect(contract.oceanBenchmark.partitions.testReportOnly).toEqual(
      modernIds(catalog, 'test'),
    );
    expect(contract.oceanBenchmark.partitions.validation).toHaveLength(4);
    expect(contract.oceanBenchmark.acceptance.minimumValidationStorms).toBe(3);
  });

  it('requires independent ocean skill before the new physics can be accepted', () => {
    expect(contract.oceanBenchmark.requiredBeforePhysicsImplementation).toBe(true);
    expect(contract.oceanBenchmark.currentStatus).toBe('development-candidate-frozen');
    const oceanReference = readFileSync(contract.oceanBenchmark.referenceArtifact, 'utf8');
    expect(sha256(oceanReference)).toBe(contract.oceanBenchmark.referenceSha256);
    expect(contract.oceanBenchmark.acceptance.requiredLeadsH).toEqual([24, 48]);
    expect(contract.oceanBenchmark.acceptance.minimumPairedSkillFraction).toBe(0);
    expect(contract.oceanBenchmark.acceptance.strictlyGreaterThanMinimum).toBe(true);
    expect(contract.oceanBenchmark.acceptance.absoluteBiasMustImprove).toBe(true);
    expect(contract.oceanBenchmark.acceptance.requiredSampleRetentionFraction).toBe(1);
  });

  it('allows only bounded ocean-state parameters and bans duplicate intensity terms', () => {
    expect(contract.physicsContract.horizontalGridDegrees).toBe(0.1);
    expect(contract.physicsContract.fixedConstants).toMatchObject({
      gravityMs2: 9.80665,
      referenceWaterDensityKgM3: 1025,
      waterHeatCapacityJKgK: 3990,
      airDensityKgM3: 1.15,
      thermalExpansionPerC: 0.00033,
      halineContractionPerPsu: 0.00076,
      gradientRichardsonCritical: 0.25,
      oceanSubstepMinutes: 5,
      oneMinuteToTenMinuteOpenOceanWindFactor: 0.93,
    });
    expect(contract.physicsContract.verticalLevelsM.at(0)).toBe(0);
    expect(contract.physicsContract.verticalLevelsM.at(-1)).toBe(300);
    expect(Object.keys(contract.physicsContract.tunableParameters).sort()).toEqual([
      'bulkRichardsonCritical',
      'momentumDampingInertialPeriods',
      'thermalRecoveryHours',
    ]);
    expect(contract.physicsContract.tunableParameters.momentumDampingInertialPeriods).toEqual({
      minimum: 1,
      maximum: 5,
      literatureAnchor: 1.6,
    });
    expect(contract.physicsContract.selectedParameters).toEqual({
      bulkRichardsonCritical: 0.55,
      momentumDampingInertialPeriods: 1,
      thermalRecoveryHours: 120,
    });
    expect(contract.physicsContract.forbiddenDirectIntensityTerms.sort()).toEqual([
      'empiricalColdWakeCoolingRate',
      'oceanDepthCoupling',
      'ohcMpiWeight',
    ]);
  });

  it('keeps validation for acceptance and permanent test report-only', () => {
    expect(contract.workflow).toEqual({
      parameterSelectionPartition: 'development',
      acceptancePartition: 'validation',
      reportOnlyPartition: 'test',
      candidateMustBeHashedBeforeValidation: true,
      validationAttemptsMustBeLogged: true,
      validationGuidedChangesInvalidateConfirmatoryUse: true,
    });
    expect(contract.gates.hf2aCandidate.requiredSampleRetentionFraction).toBe(1);
    expect(contract.gates.hf2aCandidate.maximumTrackMaeRegressionFraction).toBe(0.05);
    expect(contract.gates.hf2aCandidate.permanentTestUsedForAcceptance).toBe(false);
    expect(contract.gates.hf2Completion.minimumWindPairedSkillFractionStrictlyGreaterThan).toBe(0);
    expect(contract.gates.hf2Completion.minimumPressurePairedSkillFractionStrictlyGreaterThan).toBe(0);
    expect(contract.gates.hf2Completion.permanentTestUsedForAcceptance).toBe(false);
  });
});
