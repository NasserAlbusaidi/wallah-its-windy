"""era5_event.py — aligned event forcing for hindcasts and counterfactuals.

Reads per-event ERA5 hourly winds, 600/700-hPa RH, and SST plus WOA23 OHC. It
emits a WIWB env bin whose eight layers share one 3-hourly TIME axis instead of
the climatology's frozen real-year samples. Format bytes are IDENTICAL to
env.bin; only the consumer-side nt interpretation differs.

Derivation reuses era5.py exactly (same deep-layer steering weights, same shear
definition, same lat-descending -> north-first row order):
  * deep-layer steering = pressure-weighted mean of 850/500/250 hPa winds;
  * shear = |V(200) - V(850)| per timestep.

VORTEX FILTER (lead decision, C2): the event winds contain the real storm's own
vortex. We wash it out with scipy.ndimage.gaussian_filter, sigma=3 cells (=1.5°)
on the NATIVE 0.5° grid, applied to every wind field per time plane BEFORE
regridding, so
the baked wind field is the large-scale environment a free simulated vortex
would feel, not its observed vortex fed back as steering. RH is smoothed at the
same scale; SST retains the observed event-time surface signal. Spatial filtering is
independent per plane, so we decimate to 3-hourly first (cheaper), then filter,
then regrid; the result is identical to filter-then-decimate.

WOA23 OHC is monthly climatology selected by each chronological plane's calendar
month; it is not an event-specific subsurface ocean analysis.
"""

from __future__ import annotations

import datetime as _dt
import os

import numpy as np
from scipy import ndimage

import binfmt
import era5
import sources
import woa23
from binfmt import Layer

VORTEX_SIGMA = 3.0  # gaussian_filter sigma in native 0.5-deg cells (=1.5 deg)
DECIMATE = 3  # 3-hourly: stride over the hourly series
QUANT_SCALE = 0.01
SST_OFFSET = 20.0


def _read_uv(nc_path: str):
    """(valid_time[int64 s], u[T,L,ny,nx], v, lat[desc], lon[asc], levels)."""
    import h5py

    with h5py.File(nc_path, "r") as f:
        vt = np.asarray(f["valid_time"][...], dtype=np.int64)
        levels = np.asarray(f["pressure_level"][...], dtype=np.float64)
        lat = np.asarray(f["latitude"][...], dtype=np.float64)
        lon = np.asarray(f["longitude"][...], dtype=np.float64)
        u = era5._unpack(f["u"])  # CF unpack (scale/offset/_FillValue) — reuse
        v = era5._unpack(f["v"])
    if u.ndim != 4:
        raise ValueError(f"{nc_path}: expected u[time,level,lat,lon], got {u.shape}")
    return vt, u, v, lat, lon, levels


def _read_rh(nc_path: str):
    """(valid_time, mean 600/700-hPa RH[T,ny,nx], lat, lon)."""
    import h5py

    with h5py.File(nc_path, "r") as f:
        vt = np.asarray(f["valid_time"][...], dtype=np.int64)
        levels = np.asarray(f["pressure_level"][...], dtype=np.float64)
        lat = np.asarray(f["latitude"][...], dtype=np.float64)
        lon = np.asarray(f["longitude"][...], dtype=np.float64)
        rh4 = era5._unpack(f["r"])
    wanted = [_level_index(levels, 600.0), _level_index(levels, 700.0)]
    rh = np.nanmean(rh4[:, wanted], axis=1)
    return vt, rh, lat, lon


def _read_sst(nc_path: str):
    """(valid_time, SST Celsius[T,ny,nx], lat, lon)."""
    import h5py

    with h5py.File(nc_path, "r") as f:
        vt = np.asarray(f["valid_time"][...], dtype=np.int64)
        lat = np.asarray(f["latitude"][...], dtype=np.float64)
        lon = np.asarray(f["longitude"][...], dtype=np.float64)
        sst = era5._unpack(f["sst"])
    if sst.ndim == 4 and sst.shape[1] == 1:
        sst = sst[:, 0]
    if sst.ndim != 3:
        raise ValueError(f"{nc_path}: expected sst[time,lat,lon], got {sst.shape}")
    # ERA5 SST is Kelvin.
    return vt, sst - 273.15, lat, lon


def _load_series(nc_paths: list[str]):
    """Concatenate one or more event files along time into a single continuous
    hourly series, sorted by valid_time. Asserts a strictly increasing hourly
    axis (no gap / overlap) so a two-file storm (Shaheen _09 + _10) stitches
    cleanly."""
    parts = [_read_uv(p) for p in nc_paths]
    lat, lon, levels = parts[0][3], parts[0][4], parts[0][5]
    for _, _, _, la, lo, lv in parts[1:]:
        if not (np.array_equal(la, lat) and np.array_equal(lo, lon) and np.array_equal(lv, levels)):
            raise ValueError("event files disagree on grid/levels; cannot concatenate")
    vt = np.concatenate([p[0] for p in parts])
    u = np.concatenate([p[1] for p in parts], axis=0)
    v = np.concatenate([p[2] for p in parts], axis=0)
    order = np.argsort(vt, kind="stable")
    vt, u, v = vt[order], u[order], v[order]
    dt = np.diff(vt)
    if vt.size > 1 and not np.all(dt == 3600):
        raise ValueError(f"non-hourly / discontinuous valid_time (diffs seen: {set(dt.tolist())})")
    return vt, u, v, lat, lon, levels


def _load_scalar_series(nc_paths: list[str], reader):
    parts = [reader(path) for path in nc_paths]
    lat, lon = parts[0][2], parts[0][3]
    for _, _, la, lo in parts[1:]:
        if not (np.array_equal(la, lat) and np.array_equal(lo, lon)):
            raise ValueError("event scalar files disagree on grid; cannot concatenate")
    vt = np.concatenate([part[0] for part in parts])
    field = np.concatenate([part[1] for part in parts], axis=0)
    order = np.argsort(vt, kind="stable")
    vt, field = vt[order], field[order]
    dt = np.diff(vt)
    if vt.size > 1 and not np.all(dt == 3600):
        raise ValueError(f"non-hourly / discontinuous scalar valid_time: {set(dt.tolist())}")
    return vt, field, lat, lon


def _level_index(levels: np.ndarray, p: float) -> int:
    i = int(np.argmin(np.abs(levels - p)))
    if abs(levels[i] - p) > 1.0:
        raise ValueError(f"level {p} hPa not in file (has {levels.tolist()})")
    return i


def native_steer_shear(u4: np.ndarray, v4: np.ndarray, levels: np.ndarray):
    """Per-timestep steering plus 200–850 hPa shear magnitude/components."""
    w = np.array(era5.STEER_LEVELS) / sum(era5.STEER_LEVELS)
    steer_idx = [_level_index(levels, p) for p in era5.STEER_LEVELS]
    i850 = _level_index(levels, era5.SHEAR_LEVELS[0])
    i200 = _level_index(levels, era5.SHEAR_LEVELS[1])
    u_steer = np.tensordot(w, u4[:, steer_idx], axes=(0, 1))  # [T,ny,nx]
    v_steer = np.tensordot(w, v4[:, steer_idx], axes=(0, 1))
    shear_u = u4[:, i200] - u4[:, i850]
    shear_v = v4[:, i200] - v4[:, i850]
    shear = np.hypot(shear_u, shear_v)
    return u_steer, v_steer, shear, shear_u, shear_v


def _vortex_filter(field3d: np.ndarray) -> np.ndarray:
    """gaussian_filter over the two spatial axes only (sigma 0 on time)."""
    return ndimage.gaussian_filter(
        field3d, sigma=(0.0, VORTEX_SIGMA, VORTEX_SIGMA), mode="nearest"
    )


def _regrid_series(field3d: np.ndarray, lat_native: np.ndarray, lon_native: np.ndarray,
                   elat: np.ndarray, elon: np.ndarray) -> np.ndarray:
    """Bilinear-interpolate [P,ny,nx] native planes onto the env cell centers,
    mirroring era5._to_env_grid: flip native lat to ascending for the
    interpolator; the OUTPUT row order is north-first because elat is
    north-first (row 0 = latMax)."""
    from scipy.interpolate import RegularGridInterpolator

    flip = lat_native[0] > lat_native[-1]
    lat_asc = lat_native[::-1] if flip else lat_native
    pts = np.stack([elat.ravel(), elon.ravel()], axis=-1)
    out = np.empty((field3d.shape[0], elat.shape[0], elat.shape[1]), dtype=np.float64)
    for p in range(field3d.shape[0]):
        plane = field3d[p, ::-1, :] if flip else field3d[p]
        if np.isnan(plane).any():
            raise ValueError("event field contains NaN inside the domain — bad download?")
        interp = RegularGridInterpolator((lat_asc, lon_native), plane,
                                         bounds_error=False, fill_value=None)
        out[p] = interp(pts).reshape(elat.shape)
    return out


def _nearest_valid_fill_series(field3d: np.ndarray) -> np.ndarray:
    """Fill land/missing cells from the nearest valid ocean cell per plane."""
    out = np.asarray(field3d, dtype=np.float64).copy()
    for plane_index in range(out.shape[0]):
        plane = out[plane_index]
        missing = ~np.isfinite(plane)
        if not missing.any():
            continue
        if missing.all():
            raise ValueError("event scalar plane contains no valid cells")
        nearest = ndimage.distance_transform_edt(
            missing,
            return_distances=False,
            return_indices=True,
        )
        out[plane_index] = plane[tuple(nearest)]
    return out


def _q_i16(a: np.ndarray, scale: float, offset: float) -> np.ndarray:
    raw = np.round((a - offset) / scale)
    if raw.min() < -32768 or raw.max() > 32767:
        raise ValueError(f"int16 overflow: raw range {raw.min()}..{raw.max()} (scale {scale})")
    return np.clip(raw, -32768, 32767).astype(np.int16).ravel(order="C")


def _interpolated_ohc(timestamp: int) -> np.ndarray:
    """Linearly interpolate WOA23 monthly means between month midpoints.

    A monthly analysed field represents conditions near the middle of its month,
    not a step at 00Z on day one. Interpolating adjacent month centres prevents
    an artificial three-hour OHC cliff in event bins that cross a month boundary.
    """
    when = _dt.datetime.fromtimestamp(int(timestamp), _dt.timezone.utc)
    centre = _dt.datetime(
        when.year,
        when.month,
        15,
        12,
        tzinfo=_dt.timezone.utc,
    )
    if when >= centre:
        if when.month == 12:
            neighbour = _dt.datetime(
                when.year + 1,
                1,
                15,
                12,
                tzinfo=_dt.timezone.utc,
            )
        else:
            neighbour = _dt.datetime(
                when.year,
                when.month + 1,
                15,
                12,
                tzinfo=_dt.timezone.utc,
            )
        first_month = when.month - 1
        second_month = neighbour.month - 1
        weight = (when - centre).total_seconds() / (
            neighbour - centre
        ).total_seconds()
    else:
        if when.month == 1:
            neighbour = _dt.datetime(
                when.year - 1,
                12,
                15,
                12,
                tzinfo=_dt.timezone.utc,
            )
        else:
            neighbour = _dt.datetime(
                when.year,
                when.month - 1,
                15,
                12,
                tzinfo=_dt.timezone.utc,
            )
        first_month = neighbour.month - 1
        second_month = when.month - 1
        weight = (when - neighbour).total_seconds() / (
            centre - neighbour
        ).total_seconds()
    first = woa23.load_ohc(first_month)
    second = woa23.load_ohc(second_month)
    return first + (second - first) * min(1.0, max(0.0, weight))


def assemble_event_layers(mm: str, sst_env: np.ndarray,
                          u_env: np.ndarray, v_env: np.ndarray,
                          shr_env: np.ndarray, shu_env: np.ndarray,
                          shv_env: np.ndarray, rh_env: np.ndarray,
                          ohc_env: np.ndarray) -> list[Layer]:
    """Build eight month-suffixed layers on one chronological event axis."""
    nx, ny = sources.ENV_NX, sources.ENV_NY
    nt = u_env.shape[0]
    dom = sources.DOMAIN
    return [
        Layer(f"sst_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, SST_OFFSET,
              _q_i16(sst_env, QUANT_SCALE, SST_OFFSET)),
        Layer(f"u_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(u_env, QUANT_SCALE, 0.0)),
        Layer(f"v_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(v_env, QUANT_SCALE, 0.0)),
        Layer(f"shr_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shr_env, QUANT_SCALE, 0.0)),
        Layer(f"shu_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shu_env, QUANT_SCALE, 0.0)),
        Layer(f"shv_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shv_env, QUANT_SCALE, 0.0)),
        Layer(f"rh_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(rh_env, QUANT_SCALE, 0.0)),
        Layer(f"ohc_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(ohc_env, QUANT_SCALE, 0.0)),
    ]


def _sst_raw_from_env(env_bin_path: str, mm: str) -> np.ndarray:
    """Recover the exact int16 raw sst_MM plane from the committed env.bin (parse
    dequantizes to float; re-quantize with the identical scale/offset to get the
    original int16 back byte-for-byte)."""
    parsed = binfmt.parse_bin(open(env_bin_path, "rb").read())
    layer = parsed[f"sst_{mm}"]
    return _q_i16(layer.data.astype(np.float64), layer.scale, layer.offset)


def _vortex_diagnostic(vt_dec, lat_native, lon_native, u_raw, v_raw, u_sm, v_sm, track_points):
    """mean |raw-smoothed| steering SPEED at real track positions vs far-field.
    For each decimated plane, use the storm fix nearest that plane's time; near =
    the fix's native cell, far = cells > 4 deg away. Returns (near, far)."""
    if not track_points:
        return None
    fixes = []
    for pt in track_points:
        if pt["lat"] is None or pt["lon"] is None:
            continue
        t = _dt.datetime.strptime(pt["iso"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=_dt.timezone.utc)
        fixes.append((int(t.timestamp()), float(pt["lat"]), float(pt["lon"])))
    if not fixes:
        return None
    ft = np.array([f[0] for f in fixes])
    dom = sources.DOMAIN
    LON, LAT = np.meshgrid(lon_native, lat_native)  # native [ny,nx]
    raw_spd = np.hypot(u_raw, v_raw)
    sm_spd = np.hypot(u_sm, v_sm)
    diff = np.abs(raw_spd - sm_spd)  # [P,ny,nx]
    near_vals, far_vals = [], []
    for p, t in enumerate(vt_dec):
        k = int(np.argmin(np.abs(ft - int(t))))
        _, fla, flo = fixes[k]
        if not (dom[0] <= flo <= dom[1] and dom[2] <= fla <= dom[3]):
            continue
        r = int(np.argmin(np.abs(lat_native - fla)))
        c = int(np.argmin(np.abs(lon_native - flo)))
        near_vals.append(float(diff[p, r, c]))
        dist = np.hypot(LAT - fla, LON - flo)
        far_vals.append(float(diff[p][dist > 4.0].mean()))
    if not near_vals:
        return None
    return float(np.mean(near_vals)), float(np.mean(far_vals))


def build_event_env(tag: str, month_index: int, nc_paths: list[str],
                    rh_paths: list[str], sst_paths: list[str],
                    out_dir: str, track_points=None) -> dict:
    """Bake one event env bin. Returns a diagnostics dict (path, planes, windowH,
    layer names, quant ranges, vortex near/far diagnostic)."""
    vt, u4, v4, lat_native, lon_native, levels = _load_series(nc_paths)
    rh_vt, rh3, rh_lat, rh_lon = _load_scalar_series(rh_paths, _read_rh)
    sst_vt, sst3, sst_lat, sst_lon = _load_scalar_series(sst_paths, _read_sst)
    if not (np.array_equal(vt, rh_vt) and np.array_equal(vt, sst_vt)):
        raise ValueError("wind, humidity, and SST event time axes disagree")

    # 3-hourly decimation first (spatial filter is per-plane; order-independent).
    vt_dec = vt[::DECIMATE]
    u4d, v4d = u4[::DECIMATE], v4[::DECIMATE]
    rh3d = rh3[::DECIMATE]
    sst3d = sst3[::DECIMATE]

    u_raw, v_raw, shr_raw, shu_raw, shv_raw = native_steer_shear(
        u4d, v4d, levels
    )
    u_sm = _vortex_filter(u_raw)
    v_sm = _vortex_filter(v_raw)
    shr_sm = _vortex_filter(shr_raw)
    shu_sm = _vortex_filter(shu_raw)
    shv_sm = _vortex_filter(shv_raw)

    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")  # [ny,nx], row0=north
    u_env = _regrid_series(u_sm, lat_native, lon_native, ELAT, ELON)
    v_env = _regrid_series(v_sm, lat_native, lon_native, ELAT, ELON)
    shr_env = _regrid_series(shr_sm, lat_native, lon_native, ELAT, ELON)
    shu_env = _regrid_series(shu_sm, lat_native, lon_native, ELAT, ELON)
    shv_env = _regrid_series(shv_sm, lat_native, lon_native, ELAT, ELON)
    # Wash out the storm-moistened core just like the wind vortex; SST is kept
    # unsmoothed because the observed cold wake is a desired hindcast signal.
    rh_env = _regrid_series(
        _vortex_filter(rh3d),
        rh_lat,
        rh_lon,
        ELAT,
        ELON,
    )
    rh_env = np.clip(rh_env, 0.0, 100.0)
    sst_env = _regrid_series(
        _nearest_valid_fill_series(sst3d),
        sst_lat,
        sst_lon,
        ELAT,
        ELON,
    )

    # WOA23 supplies monthly subsurface profiles. Interpolate between month
    # centres so a calendar boundary cannot introduce an artificial OHC step.
    ohc_env = np.stack(
        [
            _interpolated_ohc(int(timestamp))
            for timestamp in vt_dec
        ]
    )

    mm = f"{month_index:02d}"
    layers = assemble_event_layers(
        mm,
        sst_env,
        u_env,
        v_env,
        shr_env,
        shu_env,
        shv_env,
        rh_env,
        ohc_env,
    )

    path = os.path.join(out_dir, f"env_{tag}.bin")
    binfmt.write_bin(path, layers)

    planes = u_env.shape[0]
    diag = _vortex_diagnostic(vt_dec, lat_native, lon_native, u_raw, v_raw, u_sm, v_sm, track_points)
    return {
        "tag": tag, "path": path, "planes": planes,
        "windowH": (planes - 1) * DECIMATE, "monthIndex": month_index,
        "layers": [ly.name for ly in layers],
        "u_range": (float(u_env.min()), float(u_env.max())),
        "shr_range": (float(shr_env.min()), float(shr_env.max())),
        "rh_range": (float(rh_env.min()), float(rh_env.max())),
        "sst_range": (float(sst_env.min()), float(sst_env.max())),
        "ohc_range": (float(ohc_env.min()), float(ohc_env.max())),
        "vortex_near_far": diag,
        "start_iso": _dt.datetime.fromtimestamp(int(vt[0]), _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def build_pressure_wind_sidecar(nc_paths: list[str], output_path: str) -> dict:
    """Bake aligned, individually vortex-filtered 850/500/250-hPa winds.

    This is a separate HF-3 artifact so adding pressure levels cannot mutate the
    frozen HF-1/HF-2 environment bytes. All six layers share the same 3-hourly
    axis and grid; filtering happens at each native pressure level before
    regridding and depth weighting.
    """
    vt, u4, v4, lat_native, lon_native, levels = _load_series(nc_paths)
    vt_dec = vt[::DECIMATE]
    u4d, v4d = u4[::DECIMATE], v4[::DECIMATE]
    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")
    fields: dict[str, np.ndarray] = {}
    for pressure in (850, 500, 250):
        index = _level_index(levels, float(pressure))
        fields[f"u{pressure}"] = _regrid_series(
            _vortex_filter(u4d[:, index]), lat_native, lon_native, ELAT, ELON
        )
        fields[f"v{pressure}"] = _regrid_series(
            _vortex_filter(v4d[:, index]), lat_native, lon_native, ELAT, ELON
        )
    nx, ny = sources.ENV_NX, sources.ENV_NY
    layers = [
        Layer(name, "int16", True, nx, ny, values.shape[0], sources.DOMAIN,
              QUANT_SCALE, 0.0, _q_i16(values, QUANT_SCALE, 0.0))
        for name, values in fields.items()
    ]
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    binfmt.write_bin(output_path, layers)
    return {
        "path": output_path,
        "planes": int(vt_dec.size),
        "stepH": DECIMATE,
        "windowH": int((vt_dec.size - 1) * DECIMATE),
        "startIso": _dt.datetime.fromtimestamp(
            int(vt_dec[0]), _dt.timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "levelsHpa": [850, 500, 250],
        "vortexFilterSigmaNativeCells": VORTEX_SIGMA,
    }
