"""Build the outcome-blind HF-6 Arabian Sea case and initialization catalogue."""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

from fidelity_catalog import (
    DOMAIN,
    FROZEN_STORMS,
    INITIAL_NATURES,
    INTERIOR_MARGIN_DEG,
    MINIMUM_WIND_KT,
    PINNED_IBTRACS_SHA256,
    RAW_IBTRACS,
    ROOT,
    request_parts,
)


CATALOG_PATH = ROOT / "calibration" / "data" / "hf6-case-catalog.json"
TRACKS_PATH = ROOT / "calibration" / "data" / "hf6-tracks.json"
TARGET_STORMS = 72
SEALED_STORMS = 8
INITIALIZATION_OFFSETS_H = (0, 6)
MINIMUM_OBSERVATION_HORIZON_H = 12
CASE_INTERIOR_MARGIN_DEG = 0.3
MINIMUM_INITIAL_WIND_KT = 20
CASE_NATURES = ("TS", "NR", "DS")
SEAL_ID = "hf6-arabian-v1-2026-07-21"
SEAL_TIME = "2026-07-21T15:10:00+04:00"


def _number(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def _iso(raw: str) -> str:
    return raw.strip().replace(" ", "T") + "Z"


def _time(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=dt.timezone.utc
    )


def _inside(lat: float, lon: float, margin: float = 0.0) -> bool:
    lon_min, lon_max, lat_min, lat_max = DOMAIN
    return (
        lon_min + margin <= lon <= lon_max - margin
        and lat_min + margin <= lat <= lat_max - margin
    )


def _read_all(path: Path) -> tuple[dict[str, list[dict]], dict[str, str]]:
    tracks: dict[str, dict[str, dict]] = defaultdict(dict)
    names: dict[str, str] = {}
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        next(reader)
        for row in reader:
            if row["TRACK_TYPE"].strip() != "main":
                continue
            sid = row["SID"].strip()
            if not sid or int(sid[:4]) < 1940 or int(sid[:4]) > 2024:
                continue
            lat = _number(row["LAT"])
            lon = _number(row["LON"])
            if lat is None or lon is None:
                continue
            iso = _iso(row["ISO_TIME"])
            usa_wind = _number(row["USA_WIND"])
            usa_pressure = _number(row["USA_PRES"])
            wmo_wind = _number(row["WMO_WIND"])
            wmo_pressure = _number(row["WMO_PRES"])
            wind = usa_wind if usa_wind is not None else wmo_wind
            pressure = usa_pressure if usa_pressure is not None else wmo_pressure
            def radius_mean(prefix: str) -> float | None:
                values = [
                    _number(row[f"{prefix}_{quadrant}"])
                    for quadrant in ("NE", "SE", "SW", "NW")
                ]
                finite_values = [value for value in values if value is not None]
                if not finite_values:
                    return None
                return round(sum(finite_values) / len(finite_values) * 1.852, 3)

            rmw_nm = _number(row["USA_RMW"])
            tracks[sid][iso] = {
                "iso": iso,
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "windKt": None if wind is None else int(round(wind)),
                "presMb": None if pressure is None else int(round(pressure)),
                "windAgency": (
                    "USA/JTWC"
                    if usa_wind is not None
                    else row["WMO_AGENCY"].strip() or None
                ),
                "windCanonicalOneMinute": usa_wind is not None,
                "pressureCanonicalUsa": usa_pressure is not None,
                "rmwKm": None if rmw_nm is None else round(rmw_nm * 1.852, 3),
                "r34Km": radius_mean("USA_R34"),
                "r50Km": radius_mean("USA_R50"),
                "r64Km": radius_mean("USA_R64"),
                "distanceToLandKm": _number(row["DIST2LAND"]),
                "nextLandfallDistanceKm": _number(row["LANDFALL"]),
                "nature": row["NATURE"].strip(),
            }
            name = row["NAME"].strip()
            if name and name != "NOT_NAMED":
                names[sid] = name.title()
    return (
        {sid: [points[key] for key in sorted(points)] for sid, points in tracks.items()},
        names,
    )


def _eligible(points: list[dict]) -> tuple[list[dict], list[dict]] | None:
    first_index = next(
        (
            index
            for index, point in enumerate(points)
            if point["nature"] in CASE_NATURES
            and (
                point["windKt"] is None
                or point["windKt"] >= MINIMUM_INITIAL_WIND_KT
            )
            and _inside(point["lat"], point["lon"], CASE_INTERIOR_MARGIN_DEG)
        ),
        None,
    )
    if first_index is None:
        return None
    contiguous: list[dict] = []
    for point in points[first_index:]:
        if not _inside(point["lat"], point["lon"]):
            break
        contiguous.append(point)
    first_time = _time(contiguous[0]["iso"])
    horizon = (_time(contiguous[-1]["iso"]) - first_time).total_seconds() / 3600
    if horizon < MINIMUM_OBSERVATION_HORIZON_H:
        return None
    max_wind = max(
        (point["windKt"] or 0 for point in contiguous),
        default=0,
    )
    if max_wind < MINIMUM_WIND_KT and not any(
        point["nature"] == "TS" for point in contiguous
    ):
        return None
    initializations: list[dict] = []
    for offset_h in INITIALIZATION_OFFSETS_H:
        target = first_time + dt.timedelta(hours=offset_h)
        match = next(
            (
                point
                for point in contiguous
                if _time(point["iso"]) >= target
                and (_time(point["iso"]) - target).total_seconds() <= 6 * 3600
                and point["nature"] in CASE_NATURES
                and _inside(point["lat"], point["lon"], CASE_INTERIOR_MARGIN_DEG)
            ),
            None,
        )
        if match is None:
            return None
        available_h = (
            _time(contiguous[-1]["iso"]) - _time(match["iso"])
        ).total_seconds() / 3600
        initializations.append(
            {
                "id": f"i{offset_h:02d}",
                "offsetFromFirstH": offset_h,
                "startIso": match["iso"],
                "lat": match["lat"],
                "lon": match["lon"],
                "initialWindKt": match["windKt"],
                "initialWindPriorKt": (
                    None if match["windKt"] is not None else 25
                ),
                "initialPressureMb": match["presMb"],
                "initialRmwKm": match["rmwKm"],
                "initialR34Km": match["r34Km"],
                "initialR50Km": match["r50Km"],
                "initialR64Km": match["r64Km"],
                "availableObservationH": available_h,
                "windAgency": match["windAgency"],
                "windCanonicalOneMinute": match["windCanonicalOneMinute"],
            }
        )
    return contiguous, initializations


def _rank(sid: str, namespace: str) -> str:
    return hashlib.sha256(f"{SEAL_ID}|{namespace}|{sid}".encode()).hexdigest()


def build_documents(path: Path = RAW_IBTRACS) -> tuple[dict, dict]:
    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if source_sha != PINNED_IBTRACS_SHA256:
        raise ValueError(f"IBTrACS snapshot drift: {source_sha}")
    tracks, names = _read_all(path)
    frozen_by_sid = {sid: storm_id for storm_id, sid, *_ in FROZEN_STORMS}
    candidates: dict[str, tuple[list[dict], list[dict]]] = {}
    for sid, points in tracks.items():
        eligible = _eligible(points)
        if eligible is not None:
            candidates[sid] = eligible
    unseen = sorted(
        (
            sid
            for sid, (_, initializations) in candidates.items()
            if sid not in frozen_by_sid
            and all(
                initialization["windCanonicalOneMinute"]
                for initialization in initializations
            )
            and initializations[0]["availableObservationH"] >= 48
        ),
        key=lambda sid: _rank(sid, "sealed"),
    )
    if len(unseen) < SEALED_STORMS:
        raise ValueError(f"only {len(unseen)} unseen eligible storms")
    sealed = set(unseen[:SEALED_STORMS])
    legacy = sorted(
        (sid for sid in candidates if sid in frozen_by_sid),
        key=lambda sid: (int(sid[:4]), sid),
    )
    remaining = sorted(
        (sid for sid in candidates if sid not in sealed and sid not in legacy),
        key=lambda sid: _rank(sid, "broad"),
    )
    selected = legacy + sorted(sealed) + remaining
    selected = selected[:TARGET_STORMS]
    if len(selected) < 60:
        raise ValueError(f"HF-6 requires at least 60 storms; found {len(selected)}")
    if not sealed.issubset(selected):
        raise ValueError("sealed cohort was truncated")

    cases: list[dict] = []
    track_doc: list[dict] = []
    for index, sid in enumerate(selected):
        points, initializations = candidates[sid]
        legacy_id = frozen_by_sid.get(sid)
        partition = (
            "sealed-confirmation"
            if sid in sealed
            else "legacy"
            if legacy_id is not None
            else "broad-report"
        )
        case_id = legacy_id or f"hf6_{sid.lower()}"
        label = names.get(sid) or f"Arabian Sea system {sid[:4]}"
        winds = [point["windKt"] for point in points if point["windKt"] is not None]
        event_start = (_time(points[0]["iso"]) - dt.timedelta(hours=24)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        event_end = (_time(points[-1]["iso"]) + dt.timedelta(hours=24)).replace(
            hour=23, minute=0, second=0, microsecond=0
        )
        cases.append(
            {
                "id": case_id,
                "sid": sid,
                "name": label,
                "year": int(sid[:4]),
                "partition": partition,
                "legacyId": legacy_id,
                "selectionRank": _rank(sid, partition),
                "seed": int(sid[:4]) * 1000 + index,
                "monthIndex": _time(points[0]["iso"]).month - 1,
                "eventStartIso": event_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "eventEndIso": event_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "requestParts": list(request_parts(event_start, event_end)),
                "initializations": initializations,
                "maxObservedWindKt": max(winds) if winds else None,
                "firstFixIso": points[0]["iso"],
                "lastContinuousDomainFixIso": points[-1]["iso"],
            }
        )
        track_doc.append(
            {
                "id": case_id,
                "sid": sid,
                "name": label,
                "year": int(sid[:4]),
                "points": [
                    {key: value for key, value in point.items() if key != "nature"}
                    for point in points
                ],
            }
        )
    partition_counts = Counter(case["partition"] for case in cases)
    init_count = sum(len(case["initializations"]) for case in cases)
    catalog = {
        "schemaVersion": 1,
        "phase": "HF-6",
        "sealedBeforeCandidateEvaluation": True,
        "sealId": SEAL_ID,
        "sealedAt": SEAL_TIME,
        "source": {
            "name": "NOAA IBTrACS v04r01 North Indian basin",
            "path": "data/raw/ibtracs.NI.csv",
            "sha256": source_sha,
            "positionColumns": "IBTrACS common LAT/LON",
            "windColumns": "USA/JTWC when present, otherwise WMO with agency retained",
        },
        "protocol": {
            "years": [1940, 2024],
            "domain": list(DOMAIN),
            "interiorMarginDeg": CASE_INTERIOR_MARGIN_DEG,
            "minimumInitialWindKt": MINIMUM_INITIAL_WIND_KT,
            "requiredStormWindKt": MINIMUM_WIND_KT,
            "initialNature": list(CASE_NATURES),
            "requiredContinuousObservationH": MINIMUM_OBSERVATION_HORIZON_H,
            "initializationOffsetsH": list(INITIALIZATION_OFFSETS_H),
            "maximumFixDelayAfterOffsetH": 6,
            "selection": (
                "all objectively eligible legacy storms, eight unseen storms with "
                "canonical USA/JTWC intensity and at least 48 h of observations "
                "chosen by a predeclared SHA-256 rank, then unseen broad-report storms by a "
                "separate SHA-256 rank; no simulated outcome enters selection"
            ),
            "intensityComparisonPolicy": (
                "one-minute model intensity is scored only against USA/JTWC fixes; "
                "other WMO wind periods remain report-only until an agency-specific "
                "conversion is pinned"
            ),
            "targetStorms": TARGET_STORMS,
            "actualStorms": len(cases),
            "actualInitializations": init_count,
            "partitions": dict(partition_counts),
        },
        "cases": cases,
    }
    return catalog, {"schemaVersion": 1, "storms": track_doc}


def main(check: bool = False) -> None:
    catalog, tracks = build_documents()
    catalog_text = json.dumps(catalog, indent=2) + "\n"
    tracks_text = json.dumps(tracks, separators=(",", ":")) + "\n"
    if check:
        if not CATALOG_PATH.exists() or CATALOG_PATH.read_text() != catalog_text:
            raise ValueError("HF-6 case catalogue is stale")
        if not TRACKS_PATH.exists() or TRACKS_PATH.read_text() != tracks_text:
            raise ValueError("HF-6 tracks artifact is stale")
        print("[hf6-catalog] PASS deterministic catalogue and tracks")
        return
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(catalog_text)
    TRACKS_PATH.write_text(tracks_text)
    print(
        f"[hf6-catalog] {len(catalog['cases'])} storms, "
        f"{catalog['protocol']['actualInitializations']} initializations, "
        f"{catalog['protocol']['partitions']}"
    )


if __name__ == "__main__":
    main("--check" in sys.argv)
