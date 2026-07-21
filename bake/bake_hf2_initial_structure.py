#!/usr/bin/env python3
"""Extract agency-consistent HF-2C initialization structure sidecar."""

from __future__ import annotations

import csv
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(__file__))
RAW_PATH = os.path.join(ROOT, "data", "raw", "ibtracs.NI.csv")
CATALOG_PATH = os.path.join(ROOT, "calibration", "fidelity-catalog.json")
OUT_PATH = os.path.join(ROOT, "calibration", "data", "hf2-initial-structure.json")
QUADRANTS = ("ne", "se", "sw", "nw")


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def nautical_miles_to_km(raw: str, maximum_nm: float = 600) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value <= 0 or value > maximum_nm:
        return None
    return round(value * 1.852, 3)


def radii(row: dict[str, str], threshold: int) -> dict[str, float | None]:
    return {
        quadrant: nautical_miles_to_km(row[f"USA_R{threshold}_{quadrant.upper()}"])
        for quadrant in QUADRANTS
    }


def main() -> None:
    with open(CATALOG_PATH, encoding="utf-8") as handle:
        catalog = json.load(handle)
    wanted = {
        (storm["sid"], storm["initialFix"]["iso"]): storm
        for storm in catalog["storms"]
    }
    found: dict[tuple[str, str], dict[str, str]] = {}
    with open(RAW_PATH, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            key = (row.get("SID", "").strip(), row.get("ISO_TIME", "").strip().replace(" ", "T") + "Z")
            if key in wanted:
                found[key] = row

    storms = []
    for key, storm in wanted.items():
        row = found.get(key)
        r34 = radii(row, 34) if row else {quadrant: None for quadrant in QUADRANTS}
        positive_r34 = [value for value in r34.values() if value is not None]
        storms.append(
            {
                "id": storm["id"],
                "sid": storm["sid"],
                "initializationTime": storm["initialFix"]["iso"],
                "sourceAgency": "USA/JTWC",
                "windAveragingPeriodMinutes": 1,
                "rmwKm": nautical_miles_to_km(row.get("USA_RMW", ""), 300) if row else None,
                "outerSizePriorKm": round(sum(positive_r34) / len(positive_r34), 3) if positive_r34 else None,
                "r34Km": r34,
                "r50Km": radii(row, 50) if row else {quadrant: None for quadrant in QUADRANTS},
                "r64Km": radii(row, 64) if row else {quadrant: None for quadrant in QUADRANTS},
                "missingDataPrior": "live climatological relationship" if row is None or (not positive_r34 and not row.get("USA_RMW", "").strip()) else None,
            }
        )
    output = {
        "schemaVersion": 1,
        "source": {
            "name": "NOAA IBTrACS v04r01 North Indian basin USA/JTWC fields",
            "path": "data/raw/ibtracs.NI.csv",
            "sha256": sha256(RAW_PATH),
        },
        "catalog": {
            "path": "calibration/fidelity-catalog.json",
            "sha256": sha256(CATALOG_PATH),
        },
        "contract": "RMW and radii are used only when present at the exact agency-consistent initialization fix; blanks remain an explicit climatological prior.",
        "counts": {
            "storms": len(storms),
            "rmw": sum(item["rmwKm"] is not None for item in storms),
            "r34": sum(any(value is not None for value in item["r34Km"].values()) for item in storms),
            "r50": sum(any(value is not None for value in item["r50Km"].values()) for item in storms),
            "r64": sum(any(value is not None for value in item["r64Km"].values()) for item in storms),
        },
        "storms": storms,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")
    print(f"[hf2-initial-structure] wrote {OUT_PATH}: {output['counts']}")


if __name__ == "__main__":
    main()
