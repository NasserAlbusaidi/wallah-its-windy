# HF-7 realism charter

Source: `docs/realism-gap-register.md` (R1, Tasks 1-8) and
`calibration/realism/env-variance.json` (Task 7). Written 2026-08-02.

## Purpose

This document is a charter. It is explicitly **not** a commitment to run
HF-7. It collects every register entry the R1 realism program could not
close inside its presentation-only track, plus the one-shot climate-variance
study that quantifies why one of those gaps exists. Closing anything listed
here means touching `src/sim.ts`, `src/structure.ts`, a frozen acceptance
contract, or a sealed cohort — all explicitly out of scope for R1/R2/R3 by
design (`docs/superpowers/specs/2026-07-30-realism-program-design.md`,
"Non-goals and boundaries": "No change to `src/sim.ts`, `src/structure.ts`,
calibrated constants, frozen acceptance files, or sealed cohorts."). Whether
and when to actually run a future HF-7 phase is a separate decision for the
repo owner, informed by this charter; this document does not make that call
and proposes no timeline.

## Data-side gaps

### RGR-011 — no event-aligned upper-level analysis

Event replays sample a climatology-only `upper.bin`; layer 9 in the Shaheen
replay reports "no aligned upper-level analysis for this event" verbatim.
Cirrus-canopy banding and outflow asymmetry (RGR-010, presentation-class and
already dispositioned close-now) are mechanistically downstream of the
200 hPa flow (Kawashima 2021,
`docs/research/realism/literature-anchors.md` §3), so any event-mode canopy
fix can only be data-grounded, not merely rendered, once an event-aligned
upper-wind sidecar exists. This is a bake-side acquisition question, not a
rendering one — rough cost M ("bake-side sidecar per event", per the
register).

### Related data-side decisions

Two decisions already recorded in the register's Decisions section bound
future data-side work adjacent to this gap:

- **D1 (IMERG acquisition).** GPM IMERG was chosen as R2's observed
  rain-truth reference (open-ocean coverage via satellite retrieval, Final
  Run ~3.5-month latency tier appropriate for archival/hindcast sessions).
  The decision is resolved; acquiring and baking it is not — that is a
  data-side work item for R2's harness, separate from RGR-011's upper-wind
  gap but the same category of work (a new baked observed reference).
- **D2 (EUMETSAT derived-statistics rule).** EUMETSAT's Terms of Use are not
  clearly licence-clean for raw-frame commits, so R2's harness must ship
  EUMETSAT-derived comparisons as derived statistics plus a provenance
  manifest, never new raw frames.
  **Open item flagged for the repo owner:** 11 raw EUMETSAT SEVIRI frames
  were already committed to this public repository before D2 was decided —
  `docs/research/realism/captures/shaheen/*-obs.webp` (6 files) and
  `docs/research/realism/captures/biparjoy/*-obs.webp` (5 files) — under
  the general Terms of Use's personal/non-commercial default, which is not
  clearly licence-clean. Resolving this (seek EUMETSAT authorization,
  confirm whether the >=1h-latency Data Policy tier actually clears it, or
  replace the files with derived-only artifacts) is follow-up work outside
  R1's scope. This charter records the exposure; it does not resolve it.

## Physics-side gaps

### RGR-014 — event-mode hindcast lifecycle collapse

Three of five event hindcasts die prematurely against their real
lifecycles: Biparjoy dissipates 25.5 h after a matched 70 kt init (lifetime
ratio ~0.15 against the storm's real ~6 more days to Gujarat landfall),
Kyarr dies in 67 h (ratio ~0.4, erasing the recurve and dissipation
stages), and Ashobaa dies in 18.75 h (ratio ~0.16). Gonu's duration is
roughly right but its arc is hollow (82 kt sim peak vs ~140 kt real). This
is the frozen intensity lane — never fixable by a presentation wave — and
the register dispositions it `hf7-charter` accordingly.

Mechanism: `SHEAR_THRESHOLD_MS` (14 m/s) and `SHEAR_K_KT_PER_H_PER_MS`
(0.45 kt/h per m/s) in `src/sim.ts` are calibrated empirically against
env.bin's **monthly-mean** shear distribution, documented in the
constant's own comment:

> Deep-layer shear below this (m/s) does no harm. The classic instantaneous
> onset is ~10 m/s, but env.bin's per-year planes carry |V200 - V850| of
> MONTHLY-MEAN winds — smoother than any instantaneous shear (a vector mean
> under-counts variability) ... The constants are therefore calibrated
> EMPIRICALLY against the shipped field's distribution.

Event bins step their fields at 3-hourly resolution — much closer to
instantaneous reality than a monthly mean. The env-variance study
(quantified below) shows the genesis-belt shear distribution behind each
monthly plane has a p95 running 1.1-2.0x its mean, and for June — Biparjoy's
month — 2019/2021/2023 p95 values of 29.07, 31.03, and 35.36 m/s against
means of 19.04, 22.60, and 22.20 m/s. Applying `SHEAR_K_KT_PER_H_PER_MS` at
a p95 excursion rather than the mean roughly doubles to triples the intended
weakening rate: at the 2023 June mean (22.20 m/s) the shear term is
0.45 * (22.20 - 14) = 3.69 kt/h; at that same month's p95 (35.36 m/s) it is
0.45 * (35.36 - 14) = 9.61 kt/h. A constant calibrated to the mean, exposed
to inputs that spend meaningful time near the tail, over-weakens
shear-resistant storms — exactly the failure mode in the three collapsed
hindcasts. (This is an illustrative order-of-magnitude reading of the
constants against the closest available variance numbers, not a per-event
replay diagnostic — the events themselves are specific storms in specific
years, not the ERA5 2019/2021/2023 variance sample.)

This is squarely HF-2B territory in ROADMAP.md: HF-2B's stated scope is to
"replace scalar shear and humidity penalties with a vector-aware
ventilation treatment," to "sample environmental humidity and shear around
the vortex rather than relying on a single center cell," and to "make
organization respond to sustained favorable/adverse environments with
physically bounded memory rather than instant threshold changes" — all
directly responsive to a scalar, monthly-mean-calibrated threshold meeting
sub-monthly reality. HF-2C's wind/pressure/size closure work
(`src/sim.ts` intensity-pressure coupling, RMW, wind radii) is adjacent but
secondary here; the primary mechanism is HF-2B's. Note that HF-2 was
already implemented once and rejected without changing thresholds
(`calibration/hf2-acceptance.json`); its experimental parameters remain in
`src/sim.ts` as `HF2_EXPERIMENTAL_INTENSITY_PARAMETERS` for verification
reproducibility only, not as a starting point HF-7 could reuse
unexamined — that candidate was itself tuned against the same monthly-mean
distribution this charter documents as insufficient.

## Variance-study numbers

Source: `calibration/realism/env-variance.json`
(`sourceTag: "ERA5-6H-REALISM-2019-2021-2023"`), generated by
`bake/realism_env_variance.py`; full tables including the full-domain
region in `docs/research/realism/env-variance-study.md`. Each cell is the
6-hourly regional-mean series' `mean +/- std (p95)` for that month, in the
genesis belt (lat <= 19 N).

### Deep-layer shear (m/s) — genesis belt

| month | 2019 | 2021 | 2023 |
| --- | --- | --- | --- |
| 05 | 15.21 +/- 6.41 (p95 25.33) | 14.47 +/- 6.79 (p95 29.02) | 11.83 +/- 4.31 (p95 20.52) |
| 06 | 19.04 +/- 8.38 (p95 29.07) | 22.60 +/- 6.47 (p95 31.03) | 22.20 +/- 8.70 (p95 35.36) |
| 07 | 34.02 +/- 4.79 (p95 42.07) | 35.27 +/- 3.59 (p95 41.99) | 34.40 +/- 2.97 (p95 38.61) |
| 08 | 30.48 +/- 7.89 (p95 43.22) | 29.29 +/- 4.62 (p95 35.64) | 26.24 +/- 5.55 (p95 35.45) |
| 09 | 24.29 +/- 7.12 (p95 34.08) | 23.08 +/- 3.04 (p95 26.82) | 20.13 +/- 4.35 (p95 25.87) |
| 10 | 11.34 +/- 4.20 (p95 17.73) | 10.89 +/- 4.50 (p95 19.80) | 12.55 +/- 5.43 (p95 22.08) |
| 11 | 24.82 +/- 8.75 (p95 37.47) | 20.47 +/- 5.62 (p95 31.02) | 23.37 +/- 3.94 (p95 29.82) |

### 600/700 hPa RH (%) — genesis belt

| month | 2019 | 2021 | 2023 |
| --- | --- | --- | --- |
| 05 | 24.56 +/- 9.88 (p95 39.71) | 31.09 +/- 10.72 (p95 53.18) | 23.91 +/- 6.85 (p95 37.89) |
| 06 | 39.87 +/- 8.83 (p95 56.80) | 28.43 +/- 5.12 (p95 37.13) | 39.00 +/- 9.63 (p95 59.30) |
| 07 | 46.19 +/- 11.62 (p95 68.98) | 54.24 +/- 17.20 (p95 84.68) | 51.48 +/- 13.71 (p95 74.84) |
| 08 | 48.18 +/- 12.78 (p95 70.92) | 38.69 +/- 5.59 (p95 50.85) | 38.85 +/- 4.75 (p95 45.21) |
| 09 | 47.89 +/- 7.16 (p95 59.54) | 50.43 +/- 8.61 (p95 64.06) | 36.55 +/- 7.77 (p95 51.04) |
| 10 | 36.74 +/- 9.82 (p95 54.59) | 28.06 +/- 19.55 (p95 61.48) | 24.42 +/- 10.59 (p95 50.24) |
| 11 | 26.75 +/- 12.95 (p95 45.52) | 23.89 +/- 10.85 (p95 47.63) | 23.70 +/- 11.97 (p95 40.73) |

### SST (C) — genesis belt

| month | 2019 | 2021 | 2023 |
| --- | --- | --- | --- |
| 05 | 29.56 +/- 0.34 (p95 30.19) | 29.97 +/- 0.25 (p95 30.32) | 30.41 +/- 0.44 (p95 30.84) |
| 06 | 29.35 +/- 0.77 (p95 30.42) | 28.32 +/- 0.65 (p95 29.34) | 29.43 +/- 1.12 (p95 31.03) |
| 07 | 27.04 +/- 0.57 (p95 28.14) | 27.06 +/- 0.65 (p95 28.09) | 26.74 +/- 0.56 (p95 27.53) |
| 08 | 25.70 +/- 0.38 (p95 26.16) | 25.96 +/- 0.31 (p95 26.47) | 26.23 +/- 0.44 (p95 26.80) |
| 09 | 26.60 +/- 0.58 (p95 27.66) | 26.79 +/- 0.47 (p95 27.71) | 27.81 +/- 0.32 (p95 28.39) |
| 10 | 28.40 +/- 0.35 (p95 28.91) | 28.29 +/- 0.21 (p95 28.50) | 28.89 +/- 0.25 (p95 29.30) |
| 11 | 27.42 +/- 0.24 (p95 27.80) | 27.70 +/- 0.25 (p95 28.06) | 28.69 +/- 0.22 (p95 28.96) |

Recomputed directly from `calibration/realism/env-variance.json` (all 21
year/month cells per region): shear's genesis-belt std/mean ratio ranges
0.09x (2023-07) to 0.47x (2021-05), landing in the 0.3-0.5 band for 9 of
those 21 cells (2019-05/06/10/11, 2021-05/10, 2023-05/06/10) rather than
"most" months. Its p95/mean ratio ranges 1.12x (2023-07) to 2.00x
(2021-05) in the genesis belt, and 1.09x (2023-11) to 1.88x (2021-10) in
the full domain — belt and domain are two different regions and neither
matches the belt's own `maxOverMean` (max/mean, a different ratio) peak
of 2.35x, also at 2021-05. Every one of these shear ratios is still far
larger than SST's (std/mean under 0.04 in every cell, both regions) — the
field driving the collapse mechanism is also the field env.bin's monthly
mean erases the most.

## Consequences

- **Recalibration is from scratch, not a tune.** Per the
  `SHEAR_THRESHOLD_MS` comment in `src/sim.ts`: "Recalibrate from scratch if
  the env source ever moves to daily/hourly fields." Any HF-7 physics
  candidate that samples sub-monthly shear/RH/SST forcing invalidates the
  existing monthly-mean-calibrated constants outright; it is new
  calibration work, not a parameter nudge.
- **A new sealed cohort is required, not the existing one.** ROADMAP.md's
  phase rules require tuning with development storms only, validation
  deciding acceptance, and — per the "Later" execution order —
  "Start any revised intensity candidate as a new versioned phase with a
  new development protocol and a newly sealed confirmation cohort." The
  existing HF-1/HF-6 sealed splits stay frozen; an HF-7 candidate is
  evaluated against its own newly sealed cohort, never the one used to
  reject HF-2/HF-3/HF-4/HF-6.
- **No frozen gate moves to accommodate this work.** `npm run
  calibrate:check` and the three HF-6 checks stay green throughout R1/R2/R3
  by construction, and stay the standard any future HF-7 candidate must
  clear or exceed, not relax.

## Appendix: Tauktae 2021 event-bin candidate

Tauktae 2021 (Indian-coast landfall archetype) has no baked event bin;
baking one was ruled outside R1's research scope
(`docs/superpowers/plans/2026-07-30-realism-r1-gap-register.md`
self-review notes: "Tauktae out, Biparjoy carries the Indian-coast cell").
Biparjoy 2023 currently carries the Indian-coast-landfall archetype cell in
the availability matrix instead, with the caveat that RGR-014's lifecycle
collapse removes its own landfall stage from event replay. Baking a
Tauktae event bin remains a candidate future data-side work item, not
scoped or scheduled by this charter.
