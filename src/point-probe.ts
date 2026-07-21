/** Pure point-probe reading assembled from the same environment and vortex data
 * used by the simulator. DOM positioning and gestures live in main/ui. */

import { windAtPointKt } from './impact';
import type { EnvSample, LatLon, StormState } from './types';

export type ProbeEnvironmentKind = 'analysis' | 'climatology' | 'fallback';

export interface PointProbeReading extends LatLon {
  modeledWindKt: number | null;
  sstC: number;
  midlevelRhPct: number;
  shearMs: number;
  ohcKjCm2: number;
  environmentKind: ProbeEnvironmentKind;
  environmentLabel: string;
  validTimeLabel: string;
}

export interface PointProbeInput extends LatLon {
  environment: EnvSample;
  storm: StormState | null;
  environmentKind: ProbeEnvironmentKind;
  environmentLabel: string;
  validTimeLabel: string;
}

export function createPointProbeReading(input: PointProbeInput): PointProbeReading {
  const { environment } = input;
  return {
    lat: input.lat,
    lon: input.lon,
    modeledWindKt:
      input.storm && input.storm.alive
        ? windAtPointKt(input.storm, input)
        : null,
    sstC: environment.sstC,
    midlevelRhPct: environment.midlevelRhPct,
    shearMs: environment.shear,
    ohcKjCm2: environment.ohcKjCm2,
    environmentKind: input.environmentKind,
    environmentLabel: input.environmentLabel,
    validTimeLabel: input.validTimeLabel,
  };
}
