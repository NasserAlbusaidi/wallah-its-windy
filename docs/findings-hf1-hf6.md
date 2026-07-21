# Findings after HF-1 through HF-6

## Executive verdict

Wallah It's Windy is now a feature-rich interactive cyclone simulator and a
reproducible reduced-order research prototype. It is not a validated operational
forecast model.

The strongest scientific result is track guidance. On the untouched HF-6
cohort, the experimental track system beat linear persistence by 34.4% at 12
hours, 38.6% at 24 hours, and 53.5% at 48 hours. The weakest result is intensity
and pressure evolution. At 48 hours, wind skill fell to -95.2% and pressure
skill to -72.1%. The model often moves a storm in a useful direction while
strengthening, weakening, or dissipating it at the wrong rate or time.

The project therefore keeps a strict product boundary. The interactive sandbox
uses its previously validated shipped profile. HF-2 and HF-3 remain explicit
research profiles because their frozen gates rejected them. Ensemble maps remain
labelled **perturbation frequency**, and live mode remains disabled until a
scheduled feed and prospective evidence exist.

## What we built

The product now combines:

- a deterministic, fixed-step, single-storm simulation over the Arabian Sea;
- baked SST, humidity, ocean heat content, steering, shear, terrain, and
  hydrographic data;
- Holland-style wind, pressure, RMW, outer-size, and quadrant wind-radius
  structure;
- terrain, wind, simulated infrared, simulated radar, rainfall, SST, humidity,
  OHC, and shear map layers;
- point probes, impact-city markers, deterministic storm names, historical
  analogs, and an exact intensity sparkline;
- historical hindcasts, immutable flight tapes, comparisons, sensitivity runs,
  and worker-based ensembles;
- experimental dynamic upper-ocean, annular ventilation, coastal-exposure,
  pressure-level steering, and coherent ensemble systems;
- provider-neutral live-data normalization, visible failure states, and an
  immutable issued-run archive;
- frozen catalogues, source hashes, deterministic verification, acceptance
  gates, model cards, and generated scorecards.

These additions make the application more useful without changing its basic
promise: users choose the initial storm and environment; the simulation decides
what follows.

## Phase findings

| Phase | Result | What we learned |
| --- | --- | --- |
| HF-1 | Complete | A 30-storm, 12/24/48/72-hour benchmark established the measurement system. Baseline track skill improved after 24 hours, while wind and pressure often lost to persistence. |
| HF-2A | Rejected | The dynamic ocean candidate improved the 48-hour SST error but regressed the 24-hour error and bias. More physical structure did not automatically produce better forecasts. |
| HF-2 | Rejected | The full intensity candidate passed the 24-hour wind and pressure tests but missed positive 48-hour wind skill. The implementation remains useful for research, not deployment. |
| HF-3 | Rejected | Pressure-level steering improved track skill at every required lead, but 24-hour combined bias worsened and aggregate intensity MAE exceeded the locked regression limit. |
| HF-4 | Rejected | Every uncertainty source produced spread, and ensemble CRPS beat the deterministic member. The cone overcovered, 48-hour Brier skill was negative, and the device matrix remained incomplete. |
| HF-5 | Infrastructure complete | Provider normalization, cycle integrity, visible failure, side-by-side guidance, and immutable issuance work. No scheduled lawful live feed is configured. |
| HF-6 | Implementation complete; sealed result rejected | The 72-storm/144-initialization audit and untouched 8-storm/16-start first look confirmed strong track skill but rejected the intensity and pressure claims. Prospective evidence remains at zero matured forecasts. |

## HF-6 first-look evidence

The HF-6 catalogue covers 72 Arabian Sea storms from 1940–2024, with two
initializations per storm. Eight previously unused, agency-compatible storms
formed the sealed confirmation cohort. We selected this cohort before running
the frozen HF-2/HF-3 candidates and did not retune after viewing the result.

| Lead | Track MAE / persistence | Track skill | Wind MAE / persistence | Wind skill | Pressure MAE / persistence | Pressure skill |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 h | 71.8 / 109.3 km | +34.4% | 5.5 / 5.9 kt | +6.8% | 4.1 / 3.3 hPa | -23.6% |
| 24 h | 128.1 / 208.6 km | +38.6% | 8.9 / 10.4 kt | +14.4% | 5.6 / 4.9 hPa | -14.5% |
| 48 h | 202.3 / 435.0 km | +53.5% | 27.5 / 14.1 kt | -95.2% | 10.3 / 6.0 hPa | -72.1% |
| 72 h | 106.7 / 596.3 km | +82.1% | 30.8 / 8.2 kt | -277.2% | 15.5 / 3.2 hPa | -390.8% |

Additional sealed outcomes were mixed:

- landfall position MAE: 188.6 km;
- landfall time MAE: 5.3 hours;
- landfall-event accuracy: 87.5%;
- peak-intensity MAE: 13.3 kt;
- peak-time MAE: 40.2 hours;
- rapid-intensification event accuracy: 100%, on a small cohort;
- dissipation-event accuracy: 18.8%;
- RMW MAE: 18.8 km;
- R34 MAE: 75.9 km;
- R50 and R64: unavailable in the sealed cohort and left unscored.

The 72-hour track result is encouraging but rests on only six eligible starts.
It cannot offset the severe intensity and pressure losses or support a broad
forecast-skill claim.

## What the evidence means

### Track is the best research direction

The steering architecture now produces a measured advantage against a simple,
no-future-information baseline. Pressure-level flow, initial motion, beta drift,
and terrain corrections deserve further study. Future work should preserve the
current track implementation as a reference rather than rewrite it casually.

### Intensity timing is the main scientific problem

The simulator can produce plausible-looking storms, but visual plausibility is
not enough. The sealed errors show that the coupled ocean, ventilation,
organization, and structure system frequently evolves intensity too strongly or
at the wrong time. Peak timing, dissipation, and outer wind radii need better
observations and a new calibration protocol.

### Added physics must earn deployment

HF-2A is the clearest warning. Its dynamic ocean improved the 48-hour SST result
but failed at 24 hours. We therefore separated experimental physics from shipped
defaults. A rejected candidate remains reproducible without silently changing
the public simulator.

### The ensemble is an experiment, not a probability forecast

The ensemble responds to initialization, forcing, parameter, and unresolved-
physics perturbations. Its spread is real, but the cone is too wide and the
48-hour event probabilities do not beat the frozen climatology reference. The
current interface correctly reports member frequency rather than calibrated
probability.

### Live readiness is mainly an operations problem now

HF-5 established the data boundary: providers, units, wind periods, timestamps,
checksums, cycle matching, freshness, partial-download rejection, and immutable
archives. Turning that into live mode requires a lawful scheduled feed,
monitoring, failure recovery, and forecasts archived before observations arrive.
It does not require weakening the scientific gate.

## Product claim

The defensible description is:

> Wallah It's Windy is an interactive Arabian Sea cyclone simulator and a
> reproducible reduced-order research prototype. Its track experiments show
> retrospective promise, but its intensity, pressure, uncertainty, and live
> forecast skill are not validated for operational use.

Users should follow official meteorological agencies for warnings. Simulated
infrared and radar layers remain labelled as simulations; population exposure,
surge, casualty, or evacuation claims remain outside the current model.

## Recommended next work

1. Build the shared pan/zoom camera. This produces the largest product gain
   without changing scientific claims.
2. Start prospective archiving. Do not score a run until its observations
   mature; require at least 12 forecasts across four storms before discussing
   prospective skill.
3. Design a new intensity phase. Use new development cases, explicit peak-time
   and dissipation objectives, better upper-ocean initialization, and a newly
   sealed confirmation cohort.
4. Select a structure-rich cohort. Require usable R34/R50/R64 observations so
   outer-core verification cannot disappear through missing data.
5. Complete the representative device matrix before increasing automatic
   ensemble use.
6. Add population exposure only as a versioned census overlay, never as a
   damage or casualty model.

## Reproduction and evidence

Primary artifacts:

- [`docs/fidelity-benchmark.md`](fidelity-benchmark.md)
- [`calibration/hf2a-ocean-acceptance.json`](../calibration/hf2a-ocean-acceptance.json)
- [`calibration/hf2-acceptance.json`](../calibration/hf2-acceptance.json)
- [`calibration/hf3-acceptance.json`](../calibration/hf3-acceptance.json)
- [`calibration/hf4-acceptance.json`](../calibration/hf4-acceptance.json)
- [`calibration/hf5-acceptance.json`](../calibration/hf5-acceptance.json)
- [`docs/hf6-scorecard.md`](hf6-scorecard.md)
- [`calibration/hf6-acceptance.json`](../calibration/hf6-acceptance.json)
- [`docs/model-card-hf6.md`](model-card-hf6.md)

Final verification:

```bash
npm test
npm run build
npm run calibrate:check
npm run hf2a:ocean:gate:check
npm run hf2:gate:check
npm run hf3:gate:check
npm run hf4:verify:check
npm run hf4:gate:check
npm run hf5:gate:check
npm run data:hf6:catalog:check
npm run hf6:verify:check
npm run hf6:prospective:check
npm run hf6:gate:check
```

The final local run passed 405 tests, the production build, calibration
reproduction, every stable phase-artifact check, the full HF-4 ensemble replay,
and the deterministic HF-6 sealed replay. Rejected acceptance gates remain
rejected by design.
