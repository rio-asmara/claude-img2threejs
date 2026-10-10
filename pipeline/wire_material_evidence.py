#!/usr/bin/env python3
"""Wire single-crop material evidence (analyze_texture.py + extract_pbr_evidence.py) into the spec.

Single-crop route of the `material-evidence` checklist step. The region route's
apply_material_analysis.py is NOT used: it writes textureResolution/textureProjection/referencePbr,
which contradict this spec's evidence-backed `textureless` declarations (flat-fill toon reference).

For every analysed material this records a `materialEvidence` block with the verified crop, the
extractor confidence, palette, finish classification and an explicit adopt/reject decision per
field. Adopted: flat albedo = crop median (clamped to the generator's 30..240 albedo range),
clearcoat where the finish class agrees with the observed crisp highlights. Rejected (with reason):
the extractor's roughness (~0.68 on every crop: non-discriminative on flat toon fills) and finish
classes that contradict observation (e.g. 'brushed-steel' for white plastic / cotton).

Usage: python3 pipeline/wire_material_evidence.py pipeline/object-sculpt-spec.json --in-place
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "material-evidence"
CROPS = ROOT / "crops"

# material id -> (crop id, adopted fields, per-field decisions)
DECISIONS = {
    "slime-skin": ("slime-skin", {"clearcoat": 1.0, "clearcoatRoughness": 0.0525},
                   "finish painted-metal recipe agrees on clearcoat 1.0 / dielectric; its roughness 0.5 rejected (crisp specular hotspots observed) -> 0.15 kept"),
    "slime-hair": ("slime-hair", {"clearcoat": 1.0, "clearcoatRoughness": 0.0525},
                   "same as slime-skin; hair locks show the crispest highlights -> roughness 0.12 kept"),
    "goggle-lens": ("goggle-lens", {},
                    "finish worn-composite (roughness 0.9) rejected: lens shows a sharp environment band -> roughness 0.05 + clearcoat kept; extractor warns the mask is unreliable on a fully-filled crop"),
    "goggle-frame": ("goggle-frame", {},
                     "finish brushed-steel (metalness 1) rejected: bright low-saturation white plastic misread as steel by the streak heuristic -> dielectric plastic roughness 0.35 kept"),
    "jacket-nylon": ("jacket-nylon", {"clearcoat": 0.0},
                     "finish worn-composite agrees on a matte dielectric (clearcoat 0); roughness 0.6 kept (satin nylon sheen visible on folds)"),
    "tee-cotton": ("tee-cotton", {},
                   "finish brushed-steel rejected (white cotton, low saturation); matte cotton roughness 0.9 kept"),
    "pants-twill": ("pants-twill", {"clearcoat": 0.0},
                    "finish worn-composite agrees (matte, clearcoat 0); roughness 0.85 kept"),
    "shoe-midsole": ("shoe-midsole", {},
                     "finish brushed-steel rejected (white EVA/rubber); roughness 0.6 kept"),
    "shoe-outsole": ("shoe-outsole", {},
                     "finish painted-metal rejected (rubber, no clearcoat observed); roughness 0.7 kept"),
}
# materials whose flat albedo is the same observed turquoise accent (no separate crop)
SHARED_ALBEDO = {"accent-turquoise": "shoe-outsole"}


def median_hex(path: Path) -> str:
    im = Image.open(path).convert("RGB")
    px = sorted(im.getdata(), key=lambda p: (p[0] + p[1] + p[2]))
    r, g, b = px[len(px) // 2]
    clamp = lambda v: max(30, min(240, v))
    return f"#{clamp(r):02X}{clamp(g):02X}{clamp(b):02X}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("spec", type=Path)
    ap.add_argument("--in-place", action="store_true")
    args = ap.parse_args()
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    crops = json.loads((CROPS / "crops.json").read_text(encoding="utf-8"))
    mats = {m["id"]: m for m in spec["materials"]}
    report = {"route": "single-crop (analyze_texture.py + extract_pbr_evidence.py per verified crop)",
              "notUsed": "apply_material_analysis.py (region route) - writes texture-authoring fields that contradict textureless",
              "materials": []}
    medians = {}
    for mid, (crop, adopted, reason) in DECISIONS.items():
        tex = json.loads((EVIDENCE / f"{crop}.texture.json").read_text(encoding="utf-8"))
        pbr = json.loads((EVIDENCE / f"{crop}.pbr-report.json").read_text(encoding="utf-8"))
        median = median_hex(CROPS / f"{crop}.png")
        medians[crop] = median
        material = mats[mid]
        previous = material["baseColor"]
        material["baseColor"] = median
        material["color"] = median
        shade = "#%02X%02X%02X" % tuple(max(30, int(int(median[i:i + 2], 16) * 0.82)) for i in (1, 3, 5))
        material["albedo"]["dominant"] = median
        material["albedo"]["secondary"] = [shade]
        material["colorVariation"]["palette"] = [median, shade]
        for key, value in adopted.items():
            material[key] = value
        stats = tex.get("stats", {})
        material["materialEvidence"] = {
            "crop": f"pipeline/crops/{crop}.png",
            "cropBox": crops[crop],
            "cropVerified": "visually verified on the target part (pipeline/crops/*.png contact sheet); minor edge contamination noted where present",
            "analyzeTexture": {"report": f"pipeline/material-evidence/{crop}.texture.json", "finishClass": tex.get("finishClass"),
                               "recipe": tex.get("recipe"), "stats": stats},
            "extractPbrEvidence": {"report": f"pipeline/material-evidence/{crop}.pbr-report.json", "verdict": pbr.get("verdict"),
                                   "confidence": pbr.get("confidence"), "targetThreshold": pbr.get("targetThreshold"),
                                   "palette": pbr.get("palette"), "roughnessEstimate": pbr["diagnostics"]["mapStats"]["roughnessBase"],
                                   "warnings": pbr.get("warnings")},
            "adopted": {"baseColor": f"{median} (crop median; was {previous})", **{k: v for k, v in adopted.items()}},
            "rejected": {"roughnessEstimate": "extractor reads ~0.68 on every crop (flat toon fills) -> non-discriminative; observation-derived roughness kept",
                         "finishClass": reason, "maps": "not wired: material is textureless (flat-fill toon subject)"},
        }
        material["textureless"]["evidence"] = [
            f"pipeline/crops/{crop}.png: analyze_texture mottle {stats.get('mottle')}, hueSpread {stats.get('hueSpread')}, "
            f"specularFraction {stats.get('specularFraction')} -> flat fill + baked toon highlight, no grain/print",
            "reference/front.png, side.png, back.png are a flat-fill toon illustration with ink outlines (pipeline/image-analysis.md layer 6)",
        ]
        report["materials"].append({"materialId": mid, "crop": crop, "confidence": pbr.get("confidence"),
                                    "finishClass": tex.get("finishClass"), "baseColor": median, "adopted": adopted, "decision": reason})
    for mid, crop in SHARED_ALBEDO.items():
        material = mats[mid]
        material["baseColor"] = material["color"] = medians[crop]
        material["albedo"]["dominant"] = medians[crop]
        material["materialEvidence"] = {"sharedWith": crop, "note": "same observed turquoise accent as the outsole crop"}
        report["materials"].append({"materialId": mid, "sharedAlbedoFrom": crop, "baseColor": medians[crop]})
    unanalysed = sorted(set(mats) - set(DECISIONS) - set(SHARED_ALBEDO) - {"hidden"})
    report["notAnalysed"] = {m: "no clean isolatable crop in front.png at 400x615 (thin/occluded/back-only); observation-derived flat values kept"
                             for m in unanalysed}
    # keep component colour recipes and vertexPaint albedo in step with the adopted albedo
    # (vertexPaint replaces the material colour with vertex colours, so its baseColor IS the albedo)
    accent = mats["accent-turquoise"]["baseColor"]
    for component in spec["componentTree"]:
        mat = mats.get(component.get("material"))
        paint = component.get("vertexPaint")
        if mat and isinstance(paint, dict):
            paint["baseColor"] = mat["baseColor"]
            for region in paint.get("regions", []):
                region["color"] = accent
        if mat and "colorMaterialRecipe" in component:
            h = mat["baseColor"].lstrip("#")
            rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
            component["colorMaterialRecipe"]["dominantAlbedo"] = f"rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, 1.0)"
            component["colorMaterialRecipe"]["secondaryAlbedo"] = "rgba(%d, %d, %d, 1.0)" % tuple(max(0, int(c * 0.82)) for c in rgb)
    out = json.dumps(spec, indent=2, ensure_ascii=False) + "\n"
    (EVIDENCE / "wiring-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if args.in_place:
        args.spec.write_text(out, encoding="utf-8")
    print(f"wired {len(DECISIONS)} analysed materials (+{len(SHARED_ALBEDO)} shared); report: {EVIDENCE / 'wiring-report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
