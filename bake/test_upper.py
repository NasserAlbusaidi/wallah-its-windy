#!/usr/bin/env python3
"""
test_upper.py — offline tests for the C1 upper-level wind sidecar bake.

No pytest in the bake venv; standalone-assert convention (see test_events.py).
Everything here is fully offline: synthetic WIWB blobs and injected module
state, no .nc reads, no network.

Run:  node bake/run-python.mjs bake/test_upper.py
"""

from __future__ import annotations

import numpy as np

import binfmt


def test_parse_bin_raw_roundtrip() -> None:
    domain = (50.0, 70.0, 15.0, 27.0)
    a = binfmt.Layer(
        "alpha", "int16", True, 2, 2, 2, domain, 0.01, 0.0,
        np.arange(8, dtype="<i2"),
    )
    b = binfmt.Layer(
        "beta", "uint8", False, 2, 2, 1, domain, 1.0, 0.0,
        np.array([1, 0, 1, 0], dtype="<u1"),
    )
    blob = binfmt.write_bin(None, [a, b])
    raw = binfmt.parse_bin_raw(blob)
    assert set(raw) == {"alpha", "beta"}, sorted(raw)
    assert raw["alpha"].payload == a.raw_bytes()
    assert raw["beta"].payload == b.raw_bytes()
    assert raw["alpha"].nt == 2
    assert raw["alpha"].scale == 0.01
    assert raw["beta"].quantized is False
    # The raw view and the dequantizing parser must agree on the records.
    parsed = binfmt.parse_bin(blob)
    assert parsed["alpha"].nx == raw["alpha"].nx
    assert parsed["alpha"].bbox == raw["alpha"].bbox
    # A governance gate's parser must reject truncated payloads loudly.
    try:
        binfmt.parse_bin_raw(blob[:-2])
    except ValueError:
        pass
    else:
        raise AssertionError("truncated payload must be rejected")


def test_quantize_int16_matches_bake_contract() -> None:
    # Probe rounding, negatives, and both clip rails; compare against the
    # exact expression build_env used inline before extraction.
    a = np.array([[0.0, 0.014, -0.006], [400.0, -400.0, 1.0]])
    got = binfmt.quantize_int16(a, 0.01, 0.0)
    want = np.clip(np.round((a - 0.0) / 0.01), -32768, 32767)
    want = want.astype(np.int16).ravel(order="C")
    assert got.tolist() == want.tolist()
    assert got.dtype == np.int16
    big = np.array([1e6, -1e6])
    clipped = binfmt.quantize_int16(big, 0.01, 0.0)
    assert clipped.tolist() == [32767, -32768]


def test_upper_planes_align_with_steering_picks() -> None:
    """upper_level_samples_vector must return the same years, in the same
    plane order, as steering_shear_samples_vector — the whole point of C1's
    alignment contract. Synthetic injection bypasses _load's file read."""
    import era5

    lat = np.array([0.0, 1.0, 2.0])
    lon = np.array([10.0, 11.0, 12.0, 13.0])
    ny, nx = lat.size, lon.size
    years = np.array([2001, 2002, 2003, 2004, 2005])
    n = years.size
    rng = np.random.default_rng(7)
    u_y = rng.normal(0.0, 5.0, (n, ny, nx))
    v_y = rng.normal(0.0, 5.0, (n, ny, nx))
    # All-hostile constant shear keeps the calm-year rescue inert (>= 13 m/s).
    shear_y = np.full((n, ny, nx), 20.0)
    su_y = u_y * 0.5
    sv_y = v_y * 0.5
    # Encode the year IN the field so plane order is observable.
    u200_y = np.stack([np.full((ny, nx), float(y)) for y in years])
    v200_y = -u200_y
    era5._cache = {5: None}  # non-None sentinel: _load() becomes a no-op
    era5._yearly = {5: (years, u_y, v_y, shear_y, su_y, sv_y, u200_y, v200_y)}
    era5._axes = (lat, lon)
    era5._picks = {}
    ELAT, ELON = np.meshgrid(lat, lon, indexing="ij")

    su, sv, s, ssu, ssv, steer_years = era5.steering_shear_samples_vector(
        ELAT, ELON, 5
    )
    u200, v200, upper_years = era5.upper_level_samples_vector(ELAT, ELON, 5)
    assert upper_years == steer_years, (upper_years, steer_years)
    assert u200.shape == su.shape
    assert v200.shape == sv.shape
    for k, year in enumerate(upper_years):
        assert abs(float(u200[k].mean()) - year) < 1e-6, (k, year)
        assert abs(float(v200[k].mean()) + year) < 1e-6, (k, year)
    # The pick cache is deterministic and reused.
    assert era5._month_pick_indices(5) == era5._month_pick_indices(5)


def main() -> int:
    tests = [
        test_parse_bin_raw_roundtrip,
        test_quantize_int16_matches_bake_contract,
        test_upper_planes_align_with_steering_picks,
    ]
    for t in tests:
        t()
        print(f"[PASS] {t.__name__}")
    print(f"[done] {len(tests)} upper-sidecar tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
