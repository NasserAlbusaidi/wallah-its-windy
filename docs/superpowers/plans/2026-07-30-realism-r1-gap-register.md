# Realism R1 — Gap Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the realism gap register — an evidenced, classified catalogue of every way the simulated sensor products and climate forcing read as unrealistic — plus the one-shot ERA5 variance study and the HF-7 charter draft.

**Architecture:** Pure research phase with one code artifact. Three evidence streams (paired in-app observation sessions, literature anchors, scripted ERA5 variance study) feed one register document. No runtime code changes; the only executable deliverables are two bake-side Python scripts following the repo's standalone-assert test convention.

**Tech Stack:** Existing Vite dev server for capture sessions; bake venv Python (numpy, h5py, Pillow — already pinned); CDS API via `~/.cdsapirc` (already configured on this machine — `data/raw/era5_climatology.nc` exists).

**Spec:** `docs/superpowers/specs/2026-07-30-realism-program-design.md`

## Global Constraints

- No change to `src/sim.ts`, `src/structure.ts`, any calibrated constant, frozen acceptance file, or sealed cohort. `npm test`, `npm run calibrate:check`, and the HF-6 checks must pass untouched at every commit.
- Zero new runtime npm dependencies; zero new Python dependencies (numpy/h5py/Pillow only).
- Committed capture images: WebP, quality 82, ≤ 250 KB each, ≤ 15 MB total for the whole R1 evidence set.
- External observed imagery is committed ONLY if its licence allows redistribution (NASA Worldview/GIBS: yes; anything unclear: record a URL + access date in the session log instead of committing pixels).
- Every external image or citation records: source, URL, access date, licence.
- Machine-generated outputs (`docs/research/realism/env-variance-study.md`, `calibration/realism/env-variance.json`) are never hand-edited.
- Conventional commits, no AI attribution.
- Branch: `feat/realism-program` (already exists, spec committed).

## Data-availability facts the plan is built on (verified 2026-07-30)

- Event scenarios (URL hash `#env=<id>`): `gonu`, `phet`, `nilofar`, `ashobaa`, `mekunu`, `hikaa`, `vayu`, `kyarr`, `shaheen`, `biparjoy` (`public/data/scenarios.json`). There is **no Tauktae event bin** — Tauktae is out of R1 scope (creating event bins is a bake-pipeline task, not research).
- In-app observed Meteosat frames exist only for model times ≥ 2020-08-01 (`METEOSAT_ARCHIVE_START_MS`, `src/satellite-observations.ts:36`). Therefore **paired** (in-app sim + in-app observed) sessions are possible only for `shaheen` (Sep–Oct 2021) and `biparjoy` (Jun 2023). All other archetypes are **reference-only**: sim-side captures still come from the event replay in-app; observed-side reference comes from external published imagery.
- Scenario metadata (`startIso`, `stepH`, `windowH`) maps model time to real UTC for matching external imagery.
- Python tests use the repo's standalone-assert convention (plain asserts + `main()` returning nonzero) — there is NO pytest in the bake venv (`bake/test_events.py` header documents this).
- `node bake/run-python.mjs <args…>` runs the repo venv Python with args passed verbatim; `-u` for unbuffered fetch scripts.

## Archetype × lifecycle matrix (locked)

| Archetype | Storm | Scenario id | Observed side |
| --- | --- | --- | --- |
| Severe, long-lived | Gonu 2007 | `gonu` | external (reference-only) |
| Severe, recurving, no landfall | Kyarr 2019 | `kyarr` | external (reference-only) |
| Oman landfall | Shaheen 2021 | `shaheen` | **in-app paired** |
| Indian-coast landfall + long sheared weak phase | Biparjoy 2023 | `biparjoy` | **in-app paired** |
| Weak sheared system | Ashobaa 2015 | `ashobaa` | external (reference-only) |

Lifecycle stages: `genesis`, `intensification`, `peak`, `shear-decay`, `landfall` (Kyarr: `dissipation` instead of `landfall`). Stage times are located from the scenario's ghost/best track in-app (first gale-force point, steepest intensity rise, maximum, decline onset, coast crossing) — not hardcoded here.

---

### Task 1: Scaffolding — register skeleton, matrix, protocol docs

**Files:**
- Create: `docs/realism-gap-register.md`
- Create: `docs/research/realism/README.md`
- Create: `docs/research/realism/sessions/TEMPLATE.md`

**Interfaces:**
- Produces: the register entry schema (exact field list below) used verbatim by Tasks 3–6 and 8; the capture naming convention `docs/research/realism/captures/<storm>/<stage>-{sim|obs}.webp`; session logs at `docs/research/realism/sessions/<storm>.md`.

- [ ] **Step 1: Create `docs/realism-gap-register.md`** with exactly these sections:

```markdown
# Realism gap register

Status: R1 in progress. Spec: docs/superpowers/specs/2026-07-30-realism-program-design.md
Every entry follows the schema in docs/research/realism/README.md.

## Data-availability matrix

| Archetype | Storm | Scenario | Observed side | Stages covered |
| --- | --- | --- | --- | --- |
| Severe, long-lived | Gonu 2007 | env=gonu | external reference (Meteosat in-app archive starts 2020-08-01) | pending |
| Severe, recurving | Kyarr 2019 | env=kyarr | external reference | pending |
| Oman landfall | Shaheen 2021 | env=shaheen | in-app paired | pending |
| Indian-coast landfall + weak sheared phase | Biparjoy 2023 | env=biparjoy | in-app paired | pending |
| Weak sheared system | Ashobaa 2015 | env=ashobaa | external reference | pending |

Tauktae 2021 is excluded: no event bin exists, and baking one is outside R1's
research scope. Candidate future work, recorded in the HF-7 charter appendix.

## Decisions

- D1 (pending, Task 6): observed rain reference over the open Arabian Sea.
- D2 (pending, Task 6): licence position for committed observed reference material.

## Entries

(populated by session and literature tasks)

## R2 metric shortlist

(populated by Task 8)
```

- [ ] **Step 2: Create `docs/research/realism/README.md`** documenting the entry schema and capture rules:

```markdown
# Realism research evidence

Captures: docs/research/realism/captures/<storm>/<stage>-{sim|obs}.webp,
1600×900 viewport, WebP quality 82, ≤ 250 KB each. Observed-side external
images are committed only under a redistribution-compatible licence
(NASA Worldview/GIBS OK); otherwise the session log records URL + access date.

Compression (repo venv, no new tools):
node bake/run-python.mjs -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'WEBP', quality=82)" in.png out.webp

## Register entry schema (copy verbatim for each entry)

### RGR-NNN — <short title>
- subsystem: ir-clouds | vis-clouds | radar-rain | environment
- stage: genesis | intensification | peak | shear-decay | landfall | dissipation | all
- evidence: <capture pair paths and/or citation and/or study numbers>
- description: <what the real product shows vs what the sim shows>
- class: presentation | data | physics
- severity: high | medium | low   (visibility to a satellite-literate viewer)
- candidate metric: <deterministic field-space quantity, presentation-class only>
- rough cost: S | M | L
- disposition: close-now | hf7-charter | rejected
```

- [ ] **Step 3: Create `docs/research/realism/sessions/TEMPLATE.md`:**

```markdown
# Session — <storm> (<scenario id>)

Date: YYYY-MM-DD. Operator: <name>.
Scenario URL: <dev-server-url>/#env=<id>
Ghost track stage times used:
- genesis: <model time / real UTC>
- intensification: <…>
- peak: <…>
- shear-decay: <…>
- landfall|dissipation: <…>

## Observed-side source
in-app Meteosat IODC | external: <source, URL, access date, licence>

## Stage notes
### <stage>
- captures: captures/<storm>/<stage>-sim.webp, <stage>-obs.webp
- real shows / sim lacks: …
- sim shows / real lacks: …
- candidate register entries: RGR-…
```

- [ ] **Step 4: Verify and commit**

Run: `npm test` (must stay green — nothing outside docs/ changed).
Run: `git add docs/realism-gap-register.md docs/research/realism/ && git commit -m "docs: scaffold the realism gap register and evidence conventions"`

---

### Task 2: ERA5 fetch script for the variance study (start the queue early)

CDS queues take minutes to hours; this task lands the fetch script and starts the downloads in the background so Task 7 finds the data ready. Seasons: 2019 (Vayu/Hikaa/Kyarr), 2021 (Shaheen), 2023 (Biparjoy) — May–Nov, 6-hourly, same area/grid as env.bin.

**Files:**
- Create: `bake/fetch_realism_era5.py`
- Modify: `package.json` (one script line in the `data:` block)

**Interfaces:**
- Produces: `data/raw/era5_realism_plev_<year>.nc` (u/v/rh at 200/600/700/850 hPa) and `data/raw/era5_realism_sst_<year>.nc` for year ∈ {2019, 2021, 2023}; consumed by Task 7's `bake/realism_env_variance.py`.

- [ ] **Step 1: Write `bake/fetch_realism_era5.py`** (mirror of `bake/fetch_era5.py`'s conventions — module docstring with prereqs, `data/raw/` target, skip-existing):

```python
"""Fetch 6-hourly ERA5 fields for the realism env-variance study (R1).

Prereqs: same as bake/fetch_era5.py (~/.cdsapirc + accepted CDS licence).
Run: node bake/run-python.mjs -u bake/fetch_realism_era5.py
Seasons 2019/2021/2023, May-Nov, 00/06/12/18 UTC, 50-70E/15-27N, 0.5 deg —
the same domain and grid as env.bin. Re-running skips files that already exist.
"""

from __future__ import annotations

from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
AREA = [27, 50, 15, 70]  # N, W, S, E — matches bake/fetch_era5.py
GRID = [0.5, 0.5]
YEARS = ("2019", "2021", "2023")
MONTHS = ["05", "06", "07", "08", "09", "10", "11"]
DAYS = [f"{d:02d}" for d in range(1, 32)]
TIMES = ["00:00", "06:00", "12:00", "18:00"]


def requests() -> list[tuple[str, str, dict]]:
    out: list[tuple[str, str, dict]] = []
    for year in YEARS:
        out.append((
            f"era5_realism_plev_{year}.nc",
            "reanalysis-era5-pressure-levels",
            {
                "product_type": "reanalysis",
                "variable": ["u_component_of_wind", "v_component_of_wind",
                             "relative_humidity"],
                "pressure_level": ["200", "600", "700", "850"],
                "year": year, "month": MONTHS, "day": DAYS, "time": TIMES,
                "area": AREA, "grid": GRID,
                "data_format": "netcdf", "download_format": "unarchived",
            },
        ))
        out.append((
            f"era5_realism_sst_{year}.nc",
            "reanalysis-era5-single-levels",
            {
                "product_type": "reanalysis",
                "variable": ["sea_surface_temperature"],
                "year": year, "month": MONTHS, "day": DAYS, "time": TIMES,
                "area": AREA, "grid": GRID,
                "data_format": "netcdf", "download_format": "unarchived",
            },
        ))
    return out


def main() -> int:
    import cdsapi  # not in requirements.txt by design; same as fetch_era5.py

    RAW.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for filename, dataset, request in requests():
        target = RAW / filename
        if target.exists():
            print(f"skip {filename} (exists)")
            continue
        print(f"request {filename} from {dataset} …")
        client.retrieve(dataset, request, str(target))
        print(f"done {filename}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Before writing, open `bake/fetch_era5.py` and confirm how it imports/constructs the cdsapi client; keep this file consistent with whatever that file actually does (it is the house pattern).

- [ ] **Step 2: Add the npm script** to `package.json` next to the other `data:` entries:

```json
"data:realism:fetch": "node bake/run-python.mjs -u bake/fetch_realism_era5.py",
```

- [ ] **Step 3: Start the fetch in the background**

Run: `npm run data:realism:fetch` as a background job. Do not block on it; Task 7 checks completion. If `~/.cdsapirc` is missing the script fails immediately with the licence/credentials message — surface that to the user and continue with Tasks 3–6 (only Task 7 depends on the data).

- [ ] **Step 4: Verify and commit**

Run: `npm test` (green).
Run: `git add bake/fetch_realism_era5.py package.json && git commit -m "feat: add the ERA5 6-hourly fetch for the realism variance study"`

---

### Task 3: Pilot paired session — Shaheen

**Files:**
- Create: `docs/research/realism/sessions/shaheen.md` (from TEMPLATE.md)
- Create: `docs/research/realism/captures/shaheen/<stage>-{sim|obs}.webp` (≥ 4 stage pairs)
- Modify: `docs/realism-gap-register.md` (new entries + matrix row updated)

**Interfaces:**
- Consumes: Task 1's schema, template, naming convention.
- Produces: the worked example every later session task copies.

- [ ] **Step 1: Start the dev server** (`npm run dev`), open `<url>/#env=shaheen`.
- [ ] **Step 2: Locate stage times** from the ghost/best track (enable the historical ghost track for the scenario in the layer rail): first gale-force fix → `genesis`; steepest rise → `intensification`; maximum → `peak`; decline onset → `shear-decay`; coast crossing → `landfall`. Record model time and real UTC (from `startIso` 2021-09-20T00Z + model hours) for each in the session log.
- [ ] **Step 3: For each stage:** pause at the stage time; capture simulated IR at 1600×900 → `<stage>-sim.png`; switch the satellite desk to observed Meteosat IR at the same paused time → `<stage>-obs.png`; convert both with the Pillow one-liner from `docs/research/realism/README.md`; delete the PNGs. For `peak`, additionally capture the VIS pair as `peak-vis-sim.webp` / `peak-vis-obs.webp` (daytime frame required — if the peak falls at night, use the nearest daytime frame and note the shift in the log).
- [ ] **Step 4: Write the session log**, filling every "real shows / sim lacks" and "sim shows / real lacks" line with specific, falsifiable observations (e.g. "observed eyewall BT floor colder than sim's coldest palette stop", not "looks better").
- [ ] **Step 5: Draft register entries** for every gap the session surfaced, `RGR-001` upward, schema verbatim, `evidence:` pointing at the committed capture pairs. Explicitly evaluate the spec's background-cloudiness hypothesis (real IODC frames carry monsoon cloud across the basin; the sim background is suspected too empty) and either write it up as an entry or record its rejection in the session log.
- [ ] **Step 6: Verify sizes and commit**

Check every `.webp` ≤ 250 KB (`ls -la docs/research/realism/captures/shaheen/`).
Run: `git add docs/research/realism/ docs/realism-gap-register.md && git commit -m "docs: realism session - shaheen paired captures and first register entries"`

---

### Task 4: Paired session — Biparjoy (weak sheared phase + Gujarat landfall)

**Files:**
- Create: `docs/research/realism/sessions/biparjoy.md`
- Create: `docs/research/realism/captures/biparjoy/<stage>-{sim|obs}.webp`
- Modify: `docs/realism-gap-register.md`

**Interfaces:**
- Consumes: Task 3's worked example; continues RGR numbering.

- [ ] **Step 1–4: Repeat the Task 3 protocol** for `#env=biparjoy` (startIso 2023-06-08T00Z). This storm's long sheared weak phase is the point: spend at least two capture pairs inside it (exposed-center / asymmetric-convection appearance) in addition to the standard stages. Landfall stage covers the Indian-coast archetype.
- [ ] **Step 2: New register entries** — pay particular attention to gaps the weak/sheared regime exposes that Shaheen's cleaner structure did not (asymmetry, convective displacement, ragged tops vs the sim's radially-organized morphology). Do not duplicate Shaheen entries; extend an existing entry's `evidence:` line when it is the same gap seen again.
- [ ] **Step 3: Verify and commit**

Run: `git add docs/research/realism/ docs/realism-gap-register.md && git commit -m "docs: realism session - biparjoy paired captures and register entries"`

---

### Task 5: Reference-only sessions — Gonu, Kyarr, Ashobaa

**Files:**
- Create: `docs/research/realism/sessions/{gonu,kyarr,ashobaa}.md`
- Create: `docs/research/realism/captures/{gonu,kyarr,ashobaa}/<stage>-sim.webp` (+ `-obs.webp` only where licence-clean)
- Modify: `docs/realism-gap-register.md`

**Interfaces:**
- Consumes: Tasks 3–4 conventions; continues RGR numbering.

- [ ] **Step 1: Sim-side captures** for `#env=gonu`, `#env=kyarr`, `#env=ashobaa` at their stage times (Kyarr uses `dissipation` instead of `landfall`; Ashobaa is the weak-sheared archetype — its whole life is effectively the sheared regime, so capture genesis / best-organized / decaying).
- [ ] **Step 2: Observed-side references from external archives.** Preferred sources, in order: NASA Worldview/GIBS (MODIS true-color/IR, public domain — committable), then agency/report imagery (IMD/JTWC reports, NOAA archives — usually committable with attribution), then anything else as URL-only. Match date/time to the stage's real UTC from the scenario metadata. Record source, URL, access date, licence per image in the session log. Where no usable observed image exists for a cell, mark the cell `no observed reference available` in the matrix — never silently skip.
- [ ] **Step 3: Register entries** — these sessions primarily test whether the paired-session gaps generalize across archetypes (severe long-lived, recurving, weak). Extend `evidence:` lines of existing entries where confirmed; add new entries only for gaps first visible here.
- [ ] **Step 4: Update the availability matrix** "Stages covered" column for all five storms.
- [ ] **Step 5: Verify and commit**

Run: `git add docs/research/realism/ docs/realism-gap-register.md && git commit -m "docs: realism sessions - gonu, kyarr, ashobaa reference captures and entries"`

---

### Task 6: Literature anchors + the two standing decisions

**Files:**
- Create: `docs/research/realism/literature-anchors.md`
- Modify: `docs/realism-gap-register.md` (entries citing literature; D1/D2 resolved)

**Interfaces:**
- Produces: quantitative anchors that Task 8 turns into the R2 metric shortlist; resolved decisions D1 (rain truth) and D2 (licence position).

- [ ] **Step 1: Write `docs/research/realism/literature-anchors.md`** with one section per topic, each ending in a boxed "anchor" (a number or relationship a metric could test) plus full citations:
  1. **TC diurnal pulse** (Dunion et al. 2014 and follow-ons): cirrus-canopy IR cooling/warming cycle amplitude, phase (local time), outward propagation speed.
  2. **IR brightness temperature vs intensity** (Dvorak technique lineage; ADT papers): eye–cloud-top BT contrast by category, coldest-ring BT ranges, eye clarity onset intensity.
  3. **Cirrus canopy / outflow extent**: typical canopy radius vs storm size and intensity; upper-level outflow asymmetry vs 200-hPa environment (the app already consumes 200-hPa winds — anchor what the canopy SHOULD do with them).
  4. **Rainband geometry**: principal band spacing, crossing angle, stratiform/convective partition (TRMM/GPM-era climatologies).
  5. **Arabian Sea environmental cloud context**: monsoon-season cloud cover climatology over the basin (supports or refutes the background-cloudiness hypothesis with a number).
- [ ] **Step 2: Resolve D1 (observed rain reference).** Investigate GPM IMERG access (NASA GES DISC: registration, licence, format, latency) vs RainViewer's coastal-composite coverage over the basin. Write the decision with rationale into the register's Decisions section: which product anchors radar-rain realism in R2, and how it would be acquired.
- [ ] **Step 3: Resolve D2 (licence position).** Confirm EUMETSAT's terms for redistributing derived statistics vs raw imagery; confirm NASA Worldview/GIBS reuse terms; write the resulting rule into the Decisions section (expected outcome per spec: derived statistics + provenance manifests in R2; raw frames only where clearly permitted).
- [ ] **Step 4: Register entries from literature** — any anchor the sim visibly violates becomes an entry (class `presentation` where render-side, `data`/`physics` where not), `evidence:` citing the anchor section.
- [ ] **Step 5: Verify and commit**

Run: `git add docs/research/realism/literature-anchors.md docs/realism-gap-register.md && git commit -m "docs: realism literature anchors and rain-truth/licence decisions"`

---

### Task 7: ERA5 variance analysis script (standalone-assert tested)

**Files:**
- Create: `bake/test_realism_variance.py`
- Create: `bake/realism_env_variance.py`
- Create (generated): `calibration/realism/env-variance.json`, `docs/research/realism/env-variance-study.md`
- Modify: `package.json` (one script line)

**Interfaces:**
- Consumes: `data/raw/era5_realism_plev_<year>.nc`, `data/raw/era5_realism_sst_<year>.nc` from Task 2.
- Produces: `env-variance.json` with the exact shape below, consumed by Task 8's charter:

```json
{
  "version": 1,
  "sourceTag": "ERA5-6H-REALISM-2019-2021-2023",
  "years": [2019, 2021, 2023],
  "regions": {"belt": "lat <= 19.0 N (genesis belt, mirrors bake/era5.py)", "domain": "50-70E 15-27N"},
  "fields": {
    "shear_ms":   {"belt": {"2019": {"05": {"mean": 0.0, "std": 0.0, "p05": 0.0, "p95": 0.0, "maxOverMean": 0.0}}}, "domain": {}},
    "rh_mid_pct": {"belt": {}, "domain": {}},
    "sst_c":      {"belt": {}, "domain": {}}
  }
}
```

(every year × month "05".."11" populated; all numbers rounded to 6 decimal places)

Definitions locked here: `shear_ms` = |V(850) − V(200)| computed **per timestep per grid cell**, then spatially averaged over the region, then temporal stats over the month — mean-of-magnitudes, mirroring the documented rule in `bake/era5.py`. `rh_mid_pct` = mean of the 600 and 700 hPa RH. `sst_c` = SST in °C, ocean cells only (skip NaN/fill). Stats are over the month's 6-hourly regional-mean series: `mean`, `std` (ddof=0), `p05`, `p95` (numpy percentiles, linear interpolation), `maxOverMean` = max/mean.

- [ ] **Step 1: Write the failing test `bake/test_realism_variance.py`** (standalone-assert convention — plain asserts, `main()` returns nonzero on failure, no pytest):

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node bake/run-python.mjs bake/test_realism_variance.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'realism_env_variance'`

- [ ] **Step 3: Write `bake/realism_env_variance.py`.** Required pieces:

```python
#!/usr/bin/env python3
"""realism_env_variance.py — one-shot R1 study: what within-month variability
do env.bin's monthly planes erase? Reads the 6-hourly ERA5 files fetched by
bake/fetch_realism_era5.py and writes calibration/realism/env-variance.json
plus a generated markdown table. Offline after the fetch; deterministic.

Run: node bake/run-python.mjs bake/realism_env_variance.py
"""

from __future__ import annotations

import json
import os

import numpy as np

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")
OUT_JSON = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                        "calibration", "realism", "env-variance.json")
OUT_MD = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                      "docs", "research", "realism", "env-variance-study.md")
YEARS = (2019, 2021, 2023)
MONTHS = tuple(f"{m:02d}" for m in range(5, 12))
BELT_LAT_MAX = 19.0  # genesis belt, mirrors bake/era5.py GENESIS_BELT_LAT_MAX


def round6(x: float) -> float:
    return float(round(float(x), 6))


def temporal_stats(series: np.ndarray) -> dict:
    mean = float(np.mean(series))
    return {
        "mean": round6(mean),
        "std": round6(float(np.std(series))),
        "p05": round6(float(np.percentile(series, 5))),
        "p95": round6(float(np.percentile(series, 95))),
        "maxOverMean": round6(float(np.max(series)) / mean) if mean else 0.0,
    }


def regional_shear_series(u850, v850, u200, v200, mask) -> np.ndarray:
    """|V850 - V200| per timestep per cell, then mean over masked cells.

    Mean-of-magnitudes BEFORE any temporal reduction — opposing-direction
    timesteps must not cancel (same rule bake/era5.py documents for shear).
    """
    mag = np.hypot(u850 - u200, v850 - v200)          # (t, lat, lon)
    return mag[:, mask].mean(axis=1)                   # (t,)
```

plus: an h5py reader that discovers coordinate names defensively using the same candidate lists as `bake/era5.py` (`valid_time|time|date`, `pressure_level|level|plev`, `latitude|lat`, `longitude|lon`) — read that file's `_open` logic first and follow it; month grouping from the decoded time axis; `rh_mid_pct` = mean of 600/700 planes; `sst_c` with fill/NaN cells excluded from the regional mean and converted from K; two region masks (`belt`: lat ≤ 19.0, `domain`: all); assembly into the JSON shape from the Interfaces block; and a generated-markdown writer that starts with `<!-- generated by bake/realism_env_variance.py — do not hand-edit -->` and renders one table per field/region (rows = month, columns = year, cell = `mean ± std (p95)`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node bake/run-python.mjs bake/test_realism_variance.py`
Expected: `ok test_temporal_stats_known_series`, `ok test_shear_is_mean_of_magnitudes`, `ok test_rounding_six_places`, exit 0.

- [ ] **Step 5: Confirm the Task 2 fetch finished** (`ls data/raw/era5_realism_*.nc` → 6 files). If still queued, pause this task until it lands (do not substitute other data).

- [ ] **Step 6: Run the study**

Run: `node bake/run-python.mjs bake/realism_env_variance.py`
Expected: writes `calibration/realism/env-variance.json` + `docs/research/realism/env-variance-study.md`. Re-run immediately; the outputs must be byte-identical (deterministic).

- [ ] **Step 7: Add the npm script** to `package.json`:

```json
"data:realism:variance": "node bake/run-python.mjs bake/realism_env_variance.py",
```

- [ ] **Step 8: Verify and commit**

Run: `npm test` (green — nothing runtime-side changed).
Run: `git add bake/test_realism_variance.py bake/realism_env_variance.py calibration/realism/env-variance.json docs/research/realism/env-variance-study.md package.json && git commit -m "feat: add the R1 env-variance study - within-month variability env.bin cannot represent"`

---

### Task 8: HF-7 charter, R2 metric shortlist, acceptance check, PR

**Files:**
- Create: `docs/hf7-realism-charter.md`
- Modify: `docs/realism-gap-register.md` (R2 shortlist section; final dispositions)
- Modify: `ROADMAP.md` (short realism-program entry in the product/communication section)

**Interfaces:**
- Consumes: all register entries (Tasks 3–6), `calibration/realism/env-variance.json` (Task 7).

- [ ] **Step 1: Write `docs/hf7-realism-charter.md`** with sections: purpose (a charter, explicitly NOT a commitment to run HF-7); data-side gaps (every `class: data` register entry, verbatim ids); physics-side gaps (every `class: physics` entry, cross-referenced to the HF-2B/2C items already in ROADMAP.md); the variance-study numbers (cite `calibration/realism/env-variance.json`, quote the headline shear/RH/SST std and p95 values per month); consequences (daily/hourly forcing ⇒ from-scratch recalibration per the `SHEAR_THRESHOLD_MS` comment in `src/sim.ts`; new sealed cohort per ROADMAP's phase rules); appendix (Tauktae event-bin candidate).
- [ ] **Step 2: Fill the register's R2 metric shortlist** — for each high-severity `presentation` entry, one line: entry id → candidate field-space metric → literature anchor it tests. This is R2's input, not its spec.
- [ ] **Step 3: Final disposition pass** — every register entry has a non-empty disposition; the availability matrix has no `pending` cells (covered or explicitly marked unavailable).
- [ ] **Step 4: Add the ROADMAP entry** — a short subsection under "Product and communication roadmap" recording the realism program (register → harness → closure waves, two-track rule, charter location). Do not touch any frozen-outcome prose.
- [ ] **Step 5: R1 acceptance self-check** against the spec's list (matrix covered, entries classified/evidenced/dispositioned, study reproduces, charter drafted, shortlist derived) — record the checklist result at the top of the register.
- [ ] **Step 6: Full verification and PR**

Run: `npm test && npm run calibrate:check && npm run hf6:verify:check && npm run hf6:gate:check && npm run hf6:prospective:check` — all green.
Run: `git push -u origin feat/realism-program`, then `gh pr create` with body = summary of the register (entry count by class/severity), the two decisions, the variance-study headline numbers, and a test plan (the commands above). Full-branch diff review: `git diff main...HEAD`.

---

## Self-review notes (completed at write time)

- **Spec coverage:** evidence stream 1 → Tasks 3–5; stream 2 → Task 6; stream 3 → Tasks 2+7; register → Tasks 1, 3–6, 8; charter + shortlist + acceptance → Task 8. The spec's archetype table is adjusted by verified data availability (Tauktae out, Biparjoy carries the Indian-coast cell; recorded in the matrix and charter appendix).
- **Placeholder scan:** stage times and register entry contents are deliberately produced BY the research tasks, not pre-written here; everything executable is fully specified.
- **Type consistency:** `temporal_stats`, `regional_shear_series`, `round6`, and the JSON shape are defined once (Task 7) and referenced nowhere else with different names; RGR numbering and capture naming defined once (Task 1).
