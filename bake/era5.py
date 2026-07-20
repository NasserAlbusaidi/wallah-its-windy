"""era5.py — REAL ERA5 climatological steering + shear (replaces synth when present).

Reads data/raw/era5_climatology.nc (submitted by bake/fetch_era5.py: monthly-mean
u/v at 850/500/250/200 hPa, 1991-2020, May-Nov, 50-70E/15-27N, 0.5 deg) and
exposes the SAME steering_shear(ELAT, ELON, month) contract as synth.py, so
bake.py/spike_tracks.py pick whichever source is available.

Definitions (documented, standard-simple at this altitude):
  * Deep-layer steering = pressure-weighted mean of the 850/500/250 hPa winds
    (weights proportional to pressure: 0.531/0.313/0.156) — heavier air steers more.
  * Shear = |V(200) - V(850)| computed per (year, month) FIRST, then averaged over
    the 30 years. Mean-of-magnitudes, not magnitude-of-means: storms feel each
    year's shear vector, and opposing-direction years must not cancel to calm.

The file is netCDF4 (HDF5 container), read with h5py — no new dependencies.
Coordinate/variable names are discovered defensively because the post-2024 CDS
converter has shifted names (valid_time vs time vs date, etc.).
"""

from __future__ import annotations

import datetime as _dt
import os

import numpy as np

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")
CLIM_PATH = os.path.join(RAW_DIR, "era5_climatology.nc")

IS_SYNTHETIC = False
TAG = "ERA5-CLIM-1991-2020"

# D10 remedy (spike FAILed on monthly means: keep-ratio 16% in June): ship K
# distinct real YEARS per month as nt planes instead of the 30-year mean. The
# runtime picks a plane per spawn from the seed, so same-spot re-spawns feel
# genuinely different synoptic regimes while sim = f(spawn, month, seed) holds.
SAMPLES_PER_MONTH = 4

# Post-monsoon rescue (C6 nov_remedy, data-side). Farthest-point sampling on the
# STEERING field alone can strand a month with no calm-shear plane even when calm
# years exist in the record — November's diversity picks were all >=14 m/s belt
# shear, so seed%K never escaped a hostile regime and 0/32 test storms reached
# Cat-1. Fix: if a genuinely calm year exists (belt shear < CALM_BELT_SHEAR_MS)
# but no current pick captured it, swap the calmest real year in for the least-
# typical pick. Gated so ONLY all-hostile months change; June's calmest belt
# shear (~18.5) stays above the threshold, so June/May/Jul/Aug/Sep/Oct picks are
# byte-identical (zero blast radius on existing seeds, URLs, and the demo pin).
GENESIS_BELT_LAT_MAX = 19.0  # deg N; the low-latitude genesis belt
CALM_BELT_SHEAR_MS = 13.0    # below this a plane is a survivable regime

STEER_LEVELS = (850.0, 500.0, 250.0)
SHEAR_LEVELS = (850.0, 200.0)

_TIME_NAMES = ("valid_time", "time", "date", "forecast_reference_time")
_LEVEL_NAMES = ("pressure_level", "level", "plev", "isobaricInhPa")
_LAT_NAMES = ("latitude", "lat")
_LON_NAMES = ("longitude", "lon")

_cache: dict[
    int,
    tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray],
] | None = None
# Per-year fields for synoptic sampling:
# month -> (years[n], steerU, steerV, shearMagnitude, shearU, shearV).
_yearly: dict[
    int,
    tuple[
        np.ndarray,
        np.ndarray,
        np.ndarray,
        np.ndarray,
        np.ndarray,
        np.ndarray,
    ],
] | None = None
_axes: tuple[np.ndarray, np.ndarray] | None = None  # (lat ascending, lon ascending)


def available() -> bool:
    return os.path.exists(CLIM_PATH) and os.path.getsize(CLIM_PATH) > 0


def banner() -> str:
    return (
        "\n" + "#" * 62 + "\n"
        f"##  env.bin steering (u,v) + shear are REAL ({TAG})  ##\n"
        "##  Deep-layer mean 850/500/250; shear |V200-V850|, 30-yr mean ##\n"
        + "#" * 62 + "\n"
    )


def _find(f, names):  # h5py.File, candidate names -> dataset
    for n in names:
        if n in f:
            return f[n], n
    raise KeyError(f"era5_climatology.nc: none of {names} present; keys={list(f.keys())}")


def _unpack(ds) -> np.ndarray:
    """Apply CF packing (scale_factor/add_offset, _FillValue -> nan)."""
    a = np.asarray(ds[...], dtype=np.float64)
    fill = ds.attrs.get("_FillValue")
    if fill is not None:
        a[a == np.asarray(fill, dtype=a.dtype)] = np.nan
    scale = float(np.asarray(ds.attrs.get("scale_factor", 1.0)))
    offset = float(np.asarray(ds.attrs.get("add_offset", 0.0)))
    return a * scale + offset


def _dates_from_time(ds) -> tuple[np.ndarray, np.ndarray]:
    """(year, month 1..12) per time entry, tolerating CDS unit variants."""
    vals = np.asarray(ds[...])
    units = ds.attrs.get("units", b"")
    units = units.decode() if isinstance(units, bytes) else str(units)
    if "since" in units:
        head, _, epoch_s = units.partition(" since ")
        epoch = _dt.datetime.fromisoformat(epoch_s.strip().replace("Z", "+00:00").split("+")[0])
        per = {"seconds": 1, "hours": 3600, "days": 86400}[head.strip().split()[0]]
        stamps = [epoch + _dt.timedelta(seconds=float(v) * per) for v in vals]
        return np.array([d.year for d in stamps]), np.array([d.month for d in stamps])
    # Fallback: YYYYMMDD integers (some monthly products ship a 'date' coord).
    return (
        np.array([int(str(int(v))[0:4]) for v in vals]),
        np.array([int(str(int(v))[4:6]) for v in vals]),
    )


def _load() -> None:
    """Parse the netCDF once into per-month climatological AND per-year fields."""
    global _cache, _yearly, _axes
    if _cache is not None:
        return
    import h5py

    with h5py.File(CLIM_PATH, "r") as f:
        time_ds, _ = _find(f, _TIME_NAMES)
        lev_ds, _ = _find(f, _LEVEL_NAMES)
        lat_ds, _ = _find(f, _LAT_NAMES)
        lon_ds, _ = _find(f, _LON_NAMES)
        years, months = _dates_from_time(time_ds)
        levels = np.asarray(lev_ds[...], dtype=np.float64)
        lat = np.asarray(lat_ds[...], dtype=np.float64)
        lon = np.asarray(lon_ds[...], dtype=np.float64)
        u = _unpack(_find(f, ("u",))[0])  # [time, level, lat, lon]
        v = _unpack(_find(f, ("v",))[0])

    if u.ndim != 4:
        raise ValueError(f"expected u[time,level,lat,lon], got shape {u.shape}")

    def li(p: float) -> int:
        i = int(np.argmin(np.abs(levels - p)))
        if abs(levels[i] - p) > 1:
            raise ValueError(f"level {p} hPa not in file (has {levels})")
        return i

    w = np.array(STEER_LEVELS) / sum(STEER_LEVELS)  # pressure-proportional weights
    steer_idx = [li(p) for p in STEER_LEVELS]
    i850, i200 = li(SHEAR_LEVELS[0]), li(SHEAR_LEVELS[1])

    # Normalise axes ascending for interpolation (ERA5 ships lat descending).
    flip_lat = lat[0] > lat[-1]
    flip = (lambda a: a[..., ::-1, :]) if flip_lat else (lambda a: a)

    cache: dict[
        int,
        tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray],
    ] = {}
    yearly: dict[
        int,
        tuple[
            np.ndarray,
            np.ndarray,
            np.ndarray,
            np.ndarray,
            np.ndarray,
            np.ndarray,
        ],
    ] = {}
    for cal_month in sorted(set(months.tolist())):
        sel = months == cal_month
        yr = years[sel]
        u_y = flip(np.tensordot(w, u[sel][:, steer_idx], axes=(0, 1)))  # [nyear, ny, nx]
        v_y = flip(np.tensordot(w, v[sel][:, steer_idx], axes=(0, 1)))
        shear_u_y = flip(u[sel][:, i200] - u[sel][:, i850])
        shear_v_y = flip(v[sel][:, i200] - v[sel][:, i850])
        shear_y = np.hypot(shear_u_y, shear_v_y)
        m0 = cal_month - 1  # store 0-indexed like SEASON_MONTHS
        yearly[m0] = (yr, u_y, v_y, shear_y, shear_u_y, shear_v_y)
        cache[m0] = (
            u_y.mean(axis=0),
            v_y.mean(axis=0),
            shear_y.mean(axis=0),
            shear_u_y.mean(axis=0),
            shear_v_y.mean(axis=0),
        )

    if flip_lat:
        lat = lat[::-1]
    _axes = (lat, lon)
    _cache = cache
    _yearly = yearly


def _belt_shear_per_year(shear_y: np.ndarray) -> np.ndarray:
    """Per-year mean shear (m/s) in the low-latitude genesis belt (native cells,
    lat <= GENESIS_BELT_LAT_MAX). Domain-band proxy for the per-year post-monsoon
    calm test — cheaper than sampling genesis points and monotone with them."""
    assert _axes is not None
    lat, _lon = _axes
    mask = lat <= GENESIS_BELT_LAT_MAX
    if not mask.any():
        mask = np.ones_like(lat, dtype=bool)
    return shear_y[:, mask, :].mean(axis=(1, 2))


def _pick_sample_years(u_y: np.ndarray, v_y: np.ndarray, shear_y: np.ndarray, k: int) -> list[int]:
    """Indices of k diverse-but-real years via deterministic farthest-point pick.

    Seed with the most TYPICAL year (closest to the mean field), then greedily
    add the year farthest (RMS over the concatenated u,v field) from all picks —
    one representative regime plus the spread of real alternatives.

    Post-monsoon rescue (C6): if a genuinely calm-shear year exists in the record
    (belt shear < CALM_BELT_SHEAR_MS) but no steering-diversity pick captured one,
    replace the least-typical pick with the calmest real year, so seed%K can land
    on a survivable regime. Gated on the calmest-year value, so months whose calm
    floor is above the threshold (e.g. June) keep byte-identical picks.
    """
    n = u_y.shape[0]
    flat = np.concatenate([u_y.reshape(n, -1), v_y.reshape(n, -1)], axis=1)
    mean = flat.mean(axis=0, keepdims=True)
    picks = [int(np.argmin(np.linalg.norm(flat - mean, axis=1)))]
    while len(picks) < min(k, n):
        dmin = np.min(
            np.stack([np.linalg.norm(flat - flat[p][None, :], axis=1) for p in picks]), axis=0
        )
        dmin[picks] = -1.0
        picks.append(int(np.argmax(dmin)))
    if len(picks) > 1:
        belt = _belt_shear_per_year(shear_y)
        calmest = int(np.argmin(belt))
        picked_floor = min(float(belt[p]) for p in picks)
        if (
            float(belt[calmest]) < CALM_BELT_SHEAR_MS
            and picked_floor >= CALM_BELT_SHEAR_MS
            and calmest not in picks
        ):
            # Keep plane 0 (typical) and the earlier diversity planes; the last
            # (most-extreme) pick is the one traded for the calm regime.
            picks[-1] = calmest
    return picks


def _post_monsoon_thermodynamic_rescue(
    years: np.ndarray,
    shear_y: np.ndarray,
    picks: list[int],
) -> list[int]:
    """Guarantee two real November regimes jointly support moisture + low shear.

    Wind-only diversity previously selected the absolutely calmest 2020 plane,
    but ERA5 shows that plane was exceptionally dry aloft. Once RH became a real
    model input, that "rescue" was no rescue at all. Rank real years by genesis-
    belt RH subject to observed belt shear <17 m/s and use the best two as the
    tail planes, preserving the typical/diverse head planes.
    """
    import era5_humidity

    era5_humidity._load()
    assert era5_humidity._yearly is not None
    humidity_years, humidity_y = era5_humidity._yearly[10]
    if not np.array_equal(humidity_years, years):
        raise ValueError("November ERA5 wind/RH years are not aligned")
    assert _axes is not None
    lat, _lon = _axes
    belt = lat <= GENESIS_BELT_LAT_MAX
    shear_mean = shear_y[:, belt, :].mean(axis=(1, 2))
    humidity_mean = humidity_y[:, belt, :].mean(axis=(1, 2))
    viable = [
        index
        for index in range(len(years))
        if float(shear_mean[index]) < 17.0
    ]
    viable.sort(
        key=lambda index: (
            -float(humidity_mean[index]),
            float(shear_mean[index]),
            int(years[index]),
        )
    )
    rescued = viable[: min(2, len(viable))]
    if len(rescued) < 2 or len(picks) < 2:
        return picks
    head = [index for index in picks if index not in rescued][: len(picks) - 2]
    # If a rescued year was already in the head, fill from the original picks.
    for index in picks:
        if len(head) >= len(picks) - 2:
            break
        if index not in head and index not in rescued:
            head.append(index)
    return head + rescued


def _to_env_grid(field: np.ndarray, elat: np.ndarray, elon: np.ndarray) -> np.ndarray:
    """Bilinear-interpolate one native-grid field onto the env cell centers."""
    from scipy.interpolate import RegularGridInterpolator

    assert _axes is not None
    if np.isnan(field).any():
        raise ValueError("ERA5 field contains NaN inside the domain — bad download?")
    lat, lon = _axes
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=False, fill_value=None)
    pts = np.stack([elat.ravel(), elon.ravel()], axis=-1)
    return interp(pts).reshape(elat.shape).astype(np.float64)


def steering_shear(
    elat: np.ndarray, elon: np.ndarray, month: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """REAL 30-yr-mean deep-layer steering (u,v) + shear; synth-compatible."""
    u, v, s, _su, _sv = steering_shear_vector(elat, elon, month)
    return u, v, s


def steering_shear_vector(
    elat: np.ndarray, elon: np.ndarray, month: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Steering plus 200–850 hPa shear magnitude and vector components."""
    _load()
    assert _cache is not None
    if month not in _cache:
        raise KeyError(f"month {month} not in ERA5 climatology (has {sorted(_cache)})")
    u, v, s, su, sv = (
        _to_env_grid(field, elat, elon) for field in _cache[month]
    )
    return u, v, s, su, sv


def steering_shear_samples(
    elat: np.ndarray, elon: np.ndarray, month: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[int]]:
    """K diverse REAL years' fields on the env grid: (u[k,ny,nx], v, shear, years).

    Samples are whole coherent year-months (steering AND shear from the same
    year), ordered typical-first (pick order), so plane 0 is the representative
    regime and planes 1..k-1 are the spread. The runtime selects a plane per
    spawn from the seed (see src/env-sampler.ts).
    """
    u, v, s, _su, _sv, years = steering_shear_samples_vector(
        elat, elon, month
    )
    return u, v, s, years


def steering_shear_samples_vector(
    elat: np.ndarray, elon: np.ndarray, month: int
) -> tuple[
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    np.ndarray,
    list[int],
]:
    """K coherent real-year steering and shear-vector fields on the env grid."""
    _load()
    assert _yearly is not None
    if month not in _yearly:
        raise KeyError(f"month {month} not in ERA5 climatology (has {sorted(_yearly)})")
    yr, u_y, v_y, shear_y, shear_u_y, shear_v_y = _yearly[month]
    idx = _pick_sample_years(u_y, v_y, shear_y, SAMPLES_PER_MONTH)
    if month == 10:
        idx = _post_monsoon_thermodynamic_rescue(yr, shear_y, idx)
    u = np.stack([_to_env_grid(u_y[i], elat, elon) for i in idx])
    v = np.stack([_to_env_grid(v_y[i], elat, elon) for i in idx])
    s = np.stack([_to_env_grid(shear_y[i], elat, elon) for i in idx])
    su = np.stack([_to_env_grid(shear_u_y[i], elat, elon) for i in idx])
    sv = np.stack([_to_env_grid(shear_v_y[i], elat, elon) for i in idx])
    return u, v, s, su, sv, [int(yr[i]) for i in idx]
