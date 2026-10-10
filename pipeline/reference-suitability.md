# Reference Suitability Verdict — Slime Agent

Rubric: `grimoire/intake/validation_rubric.md`.

**Verdict: conditional -> `character-conditional -> stylized`** (proceed with the standard character
pipeline; not a reject).

## Pass criteria met
- One obvious target: a single humanoid character per view panel on a clean light-gray background.
- Subject fills the crop (figure ~584 of 615 px tall in `reference/front.png`).
- Strong silhouette in all four observed views (front / 3/4 / side / back).
- Major materials visible (slime skin, black nylon, white cotton, white/black plastic, glass, metal).
- Hidden sides are observed, not inferred: the sheet is a full turnaround (front, 3/4, right side,
  back) — `reference/side.png`, `reference/back.png`, `reference/three-quarter.png`.
- Approximable with procedural primitives (ellipsoids, capsules, lathe/extrude profiles, tubes,
  blobby metaball-like hair locks).

## Why conditional (not plain pass)
- Organic slime body/hair and cloth folds: user accepts stylization (toon/semi-glossy game look);
  stylized-clump hair and fold-normal garments, not strand/drape simulation.
- Crop resolution is low (400x615; `probe_image.py` -> technicalSuitability=conditional, "low
  resolution"): micro-details (rivets, stitching, tread) will be stylized procedurally.
- The ink tank is transparent glass with liquid: the rubric's reject clause targets subjects that
  rely primarily on glass/liquid; here it is one accessory and is rendered as a stylized
  MeshPhysicalMaterial glass shell + opaque turquoise liquid cylinder — no caustics required.
- No brand/logo/text fidelity required.

## Stylization level
Chibi/stylized: ~2.9 heads incl. hair mass, ~4.2–4.5 skull heads (measured, see
`pipeline/image-analysis.md`). NOT realistic 7.5-head canon. Likeness route: stylized (not
projection-first maximum likeness) — the reference is an illustrated toon render with flat fills
and ink outlines, whose pixels carry baked toon shading and line art that would read wrong if
projected onto a lit 3D mesh.
