#!/usr/bin/env python3
"""
Extract a pinned, agency-consistent North Indian Ocean structure dataset.

The source is the official IBTrACS v04r01 North Indian basin CSV already used
by the map bake. This extractor deliberately keeps only six-hour, main-track,
tropical JTWC/USA fixes. Position, intensity, pressure, RMW, and wind radii all
come from the USA columns so one observation never mixes agencies.

The committed normalized subset is the reproducibility boundary. The 26 MB raw
download remains under data/raw/ and is intentionally gitignored.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "raw" / "ibtracs.NI.csv"
DEFAULT_OUTPUT = (
    ROOT / "calibration" / "data" / "ibtracs-ni-jtwc-2019-2024.json"
)

SOURCE_URL = (
    "https://www.ncei.noaa.gov/data/"
    "international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
)
SOURCE_VERSION = "IBTrACS v04r01"
SOURCE_SHA256 = "02f6af3b7e12ee76e88866995b4451b85867a2b7f20ed2666f8561024d671b62"
SNAPSHOT_DATE = "2026-07-19"
START_SEASON = 2019
END_SEASON = 2024
TROPICAL_STATUSES = {"TD", "TS", "TY", "ST"}
NM_TO_KM = 1.852
EARTH_RADIUS_M = 6_371_008.8
QUADRANTS = ("ne", "se", "sw", "nw")
THRESHOLDS = (34, 50, 64)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def number(cell: str) -> float | None:
    try:
        value = float(cell.strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def bounded(cell: str, minimum: float, maximum: float) -> float | None:
    value = number(cell)
    if value is None or value < minimum or value > maximum:
        return None
    return value


def positive_nm_to_km(cell: str, maximum_nm: float) -> float | None:
    value = bounded(cell, 0.01, maximum_nm)
    return None if value is None else round(value * NM_TO_KM, 3)


def iso_z(raw: str) -> str:
    return datetime.fromisoformat(raw.strip()).isoformat(timespec="seconds") + "Z"


def longitude_delta_degrees(start: float, end: float) -> float:
    return (end - start + 540.0) % 360.0 - 180.0


def motion(
    start: dict[str, Any],
    end: dict[str, Any],
) -> tuple[float, float]:
    t0 = datetime.fromisoformat(start["iso"].removesuffix("Z"))
    t1 = datetime.fromisoformat(end["iso"].removesuffix("Z"))
    seconds = (t1 - t0).total_seconds()
    if seconds <= 0:
        return 0.0, 0.0
    mean_lat_rad = math.radians((start["lat"] + end["lat"]) / 2.0)
    east_m = (
        math.radians(longitude_delta_degrees(start["lon"], end["lon"]))
        * EARTH_RADIUS_M
        * math.cos(mean_lat_rad)
    )
    north_m = math.radians(end["lat"] - start["lat"]) * EARTH_RADIUS_M
    return east_m / seconds, north_m / seconds


def read_rows(path: Path) -> tuple[list[dict[str, Any]], int]:
    observations: list[dict[str, Any]] = []
    source_rows = 0
    seen: set[tuple[str, str]] = set()

    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        next(reader)  # IBTrACS units row.
        for row in reader:
            source_rows += 1
            try:
                season = int(row["SEASON"])
                timestamp = datetime.fromisoformat(row["ISO_TIME"].strip())
            except (ValueError, KeyError):
                continue
            if not START_SEASON <= season <= END_SEASON:
                continue
            if row["TRACK_TYPE"].strip() != "main":
                continue
            if row["USA_STATUS"].strip() not in TROPICAL_STATUSES:
                continue
            if timestamp.minute != 0 or timestamp.second != 0:
                continue
            if timestamp.hour not in (0, 6, 12, 18):
                continue

            lat = bounded(row["USA_LAT"], -40, 40)
            lon = bounded(row["USA_LON"], -180, 360)
            wind = bounded(row["USA_WIND"], 1, 200)
            if lat is None or lon is None or wind is None:
                continue
            if lon > 180:
                lon -= 360

            sid = row["SID"].strip()
            timestamp_iso = iso_z(row["ISO_TIME"])
            identity = (sid, timestamp_iso)
            if not sid or identity in seen:
                continue
            seen.add(identity)

            pressure = bounded(row["USA_PRES"], 850, 1050)
            rmw = positive_nm_to_km(row["USA_RMW"], 300)
            radii: dict[str, dict[str, float | None]] = {}
            for threshold in THRESHOLDS:
                radii[f"r{threshold}Km"] = {
                    quadrant: positive_nm_to_km(
                        row[f"USA_R{threshold}_{quadrant.upper()}"],
                        600,
                    )
                    for quadrant in QUADRANTS
                }

            distance_to_land = bounded(row["DIST2LAND"], 0, 10_000)
            observations.append(
                {
                    "sid": sid,
                    "season": season,
                    "name": row["NAME"].strip() or "UNNAMED",
                    "subbasin": row["SUBBASIN"].strip() or "NI",
                    "iso": timestamp_iso,
                    "status": row["USA_STATUS"].strip(),
                    "lat": round(lat, 3),
                    "lon": round(lon, 3),
                    "windKt": round(wind, 1),
                    "pressureHpa": (
                        None if pressure is None else round(pressure, 1)
                    ),
                    "rmwKm": rmw,
                    **radii,
                    "distanceToLandKm": (
                        None
                        if distance_to_land is None
                        else round(distance_to_land, 1)
                    ),
                    "overLand": distance_to_land == 0,
                }
            )

    observations.sort(key=lambda item: (item["sid"], item["iso"]))
    return observations, source_rows


def attach_motion(observations: list[dict[str, Any]]) -> None:
    storms: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        storms[observation["sid"]].append(observation)

    for fixes in storms.values():
        for index, fix in enumerate(fixes):
            previous = fixes[index - 1] if index > 0 else None
            following = fixes[index + 1] if index + 1 < len(fixes) else None
            start = previous or fix
            end = following or fix
            motion_u, motion_v = motion(start, end)
            if previous is None:
                delta_hours = 0.0
            else:
                current_time = datetime.fromisoformat(fix["iso"].removesuffix("Z"))
                previous_time = datetime.fromisoformat(
                    previous["iso"].removesuffix("Z")
                )
                delta_hours = (current_time - previous_time).total_seconds() / 3600
            fix["motionUms"] = round(motion_u, 4)
            fix["motionVms"] = round(motion_v, 4)
            fix["deltaHours"] = round(max(0.0, delta_hours), 3)


def counts(observations: list[dict[str, Any]]) -> dict[str, Any]:
    def populated(field: str, minimum_season: int) -> int:
        return sum(
            1
            for observation in observations
            if observation["season"] >= minimum_season
            and observation["windKt"] >= 34
            and observation[field] is not None
        )

    def populated_radii(field: str, minimum_season: int) -> int:
        return sum(
            1
            for observation in observations
            if observation["season"] >= minimum_season
            and any(value is not None for value in observation[field].values())
        )

    return {
        "storms": len({observation["sid"] for observation in observations}),
        "fixes": len(observations),
        "pressureFixes": populated("pressureHpa", 2019),
        "rmwFixesExploratory": populated("rmwKm", 2019),
        "r34Fixes": populated_radii("r34Km", 2019),
        "r50Fixes": populated_radii("r50Km", 2022),
        "r64Fixes": populated_radii("r64Km", 2022),
    }


def main() -> int:
    args = parse_args()
    if not args.source.exists():
        raise SystemExit(
            f"missing {args.source}; run the normal bake once to fetch IBTrACS"
        )
    actual_sha = sha256(args.source)
    if actual_sha != SOURCE_SHA256:
        raise SystemExit(
            "IBTrACS source hash changed. Inspect the new release, then update "
            f"SOURCE_SHA256 deliberately.\nexpected {SOURCE_SHA256}\nactual   {actual_sha}"
        )

    observations, source_rows = read_rows(args.source)
    attach_motion(observations)
    payload = {
        "schemaVersion": 1,
        "source": {
            "name": SOURCE_VERSION,
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "snapshotDate": SNAPSHOT_DATE,
            "basin": "NI",
            "agencyColumns": "USA/JTWC",
            "sourceRows": source_rows,
        },
        "selection": {
            "seasons": [START_SEASON, END_SEASON],
            "intervalHours": 6,
            "trackType": "main",
            "statuses": sorted(TROPICAL_STATUSES),
            "positionAndStructureAgency": "USA/JTWC",
            "r34QualityStartSeason": 2019,
            "r50R64QualityStartSeason": 2022,
            "rmwUse": "exploratory-only",
            "pressureUse": "moderate-confidence",
        },
        "units": {
            "wind": "kt, 1-minute sustained",
            "pressure": "hPa",
            "distance": "km",
            "motion": "m/s, centred finite difference where possible",
        },
        "counts": counts(observations),
        "observations": observations,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"[structure-data] wrote {args.output.relative_to(ROOT)}: "
        f"{payload['counts']['storms']} storms, "
        f"{payload['counts']['fixes']} six-hour fixes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
