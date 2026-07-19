# TODOS

Parked scope, each pointing at the design-doc section that specifies it. The
design doc is the single source of truth: `~/.gstack/projects/Personal/nasseralbusaidi-none-design-20260719-211840.md`.

## Deferred features (v1.2+ candidates)

- **GIF / satellite-loop export** — capture a 10s storm-hitting-coast clip for
  sharing. Design doc: "Approach C: Forecaster console" + Distribution Plan
  ("The capture is the marketing"). Held as a v1.2 candidate.
- **DIR flood pulse** — use the HydroSHEDS DIR basin-ID layer to send a timed
  flood pulse downstream, beyond the basin-glow approximation. Design doc:
  "Basin-glow transport (outside voice D9)" and eng task T9.
- **NHC-style advisories** — auto-write forecast-office advisory text for the
  user's own storm. Design doc: "Approach C: Forecaster console" (advisories +
  warning cones). Delight bomb; competes with physics tuning, so parked.
- **Mobile** — touch spawn, responsive chrome, DPR/perf budget for phones.
  Design doc: "Skip in weekend one: ... mobile". Explicitly out of v1.0.

## v1.1 (weekend two) — tracked in the design doc, not here

- IBTrACS ghost tracks for Gonu 2007 + Shaheen 2021 (design "Weekend two", item 1).
- Tuning pass incl. dry-air decay term (design item 2; eng task T11).
- Counterfactual env-field toggle (design item 3; first to be cut).

## Foundation seams left for later builders

- Sim engine plugs into `src/main.ts` `tickSim()` / spawn seams (eng task T2).
- Render layers composite in `render()` in luminance order (design Visual Design).
- Data manifest in `main.ts` grows to terrain.bin / env.bin / flowacc.bin once
  `bake/bake.py` emits them (eng task T4; see BINARY-FORMATS.md).
