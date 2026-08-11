"""Fetch the frozen ten-storm ERA5 hindcast benchmark.

Each request is a small domain/window and is cached under ``data/raw``. Re-run
freely: existing non-empty files are skipped. CDS authentication/licence setup
is identical to ``fetch_era5.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

from netcdf_extent import valid_cached_netcdf

import cdsapi

from event_catalog import EVENTS, event_files


RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
AREA = [27, 50, 15, 70]  # north, west, south, east
GRID = [0.5, 0.5]
TIMES = [f"{hour:02d}:00" for hour in range(24)]

KINDS = {
    "wind": (
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": ["u_component_of_wind", "v_component_of_wind"],
            "pressure_level": ["200", "250", "500", "850"],
        },
    ),
    "rh": (
        "reanalysis-era5-pressure-levels",
        {
            "product_type": "reanalysis",
            "variable": ["relative_humidity"],
            "pressure_level": ["600", "700"],
        },
    ),
    "sst": (
        "reanalysis-era5-single-levels",
        {
            "product_type": "reanalysis",
            "variable": ["sea_surface_temperature"],
        },
    ),
}


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    failures = 0
    for event in EVENTS:
        for kind, filenames in (
            ("wind", event_files(event, "wind")),
            ("rh", event_files(event, "rh")),
            ("sst", event_files(event, "sst")),
        ):
            dataset, base = KINDS[kind]
            for part, filename in zip(event["parts"], filenames, strict=True):
                year, month, days, _ = part
                target = RAW / filename
                # Existence is NOT enough - see netcdf_extent.py.
                if valid_cached_netcdf(target, AREA, GRID):
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
                if target.exists():
                    print(f"[refetch] {filename} does not cover {AREA} at {GRID} - "
                          "will replace once the redownload succeeds")
                request = {
                    **base,
                    "year": str(year),
                    "month": f"{month:02d}",
                    "day": [f"{day:02d}" for day in days],
                    "time": TIMES,
                    "area": AREA,
                    "grid": GRID,
                    "data_format": "netcdf",
                    "download_format": "unarchived",
                }
                print(
                    f"[submit] {event['label']} {kind} -> {filename} "
                    "(CDS may queue)"
                )
                # Download to a temp path and only replace `target` once the
                # download has actually landed: a stale/invalid cache is a
                # possibly-wrong verdict (see netcdf_extent.py), and CDS
                # queues can take hours, so an existing file - valid or not -
                # must never be destroyed before its replacement exists.
                tmp = target.with_name(target.name + ".tmp")
                try:
                    client.retrieve(dataset, request, str(tmp))
                    tmp.replace(target)
                    print(
                        f"[done] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                except Exception as err:  # noqa: BLE001
                    failures += 1
                    print(f"[FAIL] {filename}: {err}", file=sys.stderr)
                    if tmp.exists():
                        tmp.unlink()
    if failures:
        print(f"{failures} ERA5 request(s) failed", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
