#!/usr/bin/env python3
"""bake_upper_winds.py — 200-hPa wind sidecar, plane-aligned to env.bin (C1).

Writes public/data/upper.bin (u200_MM / v200_MM, nt = K synoptic real-year
planes) and public/data/upper.json (per-month plane->year metadata plus the
sha256 of the env.bin the alignment was proven against).

REFUSES to write unless every year-picked env.bin layer (u/v/shr/shu/shv/rh
x 7 months) reconstructs BYTE-IDENTICALLY from the current raw ERA5 downloads.
env.bin's sample years were never persisted; byte reconstruction is the only
proof that sidecar plane N carries the same year as env.bin plane N. A gate
failure means the fresh CDS download no longer reproduces the frozen bake —
a governance decision, not a bake-time warning: STOP, do not rebake env.bin,
see bake/README.md.

Run:   node bake/run-python.mjs bake/bake_upper_winds.py
Check: node bake/run-python.mjs bake/bake_upper_winds.py --check
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

import binfmt
import era5
import era5_humidity
import sources
from binfmt import Layer

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "data")
ENV_BIN = os.path.join(OUT_DIR, "env.bin")
UPPER_BIN = os.path.join(OUT_DIR, "upper.bin")
UPPER_JSON = os.path.join(OUT_DIR, "upper.json")
DOMAIN = sources.DOMAIN
QUANT_SCALE = 0.01
VERIFY_FIELDS = ("u", "v", "shr", "shu", "shv", "rh")


def reconstruct_env_wind_payloads(
    elat: np.ndarray, elon: np.ndarray
) -> dict[str, bytes]:
    """Re-derive every year-picked env.bin layer from raw ERA5, quantized
    exactly as bake.py wrote them (same code paths, same shared quantizer)."""
    out: dict[str, bytes] = {}
    for m in sources.SEASON_MONTHS:
        u, v, shr, shu, shv, years = era5.steering_shear_samples_vector(
            elat, elon, m
        )
        rh = era5_humidity.samples_for_years(elat, elon, m, years)
        mm = f"{m:02d}"
        for name, field in (
            ("u", u),
            ("v", v),
            ("shr", shr),
            ("shu", shu),
            ("shv", shv),
            ("rh", rh),
        ):
            out[f"{name}_{mm}"] = binfmt.quantize_int16(
                field, QUANT_SCALE, 0.0
            ).tobytes()
    return out


def expected_layer_names() -> set[str]:
    """Return the exact 42 year-picked env.bin layers the gate must cover."""
    return {
        f"{field}_{month:02d}"
        for field in VERIFY_FIELDS
        for month in sources.SEASON_MONTHS
    }


def verify_alignment(
    env_blob: bytes,
    candidate: dict[str, bytes],
    nx: int,
    ny: int,
    bbox: tuple[float, float, float, float],
) -> list[str]:
    """Byte-compare reconstructed payloads and validate their header semantics.

    Equal raw integers under a different dtype, quantizer, or grid are not a
    valid reconstruction. An empty return value means the gate passed.
    """
    committed = binfmt.parse_bin_raw(env_blob)
    problems: list[str] = []
    for name, payload in sorted(candidate.items()):
        layer = committed.get(name)
        if layer is None:
            problems.append(f"{name}: missing from committed env.bin")
            continue
        if (layer.dtype, layer.quantized, layer.nx, layer.ny) != (
            0,
            True,
            nx,
            ny,
        ):
            problems.append(
                f"{name}: committed header dtype/quant/grid "
                f"({layer.dtype},{layer.quantized},{layer.nx}x{layer.ny}) "
                f"!= int16/quantized/{nx}x{ny}"
            )
            continue
        if (layer.scale, layer.offset) != (QUANT_SCALE, 0.0):
            problems.append(
                f"{name}: committed scale/offset {layer.scale}/{layer.offset} "
                f"!= {QUANT_SCALE}/0.0"
            )
            continue
        if layer.bbox != tuple(bbox):
            problems.append(f"{name}: committed bbox {layer.bbox} != {tuple(bbox)}")
            continue
        if len(payload) != layer.nt * ny * nx * 2:
            problems.append(
                f"{name}: reconstructed "
                f"{len(payload) // max(1, ny * nx * 2)} planes "
                f"!= committed nt {layer.nt}"
            )
            continue
        if layer.payload == payload:
            continue
        a = np.frombuffer(layer.payload, dtype="<i2")
        b = np.frombuffer(payload, dtype="<i2")
        delta = np.abs(a.astype(np.int32) - b.astype(np.int32))
        problems.append(
            f"{name}: {int((delta > 0).sum())}/{a.size} raw values differ "
            f"(max LSB delta {int(delta.max())})"
        )
    return problems


def build_sidecar(
    elat: np.ndarray, elon: np.ndarray
) -> tuple[list[Layer], dict[str, dict]]:
    """Build u200_MM/v200_MM layers plus plane-to-year metadata."""
    ny, nx = elat.shape
    layers: list[Layer] = []
    months: dict[str, dict] = {}
    for m in sources.SEASON_MONTHS:
        u200, v200, years = era5.upper_level_samples_vector(elat, elon, m)
        nt = u200.shape[0]
        mm = f"{m:02d}"
        months[mm] = {"nt": nt, "years": years}
        layers.append(
            Layer(
                f"u200_{mm}",
                "int16",
                True,
                nx,
                ny,
                nt,
                DOMAIN,
                QUANT_SCALE,
                0.0,
                binfmt.quantize_int16(u200, QUANT_SCALE, 0.0),
            )
        )
        layers.append(
            Layer(
                f"v200_{mm}",
                "int16",
                True,
                nx,
                ny,
                nt,
                DOMAIN,
                QUANT_SCALE,
                0.0,
                binfmt.quantize_int16(v200, QUANT_SCALE, 0.0),
            )
        )
    return layers, months


def build_metadata(months: dict[str, dict], env_sha256: str) -> dict:
    """Return deterministic metadata for the upper-wind sidecar."""
    return {
        "version": 1,
        "bin": "data/upper.bin",
        "fields": ["u200", "v200"],
        "quant": {"dtype": "int16", "scale": QUANT_SCALE, "offset": 0.0},
        "grid": {
            "nx": sources.ENV_NX,
            "ny": sources.ENV_NY,
            "bbox": list(DOMAIN),
        },
        "ntSemantics": "synoptic-plane",
        "months": months,
        "alignment": {
            "envBin": "data/env.bin",
            "envBinSha256": env_sha256,
            "verifiedLayers": sorted(expected_layer_names()),
        },
        "source": (
            "ERA5 monthly-mean pressure-level winds 1991-2020 "
            "(reanalysis-era5-pressure-levels-monthly-means), 200 hPa u/v; "
            "the same CDS request that feeds env.bin (bake/fetch_era5.py)"
        ),
    }


def main(argv: list[str]) -> int:
    unknown = [arg for arg in argv if arg != "--check"]
    if unknown:
        print(
            f"[FAIL] unknown argument(s): {' '.join(unknown)} (only --check exists)",
            file=sys.stderr,
        )
        return 1
    check = "--check" in argv
    if not era5.available():
        print(
            "[FAIL] data/raw/era5_climatology.nc missing; run bake/fetch_era5.py",
            file=sys.stderr,
        )
        return 1
    if not era5_humidity.available():
        print(
            "[FAIL] data/raw/era5_rh_climatology.nc missing; "
            "run bake/fetch_era5.py",
            file=sys.stderr,
        )
        return 1

    print("[assert] " + binfmt.assert_golden_vector())
    with open(ENV_BIN, "rb") as fh:
        env_blob = fh.read()
    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")

    print("[gate] reconstructing env.bin year-picked planes from raw ERA5 ...")
    candidate = reconstruct_env_wind_payloads(ELAT, ELON)
    expected = expected_layer_names()
    if set(candidate) != expected:
        missing = sorted(expected - set(candidate))
        extra = sorted(set(candidate) - expected)
        print(
            "[FAIL] gate bug (not data drift): reconstructed layer set != "
            f"the expected 42 (missing {missing}, extra {extra})",
            file=sys.stderr,
        )
        return 1
    problems = verify_alignment(
        env_blob, candidate, sources.ENV_NX, sources.ENV_NY, DOMAIN
    )
    if problems:
        print(
            "[FAIL] fresh ERA5 raw no longer reproduces the committed env.bin:",
            file=sys.stderr,
        )
        for problem in problems:
            print("  " + problem, file=sys.stderr)
        print(
            "  REFUSING to write the sidecar. env.bin is frozen: do NOT rebake",
            file=sys.stderr,
        )
        print(
            "  it to make this pass — escalate (bake/README.md, upper sidecar).",
            file=sys.stderr,
        )
        return 1
    print(f"[gate] PASS — all {len(candidate)} year-picked layers byte-identical")

    layers, months = build_sidecar(ELAT, ELON)
    meta = build_metadata(months, hashlib.sha256(env_blob).hexdigest())
    blob = binfmt.write_bin(None, layers)
    meta_bytes = (json.dumps(meta, indent=2, sort_keys=True) + "\n").encode("utf-8")

    if check:
        if not (os.path.exists(UPPER_BIN) and os.path.exists(UPPER_JSON)):
            print(
                "[FAIL] --check: committed upper.bin/upper.json not found; "
                "run npm run data:upper first",
                file=sys.stderr,
            )
            return 1
        with open(UPPER_BIN, "rb") as fh:
            committed_bin = fh.read()
        with open(UPPER_JSON, "rb") as fh:
            committed_json = fh.read()
        if committed_bin != blob or committed_json != meta_bytes:
            print(
                "[FAIL] committed upper.bin/upper.json do not match recomputation",
                file=sys.stderr,
            )
            return 1
        print("[check] upper.bin + upper.json reproduce byte-identically")
        return 0

    # Each replace is atomic, so neither file can be torn. The pair is not
    # atomic; checks and the asset manifest reject a kill between replacements.
    tmp_bin, tmp_json = UPPER_BIN + ".tmp", UPPER_JSON + ".tmp"
    with open(tmp_bin, "wb") as fh:
        fh.write(blob)
    with open(tmp_json, "wb") as fh:
        fh.write(meta_bytes)
    os.replace(tmp_bin, UPPER_BIN)
    os.replace(tmp_json, UPPER_JSON)
    for mm, info in sorted(months.items()):
        print(f"      month {mm}: years {info['years']}")
    print(f"[done] upper.bin ({len(blob) / 1e3:.1f} kB) + upper.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
