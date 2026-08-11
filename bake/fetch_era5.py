"""Submit the ERA5 wind + thermodynamic requests and download when ready.

Prereqs (one-time, human):
  1. ~/.cdsapirc with:
       url: https://cds.climate.copernicus.eu/api
       key: <personal access token from https://cds.climate.copernicus.eu/profile>
  2. Accept the "Licence to use Copernicus Products" once on either ERA5 dataset
     page (the API errors with the licence URL if not accepted).

Run: node bake/run-python.mjs -u bake/fetch_era5.py [target-filename ...]
CDS queues can take minutes to hours; the script blocks per request until each
file lands in data/raw/. Re-running skips files that already exist.

1) Monthly climatology 1991-2020 May-Nov:
   - winds -> steering (deep-layer mean 850/500/250) + |V200 - V850| shear;
   - 600/700-hPa relative humidity -> a real mid-level moisture field.
2) Gonu hourly event window (Jun 1-8 2007):
   - winds + mid-level humidity + event-time sea-surface temperature.
3) Shaheen hourly event window (Sep 20 - Oct 10 2021):
   - winds + mid-level humidity + event-time sea-surface temperature.

Windows are trimmed vs "whole months" to be kind to the queue; widen here if the
counterfactual ever needs more lead-in. Area/grid match env.bin: 50-70E/15-27N, 0.5 deg.
"""

from __future__ import annotations

import sys
from pathlib import Path

from netcdf_extent import valid_cached_netcdf

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
AREA = [27, 50, 15, 70]  # N, W, S, E
GRID = [0.5, 0.5]
LEVELS = ["200", "250", "500", "850"]
WINDS = ["u_component_of_wind", "v_component_of_wind"]
HUMIDITY_LEVELS = ["600", "700"]
HUMIDITY = ["relative_humidity"]
SST = ["sea_surface_temperature"]

REQUESTS: list[tuple[str, str, dict]] = [
    (
        "era5_climatology.nc",
        "reanalysis-era5-pressure-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": WINDS,
            "pressure_level": LEVELS,
            "year": [str(y) for y in range(1991, 2021)],
            "month": ["05", "06", "07", "08", "09", "10", "11"],
            "time": "00:00",
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_rh_climatology.nc",
        "reanalysis-era5-pressure-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": HUMIDITY,
            "pressure_level": HUMIDITY_LEVELS,
            "year": [str(y) for y in range(1991, 2021)],
            "month": ["05", "06", "07", "08", "09", "10", "11"],
            "time": "00:00",
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_gonu_2007.nc",
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": WINDS,
            "pressure_level": LEVELS,
            "year": "2007",
            "month": "06",
            "day": [f"{d:02d}" for d in range(1, 9)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_rh_gonu_2007.nc",
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": HUMIDITY,
            "pressure_level": HUMIDITY_LEVELS,
            "year": "2007",
            "month": "06",
            "day": [f"{d:02d}" for d in range(1, 9)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_sst_gonu_2007.nc",
        "reanalysis-era5-single-levels",
        {
            "product_type": "reanalysis",
            "variable": SST,
            "year": "2007",
            "month": "06",
            "day": [f"{d:02d}" for d in range(1, 9)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_shaheen_2021.nc",
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": WINDS,
            "pressure_level": LEVELS,
            "year": "2021",
            "month": ["09", "10"],
            "day": [f"{d:02d}" for d in range(1, 32)],  # server drops invalid dates
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_rh_shaheen_2021.nc",
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": HUMIDITY,
            "pressure_level": HUMIDITY_LEVELS,
            "year": "2021",
            "month": ["09", "10"],
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
    (
        "era5_sst_shaheen_2021.nc",
        "reanalysis-era5-single-levels",
        {
            "product_type": "reanalysis",
            "variable": SST,
            "year": "2021",
            "month": ["09", "10"],
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": [f"{h:02d}:00" for h in range(24)],
            "area": AREA,
            "grid": GRID,
            "data_format": "netcdf",
            "download_format": "unarchived",
        },
    ),
]

# Shaheen: constrain to the event window by filtering days per month.
SHAHEEN_DAYS = {
    "09": [f"{d:02d}" for d in range(20, 31)],
    "10": [f"{d:02d}" for d in range(1, 11)],
}


def select_requests(
    requests: list[tuple[str, str, dict]], names: list[str]
) -> list[tuple[str, str, dict]]:
    """Filter requests to target filenames, preserving request-list order."""
    if not names:
        return list(requests)
    known = {filename for filename, _dataset, _spec in requests}
    unknown = sorted(set(names) - known)
    if unknown:
        raise SystemExit(
            f"unknown request file(s): {', '.join(unknown)}; have {sorted(known)}"
        )
    wanted = set(names)
    return [request for request in requests if request[0] in wanted]


def main(names: list[str]) -> int:
    selected = select_requests(REQUESTS, names)

    import cdsapi

    RAW.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    failures = 0
    for filename, dataset, spec in selected:
        target = RAW / filename
        # Existence is NOT enough: no filename encodes the extent, so a stale
        # file from a previous AREA silently poisons the whole bake.
        if valid_cached_netcdf(target, AREA, GRID):
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        if target.exists():
            print(f"[refetch] {filename} does not cover {AREA} at {GRID} - replacing")
            target.unlink()
        if filename in {
            "era5_shaheen_2021.nc",
            "era5_rh_shaheen_2021.nc",
            "era5_sst_shaheen_2021.nc",
        }:
            # Two per-month windows -> two part-files merged at bake time by
            # xarray/netCDF concat; simpler: one request per month window.
            for mon, days in SHAHEEN_DAYS.items():
                stem = filename.removesuffix(".nc")
                part = RAW / f"{stem}_{mon}.nc"
                # Existence is NOT enough - see netcdf_extent.py.
                if valid_cached_netcdf(part, AREA, GRID):
                    print(f"[skip] {part.name} already present")
                    continue
                if part.exists():
                    print(f"[refetch] {part.name} does not cover {AREA} at {GRID} - replacing")
                    part.unlink()
                s = dict(spec, month=mon, day=days)
                print(f"[submit] {dataset} -> {part.name} (queue may take a while)")
                try:
                    client.retrieve(dataset, s, str(part))
                    print(f"[done] {part.name} ({part.stat().st_size / 1e6:.1f} MB)")
                except Exception as err:  # noqa: BLE001 — report and continue to next request
                    failures += 1
                    print(f"[FAIL] {part.name}: {err}", file=sys.stderr)
            continue
        print(f"[submit] {dataset} -> {filename} (queue may take a while)")
        try:
            client.retrieve(dataset, spec, str(target))
            print(f"[done] {filename} ({target.stat().st_size / 1e6:.1f} MB)")
        except Exception as err:  # noqa: BLE001
            failures += 1
            print(f"[FAIL] {filename}: {err}", file=sys.stderr)
    if failures:
        print(f"\n{failures} request(s) failed — commonest causes: licence not yet "
              "accepted on the CDS site, or a stale token in ~/.cdsapirc.", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
