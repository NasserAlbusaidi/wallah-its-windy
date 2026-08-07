"""Bake the presentation-only GMRT terrain context declared in config/.

The output is a normal self-describing WIWB binary. It is intentionally
separate from terrain.bin: the latter remains the fixed, high-detail simulation
terrain, while this lower-resolution sidecar only supplies geographic context.

Usage:
  node bake/run-python.mjs bake/bake_context_terrain.py
  node bake/run-python.mjs bake/bake_context_terrain.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

import numpy as np
from scipy import ndimage
from scipy.io import netcdf_file

import binfmt
from binfmt import Layer


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "display-domain.json"
RAW_DIR = ROOT / "data" / "raw"


def load_contract() -> tuple[str, tuple[float, float, float, float], int, int, Path, str, str]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 1:
        raise ValueError("display-domain schemaVersion must be 1")
    domain_id = str(config["id"])
    bbox = config["bbox"]
    domain = (
        float(bbox["lonMin"]),
        float(bbox["lonMax"]),
        float(bbox["latMin"]),
        float(bbox["latMax"]),
    )
    nx = int(config["grid"]["nx"])
    ny = int(config["grid"]["ny"])
    if not domain_id or nx <= 0 or ny <= 0:
        raise ValueError("display-domain id and positive grid dimensions are required")
    if domain[0] >= domain[1] or domain[2] >= domain[3]:
        raise ValueError("display-domain bbox minima must be below maxima")
    output = ROOT / "public" / str(config["asset"]["path"])
    resolution = str(config["source"]["resolution"])
    source_sha256 = str(config["source"]["sha256"]).lower()
    if len(source_sha256) != 64 or any(c not in "0123456789abcdef" for c in source_sha256):
        raise ValueError("display-domain source.sha256 must be a lowercase SHA-256 digest")
    return domain_id, domain, nx, ny, output, resolution, source_sha256


def gmrt_url(domain: tuple[float, float, float, float], resolution: str) -> str:
    lon_min, lon_max, lat_min, lat_max = domain
    query = urllib.parse.urlencode(
        {
            "minlongitude": f"{lon_min:g}",
            "maxlongitude": f"{lon_max:g}",
            "minlatitude": f"{lat_min:g}",
            "maxlatitude": f"{lat_max:g}",
            "format": "netcdf",
            "resolution": resolution,
        }
    )
    return f"https://www.gmrt.org/services/GridServer?{query}"


def ensure_source(domain_id: str, url: str) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"gmrt_{domain_id}.nc"
    if path.exists() and path.stat().st_size > 0:
        print(f"[cache] {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KiB)")
        return path
    partial = path.with_suffix(path.suffix + ".part")
    if partial.exists():
        partial.unlink()
    print(f"[get]   {url}")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "wallah-its-windy-context-bake/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response, partial.open("wb") as output:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block)
        os.replace(partial, path)
    except Exception:
        if partial.exists():
            partial.unlink()
        raise
    print(f"[ok]    {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KiB)")
    return path


def resample(
    source: Path,
    domain: tuple[float, float, float, float],
    nx: int,
    ny: int,
) -> tuple[np.ndarray, np.ndarray]:
    with netcdf_file(source, "r", mmap=False) as dataset:
        x0, x1 = [float(v) for v in dataset.variables["x_range"].data]
        y0, y1 = [float(v) for v in dataset.variables["y_range"].data]
        gnx, gny = [int(v) for v in dataset.variables["dimension"].data]
        z = dataset.variables["z"].data.astype(np.float64).reshape(gny, gnx)

    lon_min, lon_max, lat_min, lat_max = domain
    tolerance = 1e-6
    if x0 > lon_min + tolerance or x1 < lon_max - tolerance:
        raise ValueError(f"GMRT longitude coverage {x0:g}..{x1:g} misses {lon_min:g}..{lon_max:g}")
    if y0 > lat_min + tolerance or y1 < lat_max - tolerance:
        raise ValueError(f"GMRT latitude coverage {y0:g}..{y1:g} misses {lat_min:g}..{lat_max:g}")

    source_lon = np.linspace(x0, x1, gnx)
    source_lat = np.linspace(y1, y0, gny)  # row zero is north
    lon, lat = np.meshgrid(source_lon, source_lat)
    values = z.ravel()
    cols = np.floor((lon.ravel() - lon_min) / ((lon_max - lon_min) / nx)).astype(np.int64)
    rows = np.floor((lat_max - lat.ravel()) / ((lat_max - lat_min) / ny)).astype(np.int64)
    good = (
        np.isfinite(values)
        & (cols >= 0)
        & (cols < nx)
        & (rows >= 0)
        & (rows < ny)
    )
    target_index = rows[good] * nx + cols[good]
    source_values = values[good]
    size = nx * ny
    sums = np.bincount(target_index, weights=source_values, minlength=size)
    counts = np.bincount(target_index, minlength=size)
    land_hits = np.bincount(
        target_index,
        weights=(source_values >= 0.0).astype(np.float64),
        minlength=size,
    )

    elevation = np.full(size, np.nan, dtype=np.float64)
    populated = counts > 0
    elevation[populated] = sums[populated] / counts[populated]
    elevation = elevation.reshape(ny, nx)
    landmask = (land_hits.reshape(ny, nx) > 0).astype(np.uint8)

    holes = ~np.isfinite(elevation)
    if holes.all():
        raise ValueError("GMRT resample produced no populated target cells")
    if holes.any():
        nearest = ndimage.distance_transform_edt(
            holes,
            return_distances=False,
            return_indices=True,
        )
        elevation = elevation[tuple(nearest)]
        landmask[holes] = (elevation[holes] >= 0.0).astype(np.uint8)

    elevation_i16 = np.clip(np.rint(elevation), -32768, 32767).astype(np.int16)
    return elevation_i16, landmask


def build_blob(
    domain: tuple[float, float, float, float],
    nx: int,
    ny: int,
    elevation: np.ndarray,
    landmask: np.ndarray,
) -> bytes:
    layers = [
        Layer("elev", "int16", False, nx, ny, 1, domain, 1.0, 0.0, elevation.ravel(order="C")),
        Layer("landmask", "uint8", False, nx, ny, 1, domain, 1.0, 0.0, landmask.ravel(order="C")),
    ]
    blob = binfmt.write_bin(None, layers)
    parsed = binfmt.parse_bin(blob)
    if set(parsed) != {"elev", "landmask"}:
        raise AssertionError("context terrain roundtrip lost required layers")
    return blob


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="rebuild from the cached/downloaded GMRT source and require byte identity",
    )
    args = parser.parse_args()

    domain_id, domain, nx, ny, output, resolution, expected_source_digest = load_contract()
    url = gmrt_url(domain, resolution)
    source = ensure_source(domain_id, url)
    source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_digest != expected_source_digest:
        raise AssertionError(
            "GMRT source checksum differs from display-domain.json: "
            f"expected {expected_source_digest}, got {source_digest}"
        )
    elevation, landmask = resample(source, domain, nx, ny)
    blob = build_blob(domain, nx, ny, elevation, landmask)
    digest = hashlib.sha256(blob).hexdigest()

    if args.check:
        if not output.exists():
            raise FileNotFoundError(f"missing committed context terrain: {output}")
        if output.read_bytes() != blob:
            raise AssertionError(f"{output.relative_to(ROOT)} differs from reproducible bake")
        print(f"[check] {output.relative_to(ROOT)} byte-identical sha256={digest}")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_bytes(blob)
        os.replace(temporary, output)
        print(f"[write] {output.relative_to(ROOT)} ({len(blob) / (1024 * 1024):.2f} MiB)")

    print(
        f"[grid]  {domain_id} {nx}x{ny} bbox={domain} "
        f"elev={int(elevation.min())}..{int(elevation.max())}m "
        f"land={float(landmask.mean()) * 100:.1f}%"
    )
    print(f"[raw]   sha256={source_digest}")
    print(f"[bin]   sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
