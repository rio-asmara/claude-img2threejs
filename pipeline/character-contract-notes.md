# Character Contract Read — Slime Agent

Read completely: `grimoire/character/reconstruction.md`, `grimoire/character/likeness_maximization.md`,
`grimoire/readiness/standard_character_pipeline.md`.

## Decisions taken from the contracts
- Route: **code-only** (reference -> spec -> procedural TypeScript factory -> authored rig ->
  Three.js). No external-asset or GLB-mediated route; no generativeAssist.
- Likeness route: **stylized** (`reconstruction.md` fallback path), not projection-first. Reason:
  the reference is a toon illustration (ink outlines, flat fills, baked toon speculars); the
  illustrated pixels are not a photo albedo and projecting them would bake line art + highlights
  onto lit geometry. The turnaround sheet supplies front/3/4/side/back as *observed* views, so the
  hidden-side inference that projection-first is meant to manage is mostly covered by the views.
- Proportions measured in head-units (see `pipeline/image-analysis.md`): chibi/stylized axis,
  ~2.9 HU incl. hair, ~4.2–4.5 skull HU. Not realistic 7.5 HU.
- Face: one continuous head volume. No eyes are depicted (goggle lens covers them) -> no eye
  spheres/iris decals/catchlights are modelled; the "eyes" identity role is carried by the goggle
  lens. Mouth = surface linework (smile curve) on the head volume, not a floating primitive.
- Hair: stylized clumps = slime locks (5–15 major masses + drips), shell/mass + directional clumps,
  rigidly parented to the head (never smooth-skinned). Not a billboard.
- Skin: stylized slime -> low roughness + clearcoat; slight transmission is justified because the
  reference shows a semi-translucent slime read (team-palette "glassy" finish), kept small.
- Cloth: jacket/pants as shells following fold lines; creasing at elbow, waist, knee, cuffs.
- Separate semantic modules: body, head, hair, goggles, outfit (jacket/tee/pants/shoes),
  harness, backpack tank + hose, blaster prop (socket).
- Rig: Y-up, right-handed, root joint index 0; four-weight packed skinning when skinned; rig payload
  validated before binding. Structural rig validation is not deformation proof.
- Required capture batch for review (viewer agent): hero/reference-match (front), orbit +35,
  orbit -35, profile 90, rear three-quarter 135, rear 180, head hero, head three-quarter.
