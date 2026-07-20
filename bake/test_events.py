#!/usr/bin/env python3
"""
test_events.py — offline tests for the v1.1 event bake (tracks + event env bins).

No pytest in the bake venv; this follows the repo's standalone-assert convention
(binfmt.assert_golden_vector / spike_tracks.run): plain asserts, a main() that
runs every check and returns a nonzero exit on the first failure.

Run:  bake/.venv/bin/python bake/test_events.py

Both tests are fully offline and self-contained:
  * track extraction runs against a synthetic IBTrACS CSV fixture (header + units
    row + a handful of GONU/SHAHEEN/decoy rows) — no 28 MB download needed;
  * the event-env WIWB round-trip builds a tiny event bin from synthetic fields
    and parses it back — no .nc read needed.
"""

from __future__ import annotations

import os
import tempfile

import numpy as np

import binfmt
import era5_event
import sources

# --- synthetic IBTrACS fixture ---------------------------------------------
# Header row, a UNITS row (must be skipped), then data. Columns are a subset of
# the real file in real order-agnostic form (the loader indexes by name).
FIXTURE_CSV = """SID,SEASON,NUMBER,BASIN,NAME,ISO_TIME,LAT,LON,WMO_WIND,WMO_PRES
,Year,,,,,degrees_north,degrees_east,kts,mb
2007151N14072,2007,01,NI,GONU,2007-05-31 06:00:00,13.7,71.6,35,996
2007151N14072,2007,01,NI,GONU,2007-05-31 12:00:00,14.12345,70.98765,45,990
2007151N14072,2007,01,NI,GONU,2007-06-04 15:00:00,20.1,63.8,127,920
2007151N14072,2007,01,NI,GONU,2007-06-08 00:00:00,25.9,57.8,,
2021267N18094,2021,03,NI,GULAB:SHAHEEN-GU,2021-09-23 18:00:00,18.4,94.1,35,994
2021267N18094,2021,03,NI,GULAB:SHAHEEN-GU,2021-10-01 18:00:00,23.7,63.2,60,972
1999999N99999,1999,09,NI,GONU,1999-01-01 00:00:00,10.0,60.0,20,1000
"""


def test_load_event_tracks_synthetic() -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="") as fh:
        fh.write(FIXTURE_CSV)
        path = fh.name
    try:
        storms = sources.load_event_tracks(csv_path=path)
    finally:
        os.unlink(path)

    ids = [s["id"] for s in storms]
    assert ids == [s["id"] for s in sources.EVENT_STORMS], ids
    by_id = {s["id"]: s for s in storms}

    gonu = by_id["gonu2007"]
    assert gonu["name"] == "gonu" and gonu["year"] == 2007, gonu
    # 4 GONU-2007 fixes; the 1999 decoy (same NAME, different SEASON+SID) excluded.
    assert len(gonu["points"]) == 4, len(gonu["points"])
    p0 = gonu["points"][0]
    # ISO normalised to ...T...Z.
    assert p0["iso"] == "2007-05-31T06:00:00Z", p0["iso"]
    # lat/lon rounded to 3 dp.
    assert gonu["points"][1]["lat"] == 14.123 and gonu["points"][1]["lon"] == 70.988, gonu["points"][1]
    # intensities are ints.
    assert p0["windKt"] == 35 and p0["presMb"] == 996, p0
    # blank cells -> null.
    last = gonu["points"][-1]
    assert last["windKt"] is None and last["presMb"] is None, last
    # time-ordered.
    isos = [p["iso"] for p in gonu["points"]]
    assert isos == sorted(isos), isos

    shaheen = by_id["shaheen2021"]
    assert shaheen["name"] == "shaheen" and shaheen["year"] == 2021, shaheen
    # Exact SID match; archive display-name punctuation is irrelevant.
    assert len(shaheen["points"]) == 2, len(shaheen["points"])
    assert shaheen["points"][0]["iso"] == "2021-09-23T18:00:00Z", shaheen["points"][0]
    assert all(
        len(storm["points"]) == 0
        for storm in storms
        if storm["id"] not in {"gonu2007", "shaheen2021"}
    )
    print("PASS test_load_event_tracks_synthetic")


def test_event_bin_roundtrip() -> None:
    """Assemble a tiny event bin from synthetic fields, write, parse it back,
    and assert the WIWB contract holds: month-suffixed names, nt semantics,
    quant flags, and dequant ranges."""
    ny, nx = sources.ENV_NY, sources.ENV_NX
    nt = 5  # pretend 5 time planes
    rng = np.random.default_rng(0)
    u = rng.uniform(-12, 12, size=(nt, ny, nx))
    v = rng.uniform(-12, 12, size=(nt, ny, nx))
    shr = rng.uniform(0, 25, size=(nt, ny, nx))
    shu = rng.uniform(-20, 20, size=(nt, ny, nx))
    shv = rng.uniform(-20, 20, size=(nt, ny, nx))
    sst = np.full((nt, ny, nx), 28.0)
    rh = rng.uniform(20, 95, size=(nt, ny, nx))
    ohc = rng.uniform(0, 140, size=(nt, ny, nx))

    layers = era5_event.assemble_event_layers(
        "05", sst, u, v, shr, shu, shv, rh, ohc
    )
    with tempfile.NamedTemporaryFile("wb", suffix=".bin", delete=False) as fh:
        binfmt.write_bin(fh.name, layers)
        path = fh.name
    try:
        parsed = binfmt.parse_bin(open(path, "rb").read())
    finally:
        os.unlink(path)

    assert set(parsed) == {
        "sst_05", "u_05", "v_05", "shr_05", "shu_05", "shv_05",
        "rh_05", "ohc_05",
    }, set(parsed)
    for nm in (
        "sst_05", "u_05", "v_05", "shr_05", "shu_05", "shv_05",
        "rh_05", "ohc_05",
    ):
        L = parsed[nm]
        assert L.nt == nt, (nm, L.nt)
        assert L.quantized is True, nm
        assert L.nx == nx and L.ny == ny, (nm, L.nx, L.ny)
    # dequant round-trips within the 0.01 quant step.
    got_u = parsed["u_05"].data.reshape(nt, ny, nx)
    assert np.max(np.abs(got_u - u)) <= 0.01 + 1e-6, float(np.max(np.abs(got_u - u)))
    assert parsed["sst_05"].data.reshape(nt, ny, nx).mean() == 28.0, parsed["sst_05"].data.mean()
    print("PASS test_event_bin_roundtrip")


def main() -> int:
    test_load_event_tracks_synthetic()
    test_event_bin_roundtrip()
    print("[events] all offline tests PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
