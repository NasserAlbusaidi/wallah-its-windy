#!/usr/bin/env python3
"""
spike_tracks.py — track-diversity spike (design D10 / eng task T7, pre-freeze).

Integrates ~20 forward-Euler cyclone tracks from varied spawn points against the
deep-layer STEERING field only — NO WebGL, NO intensity model, NO bake format. The
cheap check the design calls "the highest-leverage 30 lines in the plan": if nearby
spawns collapse onto the same rail, the monthly-mean steering is too smooth and
env.bin should carry 3-5 synoptic samples per month instead. The env.bin `nt`
timestep axis already supports that, so acting on a FAIL is a re-bake, not a format
change (which is exactly why running this late is still cheap).

STATUS — reads synth.steering_shear() (SYNTHETIC_V0), because ERA5 is blocked on
this build machine (no CDS credentials; see the ERA5 TODO in bake/README.md). So it
currently measures the diversity of the *shipped synthetic* steering, and it is the
reference implementation the TS steering integrator is checked against. RE-RUN it
against the real ERA5 fields the moment they land, BEFORE any tuning pass — swapping
the field source is the same one-function swap as the bake
(synth.steering_shear -> ERA5 reader).

Run:  bake/.venv/bin/python bake/spike_tracks.py
"""

from __future__ import annotations

import math

import numpy as np

import era5
import sources
import synth

ENV_SRC = era5 if era5.available() else synth

LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = sources.DOMAIN
# grid.ts METERS_PER_DEG_LAT — the ONE m/s -> deg conversion constant.
METERS_PER_DEG_LAT = 111_320.0

DT_H = 3.0          # integration step, hours (design pacing 1 real s = 3 sim h)
STEPS = 96          # ~12 sim-days; a storm either lands, exits, or stalls by then
# Months to contrast (design success criterion: June vs October differ visibly).
MONTHS = [5, 9]     # 0-indexed: June, October
# ~20 varied ocean spawns on a regular grid (lon x lat), spaced to probe rails.
SPAWN_LONS = [54.0, 57.0, 60.0, 63.0, 66.0]
SPAWN_LATS = [15.5, 17.5, 19.5, 21.5]


def sample_nearest(field: np.ndarray, lat: float, lon: float) -> float:
    """Nearest-cell read (mirror grid.latLonToCell; row 0 = north)."""
    ny, nx = field.shape
    col = round((lon - LON_MIN) / (LON_MAX - LON_MIN) * nx - 0.5)
    row = round((LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * ny - 0.5)
    col = min(max(col, 0), nx - 1)
    row = min(max(row, 0), ny - 1)
    return float(field[row, col])


def integrate(lat0: float, lon0: float, u: np.ndarray, v: np.ndarray) -> tuple[float, float, int]:
    """Advect a parcel by the steering field. Returns (endLat, endLon, stepsAlive)."""
    lat, lon = lat0, lon0
    for step in range(STEPS):
        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            return lat, lon, step
        us = sample_nearest(u, lat, lon)
        vs = sample_nearest(v, lat, lon)
        # m/s -> deg/h, cos-lat correction on the zonal component (grid.ts).
        dlon = us * 3600.0 / (METERS_PER_DEG_LAT * math.cos(math.radians(lat)))
        dlat = vs * 3600.0 / METERS_PER_DEG_LAT
        lon += dlon * DT_H
        lat += dlat * DT_H
    return lat, lon, STEPS


def nearest_neighbour_mean(points: np.ndarray) -> float:
    """Mean great-circle-ish separation (deg) to each point's nearest neighbour."""
    n = len(points)
    if n < 2:
        return 0.0
    best = []
    for i in range(n):
        d = np.hypot(points[:, 0] - points[i, 0], points[:, 1] - points[i, 1])
        d[i] = np.inf
        best.append(d.min())
    return float(np.mean(best))


def run() -> int:
    elat = sources.lat_centers(sources.ENV_NY)
    elon = sources.lon_centers(sources.ENV_NX)
    ELAT, ELON = np.meshgrid(elat, elon, indexing="ij")  # [ny,nx], row0=north

    spawns = np.array([(la, lo) for la in SPAWN_LATS for lo in SPAWN_LONS], dtype=float)
    spawn_spread = nearest_neighbour_mean(spawns[:, ::-1])  # (lon,lat) for spread

    print(ENV_SRC.banner())
    print(f"[spike] {len(spawns)} spawns x {len(MONTHS)} months, dt={DT_H} h, {STEPS} steps")
    note = "(re-run against ERA5 when it lands)" if ENV_SRC.IS_SYNTHETIC else "(REAL fields — this is the D10 gate)"
    print(f"[spike] steering source: {ENV_SRC.TAG} {note}\n")

    # Runtime-like synoptic sampling (D10 remedy): when the source ships K real
    # year-samples per month, spawn i rides sample i % K — mirroring the runtime's
    # seed-picks-a-plane behavior — so the measured spread is the spread a
    # population of user storms actually experiences.
    has_samples = hasattr(ENV_SRC, "steering_shear_samples")

    worst_ratio = 1.0
    all_pass = True
    for m in MONTHS:
        if has_samples:
            u3, v3, _s3, years = ENV_SRC.steering_shear_samples(ELAT, ELON, m)
            k = u3.shape[0]
            fields = [(u3[i], v3[i]) for i in range(k)]
            print(f"  month {m:02d}: {k} synoptic samples (years {years})")
        else:
            u1, v1, _shr = ENV_SRC.steering_shear(ELAT, ELON, m)
            fields = [(u1, v1)]
        pick = lambda i: fields[i % len(fields)]  # noqa: E731
        ends = np.array([integrate(la, lo, *pick(i))[:2] for i, (la, lo) in enumerate(spawns)])
        alive = np.array([integrate(la, lo, *pick(i))[2] for i, (la, lo) in enumerate(spawns)])
        end_pts = ends[:, ::-1]  # (lon,lat) for planar spread
        end_spread = nearest_neighbour_mean(end_pts)
        # Rail-collapse ratio: endpoints keep this fraction of initial spacing.
        ratio = end_spread / spawn_spread if spawn_spread > 0 else 0.0
        worst_ratio = min(worst_ratio, ratio)
        exited = int(np.sum(alive < STEPS))
        ok = ratio >= 0.3  # < 0.3 => tracks converge onto rails (too-smooth means)
        all_pass = all_pass and ok
        print(
            f"  month {m:02d}: endpoint spacing {end_spread:.2f} deg "
            f"(spawn {spawn_spread:.2f}, keep {ratio*100:.0f}%) | "
            f"{exited}/{len(spawns)} left domain | "
            f"[{'PASS' if ok else 'FAIL: rails — go to 3-5 synoptic samples/month'}]"
        )

    print()
    print("[spike] note: PURE steering advection — no beta drift, no per-run")
    print("        stochastic perturbation (both of which the runtime sim can add).")
    print("        A FAIL flags FIELD smoothness (the D10 trigger to bake 3-5")
    print("        synoptic samples/month), not a defect in the shipped tracks.")
    verdict = "PASS" if all_pass else "FAIL"
    print(f"[spike] diversity {verdict} (worst keep-ratio {worst_ratio*100:.0f}%, need >=30%)")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(run())
