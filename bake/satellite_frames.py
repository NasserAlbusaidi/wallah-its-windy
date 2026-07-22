#!/usr/bin/env python3
"""Cache observed satellite frames in the browser-ready domain manifest.

Meteosat mode downloads a public EUMETView WMS crop. INSAT mode ingests a
GeoTIFF/PNG/JPEG that the operator has lawfully downloaded from MOSDAC; this
script never stores or accepts MOSDAC credentials.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

DOMAIN = {"west": 50.0, "south": 15.0, "east": 70.0, "north": 27.0}
WMS = "https://view.eumetsat.int/geoserver/wms"


def iso_utc(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def stamp(value: str) -> str:
    return iso_utc(value).replace("-", "").replace(":", "").replace("T", "-").replace("Z", "Z")


def mercator_y(latitude: float) -> float:
    rad = math.radians(max(-85.0, min(85.0, latitude)))
    return math.log(math.tan(math.pi / 4 + rad / 2))


def crop_equirectangular(image: Image.Image, source: dict[str, float]) -> Image.Image:
    x0 = (DOMAIN["west"] - source["west"]) / (source["east"] - source["west"])
    x1 = (DOMAIN["east"] - source["west"]) / (source["east"] - source["west"])
    y0 = (source["north"] - DOMAIN["north"]) / (source["north"] - source["south"])
    y1 = (source["north"] - DOMAIN["south"]) / (source["north"] - source["south"])
    return image.crop((x0 * image.width, y0 * image.height, x1 * image.width, y1 * image.height))


def crop_mercator(image: Image.Image, source: dict[str, float]) -> Image.Image:
    x0 = (DOMAIN["west"] - source["west"]) / (source["east"] - source["west"])
    x1 = (DOMAIN["east"] - source["west"]) / (source["east"] - source["west"])
    top = mercator_y(source["north"])
    bottom = mercator_y(source["south"])
    y0 = (top - mercator_y(DOMAIN["north"])) / (top - bottom)
    y1 = (top - mercator_y(DOMAIN["south"])) / (top - bottom)
    return image.crop((x0 * image.width, y0 * image.height, x1 * image.width, y1 * image.height))


def manifest_path(repo: Path) -> Path:
    return repo / "public" / "data" / "satellite" / "manifest.json"


def add_manifest_frame(repo: Path, frame: dict[str, object]) -> None:
    path = manifest_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = json.loads(path.read_text())
    else:
        data = {"version": 1, "frames": []}
    frames = [item for item in data.get("frames", []) if item.get("id") != frame["id"]]
    frames.append(frame)
    frames.sort(key=lambda item: (item["observedAt"], item["provider"], item["channel"]))
    path.write_text(json.dumps({"version": 1, "frames": frames}, indent=2) + "\n")


def cache_meteosat(args: argparse.Namespace, repo: Path) -> None:
    observed_at = iso_utc(args.observed_at)
    channel = args.channel
    layer = "msg_iodc:vis006" if channel == "visible" else "msg_iodc:ir108"
    params = urllib.parse.urlencode({
        "service": "WMS",
        "version": "1.3.0",
        "request": "GetMap",
        "layers": layer,
        "styles": "",
        "crs": "EPSG:4326",
        "bbox": "15,50,27,70",
        "width": "1000",
        "height": "600",
        "format": "image/png",
        "transparent": "false",
        "time": observed_at,
    })
    url = f"{WMS}?{params}"
    frame_id = f"meteosat-{channel}-{stamp(observed_at)}"
    destination = repo / "public" / "data" / "satellite" / f"{frame_id}.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("wb") as output:
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            raise RuntimeError(f"EUMETView returned {content_type or 'non-image data'}")
        shutil.copyfileobj(response, output)
    add_manifest_frame(repo, {
        "id": frame_id,
        "provider": "meteosat",
        "satellite": "Meteosat-9 IODC" if observed_at >= "2022-06-01" else "Meteosat-8 IODC",
        "product": "SEVIRI VIS0.6 μm" if channel == "visible" else "SEVIRI IR10.8 μm",
        "observedAt": observed_at,
        "channel": channel,
        "imageUrl": f"data/satellite/{frame_id}.png",
        "sourceUrl": "https://user.eumetsat.int/data-access/eumetview",
        "attribution": "EUMETSAT EUMETView",
        "license": "EUMETSAT data policy",
        "bbox": DOMAIN,
        "cached": True,
    })
    print(destination)


def cache_insat(args: argparse.Namespace, repo: Path) -> None:
    if not args.input_image or not args.granule_id:
        raise SystemExit("INSAT mode requires --input-image and --granule-id")
    observed_at = iso_utc(args.observed_at)
    source = {
        "west": args.source_bbox[0],
        "south": args.source_bbox[1],
        "east": args.source_bbox[2],
        "north": args.source_bbox[3],
    }
    with Image.open(args.input_image) as opened:
        image = opened.convert("RGB")
        cropped = crop_mercator(image, source) if args.projection == "mercator" else crop_equirectangular(image, source)
        cropped = cropped.resize((1000, 600), Image.Resampling.LANCZOS)
    frame_id = f"insat-{args.channel}-{stamp(observed_at)}-{args.granule_id}"
    destination = repo / "public" / "data" / "satellite" / f"{frame_id}.webp"
    destination.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(destination, "WEBP", quality=92, method=6)
    add_manifest_frame(repo, {
        "id": frame_id,
        "provider": "insat",
        "satellite": args.satellite,
        "product": args.product,
        "observedAt": observed_at,
        "channel": args.channel,
        "imageUrl": f"data/satellite/{frame_id}.webp",
        "sourceUrl": f"https://mosdac.gov.in/uops/?metaid={args.granule_id}",
        "attribution": "MOSDAC / Space Applications Centre, ISRO",
        "license": args.license,
        "bbox": DOMAIN,
        "cached": True,
    })
    print(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provider", choices=("meteosat", "insat"))
    parser.add_argument("--observed-at", required=True, help="ISO-8601 acquisition time")
    parser.add_argument("--channel", choices=("infrared", "visible"), default="infrared")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--input-image", type=Path, help="lawfully downloaded/rendered INSAT raster")
    parser.add_argument("--granule-id", help="MOSDAC granule/meta ID")
    parser.add_argument("--satellite", default="INSAT-3D")
    parser.add_argument("--product", default="IMAGER TIR1")
    parser.add_argument("--license", default="MOSDAC research-use terms")
    parser.add_argument("--projection", choices=("mercator", "equirectangular"), default="mercator")
    parser.add_argument(
        "--source-bbox",
        nargs=4,
        type=float,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        default=(44.5, -10.0, 105.5, 45.0),
        help="source raster extent; default is INSAT Asia Mercator L1C",
    )
    args = parser.parse_args()
    if args.provider == "meteosat":
        cache_meteosat(args, args.repo.resolve())
    else:
        cache_insat(args, args.repo.resolve())


if __name__ == "__main__":
    main()
