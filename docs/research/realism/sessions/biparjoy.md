# Session — Biparjoy 2023 (`biparjoy`)

Date: 2026-08-01. Operator: R1 controller session (inline).
Scenario URL: `<dev>/#env=biparjoy` → hindcast spawn `#lat=16.200&lon=67.400&month=5&seed=2023&env=biparjoy`
Run: hindcast init Jun 9 18:00 UTC (70 kt, org 0.544), 103 replay frames × 15 min,
ends Jun 10 19:30 UTC.

Stage frames used (replay frame · model valid · sim wind · sim shear diag):

- init: frame 0 · 09 Jun 18:00 UTC · 70 kt / 977 hPa
- peak: frame 13 · 09 Jun 21:15 UTC · 77 kt / 972 hPa (milestone button)
- sheared-mid: frame 48 · 10 Jun 06:00 UTC · 66 kt weakening · shear 20.7 m/s
- sheared-vis: frame 60 · 10 Jun 09:00 UTC · 58 kt (~13:30 local solar, VIS pair)
- decay-end: frame 102 · 10 Jun 19:30 UTC · 19 kt d* / 1007 hPa · shear 26.1 m/s

Methodology note — the run collapses: the sim kills Biparjoy 25.5 h after
init (dissipated by Jun 10 19:30 UTC) under a self-sampled 20.7–26.1 m/s
deep-layer shear, while the real storm intensified through this exact window
(~85 kt VSCS by Jun 11) and lived to its Gujarat landfall on Jun 15. The
intensity/lifecycle offset itself is the frozen intensity lane's known skill
problem and is NOT logged as a realism gap — but it has two session
consequences: (1) no sim landfall or long sheared-weak phase exists to
capture, so the Gujarat-landfall matrix cell is not coverable in event replay
(RGR-014); (2) all pairs after init compare a weakening sim against a
strengthening real storm — the init pair (70 kt vs ~70 kt real) is the one
matched-intensity comparison and the most diagnostic frame this program has
produced so far.

Capture framing note: captures are the bare `#gl-canvas` with all UI chrome
hidden (`visibility: hidden` on `.chrome`, `#hint-chips`, `#progress`), taken
at a 1500×1250 viewport, because the storm sits in the domain's bottom-right
corner (16.2N 67.4E in the fixed 50–70E/15–27N view) under the UI panels.
Observed-side provenance is therefore recorded here per frame instead of
being visible in-image.

## Observed-side source

In-app paired: Meteosat-9 IODC · SEVIRI IR10.8 μm (all stages) and VIS0.6 μm
(sheared-vis) via EUMETSAT EUMETVIEW; provenance label read from the
satellite desk per frame, e.g. "Meteosat-9 IODC · SEVIRI IR10.8 μm ·
09 Jun 2023, 18:00 UTC". All five observed frames time-matched exactly to
the model valid time.
Observed-side imagery © EUMETSAT 2023, used with attribution; licence
position and the standing derived-statistics rule are recorded in the
register's D2 decision.

## Stage notes

### init (09 Jun 18:00 UTC · sim 70 kt vs real ~70 kt — matched intensity)
- captures: captures/biparjoy/init-{sim,obs}.webp
- real shows / sim lacks: a cold central overcast spanning roughly 6–8° of
  the SE domain with the working-best-track fix at its NE EDGE — essentially
  all deep convection displaced one side of the center; streaming textured
  cirrus filling the eastern basin up past Gwadar/Karachi; monsoon cloud in
  the SW corner. At the SAME intensity the observed cloud system is several
  times the sim's total cloud footprint.
- sim shows / real lacks: a tidy ~3° concentric vortex — closed red eyewall
  annulus with pinhole eye at 70 kt, centered gauze disc, one thin band arm.
  First paired evidence of the environmental debris deck: a handful of dim
  amorphous yellow-brown blobs over the basin — present, but they read as
  smudges, not the structured cloud fields the observed frame carries
  everywhere.
- candidate register entries: RGR-013 (new), RGR-001, RGR-002, RGR-003

### peak (09 Jun 21:15 UTC · sim 77 kt / real ~70–75 kt)
- captures: captures/biparjoy/peak-{sim,obs}.webp
- real shows / sim lacks: the giant CDO persists with the fix still on its NE
  edge; a long ragged band of discrete beaded orange cells arcs NW toward
  Masirah/Duqm; granular texture through the whole shield.
- sim shows / real lacks: the same corner vortex with a cleaner red annulus +
  dotted range ring; smooth soft-edged bands; circular gauze boundary.
- candidate register entries: RGR-013, RGR-003, RGR-004, RGR-010

### sheared-mid (10 Jun 06:00 UTC · sim 66 kt weakening · sim's own shear diag 20.7 m/s)
- captures: captures/biparjoy/sheared-mid-{sim,obs}.webp
- the key self-inconsistency frame: the sim's HUD reports 20.7 m/s deep-layer
  shear and the intensity lane is actively weakening the storm because of it,
  yet the rendered cloud field remains perfectly radially organized around
  the fix — the morphology never consumes the shear vector the model itself
  computes (layer 8).
- real shows: coldest tops still displaced SW of the fix, the huge beaded
  band complex reaching the Oman coast, basin-wide cloud.
- candidate register entries: RGR-003 (strongest evidence yet), RGR-004

### sheared-vis (10 Jun 09:00 UTC ≈ 13:30 local · sim 58 kt / real ~80 kt · VIS pair)
- captures: captures/biparjoy/sheared-vis-{sim,obs}.webp
- real shows / sim lacks: photographic scene — sunlit gray-toned land, dark
  but not black sea, storm shield with overshooting-top texture and shadows,
  a distinct black eye pit in VIS, streaming cirrus mid-basin.
- sim shows / real lacks: flat uniform illumination; smooth white swirl with
  a shallow dimple for the eye; black sea; environmental blobs read as
  stains. No solar-elevation dependence of scene luminance or contrast.
- candidate register entries: RGR-012, RGR-001

### decay-end (10 Jun 19:30 UTC · sim 19 kt dissipated / real ~85 kt VSCS)
- captures: captures/biparjoy/decay-end-{sim,obs}.webp
- sim shows / real lacks: the dissipated state renders as an organized gray
  pinwheel — grayscale gauze spiral with concentric ring gaps and detached
  orange patches. Same synthetic concentric-ring decay geometry Shaheen
  showed (RGR-009), now in a second storm.
- real shows: a compact ~85 kt VSCS with a huge deep-red CDO (the comparison
  is lifecycle-divergent by this frame; morphology noted for the sim side
  only).
- candidate register entries: RGR-009, RGR-006

## Session verdict

Three things dominate. First, the matched-intensity init pair shows the sim's
cloud system is several times too SMALL at 70 kt — not a palette or texture
problem but a scale problem (new RGR-013). Second, the sheared-mid frame is
the cleanest possible demonstration that the sim renders one symmetric
archetype regardless of shear: the model weakens the storm because of
20.7 m/s shear while drawing a concentric ring around the fix (RGR-003).
Third, the run itself collapsed 6 days before the real storm died,
eliminating the Gujarat-landfall and long-weak-phase stages this archetype
was chosen for — an event-mode lifecycle-fidelity gap that belongs to the
frozen physics/data lane and goes to the HF-7 charter (new RGR-014), not to
the presentation closure waves.
