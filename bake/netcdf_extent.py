#!/usr/bin/env python3
"""
netcdf_extent.py — is a cached raw ERA5 download actually the box we want?

Every fetcher used to skip a download on existence and non-zero size alone, and
no filename encodes the extent. After AREA changes, every stale file in
data/raw is silently reused and the bake produces a correctly shaped,
completely wrong basin. This is the check that makes that impossible.

The axis reconstruction mirrors fetch_fidelity_benchmark.py:88-96, which has
carried this pattern since the fidelity benchmark shipped.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np


def netcdf_extent(target: Path) -> tuple[float, float, float, float]:
    """(north, west, south, east) of a downloaded ERA5 NetCDF, from its axes."""
    with h5py.File(target, "r") as handle:
        lat = np.asarray(handle["latitude"][...], dtype="float64")
        lon = np.asarray(handle["longitude"][...], dtype="float64")
    return (float(lat.max()), float(lon.min()), float(lat.min()), float(lon.max()))


def valid_cached_netcdf(
    target: Path,
    area: list[float] | tuple[float, float, float, float],
    grid: list[float] | tuple[float, float],
) -> bool:
    """True only when `target` exists AND its axes match `area`/`grid` exactly.

    `area` is CDS order: north, west, south, east. Any read failure is a False,
    never an exception: a half-written or truncated cache must be refetched, not
    crash the run.
    """
    if not target.exists() or target.stat().st_size == 0:
        return False
    north, west, south, east = (float(v) for v in area)
    lat_step, lon_step = (float(v) for v in grid)
    expected_lat = [
        north - index * lat_step
        for index in range(round((north - south) / lat_step) + 1)
    ]
    expected_lon = [
        west + index * lon_step
        for index in range(round((east - west) / lon_step) + 1)
    ]
    try:
        with h5py.File(target, "r") as handle:
            if "latitude" not in handle or "longitude" not in handle:
                return False
            lat = [float(v) for v in handle["latitude"][...]]
            lon = [float(v) for v in handle["longitude"][...]]
    except (OSError, KeyError, ValueError):
        return False
    # Latitude order is NOT guaranteed: era5_event.py's own reader tolerates
    # either native order (`flip = lat_native[0] > lat_native[-1]`). Comparing
    # sorted axes accepts either order without weakening the check - the
    # VALUES must still match exactly, just not a specific direction.
    return sorted(lat) == sorted(expected_lat) and lon == expected_lon
