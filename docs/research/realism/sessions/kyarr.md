# Session — Kyarr 2019 (`kyarr`) — reference-only

Date: 2026-08-02. Operator: R1 controller session (inline).
Scenario URL: `<dev>/#env=kyarr` → hindcast spawn `#lat=16.900&lon=68.500&month=9&seed=20193&env=kyarr`
Run: hindcast init Oct 26 21:00 UTC (110 kt ESCS, org 0.704, 944 hPa),
268 replay frames × 15 min, ends Oct 29 15:45 UTC (20 kt d*).

Sim milestones: start 0 · Oct 26 21:00Z · 110 kt; peak 5 · Oct 26 22:15Z ·
110 kt; end 267 · Oct 29 15:45Z · 20 kt.

Stage frames (MODIS Aqua overpass ~09:30 UTC):

- peakday: frame 50 · 27 Oct 09:30Z · 103 kt ESCS (real ~125–130 kt — the
  highest-intensity sim capture in the program so far)
- middecay: frame 146 · 28 Oct 09:30Z · 70 kt (real ~110 kt, slow WSW crawl)
- end: frame 267 · 29 Oct 15:45Z · 20 kt d* (IR only; real Kyarr was still a
  ~90 kt VSCS at this hour and lived to ~Nov 1–2)

Captures: `captures/kyarr/peakday-sim-{ir,vis}.webp`,
`middecay-sim-{ir,vis}.webp`, `end-sim-ir.webp` + observed references
`peak-obs.webp` (Oct 27), `recurve-obs.webp` (Oct 30),
`dissipation-obs.webp` (Nov 1).

Methodology note — second outright lifecycle collapse: initialized at
110 kt from the real Oct 26 state, the sim run is over in 67 h while the
real storm's post-peak decay took ~6 more days. The recurve (Oct 30) and
dissipation (Nov 1) observed references therefore have NO sim counterpart —
those matrix cells are not coverable in event replay (RGR-014, second
example). Lifetime ratio ≈ 0.4.

## Observed-side source

External: NASA Worldview snapshot API, layer
`MODIS_Aqua_CorrectedReflectance_TrueColor`, dates 2019-10-27 / -30 /
2019-11-01, BBOX 15–27N 50–70E, 1560×936, overpass ~09:30–10:00 UTC. Public
domain, attribution "NASA Worldview / MODIS Aqua". Accessed 2026-08-02.
Visible-band references; channel difference accounted for in the notes.

## Stage notes

### peakday (Oct 27 · sim 103 kt vs real ~125–130 kt)
- real (obs): textbook super cyclone — huge circular shield with a crisp
  PINHOLE EYE, banded shield texture, long feeder band from the south,
  cirrus streaming over the NE basin toward Pakistan. Notably the WESTERN
  half of the domain is largely clear post-monsoon ocean.
- sim (IR): a nearly featureless SOLID deep-red disc — no eye, no ring
  contrast, no radial structure, entire core at the palette's coldest stop.
  The sim renders eyes at 58–77 kt (Shaheen, Biparjoy) but none at 103 kt:
  eye logic is wrong in both directions (RGR-002), and the whole-core
  saturation is RGR-005's strongest example.
- register entries: RGR-002, RGR-005, and RGR-001 nuance (see verdict).

### middecay (Oct 28 · sim 70 kt vs real ~110 kt)
- sim: the disc shrinks and develops the familiar concentric ring + smooth
  band arms; still perfectly symmetric while weakening rapidly.
- real (nearest reference Oct 30): still a compact eye-bearing cyclone.

### end (Oct 29 15:45Z · sim 20 kt d*)
- sim: gray pinwheel remnant with ring-gap geometry (RGR-009, fourth storm).
- real: a ~90 kt VSCS at the same hour.

## Session verdict

Kyarr contributes the program's highest-intensity sim frame and with it the
cleanest statement of the core-representation problem: at ESCS intensity the
sim's IR is a saturated structureless disc where the real storm is a
pinhole-eye annulus (RGR-002 + RGR-005 jointly). It is also the second
outright lifecycle collapse (RGR-014). And it forces an honest nuance into
RGR-001: the post-monsoon October basin west of the storm really is largely
cloud-free — the empty-sky gap is seasonal, and the background-cloudiness
metric must be month-conditioned, not a constant.
