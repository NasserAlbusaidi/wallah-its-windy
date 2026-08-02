#!/usr/bin/env python3
"""realism_env_variance.py — one-shot R1 study: what within-month variability
do env.bin's monthly planes erase? Reads the 6-hourly ERA5 files fetched by
bake/fetch_realism_era5.py and writes calibration/realism/env-variance.json
plus a generated markdown table. Offline after the fetch; deterministic.

Task 2 was split per-month after the fetch script hit CDS cost limits (see
bake/fetch_realism_era5.py): pressure-level data lands as one file per
(year, month) — era5_realism_plev_<year>_<month>.nc, 21 files — instead of one
file per year. SST stayed yearly — era5_realism_sst_<year>.nc, 3 files — and is
grouped into months here from its own time axis. 24 files total.

Run: node bake/run-python.mjs bake/realism_env_variance.py
"""

from __future__ import annotations

import json
import os

import numpy as np

import era5

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")
OUT_JSON = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                        "calibration", "realism", "env-variance.json")
OUT_MD = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                      "docs", "research", "realism", "env-variance-study.md")
YEARS = (2019, 2021, 2023)
MONTHS = tuple(f"{m:02d}" for m in range(5, 12))
BELT_LAT_MAX = 19.0  # genesis belt, mirrors bake/era5.py GENESIS_BELT_LAT_MAX
SOURCE_TAG = "ERA5-6H-REALISM-2019-2021-2023"

SHEAR_LEVELS = (850.0, 200.0)
RH_LEVELS = (600.0, 700.0)

FIELD_LABELS = {
    "shear_ms": "shear (m/s)",
    "rh_mid_pct": "600/700 hPa RH (%)",
    "sst_c": "SST (C)",
}
REGION_LABELS = {"belt": "genesis belt (lat <= 19N)", "domain": "full domain"}


def round6(x: float) -> float:
    return float(round(float(x), 6))


def temporal_stats(series: np.ndarray) -> dict:
    """Raw (unrounded) temporal stats over a regional-mean series. Rounding to
    the 6-decimal JSON contract happens at assembly time (_round_stats) —
    keeping this function unrounded is what lets test_realism_variance.py
    compare it directly against numpy at near-float64 precision."""
    mean = float(np.mean(series))
    return {
        "mean": mean,
        "std": float(np.std(series)),
        "p05": float(np.percentile(series, 5)),
        "p95": float(np.percentile(series, 95)),
        "maxOverMean": float(np.max(series)) / mean if mean else 0.0,
    }


def _round_stats(stats: dict) -> dict:
    return {key: round6(value) for key, value in stats.items()}


def regional_shear_series(u850, v850, u200, v200, mask) -> np.ndarray:
    """|V850 - V200| per timestep per cell, then mean over masked cells.

    Mean-of-magnitudes BEFORE any temporal reduction — opposing-direction
    timesteps must not cancel (same rule bake/era5.py documents for shear).
    """
    mag = np.hypot(u850 - u200, v850 - v200)          # (t, lat, lon)
    return mag[:, mask].mean(axis=1)                   # (t,)


def _level_index(levels: np.ndarray, target: float) -> int:
    i = int(np.argmin(np.abs(levels - target)))
    if abs(levels[i] - target) > 1.0:
        raise ValueError(f"level {target} hPa not in file (has {levels.tolist()})")
    return i


def _plev_path(year: int, month: str) -> str:
    return os.path.join(RAW_DIR, f"era5_realism_plev_{year}_{month}.nc")


def _sst_path(year: int) -> str:
    return os.path.join(RAW_DIR, f"era5_realism_sst_{year}.nc")


def _read_plev_month(year: int, month: str):
    """One (year, month) pressure-level file -> u850, v850, u200, v200,
    rh_mid[t,ny,nx], lat, lon. Coordinate discovery mirrors bake/era5.py._load
    (candidate name lists for time/level/lat/lon, CF unpack for scale/offset/
    fill). The file is already scoped to this exact month by the Task 2 fetch
    split, but decoded months are asserted anyway — silent month drift would
    corrupt the study without ever raising."""
    import h5py

    path = _plev_path(year, month)
    with h5py.File(path, "r") as f:
        time_ds, _ = era5._find(f, era5._TIME_NAMES)
        level_ds, _ = era5._find(f, era5._LEVEL_NAMES)
        lat_ds, _ = era5._find(f, era5._LAT_NAMES)
        lon_ds, _ = era5._find(f, era5._LON_NAMES)
        _years, months = era5._dates_from_time(time_ds)
        levels = np.asarray(level_ds[...], dtype=np.float64)
        lat = np.asarray(lat_ds[...], dtype=np.float64)
        lon = np.asarray(lon_ds[...], dtype=np.float64)
        u = era5._unpack(era5._find(f, ("u",))[0])  # [t, level, lat, lon]
        v = era5._unpack(era5._find(f, ("v",))[0])
        r = era5._unpack(era5._find(f, ("r",))[0])

    wanted_month = int(month)
    if not np.all(months == wanted_month):
        bad = sorted(set(months.tolist()) - {wanted_month})
        raise ValueError(f"{path}: expected only month {wanted_month}, also has {bad}")
    if u.ndim != 4:
        raise ValueError(f"{path}: expected u[time,level,lat,lon], got {u.shape}")
    if np.isnan(u).any() or np.isnan(v).any() or np.isnan(r).any():
        raise ValueError(f"{path}: NaN in u/v/r — bad download or fill leaked through")

    i850 = _level_index(levels, SHEAR_LEVELS[0])
    i200 = _level_index(levels, SHEAR_LEVELS[1])
    i600 = _level_index(levels, RH_LEVELS[0])
    i700 = _level_index(levels, RH_LEVELS[1])

    u850, v850 = u[:, i850], v[:, i850]
    u200, v200 = u[:, i200], v[:, i200]
    rh_mid = (r[:, i600] + r[:, i700]) / 2.0

    return u850, v850, u200, v200, rh_mid, lat, lon


def _read_sst_year(year: int):
    """One yearly SST file -> months[t] (int, decoded from valid_time),
    sst_c[t,ny,nx] (Kelvin -> Celsius, NaN preserved over land), lat, lon."""
    import h5py

    path = _sst_path(year)
    with h5py.File(path, "r") as f:
        time_ds, _ = era5._find(f, era5._TIME_NAMES)
        lat_ds, _ = era5._find(f, era5._LAT_NAMES)
        lon_ds, _ = era5._find(f, era5._LON_NAMES)
        _years, months = era5._dates_from_time(time_ds)
        lat = np.asarray(lat_ds[...], dtype=np.float64)
        lon = np.asarray(lon_ds[...], dtype=np.float64)
        sst = era5._unpack(era5._find(f, ("sst",))[0])

    if sst.ndim == 4 and sst.shape[1] == 1:
        sst = sst[:, 0]
    if sst.ndim != 3:
        raise ValueError(f"{path}: expected sst[time,lat,lon], got {sst.shape}")
    sst_c = sst - 273.15  # ERA5 SST is Kelvin
    return months, sst_c, lat, lon


def _region_masks(lat: np.ndarray, lon: np.ndarray) -> dict:
    belt = np.broadcast_to((lat <= BELT_LAT_MAX)[:, None], (lat.size, lon.size))
    domain = np.ones((lat.size, lon.size), dtype=bool)
    return {"belt": belt, "domain": domain}


def _sst_regional_series(sst_month: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Regional-mean SST per timestep, ocean cells only — NaN (land/fill) cells
    are excluded from the mean rather than propagating it to NaN."""
    selected = sst_month[:, mask]  # (t, n_cells_in_region)
    with np.errstate(invalid="ignore"):
        series = np.nanmean(selected, axis=1)
    if not np.isfinite(series).all():
        raise ValueError("SST regional mean is non-finite — region is entirely land/fill")
    return series


def _empty_field_tree() -> dict:
    return {"belt": {}, "domain": {}}


def _put(tree: dict, region: str, year: int, month: str, stats: dict) -> None:
    tree[region].setdefault(str(year), {})[month] = stats


def run_study() -> dict:
    fields = {
        "shear_ms": _empty_field_tree(),
        "rh_mid_pct": _empty_field_tree(),
        "sst_c": _empty_field_tree(),
    }

    for year in YEARS:
        plev_lat = plev_lon = None
        for month in MONTHS:
            u850, v850, u200, v200, rh_mid, lat, lon = _read_plev_month(year, month)
            if plev_lat is None:
                plev_lat, plev_lon = lat, lon
            elif not (np.array_equal(lat, plev_lat) and np.array_equal(lon, plev_lon)):
                raise ValueError(f"{year} {month}: plev grid disagrees with earlier months")
            masks = _region_masks(lat, lon)
            for region, mask in masks.items():
                shear_series = regional_shear_series(u850, v850, u200, v200, mask)
                rh_series = rh_mid[:, mask].mean(axis=1)
                _put(fields["shear_ms"], region, year, month, _round_stats(temporal_stats(shear_series)))
                _put(fields["rh_mid_pct"], region, year, month, _round_stats(temporal_stats(rh_series)))

        sst_months, sst_c, sst_lat, sst_lon = _read_sst_year(year)
        if not (np.array_equal(sst_lat, plev_lat) and np.array_equal(sst_lon, plev_lon)):
            raise ValueError(f"{year}: SST grid disagrees with the pressure-level grid")
        sst_masks = _region_masks(sst_lat, sst_lon)
        for month in MONTHS:
            sel = sst_months == int(month)
            if not sel.any():
                raise ValueError(f"{year}: SST file has no timesteps for month {month}")
            sst_month = sst_c[sel]
            for region, mask in sst_masks.items():
                series = _sst_regional_series(sst_month, mask)
                _put(fields["sst_c"], region, year, month, _round_stats(temporal_stats(series)))

    return {
        "version": 1,
        "sourceTag": SOURCE_TAG,
        "years": list(YEARS),
        "regions": {
            "belt": "lat <= 19.0 N (genesis belt, mirrors bake/era5.py)",
            "domain": "50-70E 15-27N",
        },
        "fields": fields,
    }


def _fmt_cell(stats: dict) -> str:
    return f"{stats['mean']:.2f} +/- {stats['std']:.2f} (p95 {stats['p95']:.2f})"


def render_markdown(result: dict) -> str:
    lines = [
        "<!-- generated by bake/realism_env_variance.py — do not hand-edit -->",
        "",
        "# R1 env-variance study: what env.bin's monthly planes erase",
        "",
        f"Source: `{result['sourceTag']}`. Years: "
        f"{', '.join(str(y) for y in result['years'])}. Regions: "
        f"belt = {result['regions']['belt']}; domain = {result['regions']['domain']}.",
        "",
        "Each cell is the 6-hourly regional-mean series' `mean +/- std (p95)` for "
        "that month, computed from ERA5 (see `bake/realism_env_variance.py` for "
        "exact definitions). This is within-month variability env.bin's single "
        "per-plane monthly value cannot represent.",
        "",
    ]
    for field, regions in result["fields"].items():
        for region, by_year in regions.items():
            lines.append(f"## {FIELD_LABELS[field]} — {REGION_LABELS[region]}")
            lines.append("")
            header = "| month | " + " | ".join(str(y) for y in result["years"]) + " |"
            sep = "|---" * (1 + len(result["years"])) + "|"
            lines.append(header)
            lines.append(sep)
            for month in MONTHS:
                row = [month]
                for year in result["years"]:
                    stats = by_year.get(str(year), {}).get(month)
                    row.append(_fmt_cell(stats) if stats else "-")
                lines.append("| " + " | ".join(row) + " |")
            lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    result = run_study()
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    with open(OUT_JSON, "w", newline="\n") as fh:
        json.dump(result, fh, indent=2, sort_keys=False)
        fh.write("\n")
    with open(OUT_MD, "w", newline="\n") as fh:
        fh.write(render_markdown(result))
    print(f"wrote {OUT_JSON}")
    print(f"wrote {OUT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
