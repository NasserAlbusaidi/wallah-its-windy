# Session — Ashobaa 2015 (`ashobaa`) — reference-only

Date: 2026-08-02. Operator: R1 controller session (inline).
Scenario URL: `<dev>/#env=ashobaa` → hindcast spawn `#lat=18.000&lon=67.200&month=5&seed=2015&env=ashobaa`
Run: hindcast init Jun 8 03:00 UTC (35 kt CS, org 0.404), 76 replay frames ×
15 min, ends Jun 8 21:45 UTC (20 kt d*).

Sim milestones: start 0 · Jun 8 03:00Z · 35 kt; end 75 · Jun 8 21:45Z · 20 kt.

Stage frames:

- genesis: frame 26 · 08 Jun 09:30Z · 38 kt CS (Aqua-matched; the only
  usable stage — see below)
- end: frame 74 · 08 Jun 21:30Z · 20 kt d* (IR only)

Captures: `captures/ashobaa/genesis-sim-{ir,vis}.webp`, `end-sim-ir.webp` +
observed references `genesis-obs.webp` (Jun 8), `organized-obs.webp`
(Jun 9), `decay-obs.webp` (Jun 11).

Methodology note — third lifecycle collapse, and the most complete: the
weak-sheared archetype this storm was chosen for survives 18.75 h in the
sim (35 kt → dissipated within one day), while the real Ashobaa persisted
~5 more days as a sheared cyclonic storm drifting toward Masirah. The
"best-organized" (Jun 9) and "decaying" (Jun 11) observed references have no
sim counterpart at all (RGR-014, third example; lifetime ratio ≈ 0.16). The
irony worth recording: the sim cannot HOLD a weak sheared storm — the exact
regime whose morphology (exposed centers, displaced bursts) the register
says the renderer cannot DRAW either.

## Observed-side source

External: NASA Worldview snapshot API, layer
`MODIS_Aqua_CorrectedReflectance_TrueColor`, dates 2015-06-08 / -09 / -11,
BBOX 15–27N 50–70E, 1560×936, overpass ~09:30–10:00 UTC. Public domain,
attribution "NASA Worldview / MODIS Aqua". Accessed 2026-08-02. Positions
described from the imagery itself, dated by layer; no best-track fix claims.

## Stage notes

### genesis (Jun 8 · sim 38 kt vs real ~35–40 kt — matched intensity)
- real (obs): a broad multi-lobed convective burst mass with ragged edges
  and cirrus streaming NE, embedded in textured monsoon flow that fills the
  SE half of the domain; no vortical cloud signature, no visible center.
- sim (IR): a tidy grayscale pinwheel — perfect logarithmic spiral arms, a
  dark concentric ring gap around a small orange core dot, centered exactly
  on the fix. A second matched-intensity pair (after Biparjoy init), and at
  the weak end it reproduces Shaheen's genesis finding exactly.
- sim (VIS): flat uniformly lit swirl; same solar-geometry absence.
- register entries: RGR-006 (strongest weak-stage evidence yet — matched
  intensity), RGR-009 (ring-gap geometry in a LIVE weak storm, not only in
  decay), RGR-001, RGR-012.

### end (Jun 8 21:30Z · sim 20 kt d*)
- sim: the pinwheel fades in place; concentric geometry persists to the last
  frame.

## Session verdict

Ashobaa closes the archetype matrix's weak-sheared cell with two results:
morphologically, the matched-intensity genesis pair confirms RGR-006 across
a third storm and shows the concentric-ring artifact is not decay-specific
(RGR-009 extension); and physically, the sim cannot sustain the archetype at
all — the strongest of the three RGR-014 lifecycle-collapse examples
relative to real duration.
