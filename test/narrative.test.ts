import { describe, expect, it } from 'vitest';
import { explainIntensity } from '../src/narrative';
import { deriveStormStructure } from '../src/structure';
import type { StormDiagnostics } from '../src/types';

function diagnostics(
  values: Partial<StormDiagnostics> = {},
): StormDiagnostics {
  return {
    sstC: 29,
    mpiKt: 110,
    steerU: 1,
    steerV: 1,
    shearMs: 5,
    shearUms: 3,
    shearVms: 4,
    overLand: false,
    oceanKtPerH: 1,
    shearKtPerH: 0,
    landKtPerH: 0,
    dryAirKtPerH: 0,
    netKtPerH: 1,
    ...values,
  };
}

describe('explainIntensity', () => {
  it('names warm water when ocean support wins', () => {
    expect(
      explainIntensity(
        diagnostics({ shearKtPerH: 0.3, netKtPerH: 0.7 }),
      ),
    ).toMatchObject({
      tone: 'strengthening',
      headline: 'Warm water is winning.',
    });
  });

  it.each([
    [{ shearKtPerH: 1.2, netKtPerH: -0.2 }, 'Wind shear'],
    [{ landKtPerH: 3, netKtPerH: -2 }, 'Land'],
    [{ dryAirKtPerH: 2, netKtPerH: -1 }, 'Dry desert air'],
  ] as const)('names the dominant loss', (values, phrase) => {
    expect(explainIntensity(diagnostics(values)).headline).toContain(phrase);
  });

  it('explains a balanced budget without claiming strengthening', () => {
    expect(explainIntensity(diagnostics({ netKtPerH: 0.02 }))).toMatchObject({
      tone: 'steady',
      headline: 'The storm is holding nearly steady.',
    });
  });

  it('adds pressure and RMW when physical structure is available', () => {
    const structure = deriveStormStructure({
      vKt: 100,
      lat: 20,
      shearMs: 5,
      overLand: false,
      motionUms: 2,
      motionVms: 4,
    });
    const narrative = explainIntensity(
      diagnostics({ netKtPerH: 1 }),
      structure,
    );
    expect(narrative.detail).toContain(
      `${Math.round(structure.centralPressureHpa)} hPa`,
    );
    expect(narrative.detail).toContain(
      `${Math.round(structure.rmwKm)} km RMW`,
    );
  });
});
