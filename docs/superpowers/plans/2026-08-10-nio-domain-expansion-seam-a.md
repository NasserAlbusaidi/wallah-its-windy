# Northern Indian Ocean domain expansion — Seam A implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the five meanings of `DOMAIN`, freeze what must be frozen, harden the bake, and measure the four unverified assumptions — all without changing a single committed byte of baked data or calibration output.

**Architecture:** Seam A is the first of three plans derived from [the nio-v1 design spec](../specs/2026-08-09-nio-domain-expansion-design.md). It touches only `src/`, `test/`, `bake/`, `calibration/` scripts and documentation. The domain constant does **not** move in this plan; Seam B moves it. The organising idea is that every change here is provably zero-diff against committed data, so that when Seam B does change the data, every resulting diff has exactly one cause.

**Tech Stack:** Vite, vanilla TypeScript, WebGL2, vitest, and an offline Python bake pipeline invoked through `node bake/run-python.mjs`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Zero runtime dependencies.** `package.json` has no `dependencies` block and must not gain one. Dev dependencies are vite, typescript and vitest only. Even `@types/node` is avoided — see the scoped shim at `test/node-fs.d.ts`.
- **Node 24.18.0** is the CI version (`.github/workflows/deploy.yml`). Most `calibration/*.mjs` load `.ts` through an in-process Vite server and run on plain `node`; only `calibration/run.mjs`, `bake/hf6_prospective.mjs` and `bake/live_archive.mjs` import `.ts` statically and need `node --experimental-strip-types`.
- **Python runs through `node bake/run-python.mjs`**, which resolves the repository venv and never falls back to a system interpreter.
- **Determinism.** `src/sim.ts` contains no `Math.random` and no `Date.now`. All randomness flows through the seeded mulberry32 stream in `src/rng.ts`. Physics advances in fixed 15-sim-minute steps and never reads device traits or the clock.
- **The golden hex vector does not change.** `BINARY-FORMATS.md`, `test/loader.test.ts` ("loader: parses the golden vector to exact values") and `bake/binfmt.py`'s `assert_golden_vector` are a matched set and stay as they are.
- **Machine-generated reports are never hand-edited** — `docs/fidelity-benchmark.md`, `docs/hindcast-benchmark.md`, `docs/structure-calibration.md`, `docs/hf6-scorecard.md`, `docs/realism-benchmark.md`. Regenerate via the script.
- **Product-honesty strings are never dropped or shortened.** The masthead chip at `index.html` keeps "interactive cyclone simulator · research prototype — not official guidance". Simulated products stay labelled simulated. Ensemble output is never renamed to "probability".
- **Conventional commits. No AI attribution** — no `Co-Authored-By` trailer, no "generated with" line.
- **The zero-diff gate.** Phase 1's acceptance test is that `git status --porcelain calibration docs public/data` prints nothing. Phases 0 and 3 deliberately commit documentation, so their gate is `git status --porcelain calibration public/data` only. Phase 4 changes `flowacc.bin` for exactly one named cause and nothing else.
- **Do not unify the six frozen bake-side domain literals** (`bake/fidelity_catalog.py`, `bake/hf2a_ocean_benchmark.py`, `bake/bake_hf3_steering.py`'s manifest stamp, `bake/binfmt.py`'s golden vector, `bake/test_upper.py` ×2). They look identical to the ones Phase 4 does unify. Task P4-1 classifies every hit before touching any of them.

## Contingency

Phase 0 measures four things the rest of the project assumes. Three of its five measurements can fire a kill criterion from spec §11. **Seam B is not planned in detail until Phase 0 returns**, because its tasks would otherwise be written on top of unmeasured assumptions: whether GitHub Pages compresses a `.bin` above 10 MB, whether GMRT can tile to ~1.9 km over the box, and whether a forcing bin with an offset bbox produces identical physics.

## Open decision carried into Seam B

**`src/tracks.ts:126` is a scoring site and a runtime path at the same time**, and neither the spec nor this plan resolves it. The line reads `if (!inBBox(p.lat, p.lon, DOMAIN)) continue;`, filtering observed track fixes against the *live* `DOMAIN`. `parseTracks` feeds it to `calibration/fidelity.mjs`, `calibration/hf3-wander-calibration.mjs` and the hindcast path — so it behaves like the six sites Task 1 repoints to `SCORING_DOMAIN`. But `src/main.ts` and the UI consume the same parsed tracks, so pinning it to the old box would permanently hide observed fixes outside 50–70 °E / 15–27 °N from the shipped app, on a map that now covers the whole basin.

The two readings pull opposite ways: pin it and scoring stays stable while the product lies about where storms went; leave it live and the map tells the truth while every sealed score that consumes `parseTracks` moves at the flip. The likely answer is to split the function — a live-domain reader for the UI and a `SCORING_DOMAIN` reader for calibration — but that is a design decision, not a mechanical one.

**It is not safe to defer past the domain flip.** Decide it before Seam B's Phase 8.

---

## Phase 0 — Recon spikes (nio-v1 northern Indian Ocean domain expansion)

Phase 0 changes no code, no data and no calibration artifact. It runs five independent measurements and writes them into one dated note at `docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md`, which is the ONLY file this phase commits. The five measurements are: (M1) whether GitHub Pages gzips a .bin above 10 MB, (M2) whether GMRT can deliver ~2 km terrain over 45–100 °E / 0–30 °N, (M3) the byte cost of the three HydroSHEDS regions, (M4) how long one CDS request actually queues, and (M5) whether a forcing bin whose header bbox is a genuine subwindow produces the same physics as a full-extent bin — the pattern the design spec calls unprecedented in this repository. A reviewer knows Phase 0 worked when the note has no `UNMEASURED` placeholders left, every number in it is reproducible from the command printed beside it, and `git status --porcelain calibration public/data src test bake` prints nothing while `git log --stat` shows the note as the only file touched. Three of the five measurements can fail in a way that fires a kill criterion from spec §11; the note's final Verdicts table states, for each, whether it fired.

**Files in this phase:**

```
docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md — the ONLY committed file; carries all five measurements plus the verdict/kill-criteria roll-up
tmp/phase0/prior-probes/ — gitignored parking for the untracked GMRT/HydroSHEDS/WOA probe files already sitting in the worktree (evidence, not deliverables)
tmp/phase0/nc-header.mjs — gitignored: prints a GMRT netCDF-3 header (dimension, x_range, y_range, spacing) with zero dependencies
tmp/phase0/pages-probe/site/ — gitignored: the five synthetic .bin probe files pushed to a throwaway Pages repo for M1
tmp/phase0/cds_probe.py — gitignored: one timed CDS request for M4
tmp/phase0/crop-bin.mjs — gitignored: crops every layer of a WIWB .bin to a cell-aligned subwindow, writing the subwindow bbox into the layer headers
tmp/phase0/offset-bbox-spike.mjs — gitignored: runs one scenario through the full-extent bin and through the cropped bin and diffs the two flight-recorder tapes
tmp/phase0/bins/ — gitignored: the cropped .bin files the spike writes
```

### Task 1: Clear the worktree and create the recon note skeleton

**Files:**

```
Create: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
Create: tmp/phase0/prior-probes/ (gitignored, holds moved files)
Modify: nothing else. docs/README.md is deliberately NOT touched — see step 2.
```

**Consumes:** nothing

**Produces:** The note file `docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md` with section headings `## M1` .. `## M5` and `## Verdicts`. Every later task edits exactly one of those sections. The placeholder token every later task must remove is the literal string `UNMEASURED`.

- [ ] **Step 1: See the dirty worktree before touching anything**

Run from the repository root:

```bash
git -C /d/personal/wallah-its-windy status --porcelain
```

*Expected:* Exactly these eight untracked entries, in this order (they are leftovers from the 2026-08-09 design session, not part of the build):

```
?? gmrt_50_70_15_27_med.nc
?? gmrt_s_high.nc
?? gmrt_s_low.nc
?? gmrt_s_max.nc
?? gmrt_small.nc
?? hs/
?? woa_new.nc
?? woa_old.nc
```

If the list differs, stop and reconcile before continuing — Phase 0's whole gate is that it commits one file and nothing else.

- [ ] **Step 2: Park the untracked probe artifacts under tmp/ (which is gitignored)**

`tmp/` is on line 8 of `.gitignore`, so anything moved there disappears from `git status`. These files are real evidence for M2 and M3, so they are moved, not deleted.

```bash
cd /d/personal/wallah-its-windy
mkdir -p tmp/phase0/prior-probes
mv gmrt_50_70_15_27_med.nc gmrt_small.nc gmrt_s_low.nc gmrt_s_high.nc gmrt_s_max.nc woa_new.nc woa_old.nc hs tmp/phase0/prior-probes/
git status --porcelain
ls -la tmp/phase0/prior-probes
```

*Expected:* `git status --porcelain` prints NOTHING. `ls` shows seven .nc files plus an `hs` directory, with `gmrt_s_max.nc` at 286,089,812 bytes and `hs/hyd_eu_dir_30s.zip` at 12,603,455 bytes.

- [ ] **Step 3: Create the note directory and write the full skeleton**

Create `docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md` with exactly this content. Do not shorten the field lists — later phases read these fields by name.

```markdown
# nio-v1 Phase 0 — recon measurements

Date: 2026-08-10.
Repository commit at measurement time: `UNMEASURED`.
Spec under test: `docs/superpowers/specs/2026-08-09-nio-domain-expansion-design.md` §6 Phase 0.
Status: in progress.

This note records measurements only. Phase 0 changes no code, no baked data and
no calibration artifact; this file is the only thing it commits. Every number
below is reproducible from the command printed beside it. A field still reading
`UNMEASURED` has not been measured and must not be cited.

## Environment

| Field | Value |
| --- | --- |
| OS | `UNMEASURED` |
| `node --version` | `UNMEASURED` |
| `bake/.venv` python version | `UNMEASURED` |
| `curl --version` (first line) | `UNMEASURED` |
| Operator | `UNMEASURED` |

## M1 — GitHub Pages compression above 10 MB

Spec risk 2 and kill criterion 3. Today's largest deployed `.bin` is
`public/data/flowacc.bin` at 4,168,680 raw bytes, so nothing above ~4.2 MB has
ever been measured on the wire. The projected new assets are 14,328,784
(`terrain.bin`) and 19,105,072 (`flowacc.bin`).

Probe host: `UNMEASURED`

| Probe size (raw B) | Stands for | `Content-Encoding` | Wire `Content-Length` | Ratio |
| --- | --- | --- | --- | --- |
| 4,168,680 | today's `flowacc.bin` (control) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 9,437,184 | 9 MiB, below the suspected cut | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 10,485,760 | 10 MiB, at the suspected cut | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 14,328,784 | projected new `terrain.bin` | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |
| 19,105,072 | projected new `flowacc.bin` | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` |

Live control (the real deployed file, same day): `UNMEASURED`
Compression threshold bracket: `UNMEASURED`
First paint implied by this result, gz bytes on the wire: `UNMEASURED`
Verdict: `UNMEASURED`

## M2 — GMRT over the new box

Spec §3.6 and kill criterion 1. Target grid is 2860 × 1670, i.e. exactly
55/2860 = 0.019230769230769232 ° per column and 30/1670 =
0.017964071856287425 ° per row — bit-identical to today's 20/1040 and 12/668.

Prior evidence, from the untracked probes moved to `tmp/phase0/prior-probes/`:

| Request | Box | `dimension` | spacing lon/lat (°) |
| --- | --- | --- | --- |
| `resolution=med` | 20 × 12 | `UNMEASURED` | `UNMEASURED` |
| `resolution=med` | 5 × 4 | `UNMEASURED` | `UNMEASURED` |
| `resolution=high` | 5 × 4 | `UNMEASURED` | `UNMEASURED` |
| `resolution=max` | 5 × 4 | `UNMEASURED` | `UNMEASURED` |

New measurements:

| Request | URL | HTTP | Bytes | `dimension` | `x_range` | `y_range` | spacing | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tile A, med, 11 × 10 | `UNMEASURED` | | | | | | | |
| tile B, med, 11 × 10, adjacent east | `UNMEASURED` | | | | | | | |
| full box, high | `UNMEASURED` | | | | | | | |
| full box, max | `UNMEASURED` | | | | | | | |

Columns needed per 11 ° tile: 572. Rows needed per 10 ° tile: 557.
Is `resolution=med` a hard 1140-column cap? `UNMEASURED`
Tile seam — overlap or gap, in degrees: `UNMEASURED`
Do adjacent tiles share a spacing? `UNMEASURED`
Projected 15-tile wall clock and bytes: `UNMEASURED`
Can one single request cover the whole box at sufficient resolution? `UNMEASURED`
Verdict: `UNMEASURED`

## M3 — HydroSHEDS region downloads

Spec §6 Phase 0 item 3 claims 127,828,199 B total. `bake/hydrosheds.py:25-34`
fetches only the `eu` region today; the new box needs `af` and `as` as well.

| Region | Kind | URL | HTTP | `Content-Length` | `last-modified` |
| --- | --- | --- | --- | --- | --- |
| af | dir | `UNMEASURED` | | | |
| af | acc | `UNMEASURED` | | | |
| as | dir | `UNMEASURED` | | | |
| as | acc | `UNMEASURED` | | | |
| eu | dir | `UNMEASURED` | | | |
| eu | acc | `UNMEASURED` | | | |

Sum of the six: `UNMEASURED`
Agrees with the spec's 127,828,199 B? `UNMEASURED`
Raster bounds per region (from the already-downloaded dir zips): `UNMEASURED`
Does the union cover 45–100 °E / 0–30 °N with no gap? `UNMEASURED`
Verdict: `UNMEASURED`

## M4 — CDS request timing

One minimal request. This is a sample of one; CDS queue depth varies by hour and
by dataset, so the number below is an order of magnitude, not a service level.

| Field | Value |
| --- | --- |
| Credentials present before the probe | `UNMEASURED` |
| Dataset | `UNMEASURED` |
| Request dict | `UNMEASURED` |
| Submit time (UTC) | `UNMEASURED` |
| Completion time (UTC) | `UNMEASURED` |
| Elapsed seconds | `UNMEASURED` |
| Downloaded bytes | `UNMEASURED` |

Projection to Phase 10's 45 event requests: `UNMEASURED`
Projection to the two 12-month × 30-year climatology requests: `UNMEASURED`
Verdict: `UNMEASURED`

## M5 — Offset-bbox forcing spike

Spec §4.3 and kill criterion 4. No physics-forcing bin in this repository has
ever carried a header bbox different from `grid.ts DOMAIN`. This spike builds
one and runs a shipped scenario through it.

Method: `tmp/phase0/crop-bin.mjs` copies each layer's raw payload bytes into a
cell-aligned subwindow and writes the subwindow bbox into the 88-byte layer
records — no requantization, scale and offset untouched.
`tmp/phase0/offset-bbox-spike.mjs` runs `runDetailedHindcastCase` once against
the full-extent bin and once against the cropped bin, on the same interpreter,
and diffs the two flight-recorder tapes.

Declared before measuring, anchored to the repository's own hindcast gate
(`calibration/hindcast.mjs:340-347`, `trackRegressionKm <= 1` and
`maximumIntensityRegressionKt <= 3`):

- PASS — tapes byte-identical, or max track deviation ≤ 1.0 km AND max wind
  deviation ≤ 0.5 kt over the whole run, with landfall and death identical.
- CONDITIONAL — max track deviation ≤ 10 km AND max wind deviation ≤ 3.0 kt.
- FAIL — anything larger, a changed landfall/death outcome, or a throw.

| Field | vayu | hikaa |
| --- | --- | --- |
| Scenario bin | `UNMEASURED` | `UNMEASURED` |
| Full-extent header (nx, ny, bbox) | `UNMEASURED` | `UNMEASURED` |
| Simulated frame bbox | `UNMEASURED` | `UNMEASURED` |
| Crop window applied | `UNMEASURED` | `UNMEASURED` |
| Cropped header (nx, ny, bbox) | `UNMEASURED` | `UNMEASURED` |
| Origin moved (lonMin and/or latMax) | `UNMEASURED` | `UNMEASURED` |
| Cropped bin size, bytes | `UNMEASURED` | `UNMEASURED` |
| `validateEventBinForScenario` return | `UNMEASURED` | `UNMEASURED` |
| Frame count, full vs cropped | `UNMEASURED` | `UNMEASURED` |
| Tapes byte-identical | `UNMEASURED` | `UNMEASURED` |
| Max track deviation, km | `UNMEASURED` | `UNMEASURED` |
| Max wind deviation, kt | `UNMEASURED` | `UNMEASURED` |
| Max central-pressure deviation, hPa | `UNMEASURED` | `UNMEASURED` |
| Max RMW deviation, km | `UNMEASURED` | `UNMEASURED` |
| Landfall identical | `UNMEASURED` | `UNMEASURED` |
| Death identical | `UNMEASURED` | `UNMEASURED` |
| Pure-sampling max |Δ| over the interior lattice | `UNMEASURED` | `UNMEASURED` |
| Pure-sampling points differing at all, of 10201 | `UNMEASURED` | `UNMEASURED` |
| Negative control (zero-margin crop) track deviation, km | `UNMEASURED` | `UNMEASURED` |
| Negative control raised an error | `UNMEASURED` | `UNMEASURED` |

Steering-bin sampling comparison (no sim, `steering_vayu.bin`): `UNMEASURED`
Projected `calibration/data` size with track-following subwindows: `UNMEASURED`
Verdict: `UNMEASURED`

## Verdicts

| # | Measurement | Verdict | Kill criterion | Fired |
| --- | --- | --- | --- | --- |
| M1 | Pages compression above 10 MB | `UNMEASURED` | §11 #3 | `UNMEASURED` |
| M2 | GMRT over the new box | `UNMEASURED` | §11 #1 | `UNMEASURED` |
| M3 | HydroSHEDS bytes | `UNMEASURED` | none | n/a |
| M4 | CDS queue time | `UNMEASURED` | none | n/a |
| M5 | Offset-bbox forcing | `UNMEASURED` | §11 #4 | `UNMEASURED` |

## What Phase 0 did not measure

- `UNMEASURED`
```

*Expected:* The file exists at `docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md`. `grep -c UNMEASURED docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md` prints a number greater than 60.

- [ ] **Step 4: Record the environment block**

```bash
cd /d/personal/wallah-its-windy
git rev-parse HEAD
node --version
curl --version | head -1
```

Write the three outputs plus the OS string into the `## Environment` table and the commit sha into the `Repository commit at measurement time` line. Leave the `bake/.venv` row as `UNMEASURED` — Task 3 creates the venv and fills it in.

Note: the local Node here is v22.23.1 while CI pins 24.18.0 (`.github/workflows/deploy.yml`). That is fine for Phase 0 because M5 compares two runs on the SAME interpreter; record the version so the provenance is explicit.

*Expected:* `git rev-parse HEAD` prints a 40-character sha (`ada2b169bdd0a759f515639ce0372b54e048fa04` if nothing has been committed since this plan was written). The Environment table has four of five rows filled.

- [ ] **Step 5: Commit the skeleton**

docs/README.md is deliberately not edited: `docs/research/realism/README.md`, `docs/research/realism/env-variance-study.md` and `docs/research/realism/literature-anchors.md` are all absent from the index at `docs/README.md:22-35`, so `docs/research/` is an unindexed subtree by existing convention. Adding one row for one new research note would be inconsistent, and Phase 0 promises exactly one committed file.

```bash
cd /d/personal/wallah-its-windy
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git status --porcelain
git commit -m "docs(nio): add Phase 0 recon note skeleton"
```

*Expected:* `git status --porcelain` shows exactly one line, `A  docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md`. The commit succeeds and `git show --stat HEAD` lists one file changed.

---

### Task 2: M1: does GitHub Pages gzip a .bin above 10 MB

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (section `## M1`)
Create: tmp/phase0/pages-probe/site/*.bin (gitignored)
Create (outside this repository): a throwaway public GitHub repository serving those files on Pages
```

**Consumes:** The `## M1` section and the `UNMEASURED` placeholder convention from Task 1.

**Produces:** The filled `## M1` table, the `Compression threshold bracket` line, and a PASS/FAIL verdict that Task 7 copies into the Verdicts table.

- [ ] **Step 1: Record the live control on the real deployed site**

This proves the measuring rig works and pins today's behaviour at 4.2 MB.

```bash
curl -sS -o /dev/null -D - -H "Accept-Encoding: gzip" \
  "https://nasseralbusaidi.github.io/wallah-its-windy/data/flowacc.bin" \
  | grep -iE "^HTTP|content-encoding|content-length|etag"
```

*Expected:* Four lines. Measured 2026-08-10 on this machine:

```
HTTP/1.1 200 OK
Content-Length: 685250
ETag: W/"6a78d37f-3f9be8"
Content-Encoding: gzip
```

`0x3f9be8` is 4,168,680, i.e. the raw size, and 4168680/685250 = 6.08×. Write the whole four-line block into the `Live control` line of `## M1`.

- [ ] **Step 2: Build the five probe files**

The probe content is `public/data/terrain.bin` repeated and truncated. gzip's LZ77 window is 32 KiB, and the repeat period here is 2,084,344 bytes, so the repetition does NOT make the probe artificially compressible — the ratio stays near terrain's own.

```bash
cd /d/personal/wallah-its-windy
mkdir -p tmp/phase0/pages-probe/site
for n in 4168680 9437184 10485760 14328784 19105072; do
  for i in $(seq 1 10); do cat public/data/terrain.bin; done \
    | head -c "$n" > "tmp/phase0/pages-probe/site/probe_$n.bin"
done
ls -l tmp/phase0/pages-probe/site
```

*Expected:* Five files whose byte sizes are exactly 4168680, 9437184, 10485760, 14328784 and 19105072.

- [ ] **Step 3: Confirm the probes are not artificially compressible**

```bash
cd /d/personal/wallah-its-windy/tmp/phase0/pages-probe/site
for f in probe_*.bin; do
  printf "%s raw=%s gz9=%s\n" "$f" "$(stat -c %s "$f")" "$(gzip -9 -c "$f" | wc -c)"
done
```

The reference ratio is terrain.bin's own: 2,084,344 raw → 905,869 gz-9 = 2.30×.

*Expected:* Every line's `raw/gz9` ratio is between 2.2 and 2.5. If any ratio exceeds 3, the probe is compressing better than a real asset would; regenerate it from a different source file and say so in the note.

- [ ] **Step 4: Publish the probes on a throwaway Pages site**

There is no way to measure Pages compression without Pages serving the file, and this repository must not gain a 19 MB probe asset. So the probe goes to a separate, disposable public repository. It contains nothing but repeated bytes of an already-public MIT-licensed asset — no secrets, no personal data.

```bash
cd /d/personal/wallah-its-windy/tmp/phase0/pages-probe/site
git init -b main
git add .
git commit -m "chore: pages compression probe payloads"
gh repo create pages-compression-probe --public --source=. --push
gh api -X POST "repos/NasserAlbusaidi/pages-compression-probe/pages" \
  -f "source[branch]=main" -f "source[path]=/"
```

If the `gh api` call returns 409, Pages is already enabled — continue. If it returns 404, enable Pages once in the repository's Settings → Pages UI (Source: Deploy from a branch, `main`, `/`).

*Expected:* `gh repo create` prints the new repository URL. The `gh api` call returns JSON containing `"html_url": "https://nasseralbusaidi.github.io/pages-compression-probe/"`. Record that URL in the `Probe host` line of `## M1`.

- [ ] **Step 5: Measure each probe on the wire**

Wait for the Pages build to finish (`gh api repos/NasserAlbusaidi/pages-compression-probe/pages/builds/latest --jq .status` prints `built`), then:

```bash
for n in 4168680 9437184 10485760 14328784 19105072; do
  printf "raw=%s " "$n"
  curl -sS -o /dev/null -D - -H "Accept-Encoding: gzip" \
    "https://nasseralbusaidi.github.io/pages-compression-probe/probe_$n.bin" \
    | grep -iE "content-encoding|^content-length" | tr '\n' ' '
  echo
done
```

Run it twice: the first pass may show `x-proxy-cache: MISS`, and a MISS can serve identity while the edge is still filling. Record the SECOND pass.

*Expected:* Five lines. For each, either `Content-Encoding: gzip` with a `Content-Length` around raw/2.3, or no `Content-Encoding` header at all with `Content-Length` equal to the raw size. Fill the five rows of the `## M1` table with exactly what is printed — do not round, do not infer a missing header.

- [ ] **Step 6: Bisect the threshold if one appeared**

If the largest gzipped probe and the smallest identity probe are not adjacent in the list, build and publish one midpoint file and re-measure:

```bash
cd /d/personal/wallah-its-windy/tmp/phase0/pages-probe/site
MID=$(( (LAST_GZIPPED + FIRST_IDENTITY) / 2 ))
for i in $(seq 1 10); do cat ../../../../public/data/terrain.bin; done | head -c "$MID" > "probe_$MID.bin"
git add . && git commit -m "chore: bisect probe" && git push
```

Substitute the two real byte counts for `LAST_GZIPPED` and `FIRST_IDENTITY`. Repeat until the bracket is under 1 MB wide.

*Expected:* A recorded bracket of the form `gzip at N bytes, identity at M bytes, M - N < 1048576`. Write it into the `Compression threshold bracket` line. If every probe gzipped, write `no threshold up to 19,105,072 B`.

- [ ] **Step 7: Compute the implied first paint and the verdict, then tear down**

Spec §4.2 projects first paint at 19,283,792 gz bytes assuming both large bins compress. The two branches, computed from that table:

- Both large bins served gzip → 19,283,792 B = 18.39 MiB (spec's assumption holds).
- Both large bins served identity, everything else gzip → 19,283,792 − 6,222,910 − 3,885,438 + 14,328,784 + 19,105,072 = **42,609,300 B = 40.63 MiB**.
- Nothing compresses at all → 47,841,006 B = 45.62 MiB.

Falsification, stated plainly: **the spec's first-paint budget is falsified if the response for `probe_14328784.bin` or `probe_19105072.bin` carries no `Content-Encoding: gzip` header.** Kill criterion §11 #3 fires when that happens AND no lever from §10 risk 1 brings first paint under ~25 MiB — 40.63 MiB needs 15.6 MiB of levers, and the three named levers total about 12.2 MiB gz (ocean 5.03 + terrain tiering + upper 0.92), so a bare identity result fires the criterion.

Write the `First paint implied by this result` and `Verdict` lines. Then delete the probe:

```bash
gh repo delete NasserAlbusaidi/pages-compression-probe --yes
```

*Expected:* The `## M1` section has no `UNMEASURED` left. `gh repo delete` prints a deletion confirmation, and `curl -sS -o /dev/null -w "%{http_code}\n" https://nasseralbusaidi.github.io/pages-compression-probe/probe_14328784.bin` prints `404`.

- [ ] **Step 8: Commit M1**

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): record Phase 0 M1 Pages compression above 10 MB"
```

*Expected:* `git status --porcelain` shows exactly one modified file, the note. The commit succeeds.

---

### Task 3: M2: GMRT tiling and the 1140-column cap

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (section `## M2`, and the `bake/.venv` row of `## Environment`)
Create: tmp/phase0/nc-header.mjs (gitignored)
Read-only reference: bake/sources.py:37-41 (URL_GMRT), bake/bake_context_terrain.py:61-74 (gmrt_url)
```

**Consumes:** The `## M2` section from Task 1 and the parked probe files at tmp/phase0/prior-probes/ from Task 1 step 2.

**Produces:** The filled `## M2` tables, a yes/no on the 1140-column cap, a seam measurement, and a verdict Task 7 copies. Also fills the `bake/.venv python version` row of `## Environment`.

- [ ] **Step 1: Write a zero-dependency netCDF-3 header reader**

GMRT returns a classic (CDF-1/CDF-2) netCDF whose `dimension`, `x_range`, `y_range` and `spacing` variables carry everything M2 needs. `bake/sources.py:96-98` reads them with `scipy.io.netcdf_file`; this reader avoids needing the venv for the header alone. Create `tmp/phase0/nc-header.mjs`:

```js
// tmp/phase0/nc-header.mjs — print a GMRT netCDF-3 header. Read-only, no deps.
// Usage: node tmp/phase0/nc-header.mjs <file.nc> [...]
import { readFileSync } from 'node:fs';

const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
const pad = (n) => n + ((4 - (n % 4)) % 4);

function header(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 3) !== 'CDF') throw new Error(`${path}: not netCDF-3`);
  const version = b[3];
  let at = 4;
  const i32 = () => { const v = b.readInt32BE(at); at += 4; return v; };
  i32(); // numrecs
  const dims = [];
  { const tag = i32(); const count = i32();
    if (tag === 10) for (let i = 0; i < count; i += 1) {
      const n = i32(); const name = b.toString('ascii', at, at + n); at += pad(n);
      dims.push([name, i32()]);
    } }
  const skipAtts = () => { i32(); const c = i32();
    for (let i = 0; i < c; i += 1) {
      const n = i32(); at += pad(n);
      const type = i32(); const nv = i32(); at += pad(nv * TYPE_BYTES[type]);
    } };
  skipAtts();
  const vars = [];
  { i32(); const c = i32();
    for (let i = 0; i < c; i += 1) {
      const n = i32(); const name = b.toString('ascii', at, at + n); at += pad(n);
      const nd = i32(); for (let k = 0; k < nd; k += 1) i32();
      skipAtts();
      i32(); i32(); // type, vsize
      const begin = version === 2 ? Number(b.readBigInt64BE(at)) : b.readInt32BE(at);
      at += version === 2 ? 8 : 4;
      vars.push({ name, begin });
    } }
  const out = { file: path, bytes: b.byteLength, dims };
  for (const v of vars) {
    if (v.name === 'dimension') out.dimension = [b.readInt32BE(v.begin), b.readInt32BE(v.begin + 4)];
    if (v.name === 'x_range') out.x_range = [b.readDoubleBE(v.begin), b.readDoubleBE(v.begin + 8)];
    if (v.name === 'y_range') out.y_range = [b.readDoubleBE(v.begin), b.readDoubleBE(v.begin + 8)];
    if (v.name === 'spacing') out.spacing = [b.readDoubleBE(v.begin), b.readDoubleBE(v.begin + 8)];
  }
  return out;
}

for (const path of process.argv.slice(2)) {
  console.log(JSON.stringify(header(path)));
}
```

*Expected:* The file exists. Running it on nothing (`node tmp/phase0/nc-header.mjs`) prints nothing and exits 0.

- [ ] **Step 2: Record the prior evidence already in the worktree**

```bash
cd /d/personal/wallah-its-windy
node tmp/phase0/nc-header.mjs \
  tmp/phase0/prior-probes/gmrt_50_70_15_27_med.nc \
  tmp/phase0/prior-probes/gmrt_small.nc \
  tmp/phase0/prior-probes/gmrt_s_high.nc \
  tmp/phase0/prior-probes/gmrt_s_max.nc
```

*Expected:* Four JSON lines. Measured 2026-08-10 with this exact reader:

- `gmrt_50_70_15_27_med.nc` (med, 20 × 12°): `dimension [1140,735]`, `x_range [49.9921875,70.03125]`, `y_range [14.978749268537145,27.012154015337185]`, `spacing [0.017593557945566288,0.01639428439618534]`
- `gmrt_small.nc` (med, 5 × 4°): `dimension [1140,985]`, `spacing [0.004398389486391572,0.004077568830554497]`
- `gmrt_s_high.nc` (high, 5 × 4°): `dimension [2276,1966]`
- `gmrt_s_max.nc` (max, 5 × 4°): `dimension [9103,7857]`, 286,089,812 bytes

Two facts to write into the prior-evidence table and carry forward: `med` returns 1140 columns on BOTH a 20° box and a 5° box, which is the cap the spec claims; and GMRT overshoots the requested box (49.9921875 for a requested 50), so adjacent tiles will overlap, not gap.

- [ ] **Step 3: Fetch one 11 × 10 ° med tile**

URL built exactly like `bake/bake_context_terrain.py:61-74` — the same six query keys as `bake/sources.py:37-41`, only the bounds change. Tile A is the south-west corner of the new box.

```bash
cd /d/personal/wallah-its-windy
mkdir -p tmp/phase0/gmrt
time curl -sS -A "wallah-its-windy-bake/1.0" -w "HTTP %{http_code} %{size_download}B %{time_total}s\n" \
  -o tmp/phase0/gmrt/tile_a.nc \
  "https://www.gmrt.org/services/GridServer?minlongitude=45&maxlongitude=56&minlatitude=0&maxlatitude=10&format=netcdf&resolution=med"
node tmp/phase0/nc-header.mjs tmp/phase0/gmrt/tile_a.nc
```

*Expected:* `HTTP 200` and a JSON header line. If the 1140-column cap holds, `dimension` is `[1140, ~1110-1130]` with `spacing` around `[0.00965, 0.00895]`. The hard pass condition for this tile is `dimension[0] >= 572 && dimension[1] >= 557` — those are 11/0.019230769230769232 and 10/0.017964071856287425 rounded up, i.e. the columns and rows the 2860 × 1670 target grid needs from an 11 × 10 ° tile. Record HTTP, bytes, dimension, x_range, y_range, spacing and seconds in the tile-A row.

- [ ] **Step 4: Fetch the adjacent tile and measure the seam**

```bash
cd /d/personal/wallah-its-windy
time curl -sS -A "wallah-its-windy-bake/1.0" -w "HTTP %{http_code} %{size_download}B %{time_total}s\n" \
  -o tmp/phase0/gmrt/tile_b.nc \
  "https://www.gmrt.org/services/GridServer?minlongitude=56&maxlongitude=67&minlatitude=0&maxlatitude=10&format=netcdf&resolution=med"
node tmp/phase0/nc-header.mjs tmp/phase0/gmrt/tile_b.nc
```

Then compute the seam by hand from the two `x_range` pairs: `seam = tileA.x_range[1] - tileB.x_range[0]`. A positive value is overlap (safe — `bake/sources.py:118-127` resamples by `np.bincount` block mean, so overlapping source points merely contribute twice to the same target cell). A negative value is a gap, which leaves target cells with `cnt == 0` and therefore NaN elevation at `bake/sources.py:125-127`.

*Expected:* `HTTP 200`, a second JSON header line, and a computed seam value. Pass condition: `seam >= 0` AND `|tileA.spacing[0] - tileB.spacing[0]| < 1e-9`. Write the seam in degrees and the spacing comparison into the `Tile seam` and `Do adjacent tiles share a spacing?` lines.

- [ ] **Step 5: Test whether one request can cover the whole box**

The prior evidence shows `high` caps near 2276 columns and `max` near 9103. Over 55° those give 0.0242 °/col and 0.00604 °/col; the target needs 0.019230769230769232 °/col. So `max` would be sufficient in ONE request and `high` would not. Whether the server accepts a 55 × 30 ° box at those resolutions is unknown — measure it.

```bash
cd /d/personal/wallah-its-windy
for r in high max; do
  echo "--- resolution=$r"
  time curl -sS -A "wallah-its-windy-bake/1.0" -w "HTTP %{http_code} %{size_download}B %{time_total}s\n" \
    -o "tmp/phase0/gmrt/full_$r.nc" \
    "https://www.gmrt.org/services/GridServer?minlongitude=45&maxlongitude=100&minlatitude=0&maxlatitude=30&format=netcdf&resolution=$r"
  node tmp/phase0/nc-header.mjs "tmp/phase0/gmrt/full_$r.nc" || head -c 400 "tmp/phase0/gmrt/full_$r.nc"
done
```

If the server refuses, the body is usually an HTML or plain-text error rather than netCDF, which is why the fallback prints the first 400 bytes.

*Expected:* Two outcomes recorded verbatim. Either a JSON header line with `dimension` — and if `dimension[0] >= 2860 && dimension[1] >= 1670`, one request suffices and tiling is optional — or an HTTP status other than 200 with the first 400 bytes of the error body quoted in the note. Do not retry more than twice; record what happened.

- [ ] **Step 6: Create the venv and cross-check one header with the production reader**

The bake reads these files with `scipy.io.netcdf_file`, not with the hand-rolled reader. Confirm the two agree before trusting the numbers.

```bash
cd /d/personal/wallah-its-windy
python -m venv bake/.venv
node bake/run-python.mjs -m pip install -r bake/requirements.txt
node bake/run-python.mjs -c "import sys; print(sys.version)"
node bake/run-python.mjs -c "from scipy.io import netcdf_file; f=netcdf_file('tmp/phase0/gmrt/tile_a.nc','r',mmap=False); print([int(v) for v in f.variables['dimension'].data], [float(v) for v in f.variables['x_range'].data], [float(v) for v in f.variables['y_range'].data])"
```

Write the python version into the `bake/.venv python version` row of `## Environment`.

*Expected:* pip installs numpy, scipy, h5py, rasterio and Pillow. The scipy readout prints the SAME `dimension`, `x_range` and `y_range` as `nc-header.mjs` did for tile A. If they disagree, the hand-rolled reader is wrong and every M2 number must be re-taken with scipy.

- [ ] **Step 7: Write the M2 verdict**

Fill the remaining lines:

- `Is resolution=med a hard 1140-column cap?` — yes only if tile A and tile B both returned exactly 1140 columns despite an 11 ° width, matching the 20 ° and 5 ° prior probes.
- `Projected 15-tile wall clock and bytes` — 15 × (tile A seconds) and 15 × (tile A bytes), stated as a projection from two samples.
- `Can one single request cover the whole box at sufficient resolution?` — from the previous step.
- `Verdict` — PASS when the med tiles clear 572 × 557 and the seam is non-negative; also PASS (cheaper path) when the single full-box request clears 2860 × 1670. FAIL when neither holds.

Kill criterion §11 #1 fires only on FAIL. Record explicitly that `bake/sources.py:90-130`'s `load_terrain` assumes exactly one netCDF and must learn to mosaic — that is Phase 5 work this measurement scopes, not Phase 0 work.

*Expected:* The `## M2` section has no `UNMEASURED` left, and the verdict line reads PASS or FAIL with the deciding numbers quoted inline.

- [ ] **Step 8: Commit M2**

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): record Phase 0 M2 GMRT tiling measurements"
```

*Expected:* `git status --porcelain` shows exactly one modified file (`bake/.venv` is gitignored on line 3 of `.gitignore`, `tmp/` on line 8). The commit succeeds.

---

### Task 4: M3: the three HydroSHEDS region URLs

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (section `## M3`)
Read-only reference: bake/hydrosheds.py:25-34 (URL pattern), bake/hydrosheds.py:49-73 (_read_domain)
```

**Consumes:** The `## M3` section from Task 1; the parked `tmp/phase0/prior-probes/hs/` zips from Task 1 step 2; the `bake/.venv` created in Task 3.

**Produces:** Six recorded `Content-Length` values, their sum, a comparison against the spec's 127,828,199 B, and per-region raster bounds proving coverage of 45–100 °E / 0–30 °N.

- [ ] **Step 1: HEAD all six URLs**

The pattern is `bake/hydrosheds.py:25-34` with the region code substituted: `hydrosheds-v1-dir/hyd_<r>_dir_30s.zip` and `hydrosheds-v1-acc/hyd_<r>_acc_30s.zip`. `bake/hydrosheds.py` fetches only `eu` today.

```bash
for r in af as eu; do
  for k in dir acc; do
    printf "%s %s " "$r" "$k"
    curl -sSIL "https://data.hydrosheds.org/file/hydrosheds-v1-$k/hyd_${r}_${k}_30s.zip" \
      | grep -iE "^HTTP/|^content-length|^last-modified" | tr '\n' ' '
    echo
  done
done
```

*Expected:* Six lines, each `HTTP/1.1 200 OK` with a `Content-Length` and a `last-modified`. Anchor verified 2026-08-10: `eu dir` is `Content-Length: 12603455`, which matches the already-downloaded `tmp/phase0/prior-probes/hs/hyd_eu_dir_30s.zip` byte-for-byte. If your `eu dir` number is not 12,603,455, the tooling or the upstream file changed — say so in the note rather than proceeding. Fill all six rows of the `## M3` table.

- [ ] **Step 2: Sum the six and compare against the spec**

Add the six `Content-Length` values. Write the sum into `Sum of the six`, then compare against the spec's claimed 127,828,199 B and write `yes` / `no, differs by N bytes` into the next line.

Also record the sub-sums (three dir, three acc) separately in the note text — the spec sentence says "the three HydroSHEDS region URLs" but names six files' worth of data, so the sub-sums let a later reader tell which set the 127,828,199 figure referred to.

Anchor already on disk from the design session: `af dir` 14,601,343, `as dir` 12,215,300, `eu dir` 12,603,455, sum of the three dir zips 39,420,098. If that holds, the three acc zips must total 88,408,101 for the spec's figure to be the six-file sum.

*Expected:* A recorded sum, a recorded three-dir sub-sum and a recorded three-acc sub-sum, and an explicit yes/no against 127,828,199.

- [ ] **Step 3: Prove the three regions actually cover the new box**

`bake/hydrosheds.py:66-72` windows each raster by `sources.DOMAIN`; a region that does not reach the requested bounds yields a short window rather than an error. Read the real bounds from the dir zips already on disk (no new download).

```bash
cd /d/personal/wallah-its-windy
node bake/run-python.mjs -c "
import rasterio
for r in ('af','as','au','eu'):
    p = f'zip://tmp/phase0/prior-probes/hs/hyd_{r}_dir_30s.zip!hyd_{r}_dir_30s.tif'
    with rasterio.open(p) as src:
        print(r, src.bounds, src.width, src.height)
"
```

Then check by hand whether the union of the af/as/eu boxes contains 45–100 °E and 0–30 °N with no interior gap. `au` is included in the printout only because it was already downloaded; state in the note whether it turns out to be needed.

*Expected:* Four lines of the form `eu BoundingBox(left=..., bottom=..., right=..., top=...) W H`. Write the three (or four) bounds into the `Raster bounds per region` line and a yes/no plus the gap coordinates, if any, into `Does the union cover 45–100 °E / 0–30 °N with no gap?`. If a gap exists, name the extra region code needed — that is a Phase 5 input.

- [ ] **Step 4: Write the M3 verdict and commit**

M3 has no kill criterion attached. Verdict is PASS when all six URLs return 200 with a Content-Length and the union of bounds covers the box; otherwise FAIL naming the missing piece. Note the download cost the recorded sum implies for Phase 5, and that `bake/hydrosheds.py:49-73` currently hardcodes one region and one tif name per kind and must learn to mosaic.

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): record Phase 0 M3 HydroSHEDS region byte totals"
```

*Expected:* The `## M3` section has no `UNMEASURED` left. `git status --porcelain` shows exactly one modified file. The commit succeeds.

---

### Task 5: M4: one CDS request timing probe

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (section `## M4`)
Create: tmp/phase0/cds_probe.py (gitignored)
Read-only reference: bake/fetch_era5.py:1-24 (prereqs), :32-38 (AREA/GRID/LEVELS), :198-239 (client setup and retrieve loop)
```

**Consumes:** The `## M4` section from Task 1; the `bake/.venv` created in Task 3.

**Produces:** A measured queue-plus-download time for one minimal ERA5 request at the NEW area `[30, 45, 0, 100]`, and the projection to Phase 10's 45 requests.

- [ ] **Step 1: Check whether the credentials exist — without reading them**

`bake/fetch_era5.py:3-8` documents a one-time human prerequisite: a `~/.cdsapirc` holding a personal access token, plus a licence acceptance on the CDS website. That file is a credential. Check only for its existence; never print, copy or edit its contents.

```bash
test -f "$USERPROFILE/.cdsapirc" && echo "cdsapirc: present" || echo "cdsapirc: ABSENT"
```

*Expected:* One of the two strings. Measured 2026-08-10 on this machine: `cdsapirc: ABSENT`. Write the result into the `Credentials present before the probe` row.

If ABSENT: M4 is blocked on a human step that must not be automated. Ask the repository owner to create the CDS account, accept the "Licence to use Copernicus Products" on the ERA5 pressure-levels dataset page, and write `~/.cdsapirc` themselves. Do not offer to type or store the token. If it stays absent, record M4's verdict as `BLOCKED — no CDS credentials at measurement time`, fill the remaining M4 rows with `BLOCKED`, and skip to the commit step; M4 carries no kill criterion, so Phase 0 still completes with four of five measured, provided the `## What Phase 0 did not measure` section says so.

- [ ] **Step 2: Install cdsapi into the repository venv**

`cdsapi` is intentionally absent from `bake/requirements.txt` (it is a human-prereq tool, not a bake dependency). `bake/.venv` is gitignored, so installing there changes no committed byte.

```bash
cd /d/personal/wallah-its-windy
node bake/run-python.mjs -m pip install cdsapi
node bake/run-python.mjs -c "import cdsapi; print(cdsapi.__version__)"
```

*Expected:* pip reports a successful install and the version line prints a version string. Record the version in the note's M4 free text.

- [ ] **Step 3: Write the timing probe**

The smallest request that still exercises the real queue: one variable, one pressure level, one year, one month, at the NEW area. `AREA` is `[N, W, S, E]` per `bake/fetch_era5.py:32`, so the new box is `[30, 45, 0, 100]`. Create `tmp/phase0/cds_probe.py`:

```python
"""tmp/phase0/cds_probe.py — one timed CDS request. Phase 0 M4, throwaway.

Mirrors bake/fetch_era5.py's client setup (:201-204) and request shape
(:40-56), reduced to one variable / one level / one month, at the NEW area.
Run: node bake/run-python.mjs -u tmp/phase0/cds_probe.py
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

import cdsapi

TARGET = Path("tmp/phase0/cds_probe_202006.nc")
DATASET = "reanalysis-era5-pressure-levels-monthly-means"
SPEC = {
    "product_type": "monthly_averaged_reanalysis",
    "variable": ["u_component_of_wind"],
    "pressure_level": ["850"],
    "year": ["2020"],
    "month": ["06"],
    "time": "00:00",
    "area": [30, 45, 0, 100],
    "grid": [0.5, 0.5],
    "data_format": "netcdf",
    "download_format": "unarchived",
}


def main() -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.exists():
        TARGET.unlink()
    client = cdsapi.Client()
    submitted = datetime.now(timezone.utc)
    started = time.monotonic()
    print(f"[submit] {DATASET} at {submitted.isoformat()}", flush=True)
    print(f"[spec]   {SPEC}", flush=True)
    client.retrieve(DATASET, SPEC, str(TARGET))
    elapsed = time.monotonic() - started
    finished = datetime.now(timezone.utc)
    print(f"[done]   {finished.isoformat()}")
    print(f"[result] elapsed_s={elapsed:.1f} bytes={TARGET.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

*Expected:* The file exists. It is not committed — `tmp/` is gitignored.

- [ ] **Step 4: Run the probe once and record the numbers**

```bash
cd /d/personal/wallah-its-windy
node bake/run-python.mjs -u tmp/phase0/cds_probe.py
```

The `-u` flag matches `package.json`'s `data:fidelity:fetch` etc. and keeps cdsapi's queue-status lines unbuffered, so the queue transitions are visible as they happen. Do not re-run it: a second run measures a warm cache, not the queue.

*Expected:* Console output ending in two lines of the form:

```
[done]   2026-08-10T..:..:..+00:00
[result] elapsed_s=<N> bytes=<M>
```

Copy the `[submit]`, `[spec]`, `[done]` and `[result]` values into the six M4 rows. If cdsapi raises, the two commonest causes are printed in `bake/fetch_era5.py:241-242` — licence not accepted, or a stale token; record the exception text verbatim and mark M4 `BLOCKED`.

- [ ] **Step 5: Project the cost and write the verdict**

Fill the two projection lines from the measured `elapsed_s`:

- Phase 10 refetches 45 CDS requests (spec §6 Phase 10). Projection: `45 × elapsed_s`, stated in hours, with the caveat that event requests span days of hourly data and are far larger than this one-month, one-level probe, so this is a floor, not an estimate.
- The climatology needs 2 requests over 30 years × 12 months × 4 levels × 2 variables. State the field count (`bake/fetch_era5.py:40-72` shows the current 7-month shape) and say that no measurement here bounds it.

Verdict is `MEASURED` with the elapsed seconds quoted, or `BLOCKED` with the reason. Add a red flag in the note if `elapsed_s > 3600`: at that rate Phase 10's 45 requests exceed 45 hours and its schedule needs rework.

*Expected:* The `## M4` section has no `UNMEASURED` left (`BLOCKED` is an acceptable terminal value in every row).

- [ ] **Step 6: Commit M4**

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): record Phase 0 M4 CDS request timing probe"
```

*Expected:* `git status --porcelain` shows exactly one modified file. The commit succeeds.

---

### Task 6: M5: the offset-bbox forcing spike

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (section `## M5`)
Create: tmp/phase0/crop-bin.mjs (gitignored)
Create: tmp/phase0/offset-bbox-spike.mjs (gitignored)
Read-only reference: bake/binfmt.py:10-17 (byte layout), src/loader.ts:96-148 (the only reader), src/raster-sampler.ts:12-29, src/grid.ts:81-89 (latLonToCell), src/env-sampler.ts:162-169 (the DOMAIN clamp), src/scenarios.ts:184-202 (validateEventBinForScenario), src/hindcast-benchmark.ts:108-215 (runDetailedHindcastCase), src/steering.ts:98 (375 km annulus ceiling), calibration/hindcast.mjs:340-347 (the tolerance anchors)
```

**Consumes:** The `## M5` section and its pre-declared PASS/CONDITIONAL/FAIL bar from Task 1.

**Produces:** A measured answer to "does a forcing bin with a genuinely offset header bbox reproduce the physics of a full-extent bin", for two scenarios, plus a negative control showing what a too-tight subwindow does. This is the input to spec §4.3's 150 MB `calibration/data` target and to kill criterion §11 #4.

- [ ] **Step 1: Pin the baseline facts the spike depends on**

Confirm the two event bins are uniform 40 × 24 with the full `DOMAIN` bbox, so a crop is the only thing that changes.

```bash
cd /d/personal/wallah-its-windy
node -e "
const fs=require('fs');
for (const p of ['public/data/env_vayu.bin','public/data/env_hikaa.bin','public/data/steering_vayu.bin']) {
  const b=fs.readFileSync(p); const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const lc=dv.getUint8(5); let at=8; const rows=[];
  for (let i=0;i<lc;i++){ let n=''; for(let k=0;k<8;k++){const c=dv.getUint8(at+k); if(c===0)break; n+=String.fromCharCode(c);} 
    rows.push(n+' '+dv.getUint32(at+12,true)+'x'+dv.getUint32(at+16,true)+'x'+dv.getUint32(at+20,true)+' bbox='+[24,32,40,48].map(o=>dv.getFloat64(at+o,true)).join(',')); at+=88; }
  console.log(p, b.byteLength); for (const r of rows) console.log('   ', r);
}"
```

*Expected:* `env_vayu.bin` 1,106,632 bytes with eight layers `sst_05 u_05 v_05 shr_05 shu_05 shv_05 rh_05 ohc_05`, each `40x24x72 bbox=50,70,15,27`. `env_hikaa.bin` 737,992 bytes with the `_08` suffix set, each `40x24x48`. `steering_vayu.bin` 829,976 bytes with `u850 v850 u500 v500 u250 v250`, each `40x24x72`. Write the two `Full-extent header` rows from this.

- [ ] **Step 2: Write the cropper**

Create `tmp/phase0/crop-bin.mjs`. It writes the same 8-byte prefix + 88-byte records that `bake/binfmt.py:78-121` writes, and copies raw payload bytes so no value is requantized — scale and offset are carried through untouched, which is what makes any observed difference attributable to the bbox alone.

```js
// tmp/phase0/crop-bin.mjs — Phase 0 M5 helper, throwaway.
// Crop every layer of a WIWB .bin to a cell-aligned lon/lat subwindow and write
// a new .bin whose layer headers carry the SUBWINDOW bbox. Raw payload bytes
// are copied verbatim: no requantization, scale/offset unchanged.
// Byte layout mirrors bake/binfmt.py:10-17 and src/loader.ts:96-148.
import { readFileSync, writeFileSync } from 'node:fs';

const ELEM_BYTES = { 0: 2, 1: 2, 2: 4, 3: 1, 4: 1 };
const HEADER_PREFIX_BYTES = 8;
const LAYER_RECORD_BYTES = 88;

export function readLayers(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.toString('ascii', 0, 4) !== 'WIWB') throw new Error('bad magic');
  if (dv.getUint8(4) !== 1) throw new Error(`bad version ${dv.getUint8(4)}`);
  const layerCount = dv.getUint8(5);
  const layers = [];
  let at = HEADER_PREFIX_BYTES;
  for (let i = 0; i < layerCount; i += 1) {
    let name = '';
    for (let k = 0; k < 8; k += 1) {
      const c = dv.getUint8(at + k);
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    layers.push({
      name,
      dtype: dv.getUint8(at + 8),
      quant: dv.getUint8(at + 9),
      nx: dv.getUint32(at + 12, true),
      ny: dv.getUint32(at + 16, true),
      nt: dv.getUint32(at + 20, true),
      lonMin: dv.getFloat64(at + 24, true),
      lonMax: dv.getFloat64(at + 32, true),
      latMin: dv.getFloat64(at + 40, true),
      latMax: dv.getFloat64(at + 48, true),
      scale: dv.getFloat64(at + 56, true),
      offset: dv.getFloat64(at + 64, true),
      byteOffset: Number(dv.getBigUint64(at + 72, true)),
      byteLength: Number(dv.getBigUint64(at + 80, true)),
    });
    at += LAYER_RECORD_BYTES;
  }
  return layers;
}

export function cropBin(sourcePath, targetPath, window) {
  const src = readFileSync(sourcePath);
  const cropped = readLayers(src).map((layer) => {
    const dLon = (layer.lonMax - layer.lonMin) / layer.nx;
    const dLat = (layer.latMax - layer.latMin) / layer.ny;
    const c0 = Math.round((window.lonMin - layer.lonMin) / dLon);
    const c1 = Math.round((window.lonMax - layer.lonMin) / dLon);
    const r0 = Math.round((layer.latMax - window.latMax) / dLat);
    const r1 = Math.round((layer.latMax - window.latMin) / dLat);
    if (!(c0 >= 0 && c1 > c0 && c1 <= layer.nx && r0 >= 0 && r1 > r0 && r1 <= layer.ny)) {
      throw new Error(`${layer.name}: window cols[${c0},${c1}) rows[${r0},${r1}) outside ${layer.nx}x${layer.ny}`);
    }
    const nx = c1 - c0;
    const ny = r1 - r0;
    const elem = ELEM_BYTES[layer.dtype];
    const payload = Buffer.allocUnsafe(nx * ny * layer.nt * elem);
    let write = 0;
    for (let t = 0; t < layer.nt; t += 1) {
      for (let r = r0; r < r1; r += 1) {
        const from = layer.byteOffset + ((t * layer.ny + r) * layer.nx + c0) * elem;
        src.copy(payload, write, from, from + nx * elem);
        write += nx * elem;
      }
    }
    if (write !== payload.byteLength) throw new Error(`${layer.name}: wrote ${write} of ${payload.byteLength}`);
    return {
      ...layer,
      nx,
      ny,
      lonMin: layer.lonMin + c0 * dLon,
      lonMax: layer.lonMin + c1 * dLon,
      latMax: layer.latMax - r0 * dLat,
      latMin: layer.latMax - r1 * dLat,
      payload,
    };
  });
  const head = Buffer.alloc(HEADER_PREFIX_BYTES + LAYER_RECORD_BYTES * cropped.length);
  head.write('WIWB', 0, 'ascii');
  head.writeUInt8(1, 4);
  head.writeUInt8(cropped.length, 5);
  let at = HEADER_PREFIX_BYTES;
  let cursor = head.byteLength;
  for (const layer of cropped) {
    head.write(layer.name, at, 8, 'ascii');
    head.writeUInt8(layer.dtype, at + 8);
    head.writeUInt8(layer.quant, at + 9);
    head.writeUInt32LE(layer.nx, at + 12);
    head.writeUInt32LE(layer.ny, at + 16);
    head.writeUInt32LE(layer.nt, at + 20);
    head.writeDoubleLE(layer.lonMin, at + 24);
    head.writeDoubleLE(layer.lonMax, at + 32);
    head.writeDoubleLE(layer.latMin, at + 40);
    head.writeDoubleLE(layer.latMax, at + 48);
    head.writeDoubleLE(layer.scale, at + 56);
    head.writeDoubleLE(layer.offset, at + 64);
    head.writeBigUInt64LE(BigInt(cursor), at + 72);
    head.writeBigUInt64LE(BigInt(layer.payload.byteLength), at + 80);
    cursor += layer.payload.byteLength;
    at += LAYER_RECORD_BYTES;
  }
  writeFileSync(targetPath, Buffer.concat([head, ...cropped.map((l) => l.payload)]));
  return cropped.map(({ payload, ...rest }) => rest);
}
```

*Expected:* The file exists and `node -e "import('./tmp/phase0/crop-bin.mjs').then(m => console.log(Object.keys(m)))"` from the repository root prints `[ 'readLayers', 'cropBin' ]`.

- [ ] **Step 3: Prove the cropper round-trips through the production reader**

Before trusting any physics result, check that `src/loader.ts` — the ONLY .bin reader — accepts the cropped file and reports the subwindow bbox.

```bash
cd /d/personal/wallah-its-windy
node -e "
import('./tmp/phase0/crop-bin.mjs').then(async (m) => {
  const fs = await import('node:fs');
  fs.mkdirSync('tmp/phase0/bins', { recursive: true });
  const headers = m.cropBin('public/data/env_vayu.bin', 'tmp/phase0/bins/roundtrip.bin',
    { lonMin: 62.5, lonMax: 70, latMin: 15.5, latMax: 27 });
  console.log(headers[0].name, headers[0].nx + 'x' + headers[0].ny + 'x' + headers[0].nt,
    [headers[0].lonMin, headers[0].lonMax, headers[0].latMin, headers[0].latMax].join(','));
  console.log('bytes', fs.statSync('tmp/phase0/bins/roundtrip.bin').size);
});"
```

*Expected:* `sst_05 15x23x72 62.5,70,15.5,27` and `bytes 704 + 8*15*23*72*2 = 745,664`. If `cropBin` throws, the window is not cell-aligned — every bound must be a multiple of 0.5 ° offset from the layer bbox.

- [ ] **Step 4: Write the spike**

Create `tmp/phase0/offset-bbox-spike.mjs`. It boots Vite exactly the way `calibration/hindcast.mjs:13-31` and `calibration/hf6-verify.mjs:36-58` do, so it runs the shipped TypeScript under plain `node`.

```js
// tmp/phase0/offset-bbox-spike.mjs — Phase 0 M5, throwaway.
// Run one scenario through its full-extent forcing bin and through a
// cell-aligned SUBWINDOW of the same bin, and diff the two tapes.
// Run from the repository root: node tmp/phase0/offset-bbox-spike.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cropBin } from './crop-bin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = resolve(HERE, 'bins');
mkdirSync(OUT, { recursive: true });

// Largest environmental probe radius in the shipped physics is the steering
// annulus ceiling, 375 km (src/steering.ts:98). That is 3.37 deg of latitude
// and 3.66 deg of longitude at 23 N; add 0.5 deg for the bilinear neighbour and
// round up to the 0.5 deg env cell.
const MARGIN_DEG = 4.5;
const CELL_DEG = 0.5;

const vite = await createServer({
  root: ROOT, appType: 'custom', logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [
  { runDetailedHindcastCase },
  { parseBin },
  { parseScenarios, validateEventBinForScenario },
  { parseTracks },
  { greatCircleKm, DOMAIN },
  { sampleLayerBilinear },
] = await Promise.all([
  vite.ssrLoadModule('/src/hindcast-benchmark.ts'),
  vite.ssrLoadModule('/src/loader.ts'),
  vite.ssrLoadModule('/src/scenarios.ts'),
  vite.ssrLoadModule('/src/tracks.ts'),
  vite.ssrLoadModule('/src/grid.ts'),
  vite.ssrLoadModule('/src/raster-sampler.ts'),
]);

const parseBuffer = (bytes) => parseBin(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const loadBin = async (path) => parseBuffer(await readFile(path));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const snapDown = (v) => Math.floor(v / CELL_DEG) * CELL_DEG;
const snapUp = (v) => Math.ceil(v / CELL_DEG) * CELL_DEG;

const terrain = await loadBin(resolve(ROOT, 'public/data/terrain.bin'));
const scenarios = parseScenarios(JSON.parse(
  await readFile(resolve(ROOT, 'public/data/scenarios.json'), 'utf8')));
const tracks = parseTracks(JSON.parse(
  await readFile(resolve(ROOT, 'public/data/tracks.json'), 'utf8')));
const trackById = new Map(tracks.map((t) => [t.id, t]));

function diff(a, b) {
  const n = Math.min(a.frames.length, b.frames.length);
  let trackKm = 0, windKt = 0, presHpa = 0, rmwKm = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a.frames[i], y = b.frames[i];
    trackKm = Math.max(trackKm, greatCircleKm(x, y));
    windKt = Math.max(windKt, Math.abs(x.vKt - y.vKt));
    presHpa = Math.max(presHpa, Math.abs(
      x.structure.centralPressureHpa - y.structure.centralPressureHpa));
    rmwKm = Math.max(rmwKm, Math.abs(x.structure.rmwKm - y.structure.rmwKm));
  }
  return {
    frames: [a.frames.length, b.frames.length],
    identicalTape: sha(JSON.stringify(a.frames)) === sha(JSON.stringify(b.frames)),
    maxTrackKm: trackKm, maxWindKt: windKt, maxPresHpa: presHpa, maxRmwKm: rmwKm,
    landfallEqual: JSON.stringify(a.firstLandfall) === JSON.stringify(b.firstLandfall),
    deathEqual: JSON.stringify(a.death) === JSON.stringify(b.death),
  };
}

// Pure sampling comparison: no sim, no chaos. 101x101 lattice inset one
// margin inside the crop, every shared layer, plane 0.
function samplingDiff(full, sub, window) {
  const inset = {
    lonMin: window.lonMin + MARGIN_DEG, lonMax: window.lonMax - MARGIN_DEG,
    latMin: window.latMin + MARGIN_DEG, latMax: window.latMax - MARGIN_DEG,
  };
  let worst = 0, differing = 0, points = 0;
  for (const [name, subLayer] of sub.layers) {
    const fullLayer = full.layers.get(name);
    if (!fullLayer) continue;
    for (let i = 0; i <= 100; i += 1) {
      for (let j = 0; j <= 100; j += 1) {
        const lon = inset.lonMin + (inset.lonMax - inset.lonMin) * (i / 100);
        const lat = inset.latMin + (inset.latMax - inset.latMin) * (j / 100);
        const a = sampleLayerBilinear(fullLayer, 0, lat, lon);
        const b = sampleLayerBilinear(subLayer, 0, lat, lon);
        points += 1;
        if (a !== b) { differing += 1; worst = Math.max(worst, Math.abs(a - b)); }
      }
    }
    break; // first shared layer is enough; remove to sweep all eight
  }
  return { points, differing, worst, inset };
}

const report = [];
for (const id of ['vayu', 'hikaa']) {
  const scenario = scenarios.find((s) => s.id === id);
  const track = trackById.get(scenario.ghostId);
  const fullPath = resolve(ROOT, 'public', scenario.bin);
  const full = await loadBin(fullPath);
  const baseline = runDetailedHindcastCase({ scenario, track, environment: full }, terrain);

  const lats = baseline.frames.map((f) => f.lat);
  const lons = baseline.frames.map((f) => f.lon);
  const frameBox = {
    lonMin: Math.min(...lons), lonMax: Math.max(...lons),
    latMin: Math.min(...lats), latMax: Math.max(...lats),
  };
  const window = {
    lonMin: Math.max(DOMAIN.lonMin, snapDown(frameBox.lonMin - MARGIN_DEG)),
    lonMax: Math.min(DOMAIN.lonMax, snapUp(frameBox.lonMax + MARGIN_DEG)),
    latMin: Math.max(DOMAIN.latMin, snapDown(frameBox.latMin - MARGIN_DEG)),
    latMax: Math.min(DOMAIN.latMax, snapUp(frameBox.latMax + MARGIN_DEG)),
  };
  const originMoved = {
    lon: window.lonMin > DOMAIN.lonMin,
    lat: window.latMax < DOMAIN.latMax,
  };

  const subPath = resolve(OUT, `env_${id}_sub.bin`);
  const headers = cropBin(fullPath, subPath, window);
  const sub = await loadBin(subPath);
  const subject = runDetailedHindcastCase({ scenario, track, environment: sub }, terrain);

  // Negative control: zero margin. The storm's probe rings then leave the
  // window and read clamped edge data.
  const tight = {
    lonMin: Math.max(DOMAIN.lonMin, snapDown(frameBox.lonMin)),
    lonMax: Math.min(DOMAIN.lonMax, snapUp(frameBox.lonMax)),
    latMin: Math.max(DOMAIN.latMin, snapDown(frameBox.latMin)),
    latMax: Math.min(DOMAIN.latMax, snapUp(frameBox.latMax)),
  };
  let control = null, controlError = null;
  try {
    const tightPath = resolve(OUT, `env_${id}_tight.bin`);
    cropBin(fullPath, tightPath, tight);
    const tightBin = await loadBin(tightPath);
    control = diff(baseline, runDetailedHindcastCase(
      { scenario, track, environment: tightBin }, terrain));
  } catch (error) {
    controlError = String(error && error.message ? error.message : error);
  }

  report.push({
    id,
    bin: scenario.bin,
    fullHeader: `40x24 bbox=${DOMAIN.lonMin},${DOMAIN.lonMax},${DOMAIN.latMin},${DOMAIN.latMax}`,
    frameBox,
    window,
    tight,
    originMoved,
    subHeader: `${headers[0].nx}x${headers[0].ny} bbox=${headers[0].lonMin},${headers[0].lonMax},${headers[0].latMin},${headers[0].latMax}`,
    subBytes: statSync(subPath).size,
    fullBytes: statSync(fullPath).size,
    validate: validateEventBinForScenario(sub, scenario),
    diff: diff(baseline, subject),
    sampling: samplingDiff(full, sub, window),
    control,
    controlError,
  });
  console.log(`[m5] ${id} done`);
}

await vite.close();
console.log(JSON.stringify(report, null, 2));
```

*Expected:* The file exists. It is not committed.

- [ ] **Step 5: Run the spike and read the result**

```bash
cd /d/personal/wallah-its-windy
node tmp/phase0/offset-bbox-spike.mjs | tee tmp/phase0/m5-report.json
```

What to look at, in order:

1. `originMoved` — at least one of `lon`/`lat` must be `true` for that scenario, otherwise the crop did not move the bbox ORIGIN and the run proves nothing. `vayu` starts at 20.9 N / 68.7 E and should move the lon origin; `hikaa` starts at 20.4 N / 66.1 E and should move the lat origin. If a scenario reports both `false`, record it as SKIPPED with the frame box that caused it and substitute another calibration-partition scenario (`gonu`, `phet`, `nilofar`, `ashobaa`, `mekunu`). Never substitute a `validation`-partition scenario (`kyarr`, `shaheen`, `biparjoy`).
2. `validate` — expect `null`, meaning `validateEventBinForScenario` ACCEPTS a wrong-extent bin. That is spec §3.5 item 1 reproduced, and the note must say so.
3. `diff.identicalTape` — expect `false`. `src/grid.ts:86` computes `col = (lon - bbox.lonMin) / dLon - 0.5`, and `(lon - 50)` and `(lon - 62.5)` round differently in IEEE754 double, so the bilinear weights differ by about 1e-14 even though the cell centres are mathematically identical. A `false` here is not a failure; the pre-declared bar is the deviation, not the hash.
4. `diff.maxTrackKm` / `maxWindKt` — score against the bar declared in the note.
5. `sampling.differing` and `sampling.worst` — this separates "the sampler is exact" from "the sim amplified one ulp". If `differing` is 0, the sampler is bit-exact and any tape difference came from elsewhere; if `differing` is large but `worst` is around 1e-13, the ulp explanation holds.
6. `control` — the zero-margin crop. Expect a materially larger `maxTrackKm` than the margined crop, with `controlError` null: the run does NOT throw, it silently reads clamped data. That is the evidence for spec §5 invariant 1.

*Expected:* Two `[m5] <id> done` lines and a JSON array of two objects. `vayu` should report `frames: [481, 481]` (windowH 213 − envOffsetH 93 = 120 h at 15-minute ticks) and `hikaa` `frames: [373, 373]` (141 − 48 = 93 h). Copy every field into the two columns of the `## M5` table.

- [ ] **Step 6: Add the steering-bin sampling check**

The spike drives `runDetailedHindcastCase` with its default arguments, i.e. the `runHindcastCase` path used by `npm run calibrate:check`. That path passes no `pressureWindSampler`, so a cropped STEERING bin is never exercised by the sim. Cover the sampler half of the question cheaply:

```bash
cd /d/personal/wallah-its-windy
node -e "
import('./tmp/phase0/crop-bin.mjs').then(async (m) => {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
  const { parseBin } = await vite.ssrLoadModule('/src/loader.ts');
  const { sampleLayerBilinear } = await vite.ssrLoadModule('/src/raster-sampler.ts');
  const fs = await import('node:fs');
  const load = (p) => { const b = fs.readFileSync(p); return parseBin(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const w = { lonMin: 62.5, lonMax: 70, latMin: 15.5, latMax: 27 };
  m.cropBin('public/data/steering_vayu.bin', 'tmp/phase0/bins/steering_vayu_sub.bin', w);
  const full = load('public/data/steering_vayu.bin');
  const sub = load('tmp/phase0/bins/steering_vayu_sub.bin');
  let worst = 0, differing = 0, points = 0;
  const L = full.layers.get('u850'), S = sub.layers.get('u850');
  for (let i = 0; i <= 100; i++) for (let j = 0; j <= 100; j++) {
    const lon = 67 + 2 * (i / 100), lat = 20 + 4 * (j / 100);
    const a = sampleLayerBilinear(L, 0, lat, lon), b = sampleLayerBilinear(S, 0, lat, lon);
    points++; if (a !== b) { differing++; worst = Math.max(worst, Math.abs(a - b)); }
  }
  console.log(JSON.stringify({ points, differing, worst }));
  await vite.close();
});"
```

*Expected:* One JSON line, e.g. `{"points":10201,"differing":N,"worst":W}`. Write it into the `Steering-bin sampling comparison` line. If `W` exceeds 1e-6 m/s, stop and investigate: that is far above an IEEE754 rounding artefact and would mean the crop is misaligned.

- [ ] **Step 7: Project the calibration data budget and write the verdict**

From the measured `subBytes / fullBytes` ratio, project spec §4.3's target: `calibration/data` today holds 30 HF-3 steering bins plus 16 HF-6 forcing bins; the spec targets about 150 MB for a basin-wide cohort with subwindows against about 10 MB per storm at full extent. State the measured ratio and the implied per-storm size, and mark the 150 MB target CONTINGENT or SUPPORTED.

Verdict, against the bar declared in Task 1's skeleton:

- PASS → offset-bbox forcing is usable for non-sealed calibration data; kill criterion §11 #4 does not fire.
- CONDITIONAL → usable only with the measured deviation disclosed in the calibration README and in any report derived from subwindow bins; §11 #4 does not fire but Phase 4.3 gains a documented caveat.
- FAIL → §11 #4 fires. `calibration/data` must stay at full extent, and the spec's 150 MB target is unsolved.

Also record, as findings independent of the verdict:

- `validateEventBinForScenario` returned `null` for a wrong-extent bin (`src/scenarios.ts:184-202` checks layer names and `nt` only) — the concrete case spec §5 invariant 1 must close.
- `src/env-sampler.ts:162-164` clamps every sample to `grid.ts DOMAIN`, NOT to the layer's own bbox, before `src/raster-sampler.ts:15-16` clamps again to the layer edge. A subwindow bin therefore has two different clamps acting on the same sample.
- The negative control's deviation and the fact that it raised no error.

*Expected:* The `## M5` section has no `UNMEASURED` left and its verdict line reads PASS, CONDITIONAL or FAIL with the deciding numbers inline.

- [ ] **Step 8: Commit M5**

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): record Phase 0 M5 offset-bbox forcing spike"
```

*Expected:* `git status --porcelain` shows exactly one modified file. The commit succeeds.

---

### Task 7: Verdict roll-up and the Phase 0 gate

**Files:**

```
Modify: docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md (sections `## Verdicts`, `## What Phase 0 did not measure`, and the `Status:` line)
```

**Consumes:** All five verdict lines produced by Tasks 2–6.

**Produces:** The completed note. Nothing downstream depends on new code; Phases 1–14 read this file's fields by the names Task 1 fixed.

- [ ] **Step 1: Fill the Verdicts table**

Copy each measurement's verdict line into the table, then set the `Fired` column:

- M1 → §11 #3 fires when the 14,328,784 or 19,105,072 probe was served WITHOUT `Content-Encoding: gzip` and no §10 risk-1 lever brings the implied first paint under about 25 MiB.
- M2 → §11 #1 fires when neither the med tiles reached 572 × 557 nor a single full-box request reached 2860 × 1670.
- M5 → §11 #4 fires only on a FAIL verdict.
- M3 and M4 have no kill criterion; leave `n/a`.

Then change the header's `Status: in progress.` to `Status: complete.` — or to `Status: complete except M4 (blocked on CDS credentials).` if Task 5 ended BLOCKED.

*Expected:* The Verdicts table has five filled rows and the Status line no longer says `in progress`.

- [ ] **Step 2: Fill the honest-limits section**

Replace the single `UNMEASURED` bullet under `## What Phase 0 did not measure` with at least these, plus anything the operator hit:

```markdown
- A full simulation through a cropped STEERING bin. M5 drives
  `runDetailedHindcastCase` with its default arguments — the
  `runHindcastCase` path used by `npm run calibrate:check` — which passes no
  `pressureWindSampler`, so only the raster sampler was exercised on steering
  layers, not the sim.
- A cropped `terrain.bin` or `ocean.bin`. M5 held both at full extent
  deliberately; spec §4.3 concerns forcing bins only.
- CDS queue behaviour beyond one sample. Queue depth varies by hour and by
  dataset; M4 bounds nothing.
- Whether the GMRT mosaic is seamless after resampling. M2 measured returned
  extents and spacings, not the resampled 2860 x 1670 output;
  `bake/sources.py:90-130` still assumes exactly one netCDF.
- Whether the HydroSHEDS `acc` rasters cover the box. M3 read bounds from the
  already-downloaded `dir` zips only.
- The size of the clean IBTrACS pool (spec §10 risk 8). `data/raw/ibtracs.NI.csv`
  is gitignored and absent from this checkout.
```

*Expected:* The section lists at least six concrete limits and contains no `UNMEASURED`.

- [ ] **Step 3: Prove the note is complete and Phase 0 changed nothing else**

```bash
cd /d/personal/wallah-its-windy
grep -c UNMEASURED docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git status --porcelain calibration public/data src test bake
git status --porcelain
```

*Expected:* `grep -c` prints `0` (grep exits 1 when the count is 0, which is expected — the printed number is what matters). The scoped `git status` prints NOTHING: Phase 0 touched no calibration artifact, no baked asset, no source and no test. The unscoped `git status` shows exactly one modified file, the note.

- [ ] **Step 4: Commit the roll-up**

```bash
cd /d/personal/wallah-its-windy
git add docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md
git commit -m "docs(nio): complete Phase 0 recon note with verdicts"
git log --oneline --stat -6
```

*Expected:* Six commits, each touching exactly `docs/research/nio-domain-expansion/2026-08-10-phase0-recon.md` and nothing else (five if M4 was blocked and folded in). No commit body contains a `Co-Authored-By` trailer or any AI attribution.

- [ ] **Step 5: Report any fired kill criterion before Phase 1 starts**

If the Verdicts table has any `Fired = yes`, stop here and raise it. Spec §11 makes these project-level decisions, not implementation details:

- §11 #1 (GMRT) or §11 #4 (offset bbox) firing invalidates a premise Phases 5 and 10 are built on.
- §11 #3 (Pages compression) firing means the largest product regression in the project is worse than budgeted and §10 risk 1's levers must be scoped before Phase 1, not after Phase 14.

Do not start Phase 1 on a fired criterion without an explicit decision recorded in `ROADMAP.md`.

*Expected:* Either a written statement that no kill criterion fired, or a raised decision naming the criterion, the measured number that fired it, and the spec section it invalidates.


**Unverified in this phase — the implementer must check:**

- No file above 10 MB has ever been deployed from this repository, so M1 cannot be measured against the real site. The plan publishes synthetic probes to a throwaway public repository instead. If the account cannot host a second Pages site, M1 stays unmeasured and spec §10 risk 2 plus kill criterion §11 #3 both stay open — say so in the note rather than inferring the answer from Fastly's documented behaviour.
- `~/.cdsapirc` is ABSENT on this machine (verified 2026-08-10). M4 is therefore blocked on a human credential step that must not be automated: the repository owner creates the CDS account, accepts the Copernicus licence, and writes the file themselves. Never type, echo or store the token.
- The exact returned dimensions of an 11 × 10 ° GMRT tile are unverified — only 20 × 12 ° and 5 × 4 ° boxes were probed (in the leftover files now parked under tmp/phase0/prior-probes/). The 1140-column cap is strongly supported by those two but is confirmed for an 11 ° width only when Task 3 runs.
- Whether GMRT accepts a 55 × 30 ° box at `resolution=max` is entirely unknown. If it does, the spec's 15-tile plan is unnecessary; if the server refuses or truncates, that must be recorded verbatim, not paraphrased.
- M5's PASS bar (≤ 1.0 km track, ≤ 0.5 kt wind) is derived from `calibration/hindcast.mjs:340-347`'s own regression gates, not from an independent physical argument. If the measured deviation lands between the PASS and CONDITIONAL bands, the design owner — not the implementer — decides whether subwindow forcing is acceptable.
- M5's tape-identity check is expected to fail for an arithmetic reason (`src/grid.ts:86` subtracts a different `bbox.lonMin`, so bilinear weights differ by roughly 1e-14). That expectation is reasoned, not measured; if the tapes DO come back byte-identical, the reasoning was wrong and the note should say so plainly rather than quietly recording a pass.
- M5 exercises the env forcing bin only. A cropped steering bin is checked at the sampler level and never driven through the sim, because `runHindcastCase`'s default path passes no `pressureWindSampler`. The HF-6 path (`calibration/hf6-verify.mjs:205-222`) does pass one, and that combination is unmeasured in Phase 0.
- The expected frame counts quoted for vayu (481) and hikaa (373) are computed from `scenario.windowH - hindcast.envOffsetH` at 15-minute ticks. They are arithmetic, not observed; if the storm dies early the loop breaks at `src/hindcast-benchmark.ts:192` and the count is lower. A shorter count is a result to record, not a bug.
- `bake/.venv` does not exist in this checkout. Tasks 3 and 5 create it. If `pip install rasterio` fails on this Windows box, M3's bounds check is blocked; the six HEAD measurements still stand on their own.
- Local Node is v22.23.1 while CI pins 24.18.0. M5's comparison is valid because both runs share one interpreter, but any number in this note must not be cited as a cross-build reproduction claim — CLAUDE.md's determinism section and spec §5 invariant 12 both forbid that framing.

---

## Phase 1, Part A — zero-diff constant derivations (nio-v1 Seam A)

This phase removes five classes of hardcoded domain knowledge from the runtime and the offline scoring scripts, without changing a single computed number. It introduces `SCORING_DOMAIN` (the frozen 50–70 °E / 15–27 °N box that every sealed calibration artifact was written against) and repoints the six sites that currently reach for the live `DOMAIN` when they mean the frozen box; it derives `HALF_DOMAIN_HEIGHT_KM` from `DOMAIN` via a new, deliberately-disagreeing `RENDER_KM_PER_LAT_DEG = 111` and deletes both 666 literals; it derives the world east-west metric from `DOMAIN` and gives `camera.ts` and `render/cloud-motion.ts` one shared owner; it re-aims the six deliberate 666/20-12 drift-guard tests one at a time, with a recorded reason for each; and it restates the four clip-space radius floors in kilometres so a future domain change cannot silently rescale them past `structure.ts`'s 12 km RMW floor. A reviewer knows it worked when, after each task is committed, `npm test`, `npm run build`, `npm run calibrate:check`, `npm run hf6:verify:check`, `npm run hf6:gate:check`, `npm run hf6:prospective:check` and `npm run realism:check` are all green AND `git status --porcelain calibration docs public/data` prints nothing — the check scripts recomputed every sealed number and none moved.

**Files in this phase:**

```
src/scoring-domain.ts — NEW. The frozen 50–70 °E / 15–27 °N scoring box; deliberately never derived from or compared to grid.ts's live DOMAIN.
test/scoring-domain.test.ts — NEW. Pins the four numbers and asserts the module does not import ./grid.
src/fidelity-verification.ts — swaps DOMAIN for SCORING_DOMAIN at the two observed-track truncation sites (lines 407, 413).
calibration/fidelity.mjs — loads /src/scoring-domain.ts; swaps DOMAIN at the track-truncation site (149) and at the recorded verificationProtocol.domain (676).
calibration/hf6-verify.mjs — loads /src/scoring-domain.ts; swaps DOMAIN at the track-truncation site (101).
calibration/hf2a-ocean-reference.mjs — loads /src/scoring-domain.ts; swaps DOMAIN at the track-truncation site (158).
calibration/hf3-wander-calibration.mjs — loads /src/scoring-domain.ts; replaces the four inline 50/70/15/27 literals (88).
src/grid.ts — gains RENDER_KM_PER_LAT_DEG, the derived HALF_DOMAIN_HEIGHT_KM, and worldMetricX; these are the single sources for the render km↔clip mapping and the world anisotropy.
src/render/storm-radii.ts — deletes its 666 literal; imports and re-exports the grid constants; expresses RENDER_RADIUS_FLOOR in km.
src/realism-metrics.ts — deletes its duplicate 666 literal and imports the constant from ./grid (not a render path); header comment updated.
src/render/cloud-motion.ts — deletes its own (20·cos)/12 body; re-exports grid's worldMetricX under the name cloudMetricX.
src/camera.ts — drops its private metricX and DEG2RAD; imports worldMetricX from ./grid.
src/render/wind.ts — restates the 0.012 vortex RMW floor as 7.992 km.
src/render/rain.ts — restates the 0.015 floor / 0.16 cap as 9.99 km / 106.56 km, hoisting the division.
src/render/particles.ts — restates the 0.015 floor / 0.16 cap and the 0.46 spawn cap in km, hoisting the division.
test/storm-radii.test.ts — gains the derivation-identity test; keeps its 40/666 and 180/666 literals as the ONE absolute pin, with a recorded reason.
test/cloud-motion.test.ts — imports HALF_DOMAIN_HEIGHT_KM instead of restating 666.
test/realism-metrics.test.ts — fixture cellKm imports the constant; the :194 drift guard keeps its role with a corrected comment.
test/realism-proxy.test.ts — the test-local geometry helper and the metricX assertion import the shared constants.
test/grid.test.ts — gains a domain-agnostic identity pin for worldMetricX.
```

### Task 8: Introduce SCORING_DOMAIN and repoint the six scoring sites

**Files:**

```
Create: src/scoring-domain.ts
Create: test/scoring-domain.test.ts
Modify: src/fidelity-verification.ts:4, :403-408, :409-414
Modify: calibration/fidelity.mjs:82, :86-97, :149, :676
Modify: calibration/hf6-verify.mjs:46, :50-58, :101
Modify: calibration/hf2a-ocean-reference.mjs:68, :72-81, :158
Modify: calibration/hf3-wander-calibration.mjs:27-41, :88
```

**Consumes:** nothing (first task in the phase)

**Produces:** `src/scoring-domain.ts` exporting `export const SCORING_DOMAIN: BBox` = `{ lonMin: 50, lonMax: 70, latMin: 15, latMax: 27 }`. Tasks 2–5 do not use it; later nio phases do.

- [ ] **Step 1: Write the failing test**

Create `test/scoring-domain.test.ts` with exactly this content:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCORING_DOMAIN } from '../src/scoring-domain';

describe('SCORING_DOMAIN', () => {
  it('is the frozen 50-70 E, 15-27 N box every sealed artifact was scored in', () => {
    expect(SCORING_DOMAIN).toEqual({
      lonMin: 50,
      lonMax: 70,
      latMin: 15,
      latMax: 27,
    });
  });

  it('is spelled out, never derived from the live DOMAIN', () => {
    // The whole point of the constant is that it must NOT move when grid.ts's
    // DOMAIN moves. An import from ./grid is the one edit that would silently
    // undo it, so the source text itself is the assertion.
    const source = readFileSync('src/scoring-domain.ts', 'utf8');
    expect(source).not.toMatch(/^\s*import[^\n]*'\.\/grid'/m);
  });
});
```

*Expected:* `npx vitest run test/scoring-domain.test.ts` fails before the module exists, with `Error: Failed to load url ../src/scoring-domain` (Vitest prints `Does the file exist?`). Zero tests pass.

- [ ] **Step 2: Create src/scoring-domain.ts**

Create `src/scoring-domain.ts` with exactly this content:

```ts
/**
 * scoring-domain.ts — the FROZEN box every sealed scoring artifact was written
 * against.
 *
 * `DOMAIN` in grid.ts is the LIVE simulation box and is scheduled to move (the
 * northern Indian Ocean expansion widens it to 45..100 E, 0..30 N). Every
 * catalogue, split, initialization list and sealed result under `calibration/`
 * was produced by truncating observed tracks against 50..70 E, 15..27 N.
 * Re-deriving those truncations from a wider box would change cohort
 * membership and the frozen 18/6/6 and 7/3 splits — holdout leakage, not a bug
 * fix (calibration/README.md, CLAUDE.md "Frozen scientific gates").
 *
 * So the numbers are written out in full, ON PURPOSE. This module must never
 * import grid.ts, never be derived from `DOMAIN`, and never be "unified" with
 * it. It is equal to `DOMAIN` today; that equality is an accident of history,
 * not an invariant, and `test/scoring-domain.test.ts` asserts the file text
 * rather than the equality for exactly that reason.
 */

import type { BBox } from './types';

export const SCORING_DOMAIN: BBox = {
  lonMin: 50,
  lonMax: 70,
  latMin: 15,
  latMax: 27,
};
```

*Expected:* `npx vitest run test/scoring-domain.test.ts` prints `Tests  2 passed (2)`.

- [ ] **Step 3: Repoint src/fidelity-verification.ts**

This file has TWO `DOMAIN` uses, not one (the spec's `:403` is the first line of the statement that contains the first one).

Before, line 4:
```ts
import { DOMAIN, greatCircleKm, inBBox } from './grid';
```
After (two lines):
```ts
import { greatCircleKm, inBBox } from './grid';
import { SCORING_DOMAIN } from './scoring-domain';
```

Before, lines 400-414:
```ts
    // The runtime has no forcing outside its declared product domain and dies
    // on exit. Never score a model that lingered inside against truth that has
    // already left that physical domain.
    const observedExited = points.some(
      ({ time, fix }) =>
        time > startMs &&
        time <= verifyingMs &&
        !inBBox(fix.lat, fix.lon, DOMAIN),
    );
    if (
      !observed ||
      !model ||
      observedExited ||
      !inBBox(observed.lat, observed.lon, DOMAIN)
    ) {
```
After:
```ts
    // The sealed cohorts were truncated against the FROZEN scoring box, not
    // the live DOMAIN. Truncating against a wider box would admit fixes the
    // catalogues never contained and move every sealed lead-time score.
    const observedExited = points.some(
      ({ time, fix }) =>
        time > startMs &&
        time <= verifyingMs &&
        !inBBox(fix.lat, fix.lon, SCORING_DOMAIN),
    );
    if (
      !observed ||
      !model ||
      observedExited ||
      !inBBox(observed.lat, observed.lon, SCORING_DOMAIN)
    ) {
```

*Expected:* `npm run build` (which runs `tsc --noEmit` first) passes. If `DOMAIN` were left in the import, `noUnusedLocals: true` fails the build with `error TS6133: 'DOMAIN' is declared but its value is never read.` — that error is the enforcement, so seeing it means the import line was not edited.

- [ ] **Step 4: Repoint calibration/fidelity.mjs (two sites, including the one that writes bytes)**

Line 82, before:
```js
  { DOMAIN, inBBox },
```
after:
```js
  { inBBox },
```

Add a new destructure entry immediately after line 85 (`  { observedInitialMotionMs, pressureWindSamplerFromBin },`) so it becomes:
```js
  { observedInitialMotionMs, pressureWindSamplerFromBin },
  { SCORING_DOMAIN },
] = await Promise.all([
```
and add the matching loader immediately after line 96 (`  vite.ssrLoadModule('/src/steering.ts'),`) so it becomes:
```js
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);
```
(The destructure array and the `Promise.all` array are positional — the new entry must be LAST in both.)

Line 149, before:
```js
    if (!inBBox(point.lat, point.lon, DOMAIN)) break;
```
after:
```js
    if (!inBBox(point.lat, point.lon, SCORING_DOMAIN)) break;
```

Line 676, before:
```js
    domain: DOMAIN,
```
after:
```js
    domain: SCORING_DOMAIN,
```
This second site is NOT in the design spec's list and must still be changed: it is written verbatim into `calibration/fidelity-results.json` as `verificationProtocol.domain` (confirmed present today as `{"lonMin":50,"lonMax":70,"latMin":15,"latMax":27}`). Leaving it bound to the live `DOMAIN` would change a sealed result file for a non-physics reason at the domain flip.

*Expected:* `npm run fidelity:check` exits 0 and prints no diff. `git status --porcelain calibration` shows only the edited `.mjs` (no change to `calibration/fidelity-results.json`).

- [ ] **Step 5: Repoint calibration/hf6-verify.mjs**

Line 46, before:
```js
  { inBBox, greatCircleKm, DOMAIN },
```
after:
```js
  { inBBox, greatCircleKm },
```

Add a new destructure entry after line 49 (`  { observedInitialMotionMs, pressureWindSamplerFromBin },`):
```js
  { observedInitialMotionMs, pressureWindSamplerFromBin },
  { SCORING_DOMAIN },
] = await Promise.all([
```
and the matching loader after line 57 (`  vite.ssrLoadModule('/src/steering.ts'),`):
```js
  vite.ssrLoadModule('/src/steering.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);
```

Line 101, before:
```js
    if (!inBBox(point.lat, point.lon, DOMAIN)) break;
```
after:
```js
    if (!inBBox(point.lat, point.lon, SCORING_DOMAIN)) break;
```

*Expected:* `npm run hf6:verify:check` exits 0. `calibration/hf6-sealed-verification.json` is unchanged (`git status --porcelain calibration/hf6-sealed-verification.json` prints nothing).

- [ ] **Step 6: Repoint calibration/hf2a-ocean-reference.mjs**

Line 68, before:
```js
  { greatCircleKm, inBBox, DOMAIN },
```
after:
```js
  { greatCircleKm, inBBox },
```

Add a destructure entry after line 71 (`  { sampleOceanProfileBin, sampleEventOceanProfileBin },`):
```js
  { sampleOceanProfileBin, sampleEventOceanProfileBin },
  { SCORING_DOMAIN },
] = await Promise.all([
```
and the loader after line 80 (`  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),`):
```js
  vite.ssrLoadModule('/src/ocean-profile-sampler.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);
```

Line 158, before:
```js
    if (!inBBox(point.lat, point.lon, DOMAIN)) {
```
after:
```js
    if (!inBBox(point.lat, point.lon, SCORING_DOMAIN)) {
```

*Expected:* `npm run hf2a:ocean:reference:check` and `npm run hf2a:ocean:candidate:check` both exit 0 with no diff reported.

- [ ] **Step 7: Repoint calibration/hf3-wander-calibration.mjs (inline literals, no inBBox today)**

This script does not use `inBBox` at all. Line 88 today is a bare four-way literal comparison.

Add a destructure entry after line 33 (`  { betaDriftMs },`):
```js
  { betaDriftMs },
  { SCORING_DOMAIN },
] = await Promise.all([
```
and the loader after line 40 (`  vite.ssrLoadModule('/src/sim.ts'),`):
```js
  vite.ssrLoadModule('/src/sim.ts'),
  vite.ssrLoadModule('/src/scoring-domain.ts'),
]);
```

Line 88, before:
```js
    if (lon < 50 || lon > 70 || lat < 15 || lat > 27) break;
```
after:
```js
    if (
      lon < SCORING_DOMAIN.lonMin ||
      lon > SCORING_DOMAIN.lonMax ||
      lat < SCORING_DOMAIN.latMin ||
      lat > SCORING_DOMAIN.latMax
    ) {
      break;
    }
```
This is a textual substitution of the four numbers — the comparison operators and their order are unchanged, so the branch decision is bit-identical for every input. Do NOT "simplify" it to `!inBBox(...)`: that would be equivalent today, but it adds a second module load for no benefit.

*Expected:* `npm run hf3:wander:check` exits 0 with no diff reported.

- [ ] **Step 8: Run the full phase gate and commit**

Run, in order:
```
npm test
npm run build
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run hf2a:ocean:reference:check
npm run hf3:wander:check
```
Then commit and only then run the zero-diff gate (the gate reports UNCOMMITTED changes, so the source edits must be committed first or they will show up as noise):
```
git add src/scoring-domain.ts test/scoring-domain.test.ts src/fidelity-verification.ts calibration/fidelity.mjs calibration/hf6-verify.mjs calibration/hf2a-ocean-reference.mjs calibration/hf3-wander-calibration.mjs
git commit -m "refactor: score sealed cohorts against a frozen SCORING_DOMAIN"
git status --porcelain calibration docs public/data
```

*Expected:* Every command exits 0. The final `git status --porcelain calibration docs public/data` prints NOTHING — no sealed result, no machine-generated report and no baked asset moved.

---

### Task 9: Derive HALF_DOMAIN_HEIGHT_KM from DOMAIN and delete both 666 literals

**Files:**

```
Modify: src/grid.ts:36-41 (append after the physical-constants block)
Modify: src/render/storm-radii.ts:13-19
Modify: src/realism-metrics.ts:1-23, :62-68
Modify: test/storm-radii.test.ts:1-8 (imports), append one new `it`
```

**Consumes:** nothing from Task 1

**Produces:** From `src/grid.ts`: `export const RENDER_KM_PER_LAT_DEG = 111` (number) and `export const HALF_DOMAIN_HEIGHT_KM: number` (evaluates to exactly 666 today). `src/render/storm-radii.ts` re-exports both under the same names, so all twelve existing `from './storm-radii'` / `from '../render/storm-radii'` imports keep working unchanged. Task 4 and Task 5 both import `HALF_DOMAIN_HEIGHT_KM`; Task 5 also uses `RENDER_KM_PER_LAT_DEG` only in prose.

- [ ] **Step 1: Write the failing derivation test FIRST (this is the 'evaluates to exactly 666' proof)**

In `test/storm-radii.test.ts`, replace the import block at lines 1-6:
```ts
import { describe, expect, it } from 'vitest';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from '../src/render/storm-radii';
```
with:
```ts
import { describe, expect, it } from 'vitest';
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  stormRenderRadii,
} from '../src/render/storm-radii';
import {
  DOMAIN,
  HALF_DOMAIN_HEIGHT_KM,
  RENDER_KM_PER_LAT_DEG,
} from '../src/grid';
```
and append this new `describe` block at the end of the file (after the closing `});` on line 51):
```ts
describe('HALF_DOMAIN_HEIGHT_KM', () => {
  it('is exactly half the domain height at the render km-per-degree', () => {
    // The identity, written domain-agnostically so it survives a domain
    // change untouched. The absolute value is pinned exactly once, in
    // 'pins the reference structure so the render is unchanged' above.
    expect(HALF_DOMAIN_HEIGHT_KM).toBe(
      ((DOMAIN.latMax - DOMAIN.latMin) / 2) * RENDER_KM_PER_LAT_DEG,
    );
  });

  it('reproduces the legacy 666 at the current 15-27 N domain', () => {
    // Proof that the derivation is a no-op TODAY. This assertion is the one
    // the domain expansion must delete deliberately, in the same commit that
    // moves DOMAIN, so the rescale cannot happen by accident.
    expect(HALF_DOMAIN_HEIGHT_KM).toBe(666);
    expect(RENDER_KM_PER_LAT_DEG).toBe(111);
  });
});
```

*Expected:* `npm run build` fails at the `tsc --noEmit` step with `error TS2305: Module '"../src/grid"' has no exported member 'HALF_DOMAIN_HEIGHT_KM'.` and a second TS2305 for `RENDER_KM_PER_LAT_DEG`. `npx vitest run test/storm-radii.test.ts` fails too — either `SyntaxError: ... does not provide an export named 'RENDER_KM_PER_LAT_DEG'` or `AssertionError: expected undefined to be 666`; either message is the correct 'see it fail'.

- [ ] **Step 2: Add the two constants to src/grid.ts**

In `src/grid.ts`, after line 41 (`const DEG2RAD = Math.PI / 180;`) and before line 43's `// ---` separator, insert:

```ts
/**
 * Kilometres per degree of latitude used by the RENDER km<->clip mapping, and
 * by nothing else.
 *
 * This deliberately disagrees with the two other km-per-degree numbers in the
 * tree, and the disagreement is load-bearing:
 *   - METERS_PER_DEG_LAT = 111_320 above (the physics wind conversion) would
 *     make the half-domain height 667.92 km;
 *   - KM_PER_LAT_DEGREE = 111.195 in src/render/terrain.ts:23 (and the same
 *     number in src/fidelity-verification.ts:13 and src/steering.ts:221) would
 *     make it 667.17 km.
 * Neither is 666. The render layer has always used a flat 111, and every
 * shipped shader constant, R2a realism metric and human-accepted R3/R4
 * presentation baseline is denominated in that mapping. Reconciling the <=
 * 0.29 % difference would move every cloud, rainband and radar radius those
 * verdicts accepted. It is a RENDERING unit, never a physical one: do not use
 * it in sim.ts, structure.ts, steering.ts or any calibration path.
 */
export const RENDER_KM_PER_LAT_DEG = 111;

/**
 * Half the domain height in km — THE km -> clip-y factor for every render and
 * measurement path. Derived, not written out, so a domain change cannot leave
 * a stale literal behind. Exactly 666 at the current 15..27 N domain
 * (12 / 2 * 111, all three operations exact in IEEE754 double).
 */
export const HALF_DOMAIN_HEIGHT_KM =
  ((DOMAIN.latMax - DOMAIN.latMin) / 2) * RENDER_KM_PER_LAT_DEG;
```

*Expected:* `npx vitest run test/storm-radii.test.ts` prints `Tests  7 passed (7)` (the five existing plus the two new). `npm run build` passes.

- [ ] **Step 3: Delete the literal in src/render/storm-radii.ts and re-export**

Before, lines 13-19:
```ts
import type { StormStructure } from '../types';

/** Half the domain height in km — converts km to clip-y units. */
export const HALF_DOMAIN_HEIGHT_KM = 666;

/** Shared numerical floor; matches the existing guards in env.ts and radar.ts. */
export const RENDER_RADIUS_FLOOR = 0.008;
```
After:
```ts
import type { StormStructure } from '../types';
import { HALF_DOMAIN_HEIGHT_KM, RENDER_KM_PER_LAT_DEG } from '../grid';

// grid.ts owns the km<->clip mapping (it owns clip space). Re-exported here so
// the twelve render and realism modules that already import it from this file
// keep working, and so docs/architecture.md's export list stays true.
export { HALF_DOMAIN_HEIGHT_KM, RENDER_KM_PER_LAT_DEG };

/** Shared numerical floor; matches the existing guards in env.ts and radar.ts. */
export const RENDER_RADIUS_FLOOR = 0.008;
```
Nothing else in the file changes — `stormRenderRadii` at lines 35-48 keeps using the now-imported `HALF_DOMAIN_HEIGHT_KM` binding unchanged.

*Expected:* `npm test` passes with no new failures. Note `import { HALF_DOMAIN_HEIGHT_KM } from '../grid'` is a VALUE import used both locally (line 41, 45) and in the `export {}` — `noUnusedLocals` is satisfied and `npm run build` passes.

- [ ] **Step 4: Delete the duplicate literal in src/realism-metrics.ts**

Before, lines 62-68:
```ts
/**
 * Half the domain height in km — the clip→km factor. Mirrors
 * `HALF_DOMAIN_HEIGHT_KM` in `src/render/storm-radii.ts`, restated here because
 * this module must not import a render path; `buildRealismField` derives its
 * `cellKm` from the same 666, so the two mappings agree by construction.
 */
const HALF_DOMAIN_HEIGHT_KM = 666;
```
After — delete those seven lines entirely, and add the import next to the existing ones. Before, lines 22-23:
```ts
import type { RealismField, RealismFrameContext } from './realism-proxy';
import { clamp01, smoothstep } from './realism-proxy';
```
After:
```ts
import type { RealismField, RealismFrameContext } from './realism-proxy';
import { clamp01, smoothstep } from './realism-proxy';
// grid.ts, NOT render/storm-radii.ts: this module still must not import a
// render path, and grid.ts is a coordinate-convention module below it. The
// duplicated 666 that used to live here is gone; the mapping is now shared
// with buildRealismField by construction rather than by comment.
import { HALF_DOMAIN_HEIGHT_KM } from './grid';
```
Also fix the file header, which now states something false. Before, lines 7-9:
```ts
 * here is a pure function of (field, context): no clock, no device trait, no
 * global state, and no import from a render path — the only dependency is
 * `realism-proxy`, the harness's single import surface.
```
After:
```ts
 * here is a pure function of (field, context): no clock, no device trait, no
 * global state, and no import from a render path — the dependencies are
 * `realism-proxy` (the harness's single import surface) and `grid`, which owns
 * the km<->clip mapping and sits below the render layer.
```
This supersedes `docs/superpowers/plans/2026-08-07-shared-camera.md:49-50` ("a deliberate second copy ... leave it"). Do not update that plan file — it is a historical record, and this phase's gate forbids touching `docs/`.

*Expected:* `npx vitest run test/realism-metrics.test.ts` passes with the same test count as before the edit. `npm run realism:check` exits 0 and reports no drift — this is the assertion that matters, because `realism-metrics.ts` feeds the sealed R2a numbers.

- [ ] **Step 5: Run the full phase gate and commit**

```
npm test
npm run build
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
git add src/grid.ts src/render/storm-radii.ts src/realism-metrics.ts test/storm-radii.test.ts
git commit -m "refactor: derive the render half-domain height from DOMAIN"
git status --porcelain calibration docs public/data
```

*Expected:* All commands exit 0. `git status --porcelain calibration docs public/data` prints nothing. In particular `calibration/realism/realism-reference.json` is untouched — the derivation produced the identical double.

---

### Task 10: Derive the world east-west metric from DOMAIN; camera.ts and cloud-motion.ts share one owner

**Files:**

```
Modify: src/grid.ts (append after the constants added in Task 2)
Modify: src/render/cloud-motion.ts:182-185
Modify: src/camera.ts:21, :57, :58-65, :86, :238, :239
Modify: test/grid.test.ts:1-13 (imports), append one new `describe`
```

**Consumes:** nothing from Tasks 1-2 (it edits the same file, src/grid.ts, so run it after Task 2 to avoid a conflict)

**Produces:** From `src/grid.ts`: `export function worldMetricX(latitude: number): number`. `src/render/cloud-motion.ts` re-exports the SAME function object under its existing name `cloudMetricX`, so `cloudMetricX === worldMetricX` is true and all six existing `cloudMetricX` call sites are byte-for-byte unaffected. Task 4 imports `cloudMetricX` from `../src/render/cloud-motion`.

- [ ] **Step 1: Write the failing identity test**

In `test/grid.test.ts`, add `worldMetricX` to the import list at lines 2-12 so it reads:
```ts
import {
  DOMAIN,
  cellToLatLon,
  latLonToCell,
  latLonToClip,
  clipToLatLon,
  msToDegPerHourZonal,
  msToDegPerHourMeridional,
  greatCircleKm,
  inBBox,
  worldMetricX,
} from '../src/grid';
```
and append this `describe` at the end of the file:
```ts
describe('grid: world east-west metric', () => {
  it('is the domain aspect ratio at the equator', () => {
    expect(worldMetricX(0)).toBe(
      (DOMAIN.lonMax - DOMAIN.lonMin) / (DOMAIN.latMax - DOMAIN.latMin),
    );
  });

  it('scales by cos(lat) and is symmetric about the equator', () => {
    expect(worldMetricX(60)).toBeCloseTo(worldMetricX(0) * Math.cos(Math.PI / 3), 12);
    expect(worldMetricX(-21)).toBeCloseTo(worldMetricX(21), 15);
  });

  it('keeps the radian conversion the sealed realism reference was measured with', () => {
    // (lat * Math.PI) / 180, NOT lat * (Math.PI / 180). The two forms differ by
    // up to ~1.4 ULP on about 2 % of latitudes in 0..30 N, and the first form
    // is the one calibration/realism/realism-reference.json was produced with.
    expect(worldMetricX(21)).toBe(
      ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos((21 * Math.PI) / 180)) /
        (DOMAIN.latMax - DOMAIN.latMin),
    );
  });
});
```

*Expected:* `npm run build` fails at `tsc --noEmit` with `error TS2305: Module '"../src/grid"' has no exported member 'worldMetricX'.` `npx vitest run test/grid.test.ts` fails at module load or with `TypeError: worldMetricX is not a function`.

- [ ] **Step 2: Add worldMetricX to src/grid.ts**

Append, immediately after the `HALF_DOMAIN_HEIGHT_KM` block added in Task 2:

```ts
/**
 * East-west world anisotropy at a latitude: the factor that makes a circle on
 * the ground render as a circle in the domain-normalized clip space. Owned
 * here because clip space is grid.ts's contract, and because both consumers
 * sit in different layers — `src/camera.ts` (presentation clamp) may not
 * import a render module, and `src/render/cloud-motion.ts` re-exports this as
 * `cloudMetricX` for the shader uploads.
 *
 * The radian conversion is written `(latitude * Math.PI) / 180`, NOT
 * `latitude * DEG2RAD`. The two forms differ by up to about 1.4 ULP on roughly
 * 2 % of latitudes in 0..30 N, and this one is the form the sealed R2a realism
 * reference was measured with. Do not "simplify" it to reuse DEG2RAD.
 */
export function worldMetricX(latitude: number): number {
  return (
    ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos((latitude * Math.PI) / 180)) /
    (DOMAIN.latMax - DOMAIN.latMin)
  );
}
```
`DOMAIN.lonMax - DOMAIN.lonMin` evaluates to exactly `20` and `DOMAIN.latMax - DOMAIN.latMin` to exactly `12` in IEEE754 double, so this is the same sequence of operations on the same values as the current `(20 * Math.cos((latitude * Math.PI) / 180)) / 12` — bit-identical for every input.

*Expected:* `npx vitest run test/grid.test.ts` passes, including the three new assertions.

- [ ] **Step 3: Replace the body of cloudMetricX with a re-export**

Before, `src/render/cloud-motion.ts` lines 182-185:
```ts
/** East-west metric correction shared by env and cloud-memory uploads. */
export function cloudMetricX(latitude: number): number {
  return (20 * Math.cos((latitude * Math.PI) / 180)) / 12;
}
```
After:
```ts
/**
 * East-west metric correction shared by env and cloud-memory uploads.
 * The formula is grid.ts's `worldMetricX` — one owner, so the shader uploads
 * and the camera clamp cannot drift apart. Re-exported (not wrapped) so the
 * two names are the SAME function object.
 */
export { worldMetricX as cloudMetricX } from '../grid';
```
Note `export ... from` creates no local binding, so nothing else in this file needs to change; `cloudMetricX` is not referenced elsewhere inside `cloud-motion.ts`.

*Expected:* `npx vitest run test/realism-proxy.test.ts test/cloud-motion.test.ts test/realism-metrics.test.ts` passes. `npm run realism:check` exits 0 with no drift — the value is bit-identical.

- [ ] **Step 4: Point camera.ts at the shared function and delete its private copy**

Before, `src/camera.ts` line 21:
```ts
import { DOMAIN, clipToLatLon, latLonToClip } from './grid';
```
After:
```ts
import { clipToLatLon, latLonToClip, worldMetricX } from './grid';
```
(`DOMAIN` must go — after this edit its only remaining appearances in the file are in prose comments at lines 5, 14 and 15. Leaving the import fails `npm run build` under `noUnusedLocals`.)

Before, lines 57-65:
```ts
const DEG2RAD = Math.PI / 180;

/** East-west world anisotropy at a latitude — same formula as cloudMetricX. */
function metricX(lat: number): number {
  return (
    ((DOMAIN.lonMax - DOMAIN.lonMin) * Math.cos(lat * DEG2RAD)) /
    (DOMAIN.latMax - DOMAIN.latMin)
  );
}
```
After — delete all nine lines. `DEG2RAD` has no other use in `camera.ts`.

Then replace the three call sites. Line 86, before:
```ts
  const m = metricX(centreLat);
```
after:
```ts
  const m = worldMetricX(centreLat);
```
Lines 238-239, before:
```ts
  const m0 = metricX(clipToLatLon(0, view.center.y).lat);
  const m1 = metricX(clipToLatLon(0, cy).lat);
```
after:
```ts
  const m0 = worldMetricX(clipToLatLon(0, view.center.y).lat);
  const m1 = worldMetricX(clipToLatLon(0, cy).lat);
```
Also update the doc comment at line 225, which names the old identifier. Before:
```ts
 * new centre latitude; scaleX additionally carries metricX(centre lat), so
```
After:
```ts
 * new centre latitude; scaleX additionally carries worldMetricX(centre lat), so
```

This is the ONE place in the phase where a number changes: the retired `lat * DEG2RAD` differs from `(lat * Math.PI) / 180` by at most 3.08e-16 relative (measured over 200,001 samples across 0-30 °N; 4,442 of them differ at all). Camera output is presentation-only and reaches no sealed artifact. `viewKey` rounds with `toFixed(9)` on values of order 1-20, so a 3e-16 relative shift cannot change its string.

*Expected:* `npx vitest run test/camera.test.ts test/camera-gestures.test.ts` passes with no changed assertions. `npm run build` passes; if either `DOMAIN` or `DEG2RAD` was left behind you get `error TS6133: 'DOMAIN' is declared but its value is never read.`

- [ ] **Step 5: Run the full phase gate and commit**

```
npm test
npm run build
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
git add src/grid.ts src/render/cloud-motion.ts src/camera.ts test/grid.test.ts
git commit -m "refactor: give the world east-west metric one owner in grid.ts"
git status --porcelain calibration docs public/data
```

*Expected:* All commands exit 0; the final `git status` prints nothing.

---

### Task 11: Decide the six deliberate 666 / 20-12 drift guards, one at a time

**Files:**

```
Modify: test/storm-radii.test.ts:32-41 (keep literals, record why)
Modify: test/cloud-motion.test.ts:1-2 (add import), :128-133
Modify: test/realism-metrics.test.ts:15-21, :194-201
Modify: test/realism-proxy.test.ts:1-19 (add imports), :332-335, :356-361
```

**Consumes:** `HALF_DOMAIN_HEIGHT_KM` from `src/render/storm-radii` (defined in Task 2, re-exported from grid.ts). `cloudMetricX` from `src/render/cloud-motion` (re-exported in Task 3).

**Produces:** nothing consumed by later tasks

- [ ] **Step 1: Understand the rule being applied, then apply it site by site**

The governing distinction, applied consistently below:

- A guard whose target is a **duplication** (two independently written copies of the same number that could silently disagree) has lost its target once Tasks 2 and 3 collapsed the copies. Keeping its literal leaves a second number to hand-edit at the domain flip — an extra chance to edit it wrongly — while detecting nothing the single source does not already detect. Those import the constant.
- A guard whose target is a **value** (today's rendered geometry stated in absolute terms) must keep its literal. That is the one thing that has to fail loudly at the domain flip and be decided, not absorbed.

After this task there is exactly ONE bare `666` left in `test/` outside a comment, plus the deliberate `expect(HALF_DOMAIN_HEIGHT_KM).toBe(666)` added in Task 2. Verify that at the end with:
```
grep -rn "666" test/ --include=*.ts
```
No edit in this step; read it and proceed.

*Expected:* No command run. This step exists so the five edits below are not applied mechanically.

- [ ] **Step 2: Guard 1 of 6 — test/storm-radii.test.ts:32-41: KEEP the literals**

Decision: KEEP `40 / 666` and `180 / 666`. Reason: this is the only place in the repository that states today's rendered geometry as an absolute number. Importing `HALF_DOMAIN_HEIGHT_KM` here would make both lines tautologies of `stormRenderRadii`'s own implementation, and the domain expansion would rescale every cloud, rainband and radar radius with a fully green suite. Record the reason in the test so a future reader does not "clean it up".

Before, lines 32-41:
```ts
  it('pins the reference structure so the render is unchanged', () => {
    const { rMax, rCanopy } = stormRenderRadii({
      rmwKm: 40,
      outerSizeKm: 180,
    });
    expect(rMax).toBeCloseTo(40 / 666, 12);
    expect(rCanopy).toBeCloseTo(180 / 666, 12);
    // Canopy coefficients are the old rMax multiples divided by this ratio.
    expect(rCanopy / rMax).toBeCloseTo(CANOPY_COEFFICIENT_DIVISOR, 12);
  });
```
After:
```ts
  it('pins the reference structure so the render is unchanged', () => {
    const { rMax, rCanopy } = stormRenderRadii({
      rmwKm: 40,
      outerSizeKm: 180,
    });
    // DELIBERATE bare 666, kept after the constant was derived from DOMAIN.
    // This is the ONE absolute pin of today's rendered geometry. Importing
    // HALF_DOMAIN_HEIGHT_KM here would make both lines restate
    // stormRenderRadii's own arithmetic, and a domain change would rescale
    // every cloud, rainband and radar radius with a green suite. A domain
    // change MUST fail here and be decided, not absorbed.
    expect(rMax).toBeCloseTo(40 / 666, 12);
    expect(rCanopy).toBeCloseTo(180 / 666, 12);
    // Canopy coefficients are the old rMax multiples divided by this ratio.
    expect(rCanopy / rMax).toBeCloseTo(CANOPY_COEFFICIENT_DIVISOR, 12);
  });
```

*Expected:* `npx vitest run test/storm-radii.test.ts` passes; assertion values are unchanged (comment-only edit).

- [ ] **Step 3: Guard 2 of 6 — test/cloud-motion.test.ts:128-133: IMPORT the constant**

Decision: IMPORT. Reason: the literal 666 here duplicated `storm-radii.ts`'s constant so the two could be compared. Task 2 deleted the second copy, so the duplication is gone. What the test still genuinely proves — that `cloudAngularRateAtClipRadius` multiplies BOTH radii by the shared conversion and does nothing else — survives verbatim with the constant imported.

Add this import after line 2 (`import { describe, expect, test } from 'vitest';`):
```ts
import { HALF_DOMAIN_HEIGHT_KM } from '../src/render/storm-radii';
```

Before, lines 128-133:
```ts
  test('clip-radius form applies the shared 666-km conversion', () => {
    // rUnits 0.3 at the 666-km half-domain height = 199.8 km; rmw 30 km
    const viaKm = cloudAngularRateRadPerH(0.3 * 666, 0.045045045 * 666, 40, 1.35);
    const viaClip = cloudAngularRateAtClipRadius(0.3, 0.045045045, 40, 1.35);
    expect(viaClip).toBeCloseTo(viaKm, 12);
  });
```
After:
```ts
  test('clip-radius form applies the shared half-domain conversion', () => {
    // The 666 literal is gone on purpose: HALF_DOMAIN_HEIGHT_KM is now derived
    // from DOMAIN in grid.ts, so a literal here would be a second number to
    // hand-edit at a domain change. What this still guards is that the clip
    // form scales BOTH radii by that constant and nothing else.
    // rUnits 0.3 at today's 666-km half-domain height = 199.8 km; rmw 30 km.
    const viaKm = cloudAngularRateRadPerH(
      0.3 * HALF_DOMAIN_HEIGHT_KM,
      0.045045045 * HALF_DOMAIN_HEIGHT_KM,
      40,
      1.35,
    );
    const viaClip = cloudAngularRateAtClipRadius(0.3, 0.045045045, 40, 1.35);
    expect(viaClip).toBeCloseTo(viaKm, 12);
  });
```

*Expected:* `npx vitest run test/cloud-motion.test.ts` passes with the same test count. The GLSL digest tests in this file are unaffected — `RENDER_RADIUS_FLOOR` and `HALF_DOMAIN_HEIGHT_KM` still stringify to `0.008` and `666`.

- [ ] **Step 4: Guard 3 of 6 — test/realism-metrics.test.ts:15-21: IMPORT the constant**

Decision: IMPORT. Reason: this is not a guard at all — it is `blankField()` fixture construction. Its `cellKm` must track what `buildRealismField` actually produces, or the fixture stops representing a real field and every metric measured on it becomes meaningless. `HALF_DOMAIN_HEIGHT_KM` is already imported at line 10.

Before, lines 15-21:
```ts
  return {
    n, metricX: 1, center: { x: 0, y: 0 },
    cellKm: { x: (2 / n) * 666, y: (2 / n) * 666 },
    btProxyC: fill(20), cloud: fill(0), stormCloud: fill(0),
    ambientCloud: fill(0), bands: fill(0), precipBandCloud: fill(0),
    debris: fill(0), oceanMask: fill(1),
  };
```
After:
```ts
  return {
    n, metricX: 1, center: { x: 0, y: 0 },
    // Fixture construction, not a drift guard: cellKm must track what
    // buildRealismField produces or the fixture stops being a real field.
    cellKm: {
      x: (2 / n) * HALF_DOMAIN_HEIGHT_KM,
      y: (2 / n) * HALF_DOMAIN_HEIGHT_KM,
    },
    btProxyC: fill(20), cloud: fill(0), stormCloud: fill(0),
    ambientCloud: fill(0), bands: fill(0), precipBandCloud: fill(0),
    debris: fill(0), oceanMask: fill(1),
  };
```
Also update the stale comment at lines 8-9. Before:
```ts
// The MODULE may not import a render path, so it restates HALF_DOMAIN_HEIGHT_KM.
// This TEST is under no such rule, and imports the original to bind the two.
```
After:
```ts
// The MODULE takes HALF_DOMAIN_HEIGHT_KM from grid.ts (below the render layer);
// this TEST imports it through the render re-export, which is the path every
// render consumer uses. Same value, both routes — that is the point.
```

*Expected:* `npx vitest run test/realism-metrics.test.ts` passes with the same test count and identical numbers ((2/8)*666 === (2/8)*HALF_DOMAIN_HEIGHT_KM).

- [ ] **Step 5: Guard 4 of 6 — test/realism-metrics.test.ts:194-201: KEEP, with a corrected reason**

Decision: KEEP the test as written (it already imports `HALF_DOMAIN_HEIGHT_KM`), but correct the comment. Its stated target — "the duplicated 666" — no longer exists after Task 2. Its real, surviving target is that `metricsForField`'s clip→km mapping and `buildRealismField`'s cellKm mapping are two independent USES of the constant that can still disagree in structure even when they agree in value.

Before, lines 194-201:
```ts
  it('the km mapping tracks the field builder\'s half-domain height', () => {
    // Drift guard for the duplicated 666. The cold centroid sits at clip
    // (0.5, 0), so its offset must be exactly half the domain height. Changing
    // EITHER copy — the render path's constant or the metrics module's local
    // restatement — breaks this equality, so a divergence cannot go quiet.
    const m = metricsForField(eastLobeField(), ctxFor());
    expect(m.coldTop.centroidOffsetKm).toBeCloseTo(0.5 * HALF_DOMAIN_HEIGHT_KM, 6);
  });
```
After:
```ts
  it('the km mapping tracks the field builder\'s half-domain height', () => {
    // Drift guard for the two independent USES of the half-domain height:
    // realism-metrics.ts maps clip offsets to km in fieldGeometry, and
    // buildRealismField maps cell size to km in cellKm. The duplicated 666
    // literal is gone, but the two mappings are still written separately and
    // can still be rewritten apart. The cold centroid sits at clip (0.5, 0),
    // so its offset must be exactly half the domain height.
    const m = metricsForField(eastLobeField(), ctxFor());
    expect(m.coldTop.centroidOffsetKm).toBeCloseTo(0.5 * HALF_DOMAIN_HEIGHT_KM, 6);
  });
```

*Expected:* `npx vitest run test/realism-metrics.test.ts` passes (comment-only edit).

- [ ] **Step 6: Guard 5 of 6 — test/realism-proxy.test.ts:332-335: IMPORT the constant**

Decision: IMPORT. Reason: `eyewallMinC` is a test-local reimplementation of the field geometry used to select an annulus. Its 666s are not a guard — if they ever disagreed with the production constant the helper would silently select the WRONG annulus and the surrounding assertion would still pass. That is a false-pass mechanism, not a drift detector. The actual guard for this mapping is guard 4 above.

Add this import after line 3 (`import { cloudNoiseBytes } from '../src/render/cloud-noise';`):
```ts
import { HALF_DOMAIN_HEIGHT_KM } from '../src/render/storm-radii';
import { cloudMetricX } from '../src/render/cloud-motion';
```
(The second import is used by guard 6 in the next step.)

Before, lines 332-336:
```ts
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      const east = ((u * 2 - 1) - field.center.x) * field.metricX * 666;
      const north = ((1 - v * 2) - field.center.y) * 666;
      const q = Math.hypot(east, north) / rmwKm;
```
After:
```ts
      const u = (i + 0.5) / field.n;
      const v = (j + 0.5) / field.n;
      // Imported, not restated: a disagreement here would pick the wrong
      // annulus and still pass. The mapping's real drift guard lives in
      // test/realism-metrics.test.ts.
      const east =
        ((u * 2 - 1) - field.center.x) * field.metricX * HALF_DOMAIN_HEIGHT_KM;
      const north = ((1 - v * 2) - field.center.y) * HALF_DOMAIN_HEIGHT_KM;
      const q = Math.hypot(east, north) / rmwKm;
```

*Expected:* `npx vitest run test/realism-proxy.test.ts` passes; the annulus selection is unchanged because the constant is still 666.

- [ ] **Step 7: Guard 6 of 6 — test/realism-proxy.test.ts:356-361: IMPORT cloudMetricX**

Decision: IMPORT. Reason: the literal `(20 * Math.cos((18 * Math.PI) / 180)) / 12` duplicated the formula Task 3 made single-source. What the assertion actually guards — that `buildRealismField` reads the FRAME latitude (18 °N) rather than a default or the domain centre — survives with the function imported, and is the discriminating part. The formula's absolute identity is now pinned domain-agnostically in `test/grid.test.ts` (Task 3).

Before, lines 356-361:
```ts
  it('grid geometry: 192^2, metricX from frame latitude', () => {
    const field = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(field.n).toBe(REALISM_GRID_N);
    expect(field.btProxyC.length).toBe(REALISM_GRID_N * REALISM_GRID_N);
    expect(field.metricX).toBeCloseTo((20 * Math.cos((18 * Math.PI) / 180)) / 12, 9);
  });
```
After:
```ts
  it('grid geometry: 192^2, metricX from frame latitude', () => {
    const field = buildRealismField(contextFor(syntheticFrame()), openOcean);
    expect(field.n).toBe(REALISM_GRID_N);
    expect(field.btProxyC.length).toBe(REALISM_GRID_N * REALISM_GRID_N);
    // The discriminating part is the ARGUMENT — 18, the synthetic frame's
    // latitude, not a default and not the domain centre. The formula itself is
    // pinned domain-agnostically in test/grid.test.ts now that grid.ts owns it.
    expect(field.metricX).toBeCloseTo(cloudMetricX(18), 9);
  });
```
Then confirm the whole task with:
```
grep -rn "666" test/ --include=*.ts
```

*Expected:* `npx vitest run test/realism-proxy.test.ts` passes. The `grep` prints exactly four lines: `test/storm-radii.test.ts` (the two kept literals plus the deliberate `toBe(666)` and `RENDER_KM_PER_LAT_DEG` block added in Task 2), plus any line where 666 appears inside a comment. No bare `666` remains in cloud-motion, realism-metrics or realism-proxy tests.

- [ ] **Step 8: Run the full phase gate and commit**

```
npm test
npm run build
npm run realism:check
npm run calibrate:check
npm run hf6:verify:check
git add test/storm-radii.test.ts test/cloud-motion.test.ts test/realism-metrics.test.ts test/realism-proxy.test.ts
git commit -m "test: re-aim the half-domain drift guards at their single source"
git status --porcelain calibration docs public/data
```

*Expected:* All commands exit 0; the final `git status` prints nothing. Test counts are identical to before the task — no test was added or removed here.

---

### Task 12: Restate the four clip-space radius floors in kilometres, at no-op values

**Files:**

```
Modify: src/render/storm-radii.ts:18-19, :35-48
Modify: src/render/wind.ts (add a module constant near line 56; edit :268)
Modify: src/render/rain.ts (add two module constants; edit :341-346)
Modify: src/render/particles.ts (add three module constants; edit :74-83)
Test: test/storm-radii.test.ts (append one `describe`)
```

**Consumes:** `HALF_DOMAIN_HEIGHT_KM` from `src/render/storm-radii` / `src/grid` (Task 2)

**Produces:** From `src/render/storm-radii.ts`: `export const RENDER_RADIUS_FLOOR_KM = 5.328`, with `RENDER_RADIUS_FLOOR` kept as an exported derived clip value (all six existing consumers unchanged).

- [ ] **Step 1: Find and confirm the four floors**

There are exactly four `Math.max` lower bounds applied to a `km / HALF_DOMAIN_HEIGHT_KM` quantity in `src/render/`. Confirm with:
```
grep -rn "Math.max(0.0" src/render/
grep -rn "RENDER_RADIUS_FLOOR = " src/render/
```
They are:
1. `src/render/storm-radii.ts:19` — `RENDER_RADIUS_FLOOR = 0.008` = 5.328 km
2. `src/render/wind.ts:268` — `Math.max(0.012, ...)` = 7.992 km
3. `src/render/particles.ts:74-77` — `Math.max(0.015, Math.min(0.16, ...))` = 9.99 km floor, 106.56 km cap
4. `src/render/rain.ts:341-346` — the same 0.015 / 0.16 pair

Why this matters: at the current domain 0.008 clip = 5.33 km, comfortably under `structure.ts`'s `rmwMinKm = 12`. At the planned 0–30 °N domain the same clip literal becomes 13.3 km and starts binding above the RMW floor — the exact re-coupling failure `CLAUDE.md`'s `rCanopy` note warns about. Denominating the floors in km makes them domain-invariant and removes that failure mode before the domain moves.

Arithmetic verified this session (`node -e`): `5.328 / 666 === 0.008` is `true`, `7.992 / 666 === 0.012` is `true`, `106.56 / 666 === 0.16` is `true`, `306.36 / 666 === 0.46` is `true`. `9.99 / 666` is `0.015000000000000001`, NOT `0.015` — which is why sites 3 and 4 hoist the division instead of restating the clip floor (see their steps).

*Expected:* The two `grep`s print exactly the lines listed above. No edit in this step.

- [ ] **Step 2: Write the failing test**

Append to `test/storm-radii.test.ts`:
```ts
describe('render radius floors are denominated in km', () => {
  it('RENDER_RADIUS_FLOOR is exactly the km floor over the half-domain height', () => {
    expect(RENDER_RADIUS_FLOOR_KM).toBe(5.328);
    expect(RENDER_RADIUS_FLOOR).toBe(RENDER_RADIUS_FLOOR_KM / HALF_DOMAIN_HEIGHT_KM);
    // Bit-exact round trip: the derived double IS the old 0.008 literal, so
    // the GLSL template literals in env.ts, cloud-motion.ts and cloud-memory.ts
    // still emit the string "0.008" and their digest pins are untouched.
    expect(RENDER_RADIUS_FLOOR).toBe(0.008);
    expect(String(RENDER_RADIUS_FLOOR)).toBe('0.008');
  });

  it('the floor stays below the RMW clamp, which is why it never binds', () => {
    // structure.ts clamps rmwKm to [12, 95]. Expressed in km the floor is
    // domain-invariant, so this stays true after a domain change; expressed in
    // clip units it would become 13.3 km at 0-30 N and start overriding the
    // 12 km RMW floor -- the re-coupling CLAUDE.md's rCanopy note warns about.
    expect(RENDER_RADIUS_FLOOR_KM).toBeLessThan(12);
  });
});
```
and extend the import block to include `RENDER_RADIUS_FLOOR_KM`:
```ts
import {
  CANOPY_COEFFICIENT_DIVISOR,
  RENDER_RADIUS_FLOOR,
  RENDER_RADIUS_FLOOR_KM,
  stormRenderRadii,
} from '../src/render/storm-radii';
```

*Expected:* `npm run build` fails at `tsc --noEmit` with `error TS2305: Module '"../src/render/storm-radii"' has no exported member 'RENDER_RADIUS_FLOOR_KM'.`

- [ ] **Step 3: Restate storm-radii.ts's floor in km**

Before, `src/render/storm-radii.ts` lines 18-19 (as they stand after Task 2):
```ts
/** Shared numerical floor; matches the existing guards in env.ts and radar.ts. */
export const RENDER_RADIUS_FLOOR = 0.008;
```
After:
```ts
/**
 * Shared numerical floor, in KILOMETRES. Denominated in km, not clip units, so
 * it cannot rescale with the domain: as a clip literal 0.008 is 5.33 km today
 * and would be 13.3 km over a 0-30 N domain, overriding structure.ts's 12 km
 * rmwKm floor and re-coupling the canopy to the core.
 */
export const RENDER_RADIUS_FLOOR_KM = 5.328;

/**
 * The same floor in clip units — 5.328 / 666 is bit-exactly 0.008, so the GLSL
 * template literals in env.ts, cloud-motion.ts and cloud-memory.ts still emit
 * "0.008" and their digest pins are unaffected. Kept exported: six modules
 * consume it as a clip value.
 */
export const RENDER_RADIUS_FLOOR = RENDER_RADIUS_FLOOR_KM / HALF_DOMAIN_HEIGHT_KM;
```

Then hoist the division in `stormRenderRadii`. Before, lines 35-48:
```ts
export function stormRenderRadii(
  structure: Pick<StormStructure, 'rmwKm' | 'outerSizeKm'>,
): StormRenderRadii {
  return {
    rMax: Math.max(
      RENDER_RADIUS_FLOOR,
      structure.rmwKm / HALF_DOMAIN_HEIGHT_KM,
    ),
    rCanopy: Math.max(
      RENDER_RADIUS_FLOOR,
      structure.outerSizeKm / HALF_DOMAIN_HEIGHT_KM,
    ),
  };
}
```
After:
```ts
export function stormRenderRadii(
  structure: Pick<StormStructure, 'rmwKm' | 'outerSizeKm'>,
): StormRenderRadii {
  // Clamp in km, convert once. Because RENDER_RADIUS_FLOOR_KM /
  // HALF_DOMAIN_HEIGHT_KM is bit-exactly RENDER_RADIUS_FLOOR and the division
  // is monotone, this returns the identical double as the old clip-space form
  // for every input, including the floored branch.
  return {
    rMax:
      Math.max(RENDER_RADIUS_FLOOR_KM, structure.rmwKm) / HALF_DOMAIN_HEIGHT_KM,
    rCanopy:
      Math.max(RENDER_RADIUS_FLOOR_KM, structure.outerSizeKm) /
      HALF_DOMAIN_HEIGHT_KM,
  };
}
```

*Expected:* `npx vitest run test/storm-radii.test.ts` passes, including the existing `expect(degenerate.rCanopy).toBe(RENDER_RADIUS_FLOOR)` at line 29 (`Math.max(5.328, 0) / 666 === 0.008`) and the two new assertions. `npm run realism:check` exits 0 — `realism-cloud-sample.ts` and `realism-proxy.ts` consume this constant and feed the sealed R2a numbers.

- [ ] **Step 4: Restate wind.ts's 0.012 floor**

Add a module constant in `src/render/wind.ts`, immediately after the `METRIC_X` block that ends at line 58:
```ts
/**
 * Vortex RMW floor for the wind-line field, in KILOMETRES (7.992 / 666 is
 * bit-exactly the old 0.012 clip literal). In km it cannot rescale with the
 * domain; structure.ts clamps rmwKm to >= 12, so it never binds in practice.
 */
const VORTEX_RMAX_FLOOR_KM = 7.992;
```

Before, line 268:
```ts
        rMax: Math.max(0.012, s.rmwKm / HALF_DOMAIN_HEIGHT_KM),
```
After:
```ts
        rMax:
          Math.max(VORTEX_RMAX_FLOOR_KM, s.rmwKm) / HALF_DOMAIN_HEIGHT_KM,
```
Bit-identical for every input: for `rmwKm >= 7.992` both give `rmwKm / 666`; for `rmwKm < 7.992` both give `0.012`, since `7.992 / 666 === 0.012` exactly and division by a positive constant is monotone and correctly rounded.

*Expected:* `npm test` passes. No test currently imports `src/render/wind.ts` (verified: `grep -rn "render/wind" test/ calibration/` returns nothing), so the guarantee here is the arithmetic argument plus `npm run build`.

- [ ] **Step 5: Restate rain.ts's 0.015 floor and 0.16 cap**

Add two module constants in `src/render/rain.ts`, immediately after the import block (after line 61, `import { HALF_DOMAIN_HEIGHT_KM } from './storm-radii';`):
```ts
/**
 * Rain-shader core radius bounds, in KILOMETRES. 9.99 / 666 and 106.56 / 666
 * are the old 0.015 and 0.16 clip literals. Denominated in km so a domain
 * change cannot rescale them; structure.ts clamps rmwKm to [12, 95], so both
 * bounds sit outside the reachable range and neither binds today.
 */
const RAIN_RMAX_FLOOR_KM = 9.99;
const RAIN_RMAX_CAP_KM = 106.56;
```

Before, lines 341-346:
```ts
    const rMax = structure
      ? Math.max(
          0.015,
          Math.min(0.16, structure.rmwKm / HALF_DOMAIN_HEIGHT_KM),
        )
      : RMAX_BASE * (0.7 + 0.6 * ctx.intensity01);
```
After:
```ts
    const rMax = structure
      ? Math.max(
          RAIN_RMAX_FLOOR_KM,
          Math.min(RAIN_RMAX_CAP_KM, structure.rmwKm),
        ) / HALF_DOMAIN_HEIGHT_KM
      : RMAX_BASE * (0.7 + 0.6 * ctx.intensity01);
```
Hoisting the division is required here, not cosmetic: `9.99 / 666` is `0.015000000000000001`, one ULP above the old literal, so a naive clip-space restatement would NOT be a no-op. Hoisted, every reachable input (`rmwKm` clamped to [12, 95], `12 / 666 = 0.018018 > 0.015` and `95 / 666 = 0.142643 < 0.16`) takes the pass-through branch and returns exactly `structure.rmwKm / HALF_DOMAIN_HEIGHT_KM` — the identical double the old expression returned. The one-ULP difference exists only in a branch `structure.ts` makes unreachable.

*Expected:* `npm test` passes. `npx vitest run test/rain-accumulation.test.ts test/rainband-profile.test.ts test/radar-reflectivity.test.ts` passes — none of them imports `render/rain.ts`, so this is confirmation that nothing downstream moved.

- [ ] **Step 6: Restate particles.ts's 0.015 floor, 0.16 cap and 0.46 spawn cap**

Add three module constants in `src/render/particles.ts`, immediately after the import at line 27 (`import { HALF_DOMAIN_HEIGHT_KM } from './storm-radii';`):
```ts
/**
 * Particle-field radius bounds, in KILOMETRES. 9.99 / 666, 106.56 / 666 and
 * 306.36 / 666 are bit-exactly the old 0.015, 0.16 and 0.46 clip literals.
 * Denominated in km so a domain change cannot rescale them.
 */
const PARTICLE_RMAX_FLOOR_KM = 9.99;
const PARTICLE_RMAX_CAP_KM = 106.56;
const PARTICLE_SPAWN_RADIUS_CAP_KM = 306.36;
```

Before, lines 74-83:
```ts
  const rMax = Math.max(
    0.015,
    Math.min(0.16, structure.rmwKm / HALF_DOMAIN_HEIGHT_KM),
  );
  const r34 = maxWindRadiusKm(structure.r34Km);
  const outerKm = Math.max(structure.rmwKm * 4, r34 * 1.08);
  const spawnR = Math.max(
    rMax * 2.5,
    Math.min(0.46, outerKm / HALF_DOMAIN_HEIGHT_KM),
  );
```
After:
```ts
  const rMax =
    Math.max(
      PARTICLE_RMAX_FLOOR_KM,
      Math.min(PARTICLE_RMAX_CAP_KM, structure.rmwKm),
    ) / HALF_DOMAIN_HEIGHT_KM;
  const r34 = maxWindRadiusKm(structure.r34Km);
  const outerKm = Math.max(structure.rmwKm * 4, r34 * 1.08);
  const spawnR = Math.max(
    rMax * 2.5,
    Math.min(PARTICLE_SPAWN_RADIUS_CAP_KM, outerKm) / HALF_DOMAIN_HEIGHT_KM,
  );
```
The `spawnR` cap is bit-identical for every input, not just reachable ones: `306.36 / 666 === 0.46` exactly, so the capped branch returns the same double and the uncapped branch returns `outerKm / 666` either way. The `rMax` argument is the same hoisting case as `rain.ts` above. `rMax * 2.5` stays in clip units deliberately — it is a ratio of the already-converted radius, not a km bound.

*Expected:* `npm test` passes; `npm run build` passes. No test imports `src/render/particles.ts` (verified this session), so the guarantee is the arithmetic argument plus a clean type-check.

- [ ] **Step 7: Run the full phase gate and commit**

```
npm test
npm run build
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
git add src/render/storm-radii.ts src/render/wind.ts src/render/rain.ts src/render/particles.ts test/storm-radii.test.ts
git commit -m "refactor: denominate the render radius floors in kilometres"
git status --porcelain calibration docs public/data
```

*Expected:* All commands exit 0. The final `git status --porcelain calibration docs public/data` prints NOTHING. `npm run realism:check` in particular must be green — `RENDER_RADIUS_FLOOR` reaches the sealed R2a numbers through `realism-cloud-sample.ts:198-199` and `realism-proxy.ts:108`.


**Unverified in this phase — the implementer must check:**

- The design spec's line numbers for two sites are wrong and I corrected them against the tree this session: `src/fidelity-verification.ts` has TWO `DOMAIN` uses at lines 407 and 413 (not one at 403 — 403 is the first line of the statement containing the first use), and `src/render/terrain.ts:23` holds `KM_PER_LAT_DEGREE = 111.195` (there is no `src/terrain.ts`). The `test/realism-metrics.test.ts:195` guard is the comment; the assertion is line 200. The `test/realism-proxy.test.ts:356` guard is the `it(` line; the assertion is line 360. Re-verify every line number before editing — the tree moves.
- I added `calibration/fidelity.mjs:676` (`domain: DOMAIN` inside `verificationProtocol`) to Task 1's list; the design spec does not name it. It is the site that actually writes bytes: `calibration/fidelity-results.json` records `verificationProtocol.domain` as `{lonMin:50,lonMax:70,latMin:15,latMax:27}` today. If a reviewer rejects the addition as out of scope, the phase still passes its gate, but the domain flip will then change a sealed result file for a non-physics reason. I recommend keeping it.
- `src/tracks.ts:126` (`if (!inBBox(p.lat, p.lon, DOMAIN)) continue;`) filters observed track fixes against the live `DOMAIN` and is consumed by `parseTracks` in fidelity.mjs, hf3-wander-calibration.mjs and the hindcast path. It is arguably a sixth scoring site. I deliberately left it alone because it is also a runtime path (`src/main.ts` and the UI consume parsed tracks), so repointing it needs its own decision about whether the shipped app should show fixes outside the scoring box. Raise it before Phase 8; it is not zero-diff-safe to defer past the domain flip.
- Task 3 changes one number: `camera.ts`'s radian conversion moves from `lat * (Math.PI / 180)` to `(lat * Math.PI) / 180`. Measured over 200,001 samples in 0–30 °N, 4,442 differ, worst relative difference 3.08e-16. I argued this cannot change `viewKey` (toFixed(9) on values of order 1–20) and reaches no sealed artifact, but I could not run `test/camera.test.ts` to confirm no `toBeCloseTo` sits exactly on a boundary. If a camera assertion fails by ~1e-16, that is this change and the fix is to loosen that one assertion's precision, not to reintroduce `DEG2RAD`.
- `clampPass` in `camera.ts` uses `metricX` inside the comparison `halfW * 2 >= DISPLAY_WORLD.maxX - DISPLAY_WORLD.minX`, which selects a clamp branch. A 1-ULP change in the metric could in principle flip that comparison exactly at the boundary. Presentation-only, but if `test/camera-gestures.test.ts` shows a surprising boundary failure this is the mechanism.
- Sites 3 and 4 of Task 5 (`rain.ts`, `particles.ts`) are NOT bit-identical in the floored branch: `9.99 / 666` is `0.015000000000000001`, not `0.015`. I proved the branch is unreachable because `structure.ts` clamps `rmwKm` to `[rmwMinKm=12, rmwMaxKm=95]` (`src/structure.ts:89-90, 698-702`) and `12 / 666 = 0.018018 > 0.015`. That proof depends on `DEFAULT_STRUCTURE_PARAMETERS.rmwMinKm` staying at 12. If a later phase lowers it below 9.99 km, the floor becomes reachable and the two forms diverge by 1 ULP in a `gl.uniform1f` value that is float32-downcast anyway. Verify `rmwMinKm` is still 12 before accepting the task.
- No test currently imports `src/render/wind.ts`, `src/render/rain.ts` or `src/render/particles.ts` (verified with `grep -rn "render/wind\|render/rain\|render/particles" test/ calibration/` — zero hits). Three of Task 5's four edits therefore have no automated coverage beyond `tsc --noEmit`. The arithmetic arguments in each step are the evidence; a browser-QA pass on the rain, wind and particle layers would be a cheap independent confirmation and I could not run one.
- I placed `RENDER_KM_PER_LAT_DEG`, `HALF_DOMAIN_HEIGHT_KM` and `worldMetricX` in `src/grid.ts` rather than a new module. This is a judgement call: it keeps `src/camera.ts` from importing a render path (forbidden by `docs/superpowers/plans/2026-08-07-shared-camera.md:107-114`) and lets `src/realism-metrics.ts` drop its duplicate without importing a render path either. It grows `grid.ts` from 186 to roughly 226 lines — still inside the 200–400 band — and puts a render-only 111 next to the physics 111_320, which is exactly where the documented disagreement belongs. If a reviewer prefers a separate `src/world-metric.ts`, the tasks port over unchanged; only the import specifiers move.
- `src/scoring-domain.ts` is a new module and `docs/architecture.md`'s module table will be stale until it is added. I deliberately did NOT edit it, because this phase's gate is that `git status --porcelain calibration docs public/data` prints nothing and I did not want a docs edit muddying that signal. The row belongs in the Phase 3 governance commit; note it there or it will be forgotten.
- `src/impact.ts:408` and `:411` also use a bare `111` km-per-degree for their cell-size estimate. It is the same number as `RENDER_KM_PER_LAT_DEG` but a different concern (impact grid geometry), and Phase 9 owns that file. I left it alone; do not unify it here.

---

## Phase 1B — safety and silent-failure closure, zero-diff at the Arabian Sea domain (nio-v1)

Five independent tasks that harden the engine and the bake before any asset is re-baked at the new 45–100 °E / 0–30 °N extent. Task 1 gives storms a lifetime bound (`SIM.MAX_AGE_H = 360`) that is unreachable today by construction. Task 2 replaces `upper-ocean.ts`'s `Math.round` cell tie with an explicit containing-cell rule in `grid.ts`, in a form measured to be bit-identical today, and ships the tested snap behaviour that Phase 8 turns on. Task 3 probes `gl.MAX_TEXTURE_SIZE` and adds `src/render/texture-fit.ts` (render-only, never on a physics path). Tasks 4 and 5 close the four silent-failure paths from design §3.5: bin extent validation in TypeScript, and cache-extent / extrapolation / quantization-saturation guards in Python. A reviewer knows this worked when, from a clean tree, `npm test && npm run calibrate:check && npm run hf6:verify:check && npm run hf6:gate:check && npm run hf6:prospective:check && npm run realism:check && npm run build` all pass AND `git status --porcelain calibration docs public/data` prints nothing. That last command is the phase gate: this phase changes no committed byte outside `src/`, `test/` and `bake/`.

**Files in this phase:**

```
src/types.ts — MODIFY: add `DeathReason.MaxAge` to the enum at :399-405 (Task 1)
src/sim.ts — MODIFY: add `SIM.MAX_AGE_H` after `DESPAWN_VKT` (:79) and a third lifecycle branch at :1378-1383 (Task 1)
src/ui.ts — MODIFY: add the `MaxAge` epitaph phrase at :1759-1765 (Task 1); route `isLand` through `sampleLayerNearest` at :1696-1705 (Task 3)
test/max-age.test.ts — CREATE: proves the cap fires at 360.25 h and pre-empts nothing today (Task 1)
src/grid.ts — MODIFY: add `cellIndexFromOrigin`, `columnIndex`, `rowIndex` after `latLonToCell` (:89) (Task 2)
src/upper-ocean.ts — MODIFY: `cell()` at :564-570 indexes off the bbox origin; drop the now-unused `latLonToCell` import at :15 (Task 2)
test/cell-index.test.ts — CREATE: bit-identity sweep vs today's rule, plus the stable 0.1-degree walk (Task 2)
src/render/gl-utils.ts — MODIFY: `GlCaps` gains `maxTextureSize`; `probeCaps` reads `gl.MAX_TEXTURE_SIZE` (:106-116) (Task 3)
src/render/index.ts — MODIFY: the `GlCaps` literal at :235 gains `maxTextureSize` (Task 3)
src/render/wind.ts — MODIFY: the `GlCaps` literal at :137 gains `maxTextureSize` (Task 3)
src/render/texture-fit.ts — CREATE: `fitFactor`, `reducedDims`, `binarize`, `boxReduce`, `majorityReduce`, `strideReduce` (Task 3)
src/raster-sampler.ts — MODIFY: add `sampleLayerNearest`, byte-identical to today's `ui.isLand` body (Task 3)
test/texture-fit.test.ts — CREATE: reducer contracts, non-commutation proof, and the land-predicate determinism guard (Task 3)
src/bin-domain-guard.ts — CREATE: `validateBinDomain` / `assertBinDomain` — the one place a bin's nx/ny/bbox is checked against `DOMAIN` (Task 4)
src/scenarios.ts — MODIFY: `validateEventBinForScenario` at :183-202 calls the guard first (Task 4)
src/ensemble.worker.ts — MODIFY: assert every loaded bin's domain after :71 (Task 4)
test/event-bin.test.ts — MODIFY: add the wrong-extent rejection cases after :106 (Task 4)
test/bin-domain-guard.test.ts — CREATE: guard unit tests plus the worker call-site pin (Task 4)
bake/fetch_era5.py — MODIFY: cache skip at :206 validates extent, not existence (Task 5)
bake/fetch_event_benchmark.py — MODIFY: cache skip at :64 validates extent, not existence (Task 5)
bake/era5.py — MODIFY: `_to_env_grid` at :330 stops extrapolating (Task 5)
bake/era5_event.py — MODIFY: `_regrid_series` at :176-177 stops extrapolating (Task 5)
bake/bake.py — MODIFY: `q_u16` at :169-170 and `basin_clip` at :173 raise instead of clipping (Task 5)
bake/netcdf_extent.py — CREATE: the shared `valid_cached_netcdf` extent check reused by both fetchers (Task 5)
bake/test_guards.py — CREATE: standalone-assert offline tests for the Python guards (Task 5)
```

### Task 13: MAX_AGE_H — a lifetime bound that is unreachable today

**Files:**

```
Modify: src/types.ts:398-405 | Modify: src/sim.ts:75-80 | Modify: src/sim.ts:1378-1383 | Modify: src/ui.ts:1759-1765 | Test: test/max-age.test.ts (create)
```

**Consumes:** nothing

**Produces:** `DeathReason.MaxAge = 'max-age'` (src/types.ts) and `SIM.MAX_AGE_H = 360` (src/sim.ts). No later task in this phase consumes either.

- [ ] **Step 1: Understand why the cap is currently unreachable**

Read these three facts before writing anything. Do not edit yet.

1. `src/sim.ts:1378-1383` is the ONLY lifetime bound in the physics core:

```ts
    // 6) Lifecycle: exit-domain wins over intensity; then the <20 kt floor.
    if (!inBBox(lat, lon, DOMAIN)) {
      die(DeathReason.ExitedDomain, events);
    } else if (vKt < SIM.DESPAWN_VKT) {
      die(reasonFromRecent(), events);
    }
```

2. `src/ensemble.ts:183` reads `const maxHours = options.maxHours ?? 360;` and `:188` turns that into `maxTicks = Math.ceil((maxHours * 60) / dtMin)` with `dtMin = 15` — exactly 1440 ticks. `ageH` advances by `dtH = 0.25` per tick (`sim.ts:1251`), and 0.25 is a power of two, so after 1440 ticks `ageH === 360` EXACTLY in IEEE754.

3. Therefore a `>=` comparison would newly emit a `died` event on the final tick of every 360-hour harness run and change `durationH`/`death` in recorded ensemble output. The comparison MUST be strict `>`. That is the whole zero-diff argument; write it into the code comment in step 5.

*Expected:* No file changed. You can state, in one sentence, why `>` and not `>=`.

- [ ] **Step 2: Write the failing test**

Create `test/max-age.test.ts` with exactly this content:

```ts
/**
 * max-age.test.ts — SIM.MAX_AGE_H, the lifetime bound (nio-v1 Phase 1).
 *
 * Today the exit-domain test at sim.ts:1379 ends every real storm long before
 * any age cap, so the cap must be provably inert. This file proves BOTH halves:
 * (a) the cap never pre-empts an existing outcome, and it is strictly outside
 *     the 360-hour horizon `ensemble.runStorm` already stops at — so no recorded
 *     ensemble result gains a death record;
 * (b) the cap does fire for a storm the exit test cannot reach, built as the
 *     design-spec section 3.2 probe: beta drift cancelled by the environmental
 *     steer, stochastic wander disabled, a slow eastward drift that stays in box.
 */

import { describe, it, expect } from 'vitest';
import type { EnvSample, EnvSampler, SimEngine, SimEvent, SpawnParams, StormDeath } from '../src/types';
import { DeathReason } from '../src/types';
import { SIM, createSimEngine } from '../src/sim';
import { runStorm } from '../src/ensemble';
import { DOMAIN, inBBox } from '../src/grid';

const DT = 15; // the fixed accumulator step, sim-minutes
/** sim.ts:72's module-local MS_PER_KT, duplicated because it is not exported. */
const MS_PER_KT = 0.514444;
/** sim.ts:808-812's shipped-profile beta drift is {u:-B, v:+B} with this B. */
const BETA_SPEED_MS = SIM.BETA_DRIFT_KT * MS_PER_KT * Math.SQRT1_2;
/** Slow enough to stay in the box for 360 h, fast enough to avoid wake saturation. */
const DRIFT_EAST_MS = 1;

function env(over: Partial<EnvSample> = {}): EnvSampler {
  const s: EnvSample = {
    sstC: 29.5,
    steerU: 0,
    steerV: 0,
    shear: 0,
    shearU: 0,
    shearV: 0,
    midlevelRhPct: 75,
    ohcKjCm2: 120,
    ...over,
  };
  return { sample: () => ({ ...s }) };
}

const NO_LAND = () => false;

/** Net motion: +1 m/s east, 0 north. Beta drift is cancelled exactly in v. */
const IMMORTAL_ENV = env({
  steerU: BETA_SPEED_MS + DRIFT_EAST_MS,
  steerV: -BETA_SPEED_MS,
});

function immortalSpawn(): SpawnParams {
  return {
    lat: 21,
    lon: 53,
    monthIndex: 5,
    seed: 12345,
    isDemo: false,
    disableWander: true,
  };
}

function firstDeath(events: SimEvent[]): StormDeath | null {
  for (const e of events) if (e.type === 'died') return e.death;
  return null;
}

describe('SIM.MAX_AGE_H: the declared lifetime bound', () => {
  it('is 360 hours, matching ensemble.ts:183 maxHours', () => {
    expect(SIM.MAX_AGE_H).toBe(360);
  });

  it('is strictly outside the 360-hour horizon runStorm already stops at', () => {
    const result = runStorm({
      env: IMMORTAL_ENV,
      isLand: NO_LAND,
      spawn: immortalSpawn(),
    });
    // If this flips to a death record, every recorded ensemble result changes.
    expect(result.death).toBeNull();
    expect(result.durationH).toBe(360);
  });

  it('fires on the first tick past the cap, for a storm the exit test cannot reach', () => {
    const engine: SimEngine = createSimEngine({ env: IMMORTAL_ENV, isLand: NO_LAND });
    engine.spawn(immortalSpawn());
    // 1440 ticks of 15 min = exactly 360.00 h.
    let events: SimEvent[] = [];
    for (let i = 0; i < 1440; i++) events = engine.tick(DT);
    const at360 = engine.getState()!;
    expect(at360.alive).toBe(true);
    expect(at360.ageH).toBe(360);
    expect(firstDeath(events)).toBeNull();
    // Fixture sanity: the exit test must not be what ends this storm.
    expect(inBBox(at360.lat, at360.lon, DOMAIN)).toBe(true);
    expect(at360.lat).toBeCloseTo(21, 6);
    expect(at360.vKt).toBeGreaterThanOrEqual(SIM.DESPAWN_VKT);

    const finalEvents = engine.tick(DT);
    const death = firstDeath(finalEvents);
    expect(death).not.toBeNull();
    expect(death!.reason).toBe(DeathReason.MaxAge);
    expect(death!.durationH).toBe(360.25);
    expect(engine.getState()!.alive).toBe(false);
  });
});

describe('SIM.MAX_AGE_H: pre-empts no existing outcome', () => {
  const cases: Array<[string, Partial<EnvSample>, Partial<SpawnParams>, DeathReason]> = [
    ['cold water', { sstC: 22 }, {}, DeathReason.ColdWater],
    ['extreme shear', { sstC: 30, shear: 40 }, {}, DeathReason.Shear],
    ['east edge', { sstC: 29, steerU: 20 }, { lat: 21, lon: 69 }, DeathReason.ExitedDomain],
    ['west edge', { sstC: 29, steerU: -20 }, { lat: 21, lon: 51 }, DeathReason.ExitedDomain],
    ['north edge', { sstC: 29, steerV: 20 }, { lat: 26, lon: 60 }, DeathReason.ExitedDomain],
    ['south edge', { sstC: 29, steerV: -20 }, { lat: 16, lon: 60 }, DeathReason.ExitedDomain],
  ];
  for (const [name, over, spawnOver, reason] of cases) {
    it(`${name} still dies of ${reason}, before the cap`, () => {
      const engine = createSimEngine({ env: env(over), isLand: NO_LAND });
      engine.spawn({ lat: 21, lon: 60, monthIndex: 5, seed: 12345, isDemo: false, ...spawnOver });
      let death: StormDeath | null = null;
      for (let i = 0; i < 2000 && death === null; i++) death = firstDeath(engine.tick(DT));
      expect(death, name).not.toBeNull();
      expect(death!.reason).toBe(reason);
      expect(death!.durationH).toBeLessThan(SIM.MAX_AGE_H);
    });
  }
});
```

*Expected:* File created. Nothing run yet.

- [ ] **Step 3: Run it and watch it fail**

```
npx vitest run test/max-age.test.ts
```

*Expected:* Failures, not an unhandled crash. The first is `AssertionError: expected undefined to be 360` on `expect(SIM.MAX_AGE_H).toBe(360)` — vitest strips TypeScript types, so a missing enum member and a missing constant both read as `undefined` at runtime. The 'fires on the first tick past the cap' case fails with `expected undefined not to be null` at `expect(death).not.toBeNull()`. The six pre-emption cases PASS already (they must — they describe today's behaviour).

- [ ] **Step 4: Add the enum member**

In `src/types.ts`, replace lines 398-405:

BEFORE
```ts
/** Why a storm stopped being a storm. Drives the epitaph copy. */
export enum DeathReason {
  ColdWater = 'cold-water',
  Shear = 'shear',
  Land = 'land',
  DryAir = 'dry-air',
  ExitedDomain = 'exited-domain',
}
```

AFTER
```ts
/** Why a storm stopped being a storm. Drives the epitaph copy. */
export enum DeathReason {
  ColdWater = 'cold-water',
  Shear = 'shear',
  Land = 'land',
  DryAir = 'dry-air',
  ExitedDomain = 'exited-domain',
  /** Reached SIM.MAX_AGE_H. Unreachable inside the 50-70E/15-27N domain. */
  MaxAge = 'max-age',
}
```

Then run:

```
npm run build
```

*Expected:* `tsc --noEmit` FAILS with `src/ui.ts(1759,7): error TS2741: Property '[DeathReason.MaxAge]' is missing in type '{ ... }' but required in type 'Record<DeathReason, string>'.` That error is the point: the exhaustive `Record` makes a new death reason impossible to smuggle past the UI copy.

- [ ] **Step 5: Add the epitaph phrase**

In `src/ui.ts`, replace lines 1759-1765:

BEFORE
```ts
const REASON_PHRASE: Record<DeathReason, string> = {
  [DeathReason.ColdWater]: 'starved over cool water',
  [DeathReason.Shear]: 'torn apart by wind shear',
  [DeathReason.Land]: 'wrung out over land',
  [DeathReason.DryAir]: 'choked on dry desert air',
  [DeathReason.ExitedDomain]: 'drifted off the map',
};
```

AFTER
```ts
const REASON_PHRASE: Record<DeathReason, string> = {
  [DeathReason.ColdWater]: 'starved over cool water',
  [DeathReason.Shear]: 'torn apart by wind shear',
  [DeathReason.Land]: 'wrung out over land',
  [DeathReason.DryAir]: 'choked on dry desert air',
  [DeathReason.ExitedDomain]: 'drifted off the map',
  [DeathReason.MaxAge]: 'ran out the simulated clock',
};
```

Then run:

```
npm run build
```

*Expected:* `tsc --noEmit` passes and `vite build` completes. No TS2741.

- [ ] **Step 6: Add the constant, with the caveat the spec requires**

In `src/sim.ts`, replace lines 75-80:

BEFORE
```ts
export const SIM = {
  /** Intensity a fresh storm spawns at, knots (a strong depression). */
  SPAWN_VKT: 30,
  /** Storm dies below this sustained wind, knots (design lifecycle rule). */
  DESPAWN_VKT: 20,
```

AFTER
```ts
export const SIM = {
  /** Intensity a fresh storm spawns at, knots (a strong depression). */
  SPAWN_VKT: 30,
  /** Storm dies below this sustained wind, knots (design lifecycle rule). */
  DESPAWN_VKT: 20,
  /**
   * Hard lifetime bound, simulated hours. A CALIBRATED MODEL PARAMETER, not a
   * guard rail — read this before touching it.
   *
   * Provenance is `ensemble.ts:183`'s existing `maxHours = 360`, and that
   * provenance is weak. Today the value is inert: inside the 50-70E/15-27N box
   * the exit-domain test at the bottom of tick() ends every storm first, and
   * the comparison below is STRICTLY greater so a run stopped at exactly 360 h
   * (which is what `ensemble.runStorm` does by default) never reaches it. That
   * is what keeps this addition zero-diff.
   *
   * THE ZERO-DIFF PROPERTY EXPIRES AT THE DOMAIN FLIP. Over 45-100E/0-30N a
   * probe ran nine spawn latitudes over constant 29.5 C water for the full
   * 240 h with `reason = null`, so after the flip this cap becomes the dominant
   * death mechanism for a large share of storms — a first-order physics
   * parameter. It belongs in the HF-7 charter's frozen-input set and in the
   * model card; HF-7 scores dissipation timing and cannot treat it as free.
   */
  MAX_AGE_H: 360,
```

*Expected:* File edited. `npx vitest run test/max-age.test.ts` now fails only on the 'fires on the first tick past the cap' case (the `SIM.MAX_AGE_H` assertion passes).

- [ ] **Step 7: Add the lifecycle branch**

In `src/sim.ts`, replace lines 1378-1383:

BEFORE
```ts
    // 6) Lifecycle: exit-domain wins over intensity; then the <20 kt floor.
    if (!inBBox(lat, lon, DOMAIN)) {
      die(DeathReason.ExitedDomain, events);
    } else if (vKt < SIM.DESPAWN_VKT) {
      die(reasonFromRecent(), events);
    }
```

AFTER
```ts
    // 6) Lifecycle: exit-domain wins over intensity; then the <20 kt floor;
    // then the age cap LAST, so it can never pre-empt an existing outcome.
    // The comparison is strictly greater on purpose: `ensemble.runStorm` stops
    // at exactly SIM.MAX_AGE_H, and `>=` would emit a death event on that final
    // tick, changing every recorded ensemble result. See SIM.MAX_AGE_H.
    if (!inBBox(lat, lon, DOMAIN)) {
      die(DeathReason.ExitedDomain, events);
    } else if (vKt < SIM.DESPAWN_VKT) {
      die(reasonFromRecent(), events);
    } else if (ageH > SIM.MAX_AGE_H) {
      die(DeathReason.MaxAge, events);
    }
```

Then run:

```
npx vitest run test/max-age.test.ts
```

*Expected:* All 9 cases pass. In particular `death.durationH` is exactly `360.25` and `result.death` from `runStorm` is still `null`.

- [ ] **Step 8: Run the full phase gate and commit**

```
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
git status --porcelain calibration docs public/data
```

Then:

```
git add src/types.ts src/sim.ts src/ui.ts test/max-age.test.ts
git commit -m "feat(sim): bound storm lifetime with SIM.MAX_AGE_H"
```

*Expected:* Every command exits 0. `git status --porcelain calibration docs public/data` prints NOTHING — no calibration result, no generated report and no baked asset moved. If `calibrate:check` reports drift, revert and stop: the branch must be strictly greater and must be the last branch.

---

### Task 14: Index ocean cells off the bbox origin, not off a Math.round tie

**Files:**

```
Modify: src/grid.ts:81-89 (append after `latLonToCell`) | Modify: src/upper-ocean.ts:15 | Modify: src/upper-ocean.ts:564-570 | Test: test/cell-index.test.ts (create)
```

**Consumes:** nothing

**Produces:** `cellIndexFromOrigin(value, origin, delta, count, snapEpsilon?)`, `columnIndex(spec, lon, snapEpsilon?)`, `rowIndex(spec, lat, snapEpsilon?)`, `STABLE_CELL_SNAP_EPSILON` — all exported from `src/grid.ts`. `OCEAN_CELL_SNAP_EPSILON` is module-private in `src/upper-ocean.ts`. No later task in this phase consumes them.

- [ ] **Step 1: Read the defect and the measurement that constrains the fix**

`src/upper-ocean.ts:564-570` is today:

```ts
  private cell(lat: number, lon: number): { col: number; row: number } {
    const at = latLonToCell(OCEAN_GRID, lat, lon);
    return {
      col: clamp(Math.round(at.col), 0, OCEAN_GRID.nx - 1),
      row: clamp(Math.round(at.row), 0, OCEAN_GRID.ny - 1),
    };
  }
```

`grid.ts:86-87` makes `at.col = (lon - 50) / 0.1 - 0.5`, so for any 0.1-degree coordinate that is mathematically an exact half-integer and `Math.round`'s ties-to-+infinity behaviour decides the cell — except last-bit float error usually decides it first. Walking `lon = 50 + k/10` for k = 0..200 through today's rule produces the column sequence `0,1,2,2,3,5,6,7,7,8,10,11,...`: duplicates AND skips.

Two measurements taken against this repository on 2026-08-10 constrain what you may do:

1. `Math.round(t - 0.5)` and `Math.floor(t)` (with `t = (lon - lonMin)/dLon` computed identically) agree for EVERY point on that walk — 0 mismatches. `t - 0.5` is exact in IEEE754 for all `t` in [0.5, 2^52), so flooring the origin-relative offset is a bit-identical restatement of today's rule.
2. Snapping (`Math.floor(t + 1e-9)`) is NOT zero-diff. It moves 38 of the 81 shipped spawn points in `public/data/scenarios.json` + `public/data/genesis.json` by one ocean cell — for example `gonu`'s hindcast lon 67.1 goes from column 170 to 171, and lat 23.6 from row 33 to 34. `SparseUpperOcean.sample` is called with the raw spawn lat/lon at `sim.ts:1047`, so those 38 storms would start over a different ocean column, change their tracks, and break `calibrate:check`.

So: the rule ships now in its bit-identical form, and the snap ships as a tested, named, OFF switch that Phase 8 flips together with `DOMAIN`.

*Expected:* You can state, without running anything, why `snapEpsilon` must default to 0 in Phase 1.

- [ ] **Step 2: Write the failing test**

Create `test/cell-index.test.ts`:

```ts
/**
 * cell-index.test.ts — the containing-cell index rule (nio-v1 Phase 1).
 *
 * upper-ocean.ts used to index cells with Math.round on the continuous cell
 * coordinate, whose value is an exact half-integer for every 0.1-degree
 * coordinate; the rounding direction was then decided by last-bit float error.
 * grid.ts now owns an explicit containing-cell rule indexed off the bbox
 * origin. Two properties are pinned here:
 *   1. at snapEpsilon = 0 the new rule is BIT-IDENTICAL to the old expression,
 *      which is what makes the change safe to land inside a zero-diff phase;
 *   2. at STABLE_CELL_SNAP_EPSILON a 0.1-degree walk yields 0,1,2,...,n-1 with
 *      every step exactly 1 — no duplicate, no skip. That is the behaviour the
 *      domain flip needs; it is measured NOT to be zero-diff (38 of 81 shipped
 *      spawn points move one cell), so it stays off until Phase 8.
 */

import { describe, it, expect } from 'vitest';
import {
  DOMAIN,
  STABLE_CELL_SNAP_EPSILON,
  cellIndexFromOrigin,
  columnIndex,
  latLonToCell,
  rowIndex,
} from '../src/grid';
import type { GridSpec } from '../src/types';

/** The runtime ocean grid: 0.1 degrees over DOMAIN (upper-ocean.ts:139-143). */
const OCEAN_GRID: GridSpec = { nx: 200, ny: 120, bbox: DOMAIN };

/** Verbatim reproduction of the pre-fix upper-ocean.ts:564-570 expression. */
function legacyCell(lat: number, lon: number): { col: number; row: number } {
  const at = latLonToCell(OCEAN_GRID, lat, lon);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    col: clamp(Math.round(at.col), 0, OCEAN_GRID.nx - 1),
    row: clamp(Math.round(at.row), 0, OCEAN_GRID.ny - 1),
  };
}

describe('cellIndexFromOrigin at snapEpsilon 0 is bit-identical to the old rule', () => {
  it('agrees over a dense sweep of the ocean grid', () => {
    let checked = 0;
    for (let i = 0; i <= 20000; i++) {
      const lon = 50 + (i * 20) / 20000;
      const lat = 15 + (i * 12) / 20000;
      expect(columnIndex(OCEAN_GRID, lon), `lon ${lon}`).toBe(legacyCell(lat, lon).col);
      expect(rowIndex(OCEAN_GRID, lat), `lat ${lat}`).toBe(legacyCell(lat, lon).row);
      checked++;
    }
    expect(checked).toBe(20001);
  });

  it('agrees on every 0.1-degree coordinate, ties included', () => {
    for (let k = 0; k <= 200; k++) {
      const lon = 50 + k / 10;
      expect(columnIndex(OCEAN_GRID, lon), `lon ${lon}`).toBe(legacyCell(21, lon).col);
    }
    for (let k = 0; k <= 120; k++) {
      const lat = 15 + k / 10;
      expect(rowIndex(OCEAN_GRID, lat), `lat ${lat}`).toBe(legacyCell(lat, 60).row);
    }
  });

  it('clamps outside the box instead of returning a negative index', () => {
    expect(columnIndex(OCEAN_GRID, 40)).toBe(0);
    expect(columnIndex(OCEAN_GRID, 90)).toBe(199);
    expect(rowIndex(OCEAN_GRID, 40)).toBe(0);
    expect(rowIndex(OCEAN_GRID, 5)).toBe(119);
  });
});

describe('the snapped rule gives a stable 0.1-degree walk', () => {
  it('advances the column by exactly one per 0.1 degree of longitude', () => {
    const seen: number[] = [];
    for (let k = 0; k < 200; k++) {
      seen.push(columnIndex(OCEAN_GRID, 50 + k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 200 }, (_, k) => k));
  });

  it('advances the row by exactly one per 0.1 degree of latitude, north to south', () => {
    const seen: number[] = [];
    for (let k = 0; k < 120; k++) {
      seen.push(rowIndex(OCEAN_GRID, 27 - k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 120 }, (_, k) => k));
  });

  it('is stable on the post-expansion grid shape too', () => {
    const NEW_GRID: GridSpec = {
      nx: 550,
      ny: 300,
      bbox: { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 },
    };
    const seen: number[] = [];
    for (let k = 0; k < 550; k++) {
      seen.push(columnIndex(NEW_GRID, 45 + k / 10, STABLE_CELL_SNAP_EPSILON));
    }
    expect(seen).toEqual(Array.from({ length: 550 }, (_, k) => k));
  });

  it('records that the snap is a behaviour change, not a refactor', () => {
    // gonu's hindcast fix (scenarios.json). Measured 2026-08-10: one of 38 of
    // the 81 shipped spawn points that move a cell when the snap is enabled.
    expect(columnIndex(OCEAN_GRID, 67.1)).toBe(170);
    expect(columnIndex(OCEAN_GRID, 67.1, STABLE_CELL_SNAP_EPSILON)).toBe(171);
  });
});

describe('cellIndexFromOrigin: the raw axis helper', () => {
  it('returns the containing cell, west/north edge inclusive', () => {
    expect(cellIndexFromOrigin(0, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(0.999, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(1, 0, 1, 4)).toBe(1);
    expect(cellIndexFromOrigin(3.5, 0, 1, 4)).toBe(3);
  });

  it('clamps to [0, count-1]', () => {
    expect(cellIndexFromOrigin(-5, 0, 1, 4)).toBe(0);
    expect(cellIndexFromOrigin(99, 0, 1, 4)).toBe(3);
  });
});
```

*Expected:* File created.

- [ ] **Step 3: Run it and watch it fail**

```
npx vitest run test/cell-index.test.ts
```

*Expected:* The whole file fails to collect with a message naming the missing export, e.g. `SyntaxError: The requested module '/src/grid.ts' does not provide an export named 'cellIndexFromOrigin'`.

- [ ] **Step 4: Add the rule to grid.ts**

In `src/grid.ts`, insert immediately AFTER `latLonToCell` (which ends at line 89) and BEFORE the `// latlon <-> clip space` banner at line 91:

```ts
/**
 * Snap tolerance that makes a 0.1-degree walk produce a strictly one-per-step
 * cell index. NOT the default: enabling it moves 38 of the 81 shipped spawn
 * points in scenarios.json + genesis.json by one 0.1-degree ocean cell
 * (measured 2026-08-10), which changes tracks and breaks calibrate:check. It
 * is turned on with the domain flip, where a value change is attributable.
 */
export const STABLE_CELL_SNAP_EPSILON = 1e-9;

/**
 * Containing-cell index on a regular axis that starts at `origin` and advances
 * by `delta`, clamped to [0, count-1].
 *
 * This replaces `Math.round(latLonToCell(...).col)`. That expression is an
 * exact half-integer for any coordinate sitting on a cell boundary, so the
 * rounding direction was decided by last-bit float error rather than by a
 * stated rule. Flooring the origin-relative offset states the rule — the cell
 * whose west (or north) edge is at or before the point — and is bit-identical
 * to the old expression at `snapEpsilon = 0`, because `t - 0.5` is exact in
 * IEEE754 for every `t` in [0.5, 2^52) so `Math.round(t - 0.5) === Math.floor(t)`.
 */
export function cellIndexFromOrigin(
  value: number,
  origin: number,
  delta: number,
  count: number,
  snapEpsilon = 0,
): number {
  const index = Math.floor((value - origin) / delta + snapEpsilon);
  return Math.max(0, Math.min(count - 1, index));
}

/** Column index of `lon` on `spec`, indexed off the bbox west edge. */
export function columnIndex(spec: GridSpec, lon: number, snapEpsilon = 0): number {
  const dLon = (spec.bbox.lonMax - spec.bbox.lonMin) / spec.nx;
  return cellIndexFromOrigin(lon, spec.bbox.lonMin, dLon, spec.nx, snapEpsilon);
}

/** Row index of `lat` on `spec`, indexed off the bbox NORTH edge (row 0 = latMax). */
export function rowIndex(spec: GridSpec, lat: number, snapEpsilon = 0): number {
  const dLat = (spec.bbox.latMax - spec.bbox.latMin) / spec.ny;
  return cellIndexFromOrigin(spec.bbox.latMax - lat, 0, dLat, spec.ny, snapEpsilon);
}
```

Note the `rowIndex` sign: the axis runs north to south, so the origin-relative offset is `latMax - lat` and the origin is 0.

Then run:

```
npx vitest run test/cell-index.test.ts
```

*Expected:* All 9 cases pass, including the dense 20,001-point bit-identity sweep and the 550-column post-expansion walk.

- [ ] **Step 5: Switch upper-ocean.ts onto the rule**

First, `src/upper-ocean.ts:15`:

BEFORE
```ts
import { cellToLatLon, DOMAIN, latLonToCell } from './grid';
```

AFTER
```ts
import { cellToLatLon, columnIndex, DOMAIN, rowIndex } from './grid';
```

(`latLonToCell` has exactly one use in this file, the one you are about to delete. `tsconfig.json` sets `noUnusedLocals: true`, so leaving it imported fails `npm run build`.)

Then replace lines 564-570:

BEFORE
```ts
  private cell(lat: number, lon: number): { col: number; row: number } {
    const at = latLonToCell(OCEAN_GRID, lat, lon);
    return {
      col: clamp(Math.round(at.col), 0, OCEAN_GRID.nx - 1),
      row: clamp(Math.round(at.row), 0, OCEAN_GRID.ny - 1),
    };
  }
```

AFTER
```ts
  private cell(lat: number, lon: number): { col: number; row: number } {
    return {
      col: columnIndex(OCEAN_GRID, lon, OCEAN_CELL_SNAP_EPSILON),
      row: rowIndex(OCEAN_GRID, lat, OCEAN_CELL_SNAP_EPSILON),
    };
  }
```

And add this constant immediately after the `OCEAN_GRID` declaration that ends at line 143:

```ts
/**
 * Zero here on purpose: at zero the containing-cell rule is bit-identical to
 * the Math.round expression it replaced, so this file's change is a refactor.
 * Raising it to grid.ts's STABLE_CELL_SNAP_EPSILON makes a 0.1-degree walk
 * advance one cell per step, but moves 38 of the 81 shipped spawn points by a
 * cell (measured 2026-08-10) and therefore changes every sealed calibration
 * number. It is raised in the phase that flips DOMAIN, never before.
 */
const OCEAN_CELL_SNAP_EPSILON = 0;
```

Then run:

```
npm run build
npx vitest run test/cell-index.test.ts
```

*Expected:* `tsc --noEmit` passes (no unused-import error) and the cell-index tests still pass. If tsc reports `'clamp' is declared but its value is never read`, do NOT delete `clamp` — it is used elsewhere in the file; re-check that you only removed the two `clamp(Math.round(...))` calls.

- [ ] **Step 6: Run the full phase gate and commit**

```
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
git status --porcelain calibration docs public/data
```

Then:

```
git add src/grid.ts src/upper-ocean.ts test/cell-index.test.ts
git commit -m "refactor(grid): index cells off the bbox origin instead of a Math.round tie"
```

*Expected:* Every command exits 0 and `git status --porcelain calibration docs public/data` prints NOTHING. `calibrate:check` in particular must be green: this change is a refactor and any drift means the `snapEpsilon` default leaked away from 0.

- [ ] **Step 7: Sweep for the sibling defect and record it**

The same `Math.round`-on-a-continuous-cell-coordinate pattern exists at two other sites. Run:

```
grep -rn "Math.round(at.col\|Math.round(col\|Math.round(row" src/ test/
```

Do NOT change them in this task. `src/ui.ts:1700-1701` is the main-thread sim's land predicate (`main.ts:558` wires `isLand: (lat, lon) => ui.isLand(lat, lon)`), so touching it moves tracks; Task 3 relocates that expression verbatim without changing it. `test/integration-bins.test.ts:43`'s `clampInt` is a test-only spot-check helper. Add a one-line note to the commit body naming both.

*Expected:* The grep reports `src/ui.ts:1700`, `src/ui.ts:1701`, and `test/integration-bins.test.ts:43`. No source file is edited by this step.

---

### Task 15: Probe MAX_TEXTURE_SIZE and add the render-only reduction module

**Files:**

```
Modify: src/render/gl-utils.ts:106-116 | Modify: src/render/index.ts:56,235 | Modify: src/render/wind.ts:35,137 | Create: src/render/texture-fit.ts | Modify: src/raster-sampler.ts (append) | Modify: src/ui.ts:1696-1705 | Test: test/texture-fit.test.ts (create)
```

**Consumes:** nothing

**Produces:** `GlCaps.maxTextureSize: number` and `MIN_GUARANTEED_TEXTURE_SIZE` (src/render/gl-utils.ts); `fitFactor`, `reducedDims`, `binarize`, `boxReduce`, `majorityReduce`, `strideReduce` (src/render/texture-fit.ts); `sampleLayerNearest(layer, plane, lat, lon)` (src/raster-sampler.ts). Nothing later in this phase consumes them; the wiring into the texture uploads is deliberately deferred (see the last step).

- [ ] **Step 1: Understand the failure being prevented and the boundary being defended**

Read, do not edit.

- Nothing in `src/` currently reads `gl.MAX_TEXTURE_SIZE`. The post-expansion `terrain.bin` is `nx = 2860`, above the GLES 3.0 guaranteed minimum of 2048. The failure is silent: an incomplete texture samples as black, so `land = 0` and the whole basin draws as ocean.
- The reduction must NEVER reach physics. `src/ensemble.worker.ts:72-75` builds `isLand` from the `BinLayer` at full baked resolution and a worker has no WebGL context, so it cannot observe the cap even in principle. `src/ui.ts:1696-1705` does the same on the main thread from `this.landMask`, and `main.ts:558` feeds that straight into the sim.
- Therefore `src/render/texture-fit.ts` operates on plain `Float32Array` + dims. It must not import `BinLayer`, must not import `loader.ts`, and must not be imported by `loader.ts`.
- Order matters: for the landmask you binarize FIRST, then vote. Binarize-then-filter and filter-then-binarize do not commute. Worked example you will pin in the test: a 2x2 block `[0.4, 0.4, 0.4, 1.0]` at threshold 0.5 gives majority `0` (one of four samples is land) but box-mean `0.55`, which binarizes to `1`.

*Expected:* You can state the commutation counter-example from memory.

- [ ] **Step 2: Write the failing test**

Create `test/texture-fit.test.ts`:

```ts
/**
 * texture-fit.test.ts — GPU texture-size fitting (nio-v1 Phase 1).
 *
 * The post-expansion terrain grid (2860 x 1670) exceeds the GLES 3.0 guaranteed
 * MAX_TEXTURE_SIZE of 2048, and the failure mode is silent black. texture-fit.ts
 * reduces a COPIED plane for display only. This file pins three things:
 *   1. the fit arithmetic;
 *   2. that every reducer is a byte-identical copy at f === 1, so a device that
 *      needs no reduction draws exactly what it draws today;
 *   3. the determinism guard — neither land predicate can observe the cap.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  binarize,
  boxReduce,
  fitFactor,
  majorityReduce,
  reducedDims,
  strideReduce,
} from '../src/render/texture-fit';
import { probeCaps } from '../src/render/gl-utils';
import { parseBin } from '../src/loader';
import { sampleLayerBilinear, sampleLayerNearest } from '../src/raster-sampler';
import type { ParsedBin } from '../src/types';

describe('fitFactor', () => {
  it('halves the post-expansion terrain grid on a 2048 floor device', () => {
    expect(fitFactor(2860, 1670, 2048)).toBe(2);
  });

  it('is 1 whenever the plane already fits', () => {
    expect(fitFactor(1040, 668, 2048)).toBe(1);
    expect(fitFactor(2048, 2048, 2048)).toBe(1);
    expect(fitFactor(1, 1, 2048)).toBe(1);
  });

  it('grows until BOTH axes fit', () => {
    expect(fitFactor(1040, 668, 512)).toBe(3); // ceil(1040/3) = 347 <= 512
    expect(fitFactor(8192, 100, 2048)).toBe(4);
  });

  it('reducedDims rounds up so no row or column is dropped', () => {
    expect(reducedDims(2860, 1670, 2)).toEqual({ nx: 1430, ny: 835 });
    expect(reducedDims(5, 3, 2)).toEqual({ nx: 3, ny: 2 });
    expect(reducedDims(5, 3, 1)).toEqual({ nx: 5, ny: 3 });
  });
});

describe('every reducer is a byte-identical copy at f === 1', () => {
  const nx = 4;
  const ny = 3;
  const binary = new Float32Array([0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1]);

  it('box, majority and stride all return the input unchanged', () => {
    for (const [name, out] of [
      ['box', boxReduce(binary, nx, ny, 1)],
      ['majority', majorityReduce(binary, nx, ny, 1)],
      ['stride', strideReduce(binary, nx, ny, 1)],
    ] as const) {
      expect(out.length, name).toBe(binary.length);
      expect(Array.from(out), name).toEqual(Array.from(binary));
      expect(out, name).not.toBe(binary); // a copy, never the caller's buffer
    }
  });

  it('box and stride are exact on continuous data at f === 1', () => {
    const continuous = new Float32Array([-12.5, 0, 3.25, 1e4, -1, 7, 0.5, 2, 9, 8, 7, 6]);
    expect(Array.from(boxReduce(continuous, nx, ny, 1))).toEqual(Array.from(continuous));
    expect(Array.from(strideReduce(continuous, nx, ny, 1))).toEqual(Array.from(continuous));
  });
});

describe('binarize-then-vote does not commute with vote-then-binarize', () => {
  const block = new Float32Array([0.4, 0.4, 0.4, 1.0]); // one 2x2 block

  it('the correct order keeps a lone land cell from swallowing the block', () => {
    const votes = majorityReduce(binarize(block, 0.5), 2, 2, 2);
    expect(Array.from(votes)).toEqual([0]);
  });

  it('the wrong order turns three sea cells into land', () => {
    const mean = boxReduce(block, 2, 2, 2);
    expect(mean[0]).toBeCloseTo(0.55, 6);
    expect(Array.from(binarize(mean, 0.5))).toEqual([1]);
  });

  it('majorityReduce refuses non-binary input rather than guessing', () => {
    expect(() => majorityReduce(block, 2, 2, 2)).toThrow(/binariz/i);
  });

  it('a 2-2 tie resolves to sea', () => {
    const tie = new Float32Array([1, 1, 0, 0]);
    expect(Array.from(majorityReduce(tie, 2, 2, 2))).toEqual([0]);
  });

  it('a partial edge block votes over the samples it has', () => {
    // 3x1 row, f = 2: block 0 = [1,1] -> 1; block 1 = [0] alone -> 0.
    expect(Array.from(majorityReduce(new Float32Array([1, 1, 0]), 3, 1, 2))).toEqual([1, 0]);
  });

  it('strideReduce keeps the top-left sample, never an average', () => {
    const ids = new Float32Array([7, 9, 9, 9, 3, 4, 4, 4, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(Array.from(strideReduce(ids, 4, 4, 2))).toEqual([7, 9, 1, 1]);
  });
});

describe('probeCaps reports the texture-size cap', () => {
  it('reads gl.MAX_TEXTURE_SIZE through getParameter', () => {
    const fake = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: (p: number) => (p === 0x0d33 ? 4096 : 0),
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    const caps = probeCaps(fake);
    expect(caps.maxTextureSize).toBe(4096);
    expect(caps.colorBufferFloat).toBe(false);
  });

  it('falls back to the GLES 3.0 floor when the driver reports nothing usable', () => {
    const fake = {
      MAX_TEXTURE_SIZE: 0x0d33,
      getParameter: () => null,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;
    expect(probeCaps(fake).maxTextureSize).toBe(2048);
  });
});

describe('determinism guard: no land predicate can observe the texture cap', () => {
  function loadBin(name: string): ParsedBin {
    const buf = readFileSync(`public/data/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return parseBin(ab);
  }

  /** 200 coastal cell CENTRES, deterministically strided. */
  function coastalCentres(
    nx: number,
    ny: number,
    data: Float32Array,
    bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number },
  ): Array<{ lat: number; lon: number }> {
    const dLon = (bbox.lonMax - bbox.lonMin) / nx;
    const dLat = (bbox.latMax - bbox.latMin) / ny;
    const coastal: Array<[number, number]> = [];
    for (let r = 1; r < ny - 1; r++) {
      for (let c = 1; c < nx - 1; c++) {
        const v = data[r * nx + c] > 0.5;
        if (
          (data[(r - 1) * nx + c] > 0.5) !== v ||
          (data[(r + 1) * nx + c] > 0.5) !== v ||
          (data[r * nx + c - 1] > 0.5) !== v ||
          (data[r * nx + c + 1] > 0.5) !== v
        ) {
          coastal.push([r, c]);
        }
      }
    }
    expect(coastal.length).toBeGreaterThan(1000);
    const step = Math.floor(coastal.length / 200);
    return Array.from({ length: 200 }, (_, i) => {
      const [r, c] = coastal[i * step];
      return { lon: bbox.lonMin + (c + 0.5) * dLon, lat: bbox.latMax - (r + 0.5) * dLat };
    });
  }

  it('ui.isLand and the worker predicate agree at 200 coastal points, cap or no cap', () => {
    const land = loadBin('terrain.bin').layers.get('landmask')!;
    const points = coastalCentres(land.nx, land.ny, land.data, land.bbox);

    // The two shipped predicates: ui.ts:1696-1705 (nearest) and
    // ensemble.worker.ts:74-75 (bilinear > 0.5). Measured 2026-08-10: they agree
    // at all 200 coastal CELL CENTRES (they do not agree off centre — sample centres).
    const uiSide = points.map((p) => sampleLayerNearest(land, 0, p.lat, p.lon) > 0.5);
    const workerSide = points.map((p) => sampleLayerBilinear(land, 0, p.lat, p.lon) > 0.5);
    expect(uiSide).toEqual(workerSide);

    // Now stub a floor device. fitFactor(1040, 668, 512) === 3, so a reduction
    // genuinely happens — and neither predicate may notice, because neither
    // reads the reduced plane.
    const f = fitFactor(land.nx, land.ny, 512);
    expect(f).toBe(3);
    const dims = reducedDims(land.nx, land.ny, f);
    const reduced = majorityReduce(binarize(land.data, 0.5), land.nx, land.ny, f);
    expect(reduced.length).toBe(dims.nx * dims.ny);

    const uiAfter = points.map((p) => sampleLayerNearest(land, 0, p.lat, p.lon) > 0.5);
    const workerAfter = points.map((p) => sampleLayerBilinear(land, 0, p.lat, p.lon) > 0.5);
    expect(uiAfter).toEqual(uiSide);
    expect(workerAfter).toEqual(workerSide);
    // The source plane was not mutated by the reduction.
    expect(land.data.length).toBe(land.nx * land.ny);
  });

  it('texture-fit is not reachable from the binary reader or the worker', () => {
    for (const file of ['src/loader.ts', 'src/ensemble.worker.ts', 'src/raster-sampler.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/texture-fit/);
    }
    // And texture-fit itself never learns what a BinLayer is.
    const module = readFileSync('src/render/texture-fit.ts', 'utf8');
    expect(module).not.toMatch(/BinLayer/);
    expect(module).not.toMatch(/from '\.\.\/loader'/);
  });
});
```

*Expected:* File created.

- [ ] **Step 3: Run it and watch it fail**

```
npx vitest run test/texture-fit.test.ts
```

*Expected:* Collection fails with a message naming the missing module, e.g. `Failed to load url ../src/render/texture-fit` or `Cannot find module '../src/render/texture-fit'`.

- [ ] **Step 4: Add the texture-size probe**

In `src/render/gl-utils.ts`, replace lines 106-116:

BEFORE
```ts
export interface GlCaps {
  colorBufferFloat: boolean;
  floatLinear: boolean;
}

export function probeCaps(gl: WebGL2RenderingContext): GlCaps {
  return {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
  };
}
```

AFTER
```ts
/** The GLES 3.0 guaranteed minimum, used when the driver reports nothing usable. */
export const MIN_GUARANTEED_TEXTURE_SIZE = 2048;

/** Feature flags for float textures/targets, probed once. */
export interface GlCaps {
  colorBufferFloat: boolean;
  floatLinear: boolean;
  /**
   * gl.MAX_TEXTURE_SIZE. Presentation only: a device below the baked grid width
   * draws a coarser coastline and NOTHING else changes. The land predicates the
   * physics uses (ui.ts isLand, ensemble.worker.ts) read the decoded BinLayer at
   * full baked resolution, and a worker has no GL context, so tracks, landfall
   * and recorded output are identical on every tier.
   */
  maxTextureSize: number;
}

export function probeCaps(gl: WebGL2RenderingContext): GlCaps {
  const reported = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  return {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxTextureSize:
      typeof reported === 'number' && Number.isFinite(reported) && reported > 0
        ? reported
        : MIN_GUARANTEED_TEXTURE_SIZE,
  };
}
```

Then run:

```
npm run build
```

*Expected:* `tsc --noEmit` FAILS twice, with `error TS2739: Type '{ colorBufferFloat: false; floatLinear: false; }' is missing the following properties from type 'GlCaps': maxTextureSize` at `src/render/index.ts:235` and `src/render/wind.ts:137`.

- [ ] **Step 5: Fix the two GlCaps literals**

`src/render/index.ts:235`:

BEFORE
```ts
  private caps: GlCaps = { colorBufferFloat: false, floatLinear: false };
```

AFTER
```ts
  private caps: GlCaps = {
    colorBufferFloat: false,
    floatLinear: false,
    maxTextureSize: MIN_GUARANTEED_TEXTURE_SIZE,
  };
```

and change `src/render/index.ts:56` from
```ts
import { probeCaps } from './gl-utils';
```
to
```ts
import { MIN_GUARANTEED_TEXTURE_SIZE, probeCaps } from './gl-utils';
```

`src/render/wind.ts:137`: make the identical literal edit. `src/render/wind.ts:35` currently imports only TYPES from `./gl-utils`, so add a separate value import beside it:
```ts
import { MIN_GUARANTEED_TEXTURE_SIZE } from './gl-utils';
```

Then run:

```
npm run build
```

*Expected:* `tsc --noEmit` passes and `vite build` completes.

- [ ] **Step 6: Write the reduction module**

Create `src/render/texture-fit.ts`:

```ts
/**
 * texture-fit.ts — fit a baked plane inside gl.MAX_TEXTURE_SIZE, for DISPLAY.
 *
 * A device whose MAX_TEXTURE_SIZE is below the baked grid width silently gets an
 * incomplete texture that samples as black — land would read as ocean and the
 * whole basin would draw as sea. This module shrinks a COPY of the plane so that
 * cannot happen.
 *
 * SCOPE, and it is a hard boundary. Nothing here may reach physics:
 *   - it takes plain Float32Array + dims, never a decoded layer object;
 *   - loader.ts must never import it, and it must never import loader.ts;
 *   - it always allocates; the caller's buffer is never written.
 * The land predicates the sim uses (ui.ts isLand on the main thread,
 * ensemble.worker.ts in the worker) read the decoded plane at full baked
 * resolution. A worker has no WebGL context, so it cannot observe the cap even
 * in principle: tracks, landfall and recorded output are identical on a floor
 * device and on a desktop. Only the drawn coastline coarsens.
 *
 * REDUCER CHOICE IS PER-LAYER SEMANTICS, not taste:
 *   - continuous fields (elevation, SST)          -> boxReduce
 *   - the landmask                                -> binarize THEN majorityReduce
 *   - categorical ids (regions, flow direction)   -> strideReduce
 * Averaging a categorical id invents an id that means nothing. Averaging the
 * landmask and thresholding afterwards is NOT the same as voting on binarized
 * cells: [0.4,0.4,0.4,1.0] votes to sea (1 of 4 land) but means 0.55, which
 * thresholds to land. Binarize first, always.
 */

/** Cell count along one axis after reducing by `f`, rounding up. */
function axisLength(n: number, f: number): number {
  return Math.ceil(n / f);
}

/** Reduced dimensions for `f`. No row or column is ever dropped. */
export function reducedDims(nx: number, ny: number, f: number): { nx: number; ny: number } {
  return { nx: axisLength(nx, f), ny: axisLength(ny, f) };
}

/**
 * Smallest integer f >= 1 for which both reduced axes fit inside `maxSize`.
 * fitFactor(2860, 1670, 2048) === 2.
 */
export function fitFactor(nx: number, ny: number, maxSize: number): number {
  if (!Number.isFinite(maxSize) || maxSize < 1) return 1;
  const limit = Math.max(nx, ny, 1);
  let f = 1;
  while (axisLength(nx, f) > maxSize || axisLength(ny, f) > maxSize) {
    f += 1;
    if (f > limit) return limit; // degenerate input; never loop forever
  }
  return f;
}

/** 1 where value > threshold, else 0. Always a new array. */
export function binarize(src: Float32Array, threshold: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] > threshold ? 1 : 0;
  return out;
}

/** Arithmetic mean of each f x f block. Partial edge blocks average what they have. */
export function boxReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      let sum = 0;
      let count = 0;
      for (let dr = 0; dr < f; dr++) {
        const sr = r * f + dr;
        if (sr >= ny) break;
        for (let dc = 0; dc < f; dc++) {
          const sc = c * f + dc;
          if (sc >= nx) break;
          sum += src[sr * nx + sc];
          count++;
        }
      }
      out[r * dims.nx + c] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/**
 * Majority vote of an ALREADY BINARIZED plane. Ties resolve to 0 (sea): drawing
 * land that is not there is the worse error. Throws on non-binary input rather
 * than silently voting on a continuous field — see the module note.
 */
export function majorityReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== 0 && src[i] !== 1) {
      throw new Error(
        `texture-fit: majorityReduce needs a binarized plane; index ${i} is ${src[i]}. ` +
          'Call binarize() first — binarize-then-vote and vote-then-binarize differ.',
      );
    }
  }
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      let ones = 0;
      let total = 0;
      for (let dr = 0; dr < f; dr++) {
        const sr = r * f + dr;
        if (sr >= ny) break;
        for (let dc = 0; dc < f; dc++) {
          const sc = c * f + dc;
          if (sc >= nx) break;
          ones += src[sr * nx + sc];
          total++;
        }
      }
      out[r * dims.nx + c] = ones * 2 > total ? 1 : 0;
    }
  }
  return out;
}

/** Top-left sample of each f x f block. The only safe reducer for categorical ids. */
export function strideReduce(src: Float32Array, nx: number, ny: number, f: number): Float32Array {
  const dims = reducedDims(nx, ny, f);
  const out = new Float32Array(dims.nx * dims.ny);
  for (let r = 0; r < dims.ny; r++) {
    for (let c = 0; c < dims.nx; c++) {
      out[r * dims.nx + c] = src[r * f * nx + c * f];
    }
  }
  return out;
}
```

Then run:

```
npx vitest run test/texture-fit.test.ts
```

*Expected:* The fitFactor, f===1, commutation and probeCaps groups all pass. The determinism-guard group still fails: the module `../src/raster-sampler` does not export `sampleLayerNearest`.

- [ ] **Step 7: Relocate the nearest-neighbour predicate into raster-sampler.ts**

This is a verbatim move, not a rewrite: `ui.isLand` is the main-thread sim's land predicate (`main.ts:558`), so the arithmetic must stay byte-identical — including the `Math.round`, which Task 2 deliberately did NOT change here.

Append to `src/raster-sampler.ts`:

```ts
/**
 * Nearest-cell read of one plane, clamped to the layer's edges.
 *
 * The main-thread land predicate (ui.ts isLand -> main.ts's sim wiring) uses
 * this; the ensemble worker uses sampleLayerBilinear. The two differ off cell
 * centre by construction — that asymmetry predates the domain expansion and is
 * not changed here. The Math.round is kept exactly as it was: changing it moves
 * the sim's land boundary and therefore every calibrated track.
 */
export function sampleLayerNearest(layer: BinLayer, plane: number, lat: number, lon: number): number {
  const { nx, ny } = layer;
  const cell = latLonToCell({ nx, ny, bbox: layer.bbox }, lat, lon);
  const col = Math.max(0, Math.min(nx - 1, Math.round(cell.col)));
  const row = Math.max(0, Math.min(ny - 1, Math.round(cell.row)));
  const t = Math.max(0, Math.min(Math.floor(plane), layer.nt - 1));
  return layer.data[t * nx * ny + row * nx + col];
}
```

Then replace `src/ui.ts:1696-1705`:

BEFORE
```ts
  isLand(lat: number, lon: number): boolean {
    const m = this.landMask;
    if (m) {
      const { col, row } = latLonToCell({ nx: m.nx, ny: m.ny, bbox: m.bbox }, lat, lon);
      const c = Math.max(0, Math.min(m.nx - 1, Math.round(col)));
      const rr = Math.max(0, Math.min(m.ny - 1, Math.round(row)));
      return m.data[rr * m.nx + c] > 0.5;
    }
    return !pointInSea(lon, lat);
  }
```

AFTER
```ts
  isLand(lat: number, lon: number): boolean {
    const m = this.landMask;
    if (m) return sampleLayerNearest(m, 0, lat, lon) > 0.5;
    return !pointInSea(lon, lat);
  }
```

Add `import { sampleLayerNearest } from './raster-sampler';` to `src/ui.ts`'s import block. Then check whether `latLonToCell` still has a use in that file:

```
grep -n "latLonToCell" src/ui.ts
```

If the only remaining hit is the import at line 31, remove `latLonToCell` from it — `noUnusedLocals` is on and `npm run build` will fail otherwise.

Then run:

```
npm run build
npx vitest run test/texture-fit.test.ts
```

*Expected:* `tsc --noEmit` passes; all texture-fit cases pass, including `uiSide` equal to `workerSide` at 200 coastal centres. `layer.nt` is 1 for the landmask so the plane term is 0 — the values are unchanged from the old expression.

- [ ] **Step 8: Run the full phase gate and commit**

```
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
git status --porcelain calibration docs public/data
```

Then:

```
git add src/render/gl-utils.ts src/render/index.ts src/render/wind.ts src/render/texture-fit.ts src/raster-sampler.ts src/ui.ts test/texture-fit.test.ts
git commit -m "feat(render): probe MAX_TEXTURE_SIZE and add the display-only plane reducer"
```

Deliberately NOT in this task: wiring `fitFactor` into `buildElevTex` / `buildR8Tex` in `src/render/textures.ts`. Those take a decoded layer and read its `nx`/`ny`, so applying a reduction changes their signature; at the current 1040x668 grid `fitFactor` is 1 on every device with a 2048 floor, so wiring it now would be untestable no-op churn. Record it in the commit body as the follow-up that lands with the domain flip.

*Expected:* Every command exits 0. `git status --porcelain calibration docs public/data` prints NOTHING — the `ui.isLand` move is byte-identical, so `calibrate:check` must not drift. If it drifts, you changed the rounding: restore the exact `Math.round` in `sampleLayerNearest`.

---

### Task 16: Reject a wrong-extent bin loudly, in scenarios.ts and in the worker

**Files:**

```
Create: src/bin-domain-guard.ts | Modify: src/scenarios.ts:19-20 | Modify: src/scenarios.ts:183-189 | Modify: src/ensemble.worker.ts:12 and :66-73 | Test: test/bin-domain-guard.test.ts (create) | Test: test/event-bin.test.ts (append after :106)
```

**Consumes:** nothing

**Produces:** `validateBinDomain(bin, label, expected?): string | null` and `assertBinDomain(bin, label, expected?): void` — both from `src/bin-domain-guard.ts`. Nothing later in this phase consumes them.

- [ ] **Step 1: Read the silent path, and correct one thing the brief gets wrong**

`src/raster-sampler.ts:13-16` resolves cells through each layer's OWN header bbox and clamps to that layer's edges. So a bin baked at the wrong extent does not throw — it silently returns edge values everywhere. `src/scenarios.ts:184-202` validates layer names and `nt`, and `nt` is exactly what does NOT change when only the grid changes. `src/ensemble.worker.ts` validates nothing at all.

Correction to the task brief, measured 2026-08-10: the brief asks for a test that REJECTS a synthetic `40 x 24 / (50,70,15,27)` bin. That is impossible today and must not be built, because today's real event bins ARE `40 x 24 / (50,70,15,27)` — verified by reading the headers of `public/data/env_gonu.bin` (40x24x64, bbox 50,70,15,27) and its nine siblings, plus `env.bin`, `ocean.bin` and `upper.bin`. Rejecting that shape now would reject every shipped scenario. The `40 x 24` rejection is the design spec's PHASE 10 acceptance criterion, where `DOMAIN` has already moved to (45,100,0,30) and the same assertion produces it for free.

What this task ships is the assertion that yields both: every layer's bbox must equal the live `DOMAIN` exactly. Today that rejects a `(45,100,0,30)` bin; after the flip the identical code rejects a `(50,70,15,27)` bin with no edit. Both are tested here, the second by passing an explicit `expected` bbox.

One bin must NOT be guarded: `public/data/context-terrain.bin` is `875 x 550 / (45,80,8,30)` and is presentation-only. Do not add the guard to any generic loader path — only to the two call sites named in this task.

*Expected:* You can state why the literal '40x24 must be rejected' test would break every shipped scenario today.

- [ ] **Step 2: Write the failing tests**

Create `test/bin-domain-guard.test.ts`:

```ts
/**
 * bin-domain-guard.test.ts — silent path 1 (design spec section 3.5).
 *
 * raster-sampler.ts resolves cells through each layer's OWN header bbox and
 * clamps to that layer's edges, so a bin baked at the wrong extent renders and
 * simulates without a single diagnostic. This is the guard that makes a
 * wrong-extent bin a visible failure.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWiwbBin } from './helpers/wiwb';
import { parseBin } from '../src/loader';
import { assertBinDomain, validateBinDomain } from '../src/bin-domain-guard';
import { DOMAIN } from '../src/grid';
import type { BBox, ParsedBin } from '../src/types';

const NEW_DOMAIN: BBox = { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 };

function bin(nx: number, ny: number, bbox: BBox, names = ['sst_05', 'u_05']): ParsedBin {
  return parseBin(
    buildWiwbBin(
      names.map((name) => ({
        name,
        nx,
        ny,
        nt: 1,
        bbox,
        data: new Float32Array(nx * ny),
      })),
    ),
  );
}

describe('validateBinDomain', () => {
  it('accepts a bin whose every layer sits on the live domain', () => {
    expect(validateBinDomain(bin(40, 24, DOMAIN), 'env')).toBeNull();
  });

  it('rejects a bin baked at the post-expansion extent while DOMAIN is the old box', () => {
    const message = validateBinDomain(bin(110, 60, NEW_DOMAIN), 'env');
    expect(message).toMatch(/env/);
    expect(message).toMatch(/sst_05/);
    expect(message).toMatch(/45,100,0,30/);
    expect(message).toMatch(/50,70,15,27/);
  });

  it('rejects the shipped 40x24 Arabian Sea grid once the domain has moved', () => {
    // The design spec Phase 10 acceptance criterion, provable today by passing
    // the expected box explicitly instead of moving DOMAIN.
    const message = validateBinDomain(bin(40, 24, DOMAIN), 'env_gonu', NEW_DOMAIN);
    expect(message).toMatch(/env_gonu/);
    expect(message).toMatch(/50,70,15,27/);
  });

  it('rejects a bin whose layers disagree with each other on nx/ny', () => {
    const mixed = parseBin(
      buildWiwbBin([
        { name: 'sst_05', nx: 40, ny: 24, nt: 1, bbox: DOMAIN, data: new Float32Array(960) },
        { name: 'u_05', nx: 20, ny: 24, nt: 1, bbox: DOMAIN, data: new Float32Array(480) },
      ]),
    );
    const message = validateBinDomain(mixed, 'env');
    expect(message).toMatch(/u_05/);
    expect(message).toMatch(/20x24/);
    expect(message).toMatch(/40x24/);
  });

  it('rejects an empty bin instead of vacuously passing', () => {
    const empty = { layers: new Map() } as unknown as ParsedBin;
    expect(validateBinDomain(empty, 'env')).toMatch(/no layers/);
  });
});

describe('assertBinDomain', () => {
  it('throws the validate message verbatim', () => {
    expect(() => assertBinDomain(bin(110, 60, NEW_DOMAIN), 'env')).toThrow(/45,100,0,30/);
  });

  it('is silent for a good bin', () => {
    expect(() => assertBinDomain(bin(40, 24, DOMAIN), 'env')).not.toThrow();
  });
});

describe('every shipped physics bin passes the guard', () => {
  function load(name: string): ParsedBin {
    const buf = readFileSync(`public/data/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return parseBin(ab);
  }
  const names = [
    'terrain.bin', 'env.bin', 'ocean.bin', 'upper.bin', 'flowacc.bin', 'regions.bin',
    'env_gonu.bin', 'env_shaheen.bin', 'steering_gonu.bin',
  ];
  for (const name of names) {
    it(name, () => {
      expect(validateBinDomain(load(name), name)).toBeNull();
    });
  }
});

describe('the ensemble worker actually calls the guard', () => {
  // The worker cannot be imported in a node test (it references
  // DedicatedWorkerGlobalScope), so pin the call site by source text.
  const source = readFileSync('src/ensemble.worker.ts', 'utf8');
  it('imports it', () => {
    expect(source).toMatch(/from '\.\/bin-domain-guard'/);
  });
  it('asserts every bin it loads', () => {
    expect(source.match(/assertBinDomain\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
```

Then append this block to the END of `test/event-bin.test.ts` (the `event-bin scenario compatibility` describe closes at line 106; anywhere after it is fine). It reuses `MM`, `NX`, `NY`, `SCENARIO`, `buildEventBin`, `buildWiwbBin`, `constantPlanes` and `parseBin`, all already in scope in that file:

```ts
describe('event-bin scenario compatibility: extent, not just names and nt', () => {
  const NEW_DOMAIN = { lonMin: 45, lonMax: 100, latMin: 0, latMax: 30 };

  function buildWrongExtentBin(): ParsedBin {
    const buf = buildWiwbBin(
      ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc'].map((field) => ({
        name: `${field}_${MM}`,
        nx: NX,
        ny: NY,
        nt: 3,
        bbox: NEW_DOMAIN,
        data: constantPlanes(NX, NY, [1, 1, 1]),
      })),
    );
    return parseBin(buf);
  }

  it('rejects a bin with every correct layer name and the correct nt but the wrong bbox', () => {
    const message = validateEventBinForScenario(buildWrongExtentBin(), SCENARIO);
    expect(message).not.toBeNull();
    expect(message).toMatch(/45,100,0,30/);
  });

  it('still accepts the matching bin', () => {
    expect(validateEventBinForScenario(buildEventBin(), SCENARIO)).toBeNull();
  });
});
```

*Expected:* Both files edited. Nothing run yet.

- [ ] **Step 3: Run them and watch them fail**

```
npx vitest run test/bin-domain-guard.test.ts test/event-bin.test.ts
```

*Expected:* `test/bin-domain-guard.test.ts` fails to collect — the module `../src/bin-domain-guard` does not exist. `test/event-bin.test.ts` runs; its new case 'rejects a bin with every correct layer name and the correct nt but the wrong bbox' fails with `AssertionError: expected null not to be null`, which is the silent path being open today.

- [ ] **Step 4: Write the guard**

Create `src/bin-domain-guard.ts`:

```ts
/**
 * bin-domain-guard.ts — the ONE place a .bin's grid is checked against DOMAIN.
 *
 * loader.ts stays domain-agnostic on purpose: dims and bbox come from the file
 * header and the parser hardcodes no geometry. That is what makes a
 * wrong-extent bin silent — raster-sampler.ts resolves cells through each
 * layer's own header bbox and clamps to that layer's edges, so a bin baked over
 * the wrong box simulates and renders without one diagnostic.
 *
 * This module closes that. It is applied ONLY to bins the runtime feeds to
 * physics (scenario event bins; the four bins the ensemble worker loads). It is
 * deliberately NOT applied to context-terrain.bin, which is presentation-only
 * and carries 875x550 / (45,80,8,30) by design.
 *
 * Rejecting a wrong-extent bin loudly is not a fallback — it is the visible
 * failure the rebake plan assumes already exists.
 */

import { DOMAIN } from './grid';
import type { BBox, ParsedBin } from './types';

function describeBBox(b: BBox): string {
  return `${b.lonMin},${b.lonMax},${b.latMin},${b.latMax}`;
}

function sameBBox(a: BBox, b: BBox): boolean {
  // Exact equality, no tolerance: bake and runtime write the same literals, and
  // a bbox that is 'nearly' right is a rebake bug, not a rounding artifact.
  return (
    a.lonMin === b.lonMin &&
    a.lonMax === b.lonMax &&
    a.latMin === b.latMin &&
    a.latMax === b.latMax
  );
}

/**
 * Human-readable incompatibility, or null when every layer sits on `expected`
 * and every layer agrees with the first on nx/ny.
 */
export function validateBinDomain(
  bin: ParsedBin,
  label: string,
  expected: BBox = DOMAIN,
): string | null {
  const layers = [...bin.layers.values()];
  if (layers.length === 0) return `${label}: no layers`;
  const first = layers[0];
  for (const layer of layers) {
    if (!sameBBox(layer.bbox, expected)) {
      return (
        `${label}: layer ${layer.name} bbox (${describeBBox(layer.bbox)}) ` +
        `disagrees with the simulation domain (${describeBBox(expected)})`
      );
    }
    if (layer.nx !== first.nx || layer.ny !== first.ny) {
      return (
        `${label}: layer ${layer.name} is ${layer.nx}x${layer.ny}, ` +
        `but ${first.name} is ${first.nx}x${first.ny}`
      );
    }
  }
  return null;
}

/** Same check, as a throw. For call sites with no warn channel (the worker). */
export function assertBinDomain(bin: ParsedBin, label: string, expected: BBox = DOMAIN): void {
  const message = validateBinDomain(bin, label, expected);
  if (message !== null) throw new Error(message);
}
```

Then run:

```
npx vitest run test/bin-domain-guard.test.ts
```

*Expected:* Every group passes EXCEPT 'the ensemble worker actually calls the guard', which fails on the import regex.

- [ ] **Step 5: Wire scenarios.ts**

In `src/scenarios.ts`, replace lines 19-20:

BEFORE
```ts
import { eventMonthSuffix } from './env-sampler';
import type { EnvSamplingMode, ParsedBin } from './types';
```

AFTER
```ts
import { validateBinDomain } from './bin-domain-guard';
import { eventMonthSuffix } from './env-sampler';
import type { EnvSamplingMode, ParsedBin } from './types';
```

Then replace lines 183-189:

BEFORE
```ts
/** Return a human-readable incompatibility, or null when the bin matches. */
export function validateEventBinForScenario(
  bin: ParsedBin,
  scenario: Scenario,
): string | null {
  const mm = eventMonthSuffix(scenario.monthIndex);
  const expectedNt = scenario.windowH / scenario.stepH + 1;
```

AFTER
```ts
/**
 * Return a human-readable incompatibility, or null when the bin matches.
 *
 * Extent comes FIRST: `nt` is exactly what does not change when only the grid
 * changes, so a bin rebaked over the wrong box passes every name and timeline
 * check and then samples clamped edge values for the whole run.
 */
export function validateEventBinForScenario(
  bin: ParsedBin,
  scenario: Scenario,
): string | null {
  const domainMismatch = validateBinDomain(bin, scenario.id);
  if (domainMismatch !== null) return domainMismatch;
  const mm = eventMonthSuffix(scenario.monthIndex);
  const expectedNt = scenario.windowH / scenario.stepH + 1;
```

Leave lines 190-202 exactly as they are.

Then run:

```
npx vitest run test/event-bin.test.ts test/fidelity-scenarios.test.ts test/scenarios.test.ts
```

*Expected:* All pass. `test/event-bin.test.ts`'s existing 2x2-over-DOMAIN fixtures still validate (internally consistent, sitting on DOMAIN), and `test/fidelity-scenarios.test.ts:129` — which runs the REAL event bins through this function — stays green.

- [ ] **Step 6: Wire the ensemble worker**

First check that a thrown error here is actually surfaced rather than swallowed:

```
grep -n "catch\|type: 'error'" src/ensemble.worker.ts
```

If there is no handler that posts an error response, STOP and report it — adding one is `ensemble-protocol.ts`'s concern, not this task's.

Then in `src/ensemble.worker.ts` add, after line 12's `sampleOceanProfileBin` import:

```ts
import { assertBinDomain } from './bin-domain-guard';
```

and replace lines 66-73:

BEFORE
```ts
  const [envBin, terrainBin, steeringBin, oceanBin] = await Promise.all([
    loadBin(request.envUrl),
    loadBin(request.terrainUrl),
    request.steeringUrl ? loadBin(request.steeringUrl) : Promise.resolve(null),
    request.oceanUrl ? loadBin(request.oceanUrl) : Promise.resolve(null),
  ]);
  const land = terrainBin.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
```

AFTER
```ts
  const [envBin, terrainBin, steeringBin, oceanBin] = await Promise.all([
    loadBin(request.envUrl),
    loadBin(request.terrainUrl),
    request.steeringUrl ? loadBin(request.steeringUrl) : Promise.resolve(null),
    request.oceanUrl ? loadBin(request.oceanUrl) : Promise.resolve(null),
  ]);
  // The worker validated nothing at all before this. Every bin here feeds
  // physics, so a wrong-extent bin must be a thrown error, not clamped edge
  // samples. The throw surfaces through the worker's existing error path.
  assertBinDomain(envBin, request.envUrl);
  assertBinDomain(terrainBin, request.terrainUrl);
  if (steeringBin) assertBinDomain(steeringBin, request.steeringUrl ?? 'steering');
  if (oceanBin) assertBinDomain(oceanBin, request.oceanUrl ?? 'ocean');
  const land = terrainBin.layers.get('landmask');
  if (!land) throw new Error('terrain.bin is missing landmask');
```

Then run:

```
npm run build
npx vitest run test/bin-domain-guard.test.ts
```

*Expected:* `tsc --noEmit` passes and every group in `test/bin-domain-guard.test.ts` passes, including the worker call-site pin (four `assertBinDomain(` occurrences).

- [ ] **Step 7: Run the full phase gate and commit**

```
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
npm run profile:ensemble
git status --porcelain calibration docs public/data
```

Then:

```
git add src/bin-domain-guard.ts src/scenarios.ts src/ensemble.worker.ts test/bin-domain-guard.test.ts test/event-bin.test.ts
git commit -m "feat(loader): reject a bin whose extent disagrees with the simulation domain"
```

`profile:ensemble` is included because the guard runs once per worker request on a hot path; its cost is a loop over at most 56 layers, so the bench must not move.

*Expected:* Every command exits 0. `git status --porcelain calibration docs public/data` prints NOTHING. The ensemble bench is within its usual noise band.

---

### Task 17: Close the three Python silent paths: cache extent, extrapolation, quantization saturation

**Files:**

```
Create: bake/netcdf_extent.py | Modify: bake/fetch_era5.py:29,206-209,217-220 | Modify: bake/fetch_event_benchmark.py:11,64-68 | Modify: bake/era5.py:330-332 | Modify: bake/era5_event.py:176-179 | Modify: bake/bake.py:169-178 | Test: bake/test_guards.py (create)
```

**Consumes:** nothing

**Produces:** `bake/netcdf_extent.py`'s `netcdf_extent(path)` and `valid_cached_netcdf(path, area, grid)`; `bake.quantize_u16(array, scale, label)`. Nothing later in this phase consumes them.

- [ ] **Step 1: Read the three defects and the pattern to reuse**

Silent path 2 — cache skip on existence alone. `bake/fetch_era5.py:206-209`:

```python
        target = RAW / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
```

and `bake/fetch_event_benchmark.py:64-68` is the same shape. Neither filename encodes the extent, so after `AREA` changes every stale Arabian-Sea file is silently reused.

The pattern to reuse is already in this repository: `bake/fetch_fidelity_benchmark.py:64-117`'s `_valid_netcdf` opens the file with `h5py` and compares `latitude`/`longitude` against axes reconstructed from `AREA` and `GRID` (`:88-96`). Port that idea into a shared module rather than copying it a third time.

Silent path 3 — extrapolation. `bake/era5.py:330`:

```python
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=False, fill_value=None)
```

`fill_value=None` means EXTRAPOLATE. Fed a file that does not cover the domain, the bake fabricates a basin with no diagnostic. `bake/era5_event.py:176-177` is identical.

Silent path 4 — quantization saturation. `bake/bake.py:169-173`:

```python
    def q_u16(a: np.ndarray, scale: float) -> np.ndarray:
        return np.clip(np.round(a / scale), 0, 65535).astype(np.uint16).ravel(order="C")

    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; max ~5.4 -> ~54000 < 65535
    basin_clip = np.clip(basin, 0, 65535).astype(np.uint16)
```

Measured from the committed `public/data/flowacc.bin` on 2026-08-10: the `flowacc` raw maximum is 53,749 of 65,535 (value 5.3749, 17.98 % raw headroom) and `basin`'s is 40,828. Neither clip binds today, so converting both to a raise is byte-identical NOW. Over the expanded basin the Ganges-Brahmaputra-Meghna reaches about 6.345 against a 6.5535 ceiling — a 3.2 % margin, which is exactly why this must raise rather than clip.

*Expected:* You can name, for each of the three, what value is silently wrong today and what will be loud after.

- [ ] **Step 2: Write the failing offline test**

There is no pytest in the bake venv; the convention is standalone asserts run through `node bake/run-python.mjs <file>` (see the header of `bake/test_upper.py`). Follow it exactly.

Create `bake/test_guards.py`:

```python
#!/usr/bin/env python3
"""
test_guards.py — offline tests for the bake's silent-failure guards.

No pytest in the bake venv; standalone-assert convention (see test_events.py).
Fully offline: synthetic arrays and a temporary HDF5 file, no .nc reads from
data/raw, no network.

Run:  node bake/run-python.mjs bake/test_guards.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import h5py
import numpy as np

import bake as bake_module
from netcdf_extent import netcdf_extent, valid_cached_netcdf

AREA = [27, 50, 15, 70]  # north, west, south, east
GRID = [0.5, 0.5]


def _write(path: Path, north: float, west: float, south: float, east: float) -> None:
    lat = np.arange(north, south - 1e-9, -GRID[0], dtype="float64")
    lon = np.arange(west, east + 1e-9, GRID[1], dtype="float64")
    with h5py.File(path, "w") as handle:
        handle.create_dataset("latitude", data=lat)
        handle.create_dataset("longitude", data=lon)


def test_extent_reads_the_axes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ok.nc"
        _write(path, 27, 50, 15, 70)
        assert netcdf_extent(path) == (27.0, 50.0, 15.0, 70.0), netcdf_extent(path)


def test_matching_cache_is_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "ok.nc"
        _write(path, 27, 50, 15, 70)
        assert valid_cached_netcdf(path, AREA, GRID) is True


def test_stale_extent_is_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "stale.nc"
        _write(path, 30, 45, 0, 100)  # the post-expansion box in an old-box filename
        assert valid_cached_netcdf(path, AREA, GRID) is False


def test_missing_and_empty_are_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        missing = Path(tmp) / "nope.nc"
        assert valid_cached_netcdf(missing, AREA, GRID) is False
        empty = Path(tmp) / "empty.nc"
        empty.write_bytes(b"")
        assert valid_cached_netcdf(empty, AREA, GRID) is False


def test_truncated_file_is_not_reused() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "junk.nc"
        path.write_bytes(b"not an hdf5 file at all")
        assert valid_cached_netcdf(path, AREA, GRID) is False


def test_quantization_raises_instead_of_saturating() -> None:
    q = bake_module.quantize_u16
    scale = 1e-4
    ok = np.array([0.0, 5.3749], dtype="float64")
    assert q(ok, scale, "flowacc").max() == 53749

    over = np.array([0.0, 6.6], dtype="float64")
    try:
        q(over, scale, "flowacc")
    except ValueError as error:
        assert "flowacc" in str(error), str(error)
        assert "65535" in str(error), str(error)
    else:
        raise AssertionError("expected a ValueError for an out-of-range value")

    under = np.array([-1.0, 1.0], dtype="float64")
    try:
        q(under, scale, "flowacc")
    except ValueError as error:
        assert "flowacc" in str(error), str(error)
    else:
        raise AssertionError("expected a ValueError for a negative value")


def main() -> int:
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"[ok] {name}")
    print("all guard tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

If `bake/test_upper.py`'s runner block differs from this `main()`, match that file instead; the only requirement is that a failed assert exits non-zero.

*Expected:* File created.

- [ ] **Step 3: Run it and watch it fail**

```
node bake/run-python.mjs bake/test_guards.py
```

*Expected:* `ModuleNotFoundError: No module named 'netcdf_extent'`. IF INSTEAD the launcher reports that no repository venv exists, stop and read this: `bake/.venv` is ABSENT on this box (confirmed 2026-08-10). In that case make the edits below anyway, but their verification is code review only — write 'bake/test_guards.py not executed, no bake venv' in the PR body and do not claim the Python guards are verified.

- [ ] **Step 4: Write the shared extent check**

Create `bake/netcdf_extent.py`:

```python
#!/usr/bin/env python3
"""
netcdf_extent.py — is a cached raw ERA5 download actually the box we want?

Every fetcher used to skip a download on existence and non-zero size alone, and
no filename encodes the extent. After AREA changes, every stale file in
data/raw is silently reused and the bake produces a correctly shaped,
completely wrong basin. This is the check that makes that impossible.

The axis reconstruction mirrors fetch_fidelity_benchmark.py:88-96, which has
carried this pattern since the fidelity benchmark shipped.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np


def netcdf_extent(target: Path) -> tuple[float, float, float, float]:
    """(north, west, south, east) of a downloaded ERA5 NetCDF, from its axes."""
    with h5py.File(target, "r") as handle:
        lat = np.asarray(handle["latitude"][...], dtype="float64")
        lon = np.asarray(handle["longitude"][...], dtype="float64")
    return (float(lat.max()), float(lon.min()), float(lat.min()), float(lon.max()))


def valid_cached_netcdf(
    target: Path,
    area: list[float] | tuple[float, float, float, float],
    grid: list[float] | tuple[float, float],
) -> bool:
    """True only when `target` exists AND its axes match `area`/`grid` exactly.

    `area` is CDS order: north, west, south, east. Any read failure is a False,
    never an exception: a half-written or truncated cache must be refetched, not
    crash the run.
    """
    if not target.exists() or target.stat().st_size == 0:
        return False
    north, west, south, east = (float(v) for v in area)
    lat_step, lon_step = (float(v) for v in grid)
    expected_lat = [
        north - index * lat_step
        for index in range(round((north - south) / lat_step) + 1)
    ]
    expected_lon = [
        west + index * lon_step
        for index in range(round((east - west) / lon_step) + 1)
    ]
    try:
        with h5py.File(target, "r") as handle:
            if "latitude" not in handle or "longitude" not in handle:
                return False
            lat = [float(v) for v in handle["latitude"][...]]
            lon = [float(v) for v in handle["longitude"][...]]
    except (OSError, KeyError, ValueError):
        return False
    return lat == expected_lat and lon == expected_lon
```

Then run:

```
node bake/run-python.mjs bake/test_guards.py
```

*Expected:* The five extent tests print `[ok]`. `test_quantization_raises_instead_of_saturating` fails with `AttributeError: module 'bake' has no attribute 'quantize_u16'`.

- [ ] **Step 5: Make both fetchers validate the extent**

In `bake/fetch_era5.py`, add after line 29's `from pathlib import Path`:

```python
from netcdf_extent import valid_cached_netcdf
```

Then replace lines 206-209:

BEFORE
```python
        target = RAW / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
```

AFTER
```python
        target = RAW / filename
        # Existence is NOT enough: no filename encodes the extent, so a stale
        # file from a previous AREA silently poisons the whole bake.
        if valid_cached_netcdf(target, AREA, GRID):
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        if target.exists():
            print(f"[refetch] {filename} does not cover {AREA} at {GRID} - replacing")
            target.unlink()
```

Apply the same three-line change to the Shaheen part-file loop in the same function (lines 217-220, `if part.exists() and part.stat().st_size > 0:`), using `part` in place of `target`.

In `bake/fetch_event_benchmark.py`, add the same import after line 11's `from pathlib import Path`, and replace lines 64-68:

BEFORE
```python
                target = RAW / filename
                if target.exists() and target.stat().st_size > 0:
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
```

AFTER
```python
                target = RAW / filename
                # Existence is NOT enough - see netcdf_extent.py.
                if valid_cached_netcdf(target, AREA, GRID):
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
                if target.exists():
                    print(f"[refetch] {filename} does not cover {AREA} at {GRID} - replacing")
                    target.unlink()
```

*Expected:* Both files edited. No behaviour change for a correct cache: `valid_cached_netcdf` returns True for exactly the files the old condition accepted when they were fetched at the current AREA/GRID.

- [ ] **Step 6: Stop the interpolators extrapolating**

In `bake/era5.py`, replace line 330:

BEFORE
```python
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=False, fill_value=None)
```

AFTER
```python
    # bounds_error=True, NOT fill_value=None. fill_value=None means EXTRAPOLATE:
    # fed a raw file that does not cover the domain, this fabricated a basin
    # with no diagnostic at all. Interior evaluation is unchanged, so a correct
    # cache produces bit-identical output.
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=True)
```

and replace the two lines that follow (331-332):

BEFORE
```python
    pts = np.stack([elat.ravel(), elon.ravel()], axis=-1)
    return interp(pts).reshape(elat.shape).astype(np.float64)
```

AFTER
```python
    pts = np.stack([elat.ravel(), elon.ravel()], axis=-1)
    try:
        values = interp(pts)
    except ValueError as error:
        raise ValueError(
            f"ERA5 native grid lat[{lat.min()},{lat.max()}] lon[{lon.min()},{lon.max()}] "
            f"does not cover the env grid lat[{elat.min()},{elat.max()}] "
            f"lon[{elon.min()},{elon.max()}] - stale download in data/raw?"
        ) from error
    return values.reshape(elat.shape).astype(np.float64)
```

In `bake/era5_event.py`, replace lines 176-177:

BEFORE
```python
        interp = RegularGridInterpolator((lat_asc, lon_native), plane,
                                         bounds_error=False, fill_value=None)
```

AFTER
```python
        # See era5._to_env_grid: fill_value=None extrapolates silently.
        interp = RegularGridInterpolator((lat_asc, lon_native), plane,
                                         bounds_error=True)
```

and replace line 178:

BEFORE
```python
        out[p] = interp(pts).reshape(elat.shape)
```

AFTER
```python
        try:
            out[p] = interp(pts).reshape(elat.shape)
        except ValueError as error:
            raise ValueError(
                f"event native grid lat[{lat_asc.min()},{lat_asc.max()}] "
                f"lon[{lon_native.min()},{lon_native.max()}] does not cover the env grid "
                f"lat[{elat.min()},{elat.max()}] lon[{elon.min()},{elon.max()}] "
                f"- stale download in data/raw?"
            ) from error
```

The env cell centres are strictly interior to the native ERA5 axes for a correct download (0.5-degree centres 26.75..15.25 inside native 27..15), so `bounds_error=True` never fires on good data and the interior interpolation is the same code path, bit for bit.

*Expected:* Both files edited. `npm run build` is unaffected (Python is not typechecked).

- [ ] **Step 7: Make quantization raise instead of clipping**

In `bake/bake.py`, add this MODULE-LEVEL function immediately above the function that contains line 150 (it must be module level so `bake/test_guards.py` can reach it as `bake.quantize_u16`):

```python
def quantize_u16(a: np.ndarray, scale: float, label: str) -> np.ndarray:
    """Quantize to uint16, RAISING on saturation instead of clipping silently.

    This used to be np.clip(...). Clipping is invisible: the file still parses,
    the map still draws, and the largest river in the basin is quietly pegged at
    the ceiling. Headroom today (measured from the committed flowacc.bin,
    2026-08-10): flowacc peaks at raw 53,749 of 65,535 and basin at 40,828, so
    this raise is byte-identical on current data. Over the expanded basin the
    Ganges-Brahmaputra-Meghna reaches about log10(1+acc) = 6.345 against a
    6.5535 ceiling - a 3.2 percent margin, which is exactly why it must raise.
    """
    scaled = np.round(np.asarray(a, dtype="float64") / scale)
    low = float(scaled.min())
    high = float(scaled.max())
    if low < 0 or high > 65535:
        raise ValueError(
            f"{label}: uint16 quantization range [{low:.0f},{high:.0f}] escapes "
            f"[0,65535] at scale {scale}; raise the scale or widen the dtype - "
            "do not clip"
        )
    return scaled.astype(np.uint16).ravel(order="C")
```

Then replace lines 169-173:

BEFORE
```python
    def q_u16(a: np.ndarray, scale: float) -> np.ndarray:
        return np.clip(np.round(a / scale), 0, 65535).astype(np.uint16).ravel(order="C")

    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; max ~5.4 -> ~54000 < 65535
    basin_clip = np.clip(basin, 0, 65535).astype(np.uint16)
```

AFTER
```python
    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; max ~5.4 -> ~54000 < 65535
    basin_clip = quantize_u16(basin, 1.0, "basin")
```

Then fix the two call sites. Line 175:

BEFORE
```python
        Layer("flowacc", "uint16", True, nx, ny, 1, DOMAIN, acc_scale, 0.0, q_u16(flowacc_log, acc_scale)),
```
AFTER
```python
        Layer("flowacc", "uint16", True, nx, ny, 1, DOMAIN, acc_scale, 0.0, quantize_u16(flowacc_log, acc_scale, "flowacc")),
```

Line 178:

BEFORE
```python
        Layer("basin", "uint16", False, nx, ny, 1, DOMAIN, 1.0, 0.0, basin_clip.ravel(order="C")),
```
AFTER
```python
        Layer("basin", "uint16", False, nx, ny, 1, DOMAIN, 1.0, 0.0, basin_clip),
```

(`quantize_u16` already ravels, so the trailing `.ravel(order="C")` must go.)

Then run:

```
node bake/run-python.mjs bake/test_guards.py
```

*Expected:* All six tests print `[ok]` and the script prints `all guard tests passed`, exit 0. If the venv is absent, record this step as unverified per the earlier note.

- [ ] **Step 8: Confirm no baked byte moved, then commit**

The bake itself cannot be re-run here: `bake/.venv` is absent on this box and the flowacc path additionally needs the three HydroSHEDS region archives (127,828,199 B, gitignored). The byte-identity argument is therefore the measurement, not a rerun. Verify the tree instead:

```
npm test
npm run build
git status --porcelain calibration docs public/data
git status --porcelain
```

Then:

```
git add bake/netcdf_extent.py bake/test_guards.py bake/fetch_era5.py bake/fetch_event_benchmark.py bake/era5.py bake/era5_event.py bake/bake.py
git commit -m "fix(bake): validate cached extents, stop extrapolating, raise on quantization saturation"
```

Put in the commit body: the measured flowacc/basin headroom (53,749 and 40,828 of 65,535), the fact that `bounds_error=True` leaves interior evaluation bit-identical, and whether `bake/test_guards.py` was actually executed.

*Expected:* `npm test` and `npm run build` pass unchanged (no TypeScript moved). `git status --porcelain calibration docs public/data` prints NOTHING. `git status --porcelain` shows only the seven bake files plus whatever untracked `.nc` scratch files were already in the working tree before you started.


**Unverified in this phase — the implementer must check:**

- Task 2 is the one place where I had to overrule the brief. The brief asks for a test that 'walks 0.1-degree lat/lon and asserts a stable column index' AND that the fix be zero-diff. Those are mutually exclusive: I measured today's walk as 0,1,2,2,3,5,6,7,7,8,10,11,... (duplicates and skips), so no stable rule can reproduce it. Snapping moves 38 of the 81 shipped spawn points in scenarios.json + genesis.json by one 0.1-degree ocean cell, which would break `calibrate:check` inside a zero-diff phase. The plan therefore ships the stable rule as a tested, exported, OFF-by-default `snapEpsilon` and flips it at Phase 8. If the reviewer wants the snap on now, this task must move out of Phase 1 to the Phase 7/10 reseal boundary — it cannot stay here.
- Task 4's brief asks for a test that rejects a synthetic 40x24 / (50,70,15,27) bin. I verified from the actual headers that every shipped event bin IS 40x24 / (50,70,15,27), so that assertion would reject the whole catalogue today. That criterion belongs to design-spec Phase 10, after DOMAIN moves. The plan proves it now by passing an explicit expected bbox, which exercises the same code path. A reviewer expecting the literal assertion should read the correction step first.
- Task 1's 'immortal' fixture assumes a slow-moving storm survives 1441 ticks without tripping `upper-ocean.ts`'s hard bound (`OCEAN.MAX_COOLING_C = 8`, thrown at upper-ocean.ts:956). I chose ohcKjCm2 = 120 and a 1 m/s eastward drift (about 12.5 degrees of longitude over 360 h, lon 53 to about 65.5) to keep it moving through fresh columns and inside the box. I could not run the engine to confirm. If the test throws `upper-ocean: diagnostic hard-bound failure`, raise `ohcKjCm2` or the drift speed rather than weakening the assertion — and never let the drift carry the storm past lon 70, or the exit test fires and the test proves nothing.
- Task 1's `runStorm` assertion (`result.death` is null, `result.durationH` is 360) is the guard that protects recorded ensemble output. I derived it from `ensemble.ts:183-188` plus the exactness of accumulating 0.25 in IEEE754, but did not execute it. If it fails, the strict `>` is not sufficient and the whole task needs rethinking before `calibrate:check` runs.
- The 200-coastal-point cross-agreement in Task 3 was measured against the committed `terrain.bin` (0 disagreements at cell centres, 27 of 200 at 0.3 of a cell off centre). It depends on sampling CENTRES. If the implementer changes the point selection, `uiSide` equals `workerSide` will start failing for a reason unrelated to texture fitting — `ui.isLand` is nearest-neighbour and the worker is bilinear. That pre-existing main-thread-vs-worker asymmetry is real, unaddressed by this phase, and worth raising with the design owner.
- Task 5's Python guards are unverified on this box: `bake/.venv` does not exist, so `node bake/run-python.mjs bake/test_guards.py` cannot run here. The byte-identity claim for `quantize_u16` rests on reading the committed `flowacc.bin` (raw max 53,749 of 65,535; basin 40,828), not on a rerun of the bake — which additionally needs the 127,828,199 B of gitignored HydroSHEDS archives. Label the Python half 'unverified' in the PR body unless a venv is available.
- `bake/fetch_era5.py` and `bake/fetch_event_benchmark.py` import the new module by bare name (`from netcdf_extent import ...`), matching how `fetch_event_benchmark.py` already does `from event_catalog import ...`. That works because the bake scripts run with `bake/` on `sys.path`. If a future runner changes that, all three break together.
- I did not verify that `src/ensemble.worker.ts` has an error handler that surfaces a thrown `assertBinDomain` to the client. Task 4 includes a grep step for it; if there is no handler the throw is swallowed and the guard is decorative. Stop and report rather than adding one silently — the worker error protocol is `ensemble-protocol.ts`'s concern.
- Task 3 deliberately does not wire `fitFactor` into `src/render/textures.ts`. At 1040x668 it would be a no-op on every device with a 2048 floor, so wiring it now is untestable churn — but it does mean the silent-black failure stays live for anyone who rebakes terrain before Phase 8 wires it. That ordering must be preserved and stated in the phase handoff.

---

## Phase 2 — Freeze HF-6 on the pre-expansion tree; rewrite its check as a four-clause attestation

Phase 2 severs HF-6's CI check from the live simulation runtime, so the northern-Indian-Ocean domain expansion can neither silently break it nor silently pass it. It copies `public/data/terrain.bin` and `public/data/ocean.bin` into `calibration/data/hf6/forcing/`, writes `calibration/hf6-seal.json` pinning 24 frozen inputs and the SHA-256 CONTENT of eight runtime modules, and repoints `npm run hf6:verify:check` at a new plain-node attestation (`calibration/hf6-attest.mjs`) that loads no Vite and runs no physics. A reviewer knows it worked when `npm run hf6:verify:check` prints "HF-6 attestation OK ..." on the untouched tree, `npm test` passes including the new `test/hf6-attest.test.ts`, and each of Task 4's four tamper drills fails with a distinct message naming the offending path. This is an HONEST DOWNGRADE of what CI asserts: `calibration/hf6-verify.mjs` today recomputes all 16 sealed hindcasts through the live runtime via `vite.ssrLoadModule` and diffs every metric against the committed record; after this phase nothing is recomputed. Task 5 writes that fact into `docs/model-card-hf6.md` in the same PR.

**Files in this phase:**

```
calibration/data/hf6/forcing/terrain.bin — NEW. Byte copy of public/data/terrain.bin frozen on the pre-expansion tree.
calibration/data/hf6/forcing/ocean.bin — NEW. Byte copy of public/data/ocean.bin, same reason.
calibration/hf6-seal.mjs — NEW. Generator for hf6-seal.json; refuses to record a divergence without a date and a note.
calibration/hf6-seal.json — NEW. The seal: record hash, 24 frozen-input hashes, 8 runtime-module content hashes + declared status, frozen verdict.
calibration/hf6-attest.mjs — NEW. The four-clause attestation; exports `attest()` plus a CLI entry. Zero deps, no Vite, no sim.
test/hf6-attest.test.ts — NEW. Unit tests for all four clauses on injected fixtures, including the diverged branch that cannot be exercised on the real tree until Phase 8b.
package.json — MODIFY :67-68. Drop `hf6:verify`, add `hf6:seal`, repoint `hf6:verify:check` at hf6-attest.mjs.
calibration/hf6-verify.mjs — UNCHANGED, deliberately. Its bytes are pinned by manifests.runtimeVerifierSha256; it is retained as the instrument that produced the record.
calibration/README.md — MODIFY :79-80 and append an "HF-6 attestation" section carrying the tamper runbook.
docs/model-card-hf6.md — MODIFY: append the downgrade paragraph to "Version and governance" (:83-89).
calibration/hf6-acceptance.json — REGENERATED by `npm run hf6:gate` (only manifests.modelCardSha256 may change).
docs/hf6-scorecard.md — regenerated by the same command; must come out byte-identical.
README.md — MODIFY :238 comment. CONTRIBUTING.md — MODIFY: add one sentence after :24.
.github/workflows/deploy.yml — UNCHANGED. It runs `npm run hf6:verify:check` at :47; the script name is preserved on purpose.
```

### Task 18: Freeze terrain.bin and ocean.bin into calibration/data/hf6/forcing/

**Files:**

```
Create: calibration/data/hf6/forcing/terrain.bin
Create: calibration/data/hf6/forcing/ocean.bin
Read-only: calibration/hf6-sealed-verification.json, calibration/asset-manifest.mjs:15-26,60-75, test/asset-manifest.test.ts:9-15
```

**Consumes:** nothing

**Produces:** Two frozen input files at exact paths `calibration/data/hf6/forcing/terrain.bin` (2084344 bytes, sha256 a350399d3ce4960313f92e58f4f08d04b9c76ca6a7c35319d27443f3344ae262) and `calibration/data/hf6/forcing/ocean.bin` (700120 bytes, sha256 0811050864a24374e1cc7ed0e1d8519a85ec9e72505d1f9af28a6abca3498434). Task 2's NAMED_INPUTS table references both paths.

- [ ] **Step 1: Read the sha256 values the sealed record already committed to**

Run from the repository root (D:/personal/wallah-its-windy). `node -e` runs as CommonJS regardless of package.json `"type": "module"`, so `require` is correct here.

```bash
node -e "const{createHash}=require('crypto'),fs=require('fs');const rec=JSON.parse(fs.readFileSync('calibration/hf6-sealed-verification.json','utf8')).manifests;for(const [p,k] of [['public/data/terrain.bin','terrainSha256'],['public/data/ocean.bin','oceanSha256']]){const b=fs.readFileSync(p);const h=createHash('sha256').update(b).digest('hex');console.log((h===rec[k]?'MATCH':'MISMATCH'),p,b.length,'live='+h,'record='+rec[k]);}"
```

Context: `calibration/hf6-verify.mjs:13-14` declares these two files as HF-6 inputs (`terrain: resolve(ROOT, 'public/data/terrain.bin')`, `ocean: resolve(ROOT, 'public/data/ocean.bin')`) and `:310-313` hashes every input into `manifests.<key>Sha256`. The record therefore already carries the two authoritative values.

*Expected:* Exactly two lines, both starting MATCH:
```
MATCH public/data/terrain.bin 2084344 live=a350399d3ce4960313f92e58f4f08d04b9c76ca6a7c35319d27443f3344ae262 record=a350399d3ce4960313f92e58f4f08d04b9c76ca6a7c35319d27443f3344ae262
MATCH public/data/ocean.bin 700120 live=0811050864a24374e1cc7ed0e1d8519a85ec9e72505d1f9af28a6abca3498434 record=0811050864a24374e1cc7ed0e1d8519a85ec9e72505d1f9af28a6abca3498434
```
If either line reads MISMATCH, STOP and escalate. It means public/data has already been rebaked, so this is no longer a freeze of the pre-expansion tree, and invariant 5 of the design ("Freeze before rebake") is already violated.

- [ ] **Step 2: Copy the two files into the frozen forcing directory**

The directory `calibration/data/hf6/forcing/` already exists and holds the 16 committed forcing bins (8 `env_hf6_*.bin` + 8 `steering_hf6_*.bin`). Copy with node so the command is identical on Windows and POSIX and cannot apply any text translation:

```bash
node -e "const fs=require('fs');fs.copyFileSync('public/data/terrain.bin','calibration/data/hf6/forcing/terrain.bin');fs.copyFileSync('public/data/ocean.bin','calibration/data/hf6/forcing/ocean.bin');console.log('copied 2 files');"
```

*Expected:* Prints exactly `copied 2 files`.

- [ ] **Step 3: Verify the copies byte-for-byte against the recorded hashes**

```bash
node -e "const{createHash}=require('crypto'),fs=require('fs');const rec=JSON.parse(fs.readFileSync('calibration/hf6-sealed-verification.json','utf8')).manifests;for(const [p,k] of [['calibration/data/hf6/forcing/terrain.bin','terrainSha256'],['calibration/data/hf6/forcing/ocean.bin','oceanSha256']]){const b=fs.readFileSync(p);const h=createHash('sha256').update(b).digest('hex');console.log((h===rec[k]?'MATCH':'MISMATCH'),p,b.length,h);}"
```

*Expected:* ```
MATCH calibration/data/hf6/forcing/terrain.bin 2084344 a350399d3ce4960313f92e58f4f08d04b9c76ca6a7c35319d27443f3344ae262
MATCH calibration/data/hf6/forcing/ocean.bin 700120 0811050864a24374e1cc7ed0e1d8519a85ec9e72505d1f9af28a6abca3498434
```

- [ ] **Step 4: Confirm the copies are invisible to the asset manifest**

`calibration/asset-manifest.mjs:15` reads `const DATA_ROOT = new URL('../public/data/', import.meta.url);` and `:61` calls `buildManifest(DATA_ROOT)`; `walk()` at `:19-26` recurses only from the directory it is handed. It never walks `calibration/`, so files added under `calibration/data/hf6/forcing/` cannot enter or drift the manifest. `test/asset-manifest.test.ts:9` builds from the same `../public/data/` URL. Prove it rather than assert it:

```bash
node calibration/asset-manifest.mjs
npx vitest run test/asset-manifest.test.ts
```

*Expected:* First command prints `asset manifest clean (N files)` with a non-zero N and exits 0 (no `asset manifest drift:` line). Second command prints `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 5: Confirm nothing else in the repository enumerates that directory**

The only writer of `calibration/data/hf6/forcing/` is `bake/bake_hf6_benchmark.py`, which at `:17` sets `FORCING = OUT / "forcing"` and at `:41` does `FORCING.mkdir(parents=True, exist_ok=True)`. It writes named files and never lists, cleans, or globs the directory, so two extra files cannot break a rebake. Verify no other consumer globs it:

```bash
grep -rn "hf6/forcing" --include=*.mjs --include=*.ts --include=*.py . | grep -v node_modules | grep -v ".claude/worktrees"
```

*Expected:* Only matches inside `calibration/hf6-sealed-verification.json`-adjacent data or scripts that reference specific file names. No match shows a `readdir`, `glob`, `iterdir`, or `walk` over that directory.

- [ ] **Step 6: Commit**

```bash
git add calibration/data/hf6/forcing/terrain.bin calibration/data/hf6/forcing/ocean.bin
git commit -m "chore(hf6): freeze terrain and ocean forcing beside the sealed bins"
```
Then re-verify the hashes survived the git round trip (there is no `.gitattributes` in this repo, so no `text=auto` rule applies; git auto-detects these as binary, but prove it):
```bash
git stash list && node -e "const{createHash}=require('crypto'),fs=require('fs');for(const p of ['calibration/data/hf6/forcing/terrain.bin','calibration/data/hf6/forcing/ocean.bin'])console.log(p,createHash('sha256').update(fs.readFileSync(p)).digest('hex'));"
git show --stat --oneline HEAD
```

*Expected:* `git commit` reports `2 files changed, 0 insertions(+), 0 deletions(-)` with both paths listed as `create mode 100644`. The hash printout still shows a350399d... and 0811050864... . `git show --stat` shows the two paths and `Bin 0 -> 2084344 bytes` / `Bin 0 -> 700120 bytes`, confirming git treats them as binary.

---

### Task 19: Write calibration/hf6-seal.mjs and generate calibration/hf6-seal.json

**Files:**

```
Create: calibration/hf6-seal.mjs
Create: calibration/hf6-seal.json (generated, committed)
Modify: package.json:67 (add the `hf6:seal` script)
Read-only: calibration/hf6-verify.mjs:8-26,310-325, calibration/hf6-acceptance.json
```

**Consumes:** The two file paths created by Task 1: `calibration/data/hf6/forcing/terrain.bin` and `calibration/data/hf6/forcing/ocean.bin`.

**Produces:** `calibration/hf6-seal.json` with top-level keys `schemaVersion, phase, sealId, sealedAt, claim, supersedes, downgrade, record, frozenInputs, runtimeReproducibility, verdict`. `record` is `{path, bytes, sha256}`. `frozenInputs` is 24 entries of `{path, role, recordManifestKey, bytes, sha256}`. `runtimeReproducibility` is 8 entries of `{path, recordManifestKey, recordSha256, attestedSha256, status, divergedAt, note}` where `status` is `'identical'` or `'diverged'`. `verdict` is `{acceptancePath, phase, implementationStatus, sealedRetrospectiveStatus, prospectiveStatus, productClaim}`. Task 3's `attest()` consumes exactly this shape. npm script `hf6:seal`.

- [ ] **Step 1: See the generator fail because it does not exist**

```bash
node calibration/hf6-seal.mjs --write --sealed-at=2026-08-10
```

*Expected:* Node exits non-zero with `Error: Cannot find module 'D:\personal\wallah-its-windy\calibration\hf6-seal.mjs'` and `code: 'MODULE_NOT_FOUND'`.

- [ ] **Step 2: Write calibration/hf6-seal.mjs**

Design notes you must not change:
- `recordSha256` is COPIED from `calibration/hf6-sealed-verification.json`'s `manifests` block; `attestedSha256` is COMPUTED from the live tree. A divergence is therefore visible as a disagreement between two hashes, never as a boolean (design invariant 6).
- The eight runtime modules are exactly the eight non-data entries of `paths` in `calibration/hf6-verify.mjs:17-24`. `calibration/hf6-verify.mjs` is itself the eighth, via `runtimeVerifier` at `:24`.
- The 16 forcing bins are read from `record.manifests.forcing`, which `hf6-verify.mjs:314-320` wrote sorted by `localeCompare`. Do not re-sort.
- The generator REFUSES to record a divergence unless both `--diverged-at=` and `--diverged-note=` are supplied. That is what forces a dated re-attestation at Phase 8b.

File content:

```js
/**
 * Writes calibration/hf6-seal.json, the input calibration/hf6-attest.mjs checks.
 *
 * Every hash is taken from the live tree at seal time; `recordSha256` is copied
 * from calibration/hf6-sealed-verification.json. A runtime module that has moved
 * therefore shows up as a disagreement between two content hashes, never as a
 * one-bit "diverged" flag that stays true through every later edit.
 *
 * Usage:
 *   node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD
 *   node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD \
 *     --diverged-at="Phase 8b" --diverged-note="DOMAIN 45-100E/0-30N"
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const at = (relative) => fileURLToPath(new URL(relative, ROOT));
const probe = (relative) => {
  const bytes = readFileSync(at(relative));
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

const RECORD_PATH = 'calibration/hf6-sealed-verification.json';
const ACCEPTANCE_PATH = 'calibration/hf6-acceptance.json';
const SEAL_PATH = 'calibration/hf6-seal.json';

// [path, key in record.manifests, role]. Mirrors calibration/hf6-verify.mjs:9-16,
// except terrain and ocean now point at the frozen copies beside the bins.
const NAMED_INPUTS = [
  ['calibration/data/hf6-case-catalog.json', 'catalogSha256', 'catalog'],
  ['calibration/data/hf6-tracks.json', 'tracksSha256', 'tracks'],
  ['calibration/data/hf6/sealed-scenarios.json', 'scenariosSha256', 'sealed-scenarios'],
  ['calibration/data/hf6/steering-manifest.json', 'steeringSha256', 'steering-manifest'],
  ['calibration/data/hf6/forcing/terrain.bin', 'terrainSha256', 'terrain'],
  ['calibration/data/hf6/forcing/ocean.bin', 'oceanSha256', 'ocean'],
  ['calibration/hf2-candidate-selection.json', 'hf2SelectionSha256', 'hf2-candidate-selection'],
  ['calibration/hf3-candidate-selection.json', 'hf3SelectionSha256', 'hf3-candidate-selection'],
];

// The eight modules calibration/hf6-verify.mjs:17-24 named as the runtime it
// certified. The verifier itself is the eighth.
const RUNTIME_MODULES = [
  ['src/sim.ts', 'runtimeSimSha256'],
  ['src/steering.ts', 'runtimeSteeringSha256'],
  ['src/upper-ocean.ts', 'runtimeUpperOceanSha256'],
  ['src/ventilation.ts', 'runtimeVentilationSha256'],
  ['src/structure.ts', 'runtimeStructureSha256'],
  ['src/coastal-exposure.ts', 'runtimeCoastalExposureSha256'],
  ['src/hindcast-benchmark.ts', 'runtimeHindcastSha256'],
  ['calibration/hf6-verify.mjs', 'runtimeVerifierSha256'],
];

const flag = (name) => {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};

const sealedAt = flag('sealed-at');
if (!process.argv.includes('--write') || sealedAt === null) {
  console.error(
    'usage: node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD ' +
    '[--diverged-at=TEXT --diverged-note=TEXT]',
  );
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(sealedAt)) {
  console.error(`--sealed-at must be YYYY-MM-DD, got "${sealedAt}"`);
  process.exit(1);
}
const divergedAt = flag('diverged-at');
const divergedNote = flag('diverged-note');

const record = JSON.parse(readFileSync(at(RECORD_PATH), 'utf8'));
const acceptance = JSON.parse(readFileSync(at(ACCEPTANCE_PATH), 'utf8'));

const frozenInputs = [
  ...NAMED_INPUTS.map(([path, recordManifestKey, role]) => ({
    path,
    role,
    recordManifestKey,
    ...probe(path),
  })),
  ...record.manifests.forcing.map((item) => ({
    path: item.path,
    role: 'forcing',
    recordManifestKey: null,
    ...probe(item.path),
  })),
];

const runtimeReproducibility = RUNTIME_MODULES.map(([path, recordManifestKey]) => {
  const live = probe(path);
  const recordSha256 = record.manifests[recordManifestKey];
  const diverged = live.sha256 !== recordSha256;
  if (diverged && (divergedAt === null || divergedNote === null)) {
    throw new Error(
      `${path} no longer matches the sealed record (record ${recordSha256}, ` +
      `live ${live.sha256}). Re-run with --diverged-at= and --diverged-note= ` +
      'so the divergence is dated and explained.',
    );
  }
  return {
    path,
    recordManifestKey,
    recordSha256,
    attestedSha256: live.sha256,
    status: diverged ? 'diverged' : 'identical',
    divergedAt: diverged ? divergedAt : null,
    note: diverged ? divergedNote : null,
  };
});

const seal = {
  schemaVersion: 1,
  phase: 'HF-6',
  sealId: record.sealId,
  sealedAt,
  claim: 'attestation-of-frozen-record',
  supersedes:
    'recomputation of the 16 sealed hindcasts through the live runtime ' +
    '(calibration/hf6-verify.mjs)',
  downgrade:
    'npm run hf6:verify:check no longer recomputes the sealed cohort. It ' +
    'attests that the record, its frozen inputs and the runtime modules it ' +
    'names are unchanged. See docs/model-card-hf6.md.',
  record: { path: RECORD_PATH, ...probe(RECORD_PATH) },
  frozenInputs,
  runtimeReproducibility,
  verdict: {
    acceptancePath: ACCEPTANCE_PATH,
    phase: acceptance.phase,
    implementationStatus: acceptance.implementationStatus,
    sealedRetrospectiveStatus: acceptance.sealedRetrospectiveStatus,
    prospectiveStatus: acceptance.prospectiveStatus,
    productClaim: acceptance.productClaim,
  },
};

writeFileSync(at(SEAL_PATH), `${JSON.stringify(seal, null, 2)}\n`);
console.log(
  `wrote ${SEAL_PATH} — ${frozenInputs.length} frozen inputs, ` +
  `${runtimeReproducibility.length} runtime modules ` +
  `(${runtimeReproducibility.filter((item) => item.status === 'diverged').length} diverged)`,
);
```

*Expected:* File written. No command run yet.

- [ ] **Step 3: Generate the seal**

```bash
node calibration/hf6-seal.mjs --write --sealed-at=2026-08-10
```
Use the real current date if it is not 2026-08-10.

*Expected:* Exactly one line:
```
wrote calibration/hf6-seal.json — 24 frozen inputs, 8 runtime modules (0 diverged)
```
If it instead throws `... no longer matches the sealed record (record ..., live ...). Re-run with --diverged-at= ...`, a preceding phase edited that module. STOP and read the Risks section: you must decide, with the reviewer, whether to re-run with `--diverged-at="Phase 1" --diverged-note="<what changed>"`. Do not paper over it.

- [ ] **Step 4: Inspect the generated seal against the values verified this session**

```bash
node -e "const s=require('./calibration/hf6-seal.json');console.log('sealId',s.sealId);console.log('record',s.record.path,s.record.bytes,s.record.sha256);console.log('frozenInputs',s.frozenInputs.length,'roles',[...new Set(s.frozenInputs.map(i=>i.role))].join(','));console.log('forcing entries',s.frozenInputs.filter(i=>i.role==='forcing').length);for(const m of s.runtimeReproducibility)console.log('runtime',m.status,m.path,m.attestedSha256===m.recordSha256);console.log('verdict',s.verdict.sealedRetrospectiveStatus,s.verdict.prospectiveStatus);"
```

*Expected:* ```
sealId hf6-arabian-v1-2026-07-21
record calibration/hf6-sealed-verification.json 76746 f2728914428bcf8a35c853e8ac428d2390f2868bab5173c89ff6fcd8665f474d
frozenInputs 24 roles catalog,tracks,sealed-scenarios,steering-manifest,terrain,ocean,hf2-candidate-selection,hf3-candidate-selection,forcing
forcing entries 16
runtime identical src/sim.ts true
runtime identical src/steering.ts true
runtime identical src/upper-ocean.ts true
runtime identical src/ventilation.ts true
runtime identical src/structure.ts true
runtime identical src/coastal-exposure.ts true
runtime identical src/hindcast-benchmark.ts true
runtime identical calibration/hf6-verify.mjs true
verdict rejected awaiting-future-storms
```
8 + 16 = 24 is the arithmetic behind "24 frozen inputs".

- [ ] **Step 5: Add the hf6:seal npm script**

In `package.json`, replace line 67:

Before:
```json
    "hf6:verify": "node calibration/hf6-verify.mjs",
```
After:
```json
    "hf6:seal": "node calibration/hf6-seal.mjs --write",
```

The `hf6:verify` entry is removed on purpose: running it rewrites `calibration/hf6-sealed-verification.json`, which is now the sealed record clause 1 protects. `calibration/hf6-verify.mjs` stays on disk, unmodified, as the instrument that produced the record; anyone who genuinely needs it can still invoke it by path. Leave line 68 (`hf6:verify:check`) alone for now — Task 3 repoints it.

Note `hf6:seal` carries no `--sealed-at`; the generator refuses to run without it, so the caller must supply the date: `npm run hf6:seal -- --sealed-at=2026-08-10`.

*Expected:* `node -e "const p=require('./package.json');console.log(p.scripts['hf6:seal']);console.log(p.scripts['hf6:verify']);"` prints `node calibration/hf6-seal.mjs --write` then `undefined`.

- [ ] **Step 6: Commit**

```bash
git add calibration/hf6-seal.mjs calibration/hf6-seal.json package.json
git commit -m "feat(hf6): seal the frozen record, inputs and runtime content hashes"
```

*Expected:* `3 files changed`, with `create mode 100644 calibration/hf6-seal.mjs` and `create mode 100644 calibration/hf6-seal.json`.

---

### Task 20: Rewrite hf6:verify:check as a four-clause attestation in plain node

**Files:**

```
Create: test/hf6-attest.test.ts
Create: calibration/hf6-attest.mjs
Modify: package.json:68
Read-only: calibration/asset-manifest.mjs:77-80 (CLI entry pattern), test/asset-manifest.test.ts:1-7 (.mjs-import precedent)
```

**Consumes:** `calibration/hf6-seal.json` and its exact shape, both defined by Task 2. The frozen-input paths created by Task 1.

**Produces:** `calibration/hf6-attest.mjs` exporting `attest(seal, record, acceptance, probe, expected?)` returning `string[]` of failure lines, and the constants `FROZEN_INPUT_COUNT = 24`, `RUNTIME_MODULE_COUNT = 8`, `FORCING_BIN_COUNT = 16`. npm script `hf6:verify:check` now runs `node calibration/hf6-attest.mjs`. Task 4 depends on the exact failure-message prefixes `[clause 1]` … `[clause 4]`.

- [ ] **Step 1: Write the failing unit test first**

Create `test/hf6-attest.test.ts`. It imports the `.mjs` module directly — `test/asset-manifest.test.ts:1-7` already does this and type-checks, so no shim is needed (see Risks if `npm run build` disagrees).

```ts
import { describe, expect, it } from 'vitest';
import {
  attest,
  FORCING_BIN_COUNT,
  FROZEN_INPUT_COUNT,
  RUNTIME_MODULE_COUNT,
} from '../calibration/hf6-attest.mjs';

const RECORD_PATH = 'calibration/hf6-sealed-verification.json';
const ACCEPTANCE_PATH = 'calibration/hf6-acceptance.json';
const CLAIM =
  'experimental simulator and retrospective forecast-companion prototype; no prospective skill claim';
const SIZES = { frozenInputs: 2, runtimeModules: 1, forcingBins: 1 };

function fixture() {
  const seal = {
    schemaVersion: 1,
    phase: 'HF-6',
    sealId: 'hf6-arabian-v1-2026-07-21',
    sealedAt: '2026-08-10',
    record: { path: RECORD_PATH, bytes: 10, sha256: 'record-hash' },
    frozenInputs: [
      {
        path: 'calibration/data/hf6/forcing/terrain.bin',
        role: 'terrain',
        recordManifestKey: 'terrainSha256',
        bytes: 4,
        sha256: 'terrain-hash',
      },
      {
        path: 'calibration/data/hf6/forcing/env_a.bin',
        role: 'forcing',
        recordManifestKey: null,
        bytes: 5,
        sha256: 'env-a-hash',
      },
    ],
    runtimeReproducibility: [
      {
        path: 'src/sim.ts',
        recordManifestKey: 'runtimeSimSha256',
        recordSha256: 'sim-hash',
        attestedSha256: 'sim-hash',
        status: 'identical',
        divergedAt: null,
        note: null,
      },
    ],
    verdict: {
      acceptancePath: ACCEPTANCE_PATH,
      phase: 'HF-6',
      implementationStatus: 'complete',
      sealedRetrospectiveStatus: 'rejected',
      prospectiveStatus: 'awaiting-future-storms',
      productClaim: CLAIM,
    },
  };
  const record = {
    manifests: {
      terrainSha256: 'terrain-hash',
      runtimeSimSha256: 'sim-hash',
      forcing: [
        { path: 'calibration/data/hf6/forcing/env_a.bin', bytes: 5, sha256: 'env-a-hash' },
      ],
    },
  };
  const acceptance = {
    phase: 'HF-6',
    implementationStatus: 'complete',
    sealedRetrospectiveStatus: 'rejected',
    prospectiveStatus: 'awaiting-future-storms',
    productClaim: CLAIM,
    manifests: { verificationSha256: 'record-hash' },
  };
  const tree = new Map<string, { bytes: number; sha256: string }>([
    [RECORD_PATH, { bytes: 10, sha256: 'record-hash' }],
    ['calibration/data/hf6/forcing/terrain.bin', { bytes: 4, sha256: 'terrain-hash' }],
    ['calibration/data/hf6/forcing/env_a.bin', { bytes: 5, sha256: 'env-a-hash' }],
    ['src/sim.ts', { bytes: 7, sha256: 'sim-hash' }],
  ]);
  const probe = (path: string) => tree.get(path) ?? null;
  const run = () => attest(seal, record, acceptance, probe, SIZES) as string[];
  return { seal, record, acceptance, tree, run };
}

describe('HF-6 attestation', () => {
  it('pins the sealed cardinality of the real tree', () => {
    expect(FROZEN_INPUT_COUNT).toBe(24);
    expect(RUNTIME_MODULE_COUNT).toBe(8);
    expect(FORCING_BIN_COUNT).toBe(16);
  });

  it('reports nothing when record, inputs, runtime and verdict are intact', () => {
    expect(fixture().run()).toEqual([]);
  });

  it('clause 1 names the record when its bytes change', () => {
    const f = fixture();
    f.tree.set(RECORD_PATH, { bytes: 11, sha256: 'tampered' });
    const failures = f.run();
    expect(failures.some((line) => line.startsWith('[clause 1]'))).toBe(true);
    expect(failures.some((line) => line.includes(RECORD_PATH))).toBe(true);
  });

  it('clause 1 rejects a record the acceptance artifact never hashed', () => {
    const f = fixture();
    f.acceptance.manifests.verificationSha256 = 'some-other-hash';
    expect(f.run().filter((line) => line.startsWith('[clause 1]'))).toHaveLength(1);
  });

  it('clause 2 names the exact frozen input that changed', () => {
    const f = fixture();
    f.tree.set('calibration/data/hf6/forcing/env_a.bin', { bytes: 5, sha256: 'flipped' });
    const failures = f.run();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('[clause 2]');
    expect(failures[0]).toContain('calibration/data/hf6/forcing/env_a.bin');
  });

  it('clause 2 names a frozen input that is missing', () => {
    const f = fixture();
    f.tree.delete('calibration/data/hf6/forcing/terrain.bin');
    expect(f.run()).toEqual([
      '[clause 2] frozen input is missing: calibration/data/hf6/forcing/terrain.bin',
    ]);
  });

  it('clause 3 fails when a declared-identical module is edited', () => {
    const f = fixture();
    f.tree.set('src/sim.ts', { bytes: 9, sha256: 'sim-edited' });
    const failures = f.run();
    expect(failures.some((line) => line.startsWith('[clause 3]'))).toBe(true);
    expect(failures.some((line) => line.includes('src/sim.ts'))).toBe(true);
  });

  it('clause 3 pins a diverged module to its content hash, not to a boolean', () => {
    const f = fixture();
    f.seal.runtimeReproducibility[0] = {
      ...f.seal.runtimeReproducibility[0],
      attestedSha256: 'sim-nio',
      status: 'diverged',
      divergedAt: 'Phase 8b',
      note: 'DOMAIN widened to 45-100E/0-30N',
    };
    f.tree.set('src/sim.ts', { bytes: 9, sha256: 'sim-nio' });
    expect(f.run()).toEqual([]);
    // A boolean "is it different from the record?" predicate would still be
    // true here and would let this pass. Content pinning must reject it.
    f.tree.set('src/sim.ts', { bytes: 9, sha256: 'sim-edited-later' });
    expect(f.run().some((line) => line.startsWith('[clause 3]'))).toBe(true);
  });

  it('clause 3 rejects an undated divergence', () => {
    const f = fixture();
    f.seal.runtimeReproducibility[0] = {
      ...f.seal.runtimeReproducibility[0],
      attestedSha256: 'sim-nio',
      status: 'diverged',
      divergedAt: null,
      note: null,
    };
    f.tree.set('src/sim.ts', { bytes: 9, sha256: 'sim-nio' });
    const failures = f.run();
    expect(failures.some((line) => line.includes('dated and explained'))).toBe(true);
  });

  it('clause 3 rejects a status that contradicts the recorded hash', () => {
    const f = fixture();
    f.seal.runtimeReproducibility[0] = {
      ...f.seal.runtimeReproducibility[0],
      attestedSha256: 'sim-nio',
      status: 'identical',
    };
    f.tree.set('src/sim.ts', { bytes: 9, sha256: 'sim-nio' });
    expect(f.run().some((line) => line.includes('declared "identical"'))).toBe(true);
  });

  it('clause 4 fails when the sealed verdict moves off rejected', () => {
    const f = fixture();
    f.acceptance.sealedRetrospectiveStatus = 'accepted';
    const failures = f.run();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('[clause 4]');
    expect(failures[0]).toContain('sealedRetrospectiveStatus');
  });
});
```

*Expected:* Test file written. No command run yet.

- [ ] **Step 2: Run the test and watch it fail on a missing module**

```bash
npx vitest run test/hf6-attest.test.ts
```

*Expected:* Vitest reports a collection error, not assertion failures: `Failed to load url ../calibration/hf6-attest.mjs` (or `Cannot find module`), and `Test Files  1 failed (1)`.

- [ ] **Step 3: Write calibration/hf6-attest.mjs**

Full content. The CLI entry-point guard mirrors `calibration/asset-manifest.mjs:77-80`.

```js
/**
 * HF-6 sealed-record attestation — the four-clause check behind
 * `npm run hf6:verify:check`.
 *
 * THIS IS NOT A RECOMPUTATION, AND THAT IS A DOWNGRADE.
 * Until 2026-08-10 this npm script ran calibration/hf6-verify.mjs, which
 * re-ran all 16 sealed hindcasts through the live runtime (Vite
 * `ssrLoadModule` over a 19-file closure holding six live `DOMAIN` reads) and
 * diffed every metric against calibration/hf6-sealed-verification.json. That
 * proved the shipped code still produced the published numbers. It cannot
 * survive the northern-Indian-Ocean domain expansion: a wider `DOMAIN` changes
 * the numbers by construction, and no amount of frozen input prevents it.
 *
 * What this asserts instead, in four clauses:
 *   1. the sealed record is byte-intact, and is still the record the HF-6
 *      acceptance artifact hashed;
 *   2. all 24 frozen inputs are byte-intact and agree with the record;
 *   3. every one of the eight named runtime modules matches the SHA-256
 *      CONTENT the seal attests for it, and each declared status agrees with
 *      the record;
 *   4. the sealed HF-6 verdict is still `rejected`.
 *
 * It does NOT assert that the current code reproduces the record.
 * See docs/model-card-hf6.md, "Version and governance".
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/** 8 named inputs + 16 forcing bins. */
export const FROZEN_INPUT_COUNT = 24;
/** The seven src/ modules plus calibration/hf6-verify.mjs itself. */
export const RUNTIME_MODULE_COUNT = 8;
/** 8 env bins + 8 steering bins for the 8 sealed storms. */
export const FORCING_BIN_COUNT = 16;

const DEFAULT_SIZES = {
  frozenInputs: FROZEN_INPUT_COUNT,
  runtimeModules: RUNTIME_MODULE_COUNT,
  forcingBins: FORCING_BIN_COUNT,
};

const VERDICT_FIELDS = [
  'phase',
  'implementationStatus',
  'sealedRetrospectiveStatus',
  'prospectiveStatus',
  'productClaim',
];

/**
 * @param seal        parsed calibration/hf6-seal.json
 * @param record      parsed calibration/hf6-sealed-verification.json, or null
 * @param acceptance  parsed calibration/hf6-acceptance.json, or null
 * @param probe       (path) => { bytes, sha256 } | null
 * @param sizes       expected cardinalities; overridden only by unit tests
 * @returns           human-readable failure lines; empty means attested
 */
export function attest(seal, record, acceptance, probe, sizes = DEFAULT_SIZES) {
  const failures = [];
  const fail = (clause, message) => failures.push(`[clause ${clause}] ${message}`);

  // ---- clause 1: the sealed record is intact ----------------------------
  const live = probe(seal.record.path);
  if (live === null) {
    fail(1, `sealed record is missing: ${seal.record.path}`);
  } else if (live.bytes !== seal.record.bytes || live.sha256 !== seal.record.sha256) {
    fail(1,
      `sealed record changed: ${seal.record.path} — sealed ${seal.record.bytes} B ` +
      `sha256 ${seal.record.sha256}, actual ${live.bytes} B sha256 ${live.sha256}`);
  }
  if (acceptance === null) {
    fail(1, `acceptance artifact is missing or unreadable: ${seal.verdict.acceptancePath}`);
  } else if (acceptance.manifests?.verificationSha256 !== seal.record.sha256) {
    fail(1,
      `sealed record is not the one ${seal.verdict.acceptancePath} accepted — ` +
      `seal ${seal.record.sha256}, acceptance ` +
      `${acceptance.manifests?.verificationSha256 ?? 'absent'}`);
  }

  // ---- clause 2: every frozen input is intact ---------------------------
  if (seal.frozenInputs.length !== sizes.frozenInputs) {
    fail(2,
      `seal declares ${seal.frozenInputs.length} frozen inputs, expected ` +
      `${sizes.frozenInputs}`);
  }
  const recordedForcing = new Map(
    (record?.manifests?.forcing ?? []).map((item) => [item.path, item.sha256]),
  );
  if (record !== null && recordedForcing.size !== sizes.forcingBins) {
    fail(2,
      `sealed record lists ${recordedForcing.size} forcing bins, expected ` +
      `${sizes.forcingBins}`);
  }
  for (const input of seal.frozenInputs) {
    const actual = probe(input.path);
    if (actual === null) {
      fail(2, `frozen input is missing: ${input.path}`);
      continue;
    }
    if (actual.bytes !== input.bytes || actual.sha256 !== input.sha256) {
      fail(2,
        `frozen input changed: ${input.path} — sealed ${input.bytes} B ` +
        `sha256 ${input.sha256}, actual ${actual.bytes} B sha256 ${actual.sha256}`);
      continue;
    }
    if (record === null) continue;
    const bound = input.recordManifestKey === null
      ? recordedForcing.get(input.path)
      : record.manifests?.[input.recordManifestKey];
    if (bound === undefined) {
      fail(2, `frozen input is not bound to the sealed record: ${input.path}`);
    } else if (bound !== input.sha256) {
      fail(2,
        `frozen input disagrees with the sealed record: ${input.path} — ` +
        `seal ${input.sha256}, record ${bound}`);
    }
  }

  // ---- clause 3: runtime divergence is content-pinned -------------------
  if (seal.runtimeReproducibility.length !== sizes.runtimeModules) {
    fail(3,
      `seal declares ${seal.runtimeReproducibility.length} runtime modules, ` +
      `expected ${sizes.runtimeModules}`);
  }
  for (const module of seal.runtimeReproducibility) {
    const actual = probe(module.path);
    if (actual === null) {
      fail(3, `runtime module is missing: ${module.path}`);
      continue;
    }
    if (actual.sha256 !== module.attestedSha256) {
      fail(3,
        `runtime module changed since the seal: ${module.path} ` +
        `(declared "${module.status}") — attested ${module.attestedSha256}, ` +
        `actual ${actual.sha256}. Re-attest deliberately with ` +
        'node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD');
      continue;
    }
    const identical = module.attestedSha256 === module.recordSha256;
    if (identical && module.status !== 'identical') {
      fail(3,
        `runtime module ${module.path} is declared "${module.status}" but still ` +
        'matches the hash the sealed record names');
    }
    if (!identical && module.status !== 'diverged') {
      fail(3,
        `runtime module ${module.path} is declared "${module.status}" but no ` +
        `longer matches the sealed record hash ${module.recordSha256}`);
    }
    if (!identical && (module.divergedAt === null || module.note === null)) {
      fail(3,
        `runtime module ${module.path} is diverged but carries no divergedAt ` +
        'or note; a divergence must be dated and explained');
    }
    if (record !== null &&
        record.manifests?.[module.recordManifestKey] !== module.recordSha256) {
      fail(3,
        `runtime module ${module.path} is not bound to the sealed record key ` +
        `${module.recordManifestKey}`);
    }
  }

  // ---- clause 4: the frozen verdict has not moved -----------------------
  if (acceptance !== null) {
    for (const field of VERDICT_FIELDS) {
      if (acceptance[field] !== seal.verdict[field]) {
        fail(4,
          `HF-6 verdict moved: ${seal.verdict.acceptancePath} ${field} — ` +
          `sealed ${JSON.stringify(seal.verdict[field])}, actual ` +
          `${JSON.stringify(acceptance[field])}`);
      }
    }
  }

  return failures;
}

function main() {
  const at = (relative) => fileURLToPath(new URL(relative, ROOT));
  const probe = (relative) => {
    try {
      const bytes = readFileSync(at(relative));
      return {
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    } catch {
      return null;
    }
  };
  const readJson = (relative) => {
    try {
      return JSON.parse(readFileSync(at(relative), 'utf8'));
    } catch {
      return null;
    }
  };
  const seal = readJson('calibration/hf6-seal.json');
  if (seal === null) {
    console.error(
      'HF-6 attestation FAILED: calibration/hf6-seal.json is missing or is not ' +
      'valid JSON. Regenerate it with ' +
      'node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD',
    );
    process.exit(1);
  }
  const failures = attest(
    seal,
    readJson(seal.record.path),
    readJson(seal.verdict.acceptancePath),
    probe,
  );
  if (failures.length > 0) {
    console.error(`HF-6 attestation FAILED — ${failures.length} problem(s):`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(
    `HF-6 attestation OK — record intact; ${seal.frozenInputs.length} frozen ` +
    `inputs intact; ${seal.runtimeReproducibility.length} runtime modules ` +
    `content-pinned; sealed verdict ${seal.verdict.sealedRetrospectiveStatus}.`,
  );
  console.log(
    'Attestation only: the sealed cohort is not recomputed ' +
    '(see docs/model-card-hf6.md).',
  );
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (import.meta.url === entryUrl) main();
```

*Expected:* File written. No command run yet.

- [ ] **Step 4: Run the unit test and see it pass**

```bash
npx vitest run test/hf6-attest.test.ts
```

*Expected:* `Test Files  1 passed (1)` and `Tests  11 passed (11)`.

- [ ] **Step 5: Run the CLI against the real tree**

```bash
node calibration/hf6-attest.mjs
```

*Expected:* Exit 0 and exactly two lines:
```
HF-6 attestation OK — record intact; 24 frozen inputs intact; 8 runtime modules content-pinned; sealed verdict rejected.
Attestation only: the sealed cohort is not recomputed (see docs/model-card-hf6.md).
```

- [ ] **Step 6: Repoint the npm script and re-run the CI-facing name**

In `package.json` replace line 68 (now shifted by Task 2's edit; match on the text, not the number):

Before:
```json
    "hf6:verify:check": "node calibration/hf6-verify.mjs --check",
```
After:
```json
    "hf6:verify:check": "node calibration/hf6-attest.mjs",
```

The script NAME is preserved deliberately: `.github/workflows/deploy.yml:47` runs `npm run hf6:verify:check` and `CONTRIBUTING.md:23` names it. Keeping the name means this phase changes no CI file. What the name now MEANS changes, and Task 5 records that.

```bash
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
```

*Expected:* `hf6:verify:check` prints the two OK lines above and exits 0. `hf6:gate:check` exits 0 silently (it throws `HF-6 gate or scorecard artifact is stale` only on drift; nothing has changed yet). `hf6:prospective:check` exits 0.

- [ ] **Step 7: Run the full suite and build**

```bash
npm test
npm run build
```

*Expected:* `npm test` reports every test file passing, including `test/hf6-attest.test.ts`, with no failures. `npm run build` completes `tsc --noEmit` with no error and then `vite build` writes `dist/`. If `tsc` errors on the `.mjs` import, see Risks for the scoped-shim fallback.

- [ ] **Step 8: Commit**

```bash
git add calibration/hf6-attest.mjs test/hf6-attest.test.ts package.json
git commit -m "feat(hf6): attest the sealed record instead of recomputing it"
```

*Expected:* `3 files changed`, with `create mode 100644 calibration/hf6-attest.mjs` and `create mode 100644 test/hf6-attest.test.ts`.

---

### Task 21: Prove the attestation bites: four tamper drills and the runbook

**Files:**

```
Modify: calibration/README.md:79-80 and append a new section after :158
Temporarily modified and restored by git: calibration/hf6-sealed-verification.json, calibration/data/hf6/forcing/env_hf6_1975121n09072.bin, src/sim.ts, calibration/hf6-acceptance.json
```

**Consumes:** `npm run hf6:verify:check` as repointed by Task 3, and the `[clause N]` message prefixes it emits.

**Produces:** A committed tamper runbook in `calibration/README.md` naming the four drills and stating which one cannot run until Phase 8b.

- [ ] **Step 1: Confirm the tree is clean before tampering**

Every drill below relies on `git checkout --` to undo the damage. Confirm nothing is already dirty in the paths you are about to touch:

```bash
git status --porcelain calibration src test package.json docs
```

Why the draft's third drill was deleted: the design spec at :440-443 records that `git checkout <pre> -- src/sim.ts` proves nothing, because on the pre-expansion tree `<pre>` IS `HEAD`, so the command restores the file to the bytes it already has and the attestation stays green for the trivial reason. A tamper drill must MODIFY a file, not restore it.

*Expected:* Prints nothing. If it prints anything, commit or stash first — otherwise the restore steps will destroy real work.

- [ ] **Step 2: Drill 1 (clause 1) — alter one byte of the sealed record**

```bash
node -e "const fs=require('fs');const p='calibration/hf6-sealed-verification.json';const t=fs.readFileSync(p,'utf8');fs.writeFileSync(p,t.replace('\"storms\": 8','\"storms\": 9'));console.log('tampered');"
npm run hf6:verify:check
git checkout -- calibration/hf6-sealed-verification.json
npm run hf6:verify:check
```

*Expected:* The first `hf6:verify:check` exits non-zero and prints, on stderr:
```
HF-6 attestation FAILED — 2 problem(s):
  [clause 1] sealed record changed: calibration/hf6-sealed-verification.json — sealed 76746 B sha256 f2728914428bcf8a35c853e8ac428d2390f2868bab5173c89ff6fcd8665f474d, actual 76746 B sha256 <different hex>
  [clause 1] sealed record is not the one calibration/hf6-acceptance.json accepted — seal f2728914..., acceptance f2728914...
```
(Two clause-1 lines because the byte edit also breaks the acceptance binding; both name the path, neither is a stack trace.) After `git checkout --`, the second run prints the OK lines and exits 0.

- [ ] **Step 3: Drill 2 (clause 2) — flip one byte of a frozen forcing bin**

Pick a byte deep inside the data region, well past the header:

```bash
node -e "const fs=require('fs');const p='calibration/data/hf6/forcing/env_hf6_1975121n09072.bin';const b=fs.readFileSync(p);b[700000]^=0x01;fs.writeFileSync(p,b);console.log('flipped byte 700000');"
npm run hf6:verify:check
git checkout -- calibration/data/hf6/forcing/env_hf6_1975121n09072.bin
npm run hf6:verify:check
```

Repeat once against a frozen input added by Task 1 to prove the new copies are covered:
```bash
node -e "const fs=require('fs');const p='calibration/data/hf6/forcing/terrain.bin';const b=fs.readFileSync(p);b[1000000]^=0x01;fs.writeFileSync(p,b);console.log('flipped');"
npm run hf6:verify:check
git checkout -- calibration/data/hf6/forcing/terrain.bin
```

*Expected:* First run exits non-zero with exactly one failure line naming the path:
```
HF-6 attestation FAILED — 1 problem(s):
  [clause 2] frozen input changed: calibration/data/hf6/forcing/env_hf6_1975121n09072.bin — sealed 737992 B sha256 13547e2246d9b21637ac37dc687dc70d4e904d47da834cb0d7ff84f90c8fd6d3, actual 737992 B sha256 <different hex>
```
The terrain.bin repeat produces the analogous line naming `calibration/data/hf6/forcing/terrain.bin` with sealed sha256 `a350399d3ce4960313f92e58f4f08d04b9c76ca6a7c35319d27443f3344ae262`. Both restore to green.

- [ ] **Step 4: Drill 3 (clause 3, identical branch) — edit a declared-identical runtime module**

On THIS tree all eight runtime modules are declared `identical`, so this drill bites here. It is the live replacement for the no-op drill the spec deleted.

```bash
node -e "const fs=require('fs');fs.appendFileSync('src/sim.ts','\n// tamper drill\n');console.log('appended');"
npm run hf6:verify:check
git checkout -- src/sim.ts
npm run hf6:verify:check
```

*Expected:* First run exits non-zero with exactly one failure line:
```
HF-6 attestation FAILED — 1 problem(s):
  [clause 3] runtime module changed since the seal: src/sim.ts (declared "identical") — attested 2d09847109b6c73754bb1f3bdebd6e4a5cbbf1bf23ab750838ad4f7f29483d5b, actual <different hex>. Re-attest deliberately with node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD
```
After restore, green.

- [ ] **Step 5: Drill 4 (clause 4) — move the frozen verdict**

```bash
node -e "const fs=require('fs');const p='calibration/hf6-acceptance.json';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('\"sealedRetrospectiveStatus\": \"rejected\"','\"sealedRetrospectiveStatus\": \"accepted\"'));console.log('tampered');"
npm run hf6:verify:check
git checkout -- calibration/hf6-acceptance.json
npm run hf6:verify:check
```

*Expected:* First run exits non-zero with exactly one failure line:
```
HF-6 attestation FAILED — 1 problem(s):
  [clause 4] HF-6 verdict moved: calibration/hf6-acceptance.json sealedRetrospectiveStatus — sealed "rejected", actual "accepted"
```
After restore, green.

- [ ] **Step 6: State plainly which drill cannot run yet**

There is a FIFTH drill and it CANNOT be run in this phase: proving that a module already declared `diverged` fails when it drifts a second time. On the pre-expansion tree no module is diverged (`node calibration/hf6-seal.mjs` printed `0 diverged` in Task 2), so there is nothing to drift away from. That drill belongs to Phase 8b, which flips the seven physics modules to their post-expansion content hashes with `--diverged-at` / `--diverged-note` and then re-runs it against a genuine divergence.

The LOGIC of that drill is already covered, on fixtures, by `test/hf6-attest.test.ts` — the test named `clause 3 pins a diverged module to its content hash, not to a boolean`. Confirm it is present and passing:

```bash
npx vitest run test/hf6-attest.test.ts -t "content hash"
```

*Expected:* `Tests  1 passed | 10 skipped (11)`. Do not claim the real-tree divergence drill has been run; it has not, and Task 4's runbook says so in writing.

- [ ] **Step 7: Write the runbook into calibration/README.md**

Two edits.

(a) Replace `calibration/README.md:79-80`.

Before:
```
  awaiting future storms), `hf6-observation-audit.json`, and `hf6-verify.mjs`
  writing `hf6-sealed-verification.json`.
```
After:
```
  awaiting future storms), `hf6-observation-audit.json`, and
  `hf6-sealed-verification.json` — the record `hf6-verify.mjs` produced on the
  pre-expansion tree, attested since by `hf6-seal.json` + `hf6-attest.mjs`.
  `hf6-verify.mjs` is retained unmodified as the instrument that produced the
  record and is deliberately not wired to an npm script: running it rewrites
  the sealed record.
```

(b) Append this section at the end of the file (after line 158):
```

## HF-6 attestation and its tamper drills

`npm run hf6:verify:check` runs `hf6-attest.mjs`, not `hf6-verify.mjs`. It does
not recompute the sealed cohort — it attests four clauses against
`hf6-seal.json`:

1. the sealed record is byte-intact and is still the record
   `hf6-acceptance.json` hashed;
2. all 24 frozen inputs are byte-intact and agree with the record;
3. each of the 8 named runtime modules matches the SHA-256 content the seal
   attests for it, and each declared status agrees with the record;
4. the sealed verdict is still `rejected`.

This asserts strictly less than the recomputation it replaces. See
`docs/model-card-hf6.md`, "Version and governance".

The check is proved to bite by four drills, each of which must fail with a
distinct `[clause N]` line naming the offending path, then return to green
after `git checkout -- <path>`:

| Drill | Tamper | Clause |
| --- | --- | --- |
| 1 | edit `hf6-sealed-verification.json` | 1 |
| 2 | flip a byte in any frozen input | 2 |
| 3 | edit a declared-identical runtime module | 3 |
| 4 | change `sealedRetrospectiveStatus` in `hf6-acceptance.json` | 4 |

A fifth drill — a module already declared `diverged` drifting a second time —
cannot run while every module is declared `identical`. Its logic is covered on
fixtures by `test/hf6-attest.test.ts`; the real-tree run belongs to the phase
that first declares a divergence.

Re-attesting is deliberate and dated:

```bash
node calibration/hf6-seal.mjs --write --sealed-at=YYYY-MM-DD \
  --diverged-at="<phase>" --diverged-note="<what changed and why>"
```

The generator refuses to record a divergence without both flags.
```

*Expected:* File edited. `git diff --numstat calibration/README.md` shows additions and exactly 2 deletions.

- [ ] **Step 8: Verify green, then commit**

```bash
git status --porcelain calibration src test docs package.json
npm run hf6:verify:check
git add calibration/README.md
git commit -m "docs(hf6): record the attestation clauses and their tamper drills"
```

*Expected:* `git status --porcelain` lists only ` M calibration/README.md` — proof every drill was fully restored. `hf6:verify:check` prints the OK lines. Commit reports `1 file changed`.

---

### Task 22: Record the downgrade in the model card and regenerate the HF-6 gate

**Files:**

```
Modify: docs/model-card-hf6.md:83-89 (append a paragraph)
Modify: README.md:238
Modify: CONTRIBUTING.md (insert one sentence after :24)
Regenerate: calibration/hf6-acceptance.json, docs/hf6-scorecard.md (via `npm run hf6:gate` — never by hand)
```

**Consumes:** The behaviour change delivered by Task 3 (`hf6:verify:check` now attests rather than recomputes) and Task 4's runbook.

**Produces:** The written, public statement that CI now asserts less than it did. Nothing downstream consumes it in code.

- [ ] **Step 1: Capture the current acceptance hash so the regeneration can be audited**

`calibration/hf6-gate.mjs:14` reads `docs/model-card-hf6.md` and `:150` writes `manifests.modelCardSha256`. Editing the card therefore makes `npm run hf6:gate:check` fail until the gate is re-run. Record the before-state:

```bash
node -e "const j=require('./calibration/hf6-acceptance.json');console.log('modelCard',j.manifests.modelCardSha256);console.log('verdict',j.implementationStatus,j.sealedRetrospectiveStatus,j.prospectiveStatus);"
```

*Expected:* ```
modelCard ff395ab7d961db8d095ee879bb062255aece71490b90e0c8c6607b89e245225c
verdict complete rejected awaiting-future-storms
```

- [ ] **Step 2: Append the downgrade paragraph to the model card**

Edit `docs/model-card-hf6.md`. Leave lines 1-82 untouched — in particular do NOT touch `:31` ("previously unseen") or `:75` ("The fixed 50–70 E, 15–27 N domain…"); those are later phases' corrections and both are still true today.

Before (lines 83-89, end of file):
```
## Version and governance

This card describes the HF-6 contract in `calibration/hf6-contract.json` and the
runtime source hashes recorded in the versioned scorecard artifacts. Failed
gates remain visible. Thresholds may not be relaxed after results are viewed.
Any future parameter revision requires a new sealed cohort, and prospective
runs must be archived before observations arrive.
```
After:
```
## Version and governance

This card describes the HF-6 contract in `calibration/hf6-contract.json` and the
runtime source hashes recorded in the versioned scorecard artifacts. Failed
gates remain visible. Thresholds may not be relaxed after results are viewed.
Any future parameter revision requires a new sealed cohort, and prospective
runs must be archived before observations arrive.

**The sealed cohort is no longer recomputed, and that is a downgrade.** Until
2026-08-10, `npm run hf6:verify:check` ran `calibration/hf6-verify.mjs`, which
re-ran all 16 sealed hindcasts through the live runtime and diffed every metric
against `calibration/hf6-sealed-verification.json`. It therefore proved the
shipped code still produced the published numbers. It cannot survive the
planned northern Indian Ocean domain expansion: the runtime closure it loads
reads the live `DOMAIN`, so a wider domain changes the numbers by construction
and no frozen input can prevent it. The check is now an attestation
(`calibration/hf6-seal.json`, `calibration/hf6-attest.mjs`). It proves that the
record is byte-intact and is still the record this gate hashed, that the 24
frozen inputs are byte-intact, that each of the eight named runtime modules
still matches the SHA-256 content the seal attests for it, and that the sealed
verdict is still `rejected`. It does not prove that the current code reproduces
the record. The published HF-6 numbers are a dated measurement of the
pre-expansion tree, not a live claim about the shipped model.
`calibration/hf6-verify.mjs` is retained unmodified as the instrument that
produced them.
```

*Expected:* File edited. `npm run hf6:gate:check` now fails with `Error: HF-6 gate or scorecard artifact is stale` — run it once to see that, so you know the binding is real.

- [ ] **Step 3: Regenerate the gate artifacts through the documented script**

Never hand-edit `calibration/hf6-acceptance.json` or `docs/hf6-scorecard.md`; CLAUDE.md lists the scorecard among the machine-generated reports.

```bash
npm run hf6:gate
git diff --numstat calibration/hf6-acceptance.json docs/hf6-scorecard.md
git diff calibration/hf6-acceptance.json
npm run hf6:gate:check
```

*Expected:* `npm run hf6:gate` prints `[hf6] wrote gate: implementation=complete sealed=rejected prospective=awaiting-future-storms` — the verdict is UNCHANGED; this is not a re-scoring.
`git diff --numstat` prints exactly one line, `1	1	calibration/hf6-acceptance.json`, and does NOT mention `docs/hf6-scorecard.md` (the scorecard must come out byte-identical).
`git diff calibration/hf6-acceptance.json` shows exactly one removed and one added line, both `"modelCardSha256": ...`.
`npm run hf6:gate:check` exits 0.
If any verdict field changes, STOP — re-running a gate to move a verdict invalidates the protocol (CLAUDE.md, "Frozen scientific gates").

- [ ] **Step 4: Fix the two prose claims that the change made false**

(a) `README.md:238`.
Before:
```
npm run hf6:verify:check                    # reproduce the committed first look
```
After:
```
npm run hf6:verify:check                    # attest the frozen record (no recompute)
```

(b) `CONTRIBUTING.md`, insert one sentence immediately after line 24 (`npm run hf6:prospective:check`, `npm run build`. Run them locally first.`) and before the existing `npm run assets:check` sentence:
```
`hf6:verify:check` attests the frozen HF-6 record and its inputs; it no longer
recomputes the sealed cohort — see `docs/model-card-hf6.md`.
```

Do NOT edit `docs/findings-hf1-hf6.md:188` or `docs/oman-dgm-operational-readiness-audit.md:320-357`. The design spec at :866-868 rules them historical: their claims were true when written.

*Expected:* `grep -n "reproduce the committed first look" README.md` returns nothing. `grep -n "attests the frozen HF-6 record" CONTRIBUTING.md` returns one line.

- [ ] **Step 5: Run the full CI-gate sequence exactly as deploy.yml does**

`.github/workflows/deploy.yml:40-51` runs these in order. Reproduce them (skipping `live:acquire`, which needs the network):

```bash
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run build
```

*Expected:* All six exit 0. `npm run hf6:verify:check` prints the two attestation OK lines. `npm run calibrate:check` prints its three checks with no `stale` error — this phase touched no physics, so it must be untouched.

- [ ] **Step 6: Confirm the phase changed no generated data and commit**

```bash
npm run assets:check
git status --porcelain public/data
git status --porcelain calibration docs
git add docs/model-card-hf6.md calibration/hf6-acceptance.json docs/hf6-scorecard.md README.md CONTRIBUTING.md
git commit -m "docs(hf6): label the attestation reframing as a downgrade of what CI asserts"
```

*Expected:* `npm run assets:check` prints `asset manifest clean (N files)`. `git status --porcelain public/data` prints NOTHING — this phase touched no baked asset. `git status --porcelain calibration docs` lists only ` M calibration/hf6-acceptance.json` and ` M docs/model-card-hf6.md` (docs/hf6-scorecard.md must be absent, i.e. byte-identical). The commit reports `4 files changed` (the scorecard, being unchanged, contributes nothing).

- [ ] **Step 7: Final phase check**

```bash
git log --oneline -5
git status --porcelain
npm run hf6:verify:check
```

*Expected:* Five commits from this phase, in order (oldest first): `chore(hf6): freeze terrain and ocean forcing beside the sealed bins`, `feat(hf6): seal the frozen record, inputs and runtime content hashes`, `feat(hf6): attest the sealed record instead of recomputing it`, `docs(hf6): record the attestation clauses and their tamper drills`, `docs(hf6): label the attestation reframing as a downgrade of what CI asserts`. `git status --porcelain` shows only pre-existing untracked scratch files (`gmrt_*.nc`, `hs/`, `woa_*.nc`) and nothing tracked. `hf6:verify:check` green.


**Unverified in this phase — the implementer must check:**

- Phase 1 may arrive with hf6:verify:check ALREADY RED. The design spec at :403 has Phase 1 repoint `hf6-verify.mjs:101` to a new `SCORING_DOMAIN`, and at :408 add `MAX_AGE_H` to `src/sim.ts`. Both files are hashed into `manifests.runtimeVerifierSha256` / `manifests.runtimeSimSha256` by `hf6-verify.mjs:310-313`, so the OLD `--check` would fail with `HF-6 sealed verification is stale (manifests)` the moment either is edited. I verified this session that on HEAD (ada2b16) all 14 tracked hashes still match, so the problem does not exist YET. If it exists when you start Phase 2, Task 2 step 3 will throw instead of printing `0 diverged`: that is the generator refusing to smuggle a divergence. Do not delete the guard. Re-run with `--diverged-at="Phase 1" --diverged-note="<exact change>"`, and raise with the reviewer whether Phase 1's own zero-diff claim holds. This is the single most likely way the plan meets reality differently from how it was written.
- I could not run `npm run build` (the task forbade it), so `tsc --noEmit` acceptance of `import { attest } from '../calibration/hf6-attest.mjs'` in a `.ts` test is inferred from precedent, not observed: `test/asset-manifest.test.ts:1-7` imports `../calibration/asset-manifest.mjs` the same way, tsconfig.json includes `test`, and the build passes today. If TypeScript nonetheless errors (TS7016 / 'could not find a declaration file'), add a scoped shim in the style of the existing `test/node-fs.d.ts` rather than adding a dependency: `declare module '../calibration/hf6-attest.mjs' { export const FROZEN_INPUT_COUNT: number; export const RUNTIME_MODULE_COUNT: number; export const FORCING_BIN_COUNT: number; export function attest(seal: any, record: any, acceptance: any, probe: (path: string) => { bytes: number; sha256: string } | null, sizes?: { frozenInputs: number; runtimeModules: number; forcingBins: number }): string[]; }`. Adding `@types/node` is forbidden by CLAUDE.md.
- I could not run `npm run hf6:gate` (a write command), so 'docs/hf6-scorecard.md comes out byte-identical' is derived by reading `calibration/hf6-gate.mjs:156-201`: every interpolated value comes from contract/catalog/audit/verification/prospective, none from the model card, whose only use is the boolean at `:68` and the hash at `:150`. Verify it rather than trust it — Task 5 step 3's `git diff --numstat` is the check. If the scorecard does move, stop and find out why before committing.
- The exact stderr text of the tamper drills is predicted from the source I wrote, not observed. Byte counts and sealed hashes in the expected outputs ARE measured this session (record 76746 B / f2728914…, terrain 2084344 B / a350399d…, ocean 700120 B / 0811050864…, env_hf6_1975121n09072.bin 737992 B / 13547e22…). If a message differs in wording but still starts with the right `[clause N]` and names the right path, that is a pass; if it is a stack trace or names nothing, the script is wrong.
- Drill 3 appends to `src/sim.ts` and relies on `git checkout -- src/sim.ts` to undo it. If the working tree is dirty in `src/` the restore destroys uncommitted work. Task 4 step 1 exists to prevent that; do not skip it. The repository root currently carries untracked scratch files (`gmrt_*.nc`, `hs/`, `woa_*.nc`) that will appear in a bare `git status --porcelain` — that is why every status check in this plan is path-scoped.
- The seal's own integrity rests on review, not on cryptography: a person who edits `calibration/hf6-seal.json` can move any hash in it. Clauses 1-3 close most of this by cross-binding the seal to two independent artifacts (`hf6-sealed-verification.json`'s `manifests` and `hf6-acceptance.json`'s `manifests.verificationSha256`), so the only unbound freedom left is `attestedSha256` — and changing that forces `status: "diverged"` plus a non-null `divergedAt` and `note`. A silent weakening is therefore not possible; a loud, dated one is, and that is the intent. Say this out loud in review rather than claiming the seal is tamper-proof.
- This phase deliberately keeps the npm script NAME `hf6:verify:check` while changing what it asserts, so that `.github/workflows/deploy.yml` and `CONTRIBUTING.md` need no edit. That is a readability risk: a future reader can see a green `hf6:verify:check` and believe the cohort was reproduced. Task 5's model-card paragraph and Task 4's `calibration/README.md` section are the only mitigations. If the reviewer prefers, renaming to `hf6:attest:check` and updating `deploy.yml:47` is a defensible alternative — but it puts a CI-file edit inside Seam A.
- Removing the `hf6:verify` npm script orphans two historical references (`docs/oman-dgm-operational-readiness-audit.md:351` and `docs/superpowers/plans/2026-07-27-layer-integrity-e-and-a.md:1329`). The design spec at :866-868 forbids editing either. They are correct about the past; the ROADMAP break entry in Phase 3 is where they become historical. Do not 'fix' them here.
- `calibration/data/hf6/forcing/` gains 2.78 MB of duplicated binary (terrain 2084344 B + ocean 700120 B). This is intentional duplication of `public/data/`, and after Phase 6-8 the two copies will legitimately differ. Anyone later 'cleaning up the duplicate' destroys the freeze. There is no test that would catch that deletion except clause 2 of the attestation — which is exactly why clause 2 exists.

---

## Phase 3 — governance record and pre-registration (nio-v1 domain expansion, Seam A)

This phase writes every governance artifact that must exist BEFORE a single byte of ERA5 is fetched or rebaked. It produces four things: a dated ROADMAP break entry that pre-registers what the expansion will change and what it honestly weakens; a frozen, machine-readable ERA5 sample-year criterion (`calibration/era5-yearpick-criterion.json`) plus the code that executes it, so the selection rule cannot be silently altered after a pick is seen; a pre-registered replacement for the November bake guard whose numeric thresholds are either derived from that frozen criterion or downgraded to structural assertions; and three test-side honesty fixes (the test-partition leakage FACT, frozen-catalogue regeneration guards, and a disclaimer-string pin). Nothing here fetches data, rebakes an asset, or changes physics. A reviewer knows it worked when `npm test`, `npm run calibrate:check`, `npm run hf6:verify:check`, `npm run hf6:gate:check`, `npm run hf6:prospective:check`, `npm run realism:check` and `npm run build` are all green, `node bake/run-python.mjs bake/test_yearpick.py` and `bake/test_upper.py` pass, and `git diff --name-only <phase3-base>..HEAD -- calibration docs public/data` lists ONLY newly added files plus `ROADMAP.md` — with nothing at all under `public/data` and no existing sealed artifact modified.

**Files in this phase:**

```
D:\personal\wallah-its-windy\ROADMAP.md — MODIFY: gains the dated nio-v1 pre-registration break entry (Task 1).
D:\personal\wallah-its-windy\calibration\era5-yearpick-criterion.json — CREATE: THE frozen ERA5 sample-year selection rule; two profiles (`legacy`, `nio-v1`); written once, never amended (Task 2).
D:\personal\wallah-its-windy\test\era5-yearpick-criterion.test.ts — CREATE: pins the criterion file's SHA-256 and every numeric constant as independent literals; this is the freeze mechanism (Task 2).
D:\personal\wallah-its-windy\bake\yearpick.py — CREATE: the only executor of the criterion; holds no selection constant of its own (Task 3).
D:\personal\wallah-its-windy\bake\test_yearpick.py — CREATE: synthetic-field tests, including a verbatim legacy reference implementation proving the `legacy` profile is bit-identical to today's picks (Task 3).
D:\personal\wallah-its-windy\bake\era5.py — MODIFY: deletes its three hardcoded selection constants and three private selection functions; delegates to `yearpick` (Task 3).
D:\personal\wallah-its-windy\bake\test_upper.py — MODIFY: synthetic latitudes moved into the 5–19°N belt so the fixture survives both criterion profiles (Task 3).
D:\personal\wallah-its-windy\bake\realism_env_variance.py — MODIFY: comment only; its `BELT_LAT_MAX` now points at the criterion file instead of a deleted era5.py constant (Task 3).
D:\personal\wallah-its-windy\bake\README.md — MODIFY: documents `yearpick.py`, `test_yearpick.py` and the criterion file (Task 3).
D:\personal\wallah-its-windy\test\helpers\env-belt.ts — CREATE: the belt-mean shear statistic over a parsed `.bin` layer, band- and cos(lat)-aware (Task 4).
D:\personal\wallah-its-windy\test\env-belt.test.ts — CREATE: unit test for that helper against synthetic bins built with `test/helpers/wiwb.ts` (Task 4).
D:\personal\wallah-its-windy\test\integration-bins.test.ts — MODIFY: lines 325-397 replaced by a header-branched block — legacy expectations unchanged for today's bake, pre-registered expectations for the basin-wide bake (Task 5).
D:\personal\wallah-its-windy\test\fidelity-catalog.test.ts — MODIFY: asserts the leakage FACT via a frozen, dated, exact cross-tabulation; tightens the `testPolicy` string to exact equality; pins `protocol.domain` (Tasks 6 and 7).
D:\personal\wallah-its-windy\test\hf6-contract.test.ts — MODIFY: pins the sealed HF-6 catalogue's `protocol.domain`, `sealId` and `sealedAt` (Task 7).
D:\personal\wallah-its-windy\bake\fidelity_catalog.py — MODIFY: gains a `--check` mode, a `--reseal` write guard, and a sealed-domain assertion (Task 7).
D:\personal\wallah-its-windy\bake\hf6_catalog.py — MODIFY: gains the same sealed-domain assertion (Task 7).
D:\personal\wallah-its-windy\package.json — MODIFY: adds `data:fidelity:catalog:check` (Task 7).
D:\personal\wallah-its-windy\test\disclaimers.test.ts — CREATE: pins the four product-honesty strings byte-for-byte, including the non-ASCII characters (Task 8).
```

### Task 23: Write the dated nio-v1 break entry into ROADMAP.md

**Files:**

```
Modify: D:\personal\wallah-its-windy\ROADMAP.md:85-87 (insert a new section between line 85 and the blank line preceding line 87)
```

**Consumes:** nothing

**Produces:** A `## Domain break — northern Indian Ocean (nio-v1), pre-registered 2026-08-10` section in ROADMAP.md. Later tasks and phases refer to it by that exact heading. It names three artifacts that later tasks create: `calibration/era5-yearpick-criterion.json` (Task 2), `calibration/era5-yearpick-record.json` (NOT created here — Phase 7 writes it), and the leakage cross-tabulation in `test/fidelity-catalog.test.ts` (Task 6).

- [ ] **Step 1: Confirm the insertion anchor is where the plan says it is**

Run from the repo root:

```powershell
node -e "const l=require('fs').readFileSync('ROADMAP.md','utf8').split('\n'); for(let i=82;i<=88;i++) console.log(i+1, JSON.stringify(l[i]))"
```

*Expected:* Exactly this, character for character:

```
83 "the deploy workflow has been green since"  (partial line — content varies)
84 "its first successful push run at 04:18 UTC on 2026-07-27, and Pages publishes"
85 "current main."
86 ""
87 "## Rules that apply to every phase"
```

If line 85 is not `current main.` and line 87 is not `## Rules that apply to every phase`, STOP: the file moved and every line number in this task is stale.

- [ ] **Step 2: Insert the break entry**

Insert the following block after line 85 (`current main.`) and before line 86 (the blank line). Keep one blank line above and one below the inserted block, so the existing `## Rules that apply to every phase` heading still has a blank line before it.

```markdown

## Domain break — northern Indian Ocean (nio-v1), pre-registered 2026-08-10

This section is written **before** any data is fetched or rebaked. It is the
pre-registration record for the domain expansion designed in
`docs/superpowers/specs/2026-08-09-nio-domain-expansion-design.md`. Values
marked *pending* are measured later, by the phase named beside them, and are
never chosen after the result is seen.

**What changes.** The simulation domain moves from the Arabian Sea box
(50–70 °E, 15–27 °N) to the northern Indian Ocean (45–100 °E, 0–30 °N) at
unchanged cell size, and every baked asset is regenerated. The ERA5
sample-year selection is re-run basin-wide, so **every environment plane in
`env.bin`, `upper.bin` and the twelve-month `ocean.bin` changes**, including at
points inside the old box. All ten public scenario spawns move, because the
larger box exposes each storm's real first in-domain fix.

**What does not change.** The URL-hash *format* is untouched: a climatology
storm still encodes to the exact legacy `lat=…&lon=…&month=…&seed=…` string.
The golden hex vector in `BINARY-FORMATS.md` does not change. No calibrated
physics parameter is tuned by this project.

**What is honestly weakened.**

- *Replay identity becomes a within-build claim.* A URL shared before the
  rebake replays a different storm afterwards, because the forcing bytes it
  samples are different. The hash still parses; the track no longer matches.
- *`SHEAR_THRESHOLD_MS` and `SHEAR_K_KT_PER_H_PER_MS` become uncalibrated for
  the shipped forcing.* They were fitted to the old box's monthly-mean shear
  distribution. This project does not move them. `docs/hf7-realism-charter.md`
  is the phase that may.
- *`npm run hf6:verify:check` is downgraded* from a recomputation of the sealed
  hindcasts to a four-clause attestation over frozen inputs and content hashes.
  The sealed HF-6 cohort is no longer recomputable against the live runtime.
  The rejection verdict is unchanged and stays rejected.

**Pre-registered before any pick was seen.** The ERA5 sample-year criterion is
frozen in `calibration/era5-yearpick-criterion.json`, created 2026-08-10 in a
single commit and never amended. Its `nio-v1` profile bands the
farthest-point diversity metric to 5–25 °N, weights every cell by cos(lat),
redefines the genesis belt two-sided at 5–19 °N, and generalizes the
post-monsoon thermodynamic rescue from a hardwired November to
October–December. Both absolutes are re-derived from the model's own constant
`SIM.SHEAR_THRESHOLD_MS = 14`: `calmBeltShearMs = 13.0` (threshold minus 1 m/s
of headroom) and `viabilityBeltShearMs = 17.0` (threshold plus 3 m/s). The
rescue month list comes from `calibration/results.json`'s 39-storm basin-wide
2019–2024 dataset, sealed long before this criterion: October 7, November 7,
**December 6** genesis events, against zero in January and February. December
is as productive as May and the current seven-month bake cannot reach it.

**Known contamination — measured, not asserted away.** Six storms already sat
in more than one frozen role before this project began. The full
cross-tabulation of HF-1 partition against the structure split is frozen in
`test/fidelity-catalog.test.ts`. Two permanent-test HF-1 storms
(`2019301N05081` maha2019 and `2024238N25077` asna2024) contributed fixes to
`DEFAULT_STRUCTURE_PARAMETERS`, contradicting the catalogue's own
`testPolicy`. The direction of the resulting bias is **unquantified**: these
gates score differences against a baseline that shares the same contaminated
frozen input, so a leak can depress a measured improvement as easily as
inflate it. It therefore does **not** make the standing rejections
conservative. Phase 13 measures the shift and publishes it beside the sealed
numbers. No storm moves across a split boundary and no sealed verdict changes.

**Measured outcomes — pending.**

| Item | Value | Recorded by |
| --- | --- | --- |
| Pages compression above 4.2 MB | pending | Phase 0 |
| ERA5 picked years, per month | pending | Phase 7, `calibration/era5-yearpick-record.json` |
| HF-1 validation drift after the re-pick | pending | Phase 7, `docs/fidelity-benchmark.md` |
| First paint, gzip on the wire | pending | Phase 10 |
| Post-monsoon Cat-1 fraction, basin-wide | pending | Phase 10 |
| Hindcast re-measurement on moved initializations | pending | Phase 10 |
| Structure refit with the six contaminated SIDs removed | pending | Phase 13 |

The Phase 10 hindcast re-run re-scores an already-rejected candidate on moved
initializations. Declared in advance, per CLAUDE.md's rule that re-running a
gate to flip a verdict invalidates the protocol: **a flip of `accepted` to true
does not constitute acceptance and must not deploy.** `deployedParameters`
stays `BASELINE`, the run is recorded as a re-measurement, and the discrepancy
is written into this section.
```

*Expected:* `ROADMAP.md` gains 1 new `##` heading. `git diff --stat ROADMAP.md` shows insertions only, zero deletions.

- [ ] **Step 3: Prove nothing else in the governed tree moved**

```powershell
git status --porcelain calibration docs public/data
git diff --stat ROADMAP.md
```

*Expected:* `git status --porcelain calibration docs public/data` prints NOTHING. `git diff --stat` shows exactly one file changed, `ROADMAP.md`, with 0 deletions.

- [ ] **Step 4: Run the sealed checks to prove a docs-only edit changed no science**

```powershell
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
```

*Expected:* All seven commands exit 0. `npm run calibrate:check` ends with three PASS lines (structure, hindcast, fidelity). `npm run build` prints no TypeScript error and completes the vite build.

- [ ] **Step 5: Commit, and record the pre-registration ordering command**

```powershell
git add ROADMAP.md
git commit -m "docs: pre-register the nio-v1 domain break in ROADMAP"
```

Then record the ordering-proof command in the PR body. This command is the phase gate for every later phase, and it is deliberately NOT a vitest test — `actions/checkout` clones at depth 1, so git history is not reliably present in CI:

```powershell
# Must print exactly 1 at every later phase: the criterion is created once, never amended.
git log --oneline --follow -- calibration/era5-yearpick-criterion.json | Measure-Object -Line
# Must be empty at Phase 3 and non-empty only from Phase 7 onward:
git log --oneline <criterion-commit>..HEAD -- public/data/env.bin
```

*Expected:* One commit created. The first command prints `Lines : 0` today (the file does not exist until Task 2) and must print `Lines : 1` from Task 2 onward, forever.

---

### Task 24: Freeze the ERA5 year-pick criterion as a committed artifact with an independent pin

**Files:**

```
Create: D:\personal\wallah-its-windy\calibration\era5-yearpick-criterion.json
Test: D:\personal\wallah-its-windy\test\era5-yearpick-criterion.test.ts
```

**Consumes:** The ROADMAP section heading from Task 1 (referenced in the criterion's `authority` field).

**Produces:** `calibration/era5-yearpick-criterion.json` with top-level keys `schemaVersion`, `id`, `status`, `frozenUtc`, `authority`, `recordArtifact`, `modelAnchor`, `seasonEvidence`, `activeProfile`, `profiles`, `limitations`; and `profiles.legacy` / `profiles['nio-v1']` each with the exact shape `{samplesPerMonth, diversity:{metric,latBandMinDeg,latBandMaxDeg,cosLatWeighted}, belt:{latMinDeg,latMaxDeg,cosLatWeighted}, calmRescue:{enabled,calmBeltShearMs,months}, thermodynamicRescue:{enabled,months,viabilityBeltShearMs,fallbackWhenFewerThanTwoViable,tailPlanes}}`. Task 3's `bake/yearpick.py` reads exactly these keys. Task 5's replacement test reads `profiles['nio-v1'].belt` and `profiles['nio-v1'].calmRescue.calmBeltShearMs`.

- [ ] **Step 1: Read what the criterion must replace, and quote it**

Read these four regions of `bake/era5.py` before writing anything. They are what the criterion externalizes:

`bake/era5.py:37` — `SAMPLES_PER_MONTH = 4`

`bake/era5.py:48-49`:
```python
GENESIS_BELT_LAT_MAX = 19.0  # deg N; the low-latitude genesis belt
CALM_BELT_SHEAR_MS = 13.0    # below this a plane is a survivable regime
```

`bake/era5.py:222-231` — `_belt_shear_per_year` computes an **unweighted, one-sided** per-year mean:
```python
    lat, _lon = _axes
    mask = lat <= GENESIS_BELT_LAT_MAX
    if not mask.any():
        mask = np.ones_like(lat, dtype=bool)
    return shear_y[:, mask, :].mean(axis=(1, 2))
```

`bake/era5.py:248` — `_pick_sample_years` measures diversity over the **whole domain**, unweighted:
```python
    flat = np.concatenate([u_y.reshape(n, -1), v_y.reshape(n, -1)], axis=1)
```
followed by a most-typical seed pick (`:250`), a greedy farthest-point loop (`:251-256`), and a calm-year swap of the LAST pick gated on `CALM_BELT_SHEAR_MS` (`:257-268`).

`bake/era5.py:300` — the November viability cut, a bare literal:
```python
        if float(shear_mean[index]) < 17.0
```

`bake/era5.py:346` — the rescue is hardwired to one month:
```python
    if month == 10:
        idx = _post_monsoon_thermodynamic_rescue(yr, shear_y, idx)
```
There is no equivalent for the Bay of Bengal's December peak, and `_post_monsoon_thermodynamic_rescue` reads `era5_humidity._yearly[10]` with a literal 10 at `bake/era5.py:289`.

*Expected:* You can quote all six regions. In particular you have confirmed that `lat <= 19.0` over the new 0–30 °N box would average the entire 0–19 °N equatorial belt into a statistic that was calibrated on a 15–19 °N strip.

- [ ] **Step 2: Derive the two absolutes and the month list from committed evidence, not from data that does not exist yet**

Run these two read-only commands. They are the derivation record; paste their output into the PR body.

```powershell
node -e "const s=require('fs').readFileSync('src/sim.ts','utf8'); console.log(s.split('\n').slice(111,115).join('\n'))"
```

```powershell
node -e "const r=require('./calibration/results.json'); const sids=[...r.dataset.split.calibration,...r.dataset.split.validation]; const h={}; for(const s of sids){const y=+s.slice(0,4),d=+s.slice(4,7); const dt=new Date(Date.UTC(y,0,1)); dt.setUTCDate(d); h[dt.getUTCMonth()]=(h[dt.getUTCMonth()]||0)+1;} for(let m=0;m<12;m++) console.log(m, h[m]||0); console.log('total', sids.length)"
```

*Expected:* First command prints `SHEAR_THRESHOLD_MS: 14,` and `SHEAR_K_KT_PER_H_PER_MS: 0.45,`.

Second command prints the genesis-month histogram of the 39-storm basin-wide NI 2019–2024 structure dataset:
```
0 0
1 0
2 1
3 1
4 6
5 4
6 1
7 3
8 3
9 7
10 7
11 6
total 39
```
That is the justification for `thermodynamicRescueMonths = [9, 10, 11]` (Oct 7, Nov 7, Dec 6) and for declaring months 0–3 out of evidence. This dataset was sealed before this criterion existed, so using it is not retuning.

- [ ] **Step 3: Write the frozen criterion file**

Create `calibration/era5-yearpick-criterion.json` with exactly this content:

```json
{
  "schemaVersion": 1,
  "id": "era5-yearpick",
  "status": "frozen-before-any-pick",
  "frozenUtc": "2026-08-10T00:00:00Z",
  "authority": "docs/superpowers/specs/2026-08-09-nio-domain-expansion-design.md Phase 3; ROADMAP.md 'Domain break - northern Indian Ocean (nio-v1), pre-registered 2026-08-10'",
  "amendmentPolicy": "This file is created once and never amended. A change to any value here after a pick has been observed is retuning after scoring. The freeze is enforced by three independent committed copies of the same facts - this file, the SHA-256 and value literals in test/era5-yearpick-criterion.test.ts, and the behavioural assertions in bake/test_yearpick.py - plus the git ordering check in the ROADMAP break entry.",
  "recordArtifact": "calibration/era5-yearpick-record.json",
  "recordArtifactWrittenBy": "phase-7",
  "recordArtifactNote": "The picked years are OUTPUT. They are recorded in the record artifact, never in this file, so that this file's bytes can stay fixed across the whole migration.",
  "modelAnchor": {
    "shearThresholdMs": 14,
    "source": "src/sim.ts SIM.SHEAR_THRESHOLD_MS",
    "note": "Both absolutes below are stated as offsets from this model constant rather than as basin samples, so redefining the belt cannot silently change what they mean."
  },
  "seasonEvidence": {
    "source": "calibration/results.json dataset.split (calibration + validation), 39 North Indian basin storms 2019-2024, sealed before this criterion",
    "genesisCountsByMonthIndex": [0, 0, 1, 1, 6, 4, 1, 3, 3, 7, 7, 6],
    "note": "October 7, November 7, December 6. December is as productive as May (4) and is unreachable in the seven-month bake. January and February produced zero storms in six years."
  },
  "activeProfile": "legacy",
  "activeProfileNote": "Phase 3 through Phase 6 run the legacy profile so that growing the grid is provably a registration change and nothing else. Phase 7 flips activeProfile to nio-v1; that single-token edit IS the attributable reseal boundary.",
  "profiles": {
    "legacy": {
      "description": "Bit-identical reproduction of the Arabian-Sea-era picks as shipped on 2026-08-10. Not a recommendation; a control.",
      "samplesPerMonth": 4,
      "diversity": {
        "metric": "farthest-point-l2-over-concatenated-uv",
        "latBandMinDeg": null,
        "latBandMaxDeg": null,
        "cosLatWeighted": false
      },
      "belt": {
        "latMinDeg": null,
        "latMaxDeg": 19.0,
        "cosLatWeighted": false
      },
      "calmRescue": {
        "enabled": true,
        "calmBeltShearMs": 13.0,
        "months": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      },
      "thermodynamicRescue": {
        "enabled": true,
        "months": [10],
        "viabilityBeltShearMs": 17.0,
        "fallbackWhenFewerThanTwoViable": "none",
        "tailPlanes": 2
      }
    },
    "nio-v1": {
      "description": "Basin-wide criterion for 45-100 E, 0-30 N. Frozen before any pick was seen.",
      "samplesPerMonth": 4,
      "diversity": {
        "metric": "farthest-point-l2-over-concatenated-uv",
        "latBandMinDeg": 5.0,
        "latBandMaxDeg": 25.0,
        "cosLatWeighted": true
      },
      "belt": {
        "latMinDeg": 5.0,
        "latMaxDeg": 19.0,
        "cosLatWeighted": true
      },
      "calmRescue": {
        "enabled": true,
        "calmBeltShearMs": 13.0,
        "months": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      },
      "thermodynamicRescue": {
        "enabled": true,
        "months": [9, 10, 11],
        "viabilityBeltShearMs": 17.0,
        "fallbackWhenFewerThanTwoViable": "lowest-belt-shear",
        "tailPlanes": 2
      },
      "derivation": {
        "calmBeltShearMs": "shearThresholdMs minus 1.0 m/s of headroom = 13.0. Numerically equal to the Arabian-Sea-era constant, but now anchored to the model's own damage threshold rather than to a 15-19 N strip, so the two-sided belt redefinition does not change its meaning. Whether a basin-wide plane actually falls below it is an empirical question the pre-registered bake guard answers; a red guard is a published finding, not a threshold to move.",
        "viabilityBeltShearMs": "shearThresholdMs plus 3.0 m/s = 17.0. A candidate filter for the humidity ranking, not a physical threshold: wide enough that the ranking normally has at least two candidates. Retained at the legacy value because it is a filter width, not a calibrated response.",
        "beltLatMinDeg": "5.0. Tropical cyclogenesis is climatologically absent within about 5 degrees of the equator, and the design labels the 0-5 N belt out of evidence (no Coriolis term, no inertial dispersion). Without a floor, lat <= 19 over a 0-30 N box averages the entire equatorial monsoon belt into a genesis statistic.",
        "beltLatMaxDeg": "19.0, unchanged from the Arabian-Sea-era GENESIS_BELT_LAT_MAX. Only the missing floor is corrected; the upper edge is not moved, so exactly one thing changes.",
        "diversityLatBand": "[5.0, 25.0]. Over 45-100 E an unbanded whole-domain RMS is dominated by Bay-of-Bengal and equatorial monsoon variance that no storm in the genesis band ever feels, so farthest-point selection would optimise for a regime the model does not simulate.",
        "cosLatWeighted": "Cell area on a lat/lon grid is proportional to cos(lat). Over 0-30 N the factor spans 1.000 to 0.866 and the row count triples from 24 to 60, so an unweighted row mean is grid-dependent. The weighted mean is the area mean the statistic already claims to be.",
        "thermodynamicRescueMonths": "[9, 10, 11] = October, November, December, from seasonEvidence. The legacy rule is hardwired to month index 10 in bake/era5.py and reads era5_humidity._yearly[10] with a literal index; the Bay of Bengal's December peak has no equivalent. Generalising the month list, rather than adding a second hardwired branch, is what makes the rule statable in advance.",
        "fallbackWhenFewerThanTwoViable": "lowest-belt-shear. The legacy code returns the unrescued picks when fewer than two years pass the viability cut, so the rescue silently no-ops and nothing records that it did. The fallback takes the two lowest-belt-shear years instead and the record artifact marks the month, turning a silent no-op into a visible one.",
        "wholeBasinPick": "One pick per month for the whole basin, longitude unrestricted. Per-sub-basin picks would make plane k a chimera of two real years and break the coherent-year contract that env.bin, upper.bin and the paired RH field share (bake/era5.py steering_shear_samples docstring; the upper.bin plane-to-year invariant in CLAUDE.md)."
      }
    }
  },
  "limitations": [
    "A single whole-basin pick under-represents Arabian-Sea-specific regime diversity relative to the Arabian-Sea-only pick it replaces. Accepted deliberately; the coherent-year contract is worth more.",
    "The criterion selects real years. It cannot manufacture a survivable regime that the 1991-2020 record does not contain, in any month.",
    "Months 0-3 (January-April) are baked for twelve-month completeness and are declared out of evidence: zero, zero, one and one genesis events in the sealed six-year basin-wide dataset.",
    "bake/realism_env_variance.py keeps its own one-sided unweighted BELT_LAT_MAX = 19.0 so its committed R1 outputs do not drift. That statistic is deliberately NOT unified with this criterion."
  ]
}
```

*Expected:* The file exists. `node -e "JSON.parse(require('fs').readFileSync('calibration/era5-yearpick-criterion.json','utf8')); console.log('ok')"` prints `ok`.

- [ ] **Step 4: Write the pin test with a deliberately wrong hash, and watch it fail**

Create `test/era5-yearpick-criterion.test.ts`:

```ts
/**
 * era5-yearpick-criterion.test.ts — THE freeze mechanism for the ERA5
 * sample-year selection rule.
 *
 * The rule lives in calibration/era5-yearpick-criterion.json. This file holds a
 * SECOND, independent copy of the same facts: the file's SHA-256, and every
 * number restated as a literal. Editing the criterion alone turns this red.
 * Editing both is a visible two-file diff in one commit, which is exactly what
 * a reviewer needs to see when someone wants to change a rule after a pick.
 *
 * What "frozen" means mechanically:
 *   1. this test compares the criterion's bytes against a hash literal;
 *   2. this test compares each constant against a value literal;
 *   3. bake/test_yearpick.py asserts the rule's SHAPE on synthetic fields,
 *      independently of this file's text;
 *   4. the ROADMAP break entry carries the git command proving the criterion
 *      file has exactly one commit. That one is a PR gate, not a test: CI
 *      clones at depth 1, so git history is not reliably available.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'calibration/era5-yearpick-criterion.json';

/**
 * Recomputed by the reviewer with:
 *   node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('calibration/era5-yearpick-criterion.json')).digest('hex'))"
 * Frozen 2026-08-10, before any ERA5 pick was observed.
 */
const CRITERION_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000';

const text = readFileSync(PATH, 'utf8');
const criterion = JSON.parse(text) as any;

describe('frozen ERA5 sample-year criterion', () => {
  it('has not been amended since it was frozen', () => {
    expect(createHash('sha256').update(readFileSync(PATH)).digest('hex')).toBe(
      CRITERION_SHA256,
    );
    expect(criterion.schemaVersion).toBe(1);
    expect(criterion.status).toBe('frozen-before-any-pick');
    expect(criterion.frozenUtc).toBe('2026-08-10T00:00:00Z');
    expect(criterion.recordArtifact).toBe('calibration/era5-yearpick-record.json');
  });

  it('anchors both absolutes to the shipped model constant', () => {
    // Restated independently of the JSON so a coordinated edit is still a diff.
    expect(criterion.modelAnchor.shearThresholdMs).toBe(14);
    const nio = criterion.profiles['nio-v1'];
    expect(nio.calmRescue.calmBeltShearMs).toBe(14 - 1);
    expect(nio.thermodynamicRescue.viabilityBeltShearMs).toBe(14 + 3);
  });

  it('bands the diversity metric and makes the belt two-sided and area-weighted', () => {
    const nio = criterion.profiles['nio-v1'];
    expect(nio.samplesPerMonth).toBe(4);
    expect(nio.diversity).toEqual({
      metric: 'farthest-point-l2-over-concatenated-uv',
      latBandMinDeg: 5,
      latBandMaxDeg: 25,
      cosLatWeighted: true,
    });
    expect(nio.belt).toEqual({
      latMinDeg: 5,
      latMaxDeg: 19,
      cosLatWeighted: true,
    });
  });

  it('generalises the post-monsoon rescue off its hardwired November', () => {
    const nio = criterion.profiles['nio-v1'];
    expect(nio.thermodynamicRescue.months).toEqual([9, 10, 11]);
    expect(nio.thermodynamicRescue.tailPlanes).toBe(2);
    expect(nio.thermodynamicRescue.fallbackWhenFewerThanTwoViable).toBe(
      'lowest-belt-shear',
    );
    // The month list is derived from sealed evidence, not from intuition.
    expect(criterion.seasonEvidence.genesisCountsByMonthIndex).toEqual([
      0, 0, 1, 1, 6, 4, 1, 3, 3, 7, 7, 6,
    ]);
    for (const m of nio.thermodynamicRescue.months) {
      expect(criterion.seasonEvidence.genesisCountsByMonthIndex[m]).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps a control profile that reproduces the Arabian-Sea-era picks exactly', () => {
    const legacy = criterion.profiles.legacy;
    expect(legacy.samplesPerMonth).toBe(4);
    expect(legacy.diversity.latBandMinDeg).toBeNull();
    expect(legacy.diversity.latBandMaxDeg).toBeNull();
    expect(legacy.diversity.cosLatWeighted).toBe(false);
    expect(legacy.belt).toEqual({
      latMinDeg: null,
      latMaxDeg: 19,
      cosLatWeighted: false,
    });
    expect(legacy.calmRescue.calmBeltShearMs).toBe(13);
    expect(legacy.thermodynamicRescue.months).toEqual([10]);
    expect(legacy.thermodynamicRescue.viabilityBeltShearMs).toBe(17);
    expect(legacy.thermodynamicRescue.fallbackWhenFewerThanTwoViable).toBe('none');
  });

  it('ships with the control profile active until the attributable reseal', () => {
    // Phase 7 flips this to 'nio-v1'. Phases 3-6 must not.
    expect(criterion.activeProfile).toBe('legacy');
    expect(Object.keys(criterion.profiles).sort()).toEqual(['legacy', 'nio-v1']);
  });
});
```

Run it:
```powershell
npx vitest run test/era5-yearpick-criterion.test.ts
```

*Expected:* One failing test, `has not been amended since it was frozen`, with a diff of the form:
```
- Expected
+ Received
- "0000000000000000000000000000000000000000000000000000000000000000"
+ "<64 hex characters>"
```
The other five tests pass. If any of the other five fail, the criterion JSON was mistyped — fix the JSON, not the test.

- [ ] **Step 5: Paste the real digest and go green**

```powershell
node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('calibration/era5-yearpick-criterion.json')).digest('hex'))"
```

Replace the 64 zeros in `CRITERION_SHA256` with the printed digest. Re-run:
```powershell
npx vitest run test/era5-yearpick-criterion.test.ts
```

*Expected:* `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

- [ ] **Step 6: Prove the pin actually bites**

```powershell
node -e "const p='calibration/era5-yearpick-criterion.json'; const fs=require('fs'); const s=fs.readFileSync(p,'utf8'); fs.writeFileSync(p, s.replace('\"calmBeltShearMs\": 13.0', '\"calmBeltShearMs\": 12.0'))"
npx vitest run test/era5-yearpick-criterion.test.ts
git checkout -- calibration/era5-yearpick-criterion.json
```

*Expected:* Two tests fail: `has not been amended since it was frozen` (hash mismatch) and `anchors both absolutes to the shipped model constant` (`expected 12 to be 13`). After `git checkout` the file is restored — but note it is not yet committed, so if `git checkout` reports `pathspec did not match`, restore by re-editing the value back to `13.0` and re-running the digest check.

- [ ] **Step 7: Commit the criterion and its pin together**

```powershell
git add calibration/era5-yearpick-criterion.json test/era5-yearpick-criterion.test.ts
git commit -m "feat: freeze the ERA5 sample-year criterion before any pick"
git log --oneline --follow -- calibration/era5-yearpick-criterion.json | Measure-Object -Line
```

*Expected:* One commit created. The last command prints `Lines : 1`. That number must stay 1 for the life of the project.

---

### Task 25: Make bake/era5.py execute the frozen criterion instead of its own constants

**Files:**

```
Create: D:\personal\wallah-its-windy\bake\yearpick.py
Create: D:\personal\wallah-its-windy\bake\test_yearpick.py
Modify: D:\personal\wallah-its-windy\bake\era5.py:33-49, :222-269, :272-319, :335-349
Modify: D:\personal\wallah-its-windy\bake\test_upper.py:86
Modify: D:\personal\wallah-its-windy\bake\realism_env_variance.py:32
Modify: D:\personal\wallah-its-windy\bake\README.md
```

**Consumes:** `calibration/era5-yearpick-criterion.json` and its exact key shape, defined in Task 2.

**Produces:** Module `bake/yearpick.py` exporting `CRITERION_PATH`, `load_criterion(path=None) -> dict`, `active_profile(criterion=None) -> dict`, `belt_mean(field_y, lat, profile) -> np.ndarray`, `pick_years(u_y, v_y, shear_y, lat, profile, month=None) -> list[int]`, `thermodynamic_rescue(years, shear_y, humidity_y, lat, picks, profile) -> tuple[list[int], bool]`. `bake/era5.py` keeps its public surface unchanged (`available`, `banner`, `TAG`, `steering_shear`, `steering_shear_vector`, `steering_shear_samples`, `steering_shear_samples_vector`, `upper_level_samples_vector`) and keeps the private `_month_pick_indices(month)` that `bake/test_upper.py:119` calls. It gains `samples_per_month() -> int` and the module dict `_rescue_fallback: dict[int, bool]`.

- [ ] **Step 1: Write bake/test_yearpick.py first, with a verbatim legacy reference implementation**

Create `bake/test_yearpick.py`. The `_legacy_*` functions are copied character-for-character from today's `bake/era5.py` — they are the oracle that proves the `legacy` profile is bit-identical.

```python
#!/usr/bin/env python3
"""
test_yearpick.py — offline tests for the frozen ERA5 sample-year criterion.

No pytest in the bake venv; standalone-assert convention (see test_events.py).
Fully offline: synthetic fields only, no .nc reads, no network, and the
criterion JSON is read from the repository.

The legacy profile must reproduce the Arabian-Sea-era picks BIT-IDENTICALLY,
because Phase 6 uses it to prove that growing the grid changed registration and
nothing else. The oracle below is a verbatim copy of bake/era5.py as shipped on
2026-08-10; if it ever needs editing to make a test pass, the refactor is wrong.

Run:  node bake/run-python.mjs bake/test_yearpick.py
"""

from __future__ import annotations

import numpy as np

import yearpick

LEGACY_GENESIS_BELT_LAT_MAX = 19.0
LEGACY_CALM_BELT_SHEAR_MS = 13.0


def _legacy_belt_shear_per_year(shear_y: np.ndarray, lat: np.ndarray) -> np.ndarray:
    mask = lat <= LEGACY_GENESIS_BELT_LAT_MAX
    if not mask.any():
        mask = np.ones_like(lat, dtype=bool)
    return shear_y[:, mask, :].mean(axis=(1, 2))


def _legacy_pick_sample_years(u_y, v_y, shear_y, lat, k):
    n = u_y.shape[0]
    flat = np.concatenate([u_y.reshape(n, -1), v_y.reshape(n, -1)], axis=1)
    mean = flat.mean(axis=0, keepdims=True)
    picks = [int(np.argmin(np.linalg.norm(flat - mean, axis=1)))]
    while len(picks) < min(k, n):
        dmin = np.min(
            np.stack([np.linalg.norm(flat - flat[p][None, :], axis=1) for p in picks]),
            axis=0,
        )
        dmin[picks] = -1.0
        picks.append(int(np.argmax(dmin)))
    if len(picks) > 1:
        belt = _legacy_belt_shear_per_year(shear_y, lat)
        calmest = int(np.argmin(belt))
        picked_floor = min(float(belt[p]) for p in picks)
        if (
            float(belt[calmest]) < LEGACY_CALM_BELT_SHEAR_MS
            and picked_floor >= LEGACY_CALM_BELT_SHEAR_MS
            and calmest not in picks
        ):
            picks[-1] = calmest
    return picks


def _legacy_rescue(years, shear_y, humidity_y, lat, picks):
    belt = lat <= LEGACY_GENESIS_BELT_LAT_MAX
    shear_mean = shear_y[:, belt, :].mean(axis=(1, 2))
    humidity_mean = humidity_y[:, belt, :].mean(axis=(1, 2))
    viable = [i for i in range(len(years)) if float(shear_mean[i]) < 17.0]
    viable.sort(
        key=lambda i: (-float(humidity_mean[i]), float(shear_mean[i]), int(years[i]))
    )
    rescued = viable[: min(2, len(viable))]
    if len(rescued) < 2 or len(picks) < 2:
        return picks
    head = [i for i in picks if i not in rescued][: len(picks) - 2]
    for i in picks:
        if len(head) >= len(picks) - 2:
            break
        if i not in head and i not in rescued:
            head.append(i)
    return head + rescued


def _synthetic(seed: int, n_years: int, ny: int, nx: int, shear_lo: float, shear_hi: float):
    rng = np.random.default_rng(seed)
    u_y = rng.normal(0.0, 5.0, (n_years, ny, nx))
    v_y = rng.normal(0.0, 5.0, (n_years, ny, nx))
    shear_y = rng.uniform(shear_lo, shear_hi, (n_years, ny, nx))
    humidity_y = rng.uniform(20.0, 80.0, (n_years, ny, nx))
    return u_y, v_y, shear_y, humidity_y


def test_legacy_profile_is_bit_identical_to_the_shipped_rule() -> None:
    legacy = yearpick.load_criterion()["profiles"]["legacy"]
    lat = np.linspace(15.25, 26.75, 24)  # the shipped 0.5 deg env rows
    for seed, lo, hi in ((1, 8.0, 22.0), (2, 14.0, 25.0), (3, 5.0, 12.0)):
        u_y, v_y, shear_y, _rh = _synthetic(seed, 30, lat.size, 40, lo, hi)
        mine = yearpick.pick_years(u_y, v_y, shear_y, lat, legacy, month=5)
        theirs = _legacy_pick_sample_years(u_y, v_y, shear_y, lat, 4)
        assert mine == theirs, (seed, mine, theirs)
        belt_mine = yearpick.belt_mean(shear_y, lat, legacy)
        belt_theirs = _legacy_belt_shear_per_year(shear_y, lat)
        assert np.array_equal(belt_mine, belt_theirs), seed


def test_legacy_thermodynamic_rescue_is_bit_identical() -> None:
    legacy = yearpick.load_criterion()["profiles"]["legacy"]
    lat = np.linspace(15.25, 26.75, 24)
    years = np.arange(1991, 2021)
    for seed, lo, hi in ((4, 8.0, 22.0), (5, 16.5, 25.0)):
        u_y, v_y, shear_y, humidity_y = _synthetic(seed, 30, lat.size, 40, lo, hi)
        picks = yearpick.pick_years(u_y, v_y, shear_y, lat, legacy, month=10)
        mine, fallback = yearpick.thermodynamic_rescue(
            years, shear_y, humidity_y, lat, picks, legacy
        )
        theirs = _legacy_rescue(years, shear_y, humidity_y, lat, list(picks))
        assert mine == theirs, (seed, mine, theirs)
        assert fallback is False, seed


def test_nio_belt_is_two_sided_and_area_weighted() -> None:
    nio = yearpick.load_criterion()["profiles"]["nio-v1"]
    lat = np.array([2.0, 10.0, 20.0])  # below the floor, inside, above the ceiling
    shear_y = np.zeros((1, 3, 1))
    shear_y[0, 0, 0] = 100.0  # 2 N: excluded by the 5 N floor
    shear_y[0, 1, 0] = 7.0    # 10 N: the only row inside 5-19 N
    shear_y[0, 2, 0] = 100.0  # 20 N: excluded by the 19 N ceiling
    assert abs(float(yearpick.belt_mean(shear_y, lat, nio)[0]) - 7.0) < 1e-12
    # The legacy one-sided belt would have averaged the 2 N row in.
    legacy = yearpick.load_criterion()["profiles"]["legacy"]
    assert float(yearpick.belt_mean(shear_y, lat, legacy)[0]) > 50.0


def test_cos_weighting_pulls_the_mean_toward_low_latitudes() -> None:
    nio = yearpick.load_criterion()["profiles"]["nio-v1"]
    lat = np.array([5.0, 15.0])
    shear_y = np.array([[[40.0], [30.0]]])  # 5 N = 40, 15 N = 30
    w5, w15 = np.cos(np.deg2rad(5.0)), np.cos(np.deg2rad(15.0))
    expected = (40.0 * w5 + 30.0 * w15) / (w5 + w15)
    assert abs(float(yearpick.belt_mean(shear_y, lat, nio)[0]) - expected) < 1e-12
    assert expected > 35.0  # unweighted would be exactly 35.0


def test_missing_band_raises_instead_of_silently_widening() -> None:
    nio = yearpick.load_criterion()["profiles"]["nio-v1"]
    lat = np.array([28.0, 29.0])  # entirely above the 19 N belt ceiling
    try:
        yearpick.belt_mean(np.zeros((1, 2, 1)), lat, nio)
    except ValueError as err:
        assert "selects no row" in str(err), str(err)
    else:
        raise AssertionError("an empty latitude band must raise, not widen")


def test_rescue_fallback_reports_itself_when_no_year_is_viable() -> None:
    nio = yearpick.load_criterion()["profiles"]["nio-v1"]
    lat = np.linspace(5.25, 18.75, 14)
    years = np.arange(1991, 2021)
    u_y, v_y, _s, humidity_y = _synthetic(9, 30, lat.size, 40, 8.0, 22.0)
    shear_y = np.full((30, lat.size, 40), 25.0)  # every year above the 17 m/s cut
    picks = yearpick.pick_years(u_y, v_y, shear_y, lat, nio, month=10)
    rescued, fallback = yearpick.thermodynamic_rescue(
        years, shear_y, humidity_y, lat, picks, nio
    )
    assert fallback is True
    assert len(rescued) == len(picks)
    assert len(set(rescued)) == len(rescued)


def test_rescue_month_list_covers_december() -> None:
    nio = yearpick.load_criterion()["profiles"]["nio-v1"]
    assert nio["thermodynamicRescue"]["months"] == [9, 10, 11]
    assert yearpick.load_criterion()["profiles"]["legacy"][
        "thermodynamicRescue"
    ]["months"] == [10]


def test_missing_criterion_file_is_fatal() -> None:
    try:
        yearpick.load_criterion("bake/does-not-exist.json")
    except FileNotFoundError as err:
        assert "no fallback rule" in str(err), str(err)
    else:
        raise AssertionError("a missing criterion must be fatal, not defaulted")


def main() -> int:
    tests = [
        test_legacy_profile_is_bit_identical_to_the_shipped_rule,
        test_legacy_thermodynamic_rescue_is_bit_identical,
        test_nio_belt_is_two_sided_and_area_weighted,
        test_cos_weighting_pulls_the_mean_toward_low_latitudes,
        test_missing_band_raises_instead_of_silently_widening,
        test_rescue_fallback_reports_itself_when_no_year_is_viable,
        test_rescue_month_list_covers_december,
        test_missing_criterion_file_is_fatal,
    ]
    for t in tests:
        t()
        print(f"[PASS] {t.__name__}")
    print(f"[done] {len(tests)} year-pick criterion tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Run it:
```powershell
node bake/run-python.mjs bake/test_yearpick.py
```

*Expected:* `ModuleNotFoundError: No module named 'yearpick'` — `bake/yearpick.py` does not exist yet.

- [ ] **Step 2: Write bake/yearpick.py**

Create `bake/yearpick.py`:

```python
"""yearpick.py — THE ERA5 sample-year selection criterion, executed.

The RULE lives in calibration/era5-yearpick-criterion.json and nowhere else.
This module only runs it. bake/era5.py holds no selection constant of its own,
so changing how a year is picked means editing the frozen criterion file, which
test/era5-yearpick-criterion.test.ts pins by SHA-256 and by value.

Two profiles:
  legacy  — reproduces the Arabian-Sea-era picks BIT-IDENTICALLY. Phase 6 uses
            it to prove that growing the grid changed registration and nothing
            else. bake/test_yearpick.py holds the verbatim oracle.
  nio-v1  — the basin-wide criterion, frozen before any pick was seen.

Bit-identity is not an accident of arithmetic: every code path branches so the
legacy profile executes the same numpy calls, in the same order, on the same
slices as the shipped code did. Do not "simplify" the branches away.
"""

from __future__ import annotations

import json
import os

import numpy as np

CRITERION_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "calibration",
    "era5-yearpick-criterion.json",
)

_criterion: dict | None = None


def load_criterion(path: str | None = None) -> dict:
    """Parse the frozen criterion. A missing file is fatal: the bake must never
    fall back to a built-in rule, because a built-in rule is an unfrozen one."""
    global _criterion
    if path is None and _criterion is not None:
        return _criterion
    target = path or CRITERION_PATH
    if not os.path.exists(target):
        raise FileNotFoundError(
            f"frozen year-pick criterion missing: {target}; the bake has "
            "no fallback rule"
        )
    with open(target, "r", encoding="utf-8") as handle:
        parsed = json.load(handle)
    if path is None:
        _criterion = parsed
    return parsed


def active_profile(criterion: dict | None = None) -> dict:
    c = criterion if criterion is not None else load_criterion()
    name = c["activeProfile"]
    if name not in c["profiles"]:
        raise ValueError(f"activeProfile {name!r} is not a declared profile")
    return c["profiles"][name]


def _band(lat: np.ndarray, lat_min, lat_max, cos_weighted: bool):
    """(row mask, per-row cos weights or None). An empty band RAISES: silently
    widening it is the class of failure the design's section 3.5 closes."""
    mask = np.ones_like(lat, dtype=bool)
    if lat_min is not None:
        mask &= lat >= lat_min
    if lat_max is not None:
        mask &= lat <= lat_max
    if not mask.any():
        raise ValueError(
            f"latitude band [{lat_min}, {lat_max}] selects no row of the ERA5 "
            f"grid ({float(lat.min())}..{float(lat.max())}); the criterion and "
            "the fetch extent disagree"
        )
    if not cos_weighted:
        return mask, None
    return mask, np.cos(np.deg2rad(lat[mask]))


def belt_mean(field_y: np.ndarray, lat: np.ndarray, profile: dict) -> np.ndarray:
    """Per-year genesis-belt mean of field_y[year, row, col]."""
    belt = profile["belt"]
    mask, w = _band(lat, belt["latMinDeg"], belt["latMaxDeg"], belt["cosLatWeighted"])
    sub = field_y[:, mask, :]
    if w is None:
        # Identical call to the shipped code: shear_y[:, mask, :].mean((1, 2)).
        return sub.mean(axis=(1, 2))
    weights = w[None, :, None]
    return (sub * weights).sum(axis=(1, 2)) / (float(w.sum()) * sub.shape[2])


def _diversity_matrix(u_y, v_y, lat, profile) -> np.ndarray:
    """One row per year. cos(lat) enters as sqrt(w) so a plain L2 norm over the
    rows IS the area-weighted RMS distance."""
    d = profile["diversity"]
    n = u_y.shape[0]
    mask, w = _band(lat, d["latBandMinDeg"], d["latBandMaxDeg"], d["cosLatWeighted"])
    if bool(mask.all()) and w is None:
        # Identical call to the shipped code.
        return np.concatenate([u_y.reshape(n, -1), v_y.reshape(n, -1)], axis=1)
    us, vs = u_y[:, mask, :], v_y[:, mask, :]
    if w is not None:
        scale = np.sqrt(w)[None, :, None]
        us, vs = us * scale, vs * scale
    return np.concatenate([us.reshape(n, -1), vs.reshape(n, -1)], axis=1)


def pick_years(
    u_y: np.ndarray,
    v_y: np.ndarray,
    shear_y: np.ndarray,
    lat: np.ndarray,
    profile: dict,
    month: int | None = None,
) -> list[int]:
    """Indices of k diverse-but-real years: most-typical seed, then greedy
    farthest-point, then the calm-belt swap of the least-typical pick."""
    k = int(profile["samplesPerMonth"])
    n = u_y.shape[0]
    flat = _diversity_matrix(u_y, v_y, lat, profile)
    mean = flat.mean(axis=0, keepdims=True)
    picks = [int(np.argmin(np.linalg.norm(flat - mean, axis=1)))]
    while len(picks) < min(k, n):
        dmin = np.min(
            np.stack([np.linalg.norm(flat - flat[p][None, :], axis=1) for p in picks]),
            axis=0,
        )
        dmin[picks] = -1.0
        picks.append(int(np.argmax(dmin)))
    calm = profile["calmRescue"]
    gated = month is None or int(month) in calm["months"]
    if calm["enabled"] and gated and len(picks) > 1:
        belt = belt_mean(shear_y, lat, profile)
        calmest = int(np.argmin(belt))
        picked_floor = min(float(belt[p]) for p in picks)
        limit = float(calm["calmBeltShearMs"])
        if (
            float(belt[calmest]) < limit
            and picked_floor >= limit
            and calmest not in picks
        ):
            picks[-1] = calmest
    return picks


def thermodynamic_rescue(
    years: np.ndarray,
    shear_y: np.ndarray,
    humidity_y: np.ndarray,
    lat: np.ndarray,
    picks: list[int],
    profile: dict,
) -> tuple[list[int], bool]:
    """Replace the tail planes with the moistest real years that also clear the
    viability shear cut. Returns (picks, used_fallback)."""
    rescue = profile["thermodynamicRescue"]
    tail = int(rescue["tailPlanes"])
    shear_mean = belt_mean(shear_y, lat, profile)
    humidity_mean = belt_mean(humidity_y, lat, profile)
    limit = float(rescue["viabilityBeltShearMs"])
    viable = [i for i in range(len(years)) if float(shear_mean[i]) < limit]
    used_fallback = False
    if (
        len(viable) < tail
        and rescue["fallbackWhenFewerThanTwoViable"] == "lowest-belt-shear"
    ):
        viable = sorted(range(len(years)), key=lambda i: float(shear_mean[i]))[:tail]
        used_fallback = True
    viable.sort(
        key=lambda i: (
            -float(humidity_mean[i]),
            float(shear_mean[i]),
            int(years[i]),
        )
    )
    rescued = viable[: min(tail, len(viable))]
    if len(rescued) < tail or len(picks) < tail:
        return list(picks), used_fallback
    head = [i for i in picks if i not in rescued][: len(picks) - tail]
    for i in picks:
        if len(head) >= len(picks) - tail:
            break
        if i not in head and i not in rescued:
            head.append(i)
    return head + rescued, used_fallback
```

Run:
```powershell
node bake/run-python.mjs bake/test_yearpick.py
```

*Expected:* Eight `[PASS] test_...` lines and `[done] 8 year-pick criterion tests passed`, exit 0. The two `_bit_identical` tests are the load-bearing ones: if either fails, the refactor changed the legacy rule and Phase 6's registration proof is dead.

- [ ] **Step 3: Rewire bake/era5.py onto the criterion**

Four edits to `bake/era5.py`.

**(a)** Replace lines 33-49 (the `SAMPLES_PER_MONTH` block through `CALM_BELT_SHEAR_MS`) with:
```python
# D10 remedy (spike FAILed on monthly means: keep-ratio 16% in June): ship K
# distinct real YEARS per month as nt planes instead of the 30-year mean. The
# runtime picks a plane per spawn from the seed, so same-spot re-spawns feel
# genuinely different synoptic regimes while sim = f(spawn, month, seed) holds.
#
# K, the genesis belt, the calm-shear absolute and the post-monsoon rescue are
# NO LONGER constants here. They are the frozen criterion in
# calibration/era5-yearpick-criterion.json, executed by bake/yearpick.py. That
# is deliberate: a selection rule that lives in the bake can be edited after a
# pick is seen, and this one cannot.


def samples_per_month() -> int:
    """K, from the frozen criterion's active profile."""
    return int(yearpick.active_profile()["samplesPerMonth"])
```
Add `import yearpick` to the import block at line 25 (after `import numpy as np`).

**(b)** Delete `_belt_shear_per_year` entirely (lines 222-231) and `_pick_sample_years` entirely (lines 234-269). Their bodies now live in `bake/yearpick.py`.

**(c)** Delete `_post_monsoon_thermodynamic_rescue` entirely (lines 272-319).

**(d)** Replace `_month_pick_indices` (lines 335-349) with:
```python
# month -> True when the thermodynamic rescue fell back because no real year
# cleared the viability cut. Phase 7's record artifact publishes this.
_rescue_fallback: dict[int, bool] = {}


def _month_pick_indices(month: int) -> list[int]:
    """Deterministic per-month sample-year indices, cached so every extractor
    (steering/shear, RH pairing via bake.py, absolute 200-hPa winds) sees the
    IDENTICAL pick order. Plane k of every layer is the same real year.

    The rule is the frozen criterion; this function only routes data into it.
    """
    _load()
    assert _yearly is not None and _axes is not None
    cached = _picks.get(month)
    if cached is not None:
        return list(cached)  # copy: a caller mutation must not poison alignment
    profile = yearpick.active_profile()
    lat, _lon = _axes
    yr, u_y, v_y, shear_y, _su, _sv, _u200, _v200 = _yearly[month]
    idx = yearpick.pick_years(u_y, v_y, shear_y, lat, profile, month=month)
    rescue = profile["thermodynamicRescue"]
    if rescue["enabled"] and int(month) in rescue["months"]:
        import era5_humidity

        era5_humidity._load()
        assert era5_humidity._yearly is not None
        humidity_years, humidity_y = era5_humidity._yearly[month]
        if not np.array_equal(humidity_years, yr):
            raise ValueError(
                f"month {month} ERA5 wind and RH years are not aligned"
            )
        idx, fallback = yearpick.thermodynamic_rescue(
            yr, shear_y, humidity_y, lat, idx, profile
        )
        _rescue_fallback[month] = fallback
    _picks[month] = list(idx)
    return list(idx)
```

Also update the module docstring's line 12-13 reference so it no longer promises constants that moved.

*Expected:* `node -e "1"` is irrelevant here; instead run `node bake/run-python.mjs -c "import era5; print(era5.samples_per_month())"`. If `run-python.mjs` does not accept `-c`, run `node bake/run-python.mjs bake/test_upper.py` (next step) — it imports `era5` and will surface any syntax or name error immediately.

- [ ] **Step 4: Make the upper-sidecar fixture survive both profiles, then run both python suites**

`bake/test_upper.py:86` injects `lat = np.array([0.0, 1.0, 2.0])`. Under the `nio-v1` profile every one of those rows is below the 5 °N belt floor, so `_band` would raise and the fixture would break at Phase 7. Change line 86 from:
```python
    lat = np.array([0.0, 1.0, 2.0])
```
to:
```python
    # Inside the 5-19 N genesis belt so the fixture survives BOTH year-pick
    # profiles (calibration/era5-yearpick-criterion.json). Under the legacy
    # profile all three rows are still <= 19 N, so the picks are unchanged.
    lat = np.array([6.0, 12.0, 18.0])
```

And fix the now-stale comment at `bake/realism_env_variance.py:32`, from:
```python
BELT_LAT_MAX = 19.0  # genesis belt, mirrors bake/era5.py GENESIS_BELT_LAT_MAX
```
to:
```python
# Genesis belt for the R1 env-variance study. Deliberately NOT unified with
# calibration/era5-yearpick-criterion.json: this statistic stays one-sided and
# unweighted so the committed R1 outputs do not drift when the criterion moves.
BELT_LAT_MAX = 19.0
```

Run both:
```powershell
node bake/run-python.mjs bake/test_yearpick.py
node bake/run-python.mjs bake/test_upper.py
```

*Expected:* `test_yearpick.py`: 8 PASS lines, exit 0. `test_upper.py`: 7 PASS lines ending `[done] 7 upper-sidecar tests passed`, exit 0 — including `[PASS] test_upper_planes_align_with_steering_picks`, which exercises `era5._month_pick_indices(5)` through the new code path.

- [ ] **Step 5: Document the new modules and run the full gate**

Add to `bake/README.md`, immediately after the existing `test_upper.py` paragraph (around line 244):

```markdown
`yearpick.py` executes the frozen ERA5 sample-year criterion in
`calibration/era5-yearpick-criterion.json`. `bake/era5.py` holds no selection
constant of its own: K, the genesis belt, the calm-shear absolute and the
post-monsoon rescue all come from that file. The criterion is created once and
never amended — `test/era5-yearpick-criterion.test.ts` pins its SHA-256, and
`test_yearpick.py` is the offline standalone test
(`node bake/run-python.mjs bake/test_yearpick.py`), whose two
`_bit_identical` cases prove the `legacy` profile reproduces the
Arabian-Sea-era picks exactly.
```

Then:
```powershell
npm test
npm run calibrate:check
npm run build
git status --porcelain calibration docs public/data
```

*Expected:* `npm test` fully green. `npm run calibrate:check` green. `npm run build` green. `git status --porcelain calibration docs public/data` prints NOTHING — no baked byte moved, because nothing was rebaked.

- [ ] **Step 6: Commit**

```powershell
git add bake/yearpick.py bake/test_yearpick.py bake/era5.py bake/test_upper.py bake/realism_env_variance.py bake/README.md
git commit -m "refactor: drive ERA5 year picks from the frozen criterion"
```

*Expected:* One commit. `git show --stat HEAD` lists exactly six files; `bake/era5.py` shows more deletions than insertions (three functions and three constants removed).

---

### Task 26: Add the pre-registered belt-shear statistic as a tested helper

**Files:**

```
Create: D:\personal\wallah-its-windy\test\helpers\env-belt.ts
Test: D:\personal\wallah-its-windy\test\env-belt.test.ts
```

**Consumes:** `buildWiwbBin` and `WiwbLayerInput` from `test/helpers/wiwb.ts` (already in the repo). `parseBin` from `src/loader.ts`. `cellToLatLon` from `src/grid.ts`. The belt geometry shape (`latMinDeg`, `latMaxDeg`, `cosLatWeighted`) defined by Task 2's criterion file.

**Produces:** `test/helpers/env-belt.ts` exporting `interface BeltGeometry { latMinDeg: number | null; latMaxDeg: number | null; cosLatWeighted: boolean }` and `beltMeanForPlane(layer: BinLayer, plane: number, belt: BeltGeometry): number`. Task 5's replacement integration test imports both by those exact names.

- [ ] **Step 1: Write the failing unit test**

Create `test/env-belt.test.ts`:

```ts
/**
 * env-belt.test.ts — arithmetic guard for the genesis-belt shear statistic.
 *
 * The statistic is the ONE number the pre-registered post-monsoon bake guard
 * compares against the frozen criterion's calmBeltShearMs. It must mean the
 * same thing in the browser test as in bake/yearpick.py: a two-sided,
 * area-weighted mean over the genesis belt. This file pins the arithmetic on
 * synthetic bins, so the integration guard's numbers can be trusted before any
 * basin-wide env.bin exists.
 */

import { describe, expect, it } from 'vitest';
import { parseBin } from '../src/loader';
import { buildWiwbBin } from './helpers/wiwb';
import { beltMeanForPlane } from './helpers/env-belt';
import type { BinLayer } from '../src/types';

/**
 * One column, four rows over 0-40 N. Row centres north to south are
 * 35, 25, 15, 5 degrees, so the 5-19 N belt selects exactly the last two rows.
 */
function fixture(): BinLayer {
  const data = Float32Array.from([
    10, 20, 30, 40, // plane 0, rows 35 N, 25 N, 15 N, 5 N
    1, 2, 3, 4,     // plane 1
  ]);
  const bin = parseBin(
    buildWiwbBin([
      {
        name: 'shr_10',
        nx: 1,
        ny: 4,
        nt: 2,
        bbox: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 40 },
        data,
      },
    ]),
  );
  return bin.layers.get('shr_10')!;
}

describe('genesis-belt mean', () => {
  const layer = fixture();

  it('selects only rows inside a two-sided band', () => {
    expect(
      beltMeanForPlane(layer, 0, { latMinDeg: 5, latMaxDeg: 19, cosLatWeighted: false }),
    ).toBe(35); // (30 + 40) / 2 — the 35 N and 25 N rows are excluded
    expect(
      beltMeanForPlane(layer, 1, { latMinDeg: 5, latMaxDeg: 19, cosLatWeighted: false }),
    ).toBe(3.5);
  });

  it('a one-sided band admits everything below the ceiling', () => {
    // This is the legacy behaviour, and the exact reason the belt gained a floor.
    expect(
      beltMeanForPlane(layer, 0, { latMinDeg: null, latMaxDeg: 19, cosLatWeighted: false }),
    ).toBe(35);
    expect(
      beltMeanForPlane(layer, 0, { latMinDeg: null, latMaxDeg: 90, cosLatWeighted: false }),
    ).toBe(25); // all four rows
  });

  it('weights by cos(lat) so a lat/lon grid is not mistaken for an equal-area one', () => {
    const weighted = beltMeanForPlane(layer, 0, {
      latMinDeg: 5,
      latMaxDeg: 19,
      cosLatWeighted: true,
    });
    // cos(15 deg) = 0.9659258262890683, cos(5 deg) = 0.9961946980917455.
    expect(weighted).toBeCloseTo(35.077133059428725, 12);
    expect(weighted).toBeGreaterThan(35); // pulled toward the larger low-lat cell
    expect(
      beltMeanForPlane(layer, 1, { latMinDeg: 5, latMaxDeg: 19, cosLatWeighted: true }),
    ).toBeCloseTo(3.5077133059428722, 12);
  });

  it('rejects an empty band instead of silently widening it', () => {
    expect(() =>
      beltMeanForPlane(layer, 0, { latMinDeg: 50, latMaxDeg: 60, cosLatWeighted: true }),
    ).toThrow(/selects no row/);
  });

  it('rejects a plane index outside the layer', () => {
    expect(() =>
      beltMeanForPlane(layer, 2, { latMinDeg: 5, latMaxDeg: 19, cosLatWeighted: false }),
    ).toThrow(/plane 2/);
  });
});
```

Run:
```powershell
npx vitest run test/env-belt.test.ts
```

*Expected:* The run fails to collect the file with `Failed to load url ./helpers/env-belt` (or `Cannot find module './helpers/env-belt'`) — the helper does not exist yet.

- [ ] **Step 2: Write the helper**

Create `test/helpers/env-belt.ts`:

```ts
/**
 * env-belt.ts — the genesis-belt mean of one plane of a baked env layer.
 *
 * Mirrors bake/yearpick.py belt_mean: a two-sided, optionally cos(lat)-weighted
 * mean over the belt rows. Geometry comes from the caller (in practice from
 * calibration/era5-yearpick-criterion.json), never from a literal here, so the
 * test cannot drift from the frozen criterion.
 *
 * Row geometry is read from the LAYER's own header through cellToLatLon, so
 * this works unchanged at 40x24 on the Arabian Sea box and at 110x60 on the
 * northern Indian Ocean box. It hardcodes no grid.
 */

import { cellToLatLon } from '../../src/grid';
import type { BinLayer } from '../../src/types';

export interface BeltGeometry {
  /** Southern edge in degrees north; null means unbounded below. */
  latMinDeg: number | null;
  /** Northern edge in degrees north; null means unbounded above. */
  latMaxDeg: number | null;
  /** Weight each row by cos(lat) so the mean is an area mean. */
  cosLatWeighted: boolean;
}

export function beltMeanForPlane(
  layer: BinLayer,
  plane: number,
  belt: BeltGeometry,
): number {
  if (!Number.isInteger(plane) || plane < 0 || plane >= layer.nt) {
    throw new Error(`beltMeanForPlane: plane ${plane} outside [0, ${layer.nt})`);
  }
  const spec = { nx: layer.nx, ny: layer.ny, bbox: layer.bbox };
  let sum = 0;
  let weight = 0;
  for (let row = 0; row < layer.ny; row++) {
    const { lat } = cellToLatLon(spec, 0, row);
    if (belt.latMinDeg !== null && lat < belt.latMinDeg) continue;
    if (belt.latMaxDeg !== null && lat > belt.latMaxDeg) continue;
    const w = belt.cosLatWeighted ? Math.cos((lat * Math.PI) / 180) : 1;
    const base = (plane * layer.ny + row) * layer.nx;
    for (let col = 0; col < layer.nx; col++) {
      sum += layer.data[base + col] * w;
      weight += w;
    }
  }
  if (weight === 0) {
    throw new Error(
      `beltMeanForPlane: band [${belt.latMinDeg}, ${belt.latMaxDeg}] selects no row ` +
        `of a ${layer.nx}x${layer.ny} layer spanning ` +
        `${layer.bbox.latMin}..${layer.bbox.latMax} N`,
    );
  }
  return sum / weight;
}
```

Run:
```powershell
npx vitest run test/env-belt.test.ts
```

*Expected:* `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 3: Typecheck and commit**

```powershell
npm run build
git add test/helpers/env-belt.ts test/env-belt.test.ts
git commit -m "test: add the pre-registered env belt-shear statistic"
```

*Expected:* `npm run build` exits 0 with no TypeScript error. One commit created.

---

### Task 27: Replace the November bake guard with a pre-registered, header-branched block

**Files:**

```
Modify: D:\personal\wallah-its-windy\test\integration-bins.test.ts:325-397 (the whole `describe('November post-monsoon rescue (C6)')` block)
```

**Consumes:** `beltMeanForPlane` and `BeltGeometry` from Task 4's `test/helpers/env-belt.ts`. `calibration/era5-yearpick-criterion.json` (`profiles['nio-v1'].belt`, `profiles['nio-v1'].calmRescue.calmBeltShearMs`) from Task 2. Existing imports already at the top of the file: `loadBin`, `nearest`, `nearestPlane`, `makeEnvSampler`, `envMonthSuffix`, `createSimEngine`, `SIM`, `DOMAIN`.

**Produces:** A `describe('post-monsoon bake guards')` block that branches on the shipped `env.bin` header. Nothing later consumes it.

- [ ] **Step 1: Read the block you are replacing and record why each number dies**

Read `test/integration-bins.test.ts:325-397` in full. Three numbers are at stake:

- `:350` — `expect(minBelt).toBeLessThan(SIM.SHEAR_THRESHOLD_MS);` where `minBelt` is the minimum over planes of the mean of `shr_10` sampled at every `genesis.json` point. Both inputs die: `genesis.json` is Oman-filtered (`GENESIS_BOX = (52, 62, 16, 26)` in `bake/sources.py:32`) and cannot represent the Bay of Bengal, and Phase 8 rebakes it anyway.
- `:392` — `expect(productivePlanes).toBeGreaterThanOrEqual(2);`
- `:393` — `expect(totalCat1 / totalStorms).toBeGreaterThanOrEqual(0.005);`

The comment at `:389-391` states outright where 0.005 came from: *"The thermodynamically coupled bake currently produces ~0.59% Cat-1 cases in this deliberately broad genesis sweep."* It is a number read off the old bake. Re-reading it off the new bake is retuning after scoring, and the assignment forbids it.

**Decision, recorded here:** `minBelt` survives, re-expressed against the frozen criterion — it is pre-registerable because Task 2 fixed `calmBeltShearMs = 13.0` before any pick was seen, derived from `SIM.SHEAR_THRESHOLD_MS`, not from data. The Cat-1 fraction and the productive-plane count **cannot** be pre-registered: they are emergent properties of physics crossed with new forcing over a 5.5x larger box with a new lifetime bound. They are replaced by structural assertions plus one first-principles floor of ONE storm reaching 34 kt, and the measured fraction is recorded in the ROADMAP break entry by Phase 10 rather than gated.

*Expected:* You can state, without looking again, that `0.005` and `>= 2` were read off the old bake and that nothing in the repository derives them.

- [ ] **Step 2: Replace the block**

Delete `test/integration-bins.test.ts` lines 325-397 inclusive (the entire `describe('November post-monsoon rescue (C6)', ...)`) and put this in its place. Add these imports to the top of the file (after the existing import at line 28):

```ts
import { beltMeanForPlane, type BeltGeometry } from './helpers/env-belt';
```

The replacement block:

```ts
describe('post-monsoon bake guards', () => {
  // WRITTEN 2026-08-10, BEFORE ANY BASIN-WIDE ERA5 WAS FETCHED.
  //
  // The old block (v1.1) pinned the November fizzle fix with three numbers read
  // off the shipped Arabian Sea bake: min genesis-belt shear < 14 m/s, Cat-1
  // fraction >= 0.005, and >= 2 productive planes. All three die at the domain
  // expansion: genesis.json is Oman-filtered and cannot represent the Bay of
  // Bengal, and the other two are emergent properties of physics crossed with
  // forcing that does not exist yet. Re-reading them off the new bake would be
  // retuning after scoring, so they are pre-registered here instead:
  //
  //   * the belt guard survives, re-expressed against the criterion frozen in
  //     calibration/era5-yearpick-criterion.json. Its calmBeltShearMs = 13.0 is
  //     derived from SIM.SHEAR_THRESHOLD_MS - 1, never from a basin sample, so
  //     asserting it is a check that the bake OBEYED the frozen rule. If it goes
  //     red on the real basin-wide bake, that is a published finding about the
  //     1991-2020 record. The threshold does not move.
  //   * productivity becomes STRUCTURAL (termination, determinism, distinct
  //     regimes, spawn points over water) plus one first-principles floor: at
  //     least ONE storm anywhere in the basin, across every plane and seed,
  //     reaches 34 kt in October, November or December. Justification: the
  //     sealed 39-storm basin-wide 2019-2024 dataset in calibration/results.json
  //     records 7 + 7 + 6 = 20 post-monsoon genesis events. A bake in which no
  //     post-monsoon spawn anywhere reaches tropical-storm force is broken. No
  //     stronger floor can be pre-registered without seeing the bake.
  //   * the measured Cat-1 fraction is printed, NOT asserted. Phase 10 records
  //     it in the ROADMAP break entry.
  //
  // The branch below is keyed on the shipped env.bin HEADER, not on a hand
  // toggle, so both arms are committed today and CI stays green across the
  // whole migration.

  const env = loadBin('env.bin');
  const terrain = loadBin('terrain.bin');
  const land = terrain.layers.get('landmask')!;
  const isLand = (lat: number, lon: number) => nearest(land, lat, lon) > 0.5;

  const probe = env.layers.get('shr_10')!;
  const isLegacyBake =
    probe.nx === 40 &&
    probe.ny === 24 &&
    probe.bbox.lonMin === 50 &&
    probe.bbox.lonMax === 70 &&
    probe.bbox.latMin === 15 &&
    probe.bbox.latMax === 27;

  const criterion = JSON.parse(
    readFileSync('calibration/era5-yearpick-criterion.json', 'utf8'),
  ) as {
    profiles: Record<
      string,
      {
        belt: BeltGeometry;
        calmRescue: { calmBeltShearMs: number };
        thermodynamicRescue: { months: number[] };
      }
    >;
  };
  const nio = criterion.profiles['nio-v1'];

  // Pre-registered spawn set: six open-water points chosen from basin geography
  // in both sub-basins, all inside the 5-19 N genesis belt. Deliberately NOT
  // genesis.json, which is Oman-filtered (bake/sources.py GENESIS_BOX) and is
  // rebaked by the domain flip.
  const POST_MONSOON_SPAWNS = [
    { lat: 12.0, lon: 66.0 }, // south-central Arabian Sea
    { lat: 16.5, lon: 61.0 }, // Arabian Sea off Oman
    { lat: 7.0, lon: 75.0 }, // Lakshadweep sector
    { lat: 9.0, lon: 85.0 }, // southern Bay of Bengal
    { lat: 13.0, lon: 88.0 }, // central Bay of Bengal
    { lat: 17.0, lon: 90.0 }, // northern Bay of Bengal
  ] as const;
  const SEEDS = [0, 1, 2] as const;
  const TICK_BUDGET = 1600; // 400 sim-hours at 15 min/tick, above any MAX_AGE_H

  if (isLegacyBake) {
    // ------------------------------------------------------------------
    // Arabian Sea bake: the v1.1 guards, unchanged, so today's coverage is
    // preserved byte-for-byte until Phase 10 ships the basin-wide bins.
    // ------------------------------------------------------------------
    const gen = JSON.parse(
      readFileSync(`${DATA_DIR}/genesis.json`, 'utf8'),
    ) as Array<{ lat: number; lon: number }>;
    const shr = env.layers.get('shr_10')!;

    function genesisBeltShear(plane: number): number {
      let sum = 0;
      for (const g of gen) sum += nearestPlane(shr, g.lat, g.lon, plane);
      return sum / gen.length;
    }

    it('at least one shr_10 plane is calm enough in the genesis belt to survive', () => {
      let minBelt = Infinity;
      for (let p = 0; p < shr.nt; p++) minBelt = Math.min(minBelt, genesisBeltShear(p));
      expect(minBelt).toBeLessThan(SIM.SHEAR_THRESHOLD_MS);
    });

    it('November produces Cat-1 storms across more than one plane in aggregate', () => {
      const sampler = makeEnvSampler(() => env);
      let totalCat1 = 0;
      let totalStorms = 0;
      let productivePlanes = 0;
      for (let plane = 0; plane < shr.nt; plane++) {
        sampler.setSamplingMode({ kind: 'synoptic-plane', plane });
        let planeCat1 = 0;
        for (const g of gen) {
          for (const seed of [0, 1, 2]) {
            const engine = createSimEngine({ env: sampler, isLand });
            engine.spawn({ lat: g.lat, lon: g.lon, monthIndex: 10, seed, isDemo: false });
            let peak = 0;
            for (let i = 0; i < 4000; i++) {
              engine.tick(15);
              const s = engine.getState()!;
              peak = Math.max(peak, s.vKt);
              if (!s.alive) break;
            }
            if (peak >= 64) planeCat1++;
            totalStorms++;
          }
        }
        totalCat1 += planeCat1;
        if (planeCat1 > 0) productivePlanes++;
      }
      sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
      expect(productivePlanes).toBeGreaterThanOrEqual(2);
      expect(totalCat1 / totalStorms).toBeGreaterThanOrEqual(0.005);
    }, 60_000);
  } else {
    // ------------------------------------------------------------------
    // Basin-wide bake: the pre-registered guards.
    // ------------------------------------------------------------------
    it('resolves a real plane for every month, December included', () => {
      for (let m = 0; m < 12; m++) {
        const mm = `${m}`.padStart(2, '0');
        for (const field of ['sst', 'u', 'v', 'shr', 'shu', 'shv', 'rh', 'ohc']) {
          expect(env.layers.get(`${field}_${mm}`), `${field}_${mm}`).toBeDefined();
        }
      }
    });

    it('every pre-registered spawn point is over water', () => {
      // Also a domain-registration guard: a mis-registered terrain.bin puts
      // open ocean on land and this fails loudly instead of producing a basin
      // of instant deaths that the productivity floor would blame on physics.
      for (const s of POST_MONSOON_SPAWNS) {
        expect(isLand(s.lat, s.lon), `${s.lat}N ${s.lon}E`).toBe(false);
      }
    });

    it('each post-monsoon month ships a plane inside the frozen calm-shear bound', () => {
      // Not an independently invented number: calmBeltShearMs was frozen in
      // calibration/era5-yearpick-criterion.json on 2026-08-10, before any pick
      // existed, as SIM.SHEAR_THRESHOLD_MS - 1. This asserts the bake obeyed it.
      expect(nio.calmRescue.calmBeltShearMs).toBe(SIM.SHEAR_THRESHOLD_MS - 1);
      for (const month of nio.thermodynamicRescue.months) {
        const mm = `${month}`.padStart(2, '0');
        const shr = env.layers.get(`shr_${mm}`)!;
        let minBelt = Infinity;
        for (let p = 0; p < shr.nt; p++) {
          minBelt = Math.min(minBelt, beltMeanForPlane(shr, p, nio.belt));
        }
        expect(minBelt, `shr_${mm} min belt mean`).toBeLessThan(
          nio.calmRescue.calmBeltShearMs,
        );
      }
    });

    it('every post-monsoon storm terminates, replays identically, and the season is not dead', () => {
      const sampler = makeEnvSampler(() => env);
      let reached34 = 0;
      let cat1 = 0;
      let runs = 0;
      const peaksByPlane = new Map<number, number[]>();

      for (const month of nio.thermodynamicRescue.months) {
        const mm = `${month}`.padStart(2, '0');
        const planes = env.layers.get(`shr_${mm}`)!.nt;
        for (let plane = 0; plane < planes; plane++) {
          sampler.setSamplingMode({ kind: 'synoptic-plane', plane });
          const peaks: number[] = [];
          for (const s of POST_MONSOON_SPAWNS) {
            for (const seed of SEEDS) {
              const engine = createSimEngine({ env: sampler, isLand });
              engine.spawn({
                lat: s.lat,
                lon: s.lon,
                monthIndex: month,
                seed,
                isDemo: false,
              });
              let peak = 0;
              let ticks = 0;
              let state = engine.getState()!;
              while (state.alive && ticks < TICK_BUDGET) {
                engine.tick(15);
                state = engine.getState()!;
                expect(Number.isFinite(state.vKt), `${s.lat}N ${s.lon}E m${month}`).toBe(true);
                peak = Math.max(peak, state.vKt);
                ticks++;
              }
              // STRUCTURAL: the domain-exit test is no longer the only lifetime
              // bound at basin scale, so a storm that never dies is the real
              // regression risk here (design section 3.2).
              expect(state.alive, `${s.lat}N ${s.lon}E m${month} p${plane} s${seed}`).toBe(false);
              peaks.push(peak);
              if (peak >= 34) reached34++;
              if (peak >= 64) cat1++;
              runs++;
            }
          }
          peaksByPlane.set(month * 100 + plane, peaks);
        }
      }

      // STRUCTURAL: replaying one fixed (spawn, month, seed, plane) reproduces
      // its peak exactly. sim = f(spawn, month, seed) must hold at basin scale.
      sampler.setSamplingMode({ kind: 'synoptic-plane', plane: 0 });
      const replay = (): number => {
        const engine = createSimEngine({ env: sampler, isLand });
        engine.spawn({ lat: 13.0, lon: 88.0, monthIndex: 10, seed: 1, isDemo: false });
        let peak = 0;
        let state = engine.getState()!;
        let ticks = 0;
        while (state.alive && ticks < TICK_BUDGET) {
          engine.tick(15);
          state = engine.getState()!;
          peak = Math.max(peak, state.vKt);
          ticks++;
        }
        return peak;
      };
      expect(replay()).toBe(replay());

      // STRUCTURAL: the planes are genuinely different regimes, not copies.
      const novemberPlanes = [...peaksByPlane.entries()]
        .filter(([key]) => Math.floor(key / 100) === 10)
        .map(([, peaks]) => peaks.join(','));
      expect(new Set(novemberPlanes).size).toBeGreaterThanOrEqual(2);

      // The ONE pre-registered numeric floor. See the block comment.
      expect(runs).toBeGreaterThan(0);
      expect(reached34).toBeGreaterThanOrEqual(1);

      // REPORT-ONLY. Phase 10 copies this into the ROADMAP break entry. It is
      // deliberately not asserted: any threshold chosen from it would be a
      // number read off the bake it is supposed to judge.
      // eslint-disable-next-line no-console
      console.log(
        `[post-monsoon report-only] runs=${runs} >=34kt=${reached34} ` +
          `>=64kt=${cat1} cat1Fraction=${(cat1 / runs).toFixed(4)}`,
      );
    }, 120_000);
  }
});
```

*Expected:* On today's Arabian Sea bake the legacy arm runs. `npx vitest run test/integration-bins.test.ts` prints `at least one shr_10 plane is calm enough in the genesis belt to survive` and `November produces Cat-1 storms across more than one plane in aggregate` as passing, with no test from the new arm collected.

- [ ] **Step 3: Run the file and confirm the legacy arm is byte-for-byte the old behaviour**

```powershell
npx vitest run test/integration-bins.test.ts
```

Then confirm the two legacy assertions really are the old ones:
```powershell
git diff test/integration-bins.test.ts | Select-String -Pattern "^-" | Select-String -Pattern "expect\("
```

*Expected:* The vitest run is fully green, with the same test names as before under a renamed describe. The `git diff` filter shows the removed `expect(...)` lines; each one must reappear verbatim inside the `if (isLegacyBake)` arm. If any removed assertion has no verbatim twin in the new file, you dropped coverage.

- [ ] **Step 4: Prove the new arm is reachable and would bite**

Temporarily invert the branch to exercise the new arm against today's bins, then revert. The twelve-month and belt assertions MUST fail against a seven-month Arabian Sea bake — that is the proof the arm is wired, not dead code.

```powershell
node -e "const fs=require('fs'); const p='test/integration-bins.test.ts'; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('  if (isLegacyBake) {','  if (false) {'))"
npx vitest run test/integration-bins.test.ts
git checkout -- test/integration-bins.test.ts
```

*Expected:* With the branch inverted, `resolves a real plane for every month, December included` fails with `expected undefined to be defined // sst_00` (January does not exist in the seven-month bake), and `each post-monsoon month ships a plane inside the frozen calm-shear bound` fails when it reaches `shr_11` or when the 5-19 N band selects no row of the 15-27 N grid (`selects no row of a 40x24 layer spanning 15..27 N`). Both failures prove the arm executes. After `git checkout` the file is restored and the run is green again.

- [ ] **Step 5: Full gate and commit**

```powershell
npm test
npm run build
git add test/integration-bins.test.ts
git commit -m "test: pre-register the post-monsoon bake guards"
```

*Expected:* `npm test` green. `npm run build` exits 0. One commit; `git show --stat HEAD` lists one file.

---

### Task 28: Assert the test-partition leakage FACT, not just the policy string

**Files:**

```
Modify: D:\personal\wallah-its-windy\test\fidelity-catalog.test.ts:35-42 (the `reserves previously unshipped storms for the final test` case) and append a new describe block
```

**Consumes:** nothing from earlier tasks. Reads `calibration/fidelity-catalog.json`, `calibration/results.json` and `calibration/data/hf6-case-catalog.json` as committed.

**Produces:** A `describe('frozen partition leakage ledger')` block exporting nothing; the constant `KNOWN_CONTAMINATION_2026_08_10` is file-local. Task 1's ROADMAP entry references this block by file name.

- [ ] **Step 1: Measure the leaks yourself before writing anything**

The design spec says `calibration/results.json`'s `split.calibration`. **That path is wrong.** The real path is `dataset.split.calibration`. Verify both facts:

```powershell
node -e "const c=require('./calibration/fidelity-catalog.json'); const r=require('./calibration/results.json'); console.log('top-level split:', r.split); const cal=r.dataset.split.calibration, val=r.dataset.split.validation; console.log('sizes', cal.length, val.length); for(const p of ['test','validation','development']){const s=c.storms.filter(x=>x.partition===p); console.log(p, '-> calibration:', s.filter(x=>cal.includes(x.sid)).map(x=>x.sid).join(',')||'(none)', '| validation:', s.filter(x=>val.includes(x.sid)).map(x=>x.sid).join(',')||'(none)');}"
```

```powershell
node -e "const h=require('./calibration/data/hf6-case-catalog.json'); const r=require('./calibration/results.json'); const cal=r.dataset.split.calibration, val=r.dataset.split.validation; const s=h.cases.filter(c=>c.partition==='sealed-confirmation'); console.log('sealed n=', s.length); console.log('in calibration:', s.filter(c=>cal.includes(c.sid)).map(c=>c.sid).join(',')||'(none)'); console.log('in validation:', s.filter(c=>val.includes(c.sid)).map(c=>c.sid).join(',')||'(none)')"```

*Expected:* First command prints:
```
top-level split: undefined
sizes 28 11
test -> calibration: 2019301N05081,2024238N25077 | validation: (none)
validation -> calibration: 2019296N15066,2023156N10067 | validation: 2021267N18094
development -> calibration: (none) | validation: 2019160N11073,2019264N19071
```
Second command prints:
```
sealed n= 8
in calibration: 2022224N22067
in validation: (none)
```
That is seven contaminated SIDs across six cells. Two of them are permanent-test storms, which is the exact violation the `testPolicy` string denies.

- [ ] **Step 2: Decide how the task lands, and write the decision into the test**

**Decision, with reasons, to be written verbatim as the block's doc comment.**

The assignment offers two landings: a failing test, or a dated allowlist of the two known leaks. Take neither exactly — take the allowlist, but make it an **exact, bidirectional cross-tabulation** rather than a one-way permit list.

- A committed failing test is not viable: `npm test` is the first gate in `.github/workflows/deploy.yml:40`, so a red test freezes GitHub Pages at the last good build. That is what the 2026-07-21 deploy-gate incident already cost this project once.
- A one-directional allowlist ("these two SIDs may leak, everything else must not") is weaker than it looks. It stays green if someone *removes* a SID from `dataset.split.calibration` — which would move a storm across a frozen split boundary, the exact holdout violation `calibration/README.md` forbids. It would also stay green if `2019301N05081` were quietly dropped and a different test storm added.
- Exact-set equality in every cell catches both directions: a new leak fails, and a silently "fixed" leak also fails. Pinning the split cardinalities (28 / 11) on top means a leak cannot be papered over by shrinking the dataset — which `ROADMAP.md`'s "never improve a headline metric by silently reducing eligible samples" already forbids in prose but nothing enforced.
- The table covers all three HF-1 partitions plus the HF-6 sealed cohort, not only `partition: "test"`. Two HF-1 *validation* storms and the sealed HF-6 storm `2022224N22067` are contaminated too; the design's section 8.3 names them and Phase 13 measures all six. Freezing them here costs nothing and makes the whole ledger visible in one place.

The leaks are **not fixed** by this task. Fixing them means refitting `DEFAULT_STRUCTURE_PARAMETERS`, which this project explicitly does not do (design D9, Phase 13 measures the shift and publishes it beside the sealed numbers).

*Expected:* You can state why a one-directional allowlist is insufficient and why a red test is not an option here.

- [ ] **Step 3: Replace the string-only assertion and add the ledger**

In `test/fidelity-catalog.test.ts`, change line 38 from:
```ts
    expect(catalog.protocol.testPolicy).toContain('never used');
```
to:
```ts
    // EXACT, not toContain: the string must not be softened to match the fact.
    // The fact itself is asserted in 'frozen partition leakage ledger' below.
    expect(catalog.protocol.testPolicy).toBe(
      'permanent; never used for parameter selection or acceptance',
    );
```

Add these imports at the top of the file, beside the existing ones:
```ts
import results from '../calibration/results.json';
import hf6Catalog from '../calibration/data/hf6-case-catalog.json';
```

Append this block at the end of the file:

```ts
/**
 * Invariant 14 of the nio-v1 design: the string and the fact must agree.
 *
 * fidelity-catalog.json's testPolicy says the six permanent-test storms are
 * "never used for parameter selection or acceptance". Until now the only
 * assertion was that the STRING contained "never used" — which is how the
 * string and the fact diverged unnoticed. This is the fact.
 *
 * It is a LEDGER, not a fix. Seven storms already sat in more than one frozen
 * role on 2026-08-10, and this project does not move any of them: refitting
 * DEFAULT_STRUCTURE_PARAMETERS is Phase 13's measurement, published beside the
 * sealed numbers, not a replacement for them.
 *
 * Why an exact cross-tabulation rather than a one-way allowlist:
 *   - a NEW leak must fail (that is the obvious direction);
 *   - a SILENTLY REMOVED leak must also fail, because removing a SID from a
 *     frozen split is moving a storm across a holdout boundary, which
 *     calibration/README.md forbids outright;
 *   - the split cardinalities are pinned too, so a leak cannot be hidden by
 *     shrinking the dataset (ROADMAP.md: "never improve a headline metric by
 *     silently reducing eligible samples").
 *
 * Changing any cell below is a scientific act. It needs a dated entry in the
 * ROADMAP break entry saying which storm moved and why.
 */
const KNOWN_CONTAMINATION_2026_08_10 = {
  // HF-1 partition -> structure split -> SIDs present in both roles.
  test: {
    // Both fed DEFAULT_STRUCTURE_PARAMETERS. This contradicts testPolicy above.
    calibration: ['2019301N05081', '2024238N25077'], // maha2019, asna2024
    validation: [],
  },
  validation: {
    calibration: ['2019296N15066', '2023156N10067'], // kyarr2019, biparjoy2023
    validation: ['2021267N18094'], // shaheen2021
  },
  development: {
    calibration: [],
    validation: ['2019160N11073', '2019264N19071'], // vayu2019, hikaa2019
  },
} as const;

/** HF-6 sealed-confirmation storms that also fed the structure fit. */
const KNOWN_SEALED_CONTAMINATION_2026_08_10 = {
  calibration: ['2022224N22067'],
  validation: [],
} as const;

describe('frozen partition leakage ledger', () => {
  const structure = (results as any).dataset.split as {
    calibration: string[];
    validation: string[];
  };

  it('pins the structure split cardinalities so a leak cannot be shrunk away', () => {
    expect(structure.calibration).toHaveLength(28);
    expect(structure.validation).toHaveLength(11);
    expect(
      new Set([...structure.calibration, ...structure.validation]).size,
    ).toBe(39);
  });

  it('matches the frozen HF-1 contamination table exactly, in both directions', () => {
    for (const partition of ['test', 'validation', 'development'] as const) {
      const sids = catalog.storms
        .filter((storm) => storm.partition === partition)
        .map((storm) => storm.sid);
      for (const split of ['calibration', 'validation'] as const) {
        const actual = sids.filter((sid) => structure[split].includes(sid)).sort();
        const expected = [...KNOWN_CONTAMINATION_2026_08_10[partition][split]].sort();
        expect(actual, `${partition} storms inside structure ${split}`).toEqual(
          expected,
        );
      }
    }
  });

  it('keeps exactly two permanent-test leaks — no more, and no quiet fewer', () => {
    // Spelled out separately from the table so a mass edit of the table cannot
    // pass unnoticed: this is the leak the testPolicy string denies.
    expect(KNOWN_CONTAMINATION_2026_08_10.test.calibration).toHaveLength(2);
    expect(KNOWN_CONTAMINATION_2026_08_10.test.validation).toHaveLength(0);
    const testSids = catalog.storms
      .filter((storm) => storm.partition === 'test')
      .map((storm) => storm.sid);
    expect(testSids).toHaveLength(6);
    expect(
      testSids.filter((sid) => structure.validation.includes(sid)),
    ).toEqual([]);
  });

  it('matches the frozen HF-6 sealed-cohort contamination exactly', () => {
    const sealed = (hf6Catalog as any).cases
      .filter((item: any) => item.partition === 'sealed-confirmation')
      .map((item: any) => item.sid as string);
    expect(sealed).toHaveLength(8);
    for (const split of ['calibration', 'validation'] as const) {
      expect(
        sealed.filter((sid: string) => structure[split].includes(sid)).sort(),
        `sealed HF-6 storms inside structure ${split}`,
      ).toEqual([...KNOWN_SEALED_CONTAMINATION_2026_08_10[split]].sort());
    }
  });
});
```

Run:
```powershell
npx vitest run test/fidelity-catalog.test.ts
```

*Expected:* `Test Files  1 passed (1)`, `Tests  8 passed (8)` — the four original cases plus the four new ones. If `matches the frozen HF-1 contamination table exactly` fails, the table was mistyped; compare against the command output from the first step.

- [ ] **Step 4: Prove the ledger bites in both directions**

```powershell
# Direction 1: a NEW leak.
node -e "const fs=require('fs'); const p='test/fidelity-catalog.test.ts'; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace(\"calibration: ['2019296N15066', '2023156N10067'],\", \"calibration: ['2019296N15066'],\"))"
npx vitest run test/fidelity-catalog.test.ts
git checkout -- test/fidelity-catalog.test.ts
```
Then re-apply the edits from the previous step (the checkout discards them), or instead stage them first with `git add -N` and use `git stash` — simplest is to run this proof BEFORE committing only if you keep a copy, otherwise run it AFTER the commit in the next step and revert with `git checkout HEAD -- test/fidelity-catalog.test.ts`.

*Expected:* With the table entry removed, `matches the frozen HF-1 contamination table exactly, in both directions` fails with:
```
AssertionError: validation storms inside structure calibration
- Expected
+ Received
  [
    "2019296N15066",
+   "2023156N10067",
  ]
```
That is a real leak being caught. The same failure shape appears if a SID is silently removed from `calibration/results.json`.

- [ ] **Step 5: Full gate and commit**

```powershell
npm test
npm run calibrate:check
npm run build
git add test/fidelity-catalog.test.ts
git commit -m "test: assert the test-partition leakage fact, not just the policy string"
```

*Expected:* All three commands exit 0 — in particular `npm run calibrate:check` stays green, proving this task changed no calibration byte. One commit created.

---

### Task 29: Guard the frozen catalogues against silent regeneration

**Files:**

```
Modify: D:\personal\wallah-its-windy\bake\fidelity_catalog.py:9-18 (imports), :291-303 (write path)
Modify: D:\personal\wallah-its-windy\bake\hf6_catalog.py:349-371 (main)
Modify: D:\personal\wallah-its-windy\test\fidelity-catalog.test.ts (add the domain pin)
Modify: D:\personal\wallah-its-windy\test\hf6-contract.test.ts (add the seal pins)
Modify: D:\personal\wallah-its-windy\package.json:19 (add data:fidelity:catalog:check)
```

**Consumes:** Task 6's edits to `test/fidelity-catalog.test.ts` (this task adds to the same file; apply Task 6 first).

**Produces:** npm script `data:fidelity:catalog:check`. Python functions `bake/fidelity_catalog.py::_assert_domain_unchanged()` and `::check_documents() -> int`; `bake/fidelity_catalog.py::write_documents(reseal: bool = False)` gains its parameter. `bake/hf6_catalog.py::_assert_domain_unchanged()`.

- [ ] **Step 1: Establish the exposure**

Two facts to confirm before writing the guard:

```powershell
node -e "const c=require('./calibration/fidelity-catalog.json'); const h=require('./calibration/data/hf6-case-catalog.json'); console.log('fidelity protocol.domain', JSON.stringify(c.protocol.domain)); console.log('hf6 protocol.domain', JSON.stringify(h.protocol.domain), h.sealId, h.sealedAt)"
node -e "const p=require('./package.json'); console.log(Object.keys(p.scripts).filter(k=>k.includes('catalog')).join(' '))"
```

Then read `bake/fidelity_catalog.py:291-303`. `write_documents()` takes no arguments, has no guard, and `__main__` calls it unconditionally. `npm run data:fidelity:catalog` therefore **overwrites a frozen artifact with no prompt and no check mode**. `bake/hf6_catalog.py:349-371` does have `--check`, but no domain assertion, and `hf6_catalog.py:14` imports `DOMAIN` from `fidelity_catalog` — so one edit to that literal silently rebases BOTH sealed catalogues.

*Expected:* First command prints `fidelity protocol.domain [50,70,15,27]`, `hf6 protocol.domain [50,70,15,27] hf6-arabian-v1-2026-07-21 2026-07-21T15:10:00+04:00`. Second prints `data:fidelity:catalog data:hf6:catalog data:hf6:catalog:check` — note the missing `data:fidelity:catalog:check`.

- [ ] **Step 2: Add the vitest pins first — these are the load-bearing guards**

The python guards are defence in depth. `.github/workflows/deploy.yml:34-51` runs `npm test`, `npm run calibrate:check`, the three HF-6 checks and `npm run build` — it does **not** run `data:hf6:catalog:check`, despite CLAUDE.md listing it. So only vitest is CI-enforced.

In `test/fidelity-catalog.test.ts`, inside the existing `it('pins one agency-consistent source snapshot', ...)` case, add:
```ts
    // The domain is a SEALED protocol field, not a live setting. The nio-v1
    // expansion must not rebase this catalogue: the storm identities, the
    // 18/6/6 split and every downstream hash depend on it. SCORING_DOMAIN
    // (Phase 1) is what moved so this could stay put.
    expect(catalog.protocol.domain).toEqual([50, 70, 15, 27]);
    expect(catalog.protocol.interiorMarginDeg).toBe(1.2);
    expect(catalog.protocol.minimumWindKt).toBe(34);
```

In `test/hf6-contract.test.ts`, inside `it('contains 60-100 storms and multiple initializations without selection leakage', ...)`, add:
```ts
    // Sealed 2026-07-21, before any candidate evaluation. The nio-v1 domain
    // expansion does not move it.
    expect(catalog.protocol.domain).toEqual([50, 70, 15, 27]);
    expect(catalog.sealId).toBe('hf6-arabian-v1-2026-07-21');
    expect(catalog.sealedAt).toBe('2026-07-21T15:10:00+04:00');
```

Run:
```powershell
npx vitest run test/fidelity-catalog.test.ts test/hf6-contract.test.ts
```

*Expected:* Both files green. `Tests  8 passed` for fidelity-catalog (after Task 6) and `Tests  4 passed` for hf6-contract.

- [ ] **Step 3: Give bake/fidelity_catalog.py a check mode and a write guard**

Add `import sys` to the import block at `bake/fidelity_catalog.py:11-17`.

Replace `write_documents()` and the `__main__` block (lines 291-303) with:

```python
def _assert_domain_unchanged() -> None:
    """The catalogue's domain is a SEALED protocol field, not a live setting.
    A domain expansion must never silently rebase this catalogue: the storm
    identities, the 18/6/6 split and every downstream hash depend on it. The
    nio-v1 expansion introduces SCORING_DOMAIN precisely so this stays put."""
    if not CATALOG_PATH.exists():
        return
    recorded = tuple(json.loads(CATALOG_PATH.read_text())["protocol"]["domain"])
    if recorded != DOMAIN:
        raise SystemExit(
            f"fidelity catalogue domain is sealed at {recorded} but this module "
            f"declares {DOMAIN}; the HF-1 catalogue is frozen "
            "(calibration/README.md) and must not be rebased on a new domain"
        )


def check_documents() -> int:
    """Verify the committed catalogue reproduces exactly, without writing."""
    _assert_domain_unchanged()
    catalogue, tracks = build_documents()
    stale = []
    if (
        not CATALOG_PATH.exists()
        or CATALOG_PATH.read_text() != json.dumps(catalogue, indent=2) + "\n"
    ):
        stale.append(str(CATALOG_PATH.relative_to(ROOT)))
    if (
        not TRACKS_PATH.exists()
        or TRACKS_PATH.read_text() != json.dumps(tracks, separators=(",", ":")) + "\n"
    ):
        stale.append(str(TRACKS_PATH.relative_to(ROOT)))
    if stale:
        print(f"[fidelity-catalog] STALE {', '.join(stale)}")
        return 1
    print("[fidelity-catalog] PASS deterministic catalogue and tracks")
    return 0


def write_documents(reseal: bool = False) -> None:
    _assert_domain_unchanged()
    if CATALOG_PATH.exists() and not reseal:
        raise SystemExit(
            "calibration/fidelity-catalog.json already exists and is a FROZEN "
            "artifact; regenerating it re-opens the HF-1 seal "
            "(calibration/README.md). Run with --check to verify, or --reseal "
            "only as a deliberate, documented reseal."
        )
    catalogue, tracks = build_documents()
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRACKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(catalogue, indent=2) + "\n")
    TRACKS_PATH.write_text(json.dumps(tracks, separators=(",", ":")) + "\n")
    print(
        f"[fidelity-catalog] wrote {len(catalogue['storms'])} storms "
        f"to {CATALOG_PATH.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    if "--check" in sys.argv:
        raise SystemExit(check_documents())
    write_documents("--reseal" in sys.argv)
```

Add the script to `package.json`, immediately after line 19's `"data:fidelity:catalog"` entry:
```json
    "data:fidelity:catalog:check": "node bake/run-python.mjs bake/fidelity_catalog.py --check",
```

*Expected:* `npm run data:fidelity:catalog:check` prints `[fidelity-catalog] PASS deterministic catalogue and tracks` and exits 0. NOTE: this needs `data/raw/ibtracs.NI.csv`, which is gitignored — if it is absent the command fails with a FileNotFoundError naming that path, which is correct and expected on a clean checkout. Record which you saw.

- [ ] **Step 4: Prove the write guard and the domain guard fire**

```powershell
node bake/run-python.mjs bake/fidelity_catalog.py
```

Then, if `data/raw/ibtracs.NI.csv` is present, prove the domain guard:
```powershell
node -e "const fs=require('fs'); const p='bake/fidelity_catalog.py'; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('DOMAIN = (50.0, 70.0, 15.0, 27.0)','DOMAIN = (45.0, 100.0, 0.0, 30.0)'))"
node bake/run-python.mjs bake/fidelity_catalog.py --check
git checkout -- bake/fidelity_catalog.py
```

*Expected:* The first command exits non-zero with:
```
calibration/fidelity-catalog.json already exists and is a FROZEN artifact; regenerating it re-opens the HF-1 seal (calibration/README.md). Run with --check to verify, or --reseal only as a deliberate, documented reseal.
```
and `git status --porcelain calibration` prints nothing afterwards — the file was NOT touched.

The second command exits non-zero with:
```
fidelity catalogue domain is sealed at (50.0, 70.0, 15.0, 27.0) but this module declares (45.0, 100.0, 0.0, 30.0); the HF-1 catalogue is frozen (calibration/README.md) and must not be rebased on a new domain
```
That message must name both tuples.

- [ ] **Step 5: Add the same domain guard to bake/hf6_catalog.py**

In `bake/hf6_catalog.py`, add above `def main(check: bool = False) -> None:` (line 349):

```python
def _assert_domain_unchanged() -> None:
    """Same seal as fidelity_catalog._assert_domain_unchanged. This module
    imports DOMAIN from fidelity_catalog, so one edit there would silently
    rebase BOTH sealed catalogues; each asserts independently."""
    if not CATALOG_PATH.exists():
        return
    recorded = tuple(json.loads(CATALOG_PATH.read_text())["protocol"]["domain"])
    if recorded != DOMAIN:
        raise SystemExit(
            f"HF-6 case catalogue is sealed at domain {recorded} but "
            f"fidelity_catalog declares {DOMAIN}; the sealed cohort "
            "(sealId hf6-arabian-v1-2026-07-21) must not be rebased"
        )
```

and make it the first statement inside `main`:
```python
def main(check: bool = False) -> None:
    _assert_domain_unchanged()
    catalog, tracks = build_documents()
```

Run:
```powershell
node bake/run-python.mjs bake/hf6_catalog.py --check
```

*Expected:* `[hf6-catalog] PASS deterministic catalogue and tracks`, exit 0. (Again: requires the gitignored raw IBTrACS CSV; a FileNotFoundError naming that path is the expected clean-checkout outcome.)

- [ ] **Step 6: Full gate and commit**

```powershell
npm test
npm run calibrate:check
npm run hf6:gate:check
npm run build
git status --porcelain calibration docs public/data
git add bake/fidelity_catalog.py bake/hf6_catalog.py test/fidelity-catalog.test.ts test/hf6-contract.test.ts package.json
git commit -m "feat: guard the frozen catalogues against silent regeneration"
```

*Expected:* All four commands exit 0. `git status --porcelain calibration docs public/data` prints NOTHING before the commit — the guards must not have rewritten any sealed artifact. One commit; `git show --stat HEAD` lists exactly five files.

---

### Task 30: Pin the product-honesty disclaimer strings byte-for-byte

**Files:**

```
Create: D:\personal\wallah-its-windy\test\disclaimers.test.ts
```

**Consumes:** nothing

**Produces:** A standalone test file; nothing consumes it.

- [ ] **Step 1: Establish that nothing pins these strings today**

```powershell
node -e "const fs=require('fs'); const t=fs.readdirSync('test').filter(f=>f.endsWith('.ts')); let hits=0; for(const f of t){const s=fs.readFileSync('test/'+f,'utf8'); if(s.includes('index.html')) {console.log('reads index.html:', f); hits++;}} console.log('files reading index.html:', hits)"
node -e "console.log(require('fs').readFileSync('test/live-product.test.ts','utf8').split('\n')[18])"
```

*Expected:* First prints `files reading index.html: 0` — the masthead chip that CLAUDE.md calls non-negotiable is pinned by nothing. Second prints:
```
    expect(view.statusLabel).toContain('not official guidance');
```
A `toContain` on a fragment: the label could be truncated to just that fragment and stay green.

- [ ] **Step 2: Write the pin test**

Create `test/disclaimers.test.ts`. The non-ASCII characters matter: `·` is U+00B7 MIDDLE DOT, `—` is U+2014 EM DASH, `–` in `Marshall–Palmer` is U+2013 EN DASH. Copy them exactly.

```ts
/**
 * disclaimers.test.ts — the product-honesty strings, pinned byte-for-byte.
 *
 * CLAUDE.md's "Product honesty" section says these labels are never dropped or
 * truncated to clean up the UI. Until now nothing enforced that: no test read
 * index.html at all, and test/live-product.test.ts:19 asserted only that the
 * status label CONTAINED the fragment 'not official guidance', which a
 * truncation to exactly that fragment would satisfy.
 *
 * This is a pin, not a style check. A deliberate wording change is a product
 * decision and updates this file in the same commit, visibly.
 *
 * The nio-v1 domain expansion does NOT change any string here: the masthead
 * chip is basin-neutral, and the simulated/observed distinction is unaffected
 * by the box the model runs in.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { weatherLayerDefinition } from '../src/weather-layers';

describe('product-honesty strings', () => {
  it('keeps the masthead guidance chip exact', () => {
    const html = readFileSync('index.html', 'utf8');
    const match = html.match(/<p id="guidance-chip"[^>]*>([\s\S]*?)<\/p>/);
    expect(match, 'index.html has no #guidance-chip paragraph').not.toBeNull();
    expect(match![1].replace(/\s+/g, ' ').trim()).toBe(
      'interactive cyclone simulator · research prototype — not official guidance',
    );
  });

  it('keeps the gated live-run status label exact', () => {
    const source = readFileSync('src/live-product.ts', 'utf8');
    expect(source).toContain(
      "'experimental forecast companion — not official guidance'",
    );
  });

  it('keeps every simulated weather product labelled simulated', () => {
    expect(weatherLayerDefinition('rain').label).toBe('simulated rain radar');
    expect(weatherLayerDefinition('rain').unit).toBe(
      'Marshall–Palmer reflectivity proxy · simulated',
    );
    expect(weatherLayerDefinition('infrared').label).toBe(
      'simulated satellite infrared',
    );
    expect(weatherLayerDefinition('infrared').unit).toBe(
      'simulated brightness temperature · °C',
    );
    expect(weatherLayerDefinition('accum').unit).toBe(
      'mm · deterministic simulated-rain ledger',
    );
    for (const id of ['rain', 'infrared', 'accum', 'wind'] as const) {
      expect(weatherLayerDefinition(id).simulated, id).toBe(true);
    }
  });

  it('never says probability where the product means perturbation frequency', () => {
    // HF-4's gate rejected the calibration claim; CLAUDE.md forbids renaming
    // ensemble output to probability or adding %-chance framing.
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/probability/i);
    expect(html).not.toMatch(/%\s*chance/i);
  });
});
```

Run:
```powershell
npx vitest run test/disclaimers.test.ts
```

*Expected:* `Test Files  1 passed (1)`, `Tests  4 passed (4)`. If `never says probability...` fails, do NOT relax the regex — read the offending `index.html` line: either it is a genuine violation to report, or it is a legitimate use (for example a settings label) that must be narrowed by anchoring the regex to the visible copy, with the reason recorded in a comment.

- [ ] **Step 3: Prove the pin bites on a truncation**

```powershell
node -e "const fs=require('fs'); const p='index.html'; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('interactive cyclone simulator · research prototype — not official guidance','interactive cyclone simulator'))"
npx vitest run test/disclaimers.test.ts
git checkout -- index.html
```

*Expected:* `keeps the masthead guidance chip exact` fails with:
```
- Expected
+ Received
- "interactive cyclone simulator · research prototype — not official guidance"
+ "interactive cyclone simulator"
```
After `git checkout -- index.html` the file is restored and the run is green.

- [ ] **Step 4: Full gate and commit**

```powershell
npm test
npm run build
git status --porcelain calibration docs public/data
git add test/disclaimers.test.ts
git commit -m "test: pin the product disclaimer strings"
```

*Expected:* `npm test` green, `npm run build` exits 0, `git status --porcelain calibration docs public/data` prints NOTHING. One commit created.

- [ ] **Step 5: Close the phase: run every sealed check and prove the diff is governance-only**

```powershell
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run realism:check
npm run build
node bake/run-python.mjs bake/test_yearpick.py
node bake/run-python.mjs bake/test_upper.py
git log --oneline --follow -- calibration/era5-yearpick-criterion.json | Measure-Object -Line
git diff --name-only <phase3-base>..HEAD -- calibration docs public/data
```
Substitute `<phase3-base>` with the commit SHA recorded before Task 1.

*Expected:* All nine commands exit 0. `Measure-Object` prints `Lines : 1`. The final `git diff --name-only` prints exactly one line:
```
calibration/era5-yearpick-criterion.json
```
Nothing under `public/data`, no modified `docs/` file, and no existing `calibration/` artifact. `ROADMAP.md` is outside those three paths and is the only other change in the phase; confirm with `git diff --name-only <phase3-base>..HEAD` that the full set is exactly the 18 files in this plan's file structure.


**Unverified in this phase — the implementer must check:**

- bake/era5.py CANNOT be executed in this environment: data/raw/era5_climatology.nc is gitignored and absent. Task 3's rewire is proven only by bake/test_yearpick.py's synthetic legacy-equivalence oracle, never by a real bake. Before Phase 6 relies on the legacy profile, someone with the ERA5 cache must run a full bake and confirm public/data/env.bin is byte-identical to the committed one. If it is not, the refactor is wrong and Phase 6's registration proof is invalid.
- CLAUDE.md lists `data:hf6:catalog:check` among the HF-6 CI checks, but .github/workflows/deploy.yml:34-51 does NOT run it (it runs npm ci, venv setup, live:acquire, npm test, calibrate:check, hf6:verify:check, hf6:gate:check, hf6:prospective:check, npm run build). Task 7's python-side guards are therefore NOT CI-enforced; only the vitest pins are. Either add the two catalogue checks to deploy.yml (out of this phase's scope, and it would need the gitignored raw IBTrACS CSV in CI, which it does not have) or accept that the python guards protect a human running the command, not CI. The CLAUDE.md line is inaccurate and should be corrected in a later amendment PR.
- The freeze mechanism's strongest clause — that calibration/era5-yearpick-criterion.json has exactly one commit — cannot live in vitest. actions/checkout clones at depth 1, so `git log --follow` is unreliable in CI. It is a PR-checklist and phase-gate command only. A determined editor can amend both the JSON and the test literals in one commit; the defence is that this is a visible two-file diff with a hash change, not that it is impossible.
- Task 5's new branch does not execute until Phase 10 ships a non-legacy env.bin. Task 4's helper unit test exercises the arithmetic and the step that inverts the branch proves the arm is reachable, but a logic error inside the sim sweep would surface only at Phase 10. Re-read the whole `else` arm when Phase 10 lands.
- The pre-registered assertion `minBelt < 13.0` for October, November and December may go RED on the real basin-wide bake — the 1991-2020 record may simply not contain a calm-belt year in a given month once the belt is two-sided and area-weighted. That is the point of pre-registration: it is a published finding, and the threshold must not be moved. Someone will be tempted; the block comment says so explicitly, and the ROADMAP entry backs it.
- Task 2's re-derivation of `calmBeltShearMs` preserves the legacy VALUE (13.0) while changing its MEANING (anchored to the model constant rather than to a 15-19 N sample) and changing the statistic it is compared against (two-sided, cos-weighted). That is a defensible pre-registration but it is not the only one available; a reviewer could reasonably argue the absolute should have been re-derived from the new belt's climatology, which is impossible before the fetch. The choice and its reason are recorded in the criterion's `derivation` block so the alternative is visible.
- bake/realism_env_variance.py:32 keeps its own one-sided unweighted BELT_LAT_MAX = 19.0. Task 3 only fixes its stale comment. If anyone re-runs `npm run data:realism:variance` after Phase 7 expecting the new belt, they will get the old statistic — deliberately, so the committed R1 outputs do not drift. Confirm this is still wanted when Phase 11 redefines the realism instrument.
- The design spec's invariant 14 names `calibration/results.json`'s `split.calibration`. That path does not exist: the real path is `dataset.split.calibration`. Task 6 uses the real one, and the spec text should be corrected in a later amendment.
- Phase 3 adds files under calibration/ and edits ROADMAP.md, so the literal Phase 1 gate (`git status --porcelain calibration docs public/data` prints nothing) only holds AFTER these commits land. The meaningful gate is the last step's `git diff --name-only <phase3-base>..HEAD -- calibration docs public/data`, which must list exactly one added file and nothing under public/data. If it lists anything else, a sealed artifact was rewritten.
- Task 6's tamper proof (deliberately breaking the contamination table) destroys the uncommitted edits if run with `git checkout` before the commit. Run that proof AFTER the commit and revert with `git checkout HEAD -- test/fidelity-catalog.test.ts`, or the work is lost.
- Task 7's `npm run data:fidelity:catalog:check` and `bake/hf6_catalog.py --check` both require the gitignored data/raw/ibtracs.NI.csv. On a clean checkout they fail with a FileNotFoundError, which is correct behaviour but means the guards were not actually observed to pass. Record which outcome you saw; if the CSV is absent, the `_assert_domain_unchanged` path is unverified and someone with the raw data must confirm it.

---

## Phases 4 and 5 — bake hardening at the OLD domain, then the reproduction probe

Phase 4 hardens the bake pipeline while the domain is still the legacy Arabian Sea box (50–70 °E, 15–27 °N), so that every later phase changes data and nothing else. It creates one dependency-free `bake/domain.py` as the single Python copy of the box, repoints the twelve modules that must follow it, stamps the five genuinely sealed literals with a machine-checked "frozen" marker, ports the cached-NetCDF extent check out of `bake/fetch_fidelity_benchmark.py` into a shared module used by all four fetchers, closes the two `fill_value=None` extrapolation paths, makes `ensure_download` stream, replaces the silent `np.clip` in `flowacc`'s uint16 quantization with a raise, and drops the `basin` layer. A reviewer knows it worked when `npm test` is green, `node bake/run-python.mjs bake/bake.py` reruns, and `git status --porcelain public/data` prints exactly one line — ` M public/data/flowacc.bin` — with `calibration/asset-manifest.json` as the only other changed committed file. Phase 5 is a pure reconnaissance phase: three probe scripts run entirely from a scratchpad directory outside the repository, and produce one verdict per asset (bit-identical / N cells differ / not reproducible) so Phase 6 commits to a rebake only after the answer is known. Phase 5's gate is that `git status --porcelain` shows nothing new inside the repository at all.

**Files in this phase:**

```
bake/domain.py — CREATE. The one dependency-free Python copy of src/grid.ts DOMAIN; imported by every bake module that must follow the live box.
bake/netcdf_extent.py — CREATE. Shared cached-NetCDF variable/extent/level validation, lifted verbatim from fetch_fidelity_benchmark.py::_valid_netcdf.
test/bake-domain-mirrors.test.ts — CREATE. CI-enforced three-way census of every legacy-box literal in bake/: must-follow (zero hits), sealed (must keep its frozen marker), deferred (must keep its literal until its own phase).
bake/sources.py — MODIFY. Import DOMAIN from bake/domain.py; derive URL_GMRT from it; add the GMRT cached-extent assert to load_terrain; de-hardcode the docstring at :187.
bake/bake.py — MODIFY. q_u16 raises instead of clipping; the basin layer is dropped from flowacc.bin; docstring/diagnostic updated.
bake/fetch_era5.py — MODIFY. AREA derived from DOMAIN; per-request kind tag; skip path validates extent instead of existence.
bake/fetch_event_benchmark.py — MODIFY. AREA derived from DOMAIN; skip path validates extent.
bake/fetch_realism_era5.py — MODIFY. AREA derived from DOMAIN; skip path validates extent; docstring de-hardcoded.
bake/fetch_fidelity_benchmark.py — MODIFY. _valid_netcdf deleted; delegates to bake/netcdf_extent.py.
bake/era5.py — MODIFY. Docstring de-hardcoded at :4; _to_env_grid stops extrapolating at :330.
bake/era5_event.py — MODIFY. _to_env_grid_series stops extrapolating at :176-177.
bake/hydrosheds.py — MODIFY. Docstring de-hardcoded at :5. Its `basin` return value stays — bake_regions.py needs it.
bake/public_cycle.py — MODIFY. Live GFS/OISST acquisition follows bake/domain.py (design §3.8).
bake/satellite_frames.py — MODIFY. Both mirrors follow bake/domain.py: the DOMAIN dict at :22 and the WMS bbox string at :88.
bake/validate_satellite_structure.py — MODIFY. DOMAIN dict at :17 follows bake/domain.py.
bake/binfmt.py, bake/fidelity_catalog.py, bake/hf2a_ocean_benchmark.py, bake/bake_hf3_steering.py, bake/test_upper.py — MODIFY, comments only. Each gains the exact frozen marker the guard test asserts.
BINARY-FORMATS.md — MODIFY. flowacc.bin drops to three layers; the uint16 headroom note lands; the golden hex is NOT touched.
bake/README.md — MODIFY. flowacc.bin row, the "basin stays in the file" sentence, and the WIW_HYDRO_FALLBACK paragraph.
test/integration-bins.test.ts — MODIFY. The flowacc.bin block stops requiring `basin`, requires exactly three layers, and pins the quantization headroom.
public/data/flowacc.bin — REGENERATED. 4,168,680 B → 2,779,152 B. The single permitted byte change in Phase 4.
calibration/asset-manifest.json — REGENERATED by `npm run assets:manifest`. One hash line changes.
(Phase 5 creates NO file inside the repository. All probe scripts and outputs live under %TEMP%\wiw-nio-probe\.)
```

### Task 31: Census, classify, and unify every bake-side DOMAIN literal

**Files:**

```
Create: bake/domain.py
Create: test/bake-domain-mirrors.test.ts
Modify: bake/sources.py:14-59, bake/sources.py:187
Modify: bake/era5.py:4
Modify: bake/hydrosheds.py:5
Modify: bake/public_cycle.py:69
Modify: bake/satellite_frames.py:22, bake/satellite_frames.py:88
Modify: bake/validate_satellite_structure.py:17
Modify: bake/binfmt.py:258, bake/fidelity_catalog.py:25, bake/hf2a_ocean_benchmark.py:50, bake/bake_hf3_steering.py:69, bake/test_upper.py:20, bake/test_upper.py:125
Test: test/bake-domain-mirrors.test.ts
```

**Consumes:** nothing

**Produces:** `bake/domain.py` exporting `DOMAIN: tuple[float, float, float, float] = (50.0, 70.0, 15.0, 27.0)` in (lonMin, lonMax, latMin, latMax) order — imported by tasks P4-2 and P4-3, and by the Phase 5 probe scripts. The exact frozen-marker string `FROZEN DOMAIN LITERAL — do not unify with bake/domain.py` — the guard test asserts it verbatim. `bake/sources.py` keeps re-exporting the name `sources.DOMAIN` unchanged, so no existing caller moves.

- [ ] **Step 1: Verify the nine classifications the design asserts, before changing anything**

Run the census and read each hit in place. This is a read-only step; its output is what the rest of the task is built on.

```bash
cd /d/personal/wallah-its-windy
grep -rn --include=*.py -e '50\.0, 70\.0, 15\.0, 27\.0' -e '\[27, 50, 15, 70\]' -e '\[50, 70, 15, 27\]' -e 'minlongitude=50' -e '15,50,27,70' -e '"west": 50\.0' -e '50-70E' -e '50–70' -e '15-27N' -e '15–27' bake/
```

Expected 21 hits across 14 files. Check each against the design's claims and record these three corrections, which are real and must be carried into the plan:

1. **`bake/bake_hf3_steering.py` has NO non-manifest use.** The design's Phase 4 text says to delete "its non-manifest uses". Read the whole 82-line file: line 69 is the only occurrence, it sits inside the `document` dict written to `calibration/data/hf3-steering-manifest.json`, and the module does not import `sources` at all. There is nothing to unify. Classification **frozen** — correct; instruction **wrong**.
2. **`bake/satellite_frames.py` has TWO mirrors, not one.** The design names only `:22`. Line 88 carries the independent WMS string `"bbox": "15,50,27,70"`. Unifying only `:22` would ship a manifest claiming a wide bbox for a crop still requested at the narrow one.
3. **`bake/realism_env_variance.py:227` is a tenth site the design omits entirely** (`"domain": "50-70E 15-27N"`). It must follow `sources.py`, but it writes `calibration/realism/env-variance.json` and `docs/research/realism/env-variance-study.md` — both inside Phase 4's clean-gate directories. It is therefore classified **deferred to the phase that refetches the realism ERA5 cache**, and Phase 4 must NOT touch it.

The other six classifications hold as written: `binfmt.py:258` (golden vector), `fidelity_catalog.py:25` (frozen HF-1 catalogue; also inherited by `bake/hf6_catalog.py:14` via `from fidelity_catalog import DOMAIN`), `hf2a_ocean_benchmark.py:50` (frozen HF-2a reference), `test_upper.py:20` and `:125` (synthetic 2×2 fixtures) are sealed; `public_cycle.py:69`, `satellite_frames.py:22`, `validate_satellite_structure.py:17` must move.

*Expected:* 21 grep hits across 14 files. `grep -c '50\.0, 70\.0, 15\.0, 27\.0' bake/bake_hf3_steering.py` prints `0`, and `grep -n '15,50,27,70' bake/satellite_frames.py` prints `88:        "bbox": "15,50,27,70",` — the two corrections above are confirmed against the files, not assumed.

- [ ] **Step 2: Write the failing guard test**

Create `test/bake-domain-mirrors.test.ts` with exactly this content:

```ts
/**
 * bake-domain-mirrors.test.ts — the bake-side legacy-box census.
 *
 * bake/domain.py holds the one Python copy of src/grid.ts DOMAIN. A hardcoded
 * 50/70/15/27 anywhere else in bake/ is one of exactly three things, and this
 * test pins which: a sealed protocol literal that must NEVER follow the live
 * box, a mirror that must follow it, or a site deferred to a named later phase.
 * A new fourth case is a bug that would ship an Arabian-Sea-registered asset
 * into a wider runtime, so it fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Every textual spelling of the legacy box that occurs in bake/. */
const LEGACY_BOX_PATTERNS = [
  '50.0, 70.0, 15.0, 27.0',
  '[50, 70, 15, 27]',
  '[27, 50, 15, 70]',
  'minlongitude=50',
  '"west": 50.0',
  '15,50,27,70',
  '50-70E',
  '50–70',
  '15-27N',
  '15–27',
];

const FROZEN_MARKER = 'FROZEN DOMAIN LITERAL — do not unify with bake/domain.py';

/** Sealed: the literal is the protocol. Never unify. */
const SEALED: Record<string, string> = {
  'bake/binfmt.py': 'golden vector bytes 24..55 — BINARY-FORMATS.md is law',
  'bake/fidelity_catalog.py': 'frozen HF-1 catalogue membership filter',
  'bake/hf2a_ocean_benchmark.py': 'frozen HF-2a ocean reference',
  'bake/bake_hf3_steering.py': 'stamps the frozen HF-3 steering manifest',
  'bake/test_upper.py': 'synthetic 2x2 offline fixtures, not domain mirrors',
};

/** Must derive the box from bake/domain.py. Zero hits allowed. */
const MUST_FOLLOW = [
  'bake/sources.py',
  'bake/bake.py',
  'bake/era5.py',
  'bake/era5_event.py',
  'bake/hydrosheds.py',
  'bake/fetch_era5.py',
  'bake/fetch_event_benchmark.py',
  'bake/fetch_realism_era5.py',
  'bake/fetch_fidelity_benchmark.py',
  'bake/public_cycle.py',
  'bake/satellite_frames.py',
  'bake/validate_satellite_structure.py',
];

/** Deferred: follows domain.py eventually, but not in this phase. */
const DEFERRED: Record<string, string> = {
  'bake/realism_env_variance.py':
    'writes calibration/realism/env-variance.json and docs/research/realism/' +
    'env-variance-study.md; moves with the realism ERA5 refetch, not here',
};

function hits(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return LEGACY_BOX_PATTERNS.filter((pattern) => text.includes(pattern));
}

describe('bake DOMAIN mirrors', () => {
  it('bake/domain.py holds the box', () => {
    expect(hits('bake/domain.py')).toContain('50.0, 70.0, 15.0, 27.0');
  });

  it('no must-follow bake module hardcodes the legacy box', () => {
    const offenders = MUST_FOLLOW.filter((file) => hits(file).length > 0).map(
      (file) => `${file} -> ${hits(file).join(' | ')}`,
    );
    expect(offenders).toEqual([]);
  });

  it('every sealed literal survives and carries its frozen marker', () => {
    for (const [file, reason] of Object.entries(SEALED)) {
      const text = readFileSync(file, 'utf8');
      expect(hits(file).length, `${file} lost its sealed literal`).toBeGreaterThan(0);
      expect(text, `${file}: ${reason}`).toContain(FROZEN_MARKER);
    }
  });

  it('deferred sites still hold their literal and are not silently unified', () => {
    for (const [file, reason] of Object.entries(DEFERRED)) {
      expect(hits(file).length, `${file}: ${reason}`).toBeGreaterThan(0);
    }
  });
});
```

Then run only this file:

```bash
npx vitest run test/bake-domain-mirrors.test.ts
```

*Expected:* Three of the four cases fail. `bake/domain.py holds the box` fails with `ENOENT: no such file or directory, open 'bake/domain.py'`. `no must-follow bake module hardcodes the legacy box` fails with an array of nine entries beginning `bake/sources.py -> 50.0, 70.0, 15.0, 27.0 | minlongitude=50 | 50-70E | 15-27N`. `every sealed literal survives and carries its frozen marker` fails on `bake/binfmt.py` with `expected '...' to contain 'FROZEN DOMAIN LITERAL — do not unify with bake/domain.py'`. The deferred case passes already.

- [ ] **Step 3: Create bake/domain.py and repoint bake/sources.py**

Create `bake/domain.py` with exactly this content — no third-party imports, so a PIL-only script can share it without pulling in scipy:

```python
"""domain.py — the ONE Python copy of src/grid.ts DOMAIN.

Deliberately dependency-free. bake/sources.py needs numpy + scipy, but
bake/satellite_frames.py needs only PIL and bake/public_cycle.py runs on a
six-hourly CI cron; all three must read the same box without inheriting each
other's import graphs.

Order is (lonMin, lonMax, latMin, latMax), matching every WIWB layer header
bbox and the row-order convention in ../BINARY-FORMATS.md (row 0 = NORTH).

Sealed protocol literals do NOT read this module. See
test/bake-domain-mirrors.test.ts for the enforced three-way census.
"""

from __future__ import annotations

DOMAIN: tuple[float, float, float, float] = (50.0, 70.0, 15.0, 27.0)


def era5_area(domain: tuple[float, float, float, float] = DOMAIN) -> list[float]:
    """CDS 'area' order: [north, west, south, east]."""
    lon_min, lon_max, lat_min, lat_max = domain
    return [lat_max, lon_min, lat_min, lon_max]
```

In `bake/sources.py`, replace lines 24-41. Before:

```python
from event_catalog import EVENTS

# --- Domain + target grids (mirror src/grid.ts DOMAIN) ----------------------
DOMAIN = (50.0, 70.0, 15.0, 27.0)  # lonMin, lonMax, latMin, latMax
TERRAIN_NX, TERRAIN_NY = 1040, 668  # ~2 km cells over the domain
ENV_NX, ENV_NY = 40, 24  # 0.5 deg
SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10]  # May..Nov, 0-indexed (types.ts monthIndex)
# Storms whose track enters this box "affected Oman" (genesis.json filter).
GENESIS_BOX = (52.0, 62.0, 16.0, 26.0)

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")

# Source URLs (also documented in README).
URL_GMRT = (
    "https://www.gmrt.org/services/GridServer?"
    "minlongitude=50&maxlongitude=70&minlatitude=15&maxlatitude=27"
    "&format=netcdf&resolution=med"
)
```

After:

```python
from domain import DOMAIN
from event_catalog import EVENTS

# --- Domain + target grids --------------------------------------------------
# DOMAIN is re-exported from bake/domain.py, not defined here: every existing
# caller says sources.DOMAIN, and moving the definition must not move the name.
TERRAIN_NX, TERRAIN_NY = 1040, 668  # ~2 km cells over the domain
ENV_NX, ENV_NY = 40, 24  # 0.5 deg
SEASON_MONTHS = [4, 5, 6, 7, 8, 9, 10]  # May..Nov, 0-indexed (types.ts monthIndex)
# Storms whose track enters this box "affected Oman" (genesis.json filter).
GENESIS_BOX = (52.0, 62.0, 16.0, 26.0)

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "raw")

# Source URLs (also documented in README). ':g' keeps whole degrees rendering
# as "50" not "50.0", so the query string is byte-identical to the one that
# produced the committed terrain.bin.
URL_GMRT = (
    "https://www.gmrt.org/services/GridServer?"
    f"minlongitude={DOMAIN[0]:g}&maxlongitude={DOMAIN[1]:g}"
    f"&minlatitude={DOMAIN[2]:g}&maxlatitude={DOMAIN[3]:g}"
    "&format=netcdf&resolution=med"
)
```

Then `bake/sources.py:187`. Before:

```python
    first fix that lies inside the DOMAIN (the playable 50-70E/15-27N map).
```

After:

```python
    first fix that lies inside the DOMAIN (the playable map; see bake/domain.py).
```

Prove the URL is unchanged:

```bash
node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import sources; print(sources.URL_GMRT); print(sources.DOMAIN)"
```

*Expected:* The command prints `https://www.gmrt.org/services/GridServer?minlongitude=50&maxlongitude=70&minlatitude=15&maxlatitude=27&format=netcdf&resolution=med` and `(50.0, 70.0, 15.0, 27.0)` — the URL string is character-for-character what line 37-41 held before. If `bake/.venv` is missing, `run-python.mjs` prints `[python-runner] missing bake/.venv/Scripts/python.exe`; create it per bake/README.md's Reproduce block first.

- [ ] **Step 4: Repoint the three live/observed modules**

`bake/public_cycle.py`. Find the first-party import block with `sed -n '1,40p' bake/public_cycle.py`, then add `from domain import DOMAIN` as the last first-party import. Then, at line 69, before:

```python
DOMAIN = (50.0, 70.0, 15.0, 27.0)
```

After:

```python
# DOMAIN is imported from bake/domain.py above. This is the LIVE acquisition
# path: .github/workflows/deploy.yml runs `npm run live:acquire` on every push
# and on a 45 */6 * * * cron, and this module writes
# public/data/live/environment.bin straight into the shipped site. Freezing the
# box here would six-hourly ship a wrong-registration bin into the runtime,
# which test/asset-manifest.test.ts cannot catch (VOLATILE_ASSET_PREFIXES
# excludes 'live/' by design). It must move with bake/domain.py.
```

`bake/satellite_frames.py`. After line 20 (`from PIL import Image`), insert `from domain import DOMAIN as DOMAIN_BOX`. Then line 22, before:

```python
DOMAIN = {"west": 50.0, "south": 15.0, "east": 70.0, "north": 27.0}
```

After:

```python
# Observed frames are cropped to the runtime box; src/render/satellite.ts:10
# asserts "frame bbox == DOMAIN by construction", so this must follow
# bake/domain.py or the assertion becomes a lie.
DOMAIN = {
    "west": DOMAIN_BOX[0],
    "east": DOMAIN_BOX[1],
    "south": DOMAIN_BOX[2],
    "north": DOMAIN_BOX[3],
}
```

Then the second mirror the design missed, line 88. Before:

```python
        "bbox": "15,50,27,70",
```

After:

```python
        # WMS 1.3.0 EPSG:4326 axis order is lat,lon. ':g' keeps whole degrees
        # rendering as "15" not "15.0", so the request URL is unchanged today.
        "bbox": (
            f"{DOMAIN['south']:g},{DOMAIN['west']:g},"
            f"{DOMAIN['north']:g},{DOMAIN['east']:g}"
        ),
```

`bake/validate_satellite_structure.py`. After line 15 (`from PIL import Image`), insert `from domain import DOMAIN as DOMAIN_BOX`. Then line 17, before:

```python
DOMAIN = {"west": 50.0, "south": 15.0, "east": 70.0, "north": 27.0}
```

After:

```python
# The morphology screen aligns an observed frame and a simulated frame to the
# SAME box; a frozen box here would silently compare different geography.
DOMAIN = {
    "west": DOMAIN_BOX[0],
    "east": DOMAIN_BOX[1],
    "south": DOMAIN_BOX[2],
    "north": DOMAIN_BOX[3],
}
```

Prove the WMS string is unchanged:

```bash
node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import satellite_frames as s; d=s.DOMAIN; print(f\"{d['south']:g},{d['west']:g},{d['north']:g},{d['east']:g}\")"
```

*Expected:* Prints exactly `15,50,27,70` — identical to the string deleted from line 88. If PIL is absent from the venv the import fails with `ModuleNotFoundError: No module named 'PIL'`; install `bake/requirements.txt` first.

- [ ] **Step 5: Stamp the five sealed literals**

Insert the exact marker above each sealed literal. The guard test asserts the string `FROZEN DOMAIN LITERAL — do not unify with bake/domain.py` verbatim (em dash, U+2014).

`bake/binfmt.py:258`, before:

```python
    domain = (50.0, 70.0, 15.0, 27.0)
```

After:

```python
    # FROZEN DOMAIN LITERAL — do not unify with bake/domain.py.
    # These four f64 doubles are bytes 24..55 of the golden vector printed in
    # ../BINARY-FORMATS.md. Sourcing them from the live box would change
    # GOLDEN_HEX and break test/loader.test.ts's byte-exact parse.
    domain = (50.0, 70.0, 15.0, 27.0)
```

`bake/fidelity_catalog.py:25`, before:

```python
DOMAIN = (50.0, 70.0, 15.0, 27.0)
```

After:

```python
# FROZEN DOMAIN LITERAL — do not unify with bake/domain.py.
# This box decides which IBTrACS fixes count as in-domain, and therefore the
# membership of the sealed 30-storm HF-1 catalogue and its 18/6/6 split.
# bake/hf6_catalog.py imports this same name, so widening it silently rebases
# two sealed catalogues at once.
DOMAIN = (50.0, 70.0, 15.0, 27.0)
```

`bake/hf2a_ocean_benchmark.py:50`, before:

```python
DOMAIN = (50.0, 70.0, 15.0, 27.0)
```

After:

```python
# FROZEN DOMAIN LITERAL — do not unify with bake/domain.py.
# Bounds the frozen HF-2a cold-wake observation set (calibration/
# hf2a-ocean-reference.json). Regenerating it re-opens that seal.
DOMAIN = (50.0, 70.0, 15.0, 27.0)
```

`bake/bake_hf3_steering.py:69`, before:

```python
        "grid": {"nx": 40, "ny": 24, "bbox": [50, 70, 15, 27]},
```

After:

```python
        # FROZEN DOMAIN LITERAL — do not unify with bake/domain.py.
        # Stamped into calibration/data/hf3-steering-manifest.json, which
        # records the grid the sealed HF-3 sidecars were baked on. This is the
        # only occurrence in this module; there are no non-manifest uses.
        "grid": {"nx": 40, "ny": 24, "bbox": [50, 70, 15, 27]},
```

`bake/test_upper.py` — add the marker once, immediately under the module docstring (before `from __future__ import annotations` at line 12), so one comment covers both `:20` and `:125`:

```python
# FROZEN DOMAIN LITERAL — do not unify with bake/domain.py.
# The `domain` tuples below are metadata on synthetic 2x2 fixture blobs. They
# are not mirrors of the runtime box; binding them to a moving constant would
# couple an offline unit test to data it never reads.
```

Re-run the guard:

```bash
npx vitest run test/bake-domain-mirrors.test.ts
```

*Expected:* All four cases pass: `Test Files  1 passed (1)` and `Tests  4 passed (4)`.

- [ ] **Step 6: Full suite and commit**

```bash
npm test
```

Nothing in this task touched a baked byte, a physics module or a sealed artifact, so the whole suite must be green with no reseal. Then:

```bash
git status --porcelain calibration docs public/data
git add bake/domain.py test/bake-domain-mirrors.test.ts bake/sources.py bake/era5.py bake/hydrosheds.py bake/public_cycle.py bake/satellite_frames.py bake/validate_satellite_structure.py bake/binfmt.py bake/fidelity_catalog.py bake/hf2a_ocean_benchmark.py bake/bake_hf3_steering.py bake/test_upper.py
git commit -m "refactor(bake): unify the live DOMAIN mirrors and seal the frozen ones"
```

The two remaining docstring edits belong to this commit as well: `bake/era5.py:4`, before `u/v at 850/500/250/200 hPa, 1991-2020, May-Nov, 50-70E/15-27N, 0.5 deg) and`, after `u/v at 850/500/250/200 hPa, 1991-2020, May-Nov, over bake/domain.py's box at 0.5 deg) and`. And `bake/hydrosheds.py:5`, before `50–70E / 15–27N display domain. ACC is reduced to the 2 km terrain grid with`, after `bake/domain.py box. ACC is reduced to the 2 km terrain grid with`.

*Expected:* `npm test` reports every file passing with no failures. `git status --porcelain calibration docs public/data` prints NOTHING — this task changes no committed byte in those three directories.

---

### Task 32: One cached-NetCDF extent check, used by every fetcher, and no extrapolation

**Files:**

```
Create: bake/netcdf_extent.py
Modify: bake/fetch_fidelity_benchmark.py:23, :67-117, :151, :226
Modify: bake/fetch_era5.py:29-38, :40-173, :198-232
Modify: bake/fetch_event_benchmark.py:15-21, :60-68
Modify: bake/fetch_realism_era5.py:5, :18-24, :66-70
Modify: bake/era5.py:322-332
Modify: bake/era5_event.py:170-179
Modify: bake/sources.py:94-108 (load_terrain)
Test: test/bake-domain-mirrors.test.ts (already created by P4-1; it now covers the fetchers)
```

**Consumes:** `bake/domain.py::DOMAIN` and `bake/domain.py::era5_area` from task P4-1.

**Produces:** `bake/netcdf_extent.py` exporting `valid_netcdf(target: Path, kind: str, area: list[float], grid: list[float], expected_times: tuple[int, ...] | None = None) -> bool`, where `kind` is one of `'wind' | 'rh' | 'sst'`. Consumed by all four fetchers and by the Phase 5 ERA5 probe (task P5-B).

- [ ] **Step 1: Extract the validator into a shared module, unchanged in behaviour**

Create `bake/netcdf_extent.py`:

```python
"""netcdf_extent.py — cached-NetCDF variable/extent/level validation.

Lifted out of bake/fetch_fidelity_benchmark.py::_valid_netcdf so every fetcher
shares one implementation. Existence and non-zero size are NOT a valid cache
check: the filenames do not encode the requested extent, so a cache left over
from a narrower box would be silently reused, and the consumers in bake/era5.py
and bake/era5_event.py extrapolate rather than raise.

`expected_times=None` skips the timestamp check for callers (the climatology
and realism fetchers) that have no per-file time model; the extent, variable
and pressure-level checks always run.
"""

from __future__ import annotations

from pathlib import Path

EXPECTED_VARIABLES = {
    "wind": {"valid_time", "pressure_level", "latitude", "longitude", "u", "v"},
    "rh": {"valid_time", "pressure_level", "latitude", "longitude", "r"},
    "sst": {"valid_time", "latitude", "longitude", "sst"},
}

EXPECTED_LEVELS: dict[str, set[int] | None] = {
    "wind": {200, 250, 500, 850},
    "rh": {600, 700},
    "sst": None,
}


def expected_axes(
    area: list[float], grid: list[float]
) -> tuple[list[float], list[float]]:
    """The exact latitude/longitude axes a CDS request for `area` returns."""
    north, west, south, east = area
    lat_step, lon_step = grid
    latitudes = [
        north - index * lat_step
        for index in range(round((north - south) / lat_step) + 1)
    ]
    longitudes = [
        west + index * lon_step
        for index in range(round((east - west) / lon_step) + 1)
    ]
    return latitudes, longitudes


def valid_netcdf(
    target: Path,
    kind: str,
    area: list[float],
    grid: list[float],
    expected_times: tuple[int, ...] | None = None,
) -> bool:
    import h5py

    expected_variables = EXPECTED_VARIABLES[kind]
    expected_latitudes, expected_longitudes = expected_axes(area, grid)
    try:
        with h5py.File(target, "r") as handle:
            if not expected_variables.issubset(handle.keys()):
                return False
            if expected_times is not None:
                if tuple(map(int, handle["valid_time"][...])) != expected_times:
                    return False
            if list(map(float, handle["latitude"][...])) != expected_latitudes:
                return False
            if list(map(float, handle["longitude"][...])) != expected_longitudes:
                return False
            expected_levels = EXPECTED_LEVELS[kind]
            return expected_levels is None or set(
                map(int, handle["pressure_level"][...])
            ) == expected_levels
    except (OSError, KeyError, ValueError):
        return False
```

In `bake/fetch_fidelity_benchmark.py`, delete lines 67-117 (the whole `_valid_netcdf` function) and add `from netcdf_extent import valid_netcdf` beside line 24's `from fidelity_catalog import ...`. Then line 151, before `if not _valid_netcdf(target, kind, expected_times):`, after `if not valid_netcdf(target, kind, AREA, GRID, expected_times):`. And line 226, before `if _valid_netcdf(target, kind, expected_times):`, after `if valid_netcdf(target, kind, AREA, GRID, expected_times):`.

*Expected:* `node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import netcdf_extent as n; print(n.expected_axes([27,50,15,70],[0.5,0.5])[0][:3], n.expected_axes([27,50,15,70],[0.5,0.5])[1][:3])"` prints `[27.0, 26.5, 26.0] [50.0, 50.5, 51.0]` — 25 latitudes and 41 longitudes, matching env.bin's 0.5° registration. `grep -c '_valid_netcdf' bake/fetch_fidelity_benchmark.py` prints `0`.

- [ ] **Step 2: Derive AREA from DOMAIN in the three remaining fetchers and validate on skip**

`bake/fetch_event_benchmark.py`. After line 15 (`from event_catalog import EVENTS, event_files`), add:

```python
from domain import era5_area
from netcdf_extent import valid_netcdf
```

Line 19, before:

```python
AREA = [27, 50, 15, 70]  # north, west, south, east
```

After:

```python
AREA = era5_area()  # north, west, south, east — derived from bake/domain.py
```

Lines 64-68, before:

```python
                if target.exists() and target.stat().st_size > 0:
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
```

After:

```python
                if valid_netcdf(target, kind, AREA, GRID):
                    print(
                        f"[skip] {filename} ({target.stat().st_size / 1e6:.1f} MB)"
                    )
                    continue
                if target.exists():
                    print(f"[repair] cache does not cover {AREA}: {filename}")
                    target.unlink()
```

`bake/fetch_realism_era5.py`. Line 5, before `Seasons 2019/2021/2023, May-Nov, 00/06/12/18 UTC, 50-70E/15-27N, 0.5 deg —`, after `Seasons 2019/2021/2023, May-Nov, 00/06/12/18 UTC, over bake/domain.py's box at 0.5 deg —`. After line 16 (`from pathlib import Path`) add:

```python
from domain import era5_area
from netcdf_extent import valid_netcdf
```

Line 19, before `AREA = [27, 50, 15, 70]  # N, W, S, E — matches bake/fetch_era5.py`, after `AREA = era5_area()  # N, W, S, E — derived from bake/domain.py`. This fetcher's requests mix winds and RH in one file, so tag each request with its kind: change the two `out.append((` tuples in `requests()` to four-element tuples whose last element is `"wind"` for the pressure-level request (its variable list includes u, v AND r, but the `wind` variable set is the strict subset that must be present, and `EXPECTED_LEVELS['wind']` would reject its 200/600/700/850 levels — so use `None` for levels by tagging it `"rh"`? No: add a fourth kind). Add to `bake/netcdf_extent.py`:

```python
EXPECTED_VARIABLES["realism_plev"] = {
    "valid_time", "pressure_level", "latitude", "longitude", "u", "v", "r",
}
EXPECTED_LEVELS["realism_plev"] = {200, 600, 700, 850}
```

and tag the pressure-level request `"realism_plev"`, the SST request `"sst"`. Then lines 67-70, before:

```python
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
```

After:

```python
        if valid_netcdf(target, kind, AREA, GRID):
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        if target.exists():
            print(f"[repair] cache does not cover {AREA}: {filename}")
            target.unlink()
```

`bake/fetch_era5.py`. Line 23, before `counterfactual ever needs more lead-in. Area/grid match env.bin: 50-70E/15-27N, 0.5 deg.`, after `counterfactual ever needs more lead-in. Area/grid match env.bin: bake/domain.py at 0.5 deg.` After line 29 (`from pathlib import Path`) add the same two imports. Line 32, before `AREA = [27, 50, 15, 70]  # N, W, S, E`, after `AREA = era5_area()  # N, W, S, E — derived from bake/domain.py`. Add a fourth element to every entry of `REQUESTS` naming its kind — `"wind"` for `era5_climatology.nc`, `era5_gonu_2007.nc`, `era5_shaheen_2021.nc`; `"rh"` for the three `era5_rh_*` entries; `"sst"` for the two `era5_sst_*` entries — change the type annotation at line 40 to `list[tuple[str, str, dict, str]]`, and change line 206's loop header to `for filename, dataset, spec, kind in selected:`. Lines 208-210, before:

```python
        if target.exists() and target.stat().st_size > 0:
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
```

After:

```python
        if valid_netcdf(target, kind, AREA, GRID):
            print(f"[skip] {filename} already present ({target.stat().st_size / 1e6:.1f} MB)")
            continue
        if target.exists():
            print(f"[repair] cache does not cover {AREA}: {filename}")
            target.unlink()
```

Apply the same replacement to the Shaheen per-month sub-loop at lines 221-223. `select_requests` at :182-195 already indexes only `request[0]`, so it survives the 4-tuple unchanged; `bake/test_upper.py::test_fetch_select_requests` likewise only reads `request[0]` and `len()`.

*Expected:* `node bake/run-python.mjs bake/test_upper.py` prints seven `[PASS]` lines ending `[done] 7 upper-sidecar tests passed`, proving `select_requests` still works against the widened tuples. `node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import fetch_era5, fetch_realism_era5; print(fetch_era5.AREA, fetch_realism_era5.AREA)"` prints `[27.0, 50.0, 15.0, 70.0] [27.0, 50.0, 15.0, 70.0]`.

- [ ] **Step 3: Stop the two interpolators extrapolating, and assert the GMRT cache's extent**

`bake/era5.py:330`, before:

```python
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=False, fill_value=None)
```

After:

```python
    # fill_value=None EXTRAPOLATES. Fed a cache from a narrower request, that
    # fabricates an entire basin without a diagnostic. bounds_error=True turns
    # the same condition into a stack trace naming the out-of-range point.
    interp = RegularGridInterpolator((lat, lon), field, bounds_error=True)
```

`bake/era5_event.py:176-177`, before:

```python
        interp = RegularGridInterpolator((lat_asc, lon_native), plane,
                                         bounds_error=False, fill_value=None)
```

After:

```python
        # See bake/era5.py::_to_env_grid — extrapolation is a silent basin
        # fabrication, so a stale-extent cache must raise here instead.
        interp = RegularGridInterpolator((lat_asc, lon_native), plane,
                                         bounds_error=True)
```

This is zero-diff only if every env cell centre lies strictly inside the ERA5 axes. Prove it before trusting it: the env grid's extreme centres are 50.25/69.75 °E and 15.25/26.75 °N (`sources.lon_centers(40)`, `sources.lat_centers(24)`), while the ERA5 axes run 50.0..70.0 and 15.0..27.0 inclusive. Every centre is interior by 0.25°, so no query is on or outside a bound.

Now close the same hole on the terrain side, which the design does not mention: `sources.ensure_download` caches GMRT under the extent-blind filename `gmrt_terrain_med.nc`. First measure what the cached file actually reports:

```bash
node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); from scipy.io import netcdf_file; f=netcdf_file('data/raw/gmrt_terrain_med.nc','r',mmap=False); print([float(v) for v in f.variables['x_range'].data], [float(v) for v in f.variables['y_range'].data], [int(v) for v in f.variables['dimension'].data])"
```

Then insert the assert into `load_terrain`, immediately after line 100 (`f.close()`):

```python
    # The cache filename does not encode the extent, so a leftover file from a
    # different request would be reused silently and re-registered onto this
    # grid. Raise instead; delete data/raw/gmrt_terrain_med.nc and refetch.
    tol = 1e-6
    if (
        abs(x0 - DOMAIN[0]) > tol
        or abs(x1 - DOMAIN[1]) > tol
        or abs(y0 - DOMAIN[2]) > tol
        or abs(y1 - DOMAIN[3]) > tol
    ):
        raise ValueError(
            f"{path} covers x=({x0},{x1}) y=({y0},{y1}) but DOMAIN is "
            f"{DOMAIN}; delete the cached file and refetch"
        )
```

If the measurement in the first command shows GMRT snapping the range (for example `49.998`), widen `tol` to just above the observed error and record the observed numbers in the comment — do not silently loosen it to a round number.

*Expected:* The measurement prints x_range and y_range. If they are `[50.0, 70.0] [15.0, 27.0]`, `tol = 1e-6` stands. `node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import sources; e,l=sources.load_terrain(); print(e.shape, int(e.min()), int(e.max()), round(float(l.mean()),3))"` prints `(668, 1040) -5333 3722 0.394` or whatever the committed bake reported — the point is that it does not raise and the shape is `(668, 1040)`.

- [ ] **Step 4: Full suite and commit**

```bash
npm test
node bake/run-python.mjs bake/test_upper.py
node bake/run-python.mjs bake/test_events.py
npx vitest run test/bake-domain-mirrors.test.ts
git status --porcelain calibration docs public/data
```

Then:

```bash
git add bake/netcdf_extent.py bake/fetch_era5.py bake/fetch_event_benchmark.py bake/fetch_realism_era5.py bake/fetch_fidelity_benchmark.py bake/era5.py bake/era5_event.py bake/sources.py
git commit -m "fix(bake): validate cached NetCDF extent on every skip path and stop extrapolating"
```

*Expected:* `npm test` green. Both bake test scripts end `[done] N tests passed`. The guard test's `no must-follow bake module hardcodes the legacy box` case passes, now covering all four fetchers. `git status --porcelain calibration docs public/data` prints NOTHING.

- [ ] **Step 5: OPTIONAL live confirmation, only on a machine with a populated data/raw and a CDS token**

Nothing above proves the skip paths still recognise a *good* cache, because `data/raw/` is gitignored and absent on a fresh checkout. On a machine that has one, back it up first, then run each fetcher and read the output:

```bash
cp -r data/raw data/raw.backup
node bake/run-python.mjs -u bake/fetch_era5.py
node bake/run-python.mjs -u bake/fetch_realism_era5.py
```

Every line must start `[skip]`. A single `[repair]` line means either a genuinely stale cache (good — the check just did its job) or a false negative in `valid_netcdf` (bad — the file was deleted and must be restored from `data/raw.backup` before diagnosing).

*Expected:* Every printed line begins `[skip]`, and no `[submit]` or `[repair]` line appears. If `[repair]` appears, restore the named file from `data/raw.backup/` and open the file with h5py to compare its `latitude`/`longitude` arrays against `netcdf_extent.expected_axes([27.0,50.0,15.0,70.0],[0.5,0.5])` before changing anything.

---

### Task 33: Stream downloads, raise on quantization overflow, and drop the basin layer

**Files:**

```
Modify: bake/sources.py:14-22 (imports), :62-83 (ensure_download)
Modify: bake/bake.py:2-28 (module docstring), :148-188 (build_flowacc)
Modify: BINARY-FORMATS.md:200-209, :330-333
Modify: bake/README.md:43, :392-401
Test: test/integration-bins.test.ts:399-429
```

**Consumes:** `bake/domain.py::DOMAIN` from task P4-1 (already imported by `bake/sources.py`).

**Produces:** `flowacc.bin` with exactly three layers — `flowacc`, `flowdir`, `travmin` — at 2,779,152 bytes. `bake.py`'s local `q_u16(a, scale, name)` now takes a third `name` argument and raises `ValueError` instead of clipping. No public Python symbol changes.

- [ ] **Step 1: Name every consumer of the basin layer before deleting it**

Read-only. Run:

```bash
grep -rn -i --include=*.ts --include=*.py --include=*.md 'basin' src/ test/ bake/bake.py bake/hydrosheds.py BINARY-FORMATS.md bake/README.md
```

The complete consumer set, which the rest of this task must respect:

**Runtime, WebGL only, all already tolerant of a missing layer.** `src/render/index.ts:148` (`BASIN_NAMES = ['basin','basinid','basin_id','catchment']`), `:198-199`, `:787`, `:794`, `:800-803`, `:810`, `:824-830` (`buildBasinRG8Tex`, sets `hasBasin = true`), `:1171`. `src/render/context.ts:50-51` (`basin: WebGLTexture | null; hasBasin: boolean`). `src/render/textures.ts:191-195` (`buildBasinRG8Tex`). `src/render/rain.ts:86`, `:89`, `:201-217`, `:322`, `:325`. `src/main.ts:916-918` (comment only).

**The behavioural consequence, stated honestly.** `rain.ts:220` is `float net = mix(fallbackNet, routedNet, step(0.5, u_hasRouting));`. The committed `flowacc.bin` carries real `flowdir`/`travmin`, so `hasRouting` is 1 and the basin arm is ALREADY unreachable in production today. It is reachable only under `WIW_HYDRO_FALLBACK=1`, which zero-fills `flowdir`/`travmin` (`bake.py:157-158`). After this change that fallback bake degrades from basin-constrained elevation transport to unconstrained elevation transport, because `rain.ts:214`'s `sameB` becomes a constant 1.0 when `u_hasBasin` is 0. That is the whole cost, and it is confined to an explicitly labelled offline fallback.

**Do NOT delete the runtime code.** `gpu.basin ?? gpu.land` at `rain.ts:322` already dummy-binds and `u_hasBasin` already gates the arm, so leaving it costs nothing and keeps this task's diff inside `bake/`, the docs, and one test. Retiring the shader arm is a separate concern for a separate PR.

**Do NOT delete the basin computation.** `bake/bake_regions.py:185` calls `hydrosheds.load(NX, NY, landmask)` and uses its fourth return value to derive `regions.bin`'s `wadi` ids. `hydrosheds.py::_basins_from_direction` and `hydro.py::flow_accumulation_and_basins` both stay exactly as they are.

**A second, independent reason to drop it.** `bake.py:173` is `basin_clip = np.clip(basin, 0, 65535).astype(np.uint16)`. The committed layer's maximum id is 40,828 out of a 65,535 ceiling. Scaling by the 4.6× area increase of the new box puts the id count past uint16, at which point that `np.clip` silently collapses every basin above 65,535 into one. Dropping the layer removes the failure rather than deferring it.

*Expected:* The grep prints the sites listed above and no others. `node -e "const b=require('fs').readFileSync('public/data/flowacc.bin'); console.log(b.readUInt8(5), b.length)"` prints `4 4168680` — the pre-change state this task will move.

- [ ] **Step 2: Write the failing test**

In `test/integration-bins.test.ts`, replace lines 399-429. Before:

```ts
describe('flowacc.bin', () => {
  const bin = loadBin('flowacc.bin');
  it('ships observed ACC, exact D8 direction, travel time, and basin compatibility', () => {
    const acc = bin.layers.get('flowacc');
    const dir = bin.layers.get('flowdir');
    const travel = bin.layers.get('travmin');
    const basin = bin.layers.get('basin');
    expect(acc).toBeDefined();
    expect(dir).toBeDefined();
    expect(travel).toBeDefined();
    expect(basin).toBeDefined();
```

After:

```ts
describe('flowacc.bin', () => {
  const bin = loadBin('flowacc.bin');
  it('ships observed ACC, exact D8 direction, and travel time — and no basin layer', () => {
    const acc = bin.layers.get('flowacc');
    const dir = bin.layers.get('flowdir');
    const travel = bin.layers.get('travmin');
    expect(acc).toBeDefined();
    expect(dir).toBeDefined();
    expect(travel).toBeDefined();
    // `basin` is retired. The rain shader's basin arm is gated behind
    // u_hasBasin and is unreachable whenever flowdir/travmin carry values, so
    // the layer paid full grid weight for a dead compatibility path — and its
    // uint16 id space cannot survive a larger domain.
    expect(bin.layers.get('basin')).toBeUndefined();
    expect(bin.layers.size).toBe(3);
```

And replace line 427. Before:

```ts
    expect(allFinite(basin!.data)).toBe(true);
```

After:

```ts
    // uint16 at scale 1e-4 tops out at log10(1+acc) = 6.5535. The bake now
    // RAISES on overflow instead of saturating; this pins that the shipped
    // field is inside the range rather than resting on the ceiling.
    expect(range(acc!.data).max).toBeLessThan(6.5535);
```

Run it:

```bash
npx vitest run test/integration-bins.test.ts -t 'ships observed ACC'
```

*Expected:* Fails with `expected undefined not to be undefined` inverted — precisely: `AssertionError: expected ParsedLayer{ name: 'basin', ... } to be undefined`, followed by `expected 4 to be 3`. The `6.5535` assertion passes already, because the committed maximum is 5.3749.

- [ ] **Step 3: Make ensure_download stream, and make q_u16 raise**

`bake/sources.py` — add `import shutil` to the stdlib import block at lines 16-19 (alphabetical: after `import os`, before `import sys`). Then lines 75-76, before:

```python
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(part_path, "wb") as fh:
            fh.write(resp.read())
```

After:

```python
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(part_path, "wb") as fh:
            # Stream: the HydroSHEDS archives are tens of MB today and the
            # basin-wide GMRT mosaic will be an order larger. resp.read()
            # materialised the whole body before the first byte hit disk.
            shutil.copyfileobj(resp, fh, 1 << 20)
```

`bake/bake.py` lines 169-170, before:

```python
    def q_u16(a: np.ndarray, scale: float) -> np.ndarray:
        return np.clip(np.round(a / scale), 0, 65535).astype(np.uint16).ravel(order="C")
```

After:

```python
    def q_u16(a: np.ndarray, scale: float, name: str) -> np.ndarray:
        """uint16 quantization that RAISES on overflow instead of saturating.

        np.clip silently pinned anything above scale*65535 to the ceiling. At
        scale 1e-4 that ceiling is log10(1+acc) = 6.5535. The committed
        Arabian Sea field peaks at 5.3749; the Ganges-Brahmaputra-Meghna
        reaches about 6.345, a margin of roughly 3 %. A silent clip there
        would flatten the largest channel in the basin into the second
        largest, with nothing in the output to show it happened.
        """
        raw = np.round(np.asarray(a, dtype=np.float64) / scale)
        lo, hi = float(raw.min()), float(raw.max())
        if lo < 0.0 or hi > 65535.0:
            raise ValueError(
                f"{name}: uint16 quantization range [{lo:.0f},{hi:.0f}] leaves "
                f"[0,65535] at scale {scale:g} "
                f"(values [{lo * scale:.4f},{hi * scale:.4f}])"
            )
        return raw.astype(np.uint16).ravel(order="C")
```

This is byte-for-byte identical on the current data: the old path was `np.clip(np.round(a/scale), 0, 65535)` and no value was ever clipped.

*Expected:* `node bake/run-python.mjs -c "import sys; sys.path.insert(0,'bake'); import numpy as np, bake" ` imports cleanly (q_u16 is a closure, so this only proves the module parses). The real proof is the rebake in the next step.

- [ ] **Step 4: Drop the basin layer**

`bake/bake.py` lines 172-179, before:

```python
    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; max ~5.4 -> ~54000 < 65535
    basin_clip = np.clip(basin, 0, 65535).astype(np.uint16)
    layers = [
        Layer("flowacc", "uint16", True, nx, ny, 1, DOMAIN, acc_scale, 0.0, q_u16(flowacc_log, acc_scale)),
        Layer("flowdir", "uint8", False, nx, ny, 1, DOMAIN, 1.0, 0.0, flowdir.ravel(order="C")),
        Layer("travmin", "uint8", False, nx, ny, 1, DOMAIN, 1.0, 0.0, travmin.ravel(order="C")),
        Layer("basin", "uint16", False, nx, ny, 1, DOMAIN, 1.0, 0.0, basin_clip.ravel(order="C")),
    ]
```

After:

```python
    acc_scale = 1e-4  # stores log10(1+acc) to 4 decimals; ceiling 6.5535
    # `basin` is NOT written. It backed a rain-shader arm that is unreachable
    # whenever flowdir/travmin carry values (src/render/rain.ts:220), and its
    # uint16 id space is already 40,828 of 65,535 at this domain size. The ids
    # themselves are still computed: bake_regions.py derives regions.bin's
    # `wadi` layer from the same hydrosheds.load() return value.
    layers = [
        Layer("flowacc", "uint16", True, nx, ny, 1, DOMAIN, acc_scale, 0.0, q_u16(flowacc_log, acc_scale, "flowacc")),
        Layer("flowdir", "uint8", False, nx, ny, 1, DOMAIN, 1.0, 0.0, flowdir.ravel(order="C")),
        Layer("travmin", "uint8", False, nx, ny, 1, DOMAIN, 1.0, 0.0, travmin.ravel(order="C")),
    ]
```

Line 184, before:

```python
        f"      flowacc log10(1+acc) 0..{float(flowacc_log.max()):.2f} | {n_basins} basins | {_mb(path)}"
```

After:

```python
        f"      flowacc log10(1+acc) 0..{float(flowacc_log.max()):.4f} "
        f"of 6.5535 ceiling | {n_basins} basins (diagnostic; not written) "
        f"| {_mb(path)}"
```

And `bake/bake.py:9`, before `  public/data/flowacc.bin   HydroSHEDS ACC + DIR + travel time on the terrain grid`, after `  public/data/flowacc.bin   HydroSHEDS ACC + DIR + travel time on the terrain grid (3 layers; `basin` retired)`.

**Do not touch `hydrosheds.py:224`'s `max_log = float(flowacc_log.max()) or 1.0`.** It normalises `travmin` by the domain's own maximum, so turning it into an absolute reference would change `travmin` bytes and give this phase a second byte-diff cause. Phase 5 measures the number; a later phase pins it.

*Expected:* After the rebake in task P4-4, `node -e "const b=require('fs').readFileSync('public/data/flowacc.bin'); console.log(b.readUInt8(5), b.length)"` prints `3 2779152` — that is `8 + 88*3 + 1389440 + 694720 + 694720`.

- [ ] **Step 5: Update the two byte-contract documents**

`BINARY-FORMATS.md:202`, before `All four layers share the terrain grid and domain bbox:`, after `All three layers share the terrain grid and domain bbox:`. Delete line 209 entirely:

```
| `basin` | uint16 | outlet id retained for compatibility with pre-DIR clients |
```

Immediately after the table (which now ends at line 208), insert:

```markdown
`flowacc`'s uint16 quantization at scale `0.0001` has a hard ceiling of
`log10(1 + acc) = 6.5535`. `bake/bake.py` RAISES on overflow rather than
clipping: a saturated cell is indistinguishable from a genuine maximum, and the
largest channels are exactly the ones that would saturate. The Arabian Sea
field peaks at 5.3749.

The `basin` layer was retired. Its only consumer was a rain-shader transport
arm that `src/render/rain.ts` already gates behind `u_hasBasin` and that is
unreachable whenever `flowdir`/`travmin` carry values. The runtime treats the
layer as optional and needs no change.
```

`BINARY-FORMATS.md:332-333`, before:

```
may `Math.round` and compare ids safely. The name `basin` is deliberately
NOT reused (flowacc.bin owns it, different grid + id space).
```

After:

```
may `Math.round` and compare ids safely. The name `wadi` is deliberately NOT
`basin`: `flowacc.bin` used to carry a `basin` layer on a different grid with a
different id space, and reusing the name would have made two incompatible id
spaces look interchangeable. `flowacc.bin`'s layer is retired; the name stays
unused.
```

**The golden hex at `BINARY-FORMATS.md:150-196` and `bake/binfmt.py:250-251` is NOT touched.** It describes a synthetic two-layer 2×2 file and has nothing to do with `flowacc.bin`.

`bake/README.md:43`, before:

```
| `flowacc.bin` | `flowacc` (uint16 log), `flowdir` (uint8 D8), `travmin` (uint8 minutes), `basin` (uint16 compatibility) | 1040×668 | HydroSHEDS v1.1 ACC+DIR |
```

After:

```
| `flowacc.bin` | `flowacc` (uint16 log), `flowdir` (uint8 D8), `travmin` (uint8 minutes) | 1040×668 | HydroSHEDS v1.1 ACC+DIR |
```

`bake/README.md:395-396`, before:

```
decay and advances from simulated hours, not rendered frame count. `basin` stays
in the file so an older client can fall back safely.
```

After:

```
decay and advances from simulated hours, not rendered frame count. The `basin`
layer was retired: the runtime's basin arm is unreachable whenever `flowdir`
and `travmin` carry values, and the quantized `flowacc` field now raises rather
than clipping at its 6.5535 uint16 ceiling.
```

`bake/README.md:400-401`, before:

```
`flowdir`/`travmin`, and makes the runtime use its legacy elevation/basin
transport. A normal bake requires Rasterio and real HydroSHEDS inputs.
```

After:

```
`flowdir`/`travmin`, and makes the runtime use its legacy elevation transport.
Without the retired `basin` layer that transport is no longer basin-constrained
— that degradation is confined to this explicitly-labelled fallback. A normal
bake requires Rasterio and real HydroSHEDS inputs.
```

*Expected:* `grep -c 'basin' BINARY-FORMATS.md` drops from 6 to 4 (the four remaining hits are in the `regions.bin` `wadi` section). `grep -n 'basin' bake/README.md` no longer prints line 43. `grep -c '5749574201020000' bake/binfmt.py` still prints `1` and `npx vitest run test/loader.test.ts` still passes — the golden vector is untouched.

---

### Task 34: The phase gate: an old-domain rebake, byte-clean but for one named cause

**Files:**

```
Modify: public/data/flowacc.bin (regenerated by the bake)
Modify: calibration/asset-manifest.json (regenerated by npm run assets:manifest)
Test: test/integration-bins.test.ts, test/asset-manifest.test.ts, and the full vitest suite
```

**Consumes:** Every edit from tasks P4-1, P4-2 and P4-3. Nothing new is written by hand.

**Produces:** The Phase 4 exit condition: `git status --porcelain public/data` prints exactly one line, and `git status --porcelain calibration docs` prints exactly one line. Phase 6 inherits a bake pipeline it can widen with confidence.

- [ ] **Step 1: Establish the inputs before trusting the output**

The gate is meaningless if the raw inputs cannot be reproduced. `data/raw/` is gitignored and is ABSENT on a fresh checkout of this repository — confirmed by `ls data/raw` returning `No such file or directory`. Populate it first, and check the interpreter exists:

```bash
node bake/run-python.mjs -c "import numpy, scipy, h5py, rasterio; print('deps ok')"
ls -la data/raw
```

If `data/raw` is missing, three of the five sources download automatically on the next bake through `sources.ensure_download` (GMRT, OISST LTM, IBTrACS) and one more through `hydrosheds.ensure_download` (the two `hyd_eu_*_30s.zip` archives). The two ERA5 climatology files do NOT: `bake.py:83-86` raises `FileNotFoundError: data/raw/era5_rh_climatology.nc is required; run bake/fetch_era5.py`. Fetch them, which needs a `~/.cdsapirc` token and an accepted Copernicus licence:

```bash
node bake/run-python.mjs -u bake/fetch_era5.py era5_climatology.nc era5_rh_climatology.nc
```

Before rebaking, prove GMRT still returns the same grid it returned on 2026-07-25, because `terrain.bin` and therefore `flowacc.bin`'s grid depend on it:

```bash
node -e "const c=require('crypto'),f=require('fs');for(const p of ['data/raw/gmrt_terrain_med.nc','gmrt_50_70_15_27_med.nc']){try{console.log(p, f.statSync(p).size, c.createHash('sha256').update(f.readFileSync(p)).digest('hex'))}catch(e){console.log(p,'absent')}}"
```

`gmrt_50_70_15_27_med.nc` is an untracked 3,352,328-byte pull of the identical query made on 2026-08-09 and still sitting at the repository root. If its SHA-256 equals the cached `data/raw/gmrt_terrain_med.nc`, GMRT is reproducing and `terrain.bin` will come back byte-identical. If it differs, STOP and diff the arrays before running the bake — a changed GMRT tile would produce a `terrain.bin` byte diff that has nothing to do with anything in Phase 4, and would wrongly look like a gate failure.

*Expected:* `deps ok` prints. `data/raw/` contains at minimum `gmrt_terrain_med.nc`, `sst.ltm.1991-2020.nc`, `ibtracs.NI.csv`, `era5_climatology.nc`, `era5_rh_climatology.nc`, `hyd_eu_dir_30s.zip`, `hyd_eu_acc_30s.zip`. The two GMRT hashes are equal, or the discrepancy is understood and recorded before continuing.

- [ ] **Step 2: Run the rebake**

```bash
node bake/run-python.mjs bake/bake.py
```

This is the default five-file bake. It does NOT run the `events` path, so the ten `env_<event>.bin` files and `scenarios.json` are untouched, and it does not touch `ocean.bin`, `upper.bin`, `regions.bin` or `context-terrain.bin`, which have their own scripts.

Read three lines of the output specifically:
- `[assert] golden vector OK (196 bytes, byte-identical to BINARY-FORMATS.md; ...)`
- the `[3/5]` block's new headroom line
- the final `[asserts] golden-vector PASS | ACC-connectivity PASS`

*Expected:* The bake exits 0. The `[3/5]` block prints `      flowacc log10(1+acc) 0..5.3749 of 6.5535 ceiling | 40828 basins (diagnostic; not written) | 2.78 MB`. The golden-vector assert passes unchanged. `ACC-connectivity PASS`.

- [ ] **Step 3: Read the diff — this IS the gate**

```bash
git status --porcelain public/data
git diff --stat public/data
node -e "const b=require('fs').readFileSync('public/data/flowacc.bin');console.log('layers',b.readUInt8(5),'bytes',b.length);for(let i=0;i<b.readUInt8(5);i++){const a=8+88*i;console.log(' ',b.subarray(a,a+8).toString('ascii').replace(/\0+$/,''),b.readUInt32LE(a+12)+'x'+b.readUInt32LE(a+16))}"
```

The permitted result, exactly:

```
 M public/data/flowacc.bin
```

and nothing else. Specifically `terrain.bin`, `env.bin`, `genesis.json` and `tracks.json` must NOT appear. Their absence is what proves that every Phase 4 edit — the `domain.py` extraction, the derived GMRT URL, the new `bounds_error=True` interpolators, the streaming download, the raising `q_u16` — is genuinely zero-diff, and that the ONE named cause of the `flowacc.bin` change is the retired `basin` layer.

If any other file appears, do not proceed. Diagnose it: an `env.bin` diff points at the interpolator change or at a refetched ERA5 file; a `terrain.bin` diff points at GMRT; a `genesis.json` or `tracks.json` diff points at a refreshed IBTrACS CSV. None of those is acceptable in this phase.

Then close the loop on the manifest:

```bash
npm run assets:manifest
git status --porcelain calibration docs
git diff --numstat calibration/asset-manifest.json
```

*Expected:* `git status --porcelain public/data` prints exactly ` M public/data/flowacc.bin`. `git diff --stat public/data` shows one file changed and reports it as binary. The node dump prints `layers 3 bytes 2779152` followed by `flowacc 1040x668`, `flowdir 1040x668`, `travmin 1040x668`. After `npm run assets:manifest`: `wrote 33 asset hashes`, `git status --porcelain calibration docs` prints exactly ` M calibration/asset-manifest.json`, and `git diff --numstat` on it reports `1\t1\tcalibration/asset-manifest.json` — one line changed, the `flowacc.bin` hash moving off `366a56ab08d6fa2627d37e4aacc1a2fbb83147af7c557aa736046f676675f8de`.

- [ ] **Step 4: Run every gate the CI deploy workflow runs**

```bash
npm test
npm run calibrate:check
npm run hf6:verify:check
npm run hf6:gate:check
npm run hf6:prospective:check
npm run data:hf6:catalog:check
npm run realism:check
npm run build
```

None of these reads `flowacc.bin`: `calibration/fidelity.mjs` and `calibration/hindcast.mjs` read `terrain.bin`, and `calibration/realism/realism.mjs` reads `env.bin`, `terrain.bin` and `ocean.bin`. All three are unchanged, so every sealed number must be untouched. A drift in any of them means something outside the named cause moved.

*Expected:* `npm test` green, including the rewritten `flowacc.bin` case and `asset manifest > matches every static replay file under public/data byte-for-byte`. `calibrate:check` prints its three clean comparisons. All three HF-6 checks and the catalogue check pass. `realism:check` reports no drift. `npm run build` completes `tsc --noEmit` then `vite build` with no type error.

- [ ] **Step 5: Commit, with the exception stated in the message**

```bash
git add public/data/flowacc.bin calibration/asset-manifest.json bake/bake.py bake/sources.py BINARY-FORMATS.md bake/README.md test/integration-bins.test.ts
git commit -m "feat(bake)!: retire flowacc.bin's basin layer and raise on uint16 overflow

flowacc.bin drops from four layers to three (4,168,680 -> 2,779,152 bytes).
The basin arm in src/render/rain.ts is gated behind u_hasBasin and is
unreachable whenever flowdir/travmin carry values, and the layer's uint16 id
space already sits at 40,828 of 65,535 at this domain size. The ids are still
computed; bake/bake_regions.py derives regions.bin's wadi layer from them.

Quantization of flowacc now raises instead of clipping. The uint16 ceiling at
scale 1e-4 is log10(1+acc) = 6.5535 and the shipped field peaks at 5.3749.

This is the single permitted byte change of the bake-hardening phase: the
rebake left terrain.bin, env.bin, genesis.json and tracks.json byte-identical."
```

No AI attribution, no `Co-Authored-By` trailer.

*Expected:* `git show --stat HEAD` lists seven files. `git status --porcelain calibration docs public/data` prints NOTHING. `git log --oneline -1` shows the conventional-commit subject.

---

### Task 35: Reproduction probe: the tiled GMRT mosaic (scratchpad only)

**Files:**

```
Create: %TEMP%\wiw-nio-probe\probe_gmrt.py (OUTSIDE the repository)
Create: %TEMP%\wiw-nio-probe\out\gmrt\*.nc, verdict-gmrt.md (OUTSIDE the repository)
Modify: nothing inside D:\personal\wallah-its-windy
```

**Consumes:** `bake/domain.py::DOMAIN` and `bake/sources.py::TERRAIN_NX/TERRAIN_NY` from task P4-1, imported at runtime via a sys.path insertion. Nothing is written back.

**Produces:** A verdict block, in the shared template defined below, answering: does GMRT reproduce the committed single-tile pull, and does a 15-tile mosaic cover 45–100 °E / 0–30 °N at ≤ 2.14 km with no seam? Consumed by task P5-D and by Phase 6.

- [ ] **Step 1: Create the probe directory and move the stray artifacts out of the repository**

The repository root currently holds untracked probe leftovers from an earlier session: `gmrt_50_70_15_27_med.nc`, `gmrt_small.nc`, `gmrt_s_low.nc`, `gmrt_s_high.nc`, `gmrt_s_max.nc`, `woa_old.nc`, `woa_new.nc`, and `hs/` (four `hyd_*_dir_30s.zip` archives). Phase 5's gate is that nothing enters the repository, so move them out first — **move, do not delete**; `gmrt_50_70_15_27_med.nc` is the 2026-08-09 reproduction pull this task compares against.

```bash
mkdir -p "$TEMP/wiw-nio-probe/out/gmrt" "$TEMP/wiw-nio-probe/inherited"
cd /d/personal/wallah-its-windy
mv gmrt_*.nc woa_*.nc hs "$TEMP/wiw-nio-probe/inherited/"
git status --porcelain
```

*Expected:* `git status --porcelain` prints NOTHING — the repository is clean, tracked and untracked. `ls "$TEMP/wiw-nio-probe/inherited"` lists five `gmrt_*.nc`, two `woa_*.nc` and `hs/`.

- [ ] **Step 2: Answer the reproducibility half first — it is cheap and it is the one that can kill Phase 6**

Write `%TEMP%\wiw-nio-probe\probe_gmrt_repro.py`:

```python
"""Does a GMRT re-request of the committed query return the committed bytes?"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.getcwd(), "bake"))
import numpy as np
from scipy.io import netcdf_file

OLD = os.path.join("data", "raw", "gmrt_terrain_med.nc")
NEW = os.path.join(os.environ["TEMP"], "wiw-nio-probe", "inherited",
                   "gmrt_50_70_15_27_med.nc")


def digest(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def grid(path):
    f = netcdf_file(path, "r", mmap=False)
    x = [float(v) for v in f.variables["x_range"].data]
    y = [float(v) for v in f.variables["y_range"].data]
    d = [int(v) for v in f.variables["dimension"].data]
    z = f.variables["z"].data.astype(np.float64).reshape(d[1], d[0])
    f.close()
    return x, y, d, z


for label, path in (("committed", OLD), ("2026-08-09", NEW)):
    x, y, d, _ = grid(path)
    print(f"{label:12s} sha256={digest(path)} x={x} y={y} dim={d}")

_, _, d_old, z_old = grid(OLD)
_, _, d_new, z_new = grid(NEW)
if d_old != d_new:
    print(f"VERDICT: NOT REPRODUCIBLE — dimension {d_old} vs {d_new}")
    raise SystemExit(0)
delta = z_new - z_old
n_diff = int(np.count_nonzero(delta))
print(f"cells={z_old.size} differing={n_diff} "
      f"({100.0 * n_diff / z_old.size:.4f}%) "
      f"max|delta|={float(np.abs(delta).max()):.3f} m")
print("VERDICT: BIT-IDENTICAL" if n_diff == 0 else "VERDICT: N CELLS DIFFER")
```

Run it:

```bash
node bake/run-python.mjs "$TEMP/wiw-nio-probe/probe_gmrt_repro.py"
```

Note the `sys.path.insert(0, os.path.join(os.getcwd(), "bake"))` line: `run-python.mjs` sets `cwd` to the repository root but `sys.path[0]` to the SCRIPT's directory, so bake modules are not importable without it. Every probe script in Phase 5 needs that line.

*Expected:* Two `sha256=` lines and one `VERDICT:` line. `BIT-IDENTICAL` means Phase 6's terrain rebake carries no GMRT risk. `N CELLS DIFFER` with a small count and sub-metre deltas means Phase 6's `terrain.bin` will not reproduce byte-for-byte and the design's registration proof must be stated on cell indices, not bytes. `NOT REPRODUCIBLE` on dimension is a Phase 0 kill signal and must be escalated, not worked around.

- [ ] **Step 3: Probe one tile, then all fifteen**

Write `%TEMP%\wiw-nio-probe\probe_gmrt_mosaic.py`:

```python
"""Tile the GMRT GridServer over 45-100E / 0-30N and report the mosaic."""
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.getcwd(), "bake"))
import numpy as np
from scipy.io import netcdf_file

OUT = os.path.join(os.environ["TEMP"], "wiw-nio-probe", "out", "gmrt")
BOX = (45.0, 100.0, 0.0, 30.0)          # the nio-v1 target box
TILE_LON, TILE_LAT = 11.0, 10.0          # 5 columns x 3 rows = 15 tiles
TARGET_NX, TARGET_NY = 2860, 1670        # design table 4.1
ONLY_FIRST = "--one" in sys.argv


def url(lo0, lo1, la0, la1):
    return (
        "https://www.gmrt.org/services/GridServer?"
        f"minlongitude={lo0:g}&maxlongitude={lo1:g}"
        f"&minlatitude={la0:g}&maxlatitude={la1:g}"
        "&format=netcdf&resolution=med"
    )


def fetch(lo0, lo1, la0, la1):
    os.makedirs(OUT, exist_ok=True)
    name = f"gmrt_{lo0:g}_{lo1:g}_{la0:g}_{la1:g}_med.nc"
    path = os.path.join(OUT, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"[cache] {name} ({os.path.getsize(path)//1024} KB)")
        return path
    req = urllib.request.Request(
        url(lo0, lo1, la0, la1),
        headers={"User-Agent": "wallah-its-windy-probe/1.0"},
    )
    import shutil
    with urllib.request.urlopen(req, timeout=600) as resp, open(path, "wb") as fh:
        shutil.copyfileobj(resp, fh, 1 << 20)
    print(f"[get]   {name} ({os.path.getsize(path)//1024} KB)")
    return path


cover = np.zeros((TARGET_NY, TARGET_NX), dtype=np.int32)
d_lon = (BOX[1] - BOX[0]) / TARGET_NX
d_lat = (BOX[3] - BOX[2]) / TARGET_NY
total_bytes = 0
for row in range(int((BOX[3] - BOX[2]) / TILE_LAT)):
    for col in range(int((BOX[1] - BOX[0]) / TILE_LON)):
        lo0 = BOX[0] + col * TILE_LON
        la0 = BOX[2] + row * TILE_LAT
        path = fetch(lo0, lo0 + TILE_LON, la0, la0 + TILE_LAT)
        total_bytes += os.path.getsize(path)
        f = netcdf_file(path, "r", mmap=False)
        x0, x1 = [float(v) for v in f.variables["x_range"].data]
        y0, y1 = [float(v) for v in f.variables["y_range"].data]
        gnx, gny = [int(v) for v in f.variables["dimension"].data]
        z = f.variables["z"].data.astype(np.float64).reshape(gny, gnx)
        f.close()
        km_lon = (x1 - x0) / gnx * 111.32
        print(f"  tile ({lo0:g},{la0:g}) dim={gnx}x{gny} "
              f"cell={km_lon:.3f} km lon, requested=({x0:g},{x1:g},{y0:g},{y1:g})")
        glon = np.linspace(x0, x1, gnx)
        glat = np.linspace(y1, y0, gny)
        LON, LAT = np.meshgrid(glon, glat)
        c = np.floor((LON.ravel() - BOX[0]) / d_lon).astype(np.int64)
        r = np.floor((BOX[3] - LAT.ravel()) / d_lat).astype(np.int64)
        ok = (
            np.isfinite(z.ravel())
            & (c >= 0) & (c < TARGET_NX) & (r >= 0) & (r < TARGET_NY)
        )
        np.add.at(cover.ravel(), r[ok] * TARGET_NX + c[ok], 1)
        if ONLY_FIRST:
            break
    if ONLY_FIRST:
        break

holes = int((cover == 0).sum())
seams = int((cover > 1).sum())
print(f"target {TARGET_NX}x{TARGET_NY}={cover.size} cells")
print(f"uncovered={holes} ({100.0*holes/cover.size:.4f}%)")
print(f"multiply-covered={seams} ({100.0*seams/cover.size:.4f}%)")
print(f"downloaded={total_bytes/1e6:.1f} MB")
```

Run the single-tile form first — one request, about a minute, and it answers the design's `resolution=med` claim before committing to fifteen requests and roughly 23 minutes of server time:

```bash
node bake/run-python.mjs "$TEMP/wiw-nio-probe/probe_gmrt_mosaic.py" --one
node bake/run-python.mjs "$TEMP/wiw-nio-probe/probe_gmrt_mosaic.py"
```

*Expected:* The `--one` run prints one `tile (45,0) dim=NNNNxNNNN cell=X.XXX km lon` line. If `dim` is capped at 1140 columns, the cell size is 11°/1140 × 111.32 = 1.074 km — finer than the 0.019231° (2.141 km) target, so block-mean reduction is valid, and the design's 1140-column cap claim is confirmed. The full run prints fifteen tile lines then the coverage summary. The PASS condition is `uncovered=0 (0.0000%)`; `multiply-covered` may be non-zero only along tile boundaries (expect roughly `2*(4*1670 + 2*2860) ≈ 24,800` cells, under 0.6 %), and those are exactly the cells where the two contributing tiles must agree.

- [ ] **Step 4: Record the verdict**

Append to `%TEMP%\wiw-nio-probe\verdict-gmrt.md` using this template, which is shared by all three Phase 5 probes:

```markdown
## asset: GMRT terrain
probe date: <YYYY-MM-DD>
source: https://www.gmrt.org/services/GridServer?...&resolution=med
requests: 15 tiles of 11 x 10 deg over 45-100E / 0-30N

### reproduction of the committed pull
verdict: BIT-IDENTICAL | N CELLS DIFFER | NOT REPRODUCIBLE
evidence: sha256 old=<...> new=<...>; differing=<N> of <M> (<P>%); max|delta|=<X> m

### mosaic feasibility
verdict: SEAMLESS | HAS GAPS | NOT TILEABLE
evidence: tile dim=<gnx>x<gny>, cell=<X.XXX> km lon; uncovered=<N> (<P>%);
          multiply-covered=<N> (<P>%); downloaded=<X> MB in <T> min

### consequence for Phase 6
<one sentence: what Phase 6 can now assume, or which design decision this invalidates>
```

The file stays in the scratchpad. Nothing is committed, and nothing is written into `docs/`.

*Expected:* `%TEMP%\wiw-nio-probe\verdict-gmrt.md` exists with every `<...>` placeholder replaced by a measured number. `cd /d/personal/wallah-its-windy && git status --porcelain` prints NOTHING.

---

### Task 36: Reproduction probe: ERA5 at the new extent, into new filenames (scratchpad only)

**Files:**

```
Create: %TEMP%\wiw-nio-probe\probe_era5.py (OUTSIDE the repository)
Create: %TEMP%\wiw-nio-probe\out\era5\*.nc, verdict-era5.md (OUTSIDE the repository)
Modify: nothing inside D:\personal\wallah-its-windy
```

**Consumes:** `bake/netcdf_extent.py::valid_netcdf` and `expected_axes` from task P4-2; `bake/domain.py::era5_area` from task P4-1.

**Produces:** A verdict block in the P5-A template answering: what does a CDS request at `area=[30, 45, 0, 100]` cost in queue time and bytes, does it return the 111 × 61 axes the 0.5° registration requires, and does a re-request of the OLD extent return the same DATA as the cached file.

- [ ] **Step 1: Write the probe**

Create `%TEMP%\wiw-nio-probe\probe_era5.py`:

```python
"""Time and validate ERA5 at the nio-v1 extent; check old-extent reproducibility.

Writes into a scratchpad directory under NEW filenames. It must never write
into data/raw/: the repository's fetchers cache by filename, and a nio-extent
file under a legacy name would be silently consumed by an old-domain bake.
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.join(os.getcwd(), "bake"))
import numpy as np
from netcdf_extent import expected_axes, valid_netcdf

OUT = Path(os.environ["TEMP"]) / "wiw-nio-probe" / "out" / "era5"
NIO_AREA = [30.0, 45.0, 0.0, 100.0]   # N, W, S, E — the nio-v1 box
OLD_AREA = [27.0, 50.0, 15.0, 70.0]   # today's box
GRID = [0.5, 0.5]

REQUESTS = [
    # (filename, dataset, kind, area, spec)
    ("nio_era5_climatology.nc",
     "reanalysis-era5-pressure-levels-monthly-means", "wind", NIO_AREA,
     {"product_type": "monthly_averaged_reanalysis",
      "variable": ["u_component_of_wind", "v_component_of_wind"],
      "pressure_level": ["200", "250", "500", "850"],
      "year": [str(y) for y in range(1991, 2021)],
      "month": [f"{m:02d}" for m in range(1, 13)],
      "time": "00:00"}),
    ("nio_era5_rh_climatology.nc",
     "reanalysis-era5-pressure-levels-monthly-means", "rh", NIO_AREA,
     {"product_type": "monthly_averaged_reanalysis",
      "variable": ["relative_humidity"],
      "pressure_level": ["600", "700"],
      "year": [str(y) for y in range(1991, 2021)],
      "month": [f"{m:02d}" for m in range(1, 13)],
      "time": "00:00"}),
    # The reproducibility control: the EXACT legacy request, new filename.
    ("repro_era5_climatology.nc",
     "reanalysis-era5-pressure-levels-monthly-means", "wind", OLD_AREA,
     {"product_type": "monthly_averaged_reanalysis",
      "variable": ["u_component_of_wind", "v_component_of_wind"],
      "pressure_level": ["200", "250", "500", "850"],
      "year": [str(y) for y in range(1991, 2021)],
      "month": ["05", "06", "07", "08", "09", "10", "11"],
      "time": "00:00"}),
]


def main() -> int:
    import cdsapi
    OUT.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for filename, dataset, kind, area, spec in REQUESTS:
        target = OUT / filename
        if not target.exists():
            request = dict(spec, area=area, grid=GRID,
                           data_format="netcdf", download_format="unarchived")
            print(f"[submit] {filename} area={area}", flush=True)
            t0 = time.monotonic()
            client.retrieve(dataset, request, str(target))
            print(f"[done]   {filename} "
                  f"{target.stat().st_size / 1e6:.1f} MB "
                  f"in {time.monotonic() - t0:.0f} s", flush=True)
        lats, lons = expected_axes(area, GRID)
        ok = valid_netcdf(target, kind, area, GRID)
        print(f"  axes expected {len(lats)} lat x {len(lons)} lon; "
              f"valid_netcdf={ok}")

    # Reproducibility: compare DATA, not bytes. CDS regenerates the NetCDF
    # container per request, so container bytes always differ even when the
    # reanalysis values are identical.
    import h5py
    old = Path("data") / "raw" / "era5_climatology.nc"
    new = OUT / "repro_era5_climatology.nc"
    if not old.exists():
        print("VERDICT: NOT COMPARABLE — data/raw/era5_climatology.nc absent")
        return 0
    with h5py.File(old, "r") as a, h5py.File(new, "r") as b:
        for name in ("u", "v"):
            fa = np.asarray(a[name][...], dtype=np.float64)
            fb = np.asarray(b[name][...], dtype=np.float64)
            if fa.shape != fb.shape:
                print(f"VERDICT: NOT REPRODUCIBLE — {name} "
                      f"{fa.shape} vs {fb.shape}")
                return 0
            d = np.abs(fa - fb)
            n = int(np.count_nonzero(d))
            print(f"  {name}: cells={fa.size} differing={n} "
                  f"({100.0 * n / fa.size:.6f}%) max|delta|={float(d.max()):.6g}")
    print("VERDICT: see per-variable counts above")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

*Expected:* The file exists at `%TEMP%\wiw-nio-probe\probe_era5.py`. It is not inside the repository, so `git status --porcelain` still prints nothing.

- [ ] **Step 2: Run it and time the queue**

Requires a `~/.cdsapirc` token and an accepted Copernicus licence — the same prerequisites `bake/fetch_era5.py`'s docstring lists at lines 3-8. Install `cdsapi` into the bake venv first if it is not there (`bake/README.md` notes it is deliberately absent from `requirements.txt`):

```bash
node bake/run-python.mjs -m pip install cdsapi
node bake/run-python.mjs -u "$TEMP/wiw-nio-probe/probe_era5.py"
```

The `-u` flag is needed because CDS queue waits can run for minutes to hours and unbuffered output is the only progress signal.

Watch for two things beyond the timings:
- The first two requests are twelve months, not seven. The design commits to twelve-month completeness, and the queue cost of that is unmeasured until now.
- The `nio` requests span 55 × 30 degrees against today's 20 × 12 — 6.9× the fields at the same 0.5° grid.

*Expected:* For the two `nio` requests, `axes expected 61 lat x 111 lon; valid_netcdf=True`. 61 = (30−0)/0.5 + 1 and 111 = (100−45)/0.5 + 1, which is the 110 × 60 cell grid of design table 4.1 expressed as node counts. For the control request, `axes expected 25 lat x 41 lon; valid_netcdf=True`. Then per-variable lines for `u` and `v`. `differing=0` for both means ERA5 reproduces exactly and Phase 7's re-pick is the only source of env value change. A non-zero count means the reanalysis or the CDS conversion has moved and Phase 6's "values inside the old box should be unchanged" claim needs a stated tolerance rather than an equality.

- [ ] **Step 3: Record the verdict**

Write `%TEMP%\wiw-nio-probe\verdict-era5.md` in the P5-A template:

```markdown
## asset: ERA5 climatology (winds + mid-level RH)
probe date: <YYYY-MM-DD>
source: reanalysis-era5-pressure-levels-monthly-means, area=[30,45,0,100], grid=[0.5,0.5]

### new-extent cost
verdict: FEASIBLE | QUEUE-LIMITED | REJECTED
evidence: winds <X> MB in <T> s; rh <X> MB in <T> s; axes 61 lat x 111 lon;
          valid_netcdf=True for both; twelve months accepted in one request

### reproduction of the committed old-extent pull
verdict: BIT-IDENTICAL (data) | N CELLS DIFFER | NOT REPRODUCIBLE
evidence: u differing=<N> of <M> (<P>%) max|delta|=<X>;
          v differing=<N> of <M> (<P>%) max|delta|=<X>
note: container bytes always differ — CDS regenerates the NetCDF per request.

### consequence for Phase 6
<one sentence>
```

If CDS rejects a twelve-month, 55 × 30-degree request on cost — as it already does for the yearly realism pressure-level requests, per `bake/fetch_realism_era5.py`'s note dated 2026-07-30 — record `QUEUE-LIMITED` and the exact error text, and note that Phase 6 must split the request per month.

*Expected:* `verdict-era5.md` exists with measured numbers. `cd /d/personal/wallah-its-windy && git status --porcelain` prints NOTHING, and `ls data/raw | grep nio` returns nothing — the probe wrote only into the scratchpad.

---

### Task 37: Reproduction probe: the HydroSHEDS three-region mosaic and an absolute ACC_LOG_REFERENCE (scratchpad only)

**Files:**

```
Create: %TEMP%\wiw-nio-probe\probe_hydrosheds.py (OUTSIDE the repository)
Create: %TEMP%\wiw-nio-probe\out\hydrosheds\*.zip, verdict-hydrosheds.md (OUTSIDE the repository)
Modify: nothing inside D:\personal\wallah-its-windy
```

**Consumes:** `bake/hydrosheds.py::D8_TO_OFFSET` and `bake/domain.py::DOMAIN` from task P4-1. It deliberately does NOT call `hydrosheds.load`, which is hardwired to the `eu` region.

**Produces:** Three numbers Phase 6 cannot proceed without: the maximum `log10(1 + acc)` over the new box (which fixes the uint16 headroom and the value of `ACC_LOG_REFERENCE`), the same maximum recomputed over the old box from the mosaic (the reproducibility check against the committed 5.3749), and the count of cells where two regions overlap and disagree.

- [ ] **Step 1: Understand the coupling this probe exists to measure**

Read-only, but it decides what the probe must print. `bake/hydrosheds.py:224` is:

```python
    max_log = float(flowacc_log.max()) or 1.0
```

and lines 225-226 derive channel velocity from `flowacc_log / max_log`, which lines 242-244 turn into `travmin`. So `travmin` is normalised by **the domain's own maximum**, not by an absolute reference. The committed maximum is 5.3749. If the box grows to include the Ganges–Brahmaputra–Meghna at roughly 6.345, `max_log` rises by about 18 %, `strength` falls for every Arabian Sea cell, velocity falls, and **every `travmin` value in the old box changes** — a pure re-registration artifact with no hydrological meaning.

That is why the design asks for an absolute `ACC_LOG_REFERENCE`. This probe measures the number; it does not introduce the constant. Phase 4 deliberately left `hydrosheds.py:224` alone so its gate had exactly one byte-diff cause.

`bake/hydrosheds.py:25-34` currently pins one region:

```python
URL_DIR = (
    "https://data.hydrosheds.org/file/"
    "hydrosheds-v1-dir/hyd_eu_dir_30s.zip"
)
URL_ACC = (
    "https://data.hydrosheds.org/file/"
    "hydrosheds-v1-acc/hyd_eu_acc_30s.zip"
)
```

The new box needs `eu`, `as` and `af`. The `hs/` directory inherited in task P5-A already holds `hyd_af_dir_30s.zip` (14,601,343 B), `hyd_as_dir_30s.zip` (12,215,300 B) and `hyd_eu_dir_30s.zip` (12,603,455 B) — 39,420,098 B of DIR. No ACC archive is present; those must be fetched.

*Expected:* No command output. The three facts to carry forward: `travmin` depends on the domain maximum; three regions are needed; the DIR archives are already downloaded and only ACC must be fetched.

- [ ] **Step 2: Write and run the probe**

Create `%TEMP%\wiw-nio-probe\probe_hydrosheds.py`:

```python
"""Mosaic HydroSHEDS eu/as/af over 45-100E / 0-30N and measure ACC_LOG_REFERENCE."""
import os
import shutil
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.getcwd(), "bake"))
import numpy as np
import rasterio
from rasterio.windows import from_bounds

SCRATCH = os.path.join(os.environ["TEMP"], "wiw-nio-probe")
OUT = os.path.join(SCRATCH, "out", "hydrosheds")
INHERITED = os.path.join(SCRATCH, "inherited", "hs")
REGIONS = ("eu", "as", "af")
NIO = (45.0, 100.0, 0.0, 30.0)
OLD = (50.0, 70.0, 15.0, 27.0)


def archive(region: str, kind: str) -> str:
    name = f"hyd_{region}_{kind}_30s.zip"
    inherited = os.path.join(INHERITED, name)
    if os.path.exists(inherited):
        return inherited
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"[cache] {name} ({os.path.getsize(path)//1024} KB)")
        return path
    url = (f"https://data.hydrosheds.org/file/hydrosheds-v1-{kind}/{name}")
    print(f"[get]   {name}", flush=True)
    req = urllib.request.Request(
        url, headers={"User-Agent": "wallah-its-windy-probe/1.0"})
    with urllib.request.urlopen(req, timeout=1800) as resp, open(path, "wb") as fh:
        shutil.copyfileobj(resp, fh, 1 << 20)
    print(f"[ok]    {name} ({os.path.getsize(path)//1024} KB)")
    return path


def read(region: str, kind: str, box):
    path = f"zip://{archive(region, kind)}!hyd_{region}_{kind}_30s.tif"
    lo0, lo1, la0, la1 = box
    with rasterio.open(path) as src:
        print(f"  {region}/{kind}: native bounds={tuple(round(v,4) for v in src.bounds)} "
              f"res={src.res}")
        win = from_bounds(lo0, la0, lo1, la1,
                          src.transform).round_offsets().round_lengths()
        return src.read(1, window=win), src.window_transform(win)


def mosaic(box):
    stack, transform = None, None
    for region in REGIONS:
        data, tr = read(region, "acc", box)
        if stack is None:
            stack, transform = np.zeros_like(data, dtype=np.int64), tr
        elif data.shape != stack.shape or tr != transform:
            print(f"VERDICT: NOT REPRODUCIBLE — {region} window "
                  f"{data.shape}/{tr} != {stack.shape}/{transform}")
            raise SystemExit(0)
        valid = (data > 0) & (data != np.uint32(4294967295))
        overlap = (stack > 0) & valid
        disagree = int((stack[overlap] != data[overlap].astype(np.int64)).sum())
        print(f"  {region}: valid={int(valid.sum())} "
              f"overlap={int(overlap.sum())} disagreeing={disagree}")
        stack = np.where(valid & (stack == 0), data.astype(np.int64), stack)
    return stack, transform


for label, box in (("nio 45-100E/0-30N", NIO), ("old 50-70E/15-27N", OLD)):
    print(f"[{label}]")
    acc, _ = mosaic(box)
    log = np.log10(1.0 + acc.astype(np.float64))
    peak = float(log.max())
    print(f"  max log10(1+acc) = {peak:.6f}")
    print(f"  uint16 at scale 1e-4 ceiling = 6.5535 -> "
          f"headroom {100.0*(6.5535-peak)/6.5535:.2f}%")
    print(f"  quantized max raw = {round(peak/1e-4)} of 65535")
```

Run it:

```bash
node bake/run-python.mjs -u "$TEMP/wiw-nio-probe/probe_hydrosheds.py"
```

The ACC archives are roughly 88 MB across the three regions (the DIR archives total 39,420,098 B and ACC is the larger product), so the first run is a several-minute download.

*Expected:* Three `native bounds=` lines per box showing each region's coverage, then the overlap/disagreement counts, then two `max log10(1+acc)` lines. The **old-box** value is the reproducibility check: it must come back at 5.3749 to four decimals, matching `public/data/flowacc.bin`'s quantized maximum raw value of 53749. If it does not, either the mosaic priority order differs from `hydrosheds.load`'s single-region read or HydroSHEDS has been revised, and Phase 6's flowacc rebake carries an unattributed change. The **nio-box** value is the number that fixes `ACC_LOG_REFERENCE`; the design predicts about 6.345 with roughly 3.2 % headroom, and `quantized max raw` must print a value below 65535 or the uint16 encoding is dead on arrival and the design's D1 needs a wider dtype.

- [ ] **Step 3: Quantify the travmin coupling and record the verdict**

Add to the end of the probe and re-run:

```python
nio_peak = ...  # captured from the loop above
old_peak = ...
ratio = (old_peak / nio_peak) ** 0.5
print(f"travmin coupling: normalising by the nio maximum instead of the old "
      f"one scales every old-box `strength` by {ratio:.4f}, so velocity "
      f"2 + 8*strength falls and every routed travmin rises. This is why "
      f"ACC_LOG_REFERENCE must be absolute, and why Phase 4 did NOT touch "
      f"bake/hydrosheds.py:224.")
```

Then write `%TEMP%\wiw-nio-probe\verdict-hydrosheds.md`:

```markdown
## asset: HydroSHEDS v1.1 ACC + DIR
probe date: <YYYY-MM-DD>
source: https://data.hydrosheds.org/file/hydrosheds-v1-{acc,dir}/hyd_{eu,as,af}_{acc,dir}_30s.zip

### three-region mosaic over 45-100E / 0-30N
verdict: CO-REGISTERED | NOT CO-REGISTERED
evidence: per-region native bounds and res printed above; overlap cells=<N>;
          disagreeing cells=<N> (<P>% of overlap)

### reproduction of the committed old-box field
verdict: BIT-IDENTICAL | N CELLS DIFFER | NOT REPRODUCIBLE
evidence: mosaic max log10(1+acc) over 50-70E/15-27N = <X.XXXXXX>;
          public/data/flowacc.bin quantized max raw = 53749 -> 5.3749

### ACC_LOG_REFERENCE
value: <X.XXXXXX>  (max log10(1+acc) over 45-100E / 0-30N)
uint16 headroom at scale 1e-4: <P>% below the 6.5535 ceiling
travmin coupling: normalising by the new maximum scales old-box `strength`
          by <X.XXXX>; an absolute reference is required or every Arabian Sea
          travel time changes for a non-hydrological reason

### consequence for Phase 6
<one sentence>
```

*Expected:* The probe prints the coupling line with a ratio below 1 (the design's numbers give sqrt(5.3749/6.345) ≈ 0.9204, an 8 % drop in `strength`). `verdict-hydrosheds.md` exists with measured numbers. `cd /d/personal/wallah-its-windy && git status --porcelain` prints NOTHING.

---

### Task 38: Consolidate the three verdicts and confirm the repository is untouched

**Files:**

```
Create: %TEMP%\wiw-nio-probe\verdict.md (OUTSIDE the repository)
Modify: nothing anywhere
```

**Consumes:** `verdict-gmrt.md`, `verdict-era5.md` and `verdict-hydrosheds.md` from tasks P5-A, P5-B and P5-C.

**Produces:** One consolidated verdict document. It is pasted into the Phase 6 pull-request description; it is NOT committed, because the design scopes Phase 5 to the scratchpad and a dated note under `docs/` would put a hand-written file into a directory Phase 4's gate keeps clean.

- [ ] **Step 1: Assemble the three verdicts into one table**

```bash
cd "$TEMP/wiw-nio-probe"
cat verdict-gmrt.md verdict-era5.md verdict-hydrosheds.md > verdict.md
```

Then prepend a summary table with one row per asset and exactly one of the three permitted verdict words in the reproduction column:

```markdown
# nio-v1 Phase 5 — reproduction probe verdicts
date: <YYYY-MM-DD>
repository commit at probe time: <git rev-parse --short HEAD>

| asset | new-extent feasible | reproduces the committed pull | blocking? |
|---|---|---|---|
| GMRT terrain | <SEAMLESS/HAS GAPS/NOT TILEABLE> | <BIT-IDENTICAL / N CELLS DIFFER / NOT REPRODUCIBLE> | <yes/no> |
| ERA5 climatology | <FEASIBLE/QUEUE-LIMITED/REJECTED> | <BIT-IDENTICAL / N CELLS DIFFER / NOT REPRODUCIBLE> | <yes/no> |
| HydroSHEDS ACC+DIR | <CO-REGISTERED/NOT CO-REGISTERED> | <BIT-IDENTICAL / N CELLS DIFFER / NOT REPRODUCIBLE> | <yes/no> |

ACC_LOG_REFERENCE = <X.XXXXXX>
```

The `blocking?` column maps directly onto the design's kill criteria: a GMRT `NOT TILEABLE` kills D1's premise; an ERA5 `NOT REPRODUCIBLE` means Phase 6 cannot claim "values inside the old box are unchanged" and its registration proof must be restated as a tolerance; a HydroSHEDS `NOT CO-REGISTERED` means the flowacc rebake has no defined mosaic.

*Expected:* `verdict.md` exists with no `<...>` placeholder remaining. Every reproduction cell holds exactly one of the three permitted words — never a hedge, never "probably".

- [ ] **Step 2: Confirm the phase gate**

```bash
cd /d/personal/wallah-its-windy
git status --porcelain
git status --porcelain --ignored | grep -v -E '^!! (node_modules|dist|bake/\.venv|data/raw|public/data/live|tmp|\.gstack|\.playwright-mcp|\.superpowers)' 
ls "$TEMP/wiw-nio-probe/out"
```

Phase 5's whole contract is that nothing entered the repository. The first command is the gate.

*Expected:* `git status --porcelain` prints NOTHING — no modified file, no untracked file. The ignored listing shows only the entries `.gitignore` already declares plus any `__pycache__/` directories. `ls` on the scratchpad shows `era5/`, `gmrt/` and `hydrosheds/` holding every downloaded byte, none of it inside D:\personal\wallah-its-windy.


**Unverified in this phase — the implementer must check:**

- `data/raw/` is ABSENT on this machine (`ls data/raw` -> No such file or directory) and `bake/.venv` does not exist either. Every claim in task P4-4 about the rebake being byte-clean is therefore UNVERIFIED by me — I could not run the bake. The implementer must populate the raw cache and create the venv first, and must treat the GMRT hash comparison in P4-4 step 1 as a real gate, not a formality: a changed GMRT tile would produce a `terrain.bin` byte diff with no relation to any Phase 4 edit.
- The two ERA5 climatology files cannot be fetched without a personal CDS token and an accepted Copernicus licence (`bake/fetch_era5.py:3-8`). Without them `bake.py:83-86` raises before it reaches `build_flowacc`, so the Phase 4 gate cannot run at all. This blocks P4-4 entirely on a machine without CDS credentials.
- I did not verify that `bake/public_cycle.py`'s import block will accept `from domain import DOMAIN` at the position I describe — I read only lines 60-75 of that 890-plus-line file. The implementer must run `sed -n '1,40p' bake/public_cycle.py` and place the import with the other first-party imports before editing line 69.
- I could not confirm that `rasterio` and `h5py` are installed in the bake venv, because the venv does not exist. `bake/netcdf_extent.py` imports h5py lazily inside `valid_netcdf`, so a missing h5py surfaces only when a fetcher runs — and it would surface as a plain ImportError, not as a `[repair]`. The P5-C probe needs rasterio and will fail immediately without it.
- `bake/fetch_realism_era5.py`'s pressure-level request mixes u, v AND r in one file at levels 200/600/700/850, which matches none of the three existing `kind` taxonomies. I added a fourth `realism_plev` kind, but I could not open one of those cached files to confirm the variable names h5py actually reports (`u`, `v`, `r`) at the new CDS converter. If the names differ, `valid_netcdf` returns False for every realism file and the `[repair]` path would delete a valid cache — hence the mandatory `cp -r data/raw data/raw.backup` in P4-2's optional step.
- The `bounds_error=True` change in `bake/era5.py:330` is zero-diff only because every env cell centre is interior by 0.25 degrees. That reasoning holds for the 40x24 climatology grid. It does NOT automatically hold for `bake/era5_event.py`, whose native ERA5 axes may be flipped or trimmed differently per event file (`:174`'s `field3d[p, ::-1, :] if flip`). I verified the code path but not an actual event bake, so the implementer must run `node bake/run-python.mjs bake/bake.py events` on a machine with the event caches and confirm the ten `env_<event>.bin` files come back byte-identical before assuming that edit is free.
- `bake/README.md:34` says the bake is macOS/Python 3.14/numpy 2.x. This is a Windows dev box. `np.add.at` and `np.maximum.at` behaviour is stable across platforms, but the block-mean reduction in `sources.load_terrain` uses `np.bincount` on float64 sums, which is order-dependent in principle. If `terrain.bin` fails to reproduce byte-for-byte on Windows against a macOS-baked committed file, that is a platform issue and NOT a Phase 4 regression — diagnose before reverting anything.
- Phase 4 is the one deliberate exception to the Seam A rule that nothing outside src/ and test/ changes. Two committed files move: `public/data/flowacc.bin` and `calibration/asset-manifest.json`. If the reviewer applies the Seam A rule literally to Phase 4, the phase looks like a violation. The commit message in P4-4 step 5 states the exception explicitly for exactly this reason.
- I did not verify the design's claim that the Ganges-Brahmaputra-Meghna reaches log10(1+acc) of about 6.345 — that number comes from the design document, not from a measurement I made. Task P5-C measures it. If the true value exceeds 6.5535, the uint16 encoding at scale 1e-4 cannot represent the new domain at all and the flowacc format itself must change, which is outside every phase in this plan.
- `bake/realism_env_variance.py:227` is a legacy-box mirror the design omits entirely. I classified it deferred and excluded it from Phase 4 because it writes into `calibration/` and `docs/`, both of which Phase 4's gate requires to be clean. Whoever owns the phase that refetches the realism ERA5 cache must pick it up, or the generated `docs/research/realism/env-variance-study.md` will keep asserting a domain the data no longer has.

---
