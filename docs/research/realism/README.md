# Realism research evidence

Captures: docs/research/realism/captures/<storm>/<stage>-{sim|obs}.webp,
1600×900 viewport, WebP quality 82, ≤ 250 KB each. Observed-side external
images are committed only under a redistribution-compatible licence
(NASA Worldview/GIBS OK); otherwise the session log records URL + access date.

Compression (repo venv, no new tools):
node bake/run-python.mjs -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'WEBP', quality=82)" in.png out.webp

## Register entry schema (copy verbatim for each entry)

### RGR-NNN — <short title>
- subsystem: ir-clouds | vis-clouds | radar-rain | environment
- stage: genesis | intensification | peak | shear-decay | landfall | dissipation | all
- evidence: <capture pair paths and/or citation and/or study numbers>
- description: <what the real product shows vs what the sim shows>
- class: presentation | data | physics
- severity: high | medium | low   (visibility to a satellite-literate viewer)
- candidate metric: <deterministic field-space quantity, presentation-class only>
- rough cost: S | M | L
- disposition: close-now | hf7-charter | rejected
