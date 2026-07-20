"""ERA5 600/700-hPa relative humidity for climatology and event bakes."""

from __future__ import annotations

import os

import numpy as np

import era5

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")
CLIM_PATH = os.path.join(RAW_DIR, "era5_rh_climatology.nc")
LEVELS_HPA = (600.0, 700.0)

_yearly: dict[int, tuple[np.ndarray, np.ndarray]] | None = None
_axes: tuple[np.ndarray, np.ndarray] | None = None


def available() -> bool:
    return os.path.exists(CLIM_PATH) and os.path.getsize(CLIM_PATH) > 0


def _load() -> None:
    global _yearly, _axes
    if _yearly is not None:
        return
    import h5py

    with h5py.File(CLIM_PATH, "r") as f:
        time_ds, _ = era5._find(f, era5._TIME_NAMES)
        level_ds, _ = era5._find(f, era5._LEVEL_NAMES)
        lat_ds, _ = era5._find(f, era5._LAT_NAMES)
        lon_ds, _ = era5._find(f, era5._LON_NAMES)
        years, months = era5._dates_from_time(time_ds)
        levels = np.asarray(level_ds[...], dtype=np.float64)
        lat = np.asarray(lat_ds[...], dtype=np.float64)
        lon = np.asarray(lon_ds[...], dtype=np.float64)
        rh = era5._unpack(era5._find(f, ("r",))[0])

    indices = [int(np.argmin(np.abs(levels - level))) for level in LEVELS_HPA]
    for wanted, index in zip(LEVELS_HPA, indices, strict=True):
        if abs(levels[index] - wanted) > 1:
            raise ValueError(f"ERA5 humidity missing {wanted} hPa (has {levels})")
    mid = np.nanmean(rh[:, indices], axis=1)
    if lat[0] > lat[-1]:
        lat = lat[::-1]
        mid = mid[:, ::-1, :]
    _axes = (lat, lon)
    _yearly = {}
    for cal_month in sorted(set(months.tolist())):
        select = months == cal_month
        _yearly[cal_month - 1] = (years[select], mid[select])


def samples_for_years(
    elat: np.ndarray,
    elon: np.ndarray,
    month_index: int,
    selected_years: list[int],
) -> np.ndarray:
    """Return RH planes aligned to the wind bake's selected real years."""
    _load()
    assert _yearly is not None and _axes is not None
    years, fields = _yearly[month_index]
    lat, lon = _axes
    from scipy.interpolate import RegularGridInterpolator

    points = np.stack([elat.ravel(), elon.ravel()], axis=-1)
    out: list[np.ndarray] = []
    for year in selected_years:
        matches = np.flatnonzero(years == year)
        if matches.size != 1:
            raise ValueError(f"humidity month {month_index}: year {year} not found exactly once")
        field = fields[int(matches[0])]
        interp = RegularGridInterpolator(
            (lat, lon),
            field,
            bounds_error=False,
            fill_value=None,
        )
        plane = interp(points).reshape(elat.shape)
        out.append(np.clip(plane, 0.0, 100.0))
    result = np.stack(out)
    if not np.isfinite(result).all():
        raise ValueError("ERA5 humidity produced non-finite values")
    return result
