#!/usr/bin/env python3
"""Bake immutable HF-3 pressure-level steering sidecars for the 30-storm suite."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import era5_event
from event_catalog import EVENTS, event_files as public_event_files
from fidelity_catalog import CATALOG_PATH, ROOT, event_files as fidelity_event_files


RAW = ROOT / "data" / "raw"
OUT = ROOT / "calibration" / "data" / "hf3"
PUBLIC = ROOT / "public" / "data"
MANIFEST = ROOT / "calibration" / "data" / "hf3-steering-manifest.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    catalog = json.loads(CATALOG_PATH.read_text())
    public_by_id = {event["id"]: event for event in EVENTS}
    records = []
    OUT.mkdir(parents=True, exist_ok=True)
    for storm in catalog["storms"]:
        public_id = storm["publicEventId"]
        if public_id is not None:
            spec = public_by_id[public_id]
            wind_paths = [RAW / name for name in public_event_files(spec, "wind")]
        else:
            wind_paths = [RAW / name for name in fidelity_event_files(storm, "wind")]
        missing = [str(path) for path in wind_paths if not path.exists()]
        if missing:
            raise FileNotFoundError(f"{storm['id']}: missing {', '.join(missing)}")
        output = OUT / f"steering_{storm['id']}.bin"
        diagnostic = era5_event.build_pressure_wind_sidecar(
            [str(path) for path in wind_paths], str(output)
        )
        if public_id is not None:
            public_output = PUBLIC / f"steering_{public_id}.bin"
            public_output.write_bytes(output.read_bytes())
        records.append(
            {
                "id": storm["id"],
                "partition": storm["partition"],
                "path": str(output.relative_to(ROOT)),
                "bytes": output.stat().st_size,
                "sha256": sha256(output),
                "sourceWindFiles": [
                    {
                        "path": str(path.relative_to(ROOT)),
                        "bytes": path.stat().st_size,
                        "sha256": sha256(path),
                    }
                    for path in wind_paths
                ],
                **{key: value for key, value in diagnostic.items() if key != "path"},
            }
        )
        print(f"[hf3] {storm['id']}: {diagnostic['planes']} planes -> {output.name}")
    document = {
        "schemaVersion": 1,
        "contract": "Temporally aligned ERA5 pressure-level winds, individually Gaussian vortex-filtered on the native 0.5 degree grid before regridding; separate bytes preserve HF-1/HF-2 forcing immutability.",
        "grid": {"nx": 40, "ny": 24, "bbox": [50, 70, 15, 27]},
        "levelsHpa": [850, 500, 250],
        "stepHours": era5_event.DECIMATE,
        "vortexFilterSigmaNativeCells": era5_event.VORTEX_SIGMA,
        "storms": records,
    }
    MANIFEST.write_text(json.dumps(document, indent=2) + "\n")
    print(f"[hf3] wrote {MANIFEST.relative_to(ROOT)} ({len(records)} storms)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
