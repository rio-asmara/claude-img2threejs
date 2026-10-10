# Image Analysis — Slime Agent

Protocol: `grimoire/intake/image_analysis.md` (layers 1–8). Agent-vision analysis supplied by the
orchestrating agent, then confirmed by this agent reading `reference/front.png`, `side.png`,
`back.png` and the full sheet `reference/slime-agent-sheet.jpg`. Pixel measurements below were
taken with PIL on `reference/front.png` (400x615, background rgb(244,243,239)).

Primary reference: `reference/front.png`. Additional observed views (NOT inferred):
`reference/three-quarter.png`, `reference/side.png` (character's own RIGHT side faces camera;
character faces image-right), `reference/back.png`. Prop/variant sheets: `reference/blaster.png`,
`reference/swim-form.png`, `reference/team-palette.png`.

## Layer 1 — Identification & classification
- Work type: stylized chibi slime-humanoid game character ("Slime Agent"), turnaround sheet.
- Broad classification: biped humanoid character with garment layers, worn hardware (goggles,
  harness, backpack ink tank + hose) and a held prop (blaster, separate sheet panel).
- `primaryDomain`: **character**. Confidence 0.95.
- Render style (observed): toon/semi-glossy, ink outlines, flat-ish colour fills with crisp specular
  highlights on the slime. Intended use: real-time browser game character (ink-shooter genre),
  animation-ready. Complexity: **complex**.

## Layer 2 — Overall form & silhouette
- Bilateral symmetry about the sagittal plane except the hose (character's right hip) and minor
  hair-lock asymmetry.
- Standing A-pose-ish: arms angled ~15–20 deg away from the torso, legs slightly apart, feet planted.
- Measured (front.png, y from top, ground at y~600, figure top y=16, height ~584 px):
  - hair crown tuft top 16; hair mass widest ~ y 120 (242 px wide, wider than shoulders)
  - goggle band y ~128–197; smile ~ y 205; chin ~ y 218; collar top ~ y 222
  - shoulder line ~ y 285; jacket hem / tee hem ~ y 330–340; crotch (leg split) ~ y 388
  - fingertips ~ y 422 (hands hang to upper-thigh level); pant cuffs ~ y 495–505
  - turquoise ankle ~ y 505–520; shoe top ~ y 520; sole ~ y 600
- Head-units: head incl. hair mass ~200 px -> figure ~2.9 hair-heads; skull (under hair, chin to
  inferred skull top ~ y 75) ~140 px -> ~4.2 skull-heads. Stylized/chibi, consistent with the
  "~4.5 heads" estimate within measurement error (skull top is hidden by hair -> uncertain).
- Primitives: head = sphere-ish ellipsoid; hair = blobby lofted/metaball locks; torso = tapered
  capsule under a boxy jacket shell; arms/legs = capsules under garment tubes; shoes = rounded
  extruded profiles; tank = cylinder; hose = swept tube.
- Shape language: organic (slime body, hair) + soft-geometric (garments, hardware).

## Layer 3 — Macro -> meso -> micro
- Macro: head, slime hair mass, goggles, neck, torso, cropped jacket, T-shirt, arms (upper/fore),
  hands, cargo joggers, sneakers, backpack ink tank + harness + hose.
- Meso:
  - goggles: single wide black glossy lens, white rounded frame/bezel, black elastic strap all the
    way round the head (visible in side/back), silver rectangular clip hinges at the temples.
  - mouth: small curved smile line under the goggles; NO visible eyes (lens covers them).
  - hair: teardrop locks drooping around the head, crown tuft rising, droplets falling at sides.
  - jacket: black matte nylon techwear, high stand-up collar with turquoise inner lining, open
    front, turquoise piping down sleeves and front panels, boxy shoulders, cropped at the waist,
    sleeves to the forearm with black velcro wristbands; turquoise slime forearms/hands below.
  - harness: black shoulder straps with silver/white rectangular buckles at chest height, both sides.
  - T-shirt: plain white, hem visible below the jacket.
  - pants: black/charcoal baggy cargo joggers, turquoise vertical stripe on the outer leg seam,
    large flap cargo pockets on outer thighs, black waistband, elastic cuffs gathered at the ankle.
  - sneakers: chunky high-top-ish; thick white midsole, turquoise outsole rim/tread, black upper
    with turquoise panels + heel tab, white laces.
  - backpack: vertical transparent glass-like cylinder with turquoise liquid + bubbles, black top
    cap with valve, silver metal bands, black bottom cap, on a black back plate tied to the harness;
    black corrugated hose loops from the bottom cap down/around to the character's RIGHT hip
    (confirmed in back view: hose coil on image-right = character right; side view shows right side).
  - hands: 4-digit mitten-like slime hands (3 fingers + thumb), glossy.
- Micro: glossy specular highlights on slime, hair drips/droplets, liquid droplets in tank,
  rivets/snaps on jacket, stitching lines, pocket flaps, lace crossings, outsole tread.

## Layer 4 — Spatial relationships
- <goggle-strap, wraps, head> (overlap, sits ON the hair at temple height); <goggles, cover,
  eye-region> (overlap/embed into face front); <smile, below, goggles> (surface linework on face).
- <hair-mass, attached-to, head-crown> (embed); <hair-drips, hang-from, hair-locks> (overlap).
- <jacket, over, tee> (layered shell, outer); <tee, over, torso> (shell); <harness, over, jacket>.
- <tank, attached-to, back-plate> (socket `back`); <back-plate, attached-to, harness> (overlap).
- <hose, connects, tank-bottom-cap -> right-hip> (swept tube, butt at both ends).
- <hands, below, wristbands> (butt); <pants, below, tee-hem> (overlap at waist).
- <ankle (turquoise), between, pant-cuff and shoe-collar> (visible gap ~10–15 px in front view).
- <blaster, held-by, right-hand> (socket `hand_r`, separate prop panel; not part of the turnaround pose).

## Layer 5 — Materials (PBR)
- slime skin/hair: turquoise ~#1ED2C6 albedo, dielectric (metalness 0), roughness ~0.15,
  clearcoat 1.0, semi-translucent look (stylized: MeshPhysicalMaterial, small transmission or sheen).
- goggle lens: black glossy dielectric, roughness ~0.05, clearcoat.
- goggle frame: white plastic, roughness ~0.35. Strap: black fabric, roughness ~0.8.
- jacket: black nylon, roughness ~0.6. Piping: saturated turquoise (emissive-ish accent).
- tee: white cotton, roughness ~0.9. Pants: charcoal cotton twill, roughness ~0.85.
- sneakers: white rubber midsole, black synthetic upper, turquoise rubber outsole.
- tank: clear glass (transmission ~0.9, ior 1.5) + turquoise liquid volume.
- metal buckles/bands/clips: brushed aluminium, metalness 1, roughness ~0.35. Hose: black rubber.
- Observation vs inference: highlights on slime and lens are baked toon speculars — NOT albedo.

## Layer 6 — Colour & finish
- Palette: turquoise (vivid cyan-green, high value, high saturation) on black/charcoal (very low
  value) with white (high value, neutral) secondary.
- Finishes: slime = gloss; lens = gloss; garments = matte/satin; metal = satin metallic.
- Team palette variant (team-palette.png): Team A turquoise #1ACFC3, Team B magenta #E8158E;
  finishes glossy / textured / glassy. All turquoise elements should be driven by one team colour.

## Layer 7 — Identity-defining features (-> featureReviewTargets)
1. slime-hair drip silhouette (blobby teardrop locks + crown tuft + falling droplets)
2. goggles: size/placement, white frame + single black lens, covering the eyes, strap round head
3. turquoise-on-black outfit palette with piping stripes (jacket piping, pant side stripe)
4. backpack ink tank (glass cylinder, turquoise liquid) with hose to the right hip
5. chunky sneakers (white midsole, turquoise outsole, black upper)
6. chibi proportions (big head ~1/3 of height incl. hair; ~4.2–4.5 skull heads)
Plus character targets: anatomy-proportion, face-landmark-placement (goggle/smile placement),
pose-silhouette (A-pose), outfit-and-palette.

## Layer 8 — Uncertainty & single-image limits
- Observed (not hallucinated): front, 3/4, right side, back — the sheet is a full turnaround.
- Hidden: inside of the jacket, top of the skull under the hair, sole tread underside, inner
  faces of the thighs, the face under the goggle lens (no eyes are depicted -> none modelled).
- Uncertain: exact digit count (appears 4: 3 fingers + thumb); exact hose routing behind the hip;
  exact count of hair locks (~14–18 primary locks); low resolution of crops (400x615) limits
  micro-detail (rivets, stitching) — these are stylized procedurally.
- Left/right: character's own left = +X, faces +Z, Y up; `-l`/`-r` pairs are mirrors.
