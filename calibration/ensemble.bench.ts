import { bench, describe } from 'vitest';
import { runEnsemble } from '../src/ensemble';

const environment = {
  sample() {
    return {
      sstC: 29,
      steerU: -1.8,
      steerV: 0.9,
      shear: 9,
      shearU: 7,
      shearV: -5,
      midlevelRhPct: 72,
      ohcKjCm2: 75,
    };
  },
};
const spawn = {
  lat: 18,
  lon: 65,
  monthIndex: 5,
  seed: 7001,
  initialWindKt: 40,
  initialOrganization: 0.48,
  isDemo: false,
};

describe('steady-state deterministic ensemble', () => {
  for (const count of [20, 40, 80]) {
    bench(
      `${count} members`,
      () => {
        runEnsemble(environment, () => false, spawn, count);
      },
      {
        time: 0,
        iterations: 1,
        warmupTime: 0,
        warmupIterations: 1,
      },
    );
  }
});
