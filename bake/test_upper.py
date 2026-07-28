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


def main() -> int:
    tests = [
        test_parse_bin_raw_roundtrip,
        test_quantize_int16_matches_bake_contract,
    ]
    for t in tests:
        t()
        print(f"[PASS] {t.__name__}")
    print(f"[done] {len(tests)} upper-sidecar tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
