# Wallah reduced-order cyclone model — HF-6 model card

## Intended use

HF-6 is an experimental Arabian Sea cyclone laboratory and forecast-companion
prototype. It supports education, sensitivity experiments, reproducible
hindcasts, and research on reduced-order tropical-cyclone behavior. It is not
an operational warning system, numerical weather-prediction replacement,
surge model, evacuation tool, or casualty/damage model. Users must follow the
responsible meteorological agency for warnings.

## Model and data

The deterministic core is a fixed-step, single-storm reduced-order model. The
HF-2/HF-3 research profile couples vortex-filtered environmental steering, a
bounded beta/terrain motion term, vector ventilation and organization memory,
coherent parametric wind-pressure-size structure, continuous coastal exposure,
and a sparse dynamic upper-ocean column. Because that profile failed its frozen
acceptance gates, the interactive sandbox retains its previously validated
shipped profile; research verification opts into the rejected candidates
explicitly. The ensemble separates initialization, forcing, parameter, and
unresolved-physics perturbations but remains labelled **perturbation
frequency**, not calibrated probability.

HF-1 used 30 frozen 1980–2024 storms. HF-6 adds an outcome-blind catalogue of
72 Arabian Sea storms and 144 initializations. The catalogue retains eight
previously unseen USA/JTWC-compatible storms for the first look at the already
frozen HF-2/HF-3 candidates. Older position-only or noncanonical-intensity cases
increase track and observation-availability coverage but cannot be silently
used as one-minute wind truth.

Atmospheric hindcasts use [ERA5 pressure-level and surface
fields](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels).
Monthly [WOA23](https://www.ncei.noaa.gov/access/world-ocean-atlas-2023/)
profiles initialize the subsurface ocean when an event-specific profile is not
available. [IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive)
is a post-analyzed verification reference, not error-free truth. The scoring
definitions follow the same broad position/intensity-error convention described
by the [NHC verification procedure](https://www.nhc.noaa.gov/verification/verify2.shtml),
while retaining this project's own fixed domain and eligibility rules. Every
large input and generated scorecard carries a SHA-256 manifest.

## Current evidence

- HF-2 implemented the intended intensity/ocean/structure physics but failed
  its frozen legacy validation gate.
- HF-3 produced positive track skill at 12/24/48 hours against its simple
  baselines, but failed its frozen bias and intensity-regression gates.
- HF-4 improved intensity CRPS on legacy validation, yet its cone overcovered
  and 48-hour mean Brier skill was negative. Probability language was not
  promoted.
- HF-5 provider normalization and immutable issuance are implemented, while a
  continuously scheduled lawful live feed is not configured.
- HF-6 broadens the catalogue and outcome audit. Its untouched 8-storm,
  16-initialization first look found positive track skill against persistence at
  12/24/48 hours (0.344/0.386/0.535), but negative 48-hour wind and pressure
  skill (-0.952/-0.721). The sealed retrospective gate is rejected. R50/R64
  observations were unavailable in this sealed cohort and are reported as
  missing rather than imputed. The prospective registry contains no matured
  future forecast, so no operational or prospective skill claim is allowed.

## Known failure modes

- Intensity can weaken or intensify with the wrong timing, especially where
  upper-ocean, inner-core, or dry-air analyses are sparse.
- Unresolved track spread is too broad in the current ensemble calibration.
- Old storms have sparse intensity, pressure, RMW, and wind-radius observations.
- The fixed 50–70 E, 15–27 N domain truncates verification at first exit.
- Reanalysis forcing is not a true archived operational forecast and can make
  hindcasts easier than prospective forecasts.
- Landfall timing inferred from coarse best-track fixes is a proxy, not a
  high-resolution coastal analysis.
- Basin calibration must not be transferred to another ocean basin without a
  separately frozen protocol and evaluation.

## Version and governance

This card describes the HF-6 contract in `calibration/hf6-contract.json` and the
runtime source hashes recorded in the versioned scorecard artifacts. Failed
gates remain visible. Thresholds may not be relaxed after results are viewed.
Any future parameter revision requires a new sealed cohort, and prospective
runs must be archived before observations arrive.
