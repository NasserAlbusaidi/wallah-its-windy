"""Fetch 6-hourly ERA5 fields for the realism env-variance study (R1).

Prereqs: same as bake/fetch_era5.py (~/.cdsapirc + accepted CDS licence).
Run: node bake/run-python.mjs -u bake/fetch_realism_era5.py
Seasons 2019/2021/2023, May-Nov, 00/06/12/18 UTC, 50-70E/15-27N, 0.5 deg —
the same domain and grid as env.bin. Re-running skips files that already exist.
"""

from __future__ import annotations

import sys
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
AREA = [27, 50, 15, 70]  # N, W, S, E — matches bake/fetch_era5.py
GRID = [0.5, 0.5]
YEARS = ("2019", "2021", "2023")
MONTHS = ["05", "06", "07", "08", "09", "10", "11"]
DAYS = [f"{d:02d}" for d in range(1, 32)]
TIMES = ["00:00", "06:00", "12:00", "18:00"]


def requests() -> list[tuple[str, str, dict]]:
    out: list[tuple[str, str, dict]] = []
    for year in YEARS:
        out.append((
            f"era5_realism_plev_{year}.nc",
            "reanalysis-era5-pressure-levels",
            {
                "product_type": "reanalysis",
                "variable": ["u_component_of_wind", "v_component_of_wind",
                             "relative_humidity"],
                "pressure_level": ["200", "600", "700", "850"],
                "year": year, "month": MONTHS, "day": DAYS, "time": TIMES,
                "area": AREA, "grid": GRID,
                "data_format": "netcdf", "download_format": "unarchived",
            },
        ))
        out.append((
            f"era5_realism_sst_{year}.nc",
            "reanalysis-era5-single-levels",
            {
                "product_type": "reanalysis",
                "variable": ["sea_surface_temperature"],
                "year": year, "month": MONTHS, "day": DAYS, "time": TIMES,
                "area": AREA, "grid": GRID,
                "data_format": "netcdf", "download_format": "unarchived",
            },
        ))
    return out


def main() -> int:
    import cdsapi

    RAW.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    failures = 0
    for filename, dataset, spec in requests():
        target = RAW / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        print(f"[submit] {dataset} -> {filename} (queue may take a while)")
        try:
            client.retrieve(dataset, spec, str(target))
            print(f"[done] {filename} ({target.stat().st_size / 1e6:.1f} MB)")
        except Exception as err:  # noqa: BLE001 — report and continue to next request
            failures += 1
            print(f"[FAIL] {filename}: {err}", file=sys.stderr)
    if failures:
        print(f"\n{failures} request(s) failed — commonest causes: licence not yet "
              "accepted on the CDS site, or a stale token in ~/.cdsapirc.", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
