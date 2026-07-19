"""
hydro.py — D8 flow accumulation + drainage basins from the terrain DEM.

This is the sanctioned fallback (eng task T3 / bake task 3) for when HydroSHEDS
ACC+DIR is unavailable: HydroSHEDS distributes only large continental GeoTIFFs
(need GDAL/rasterio) and its file-server paths 404'd, so flow structure is derived
directly from the real GMRT DEM instead. It is REAL topography-derived hydrology,
just self-computed rather than pre-conditioned.

Method: priority-flood (Barnes 2014) that fills depressions AND records, for every
land cell, the neighbour it was flooded from — an explicit, acyclic drainage tree
draining to the coast/domain edge. No separate D8 pass, no flat-routing ambiguity.
Because the DEM is computed natively on the terrain grid (not downsampled from a
finer HydroSHEDS grid), there is no block-MAX / mode downsample step here; the
channels are already at terrain resolution. The connectivity assert still runs.
"""

from __future__ import annotations

import heapq

import numpy as np
from scipy import ndimage

# 8-neighbour offsets and their planar distances (diagonals are longer).
_NEIGH = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def flow_accumulation_and_basins(
    elev: np.ndarray, landmask: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Return (flowacc_log float [ny,nx], basin uint32 [ny,nx]).

    flowacc_log = log10(1 + upstream_cell_count); ocean cells are 0.
    basin = id of the coastal/edge outlet each land cell drains to; ocean = 0.
    """
    ny, nx = elev.shape
    n = ny * nx
    fe = elev.astype(np.float64).ravel()
    land = landmask.astype(bool).ravel()
    ocean = ~land

    visited = np.zeros(n, dtype=bool)
    visited[ocean] = True  # ocean is the sink; the flood never enters it
    filled = fe.copy()
    downstream = np.full(n, -1, dtype=np.int64)  # flooded-from cell, or -1 (outlet)

    land2d = land.reshape(ny, nx)
    ocean2d = ocean.reshape(ny, nx)
    # Coastline = land cells 8-adjacent to ocean; plus all domain-border land.
    coast = ndimage.binary_dilation(ocean2d, structure=np.ones((3, 3))) & land2d
    border = np.zeros((ny, nx), dtype=bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    seeds2d = (coast | (border & land2d))
    seed_idx = np.flatnonzero(seeds2d.ravel() & land)

    heap: list[tuple[float, int, int]] = []
    tie = 0
    for idx in seed_idx:
        visited[idx] = True
        downstream[idx] = -1  # outlet: drains to sea / off-domain
        heapq.heappush(heap, (filled[idx], tie, int(idx)))
        tie += 1

    pop_order = np.empty(n, dtype=np.int64)  # cells in the order popped (root->leaf)
    npop = 0
    while heap:
        e, _, idx = heapq.heappop(heap)
        pop_order[npop] = idx
        npop += 1
        r, c = divmod(idx, nx)
        for dr, dc in _NEIGH:
            nr, nc = r + dr, c + dc
            if nr < 0 or nr >= ny or nc < 0 or nc >= nx:
                continue
            nidx = nr * nx + nc
            if visited[nidx]:
                continue
            visited[nidx] = True
            nf = fe[nidx] if fe[nidx] > e else e  # raise to spill level (fill pit)
            filled[nidx] = nf
            downstream[nidx] = idx  # drains toward the cell that flooded it
            heapq.heappush(heap, (nf, tie, nidx))
            tie += 1
    pop_order = pop_order[:npop]

    # Accumulation: each land cell starts at 1; push contributions downstream.
    # Reverse pop order = leaves before roots, so a cell is final before it adds
    # to its downstream neighbour.
    acc = land.astype(np.float64)  # 1 for land, 0 for ocean
    for idx in pop_order[::-1]:
        d = downstream[idx]
        if d >= 0:
            acc[d] += acc[idx]

    # Basins: forward pop order = roots before leaves; each cell inherits its
    # downstream basin; outlets (downstream == -1) start a new basin.
    basin = np.zeros(n, dtype=np.int64)
    next_id = 1
    for idx in pop_order:
        d = downstream[idx]
        if d < 0:
            basin[idx] = next_id
            next_id += 1
        else:
            basin[idx] = basin[d]
    if next_id > 65535:  # keep uint16-friendly (see BINARY-FORMATS quantization)
        # Extremely unlikely at 2 km; renumber densely just in case.
        uniq, inv = np.unique(basin, return_inverse=True)
        basin = inv.astype(np.int64)

    flowacc_log = np.log10(1.0 + acc).reshape(ny, nx).astype(np.float64)
    basin2d = basin.reshape(ny, nx).astype(np.uint32)
    return flowacc_log, basin2d


def connectivity_check(flowacc_log: np.ndarray, landmask: np.ndarray) -> tuple[bool, str]:
    """Eng task T6 bake assert: the top-1% flow-accumulation cells must form
    connected LINE structures (channels), not isolated speckle. Returns
    (passed, message)."""
    land = landmask.astype(bool)
    vals = flowacc_log[land]
    if vals.size == 0:
        return False, "connectivity: no land cells"
    thr = np.percentile(vals, 99.0)
    top = (flowacc_log >= thr) & land
    n_top = int(top.sum())
    labels, n_comp = ndimage.label(top, structure=np.ones((3, 3)))
    if n_comp == 0:
        return False, "connectivity: no top-1% cells"
    sizes = np.bincount(labels.ravel())[1:]
    mean_size = float(sizes.mean())
    in_long = int(sizes[sizes >= 5].sum())  # cells in components >= 5 cells long
    frac_long = in_long / n_top
    passed = mean_size >= 3.0 and frac_long >= 0.6
    msg = (
        f"connectivity: {n_top} top-1% cells -> {n_comp} components, "
        f"mean {mean_size:.1f} cells, {frac_long*100:.0f}% in channels>=5 cells "
        f"[{'PASS' if passed else 'FAIL'} : lines not speckle]"
    )
    return passed, msg
