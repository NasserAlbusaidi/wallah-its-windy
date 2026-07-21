# HF-5 live forecast companion contract

HF-5 establishes a provider-neutral, immutable boundary between operational
weather products and the simulation core. It does **not** turn Wallah into an
operational warning system. A continuously scheduled production provider is not
configured in this repository.

## Cycle and advisory integrity

One run is initialized from one agency-consistent advisory snapshot. Position,
motion, maximum wind, pressure, RMW, wind radii, and organization share the same
provider, cycle, analysis time, and advisory identifier. The boundary converts
speed, pressure, and distance units while retaining every source value and its
wind averaging period. A provider must supply a pinned, versioned wind-period
conversion policy; the core does not guess one.

Every atmospheric grid, SST, upper-ocean, and optional satellite product carries
its provider, source URL, valid and fetch time, licence snapshot, byte count,
SHA-256, compatibility decision, and freshness limit. Missing, partial, stale,
future-dated, incompatible, or cycle-mismatched required inputs disable live
forecast output. The only fallback is labelled “climatology sandbox — live
inputs unavailable; not a current forecast.”

## Immutable issuance

`bake/live_archive.mjs` validates and publishes a canonical JSON run under its
analysis date, provider, cycle, storm, and model version. Publication uses an
atomic, non-overwriting filesystem link. Replaying identical bytes is
idempotent; attempting to change an already issued run fails. Archives contain
official, persistence, and experimental-model guidance as separately labelled
tracks so later verification cannot rewrite history.

## Provider seam

`LiveProviderAdapter` separates acquisition from normalization. A provider
adapter fetches a cycle and returns a raw advisory, input manifests, and official
guidance. `live-data.ts` owns normalization and rejection. This makes it possible
to use [RSMC New Delhi advisories](https://rsmcnewdelhi.imd.gov.in/bulletins-products-cwd.php),
[NCEP GFS grids](https://www.nco.ncep.noaa.gov/pmb/products/gfs/),
[NOAA near-real-time GeoSST](https://www.ospo.noaa.gov/products/ocean/sst/geo-sst/),
and [NOAA ocean-heat-content products](https://www.aoml.noaa.gov/phod/cyclone/index.php),
or another lawful source without teaching the physics engine provider-specific
URLs or formats.

The next operational step is external to the scientific core: configure a
scheduler and lawful provider endpoints, pin their licence/retention terms, and
archive every cycle before observations arrive. Until that is running and HF-6
has accumulated prospective cases, the UI must retain “experimental forecast
companion” language.
