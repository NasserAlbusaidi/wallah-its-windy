"""
synth.py  ===  SYNTHETIC_V0 steering + shear field  ===

    #############################################################
    ##  SYNTHETIC ENVIRONMENT  --  NOT REAL REANALYSIS DATA    ##
    ##  Deep-layer steering (u,v) and 850-200 shear are a      ##
    ##  hand-built encoding of documented Arabian Sea          ##
    ##  climatology, because ERA5 is BLOCKED on this machine   ##
    ##  (no CDS credentials). SST in env.bin is REAL (OISST).  ##
    #############################################################

Swap to real data by replacing ONE function: `steering_shear(elat, elon, month)`
with an ERA5 reader that returns the deep-layer-mean (u,v) and 850-200 hPa shear
magnitude on the env grid for the given monthIndex. Everything downstream (env.bin
layout, quantization, the timestep axis) is already real-data-shaped. See the ERA5
TODO + exact CDS request in bake/README.md.

Documented climatology encoded (Arabian Sea, cyclone-relevant):
  * Twin cyclone seasons: pre-monsoon (May-Jun) and post-monsoon (Oct-Nov) have
    WEAK steering + LOW shear -> storms can organise.
  * Monsoon (Jul-Sep): strong SW low-level flow + HIGH deep-layer shear ->
    storms are steered NE and shredded (why mid-summer Arabian Sea cyclones are
    rare).
  * Recurvature: north of ~18N the steering turns poleward then westward, nudging
    survivors toward the Omani coast (the Gonu/Shaheen approach geometry).
"""

from __future__ import annotations

import numpy as np

IS_SYNTHETIC = True
SYNTHETIC_TAG = "SYNTHETIC_V0"

# Monsoon strength index by 0-indexed month. Peaks Jul-Aug; low in the two
# cyclone-season shoulders. Tunable, but the SHAPE is the point.
MONSOON = {4: 0.12, 5: 0.28, 6: 0.85, 7: 1.00, 8: 0.72, 9: 0.40, 10: 0.12}

# Shear magnitude model (m/s): light background + monsoon jet.
SHEAR_BASE = 6.0
SHEAR_MONSOON = 18.0

# Steering model (m/s) component amplitudes.
SW_MONSOON_U = 7.0   # SW monsoon flow blows toward the NE -> +u
SW_MONSOON_V = 4.0   # ... and +v
BASE_U = -1.5        # gentle background easterly (storms drift W/NW)
BASE_V = 0.5         # slight background poleward
RECURVE_U = -2.0     # westward component that grows north of 18N
RECURVE_V = 2.5      # poleward component that grows north of 18N
RECURVE_LAT0 = 18.0  # recurvature onset latitude


def banner() -> str:
    return (
        "\n" + "#" * 62 + "\n"
        "##  env.bin steering (u,v) + shear are " + SYNTHETIC_TAG
        + "  (NOT ERA5)   ##\n"
        "##  ERA5 is BLOCKED (no CDS creds). SST is REAL (OISST LTM).   ##\n"
        "##  Swap: synth.steering_shear() -> one ERA5 reader. See README ##\n"
        + "#" * 62 + "\n"
    )


def steering_shear(
    elat: np.ndarray, elon: np.ndarray, month: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """SYNTHETIC deep-layer steering (u,v) and shear magnitude on the env grid.

    Args: elat, elon are 2D meshgrids [ny,nx] of env cell-center lat/lon; month is
    the 0-indexed calendar month. Returns (u, v, shear) each [ny,nx] in m/s.

    ==> Replace this whole function body with an ERA5 reader for real fields. <==
    """
    m = MONSOON.get(month, 0.1)
    lat_n = np.clip((elat - RECURVE_LAT0) / (27.0 - RECURVE_LAT0), 0.0, 1.0)

    # Gentle smooth spatial structure so steering is not perfectly parallel
    # (track-diversity concern, eng task T7). Small amplitude; ERA5 replaces it.
    swirl = 0.8 * np.sin((elon - 50.0) / 20.0 * np.pi)
    swirV = 0.6 * np.cos((elat - 15.0) / 12.0 * np.pi)

    u = BASE_U + RECURVE_U * lat_n + SW_MONSOON_U * m + swirl
    v = BASE_V + RECURVE_V * lat_n + SW_MONSOON_V * m + swirV

    lat_grad = np.clip((elat - 16.0) / 10.0, 0.0, 1.0)
    shear = SHEAR_BASE + SHEAR_MONSOON * m * (0.6 + 0.4 * lat_grad)
    shear = np.maximum(shear, 2.0)

    return u.astype(np.float64), v.astype(np.float64), shear.astype(np.float64)
