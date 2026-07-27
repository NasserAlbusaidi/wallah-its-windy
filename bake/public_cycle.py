"""Acquire and normalize a fail-closed public Arabian Sea data cycle.

This is deliberately a source monitor before it is a forecast. It acquires
regional GFS fields and near-real-time NOAA OISST, records the public RSMC
bulletin state, and checks whether the operational RTOFS three-dimensional
temperature volume exists. RTOFS does not expose an Arabian Sea subset, so the
~800 MB global file is never downloaded here. The resulting manifest therefore
keeps the live forecast gate closed until a usable upper-ocean input, official
active-storm advisory, and ensemble input are present.

The normalized partial environment is written in the repository's WIWB format.
It intentionally omits ``ohc_MM``; the runtime's existing eight-field validator
cannot accidentally promote this seven-field product into a forecast input.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
from eccodes import (
    codes_get,
    codes_get_array,
    codes_grib_new_from_file,
    codes_release,
)

from binfmt import Layer, parse_bin, write_bin


USER_AGENT = "wallah-its-windy-public-cycle/1.0 (+https://github.com/NasserAlbusaidi/wallah-its-windy)"
GFS_ROOT = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
GFS_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
OISST_DATASET = "ncdcOisst21NrtAgg_LonPM180"
OISST_ROOT = "https://coastwatch.pfeg.noaa.gov/erddap"
RSMC_HOME = "https://rsmcnewdelhi.imd.gov.in/"
RTOFS_ROOT = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod"
GEFS_DOCS = "https://www.nco.ncep.noaa.gov/pmb/products/gens/"
LEADS_H = tuple(range(0, 121, 6))
PRESSURE_LEVELS = (200, 250, 500, 600, 700, 850)
REQUIRED_GFS_FIELDS = (
    ("UGRD", 200),
    ("UGRD", 250),
    ("UGRD", 500),
    ("UGRD", 850),
    ("VGRD", 200),
    ("VGRD", 250),
    ("VGRD", 500),
    ("VGRD", 850),
    ("RH", 600),
    ("RH", 700),
)
QUANT_SCALE = 0.01
SST_OFFSET = 20.0
DOMAIN = (50.0, 70.0, 15.0, 27.0)
ENV_NX, ENV_NY = 40, 24


@dataclass(frozen=True)
class FetchResult:
    url: str
    body: bytes
    headers: dict[str, str]
    fetched_at: str


class AcquisitionError(RuntimeError):
    """A provider response was missing, malformed, or scientifically unusable."""


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def longitude_centers() -> np.ndarray:
    return DOMAIN[0] + (np.arange(ENV_NX) + 0.5) * (DOMAIN[1] - DOMAIN[0]) / ENV_NX


def latitude_centers() -> np.ndarray:
    return DOMAIN[3] - (np.arange(ENV_NY) + 0.5) * (DOMAIN[3] - DOMAIN[2]) / ENV_NY


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def fetch(url: str, *, method: str = "GET", timeout: int = 90) -> FetchResult:
    request = urllib.request.Request(
        url,
        method=method,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = b"" if method == "HEAD" else response.read()
        headers = {key.lower(): value for key, value in response.headers.items()}
    return FetchResult(url, body, headers, iso_z(datetime.now(timezone.utc)))


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def archive_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        if path.read_bytes() != data:
            raise AcquisitionError(f"immutable archive collision at {path}") from None


def cycle_candidates(now: datetime, count: int = 12) -> list[datetime]:
    utc = now.astimezone(timezone.utc)
    floored = utc.replace(hour=(utc.hour // 6) * 6, minute=0, second=0, microsecond=0)
    return [floored - timedelta(hours=6 * index) for index in range(count)]


def gfs_index_url(cycle: datetime, lead_h: int) -> str:
    date = cycle.strftime("%Y%m%d")
    hour = cycle.strftime("%H")
    return (
        f"{GFS_ROOT}/gfs.{date}/{hour}/atmos/"
        f"gfs.t{hour}z.pgrb2.0p25.f{lead_h:03d}.idx"
    )


def valid_gfs_inventory(body: bytes) -> bool:
    text = body.decode("utf-8", errors="replace")
    return all(f":{variable}:{level} mb:" in text for variable, level in REQUIRED_GFS_FIELDS)


def discover_complete_gfs_cycle(now: datetime) -> tuple[datetime, FetchResult]:
    errors: list[str] = []
    for candidate in cycle_candidates(now):
        try:
            final_index = fetch(gfs_index_url(candidate, LEADS_H[-1]), timeout=30)
            if not valid_gfs_inventory(final_index.body):
                errors.append(f"{iso_z(candidate)} inventory lacks required fields")
                continue
            initial_index = fetch(gfs_index_url(candidate, LEADS_H[0]), timeout=30)
            if not valid_gfs_inventory(initial_index.body):
                errors.append(f"{iso_z(candidate)} analysis inventory lacks required fields")
                continue
            return candidate, initial_index
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            errors.append(f"{iso_z(candidate)}: {error}")
    raise AcquisitionError(f"no complete GFS cycle found: {'; '.join(errors[-4:])}")


def gfs_filter_url(cycle: datetime, lead_h: int) -> str:
    date = cycle.strftime("%Y%m%d")
    hour = cycle.strftime("%H")
    params: list[tuple[str, str]] = [
        ("file", f"gfs.t{hour}z.pgrb2.0p25.f{lead_h:03d}"),
        *(("lev_" + str(level) + "_mb", "on") for level in PRESSURE_LEVELS),
        ("var_RH", "on"),
        ("var_UGRD", "on"),
        ("var_VGRD", "on"),
        ("subregion", ""),
        ("leftlon", str(DOMAIN[0])),
        ("rightlon", str(DOMAIN[1])),
        ("toplat", str(DOMAIN[3])),
        ("bottomlat", str(DOMAIN[2])),
        ("dir", f"/gfs.{date}/{hour}/atmos"),
    ]
    return f"{GFS_FILTER}?{urllib.parse.urlencode(params)}"


def download_gfs_lead(cycle: datetime, lead_h: int, destination: Path) -> dict[str, Any]:
    result = fetch(gfs_filter_url(cycle, lead_h))
    if not result.body.startswith(b"GRIB"):
        preview = result.body[:120].decode("utf-8", errors="replace")
        raise AcquisitionError(f"GFS f{lead_h:03d} is not GRIB2: {preview}")
    archive_write(destination, result.body)
    return {
        "leadH": lead_h,
        "url": result.url,
        "path": destination,
        "bytes": len(result.body),
        "sha256": sha256(result.body),
        "fetchedAt": result.fetched_at,
    }


def download_gfs_cycle(cycle: datetime, raw_directory: Path) -> list[dict[str, Any]]:
    raw_directory.mkdir(parents=True, exist_ok=True)
    items: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(
                download_gfs_lead,
                cycle,
                lead_h,
                raw_directory / f"gfs-f{lead_h:03d}.grib2",
            ): lead_h
            for lead_h in LEADS_H
        }
        for future in as_completed(futures):
            items.append(future.result())
    return sorted(items, key=lambda item: item["leadH"])


def grib_fields(path: Path) -> tuple[np.ndarray, np.ndarray, dict[tuple[str, int], np.ndarray]]:
    fields: dict[tuple[str, int], np.ndarray] = {}
    lat_axis: np.ndarray | None = None
    lon_axis: np.ndarray | None = None
    with path.open("rb") as handle:
        while True:
            message = codes_grib_new_from_file(handle)
            if message is None:
                break
            try:
                short_name = str(codes_get(message, "shortName"))
                level = int(codes_get(message, "level"))
                if short_name not in {"u", "v", "r"} or level not in PRESSURE_LEVELS:
                    continue
                values = np.asarray(codes_get_array(message, "values"), dtype=np.float64)
                latitudes = np.asarray(codes_get_array(message, "latitudes"), dtype=np.float64)
                longitudes = np.asarray(codes_get_array(message, "longitudes"), dtype=np.float64)
                current_lats = np.unique(latitudes)
                current_lons = np.unique(longitudes)
                field = np.full((current_lats.size, current_lons.size), np.nan, dtype=np.float64)
                field[
                    np.searchsorted(current_lats, latitudes),
                    np.searchsorted(current_lons, longitudes),
                ] = values
                if lat_axis is None:
                    lat_axis, lon_axis = current_lats, current_lons
                elif not np.array_equal(lat_axis, current_lats) or not np.array_equal(
                    lon_axis, current_lons
                ):
                    raise AcquisitionError(f"{path.name}: GRIB messages disagree on grid")
                fields[(short_name, level)] = field
            finally:
                codes_release(message)
    if lat_axis is None or lon_axis is None:
        raise AcquisitionError(f"{path.name}: no required GRIB fields decoded")
    required = {
        ("u", 200),
        ("u", 250),
        ("u", 500),
        ("u", 850),
        ("v", 200),
        ("v", 250),
        ("v", 500),
        ("v", 850),
        ("r", 600),
        ("r", 700),
    }
    missing = sorted(required - fields.keys())
    if missing:
        raise AcquisitionError(f"{path.name}: missing decoded fields {missing}")
    return lat_axis, lon_axis, fields


def regrid_regular(
    field: np.ndarray,
    source_lats: np.ndarray,
    source_lons: np.ndarray,
) -> np.ndarray:
    target_lons = longitude_centers()
    target_lats_north_first = latitude_centers()
    along_lon = np.vstack(
        [np.interp(target_lons, source_lons, row) for row in field]
    )
    target_lats_ascending = target_lats_north_first[::-1]
    along_lat = np.vstack(
        [
            np.interp(target_lats_ascending, source_lats, along_lon[:, column])
            for column in range(along_lon.shape[1])
        ]
    ).T
    return along_lat[::-1].astype(np.float64)


def derive_gfs_environment(
    artifacts: list[dict[str, Any]],
) -> dict[str, np.ndarray]:
    u_planes: list[np.ndarray] = []
    v_planes: list[np.ndarray] = []
    shear_planes: list[np.ndarray] = []
    shear_u_planes: list[np.ndarray] = []
    shear_v_planes: list[np.ndarray] = []
    rh_planes: list[np.ndarray] = []
    weights = np.asarray([850.0, 500.0, 250.0]) / 1600.0
    for artifact in artifacts:
        latitudes, longitudes, fields = grib_fields(artifact["path"])
        u_steer = sum(
            weights[index] * fields[("u", level)]
            for index, level in enumerate((850, 500, 250))
        )
        v_steer = sum(
            weights[index] * fields[("v", level)]
            for index, level in enumerate((850, 500, 250))
        )
        shear_u = fields[("u", 200)] - fields[("u", 850)]
        shear_v = fields[("v", 200)] - fields[("v", 850)]
        rh = np.clip((fields[("r", 600)] + fields[("r", 700)]) / 2.0, 0.0, 100.0)
        for destination, field in (
            (u_planes, u_steer),
            (v_planes, v_steer),
            (shear_planes, np.hypot(shear_u, shear_v)),
            (shear_u_planes, shear_u),
            (shear_v_planes, shear_v),
            (rh_planes, rh),
        ):
            normalized = regrid_regular(field, latitudes, longitudes)
            if not np.isfinite(normalized).all():
                raise AcquisitionError(f"{artifact['path'].name}: non-finite GFS field")
            destination.append(normalized)
    return {
        "u": np.stack(u_planes),
        "v": np.stack(v_planes),
        "shr": np.stack(shear_planes),
        "shu": np.stack(shear_u_planes),
        "shv": np.stack(shear_v_planes),
        "rh": np.stack(rh_planes),
    }


def erddap_attribute(document: dict[str, Any], name: str) -> str:
    table = document.get("table")
    rows = table.get("rows") if isinstance(table, dict) else None
    if not isinstance(rows, list):
        raise AcquisitionError("OISST metadata is not an ERDDAP info table")
    for row in rows:
        if (
            isinstance(row, list)
            and len(row) >= 5
            and row[0] == "attribute"
            and row[1] == "NC_GLOBAL"
            and row[2] == name
        ):
            return str(row[4])
    raise AcquisitionError(f"OISST metadata lacks {name}")


def fill_nearest(field: np.ndarray) -> np.ndarray:
    missing = np.argwhere(~np.isfinite(field))
    if missing.size == 0:
        return field
    valid = np.argwhere(np.isfinite(field))
    if valid.size == 0:
        raise AcquisitionError("SST subset contains no finite values")
    output = field.copy()
    for row, column in missing:
        nearest = valid[np.argmin(np.sum((valid - (row, column)) ** 2, axis=1))]
        output[row, column] = output[tuple(nearest)]
    return output


def acquire_oisst(raw_directory: Path) -> tuple[np.ndarray, dict[str, Any]]:
    metadata_url = f"{OISST_ROOT}/info/{OISST_DATASET}/index.json"
    metadata = fetch(metadata_url)
    document = json.loads(metadata.body)
    valid_time = erddap_attribute(document, "time_coverage_end")
    license_text = erddap_attribute(document, "license")
    query = (
        f"sst[({valid_time})][(0.0)]"
        f"[({DOMAIN[2]}):({DOMAIN[3]})]"
        f"[({DOMAIN[0]}):({DOMAIN[1]})]"
    )
    data_url = f"{OISST_ROOT}/griddap/{OISST_DATASET}.csv0?{query}"
    data = fetch(data_url)
    rows = list(csv.reader(io.StringIO(data.body.decode("utf-8"))))
    parsed = [
        (float(row[2]), float(row[3]), float(row[4]))
        for row in rows
        if len(row) >= 5
    ]
    if not parsed:
        raise AcquisitionError("OISST subset contains no rows")
    latitudes = np.unique([row[0] for row in parsed])
    longitudes = np.unique([row[1] for row in parsed])
    field = np.full((latitudes.size, longitudes.size), np.nan, dtype=np.float64)
    for latitude, longitude, value in parsed:
        field[
            int(np.searchsorted(latitudes, latitude)),
            int(np.searchsorted(longitudes, longitude)),
        ] = value
    normalized = regrid_regular(fill_nearest(field), latitudes, longitudes)
    raw_path = raw_directory / "oisst.csv"
    archive_write(raw_path, data.body)
    archive_write(raw_directory / "oisst-metadata.json", metadata.body)
    return normalized, {
        "id": "noaa-oisst-nrt",
        "kind": "sea-surface-temperature",
        "providerId": "noaa-ncei",
        "authority": "NOAA National Centers for Environmental Information",
        "status": "acquired",
        "usable": True,
        "dataUse": "normalized regional analysis",
        "sourceUrl": data.url,
        "documentationUrl": (
            f"{OISST_ROOT}/info/{OISST_DATASET}/index.html"
        ),
        "validTime": valid_time,
        "fetchedAt": data.fetched_at,
        "maxAgeHours": 96,
        "byteCount": len(data.body),
        "sha256": sha256(data.body),
        "license": license_text,
        "detail": "Near-real-time 0.25° OISST subset normalized to the 0.5° app grid.",
    }


def acquire_rsmc_state(raw_directory: Path, now: datetime) -> dict[str, Any]:
    result = fetch(RSMC_HOME)
    archive_write(raw_directory / "rsmc-home.html", result.body)
    text = result.body.decode("utf-8", errors="replace")
    no_cyclone = re.search(r"uploads/No\s+Cyclone\.pdf", text, re.IGNORECASE) is not None
    cyclone_links = sorted(
        {
            urllib.parse.urljoin(RSMC_HOME, match)
            for match in re.findall(
                r'href=["\']([^"\']*(?:cyclone|advisory)[^"\']*\.pdf)["\']',
                text,
                re.IGNORECASE,
            )
            if "No Cyclone.pdf" not in match
        }
    )
    if no_cyclone:
        status = "no-active-cyclone"
        detail = "RSMC New Delhi currently publishes its explicit “No Cyclone” product."
    else:
        status = "advisory-needs-normalization"
        detail = (
            "The no-cyclone marker is absent; any active bulletin must be parsed and "
            "cycle-matched before forecast use."
        )
    return {
        "id": "rsmc-new-delhi",
        "kind": "agency-advisory",
        "providerId": "rsmc-new-delhi",
        "authority": "India Meteorological Department, RSMC New Delhi",
        "status": status,
        "usable": False,
        "dataUse": "public bulletin-state snapshot",
        "sourceUrl": result.url,
        "documentationUrl": (
            "https://rsmcnewdelhi.imd.gov.in/bulletins-products-cwd.php"
        ),
        "validTime": iso_z(now),
        "fetchedAt": result.fetched_at,
        "maxAgeHours": 6,
        "byteCount": len(result.body),
        "sha256": sha256(result.body),
        "license": "IMD website copyright and terms; link to the official source.",
        "detail": detail,
        # A no-cyclone page also links climatology and planning PDFs with
        # "cyclone" in their filenames. Do not present those as active-bulletin
        # candidates.
        "candidateBulletinUrls": [] if no_cyclone else cyclone_links[:10],
    }


def acquire_rtofs_state(now: datetime) -> dict[str, Any]:
    errors: list[str] = []
    for day_offset in range(5):
        date = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
        url = (
            f"{RTOFS_ROOT}/rtofs.{date}/"
            "rtofs_glo_3dz_n024_daily_3ztio.nc"
        )
        try:
            result = fetch(url, method="HEAD", timeout=30)
            length = int(result.headers.get("content-length", "0"))
            modified = result.headers.get("last-modified")
            valid_time = (
                iso_z(datetime.strptime(modified, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc))
                if modified
                else f"{date[0:4]}-{date[4:6]}-{date[6:8]}T00:00:00Z"
            )
            return {
                "id": "ncep-rtofs-upper-ocean",
                "kind": "upper-ocean",
                "providerId": "ncep-rtofs",
                "authority": "NOAA/NWS/NCEP",
                "status": "available-unacquired",
                "usable": False,
                "dataUse": "availability and byte-count check only",
                "sourceUrl": url,
                "documentationUrl": "https://www.nco.ncep.noaa.gov/pmb/products/rtofs/",
                "validTime": valid_time,
                "fetchedAt": result.fetched_at,
                "maxAgeHours": 72,
                "byteCount": length,
                "sha256": None,
                "license": "U.S. Government NOAA/NCEP public data; provider disclaimer applies.",
                "detail": (
                    f"The current global 3-D temperature volume is {length / 1_000_000:.0f} MB. "
                    "NOMADS exposes no Arabian Sea subset, so it is not downloaded or marked usable."
                ),
            }
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, ValueError) as error:
            errors.append(f"{date}: {error}")
    return {
        "id": "ncep-rtofs-upper-ocean",
        "kind": "upper-ocean",
        "providerId": "ncep-rtofs",
        "authority": "NOAA/NWS/NCEP",
        "status": "unavailable",
        "usable": False,
        "dataUse": "availability check failed",
        "sourceUrl": RTOFS_ROOT,
        "documentationUrl": "https://www.nco.ncep.noaa.gov/pmb/products/rtofs/",
        "validTime": None,
        "fetchedAt": iso_z(now),
        "maxAgeHours": 72,
        "byteCount": 0,
        "sha256": None,
        "license": "U.S. Government NOAA/NCEP public data; provider disclaimer applies.",
        "detail": "; ".join(errors[-3:]),
    }


def quantize_i16(values: np.ndarray, scale: float, offset: float) -> np.ndarray:
    raw = np.rint((values - offset) / scale)
    if not np.isfinite(raw).all() or raw.min() < -32768 or raw.max() > 32767:
        raise AcquisitionError(
            f"WIWB int16 overflow/non-finite range {np.nanmin(raw)}..{np.nanmax(raw)}"
        )
    return raw.astype(np.int16).ravel(order="C")


def partial_environment_bin(
    cycle: datetime,
    atmosphere: dict[str, np.ndarray],
    sst: np.ndarray,
) -> bytes:
    month_suffix = f"{cycle.month - 1:02d}"
    bbox = DOMAIN
    nx, ny = ENV_NX, ENV_NY
    layers = [
        Layer(
            f"sst_{month_suffix}",
            "int16",
            True,
            nx,
            ny,
            1,
            bbox,
            QUANT_SCALE,
            SST_OFFSET,
            quantize_i16(sst, QUANT_SCALE, SST_OFFSET),
        )
    ]
    for name in ("u", "v", "shr", "shu", "shv", "rh"):
        values = atmosphere[name]
        layers.append(
            Layer(
                f"{name}_{month_suffix}",
                "int16",
                True,
                nx,
                ny,
                values.shape[0],
                bbox,
                QUANT_SCALE,
                0.0,
                quantize_i16(values, QUANT_SCALE, 0.0),
            )
        )
    return write_bin(None, layers)


def gfs_source(
    cycle: datetime,
    index: FetchResult,
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    digest_document = canonical_json(
        [
            {
                "leadH": item["leadH"],
                "sha256": item["sha256"],
                "bytes": item["bytes"],
            }
            for item in artifacts
        ]
    )
    return {
        "id": "ncep-gfs-regional",
        "kind": "atmospheric-grid",
        "providerId": "ncep-gfs",
        "authority": "NOAA/NWS/NCEP",
        "status": "acquired",
        "usable": True,
        "dataUse": "decoded regional deterministic forecast",
        "sourceUrl": index.url,
        "documentationUrl": "https://www.nco.ncep.noaa.gov/pmb/products/gfs/",
        "validTime": iso_z(cycle),
        "fetchedAt": max(item["fetchedAt"] for item in artifacts),
        "maxAgeHours": 18,
        "byteCount": sum(item["bytes"] for item in artifacts),
        "sha256": sha256(digest_document),
        "license": "U.S. Government NOAA/NCEP public data; provider disclaimer applies.",
        "detail": (
            "21 six-hourly 0–120 h regional GRIB2 leads decoded for deep-layer "
            "steering, 200–850 hPa shear, and 600/700 hPa humidity."
        ),
        "cycleId": f"gfs-{cycle.strftime('%Y%m%dT%HZ')}",
        "leadHours": list(LEADS_H),
        "artifactCount": len(artifacts),
    }


def unavailable_source(
    *,
    source_id: str,
    kind: str,
    provider_id: str,
    authority: str,
    source_url: str,
    documentation_url: str,
    detail: str,
    now: datetime,
) -> dict[str, Any]:
    return {
        "id": source_id,
        "kind": kind,
        "providerId": provider_id,
        "authority": authority,
        "status": "unavailable",
        "usable": False,
        "dataUse": "none",
        "sourceUrl": source_url,
        "documentationUrl": documentation_url,
        "validTime": None,
        "fetchedAt": iso_z(now),
        "maxAgeHours": 0,
        "byteCount": 0,
        "sha256": None,
        "license": "See provider documentation.",
        "detail": detail,
    }


def validate_output(
    manifest: dict[str, Any],
    environment_blob: bytes | None,
) -> None:
    """Reject internally inconsistent output before it reaches the web root."""
    gate_names = (
        "deterministicAtmosphere",
        "seaSurfaceTemperature",
        "officialAdvisory",
        "upperOcean",
        "ensembleAtmosphere",
    )
    ready = all(manifest["gates"][name] for name in gate_names)
    if ready != manifest["gates"]["readyForForecast"]:
        raise AcquisitionError("readyForForecast contradicts its required gates")
    if (manifest["status"] == "forecast-ready") != ready:
        raise AcquisitionError("status contradicts readyForForecast")
    if manifest["prospective"]["registered"] and not manifest["prospective"]["issued"]:
        raise AcquisitionError("an unissued cycle cannot be prospectively registered")
    if environment_blob is None:
        if manifest["environment"]["sha256"] is not None:
            raise AcquisitionError("missing environment has a SHA-256")
        return

    parsed = parse_bin(environment_blob)
    expected_suffix = f"{parse_iso(manifest['cycle']['analysisTime']).month - 1:02d}"
    expected_layers = {
        f"{name}_{expected_suffix}"
        for name in ("sst", "u", "v", "shr", "shu", "shv", "rh")
    }
    if set(parsed) != expected_layers:
        raise AcquisitionError(
            f"partial environment layers {sorted(parsed)} != {sorted(expected_layers)}"
        )
    if any(layer.nx != ENV_NX or layer.ny != ENV_NY for layer in parsed.values()):
        raise AcquisitionError("partial environment grid dimensions drifted")
    if sha256(environment_blob) != manifest["environment"]["sha256"]:
        raise AcquisitionError("partial environment SHA-256 drifted")
    if manifest["environment"]["usableForForecast"]:
        raise AcquisitionError("seven-field partial environment was promoted to forecast use")


def run(output_root: Path, archive_root: Path, now: datetime) -> dict[str, Any]:
    generated_at = iso_z(now)
    snapshot_name = now.strftime("%Y%m%dT%H%M%SZ")
    staging = archive_root / "snapshots" / now.strftime("%Y/%m/%d") / snapshot_name
    raw_directory = staging / "raw"
    raw_directory.mkdir(parents=True, exist_ok=True)
    sources_manifest: list[dict[str, Any]] = []
    failures: list[str] = []
    cycle: datetime | None = None
    environment_blob: bytes | None = None

    try:
        cycle, index = discover_complete_gfs_cycle(now)
        archive_write(raw_directory / "gfs-f000.idx", index.body)
        artifacts = download_gfs_cycle(cycle, raw_directory)
        atmosphere = derive_gfs_environment(artifacts)
        gfs = gfs_source(cycle, index, artifacts)
        sources_manifest.append(gfs)
    except Exception as error:
        failures.append(f"atmospheric-grid: {error}")
        sources_manifest.append(
            unavailable_source(
                source_id="ncep-gfs-regional",
                kind="atmospheric-grid",
                provider_id="ncep-gfs",
                authority="NOAA/NWS/NCEP",
                source_url=GFS_ROOT,
                documentation_url="https://www.nco.ncep.noaa.gov/pmb/products/gfs/",
                detail=str(error),
                now=now,
            )
        )
        atmosphere = None

    try:
        sst, sst_source = acquire_oisst(raw_directory)
        sources_manifest.append(sst_source)
    except Exception as error:
        failures.append(f"sea-surface-temperature: {error}")
        sources_manifest.append(
            unavailable_source(
                source_id="noaa-oisst-nrt",
                kind="sea-surface-temperature",
                provider_id="noaa-ncei",
                authority="NOAA National Centers for Environmental Information",
                source_url=f"{OISST_ROOT}/griddap/{OISST_DATASET}",
                documentation_url=f"{OISST_ROOT}/info/{OISST_DATASET}/index.html",
                detail=str(error),
                now=now,
            )
        )
        sst = None

    if cycle is not None and atmosphere is not None and sst is not None:
        environment_blob = partial_environment_bin(cycle, atmosphere, sst)
        environment_sha = sha256(environment_blob)
        archive_write(staging / "environment.bin", environment_blob)
    else:
        environment_sha = None

    try:
        sources_manifest.append(acquire_rsmc_state(raw_directory, now))
    except Exception as error:
        failures.append(f"agency-advisory: {error}")
        sources_manifest.append(
            unavailable_source(
                source_id="rsmc-new-delhi",
                kind="agency-advisory",
                provider_id="rsmc-new-delhi",
                authority="India Meteorological Department, RSMC New Delhi",
                source_url=RSMC_HOME,
                documentation_url="https://rsmcnewdelhi.imd.gov.in/bulletins-products-cwd.php",
                detail=str(error),
                now=now,
            )
        )

    rtofs = acquire_rtofs_state(now)
    sources_manifest.append(rtofs)
    sources_manifest.append(
        unavailable_source(
            source_id="ncep-gefs-regional",
            kind="ensemble-grid",
            provider_id="ncep-gefs",
            authority="NOAA/NWS/NCEP",
            source_url="https://nomads.ncep.noaa.gov/",
            documentation_url=GEFS_DOCS,
            detail="Regional GEFS acquisition and normalization are not configured yet.",
            now=now,
        )
    )

    by_kind = {source["kind"]: source for source in sources_manifest}
    gates = {
        "deterministicAtmosphere": bool(
            by_kind.get("atmospheric-grid", {}).get("usable")
        ),
        "seaSurfaceTemperature": bool(
            by_kind.get("sea-surface-temperature", {}).get("usable")
        ),
        "officialAdvisory": bool(by_kind.get("agency-advisory", {}).get("usable")),
        "upperOcean": bool(by_kind.get("upper-ocean", {}).get("usable")),
        "ensembleAtmosphere": bool(by_kind.get("ensemble-grid", {}).get("usable")),
    }
    ready = all(gates.values())
    gate_failures = [
        {
            "gate": name,
            "message": {
                "deterministicAtmosphere": "current deterministic atmosphere is unavailable",
                "seaSurfaceTemperature": "current SST analysis is unavailable",
                "officialAdvisory": "no normalized active RSMC advisory is available",
                "upperOcean": "no usable regional three-dimensional upper-ocean input is available",
                "ensembleAtmosphere": "current ensemble atmosphere is not configured",
            }[name],
        }
        for name, passed in gates.items()
        if not passed
    ]
    cycle_id = (
        f"gfs-{cycle.strftime('%Y%m%dT%HZ')}" if cycle is not None else "unavailable"
    )
    manifest = {
        "schemaVersion": 1,
        "product": "public-source-monitor",
        "generatedAt": generated_at,
        "region": {
            "name": "Arabian Sea / Oman",
            "bbox": {
                "west": DOMAIN[0],
                "east": DOMAIN[1],
                "south": DOMAIN[2],
                "north": DOMAIN[3],
            },
        },
        "cycle": {
            "id": cycle_id,
            "analysisTime": iso_z(cycle) if cycle is not None else None,
            "forecastLeadHours": list(LEADS_H) if cycle is not None else [],
        },
        "status": "forecast-ready" if ready else "forecast-disabled",
        "statusLabel": (
            "PUBLIC FORECAST INPUTS READY — EXPERIMENTAL, NOT OFFICIAL GUIDANCE"
            if ready
            else "PUBLIC DATA MONITOR — FORECAST DISABLED"
        ),
        "environment": {
            "url": "data/live/environment.bin" if environment_blob is not None else None,
            "sha256": environment_sha,
            "fieldCount": 7 if environment_blob is not None else 0,
            "requiredFieldCount": 8,
            "usableForForecast": False,
            "detail": (
                "Normalized GFS atmosphere plus OISST. OHC is intentionally absent, "
                "so the runtime cannot mistake this partial environment for a complete cycle."
                if environment_blob is not None
                else "No normalized partial environment was produced."
            ),
        },
        "sources": sources_manifest,
        "gates": {**gates, "readyForForecast": ready},
        "failures": failures + [item["message"] for item in gate_failures],
        "fallback": {
            "mode": "climatology-sandbox",
            "label": "climatology sandbox — public live inputs incomplete; not a current forecast",
        },
        "prospective": {
            "issued": False,
            "registered": False,
            "reason": (
                "No forecast is issued or registered while any required live-input gate is closed."
            ),
        },
    }
    validate_output(manifest, environment_blob)
    if environment_blob is not None:
        atomic_write(output_root / "environment.bin", environment_blob)
    rendered = canonical_json(manifest)
    manifest_hash = sha256(rendered)
    archive_write(staging / f"manifest-{manifest_hash}.json", rendered)
    atomic_write(output_root / "current.json", rendered)
    return manifest


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", default="public/data/live")
    parser.add_argument("--archive-root", default="tmp/public-cycle-archive")
    parser.add_argument("--now", default=None, help="ISO UTC time for deterministic runs")
    return parser.parse_args()


if __name__ == "__main__":
    options = arguments()
    requested_now = (
        parse_iso(options.now) if options.now else datetime.now(timezone.utc)
    )
    result = run(Path(options.output_root), Path(options.archive_root), requested_now)
    usable = sum(1 for source in result["sources"] if source["usable"])
    print(
        f"[public-cycle] cycle={result['cycle']['id']} usable={usable}/{len(result['sources'])} "
        f"status={result['status']}"
    )
