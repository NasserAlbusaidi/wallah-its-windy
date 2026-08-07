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

## Current scientific state — HF-1 through HF-6 executed

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
| HF-2 | Complete, rejected | Physics implemented; frozen legacy intensity gates did not all pass |
| HF-3 | Complete, rejected | Track skill improved; frozen bias/intensity-regression gates did not all pass |
| HF-4 | Complete, rejected | Ensemble verified; cone overdispersed and 48 h mean Brier skill negative |
| HF-5 | Infrastructure complete | Provider-neutral boundary and immutable archive pass; scheduled live feed disabled |
| HF-6 | Implementation complete; sealed result rejected | 72 storms/144 starts audited; 8 storms/16 starts scored once; prospective evidence still open |
| Product depth | Complete | Probe, cities, names, analog, and sparkline |
| UX big bet | Complete (2026-08-07) | Shared-camera pan and zoom shipped: `src/camera.ts` + `src/camera-gestures.ts`, cover-fit edge-to-edge map |

## Current product and engineering state — 2026-07-27

Product work delivered after the HF-6 evidence package, all presentation- or
boundary-side with no physics or calibration change:

- **HydroSHEDS flood-pulse routing (2026-07-20):** the approximate basin glow
  was replaced by HydroSHEDS v1.1 DIR-based timed downstream routing
  (`src/hydro-routing.ts`, `src/render/rain.ts`, `flowacc.bin` v1.2); legacy
  bins fall back to the old approximation.
- **Storm room and satellite desk (2026-07-22):** simulated vs observed IR/VIS
  with provenance labels, Meteosat IODC frame matching, INSAT manifest
  ingestion, and the observed-to-simulated visual handoff (see the satellite
  visualization outcome under HF-5).
- **Observed radar and rain accumulation (2026-07-26):** a timestamped
  RainViewer past-radar loop beside the labelled simulated radar, plus
  deterministic 1/3/6/24-hour and storm-lifetime accumulation windows with
  URL-stable colour breaks.
- **Windy-grade UI reskin (2026-07-27, PR #11, merge `89f1539`):** chrome/glass
  tokens, panel material and type scale, category-coloured timeline with live
  wind/pressure cluster, icon layer rail, eye-pinned storm tag, and a wind
  palette retune. UI-only; determinism, loader, and calibration untouched.

**Deploy-gate incident (2026-07-21; repaired 2026-07-27 by `a037c4a`).** The
HF-6 merge (`ba275f8`) rewrote model internals without resealing the hindcast
calibration results, leaving `npm run calibrate:check` red and the Pages site
frozen at the 2026-07-21 build. Commit `a037c4a` resealed
`calibration/hindcast-results.json` and `calibration/fidelity-results.json` and
regenerated `docs/hindcast-benchmark.md` and `docs/fidelity-benchmark.md`
through the documented flow, with no physics-core edits (`src/sim.ts` and
`src/structure.ts` were untouched). The deploy workflow has been green since
its first successful push run at 04:18 UTC on 2026-07-27, and Pages publishes
current main.

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

## Near-term product depth

These five features expose information the app already computes. The slice was
completed on 2026-07-21 with pure calculation tests, full regression coverage,
and desktop/mobile browser verification.

### Point probe

- Show total surface wind, SST, mid-level RH, shear, and OHC at the cursor.
- Use hover on pointer devices and long-press on touch devices; pin the card on
  click/tap so keyboard and touch users can inspect it.
- Read environmental values through the same `sampleEnvBin` path as physics and
  compute vortex wind through the same Holland profile as rendering and impact.
- Include units, valid time, layer provenance, and observed/analysis/simulated
  labels in the tooltip.
- Clamp the probe to the active view and event time. Never present climatology
  fallback as current observed weather.

Acceptance: tooltip values must match direct CPU samples at fixed test points,
and probing must neither advance nor mutate the simulation.

### City markers

- Draw the eight `IMPACT_CITIES` locations as overlay dots with collision-aware
  labels.
- Use the same geographic projection as tracks, ghost labels, and the point
  probe.
- Glow a city when the instantaneous parametric wind at that city reaches
  34 kt; derive the state from the same Holland calculation as the impact
  report.
- Let a marker open the city's peak wind, closest approach, and accumulated-rain
  row from the impact report.
- Keep labels legible without obscuring the storm center, probe, or forecast
  cone.

Acceptance: marker exposure state and impact-report values must agree at every
recorded frame.

### Storm names

- Pin a versioned official IMD naming-list snapshot with source, date, and
  checksum.
- Assign a deterministic simulated name from the storm seed so shared URLs keep
  the same identity.
- Carry the name through the recorder, comparison, exports, ensemble summary,
  and shared URL.
- Prefix or label user-created storms as simulated; a generated name must never
  imply an official agency designation.
- Preserve stable names when the upstream list changes by versioning the naming
  catalogue rather than silently remapping old URLs.

### Historical analog

- Compare a completed simulated track with the historical ghost tracks already
  shipped in the app.
- Define and test a deterministic similarity score that normalizes for genesis,
  duration, and sampling interval while retaining shape and direction.
- Report the closest match, score, and the dimensions that drove it, such as
  track shape, landfall sector, or intensity evolution.
- Label the result as a geometric historical analog, not evidence that the
  storms share causes, impacts, or future outcomes.
- For an active storm, compare only the elapsed prefix; never use future
  simulated points in a live analog claim.

### Intensity sparkline

- Plot wind against simulated age from the immutable flight tape.
- Mark the current replay position, peak wind, landfall, and category
  thresholds without resimulating the storm.
- Keep the strip synchronized with pause, replay, comparison, and exported
  debrief state.
- Expose exact age/wind values to pointer, touch, and keyboard inspection.

Acceptance: every plotted point must correspond to a recorded frame, and the
displayed peak must match the debrief's peak exactly.

## UX big-bet decision — pan and zoom

The roadmap selects **pan/zoom camera** as the next major UX investment. It
transforms every current layer and interaction without making a new scientific
claim. Live mode remains in HF-5, where the project can build it on proper data
ingestion and verification.

### Shared camera contract

- Add one view-bbox/camera state to `grid.ts`; keep the fixed 50–70 E,
  15–27 N data domain separate from the visible viewport.
- Route geographic-to-clip and clip-to-geographic conversion through that view
  for every shader, canvas overlay, city marker, ghost label, track, probe, and
  spawn gesture.
- Pass one shared view transform to each shader instead of adding layer-specific
  camera math.
- Clamp the camera to the baked domain and define explicit minimum/maximum zoom.
- Support wheel/trackpad zoom, drag pan, keyboard controls, and pinch gestures.
- Keep line weights, particles, labels, hit targets, and storm structure
  readable across the full zoom range.
- Leave the simulation state and deterministic physics unchanged; the camera is
  presentation state only.

Acceptance: coordinate round trips remain within tolerance at every supported
zoom, all layers stay registered during pan/zoom, and screenshots at fixed
camera states remain deterministic.

### Why live mode waits

A small baker can eventually turn current GFS-style fields into an event bin,
but a trustworthy live mode also needs source adapters, scheduled acquisition,
atomic publication, freshness checks, licences, failure handling, forecast-cycle
identity, and prospective verification. HF-5 owns that complete contract.

## HF-2 — intensity and upper-ocean fidelity

This is the next priority because intensity, not track, is the present limiting
factor.

### HF-2A — dynamic upper ocean

**Specification locked:** the physical state, data tiers, no-double-counting
rule, diagnostics, parameter bounds, and staged acceptance gates are frozen in
the [HF-2A dynamic upper-ocean specification](docs/hf2a-dynamic-upper-ocean-spec.md)
and its [machine-readable contract](calibration/hf2a-contract.json). The
auth-free NOAA GHRSST surface-ocean observations and clean HF-1 wake reference
are now generated and pinned; Argo remains a report-only vertical diagnostic.

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

**Outcome:** implemented and rejected without changing thresholds. The combined
candidate improved several development and legacy-validation intensity metrics,
but the independent ocean-component gate and every required 24/48-hour
intensity condition did not pass. The exact decision is frozen in
`calibration/hf2-acceptance.json`; the physical implementation remains available
for the new HF-6 first look.

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

**Outcome:** implemented and rejected without changing thresholds. The selected
candidate beat linear persistence and the development-trained
climatology/persistence reference at 12/24/48 hours on legacy validation, but
24-hour combined track bias and the locked intensity-regression limit failed.
See `calibration/hf3-acceptance.json`.

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

**Outcome:** implemented and rejected. Intensity CRPS beat the deterministic
member at the required legacy-validation leads and every uncertainty source
produced nonzero spread, but validation cone coverage was too high, 48-hour mean
Brier skill was negative, and the representative browser/device matrix is not
complete. The UI therefore retains **perturbation frequency** language. See
`calibration/hf4-acceptance.json`.

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

**Implementation outcome:** complete at the provider boundary, not operational.
HF-5 now normalizes advisory/grid units and wind periods, rejects stale/partial
or mixed-cycle inputs, provides provider descriptors and a side-by-side product
view, and archives issued runs atomically without overwrite. No continuously
scheduled lawful provider feed is configured, so live output remains disabled.
See `docs/hf5-live-data-contract.md` and `calibration/hf5-acceptance.json`.

**Satellite visualization outcome (2026-07-22):** the map now distinguishes
simulated cloud fields from timestamp-labelled observed pixels; supplies
enhanced IR, grayscale, and daytime visible-style palettes; resolves public
Meteosat IODC IR/VIS frames at the paused model time; and supports provenance-
preserving INSAT manifest ingestion after a registered MOSDAC download. A
six-model-hour observed-to-simulated crossfade supplies visual initialization,
but does not assimilate pixels into model state. Automated live acquisition,
radiometric decoding, and physical observed initialization remain future work.
See `docs/satellite-cloud-validation.md`.

## HF-6 — broader and prospective validation

**Outcome:** implementation complete; sealed retrospective result rejected;
prospective evidence awaiting future storms. The outcome-blind catalogue is
frozen at 72 Arabian Sea storms and 144 initializations. Eight previously
unseen, USA/JTWC-compatible storms supplied 16 first-look initializations for
the already frozen HF-2/HF-3 candidates. Observation availability,
landfall/peak/RI/dissipation/structure outcomes, and all required strata are
machine-audited.

The first look was recorded without retuning. Track MAE beat linear persistence
at 12/24/48 hours by 34.4%, 38.6%, and 53.5%, respectively. The intensity and
pressure candidate did not generalize: 48-hour wind skill was -95.2% and
48-hour pressure skill was -72.1%; even 24-hour pressure skill was negative.
The sealed gate is therefore rejected. R50/R64 observations were unavailable in
the sealed cohort and remain explicitly unscored rather than imputed. The
prospective registry contains zero matured future forecasts, so this part can
only accumulate with future storms and supports no prospective skill claim.

Generated evidence lives in `calibration/hf6-acceptance.json` and
`docs/hf6-scorecard.md`.

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

### Population exposure

- Bake a versioned population raster through the same self-describing binary
  pipeline as the environmental layers.
- Compute unique residents intersected by the modeled >=34-kt footprint without
  double-counting cells across time.
- State the population source, census/model vintage, raster resolution, and
  uncertainty beside every estimate.
- Phrase the result as “estimated residents inside the modeled gale footprint.”
  It is an exposure overlay, not a casualty, damage, evacuation, or vulnerability
  model.
- Validate reprojection, coastal cells, nodata handling, and exposure totals
  against independent spot checks before showing the feature publicly.

### Automatic ensemble envelope

Delivered 2026-08-07 as UX v2 phase 4 (item 7c below); the calibrated-cone
upgrade path stays gated on HF-4.

- Auto-run a 20-member ensemble after a spawn once the input settles; cancel a
  stale job when the user respawns or changes the environment.
- Derive a time-indexed percentile envelope from the ensemble worker output and
  show member tracks only on demand.
- Label the pre-HF-4 product as a perturbation-frequency envelope, not an
  official forecast cone or calibrated probability.
- Replace that label with a calibrated forecast cone only after HF-4 demonstrates
  out-of-sample coverage and reliability.
- Keep automatic execution within the versioned device and frame-time budget;
  fall back to an explicit Run action on devices that miss it.

### Forecast experience

- Calibrated cone and strike-probability layers.
- Side-by-side official, persistence, deterministic, and ensemble tracks.
- Landfall windows, intensity ranges, and “why did it change?” diagnostics.
- NHC-style plain-language advisories for user-created or experimental storms,
  always labeled as generated simulation text.
- Research mode with full diagnostics and a simpler public mode.

### Weather layers

- Observed satellite IR/VIS and observed radar are shipped with provenance
  labels; extend to microwave products where licensing and update reliability
  allow.
- Forecast SST, humidity, OHC, shear, wind, rainfall, and uncertainty layers.
- Explicit legends for observation, analysis, forecast, and simulated proxy.
- Time controls that keep every visible layer synchronized to the same valid
  time.

### Realism program

- **R1 (complete):** `docs/realism-gap-register.md` catalogues every
  simulated IR/VIS/rain gap against paired observed sessions and
  literature anchors, each entry classified presentation / data /
  physics and dispositioned close-now or charter-only.
- **R2a (sim-side harness landed):** the field-space measurement harness
  under `calibration/realism/` (`npm run realism` / `realism:check`) with
  regression-only gate semantics — it proves a change did not move the
  simulated product; a human A/B verdict still decides whether a move is
  better, and a reseal records it. Rollout is advisory — not yet a CI gate.
- **R2b (not started):** R2 completes only with R2b — observed
  derived-statistics references (EUMETSAT per D2) and the GPM IMERG
  rain-truth comparison (D1). Until those land, every harness number is
  sim-side only and nothing may claim R2 complete.
- **R3 (not started):** closure waves, one gap-cluster per PR, each
  citing its register entries and updating the register disposition in
  the same PR.
- **Two-track rule:** only presentation-class gaps close inside this
  program. Data-side and physics-side gaps are recorded, never touched
  here — they live in `docs/hf7-realism-charter.md`, a charter and
  explicitly not a commitment to run a future HF-7 phase.

### Sharing and accessibility

- GIF or satellite-loop export in addition to the existing PNG/WebM products.
- Mobile touch spawning, responsive controls, accessibility review, and strict
  DPR/performance budgets.
- Shareable forecast-cycle and ensemble URLs with immutable provenance.
- Exportable machine-readable tracks, probabilities, diagnostics, and model
  version metadata.

### Hazard extensions — only after core fidelity

- **Done (2026-07-20):** the approximate basin glow was replaced by HydroSHEDS
  v1.1 DIR-based timed downstream flood-pulse routing (`src/hydro-routing.ts`,
  `src/render/rain.ts`, `flowacc.bin` v1.2); legacy bins fall back to the old
  approximation.
- Research rainfall accumulation and orographic enhancement validation.
- Treat surge and inundation as separate future models with their own data and
  verification; never infer them directly from wind category alone.

## Named avoidances

These boundaries prevent expensive work that weakens the project's focus or
honesty.

- **No 3D globe.** The fixed 20-by-12-degree Arabian Sea domain gains little
  from a globe, while a second rendering and interaction stack would consume
  months.
- **No hand-wavy storm-surge proxy.** A credible surge model needs bathymetry,
  tides, coastal geometry, hydrodynamics, boundary conditions, and independent
  validation. Treat it as a separate future research program or omit it.
- **No multi-storm simulation.** The engine and interface deliberately model
  one cyclone. Reworking physics, impact bookkeeping, ensembles, UI, and
  rendering for simultaneous vortices offers too little value.
- **No unlabeled live or impact claims.** Population is exposure, ensemble
  frequency is not calibrated probability, and simulated IR/rain is not an
  observation.

## Recommended execution order

### Now

1. **Ship visibly.** The reskinned simulator is the public face — share the
   Pages URL. Working-but-local is the trap.

### Done — kept visible as the record

**Complete (2026-07-27): deploy-gate repair.** Commit `a037c4a` completed the
documented reseal flow with zero physics-core edits; the November C6
replay-timeout wrinkle from the 2026-07-26 diagnosis remains part of the
incident record.

2. **Complete:** product-depth slice (probe, cities, names, analog, sparkline).
3. **Complete:** HF-2 through HF-4 physical, track, and ensemble experiments;
   their rejected gates remain frozen and visible.
4. **Complete:** HF-5 provider boundary, failure contract, and immutable issue
   archive; operational live mode remains disabled without a scheduled feed.
5. **Complete:** HF-6 catalogue, observation audit, sealed first look, model
   card, and versioned scorecard. The negative intensity/pressure result is the
   accepted scientific outcome, not a prompt to retune the sealed cohort.
6. **Complete:** post-HF-6 product lane — HydroSHEDS flood-pulse routing,
   storm room + satellite desk, observed radar + rain accumulation, and the
   windy-grade reskin (see the current-state section above).
6b. **Complete (2026-08-06): impact board — UX v2 phase 1.** The always-visible
   effects panel (ranked 8-city table, vitals, live/complete headline; landfall
   as recorded fact, never an ETA) replaced the debrief-buried impact report and
   the conditional live line. Umbrella design:
   `docs/superpowers/specs/2026-08-06-impact-board-ux-v2-design.md`.
7. **Complete (2026-08-07): shared camera — UX v2 phase 2.** Pan/zoom per the
   contract above: cover-fit edge-to-edge canvas, every geo↔screen conversion
   through one affine world→NDC view, wheel/drag/pinch/keyboard controls
   clamped inside the baked domain, physics and recorded output untouched
   (grid.ts clip space stays domain-fixed WORLD space; offscreen state passes
   bind the identity view). One deviation from the contract text: the view
   math lives in the sibling `src/camera.ts` rather than inside `grid.ts` —
   one concern per file; grid.ts remains the data-space owner. The rain
   accumulator moved to a domain-fixed 1000×600 grid in the same PR (it was
   screen-registered state that any camera move would have corrupted).
7b. **Complete (2026-08-07): regional rain ledger — UX v2 phase 3.** Baked
   region-id rasters (`regions.bin`: Natural Earth v5.1.2 Oman governorates +
   HydroSHEDS-derived 0.1° wadi basins, geography-keyed names in
   `regions.json`) through the three-way bin contract; read-only per-region
   sum/mean/max over the deterministic rain ledger in `impact.summary()`;
   ranked worst-hit block on the impact board following the accum-window
   selection. Areal values keep the parametric-proxy label and are never
   flood-tiered. Phase 4 (ensemble on-map) remains.
7c. **Complete (2026-08-07): ensemble on-map — UX v2 phase 4.** The
   "Automatic ensemble envelope" contract above, delivered: a 20-member
   ensemble auto-runs after a real (non-demo) spawn once input settles
   (1.5 s debounce); respawns, environment switches, and sensitivity runs
   cancel the stale job cooperatively (worker abandons remaining members via
   a cancel message, not just a discarded result). A time-indexed percentile
   envelope (`src/ensemble-envelope.ts`: per-lead median centre + p90
   great-circle radius, membership floor max(4, 30%)) draws by default
   through the render facade (`src/render/ensemble.ts`, between ghosts and
   the live track in luminance order); member tracks are on demand via the
   impact-board toggle. Headline counts ("N of 20 members" — never a
   percentage) sit on the impact board. The versioned budget the contract
   requires is `AUTO_ENSEMBLE_BUDGET` v1 in `src/performance.ts`: 20
   members, worker-thread only, envelope computed once per result, auto-run
   eligibility = desktop tier only (`RenderProfile.autoEnsemble`); phone and
   mid tiers keep the explicit Run fallback. Wording stays
   perturbation-frequency everywhere (HF-4 rejection binding); the
   calibrated-cone replacement remains gated on a future HF-4 pass.

### Next


8. **Evidence lane — prospective archiving:** archive future HF-5 runs before
   observations exist; evaluate only after at least 12 forecasts across four
   storms mature. This lane runs on the calendar, not on effort — it only
   accumulates when real storms happen.
9. Add population exposure with the explicit non-casualty labels defined
   above (the automatic ensemble envelope shipped as item 7c with its
   perturbation-frequency labels).

### Later

10. Start any revised intensity candidate as a new versioned phase with a new
    development protocol and a newly sealed confirmation cohort.
11. Richer exports (GIF/satellite loop), the formal accessibility review and
    dedicated mobile-layout pass (budgets, touch input, and compact layouts
    already ship), and carefully validated hazard models — only after the
    relevant evidence and device gates exist.

HF-6 is finished as an implementation and evidence package. It does **not**
finish prospective validation, turn the simulator into an operational model, or
authorize stronger probability language. Pan/zoom remains the selected UX big
bet; prospective archiving is the long-running scientific lane. The deploy
publishes current main, so merged work is publicly visible.
