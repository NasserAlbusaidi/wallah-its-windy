# HF-4 Node runtime migration

- **Status:** Accepted
- **Date:** 2026-07-28
- **Decision owner:** Repository owner

## Context

The A3 ocean-profile provenance change requires the HF-4 and HF-6 sealed
artefacts to refresh their runtime source hashes. The first authorized HF-4
refresh also changed one canonicalized metric:

`sourceAblations.initialization["24"]` moved from `23.860182716` to
`23.860182715`.

A forensic reproduction restored every HF-4 hashed input to the bytes recorded
by the original 2026-07-21 seal. Under the current Node 24.18.0 runtime, the
same one-digit result persisted and every other canonicalized metric reproduced
byte-for-byte. The unrounded current result,
`23.860182714892150813`, lies close enough to the nine-decimal rounding
boundary for accumulated cross-runtime `libm` variation to select the adjacent
canonical value. Repeated runs in the current environment were bit-identical.

The interpreter that produced the original seal is no longer installed. The
source change made after that seal was independently shown to be dynamically
inert for this metric.

## Decision

Node 24.18.0 is the exact runtime for local sealed reproduction and CI:

- `.node-version` pins local version managers.
- `.github/workflows/deploy.yml` pins `actions/setup-node`.
- `CLAUDE.md` records the same version.

The repository owner explicitly authorized regenerating HF-4 and HF-6 through
their scripts on 2026-07-28. The permitted scientific-data change is limited to
the adjacent canonical HF-4 value above and its copy in the HF-4 acceptance
record. The A3 runtime source hashes and resulting verification-hash cascade
may also change. No threshold, status, decision, case, or rejected verdict may
change.

The canonicalization contract remains at nine decimal places. Changing it
would rewrite the measurement contract and unnecessarily invalidate the wider
sealed surface.

## Consequences

- `23.860182715` becomes the reproducible canonical value for the pinned
  runtime; it is not interpreted as a physical improvement or regression.
- HF-4 remains rejected. Its gate only requires this spread to be non-zero.
- HF-6 remains rejected, with unchanged scored results and verdict.
- Any future Node version change requires an explicit reproducibility review
  before sealed artefacts are refreshed.
