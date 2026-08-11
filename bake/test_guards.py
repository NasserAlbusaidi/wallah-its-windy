#!/usr/bin/env python3
"""
test_guards.py — offline tests for the bake's silent-failure guards.

No pytest in the bake venv; standalone-assert convention (see test_events.py).
Fully offline: synthetic arrays and a temporary HDF5 file, no .nc reads from
data/raw, no network.

Run:  node bake/run-python.mjs bake/test_guards.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import h5py
import numpy as np

import bake as bake_module
from netcdf_extent import netcdf_extent, valid_cached_netcdf

AREA = [27, 50, 15, 70]  # north, west, south, east
GRID = [0.5, 0.5]


def _write(path: Path, north: float, west: float, south: float, east: float) -> None:
    lat = np.arange(north, south - 1e-9, -GRID[0], dtype="float64")
    lon = np.arange(west, east + 1e-9, GRID[1], dtype="float64")
    with h5py.File(path, "w") as handle:
        handle.create_dataset("latitude", data=lat)
        handle.create_dataset("longitude", data=lon)


def test_extent_reads_the_axes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ok.nc"
        _write(path, 27, 50, 15, 70)
        assert netcdf_extent(path) == (27.0, 50.0, 15.0, 70.0), netcdf_extent(path)


def test_matching_cache_is_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ok.nc"
        _write(path, 27, 50, 15, 70)
        assert valid_cached_netcdf(path, AREA, GRID) is True


def test_stale_extent_is_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "stale.nc"
        _write(path, 30, 45, 0, 100)  # the post-expansion box in an old-box filename
        assert valid_cached_netcdf(path, AREA, GRID) is False


def test_missing_and_empty_are_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        missing = Path(tmp) / "nope.nc"
        assert valid_cached_netcdf(missing, AREA, GRID) is False
        empty = Path(tmp) / "empty.nc"
        empty.write_bytes(b"")
        assert valid_cached_netcdf(empty, AREA, GRID) is False


def test_truncated_file_is_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "junk.nc"
        path.write_bytes(b"not an hdf5 file at all")
        assert valid_cached_netcdf(path, AREA, GRID) is False


def test_quantization_raises_instead_of_saturating() -> None:
    q = bake_module.quantize_u16
    scale = 1e-4
    ok = np.array([0.0, 5.3749], dtype="float64")
    assert q(ok, scale, "flowacc").max() == 53749

    over = np.array([0.0, 6.6], dtype="float64")
    try:
        q(over, scale, "flowacc")
    except ValueError as error:
        assert "flowacc" in str(error), str(error)
        assert "65535" in str(error), str(error)
    else:
        raise AssertionError("expected a ValueError for an out-of-range value")

    under = np.array([-1.0, 1.0], dtype="float64")
    try:
        q(under, scale, "flowacc")
    except ValueError as error:
        assert "flowacc" in str(error), str(error)
    else:
        raise AssertionError("expected a ValueError for a negative value")


def main() -> int:
    tests = [
        test_extent_reads_the_axes,
        test_matching_cache_is_reused,
        test_stale_extent_is_not_reused,
        test_missing_and_empty_are_not_reused,
        test_truncated_file_is_not_reused,
        test_quantization_raises_instead_of_saturating,
    ]
    for t in tests:
        t()
        print(f"[PASS] {t.__name__}")
    print(f"[done] {len(tests)} guard tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
