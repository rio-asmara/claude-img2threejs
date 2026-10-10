# Projection-route decision — Slime Agent

Decision: **projection NOT required -> stylized route** (skip solve_camera_pose / delight_albedo /
bake_projected_texture).

Reasons (grimoire/character/likeness_maximization.md, reconstruction.md, validation_rubric.md):
1. The reference is an illustrated toon render (ink outlines, flat colour fills, baked toon
   speculars), not a photograph. Its pixels are not albedo: projecting them would bake black
   contour lines and painted highlights onto lit 3D geometry (the failure de-lighting exists to
   prevent, and de-lighting cannot remove line art).
2. The surface identity is flat colour regions with hard boundaries (turquoise / black / white),
   which this pipeline represents with per-material flat albedo plus geometry-gated vertexPaint
   regions (piping, pant stripes, collar lining) — no patterned finish that would need the photo's
   own pixels.
3. Hidden-side risk that projection-first manages is mostly removed: the sheet supplies observed
   front, 3/4, right-side and back views (pipeline/reference-set.json).
4. Intended use is a real-time browser game character with a team-colour swap
   (Team A #1ACFC3 / Team B #E8158E): flat, parameterised materials are required for the swap; a
   baked projected texture would lock the turquoise team colour into the texture.
Camera: the review camera is a fixed orthographic-like front view matching reference/front.png
framing; referenceCamera stays unsolved (fov 30, yaw 0) and is recorded in the spec.
