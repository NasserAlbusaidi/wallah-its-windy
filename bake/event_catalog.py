"""Frozen historical-event catalogue shared by fetch, bake, and validation.

The ten storms span weak, major, recurving, landfalling, and long-lived Arabian
Sea cases. ``partition`` is deliberately storm-level: calibration never sees a
fix from the three held-out storms.
"""

from __future__ import annotations


EVENTS = (
    {
        "id": "gonu",
        "trackId": "gonu2007",
        "sid": "2007151N14072",
        "name": "gonu",
        "label": "gonu 2007",
        "year": 2007,
        "tag": "gonu",
        "seed": 2007,
        "partition": "calibration",
        "monthIndex": 5,
        "sandboxSpawn": (20.5, 64.5),
        "parts": ((2007, 6, tuple(range(1, 9)), ""),),
    },
    {
        "id": "phet",
        "trackId": "phet2010",
        "sid": "2010151N14065",
        "name": "phet",
        "label": "phet 2010",
        "year": 2010,
        "tag": "phet",
        "seed": 2010,
        "partition": "calibration",
        "monthIndex": 4,
        "parts": (
            (2010, 5, (30, 31), "_05"),
            (2010, 6, tuple(range(1, 8)), "_06"),
        ),
    },
    {
        "id": "nilofar",
        "trackId": "nilofar2014",
        "sid": "2014297N11062",
        "name": "nilofar",
        "label": "nilofar 2014",
        "year": 2014,
        "tag": "nilofar",
        "seed": 2014,
        "partition": "calibration",
        "monthIndex": 9,
        "parts": (
            (2014, 10, tuple(range(25, 32)), "_10"),
            (2014, 11, (1,), "_11"),
        ),
    },
    {
        "id": "ashobaa",
        "trackId": "ashobaa2015",
        "sid": "2015157N13069",
        "name": "ashobaa",
        "label": "ashobaa 2015",
        "year": 2015,
        "tag": "ashobaa",
        "seed": 2015,
        "partition": "calibration",
        "monthIndex": 5,
        "parts": ((2015, 6, tuple(range(6, 14)), "_06"),),
    },
    {
        "id": "mekunu",
        "trackId": "mekunu2018",
        "sid": "2018136N11054",
        "name": "mekunu",
        "label": "mekunu 2018",
        "year": 2018,
        "tag": "mekunu",
        "seed": 2018,
        "partition": "calibration",
        "monthIndex": 4,
        "parts": ((2018, 5, tuple(range(23, 29)), "_05"),),
    },
    {
        "id": "hikaa",
        "trackId": "hikaa2019",
        "sid": "2019264N19071",
        "name": "hikaa",
        "label": "hikaa 2019",
        "year": 2019,
        "tag": "hikaa",
        "seed": 20191,
        "partition": "calibration",
        "monthIndex": 8,
        "parts": ((2019, 9, tuple(range(21, 27)), "_09"),),
    },
    {
        "id": "vayu",
        "trackId": "vayu2019",
        "sid": "2019160N11073",
        "name": "vayu",
        "label": "vayu 2019",
        "year": 2019,
        "tag": "vayu",
        "seed": 20192,
        "partition": "calibration",
        "monthIndex": 5,
        "parts": ((2019, 6, tuple(range(10, 19)), "_06"),),
    },
    {
        "id": "kyarr",
        "trackId": "kyarr2019",
        "sid": "2019296N15066",
        "name": "kyarr",
        "label": "kyarr 2019",
        "year": 2019,
        "tag": "kyarr",
        "seed": 20193,
        "partition": "validation",
        "monthIndex": 9,
        "sandboxSpawn": (18.0, 66.0),
        "parts": (
            (2019, 10, tuple(range(25, 32)), "_10"),
            (2019, 11, (1, 2), "_11"),
        ),
    },
    {
        "id": "shaheen",
        "trackId": "shaheen2021",
        "sid": "2021267N18094",
        "name": "shaheen",
        "label": "shaheen 2021",
        "year": 2021,
        "tag": "shaheen",
        "seed": 2021,
        "partition": "validation",
        "monthIndex": 8,
        "sandboxSpawn": (24.0, 61.5),
        "parts": (
            (2021, 9, tuple(range(20, 31)), "_09"),
            (2021, 10, tuple(range(1, 11)), "_10"),
        ),
    },
    {
        "id": "biparjoy",
        "trackId": "biparjoy2023",
        "sid": "2023156N10067",
        "name": "biparjoy",
        "label": "biparjoy 2023",
        "year": 2023,
        "tag": "biparjoy",
        "seed": 2023,
        "partition": "validation",
        "monthIndex": 5,
        "parts": ((2023, 6, tuple(range(8, 18)), "_06"),),
    },
)


def event_files(event: dict, kind: str) -> tuple[str, ...]:
    """Return raw NetCDF filenames for ``wind``, ``rh``, or ``sst``."""
    if kind not in {"wind", "rh", "sst"}:
        raise ValueError(f"unknown event field kind {kind}")
    prefix = "era5" if kind == "wind" else f"era5_{kind}"
    # Preserve the original Gonu filename so existing cached data remains valid.
    if event["id"] == "gonu":
        return (f"{prefix}_gonu_2007.nc",)
    return tuple(
        f"{prefix}_{event['tag']}_{event['year']}{suffix}.nc"
        for _, _, _, suffix in event["parts"]
    )
