# Northern Indian Ocean domain expansion (nio-v1) — design

Date: 2026-08-09. Revised 2026-08-10 after adversarial verification.
Status: draft, awaiting review.

Expand the simulation domain from the Arabian Sea box (50–70 °E, 15–27 °N) to
the whole northern Indian Ocean (45–100 °E, 0–30 °N). Rebake every asset at the
same resolution. Accept the reseal this forces, and pay it once, at one
attributable boundary.

**This project ships a domain, not a model.** It changes no calibrated physics
parameter and runs no intensity protocol. It is the enabling work that gives the
already-chartered HF-7 phase (`docs/hf7-realism-charter.md`) a basin-wide data
foundation and an uncontaminated cohort to draw from. That separation is the
main change in this revision.

Every number here was measured against the repository on 2026-08-09 or
2026-08-10 unless marked UNVERIFIED. Claims that a first draft got wrong are
marked **[corrected]** so a reader who saw the draft is not misled.

---

## 1. Decisions of record

| # | Decision | Chosen |
|---|---|---|
| D1 | Domain and resolution | `{45, 100, 0, 30}`, uniform expansion, everything rebaked at unchanged resolution |
| D2 | ERA5 year selection | Basin-wide. Every environment plane changes |
| D3 | The twenty scenario bins | Rebaked at the new extent. No scoping, no freeze |
| D4 | HF-6 | Freeze its inputs, keep the check in CI, change what it asserts |
| D5 | Home view | Whole basin by default |
| D6 | Basin-wide intensity evidence | **Feed the existing HF-7 charter.** No competing protocol, no cohort drawn by this project |
| D7 | URL hash | Breaks cleanly. No version key, no shim. Say so plainly |
| D8 | Scenario spawns | Let them move. The larger box reveals each storm's real first fix |
| D9 | The two pre-existing leaks | **Measure the shift**, then disclose the number |
| D10 | Impact rain ledger | **Stays Float32.** 63.36 MB. No quantization of recorded output |

Settled by the assistant, open to reversal at review:

- All twelve months are baked. The Bay of Bengal has a real November–December
  season, and the current seven-month window makes it unreachable.
- `flowacc.bin` drops its `basin` layer.
- The display context is deleted — but **after** the domain flip, not before.
- Public scenario bins keep 0.5° at full extent. Offline calibration bins use
  track-following subwindows, contingent on the Phase 0 spike.
- The camera uses a **contain** fit, not the current cover fit.
- `MAX_AGE_H = 360` (matching `ensemble.ts:183`'s `maxHours`), declared a
  calibrated model parameter, not a free constant. See §3.2.

### 1.1 What this project deliberately does not do

- It does not tune `SHEAR_THRESHOLD_MS`, `SHEAR_K_KT_PER_H_PER_MS`, or any
  intensity parameter. D2 makes their calibration *invalid*, which is a fact to
  record, not a licence to retune inside this project.
- It does not draw a sealed cohort. The charter reserves that for HF-7, and a
  cohort can be drawn roughly once — every SID it consumes is permanently burnt
  for confirmatory use (`hf2-contract.json:25`, `hf3-contract.json:29`).
- It does not regenerate `fidelity-reference.json`. See §7.

---

## 2. The domain box

`{ lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 }`.

Each edge is forced by arithmetic.

- **latMin 0.** Terrain registration survives only if the height is an integer
  multiple of `12/668` degrees. 30° gives exactly 1670 rows, and `12/668 ===
  30/1670` holds bit-identically in IEEE754 double. `latMin 2` gives 1558.67
  rows and destroys every existing cell centre.
- **latMax 30, lonMin 45.** They match the retiring presentation context box.
- **lonMax 100.** Exactly 110 env cells and 2860 terrain columns.
  `structure.ts:259`'s maritime taper `smoothstep(98, 104)` is 25.9 % engaged
  there, but that taper is a *fitted* coefficient over a dataset spanning
  46.5–119.2 °E, so partial engagement is the fit's own answer.

Registration verified over 200,000 in-box points: +260 columns and +167 rows at
terrain resolution, +10 and +6 at 0.5° env resolution, zero mismatches.

The equator is numerically safe — `src/sim.ts` has no Coriolis term and no
division by `f`, and a probe ran the shipped engine to 0.05 °N without a throw.
Three conditions ship with it: replace `upper-ocean.ts:198`'s `Infinity` with a
finite 720 h sentinel; document "no inertial dispersion equatorward of about
5 °N"; label that belt out of evidence.

---

## 3. What actually breaks

### 3.1 Tracks change, and the data is not the reason

`src/env-sampler.ts:163-164`, `src/steering.ts:274-275` and
`src/upper-ocean.ts:564-570` clamp every sample to the current box. Ventilation
rings probe 150–350 km (`ventilation.ts:42`); steering rings 275–375 km
(`steering.ts:98`). At 350 km — 3.14° of latitude — any storm below 18.1 °N or
above 23.9 °N, or within about 3.35° of 50 °E or 70 °E, reads clamped data
today. That is about 68 % of the old box by area, and 41 of the 71
`genesis.json` spawn points.

Releasing those clamps changes structure → the Holland field → the upper ocean →
`surfaceSstC` → intensity. Tracks move before a byte of new data lands. Motion
is spared: `DEFAULT_TRACK_PARAMETERS.environmentalSteeringBlend = 0`
(`sim.ts:236`).

Interior sampling is provably registration-preserving: over 200,000 interior
points the new fractional column and row equalled old + 10 and old + 6 with zero
bit difference. **Registration preservation is a statement about cell indices,
not about values.** That distinction is why Phase 6 and Phase 7 are separate —
see §6.

### 3.2 Storms lose their only lifetime bound

`src/sim.ts:1379` is the sole `DOMAIN` use in the physics core and the only
lifetime bound. A probe patched `DOMAIN` to the new box and ran nine spawn
latitudes over constant 29.5 °C water: all nine ran the full 960 ticks (240 h)
with `reason = null`. `main.ts:3312` caps ticks per *frame*, not per run.

`MAX_AGE_H = 360` lands in Phase 1, where the exit test still fires long before
any cap and the addition provably changes no number. **[corrected]** That
zero-diff property expires at the domain flip. After Phase 8, `MAX_AGE_H`
becomes the dominant death mechanism for a large share of storms, so it is a
first-order physics parameter, not a guard rail. It is therefore declared a
calibrated model parameter, listed in the HF-7 charter's frozen-input set, and
recorded in the model card. Its provenance is `ensemble.ts:183`'s existing
`maxHours = 360`; that provenance is weak, and HF-7 — which scores dissipation
timing per `findings-hf1-hf6.md:100-106` — cannot treat it as free.

### 3.3 The render layer is denominated in the old box

`HALF_DOMAIN_HEIGHT_KM = 666` is hardcoded at `src/render/storm-radii.ts:16` and
`src/realism-metrics.ts:68` — half of 12°. At 30° it becomes 1665, and every
bare clip literal rescales by 2.5. Sharpest example:
`RENDER_RADIUS_FLOOR = 0.008` is 5.33 km today and 13.3 km after, exceeding
`structure.ts`'s 12 km `rmwKm` floor — the exact failure class CLAUDE.md's
`rCanopy` note warns about.

A zero-diff derivation needs a render-local `RENDER_KM_PER_LAT_DEG = 111`:
`grid.ts:40`'s `METERS_PER_DEG_LAT = 111_320` gives 667.92 and
`terrain.ts:23`'s `KM_PER_LAT_DEGREE = 111.195` gives 667.17. Neither is 666.
The disagreement (≤ 0.29 %) is documented at the constant.

Six test files pin `666` **deliberately, as drift guards**:
`test/storm-radii.test.ts:37-38`, `test/cloud-motion.test.ts:128-130`,
`test/realism-metrics.test.ts:17` and `:195` (whose comment reads "Drift guard
for the duplicated 666"), `test/realism-proxy.test.ts:334-335` and `:356`.
Re-pinning them silently defeats their purpose; each is decided individually —
either import the derived constant or re-pin with a recorded reason.

### 3.4 The realism harness measures the wrong thing at the new size

`REALISM_GRID_N = 192` over the new domain gives 17.34 × 30.71 km cells against
6.94 × 10.79 km today. That nulls RGR-002 and coarsens the cold-top area quantum
7.1×.

Two corrections to the obvious framing. The metrics were never view-dependent —
`src/realism-field.ts` imports nothing from `camera.ts` or `display-domain.ts`,
and `src/realism-metrics.ts` imports only `realism-proxy`. Domain registration
is the problem, not the camera. And only **R2a** is a measurement harness: R1 is
the register self-check, and R3/R4 are shader programmes already closed by
recorded human A/B verdicts. They need re-scoped wording, not re-measurement.

### 3.5 Silent-failure paths that must close before anything is rebaked

1. `src/raster-sampler.ts:13-16` resolves cells through each layer's **own**
   header bbox and clamps to that layer's edges. `src/scenarios.ts:184-202`
   validates layer names and `nt` but never `nx`, `ny` or bbox — and `nt` is
   exactly what does not change when only the grid changes.
   `src/ensemble.worker.ts` validates nothing at all.
2. `bake/fetch_era5.py:206` and `bake/fetch_event_benchmark.py:64` skip a cached
   download on existence and non-zero size alone, and the filenames do not
   encode the extent.
3. `bake/era5.py:330` and `bake/era5_event.py:176-177` build
   `RegularGridInterpolator` with `fill_value=None`, which **extrapolates**. Fed
   a stale file, the bake fabricates a basin without a diagnostic.
4. `bake/bake.py:173`'s `np.clip` saturates `flowacc`'s uint16 quantization
   silently. Ceiling `log10(1+acc) = 6.5535`; the Ganges–Brahmaputra–Meghna
   reaches about 6.345. A 3.2 % margin.

Each becomes a raise, not a clip, before the rebake.

### 3.6 GMRT will not give 2 km in one request

`resolution=med` is a hard **1140-column cap**, not a ground resolution:
1140 × 985 on a 5 × 4° box, 1140 × 735 on the current 20 × 12° box. Over 55° it
gives 5.36 km cells against a 1.923 km target. The fetch must tile — 15 requests
of 11 × 10°, about 76.5 MB, about 23 minutes of server time —
and `sources.load_terrain`, which assumes exactly one NetCDF, must learn to
mosaic.

### 3.7 The 2048 texture floor

Nothing in `src/` probes `gl.MAX_TEXTURE_SIZE`. `nx = 2860` exceeds the GLES 3.0
minimum of 2048, and the failure is silent: an incomplete texture samples as
black, so `land = 0` and the basin renders as ocean.

Determinism resolves cleanly. `ensemble.worker.ts:72-75` builds `isLand` from
the `BinLayer` through `sampleLayerBilinear` at full baked resolution, and a
worker has no WebGL context, so it cannot observe the cap even in principle. A
floor device produces identical tracks, landfall and recorded output; only the
drawn coastline coarsens. The reduction lives in `src/render/texture-fit.ts` and
operates on a copied plane. Applying it in `bake.py` or `loader.ts` is
forbidden.

### 3.8 The live acquisition path is not a frozen literal **[corrected]**

A first draft listed `bake/public_cycle.py:69` among the frozen protocol
literals. That is wrong and dangerous. `public_cycle.py` is the **live**
acquisition path: `.github/workflows/deploy.yml` runs `npm run live:acquire` on
every push and on a `45 */6 * * *` cron, and `:889` writes
`public/data/live/environment.bin` straight into the shipped site at 40 × 24 /
bbox (50, 70, 15, 27). `:705` hard-asserts against its own `ENV_NX`/`ENV_NY`.
Nothing downstream catches a mismatch either — `test/asset-manifest.test.ts:32`
pins `VOLATILE_ASSET_PREFIXES` to `['live/', 'satellite/']`, so the live bin is
excluded from the manifest by design.

Freezing it would ship an Arabian-Sea-registered live bin into a whole-basin
runtime, six-hourly, past the very invariant written to prevent that. It moves
with `sources.py`. Its GFS NCSS request area grows 2.75×, which is unbudgeted
CI wall-clock on a six-hourly cron.

---

## 4. Grids and budget

### 4.1 Grid dimensions

| Asset | Now | New | Note |
|---|---|---|---|
| `terrain.bin` | 1040 × 668 | **2860 × 1670** | cell size bit-exact; +260 / +167 |
| `flowacc.bin` | 1040 × 668, 4 layers | **2860 × 1670, 3 layers** | `basin` retired |
| `env.bin` | 40 × 24, 7 months | **110 × 60, 12 months** | 96 layers of a 255 ceiling |
| `ocean.bin` | 40 × 24, 7 months | **110 × 60, 12 months** | nt = 26 depths |
| `upper.bin` | 40 × 24, 7 months | **110 × 60, 12 months** | **has a runtime consumer** |
| `regions.bin` | 200 × 120 | **550 × 300**, admin1 → uint16 | Phase 9 |
| `impact.ts` GRID_NX/NY | 200 × 120 | **550 × 300** | Phase 9, own work item |
| runtime `OCEAN_GRID` | 200 × 120 | **550 × 300** | rounding tie fixed |
| ensemble summary grid | 80 × 48 | **220 × 120** | 0.25° cells |
| realism field | 192² domain-wide | **256² storm-centred, 800 km half-extent** | 6.25 km isotropic |
| realism env field | — | **352 × 192 domain-wide** | new, RGR-001 only |
| display context | 875 × 550 | **deleted at Phase 8** | not before |

**[corrected]** `upper.bin` is not inert. It backs a shipped, user-selectable
weather layer: `src/weather-layers.ts:170` declares layer id `upper`;
`src/upper-sampler.ts:27-34` is its single runtime resolver;
`src/main.ts:2341-2342` and `src/render/index.ts:261,426` consume and draw it,
and `render/index.ts:647` comments that it "is not self-fetched here" — it
depends on the first-paint fetch. Dropping it from first paint is a real code
change, not a free byte saving.

### 4.2 Budget

`8 + 88·layerCount + Σ(nx·ny·nt·elemBytes)` reproduces all six committed bins
exactly.

| File | Raw now | Raw new | Gz now | Gz new |
|---|---|---|---|---|
| `terrain.bin` | 2,084,344 | 14,328,784 | 905,869 | ~6,222,910 |
| `flowacc.bin` | 4,168,680 | 19,105,072 | 669,287 | ~3,885,438 |
| `env.bin` | 354,376 | 4,126,856 | 272,432 | ~3,172,726 |
| `ocean.bin` | 700,120 | 8,238,920 | 427,486 | ~5,030,684 |
| `upper.bin` | 108,760 | 1,269,320 | 79,006 | ~922,034 |
| `regions.bin` | 72,184 | **660,184** | 2,797 | ~24,000 |
| JSON (4 files) | 68,304 | ~112,000 | ~20,000 | ~26,000 |
| `context-terrain.bin` | 1,443,934 | **0** | 694,809 | 0 |
| **First paint** | **9,000,702** | **~47,841,006** | **3,060,151** | **~19,283,792** |

**[corrected]** Three fixes against the first draft. `regions.bin` is 660,184,
not 495,184 — Phase 9 widens `admin1` from uint8 to uint16, and the old figure
assumed today's dtypes (measured header: `admin1` uint8 24,000 B + `wadi` uint16
48,000 B). The first-paint row now itemises everything `src/main.ts:781-801`
actually fetches, including the four JSON files and today's `context-terrain.bin`
— the draft's total was correct but unauditable, since the six-row table summed
to 7,488,464 against a stated 9,000,702.

First paint goes from 2.92 MiB to about 18.39 MiB on the wire: 6.3×. Download at
10 / 50 / 200 Mbit/s becomes 15.4 s / 3.1 s / 0.8 s against 2.4 / 0.5 / 0.1 s.
**This is the largest product regression in the project.**

**[corrected]** The twenty scenario bins are **175,942,080 B raw** (about
117 MiB gz), not 138,982,080. The draft scaled today's 752 planes by area only,
while Phase 10 lengthens every window to 952 planes. All of `public/data`
therefore lands near **213 MiB**, not 178 MiB. `env_shaheen.bin`'s projected
17,741,512 B is likewise an area-only lower bound — its window grows most of
all, since its first fix moves to the Bay of Bengal. The under-100 MB conclusion
survives; the number does not.

**GitHub Pages already compresses `.bin`.** Measured 2026-08-09: `terrain.bin`
serves at 910,773 bytes against 2,084,344 raw with `Content-Encoding: gzip`,
within ±2.5 % of local `gzip -9`. No precompression exists or is needed. Brotli
is not offered for `application/octet-stream`. This is UNVERIFIED above about
4.2 MB — see §10.

No header field overflows: `nx`/`ny` u32, `byteLength` u64, `layerCount` u8 at
96 of 255.

### 4.3 Offline calibration data

A basin-wide cohort at full extent would be about 10 MB of forcing per storm.
Non-sealed storms therefore get **track-following subwindows** — track bbox plus
the 375 km environmental annulus plus margin — recorded with their own bbox
header.

**[corrected]** The draft called this precedented. It is not. Every bin under
`calibration/data/hf3/` and `calibration/data/hf6/forcing/` carries nx = 40,
ny = 24, bbox = (50, 70, 15, 27); only `nt` varies. **No physics-forcing bin in
this repository has ever carried a bbox different from `DOMAIN`.** The only
non-`DOMAIN` bbox anywhere is `context-terrain.bin`, which is presentation-only
and slated for deletion. `raster-sampler.ts` is structurally capable, but the
pattern is untested for forcing, so Phase 0 spikes it: one calibration storm
through a genuinely offset-bbox bin, compared against the same storm through a
full-extent bin. The 150 MB target is contingent on that spike.

---

## 5. New invariants

1. **Bbox agreement.** No layer header bbox may disagree with `grid.ts DOMAIN`
   for any bin the runtime feeds to physics. `validateEventBinForScenario` must
   assert `nx`, `ny` and bbox; `ensemble.worker.ts` must be covered too.
   Rejecting a wrong-extent bin loudly is not a fallback — it is the visible
   failure D3 assumes already exists.
2. **One domain, two languages, with one declared exception.** `bake/sources.py:27`
   and `src/grid.ts:29` are the same fact and are asserted equal by a test —
   **except** during the migration, where Phases 6 and 7 hold them unequal by
   design, because that divergence *is* the registration proof. The test reads
   an explicit `DOMAIN_MIGRATION.json` permitting exactly one intermediate
   state, and that file is deleted in Phase 8. **[corrected]** The draft's
   unconditional invariant would have made Phase 6 uncommittable.
3. **Frozen literals, split into two kinds.** **[corrected]**
   - *Genuinely sealed, never unify:* `bake/fidelity_catalog.py:25`,
     `bake/hf2a_ocean_benchmark.py:50`, `bake/bake_hf3_steering.py:69` (stamps
     the frozen HF-3 manifest), `bake/binfmt.py:258` (`assert_golden_vector`),
     `bake/test_upper.py:20` and `:125` (the same fixture pattern). Each gains a
     comment saying so.
   - *Live and observed planes, must move with `sources.py`:*
     `bake/public_cycle.py:69` (see §3.8), `bake/satellite_frames.py:22`,
     `bake/validate_satellite_structure.py:17`. `src/render/satellite.ts:10`
     asserts "frame bbox == DOMAIN by construction", so freezing these breaks
     invariant 1.
4. **Sealed records read their own domain.** Every frozen verifier truncates
   against the `protocol.domain` it recorded, never the live `DOMAIN`. A
   domain-driven byte diff in a sealed artifact is fixed by pinning, never by
   resealing.
5. **Freeze before rebake.** HF-6's frozen input copies are made from the
   pre-expansion tree, in their own commit. One-way.
6. **Divergence is content-pinned, not one-bit.** **[corrected]** The draft's
   attestation asserted only that a diverged module *differs* from its frozen
   copy. That is a one-bit predicate: once `src/sim.ts` is declared diverged,
   every later physics edit keeps it diverged and the clause stays green
   forever. Clause 3 must pin the **SHA-256 content** of each diverged module as
   of the seal commit, so any later edit to `sim.ts`, `structure.ts`,
   `steering.ts`, `upper-ocean.ts`, `ventilation.ts`, `coastal-exposure.ts` or
   `hindcast-benchmark.ts` fails the clause and forces a dated re-attestation
   naming what changed. Without that it is not a tamper check and must not be
   described as one.
7. **One-directional holdout inheritance, and no rehabilitation.**
   **[corrected]** A storm seen in any earlier phase may enter a future
   *development* partition only. But a **permanent-test** storm that has been
   contaminated is **not** demoted into a usable tier — it is excluded outright,
   and the compromise is recorded. The draft's ledger would have reclassified
   two permanent-test storms as training data, which is exactly the violation it
   was written to expose. `ROADMAP.md:433-436` prescribes the real remedy: seal
   a new independent test set before making a confirmatory claim.
8. **Twelve-month completeness.** Every `monthIndex` 0–11 resolves to a real
   plane in `env.bin`, `upper.bin` **and** `ocean.bin`.
9. **Raw-cache extent validation.** No fetcher skips on existence alone; no
   consumer extrapolates.
10. **Quantization ranges are asserted, never clipped.**
11. **Device adaptation stops at the byte copy.**
12. **No new text claims cross-build replay identity.**
13. **Instrument changes retire baselines** with a recorded human A/B verdict.
14. **The string and the fact must agree.** `test/fidelity-catalog.test.ts:38`
    asserts the `testPolicy` *string* contains "never used"; it never asserted
    the fact, which is how §8.2's leak survived. A real assertion lands: no
    `partition: "test"` SID may appear in `calibration/results.json`
    `split.calibration`.

---

## 6. Phases

Three seams. Each is its own PR series and could be its own spec if this proves
too large to hold: **A. Decouple and govern** (0–5), **B. Migrate the data**
(6–10), **C. Product and honesty** (11–14).

### Phase 0 — Recon spikes

No repository changes. Five measurements, recorded in a dated note:

1. Pages compression on a file above 10 MB (today's measurement tops out at
   `flowacc.bin`, 4.2 MB — see §10 risk 2).
2. One tiled GMRT request printing returned dimensions.
3. The three HydroSHEDS region URLs (`eu`, `as`, `af`; 127,828,199 B total).
4. One CDS request timing probe.
5. **The offset-bbox forcing spike** from §4.3.

*Verify:* a dated note carrying five measured results.

### Phase 1 — Zero-diff decoupling

- `SCORING_DOMAIN = {50, 70, 15, 27}`, repointing `fidelity.mjs:149`,
  `hf6-verify.mjs:101`, `fidelity-verification.ts:403`,
  `hf2a-ocean-reference.mjs:158`, `hf3-wander-calibration.mjs:88`.
- `RENDER_KM_PER_LAT_DEG = 111`; derive `HALF_DOMAIN_HEIGHT_KM`; delete both
  literals; derive `cloudMetricX` from `DOMAIN`; `camera.ts:60` imports it.
- Restate all four clip-space floors in km at no-op values.
- `MAX_AGE_H = 360`, with §3.2's caveat recorded at the constant.
- Probe `MAX_TEXTURE_SIZE`; add `src/render/texture-fit.ts`. Binarize the
  landmask **before** the majority vote — the two orders do not commute.
- Fix `upper-ocean.ts:567-568`'s `Math.round` half-integer tie by indexing off
  the bbox origin.
- Close all four silent paths from §3.5.

*Verify:* `npm test && npm run calibrate:check && npm run hf6:verify:check &&
npm run hf6:gate:check && npm run hf6:prospective:check && npm run realism:check
&& npm run build`, then **`git status --porcelain calibration docs public/data`
must print nothing.**

### Phase 2 — Freeze HF-6, on the pre-expansion tree

Copy `public/data/terrain.bin` and `ocean.bin` into
`calibration/data/hf6/forcing/`, beside the 16 forcing bins already frozen
there. Write `calibration/hf6-seal.json` with all eight `runtimeReproducibility`
entries carrying **content hashes**, not booleans (invariant 6).

Rewrite `hf6:verify:check` as a four-clause attestation — plain node, no Vite,
no sim: record intact; 24 frozen inputs intact; every declared-diverged module
matches its recorded content hash and every declared-identical module matches
the live tree; verdict still `rejected`.

This is the D4 correction. `hf6-verify.mjs` does not replay a record — it
recomputes 16 hindcasts through `ssrLoadModule` of the live runtime, whose
19-file closure holds six live `DOMAIN` read sites. Freezing bins cannot make it
reproduce. **This is an honest downgrade of what CI asserts, and it is labelled
as one in the model card.** The sealed cohort is no longer recomputable.

*Verify:* green on the pre-expansion tree. Then prove it bites: alter one byte
of the sealed record → clause 1; alter one byte of a frozen input → clause 2
names the path. **[corrected]** The draft's third tamper test
(`git checkout <pre> -- src/sim.ts`) is a no-op on the pre-expansion tree, where
`<pre>` is HEAD. The real divergence test belongs to Phase 8b, which flips the
declarations and re-runs it against a genuine divergence.

### Phase 3 — Governance record and pre-registration, written first

- `ROADMAP.md` break entry.
- **The ERA5 year-pick criterion, pre-registered before the fetch.**
  **[corrected]** The draft treated basin-wide re-picking as a consequence to
  absorb; the criterion itself is domain-shaped and carries Arabian-Sea-fitted
  absolutes. `bake/era5.py:235-244` picks by farthest-point distance over the
  **whole-domain** concatenated u,v field, so over 45–100 °E the selection
  becomes dominated by Bay of Bengal and equatorial monsoon variance.
  `bake/era5.py:48`'s `GENESIS_BELT_LAT_MAX = 19.0` would admit the whole
  0–19 °N equatorial belt against a hardcoded `CALM_BELT_SHEAR_MS = 13.0` and a
  17.0 m/s November-viability gate at `:296`; `_post_monsoon_thermodynamic_rescue`
  is hardwired to November, with no equivalent for the Bay's December peak.
  Recommended definition, to be frozen here: a latitude-banded (5–25 °N),
  cos(lat)-weighted distance, with the belt redefined two-sided and both
  absolutes re-derived and recorded **before** any pick is seen.
- The pre-registered replacement for `test/integration-bins.test.ts:325-397`.
  Its thresholds (`minBelt < 14`; Cat-1 fraction ≥ 0.005; `productivePlanes ≥ 2`)
  came from the old picks and will fail. Re-deriving them after seeing the new
  bake is retuning after scoring.
- Catalogue regeneration guards and the disclaimer-string pin test.
- Invariant 14's real assertion in `test/fidelity-catalog.test.ts`.

*Verify:* all sealed checks green; the guard test hard-fails on a domain
mismatch; the pre-registration commit precedes every fetch commit in
`git log --follow`.

### Phase 4 — Bake hardening at the OLD domain

Delete the literal `DOMAIN` mirrors that should follow `sources.py` —
enumerated: `bake/bake_hf3_steering.py` (its non-manifest uses),
`bake/fetch_era5.py:32`, `bake/fetch_event_benchmark.py:19`,
`bake/fetch_realism_era5.py:19`, `bake/sources.py:39`'s GMRT query string, and
the docstrings at `bake/era5.py:4` and `bake/hydrosheds.py:5`. **Do not touch
the six sealed literals in §5 invariant 3** — they look identical and unifying
them silently rebases two sealed catalogues.

Port `_valid_netcdf` into every fetcher skip path. Streaming download, pre-clip
headroom assert, drop `basin`.

*Verify:* an old-domain rebake is byte-clean. `npm test` after
`npm run assets:manifest`. **[corrected]** `admin1`'s widening moves to Phase 9
with the rest of the regions work, so Phase 4 has one byte-diff cause
(`flowacc`), not two.

### Phase 5 — Reproduction probe, scratchpad only

Tiled GMRT mosaic; ERA5 at `[30, 45, 0, 100]` into new filenames; HydroSHEDS
three-region mosaic with an absolute `ACC_LOG_REFERENCE`.

*Verify:* a written per-asset verdict — bit-identical, N cells differ, or not
reproducible.

### Phase 6 — New extent, **identical year picks**, `DOMAIN` unchanged

**[corrected]** The draft folded this together with the basin-wide re-pick and
then demanded all sealed checks be green. That is impossible:
`calibration/realism/realism.mjs:46-48` reads `public/data/env.bin`,
`terrain.bin` and `ocean.bin`; `calibration/fidelity.mjs:16-17` and
`calibration/hindcast.mjs:264` read `terrain.bin`. D2 changes every env plane,
including at interior points, so the checks cannot be green — and §11's kill
criterion would then fire for the wrong reason, killing a project whose
registration argument was sound.

So this phase grows the extent while **pinning `_pick_sample_years` to the
legacy sub-box**, reproducing the same picked years. Values inside the old box
should be unchanged; only cells outside it are new. Add
`test/domain-subblock.test.ts` pinning old-box sub-block hashes.

*Verify:* `npm run calibrate:check && npm run hf6:verify:check && npm run
hf6:gate:check && npm run realism:check` **all green.** This — and only this —
is the registration proof.

### Phase 7 — Basin-wide re-pick, `DOMAIN` still unchanged

Apply Phase 3's frozen criterion. Every env plane changes. This is the
attributable reseal boundary: drift here is a **value** change, provably not a
registration change, because Phase 6 already proved registration separately.

*Verify:* `calibrate:check` and `realism:check` drift, and the drift is resealed
through §7's permitted flow with the recorded A/B verdict. `hf6:verify:check`
and `hf6:gate:check` stay green — Phase 2 made them independent of the live
bins.

### Phase 8 — Flip `DOMAIN`, camera, and retire the display context

One-line flip in `grid.ts`. Re-derive `steering.ts:71`. Re-anchor the analytic
fallback. Rebake `genesis.json`. Delete `DOMAIN_MIGRATION.json`.

`MIN_ZOOM` collapses to 1, `HOME_VIEW` to the origin, `MAX_ZOOM` rises 8 → 20 to
preserve today's 12.9× terrain-magnification ceiling. The clamp becomes a
**contain** fit: under the current cover fit a 375 × 812 portrait phone would
see 14.3 of 55 degrees of longitude — 26 % of the basin. The terrain pass needs
the out-of-range discard the weather composite already has at `env.ts:761`.

**[corrected]** The display context is deleted **here**, not earlier. At any
earlier phase `grid.ts` still holds the small box while
`config/display-domain.json` holds the larger one, and `camera.ts:45-52` derives
`MIN_ZOOM` and `HOME_VIEW` from `DISPLAY_WORLD` — so an early deletion would
ship a *narrower* map than today for several phases. Deletion work:
`config/display-domain.json`, `src/display-domain.ts`,
`bake/bake_context_terrain.py`, `public/data/context-terrain.bin`, two npm
scripts, **`test/display-domain.test.ts`** (deleted), and
**`test/camera.test.ts`** (rewritten off `DISPLAY_CONTEXT_DOMAIN`, which it uses
in twelve assertions). `npm run assets:manifest` must run and be committed, or
`test/asset-manifest.test.ts:12-15` fails on the hashed
`context-terrain.bin`.

**Phase 8b:** flip the HF-6 divergence declarations to their post-expansion
content hashes and run the real tamper test.

Tests that fail here and are decided individually: the six `666` drift guards
from §3.3, plus `test/satellite-observations.test.ts:45` (which asserts the
literal WMS string `bbox=15%2C50%2C27%2C70`) and `test/grid.test.ts:19-20,43-44,55`.

*Verify:* `npm test`; `npm run profile:ensemble` before and after; a camera unit
test asserting the view bbox contains `DOMAIN` at aspects {0.4618, 1.3333, 1.6,
1.7778}; `npm run assets:manifest` committed.

### Phase 9 — Impact grid and regions

**[corrected]** The draft assumed this work and scheduled none of it.
`src/impact.ts:51-52` hardcodes `GRID_NX = 200; GRID_NY = 120`, which over 55°
gives 0.275° cells and silently breaks the "0.1° (~11 km)" contract in the `:50`
comment and the `regions.json` `grid` sidecar.

Work: `GRID_NX`/`GRID_NY` → 550 × 300; `bake/bake_regions.py:45-47` in lockstep;
`admin1` widened to uint16; `test/integration-bins.test.ts:443-464` updated
(`:449-450` pins 200 × 120, `:461` pins `admin1` uint8, `:466` pins max ≤ 11).

Per D10 the rain-history ring **stays `Float32Array`** (`impact.ts:160-166`).
At 550 × 300 × 96 that is 63.36 MB. Recorded impact output stays exact and no
impact test moves for quantization reasons. The cost lands on Phase 12.

*Verify:* `npm test`; a memory measurement; `regions.json`'s grid sidecar agrees
with `impact.ts`.

### Phase 10 — The twenty scenario bins

Purge the raw ERA5 event cache. Refetch: 45 CDS requests, 31,416 fields, about
425 MB. Windows lengthen because the exit test no longer fires where it did —
measured against `tracks.json`, the ten tracks spent a mean 136.8 h inside the
old box and 223.2 h inside the new one, and 9 of 10 now stay in-box for their
whole IBTrACS life. Planes 752 → 952.

All ten spawns move (D8). `gonu` 16.5 °N/67.1 °E → 13.7 °N/71.6 °E; `vayu`
20.9 °N/68.7 °E → 10.5 °N/72.7 °E; `shaheen` 22.6 °N/68.7 °E → 18.4 °N/94.1 °E,
which is Gulab's Bay of Bengal genesis — Shaheen was Gulab's remnant crossing
India. Seven of ten hindcast initialization fixes also move, most to 35 kt. The
three `sandboxSpawn` overrides bypass `_first_in_domain` and stay put unless
deliberately re-chosen.

`tracks.json` does **not** change (`sources.py:287` keeps every fix regardless of
domain). `genesis.json` keeps its point count — `GENESIS_BOX` is unchanged — but
some positions move.

**The hindcast reseal belongs here, not earlier.** **[corrected]**
`calibration/hindcast.mjs:255,257,264,273` reads `scenarios.json`,
`tracks.json`, `terrain.bin` and the ten event bins this phase rewrites, so a
reseal taken at Phase 7 would be invalidated one phase later. And because
`hindcast-results.json` carries a search *and* an acceptance decision, this
re-run re-scores a rejected candidate on moved initializations. Declared in
advance, per CLAUDE.md's "re-running a gate to flip a verdict invalidates the
whole protocol": **a flip of `accepted` to true does not constitute acceptance
and must not deploy.** If it flips, `deployedParameters` stays `BASELINE`, the
result is recorded as a re-measurement, and the discrepancy is written into the
ROADMAP entry.

*Verify:* every public bin header reports `nx=110 ny=60 bbox=(45,100,0,30)`; the
new `scenarios.test.ts` case rejects a synthetic 40 × 24 bin carrying the right
layer names and `nt`; `test/integration-events.test.ts:206` still passes;
`npm run calibrate:check` green against the resealed numbers;
`npm run assets:manifest` committed.

### Phase 11 — Realism redefinition

Storm-centred window, 800 km half-extent both axes, `REALISM_GRID_N = 256`,
isotropic 6.25 km — 1.92× finer than today. RGR-001 cannot live there (its
`3 × outerSizeKm` exclusion reaches 1260 km) and moves to a coarse domain-wide
field at 352 × 192 (0.15625° both axes) carrying `btProxyC` and `oceanMask`.

The register entry is **not** a presentation A/B. The instrument changed and the
environment under it changed. It states that the previous R2a baseline is
retired, not moved; that no continuity claim is made; and that
`docs/research/realism/captures/` no longer reproduces, being keyed to URL
hashes D7 breaks and a view D5 replaces.

*Verify:* delete the reference, `npm run realism`, record the A/B verdict in
`docs/realism-gap-register.md` **in the same PR**.

### Phase 12 — Runtime memory

**[corrected]** The draft scoped this to `uint8`/`uint16` and missed the whole
win. `src/loader.ts:60-70` dequantizes every dtype to `Float32`, and the largest
arrays are **int16**: `bake/bake.py:70` writes `elev` as int16 (4.776 M cells →
19.10 MB as Float32) and `:126-133` writes all eight env fields as int16.
uint8/uint16 alone recovers about 53.5 MB of 124.

Also unaccounted: `src/ensemble.worker.ts:36-44,66-70` keeps its **own**
`binCache` and re-fetches and re-parses `terrain.bin`, `env.bin`, `ocean.bin`
and the steering bin inside the worker — a second ~60 MB of long-lived typed
arrays.

With Phase 9's 63.36 MB Float32 ring on top, this is the project's real mobile
risk, not a nice-to-have.

*Verify:* `npm test`; a heap measurement before and after; the golden-vector
test unchanged.

### Phase 13 — Measure the leak (D9)

Refit the structure model with the six contaminated SIDs removed from the
calibration split — `2019301N05081`, `2024238N25077`, `2022224N22067`,
`2019296N15066`, `2023156N10067`, `2021267N18094` — then report the direction
and size of the shift in the affected HF-6 structure MAEs
(`hf6-verify.mjs:297-300`) and in the hindcast improvement fraction.

Until it runs, every document says "direction of bias unquantified". The refit
is a **measurement published beside the sealed numbers**, not a replacement for
them: `DEFAULT_STRUCTURE_PARAMETERS` does not change in this project.

*Verify:* the numbers appear in `docs/model-card-hf6.md` and the ROADMAP entry;
invariant 14's assertion is green.

### Phase 14 — Product honesty and the twelve-month unlock

Per-component evidence in the model card. Region vocabulary and flood tiers
scoped. Nearest-city epitaph. Radar bound to the camera bbox.

The twelve-month unlock is more than a picker. **[corrected]**
`src/env-sampler.ts:40-45`'s `envMonthSuffix` clamps to `[4,10]` and CLAUDE.md
warns a wrong suffix falls back silently to the analytic climate. Work:
`envMonthSuffix`; `test/integration-bins.test.ts:148-155` (which pins
`envMonthSuffix(0) === '04'`); the `SEASON` list at `:114,124,157`;
`index.html`'s month picker; **and the second `<select>` at `index.html:449-455`,
the comparison-panel climatology options.** Loosening the clamp before the bake
lands is the one thing that must not happen.

The masthead chip at `index.html:75-77` does **not** change. It is basin-neutral.

*Verify:* `npm test` plus the disclaimer pin test; a manual Bay of Bengal spawn.

---

## 7. Gate and reseal strategy

**[corrected] The draft invented a rule that inverted the repository's own.** It
claimed "a **reference** may be resealed; a contract, catalogue or candidate
selection may not," citing `calibration/README.md:82-87`. That passage says the
opposite. Read directly:

> Frozen artifacts — the contracts, candidate selections, `*-selected`
> snapshots, `fidelity-catalog.json`, **`fidelity-reference.json`**,
> `hf2a-ocean-reference.json`, the HF-6 catalogue and sealed scenarios, and
> `satellite-cloud-validation.json` — were written before the evaluations they
> gate. Regenerating them re-opens the corresponding seal.

Both references are named **among the frozen set**. And the precedent the draft
cited, commit `a037c4a`, never touched `fidelity-reference.json`:
`git log --oneline -- calibration/fidelity-reference.json` returns exactly two
commits, creation and canonicalization. The file has never been resealed.

The mechanism makes it worse. `calibration/fidelity.mjs:717-723` re-derives the
reference only when the file is **absent**, and `:299-368` gates a 5 %
validation regression against it. So "resealing" means deleting the gate and
regenerating it from the very run it is meant to judge, after which
`compareReference` compares the run against itself and passes trivially.

**May be resealed:** `fidelity-results.json` + `docs/fidelity-benchmark.md`;
`hindcast-results.json` + `docs/hindcast-benchmark.md` (Phase 10, with the
no-acceptance declaration); `realism-reference.json` (delete, run, record —
this one has a documented flow at `calibration/realism/README.md:64-76`);
`asset-manifest.json`. Fix `fidelity.mjs:396,469`'s hardcoded "50–70 E" and
"Arabian Sea" prose *before* resealing, or the generated report lies.

**May not be resealed:** every `hf*-acceptance.json`, every catalogue, every
candidate selection, and **`fidelity-reference.json`**. A post-expansion HF-1
validation drift is a measured result to publish in `docs/fidelity-benchmark.md`
and the ROADMAP break entry — not a baseline to move.

**Untouched:** `calibrate:structure`, `hf5:gate:check` and
`hf6:prospective:check` are domain-independent and must not appear in any reseal
PR.

`SCORING_DOMAIN` keeps the catalogues byte-identical, so cohort membership, the
18/6/6 and 7/3 splits and the 144 initializations never move. That byte-identity
**is** the anti-leakage proof. `test/fidelity-catalog.test.ts:59-62` and
`test/hf6-contract.test.ts:36-51` stay exactly as written.

---

## 8. The basin-wide intensity question (D6)

### 8.1 It belongs to HF-7, and HF-7 already exists

**[corrected]** A draft invented a protocol and called it HF-7. That name is
taken. `docs/hf7-realism-charter.md` (written 2026-08-02, 208 lines) defines
HF-7 as the intensity-physics lane, and `ROADMAP.md:523` records it as "drafted,
explicitly not a commitment to run". It already anticipates precisely what D2
forces — its §"Physics-side gaps" cites `src/sim.ts`'s own comment and concludes
that sub-monthly forcing "invalidates the existing monthly-mean-calibrated
constants outright; it is new calibration work, not a parameter nudge."

The charter also states the two rules that decide this project's posture:

> An HF-7 candidate is evaluated against its own newly sealed cohort, never the
> one used to reject HF-2/HF-3/HF-4/HF-6.

> No frozen gate moves to accommodate this work.

So the invented protocol was not merely redundant — it would have drawn and
permanently burnt the sealed cohort that the charter's HF-7 reserves, on a gate
pre-committed to changing nothing. Every SID drawn for a validation, test or
sealed partition is burnt for confirmatory use forever
(`hf2-contract.json:25`, `hf3-contract.json:29`), and §10 risk 8 records that the
eligible pool may only support one clean draw.

**This project therefore draws no cohort and runs no gate.** It delivers the
data foundation HF-7 needs and stops.

### 8.2 What this project owes HF-7

1. **Basin-wide forcing**, with the year-pick criterion frozen in Phase 3
   *before* any pick is seen, so HF-7 inherits a pre-registered environment
   rather than one chosen after the fact.
2. **A recorded invalidation.** `SHEAR_THRESHOLD_MS = 14` and
   `SHEAR_K_KT_PER_H_PER_MS` are calibrated to the old box's monthly-mean shear
   distribution. D2 destroys that premise. CLAUDE.md currently names bake year
   selection as the *data-side lever* for month-specific failures — the very
   thing D2 changes — so the rule is inverted, not merely inconvenient. §9
   amends it. The constants **do not move in this project**; the model card
   records that they are now uncalibrated for the shipped forcing.
3. **`MAX_AGE_H` declared**, not smuggled (§3.2).
4. **A clean pool**, preserved.
5. **The exclusion ledger**, generated not hand-typed, from
   `fidelity-catalog.json`, `scenarios.json`'s `benchmarkPartition`,
   `results.json`'s structure split, and `hf6-case-catalog.json`. Two tiers may
   enter a future development partition; contaminated permanent-test storms
   enter nothing (invariant 7).
6. **One CI change HF-7 will need, flagged now, not made now.**
   `calibration/hindcast.mjs:348-353` asserts the live intensity parameters
   equal *its own* phase's deployed decision, so any future accepting phase
   turns `calibrate:check` permanently red at `:417`. That assertion is a
   deployment-consistency check, not an acceptance threshold, so generalizing it
   to "live parameters match the most recent accepting phase" does not relax a
   gate and does not violate the charter's "no frozen gate moves" rule. It is
   HF-7's change to make, in HF-7's PR, with the HF-2 rejection preserved
   verbatim.

### 8.3 The pre-existing leaks

Confirmed by intersecting the committed files. Of six `partition: "test"` storms
in `fidelity-catalog.json`, two — `2019301N05081` (maha2019) and
`2024238N25077` (asna2024) — appear in `calibration/results.json`'s 28-SID
`split.calibration`, so both contributed fixes to fitting
`DEFAULT_STRUCTURE_PARAMETERS`. `fidelity-catalog.json`'s own `testPolicy` reads
"permanent; never used for parameter selection or acceptance".
`test/fidelity-catalog.test.ts:38` asserts only that the *string* contains
"never used", which is how the fact and the string diverged.

Also: HF-6 sealed storm `2022224N22067` is in the structure calibration split,
so `model-card-hf6.md:31`'s "previously unseen" is stronger than the artifacts
support — disjointness was checked only against the HF-1 fidelity catalogue.
And HF-1 validation storms `kyarr2019` and `biparjoy2023` sit in structure
calibration, `shaheen2021` in structure validation.

**[corrected] "A leak can only flatter a candidate, so the rejection stands
conservatively" is false**, and a draft asserted it. These gates score
*differences*: `hindcast.mjs:343-347` accepts on an improvement fraction;
`fidelity.mjs:299-368` gates a 5 % regression. The leaked storms fed
`DEFAULT_STRUCTURE_PARAMETERS`, a frozen input shared by **both** the baseline
and the candidate arm. A leak that flatters the baseline more than the candidate
depresses the measured improvement and can produce a **false rejection** —
fabricated conservatism. Separately, the sealed-cohort structure MAEs at
`hf6-verify.mjs:297-300` are inflated by the `2022224N22067` leak regardless of
any intensity verdict.

Hence D9: Phase 13 measures the shift rather than asserting its direction.

---

## 9. Governing document amendments

Each lands in the same PR as the change it describes.

- **CLAUDE.md.** Separate the two ideas currently written as one: the hash
  *format* contract stays verbatim (four exact-string assertions in
  `test/rng.test.ts` still enforce it); the *replay* contract gains a
  within-build qualifier. The `SHEAR_THRESHOLD_MS` paragraph gains "domain
  change" as an invalidation trigger, and records that the constants are now
  uncalibrated for the shipped forcing pending HF-7. Product honesty: the
  product is no longer an Arabian Sea simulator. Add §5's invariants.
- **ROADMAP.md.** A dated break entry: the expansion and the basin-wide re-pick
  changed every environment plane and every public scenario spawn; the hash
  format did not change; determinism is a within-build claim. `:442` records
  that this project performs the extension groundwork and that HF-7 remains the
  phase that may act on it, from a rejected baseline. `:549`'s "fixed
  20-by-12-degree Arabian Sea domain" becomes 55 × 30.
- **`docs/hf7-realism-charter.md`** and **`docs/realism-gap-register.md`.**
  **[corrected]** A draft omitted both. The charter gains a section recording
  that the basin-wide forcing and the preserved clean pool now exist, that
  `MAX_AGE_H` joins its frozen-input set, and that the `hindcast.mjs` assertion
  generalization is HF-7's to make. The register's RGR-011 entry gains a note
  that the twelve-month basin-wide `upper.bin` partially addresses it.
- **README.md.** Subtitle, the replay sentence, and the domain paragraph — the
  last two sit two paragraphs apart and must move together.
- **`docs/model-card-hf6.md`.** `:80-81` verbatim plus a pointer to the charter.
  `:75` restated. `:31` qualified per §8.3. The governance section records the
  attestation reframing as a downgrade. Phase 13's measured shift is added when
  it exists.
- **`bake/README.md`.** The `≤ 8.5 MiB` budget is false and is replaced with a
  gzip-on-the-wire statement. Its categories are also wrong today: `ocean.bin`,
  `upper.bin` and `regions.bin` are filed as opt-in while `src/main.ts:790-801`
  fetches all three on first paint — at the new sizes that misfiling hides
  5,970,884 B of gzip, a third of first paint.
- **BINARY-FORMATS.md.** Month range, layer counts, grid dimensions, the retired
  `basin` layer, the `flowacc` headroom note. `:144`'s golden-vector bbox becomes
  "the frozen legacy box, deliberately not the live `DOMAIN`". **The golden hex
  does not change.**
- **`docs/architecture.md`, `docs/README.md`, `calibration/README.md`,
  `calibration/realism/README.md`.**
- **No edits** to `docs/findings-hf1-hf6.md`, the operational-readiness audit, or
  any prior spec. Their claims were true when written; the dated ROADMAP entry is
  where they become historical.

---

## 10. Open risks

1. **First paint is 6.3× heavier** — 18.39 MiB, 15.4 s at 10 Mbit/s. No phase
   fixes it. Levers, re-ranked: split `ocean.bin` per month behind a lazy fetch
   (~5.03 MB gz, the largest line after terrain); a coarse terrain first-paint
   tier; lazy `upper.bin` behind its layer toggle (~922 KB gz — **a real code
   change**, since it has a runtime consumer). Each is a format or loader change
   and none is scoped here.
2. **Pages compression above 4.2 MB is UNVERIFIED.** New `terrain.bin` is
   14.3 MB, `flowacc.bin` 19.1 MB. If compression stops at a threshold, first
   paint is about 46 MiB, not 18.4 MiB. Phase 0 measures it.
3. **Runtime memory is the likelier mobile failure.** Phase 12 plus Phase 9's
   63.36 MB ring; ~156 MB main thread plus ~60 MB in the worker.
4. **GMRT tiling is unproven.** Phase 0 issues the request. If `med` cannot tile
   to a seamless 1.923 km mosaic, D1's premise fails.
5. **Offset-bbox forcing is unprecedented** (§4.3). If the spike fails, the
   calibration data budget is unsolved.
6. **The demo storm will probably break.**
   `test/integration-bins.test.ts:544-587` pins `DEMO_SEED = 1727` to a
   multi-day Omani landfall. Re-select through `npm run calibrate:demo`; do not
   relax the assertions.
7. **`flowacc` uint16 headroom is 3.2 %.** The bake must raise, not clip.
8. **The clean pool may not support one draw**, let alone two. This project
   preserves it but does not measure it. `data/raw/ibtracs.NI.csv` is gitignored
   and absent, so the eligible count is UNVERIFIED.
9. **Repository weight** — `public/data` to about 213 MiB, `calibration/data` to
   about 150 MiB even with subwindows.
10. **This spec is large.** Fourteen phases across three seams. If it proves
    unholdable, split at the seams in §6 and give each its own spec.

---

## 11. Kill criteria

- GMRT cannot deliver a seamless ~1.9 km mosaic over the box (Phase 0).
- **Phase 6** cannot make the sealed checks green with new-extent assets, the
  legacy year picks, and the old `DOMAIN`. **[corrected]** The draft applied this
  test to a phase that also re-picked the years, where failure proves nothing —
  a value change and a registration failure would be indistinguishable. Phase 6
  isolates registration, so a red check there is a genuine kill.
- Pages does not compress the large bins and no lever brings first paint under
  about 25 MiB.
- The offset-bbox forcing spike fails and no alternative keeps
  `calibration/data` committable.
