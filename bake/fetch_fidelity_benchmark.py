"""Fetch ERA5 forcing for the 20 non-public storms in HF-1.

The ten featured storms reuse their already committed public event bins.  This
script downloads only the additional frozen cases, is safe to resume, and keeps
all large NetCDF inputs under the gitignored ``data/raw`` cache.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cdsapi
import h5py
import requests

from fetch_event_benchmark import AREA, GRID, KINDS, RAW, TIMES
from fidelity_catalog import CATALOG_PATH, event_files


RETRIES = 3
QUEUE_BACKOFF_SECONDS = 120
_thread = threading.local()
_dataset_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)


def _selected_ids(argv: list[str]) -> set[str] | None:
    if "--ids" not in argv:
        return None
    index = argv.index("--ids")
    if index + 1 >= len(argv):
        raise ValueError("--ids requires a comma-separated value")
    return {value for value in argv[index + 1].split(",") if value}


def _catalog_path(argv: list[str]) -> Path:
    if "--catalog" not in argv:
        return CATALOG_PATH
    index = argv.index("--catalog")
    if index + 1 >= len(argv):
        raise ValueError("--catalog requires a path")
    return Path(argv[index + 1])


def _client() -> cdsapi.Client:
    client = getattr(_thread, "client", None)
    if client is None:
        # cdsapi defaults to 500 retries with 120-second sleeps, which can make
        # one transient gateway error occupy a worker for hours. Bound its
        # inner HTTP loop; _download owns the visible file-level retry policy.
        client = cdsapi.Client(
            timeout=120,
            retry_max=3,
            sleep_max=10,
            session=requests.Session(),
        )
        _thread.client = client
    return client


def _valid_netcdf(
    target: Path, kind: str, expected_times: tuple[int, ...]
) -> bool:
    expected_variables = {
        "wind": {
            "valid_time",
            "pressure_level",
            "latitude",
            "longitude",
            "u",
            "v",
        },
        "rh": {
            "valid_time",
            "pressure_level",
            "latitude",
            "longitude",
            "r",
        },
        "sst": {"valid_time", "latitude", "longitude", "sst"},
    }[kind]
    north, west, south, east = AREA
    lat_step, lon_step = GRID
    expected_latitudes = [
        north - index * lat_step
        for index in range(round((north - south) / lat_step) + 1)
    ]
    expected_longitudes = [
        west + index * lon_step
        for index in range(round((east - west) / lon_step) + 1)
    ]
    try:
        with h5py.File(target, "r") as handle:
            if not expected_variables.issubset(handle.keys()):
                return False
            if tuple(map(int, handle["valid_time"][...])) != expected_times:
                return False
            if list(map(float, handle["latitude"][...])) != expected_latitudes:
                return False
            if list(map(float, handle["longitude"][...])) != expected_longitudes:
                return False
            expected_levels = {
                "wind": {200, 250, 500, 850},
                "rh": {600, 700},
                "sst": None,
            }[kind]
            return expected_levels is None or set(
                map(int, handle["pressure_level"][...])
            ) == expected_levels
    except (OSError, KeyError, ValueError):
        return False


def _expected_times(part: dict) -> tuple[int, ...]:
    return tuple(
        int(
            dt.datetime(
                part["year"],
                part["month"],
                day,
                hour,
                tzinfo=dt.timezone.utc,
            ).timestamp()
        )
        for day in part["days"]
        for hour in range(24)
    )


def _download(
    task: tuple[str, str, str, dict, Path, tuple[int, ...]]
) -> tuple[str, bool, str]:
    label, kind, dataset, request, target, expected_times = task
    # CDS limits queued jobs per dataset. Wind and humidity share the pressure-
    # level dataset, while SST uses the single-level dataset; serialize within
    # each dataset but let those two independent products progress together.
    with _dataset_locks[dataset]:
        print(
            f"[submit] {label} {kind} -> {target.name} (CDS may queue)",
            flush=True,
        )
        for attempt in range(1, RETRIES + 1):
            try:
                _client().retrieve(dataset, request, str(target))
                if not _valid_netcdf(target, kind, expected_times):
                    raise ValueError("downloaded NetCDF failed variable/time validation")
                message = (
                    f"[done] {target.name} "
                    f"({target.stat().st_size / 1e6:.1f} MB)"
                )
                print(message, flush=True)
                return target.name, True, message
            except Exception as error:  # noqa: BLE001
                if target.exists():
                    target.unlink()
                if attempt == RETRIES:
                    message = (
                        f"[FAIL] {target.name} after {RETRIES} attempts: {error}"
                    )
                    print(message, file=sys.stderr, flush=True)
                    return target.name, False, message
                print(
                    f"[retry {attempt}/{RETRIES}] {target.name}: {error}",
                    file=sys.stderr,
                    flush=True,
                )
                queue_limited = "queued requests" in str(error).lower()
                delay = (
                    QUEUE_BACKOFF_SECONDS if queue_limited else 2 * attempt
                )
                if queue_limited:
                    print(
                        f"[cooldown] {delay}s after CDS queue limit",
                        file=sys.stderr,
                        flush=True,
                    )
                time.sleep(delay)
    raise AssertionError("retry loop fell through")


def _download_group(
    tasks: list[tuple[str, str, str, dict, Path, tuple[int, ...]]],
) -> int:
    failures = 0
    for task in tasks:
        _, succeeded, _ = _download(task)
        if not succeeded:
            failures += 1
    return failures


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    wanted = _selected_ids(argv)
    document = json.loads(_catalog_path(argv).read_text())
    entries = document.get("storms", document.get("cases", []))
    storms = [
        storm
        for storm in entries
        if storm.get("publicEventId") is None
        and (wanted is None or storm["id"] in wanted)
    ]
    if wanted is not None:
        unknown = wanted - {storm["id"] for storm in storms}
        if unknown:
            raise ValueError(f"unknown/non-download fidelity ids: {sorted(unknown)}")
    RAW.mkdir(parents=True, exist_ok=True)
    tasks: list[
        tuple[str, str, str, dict, Path, tuple[int, ...]]
    ] = []
    for storm in storms:
        for kind in ("wind", "rh", "sst"):
            dataset, base = KINDS[kind]
            filenames = event_files(storm, kind)
            for part, filename in zip(
                storm["requestParts"], filenames, strict=True
            ):
                target = RAW / filename
                expected_times = _expected_times(part)
                if _valid_netcdf(target, kind, expected_times):
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
                if target.exists():
                    print(f"[repair] removing invalid cache file {filename}")
                    target.unlink()
                request = {
                    **base,
                    "year": str(part["year"]),
                    "month": f"{part['month']:02d}",
                    "day": [f"{day:02d}" for day in part["days"]],
                    "time": TIMES,
                    "area": AREA,
                    "grid": GRID,
                    "data_format": "netcdf",
                    "download_format": "unarchived",
                }
                tasks.append(
                    (
                        storm.get("label", storm.get("name", storm["id"])),
                        kind,
                        dataset,
                        request,
                        target,
                        expected_times,
                    )
                )
    print(
        f"[fidelity-fetch] {len(tasks)} files, one active request per CDS dataset",
        flush=True,
    )
    # Give each CDS dataset one dedicated sequential worker. This keeps the
    # surface stream moving while pressure-level work runs, without allowing a
    # backlog of lock-waiting pressure tasks to occupy the whole pool.
    groups: dict[
        str, list[tuple[str, str, str, dict, Path, tuple[int, ...]]]
    ] = {}
    for task in tasks:
        groups.setdefault(task[2], []).append(task)
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, len(groups))) as executor:
        futures = [executor.submit(_download_group, group) for group in groups.values()]
        for future in as_completed(futures):
            failures += future.result()
    if failures:
        print(f"{failures} ERA5 request(s) failed", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
