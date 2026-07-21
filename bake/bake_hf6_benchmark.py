"""Bake ERA5 environment and pressure-steering bins for the sealed HF-6 cohort."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import era5_event
from bake_fidelity_benchmark import _hours_between, _organization
from fidelity_catalog import ROOT, event_files
from hf6_catalog import CATALOG_PATH, TRACKS_PATH


RAW = ROOT / "data" / "raw"
OUT = ROOT / "calibration" / "data" / "hf6"
FORCING = OUT / "forcing"
SCENARIOS = OUT / "sealed-scenarios.json"
STEERING_MANIFEST = OUT / "steering-manifest.json"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _quadrants(value: float | None) -> dict | None:
    if value is None:
        return None
    return {key: value for key in ("ne", "se", "sw", "nw")}


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text())
    tracks_doc = json.loads(TRACKS_PATH.read_text())
    tracks = {track["id"]: track for track in tracks_doc["storms"]}
    cases = [
        case
        for case in catalog["cases"]
        if case["partition"] == "sealed-confirmation"
    ]
    FORCING.mkdir(parents=True, exist_ok=True)
    scenarios = []
    steering_records = []
    for case in cases:
        wind_paths = [RAW / name for name in event_files(case, "wind")]
        rh_paths = [RAW / name for name in event_files(case, "rh")]
        sst_paths = [RAW / name for name in event_files(case, "sst")]
        missing = [
            path
            for path in (*wind_paths, *rh_paths, *sst_paths)
            if not path.exists()
        ]
        if missing:
            raise FileNotFoundError(
                f"{case['id']}: missing {', '.join(str(path) for path in missing)}"
            )
        diagnostic = era5_event.build_event_env(
            case["id"],
            case["monthIndex"],
            [str(path) for path in wind_paths],
            [str(path) for path in rh_paths],
            [str(path) for path in sst_paths],
            str(FORCING),
            track_points=tracks[case["id"]]["points"],
        )
        environment_path = Path(diagnostic["path"])
        steering_path = FORCING / f"steering_{case['id']}.bin"
        steering_diagnostic = era5_event.build_pressure_wind_sidecar(
            [str(path) for path in wind_paths], str(steering_path)
        )
        steering_records.append(
            {
                "id": case["id"],
                "path": str(steering_path.relative_to(ROOT)),
                "bytes": steering_path.stat().st_size,
                "sha256": _sha(steering_path),
                "sourceWindFiles": [
                    {
                        "path": str(path.relative_to(ROOT)),
                        "bytes": path.stat().st_size,
                        "sha256": _sha(path),
                    }
                    for path in wind_paths
                ],
                **{
                    key: value
                    for key, value in steering_diagnostic.items()
                    if key != "path"
                },
            }
        )
        for initialization in case["initializations"]:
            initial_fix = {
                "iso": initialization["startIso"],
                "lat": initialization["lat"],
                "lon": initialization["lon"],
                "windKt": initialization["initialWindKt"],
            }
            offset_h = _hours_between(
                diagnostic["start_iso"], initialization["startIso"]
            )
            scenario_id = f"{case['id']}__{initialization['id']}"
            scenarios.append(
                {
                    "id": scenario_id,
                    "caseId": case["id"],
                    "initializationId": initialization["id"],
                    "label": f"{case['name']} {initialization['id']}",
                    "bin": str(environment_path.relative_to(ROOT)),
                    "steeringBin": str(steering_path.relative_to(ROOT)),
                    "monthIndex": case["monthIndex"],
                    "stepH": era5_event.DECIMATE,
                    "windowH": diagnostic["windowH"],
                    "startIso": diagnostic["start_iso"],
                    "spawn": {
                        "lat": initialization["lat"],
                        "lon": initialization["lon"],
                        "seed": case["seed"] + initialization["offsetFromFirstH"],
                    },
                    "ghostId": case["id"],
                    "benchmarkPartition": "validation",
                    "hf6Partition": "sealed-confirmation",
                    "hindcast": {
                        "startIso": initialization["startIso"],
                        "lat": initialization["lat"],
                        "lon": initialization["lon"],
                        "initialWindKt": initialization["initialWindKt"],
                        "initialOrganization": _organization(initial_fix),
                        "envOffsetH": offset_h,
                    },
                    "structureInitialization": {
                        "rmwKm": initialization["initialRmwKm"],
                        "outerSizePriorKm": None,
                        "r34Km": _quadrants(initialization["initialR34Km"]),
                        "r50Km": _quadrants(initialization["initialR50Km"]),
                        "r64Km": _quadrants(initialization["initialR64Km"]),
                    },
                }
            )
        print(
            f"[hf6-bake] {case['id']}: {diagnostic['planes']} environment planes"
        )
    SCENARIOS.write_text(
        json.dumps({"schemaVersion": 1, "scenarios": scenarios}, indent=2) + "\n"
    )
    STEERING_MANIFEST.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "phase": "HF-6",
                "sealId": catalog["sealId"],
                "storms": steering_records,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"[hf6-bake] wrote {len(scenarios)} sealed initializations")


if __name__ == "__main__":
    main()
