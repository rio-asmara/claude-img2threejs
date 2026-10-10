# Slime Agent: image → procedural Three.js (img2threejs)

A code-only, procedural Three.js reconstruction of the character sheet in
[`reference/slime-agent-sheet.jpg`](reference/slime-agent-sheet.jpg), built with the
[img2threejs](https://github.com/img2threejs/img2threejs) pipeline (staged spec → build → gated review).
There are no mesh files, textures or downloaded assets. Every surface comes from TypeScript in
[`src/model/`](src/model).

**Live viewer:** https://rio-asmara.github.io/claude-img2threejs/ (deployed by `.github/workflows/deploy-pages.yml` on every push to the default branch).

![Reference vs render](renders/review/comparison-sheet.png)

*Left of each pair: reference crop. Right: headless WebGL render of this repo (front / ¾ / side / back,
blaster, swim form). Source: [`renders/review/comparison-sheet.png`](renders/review/comparison-sheet.png).*

> **Ringkasan (ID).** Karakter dari lembar referensi dibangun ulang sebagai model Three.js prosedural.
> Semuanya kode, tanpa file mesh atau tekstur. Model sudah siap animasi: pivot sendi, socket tangan dan punggung, collider, serta animasi idle dan wave.
> Ada varian tim A (turquoise) dan B (magenta), prop blaster, dan swim form.
> Semua gate struktural dan geometri pipeline forge lulus.
> Satu gate yang masih memblokir adalah Tier 1, yaitu IoU siluet piksel 0,661 terhadap batas 0,85, karena referensinya ilustrasi ber-line-art.
> Detailnya ada di bagian *Status pipeline* di bawah.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (orbit view, idle animation)
npm run typecheck
npm run build
```

Viewer URL parameters (see the header of [`src/main.ts`](src/main.ts)):

| param | values |
| --- | --- |
| `view` | `orbit` (default), `front`, `three-quarter`, `side`, `back`, `blaster`, `swim` |
| `team` | `A` (turquoise, default) / `B` (magenta) |
| `blaster` | `1` puts the blaster in the right-hand grip socket |
| `explode` | `1` (or a factor) spreads every tagged part away from the centre |
| `az`, `el` | arbitrary camera azimuth/elevation (az 0 = front, 90 = character's left) |
| `anim` / `outline` | `0` disables the idle loop / the ink outline |
| `ground`, `bg`, `tone`, `maps` | review-capture switches (shadow catcher, background, tone mapping, map stripping) |

Clicking a mesh names its part. `window.__IMG2` exposes the scene, model and part list.

## The model

`createSlimeAgentModel({ team, withBlaster, animate, outline })` in
[`src/model/createSlimeAgentModel.ts`](src/model/createSlimeAgentModel.ts) returns a `THREE.Group`:

- **Units and frame:** 1.6 units tall, feet on y = 0, facing +Z. The character's own **left is +X**. Every
  `-l`/`-r` pair comes from one routine with a lateral sign, so it is a reflection, never a rotation.
- **Hierarchy (action-ready):** `hips → spine → neck → head`, `shoulder → elbow → wrist → hand`,
  `hip → knee → ankle → sneaker`. Each pivot sits on its joint with scale 1.
  - Sockets: `socket-hand-l/r` (props stand upright in the grip) and `socket-back` (ink tank).
  - `root.userData.sculptRuntime` carries nodes, parts, sockets, 8 colliders (data only), destruction
    groups and an animation controller (`idle`, `wave`).
  - `root.userData.tick` drives the animation.
- **Parts:** 136 parts are tagged with `userData.img2Part`. Their ids match `componentTree` in the spec,
  and no mesh is left without a part, so every part is selectable and explodable. About 233k triangles.
- **Modules:**
  - [`body.ts`](src/model/body.ts): head, slime hair, jacket, pants, arms, legs.
  - [`gear.ts`](src/model/gear.ts): sneakers, ink tank, hose, buckles.
  - [`props.ts`](src/model/props.ts): goggles, blaster, swim form.
  - [`materials.ts`](src/model/materials.ts): team palettes taken as median RGB from the sheet's swatches.
  - [`geometry.ts`](src/model/geometry.ts): tapered tubes, lathes, a variable-gap lathe, bend-around-Y,
    blob outlines and the inverted-hull ink outline.
- **Slime hair:**
  - A cap plus 26 blob locks rooted at scalp (azimuth, polar) coordinates. The locks flare, droop and sweep
    back, and end in bulbs. A crown tuft, drips and detached droplets complete it.
  - The hair is rigidly parented to the head, never skinned.

## Pipeline: what was run

The skill checkout is used read-only. Set `IMG2THREEJS_SKILL_ROOT` to it.

| Stage | Evidence |
| --- | --- |
| **Intake.** Probe, reference admission (front/¾/side/back admitted), agent-vision analysis, local spec search, character landmarks/anatomy. | [`pipeline/image-analysis.md`](pipeline/image-analysis.md), [`pipeline/admission/`](pipeline/admission), [`pipeline/anatomy.json`](pipeline/anatomy.json) |
| **Pre-spec assessment + detail inventory.** 22 details, all mapped to components/materials. | [`pipeline/assessment.json`](pipeline/assessment.json), [`pipeline/detail-inventory/`](pipeline/detail-inventory) |
| **Material evidence.** 9 verified crops, confidence 0.72–0.87, flat colours. | [`pipeline/material-evidence/`](pipeline/material-evidence) |
| **Projection route.** Skipped, with a recorded reason: a toon illustration is not albedo, and team colours need plain materials. | [`pipeline/projection-route.md`](pipeline/projection-route.md) |
| **Sculpt spec.** 113 components, 27-bone rig, 8 feature targets, 6 repetition systems. `validate_sculpt_spec.py --strict-quality` passes. | [`pipeline/object-sculpt-spec.json`](pipeline/object-sculpt-spec.json), [`pipeline/strict-validation.json`](pipeline/strict-validation.json) |
| **Blockout factory generated from the spec.** Kept as the pipeline artifact. The shipped model is the hand-refined factory in `src/model/` (`refine-code`), and its part ids follow the spec. | [`pipeline/generated/`](pipeline/generated) |
| **Review gates for blockout.** Loop 0 and correction loop 1. | [`pipeline/gates/blockout/`](pipeline/gates/blockout), [`pipeline/gates/blockout-r1/`](pipeline/gates/blockout-r1) |
| **Local checklist state.** | [`.img2threejs/state.json`](.img2threejs/state.json) |

Reproduce the review evidence:

```bash
export IMG2THREEJS_SKILL_ROOT=/path/to/img2threejs
node scripts/capture.mjs --label review --views front,three-quarter,side,back,turntable,blaster,swim --query ground=0
node scripts/capture.mjs --label review/turntable-gray --views turntable --query "ground=0&bg=808080"
node scripts/capture.mjs --label review/map-stripped --views front --query "ground=0&maps=0"
node scripts/export-review-data.mjs          # parts.json, skull rings, hair points, meshes, positions
python3 scripts/prepare_tier1_reference.py   # Tier 1 reference without the painted floor shadow
python3 scripts/run_review_gates.py --pass-id blockout --renders renders/review --out pipeline/gates/<dir> --record
```

## Pipeline status (honest)

Latest gate results, correction loop 1, from [`pipeline/gates/blockout-r1/`](pipeline/gates/blockout-r1):

| Gate | Result |
| --- | --- |
| Part coverage (`check_part_coverage.py`) | **pass**: 113 specified, 136 built, 0 errors, 0 unnamed meshes |
| Scalp exposure (hard, hair zone above the goggle line) | **pass**: 0.0 exposed |
| Self-intersection (closed meshes, vertex normals) | **pass**: 0 inside. 142 of ~25.8k vertices are undecided (ray tangent), reported, not counted |
| Turntable 0/90/180/270 | **pass**, with `--allow-holes`. The only enclosed gap is the hose loop at az 270 ([`hole-270.png`](pipeline/gates/blockout-r1/hole-270.png)). The capture uses a neutral grey background because white surfaces read as "holes" on the sheet colour |
| Multi-angle | **pass**: non-degenerate |
| Attachment anchors | **pass**: 9/9 measured. Four `maxOffset` values were updated to the implemented geometry, with a recorded rationale |
| Hair gate (soft) | **not measurable**: slime hair and slime skin share one colour, so there is no hair/skin boundary |
| Tier 1 `diagnose_render` | **fail**: silhouette IoU **0.661 < 0.85**. Aspect delta 0.015 and scale delta 0.006 pass |
| AI-vision review | 0.75. Every critical feature is at or above its threshold, recorded in `reviewHistory` |

Tier 1 blocks the locked pass sequence, so `orchestrate_passes.py check blockout` stays closed. The
checklist sits at `pass-gate-check` (loop 1/3). The last review records `request-input` for this reason:

- The metric overlaps pixel masks of a line-art illustration and an outline-less 3D render. The white tee,
  goggle frame and midsoles read as background in the render mask, while the sheet's ink lines make its
  whites partly foreground.
- The refinement that clearly improved 3D likeness (hair sweeping back in the side view) lowered front IoU
  from 0.692 to 0.661. Optimising for this threshold would distort the model, which the skill's
  self-correction guide warns against.

Accepting the approximation, or giving direction, is the user's call.

Known visual differences:

- The front hair dome is fuller and more regular than the sheet's irregular clumps.
- The jacket and pants have no cloth folds.
- The hands sit slightly high.
- A single sheet cannot show the top of the head under the hair or the shoe treads, so those are inferred.
