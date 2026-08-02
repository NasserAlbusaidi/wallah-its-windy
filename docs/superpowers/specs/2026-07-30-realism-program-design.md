# Realism program — design

Date: 2026-07-30
Status: approved direction, R1 speccing complete; R2/R3 are contracts whose
details R1's findings fill in.

## Goal

Make the app the best *realistic interactive cyclone lab* it can be. The
current simulated sensor products (IR/VIS clouds, rain radar) and the
climatological environment read as unrealistic in specific, so-far-unmeasured
ways. This program finds every such gap, measures it, closes what is closeable
without touching frozen science, and converts the rest into a quantified
charter for a future gated recalibration phase (HF-7).

## Decisions already made

1. **Two-track.** Presentation-side gaps are closed inside this program.
   Data-side gaps (monthly-mean env forcing) and physics-side gaps (HF-2B/2C
   territory) are documented in an HF-7 charter and NOT touched. No frozen
   gate, sealed result, or calibrated constant changes in this program.
2. **Full measurement harness.** Realism claims get the same treatment as
   fidelity claims: scored metrics, frozen references, and a regression gate.
   "Looks more realistic" is never the acceptance criterion by itself.
3. **Coverage of harness v1.** Recurring gated metrics for the two simulated
   sensor products (IR/VIS clouds, rain radar) versus their observed
   counterparts, plus a one-shot quantified variance-deficit study of the
   monthly-mean env forcing that becomes the numeric backbone of the HF-7
   charter.
4. **Structure.** Register first (R1), harness second (R2), closure waves
   third (R3) — the harness measures gaps the register confirmed, not gaps
   guessed in advance.

## Non-goals and boundaries

- No change to `src/sim.ts`, `src/structure.ts`, calibrated constants, frozen
  acceptance files, or sealed cohorts. `npm run calibrate:check` and the HF-6
  checks stay green throughout, trivially, because nothing physics-side moves.
- Named avoidances stand: no 3D globe, no surge proxy, no multi-storm, no
  unlabeled live/impact claims.
- This program makes no scientific skill claim. Realism here means perceptual
  and climatological plausibility of *labeled simulated products*, judged
  against observations and literature — not forecast accuracy.

## R1 — realism gap register (~2 weeks, research only)

### Evidence stream 1: paired observation sessions

Use the storm room's existing observed-vs-simulated display (Meteosat IODC
IR/VIS beside simulated IR/VIS) across a fixed archetype matrix:

| Archetype | Storm |
| --- | --- |
| Severe, long-lived | Gonu 2007 |
| Severe, recurving | Kyarr 2019 |
| Oman landfall | Shaheen 2021 |
| Indian-coast landfall | Tauktae 2021 |
| Marginal/monsoon-onset | Biparjoy 2023 (long weak phase) plus one weak sheared system chosen during R1 |

crossed with lifecycle stages: genesis, rapid intensification, peak, shear
onset/decay, landfall. For each covered cell, produce an annotated capture
pair recording what the real storm shows that the sim does not, and vice
versa. Captures are committed as compressed images under
`docs/research/realism/` so register entries stay auditable.

Hypothesis to confirm or reject early (not a pre-decided finding): real IODC
frames carry monsoon cloud across the whole basin; the sim's background sky is
suspected to be far too empty, and environmental cloudiness may dominate
perceived realism over any inner-core refinement.

### Evidence stream 2: literature anchors

- TC diurnal pulse (Dunion et al.) — amplitude, phase, radial propagation.
- IR brightness-temperature and eye-clarity relationships vs intensity
  (Dvorak/ADT lineage).
- Cirrus canopy extent and outflow structure climatology.
- Rainband geometry (spacing, crossing angle, stratiform/convective mix).
- Rain truth over the open Arabian Sea: ground radar is coastal; decide the
  observed rain reference (expected: GPM IMERG) including acquisition path and
  licence.
- EUMETSAT terms for committing frozen reference material; the harness's
  derived-statistics design (below) is the fallback if raw frames cannot be
  committed.

### Evidence stream 3: climate variance study (one-shot, scripted)

Compare env.bin's monthly-mean fields against daily reanalysis samples (ERA5,
2–3 seasons) for SST, shear, and mid-level RH: variance deficit per field per
month, plus the structures monthly means erase (synoptic shear events, monsoon
surges, diurnal SST). This is R1's only code artifact — a bake-side analysis
script, reproducible offline like the rest of the pipeline. Its numbers go
into the HF-7 charter, not into any runtime path.

### The register

One document, `docs/realism-gap-register.md`. Entry schema:

- id, subsystem, lifecycle stage
- description of the gap
- evidence links (capture pairs, literature citation, or study numbers)
- class: presentation / data / physics
- severity: visibility to a satellite-literate viewer (high/medium/low)
- candidate metric (for presentation-class entries)
- rough cost
- disposition: close-now / HF-7 charter / rejected

### R1 acceptance

- Archetype × lifecycle matrix covered (cells impossible for data reasons are
  marked so, not silently skipped).
- Every entry classified, evidenced, and dispositioned.
- Climate study numbers reproduce from the committed script.
- HF-7 charter drafted (`docs/hf7-realism-charter.md`) holding all data/physics
  entries plus the study; explicitly a charter, not a commitment to run HF-7.
- A metric shortlist for R2 derived from the top presentation-class gaps.

## R2 — measurement harness (contract; metrics finalized after R1)

- Lives in `calibration/realism/`, mirroring the existing calibration layout.
  `npm run realism` regenerates a machine-generated `docs/realism-benchmark.md`;
  `npm run realism:check` verifies without writing.
- **Field-space metrics.** Metrics compute from deterministic CPU-side state
  (cloud-field CPU mirrors, env sampler, rainband profile) on a fixed scenario
  set of (spawn, month, seed) storms replayed through the engine — not from
  GPU pixels, which are not byte-stable across drivers. Any metric that truly
  requires pixels is deferred or explicitly canonicalized.
- All numbers pass through the existing `canonicalizeNumbers` path
  (9 decimal places) before being written.
- **Observed references are derived statistics + provenance manifest** (frame
  ids, timestamps, checksums, licence note) — not committed raw imagery.
- **Gate semantics: regression-only.** The harness proves a change did not get
  worse; a fixed human A/B protocol (capture matrix, verdict recorded in the
  register) is what accepts an improvement. After acceptance the baseline is
  resealed through a documented flow, like the calibration flows. This split
  is the Goodhart guard.
- Rollout: advisory (report-only) in its first PR; promoted to CI-blocking
  once it has proven stable across platforms.

## R3 — closure waves

- One gap-cluster per PR. Each PR: cites its register entries, shows the
  before-evidence, lands the fix, passes `realism:check` (no regression
  elsewhere), records the A/B verdict, and updates the register disposition —
  same PR.
- **Class discipline.** A fix that wants to touch `src/sim.ts`,
  `src/structure.ts`, recorded outputs, or any frozen contract is reclassified
  to the HF-7 charter on the spot. A change that alters flight-tape bytes
  (e.g. anything recorded like the cloud-memory boundary frames) must call
  that out explicitly in its PR and keep shared-URL track replay byte-identical.
- Product-honesty labels ("simulated …") are never weakened by a realism fix;
  looking more real makes the labels more important, not less.

## Risks and open questions (owned by R1)

1. Observed rain reference over open ocean — GPM IMERG expected, unverified.
2. Licence for frozen observed reference material — derived-stats design is
   the fallback.
3. Which state counts as "recorded output" for tape-byte purposes — enumerate
   precisely during R2 planning.
4. Register scope creep — the register may surface tempting physics work; the
   two-track rule exists precisely to park it.
