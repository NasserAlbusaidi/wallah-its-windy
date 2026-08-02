#!/usr/bin/env python3
"""test_realism_variance.py — offline tests for the R1 env-variance stats.

Repo convention: plain asserts + main(), no pytest (see bake/test_events.py).
Run: node bake/run-python.mjs bake/test_realism_variance.py
"""

from __future__ import annotations

import numpy as np

import realism_env_variance as rev


def test_temporal_stats_known_series() -> None:
    series = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    s = rev.temporal_stats(series)
    assert s["mean"] == 3.0
    assert abs(s["std"] - float(np.std(series))) < 1e-12
    assert s["p05"] == float(np.percentile(series, 5))
    assert s["p95"] == float(np.percentile(series, 95))
    assert abs(s["maxOverMean"] - 5.0 / 3.0) < 1e-9


def test_shear_is_mean_of_magnitudes() -> None:
    # Two timesteps with opposing shear vectors must NOT cancel to calm.
    # u850/v850 zero; u200 = +10 then -10 m/s at every cell.
    u850 = np.zeros((2, 3, 4)); v850 = np.zeros((2, 3, 4))
    u200 = np.stack([np.full((3, 4), 10.0), np.full((3, 4), -10.0)])
    v200 = np.zeros((2, 3, 4))
    series = rev.regional_shear_series(u850, v850, u200, v200,
                                       mask=np.ones((3, 4), dtype=bool))
    assert series.shape == (2,)
    assert np.allclose(series, 10.0)  # both timesteps feel 10 m/s of shear


def test_rounding_six_places() -> None:
    assert rev.round6(1.23456789) == 1.234568


def main() -> int:
    for check in (test_temporal_stats_known_series,
                  test_shear_is_mean_of_magnitudes,
                  test_rounding_six_places):
        check()
        print(f"ok {check.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
