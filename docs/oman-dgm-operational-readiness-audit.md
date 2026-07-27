# Oman DGM operational-readiness audit

**Application:** Wallah It's Windy
**Audit date:** 27 July 2026
**Target context:** Civil Aviation Authority — Directorate General of Meteorology, Sultanate of Oman
**Audit type:** Strict scientific, weather-data, visualisation, interface, and operational-readiness review
**Decision:** **NO-GO for operational meteorological use**

## Executive verdict

Wallah It's Windy is a capable research and public-education prototype with
unusually honest documentation, deterministic replay, useful diagnostic
instruments, and a promising experimental track model. It is not currently a
weather forecasting system.

The application uses climatology or retrospective reanalysis rather than a
connected operational forecast cycle. Its sealed intensity and pressure
verification is rejected, rainfall is unverified and can become physically
contradictory, and essential Omani hazards—including storm surge, waves, tides,
and basin-level flash flooding—are missing.

The product must remain a clearly labelled research sandbox until the blocking
findings in this report are resolved and prospectively verified.

| Area | Readiness | Verdict |
| --- | ---: | --- |
| Current weather-data system | 1/10 | No operational feed is connected |
| Cyclone track | 5/10 | Retrospectively encouraging, not prospective |
| Intensity and pressure | 2/10 | Sealed verification rejected |
| Rain and flood impacts | 1/10 | Critical physics and validation deficiencies |
| Ocean representation | 2/10 | Mostly monthly climatology |
| Visualisation | 6/10 desktop; 2/10 mobile | Attractive but scientifically ambiguous |
| Operational governance | 1/10 | No issuance, approval, audit, or failover system |
| **Overall** | **2/10** | **Research sandbox only** |

This conclusion agrees with the project's own
[HF-6 model card](./model-card-hf6.md), which excludes operational warnings,
evacuation, surge, and NWP replacement.

## Audit scope and method

The review covered:

- The full desktop application at 1920 × 945.
- A mobile layout at 390 × 844.
- All nine weather-map layers and their workbenches.
- Spawn, month, scenario, historical-event, and run-mode controls.
- Point probe and city-impact markers.
- Flight recorder, timeline, replay, comparison, sensitivity, and ensemble
  laboratory.
- Historical hindcast scoring.
- PNG and WebM export paths by source inspection.
- Environmental binary data and its sampling logic.
- Simulation, rainfall, intensity, ocean, impact, and naming source code.
- Scientific model cards, calibration reports, and sealed verification
  artefacts.
- Production build, automated tests, calibration checks, and dependency audit.
- Comparison with Oman DGM, RSMC New Delhi, WMO, NOAA, ECMWF/Copernicus, and
  official Oman early-warning material.

No application source was changed during the audit.

## Simulations performed

These experiments are deterministic simulator tests, not forecasts.

| Experiment | Result | Audit conclusion |
| --- | --- | --- |
| Default May demonstration | Peak approximately 102 kt; six-day life; passed over land | Visually convincing, but not tied to a real forecast cycle |
| October controlled storm at 20.34°N, 63.25°E | Initial RH 10%; peak 41.6 kt; Oman landfall around 40 kt; **0 mm land rainfall** | Physical contradiction |
| Same genesis and seed, May environment | Peak 104.8 kt; landfall near 100 kt; **0 mm land rainfall** | Critical contradiction: an intense landfalling cyclone with no rain |
| 20-member October ensemble | Peak p10–p90 38–44 kt; 100% landfall member frequency | Spread is implausibly narrow; ensemble verification was rejected |
| Very favourable sensitivity run | +2°C SST, +20% RH, −8 m/s shear, and OHC ×1.5 produced only +8.9 kt peak and +1 hour of life | Useful educational experiment, not calibrated forecast sensitivity |
| Shaheen 2021 hindcast | Track MAE 51 km; intensity MAE 11.5 kt; pressure MAE 8.7 hPa; peak bias +5 kt | A reasonable single track result, but not evidence of operational skill |

The wider sealed evidence is substantially weaker for intensity. At 48 hours,
track skill is +53.5% against persistence, while wind skill is **−95.2%** and
pressure skill is **−72.1%**. At 72 hours, the intensity and pressure losses are
larger, while only six starts remain eligible for the track result. See
[HF-1–HF-6 findings](./findings-hf1-hf6.md).

## P0 operational blockers

P0 findings block any operational or warning use. Each is labelled by kind,
because the remedies differ:

- **Implementation defect** — the shipped code does the wrong thing. Fixable
  inside this repository.
- **Verification/governance failure** — the evidence or the process that
  produces it is broken. Fixable by protocol, not by physics.
- **Operational capability gap** — the capability was never built. Requires new
  systems, data agreements, and organisational process.

A 2/10 readiness score is not a claim that eight bugs exist. Most of the
distance to operational use is capability gap, and this audit assesses
operational readiness, not defect density.

### P0.1 — The application does not contain current forecast weather

**Operational capability gap.**

The default environment is a 0.5° monthly product:

- SST is OISST converted into monthly climatology.
- OHC is WOA23 monthly climatology.
- Humidity, shear, and steering use four seed-selected historical ERA5
  monthly-mean planes.
- A different seed can select a different historical year, not an ensemble
  member from today's atmosphere.
- Current Meteosat and RainViewer layers are display-only and never enter the
  model state.
- The HF-5 live-data types and provider adapters exist, but are not wired into
  the running application.
- The project documentation states that live mode remains disabled until a
  scheduled lawful feed and prospective evidence exist.

This is climate-sensitivity data, not weather initialisation. NOAA describes
[OISST](https://www.ncei.noaa.gov/products/optimum-interpolation-sst) as a daily
product and
[WOA23](https://www.ncei.noaa.gov/access/world-ocean-atlas-2023/) as
climatological fields. The application discards the daily SST resolution and
uses monthly climatology. ERA5 is a
[reanalysis](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels),
not an operational forecast cycle.

Local evidence:

- [`README.md`](../README.md), "Provenance — steering/shear are REAL ERA5".
- [`src/env-sampler.ts`](../src/env-sampler.ts), frozen synoptic-plane
  selection and analytic fallback.
- [`src/live-data.ts`](../src/live-data.ts),
  [`src/live-product.ts`](../src/live-product.ts), and
  [`src/live-providers.ts`](../src/live-providers.ts), which are currently
  disconnected from `main.ts`.

### P0.2 — The model can produce an intense, rainless tropical cyclone

**Implementation defect.** This is the most serious one found.

In [`src/sim.ts`](../src/sim.ts), every rainfall component is multiplied by:

```text
clamp((mid-level RH − 30) / 50)
```

RH at or below 30% therefore produces exactly zero eyewall, rainband, and
orographic rainfall. This multiplier is unconditional — it applies under every
physics profile.

At the same time, the shipped intensity profile lets low-shear dry air exert no
direct intensity penalty because dry-air exposure is multiplied by a shear
ramp that is zero below 12 m/s:

```text
low monthly RH → rainfall forced to zero
low shear       → dry-air weakening also forced to zero
warm SST/OHC    → cyclone intensifies
```

This explains the controlled 104.8 kt, zero-rain landfall.

Two separate defaults govern which branch runs, and only one of them describes
the product. The `intensityTerms` helper defaults its `physicsProfile`
parameter to `hf2-experimental`, which would take a physical ventilation-index
path. But `createSimEngine` defaults the engine to `shipped`, `src/main.ts`
never overrides it, and the engine passes that value explicitly into the
intensity calculation. The running application therefore takes the
shear-ramped fallback branch described above. Reading the helper default alone
gives the wrong answer about the shipped product.

Dry air is not entirely without effect: it also enters indirectly through the
organization target, whose shipped branch carries a moisture term weighted
0.25. That term is clamped to zero at RH ≤ 35%, so it is already saturated
across the environmental planes examined here (medians 13.8–27%, minima
7.5–8.9%). Within that regime, lowering RH further changes intensity through
neither the direct nor the indirect path, while rainfall remains exactly zero.
The indirect coupling exists but is inactive precisely where the defect
manifests.

Inspection of `public/data/env.bin` found May RH-plane medians around 21–27%,
with values down to 8.9%. One October plane had a median of only 13.8%, with a
minimum around 7.5%. A tropical cyclone cannot be represented by applying a
static monthly environmental RH directly to precipitation without moisture
convergence, storm-scale moistening, and forecast QPF.

Rain and cold-wake behaviour have never been scored against precipitation or
ocean observations. See [the hindcast benchmark](./hindcast-benchmark.md).

### P0.3 — Retrospective track skill is not prospective forecast skill

**Verification/governance failure.**

Historical experiments use future-valid ERA5 reanalysis throughout each event,
while their persistence comparator receives no future information. This is
useful for diagnosing internal physics but does not establish real-time forecast
skill.

The application requires an immutable archive of forecasts issued before
observations become available. The project currently reports zero matured
prospective forecasts. See [HF-1–HF-6 findings](./findings-hf1-hf6.md).

### P0.4 — Oman’s principal cyclone-impact systems are absent

**Operational capability gap.**

Oman’s official tropical-cyclone early-warning system considers numerical track
guidance, storm surge, coastal flooding, and water level. The app does not model
storm surge, tide, wave setup, sea state, or inundation. See the official
[Oman Tropical Cyclone Early Warning System](https://met.gov.om/website/pages/tcews.html).

The application's flash-flood output is a fixed storm-total proxy:

- 30 mm: moderate.
- 80 mm: high.
- 150 mm: extreme.

It does not use basin geometry, antecedent soil moisture, radar/gauge merging,
infiltration, discharge, or inundation. The implementation admits this in
[`src/impact.ts`](../src/impact.ts).

Oman's operational
[Flash Flood Guidance](https://met.gov.om/website/pages/ffg.html) combines basin
response, radar, satellite, gauges, and soil saturation. The application must
not display operational-looking flash-flood categories until integrated with
DGM's basin guidance.

### P0.5 — Wind classification is ambiguous for the region

**Implementation defect.**

The interface uses Saffir–Simpson categories without prominently stating
whether winds are 1-, 3-, or 10-minute sustained. Verification data use
USA/JTWC one-minute winds.

RSMC New Delhi's North Indian Ocean system uses regional terms such as Cyclonic
Storm, Severe Cyclonic Storm, and Extremely Severe Cyclonic Storm. IMD uses
three-minute sustained winds. See the official
[cyclone SOP](https://mausam.imd.gov.in/imd_latest/contents/pdf/cyclone_sop.pdf)
and [RSMC FAQ](https://rsmcnewdelhi.imd.gov.in/images/pdf/faq.pdf).

For DGM use, every wind value must declare averaging period, height and
exposure, sustained versus gust, source agency, and any conversion applied.
Saffir–Simpson categories may remain a secondary comparison but cannot be the
only operational vocabulary.

### P0.6 — Scientific verification is rejected

**Verification/governance failure.**

The sealed HF-6 result shows positive track skill but severe negative intensity
and pressure skill. The interactive sandbox retains the older shipped profile
because the more physical HF-2/HF-3 candidates failed their gates. The HF-4
ensemble was also rejected because of overcoverage and negative 48-hour Brier
skill.

Important sealed results include:

- 12-hour track skill: +34.4%.
- 24-hour track skill: +38.6%.
- 48-hour track skill: +53.5%.
- 48-hour wind skill: −95.2%.
- 48-hour pressure skill: −72.1%.
- Peak-intensity MAE: 13.3 kt.
- Peak-time MAE: 40.2 hours.
- Dissipation-event accuracy: 18.8%.
- RMW MAE: 18.8 km.
- R34 MAE: 75.9 km.
- R50 and R64: unavailable in the sealed cohort.

See the [HF-6 scorecard](./hf6-scorecard.md).

### P0.7 — Sealed reproducibility failed at audit time — remediated 27 July 2026

**Verification/governance failure — resolved.**

The following checks passed during the audit:

- Production TypeScript/Vite build.
- 434 automated tests across 53 files.
- Structure, hindcast, and fidelity calibration checks.
- HF-6 implementation/honesty gate.
- Dependency audit with zero reported vulnerabilities.

At audit time, `npm run hf6:verify:check` failed:

```text
Error: HF-6 sealed verification is stale (manifests)
```

The failure is fully localised. `manifests` is the only differing top-level key
in `calibration/hf6-sealed-verification.json`; every scored result is
unchanged. Of the eight hashed runtime sources, exactly one has drifted:

| Manifest key | Sealed | Current |
| --- | --- | --- |
| `runtimeHindcastSha256` (`src/hindcast-benchmark.ts`) | `f64ef8f2…` | `a2c2d1d0…` |
| Other seven runtime hashes | — | all match |

Provenance: commit `a037c4a` (*"fix: calibrate the shipped physics profile"*)
introduced the current hash of `src/hindcast-benchmark.ts`; the sealed file was
last written by commit `ba275f8`. The seal was never regenerated after that
calibration.

The defect was process, not arithmetic. At audit time,
`.github/workflows/deploy.yml` ran `npm test`, `npm run calibrate:check`, and
`npm run build`, but did **not** run `hf6:verify:check` — so the sealed cohort
could silently desynchronise from the code it certifies while the deploy gate
stayed green. An operational scientific product cannot ship with a broken
reproduction command.

The required remedy was a deliberate two-artifact re-seal, not a one-line hash edit.
`calibration/hf6-acceptance.json` records a `verificationSha256` over the
sealed file, so regenerating the seal alone leaves the gate artifact stale and
moves the failure from `hf6:verify:check` to `hf6:gate:check` rather than
clearing it. Both `hf6:verify` and `hf6:gate` must be re-run, and both checks
belong in CI — the second is what catches an incomplete re-seal.

Remediation completed on 27 July 2026. The sealed verification and acceptance
artifacts were regenerated; each changed by one hash line, while
`docs/hf6-scorecard.md` and every reported score remained unchanged.
`hf6:verify:check` and `hf6:gate:check` now pass and are both enforced by the
deployment workflow.

The implementation-complete gate passing does not mean the scientific forecast
gate passed; the project deliberately records the HF-6 result as rejected.
Re-sealing restores reproducibility of the rejected result — it does not and
must not alter that verdict.

### P0.8 — Observation and simulation times can be mixed

**Implementation defect.**

Recent wall-clock RainViewer radar and Meteosat observations can be displayed
while a climatological or accelerated simulated storm remains on the map.
Although the workbenches label providers and times, this compositing encourages
users to infer a relationship that does not exist.

Observation, analysis, forecast, hindcast, and climatology modes require
separate visual identities and synchronized valid-time controls.

## Layer-by-layer audit

| Layer | Finding | Required improvement |
| --- | --- | --- |
| Wind | Attractive particle rendering, but it combines environmental steering and a synthetic vortex. No wind direction vectors, averaging period, level, valid time, or uncertainty | Separate analysed/model wind and vortex products; add barbs or streamlines, issue/valid time, and wind-period metadata |
| Simulated radar | White opaque spirals did not resemble the stated reflectivity palette and can be mistaken for radar | Use a quantitative dBZ scale and permanent `MODEL RAIN PROXY` watermark; preferably replace with NWP QPF |
| Observed radar | Provider, age, and missing-data hatching are honest. Coverage was only 29%, and the hatch dominated most of Oman | Ingest DGM radar mosaics and quality flags; synchronize valid time; do not overlay an unrelated simulated storm by default |
| Satellite IR | Meteosat time and product attribution are good. Enhanced rendering lacks a quantitative brightness-temperature scale | Add Kelvin/°C ticks, enhancement table, navigation quality, and observation/model separation |
| Accumulation | 1/3/6/24-hour controls work, but the product inherits the zero-rain defect and uses a fixed 0.1° parametric ledger | Replace with verified forecast QPF plus radar/gauge correction and duration-specific scales |
| SST | Smooth and readable, but monthly climatology looks like a current analysis | Display source date, analysis age, anomaly, 26°C isotherm, and uncertainty; use daily operational SST |
| Humidity | Shows 600/700-hPa mean RH, but it is static monthly forcing and is critically misused by the rain model | Use forecast profiles and storm-relative ventilation diagnostics |
| OHC | A useful conceptual layer, but WOA monthly climate cannot represent current warm-core eddies | Use an operational ocean analysis with depth, TCHP/OHC definition, and valid time |
| Shear | Magnitude only; vector components and storm-relative direction are hidden | Add shear arrows, magnitude, pressure levels, and downshear quadrants |
| Terrain | Attractive hillshade but no numeric elevation/depth contours, tidal datum, surge, or basin overlays | Add elevations, bathymetric contours, wadis, catchments, exposure, and flood/surge layers |

The main layer catalogue is defined in
[`src/weather-layers.ts`](../src/weather-layers.ts). Its principal legends do
not carry a complete issue-time, valid-time, source, uncertainty, and vertical
coordinate contract.

## Interface and product-surface audit

### Masthead, disclaimer, and methodology

The desktop disclaimer and methodology dialog are strong. Limitations,
observations, simplifications, and non-assimilation are explained more honestly
than in many research applications.

At widths below 600 px, the generic quiet button—including methodology—is
hidden by [`src/style.css`](../src/style.css). Safety limitations must become
more prominent on a small screen, not disappear.

### Run environment

Month, scenario, and hindcast/counterfactual separation are clear for research.
The controls need a stronger run identity containing mode, provider, model,
cycle, issue time, valid time, lead, configuration/data hashes, and wind
convention.

### Map and camera

The map domain is fixed to 50–70°E and 15–27°N in
[`src/grid.ts`](../src/grid.ts). There is no pan or zoom. This truncates storm
context and is inadequate for regional coordination, upstream monitoring, or
close coastal analysis.

### Storm identity and naming

The code explicitly marks generated names as simulated, which is responsible.
However, it assigns real WMO/ESCAP roster names deterministically in
[`src/storm-names.ts`](../src/storm-names.ts). This still risks confusion inside
an operational organisation. Use neutral identifiers such as `SIM-2026-0042`;
historical hindcasts may use the actual historical name.

### Point probe

The point probe is one of the strongest surfaces. It exposes model wind, SST,
RH, shear, OHC, rain, and provenance. It needs valid-time and pressure-level
selection, observation/model comparison, quality/uncertainty flags, coordinates,
and value-copy support.

### City impacts

Only Muscat, Sur, Masirah, Duqm, Salalah, Gwadar, Karachi, and Chabahar are
represented. Their winds and rain are parametric point samples, not exposure or
damage forecasts.

Oman requires governorates, coastal segments, ports, airports, wadis, populated
places, emergency assets, user-defined points, and polygon/basin summaries.

### Flight recorder

The recorder is an excellent research explainer. It makes intensity tendencies,
environment, structure, and rain components inspectable and is valuable for
training and model debugging.

It is too dense for an operational overview. On mobile it dominates the
viewport and reduces the map to a narrow strip. Operational and research
layouts should be separated.

### Timeline and replay

Deterministic immutable replay and milestone navigation work well. At 390 × 844,
category, peak, landfall, and end labels overlap. Mobile needs collision-aware
labels, priority rules, and a full-screen map mode.

### Comparison and sensitivity

Same-genesis/same-seed comparison and SST, RH, shear, OHC, and core sensitivity
controls are strong research instruments. Their responses are not calibrated
forecast sensitivities and must remain separated from operational guidance.

### Ensemble laboratory

The interface honestly says member frequency is not calibrated probability.
This warning is necessary because HF-4 was rejected. The ensemble cannot drive
a cone or probability product until it passes spread–skill, reliability, CRPS,
Brier-skill, rank-histogram, and strike-probability verification.

### Historical hindcasts

Observed-initialisation and counterfactual modes are well separated, and the UI
states that no track nudging occurs. Historical runs should carry a permanent:

> RETROSPECTIVE REANALYSIS — NOT A FORECAST

label. Future-valid reanalysis makes these physics hindcasts, not archived
real-time forecasts.

### Export surfaces

PNG cards and WebM replays are useful communication artefacts. Source inspection
of [`src/main.ts`](../src/main.ts) and [`src/export.ts`](../src/export.ts) found
no machine-readable, signed forecast manifest.

An operational export needs product/model version, cycle, issue/valid times,
source hashes, configuration, operator and approver, warning status, wind
convention, domain/CRS, and a digital integrity signature.

### Failure behaviour

Radar and satellite failures are clearly reported, and simulated radar pixels
are not silently substituted for failed observations. This is good.

Environmental failure is less safe: the simulator can continue using an
analytic degraded environment. An operational product must fail closed, remove
forecast-authority styling, and make the degraded condition impossible to miss.

### Mobile, accessibility, and localisation

Good foundations include keyboard-accessible controls, useful ARIA names and
status regions, reduced-motion support, and touch-specific interaction logic.

Problems include:

- The map becomes too small after the flight recorder opens.
- Methodology disappears below 600 px.
- Timeline milestones collide.
- Run controls and labels clip.
- Forecast-lab controls compete with the recorder.
- No Arabic or RTL interface.
- No documented screen-reader, contrast, or representative-device
  qualification.

## What is worth preserving

- Deterministic fixed-step behaviour and URL reproducibility.
- Immutable flight tapes and replay.
- Point-probe transparency.
- Explicit observation-versus-simulation labels.
- Clear observation failure messages.
- Provider, time, age, and coverage labels.
- Source hashes and scientific gate infrastructure.
- Model cards that openly record rejected experiments.
- Good unit and integration test coverage.
- Worker-based ensemble execution.
- Research comparison and sensitivity tools.
- Desktop visual quality and storm-physics explanation.

These features make the application a valuable research client and a useful
foundation for a future operational visualisation shell.

## Recommended conversion roadmap

### Phase 0 — Freeze claims and remove immediate safety risks

1. Keep the current application as a research/sandbox edition.
2. Add a permanent `RESEARCH — NOT FOR WARNING` identity.
3. Remove official-roster names from simulated storms.
4. Fix the rain/dry-air contradiction.
5. Keep sealed verification reproducible through CI (**completed 27 July 2026**).
6. Separate wall-clock observations from climatological and simulated time.
7. Remove probability-like language from uncalibrated ensemble fields.
8. Make all operational-style degradation states fail closed.

### Phase 1 — Build an operational data plane

Integrate under DGM-controlled acquisition, licensing, and quality monitoring:

- DGM radar, automatic weather stations, and rain gauges.
- Buoys and tide gauges.
- Official RSMC New Delhi advisories.
- Multiple deterministic and ensemble NWP systems.
- Daily SST and a three-dimensional operational ocean analysis.
- Meteosat/INSAT imagery with navigation and quality metadata.
- Lightning, wave, and sea-state data where available.
- Immutable forecast-cycle archives.

Every artefact requires provider, cycle/issue/valid time, fetch age, grid, units,
vertical coordinates, wind-averaging period, licence, byte count, checksum,
quality-control state, and a clear failure policy.

RSMC New Delhi supplies regional advisories, track/intensity guidance, and
storm-surge products relevant to Oman:
[RSMC activities](https://rsmcnewdelhi.imd.gov.in/activities-of-rsmc-new-delhi.php).

The Directorate's responsibilities include observations, high-accuracy
forecasts, and warnings through Oman's multi-hazard early-warning system:
[DGM responsibilities](https://met.caa.gov.om/en/service/research-and-development-department/).

### Phase 2 — Replace the authoritative forecast core

Use official guidance and multi-model NWP/ensemble consensus as the operational
forecast basis. The current simulator may remain a diagnostic or experimental
member but cannot control a warning answer.

Develop and independently verify:

- Probabilistic track and intensity guidance.
- Along-track and cross-track uncertainty.
- Wind radii and gusts.
- Quantitative precipitation and radar/gauge bias correction.
- Storm surge, astronomical tide, wave setup, and sea state.
- Coastal inundation.
- Basin-level flash-flood guidance.
- Asset and population exposure.

Remove presentation-motivated physics such as the 12-hour shear grace period in
`src/sim.ts`. Model parameters must be driven by scientific performance, not by
the need to keep a storm visible long enough for animation.

### Phase 3 — Rebuild the product interface around valid time

1. Add a shared pan/zoom map camera.
2. Make issue time, valid time, lead, provider, and mode persistent.
3. Use separate identities for observations, analyses, forecasts, hindcasts,
   climatology, and simulations.
4. Add quantitative legends: dBZ, mm, K/°C, m/s, kt, hPa, and metres.
5. Add wind barbs and shear vectors.
6. Add administrative, basin, coastal, airport, port, and asset layers.
7. Provide Arabic and English with full RTL support.
8. Build separate research and operational workspaces.
9. Add CAP-compatible warnings, approval workflow, audit logs, and role-based
   access.
10. Design mobile around situational awareness, not a compressed desktop lab.

### Phase 4 — Establish prospective verification

Archive every forecast before observations arrive. Predeclare metrics and
acceptance thresholds for:

- Along-track, cross-track, and position error.
- Intensity and pressure MAE/bias.
- Peak timing and dissipation.
- R34, R50, and R64 errors.
- Brier score, CRPS, reliability, and spread–skill.
- Rainfall FSS, ETS, CRPS, and bias by duration/threshold.
- Surge and water-level RMSE.
- Landfall position/time, false alarms, misses, and warning lead time.
- Availability, latency, recovery, and data completeness.

Do not claim operational skill until at least two cyclone seasons have been
prospectively archived, mandatory forecast metrics beat predeclared baselines,
and intensity, pressure, rain, uncertainty, and surge gates pass.

WMO regional operational plans require coordinated observations, data exchange,
forecasting, and warning procedures:
[WMO Tropical Cyclone Operational Plans](https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/tropical-cyclone-programme-tcp/tropical-cyclone-operational-plans).

## Release gates

Operational deployment remains blocked until all of the following are true:

- [ ] A lawful, monitored, scheduled current-data feed exists.
- [ ] Every product displays cycle, issue time, valid time, lead, source, age,
      units, and quality status.
- [ ] Wind averaging conventions are explicit and regionally compatible.
- [ ] Observation and simulation times cannot be mixed accidentally.
- [ ] Analytic fallback cannot masquerade as an operational forecast.
- [x] Sealed verification reproduces byte-for-byte.
- [ ] Prospective archives contain sufficient independent storms and seasons.
- [ ] Track, intensity, pressure, uncertainty, rain, and structure gates pass.
- [ ] Storm surge, tide, waves, and coastal-flood products are verified.
- [ ] Flash-flood output is connected to basin-level DGM guidance.
- [ ] Ensemble products pass reliability, CRPS, Brier, and spread–skill gates.
- [ ] Pan/zoom, valid-time navigation, Arabic/RTL, accessibility, and the full
      device matrix are complete.
- [ ] Role-based access, approval, audit logs, issuance, retraction, failover,
      and continuity procedures exist.
- [ ] DGM meteorologists complete acceptance testing and sign the operational
      concept and limitations.

## Final recommendation

Do not attempt to certify the current reduced-order simulator as DGM's forecast
model.

Preserve it as:

1. An Arabian Sea cyclone research sandbox.
2. A training and public-education application.
3. A diagnostic visualisation client.
4. A foundation for a future DGM-controlled operational visualisation shell.

Sealed reproducibility was restored after the audit and is now protected by CI.
The remaining immediate order of work should be:

1. Fix the rain/dry-air contradiction.
2. Add live-cycle data and strict valid-time separation.
3. Adopt regional wind and classification semantics.
4. Integrate storm surge, waves, tides, and DGM flash-flood guidance.
5. Begin immutable prospective archiving.
6. Rebuild the interface for bilingual operational situational awareness.

Until those steps and their verification gates are complete, all outputs must
remain explicitly non-operational.
