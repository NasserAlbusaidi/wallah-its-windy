# Literature anchors for the realism gap register

Task 6 of the R1 realism-gap-register plan. Each section below is a
published, citable quantity or relationship a future R2 metric could test
against — not a re-litigation of the register entries themselves. Numbers
that could not be confirmed from a source reachable this session (mostly
AMS/Wiley paywalls that blocked full-text fetch) are marked "needs
verification" rather than asserted; the qualitative relationship is kept
only where at least one independent source corroborated it.

## 1. TC diurnal pulse

- Dunion, J. P., C. D. Thorncroft, and C. S. Velden, 2014: The Tropical
  Cyclone Diurnal Cycle of Mature Hurricanes. Mon. Wea. Rev., 142,
  3900-3919. doi:`10.1175/MWR-D-13-00191.1`
- Zhang, X., S. S. Ditchek, K. L. Corbosiero, and W. Xu, 2023: Global and
  Regional Characteristics of Radially Outward Propagating Tropical
  Cyclone Diurnal Pulses. J. Geophys. Res. Atmos., 128, e2022JD037660.
  doi:`10.1029/2022JD037660`

Findings:

- Phase: pulses initiate in the inner core near local sunset, in phase
  with inner-core deep convection overnight, and propagate radially
  outward, reaching several hundred kilometers from the center by the
  following afternoon (Dunion et al. 2014).
- Propagation speed: mean 11-13 m/s; pulses that persist longer than 15 h
  slow to roughly 5-10 m/s, comparable to internal inertia-gravity wave
  speeds. The signal measurably weakens and slows crossing the 200-400 km
  annulus during 09:00-12:00 local time (Zhang et al. 2023).
- Frequency: diurnal pulses occur on 52% of tropical-cyclone days
  globally, most frequently in the Northwest Pacific (Zhang et al. 2023).
  A North Indian Ocean/Arabian Sea-specific frequency figure was not
  recovered this session — needs verification.
- Amplitude: Dunion et al. (2014) quantify the pulse as a 6-hour IR
  brightness-temperature trough-to-peak difference measured at a 300 km
  radius. The exact Kelvin magnitude of that trough-to-peak swing could
  not be confirmed from sources reachable this session — needs
  verification.

> **Anchor:** RGR-007's claim that the sim carries zero local-time
> dependence anywhere in the run is contradicted by a well-replicated,
> ~50%-of-days phenomenon with a specific phase (sunset-triggered inner
> core, overnight outward propagation) and a bounded speed (5-13 m/s). A
> diurnal-cloud metric should test phase and propagation speed against
> these numbers, not merely presence/absence of a cycle. Informs RGR-007.

## 2. IR brightness temperature vs intensity (Dvorak / ADT)

- Dvorak, V. F., 1984: Tropical Cyclone Intensity Analysis Using
  Satellite Data. NOAA Tech. Report NESDIS 11, 47 pp. (defines the
  classic T-number / scene-type / current-intensity table).
- Velden, C. S., B. Harper, L. Wells, et al., 2006: The Dvorak Tropical
  Cyclone Intensity Estimation Technique: A Satellite-Based Method That
  Has Endured for over 30 Years. Bull. Amer. Meteor. Soc., 87,
  1195-1210. doi:`10.1175/BAMS-87-9-1195`
- Olander, T. L., and C. S. Velden, 2007: The Advanced Dvorak Technique:
  Continued Development of an Objective Scheme to Estimate Tropical
  Cyclone Intensity Using Geostationary Infrared Satellite Imagery.
  Wea. Forecasting, 22, 287-298. doi:`10.1175/WAF975.1`
- Olander, T. L., and C. S. Velden, 2019: The Advanced Dvorak Technique
  (ADT) for Estimating Tropical Cyclone Intensity: Update and New
  Capabilities. Wea. Forecasting, 34, 905-922.
  doi:`10.1175/WAF-D-19-0007.1`

Findings:

- Classic Dvorak scene-type T-number ranges: curved band T1.0-T4.5,
  shear T1.5-T3.5, central dense overcast (CDO) T2.5-T5.0, eye pattern
  T4.5-T8.0 (Dvorak 1984, corroborated by two independent summaries this
  session).
- The standard Dvorak current-intensity (CI) number-to-wind-speed table
  places T4.0 at 65 kt (minimal hurricane) — confirmed this session. By
  the same table T4.5 corresponds to roughly 77 kt; that specific value
  is recalled from training material and was not independently
  re-derived from a primary source reachable this session — needs
  verification. The ORDER of the relationship (eye-pattern scene type is
  not assigned below the T4.0-T4.5 band, i.e. below hurricane strength,
  and CDO/curved-band scenes with no eye remain valid up to T5.0, ~90 kt)
  is corroborated by two independent sources.
- The technique estimates intensity from the temperature contrast
  between the warm eye and the surrounding cold cloud top — larger
  contrast, higher estimated intensity (Velden et al. 2006; Olander and
  Velden 2007, 2019). A specific contrast-to-category regression table
  exists in ADT documentation, but its exact numbers could not be
  extracted this session (the ADT users' guide PDF did not render as
  parseable text with the tools available) — needs verification.

> **Anchor:** satellite eye clarity is, by construction of the technique
> operational forecasters have used since the 1970s, not expected below
> roughly hurricane strength (T4.0 = 65 kt, confirmed; T4.5 = ~77 kt,
> needs verification), and an eyeless CDO/curved-band scene remains valid
> up to T5.0 (~90 kt, same unconfirmed table position — needs
> verification). RGR-002's paired evidence — a rendered eye at 58 kt in
> one storm, no eye at 103 kt (sim) / 125-130 kt (real) in another —
> places the sim on both sides of a threshold analysts treat as roughly
> the 65-90 kt band (the 77/90 kt endpoints need verification; the order
> of the relationship does not). A candidate metric: fraction of frames
> below ~77 kt (needs verification) with a sim-rendered eye (should be
> ~0) and fraction above ~90 kt (needs verification) without one (should
> be small). The same contrast-graded-by-category expectation applies to
> RGR-005's coldest-ring saturation. Informs RGR-002, RGR-005.

## 3. Cirrus canopy / outflow extent

- Merritt, E. S., and R. Wexler, 1967: Cirrus Canopies in Tropical
  Storms. Mon. Wea. Rev., 95, 111-120.
- Merrill, R. T., 1984: A Comparison of Large and Small Tropical
  Cyclones. Mon. Wea. Rev., 112, 1408-1418.
  doi:`10.1175/1520-0493(1984)112<1408:ACOLAS>2.0.CO;2`
- Kawashima, M., 2021: A Numerical Study of Cirrus Bands and
  Low-Static-Stability Layers Associated with Tropical Cyclone Outflow.
  J. Atmos. Sci., 78 (11). doi:`10.1175/JAS-D-21-0047.1`

Findings:

- Mechanism: cirrus generated at the eyewall and advected outward can
  form a canopy resembling satellite observations within 12-18 hours;
  generation directly in the spiral bands shortens this further. The
  canopy's outer edge is sharp specifically where the radial outflow
  wind drops below roughly 1 m/s and the tangential wind is near a local
  maximum — the edge shape is a signature of the outflow wind field, not
  a free boundary (Merritt and Wexler 1967).
- Size climatology: tropical-cyclone size is only weakly correlated with
  intensity, and storm size varies strongly by basin and season —
  western North Pacific storms run roughly twice the size of Atlantic
  storms of comparable intensity (Merrill 1984). No Arabian Sea/North
  Indian Ocean-specific size climatology was recovered this session —
  needs verification.
- Outer-shield radius: search-engine-indexed summaries of TRMM-based
  storm-centered composite studies put roughly 90% of tropical-cyclone
  cases within a 550-600 km cloud-shield outer edge. The primary source
  for that specific figure could not be pinned down this session — an
  earlier draft of this document mis-attributed it to Leppert and Cecil
  (2016), whose actual result (per independent review) is a diurnal
  precipitation signal within <500 km, a different finding. Attribution
  unresolved — needs verification before this number is used as a hard
  target.
- Outflow-driven banding: episodic cirrus banding within the outflow
  canopy is tied to violations of gradient-wind balance in the core and
  to ascent over the ambient static-stability field — a direct,
  physically mechanistic response to the same upper-level flow the
  canopy sits in (Kawashima 2021), reinforcing that canopy shape is not
  a free parameter independent of the 200-hPa environment.

> **Anchor:** a real cirrus canopy's edge shape and streaming are
> outputs of the local outflow/tangential wind field, not a circle
> scaled by storm size, and canopy radius is only weakly tied to
> intensity. RGR-010's metric should test edge raggedness against
> wind-field asymmetry where available, rather than against intensity
> alone; RGR-011's missing event-aligned 200-hPa data is the actual
> blocker for computing that comparison in event replay. The bounded
> shield radius (90% within ~550-600 km; primary source unresolved,
> needs verification) contextualizes RGR-013's "several times too
> small" claim, and Merrill's weak size-intensity correlation supports
> binning by regime rather than a single intensity axis. Informs
> RGR-010, RGR-011, RGR-013.

## 4. Rainband geometry

- Houze, R. A. Jr., 2010: Clouds in Tropical Cyclones. Mon. Wea. Rev.,
  138, 293-344. doi:`10.1175/2009MWR2989.1`
- Hence, D. A., and R. A. Houze Jr., 2012: Vertical Structure of
  Tropical Cyclone Rainbands as Seen by the TRMM Precipitation Radar.
  J. Atmos. Sci., 69, 2644-2661. doi:`10.1175/JAS-D-11-0323.1`

Findings:

- Regime break at roughly 200 km radius: inner-region rainbands are
  vertically confined by eyewall outflow and combine strong embedded
  convective cells with robust stratiform precipitation, both of which
  strengthen with storm intensity; beyond ~200 km, rainbands become more
  sparsely distributed and more purely convective in character (Hence
  and Houze 2012).
- Shear organization: rainbands in both the inner and outer regions
  organize with respect to the environmental deep-layer shear vector —
  right-of-shear quadrants host newer convective cells, left-of-shear
  quadrants are predominantly stratiform (Hence and Houze 2012). This is
  the same shear vector the app already computes and feeds to the
  intensity lane (the mechanism behind RGR-003).
- Real bands have a two-layer vertical structure separated by the
  melting layer (Hence and Houze 2012) — a structural signature with no
  direct IR analogue, but implying real bands are not visually uniform
  along their length; texture should vary with the local
  convective/stratiform mix.
- Specific band-to-band spacing (km) and crossing angle (degrees)
  relative to the vortex are documented in the Houze (2010) review, but
  could not be extracted from the source this session (AMS full-text
  fetch was blocked) — needs verification.

> **Anchor:** real rainbands are structurally two different regimes
> (inner vs outer, split near 200 km radius) whose convective/stratiform
> character is organized by the shear vector, not radially uniform.
> RGR-004's "smooth continuous ribbon" and RGR-003's "radially symmetric
> regardless of shear" are two faces of the same literature-documented
> violation: band texture and type mix should vary with radius and with
> shear-relative quadrant. Candidate metric: convective-cell fraction (or
> edge-density proxy) split inner (<200 km) vs outer (>200 km) and by
> shear-relative quadrant, sim vs observed. Informs RGR-004, and
> secondarily RGR-003.

## 5. Arabian Sea environmental cloud context

- Wonsick, M. M., R. T. Pinker, and Y. Govaerts, 2009: Cloud Variability
  over the Indian Monsoon Region as Observed from Satellites. J. Appl.
  Meteor. Climatol., 48, 1803-1821. doi:`10.1175/2009JAMC2027.1`
- Sathiyamoorthy, V., C. Mahesh, K. Gopalan, S. Prakash, B. P. Shukla,
  and A. Mathur, 2013: Characteristics of low clouds over the Arabian
  Sea. J. Geophys. Res. Atmos., 118, 13489-13503.
  doi:`10.1002/2013JD020553`

Findings:

- Seasonality of the shape, not just the level, of cloudiness: the
  daytime (08:00-15:00 local) diurnal cycle of total cloud amount is
  flat through the premonsoon, U-shaped during peak monsoon (June-July),
  and rises toward an afternoon peak in the postmonsoon
  (October-November) (Wonsick et al. 2009).
- Regional structure: low clouds dominate the northern Arabian Sea while
  high clouds are more frequent over the southern Arabian Sea and Bay of
  Bengal (Sathiyamoorthy et al. 2013; corroborated by Wonsick et al.
  2009).
- A single, basin-wide numeric cloud-fraction target for "monsoon" vs
  "post-monsoon" (the two seasons the register's storms actually span)
  was not recovered from sources reachable this session — needs
  verification. Both papers confirm the seasonal shape and the
  regional (north/south) asymmetry, not a single target percentage.

> **Anchor:** RGR-001's existing month-dependence nuance (June basin
> cloud-filled, October basin largely clear west of the storm) is
> independently corroborated by the published seasonal cycle shape —
> the literature agrees the monsoon/post-monsoon contrast is real and
> non-trivial, not a session-to-session artifact. This supports
> conditioning the cloudy-area-fraction metric on month/season rather
> than testing against one constant target. Informs RGR-001.

## 6. Pre-genesis convective organization

- Wang, Z., 2018: What Is the Key Feature of Convection Leading up to
  Tropical Cyclone Formation? J. Atmos. Sci., 75, 1609-1629.
  doi:`10.1175/JAS-D-17-0131.1`
- Chang, M., et al., 2017: Multiday Evolution of Convective Bursts during
  Western North Pacific Tropical Cyclone Development and Nondevelopment
  Using Geostationary Satellite Measurements. J. Geophys. Res. Atmos.,
  122, 1635-1649. doi:`10.1002/2016JD025535`

Findings:

- Weak-stage convection is not one recurrent miniature cyclone pattern.
  Cluster analysis of more than 150 Atlantic genesis cases found three
  distinct IR spatial regimes: a large convective system displaced roughly
  4-5 degrees from the pouch center, a smaller and weaker system that was
  more centered, and a large system with a smaller displacement. Convective
  intensity, area, and duration varied substantially between storms; the
  composite is an occurrence probability, not a shape every storm repeats
  (Wang 2018).
- Organization changes toward genesis: the occurrence of deep convection
  increases in the inner pouch, and convection becomes more effective at
  strengthening the protovortex as its maximum approaches the circulation
  center. A displaced burst complex is therefore a weak-stage possibility,
  not a shape that should remain fixed through maturation (Wang 2018).
- Repeated bursts are common before formation: 67.5% of 80 developing
  disturbances, versus 13.8% of 383 nondeveloping disturbances, exhibited
  multiday convective bursts in the satellite analysis (Chang et al. 2017).
  This supports episodic clustered texture instead of one continuously
  organized spiral, while the basin-specific frequency remains unverified.

> **Anchor:** RGR-006 should replace the deterministic centered mini-vortex
> at weak intensity with a seed-varying distribution of multi-lobed burst
> complexes, including both displaced and relatively centered realizations,
> and blend back toward an organized core as development rises. Metrics should
> test the distribution of centroid offsets and component topology across a
> frozen seed matrix rather than require every weak storm to have the same
> displacement. Informs RGR-006 and RGR-009.

## Verification summary

| Topic | Verified this session | Needs verification |
| --- | --- | --- |
| Diurnal pulse | phase, propagation speed, global frequency | exact K amplitude; North Indian Ocean-specific frequency |
| BT vs intensity | scene-type T-number bands, T4.0=65kt, eye/CDO overlap order | T4.5 (~77kt) and T5.0 (~90kt) kt values; ADT contrast-to-category table |
| Canopy/outflow | edge-formation mechanism, weak size-intensity correlation | shield-radius percentile (attribution unresolved — see §3); Arabian Sea-specific size climatology |
| Rainband geometry | 200 km regime break, shear-quadrant organization | band spacing (km); crossing angle (degrees) |
| Arabian Sea cloud | seasonal cycle shape, N/S regional asymmetry | single monsoon/post-monsoon cloud-fraction number |
| Pre-genesis convection | spatial-pattern variability, inward organization, multiday-burst frequency | North Indian Ocean-specific pattern and frequency |

Papers were located via search-engine indexing of AMS, AGU/Wiley, and
NOAA/NASA repository listings; several primary PDFs (AMS journals: 403,
Wiley: 402) could not be fetched in full this session, which is why some
numbers above are marked needs verification rather than asserted. Where a
number could not be independently confirmed, the qualitative relationship
was kept only if corroborated by an independent source; single-source
paraphrases of blocked full text are flagged explicitly above.
