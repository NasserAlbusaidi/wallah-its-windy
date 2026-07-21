"""Bake compact forcing/scenario artefacts for the HF-1 benchmark."""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from scipy.interpolate import RegularGridInterpolator

import era5_event
import sources
import woa23
from fidelity_catalog import CATALOG_PATH, ROOT, TRACKS_PATH, event_files


OUT_DIR = ROOT / "calibration" / "data" / "fidelity"
SCENARIOS_PATH = ROOT / "calibration" / "data" / "fidelity-scenarios.json"
PUBLIC_SCENARIOS_PATH = ROOT / "public" / "data" / "scenarios.json"


def _selected_ids(argv: list[str]) -> set[str] | None:
    if "--ids" not in argv:
        return None
    index = argv.index("--ids")
    if index + 1 >= len(argv):
        raise ValueError("--ids requires a comma-separated value")
    return {value for value in argv[index + 1].split(",") if value}


def _hours_between(start_iso: str, end_iso: str) -> float:
    parse = lambda value: dt.datetime.strptime(  # noqa: E731
        value, "%Y-%m-%dT%H:%M:%SZ"
    ).replace(tzinfo=dt.timezone.utc)
    return (parse(end_iso) - parse(start_iso)).total_seconds() / 3600


def _organization(initial_fix: dict) -> float:
    month_index = dt.datetime.strptime(
        initial_fix["iso"], "%Y-%m-%dT%H:%M:%SZ"
    ).month - 1
    ohc = woa23.load_ohc(month_index)
    env_lat = sources.lat_centers(sources.ENV_NY)
    env_lon = sources.lon_centers(sources.ENV_NX)
    ohc_at_fix = float(
        RegularGridInterpolator(
            (env_lat[::-1], env_lon),
            ohc[::-1],
            bounds_error=False,
            fill_value=None,
        )([[initial_fix["lat"], initial_fix["lon"]]])[0]
    )
    shallow_adjustment = 0.05 * min(
        1.0, max(0.0, (45.0 - ohc_at_fix) / 25.0)
    )
    return round(
        min(
            0.9,
            0.4
            + shallow_adjustment
            + max(0.0, initial_fix["windKt"] - 34.0) * 0.004,
        ),
        3,
    )


def _scenario(
    storm: dict,
    start_iso: str,
    window_h: float,
    bin_path: str,
    month_index: int | None = None,
) -> dict:
    initial = storm["initialFix"]
    offset_h = _hours_between(start_iso, initial["iso"])
    if offset_h < 0 or offset_h > window_h:
        raise ValueError(
            f"{storm['id']}: initialization offset {offset_h} outside {window_h} h"
        )
    return {
        "id": storm["id"],
        "label": storm["label"],
        "bin": bin_path,
        "monthIndex": storm["monthIndex"] if month_index is None else month_index,
        "stepH": era5_event.DECIMATE,
        "windowH": window_h,
        "startIso": start_iso,
        "spawn": {
            "lat": initial["lat"],
            "lon": initial["lon"],
            "seed": storm["seed"],
        },
        "ghostId": storm["id"],
        "benchmarkPartition": storm["partition"],
        "hindcast": {
            "startIso": initial["iso"],
            "lat": initial["lat"],
            "lon": initial["lon"],
            "initialWindKt": initial["windKt"],
            "initialOrganization": _organization(initial),
            "envOffsetH": offset_h,
        },
    }


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    wanted = _selected_ids(argv)
    catalogue = json.loads(CATALOG_PATH.read_text())
    tracks_doc = json.loads(TRACKS_PATH.read_text())
    tracks = {track["id"]: track for track in tracks_doc["storms"]}
    public_doc = json.loads(PUBLIC_SCENARIOS_PATH.read_text())
    public = {scenario["id"]: scenario for scenario in public_doc["scenarios"]}
    previous: dict[str, dict] = {}
    if SCENARIOS_PATH.exists():
        previous_doc = json.loads(SCENARIOS_PATH.read_text())
        previous = {
            scenario["id"]: scenario for scenario in previous_doc["scenarios"]
        }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    raw_dir = Path(sources.RAW_DIR)
    scenarios: list[dict] = []
    for storm in catalogue["storms"]:
        if storm["id"] not in tracks:
            raise ValueError(f"{storm['id']}: missing fidelity track")
        public_event_id = storm["publicEventId"]
        if public_event_id is not None:
            source = public[public_event_id]
            if source["stepH"] != era5_event.DECIMATE:
                raise ValueError(
                    f"{storm['id']}: public stepH {source['stepH']} does not "
                    f"match fidelity step {era5_event.DECIMATE}"
                )
            scenarios.append(
                _scenario(
                    storm,
                    source["startIso"],
                    source["windowH"],
                    f"public/{source['bin']}",
                    source["monthIndex"],
                )
            )
            continue
        should_bake = wanted is None or storm["id"] in wanted
        output = OUT_DIR / f"env_{storm['id']}.bin"
        if not should_bake:
            if storm["id"] not in previous:
                raise ValueError(
                    f"{storm['id']}: partial bake requested before scenario exists"
                )
            scenarios.append(previous[storm["id"]])
            continue
        wind_paths = [
            str(raw_dir / filename)
            for filename in event_files(storm, "wind")
        ]
        rh_paths = [
            str(raw_dir / filename)
            for filename in event_files(storm, "rh")
        ]
        sst_paths = [
            str(raw_dir / filename)
            for filename in event_files(storm, "sst")
        ]
        missing = [
            path
            for path in (*wind_paths, *rh_paths, *sst_paths)
            if not Path(path).exists()
        ]
        if missing:
            raise FileNotFoundError(
                f"{storm['id']}: missing raw inputs: {', '.join(missing)}"
            )
        diagnostic = era5_event.build_event_env(
            storm["id"],
            storm["monthIndex"],
            wind_paths,
            rh_paths,
            sst_paths,
            str(OUT_DIR),
            track_points=tracks[storm["id"]]["points"],
        )
        if Path(diagnostic["path"]) != output:
            raise ValueError(f"{storm['id']}: unexpected output {diagnostic['path']}")
        scenarios.append(
            _scenario(
                storm,
                diagnostic["start_iso"],
                diagnostic["windowH"],
                f"calibration/data/fidelity/{output.name}",
            )
        )
        print(
            f"[fidelity-bake] {storm['id']} {diagnostic['planes']} planes "
            f"{output.stat().st_size / 1e6:.1f} MB"
        )

    if len(scenarios) != 30:
        raise ValueError(f"expected 30 scenarios, got {len(scenarios)}")
    SCENARIOS_PATH.write_text(
        json.dumps({"version": 1, "scenarios": scenarios}, separators=(",", ":"))
        + "\n"
    )
    print(f"[fidelity-bake] wrote {SCENARIOS_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
