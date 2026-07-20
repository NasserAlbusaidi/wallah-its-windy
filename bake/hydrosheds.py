"""
hydrosheds.py — official HydroSHEDS v1.1 ACC + DIR for the Arabian Sea domain.

The Europe and Middle East 30-arc-second tiles cover the complete
50–70E / 15–27N display domain. ACC is reduced to the 2 km terrain grid with
block-MAX semantics: the strongest source channel in each target cell survives.
DIR is taken from that same maximum-ACC source pixel, then followed until its
path crosses into a neighbouring target cell. This keeps direction and channel
selection coherent instead of independently resampling categorical D8 codes.

Outputs use ESRI/HydroSHEDS D8 codes:
  1 E, 2 SE, 4 S, 8 SW, 16 W, 32 NW, 64 N, 128 NE; 0 = outlet/no route.
`travmin` is the per-cell travel time to that downstream neighbour, in minutes.
It is an explicit visualization-scale routing parameter, not a discharge model.
"""

from __future__ import annotations

import os

import numpy as np

import sources

URL_DIR = (
    "https://data.hydrosheds.org/file/"
    "hydrosheds-v1-dir/hyd_eu_dir_30s.zip"
)
URL_ACC = (
    "https://data.hydrosheds.org/file/"
    "hydrosheds-v1-acc/hyd_eu_acc_30s.zip"
)
DIR_ZIP = "hyd_eu_dir_30s.zip"
ACC_ZIP = "hyd_eu_acc_30s.zip"

D8_TO_OFFSET = {
    1: (0, 1),
    2: (1, 1),
    4: (1, 0),
    8: (1, -1),
    16: (0, -1),
    32: (-1, -1),
    64: (-1, 0),
    128: (-1, 1),
}
OFFSET_TO_D8 = {offset: code for code, offset in D8_TO_OFFSET.items()}


def _read_domain(kind: str) -> tuple[np.ndarray, object]:
    try:
        import rasterio
        from rasterio.windows import from_bounds
    except ImportError as exc:
        raise RuntimeError(
            "HydroSHEDS bake requires rasterio; install bake/requirements.txt"
        ) from exc

    if kind == "dir":
        archive = sources.ensure_download(URL_DIR, DIR_ZIP)
    elif kind == "acc":
        archive = sources.ensure_download(URL_ACC, ACC_ZIP)
    else:
        raise ValueError(kind)
    tif = f"hyd_eu_{kind}_30s.tif"
    path = f"zip://{archive}!{tif}"
    lon_min, lon_max, lat_min, lat_max = sources.DOMAIN
    with rasterio.open(path) as src:
        window = from_bounds(
            lon_min, lat_min, lon_max, lat_max, src.transform
        ).round_offsets().round_lengths()
        data = src.read(1, window=window)
        transform = src.window_transform(window)
    return data, transform


def _source_to_target_indices(
    transform: object,
    shape: tuple[int, int],
    nx: int,
    ny: int,
) -> tuple[np.ndarray, np.ndarray]:
    height, width = shape
    lon_min, lon_max, lat_min, lat_max = sources.DOMAIN
    cols = np.arange(width)
    rows = np.arange(height)
    lon = transform.c + (cols + 0.5) * transform.a
    lat = transform.f + (rows + 0.5) * transform.e
    target_cols = np.floor(
        (lon - lon_min) * nx / (lon_max - lon_min)
    ).astype(np.int32)
    target_rows = np.floor(
        (lat_max - lat) * ny / (lat_max - lat_min)
    ).astype(np.int32)
    return target_rows, target_cols


def _basins_from_direction(
    flowdir: np.ndarray, landmask: np.ndarray
) -> np.ndarray:
    """Assign every routed land cell to its eventual outlet; cycles become sinks."""
    ny, nx = flowdir.shape
    n = ny * nx
    land = landmask.astype(bool).ravel()
    codes = flowdir.ravel()
    downstream = np.full(n, -1, dtype=np.int64)
    for idx in np.flatnonzero(land):
        code = int(codes[idx])
        offset = D8_TO_OFFSET.get(code)
        if offset is None:
            continue
        row, col = divmod(int(idx), nx)
        nr, nc = row + offset[0], col + offset[1]
        if 0 <= nr < ny and 0 <= nc < nx and land[nr * nx + nc]:
            downstream[idx] = nr * nx + nc

    basin = np.zeros(n, dtype=np.uint32)
    mark = np.zeros(n, dtype=np.int64)
    next_id = 1
    for start in np.flatnonzero(land):
        if basin[start] != 0:
            continue
        token = int(start) + 1
        path: list[int] = []
        cur = int(start)
        while (
            cur >= 0
            and land[cur]
            and basin[cur] == 0
            and mark[cur] != token
        ):
            mark[cur] = token
            path.append(cur)
            cur = int(downstream[cur])
        if cur >= 0 and basin[cur] != 0:
            outlet = int(basin[cur])
        else:
            outlet = next_id
            next_id += 1
        for idx in reversed(path):
            basin[idx] = outlet
    return basin.reshape(ny, nx)


def load(
    nx: int,
    ny: int,
    landmask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]:
    """Return (logACC, flowdir, travmin, basin, provenance_message)."""
    dir_src, dir_transform = _read_domain("dir")
    acc_src, acc_transform = _read_domain("acc")
    if dir_src.shape != acc_src.shape or dir_transform != acc_transform:
        raise ValueError("HydroSHEDS ACC/DIR grids are not co-registered")

    target_rows, target_cols = _source_to_target_indices(
        dir_transform, dir_src.shape, nx, ny
    )
    target_id = (
        target_rows[:, None].astype(np.int64) * nx
        + target_cols[None, :].astype(np.int64)
    )
    valid_target = (
        (target_rows[:, None] >= 0)
        & (target_rows[:, None] < ny)
        & (target_cols[None, :] >= 0)
        & (target_cols[None, :] < nx)
    )
    valid_dir = np.isin(dir_src, np.array(list(D8_TO_OFFSET), dtype=np.uint8))
    valid_acc = (acc_src > 0) & (acc_src != np.uint32(4294967295))
    valid = valid_target & valid_dir & valid_acc

    flat_tid = target_id.ravel()
    flat_acc = acc_src.ravel()
    flat_valid = valid.ravel()
    max_acc = np.zeros(nx * ny, dtype=np.uint32)
    np.maximum.at(max_acc, flat_tid[flat_valid], flat_acc[flat_valid])

    is_representative = np.zeros(flat_valid.shape, dtype=bool)
    is_representative[flat_valid] = (
        flat_acc[flat_valid] == max_acc[flat_tid[flat_valid]]
    )
    source_flat = np.flatnonzero(is_representative)
    candidate_tid = flat_tid[source_flat]
    unique_tid, first = np.unique(candidate_tid, return_index=True)
    representative = np.full(nx * ny, -1, dtype=np.int64)
    representative[unique_tid] = source_flat[first]

    source_h, source_w = dir_src.shape
    flowdir = np.zeros(nx * ny, dtype=np.uint8)
    for tid in np.flatnonzero(representative >= 0):
        source_idx = int(representative[tid])
        row, col = divmod(source_idx, source_w)
        for _ in range(16):
            offset = D8_TO_OFFSET.get(int(dir_src[row, col]))
            if offset is None:
                break
            row += offset[0]
            col += offset[1]
            if row < 0 or row >= source_h or col < 0 or col >= source_w:
                break
            next_row = int(target_rows[row])
            next_col = int(target_cols[col])
            if not (0 <= next_row < ny and 0 <= next_col < nx):
                break
            next_tid = next_row * nx + next_col
            if next_tid == tid:
                continue
            here_row, here_col = divmod(int(tid), nx)
            step = (
                int(np.sign(next_row - here_row)),
                int(np.sign(next_col - here_col)),
            )
            flowdir[tid] = OFFSET_TO_D8.get(step, 0)
            break

    land = landmask.astype(bool).ravel()
    flowdir[~land] = 0
    max_acc[~land] = 0
    flowacc_log = np.log10(1.0 + max_acc.astype(np.float64))

    # Visualization-scale channel velocity: 2 km/h in headwaters, smoothly
    # increasing to 10 km/h on the largest channels. Travel time is for one
    # target-grid D8 step and is what the runtime actually integrates.
    max_log = float(flowacc_log.max()) or 1.0
    strength = np.sqrt(np.clip(flowacc_log / max_log, 0.0, 1.0))
    velocity_kmh = 2.0 + 8.0 * strength
    travel = np.zeros(nx * ny, dtype=np.float64)
    dlat_km = 111.0 * (sources.DOMAIN[3] - sources.DOMAIN[2]) / ny
    dlon_deg = (sources.DOMAIN[1] - sources.DOMAIN[0]) / nx
    for tid in np.flatnonzero(flowdir > 0):
        row, _ = divmod(int(tid), nx)
        lat = (
            sources.DOMAIN[3]
            - (row + 0.5)
            * (sources.DOMAIN[3] - sources.DOMAIN[2])
            / ny
        )
        dr, dc = D8_TO_OFFSET[int(flowdir[tid])]
        dx_km = 111.0 * np.cos(np.deg2rad(lat)) * dlon_deg * abs(dc)
        dy_km = dlat_km * abs(dr)
        distance_km = float(np.hypot(dx_km, dy_km))
        travel[tid] = np.clip(
            distance_km / velocity_kmh[tid] * 60.0, 8.0, 120.0
        )

    flowdir2d = flowdir.reshape(ny, nx)
    basin = _basins_from_direction(flowdir2d, landmask)
    routed = int(((flowdir > 0) & land).sum())
    covered = int(((max_acc > 0) & land).sum())
    land_count = int(land.sum())
    message = (
        "HydroSHEDS v1.1 EU/Middle-East 30s ACC+DIR: "
        f"{covered}/{land_count} land cells covered, {routed} routed; "
        f"travel {travel[travel > 0].min():.0f}..{travel.max():.0f} min"
    )
    return (
        flowacc_log.reshape(ny, nx),
        flowdir2d,
        np.rint(travel).astype(np.uint8).reshape(ny, nx),
        basin,
        message,
    )
