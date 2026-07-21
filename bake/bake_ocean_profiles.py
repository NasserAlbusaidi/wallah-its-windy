#!/usr/bin/env python3
"""Bake monthly WOA23 temperature/salinity profiles for the HF-2A column.

The output is a separate WIWB container because its ``nt`` dimension is depth,
not atmospheric time. Profiles are interpolated onto the locked 26 layer
midpoints and the existing 0.5-degree environment grid. Dynamic columns remain
0.1-degree and bilinearly sample this immutable background.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.parse

import h5py
import numpy as np
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

import binfmt
import era5
import sources
from binfmt import Layer

ROOT = os.path.dirname(os.path.dirname(__file__))
OUT_BIN = os.path.join(ROOT, "public", "data", "ocean.bin")
OUT_META = os.path.join(ROOT, "public", "data", "ocean.json")
DEPTH_INTERFACES_M = np.asarray(
    [
        0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75,
        80, 85, 90, 95, 100, 125, 150, 175, 200, 250, 300,
    ],
    dtype=np.float64,
)
DEPTH_MIDPOINTS_M = (DEPTH_INTERFACES_M[:-1] + DEPTH_INTERFACES_M[1:]) / 2
BASE = "https://www.ncei.noaa.gov/thredds-ocean/ncss/grid/woa23/DATA"


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_url(kind: str, month_index: int) -> str:
    prefix, variable = ("temperature", "t_an") if kind == "t" else ("salinity", "s_an")
    name = f"woa23_decav_{kind}{month_index + 1:02d}_01.nc"
    query = urllib.parse.urlencode(
        {
            "var": variable,
            "north": 27.5,
            "west": 50.0,
            "east": 70.5,
            "south": 15.0,
            "horizStride": 1,
            "accept": "netcdf4ext",
        }
    )
    return f"{BASE}/{prefix}/netcdf/decav/1.00/{name}?{query}"


def source_path(kind: str, month_index: int) -> str:
    filename = f"woa23_decav_{kind}{month_index + 1:02d}_01_arabian.nc"
    return sources.ensure_download(source_url(kind, month_index), filename)


def nearest_ocean_fill(values: np.ndarray) -> np.ndarray:
    output = values.copy()
    for level in range(output.shape[0]):
        missing = ~np.isfinite(output[level])
        if missing.all():
            raise ValueError(f"WOA23 level {level} contains no valid ocean cells")
        if missing.any():
            nearest = ndimage.distance_transform_edt(
                missing,
                return_distances=False,
                return_indices=True,
            )
            output[level] = output[level][tuple(nearest)]
    return output


def load_product(kind: str, month_index: int) -> tuple[np.ndarray, str]:
    path = source_path(kind, month_index)
    variable = "t_an" if kind == "t" else "s_an"
    with h5py.File(path, "r") as dataset:
        values = np.asarray(era5._unpack(dataset[variable]), dtype=np.float64)
        if values.ndim == 4:
            values = values[0]
        depth = np.asarray(dataset["depth"][...], dtype=np.float64)
        lat = np.asarray(dataset["lat"][...], dtype=np.float64)
        lon = np.asarray(dataset["lon"][...], dtype=np.float64)
    values = nearest_ocean_fill(values)

    # First interpolate vertically at every native horizontal point.
    vertical = np.empty((DEPTH_MIDPOINTS_M.size, lat.size, lon.size), dtype=np.float64)
    for row in range(lat.size):
        for col in range(lon.size):
            vertical[:, row, col] = np.interp(
                DEPTH_MIDPOINTS_M,
                depth,
                values[:, row, col],
            )

    # Then bilinearly interpolate each level to the browser environment grid.
    target_lat = sources.lat_centers(sources.ENV_NY)
    target_lon = sources.lon_centers(sources.ENV_NX)
    target_lat_grid, target_lon_grid = np.meshgrid(
        target_lat,
        target_lon,
        indexing="ij",
    )
    points = np.stack([target_lat_grid.ravel(), target_lon_grid.ravel()], axis=-1)
    output = np.empty(
        (DEPTH_MIDPOINTS_M.size, sources.ENV_NY, sources.ENV_NX),
        dtype=np.float64,
    )
    for level in range(DEPTH_MIDPOINTS_M.size):
        interpolator = RegularGridInterpolator(
            (lat, lon),
            vertical[level],
            bounds_error=False,
            fill_value=None,
        )
        output[level] = interpolator(points).reshape(sources.ENV_NY, sources.ENV_NX)
    if not np.isfinite(output).all():
        raise ValueError(f"WOA23 {kind} profile interpolation produced missing values")
    return output, path


def quantize(values: np.ndarray, offset: float) -> np.ndarray:
    raw = np.rint((values - offset) / 0.001)
    return np.clip(raw, -32768, 32767).astype("<i2").ravel(order="C")


def main() -> None:
    layers: list[Layer] = []
    inputs: list[dict[str, object]] = []
    for month_index in sources.SEASON_MONTHS:
        temperature, temperature_path = load_product("t", month_index)
        salinity, salinity_path = load_product("s", month_index)
        suffix = f"{month_index:02d}"
        for name, values, offset in (
            (f"temp_{suffix}", temperature, 20.0),
            (f"salt_{suffix}", salinity, 35.0),
        ):
            layers.append(
                Layer(
                    name,
                    "int16",
                    True,
                    sources.ENV_NX,
                    sources.ENV_NY,
                    DEPTH_MIDPOINTS_M.size,
                    sources.DOMAIN,
                    0.001,
                    offset,
                    quantize(values, offset),
                )
            )
        inputs.append(
            {
                "monthIndex": month_index,
                "temperature": {
                    "path": os.path.relpath(temperature_path, ROOT),
                    "url": source_url("t", month_index),
                    "sha256": sha256(temperature_path),
                },
                "salinity": {
                    "path": os.path.relpath(salinity_path, ROOT),
                    "url": source_url("s", month_index),
                    "sha256": sha256(salinity_path),
                },
            }
        )
        print(
            f"  [ocean] month {month_index:02d}: "
            f"T {temperature.min():.2f}..{temperature.max():.2f} C, "
            f"S {salinity.min():.2f}..{salinity.max():.2f} PSU"
        )
    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    binfmt.write_bin(OUT_BIN, layers)
    metadata = {
        "schemaVersion": 1,
        "sourceTier": "climatological-subsurface",
        "product": "NOAA World Ocean Atlas 2023 decadal monthly objective analysis",
        "license": "United States public domain; cite NOAA NCEI WOA23",
        "horizontalGrid": {
            "nx": sources.ENV_NX,
            "ny": sources.ENV_NY,
            "bbox": list(sources.DOMAIN),
        },
        "dynamicGridDegrees": 0.1,
        "depthInterfacesM": DEPTH_INTERFACES_M.tolist(),
        "depthMidpointsM": DEPTH_MIDPOINTS_M.tolist(),
        "temperatureUnits": "degree_Celsius",
        "salinityUnits": "PSU",
        "wakeFreeAfterInitialization": True,
        "futureOceanAssimilation": False,
        "missingDataPolicy": "per-level nearest-ocean fill before bilinear interpolation",
        "inputs": inputs,
        "binary": {
            "path": "public/data/ocean.bin",
            "bytes": os.path.getsize(OUT_BIN),
            "sha256": sha256(OUT_BIN),
        },
    }
    with open(OUT_META, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
        handle.write("\n")
    print(f"[ocean] wrote {OUT_BIN} ({os.path.getsize(OUT_BIN) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
