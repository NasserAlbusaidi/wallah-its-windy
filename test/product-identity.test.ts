import { describe, expect, it } from 'vitest';
import {
  buildProductIdentity,
  modelValidTimeIso,
  productMode,
  requiresObservationAcknowledgement,
} from '../src/product-identity';

describe('product identity and valid-time boundary', () => {
  it('never assigns a UTC valid time to a climatology sandbox', () => {
    const identity = buildProductIdentity({
      runMode: 'counterfactual',
      ageH: 18.25,
    });
    expect(identity.mode).toBe('climatology-sandbox');
    expect(identity.modeLabel).toBe('CLIMATOLOGY SANDBOX');
    expect(identity.validTimeIso).toBeNull();
    expect(identity.validTimeLabel).toBe('MODEL +18.3 H · NO UTC VALID TIME');
  });

  it('uses the hindcast initialization time as the model clock origin', () => {
    const input = {
      scenarioLabel: 'gonu 2007',
      scenarioStartIso: '2007-06-01T00:00:00.000Z',
      hindcastStartIso: '2007-06-02T06:00:00.000Z',
      runMode: 'hindcast' as const,
      ageH: 12.5,
    };
    expect(modelValidTimeIso(input)).toBe('2007-06-02T18:30:00.000Z');
    expect(buildProductIdentity(input)).toMatchObject({
      mode: 'historical-hindcast',
      modeLabel: 'RETROSPECTIVE REANALYSIS HINDCAST · GONU 2007',
      validTimeLabel: 'MODEL VALID 02 JUN 2007 18:30 UTC',
    });
  });

  it('uses the event-field origin for a historical counterfactual', () => {
    expect(modelValidTimeIso({
      scenarioLabel: 'mekunu 2018',
      scenarioStartIso: '2018-05-20T00:00:00.000Z',
      runMode: 'counterfactual',
      ageH: 6,
    })).toBe('2018-05-20T06:00:00.000Z');
    expect(productMode('mekunu 2018', 'counterfactual').mode).toBe(
      'historical-counterfactual',
    );
  });

  it('classifies observed display time against the model clock', () => {
    const base = {
      scenarioLabel: 'gonu 2007',
      scenarioStartIso: '2007-06-01T00:00:00.000Z',
      hindcastStartIso: '2007-06-02T06:00:00.000Z',
      runMode: 'hindcast' as const,
      ageH: 12,
    };
    expect(buildProductIdentity({
      ...base,
      observation: {
        label: 'Meteosat observed',
        validTimeIso: '2007-06-02T18:30:00.000Z',
      },
    }).observationState).toBe('time-matched');
    expect(buildProductIdentity({
      ...base,
      observation: {
        label: 'RainViewer observed',
        validTimeIso: '2026-07-27T12:00:00.000Z',
      },
    })).toMatchObject({
      observationState: 'unsynced',
      sourceLabel: 'RAINVIEWER OBSERVED · UNSYNCED OBS OVERLAY',
    });
  });

  it('keeps observations unsynced when the model has no UTC clock', () => {
    expect(buildProductIdentity({
      runMode: 'counterfactual',
      ageH: 9,
      observation: {
        label: 'Meteosat observed',
        validTimeIso: '2026-07-27T12:00:00.000Z',
      },
    }).observationState).toBe('unsynced');
  });

  it('requires a one-time acknowledgement for observed sources on an active storm', () => {
    expect(requiresObservationAcknowledgement(true, 'observed', false)).toBe(true);
    expect(requiresObservationAcknowledgement(true, 'handoff', false)).toBe(true);
    expect(requiresObservationAcknowledgement(true, 'simulated', false)).toBe(false);
    expect(requiresObservationAcknowledgement(false, 'observed', false)).toBe(false);
    expect(requiresObservationAcknowledgement(true, 'observed', true)).toBe(false);
  });
});
