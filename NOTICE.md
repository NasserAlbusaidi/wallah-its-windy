# NOTICE — what the MIT license does and does not cover

The **code** in this repository is MIT-licensed (see `LICENSE`). The **data,
imagery, and font** it ships or fetches carry their own providers' terms,
which the MIT license does not override. If you redistribute the baked
`public/data/` artifacts or observed imagery, the source attributions below
travel with them.

Authoritative per-source detail (URLs, exact products, citations) lives in
`bake/README.md` § "Sources & licenses". This file is the summary.

## Baked data shipped in `public/data/`

| Source | Used for | Terms |
|---|---|---|
| GMRT GridServer | `terrain.bin` bathymetry + topography | Free with attribution; cite Ryan et al. (2009), *Geochem. Geophys. Geosyst.* 10, Q03014 |
| NOAA OISST v2 climatology | `env.bin` SST | U.S. Government work, public domain (NOAA PSL) |
| ERA5 (Copernicus/C3S) | `env.bin` steering, shear, humidity; `upper.bin` 200-hPa winds; event windows | Copernicus licence. Contains modified Copernicus Climate Change Service information (2026); neither the European Commission nor ECMWF is responsible for any use of it |
| NOAA World Ocean Atlas 2023 | `env.bin` OHC26 | U.S. Government work, public domain |
| IBTrACS v04r01 | `genesis.json`, `tracks.json`, storm catalogues | Public domain; cite Knapp et al. (2010) and Gahtan et al. (2024) |
| HydroSHEDS v1.1 | `flowacc.bin` hydrography | © WWF, used under the HydroSHEDS licence; cite Lehner, Verdin & Jarvis (2008), *Eos* 89(10) |

## Observed imagery and live inputs (fetched at runtime or by the monitor)

- **RainViewer** — observed radar pixels and coverage masks, requested under
  RainViewer's public weather-maps API terms; the UI always retains visible
  attribution.
- **EUMETSAT (EUMETView)** — observed satellite frames, © EUMETSAT; each frame's
  provider, source URL, and acquisition timestamp are recorded in
  `public/data/satellite/manifest.json`.
- **MOSDAC / INSAT (ISRO)** — optional registered-access satellite inputs,
  under MOSDAC's terms; same per-frame manifest provenance.
- **NOAA/NCEP GFS (NOMADS), NOAA CoastWatch OISST ERDDAP, RTOFS** — scheduled
  public-source monitor inputs; U.S. Government works. **RSMC New Delhi** is
  linked as the official regional advisory source, never republished as ours.

## Font

- **IBM Plex Mono** (bundled woff2 subsets) — SIL Open Font License 1.1.

## Products derived from these data

Simulated products (rain radar, satellite infrared, storm names) are labeled
simulated in the UI and are not observations. Nothing in this repository is
official forecast guidance.
