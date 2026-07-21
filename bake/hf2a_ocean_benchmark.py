"""Build the HF-2A satellite-SST cold-wake observation set.

The source is NOAA NESDIS CoastWatch's auth-free GHRSST Geo-polar Blended
night-only foundation SST analysis.  The original contract named MUR v4.1, but
NASA's canonical cloud endpoint requires Earthdata credentials.  This NOAA L4
product preserves the same daily, gap-free foundation-SST and per-pixel error
contract at 0.05 degree while remaining reproducible from a clean checkout.

Raw NetCDF subsets are cached under data/raw/ (gitignored).  The committed JSON
contains only the 0.1-degree, track-local, quality-controlled observations used
by deterministic offline scoring.  Pixels are selected without looking at any
candidate model output.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import struct
import urllib.parse
from pathlib import Path

import numpy as np
from scipy.io import netcdf_file

import sources


ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "calibration" / "fidelity-catalog.json"
TRACKS_PATH = ROOT / "calibration" / "data" / "fidelity-tracks.json"
OUTPUT_PATH = ROOT / "calibration" / "data" / "hf2a-ocean-observations.json"
BINARY_PATH = ROOT / "calibration" / "data" / "hf2a-ocean-observations.bin"
DATASET_ID = "noaacwBLENDEDCsstDaily"
SOURCE_URL = f"https://coastwatch.noaa.gov/erddap/griddap/{DATASET_ID}"
SOURCE_INFO = f"https://coastwatch.noaa.gov/erddap/info/{DATASET_ID}/index.json"
SOURCE_COVERAGE_START = dt.datetime(2002, 9, 1, 12, tzinfo=dt.timezone.utc)
ANALYSIS_HOUR = 12
GRID_STRIDE = 2  # native 0.05 degree -> deterministic 0.10 degree selection
MAX_ERROR_C = 0.5
MAX_TRACK_DISTANCE_KM = 300.0
BASELINE_WINDOW_H = (-120.0, -48.0)
LEADS_H = (24, 48)
MINIMUM_BASELINE_DAYS = 2
MINIMUM_STORM_PIXELS = 100
DOMAIN = (50.0, 70.0, 15.0, 27.0)
EARTH_RADIUS_KM = 6371.0
BINARY_MAGIC = b"HF2O"
BINARY_VERSION = 1
BINARY_HEADER = struct.Struct("<4sHHI")
BINARY_RECORD = struct.Struct("<ffffqffqffq")


def _read_json(path: Path):
    return json.loads(path.read_text())


def _iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=dt.timezone.utc
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite value in benchmark output")
        rounded = round(value, 6)
        return 0 if rounded == 0 else rounded
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    return value


def _output_text(payload: dict) -> str:
    return json.dumps(_canonical(payload), indent=2, sort_keys=False) + "\n"


def _binary_records(storms: list[dict]) -> tuple[bytes, list[dict]]:
    chunks = [
        BINARY_HEADER.pack(
            BINARY_MAGIC,
            BINARY_VERSION,
            BINARY_RECORD.size,
            len(storms),
        )
    ]
    manifests = []
    offset = BINARY_HEADER.size
    for storm in storms:
        start = offset
        for pixel in storm.pop("pixels"):
            lead24 = pixel["leads"]["24"]
            lead48 = pixel["leads"]["48"]
            packed = BINARY_RECORD.pack(
                pixel["lat"],
                pixel["lon"],
                pixel["distanceToTrackKm"],
                pixel["backgroundSstC"],
                pixel["passageUnixS"],
                lead24["deltaSstC"],
                lead24["analysisErrorC"],
                lead24["validUnixS"],
                lead48["deltaSstC"],
                lead48["analysisErrorC"],
                lead48["validUnixS"],
            )
            chunks.append(packed)
            offset += len(packed)
        manifests.append(
            {
                "id": storm["id"],
                "byteOffset": start,
                "byteLength": offset - start,
                "records": storm["diagnostics"]["commonPixels"],
            }
        )
    return b"".join(chunks), manifests


def _inside(point: dict) -> bool:
    lon_min, lon_max, lat_min, lat_max = DOMAIN
    return (
        lat_min <= float(point["lat"]) <= lat_max
        and lon_min <= float(point["lon"]) <= lon_max
    )


def _scored_track(storm: dict, points: list[dict]) -> list[dict]:
    """Return the same post-initialization, first-domain-exit track HF-1 scores."""
    start = _parse_iso(storm["initialFix"]["iso"])
    selected = []
    started = False
    for point in points:
        when = _parse_iso(point["iso"])
        if when < start:
            continue
        if not _inside(point):
            if started:
                break
            continue
        started = True
        selected.append(point)
    if len(selected) < 2:
        raise ValueError(f"{storm['id']}: insufficient scored in-domain track")
    return selected


def _eligible_storms(catalog: dict) -> list[dict]:
    storms = [
        storm
        for storm in catalog["storms"]
        if int(storm["year"]) >= SOURCE_COVERAGE_START.year
    ]
    return sorted(storms, key=lambda storm: (int(storm["year"]), storm["id"]))


def _track_bounds(points: list[dict]) -> tuple[float, float, float, float]:
    active = [point for point in points if _inside(point)]
    if not active:
        raise ValueError("storm has no in-domain track points")
    lats = [float(point["lat"]) for point in active]
    lons = [float(point["lon"]) for point in active]
    # Three degrees is slightly wider than the 300 km evaluation swath at the
    # product's northern edge.  Clip only after expansion.
    return (
        max(DOMAIN[0], min(lons) - 3.0),
        min(DOMAIN[1], max(lons) + 3.0),
        max(DOMAIN[2], min(lats) - 3.0),
        min(DOMAIN[3], max(lats) + 3.0),
    )


def _download_window(points: list[dict]) -> tuple[dt.datetime, dt.datetime]:
    active = [point for point in points if _inside(point)]
    first = min(_parse_iso(point["iso"]) for point in active)
    last = max(_parse_iso(point["iso"]) for point in active)
    start = (first - dt.timedelta(hours=120)).replace(
        hour=ANALYSIS_HOUR, minute=0, second=0, microsecond=0
    )
    if start > first - dt.timedelta(hours=120):
        start -= dt.timedelta(days=1)
    stop = (last + dt.timedelta(hours=60)).replace(
        hour=ANALYSIS_HOUR, minute=0, second=0, microsecond=0
    )
    if stop < last + dt.timedelta(hours=60):
        stop += dt.timedelta(days=1)
    return max(start, SOURCE_COVERAGE_START), stop


def _subset_url(points: list[dict]) -> tuple[str, dict]:
    lon_min, lon_max, lat_min, lat_max = _track_bounds(points)
    start, stop = _download_window(points)
    axes = (
        f"[({_iso(start)}):1:({_iso(stop)})]"
        f"[({lat_min:.3f}):{GRID_STRIDE}:({lat_max:.3f})]"
        f"[({lon_min:.3f}):{GRID_STRIDE}:({lon_max:.3f})]"
    )
    query = f"analysed_sst{axes},analysis_error{axes}"
    return f"{SOURCE_URL}.nc?{urllib.parse.quote(query, safe='(),:[]')}" , {
        "startIso": _iso(start),
        "stopIso": _iso(stop),
        "bbox": [lon_min, lon_max, lat_min, lat_max],
        "gridStride": GRID_STRIDE,
    }


def _fetch(storm: dict, points: list[dict]) -> tuple[Path, dict]:
    url, window = _subset_url(points)
    query_id = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    filename = f"hf2a_sst_{storm['id']}_{query_id}.nc"
    path = Path(sources.ensure_download(url, filename, timeout=300))
    window.update(
        {
            "path": str(path.relative_to(ROOT)),
            "bytes": path.stat().st_size,
            "sha256": _sha256(path),
        }
    )
    return path, window


def _load_subset(path: Path):
    handle = netcdf_file(path, "r", mmap=False)
    try:
        times = np.asarray(handle.variables["time"].data, dtype=np.float64)
        lats = np.asarray(handle.variables["latitude"].data, dtype=np.float64)
        lons = np.asarray(handle.variables["longitude"].data, dtype=np.float64)
        sst = np.asarray(handle.variables["analysed_sst"].data, dtype=np.float64)
        error = np.asarray(handle.variables["analysis_error"].data, dtype=np.float64)
    finally:
        handle.close()
    if sst.shape != (times.size, lats.size, lons.size) or error.shape != sst.shape:
        raise ValueError(f"{path}: inconsistent subset dimensions")
    sst[sst < -100] = np.nan
    error[(error < 0) | (error > 100)] = np.nan
    if times.size < 3 or not np.all(np.diff(times) > 0):
        raise ValueError(f"{path}: SST time axis is missing or not increasing")
    return times, lats, lons, sst, error


def _dense_track(points: list[dict], step_minutes: int = 15):
    usable = [
        point
        for point in points
        if point.get("lat") is not None and point.get("lon") is not None
    ]
    times: list[float] = []
    lats: list[float] = []
    lons: list[float] = []
    for left, right in zip(usable, usable[1:]):
        start = _parse_iso(left["iso"]).timestamp()
        stop = _parse_iso(right["iso"]).timestamp()
        if stop <= start:
            continue
        steps = max(1, int(round((stop - start) / (step_minutes * 60))))
        for index in range(steps):
            weight = index / steps
            times.append(start + (stop - start) * weight)
            lats.append(float(left["lat"]) + (float(right["lat"]) - float(left["lat"])) * weight)
            lons.append(float(left["lon"]) + (float(right["lon"]) - float(left["lon"])) * weight)
    last = usable[-1]
    times.append(_parse_iso(last["iso"]).timestamp())
    lats.append(float(last["lat"]))
    lons.append(float(last["lon"]))
    return np.asarray(times), np.asarray(lats), np.asarray(lons)


def _local_passage(lats: np.ndarray, lons: np.ndarray, points: list[dict]):
    track_time, track_lat, track_lon = _dense_track(points)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    flat_lat = lat_grid.ravel()
    flat_lon = lon_grid.ravel()
    best_km = np.full(flat_lat.shape, np.inf)
    best_time = np.zeros(flat_lat.shape, dtype=np.float64)
    for timestamp, lat, lon in zip(track_time, track_lat, track_lon):
        dlat = np.radians(flat_lat - lat)
        dlon = np.radians(flat_lon - lon)
        mean_lat = np.radians((flat_lat + lat) * 0.5)
        distance = EARTH_RADIUS_KM * np.hypot(dlat, dlon * np.cos(mean_lat))
        better = distance < best_km
        best_km[better] = distance[better]
        best_time[better] = timestamp
    return flat_lat, flat_lon, best_km, best_time


def _nearest_time_index(times: np.ndarray, target: float) -> int | None:
    index = int(np.argmin(np.abs(times - target)))
    if abs(float(times[index]) - target) > 13 * 3600:
        return None
    return index


def _storm_observations(path: Path, points: list[dict]) -> tuple[list[dict], dict]:
    times, lats, lons, sst, error = _load_subset(path)
    flat_lat, flat_lon, distance_km, passage_time = _local_passage(lats, lons, points)
    flat_sst = sst.reshape(sst.shape[0], -1)
    flat_error = error.reshape(error.shape[0], -1)
    pixels: list[dict] = []
    lead_counts = {str(lead): 0 for lead in LEADS_H}
    for pixel_index in np.flatnonzero(distance_km <= MAX_TRACK_DISTANCE_KM):
        passage = float(passage_time[pixel_index])
        offsets_h = (times - passage) / 3600
        baseline_indices = np.flatnonzero(
            (offsets_h >= BASELINE_WINDOW_H[0])
            & (offsets_h <= BASELINE_WINDOW_H[1])
            & np.isfinite(flat_sst[:, pixel_index])
            & np.isfinite(flat_error[:, pixel_index])
            & (flat_error[:, pixel_index] <= MAX_ERROR_C)
        )
        if baseline_indices.size < MINIMUM_BASELINE_DAYS:
            continue
        background = float(np.median(flat_sst[baseline_indices, pixel_index]))
        row = {
            "lat": float(flat_lat[pixel_index]),
            "lon": float(flat_lon[pixel_index]),
            "distanceToTrackKm": float(distance_km[pixel_index]),
            "passageUnixS": int(round(passage)),
            "backgroundSstC": background,
            "leads": {},
        }
        for lead_h in LEADS_H:
            time_index = _nearest_time_index(times, passage + lead_h * 3600)
            if time_index is None:
                continue
            value = float(flat_sst[time_index, pixel_index])
            uncertainty = float(flat_error[time_index, pixel_index])
            if (
                not math.isfinite(value)
                or not math.isfinite(uncertainty)
                or uncertainty > MAX_ERROR_C
            ):
                continue
            row["leads"][str(lead_h)] = {
                "deltaSstC": value - background,
                "analysisErrorC": uncertainty,
                "validUnixS": int(round(float(times[time_index]))),
            }
            lead_counts[str(lead_h)] += 1
        if len(row["leads"]) == len(LEADS_H):
            pixels.append(row)
    if len(pixels) < MINIMUM_STORM_PIXELS:
        raise ValueError(
            f"{path}: only {len(pixels)} common valid wake pixels; "
            f"need {MINIMUM_STORM_PIXELS}"
        )
    observed = {}
    for lead_h in LEADS_H:
        anomalies = np.asarray(
            [pixel["leads"][str(lead_h)]["deltaSstC"] for pixel in pixels]
        )
        cooling = np.maximum(0.0, -anomalies)
        observed[str(lead_h)] = {
            "pixels": int(anomalies.size),
            "meanDeltaSstC": float(np.mean(anomalies)),
            "meanCoolingC": float(np.mean(cooling)),
            "peakCoolingP95C": float(np.percentile(cooling, 95)),
            "coldAreaFractionBelowMinus0_5C": float(np.mean(anomalies <= -0.5)),
        }
    return pixels, {"commonPixels": len(pixels), "observed": observed, "rawLeadCounts": lead_counts}


def build(*, check: bool = False, fetch_only: bool = False) -> dict:
    catalog = _read_json(CATALOG_PATH)
    tracks_doc = _read_json(TRACKS_PATH)
    tracks = {storm["id"]: storm for storm in tracks_doc["storms"]}
    storms_out = []
    for storm in _eligible_storms(catalog):
        track = tracks.get(storm["id"])
        if track is None:
            raise ValueError(f"missing track for {storm['id']}")
        scored_track = _scored_track(storm, track["points"])
        path, raw = _fetch(storm, scored_track)
        print(f"  [ocean] {storm['id']} ({storm['partition']})")
        if fetch_only:
            continue
        pixels, diagnostics = _storm_observations(path, scored_track)
        storms_out.append(
            {
                "id": storm["id"],
                "label": storm["label"],
                "year": storm["year"],
                "partition": storm["partition"],
                "raw": raw,
                "diagnostics": diagnostics,
                "pixels": pixels,
            }
        )
    if fetch_only:
        return {"fetched": len(_eligible_storms(catalog))}
    binary, binary_storms = _binary_records(storms_out)
    binary_sha = hashlib.sha256(binary).hexdigest()
    payload = {
        "schemaVersion": 1,
        "generatedBy": "bake/hf2a_ocean_benchmark.py",
        "source": {
            "name": "NOAA NESDIS Geo-polar Blended Night-only Foundation SST",
            "datasetId": DATASET_ID,
            "infoUrl": SOURCE_INFO,
            "resolutionDegrees": 0.05,
            "selectedStride": GRID_STRIDE,
            "selectedResolutionDegrees": 0.1,
            "maximumAnalysisErrorC": MAX_ERROR_C,
            "license": "GHRSST free and open data-use protocol",
        },
        "protocol": {
            "catalogSha256": _sha256(CATALOG_PATH),
            "tracksSha256": _sha256(TRACKS_PATH),
            "maximumTrackDistanceKm": MAX_TRACK_DISTANCE_KM,
            "baselineWindowBeforeLocalPassageH": list(BASELINE_WINDOW_H),
            "evaluationLeadsAfterLocalPassageH": list(LEADS_H),
            "minimumBaselineDays": MINIMUM_BASELINE_DAYS,
            "minimumStormPixels": MINIMUM_STORM_PIXELS,
            "selectionPolicy": "all frozen HF-1 storms within source coverage; pixels selected only by observed track distance, source validity, and source uncertainty",
            "aggregationPolicy": "pixel errors aggregate to one metric per storm before partition scoring",
        },
        "binary": {
            "path": str(BINARY_PATH.relative_to(ROOT)),
            "magic": BINARY_MAGIC.decode("ascii"),
            "version": BINARY_VERSION,
            "headerBytes": BINARY_HEADER.size,
            "recordBytes": BINARY_RECORD.size,
            "recordLayout": "float32 lat,lon,distanceKm,backgroundSstC; int64 passageUnixS; per 24/48h: float32 deltaSstC,errorC,int64 validUnixS",
            "bytes": len(binary),
            "sha256": binary_sha,
            "storms": binary_storms,
        },
        "storms": storms_out,
    }
    text = _output_text(payload)
    if check:
        existing = OUTPUT_PATH.read_text() if OUTPUT_PATH.exists() else ""
        existing_binary = BINARY_PATH.read_bytes() if BINARY_PATH.exists() else b""
        if existing != text or existing_binary != binary:
            raise SystemExit("[hf2a-ocean] observation artifact drift")
        print(f"[hf2a-ocean] PASS {len(storms_out)} storms; artifact stable")
    else:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        BINARY_PATH.write_bytes(binary)
        OUTPUT_PATH.write_text(text)
        print(
            f"[hf2a-ocean] wrote {OUTPUT_PATH.relative_to(ROOT)} "
            f"({len(storms_out)} storms)"
        )
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--fetch-only", action="store_true")
    args = parser.parse_args()
    build(check=args.check, fetch_only=args.fetch_only)
