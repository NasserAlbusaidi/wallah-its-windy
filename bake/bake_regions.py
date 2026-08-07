"""
bake_regions.py — region-id rasters for the regional rain ledger (UX v2 phase 3).

Writes public/data/regions.bin + public/data/regions.json:

  admin1 (uint8, unquantized): Oman governorate ids 1..11 on the IMPACT grid
    (200x120, 0.1 deg over the domain — mirrors src/impact.ts GRID_NX/GRID_NY;
    test/integration-bins.test.ts pins the geometry so drift is loud).
    Source: Natural Earth 10m admin-1 (public domain), filtered to Oman,
    rasterized with rasterio. Ids are 1..N in sorted-display-name order;
    0 = no governorate (sea, Iran/Pakistan land — phase 3 scopes admin
    regions to Oman only).

  wadi (uint16, unquantized): drainage-basin ids derived on the SAME impact
    grid from the official HydroSHEDS v1.1 DIR+ACC data (hydrosheds.load is
    grid-parametric — deriving natively at 0.1 deg keeps basins D8-coherent
    at display scale instead of majority-resampling the 2 km ids). Basins
    smaller than MIN_BASIN_CELLS are dropped as noise; surviving ids are
    compacted to 1..N (uint16-safe); 0 = none/ocean.

Wadi NAMES are resolved at bake time from a curated anchor table
(name -> in-channel lat/lon): names key to geography, not to ids, so a
rebake re-resolves and can never silently mislabel. Anchors that resolve to
id 0 or collide with an earlier anchor are logged as warnings and skipped.

Categorical layers ship unquantized (scale=1, offset=0): uint8/uint16 raw
values are bit-exact through the loader's Float32 dequantize path.

Run:   node bake/run-python.mjs bake/bake_regions.py
Check: node bake/run-python.mjs bake/bake_regions.py --check
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np

import binfmt
import hydrosheds
import sources

# Impact grid (src/impact.ts GRID_NX/GRID_NY over grid.ts DOMAIN).
NX, NY = 200, 120
DOMAIN = sources.DOMAIN  # (lonMin, lonMax, latMin, latMax)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN_PATH = os.path.join(ROOT, "public", "data", "regions.bin")
JSON_PATH = os.path.join(ROOT, "public", "data", "regions.json")

# Natural Earth 10m admin-1, pinned to the v5.1.2 release tag (public domain).
URL_NE_ADM1 = (
    "https://github.com/nvkelso/natural-earth-vector/raw/v5.1.2/"
    "geojson/ne_10m_admin_1_states_provinces.geojson"
)
NE_FILENAME = "ne_10m_admin_1_states_provinces.v5.1.2.geojson"

# Natural Earth `name` -> display label (lowercase per product convention).
# Keyed on the NE `name` property because `name_en` mislabels one feature
# ("Ash Sharqiyah South" carries name_en "Ash Sharqiyah").
GOVERNORATE_LABELS = {
    "Muscat": "muscat",
    "Dhofar": "dhofar",
    "Musandam": "musandam",
    "Al Buraymi": "al buraimi",
    "Al Batnah North": "al batinah north",
    "Al Batnah South": "al batinah south",
    "Al Dhahira": "ad dhahirah",
    "Ad Dakhliyah": "ad dakhiliyah",
    "Ash Sharqiyah North": "ash sharqiyah north",
    "Ash Sharqiyah South": "ash sharqiyah south",
    "Al Wusta": "al wusta",
}

# Curated wadi anchors: (display name, lat, lon) at an in-channel point of the
# catchment. Resolution to basin ids happens at bake time (geography-keyed).
WADI_ANCHORS = [
    ("wadi samail", 23.15, 58.00),
    ("wadi dayqah", 23.05, 58.85),
    ("wadi aday", 23.55, 58.50),
    ("wadi bani khalid", 22.60, 59.05),
    ("wadi halfayn", 22.60, 57.95),
    ("wadi andam", 22.45, 58.40),
    ("wadi bani awf", 23.25, 57.50),
    ("wadi ghul", 23.15, 57.20),
    ("wadi mistal", 23.35, 57.75),
    ("wadi ma'awil", 23.50, 57.85),
    ("wadi sahtan", 23.35, 57.35),
    ("wadi bani kharus", 23.40, 57.65),
    ("wadi al jizzi", 24.35, 56.55),
    ("wadi hawasinah", 23.85, 56.85),
    ("wadi darbat", 17.10, 54.45),
]

# Basins smaller than this many 0.1-deg cells (~11 km each) are noise.
MIN_BASIN_CELLS = 4


def build_admin1() -> tuple[np.ndarray, dict[int, str]]:
    """Rasterize Oman governorates onto the impact grid. Returns (grid, names)."""
    import rasterio.features
    import rasterio.transform

    path = sources.ensure_download(URL_NE_ADM1, NE_FILENAME, timeout=600)
    with open(path, encoding="utf-8") as fh:
        collection = json.load(fh)
    features = [
        f for f in collection["features"]
        if f.get("properties", {}).get("admin") == "Oman"
    ]
    if not features:
        raise RuntimeError("Natural Earth admin-1: no Oman features found")

    labelled = []
    for feature in features:
        ne_name = feature["properties"].get("name")
        label = GOVERNORATE_LABELS.get(ne_name)
        if label is None:
            raise RuntimeError(
                f"unmapped Oman admin-1 feature {ne_name!r} — update "
                "GOVERNORATE_LABELS (upstream data changed)"
            )
        labelled.append((label, feature["geometry"]))
    labelled.sort(key=lambda item: item[0])

    lon_min, lon_max, lat_min, lat_max = DOMAIN
    transform = rasterio.transform.from_bounds(
        lon_min, lat_min, lon_max, lat_max, NX, NY
    )  # row 0 = north edge, matching BINARY-FORMATS.md
    shapes = [
        (geometry, region_id)
        for region_id, (_label, geometry) in enumerate(labelled, start=1)
    ]
    grid = rasterio.features.rasterize(
        shapes,
        out_shape=(NY, NX),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=False,
    )
    names = {
        region_id: label
        for region_id, (label, _geometry) in enumerate(labelled, start=1)
    }
    for region_id, label in names.items():
        cells = int((grid == region_id).sum())
        print(f"  [admin1] {region_id:2d} {label:<22s} {cells:4d} cells")
        if cells == 0:
            print(f"  [warn] governorate {label!r} rasterized to zero cells")
    return grid, names


def build_impact_landmask() -> np.ndarray:
    """Terrain landmask nearest-sampled at impact cell centres — the exact
    resample src/impact.ts setLandMask performs at runtime."""
    _elev, terrain_land = sources.load_terrain()
    t_ny, t_nx = terrain_land.shape
    lon = sources.lon_centers(NX)
    lat = sources.lat_centers(NY)
    lon_min, lon_max, lat_min, lat_max = DOMAIN
    col = np.clip(
        np.round((lon - lon_min) / (lon_max - lon_min) * t_nx - 0.5).astype(int),
        0, t_nx - 1,
    )
    row = np.clip(
        np.round((lat_max - lat) / (lat_max - lat_min) * t_ny - 0.5).astype(int),
        0, t_ny - 1,
    )
    return terrain_land[np.ix_(row, col)].astype(np.uint8)


def build_wadi() -> tuple[np.ndarray, dict[int, str]]:
    """Derive impact-grid basins from HydroSHEDS, prune, compact, name."""
    landmask = build_impact_landmask()
    _acc, _dir, _trav, basin, message = hydrosheds.load(NX, NY, landmask)
    print(f"  [wadi] {message}")

    ids, counts = np.unique(basin[basin > 0], return_counts=True)
    keep = ids[counts >= MIN_BASIN_CELLS]
    pruned = basin.copy()
    pruned[~np.isin(basin, keep)] = 0
    print(
        f"  [wadi] {ids.size} raw basins -> {keep.size} kept "
        f"(>= {MIN_BASIN_CELLS} cells)"
    )

    # Compact surviving ids to 1..N in a deterministic order (old-id ascending).
    compact = np.zeros_like(pruned, dtype=np.uint16)
    for new_id, old_id in enumerate(np.sort(keep), start=1):
        compact[pruned == old_id] = new_id
    n_basins = int(compact.max())
    if n_basins > 65535:
        raise RuntimeError(f"{n_basins} basins exceed uint16")

    lon_min, lon_max, lat_min, lat_max = DOMAIN
    names: dict[int, str] = {}
    for name, lat, lon in WADI_ANCHORS:
        col = int((lon - lon_min) / (lon_max - lon_min) * NX)
        row = int((lat_max - lat) / (lat_max - lat_min) * NY)
        if not (0 <= col < NX and 0 <= row < NY):
            print(f"  [warn] wadi anchor {name!r} outside the domain — skipped")
            continue
        basin_id = int(compact[row, col])
        if basin_id == 0:
            print(f"  [warn] wadi anchor {name!r} resolved to no basin — skipped")
            continue
        if basin_id in names:
            print(
                f"  [warn] wadi anchor {name!r} collides with "
                f"{names[basin_id]!r} (basin {basin_id}) — skipped"
            )
            continue
        cells = int((compact == basin_id).sum())
        names[basin_id] = name
        print(f"  [wadi] {basin_id:4d} {name:<18s} {cells:3d} cells")
    return compact, names


def build_layers(
    admin_grid: np.ndarray, wadi_grid: np.ndarray
) -> list[binfmt.Layer]:
    return [
        binfmt.Layer(
            name="admin1", dtype="uint8", quant=False,
            nx=NX, ny=NY, nt=1, bbox=DOMAIN, scale=1.0, offset=0.0,
            data=admin_grid.astype(np.uint8).ravel(order="C"),
        ),
        binfmt.Layer(
            name="wadi", dtype="uint16", quant=False,
            nx=NX, ny=NY, nt=1, bbox=DOMAIN, scale=1.0, offset=0.0,
            data=wadi_grid.astype(np.uint16).ravel(order="C"),
        ),
    ]


def build_metadata(
    admin_names: dict[int, str], wadi_names: dict[int, str], n_basins: int
) -> dict:
    return {
        "version": 1,
        "bin": "data/regions.bin",
        "grid": {"nx": NX, "ny": NY, "bbox": list(DOMAIN)},
        "admin1": {str(k): v for k, v in sorted(admin_names.items())},
        "wadi": {str(k): v for k, v in sorted(wadi_names.items())},
        "wadiBasinCount": n_basins,
        "source": {
            "admin1": (
                "Natural Earth 10m admin-1 v5.1.2 (public domain), "
                "Oman governorates"
            ),
            "wadi": (
                "Derived on the 0.1-deg impact grid from HydroSHEDS v1.1 "
                "EU/Middle-East 30s DIR+ACC (c) WWF; Lehner, Verdin & "
                "Jarvis 2008. Basin ids are bake-derived outlets, not "
                "official HydroSHEDS ids; names resolved from curated "
                "in-channel anchor coordinates at bake time."
            ),
        },
    }


def serialize_metadata(meta: dict) -> bytes:
    return (json.dumps(meta, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main(argv: list[str]) -> int:
    unknown = [arg for arg in argv if arg != "--check"]
    if unknown:
        print(
            f"[FAIL] unknown argument(s): {' '.join(unknown)} (only --check exists)",
            file=sys.stderr,
        )
        return 2
    check = "--check" in argv

    print("[assert]", binfmt.assert_golden_vector())
    admin_grid, admin_names = build_admin1()
    wadi_grid, wadi_names = build_wadi()
    layers = build_layers(admin_grid, wadi_grid)
    blob = binfmt.write_bin(None, layers)
    meta_bytes = serialize_metadata(
        build_metadata(admin_names, wadi_names, int(wadi_grid.max()))
    )

    if check:
        try:
            with open(BIN_PATH, "rb") as fh:
                committed_bin = fh.read()
            with open(JSON_PATH, "rb") as fh:
                committed_json = fh.read()
        except FileNotFoundError:
            print(
                "[FAIL] --check: committed regions.bin/regions.json not found; "
                "run without --check first",
                file=sys.stderr,
            )
            return 1
        if committed_bin != blob or committed_json != meta_bytes:
            print(
                "[FAIL] --check: rebuilt regions artifacts differ from the "
                "committed files (source data or code drifted)",
                file=sys.stderr,
            )
            return 1
        print(f"[regions] --check OK ({len(blob)} bin bytes, byte-identical)")
        return 0

    tmp_bin, tmp_json = BIN_PATH + ".tmp", JSON_PATH + ".tmp"
    with open(tmp_bin, "wb") as fh:
        fh.write(blob)
    with open(tmp_json, "wb") as fh:
        fh.write(meta_bytes)
    os.replace(tmp_bin, BIN_PATH)
    os.replace(tmp_json, JSON_PATH)
    print(
        f"[regions] wrote {os.path.relpath(BIN_PATH, ROOT)} "
        f"({len(blob)} bytes) + regions.json "
        f"({len(admin_names)} governorates, {len(wadi_names)} named wadis, "
        f"{int(wadi_grid.max())} basins)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
