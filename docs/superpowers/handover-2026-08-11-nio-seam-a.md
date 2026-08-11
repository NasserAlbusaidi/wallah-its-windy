# Handover — NIO domain expansion, Seam A

**Branch:** `feat/nio-seam-a` · **As of:** 2026-08-11 · **State:** 19 of 39 tasks complete, tree clean, all gates green.

This branch is Seam A of the northern Indian Ocean domain expansion: moving the
simulation domain from 50–70 °E / 15–27 °N to 45–100 °E / 0–30 °N.

**Seam A changes no behaviour.** Every commit is provably a no-op against
committed data, so that when Seam B moves the domain, each resulting diff has
exactly one cause. That is the whole design.

Design: [`specs/2026-08-09-nio-domain-expansion-design.md`](specs/2026-08-09-nio-domain-expansion-design.md) ·
Plan: [`plans/2026-08-10-nio-domain-expansion-seam-a.md`](plans/2026-08-10-nio-domain-expansion-seam-a.md)

---

## 1. Read the ledger first — it is NOT in git

The full task-by-task record lives at:

```
.superpowers/sdd/2026-08-10-nio-domain-expansion-seam-a/progress.md
```

`.gitignore:15` ignores `.superpowers/`, so **that file does not exist on the
remote or in any fresh clone.** It holds every ruling, measurement and
correction made during execution. This handover is the durable extract; the
ledger is the detail. If you have the original working tree, read it. If you do
not, `git log` plus this document is the recovery path.

## 2. Where things stand

| Phase | Tasks | State |
|---|---|---|
| 0 — reconnaissance | 1–7 | complete; no kill criterion fired |
| 1A — split the domain constant | 8–12 | complete |
| 1B — close silent failures | 13–17, plus inserted 16B | complete |
| 2 — freeze and reframe HF-6 | 18 done; **19 is next** | in progress |
| 3 onward | 20–38 | not started |

Test suite 722 → **789**. `npm test`, `npm run build`, `calibrate:check`,
`hf6:verify:check`, `hf6:gate:check`, `hf6:prospective:check` and
`realism:check` all pass — verified by observed exit code, not by report.

Three provenance reseals landed, each proven to move only `*Sha256` fields.

**To resume:** extract the next brief and dispatch it.

```bash
.claude/plugins/cache/superpowers-marketplace/superpowers/6.2.0/skills/subagent-driven-development/scripts/task-brief docs/superpowers/plans/2026-08-10-nio-domain-expansion-seam-a.md 19
```

## 3. Three decisions the human still owes

### 3.1 Two different land predicates drive physics

- `src/main.ts` → `src/ui.ts` `isLand` uses **nearest neighbour**.
- `src/ensemble.worker.ts` uses **bilinear** (`sampleLayerBilinear(...) > 0.5`).

Near a coastline these disagree, so part of the ensemble spread is a sampler
artifact rather than the perturbation being modelled. This predates the
expansion and is documented, not fixed, in `sampleLayerNearest`'s JSDoc.

The new domain adds the whole northern Indian Ocean rim, multiplying the
coastline where they disagree. Either unify them — accepting track changes and
a reseal — or document the asymmetry deliberately. **Decide before Seam B.**

### 3.2 `src/tracks.ts:126`

`if (!inBBox(p.lat, p.lon, DOMAIN)) continue;` filters observed track fixes
against the **live** domain. It is a scoring path (`fidelity.mjs`,
`hf3-wander-calibration.mjs`, hindcast) *and* a runtime path (the UI consumes
the same parsed tracks).

Pin it to `SCORING_DOMAIN` and the shipped map permanently hides real observed
fixes over the newly visible ocean. Leave it live and every sealed score that
consumes `parseTracks` moves at the flip. The likely answer is splitting the
function. **Not safe to defer past the domain flip.**

### 3.3 `basin` overflows uint16 at the new domain

Basin ids are a sequential per-outlet counter (`next_id` in
`bake/hydrosheds.py`), so the maximum scales with land-cell count. Measured
today: **40,828 of 65,535** — it breaks at a growth factor of 1.61×, and the
grid grows **6.9×** in cells while adding far more land (India, Pakistan, the
Horn of Africa, Myanmar).

`quantize_u16(basin, 1.0, "basin")` will therefore raise at the rebake. That is
Task 17's guard working as designed, but it is a **scheduled break, not a
hypothesis**. The fix is a wider dtype, which touches the three-way matched set:
`bake/binfmt.py` (writer), `src/loader.ts` (reader), `BINARY-FORMATS.md`
(contract), and possibly the golden hex vector. Plan it into Seam B.

Contrast `flowacc`, which is log₁₀-compressed: 15.1× headroom against 6.9×
growth, so plausibly fine.

## 4. Constraints Seam B must respect

**Ordering — the `hf6-verify.mjs` repoint must precede the rebake.** Three
obligations converge on that one file:

1. Task 8 deferred its `SCORING_DOMAIN` repoint because the file hashes its own
   bytes (`runtimeVerifierSha256`) — editing it breaks its own gate. **Task 20
   must pick this up. No in-code reminder exists, deliberately.**
2. Task 18 froze `terrain.bin` and `ocean.bin` into
   `calibration/data/hf6/forcing/`, but `hf6-verify.mjs` still reads
   `public/data/`. The frozen copies are inert until repointed.
3. If the rebake lands first, `hf6:verify:check` compares rebaked live bins
   against old sealed hashes and fails. Arguably correct fail-safe behaviour,
   but it must be a deliberate sequencing decision, not a surprise.

**The `worldMetricX` pin must go red.** `test/grid.test.ts` holds the only
absolute anchor of the east–west anisotropy, written with bare literals. Seam B's
flip *will* fail it. That is by design — decide the new anisotropy explicitly;
do not absorb it.

**GLSL half-height interpolation is integer-fragile.** Six sites in
`render/cloud-memory.ts`, `render/cloud-motion.ts` and `render/env.ts`
interpolate `${HALF_DOMAIN_HEIGHT_KM}.0` into shader source. Today 666, at
0–30 °N 1665 — both integers, so the planned domain does not trip it. Any
fractional half-height emits `1234.5.0` and fails **shader compilation**, not a
test. `render/radar.ts:153` already guards this with `.toFixed(1)`; the other
six do not.

**Texture-reducer wiring carries three recorded risks.** Non-power-of-two
factors leave the reduced extent wider than the source; `fitFactor` fails *open*
while `probeCaps` fails *closed*, so a caller bypassing the probe reproduces the
silent-black failure the module exists to prevent; and `majorityReduce` throws
on non-binary input, which blanks a render rather than degrading it once wired.

**The atomic download path has no automated test.** Task 17 routed all three
`client.retrieve()` calls through a `.tmp` sibling plus `Path.replace()`.
Verifying it needs a mocked `cdsapi.Client`, and `cdsapi` is not installed in
`bake/.venv`. It is the least-verified part of the largest change in that task,
and Seam B exercises it against every ERA5 fetch. Test it before the first real
rebake.

**`bake/.venv` is a plan gap.** Task 17 needs it; no task creates it. It was
built during Phase 0 reconnaissance.

## 5. What the review loop kept catching

One defect class dominated: **documentation and guards claiming more than the
code does.** Five instances, none of which changed shipped behaviour, all of
which would have misled the next reader.

- A comment asserting bit-exactness that was one ULP wrong.
- An "unreachable" claim falsified by a test in the same commit.
- A reachability guard omitting one of the two paths its own docs named.
- A coverage docstring implying all physics bins were protected.
- A regression test that stayed green when its own regression was reintroduced —
  caught only by a reviewer running **mutation testing**.

Two working rules came out of it:

- **A guard nobody has watched fail is not yet a guard.** Every guard on this
  branch was demonstrated red before being accepted. That standard caught a bug
  in a coordinator-authored brief.
- **For `src/main.ts`, source-text assertions must pin the conditional or the
  ordering, never a bare identifier** — identifiers leak into comments. `main.ts`
  is ~2600 lines that no unit test can import, so its only guarantees are regex
  assertions and live browser proof.

Also: the plan's `*Expected:*` blocks are **predictions the author never ran**.
Six were proven wrong or stale — impossible git statuses, tests claimed passing
that could not have, wrong error codes, wrong line numbers. Treat them as
unverified and re-check every line number against the tree.

## 6. Rules learned the hard way

**Provenance reseals are permitted, under proof** — see design §7.1, added
mid-execution. `calibration/hf6-verify.mjs` hashes the raw bytes of eight
runtime sources, so a *comment* change to `src/sim.ts` fails the gate. A reseal
commit must show: sealed diff contains only `*Sha256`; acceptance diff contains
only `verificationSha256`; both remaining HF-6 gates pass afterwards. Fail any
one and it is a result change, not a reseal. **This does not reopen HF-6's
verdict, which stays REJECTED.**

**Phase 2's gate inverts.** Tasks 8–17 had to leave `calibration/` untouched.
Phase 2 tasks deliberately add files there. The gate becomes: additions only,
**zero modifications**, with `docs` and `public/data` clean.

**Never put the bin-extent guard in `src/loader.ts`.** `parseBin` also reads
`public/data/context-terrain.bin` (875×550 on 45–80 °E / 8–30 °N,
presentation-only). A loader-level guard rejects it. The same trap exists in
`main.ts`'s `routeLoaded`, which routes that bin too — hence the
`CONTEXT_TERRAIN_KEY` exclusion there.
