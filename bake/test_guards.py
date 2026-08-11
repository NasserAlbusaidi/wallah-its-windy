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
import netcdf_extent as netcdf_extent_module
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
        # A box LARGER than AREA, validated against today's smaller AREA.
        # The mirror image - the actual defect this task exists to close -
        # is exercised separately below.
        _write(path, 30, 45, 0, 100)
        assert valid_cached_netcdf(path, AREA, GRID) is False


def test_undersized_cache_after_area_expansion_is_not_reused() -> None:
    """The real-world defect: a file fetched for the OLD, SMALLER box is
    reused verbatim after AREA grows. `==` is symmetric so today's code
    already rejects both directions, but a future relaxation to "the cache
    contains the request, so reuse it" would silently reintroduce exactly
    this bug - only this direction would catch it."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "old_box.nc"
        _write(path, 27, 50, 15, 70)  # today's AREA, as if cached pre-expansion
        expanded_area = [30, 45, 10, 75]  # a strict superset of AREA
        assert valid_cached_netcdf(path, expanded_area, GRID) is False


def test_missing_and_empty_are_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        missing = Path(tmp) / "nope.nc"
        empty = Path(tmp) / "empty.nc"
        empty.write_bytes(b"")
        assert valid_cached_netcdf(missing, AREA, GRID) is False
        assert valid_cached_netcdf(empty, AREA, GRID) is False

        # The two asserts above pass even without the existence/size fast
        # path at netcdf_extent.py's `if not target.exists() or ...`: h5py
        # raises OSError for both a missing path and a 0-byte file, and that
        # is caught by the same except clause as a truncated file, so this
        # test would pass for the WRONG reason if the fast path were deleted
        # - duplicating test_truncated_file_is_not_reused and pinning
        # nothing unique. Make the short-circuit observable: h5py.File must
        # never even be called for a missing/empty target.
        def _must_not_open(*args: object, **kwargs: object) -> None:
            raise AssertionError("h5py.File must not be reached for a missing/empty target")

        original_file = netcdf_extent_module.h5py.File
        netcdf_extent_module.h5py.File = _must_not_open
        try:
            assert valid_cached_netcdf(missing, AREA, GRID) is False
            assert valid_cached_netcdf(empty, AREA, GRID) is False
        finally:
            netcdf_extent_module.h5py.File = original_file


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

    # NaN compares False against both the low and high bound checks, so a
    # range check ALONE lets a NaN cell through as 0 with only a
    # RuntimeWarning on the cast - the exact silent-plausible-file failure
    # this function exists to close. Must be caught before the range test.
    nan = np.array([0.0, np.nan, 1.0], dtype="float64")
    try:
        q(nan, scale, "flowacc")
    except ValueError as error:
        assert "flowacc" in str(error), str(error)
    else:
        raise AssertionError("expected a ValueError for a NaN value")


def main() -> int:
    tests = [
        test_extent_reads_the_axes,
        test_matching_cache_is_reused,
        test_stale_extent_is_not_reused,
        test_undersized_cache_after_area_expansion_is_not_reused,
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
