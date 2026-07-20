"""era5_event.py — v1.1 event steering/shear bake (counterfactual env bins).

Reads the per-EVENT ERA5 hourly winds (data/raw/era5_{gonu_2007,shaheen_2021_09,
shaheen_2021_10}.nc) and emits a WIWB env bin whose steering/shear layers carry a TIME
axis (nt = decimated hourly planes, BINARY-FORMATS.md mode 2) instead of the
climatology's synoptic samples. Format bytes are IDENTICAL to env.bin — only the
nt semantics differ, and that is a consumer-side routing convention.

Derivation reuses era5.py exactly (same deep-layer steering weights, same shear
definition, same lat-descending -> north-first row order):
  * deep-layer steering = pressure-weighted mean of 850/500/250 hPa winds;
  * shear = |V(200) - V(850)| per timestep.

VORTEX FILTER (lead decision, C2): the event winds contain the real storm's own
vortex. We wash it out with scipy.ndimage.gaussian_filter, sigma=3 cells (=1.5°)
on the NATIVE 0.5° grid, applied to every wind field per time plane BEFORE
regridding, so
the baked field is the large-scale STEERING environment a counterfactual storm
would feel — not a replay of the historical track. Spatial filtering is
independent per plane, so we decimate to 3-hourly first (cheaper), then filter,
then regrid; the result is identical to filter-then-decimate.

SST is climatological: the event fetch was winds-only, so sst_MM is copied
verbatim (nt=1) from the committed public/data/env.bin.
"""

from __future__ import annotations

import datetime as _dt
import os

import numpy as np
from scipy import ndimage

import binfmt
import era5
import sources
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


def _q_i16(a: np.ndarray, scale: float, offset: float) -> np.ndarray:
    raw = np.round((a - offset) / scale)
    if raw.min() < -32768 or raw.max() > 32767:
        raise ValueError(f"int16 overflow: raw range {raw.min()}..{raw.max()} (scale {scale})")
    return np.clip(raw, -32768, 32767).astype(np.int16).ravel(order="C")


def assemble_event_layers(mm: str, sst_raw_i16: np.ndarray,
                          u_env: np.ndarray, v_env: np.ndarray,
                          shr_env: np.ndarray, shu_env: np.ndarray,
                          shv_env: np.ndarray) -> list[Layer]:
    """Build six month-suffixed layers; SST has nt=1, winds use event time."""
    nx, ny = sources.ENV_NX, sources.ENV_NY
    nt = u_env.shape[0]
    dom = sources.DOMAIN
    return [
        Layer(f"sst_{mm}", "int16", True, nx, ny, 1, dom, QUANT_SCALE, SST_OFFSET,
              np.asarray(sst_raw_i16, dtype=np.int16).ravel(order="C")),
        Layer(f"u_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(u_env, QUANT_SCALE, 0.0)),
        Layer(f"v_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(v_env, QUANT_SCALE, 0.0)),
        Layer(f"shr_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shr_env, QUANT_SCALE, 0.0)),
        Layer(f"shu_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shu_env, QUANT_SCALE, 0.0)),
        Layer(f"shv_{mm}", "int16", True, nx, ny, nt, dom, QUANT_SCALE, 0.0, _q_i16(shv_env, QUANT_SCALE, 0.0)),
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
                    out_dir: str, env_bin_path: str, track_points=None) -> dict:
    """Bake one event env bin. Returns a diagnostics dict (path, planes, windowH,
    layer names, quant ranges, vortex near/far diagnostic)."""
    vt, u4, v4, lat_native, lon_native, levels = _load_series(nc_paths)

    # 3-hourly decimation first (spatial filter is per-plane; order-independent).
    vt_dec = vt[::DECIMATE]
    u4d, v4d = u4[::DECIMATE], v4[::DECIMATE]

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

    mm = f"{month_index:02d}"
    sst_raw = _sst_raw_from_env(env_bin_path, mm)
    layers = assemble_event_layers(
        mm,
        sst_raw,
        u_env,
        v_env,
        shr_env,
        shu_env,
        shv_env,
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
        "vortex_near_far": diag,
        "start_iso": _dt.datetime.fromtimestamp(int(vt[0]), _dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
