# Session — Gonu 2007 (`gonu`) — reference-only

Date: 2026-08-02. Operator: R1 controller session (inline).
Scenario URL: `<dev>/#env=gonu` → hindcast spawn `#lat=16.500&lon=67.100&month=5&seed=2007&env=gonu`
Run: hindcast init Jun 3 06:00 UTC (55 kt, org 0.484), 485 replay frames × 15 min,
ends Jun 8 07:00 UTC (dissipated inland/coast as 19 kt d*).

Sim milestones: start 0 · Jun 3 06:00Z · 55 kt; peak 159 · Jun 4 21:45Z ·
82 kt VSCS / 970 hPa; end 484 · Jun 8 07:00Z · 19 kt.

Stage frames (picked at MODIS Aqua overpass ~09:30 UTC for fair pairing with
the observed references):

- organizing: frame 14 · 03 Jun 09:30Z · 61 kt (real ~60 kt — near-matched)
- nearpeak: frame 110 · 04 Jun 09:30Z · 73 kt (real ~125–140 kt)
- omanapproach: frame 302 · 06 Jun 09:30Z · 29 kt dd* (real ~90 kt off Muscat)
- decay: frame 398 · 07 Jun 09:30Z · 25 kt d* (real ~60 kt at Iran landfall)

Captures: `captures/gonu/<stage>-sim-{ir,vis}.webp` (sim, both channels) +
`captures/gonu/<stage>-obs.webp` (observed reference).

Methodology note: the sim keeps Gonu alive for a realistic 5-day span (the
only one of the three Task 5 storms not to collapse outright) but the
intensity lane underdoes the whole arc — peak 82 kt vs ~140 kt real, and the
storm is a 29 kt remnant depression at the hour the real super cyclone was
brushing Muscat at ~90 kt. Frozen-lane skill, recorded for RGR-014's
lifecycle-ratio metric, not re-litigated per stage below. Morphology
comparisons are lifecycle-stage vs lifecycle-stage, and intensity-mismatched
frames are read qualitatively only.

## Observed-side source

External (in-app Meteosat archive starts 2020-08-01): NASA Worldview
snapshot API (`wvs.earthdata.nasa.gov`), layer
`MODIS_Aqua_CorrectedReflectance_TrueColor`, dates 2007-06-03 / -04 / -06 /
-07, BBOX 15–27N 50–70E (the app domain), 1560×936. Aqua overpass over the
basin is ~09:30–10:00 UTC; the daily composite is the overpass snapshot, so
time matching is ±~1 h. Public domain (NASA imagery guidelines); attribution:
"NASA Worldview / MODIS Aqua". Accessed 2026-08-02. Note these are
visible-band true-color references; the sim's IR and VIS captures are both
provided, and channel difference is accounted for in the observations below.

## Stage notes

### organizing (Jun 3 · sim 61 kt vs real ~60 kt — near-matched)
- real shows / sim lacks: a broad asymmetric convective mass with cirrus
  streaming, embedded in basin-wide June cloud cover.
- sim shows / real lacks: the standard concentric ring-and-gauze archetype at
  the same intensity.
- register entries: RGR-001, RGR-003, RGR-006 evidence generalizes.

### nearpeak (Jun 4 · sim 73 kt vs real ~125–140 kt)
- real (obs, near peak): compact near-annular white CDO with a clear pinhole
  eye, sharp shield edge, a single long comma band to the SE, cirrus plume
  streaming N/NE across the whole NE basin.
- sim: larger-footprint diffuse vortex — gauze disc, deep-red core mass,
  smooth bands, dotted range rings, no eye rendered at 73 kt in this frame.
- size nuance for RGR-013: real Gonu near peak is COMPACT/annular; the sim's
  total footprint at 73 kt is comparable to or larger than the real shield.
  The Biparjoy matched-intensity size deficit does not repeat here — the
  size relationship is storm-regime-dependent, which is exactly what the
  cold-top-area-vs-intensity metric must resolve.
- register entries: RGR-004, RGR-005, RGR-010, RGR-013 (nuance).

### omanapproach (Jun 6 · sim 29 kt dd* vs real ~90 kt off Muscat)
- real: the shield sits over the Gulf of Oman/NE Oman with the core just off
  Muscat; textured monsoon cloud fills the SE basin.
- sim: a faded remnant swirl far SE of Oman — the sim never brings a severe
  storm anywhere near the coast. Lifecycle divergence (RGR-014 lifecycle-ratio
  evidence), not a per-frame morphology comparison.

### decay (Jun 7 · sim 25 kt d* vs real ~60 kt at Iran landfall)
- real: still a coherent compact swirl with a visible low-level center in the
  Gulf of Oman at the Iran coast.
- sim: detached gauze remnants with concentric-ring gap geometry (RGR-009
  pattern, third storm).

## Session verdict

Gonu generalizes the register rather than adding to it: the one-archetype
problem (RGR-003/006), band and canopy texture (RGR-004/010), and the decay
bullseye (RGR-009) all repeat in a pre-2020 severe storm. The two sharpest
new facts: at 73 kt this sim frame renders no eye while RGR-002's other
evidence has eyes appearing at 58 kt (eye logic is inconsistent, not merely
early), and the near-peak size comparison inverts Biparjoy's — real severe
Arabian Sea storms can be compact and annular, so RGR-013's metric must be
intensity-binned rather than a blanket "too small".
