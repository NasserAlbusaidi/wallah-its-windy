# Contributing

Small project, strict invariants. Read `CLAUDE.md` first — it is the operating
contract for humans and AI sessions alike, and PRs that break its rules
(determinism, frozen gates, product honesty) are rejected regardless of code
quality.

## Setup

```bash
npm ci          # Node 24.x (CI pins 24.18.0); zero runtime deps by design
npm test        # full vitest suite — run before claiming anything works
npm run build   # tsc --noEmit + vite build
```

The Python bake pipeline (`bake/`) is only needed to regenerate data. It runs
from the repository-owned venv (`bake/.venv`) — see `bake/README.md`. Most
contributions never touch it.

## Before opening a PR

The CI deploy gate runs, in order: `npm test`, `npm run calibrate:check`,
`npm run hf6:verify:check`, `npm run hf6:gate:check`,
`npm run hf6:prospective:check`, `npm run build`. Run them locally first.
`npm run assets:check` must show no `public/data/` diff unless your PR is a
deliberate, documented rebake.

- One PR, one concern.
- Conventional commit messages (`feat:`, `fix:`, `docs:`, ...).
- A physics or calibration change that alters `calibrate:check` output is a
  gated recalibration, not a bugfix — open an issue first.
- Adding a runtime npm dependency is a design decision to raise in an issue,
  not a convenience; `dependencies` is empty on purpose.

## Machine-generated files — never edit by hand

| File | Regenerate with |
|---|---|
| `docs/fidelity-benchmark.md` | `npm run fidelity` |
| `docs/hindcast-benchmark.md` | `npm run calibrate:intensity` |
| `docs/structure-calibration.md` | `npm run calibrate:structure` |
| `docs/hf6-scorecard.md` | `npm run hf6:gate` |

Hand edits are reverted by the next run and make the report lie about the code.

## Frozen scientific artifacts — never edit at all

`calibration/*-acceptance.json` and `*-contract.json` are sealed before
scoring. Rejected gates (HF-2, HF-3, HF-4, the HF-6 sealed first look) stay
rejected; re-running a gate to flip a verdict invalidates the whole protocol.
The storm splits (fidelity 18/6/6, hindcast 7/3, structure holdout) are
frozen — moving a storm across a split boundary is holdout leakage.
