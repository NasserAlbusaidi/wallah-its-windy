# Satellite-cloud visual validation

## Claim boundary

This is a **qualitative morphology screen**, not a forecast-skill score and not
a radiometric validation. The simulated field does not solve cloud
microphysics, radiative transfer, or data assimilation. It turns the modeled
storm structure and environment into a visually coherent cloud-top proxy.

The validation asks narrower questions that the renderer can honestly answer:

- Is the cold-cloud coverage in the same order of magnitude?
- Is there an organized core near the modeled circulation centre?
- Is the cloud centroid displaced by a plausible distance and direction?
- Is the quadrant distribution broadly asymmetric rather than perfectly radial?

The executable screen is `bake/validate_satellite_structure.py`; its frozen
output is `calibration/satellite-cloud-validation.json`.

## Timestamp-matched case

The first frozen case uses the untouched Shaheen validation scenario:

| item | value |
|---|---|
| Scenario | `shaheen-2021-hindcast` |
| Model age | 2.5 h |
| Model centre | 23.1917 N, 65.0952 E |
| Model wind | 35.99 kt |
| Model organization | 0.4499 |
| Observed frame | Meteosat-8 IODC, SEVIRI IR10.8 μm |
| Acquisition | 2021-10-01 02:30 UTC |
| Source | EUMETSAT EUMETView public WMS |
| Comparison radius | 3.5 degrees around the modeled centre |

Paused historical inspection resolves the model clock to the nearest 15-minute
satellite acquisition. Accelerated playback deliberately refreshes at the
three-hour environment cadence to avoid flooding a public WMS; pausing replaces
that coarse playback frame with the actual 15-minute match.

## Result

The morphology screen passes all five deliberately broad checks:

- simulated/observed cold-cloud coverage ratio: **0.4903**;
- cloud-centroid vector separation: **1.3731 degrees** (limit 1.5 degrees);
- quadrant-fraction mean absolute error: **0.1738** (limit 0.20);
- simulated organized-core fraction: **0.7826** (minimum 0.08);
- centroid-distance difference: **0.4797 degrees** (limit 1.25 degrees).

The result confirms that the render is no longer a generic rotating sprite: it
produces a resolved core, broken spiral convection, environmental cloud cover,
and a shear-displaced canopy on the correct geographic domain and timestamp.

It also exposes the next fidelity gap. In this Shaheen frame, the observed cold
shield is broader and predominantly south of the circulation; the simulated
shield is about half as extensive and leans northwest. Passing this coarse
screen does **not** mean the cloud geometry, brightness temperatures, or rain
rates are accurate. A multi-case calibration set and radiometrically decoded
IR temperatures would be required before tightening the thresholds.

## Currency note (2026-07-29)

The sealed result above documents the renderer as it existed when the screen
was frozen. Two later render changes (the rain/IR alignment fix and the C2a
upper-wind merge) and the 2026-07-29 cloud-motion work all altered the
simulated cloud output without this screen being re-run, and the original
simulated-capture protocol (viewport, canvas isolation, fade state) was never
recorded, so the sealed numbers are not reproducible by re-capture.

A controlled A/B on 2026-07-29 — one pinned pipeline (WMS re-fetch of the same
observed frame; scenario `shaheen` hindcast scrubbed to frame 10 = 2.5 h;
grayscale; UI hidden; `#gl-canvas` element capture), renderer as the only
variable — measured: pre-cloud-motion main fails `centroid_vector_within_1_5deg`
(1.66 > 1.5, quadrant MAE 0.195); the cloud-motion branch fails
`quadrant_distribution_plausible` (MAE 0.205 > 0.20) while restoring the
centroid vector to 1.43 (passing). The cloud-motion branch was accepted on
that relative evidence. Re-sealing this screen with a documented, automated
capture protocol is tracked as a follow-up issue; the thresholds themselves
remain untouched.

## Observed-frame sources

### Meteosat

The runtime requests domain-cropped `msg_iodc:ir108` and
`msg_iodc:vis006` frames from the public EUMETView WMS. It preserves provider,
satellite, product, acquisition time, attribution, bounding box, and source URL
with every frame. The optional baker can cache a reviewed frame into the static
manifest for reproducible historical runs.

### INSAT

MOSDAC's `3DIMG_L1C_ASIA_MER` catalogue is publicly searchable, but its API is
not CORS-enabled and pixel downloads require a registered user and accepted
terms. The static browser therefore consumes reviewed INSAT frames only from
the local provenance manifest. If none matches, it says that registered ingest
is required and continues with the simulated fallback—without leaking
credentials through a proxy or producing a hidden network failure.

`bake/satellite_frames.py insat` accepts a lawfully downloaded/rendered raster,
crops its documented extent into the app domain, converts it to a browser-ready
image, and adds its provenance to the manifest. The script never accepts or
stores MOSDAC credentials.

## Observed initialization to simulated evolution

The `obs to sim` source mode is a **visual initialization handoff**:

1. load the timestamp-matched observed frame;
2. align it to the same fixed geographic domain as the simulation;
3. crossfade from observed pixels to the evolving simulated cloud field over
   six model hours;
4. continue with the deterministic simulated cloud evolution.

This is not meteorological data assimilation. The observed pixels do not alter
the vortex state, environmental fields, track, or intensity. A future physical
initialization would need retrievals or analysis fields that update the model
state under a separately validated contract.

## Reproduce

With the two same-domain captures available:

```bash
python3 bake/validate_satellite_structure.py \
  --observed /path/to/shaheen-observed-grayscale.png \
  --simulated /path/to/shaheen-simulated-grayscale.png \
  --center-lat 23.191736897213236 \
  --center-lon 65.09515530527648 \
  --radius-deg 3.5 \
  --observed-at 2021-10-01T02:30:00Z \
  --scenario shaheen-2021-hindcast \
  --output calibration/satellite-cloud-validation.json
```

Primary service references:

- [EUMETView user guide](https://user.eumetsat.int/resources/user-guides/eumet-view-user-guide)
- [MOSDAC Data Download API manual](https://mosdac.gov.in/downloadapi-manual)
- [INSAT-3D Asia Mercator product](https://mosdac.gov.in/doi/123/)
