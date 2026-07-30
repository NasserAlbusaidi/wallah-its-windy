# Session — Shaheen 2021 (`shaheen`)

Date: 2026-07-30. Operator: R1 controller session (inline).
Scenario URL: `<dev>/#env=shaheen` → hindcast spawn `#lat=23.100&lon=65.400&month=8&seed=2021&env=shaheen`
Run: hindcast init Oct 1 00:00 UTC (35 kt), 266 replay frames × 15 min, ends Oct 3 18:15 UTC.

Ghost track / milestone stage times used (replay frame · model valid · sim wind):

- genesis/init: frame 0 · 01 Oct 00:00 UTC · 35 kt
- intensification: frame 220 · 03 Oct 07:00 UTC · 58 kt (steepest rise 192→239)
- peak: frame 239 · 03 Oct 11:45 UTC · 65 kt / 981 hPa (also VIS pair)
- landfall: frame 244 · 03 Oct 13:00 UTC · 52 kt (center just inland W of Muscat)
- decay: frame 258 · 03 Oct 16:30 UTC · 27 kt (inland)

Methodology note: pairing is by valid time. The sim ran ~6–8 h fast against the
real storm (real landfall was late Oct 3 UTC; sim peak+landfall ~12:00 UTC) and
peaked 65 kt vs observed ~70–75 kt. That offset is the frozen intensity lane's
known skill problem, NOT a realism gap; entries below are morphology-only.

## Observed-side source

In-app paired: Meteosat-8 IODC · SEVIRI IR10.8 μm (all stages) and VIS0.6 μm
(peak) via EUMETSAT EUMETVIEW, provenance label confirmed per frame, e.g.
"Meteosat-8 IODC · SEVIRI IR10.8 μm · 03 Oct 2021, 11:45 UTC".

## Stage notes

### genesis (01 Oct 00:00 UTC ≈ 04:00 local — nocturnal convective max)
- captures: captures/shaheen/genesis-{sim,obs}.webp
- real shows / sim lacks: an enormous ragged multi-cluster convective burst
  (deep red tops over a huge area, more cold-top area than the sim ever shows
  at its 65 kt peak), displaced from the marked center; wide cirrus shield
  streaming west; a second band along the Indian coast; cloud across the whole
  basin. This is the nocturnal burst of a forming system.
- sim shows / real lacks: a tiny, tidy, radially symmetric miniature vortex
  (concentric gauze + neat spiral filaments) centered exactly on the fix, on a
  pitch-black empty sea.
- candidate register entries: RGR-001, RGR-006, RGR-007

### intensification (03 Oct 07:00 UTC · sim 58 kt)
- captures: captures/shaheen/intensification-{sim,obs}.webp
- real shows / sim lacks: asymmetric comma-shaped CDO with the coldest tops
  displaced NE of the center; a long granular tail band curving SSE built of
  discrete beaded convective cells; streaked cirrus to the NE; textured cloud
  basin-wide.
- sim shows / real lacks: an already-closed perfect red eyewall annulus with a
  pinhole eye at 58 kt; smooth ribbon-like spiral bands with soft edges and
  regularly-spaced embedded orange cells; a circular gauze disc with a clean
  outer boundary; black background.
- candidate register entries: RGR-002, RGR-003, RGR-004, RGR-010

### peak (03 Oct 11:45 UTC · sim 65 kt · IR + VIS pairs)
- captures: captures/shaheen/peak-{sim,obs}.webp, peak-vis-{sim,obs}.webp
- real shows / sim lacks (IR): compact asymmetric orange CDO near the coast, no
  eye, no annular ring, coldest cells NE of center; granular texture with
  embedded cells; monsoon/ITCZ cloud everywhere else in the domain.
- sim shows / real lacks (IR): textbook symmetric storm — solid red eyewall
  ring, clean circular eye, three smooth bands, radial gauze; deepest reds far
  colder-looking than anything in the observed frame at matched time.
- VIS pair (15:45 local, moderate sun): observed VIS is dim, low-contrast,
  with natural granular low-cloud texture and gray sea; sim VIS is a uniformly
  bright white swirl on black sea, no solar-geometry dimming, no environmental
  low cloud.
- candidate register entries: RGR-001..005, RGR-010, RGR-012

### landfall (03 Oct 13:00 UTC · sim 52 kt, center inland)
- captures: captures/shaheen/landfall-{sim,obs}.webp
- real shows: still-offshore compact CDO (timing offset), asymmetric shield
  over the coast.
- sim shows / real lacks: the perfect solid eyewall annulus + clean eye persist
  unchanged with the center over land — no coastal disruption of the core
  cloud morphology at all.
- candidate register entries: RGR-008

### decay (03 Oct 16:30 UTC · sim 27 kt inland)
- captures: captures/shaheen/decay-{sim,obs}.webp
- real shows: coherent asymmetric orange CDO at the coast (real storm ~5 h from
  landfall — timing offset), ragged edges.
- sim shows / real lacks: a shrunken orange blob wrapped in a dark concentric
  "bullseye" ring gap plus detached amorphous gauze blobs — reads synthetic;
  no real decaying system shows concentric-ring geometry.
- candidate register entries: RGR-009

## Session verdict

The single loudest gap is the empty basin: every observed frame has cloud
everywhere; every sim frame is a lone storm on black. Second loudest: the sim
draws one archetype (radially symmetric mature vortex) at every intensity and
scales it, while the real storm's morphology changes regime by stage (burst
complex → sheared comma → compact CDO) and never once resembles the sim's
textbook ring-and-bands.
