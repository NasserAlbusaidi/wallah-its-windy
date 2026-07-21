"""Fetch only the cohort sealed before HF-2/HF-3 confirmatory evaluation."""

from __future__ import annotations

import json

from fetch_fidelity_benchmark import main as fetch_main
from hf6_catalog import CATALOG_PATH


def main() -> int:
    document = json.loads(CATALOG_PATH.read_text())
    ids = [
        case["id"]
        for case in document["cases"]
        if case["partition"] == "sealed-confirmation"
    ]
    return fetch_main(["--catalog", str(CATALOG_PATH), "--ids", ",".join(ids)])


if __name__ == "__main__":
    raise SystemExit(main())
