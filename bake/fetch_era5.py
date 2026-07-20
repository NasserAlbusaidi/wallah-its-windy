"""Submit the three ERA5 requests (design step 0) and download when ready.

Prereqs (one-time, human):
  1. ~/.cdsapirc with:
       url: https://cds.climate.copernicus.eu/api
       key: <personal access token from https://cds.climate.copernicus.eu/profile>
  2. Accept the "Licence to use Copernicus Products" once on either ERA5 dataset
     page (the API errors with the licence URL if not accepted).

Run: bake/.venv/bin/python bake/fetch_era5.py
CDS queues can take minutes to hours; the script blocks per request until each
file lands in data/raw/. Re-running skips files that already exist.

1) Monthly climatology 1991-2020 May-Nov -> steering (deep-layer mean 850/500/250)
   + shear (|V200 - V850|). Feeds bake.py's swap of synth.steering_shear().
2) Gonu hourly event window (Jun 1-8 2007)          -> v1.1 counterfactual env.
3) Shaheen hourly event window (Sep 20 - Oct 10 2021, covers the Arabian Sea
   re-formation of Gulab's remnant through dissipation) -> v1.1 counterfactual env.

Windows are trimmed vs "whole months" to be kind to the queue; widen here if the
counterfactual ever needs more lead-in. Area/grid match env.bin: 50-70E/15-27N, 0.5 deg.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cdsapi

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
AREA = [27, 50, 15, 70]  # N, W, S, E
GRID = [0.5, 0.5]
LEVELS = ["200", "250", "500", "850"]
WINDS = ["u_component_of_wind", "v_component_of_wind"]

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
]

# Shaheen: constrain to the event window by filtering days per month.
SHAHEEN_DAYS = {
    "09": [f"{d:02d}" for d in range(20, 31)],
    "10": [f"{d:02d}" for d in range(1, 11)],
}


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    failures = 0
    for filename, dataset, spec in REQUESTS:
        target = RAW / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        if filename == "era5_shaheen_2021.nc":
            # Two per-month windows -> two part-files merged at bake time by
            # xarray/netCDF concat; simpler: one request per month window.
            for mon, days in SHAHEEN_DAYS.items():
                part = RAW / f"era5_shaheen_2021_{mon}.nc"
                if part.exists() and part.stat().st_size > 0:
                    print(f"[skip] {part.name} already present")
                    continue
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
    raise SystemExit(main())
