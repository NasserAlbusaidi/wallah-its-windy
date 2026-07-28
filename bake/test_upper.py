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
    # Governance parsing must reject invalid header enum values explicitly.
    invalid_dtype = bytearray(blob)
    invalid_dtype[16] = 255
    try:
        binfmt.parse_bin_raw(bytes(invalid_dtype))
    except ValueError as err:
        assert "dtype" in str(err), err
    else:
        raise AssertionError("unknown dtype code must be rejected")
    invalid_quant = bytearray(blob)
    invalid_quant[17] = 2
    try:
        binfmt.parse_bin_raw(bytes(invalid_quant))
    except ValueError as err:
        assert "quant" in str(err), err
    else:
        raise AssertionError("invalid quant flag must be rejected")


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


def test_verify_alignment_pass_flip_missing_and_headers() -> None:
    import bake_upper_winds as upper

    domain = (50.0, 70.0, 15.0, 27.0)
    field = np.array(
        [[[1.0, 2.0], [3.0, 4.0]], [[5.0, 6.0], [7.0, 8.0]]]
    )
    payload = binfmt.quantize_int16(field, 0.01, 0.0)
    layers = [
        binfmt.Layer(
            "u_04", "int16", True, 2, 2, 2, domain, 0.01, 0.0, payload
        )
    ]
    blob = binfmt.write_bin(None, layers)
    ok = upper.verify_alignment(blob, {"u_04": payload.tobytes()}, 2, 2, domain)
    assert ok == [], ok
    flipped = np.array(payload, copy=True)
    flipped[0] += 1  # one LSB — the drift class the gate exists to catch
    problems = upper.verify_alignment(
        blob, {"u_04": flipped.tobytes()}, 2, 2, domain
    )
    assert len(problems) == 1 and problems[0].startswith("u_04:"), problems
    assert "max LSB delta 1" in problems[0], problems
    missing = upper.verify_alignment(
        blob, {"u_05": payload.tobytes()}, 2, 2, domain
    )
    assert missing and "missing" in missing[0], missing
    # Equal bytes under wrong header semantics must not pass.
    wrong_scale = [
        binfmt.Layer(
            "u_04", "int16", True, 2, 2, 2, domain, 0.02, 0.0, payload
        )
    ]
    hdr = upper.verify_alignment(
        binfmt.write_bin(None, wrong_scale),
        {"u_04": payload.tobytes()},
        2,
        2,
        domain,
    )
    assert hdr and "scale/offset" in hdr[0], hdr
    short = upper.verify_alignment(
        blob, {"u_04": payload.tobytes()[: 2 * 2 * 2]}, 2, 2, domain
    )
    assert short and "planes" in short[0], short


def test_expected_layer_names_cover_all_year_picked_layers() -> None:
    import bake_upper_winds as upper

    names = upper.expected_layer_names()
    assert len(names) == 42, len(names)
    assert "u_04" in names and "rh_10" in names and "shv_07" in names


def test_build_sidecar_writes_aligned_layers() -> None:
    """The sidecar's planes and surfaced year lists must stay aligned."""
    import bake_upper_winds as upper
    import era5
    import era5_humidity
    import sources

    lat = np.array([0.0, 1.0, 2.0])
    lon = np.array([10.0, 11.0, 12.0, 13.0])
    ny, nx = lat.size, lon.size
    years = np.array([2001, 2002, 2003, 2004, 2005])
    n = years.size
    rng = np.random.default_rng(11)
    u_y = rng.normal(0.0, 5.0, (n, ny, nx))
    shear_y = np.full((n, ny, nx), 20.0)
    # Encode year-2000 so scale-0.01 int16 quantization does not saturate.
    u200_y = np.stack(
        [np.full((ny, nx), float(year - 2000)) for year in years]
    )
    month_state = (
        years,
        u_y,
        u_y * 0.9,
        shear_y,
        u_y * 0.5,
        u_y * 0.4,
        u200_y,
        -u200_y,
    )
    era5._cache = {month: None for month in sources.SEASON_MONTHS}
    era5._yearly = {month: month_state for month in sources.SEASON_MONTHS}
    era5._axes = (lat, lon)
    era5._picks = {}
    # October's (0-indexed November) rescue imports humidity; inject its state.
    era5_humidity._yearly = {
        10: (
            years,
            np.stack(
                [np.full((ny, nx), 50.0 + index) for index in range(n)]
            ),
        )
    }
    era5_humidity._axes = (lat, lon)
    ELAT, ELON = np.meshgrid(lat, lon, indexing="ij")

    layers, months = upper.build_sidecar(ELAT, ELON)
    assert len(layers) == 2 * len(sources.SEASON_MONTHS)
    names = [layer.name for layer in layers]
    assert "u200_04" in names and "v200_10" in names, names
    for layer in layers:
        assert (
            layer.dtype == "int16"
            and layer.scale == 0.01
            and layer.offset == 0.0
        )
        assert layer.nt == len(months[layer.name[-2:]]["years"])
        assert layer.nx == nx and layer.ny == ny
    blob = binfmt.write_bin(None, layers)
    parsed = binfmt.parse_bin(blob)
    got = parsed["u200_04"].data[: nx * ny]
    want = float(months["04"]["years"][0] - 2000)
    assert abs(float(np.asarray(got).mean()) - want) < 0.02, (got[:4], want)


def test_fetch_select_requests() -> None:
    import fetch_era5

    subset = fetch_era5.select_requests(
        fetch_era5.REQUESTS, ["era5_climatology.nc"]
    )
    assert [request[0] for request in subset] == ["era5_climatology.nc"]
    everything = fetch_era5.select_requests(fetch_era5.REQUESTS, [])
    assert len(everything) == len(fetch_era5.REQUESTS)
    try:
        # main() must validate before importing/instantiating cdsapi, so this
        # stays offline and credential-independent.
        fetch_era5.main(["nope.nc"])
    except SystemExit:
        pass
    else:
        raise AssertionError("unknown filename must be rejected loudly")


def main() -> int:
    tests = [
        test_parse_bin_raw_roundtrip,
        test_quantize_int16_matches_bake_contract,
        test_upper_planes_align_with_steering_picks,
        test_verify_alignment_pass_flip_missing_and_headers,
        test_expected_layer_names_cover_all_year_picked_layers,
        test_build_sidecar_writes_aligned_layers,
        test_fetch_select_requests,
    ]
    for t in tests:
        t()
        print(f"[PASS] {t.__name__}")
    print(f"[done] {len(tests)} upper-sidecar tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
