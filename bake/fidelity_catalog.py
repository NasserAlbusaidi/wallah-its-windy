"""Frozen 30-storm Arabian Sea observational benchmark catalogue.

The catalogue is derived from the pinned IBTrACS North Indian CSV, but the
storm identities and partitions below are code-reviewed constants.  All
positions, winds, and pressures come from the USA/JTWC columns; agencies are
never mixed within a fix.  The six ``test`` storms were not part of the
original ten-storm benchmark and are a permanent final test set.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RAW_IBTRACS = ROOT / "data" / "raw" / "ibtracs.NI.csv"
CATALOG_PATH = ROOT / "calibration" / "fidelity-catalog.json"
TRACKS_PATH = ROOT / "calibration" / "data" / "fidelity-tracks.json"

DOMAIN = (50.0, 70.0, 15.0, 27.0)
INTERIOR_MARGIN_DEG = 1.2
MINIMUM_WIND_KT = 34
INITIAL_NATURES = ("TS", "NR")
PADDING_HOURS = 24
PINNED_IBTRACS_SHA256 = (
    "02f6af3b7e12ee76e88866995b4451b85867a2b7f20ed2666f8561024d671b62"
)

# (id, sid, label, partition, public event id or None)
FROZEN_STORMS = (
    ("as1980", "1980317N11075", "arabian sea system 1980", "development", None),
    ("as1981", "1981298N07083", "arabian sea system 1981", "development", None),
    ("as1982", "1982309N12066", "arabian sea system 1982", "development", None),
    ("as1983", "1983216N23088", "arabian sea system 1983", "development", None),
    ("as1985", "1985148N15067", "arabian sea system 1985", "test", None),
    ("as1987", "1987155N16061", "arabian sea system 1987", "development", None),
    ("as1992", "1992273N12077", "arabian sea system 1992", "development", None),
    ("as1993", "1993316N11070", "arabian sea system 1993", "test", None),
    ("as1994", "1994157N17074", "arabian sea system 1994", "development", None),
    ("as1995", "1995284N17074", "arabian sea system 1995", "validation", None),
    ("as1998", "1998152N11075", "arabian sea cyclone 1998", "validation", None),
    ("as1998dec", "1998346N10072", "arabian sea system dec 1998", "development", None),
    ("as1999", "1999135N12073", "arabian sea cyclone 1999", "test", None),
    ("as2001", "2001141N14068", "arabian sea cyclone 2001", "test", None),
    ("mukda2006", "2006262N19069", "mukda 2006", "validation", None),
    ("gonu2007", "2007151N14072", "gonu 2007", "development", "gonu"),
    ("as2007", "2007172N15088", "arabian sea system jun 2007", "development", None),
    ("phet2010", "2010151N14065", "phet 2010", "development", "phet"),
    ("keila2011", "2011302N13062", "keila 2011", "development", None),
    ("nanauk2014", "2014159N12068", "nanauk 2014", "development", None),
    ("nilofar2014", "2014297N11062", "nilofar 2014", "development", "nilofar"),
    ("ashobaa2015", "2015157N13069", "ashobaa 2015", "development", "ashobaa"),
    ("mekunu2018", "2018136N11054", "mekunu 2018", "development", "mekunu"),
    ("vayu2019", "2019160N11073", "vayu 2019", "development", "vayu"),
    ("hikaa2019", "2019264N19071", "hikaa 2019", "development", "hikaa"),
    ("kyarr2019", "2019296N15066", "kyarr 2019", "validation", "kyarr"),
    ("maha2019", "2019301N05081", "maha 2019", "test", None),
    ("shaheen2021", "2021267N18094", "shaheen 2021", "validation", "shaheen"),
    ("biparjoy2023", "2023156N10067", "biparjoy 2023", "validation", "biparjoy"),
    ("asna2024", "2024238N25077", "asna 2024", "test", None),
)

PERMANENT_TEST_SIDS = {
    "1985148N15067",
    "1993316N11070",
    "1999135N12073",
    "2001141N14068",
    "2019301N05081",
    "2024238N25077",
}


def _float_or_none(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def _iso(raw: str) -> str:
    return raw.strip().replace(" ", "T") + "Z"


def _datetime(iso: str) -> dt.datetime:
    return dt.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=dt.timezone.utc
    )


def _inside(lat: float, lon: float, margin: float = 0.0) -> bool:
    lon_min, lon_max, lat_min, lat_max = DOMAIN
    return (
        lon_min + margin <= lon <= lon_max - margin
        and lat_min + margin <= lat <= lat_max - margin
    )


def _read_tracks(path: Path) -> dict[str, list[dict]]:
    wanted = {storm[1] for storm in FROZEN_STORMS}
    tracks: dict[str, dict[str, dict]] = {sid: {} for sid in wanted}
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        next(reader)  # IBTrACS units row
        for row in reader:
            sid = row["SID"].strip()
            if sid not in wanted or row["TRACK_TYPE"].strip() != "main":
                continue
            lat = _float_or_none(row["USA_LAT"])
            lon = _float_or_none(row["USA_LON"])
            if lat is None or lon is None:
                continue
            wind = _float_or_none(row["USA_WIND"])
            pressure = _float_or_none(row["USA_PRES"])
            iso = _iso(row["ISO_TIME"])
            tracks[sid][iso] = {
                "iso": iso,
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "windKt": None if wind is None else int(round(wind)),
                "presMb": None if pressure is None else int(round(pressure)),
                "_nature": row["NATURE"].strip(),
            }
    return {
        sid: [points[iso] for iso in sorted(points)]
        for sid, points in tracks.items()
    }


def _initial_fix(points: list[dict]) -> dict:
    for point in points:
        if (
            point["windKt"] is not None
            and point["windKt"] >= MINIMUM_WIND_KT
            and point["_nature"] in INITIAL_NATURES
            and _inside(point["lat"], point["lon"], INTERIOR_MARGIN_DEG)
        ):
            return point
    raise ValueError("storm has no safely interior tropical-storm fix")


def _published_fix(point: dict) -> dict:
    return {key: value for key, value in point.items() if not key.startswith("_")}


def _last_domain_fix(points: list[dict], start_iso: str) -> dict:
    # Verification ends at the first domain exit. Never extend an event window
    # to a later re-entry: the runtime has no forcing contract outside DOMAIN,
    # and scoring deliberately refuses to treat a re-entry as continuous truth.
    contiguous: list[dict] = []
    for point in points:
        if point["iso"] < start_iso:
            continue
        if not _inside(point["lat"], point["lon"]):
            break
        contiguous.append(point)
    if not contiguous:
        raise ValueError("storm has no in-domain fix after initialization")
    return contiguous[-1]


def _event_window(first: dict, last: dict) -> tuple[dt.datetime, dt.datetime]:
    start = (_datetime(first["iso"]) - dt.timedelta(hours=PADDING_HOURS)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = (_datetime(last["iso"]) + dt.timedelta(hours=PADDING_HOURS)).replace(
        hour=23, minute=0, second=0, microsecond=0
    )
    return start, end


def request_parts(start: dt.datetime, end: dt.datetime) -> tuple[dict, ...]:
    """Split an inclusive event window into CDS-friendly calendar months."""
    days: dict[tuple[int, int], list[int]] = {}
    cursor = start.date()
    while cursor <= end.date():
        days.setdefault((cursor.year, cursor.month), []).append(cursor.day)
        cursor += dt.timedelta(days=1)
    return tuple(
        {
            "year": year,
            "month": month,
            "days": values,
            "suffix": f"_{year}_{month:02d}",
        }
        for (year, month), values in sorted(days.items())
    )


def event_files(storm: dict, kind: str) -> tuple[str, ...]:
    """Raw NetCDF cache filenames for one expanded-benchmark storm."""
    if kind not in {"wind", "rh", "sst"}:
        raise ValueError(f"unknown fidelity field kind {kind}")
    prefix = "era5" if kind == "wind" else f"era5_{kind}"
    return tuple(
        f"fidelity_{prefix}_{storm['id']}{part['suffix']}.nc"
        for part in storm["requestParts"]
    )


def build_documents(csv_path: Path = RAW_IBTRACS) -> tuple[dict, dict]:
    source_sha = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    if source_sha != PINNED_IBTRACS_SHA256:
        raise ValueError(
            "IBTrACS source snapshot drift: "
            f"expected {PINNED_IBTRACS_SHA256}, got {source_sha}"
        )
    tracks_by_sid = _read_tracks(csv_path)
    catalogue: list[dict] = []
    tracks: list[dict] = []
    initial_nature_counts: Counter[str] = Counter()
    for index, (storm_id, sid, label, partition, public_event_id) in enumerate(
        FROZEN_STORMS
    ):
        points = tracks_by_sid[sid]
        if not points:
            raise ValueError(f"{sid}: no USA/JTWC fixes in pinned archive")
        first = _initial_fix(points)
        initial_nature_counts[first["_nature"]] += 1
        last = _last_domain_fix(points, first["iso"])
        event_start, event_end = _event_window(first, last)
        parts = request_parts(event_start, event_end)
        valid_winds = [p["windKt"] for p in points if p["windKt"] is not None]
        valid_pressure = [p["presMb"] for p in points if p["presMb"] is not None]
        catalogue.append(
            {
                "id": storm_id,
                "sid": sid,
                "label": label,
                "year": int(sid[:4]),
                "partition": partition,
                "seed": int(sid[:4]) * 100 + index,
                "publicEventId": public_event_id,
                "monthIndex": _datetime(first["iso"]).month - 1,
                "initialFix": _published_fix(first),
                "lastDomainFixIso": last["iso"],
                "eventStartIso": event_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "eventEndIso": event_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "requestParts": list(parts),
                "maxWindKt": max(valid_winds),
                "minimumPressureMb": min(valid_pressure) if valid_pressure else None,
            }
        )
        tracks.append(
            {
                "id": storm_id,
                "name": label.rsplit(" ", 1)[0],
                "year": int(sid[:4]),
                "points": [_published_fix(point) for point in points],
            }
        )

    counts = Counter(item["partition"] for item in catalogue)
    if counts != {"development": 18, "validation": 6, "test": 6}:
        raise ValueError(f"partition drift: {dict(counts)}")
    if {item["sid"] for item in catalogue if item["partition"] == "test"} != PERMANENT_TEST_SIDS:
        raise ValueError("permanent test split drift")
    catalog_doc = {
        "schemaVersion": 1,
        "source": {
            "name": "NOAA IBTrACS v04r01 North Indian basin",
            "path": "data/raw/ibtracs.NI.csv",
            "sha256": source_sha,
            "agency": "USA/JTWC columns only",
        },
        "protocol": {
            "domain": list(DOMAIN),
            "interiorMarginDeg": INTERIOR_MARGIN_DEG,
            "minimumWindKt": MINIMUM_WIND_KT,
            "initialNature": list(INITIAL_NATURES),
            "initialNatureCounts": dict(initial_nature_counts),
            "eventPaddingHours": PADDING_HOURS,
            "partitions": dict(counts),
            "selectionPolicy": (
                "code-reviewed stratified coverage set: ten featured cases plus "
                "twenty additional systems spanning 1980-2024, seasons, and "
                "intensities; frozen before simulation; not random or exhaustive"
            ),
            "testPolicy": "permanent; never used for parameter selection or acceptance",
        },
        "storms": catalogue,
    }
    tracks_doc = {"version": 1, "storms": tracks}
    return catalog_doc, tracks_doc


def write_documents() -> None:
    catalogue, tracks = build_documents()
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRACKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(catalogue, indent=2) + "\n")
    TRACKS_PATH.write_text(json.dumps(tracks, separators=(",", ":")) + "\n")
    print(
        f"[fidelity-catalog] wrote {len(catalogue['storms'])} storms "
        f"to {CATALOG_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    write_documents()
