# Realism gap register

Status: R1 in progress. Spec: docs/superpowers/specs/2026-07-30-realism-program-design.md
Every entry follows the schema in docs/research/realism/README.md.

## Data-availability matrix

| Archetype | Storm | Scenario | Observed side | Stages covered |
| --- | --- | --- | --- | --- |
| Severe, long-lived | Gonu 2007 | env=gonu | external reference (Meteosat in-app archive starts 2020-08-01): NASA Worldview MODIS Aqua | organizing (near-matched 61 kt), nearpeak, omanapproach, decay — done 2026-08-02. Sim lives the full 5 days but decays days early (29 kt at the real ~90 kt Muscat brush). |
| Severe, recurving | Kyarr 2019 | env=kyarr | external reference: NASA Worldview MODIS Aqua | peakday (103 kt sim, highest in program), middecay, end — done 2026-08-02. Sim collapses in 67 h (real ~7 days): recurve and dissipation cells NOT coverable in event replay (RGR-014). |
| Oman landfall | Shaheen 2021 | env=shaheen | in-app paired | genesis, intensification, peak (IR+VIS), landfall, decay — done 2026-07-30 |
| Indian-coast landfall + weak sheared phase | Biparjoy 2023 | env=biparjoy | in-app paired | init (matched 70 kt), peak, sheared-mid, decay-end (IR) + sheared VIS — done 2026-08-01. Sim hindcast collapses 25.5 h after init, so no sim landfall or long weak phase exists; the Gujarat-landfall cell is NOT coverable in event replay (see RGR-014). |
| Weak sheared system | Ashobaa 2015 | env=ashobaa | external reference: NASA Worldview MODIS Aqua | genesis (matched 38 kt), end — done 2026-08-02. Sim collapses in 18.75 h (real ~6 days): best-organized and decaying cells NOT coverable in event replay (RGR-014). |

Tauktae 2021 is excluded: no event bin exists, and baking one is outside R1's
research scope. Candidate future work, recorded in the HF-7 charter appendix.

## Decisions

- D1 (pending, Task 6): observed rain reference over the open Arabian Sea.
- D2 (pending, Task 6): licence position for committed observed reference material.

## Entries

Evidence shorthand: `shaheen/<stage>` / `biparjoy/<stage>` = the capture pair
`docs/research/realism/captures/<storm>/<stage>-{sim,obs}.webp`; session detail
in `docs/research/realism/sessions/<storm>.md`. Reference-only storms
(gonu, kyarr, ashobaa) use `<stage>-sim-{ir,vis}.webp` for the sim side and
`<stage>-obs.webp` for the external NASA Worldview reference.

### RGR-001 — Environmental sky is empty; observed basin is never cloud-free
- subsystem: environment
- stage: all
- evidence: shaheen/genesis, shaheen/peak, shaheen/peak-vis — every observed
  IR/VIS frame carries monsoon/ITCZ cloud, cirrus streaks, and low-cloud fields
  across the whole domain; every sim frame renders the storm alone on black.
  biparjoy/init, biparjoy/sheared-vis — first paired evidence of the
  cloud-memory debris deck firing in a moist June environment: a handful of
  dim amorphous blobs appear, but they read as smudges against an observed
  basin filled with structured, textured cloud fields. Seasonal nuance from
  kyarr/peakday: the observed post-monsoon October basin WEST of the storm
  is largely cloud-free — background cloudiness is strongly month-dependent,
  so the metric must be conditioned on month, not a constant target.
- description: the sim draws almost no environmental cloud. This is the single
  loudest realism tell in every pair, in both IR and VIS. The app already
  carries per-event mid-level RH and SST fields that could drive a labeled
  simulated environmental cloud proxy; the existing debris deck proves the
  plumbing exists but its density, structure, and texture are far short.
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
  obs: no eye at ~70 kt real intensity). biparjoy/init — the matched-intensity
  pair (sim 70 kt vs real ~70 kt at the same instant): observed IR shows an
  unbroken cold CDO with no eye; the sim draws a closed annulus + pinhole eye.
  kyarr/peakday — the inverse failure: at 103 kt ESCS the sim renders a solid
  eyeless disc while the real ~125–130 kt Kyarr shows a crisp pinhole eye;
  gonu/nearpeak repeats it at 73 kt (no eye in that frame). Eye rendering is
  inconsistent in BOTH directions, not merely early.
- description: the sim renders a clean circular eye and closed ring from
  ~58 kt in some storms and no eye at all at 73–103 kt in others. Real
  Arabian Sea storms at 55–75 kt overwhelmingly show an eyeless CDO;
  satellite eye clarity is a >90 kt phenomenon (to be anchored precisely
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
  biparjoy/sheared-mid — the self-inconsistency frame: the sim's own HUD
  reports 20.7 m/s deep-layer shear and the intensity lane is actively
  weakening the storm because of it, yet the rendered cloud stays perfectly
  concentric. biparjoy/init..decay-end — the real fix sits on the NE EDGE of
  its CDO in all four observed frames.
- description: the sim's cold-top field is rotationally symmetric at all
  times. The real storm's convection was displaced downshear its entire life.
  The runtime already computes a vector shear diagnostic (layer 8) that the
  cloud morphology never consumes — even while that same diagnostic is
  driving the intensity response.
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
  soft edges and evenly spaced embedded blobs). biparjoy/peak,
  biparjoy/sheared-mid (obs band complex arcing NW to the Oman coast is a
  15°-long chain of discrete beaded cells; sim bands stay smooth ribbons).
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
  time peaks in orange with only isolated colder cells). Counter-evidence
  nuance from biparjoy/init: a real VSCS-transition CDO does hit extensive
  deepest-red, so the saturation gap is intensity- and storm-dependent, not
  universal — the metric must bin by intensity. kyarr/peakday — strongest
  example: at 103 kt the sim's entire core is a structureless disc at the
  palette's coldest stop, zero internal texture or radial gradient, while
  the real shield shows banded texture and an eye.
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
  mini-swirl centered on the fix). biparjoy/decay-end (sim at 19 kt
  "dissipated" still renders an organized concentric pinwheel).
  ashobaa/genesis — second matched-intensity pair (sim 38 kt vs real
  ~35–40 kt): observed is a ragged multi-lobed burst mass with no visible
  center; sim is a tidy grayscale pinwheel with perfect spiral arms.
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
  concentric-ring geometry). biparjoy/decay-end (second storm: the dissipated
  state is a grayscale pinwheel with concentric ring gaps and detached
  orange patches — same synthetic geometry). gonu/decay, kyarr/end (third and
  fourth storms). ashobaa/genesis — the ring-gap geometry also appears in a
  LIVE 38 kt storm, so the artifact is not decay-specific.
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
  by the upper-level flow). biparjoy/init, biparjoy/peak (observed cirrus
  streams NE past Gwadar/Karachi; sim disc edge stays round).
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
  biparjoy/sheared-vis (13:30 local: obs is a photographic scene — sunlit
  land, dark-gray sea, shield with overshooting-top texture and shadows, a
  distinct black eye pit; sim is a flat, uniformly lit white swirl with a
  shallow dimple on black sea).
- description: the simulated daytime-visible product renders constant
  illumination; observed VIS brightness and contrast follow solar elevation,
  and the sea is never black in daylight.
- class: presentation
- severity: medium
- candidate metric: scene luminance vs solar zenith angle at capture times.
- rough cost: M
- disposition: close-now

### RGR-013 — Storm cloud shield is several times too small at matched intensity
- subsystem: ir-clouds
- stage: all
- evidence: biparjoy/init — the one matched-intensity pair so far (sim 70 kt
  vs real ~70 kt at the same valid time): the observed CDO plus attached
  shield spans roughly 6–8° of the domain; the sim's entire cloud system
  (gauze + ring + bands) spans about 3°. biparjoy/peak repeats it at 77 kt.
  Counter-nuance from gonu/nearpeak: real near-peak Gonu is COMPACT/annular
  and the sim footprint there is comparable or larger — the size relation is
  regime-dependent, so the metric must be intensity-binned, not a blanket
  "too small".
- description: independent of morphology (RGR-002/003/006), the sim's total
  cloud footprint per unit intensity is far too small. Shaheen pairs hinted
  at this but always with an intensity mismatch caveat; the Biparjoy init
  frame removes the caveat. `outerSizeKm` clamps at 420 km, and the canopy
  scale is tied to it — a real Arabian Sea VSCS shield readily exceeds
  1000 km across.
- class: presentation
- severity: high
- candidate metric: cold-top area (BT-proxy below threshold) binned by
  intensity, sim vs observed frames.
- rough cost: M
- disposition: close-now

### RGR-014 — Event-mode hindcast lifecycle collapse removes whole stages from event replays
- subsystem: environment (event scenarios)
- stage: all (event scenarios)
- evidence: sessions/biparjoy.md — hindcast init Jun 9 18:00 UTC at 70 kt
  (the storm's real state); the sim dissipates the storm 25.5 h later under
  a self-sampled 20.7–26.1 m/s deep-layer shear, while the real Biparjoy
  intensified to ~85 kt in the same window and lived 6 more days to its
  Gujarat landfall. sessions/kyarr.md — 110 kt ESCS init dies in 67 h vs ~7
  real days (ratio ≈ 0.4), erasing the recurve and dissipation stages.
  sessions/ashobaa.md — 35 kt init dies in 18.75 h vs ~6 real days
  (ratio ≈ 0.16). sessions/gonu.md — duration roughly right but the arc is
  hollow: peak 82 kt vs ~140 kt, a 29 kt remnant at the hour of the real
  ~90 kt Muscat brush. Three of five event replays lose whole lifecycle
  stages.
- description: the shear-response constants (`SHEAR_THRESHOLD_MS`,
  `SHEAR_K_KT_PER_H_PER_MS`) are calibrated against env.bin's monthly-mean
  shear distribution (documented in src/sim.ts and CLAUDE.md); event bins
  step their fields at 3 h, so event replays apply a monthly-mean-calibrated
  response to much spikier inputs and over-weaken shear-resistant storms.
  Consequence for this program: archetype cells that depend on late
  lifecycle stages (Indian-coast landfall, long sheared-weak phase) cannot
  be captured in event replay at all. This is the frozen intensity lane —
  never fixable by a presentation wave.
- class: physics
- severity: high
- candidate metric: hindcast lifetime ratio (sim run length / real
  best-track length) per event scenario.
- rough cost: L (to measure) — the fix itself is a gated recalibration,
  out of R-program scope
- disposition: hf7-charter

## R2 metric shortlist

(populated by Task 8)
