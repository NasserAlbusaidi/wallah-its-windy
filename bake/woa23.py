"""NOAA World Ocean Atlas 2023 upper-ocean heat-content climatology.

The browser needs a compact, interpretable measure of subsurface thermal
support—not SST pretending to describe the whole ocean.  This module downloads
NCSS subsets of WOA23's 1-degree monthly objectively analysed temperature
profiles for only the simulation domain, integrates positive heat above 26 C,
and regrids the result onto env.bin's 0.5-degree grid.

OHC units are kJ/cm^2:
    rho * cp * integral(max(T - 26 C, 0) dz) / 1e7.
The 1e7 converts J/m^2 to kJ/cm^2.  Missing land profiles are nearest-ocean
filled only so bilinear sampling near coasts remains finite; the sim's land mask
still removes ocean support over land.
"""

from __future__ import annotations

import os
import urllib.parse

import numpy as np
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

import era5
import sources

RHO_KG_M3 = 1025.0
CP_J_KG_K = 3990.0
THRESHOLD_C = 26.0
J_M2_PER_KJ_CM2 = 1.0e7
BASE = (
    "https://www.ncei.noaa.gov/thredds-ocean/ncss/grid/woa23/DATA/"
    "temperature/netcdf/decav/1.00"
)

_cache: dict[int, np.ndarray] = {}


def _filename(month_index: int) -> str:
    return f"woa23_decav_t{month_index + 1:02d}_01_arabian.nc"


def _url(month_index: int) -> str:
    source_name = f"woa23_decav_t{month_index + 1:02d}_01.nc"
    query = urllib.parse.urlencode(
        {
            "var": "t_an",
            "north": sources.DOMAIN[3],
            "west": sources.DOMAIN[0],
            "east": sources.DOMAIN[1],
            "south": sources.DOMAIN[2],
            "horizStride": 1,
            "accept": "netcdf4ext",
        }
    )
    return f"{BASE}/{source_name}?{query}"


def _unpack_temperature(ds) -> np.ndarray:
    values = era5._unpack(ds)
    return np.asarray(values, dtype=np.float64)


def _integrate_profile(
    temperature: np.ndarray,
    depth: np.ndarray,
    depth_bounds: np.ndarray,
) -> np.ndarray:
    """Return [lat,lon] TCHP, integrating only layers warmer than 26 C."""
    t = temperature[0] if temperature.ndim == 4 else temperature
    if t.ndim != 3:
        raise ValueError(f"WOA23 t_an expected [time,depth,lat,lon], got {temperature.shape}")
    thickness = np.asarray(depth_bounds[:, 1] - depth_bounds[:, 0], dtype=np.float64)
    # WOA's last monthly level is 1500 m.  OHC26 naturally stops at the first
    # non-positive anomaly, so including the full profile is harmless.
    anomaly = np.maximum(t - THRESHOLD_C, 0.0)
    anomaly[~np.isfinite(t)] = np.nan
    degree_metres = np.nansum(anomaly * thickness[:, None, None], axis=0)
    valid = np.isfinite(t).any(axis=0)
    ohc = RHO_KG_M3 * CP_J_KG_K * degree_metres / J_M2_PER_KJ_CM2
    ohc[~valid] = np.nan
    return ohc


def load_ohc(month_index: int) -> np.ndarray:
    """Return WOA23 monthly OHC26 [ENV_NY,ENV_NX] in kJ/cm^2."""
    if month_index in _cache:
        return _cache[month_index].copy()
    if month_index < 0 or month_index > 11:
        raise ValueError(f"month_index out of range: {month_index}")

    import h5py

    path = sources.ensure_download(_url(month_index), _filename(month_index))
    with h5py.File(path, "r") as f:
        temperature = _unpack_temperature(f["t_an"])
        depth = np.asarray(f["depth"][...], dtype=np.float64)
        depth_bounds = np.asarray(f["depth_bounds"][...], dtype=np.float64)
        lat = np.asarray(f["lat"][...], dtype=np.float64)
        lon = np.asarray(f["lon"][...], dtype=np.float64)

    native = _integrate_profile(temperature, depth, depth_bounds)
    missing = ~np.isfinite(native)
    if missing.any():
        nearest = ndimage.distance_transform_edt(
            missing,
            return_distances=False,
            return_indices=True,
        )
        native = native[tuple(nearest)]

    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")
    interp = RegularGridInterpolator(
        (lat, lon),
        native,
        bounds_error=False,
        fill_value=None,
    )
    points = np.stack([ELAT.ravel(), ELON.ravel()], axis=-1)
    result = interp(points).reshape(ELAT.shape).astype(np.float64)
    if not np.isfinite(result).all():
        raise ValueError("WOA23 OHC regrid produced non-finite values")
    _cache[month_index] = result
    return result.copy()
