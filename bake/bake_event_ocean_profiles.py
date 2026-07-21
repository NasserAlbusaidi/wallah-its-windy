#!/usr/bin/env python3
"""Bake pre-initialization GODAS profiles for the HF-2A event benchmark.

Each storm uses the last fully completed calendar month before its initialization
time. This keeps the profile validity interval strictly before initialization;
the storm month is never read. GODAS is lower resolution than GLORYS, so this is
an explicit auth-free Tier-A2 analysis rather than a claim of eddy-resolving
initialization.
"""

from __future__ import annotations

import datetime as dt
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
from bake_ocean_profiles import DEPTH_MIDPOINTS_M, quantize
from binfmt import Layer

ROOT = os.path.dirname(os.path.dirname(__file__))
CONTRACT_PATH = os.path.join(ROOT, "calibration", "hf2a-contract.json")
SCENARIOS_PATH = os.path.join(ROOT, "calibration", "data", "fidelity-scenarios.json")
OUT_BIN = os.path.join(ROOT, "calibration", "data", "hf2a-event-ocean.bin")
OUT_META = os.path.join(ROOT, "calibration", "data", "hf2a-event-ocean.json")
NCSS = "https://psl.noaa.gov/thredds/ncss/grid/Datasets/godas"


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def completed_month(initial_iso: str) -> tuple[int, int]:
    initialized = dt.datetime.fromisoformat(initial_iso.replace("Z", "+00:00"))
    first = initialized.replace(day=1)
    previous = first - dt.timedelta(days=1)
    return previous.year, previous.month


def source_url(variable: str, year: int, month: int) -> str:
    query = urllib.parse.urlencode(
        {
            "var": variable,
            "north": 27.5,
            "west": 49.5,
            "east": 70.5,
            "south": 14.5,
            "horizStride": 1,
            "time": f"{year:04d}-{month:02d}-01T00:00:00Z",
            "accept": "netcdf4",
        }
    )
    return f"{NCSS}/{variable}.{year}.nc?{query}"


def load_native(variable: str, year: int, month: int) -> tuple[np.ndarray, str, str]:
    filename = f"godas_{variable}_{year}_{month:02d}_arabian.nc"
    url = source_url(variable, year, month)
    path = sources.ensure_download(url, filename)
    with h5py.File(path, "r") as dataset:
        values = np.asarray(era5._unpack(dataset[variable]), dtype=np.float64)
        while values.ndim > 3:
            values = values[0]
        depth = np.asarray(dataset["level"][...], dtype=np.float64)
        lat = np.asarray(dataset["lat"][...], dtype=np.float64)
        lon = np.asarray(dataset["lon"][...], dtype=np.float64)
    if variable == "pottmp":
        values -= 273.15
    else:
        # GODAS salinity is stored as kg/kg. Practical salinity is numerically
        # about 1000 times that fraction for this reduced density closure.
        values *= 1000
    return (values, path, url)


def fill_and_resample(values: np.ndarray, path: str) -> np.ndarray:
    with h5py.File(path, "r") as dataset:
        depth = np.asarray(dataset["level"][...], dtype=np.float64)
        lat = np.asarray(dataset["lat"][...], dtype=np.float64)
        lon = np.asarray(dataset["lon"][...], dtype=np.float64)
    required = depth <= 303
    depth = depth[required]
    values = values[required]
    for level in range(values.shape[0]):
        missing = ~np.isfinite(values[level]) | (np.abs(values[level]) > 1e6)
        if missing.all():
            raise ValueError(f"GODAS {path} level {level} has no valid cells")
        if missing.any():
            nearest = ndimage.distance_transform_edt(
                missing,
                return_distances=False,
                return_indices=True,
            )
            values[level] = values[level][tuple(nearest)]

    vertical = np.empty((DEPTH_MIDPOINTS_M.size, lat.size, lon.size), dtype=np.float64)
    for row in range(lat.size):
        for col in range(lon.size):
            vertical[:, row, col] = np.interp(
                DEPTH_MIDPOINTS_M,
                depth,
                values[:, row, col],
            )

    target_lat = sources.lat_centers(sources.ENV_NY)
    target_lon = sources.lon_centers(sources.ENV_NX)
    target_lat_grid, target_lon_grid = np.meshgrid(target_lat, target_lon, indexing="ij")
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
        raise ValueError(f"GODAS interpolation produced missing values for {path}")
    return output


def main() -> None:
    with open(CONTRACT_PATH, encoding="utf-8") as handle:
        contract = json.load(handle)
    with open(SCENARIOS_PATH, encoding="utf-8") as handle:
        scenarios = {item["id"]: item for item in json.load(handle)["scenarios"]}
    partitions = contract["oceanBenchmark"]["partitions"]
    ids = partitions["development"] + partitions["validation"] + partitions["testReportOnly"]

    layers: list[Layer] = []
    events: list[dict[str, object]] = []
    for index, storm_id in enumerate(ids):
        scenario = scenarios[storm_id]
        year, month = completed_month(scenario["hindcast"]["startIso"])
        temperature_raw, temperature_path, temperature_url = load_native(
            "pottmp", year, month
        )
        salinity_raw, salinity_path, salinity_url = load_native("salt", year, month)
        temperature = fill_and_resample(temperature_raw, temperature_path)
        salinity = fill_and_resample(salinity_raw, salinity_path)
        layers.extend(
            [
                Layer(
                    f"t{index:03d}", "int16", True,
                    sources.ENV_NX, sources.ENV_NY, DEPTH_MIDPOINTS_M.size,
                    sources.DOMAIN, 0.001, 20.0,
                    quantize(temperature, 20.0),
                ),
                Layer(
                    f"s{index:03d}", "int16", True,
                    sources.ENV_NX, sources.ENV_NY, DEPTH_MIDPOINTS_M.size,
                    sources.DOMAIN, 0.001, 35.0,
                    quantize(salinity, 35.0),
                ),
            ]
        )
        events.append(
            {
                "id": storm_id,
                "layerIndex": index,
                "initializationTime": scenario["hindcast"]["startIso"],
                "sourceMonth": f"{year:04d}-{month:02d}",
                "validityEndsBeforeInitialization": True,
                "temperature": {
                    "url": temperature_url,
                    "rawSha256": sha256(temperature_path),
                },
                "salinity": {
                    "url": salinity_url,
                    "rawSha256": sha256(salinity_path),
                },
            }
        )
        print(
            f"  [event-ocean] {storm_id}: {year:04d}-{month:02d} "
            f"T {temperature.min():.2f}..{temperature.max():.2f} C, "
            f"S {salinity.min():.2f}..{salinity.max():.2f} PSU"
        )

    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    binfmt.write_bin(OUT_BIN, layers)
    metadata = {
        "schemaVersion": 1,
        "sourceTier": "event-analysis-tier-a2",
        "product": "NOAA NCEP Global Ocean Data Assimilation System monthly analysis",
        "source": "NOAA Physical Sciences Laboratory THREDDS NCSS",
        "license": "United States public data; acknowledge NOAA PSL",
        "selection": "last fully completed calendar month before initialization",
        "futureOceanAssimilation": False,
        "horizontalGrid": {
            "nx": sources.ENV_NX,
            "ny": sources.ENV_NY,
            "bbox": list(sources.DOMAIN),
        },
        "depthMidpointsM": DEPTH_MIDPOINTS_M.tolist(),
        "events": events,
        "binary": {
            "path": "calibration/data/hf2a-event-ocean.bin",
            "bytes": os.path.getsize(OUT_BIN),
            "sha256": sha256(OUT_BIN),
        },
        "limitations": [
            "GODAS native horizontal grid is 1 degree longitude by about 1/3 degree latitude.",
            "The previous completed monthly mean cannot resolve event-scale mesoscale eddies.",
            "GLORYS12V1 remains the preferred higher-resolution Tier-A source when credentials and archival access are available."
        ],
    }
    with open(OUT_META, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
        handle.write("\n")
    print(f"[event-ocean] wrote {OUT_BIN} ({os.path.getsize(OUT_BIN) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
