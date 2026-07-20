"""
sources.py — download helpers + real-data loaders for the bake.

All sources are auth-free public endpoints (see bake/README.md for URLs and
licenses). Downloads are cached under data/raw/ (gitignored); a second run reuses
them. Every network call goes through ensure_download() so reproduction is one
`python bake/bake.py` on a clean checkout.

Grid geometry here is the Python source of truth for the *actual* dims the
self-describing .bin headers will advertise; it mirrors src/grid.ts DOMAIN and the
row-order convention in BINARY-FORMATS.md (row 0 = NORTH, cols west->east).
"""

from __future__ import annotations

import csv
import os
import sys
import urllib.request

import numpy as np
from scipy.io import netcdf_file
from scipy import ndimage
from event_catalog import EVENTS

# --- Domain + target grids (mirror src/grid.ts DOMAIN) ----------------------
DOMAIN = (50.0, 70.0, 15.0, 27.0)  # lonMin, lonMax, latMin, latMax
TERRAIN_NX, TERRAIN_NY = 1040, 668  # ~2 km cells over the domain
ENV_NX, ENV_NY = 40, 24  # 0.5 deg
SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10]  # May..Nov, 0-indexed (types.ts monthIndex)
# Storms whose track enters this box "affected Oman" (genesis.json filter).
GENESIS_BOX = (52.0, 62.0, 16.0, 26.0)

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")

# Source URLs (also documented in README).
URL_GMRT = (
    "https://www.gmrt.org/services/GridServer?"
    "minlongitude=50&maxlongitude=70&minlatitude=15&maxlatitude=27"
    "&format=netcdf&resolution=med"
)
URL_OISST_LTM = (
    "https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2/sst.ltm.1991-2020.nc"
)
URL_IBTRACS_NI = (
    "https://www.ncei.noaa.gov/data/"
    "international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
)


def lon_centers(nx: int) -> np.ndarray:
    """Cell-center longitudes, west->east (mirror grid.ts cellToLatLon)."""
    return DOMAIN[0] + (np.arange(nx) + 0.5) * (DOMAIN[1] - DOMAIN[0]) / nx


def lat_centers(ny: int) -> np.ndarray:
    """Cell-center latitudes, row 0 = NORTH -> south (mirror grid.ts)."""
    return DOMAIN[3] - (np.arange(ny) + 0.5) * (DOMAIN[3] - DOMAIN[2]) / ny


def ensure_download(url: str, filename: str, timeout: int = 180) -> str:
    """Download url -> data/raw/filename unless already present. Returns the path."""
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, filename)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"  [cache] {filename} ({os.path.getsize(path)//1024} KB)")
        return path
    print(f"  [get]   {filename} <- {url[:70]}...")
    req = urllib.request.Request(url, headers={"User-Agent": "wallah-its-windy-bake/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(path, "wb") as fh:
        fh.write(resp.read())
    print(f"  [ok]    {filename} ({os.path.getsize(path)//1024} KB)")
    return path


# ---------------------------------------------------------------------------
# Terrain: GMRT (real bathymetry + topography), resampled to the 2 km grid.
# ---------------------------------------------------------------------------

def load_terrain() -> tuple[np.ndarray, np.ndarray]:
    """Return (elev_m int16 [ny,nx], landmask uint8 [ny,nx]) on the terrain grid.
    Downsample rules (eng task T3): elevation = block MEAN, landmask = ANY-land-wins.
    """
    path = ensure_download(URL_GMRT, "gmrt_terrain_med.nc")
    f = netcdf_file(path, "r", mmap=False)
    x0, x1 = [float(v) for v in f.variables["x_range"].data]
    y0, y1 = [float(v) for v in f.variables["y_range"].data]
    gnx, gny = [int(v) for v in f.variables["dimension"].data]
    z = f.variables["z"].data.astype(np.float64).reshape(gny, gnx)  # row0=NORTH (verified)
    f.close()

    # Native GMRT cell centers.
    glon = np.linspace(x0, x1, gnx)
    glat = np.linspace(y1, y0, gny)  # north -> south
    LON, LAT = np.meshgrid(glon, glat)
    Zf = z.ravel()
    LONf, LATf = LON.ravel(), LAT.ravel()

    dlon = (DOMAIN[1] - DOMAIN[0]) / TERRAIN_NX
    dlat = (DOMAIN[3] - DOMAIN[2]) / TERRAIN_NY
    col = np.floor((LONf - DOMAIN[0]) / dlon).astype(np.int64)
    row = np.floor((DOMAIN[3] - LATf) / dlat).astype(np.int64)
    good = (
        np.isfinite(Zf)
        & (col >= 0) & (col < TERRAIN_NX)
        & (row >= 0) & (row < TERRAIN_NY)
    )
    tidx = row[good] * TERRAIN_NX + col[good]
    zg = Zf[good]
    n = TERRAIN_NX * TERRAIN_NY
    esum = np.bincount(tidx, weights=zg, minlength=n)
    cnt = np.bincount(tidx, minlength=n)
    land = np.bincount(tidx, weights=(zg >= 0.0).astype(np.float64), minlength=n)

    elev = np.full(n, np.nan)
    nz = cnt > 0
    elev[nz] = esum[nz] / cnt[nz]
    elev = elev.reshape(TERRAIN_NY, TERRAIN_NX)
    landmask = (land.reshape(TERRAIN_NY, TERRAIN_NX) > 0).astype(np.uint8)

    # Fill any empty target cells (GMRT slightly finer than target, so rare/edge)
    # with the nearest valid elevation, then derive landmask there from sign.
    holes = ~np.isfinite(elev)
    if holes.any():
        idx = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
        elev = elev[tuple(idx)]
        landmask[holes] = (elev[holes] >= 0.0).astype(np.uint8)

    elev_i16 = np.clip(np.round(elev), -32768, 32767).astype(np.int16)
    return elev_i16, landmask


# ---------------------------------------------------------------------------
# SST: NOAA OISST v2 monthly long-term-mean climatology (1991-2020), 1 deg.
# ---------------------------------------------------------------------------

def load_sst_by_month() -> dict[int, np.ndarray]:
    """Return {monthIndex -> sstC float [ENV_NY,ENV_NX]} for SEASON_MONTHS,
    bilinearly resampled from the global OISST LTM onto the env grid."""
    import h5py  # netCDF4/HDF5 reader (LTM file is HDF5)

    path = ensure_download(URL_OISST_LTM, "sst.ltm.1991-2020.nc")
    with h5py.File(path, "r") as h:
        sst = np.asarray(h["sst"][:], dtype=np.float64)  # (12,180,360)
        lat = np.asarray(h["lat"][:], dtype=np.float64)  # 89.5 .. -89.5
        lon = np.asarray(h["lon"][:], dtype=np.float64)  # 0.5 .. 359.5

    lat0 = lat[0]  # 89.5
    dlat = lat[1] - lat[0]  # -1.0
    lon0 = lon[0]  # 0.5
    dlon = lon[1] - lon[0]  # 1.0
    elat = lat_centers(ENV_NY)
    elon = lon_centers(ENV_NX)
    row_f = (elat - lat0) / dlat  # fractional row indices into the global grid
    col_f = (elon - lon0) / dlon
    RR, CC = np.meshgrid(row_f, col_f, indexing="ij")  # (ENV_NY, ENV_NX)

    out: dict[int, np.ndarray] = {}
    for m in SEASON_MONTHS:
        plane = sst[m].copy()
        miss = ~np.isfinite(plane) | (plane < -100.0)  # land / fill
        if miss.any():  # fill land with nearest ocean so bilinear stays sane
            idx = ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True)
            plane = plane[tuple(idx)]
        samp = ndimage.map_coordinates(plane, [RR, CC], order=1, mode="nearest")
        out[m] = samp.astype(np.float64)
    return out


# ---------------------------------------------------------------------------
# Genesis: IBTrACS North Indian, first-fix positions of storms that reached Oman.
# ---------------------------------------------------------------------------

def load_genesis_points() -> tuple[list[dict[str, float]], int, int]:
    """Return (points, n_qualified, n_total_storms). A storm qualifies if any
    track fix falls inside GENESIS_BOX (52-62E/16-26N); its genesis point is the
    first fix that lies inside the DOMAIN (the playable 50-70E/15-27N map).

    Why first-in-domain rather than the literal first fix: several Oman-hitting
    storms (e.g. Gulab->Shaheen 2021) form in the Bay of Bengal ~90E, cross India,
    and re-intensify in the Arabian Sea. Their literal first fix is off our map;
    the meaningful "where would I spawn to recreate this" point is where they
    first appear in the domain. For Arabian-Sea-native storms this IS their
    genesis (their first fix is already in-domain). Every point renders on the map."""
    path = ensure_download(URL_IBTRACS_NI, "ibtracs.NI.csv")
    lon_min, lon_max, lat_min, lat_max = GENESIS_BOX
    d_lon_min, d_lon_max, d_lat_min, d_lat_max = DOMAIN

    tracks: dict[str, list[tuple[float, float]]] = {}
    order: list[str] = []
    with open(path, newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        i_sid = header.index("SID")
        i_lat = header.index("LAT")
        i_lon = header.index("LON")
        for rowv in reader:
            if len(rowv) <= max(i_sid, i_lat, i_lon):
                continue
            sid = rowv[i_sid].strip()
            if not sid or sid == "SID":
                continue
            try:
                la = float(rowv[i_lat])
                lo = float(rowv[i_lon])
            except ValueError:
                continue
            if lo > 180.0:  # IBTrACS uses -180..180; guard anyway
                lo -= 360.0
            if sid not in tracks:
                tracks[sid] = []
                order.append(sid)
            tracks[sid].append((la, lo))

    points: list[dict[str, float]] = []
    for sid in order:
        pts = tracks[sid]
        entered = any(
            (lon_min <= lo <= lon_max) and (lat_min <= la <= lat_max) for la, lo in pts
        )
        if not entered:
            continue
        # First fix inside the playable domain = the storm's on-map genesis/entry.
        in_dom = next(
            (
                (la, lo)
                for la, lo in pts
                if d_lon_min <= lo <= d_lon_max and d_lat_min <= la <= d_lat_max
            ),
            None,
        )
        if in_dom is None:  # cannot happen (box subset of domain), but stay safe
            continue
        gla, glo = in_dom
        points.append({"lat": round(gla, 3), "lon": round(glo, 3)})
    return points, len(points), len(order)


# ---------------------------------------------------------------------------
# Event tracks: full IBTrACS polylines for the frozen benchmark catalogue.
# Distinct from genesis dots (load_genesis_points): this keeps EVERY fix with its
# time + intensity, for the ghost-track overlay (C7) and sim tuning (C5).
# ---------------------------------------------------------------------------

# Exact IBTrACS SIDs keep the frozen split stable even if names are reused or
# agency labels change in a later archive.
EVENT_STORMS = tuple(
    {
        "id": event["trackId"],
        "name": event["name"],
        "year": event["year"],
        "sid": event["sid"],
        "partition": event["partition"],
    }
    for event in EVENTS
)


def _iso_z(raw: str) -> str:
    """IBTrACS 'YYYY-MM-DD HH:MM:SS' -> ISO-8601 UTC 'YYYY-MM-DDTHH:MM:SSZ'."""
    s = raw.strip().replace(" ", "T")
    if not s.endswith("Z"):
        s += "Z"
    return s


def _int_or_none(cell: str) -> int | None:
    cell = cell.strip()
    if not cell:
        return None
    try:
        return int(round(float(cell)))
    except ValueError:
        return None


def load_event_tracks(csv_path: str | None = None) -> list[dict]:
    """Return the per-storm track polylines for EVENT_STORMS (C1 shape, minus the
    envelope): a list of {id, name, year, points:[{iso,lat,lon,windKt,presMb}]}.

    Points keep ALL fixes (including off-domain Bay-of-Bengal segments — canvas
    clipping handles them), time-ordered, lat/lon rounded to 3 dp, windKt/presMb
    integers or None when the CSV cell is blank. Rows are matched by SEASON + a
    exact SID and de-duplicate by ISO_TIME.
    """
    path = csv_path or ensure_download(URL_IBTRACS_NI, "ibtracs.NI.csv")

    # storm-id -> {iso -> (lat, lon, windKt, presMb)} (dict de-dupes by timestamp).
    collected: dict[str, dict[str, tuple[float, float, int | None, int | None]]] = {
        s["id"]: {} for s in EVENT_STORMS
    }
    with open(path, newline="") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        i_sid = header.index("SID")
        i_iso = header.index("ISO_TIME")
        i_lat = header.index("LAT")
        i_lon = header.index("LON")
        i_wind = header.index("WMO_WIND")
        i_pres = header.index("WMO_PRES")
        need = max(i_sid, i_iso, i_lat, i_lon, i_wind, i_pres)
        for rowv in reader:
            if len(rowv) <= need:
                continue
            sid = rowv[i_sid].strip()
            if not sid or sid == "SID":  # skip blanks + the units row
                continue
            try:  # units row also fails the float() guard
                la = float(rowv[i_lat])
                lo = float(rowv[i_lon])
            except ValueError:
                continue
            if lo > 180.0:  # IBTrACS uses -180..180; guard anyway
                lo -= 360.0
            for spec in EVENT_STORMS:
                if sid != spec["sid"]:
                    continue
                iso = _iso_z(rowv[i_iso])
                collected[spec["id"]][iso] = (
                    round(la, 3), round(lo, 3),
                    _int_or_none(rowv[i_wind]), _int_or_none(rowv[i_pres]),
                )
                break

    storms: list[dict] = []
    for spec in EVENT_STORMS:
        fixes = collected[spec["id"]]
        points = [
            {"iso": iso, "lat": la, "lon": lo, "windKt": w, "presMb": p}
            for iso, (la, lo, w, p) in sorted(fixes.items())  # ISO strings sort chronologically
        ]
        storms.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "year": spec["year"],
                "partition": spec["partition"],
                "points": points,
            }
        )
    return storms


if __name__ == "__main__":  # smoke test
    e, lm = load_terrain()
    print("terrain", e.shape, "elev[m] min/max", int(e.min()), int(e.max()),
          "land frac", round(float(lm.mean()), 3), file=sys.stderr)
    pts, nq, nt = load_genesis_points()
    print(f"genesis {nq}/{nt} storms qualified", file=sys.stderr)
