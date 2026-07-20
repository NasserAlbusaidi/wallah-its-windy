#!/usr/bin/env python3
"""
bake.py — build the baked map data for "Wallah It's Windy".

Produces four files the browser loads (BINARY-FORMATS.md is the contract):
  public/data/terrain.bin   elevation (int16 m) + land mask, ~2 km grid
  public/data/env.bin       SST (REAL) + steering u/v + shear (SYNTHETIC), 0.5 deg,
                            per-(field,month) layers for May..Nov
  public/data/flowacc.bin   log flow accumulation + basin-ID on the terrain grid
  public/data/genesis.json  IBTrACS first-fix points of storms that reached Oman

Run:  bake/.venv/bin/python bake/bake.py
Reproduction, sources, licenses, and the ERA5 / HydroSHEDS drop-in TODOs are in
bake/README.md. Zero-auth sources; raw downloads cache under data/raw/.

env.bin LAYER NAMING (consumed by the EnvSampler): one layer per field per month,
each nt=1 for v1.0 climatology. Names: "sst_MM", "u_MM", "v_MM", "shr_MM" where MM
is the 0-indexed calendar month zero-padded (May=04 .. Nov=10). month and the
timestep axis (nt) are ORTHOGONAL: monthIndex picks the layer, tFrac interpolates
along that layer's nt (=1 now; a v1.1 event file grows nt to hourly steps).
"""

from __future__ import annotations

import json
import os

import numpy as np

import binfmt
import era5
import hydro
import sources
import synth
from binfmt import Layer

# Steering/shear source: real ERA5 climatology when its download exists, else the
# labeled synthetic fallback. Both expose steering_shear/banner/TAG/IS_SYNTHETIC.
ENV_SRC = era5 if era5.available() else synth

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "data")
DOMAIN = sources.DOMAIN  # (lonMin, lonMax, latMin, latMax)


def _mb(path: str) -> str:
    return f"{os.path.getsize(path)/1e6:.2f} MB"


def build_terrain() -> str:
    print("[1/4] terrain.bin  (GMRT bathymetry+topo -> 2 km grid)")
    elev, landmask = sources.load_terrain()
    ny, nx = elev.shape
    layers = [
        Layer("elev", "int16", False, nx, ny, 1, DOMAIN, 1.0, 0.0, elev.ravel(order="C")),
        Layer("landmask", "uint8", False, nx, ny, 1, DOMAIN, 1.0, 0.0, landmask.ravel(order="C")),
    ]
    path = os.path.join(OUT_DIR, "terrain.bin")
    binfmt.write_bin(path, layers)
    print(
        f"      grid {nx}x{ny}={nx*ny} cells | elev {int(elev.min())}..{int(elev.max())} m "
        f"| land {landmask.mean()*100:.1f}% | {_mb(path)}"
    )
    return path


def build_env() -> str:
    print(f"[2/4] env.bin  (OISST SST [REAL] + steering/shear [{ENV_SRC.TAG}], 0.5 deg)")
    sst_by_month = sources.load_sst_by_month()
    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")  # [ny,nx], row0=north
    nx, ny = sources.ENV_NX, sources.ENV_NY

    def q_i16(a: np.ndarray, scale: float, offset: float) -> np.ndarray:
        raw = np.round((a - offset) / scale)
        return np.clip(raw, -32768, 32767).astype(np.int16).ravel(order="C")

    # Synoptic samples (D10): when the source can provide K distinct real years
    # per month, u/v/shr ship as nt=K planes (plane 0 = most typical year) and
    # the runtime picks a plane per spawn from the seed. SST stays nt=1 (OISST
    # long-term-mean; its year-to-year spread is second-order for this toy).
    has_samples = hasattr(ENV_SRC, "steering_shear_samples")

    layers: list[Layer] = []
    sst_lo, sst_hi = 99.0, -99.0
    sample_years: dict[int, list[int]] = {}
    for m in sources.SEASON_MONTHS:
        sst = sst_by_month[m]
        sst_lo, sst_hi = min(sst_lo, float(sst.min())), max(sst_hi, float(sst.max()))
        if has_samples:
            u, v, shr, years = ENV_SRC.steering_shear_samples(ELAT, ELON, m)
            sample_years[m] = years
        else:
            u1, v1, shr1 = ENV_SRC.steering_shear(ELAT, ELON, m)
            u, v, shr = u1[None], v1[None], shr1[None]
        nt = u.shape[0]
        mm = f"{m:02d}"
        layers.append(Layer(f"sst_{mm}", "int16", True, nx, ny, 1, DOMAIN, 0.01, 20.0, q_i16(sst, 0.01, 20.0)))
        layers.append(Layer(f"u_{mm}", "int16", True, nx, ny, nt, DOMAIN, 0.01, 0.0, q_i16(u, 0.01, 0.0)))
        layers.append(Layer(f"v_{mm}", "int16", True, nx, ny, nt, DOMAIN, 0.01, 0.0, q_i16(v, 0.01, 0.0)))
        layers.append(Layer(f"shr_{mm}", "int16", True, nx, ny, nt, DOMAIN, 0.01, 0.0, q_i16(shr, 0.01, 0.0)))

    path = os.path.join(OUT_DIR, "env.bin")
    binfmt.write_bin(path, layers)
    # Report the seasonal signal so the synthetic field is inspectable.
    print(f"      grid {nx}x{ny} | {len(layers)} layers ({len(sources.SEASON_MONTHS)} months x 4 fields) | {_mb(path)}")
    print(f"      SST [REAL] {sst_lo:.1f}..{sst_hi:.1f} degC | steering+shear [{ENV_SRC.TAG}]:")
    for m in sources.SEASON_MONTHS:
        u, v, shr = ENV_SRC.steering_shear(ELAT, ELON, m)
        spd = float(np.hypot(u, v).mean())
        yrs = f"  samples={sample_years[m]}" if m in sample_years else ""
        print(f"        month {m:02d}: |steer|~{spd:4.1f} m/s  shear~{float(shr.mean()):4.1f} m/s{yrs}")
    return path


def build_flowacc(terrain_path: str) -> tuple[str, str]:
    print("[3/4] flowacc.bin  (D8 flow accumulation + basins from real DEM)")
    parsed = binfmt.parse_bin(open(terrain_path, "rb").read())
    ny, nx = parsed["elev"].ny, parsed["elev"].nx
    elev = parsed["elev"].data.reshape(ny, nx)
    landmask = parsed["landmask"].data.reshape(ny, nx).astype(np.uint8)

    flowacc_log, basin = hydro.flow_accumulation_and_basins(elev, landmask)
    passed, msg = hydro.connectivity_check(flowacc_log, landmask)

    def q_u16(a: np.ndarray, scale: float) -> np.ndarray:
        return np.clip(np.round(a / scale), 0, 65535).astype(np.uint16).ravel(order="C")

    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; max ~5.4 -> ~54000 < 65535
    basin_clip = np.clip(basin, 0, 65535).astype(np.uint16)
    layers = [
        Layer("flowacc", "uint16", True, nx, ny, 1, DOMAIN, acc_scale, 0.0, q_u16(flowacc_log, acc_scale)),
        Layer("basin", "uint16", False, nx, ny, 1, DOMAIN, 1.0, 0.0, basin_clip.ravel(order="C")),
    ]
    path = os.path.join(OUT_DIR, "flowacc.bin")
    binfmt.write_bin(path, layers)
    n_basins = int(basin.max())
    print(
        f"      flowacc log10(1+acc) 0..{float(flowacc_log.max()):.2f} | {n_basins} basins | {_mb(path)}"
    )
    print(f"      {msg}")
    return path, msg


def build_genesis() -> tuple[str, int, int]:
    print("[4/4] genesis.json  (IBTrACS North Indian first-fix, Oman-affecting)")
    points, n_qual, n_total = sources.load_genesis_points()
    path = os.path.join(OUT_DIR, "genesis.json")
    with open(path, "w") as fh:
        json.dump(points, fh, indent=2)
        fh.write("\n")
    box = sources.GENESIS_BOX
    print(
        f"      {n_qual} of {n_total} NI storms entered box "
        f"{box[0]:.0f}-{box[1]:.0f}E / {box[2]:.0f}-{box[3]:.0f}N (reached Oman) | {_mb(path)}"
    )
    return path, n_qual, n_total


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    print(ENV_SRC.banner())

    # Bake-time assert #1 (eng task T6): header write->parse roundtrip vs golden.
    print("[assert] " + binfmt.assert_golden_vector())
    print()

    tpath = build_terrain()
    epath = build_env()
    fpath, conn_msg = build_flowacc(tpath)
    gpath, n_qual, n_total = build_genesis()

    total = sum(os.path.getsize(p) for p in (tpath, epath, fpath, gpath))
    print()
    print(f"[done] public/data payload = {total/1e6:.2f} MB raw (budget <= ~7 MB)")
    print(ENV_SRC.banner())

    ok = "PASS" in conn_msg
    print(f"[asserts] golden-vector PASS | ACC-connectivity {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
