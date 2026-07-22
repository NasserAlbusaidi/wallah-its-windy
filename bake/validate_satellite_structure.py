#!/usr/bin/env python3
"""Qualitative cyclone-cloud morphology audit against an observed IR frame.

This is deliberately not a forecast score. It measures a few visible structural
properties after both images are aligned to the same domain and storm centre.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

DOMAIN = {"west": 50.0, "south": 15.0, "east": 70.0, "north": 27.0}


def load_luminance(path: Path, size: tuple[int, int]) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("L").resize(size, Image.Resampling.LANCZOS), dtype=np.float32) / 255.0


def pixel_for(lat: float, lon: float, width: int, height: int) -> tuple[float, float]:
    x = (lon - DOMAIN["west"]) / (DOMAIN["east"] - DOMAIN["west"]) * width
    y = (DOMAIN["north"] - lat) / (DOMAIN["north"] - DOMAIN["south"]) * height
    return x, y


def metrics(luma: np.ndarray, center_lat: float, center_lon: float, radius_deg: float) -> dict[str, object]:
    height, width = luma.shape
    cx, cy = pixel_for(center_lat, center_lon, width, height)
    px_per_lon = width / (DOMAIN["east"] - DOMAIN["west"])
    px_per_lat = height / (DOMAIN["north"] - DOMAIN["south"])
    yy, xx = np.mgrid[0:height, 0:width]
    dx = (xx - cx) / px_per_lon
    dy = (cy - yy) / px_per_lat
    radius = np.sqrt(dx * dx + dy * dy)
    roi = radius <= radius_deg
    values = luma[roi]
    threshold = max(0.42, float(np.quantile(values, 0.68)))
    cloud = (luma >= threshold) & roi
    count = int(cloud.sum())
    if count == 0:
        raise RuntimeError("no cold/bright cloud mask found inside validation radius")
    weights = np.maximum(0.0, luma - threshold) * cloud
    weight_sum = float(weights.sum()) or float(count)
    wx = weights if weight_sum != count else cloud.astype(np.float32)
    centroid_dx = float((dx * wx).sum() / weight_sum)
    centroid_dy = float((dy * wx).sum() / weight_sum)
    quadrants = {
        "ne": int((cloud & (dx >= 0) & (dy >= 0)).sum()),
        "nw": int((cloud & (dx < 0) & (dy >= 0)).sum()),
        "sw": int((cloud & (dx < 0) & (dy < 0)).sum()),
        "se": int((cloud & (dx >= 0) & (dy < 0)).sum()),
    }
    qfrac = {key: value / count for key, value in quadrants.items()}
    return {
        "threshold": round(threshold, 4),
        "coverage_fraction": round(count / int(roi.sum()), 4),
        "centroid_offset_deg": {"east": round(centroid_dx, 4), "north": round(centroid_dy, 4)},
        "centroid_distance_deg": round(float(np.hypot(centroid_dx, centroid_dy)), 4),
        "core_fraction": round(int((cloud & (radius <= 1.0)).sum()) / max(1, int((radius <= 1.0).sum())), 4),
        "quadrant_fraction": {key: round(value, 4) for key, value in qfrac.items()},
        "quadrant_asymmetry": round(max(qfrac.values()) - min(qfrac.values()), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observed", type=Path, required=True)
    parser.add_argument("--simulated", type=Path, required=True)
    parser.add_argument("--center-lat", type=float, required=True)
    parser.add_argument("--center-lon", type=float, required=True)
    parser.add_argument("--radius-deg", type=float, default=5.0)
    parser.add_argument("--observed-at", required=True)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    size = (1000, 600)
    observed = metrics(load_luminance(args.observed, size), args.center_lat, args.center_lon, args.radius_deg)
    simulated = metrics(load_luminance(args.simulated, size), args.center_lat, args.center_lon, args.radius_deg)
    observed_q = observed["quadrant_fraction"]
    simulated_q = simulated["quadrant_fraction"]
    quadrant_mae = sum(abs(observed_q[key] - simulated_q[key]) for key in observed_q) / 4
    coverage_ratio = simulated["coverage_fraction"] / max(0.001, observed["coverage_fraction"])
    centroid_delta = abs(simulated["centroid_distance_deg"] - observed["centroid_distance_deg"])
    centroid_vector_delta = float(np.hypot(
        simulated["centroid_offset_deg"]["east"] - observed["centroid_offset_deg"]["east"],
        simulated["centroid_offset_deg"]["north"] - observed["centroid_offset_deg"]["north"],
    ))
    checks = {
        "coverage_same_order": 0.35 <= coverage_ratio <= 2.8,
        "centroid_displacement_magnitude_plausible": centroid_delta <= 1.25,
        "centroid_vector_within_1_5deg": centroid_vector_delta <= 1.5,
        "quadrant_distribution_plausible": quadrant_mae <= 0.20,
        "organized_core_present": simulated["core_fraction"] >= 0.08,
    }
    report = {
        "schemaVersion": 1,
        "kind": "qualitative-morphology-screen-not-forecast-skill",
        "scenario": args.scenario,
        "observedAt": args.observed_at,
        "domain": DOMAIN,
        "stormCenter": {"lat": args.center_lat, "lon": args.center_lon},
        "observed": observed,
        "simulated": simulated,
        "comparison": {
            "coverage_ratio": round(coverage_ratio, 4),
            "centroid_distance_delta_deg": round(centroid_delta, 4),
            "centroid_vector_delta_deg": round(centroid_vector_delta, 4),
            "quadrant_fraction_mae": round(quadrant_mae, 4),
        },
        "checks": checks,
        "passed": all(checks.values()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
