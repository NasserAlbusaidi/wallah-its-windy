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
| October controlled storm at 20.34°N, 63.25°E | Initial RH 10%; peak 41.6 kt; Oman landfall around 40 kt; **0 mm land rainfall** | Physical contradiction reproduced before the 27 July remediation |
| Same genesis and seed, May environment | Peak 104.8 kt; landfall near 100 kt; **0 mm land rainfall** | Critical contradiction reproduced before the 27 July remediation |
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
- The HF-5 live-data types and provider adapters do not drive the simulation.
- A six-hourly public-source monitor added after the audit now normalizes
  regional GFS atmosphere and OISST and exposes each input gate in the UI. Its
  seven-field partial environment omits OHC and cannot pass the eight-field
  forecast contract.
- RSMC active-advisory parsing, regional three-dimensional upper-ocean data,
  GEFS normalization, issuance, and prospective evidence remain absent, so live
  forecast mode stays disabled.

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
  [`src/live-providers.ts`](../src/live-providers.ts), which remain disconnected
  from model initialization.
- [`bake/public_cycle.py`](../bake/public_cycle.py) and
  [`src/public-cycle.ts`](../src/public-cycle.ts), which acquire and present
  current source availability without promoting it to forecast forcing.

### P0.2 — The model could produce an intense, rainless tropical cyclone — core defect remediated 27 July 2026

**Implementation defect — core contradiction resolved; observational QPF
verification remains open.** This was the most serious code defect found.

At audit time, [`src/sim.ts`](../src/sim.ts) multiplied every rainfall
component by:

```text
clamp((mid-level RH − 30) / 50)
```

RH at or below 30% therefore produced exactly zero eyewall, rainband, and
orographic rainfall. The multiplier was unconditional across physics profiles.

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

The core contradiction was remediated on 27 July 2026. Rain moisture support
now combines environmental moisture with a bounded storm-scale
convergence/recycling term that exists only when a real circulation and an
organised convective core coexist. Regression tests prove that a 105 kt,
organised vortex at 10% environmental RH produces non-zero eyewall, rainband,
and orographic rates, while a weak, disorganised dry disturbance retains zero
rain rather than receiving an arbitrary visible floor. Radar and accumulation
surfaces now carry a permanent `MODEL RAIN PROXY` identity.

This is an internal-consistency repair, not QPF certification. Rain and
cold-wake behaviour still have not been scored against independent
precipitation or ocean observations. That verification work remains tracked in
[issue 18](https://github.com/NasserAlbusaidi/wallah-its-windy/issues/18).
See also [the hindcast benchmark](./hindcast-benchmark.md).

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

### P0.5 — Wind classification was ambiguous for the region — product ambiguity remediated 27 July 2026

**Implementation defect — research-product ambiguity resolved; full operational
wind metadata remains open.**

At audit time, the interface used Saffir–Simpson categories without prominently stating
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

The product now uses a typed wind-convention contract and North Indian Ocean
classification table. UI chips, timelines, impacts, probes, and exports
identify simulator winds as one-minute sustained; the permanent convention
note declares 10 m over-sea exposure and the USA/JTWC calibration convention.
RSMC New Delhi terms are primary. Because no validated one-to-three-minute
conversion is applied, each regional band carries an asterisk and the word
“indicative”; the Saffir–Simpson table remains only as a secondary colour
comparison.

This resolves the misleading category presentation but not every operational
requirement in [issue 21](https://github.com/NasserAlbusaidi/wallah-its-windy/issues/21):
ingested observations still need convention metadata carried end-to-end, and
wind/shear products still need direction, vertical levels, valid time, and
uncertainty.

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

### P0.8 — Observation and simulation times could be mixed — accidental mixing boundary remediated 27 July 2026

**Implementation defect — accidental mixing resolved; wider operational product
identity remains open.**

At audit time, recent wall-clock RainViewer radar and Meteosat observations could be displayed
while a climatological or accelerated simulated storm remains on the map.
Although the workbenches label providers and times, this compositing encourages
users to infer a relationship that does not exist.

Observation, analysis, forecast, hindcast, and climatology modes require
separate visual identities and synchronized valid-time controls.

The application now has a permanent, tested product-identity bar. Climatology
shows elapsed model time and explicitly has no UTC valid time. Historical
hindcast and counterfactual clocks derive UTC model time from their frozen
scenario origins. Selecting observed radar or satellite pixels on an active
run requires acknowledgement; the permanent bar then reports the observation
as valid-time pending, time-matched, or `UNSYNCED OBS OVERLAY`. A new spawn or
mode transition returns the display to simulation-only. Synthetic storms now
use neutral `SIM-…` identifiers, and the methodology control remains available
below 600 px.

The larger operational surface in
[issue 24](https://github.com/NasserAlbusaidi/wallah-its-windy/issues/24)
remains open: issue/cycle/configuration manifests, Arabic/RTL, full accessibility
and device qualification, full-screen map ergonomics, and issuance/governance
workflows are not provided by this remediation.

## Layer-by-layer audit

| Layer | Finding | Required improvement |
| --- | --- | --- |
| Wind | Attractive particles; one-minute convention and indicative regional band are now explicit, but the layer still combines environmental steering and a synthetic vortex and lacks direction vectors, vertical level, issue time, and uncertainty | Separate analysed/model wind and vortex products; add barbs or streamlines, issue/valid time, and full wind metadata |
| Simulated radar | Permanent `MODEL RAIN PROXY` identity now prevents an observed-radar claim, but white opaque spirals still lack a quantitative reflectivity contract | Add a quantitative model-rain scale; preferably replace with verified NWP QPF |
| Observed radar | Provider, age, missing-data hatching, and sync/mismatch state are honest. Coverage was only 29%, and the hatch dominated most of Oman | Ingest DGM radar mosaics and quality flags; offer synchronized time navigation |
| Satellite IR | Meteosat time, product attribution, and observation/model time state are explicit. Enhanced rendering lacks a quantitative brightness-temperature scale | Add Kelvin/°C ticks, enhancement table, and navigation quality |
| Accumulation | 1/3/6/24-hour controls and permanent model-proxy identity work; the zero-rain contradiction is repaired, but output remains a fixed 0.1° parametric ledger | Replace with verified forecast QPF plus radar/gauge correction and duration-specific scales |
| SST | Smooth and readable, but monthly climatology looks like a current analysis | Display source date, analysis age, anomaly, 26°C isotherm, and uncertainty; use daily operational SST |
| Humidity | Shows 600/700-hPa mean RH. It is no longer the sole precipitation gate, but remains static monthly environmental forcing | Use forecast profiles and storm-relative ventilation diagnostics |
| OHC | A useful conceptual layer, but WOA monthly climate cannot represent current warm-core eddies | Use an operational ocean analysis with depth, TCHP/OHC definition, and valid time |
| Shear | Magnitude only; vector components and storm-relative direction are hidden | Add shear arrows, magnitude, pressure levels, and downshear quadrants |
| Terrain | Attractive hillshade but no numeric elevation/depth contours, tidal datum, surge, or basin overlays | Add elevations, bathymetric contours, wadis, catchments, exposure, and flood/surge layers |

The main layer catalogue is defined in
[`src/weather-layers.ts`](../src/weather-layers.ts). Its principal legends do
not carry a complete issue-time, valid-time, source, uncertainty, and vertical
coordinate contract.

### Post-audit layer-integrity addendum — 27 July 2026

The following findings were submitted after the main audit and checked against
the committed runtime, shaders, bake scripts, and binary artefacts. They do not
change the no-go decision, but they sharpen the distinction between display
defects and limits imposed by the shipped data.

#### Static replay assets were not byte-pinned

**Remediated on 28 July 2026.** A recursive SHA-256 manifest now pins every
committed static replay file under `public/data/`, and CI fails on drift,
addition, or removal. The only prefix exclusions are `live/` and `satellite/`.
Those volatile live-cycle and observed-satellite assets are validated by their
cycle/provider manifests instead of being frozen to committed bytes.

#### Storm clouds use the inner-core radius as their only size scale

**Implementation defect.** The apparent shrinking of the simulated infrared
cloud shield as the cyclone intensifies has a specific cause. The structural
model deliberately contracts the radius of maximum wind (RMW) with increasing
wind using the bounded Willoughby–Rahn climatological proxy in
[`src/structure.ts`](../src/structure.ts). That is a defensible first-order
behaviour for the eye and eyewall. The same model separately predicts an outer
size, and the live parameters allow that outer circulation to grow with wind.

The infrared shader in [`src/render/env.ts`](../src/render/env.ts), however,
receives only `structure.rmwKm / 666` as `u_rMax`. Its central overcast,
rainbands, cirrus canopy, shear displacement, and eye are all expressed as
multiples of that one inner-core radius. It never receives `outerSizeKm` or a
34-kt wind radius. Consequently a strengthening storm can have a correctly
contracting eye and eyewall but an incorrectly contracting entire cloud shield,
even while its diagnosed outer circulation expands.

The widening accumulation display does not contradict this diagnosis. It is a
storm-total history: deposited rain remains on the grid as the storm moves and
new deposits are added. The instantaneous radar rainband also uses an
RMW-normalized envelope, so future correction should provide separate inner-core
and outer-cloud/rainband scales rather than merely enlarging every storm feature.

Required remedy: pass both RMW and a verified outer-size measure into the cloud
and precipitation render paths. Keep the eye and eyewall tied to RMW; tie the
central dense overcast, outer rainbands, and cirrus canopy to independently
bounded structural radii.

**Remediation status — partially closed on 28 July 2026.** The simulated
infrared pass now receives separate `rMax` and `rCanopy` scales. Outer size
controls the central overcast, cirrus canopy, canopy offset, and canopy texture
space, while the eye and inner core remain tied to RMW. The rainband component
of the cloud shield still uses the contracting inner-core scale, so the broader
cloud-shield shrinkage finding is not fully resolved.

#### Instantaneous radar and accumulated rain use different rainband means

**Implementation defect.** The simulated radar shader in
[`src/render/radar.ts`](../src/render/radar.ts) modulates its rainband with
`max(0.08, 0.54 + 0.46·sin(...))`, whose azimuthal mean is 0.54. The impact
ledger in [`src/impact.ts`](../src/impact.ts) deposits the same nominal
rainband rate with a fixed factor of 0.68. Its azimuthally averaged rainband is
therefore `0.68 / 0.54 = 1.259`, approximately 26% larger than the instantaneous
radar product implies.

There is an important qualification. The accumulation layer faithfully renders
the CPU ledger; the disagreement is between products, not between that ledger
and its own display. The 0.68 comment in `impact.ts` also matches the separate
land/wadi rain shader in [`src/render/rain.ts`](../src/render/rain.ts), which
uses `0.68 + 0.32·sin(...)`. The comment is therefore not numerically invented,
but it is ambiguous because it does not identify that shader and does not match
the user-facing simulated radar.

Required remedy: define one shared rainband spatial contract for radar, impact
accumulation, and land/wadi forcing, or explicitly document and validate any
intentional product-specific transfer functions.

**Remediation status — internally closed on 28 July 2026.**
[`src/rainband-profile.ts`](../src/rainband-profile.ts) now supplies the same
four radial edges, spiral constants, and 0.68 azimuthal mean to simulated radar,
land/wadi rain, and the impact ledger. The cloud-morphology band in
`render/env.ts` is deliberately separate. This removes the cross-product
contradiction; it does not validate the profile or its mean against observed
rainfall.

#### Missing `ocean.bin` is assigned the wrong provenance tier

**Implementation defect.** The boot loader in
[`src/main.ts`](../src/main.ts) intentionally turns a missing or failed
`data/ocean.bin` fetch into `null`. The ocean sampler then returns no profile.
At reset, [`src/sim.ts`](../src/sim.ts) nevertheless labels every non-event
column `climatological-subsurface` before it knows whether the profile exists.
[`src/upper-ocean.ts`](../src/upper-ocean.ts) correctly generates an analytic
temperature/salinity profile from scalar SST and OHC when the profile is absent,
but preserves the already assigned climatological label. Its
`missingSourceFlag` is consequently false.

The result is silent provenance degradation: diagnostics and exports can claim a
WOA23-initialized subsurface column while the model is using a fabricated
analytic profile. `analytic-fallback` remains reachable through lower-level
defaults and tests, but not through the normal shipped application path for this
failure.

Required remedy: sample the profile first and derive `initializationTier` from
the result. A missing or malformed climatological profile must set
`analytic-fallback`, raise `missingSourceFlag`, and produce a visible degraded
data-state indication.

**Remediation status — closed on 28 July 2026.** Ocean profile samplers now
return a tagged profile-and-provenance sample or `null`; the simulation derives
the tier and source time only from the branch that actually returned data.
The upper-ocean model defensively downgrades a claimed tier when no profile is
present. A missing source raises the diagnostic and displays
`DEGRADED INPUT · subsurface ocean: analytic fallback` in the permanent product
identity bar.

#### Vector ventilation is diagnostic, not shipped intensity physics

**Model limitation and profile-selection risk.** The annular calculation in
[`src/ventilation.ts`](../src/ventilation.ts) is implemented and unit-tested. It
retains the Tang–Emanuel dimensional form—shear times a bounded RH-derived
entropy-deficit proxy divided by potential intensity—but it is not a full
thermodynamic Tang–Emanuel ventilation calculation because the required entropy
profiles are absent.

The running application does not select `hf2-experimental`.
[`src/main.ts`](../src/main.ts) supplies no physics override, so
[`src/sim.ts`](../src/sim.ts) selects `shipped` and explicitly passes that
profile into organization and intensity. The vector ventilation index is still
calculated and recorded as a diagnostic, but the shipped intensity tendency and
organization target use scalar shear and mid-level RH fallbacks. Shear direction
therefore changes structure and rain geometry, but does not directly change the
deployed intensity tendency.

Required remedy: do not describe the vector ventilation index as active
intensity physics until the experimental profile passes its scientific gates and
is deliberately promoted. In the meantime, label it diagnostic-only in the UI
and model documentation.

#### The shipped environment artefact has a hard information ceiling

Independent parsing of `public/data/env.bin` with the reference parser in
[`bake/binfmt.py`](../bake/binfmt.py) found 56 layer records on the 40 × 24,
0.5-degree grid: `sst`, `u`, `v`, `shr`, `shu`, `shv`, `rh`, and `ohc` for each
month suffix `04` through `10`. Atmospheric wind, shear, and RH fields contain
four selected real-year planes per month; SST and OHC have one climatological
plane per month.

- The baked `u` and `v` fields are deep-layer steering, while `shu` and `shv`
  retain only `V200 − V850`. Absolute 200-hPa winds and the individual
  850/500/250-hPa winds are not persisted. The browser cannot uniquely
  reconstruct another shear layer pair or a data-derived upper-level outflow
  field.
- [`bake/fetch_era5.py`](../bake/fetch_era5.py) requests pressure-level `u` and
  `v`, 600/700-hPa RH, and SST. It does not request atmospheric temperature or
  geopotential. Emanuel potential intensity, tropopause height, CAPE, and other
  profile-based thermodynamics are therefore not derivable from the shipped
  artefact; the current intensity ceiling is the SST-based DeMaria–Kaplan proxy.
- The atmospheric runtime forcing is not a 30-year mean. The raw ERA5 request
  spans 1991–2020, but [`bake/era5.py`](../bake/era5.py) deliberately selects
  four distinct real years per month. As `CLAUDE.md` already states,
  `SHEAR_THRESHOLD_MS = 14` is calibrated to this monthly-mean, selected-year
  representation and is not portable to daily or hourly forecast shear without
  recalibration.
- The observation contract and baker support only infrared and visible
  satellite channels. There is no microwave or water-vapour channel. A
  quantitative brightness-temperature product would additionally require
  calibrated radiance/channel metadata; adding atmospheric temperature or
  geopotential alone would not supply it.

These are acquisition and schema limits, not parser omissions. Adding the
derived products requires versioning the data contract, retaining the necessary
vertical and radiometric source variables, updating the baker and browser
samplers, and recalibrating every model term that consumes the changed
distribution.

## Interface and product-surface audit

### Masthead, disclaimer, and methodology

The desktop disclaimer and methodology dialog are strong. Limitations,
observations, simplifications, and non-assimilation are explained more honestly
than in many research applications.

The 27 July remediation keeps methodology visible below 600 px and adds a
permanent product-mode/valid-time identity bar. The 390 × 844 browser check
confirmed both remain visible without overlapping the timeline.

### Run environment

Month, scenario, and hindcast/counterfactual separation are clear for research.
The permanent identity now adds mode, model-valid time, and observation-sync
state. A future operational identity still needs provider/model cycle, issue
time, lead, configuration/data hashes, and machine-readable wind convention.

### Map and camera

The map domain is fixed to 50–70°E and 15–27°N in
[`src/grid.ts`](../src/grid.ts). There is no pan or zoom. This truncates storm
context and is inadequate for regional coordination, upstream monitoring, or
close coastal analysis.

### Storm identity and naming

Synthetic product runs now use stable neutral `SIM-…` identifiers. Historical
hindcasts retain the actual historical event name. The WMO/ESCAP roster remains
in [`src/storm-names.ts`](../src/storm-names.ts) as catalogue data but is no
longer used to name a running synthetic storm.

### Point probe

The point probe is one of the strongest surfaces. It exposes coordinates,
model wind, SST, RH, shear, OHC, rain, provenance, and the run's exact
model-valid-time contract. It still needs pressure-level selection,
observation/model comparison, quality/uncertainty flags, and value-copy support.

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
states that no track nudging occurs. Historical runs now carry a permanent
`RETROSPECTIVE REANALYSIS HINDCAST` identity alongside the global
non-operational guidance label. Future-valid reanalysis still makes these
physics hindcasts, not archived real-time forecasts.

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
- Permanent product-mode, model-time, and observation-sync identity.
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
- [x] Simulator wind averaging, height/exposure, and no-conversion semantics are
      explicit; regional terms are primary and incompatible one-minute bands
      are visibly marked indicative.
- [x] Observation and simulation times cannot be mixed accidentally; overlays
      require acknowledgement and retain a permanent sync/mismatch state.
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

Sealed reproducibility, the rain/dry-air contradiction, regional wind
presentation, and the accidental observation/simulation mixing boundary were
remediated on 27 July 2026. The remaining immediate order of work should be:

1. Add a lawful live-cycle data plane and complete product metadata.
2. Validate rain and cold-wake behaviour against independent observations.
3. Integrate storm surge, waves, tides, and DGM flash-flood guidance.
4. Begin immutable prospective archiving.
5. Rebuild the interface for bilingual operational situational awareness.
6. Add signed issuance, approval, retraction, audit, failover, and continuity
   workflows.

Until those steps and their verification gates are complete, all outputs must
remain explicitly non-operational.
