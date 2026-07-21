"""Audit HF-6 outcome availability and prespecified performance strata."""

from __future__ import annotations

import collections
import hashlib
import json
import math
from pathlib import Path

from hf6_catalog import CATALOG_PATH, ROOT, TRACKS_PATH, _time


OUT = ROOT / "calibration" / "hf6-observation-audit.json"
LEADS_H = (12, 24, 48, 72)


def _great_circle(a: dict, b: dict) -> float:
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    dlat = lat2 - lat1
    dlon = math.radians(b["lon"] - a["lon"])
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(value)))


def _point_at(points: list[dict], start_iso: str, lead_h: int) -> dict | None:
    target = _time(start_iso).timestamp() + lead_h * 3600
    for point in points:
        if _time(point["iso"]).timestamp() == target:
            return point
    return None


def _season(month: int) -> str:
    if 4 <= month <= 6:
        return "pre-monsoon"
    if 7 <= month <= 9:
        return "monsoon"
    if 10 <= month <= 12:
        return "post-monsoon"
    return "winter"


def _intensity(wind: float | None, canonical: bool) -> str:
    if wind is None or not canonical:
        return "missing-or-noncanonical"
    if wind < 34:
        return "below-34-kt"
    if wind < 64:
        return "34-63-kt"
    if wind < 96:
        return "64-95-kt"
    return "96-plus-kt"


def _era(year: int) -> str:
    if year < 1970:
        return "pre-satellite"
    if year < 2000:
        return "early-satellite"
    return "modern"


def _count(values: list[str]) -> dict[str, int]:
    return dict(sorted(collections.Counter(values).items()))


def main() -> None:
    catalog_bytes = CATALOG_PATH.read_bytes()
    tracks_bytes = TRACKS_PATH.read_bytes()
    catalog = json.loads(catalog_bytes)
    tracks_doc = json.loads(tracks_bytes)
    tracks = {track["id"]: track["points"] for track in tracks_doc["storms"]}
    rows: list[dict] = []
    for case in catalog["cases"]:
        points = tracks[case["id"]]
        for initialization in case["initializations"]:
            lead_availability = {}
            baseline_24 = None
            for lead_h in LEADS_H:
                observed = _point_at(points, initialization["startIso"], lead_h)
                lead_availability[str(lead_h)] = {
                    "track": observed is not None,
                    "oneMinuteWind": bool(
                        observed
                        and observed["windKt"] is not None
                        and observed["windCanonicalOneMinute"]
                    ),
                    "usaPressure": bool(
                        observed
                        and observed["presMb"] is not None
                        and observed["pressureCanonicalUsa"]
                    ),
                }
                if lead_h == 24 and observed is not None:
                    baseline_24 = _great_circle(initialization, observed)
            after = [
                point
                for point in points
                if point["iso"] >= initialization["startIso"]
            ]
            canonical_winds = [
                (point["iso"], point["windKt"])
                for point in after
                if point["windKt"] is not None
                and point["windCanonicalOneMinute"]
            ]
            ri_pairs = 0
            for iso, wind in canonical_winds:
                later = next(
                    (
                        later_wind
                        for later_iso, later_wind in canonical_winds
                        if (_time(later_iso) - _time(iso)).total_seconds() == 24 * 3600
                    ),
                    None,
                )
                if later is not None:
                    ri_pairs += 1
            distances = [
                point["distanceToLandKm"]
                for point in after
                if point["distanceToLandKm"] is not None
            ]
            structure = {
                threshold: sum(point[threshold] is not None for point in after)
                for threshold in ("rmwKm", "r34Km", "r50Km", "r64Km")
            }
            next_point = _point_at(points, initialization["startIso"], 6)
            speed_kmh = (
                _great_circle(initialization, next_point) / 6
                if next_point is not None
                else None
            )
            rows.append(
                {
                    "caseId": case["id"],
                    "sid": case["sid"],
                    "partition": case["partition"],
                    "initializationId": initialization["id"],
                    "startIso": initialization["startIso"],
                    "leadAvailability": lead_availability,
                    "stationary24hErrorKm": baseline_24,
                    "outcomeAvailability": {
                        "landfallPositionTimeProxy": any(value <= 0 for value in distances),
                        "peakIntensityTime": len(canonical_winds) >= 2,
                        "rapidIntensification": ri_pairs > 0,
                        "dissipation": bool(
                            canonical_winds
                            and any(wind >= 34 for _, wind in canonical_winds)
                            and canonical_winds[-1][1] < 34
                        ),
                        "rmwSamples": structure["rmwKm"],
                        "r34Samples": structure["r34Km"],
                        "r50Samples": structure["r50Km"],
                        "r64Samples": structure["r64Km"],
                    },
                    "strata": {
                        "season": _season(_time(initialization["startIso"]).month),
                        "initialIntensity": _intensity(
                            initialization["initialWindKt"],
                            initialization["windCanonicalOneMinute"],
                        ),
                        "motion": (
                            "missing"
                            if speed_kmh is None
                            else "slow"
                            if speed_kmh < 10
                            else "moderate"
                            if speed_kmh < 20
                            else "fast"
                        ),
                        "landInteraction": (
                            "missing"
                            if not distances
                            else "near-land"
                            if min(distances) <= 50
                            else "open-water"
                        ),
                        "dataEra": _era(case["year"]),
                        "observationAvailability": (
                            "canonical-intensity-and-structure"
                            if canonical_winds and any(structure.values())
                            else "canonical-intensity"
                            if canonical_winds
                            else "track-only-or-noncanonical"
                        ),
                    },
                }
            )
    finite_difficulty = sorted(
        row["stationary24hErrorKm"]
        for row in rows
        if row["stationary24hErrorKm"] is not None
    )
    q1 = finite_difficulty[len(finite_difficulty) // 3]
    q2 = finite_difficulty[(2 * len(finite_difficulty)) // 3]
    for row in rows:
        error = row["stationary24hErrorKm"]
        row["strata"]["forecastDifficulty"] = (
            "missing"
            if error is None
            else "easy"
            if error <= q1
            else "medium"
            if error <= q2
            else "hard"
        )
    lead_summary = {}
    for lead_h in LEADS_H:
        available = [row["leadAvailability"][str(lead_h)] for row in rows]
        lead_summary[str(lead_h)] = {
            key: sum(item[key] for item in available)
            for key in ("track", "oneMinuteWind", "usaPressure")
        }
    outcome_summary = {
        key: sum(
            bool(row["outcomeAvailability"][key])
            for row in rows
        )
        for key in (
            "landfallPositionTimeProxy",
            "peakIntensityTime",
            "rapidIntensification",
            "dissipation",
        )
    }
    outcome_summary.update(
        {
            key: sum(row["outcomeAvailability"][key] for row in rows)
            for key in ("rmwSamples", "r34Samples", "r50Samples", "r64Samples")
        }
    )
    output = {
        "schemaVersion": 1,
        "phase": "HF-6",
        "claimClass": "observation-availability-audit-not-model-skill",
        "storms": len(catalog["cases"]),
        "initializations": len(rows),
        "leadAvailability": lead_summary,
        "outcomeAvailability": outcome_summary,
        "strataCounts": {
            key: _count([row["strata"][key] for row in rows])
            for key in (
                "season",
                "initialIntensity",
                "motion",
                "landInteraction",
                "dataEra",
                "forecastDifficulty",
                "observationAvailability",
            )
        },
        "difficultyThresholdsStationary24hKm": {"easyMax": q1, "mediumMax": q2},
        "manifests": {
            "catalogSha256": hashlib.sha256(catalog_bytes).hexdigest(),
            "tracksSha256": hashlib.sha256(tracks_bytes).hexdigest(),
        },
        "cases": rows,
    }
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(
        f"[hf6-audit] {output['storms']} storms, {output['initializations']} "
        f"initializations -> {OUT.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
