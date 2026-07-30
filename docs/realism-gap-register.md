# Realism gap register

Status: R1 in progress. Spec: docs/superpowers/specs/2026-07-30-realism-program-design.md
Every entry follows the schema in docs/research/realism/README.md.

## Data-availability matrix

| Archetype | Storm | Scenario | Observed side | Stages covered |
| --- | --- | --- | --- | --- |
| Severe, long-lived | Gonu 2007 | env=gonu | external reference (Meteosat in-app archive starts 2020-08-01) | pending |
| Severe, recurving | Kyarr 2019 | env=kyarr | external reference | pending |
| Oman landfall | Shaheen 2021 | env=shaheen | in-app paired | genesis, intensification, peak (IR+VIS), landfall, decay — done 2026-07-30 |
| Indian-coast landfall + weak sheared phase | Biparjoy 2023 | env=biparjoy | in-app paired | pending |
| Weak sheared system | Ashobaa 2015 | env=ashobaa | external reference | pending |

Tauktae 2021 is excluded: no event bin exists, and baking one is outside R1's
research scope. Candidate future work, recorded in the HF-7 charter appendix.

## Decisions

- D1 (pending, Task 6): observed rain reference over the open Arabian Sea.
- D2 (pending, Task 6): licence position for committed observed reference material.

## Entries

Evidence shorthand: `shaheen/<stage>` = the capture pair
`docs/research/realism/captures/shaheen/<stage>-{sim,obs}.webp`; session detail
in `docs/research/realism/sessions/shaheen.md`.

### RGR-001 — Environmental sky is empty; observed basin is never cloud-free
- subsystem: environment
- stage: all
- evidence: shaheen/genesis, shaheen/peak, shaheen/peak-vis — every observed
  IR/VIS frame carries monsoon/ITCZ cloud, cirrus streaks, and low-cloud fields
  across the whole domain; every sim frame renders the storm alone on black.
- description: the sim draws no environmental cloud at all. This is the single
  loudest realism tell in every pair, in both IR and VIS. The app already
  carries per-event mid-level RH and SST fields that could drive a labeled
  simulated environmental cloud proxy.
- class: presentation
- severity: high
- candidate metric: cloudy-area fraction (BT below a cirrus/low-cloud
  threshold) outside 3× the storm's outer radius, sim vs observed-frame
  climatology.
- rough cost: L
- disposition: close-now

### RGR-002 — Eye + closed eyewall appear far too early in intensity
- subsystem: ir-clouds
- stage: intensification, peak
- evidence: shaheen/intensification (sim: pinhole eye + solid annulus at
  58 kt; obs: eyeless asymmetric CDO), shaheen/peak (sim clean eye at 65 kt;
  obs: no eye at ~70 kt real intensity).
- description: the sim renders a clean circular eye and closed ring from
  ~58 kt. Real Arabian Sea storms at 55–75 kt overwhelmingly show an eyeless
  CDO; satellite eye clarity is a >90 kt phenomenon (to be anchored precisely
  by the literature task).
- class: presentation
- severity: high
- candidate metric: central BT contrast (eye-minus-ring) as a function of
  intensity, anchored to Dvorak/ADT eye-onset climatology.
- rough cost: M
- disposition: close-now

### RGR-003 — Core is radially symmetric regardless of shear; observed CDO is asymmetric at every stage
- subsystem: ir-clouds
- stage: all
- evidence: shaheen/intensification, shaheen/peak (obs coldest tops displaced
  NE of center throughout; sim cold tops perfectly centered/annular).
- description: the sim's cold-top field is rotationally symmetric at all
  times. The real storm's convection was displaced downshear its entire life.
  The runtime already computes a vector shear diagnostic (layer 8) that the
  cloud morphology never consumes.
- class: presentation
- severity: high
- candidate metric: cold-top centroid offset (distance and bearing) from the
  vortex center vs the shear vector, compared against the observed pairs.
- rough cost: M
- disposition: close-now

### RGR-004 — Spiral bands are smooth continuous ribbons; observed bands are beaded chains of cells
- subsystem: ir-clouds
- stage: intensification, peak, landfall
- evidence: shaheen/intensification (obs tail band = discrete convective
  beads with ragged stratiform fringe; sim bands = airbrushed ribbons with
  soft edges and evenly spaced embedded blobs).
- description: band-scale texture is the strongest "computer graphics" tell
  after the empty sky: real bands granulate into cells with sharp edges; sim
  bands read as smooth gradient ribbons.
- class: presentation
- severity: high
- candidate metric: high-spatial-frequency energy (or edge density) within
  band masks, sim vs observed.
- rough cost: L
- disposition: close-now

### RGR-005 — Cold-top palette saturates too cold at moderate intensity
- subsystem: ir-clouds
- stage: intensification, peak
- evidence: shaheen/peak (sim solid deepest-red ring at 65 kt; obs at matched
  time peaks in orange with only isolated colder cells).
- description: the sim's brightness-temperature proxy reaches the palette's
  coldest stops at intensities where the observed storm's tops are visibly
  warmer; the sim also concentrates its coldest values in an annulus that has
  no observed counterpart.
- class: presentation
- severity: medium
- candidate metric: BT-proxy histogram distance vs observed frames at matched
  intensity bins.
- rough cost: M
- disposition: close-now

### RGR-006 — Weak-stage morphology is a miniature mature vortex; real weak systems are displaced burst complexes
- subsystem: ir-clouds
- stage: genesis
- evidence: shaheen/genesis (obs: huge ragged multi-cluster burst displaced
  from the fix, more cold-top area than the sim's peak; sim: tidy concentric
  mini-swirl centered on the fix).
- description: below ~45 kt the sim scales down its mature-storm archetype.
  Real pre-cyclone systems have no vortical cloud signature at all — they are
  dominated by episodic asymmetric convective bursts.
- class: presentation
- severity: high
- candidate metric: cold-top area and centroid offset at fixed weak-intensity
  bins vs observed genesis frames.
- rough cost: L
- disposition: close-now

### RGR-007 — No diurnal cycle in the simulated cloud field
- subsystem: ir-clouds
- stage: all
- evidence: shaheen/genesis (obs 04:00 local nocturnal burst maximum; sim
  cloud field carries no local-time dependence anywhere in the run).
- description: tropical oceanic convection and the TC cirrus canopy pulse on
  a well-documented diurnal cycle. In event replays the sim knows real UTC,
  so a display-side diurnal modulation is possible without touching physics;
  the exact amplitude/phase anchor comes from the literature task.
- class: presentation
- severity: medium
- candidate metric: canopy extent / BT-proxy amplitude and phase binned by
  local solar time.
- rough cost: M
- disposition: close-now

### RGR-008 — Eyewall ring survives landfall unchanged
- subsystem: ir-clouds
- stage: landfall
- evidence: shaheen/landfall (sim: intact textbook annulus + clean eye with
  the center inland; obs comparison indirect due to the run's timing offset —
  literature-anchored).
- description: the sim's core cloud morphology shows no response to coastal
  crossing; real cores fill and the eye collapses rapidly over land.
- class: presentation
- severity: medium
- candidate metric: ring completeness / eye contrast vs hours-since-landfall.
- rough cost: M
- disposition: close-now

### RGR-009 — Decay renders a concentric "bullseye" ring artifact
- subsystem: ir-clouds
- stage: decay
- evidence: shaheen/decay (sim: shrunken orange blob inside a dark concentric
  ring gap plus detached gauze blobs; no observed decaying system shows
  concentric-ring geometry).
- class: presentation
- severity: medium
- candidate metric: A/B judgment; radial BT-proxy profile monotonicity in
  decay frames.
- rough cost: S
- disposition: close-now

### RGR-010 — Cirrus canopy edge is a clean circle; observed shield edges are ragged and streamed
- subsystem: ir-clouds
- stage: intensification, peak
- evidence: shaheen/intensification, shaheen/peak (sim gauze disc has a
  smooth circular outer boundary; observed shield is drawn out into streaks
  by the upper-level flow).
- class: presentation
- severity: medium
- candidate metric: canopy boundary raggedness (perimeter/area vs circle) and
  elongation vs the upper-wind direction where available.
- rough cost: M
- disposition: close-now

### RGR-011 — Event replays have no aligned upper-level analysis, so outflow/canopy asymmetry has no data source
- subsystem: environment
- stage: all (event scenarios)
- evidence: layer 9 in the shaheen replay reports "no aligned upper-level
  analysis for this event" (upper.bin is climatology-only by design).
- description: canopy streaming and outflow asymmetry (RGR-010) can only be
  driven correctly in event mode if event-aligned 200-hPa winds exist. That is
  a data acquisition/bake question, not a rendering one.
- class: data
- severity: medium
- candidate metric: n/a (data availability)
- rough cost: M (bake-side sidecar per event)
- disposition: hf7-charter

### RGR-012 — Simulated VIS ignores solar geometry
- subsystem: vis-clouds
- stage: peak
- evidence: shaheen/peak-vis (obs VIS0.6 at 15:45 local is dim and
  low-contrast with gray sea; sim VIS is uniformly bright white on black).
- description: the simulated daytime-visible product renders constant
  illumination; observed VIS brightness and contrast follow solar elevation,
  and the sea is never black in daylight.
- class: presentation
- severity: medium
- candidate metric: scene luminance vs solar zenith angle at capture times.
- rough cost: M
- disposition: close-now

## R2 metric shortlist

(populated by Task 8)
