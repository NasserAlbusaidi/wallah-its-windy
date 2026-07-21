import { describe, expect, it } from 'vitest';
import { createPointProbeReading } from '../src/point-probe';
import { windAtPointKt } from '../src/impact';
import { deriveStormStructure } from '../src/structure';
import type { EnvSample, StormDiagnostics, StormState } from '../src/types';

const ENVIRONMENT: EnvSample = {
  sstC: 29.25,
  steerU: -3,
  steerV: 2,
  shear: 8.75,
  shearU: 8,
  shearV: 3.5,
  midlevelRhPct: 71.5,
  ohcKjCm2: 63.25,
};

const DIAGNOSTICS: StormDiagnostics = {
  sstC: 29,
  effectiveSstC: 29,
  midlevelRhPct: 70,
  ohcKjCm2: 60,
  organization: 0.8,
  organizationTarget: 0.8,
  coldWakeC: 0,
  mpiKt: 130,
  steerU: -3,
  steerV: 2,
  shearMs: 8,
  shearUms: 8,
  shearVms: 0,
  overLand: false,
  oceanKtPerH: 1,
  shearKtPerH: 0,
  landKtPerH: 0,
  dryAirKtPerH: 0,
  netKtPerH: 1,
  eyewallRainMmH: 10,
  rainbandRainMmH: 4,
  orographicRainMmH: 0,
  totalRainMmH: 14,
};

function storm(): StormState {
  return {
    lat: 20,
    lon: 60,
    vKt: 90,
    ageH: 24,
    trackPoints: [],
    alive: true,
    isDemo: false,
    organization: 0.8,
    coldWakeC: 0,
    diagnostics: DIAGNOSTICS,
    structure: deriveStormStructure({
      vKt: 90,
      lat: 20,
      lon: 60,
      shearMs: 8,
      overLand: false,
      motionUms: -3,
      motionVms: 2,
    }),
  };
}

describe('point probe', () => {
  it('preserves exact CPU environment samples and the shared Holland wind', () => {
    const active = storm();
    const point = { lat: 20.4, lon: 60.3 };
    const reading = createPointProbeReading({
      ...point,
      environment: ENVIRONMENT,
      storm: active,
      environmentKind: 'analysis',
      environmentLabel: 'Gonu ERA5 event',
      validTimeLabel: '+24 h',
    });
    expect(reading).toMatchObject({
      sstC: 29.25,
      midlevelRhPct: 71.5,
      shearMs: 8.75,
      ohcKjCm2: 63.25,
      environmentKind: 'analysis',
    });
    expect(reading.modeledWindKt).toBe(windAtPointKt(active, point));
  });

  it('does not invent a surface wind without an active modeled vortex', () => {
    const reading = createPointProbeReading({
      lat: 18,
      lon: 65,
      environment: ENVIRONMENT,
      storm: null,
      environmentKind: 'climatology',
      environmentLabel: 'monthly climatology',
      validTimeLabel: 'seasonal mean',
    });
    expect(reading.modeledWindKt).toBeNull();
  });
});
