# Scientific and product roadmap

## Direction

Wallah It's Windy will become a transparent Arabian Sea cyclone laboratory and
forecast postprocessor. The target is a reduced-order model that explains its
physics, consumes authoritative
environmental data, quantifies uncertainty, and can eventually accompany live
operational guidance. It is not an attempt to recreate a global numerical
weather-prediction system or replace official warnings.

The product has three realistic destinations:

1. **Excellent interactive simulator** — physically coherent, accessible, and
   honest enough for education and exploration.
2. **Research-quality reduced-order model** — reproducible hindcasts,
   defensible verification, and useful sensitivity experiments.
3. **Live forecast companion** — initialized from current advisories and driven
   by external operational forecast fields, with calibrated uncertainty.

Operational decision support remains out of scope until the project has
institutional data agreements, domain-expert review, continuous prospective
evaluation, reliability engineering, and formal governance.

## Current baseline — HF-1 complete

HF-1 established the measurement system that every later fidelity claim must
pass:

- 30 frozen Arabian Sea storms: 18 development, 6 validation, and 6 permanent
  report-only test storms.
- Exact 12/24/48/72-hour track, along/cross-track, wind, and pressure errors.
- A no-future-information spherical persistence baseline.
- Deterministic 2,000-member storm-level bootstrap intervals.
- First-domain-exit scoring, fixed data provenance, compact offline forcing
  bins, and byte-stable cross-platform results.

The [generated HF-1 report](docs/fidelity-benchmark.md) is the quantitative
baseline. Its conclusion is deliberately mixed: track guidance is promising
after 24 hours, while intensity and pressure generally do not yet beat
persistence on validation.

| Phase | Status | Outcome |
| --- | --- | --- |
| HF-1 | Complete | Frozen observational benchmark and regression gate |
| HF-2 | Next | Intensity and upper-ocean fidelity |
| HF-3 | Planned | Stronger track dynamics and baselines |
| HF-4 | Planned | Calibrated probabilistic forecasts |
| HF-5 | Planned | Provider-neutral live forecast companion |
| HF-6 | Planned | Broader, multi-initialization, prospective validation |

## Rules that apply to every phase

- Tune with development storms only. Validation decides acceptance.
- Permanent-test results are report-only. If published test behavior influences
  a parameter or design choice, seal a new independent test set before making a
  confirmatory claim.
- Never improve a headline metric by silently reducing eligible samples.
- Keep source checksums, artifact manifests, units, domains, time axes, and
  initialization rules machine-readable.
- Reproduce calibration and verification offline in CI; data acquisition stays
  outside the release build.
- Preserve deterministic seeds and fixed-step physics.
- Label observed, analysis, forecast, and simulated products distinctly in the
  UI and exports.
- Report negative results, missing observations, confidence intervals, and
  baseline losses rather than hiding them.
- No phase may weaken the current validation gate merely to accept a candidate.
- Keep the 20 HF-1-only forcing bins outside the browser bundle.

## HF-2 — intensity and upper-ocean fidelity

This is the next priority because intensity, not track, is the present limiting
factor.

### HF-2A — dynamic upper ocean

- Add explicit mixed-layer depth and subsurface thermal-profile state.
- Replace the static monthly-ocean response with event-specific upper-ocean
  initialization where reliable source data exist.
- Couple cold-wake strength to translation speed, wind, storm size, residence
  time, and pre-storm stratification.
- Model wake recovery and prevent the storm from repeatedly extracting the same
  heat from an unchanged ocean column.
- Record ocean energy extraction, mixed-layer cooling, and wake recovery in the
  flight tape so every intensity response remains explainable.
- Validate the ocean state independently before using it to tune wind.

### HF-2B — ventilation and organization

- Replace scalar shear and humidity penalties with a vector-aware ventilation
  treatment.
- Sample environmental humidity and shear around the vortex rather than relying
  on a single center cell.
- Make organization respond to sustained favorable/adverse environments with
  physically bounded memory rather than instant threshold changes.
- Add constrained eyewall-cycle variability only after the mean intensification
  and weakening budgets are correct.
- Preserve an exact diagnostic budget for ocean support, dry-air ventilation,
  shear, land interaction, organization, and residual tendency.

### HF-2C — wind, pressure, and size closure

- Enforce a coherent relationship among maximum wind, central pressure, RMW,
  Holland B, translation, latitude, and outer-core size.
- Initialize RMW and 34/50/64-kt radii when agency-consistent observations are
  available; otherwise carry an explicit missing-data prior.
- Validate wind radii and RMW separately from maximum wind.
- Improve land decay with surface roughness, terrain exposure, storm size, and
  time over land.
- Treat coastal crossing and partial vortex exposure continuously instead of as
  an all-ocean/all-land switch.

### HF-2 acceptance

- Positive paired wind skill against persistence at 24 and 48 hours on
  validation.
- Positive paired pressure skill at the same leads where pressure observations
  are available.
- No greater than 5% regression in locked validation track MAE.
- No loss of wind, pressure, or track sample availability.
- Improved bias as well as MAE; a compensating positive/negative-error mixture
  is not sufficient.
- Permanent test remains outside the automated acceptance decision.

## HF-3 — track dynamics

### Environmental steering

- Weight steering depth by storm intensity, vertical structure, latitude, and
  organization.
- Sample an annulus around the cyclone and remove the residual vortex more
  robustly from reanalysis/forecast winds.
- Preserve coherent temporal evolution through pressure levels rather than
  blending unrelated snapshots.
- Quantify forcing sensitivity so a track shift can be traced to a particular
  layer or flow feature.

### Motion physics

- Add a documented beta-drift formulation with bounded basin-scale behavior.
- Improve curved motion and acceleration rather than assuming locally constant
  translation.
- Add vortex–terrain, coastal-friction, and asymmetric land-exposure effects.
- Make stochastic wander a calibrated unresolved-motion term, not a source of
  apparent skill.

### Track baselines and acceptance

- Add a climatology-and-persistence baseline alongside linear persistence.
- Compare against official forecast tracks where timestamps and agency fields
  are compatible.
- Require positive validation skill at 12 and 24 hours while retaining the
  existing 48-hour advantage.
- Reduce along-track and cross-track bias separately.
- Reject track candidates that materially degrade intensity or survival-time
  availability.

## HF-4 — calibrated probabilistic forecasting

The current ensemble perturbation frequencies are useful experiments but are
not yet calibrated probabilities.

- Separate initialization, forcing, parameter, and unresolved-physics
  uncertainty.
- Perturb inputs using observed error distributions and coherent spatial/time
  structures rather than arbitrary independent noise.
- Produce track-density, landfall-location, landfall-time, intensity-category,
  genesis, and dissipation probabilities.
- Validate spread–error consistency, rank histograms, reliability, resolution,
  Brier score, CRPS, and coverage at stated probability levels.
- Calibrate the forecast cone from out-of-sample errors rather than drawing a
  decorative envelope.
- Retain deterministic ensemble seeds, manifests, and performance budgets.
- Clearly distinguish probability from member frequency until calibration is
  demonstrated.

### HF-4 acceptance

- Nominal intervals achieve defensible out-of-sample coverage.
- Ensemble spread responds correctly to harder and easier cases.
- Probabilistic scores beat deterministic and climatological references.
- Define a versioned device matrix and frame-time budget, then keep the
  20/40/80-member modes within it without blocking the main map.

## HF-5 — live forecast companion

### Provider-neutral ingestion

- Add adapters for current agency advisories and operational atmospheric
  forecast grids without coupling the model core to one provider.
- Ingest near-real-time SST, upper-ocean heat content, and relevant satellite
  products with timestamps, licences, checksums, and freshness metadata.
- Normalize units, calendars, pressure levels, grids, and agency wind averaging
  periods at the ingestion boundary.
- Fail visibly on stale, missing, incompatible, or partially downloaded data.
- Keep the climatology sandbox available when live data are unavailable, but
  never present fallback output as a current forecast.

### Initialization and cycling

- Initialize position, motion, wind, pressure, RMW, wind radii, and organization
  from one agency-consistent advisory snapshot.
- Add explicit analysis time, forecast cycle, lead time, and provider identity.
- Archive every issued run before observations arrive; never rewrite a past
  forecast with later analysis.
- Permit controlled re-initialization on the next advisory cycle while keeping
  prior forecasts available for verification.

### Live product contract

- Present official guidance, persistence, and the Wallah model side by side.
- Mark observed satellite/radar imagery separately from simulated IR and rain.
- Show data age, run time, forecast horizon, uncertainty, and known failure
  modes at all times.
- Describe the product as an experimental forecast companion until prospective
  validation supports a stronger claim.

## HF-6 — broader and prospective validation

- Expand to 60–100 Arabian Sea cases with documented inclusion rules.
- Add multiple initialization times per storm so results do not depend on one
  favorable starting fix.
- Seal a new independent test cohort before HF-2/HF-3 choices are evaluated.
- Run prospective, timestamped forecasts on future storms and score them only
  after observations become available.
- Add landfall position/time, peak intensity/time, rapid intensification,
  dissipation, RMW, wind radii, and threshold-event verification.
- Stratify performance by season, intensity, motion, land interaction, data era,
  forecast difficulty, and observation availability.
- Extend to another basin only after the Arabian Sea protocol is stable; do not
  assume one basin's calibration transfers globally.
- Publish reproducible model cards, data limitations, failure cases, and versioned
  scorecards for every claimed release.

## Product and communication roadmap

These features should grow around verified science rather than compete with it.

### Forecast experience

- Calibrated cone and strike-probability layers.
- Side-by-side official, persistence, deterministic, and ensemble tracks.
- Landfall windows, intensity ranges, and “why did it change?” diagnostics.
- NHC-style plain-language advisories for user-created or experimental storms,
  always labeled as generated simulation text.
- Research mode with full diagnostics and a simpler public mode.

### Weather layers

- Observed satellite infrared and microwave products where licensing and update
  reliability allow them.
- Forecast SST, humidity, OHC, shear, wind, rainfall, and uncertainty layers.
- Explicit legends for observation, analysis, forecast, and simulated proxy.
- Time controls that keep every visible layer synchronized to the same valid
  time.

### Sharing and accessibility

- GIF or satellite-loop export in addition to the existing PNG/WebM products.
- Mobile touch spawning, responsive controls, accessibility review, and strict
  DPR/performance budgets.
- Shareable forecast-cycle and ensemble URLs with immutable provenance.
- Exportable machine-readable tracks, probabilities, diagnostics, and model
  version metadata.

### Hazard extensions — only after core fidelity

- Replace approximate basin glow with HydroSHEDS DIR-based downstream flood
  pulse routing.
- Research rainfall accumulation and orographic enhancement validation.
- Treat surge and inundation as separate future models with their own data and
  verification; never infer them directly from wind category alone.

## Recommended execution order

1. Write the HF-2 scientific specification and lock its validation criteria.
2. Implement dynamic upper-ocean state with independent ocean diagnostics.
3. Add vector-aware ventilation and wind–pressure–size closure.
4. Run the development search and accept or reject on validation.
5. Improve steering depth, vortex filtering, and track baselines in HF-3.
6. Calibrate uncertainty in HF-4.
7. Add provider-neutral live forcing and prospective archiving in HF-5.
8. Broaden and prospectively validate before strengthening product claims.
9. Layer the richer forecast, export, mobile, and hazard experiences on top.

The immediate next deliverable is therefore **HF-2A: dynamic upper-ocean and
cold-wake physics**, accompanied by tests, diagnostics, a frozen specification,
and the existing HF-1 validation gate.
