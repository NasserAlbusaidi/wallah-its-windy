# HF-2A dynamic upper-ocean specification

Status: **v1 locked before implementation on 2026-07-21; v2 development
candidate frozen before acceptance evaluation on 2026-07-21**. The machine-readable
contract is [`calibration/hf2a-contract.json`](../calibration/hf2a-contract.json).

## Decision

Replace the empirical cold-wake patch and direct OHC intensity multipliers with
a sparse, deterministic, one-dimensional upper-ocean column under each forced
ocean cell. Each column carries temperature, salinity, and horizontal-current
profiles to 300 m. Surface stress accelerates the mixed layer; a bulk
Richardson-number rule entrains colder water while conserving heat, salt, and
momentum.

This is a reduced PWP-style model, not a three-dimensional ocean circulation
model. It deliberately omits horizontal ocean advection, waves, spray, and a
resolved air-sea enthalpy budget. Those omissions must remain visible in the
diagnostics and product language.

The choice follows four physical results:

- Hurricane cooling is dominated by entrainment, depends strongly on initial
  mixed-layer depth and thermocline gradient, and is normally displaced to the
  right of a moving Northern Hemisphere storm. Price's three-layer experiment
  attributed 85% of the irreversible mixed-layer heat flux in Hurricane Eloise
  to entrainment and found a 5–10 day energy-dispersion scale
  ([Price 1981](https://doi.org/10.1175/1520-0485(1981)011%3C0153:UORTAH%3E2.0.CO;2)).
- A bulk mixed-layer model should homogenize unstable layers and deepen the
  layer when the bulk Richardson number falls below a critical value. The PWP
  family supplies the structure; HF-2A uses bulk and gradient Richardson
  mixing with the published 0.65 and 0.25 anchors
  ([University of Hawaii PWP reference](https://www.soest.hawaii.edu/pwp/index1.html)).
- A 0.03 kg m^-3 density threshold relative to 10 m is the preferred initial
  mixed-layer definition. A 0.2 C temperature threshold is the fallback when
  salinity is unavailable
  ([de Boyer Montegut et al. 2004](https://doi.org/10.1029/2004JC002378)).
- Ocean cooling is a negative feedback on cyclone intensity, so the simulated
  surface temperature—not a second scalar OHC penalty—must enter the atmosphere
  model ([Schade and Emanuel 1999](https://doi.org/10.1175/1520-0469(1999)056%3C0642:TOSEOT%3E2.0.CO;2)).

## Defect being removed

The current event baker retains the evolving ERA5 SST field because it contains
the real storm's observed surface wake. The runtime then subtracts its own
empirical wake from that SST. Historical replay can therefore cool the same
ocean twice.

The current OHC scalar also affects both MPI and intensification rate while OHC
separately suppresses cold-wake growth. That makes one climatological number
serve three overlapping roles and allows repeated extraction from an unchanged
column.

HF-2A removes both paths:

1. Event replays receive a pre-storm, wake-free background SST and one
   upper-ocean profile valid no later than initialization.
2. The dynamic column alone produces subsequent storm cooling.
3. OHC26 remains an initialized and prognostic diagnostic. It is not a direct
   intensity multiplier.
4. The atmosphere sees only the column's current surface temperature through
   the existing MPI and ocean-support budget.

## Data contract

### Source tiers

Every ocean artifact declares one of two initialization tiers.

**Tier A — event-specific analysis.** For events from 1993 onward, prefer a
temperature-and-salinity profile from the latest analysis whose validity
interval ends at or before cyclone initialization. The initial adapter targets
Copernicus Marine GLORYS12V1: a 1/12-degree, 50-level reanalysis containing
temperature, salinity, currents, and mixed-layer depth
([product description](https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/description)).
Only the initialization snapshot is consumed. No later ocean analysis is
assimilated.

**Tier B — climatological profile.** If a temporally valid Tier A profile cannot
be reproduced, initialize from monthly WOA23 temperature and salinity. WOA23 is
an objectively analyzed climatology on standard depth levels, so the UI and
exports must label this tier `climatological subsurface`
([NOAA WOA23](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.nodc%3ANCEI-WOA23)).
The existing baker already downloads the required temperature profiles; HF-2A
adds salinity and retains the profile instead of collapsing it to OHC26.

Tier B adjusts the mixed layer to the event's pre-storm SST without inventing a
new thermocline:

1. Compute the median event SST from the 24 hours before initialization.
2. Add its difference from the profile's surface temperature uniformly through
   the diagnosed mixed layer.
3. Taper the adjustment linearly to zero over the next 20 m.
4. Recompute density, MLD, and OHC26 and record the adjustment in metadata.

If fewer than 12 valid pre-initialization hours exist, reject the artifact. Do
not silently fall back to event-time SST.

### Wake-free surface boundary

After initialization, an event replay must not read the evolving ERA5 SST
planes. Its undisturbed background is

```text
T_background(x, y, t) = T_pre(x, y)
                      + C_month(x, y, t) - C_month(x, y, t0)
```

where `T_pre` is the pre-initialization median and `C_month` is the linearly
interpolated monthly climatology. This preserves the slow seasonal tendency
without importing the real storm's future wake. The current event SST planes
remain available only to reproduce HF-1 and must be marked deprecated in new
metadata.

### Artifact layout

Create a separate self-describing `ocean_<event>.bin` plus
`ocean_<event>.json`; do not overload atmospheric `env_<event>.bin` semantics.
The binary uses the existing WIWB container and may mix layer grids.

The metadata must include:

- schema version, source tier, source product/version, download URL, licence,
  raw and baked SHA-256 values;
- horizontal grid, depth bounds, units, missing-data policy, analysis validity
  interval, and initialization time;
- the pre-storm SST window and valid-hour count;
- MLD method, density method, profile-adjustment method, and OHC26 integration;
- explicit flags for `wakeFreeAfterInitialization` and
  `futureOceanAssimilation = false`.

The default interactive climatology uses monthly WOA23 profiles. Event bins use
one initialization profile and a wake-free background tendency. Data fetching
stays outside the release build; committed compact artifacts keep calibration
and CI offline.

## Prognostic ocean state

### Grid and allocation

- Fixed 0.1-degree grid over 50–70 E, 15–27 N: 200 by 120 cells.
- Vertical interfaces at 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
  65, 70, 75, 80, 85, 90, 95, 100, 125, 150, 175, 200, 250, and 300 m.
- Background profiles are immutable typed arrays. Dynamic columns are allocated
  lazily only where the storm wind field reaches.
- The active search radius is at most four current outer-size radii. Wind stress
  naturally approaches zero with the existing radial wind profile; there is no
  gale-force on/off switch.

Each active column carries:

```text
T[k]       layer temperature, C
S[k]       layer salinity, PSU
u[k], v[k] layer current anomaly, m/s
h_ml       diagnosed mixed-layer depth, m
Q_mix      cumulative heat moved into the mixed layer by entrainment, J/m2
Q_restore  cumulative explicit recovery heat, J/m2
```

Current anomalies begin at zero. Temperature and salinity begin from the baked
profile. The model retains the modified vertical profile, so later mixing acts
on the water left by earlier mixing instead of rereading the initial column.

### Density and initial MLD

Use the warm-ocean linear equation of state from the reduced Price-style model:

```text
rho = rho0 * [1 - alpha * (T - T_ref) + beta * (S - S_ref)]
```

with `rho0 = 1025 kg/m3`, `alpha = 3.3e-4 C^-1`, `beta = 7.6e-4
PSU^-1`, `T_ref = 27 C`, and `S_ref = 36 PSU`. A TEOS-10 upgrade may replace
this approximation only through a new contract version.

Starting from 10 m, MLD is the first depth where density exceeds the 10 m value
by 0.03 kg/m3. If salinity is unavailable, use the first 0.2 C temperature
decrease. Clamp only to the modeled 5–300 m domain and expose every clamp in the
bake report.

### Surface wind stress

For each active column, derive the Earth-relative 10 m vector from the same
Holland/outer-core structure rendered to the user. It includes vortex
circulation, translation asymmetry, current RMW, and outer size. Thus storm
size, speed, and residence time affect the ocean through the wind history
rather than independent multipliers.

The best-track and structure wind is a one-minute maximum sustained wind.
Multiply it by the fixed WMO open-ocean factor `0.93` before applying stress so
the stress forcing represents a ten-minute mean. This is a unit/averaging-period
normalization at the forcing boundary, not a fitted ocean parameter
([WMO wind-averaging guidance](https://systemsengineeringaustralia.com.au/download/WMO_TC_Wind_Averaging_27_Aug_2010.pdf)).

```text
tau = rho_air * Cd(|U10|) * |U10| * U10
```

The drag law is the
[Large-Pond](https://journals.ametsoc.org/view/journals/phoc/11/3/1520-0485_1981_011_0324_oomfmi_2_0_co_2.xml)
moderate-wind fit with a high-wind cap:

```text
Cd = 1.2e-3                          U10 <= 11 m/s
Cd = (0.49 + 0.065 U10) * 1e-3      11 < U10 < 25 m/s
Cd = 2.115e-3                        U10 >= 25 m/s
```

It is fixed, continuous to rounding, and is not an intensity-tuning parameter.
The cap lies within the 1.3e-3–2.3e-3 hurricane-wind range reported in later
ocean-response work. High-wind saturation is required because observed
momentum flux does not keep increasing under hurricane-force winds
([Powell, Vickery, and Reinhold 2003](https://doi.org/10.1038/nature01481)).
Use fixed `rho_air = 1.15 kg/m3`, `g = 9.80665 m/s2`, `rho0 = 1025 kg/m3`,
`cp = 3990 J/(kg K)`, and `Omega = 7.2921159e-5 rad/s`.

Apply stress to the existing mixed slab:

```text
du/dt - f v = tau_x / (rho0 h_ml) - r u
dv/dt + f u = tau_y / (rho0 h_ml) - r v
f = 2 Omega sin(latitude)
```

Use an energy-neutral Coriolis rotation and then the stress and damping
increments. The damping time is 1–5 local inertial periods, anchored at 1.6.
Contract v1's 3–7 range was corrected before acceptance evaluation because it
excluded the decay rate in the published PWP reference (`ucon = 0.1 |f|`, an
e-folding time of about 1.6 inertial periods). This correction is recorded as a
protocol amendment rather than hidden as tuning.
The current vector is state, not a diagnostic shortcut. Rotating stress and
current shear should therefore produce the observed Northern Hemisphere
right-of-track preference without a hard-coded side multiplier.

### Entrainment

After momentum forcing, compare the mixed slab with the next unmixed layer:

```text
Ri_b = g h_ml (rho_below - rho_ml)
       / [rho0 |U_ml - U_below|^2]
```

If `Ri_b` is below the critical value, homogenize the mixed slab and next layer
by thickness-weighted means of `T`, `S`, `u`, and `v`. Repeat downward until
`Ri_b` is at least critical or 300 m is reached. The critical range is
0.55–0.75, anchored at 0.65. If the density profile is unstable, mix the layers
convectively. If it is stable and squared shear is below 1e-8 m2/s2, define
`Ri_b = infinity`; do not introduce a velocity floor that can create mixing.

After bulk entrainment, apply the PWP gradient Richardson rule between adjacent
layers with fixed `Ri_g = 0.25`. Partially mix an unstable pair toward marginal
stability while conserving thickness-weighted heat, salt, and momentum. This
fixed closure removes unresolved shear instability; it is not tunable.

Every homogenization must close these ledgers before explicit sources/sinks:

```text
sum(rho0 cp T dz)  heat
sum(S dz)          salt
sum(rho0 u dz)     east momentum
sum(rho0 v dz)     north momentum
```

Tolerance is relative error <= 1e-8 per mixing operation. A failure kills the
candidate in tests; it is never clipped away.

### Recovery

Momentum damping represents near-inertial energy radiation. Thermal recovery is
an explicitly diagnosed unresolved surface/lateral flux:

```text
dT[k]/dt = (T_background[k] - T[k]) / tau_restore
```

Apply it only after storm stress at that cell falls below 5 m/s for six
continuous hours. `tau_restore` is the only thermal recovery knob, bounded to
120–720 hours and initialized at 240 hours. Each increment accumulates in
`Q_restore`; a plot or export can therefore distinguish storm mixing from
parameterized recovery.

No empirical maximum-cooling clamp participates in normal evolution. The
0–8 C contract bound is a fatal invariant check, not a value to clip to.

### Atmosphere coupling order

Keep the existing fixed 15-minute tick:

1. Sample the current column temperature under the pre-tick storm center.
2. Advance track, organization, and intensity using that temperature.
3. Force ocean columns along the old-to-new track segment with the trapezoidal
   mean of the old and new storm wind structures.
4. Diagnose the updated center column for the flight tape.

This explicit ordering is deterministic and delays feedback by at most one
15-minute step. A future midpoint solver requires a new contract version.
The ocean column uses three fixed five-minute substeps inside each atmospheric
tick; the substep is fixed by the timestep-convergence gate, not fitted.

Remove `ohcMpiWeight`, `oceanDepthCoupling`, and
`COLD_WAKE_K_C_PER_H`. MPI depends on the dynamic surface temperature. The
updated profile supplies OHC26 for explanation and verification only.

## Diagnostics and flight-tape contract

Every recorded frame adds:

- initialization tier and source-valid time;
- background SST, dynamic surface SST, cooling anomaly, and MLD;
- OHC26, depth of the 26 C isotherm, and temperature immediately below MLD;
- mixed-layer current speed and direction, local inertial period, local wind
  stress, and bulk Richardson number;
- entrainment depth and heat moved this tick;
- cumulative `Q_mix` and `Q_restore`;
- active-column count and any hard-bound or missing-source flag.

The existing `sstC`, `effectiveSstC`, `ohcKjCm2`, and `coldWakeC` fields remain
for export compatibility, with these exact meanings:

```text
sstC          undisturbed wake-free background SST
effectiveSstC dynamic column surface temperature
coldWakeC     max(0, sstC - effectiveSstC)
ohcKjCm2      dynamic OHC26 from the current profile
```

The intensity budget must still close exactly. No ocean influence may live
outside the recorded surface temperature and diagnostic state.

## Verification before atmosphere tuning

### Numerical and physical invariants

Unit/property tests must prove:

- isothermal, current-free columns do not cool through entrainment;
- zero wind produces zero mixing and zero momentum;
- layer mixing conserves heat, salt, and momentum to 1e-8 relative error;
- no NaN, negative thickness, out-of-range MLD, or silent clipping occurs;
- deeper initial MLD and weaker stratification reduce cooling under otherwise
  identical forcing;
- slower motion, larger wind footprint, and longer residence increase mixing
  without separate speed/size multipliers;
- the Northern Hemisphere benchmark produces stronger right-of-track cooling;
- a second pass over an unrecovered column cannot extract the original heat
  again;
- 5-, 15-, and 30-minute integrations agree within 5% for peak cooling, MLD,
  and heat extraction; and
- serialization and replay remain byte-stable across supported platforms.

### Independent ocean benchmark

`calibration/hf2a-ocean-reference.json` was frozen before the new physics. It is
an implementation prerequisite, not a result filled in after seeing the
candidate.

The locked source is NOAA NESDIS CoastWatch's daily 0.05-degree GHRSST
Geo-polar Blended night-only foundation SST, available from September 2002 and
carrying per-pixel analysis uncertainty
([NOAA dataset metadata](https://coastwatch.noaa.gov/erddap/info/noaacwBLENDEDCsstDaily/index.html)).
The original draft named NASA MUR, but its canonical cloud data endpoint
requires Earthdata credentials. The NOAA source preserves the foundation-SST,
daily, gap-free, uncertainty-filtered contract through an auth-free official
endpoint. That makes the benchmark reproducible from a clean checkout. For each
common 0.1-degree selected pixel within 300 km of the observed track:

1. Find local best-track passage time.
2. Define pre-storm SST as the valid-pixel median from 120 to 48 hours before
   passage.
3. Score observed and modeled SST anomalies at 24 and 48 hours after passage.
4. Exclude land, missing values, and NOAA analysis uncertainty above 0.5 C.
5. Aggregate pixels to one result per storm before computing MAE, bias, skill,
   or bootstrap intervals.

Development storms are Gonu 2007, AS 2007, Phet, Keila, Nanauk, Nilofar,
Ashobaa, Mekunu, Vayu, and Hikaa. Validation storms are Mukda, Kyarr, Shaheen,
and Biparjoy. Maha and Asna remain report-only. Older cases predate the locked
NOAA product and must not be imputed.

The frozen reference drives the existing HF-1 wake with observed JTWC track and
wind on the same wake-free background. This isolates ocean response from
forecast track and wind error. HF-2A must produce positive paired skill over
that baseline for SST-anomaly MAE at both leads, improve absolute bias, retain
all valid samples, and cover at least three validation storms.

Collocated Argo profiles provide a vertical-structure diagnostic. Use official
GDAC NetCDF, prefer delayed-mode adjusted temperature and salinity, and accept
only QC flags 1 or 2
([Argo file guidance](https://argo.ucsd.edu/data/how-to-use-argo-files/)). Report
MLD MAE, 0–200 m temperature RMSE, and OHC26 MAE. Because profile coverage near
individual cyclones is unknown until the selection is frozen, Argo is not a
numerical acceptance gate in contract v1.

The NOAA SST product and GLORYS are analyses, and GLORYS assimilates SST and
profiles. This is
therefore a forecast-like, future-withheld ocean evaluation—not a claim of
fully independent raw observations. The benchmark must say so.

## Acceptance gates

### HF-2A candidate gate

A candidate is eligible to merge only when:

1. All invariant, timestep, determinism, and ocean-benchmark gates pass.
2. Validation wind skill improves relative to HF-1 at both 24 and 48 hours.
3. Absolute validation wind bias improves at both leads.
4. Pressure MAE, track MAE, and every locked 12/24/48/72-hour availability
   count regress by no more than the existing contract permits: 5% for error
   and 0% for sample availability.
5. The 30-storm catalogue checksum remains unchanged.
6. Permanent-test storms are excluded from the decision.

This gate asks HF-2A to move intensity in the correct direction. It does not
pretend that one ocean component must finish all of HF-2.

### Full HF-2 gate

HF-2 is complete only when validation wind and pressure paired skill are
strictly positive against persistence at both 24 and 48 hours, absolute bias
beats both HF-1 and persistence, track MAE regresses by at most 5%, and all
samples are retained. The test partition remains report-only.

The frozen HF-1 values copied into the JSON contract include the exact aggregate
and 24/48-hour model, persistence, bias, skill, and sample values. The contract
test verifies them against `fidelity-reference.json`; hand-edited drift fails
CI.

## Tuning discipline

Only three ocean parameters were searched in HF-2A:

- bulk Richardson critical value, 0.55–0.75;
- momentum damping, 1–5 local inertial periods; and
- thermal recovery, 120–720 hours.

The drag law, density constants, grid, depth levels, source tiers, background
construction, and atmosphere-coupling path are fixed scientific choices. They
cannot become hidden tuning knobs.

The frozen development selection is `Ri_b = 0.55`, momentum damping = one
local inertial period, and thermal recovery = 120 hours. Development SST-anomaly
MAE is 0.706457 C at 24 hours and 0.774046 C at 48 hours, versus the HF-1
reference 0.707263 C and 0.921044 C. Absolute bias falls from 0.543546 C to
0.048584 C at 24 hours and from 0.781355 C to 0.196741 C at 48 hours. The
24-hour improvement is only 0.11%, so it is recorded as fragile. The selection
manifest and validation-attempt log are machine-readable artifacts.

Tune ocean parameters against development-storm ocean metrics first. Freeze and
hash the candidate before running validation. Log every validation attempt. If
validation results guide another scientific or parameter choice, those storms
are no longer confirmatory for that choice; seal a new holdout before making a
confirmatory claim. Permanent-test behavior never selects a candidate.

## Explicit non-goals

HF-2A does not claim to resolve:

- three-dimensional ocean currents, eddies, upwelling, or horizontal advection;
- wave state, spray, rain freshening, barrier-layer evolution, or ocean fronts
  below the input analysis resolution;
- bulk latent and sensible heat flux without near-surface atmospheric moisture
  and temperature; or
- operational initialization, coupled forecast skill, or warning guidance.

These limits are preferable to a hidden proxy. The deliverable is a
heat-conserving, observable reduced-order ocean whose errors can be measured
separately from cyclone intensity.
