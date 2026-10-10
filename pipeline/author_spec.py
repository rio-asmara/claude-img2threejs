#!/usr/bin/env python3
"""Author the Slime Agent ObjectSculptSpec from the new_sculpt_spec.py starter.

Deterministic and re-runnable: every reconstruction decision (measurements, hierarchy, pivots,
sockets, materials, review targets) lives here and in the spec it writes, never only in generated
TypeScript. Measurements come from reference/front.png (400x615) and reference/side.png/back.png;
see pipeline/image-analysis.md and pipeline/anatomy.json.

Usage:
  python3 pipeline/author_spec.py --skill <img2threejs checkout> \
      --starter pipeline/object-sculpt-spec.starter.json --out pipeline/object-sculpt-spec.json

Coordinate frame: Y up, character faces +Z, character's own left = +X (forge/_shared/chirality.py).
Units: 1 head unit (chin -> skull top, 166 px in front.png) = 0.40 world units; ground at Y = 0.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from pathlib import Path

# ----------------------------------------------------------------------------------------------
# measurement frame
# ----------------------------------------------------------------------------------------------
HU = 0.40
S = HU / 166.0            # world units per front.png pixel
CX = 198.0                # body centre x in front.png
GROUND_Y = 600.0          # ground line y in front.png
SIDE_CX = 160.0           # body centre x in side.png (character faces image-right = +Z)


def img(x: float, y: float, z: float = 0.0) -> tuple[float, float, float]:
    """front.png pixel -> world point (character left = image right = +X)."""
    return (round((x - CX) * S, 5), round((GROUND_Y - y) * S, 5), round(z, 5))


def r5(v):
    return [round(float(c), 5) for c in v]


def add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def mul(a, k):
    return tuple(c * k for c in a)


def norm(a):
    length = math.sqrt(sum(c * c for c in a))
    return tuple(c / length for c in a) if length > 1e-12 else (0.0, 1.0, 0.0)


def mirror(p):
    return (-p[0], p[1], p[2])


# --- three.js Quaternion.setFromUnitVectors + Euler(XYZ) replicas (used for exact local frames) ---
def quat_from_unit_vectors(vf, vt):
    r = vf[0] * vt[0] + vf[1] * vt[1] + vf[2] * vt[2] + 1.0
    if r < 1e-8:
        r = 0.0
        if abs(vf[0]) > abs(vf[2]):
            q = (-vf[1], vf[0], 0.0, r)
        else:
            q = (0.0, -vf[2], vf[1], r)
    else:
        q = (vf[1] * vt[2] - vf[2] * vt[1], vf[2] * vt[0] - vf[0] * vt[2], vf[0] * vt[1] - vf[1] * vt[0], r)
    n = math.sqrt(sum(c * c for c in q))
    return tuple(c / n for c in q)


def quat_rotate(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    ix = w * vx + y * vz - z * vy
    iy = w * vy + z * vx - x * vz
    iz = w * vz + x * vy - y * vx
    iw = -x * vx - y * vy - z * vz
    return (ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x)


def quat_conj(q):
    return (-q[0], -q[1], -q[2], q[3])


def euler_xyz_from_quat(q):
    x, y, z, w = q
    m11 = 1 - 2 * (y * y + z * z); m12 = 2 * (x * y - z * w); m13 = 2 * (x * z + y * w)
    m22 = 1 - 2 * (x * x + z * z); m23 = 2 * (y * z - x * w)
    m32 = 2 * (y * z + x * w); m33 = 1 - 2 * (x * x + y * y)
    m21 = 2 * (x * y + z * w)
    ey = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        ex = math.atan2(-m23, m33)
        ez = math.atan2(-m12, m11)
    else:
        ex = math.atan2(m32, m22)
        ez = 0.0
    return (round(ex, 5), round(ey, 5), round(ez, 5))


def mirror_euler(e):
    return (e[0], -e[1], -e[2])


def hex_rgba(hex_color: str, alpha: float = 1.0) -> str:
    h = hex_color.lstrip("#")
    return f"rgba({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}, {alpha})"


def shade(hex_color: str, k: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = (max(0, min(255, round(int(h[i:i + 2], 16) * k))) for i in (0, 2, 4))
    return f"#{r:02x}{g:02x}{b:02x}"


# ----------------------------------------------------------------------------------------------
# materials (flat, textureless toon-PBR; team colour slot on every turquoise material)
# ----------------------------------------------------------------------------------------------
TEAM_A = "#1ACFC3"
TEAM_B = "#E8158E"
TOON_EVIDENCE = [
    "reference/front.png, side.png, back.png are a flat-fill toon illustration with ink outlines: every "
    "region reads as one flat hue plus baked toon specular, no grain/print/pores (pipeline/image-analysis.md layer 6)",
    "pipeline/material-evidence/*.json: analyze_texture.py/extract_pbr_evidence.py on verified crops "
    "(see materialEvidence on this material)",
]

MATERIAL_DEFS = [
    # id, name, color, class, rough, rough_var, metal, extras, overrides, team
    ("hidden", "Hidden root proxy", "#000000", "unknown", 1.0, 0.0, 0.0, {"opacity": {"base": 0.0}}, [], False),
    ("slime-skin", "Slime body (glossy turquoise)", "#1ED2C6", "skin", 0.15, 0.04, 0.0,
     {"clearcoat": 1.0, "clearcoatRoughness": 0.08, "emissive": "#0B5F59", "emissiveIntensity": 0.35,
      "envMapIntensity": 1.0,
      "subsurfaceApproximation": "no true SSS (core.pbr-subsurface-scattering-sss): low-intensity teal emissive lifts the shadow side to read as translucent slime; transmission deliberately NOT used on the closed body"},
     [{"id": "gloss-highlight", "region": "upper-left facing slime surfaces (hands, forearms, face below goggles)",
       "roughness": 0.08, "clearcoat": 1.0, "evidenceRef": "pipeline/detail-inventory/zone-r1c0.png",
       "notes": "hotspot follows the key light from upper-left; realised by the material clearcoat, not a texture"}], True),
    ("slime-hair", "Slime hair locks (glossy turquoise)", "#21D6C9", "skin", 0.12, 0.04, 0.0,
     {"clearcoat": 1.0, "clearcoatRoughness": 0.06, "emissive": "#0B6A63", "emissiveIntensity": 0.3,
      "envMapIntensity": 1.0},
     [{"id": "gloss-highlight", "region": "upper-left of every hair lock blob", "roughness": 0.08, "clearcoat": 1.0,
       "evidenceRef": "pipeline/detail-inventory/zone-r0c1.png"}], True),
    ("mouth-line", "Smile line (dark teal)", "#0B4F4A", "skin", 0.5, 0.02, 0.0, {},
     [{"id": "smile-ink", "region": "smile arc below the goggles", "color": "#0B4F4A",
       "evidenceRef": "pipeline/detail-inventory/zone-r0c1.png"}], False),
    ("goggle-lens", "Goggle lens (gloss black)", "#121519", "plastic", 0.05, 0.02, 0.0,
     {"clearcoat": 1.0, "clearcoatRoughness": 0.0525, "envMapIntensity": 1.2},
     [{"id": "lens-specular-band", "region": "upper half of the lens", "roughness": 0.05, "clearcoat": 1.0,
       "evidenceRef": "pipeline/detail-inventory/zone-r0c1.png",
       "notes": "grey reflection band = environment reflection on a 0.05-roughness clearcoated dielectric"}], False),
    ("goggle-frame", "Goggle frame (white plastic)", "#F1F3F2", "plastic", 0.35, 0.05, 0.0,
     {"clearcoat": 0.3, "clearcoatRoughness": 0.25}, [
         {"id": "frame-rim-highlight", "region": "top edge of the bezel", "roughness": 0.25,
          "evidenceRef": "pipeline/detail-inventory/zone-r0c1.png"}], False),
    ("strap-fabric", "Black elastic strap / webbing", "#17191C", "fabric", 0.8, 0.06, 0.0, {}, [
        {"id": "webbing-weave", "region": "goggle strap, harness straps, wristbands", "roughness": 0.85,
         "evidenceRef": "pipeline/detail-inventory/zone-r1c1.png"}], False),
    ("jacket-nylon", "Black matte techwear nylon", "#1D1F23", "fabric", 0.6, 0.08, 0.0, {}, [
        {"id": "piping-stripes", "region": "front opening edges, front panel lines, sleeve fronts",
         "color": "#19D3C5", "realization": "vertexPaint regions on jacket-body (piping-*) and upper-arm-* (sleeve-piping)",
         "evidenceRef": "pipeline/detail-inventory/zone-r1c1.png"}], False),
    ("accent-turquoise", "Turquoise accent panels / lining / piping", "#19D3C5", "plastic", 0.45, 0.05, 0.0, {}, [
        {"id": "accent-flat", "region": "shoe side panels, heel tabs, tongue tab, collar lining",
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], True),
    ("tee-cotton", "White cotton T-shirt", "#F3F3F1", "fabric", 0.9, 0.04, 0.0, {}, [
        {"id": "hem-shadow", "region": "tee hem below the jacket", "roughness": 0.92,
         "evidenceRef": "pipeline/detail-inventory/zone-r1c1.png"}], False),
    ("pants-twill", "Charcoal cotton twill cargo joggers", "#2A2C31", "fabric", 0.85, 0.06, 0.0, {}, [
        {"id": "outer-seam-stripe", "region": "outer leg seam of both legs", "color": "#19D3C5",
         "realization": "vertexPaint tapered-capsule regions (outer-seam-stripe) on thigh-*/shin-*",
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], False),
    ("shoe-upper", "Sneaker upper (black synthetic)", "#1A1B1F", "plastic", 0.55, 0.05, 0.0, {}, [
        {"id": "upper-crease", "region": "toe box flex crease", "roughness": 0.6,
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], False),
    ("shoe-midsole", "Sneaker midsole (white EVA)", "#F2F2EF", "rubber", 0.6, 0.04, 0.0, {}, [
        {"id": "midsole-sidewall", "region": "midsole sidewall", "roughness": 0.62,
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], False),
    ("shoe-outsole", "Sneaker outsole (turquoise rubber)", "#1BCFC2", "rubber", 0.7, 0.05, 0.0, {}, [
        {"id": "tread-rim", "region": "outsole rim + lugs", "roughness": 0.75,
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], True),
    ("shoe-lace", "White laces", "#F5F5F3", "fabric", 0.85, 0.03, 0.0, {}, [
        {"id": "lace-weave", "region": "lace bars", "roughness": 0.88,
         "evidenceRef": "pipeline/detail-inventory/zone-r2c0.png"}], False),
    ("tank-glass", "Ink tank glass (clear)", "#E6F5F4", "glass", 0.05, 0.01, 0.0,
     {"transmission": 0.9, "ior": 1.5, "thickness": 0.02, "clearcoat": 1.0, "clearcoatRoughness": 0.0525,
      "envMapIntensity": 1.2},
     [{"id": "glass-specular-streak", "region": "vertical streak on the tank glass", "roughness": 0.03,
       "evidenceRef": "reference/back.png"}], False),
    ("ink-liquid", "Turquoise ink liquid", "#19C9BC", "unknown", 0.1, 0.03, 0.0,
     {"clearcoat": 0.6, "clearcoatRoughness": 0.1, "emissive": "#0A5550", "emissiveIntensity": 0.4},
     [{"id": "bubble-highlights", "region": "bubbles inside the liquid", "roughness": 0.05,
       "evidenceRef": "reference/back.png"}], True),
    ("metal-brushed", "Brushed aluminium (buckles, clips, bands)", "#C8CDD2", "metal", 0.35, 0.05, 1.0,
     {"anisotropy": {"base": 0.6, "rotation": 0.0}}, [
         {"id": "edge-polish", "region": "buckle and band edges", "roughness": 0.25,
          "evidenceRef": "pipeline/detail-inventory/zone-r1c1.png"}], False),
    ("rubber-black", "Black rubber (tank caps, hose, coupler)", "#151618", "rubber", 0.75, 0.06, 0.0, {}, [
        {"id": "rib-cavity-ao", "region": "hose corrugation valleys", "roughness": 0.8,
         "evidenceRef": "reference/back.png"}], False),
]


def make_material(defn) -> dict:
    mid, name, color, mclass, rough, rough_var, metal, extras, overrides, team = defn
    secondary = shade(color, 0.82) if mid != "hidden" else "#000000"
    material = {
        "id": mid,
        "name": name,
        "type": "physical",
        "shaderModel": "MeshPhysicalMaterial (flat toon-PBR, textureless)",
        "materialClass": mclass,
        "baseColor": color,
        "color": color,
        "albedo": {"dominant": color, "secondary": [secondary],
                   "samplingNotes": "sampled from verified reference crops (pipeline/crops) with toon highlights excluded"},
        "colorVariation": {"palette": [color, secondary], "pattern": "flat", "amplitude": 0.03, "heightCorrelation": 0.0},
        "roughness": {"base": rough, "variation": rough_var, "map": "none: scalar roughness (textureless toon subject)",
                      "localResponse": "localOverrides name the regions that shift roughness"},
        "metalness": {"base": metal, "variation": 0.0},
        "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35,
                             "notes": "scene-level contact shadow + SSAO in the viewer; no AO map (textureless)"},
        "localOverrides": overrides,
        "textureless": {"declared": True, "evidence": list(TOON_EVIDENCE)},
        "shaderNotes": [
            "Flat albedo per material: the reference is a toon render whose identity is flat colour regions.",
            "Colour-region boundaries (piping, pant stripes, collar lining) are geometry-gated vertexPaint, not textures.",
        ],
    }
    material.update(copy.deepcopy(extras))
    if team:
        material["teamColorSlot"] = {"teamA": TEAM_A, "teamB": TEAM_B, "default": "teamA",
                                     "evidence": "reference/team-palette.png"}
    if mid == "hidden":
        material["textureless"]["evidence"] = ["root proxy carries no visible surface (opacity 0)"]
    return material


MATERIAL_CLASS_FOR_RECIPE = {m[0]: m[3] for m in MATERIAL_DEFS}
MATERIAL_COLOR = {m[0]: m[2] for m in MATERIAL_DEFS}


# ----------------------------------------------------------------------------------------------
# component tree
# ----------------------------------------------------------------------------------------------
class Tree:
    def __init__(self, ns):
        self.ns = ns
        self.nodes: list[dict] = []
        self.anchor: dict[str, tuple] = {"root": (0.0, 0.0, 0.0)}
        self.by_id: dict[str, dict] = {}

    def rel(self, point, parent):
        return sub(point, self.anchor[parent or "root"])

    def add(self, cid, name, primitive, parent, world, scale, material, role, level, topology, rationale,
            *, rotation=(0, 0, 0), attachment=None, transform_scale=None, importance=0.6, features=None,
            sockets=None, anim_role="static", evidence=None, descriptor=None, stand_proud=None,
            vertex_paint=None, collider=None, detach=False, confidence=0.8, extra=None):
        att = None
        if attachment is not None:
            start_w, end_w, base_r, end_r, socket, contact = attachment
            att = self.ns._limb_attachment(self.rel(start_w, parent), self.rel(end_w, parent), base_r, end_r,
                                           socket=socket, contact_type=contact,
                                           evidence=evidence or ["full-object"])
            world = start_w
        node = self.ns._cnode(
            cid, name, primitive, parent, r5(self.rel(world, parent)), scale,
            material=material, role=role, level=level, rotation=tuple(round(v, 5) for v in rotation),
            importance=importance, sockets=sockets or [], local_features=features or [],
            anim_role=anim_role, evidence=evidence or ["full-object"], topology_class=topology,
            topology_rationale=rationale, attachment=att, transform_scale=transform_scale)
        node["confidence"] = confidence
        node["dimensions"]["confidence"] = confidence
        if descriptor:
            node["geometryDescriptor"].update(descriptor)
        if stand_proud:
            node["standProud"] = stand_proud
        if vertex_paint:
            node["vertexPaint"] = vertex_paint
        if collider:
            node["actionProfile"]["collider"] = collider
        if detach:
            node["actionProfile"]["transformChannels"]["detach"] = True
            node["actionProfile"]["destruction"]["detachableFragments"] = [cid]
        color = MATERIAL_COLOR[material]
        node["colorMaterialRecipe"] = {
            "dominantAlbedo": hex_rgba(color),
            "secondaryAlbedo": hex_rgba(shade(color, 0.82)),
            "materialClass": MATERIAL_CLASS_FOR_RECIPE[material] if MATERIAL_CLASS_FOR_RECIPE[material] != "unknown" else "unknown",
            "materialClassConfidence": 0.8 if material != "hidden" else 0.5,
            "source": "flat colour sampled from verified crops of reference/front.png (toon highlights excluded)",
        }
        if extra:
            node.update(extra)
        self.nodes.append(node)
        self.by_id[cid] = node
        self.anchor[cid] = world
        return node


def lf(fid, kind, description, effect, evidence="full-object"):
    return {"id": fid, "kind": kind, "description": description, "effect": effect, "evidenceRefs": [evidence]}


def sweep(points, radii, radial=12, cap=True):
    """tapered-sweep descriptor. radii entries are r or (rx, rz)."""
    stations = []
    for p, r in zip(points, radii):
        rx, rz = (r, r) if not isinstance(r, tuple) else r
        stations.append({"position": r5(p), "rx": round(rx, 5), "rz": round(rz, 5), "twist": 0.0})
    return {"taperedSweep": {"stations": stations, "radialSegments": radial, "capEnds": cap}}


def catmull(points, samples_per_seg=6):
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(3)))
    out.append(tuple(points[-1]))
    return out


def resample(polyline, step):
    """Resample a polyline at a fixed arc-length step."""
    lengths = [0.0]
    for a, b in zip(polyline, polyline[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total = lengths[-1]
    n = max(2, int(total / step) + 1)
    out = []
    j = 0
    for i in range(n):
        target = total * i / (n - 1)
        while j < len(lengths) - 2 and lengths[j + 1] < target:
            j += 1
        seg = lengths[j + 1] - lengths[j]
        t = 0.0 if seg <= 1e-12 else (target - lengths[j]) / seg
        out.append(tuple(polyline[j][k] + (polyline[j + 1][k] - polyline[j][k]) * t for k in range(3)))
    return out, total


def ellipse_points(a, b, n, start=0.0, end=2 * math.pi, cz=0.0):
    pts = []
    for i in range(n):
        t = start + (end - start) * i / (n - 1 if end - start < 2 * math.pi - 1e-9 else n)
        pts.append([round(a * math.cos(t), 5), round(b * math.sin(t) + cz, 5)])
    return pts


def build_tree(ns) -> tuple[list, dict]:
    T = Tree(ns)
    notes: dict = {}
    T.add("root", "Slime Agent (root)", "box", None, (0, 0, 0), (0.01, 0.01, 0.01), "hidden", "body", "macro",
          "assembled-solid", "Invisible root proxy for whole-character transforms; carries no surface. Sized 0.01 so its hidden mesh does not inflate Box3 bounds below the ground plane (a unit box reached y=-0.5).",
          importance=1.0, anim_role="root", confidence=1.0,
          sockets=[{"id": "ground", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0],
                    "purpose": "root motion / ground contact"}])

    # ---------------- pelvis / spine ----------------
    pelvis_c = (0.0, 0.585, 0.005)
    T.add("pelvis", "Pelvis (pants hip mass)", "ellipsoid", "root", pelvis_c, (0.31, 0.15, 0.25), "pants-twill",
          "body", "macro", "continuous-sculpt",
          "Hip mass of the baggy joggers is one smooth rounded volume (front.png y 340-390 spans 129 px = 0.31 wide); an ellipsoid tapers into the thighs.",
          importance=0.9, evidence=["full-object", "legs-zone"],
          collider={"type": "capsule", "offset": [0, 0, 0], "scale": [0.31, 0.15, 0.25], "isTrigger": False, "notes": "hip capsule"})
    torso_bottom = (0.0, 0.615, 0.005)
    waist = (0.0, 0.70, 0.01)
    torso_top = (0.0, 0.872, 0.005)
    T.add("abdomen", "Abdomen (spine segment)", "capsule", "pelvis", torso_bottom, (0.24, 0.085, 0.2), "tee-cotton",
          "shell", "macro", "assembled-solid",
          "Internal spine segment under the tee/jacket shells; a tapered segment between pelvis and waist joints.",
          attachment=(torso_bottom, waist, 0.115, 0.125, "pelvis-waist", "rigid-weld"), importance=0.9,
          evidence=["full-object", "torso-zone"])
    T.add("chest", "Chest (spine segment)", "capsule", "abdomen", waist, (0.26, 0.17, 0.2), "tee-cotton", "shell",
          "macro", "assembled-solid",
          "Internal chest segment under the jacket; tapers toward the neck so the collar sits on a narrower top.",
          attachment=(waist, torso_top, 0.125, 0.085, "abdomen-chest", "rigid-weld"), importance=1.0,
          evidence=["full-object", "torso-zone"],
          collider={"type": "capsule", "offset": [0, 0.08, 0], "scale": [0.36, 0.26, 0.28], "isTrigger": False, "notes": "torso capsule"})

    # tee: closed elliptical prism (white), hem visible below the jacket and through the open front
    tee_pts = ellipse_points(0.128, 0.112, 40, cz=-0.012)   # shape y = -world z -> centre z +0.012
    tee_base = (0.0, 0.625, 0.0)
    T.add("tee", "White T-shirt", "extrude", "chest", tee_base, (0.256, 0.235, 0.224), "tee-cotton", "shell", "macro",
          "conforming-shell",
          "Fitted cotton layer over the torso: a closed elliptical prism (hem at front.png y 332-340) extruded upward; rotation -pi/2 about X turns the extrusion axis to +Y.",
          rotation=(-math.pi / 2, 0, 0), transform_scale=(1, 1, 1), importance=0.8,
          descriptor={"profile2D": {"points": tee_pts, "depth": 0.235}},
          features=[lf("tee-hem-band", "seam", "white hem band visible between jacket hem (Y 0.646) and waistband (Y 0.627)", "geometry: prism bottom edge", "torso-zone")],
          evidence=["full-object", "torso-zone"])

    # jacket body: C-section prism open at the front (shape y = -world z)
    a_out, b_out, thick = 0.178, 0.142, 0.026
    gap = math.asin(0.05 / a_out)
    t0 = -math.pi / 2 + gap
    t1 = -math.pi / 2 - gap + 2 * math.pi
    outer = ellipse_points(a_out, b_out, 64, t0, t1, cz=-0.015)
    inner = ellipse_points(a_out - thick, b_out - thick, 64, t0, t1, cz=-0.015)
    jacket_profile = outer + list(reversed(inner))
    jacket_depth = 0.21
    jb = (0.0, 0.642, 0.0)
    edge_out = (a_out * math.cos(t0), b_out * math.sin(t0) - 0.015)
    edge_mid = ((a_out - thick / 2) * math.cos(t0), (b_out - thick / 2) * math.sin(t0) - 0.015)
    panel_t = -math.pi / 2 + 0.85
    panel = (a_out * math.cos(panel_t), b_out * math.sin(panel_t) - 0.015)
    paint_regions = []
    for side, sx in (("l", 1), ("r", -1)):
        paint_regions.append({"id": f"piping-front-edge-{side}", "kind": "tapered-capsule", "color": "#19D3C5",
                              "softness": 0.003, "start": r5((sx * edge_mid[0], edge_mid[1], 0.0)),
                              "end": r5((sx * edge_mid[0], edge_mid[1], jacket_depth)), "startRadius": 0.017,
                              "endRadius": 0.017})
        paint_regions.append({"id": f"piping-panel-{side}", "kind": "tapered-capsule", "color": "#19D3C5",
                              "softness": 0.003, "start": r5((sx * panel[0], panel[1], 0.0)),
                              "end": r5((sx * panel[0], panel[1], jacket_depth)), "startRadius": 0.009,
                              "endRadius": 0.009})
    T.add("jacket-body", "Cropped techwear jacket body (open front)", "extrude", "chest", jb,
          (2 * a_out, jacket_depth, 2 * b_out), "jacket-nylon", "garment", "macro", "conforming-shell",
          "Boxy cropped jacket = thin C-section shell (26 mm wall) open at the front, extruded from the hem (front.png y 332) to the shoulder line; boxy prism matches the reference's straight side seams.",
          rotation=(-math.pi / 2, 0, 0), transform_scale=(1, 1, 1), importance=1.0,
          descriptor={"profile2D": {"points": [r5(p) for p in jacket_profile], "depth": jacket_depth}},
          vertex_paint={"baseColor": "#1D1F23", "regions": paint_regions},
          features=[lf("snap-rivets", "fastener", "small silver snaps on front panels (documented, sub-pixel at blockout)", "documented; instanced micro parts deferred to form-refinement", "torso-zone"),
                    lf("panel-stitch-lines", "stitch", "faint panel stitching on the nylon", "documented; flat textureless material", "torso-zone"),
                    lf("open-front-placket", "seam", "open front edges with turquoise piping", "geometry: C-section gap 0.10 wide + vertexPaint piping", "torso-zone")],
          evidence=["full-object", "torso-zone", "back-view"],
          collider={"type": "box", "offset": [0, 0.1, 0], "scale": [0.36, 0.21, 0.29], "isTrigger": False, "notes": "jacket proxy"})

    # stand-up collar: smaller C-section with turquoise inner lining
    ca, cb, ct = 0.098, 0.094, 0.016
    cgap = math.asin(0.045 / ca)
    c0 = -math.pi / 2 + cgap
    c1 = -math.pi / 2 - cgap + 2 * math.pi
    collar_profile = ellipse_points(ca, cb, 40, c0, c1, cz=-0.005) + list(reversed(ellipse_points(ca - ct, cb - ct, 40, c0, c1, cz=-0.005)))
    collar_depth = 0.072
    T.add("jacket-collar", "High stand-up collar", "extrude", "chest", (0.0, 0.85, 0.0), (2 * ca, collar_depth, 2 * cb),
          "jacket-nylon", "garment", "meso", "conforming-shell",
          "Stand collar is a thin open C-ring around the neck (front.png y 222-235), turquoise lining on its inner face.",
          rotation=(-math.pi / 2, 0, 0), transform_scale=(1, 1, 1), importance=0.75,
          descriptor={"profile2D": {"points": [r5(p) for p in collar_profile], "depth": collar_depth}},
          vertex_paint={"baseColor": "#1D1F23", "regions": [
              {"id": "turquoise-inner-lining", "kind": "ellipsoid", "color": "#19D3C5", "softness": 0.002,
               "center": [0.0, -0.005, collar_depth / 2], "radii": [ca - ct + 0.004, cb - ct + 0.004, 0.2]}]},
          features=[lf("turquoise-inner-lining", "decal", "turquoise lining on the collar's inner face", "vertexPaint ellipsoid region", "torso-zone")],
          evidence=["full-object", "torso-zone"])

    # ---------------- neck / head ----------------
    neck_a, neck_b = (0.0, 0.862, 0.0), (0.0, 0.94, 0.0)
    T.add("neck", "Neck (slime)", "cylinder", "chest", neck_a, (0.11, 0.078, 0.11), "slime-skin", "support", "meso",
          "assembled-solid", "Short slime neck segment between collar and chin; tapered cylinder between joints.",
          attachment=(neck_a, neck_b, 0.056, 0.05, "chest-neck-base", "rigid-weld"), importance=0.6,
          evidence=["full-object", "head-zone"])
    head_c = (0.0, 1.113, 0.0)
    head_r = (0.215, 0.20, 0.21)
    T.add("head", "Head (slime)", "ellipsoid", "neck", head_c, (0.43, 0.40, 0.42), "slime-skin", "body", "macro",
          "continuous-sculpt",
          "One continuous round slime head volume (chin y 221 -> estimated skull top y 55 = 0.40 tall, 0.43 wide incl. cheeks); no seams, eyes or ears.",
          importance=1.0, evidence=["full-object", "head-zone"],
          sockets=[{"id": "goggles", "localPosition": [0, -0.058, 0.2], "localRotation": [0, 0, 0],
                    "purpose": "goggle mount (detachable for swim form)"},
                   {"id": "hat", "localPosition": [0, 0.21, 0], "localRotation": [0, 0, 0], "purpose": "headwear"}],
          features=[lf("chin-taper", "bevel", "lower face narrows toward the chin (y 200: 140 px -> y 218: 76 px)", "ellipsoid lower curvature", "head-zone")],
          collider={"type": "sphere", "offset": [0, 0, 0], "scale": [0.44, 0.42, 0.44], "isTrigger": False, "notes": "head sphere"})

    def H(x, y, z=0.0):
        """front.png pixel -> head-local point (head centre at front.png y 138)."""
        return ((x - CX) * S, (138.0 - y) * S, z)

    def surf_z(X, Y, hemi, pad):
        ax, ay, az = head_r[0] + pad, head_r[1] + pad, head_r[2] + pad
        q = 1 - (X / ax) ** 2 - (Y / ay) ** 2
        return hemi * (az * math.sqrt(q) if q > 0 else 0.0) + hemi * 0.01

    def headw(local):
        return add(head_c, local)

    # mouth (smile)
    smile_pts = []
    for i in range(7):
        t = -1 + 2 * i / 6
        X = 0.036 * t
        Y = (138 - 205) * S + 0.009 * t * t
        q = 1 - (X / head_r[0]) ** 2 - (Y / head_r[1]) ** 2
        Z = head_r[2] * math.sqrt(max(q, 0)) + 0.003
        smile_pts.append((X, Y, Z))
    T.add("mouth-smile", "Smile line", "tapered-sweep", "head", headw((0, 0, 0)), (0.075, 0.012, 0.01), "mouth-line",
          "detail", "micro", "surface-relief",
          "Painted smile is linework on the face surface: a 4 mm tapered arc sitting 3 mm proud of the head ellipsoid (front.png y 205).",
          transform_scale=(1, 1, 1), importance=0.6,
          descriptor=sweep(smile_pts, [0.0, 0.0028, 0.0038, 0.004, 0.0038, 0.0028, 0.0], radial=8),
          features=[lf("smile-curve", "linework", "upward-curved smile, 0.072 wide", "geometry arc + dark-teal material", "head-zone")],
          evidence=["full-object", "head-zone"])

    # goggles (single wide visor wider than the head)
    T.add("goggle-body", "Goggle frame/body (white)", "ellipsoid", "head", headw((0, -0.058, 0.115)),
          (0.53, 0.17, 0.30), "goggle-frame", "detail", "macro", "assembled-solid",
          "Rigid white plastic visor body, 1.17x head width (front.png x 100-319); a deep ellipsoid so it meets the face at the temples from side/3-4 views.",
          importance=1.0, detach=True, evidence=["full-object", "head-zone", "side-view"],
          features=[lf("frame-rounded-bevel", "bevel", "rounded white bezel exposed around the lens", "geometry: body rim visible around the lens", "head-zone"),
                    lf("nose-bridge-notch", "groove", "frame dips at the bottom centre", "approximated by lens curvature at blockout", "head-zone")])
    T.add("goggle-lens", "Goggle lens (single black visor)", "ellipsoid", "head", headw((0, -0.058, 0.225)),
          (0.40, 0.135, 0.10), "goggle-lens", "detail", "meso", "assembled-solid",
          "Single wide glossy black lens dome (front.png x 120-280, y 133-192) proud of the white body on every side.",
          importance=1.0, evidence=["full-object", "head-zone"],
          features=[lf("lens-dome", "gloss", "domed lens surface catching an environment band", "geometry dome + clearcoat material", "head-zone")])
    tr = 0.035
    sx_strap = 0.252 / (0.45 * (1 + tr))
    sy_strap = 0.262 / (0.45 * (1 + tr))
    sz_strap = 0.048 / (2 * 0.45 * tr)
    T.add("goggle-strap", "Goggle strap (around head over hair)", "torus", "head", headw((0, -0.052, 0.0)),
          (sx_strap, sy_strap, sz_strap), "strap-fabric", "strap", "meso", "conforming-shell",
          "Flat elastic band following the head+hair contour at lens height (back.png y 150-185); a thin flattened torus rotated horizontal.",
          rotation=(math.pi / 2, 0, 0), importance=0.8, descriptor={"torusTubeRatio": tr},
          evidence=["back-view", "side-view", "head-zone"],
          features=[lf("strap-band", "seam", "black band 0.048 tall wrapping over the hair at the back", "geometry", "back-view")])
    for side, sgn in (("l", 1), ("r", -1)):
        T.add(f"goggle-clip-{side}", f"Goggle strap clip {side.upper()}", "box", "head", headw((sgn * 0.255, -0.058, 0.07)),
              (0.03, 0.05, 0.045), "metal-brushed", "detail", "micro", "assembled-solid",
              "Small rectangular metal clip hinge where strap meets frame at the temple (front.png x 100/319, y 150-190).",
              importance=0.5, evidence=["head-zone"],
              features=[lf("clip-hinge", "fastener", "silver rectangular clip hinge", "geometry micro box", "head-zone")])

    # hair: cap + 17 tapered-sweep locks + crown tuft + 5 teardrop droplets
    proud = {"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.08,
             "rationale": "slime locks must sit outside the skull ellipsoid; a sunk lock reads as a bald patch"}
    T.add("hair-cap", "Slime hair mass (crown cap)", "ellipsoid", "head", headw((0, 0.09, -0.015)), (0.455, 0.27, 0.45),
          "slime-hair", "hair", "macro", "continuous-sculpt",
          "Continuous slime mass over the crown and back of the skull that the locks grow out of (front.png y 45-125).",
          importance=0.9, stand_proud=dict(proud, maxPush=0.13), evidence=["full-object", "head-zone", "back-view"],
          features=[lf("falling-droplets", "ridge", "teardrop droplets falling beside the head (hair-drop-*)", "geometry: tapered-sweep teardrops", "head-zone")])
    locks = [
        # id, [(x_img, y_img, hemisphere)], radius, label
        ("hair-lock-01", [(166, 70, 1), (152, 98, 1), (143, 124, 1)], 0.036, "fringe outer-right"),
        ("hair-lock-02", [(188, 64, 1), (184, 96, 1), (182, 122, 1)], 0.038, "fringe centre-right"),
        ("hair-lock-03", [(214, 66, 1), (220, 98, 1), (223, 123, 1)], 0.038, "fringe centre-left"),
        ("hair-lock-04", [(238, 72, 1), (254, 100, 1), (262, 125, 1)], 0.036, "fringe outer-left"),
        ("hair-lock-05", [(150, 84, 1), (128, 108, 1), (118, 138, 1)], 0.032, "front side-right"),
        ("hair-lock-06", [(252, 84, 1), (282, 106, 1), (292, 136, 1)], 0.032, "front side-left"),
        ("hair-lock-07", [(138, 78, 0.3), (106, 104, 0.3), (95, 150, 0.2), (93, 182, 0.2)], 0.03, "side right long"),
        ("hair-lock-08", [(128, 112, -0.2), (112, 150, -0.2), (110, 192, -0.2)], 0.027, "side right rear"),
        ("hair-lock-09", [(258, 58, 0.2), (298, 60, 0.1), (328, 78, 0.0), (336, 118, 0.0)], 0.03, "top-left jutting lock"),
        ("hair-lock-10", [(278, 98, 0.3), (304, 128, 0.2), (308, 172, 0.2), (305, 198, 0.2)], 0.028, "side left long"),
        ("hair-lock-11", [(272, 120, -0.3), (292, 160, -0.3), (290, 196, -0.3)], 0.026, "side left rear"),
        ("hair-lock-12", [(162, 70, -1), (150, 112, -1), (150, 170, -1), (156, 212, -1)], 0.034, "back right"),
        ("hair-lock-13", [(198, 62, -1), (198, 118, -1), (198, 176, -1), (198, 224, -1)], 0.036, "back centre"),
        ("hair-lock-14", [(236, 70, -1), (248, 112, -1), (248, 170, -1), (242, 212, -1)], 0.034, "back left"),
        ("hair-lock-15", [(122, 100, -0.6), (110, 150, -0.6), (118, 198, -0.6)], 0.03, "back outer right"),
        ("hair-lock-16", [(276, 100, -0.6), (290, 150, -0.6), (282, 198, -0.6)], 0.03, "back outer left"),
        ("hair-lock-17", [(200, 52, 0.6), (176, 60, 0.8), (158, 74, 0.9)], 0.03, "crown front sweep"),
    ]
    lock_ids = []
    for lid, cps, r, label in locks:
        pts = []
        for x, y, hemi in cps:
            X, Y, _ = H(x, y)
            sign = 1 if hemi >= 0 else -1
            Z = surf_z(X, Y, sign, r * 0.9) * abs(hemi) if abs(hemi) >= 0.99 else surf_z(X, Y, sign, r * 0.9) * max(abs(hemi), 0.15)
            pts.append((X, Y, Z))
        # root sinks into the cap; path densified; bulbous rounded tip closes to a point
        root = add(pts[0], mul(norm((pts[0][0], pts[0][1] + 0.05, pts[0][2])), -0.02))
        dense = catmull([root] + pts, 4)
        tipdir = norm(sub(dense[-1], dense[-2]))
        tip = add(dense[-1], mul(tipdir, r * 0.9))
        dense.append(tip)
        n = len(dense)
        radii = []
        for i in range(n):
            u = i / (n - 1)
            if i == n - 1:
                radii.append(0.0)
            elif u > 0.85:
                radii.append(r * 1.08)
            else:
                radii.append(r * (0.92 - 0.12 * math.sin(math.pi * u)))
        T.add(lid, f"Slime hair lock ({label})", "tapered-sweep", "head", headw((0, 0, 0)),
              (0.08, 0.15, 0.08), "slime-hair", "hair", "meso", "fiber-strand",
              "Blobby drooping slime lock: a swept strand with a pinched neck and bulbous rounded tip, rigidly parented to the head (never skinned).",
              transform_scale=(1, 1, 1), importance=0.75, descriptor=sweep(dense, radii, radial=12),
              stand_proud=proud, evidence=["full-object", "head-zone", "back-view"], confidence=0.7)
        lock_ids.append(lid)
    # crown tuft rising then curling toward +X (front.png x 196-247, y 16-46)
    tuft_cps = [H(198, 62, 0.0), H(199, 40, 0.01), H(204, 24, 0.015), H(220, 16, 0.01), H(238, 22, 0.0), H(245, 36, -0.005)]
    tuft = catmull(tuft_cps, 4)
    tuft.append(add(tuft[-1], mul(norm(sub(tuft[-1], tuft[-2])), 0.02)))
    tr_list = []
    for i in range(len(tuft)):
        u = i / (len(tuft) - 1)
        tr_list.append(0.0 if i == len(tuft) - 1 else (0.034 if u > 0.85 else 0.03 - 0.008 * math.sin(math.pi * u)))
    T.add("hair-tuft", "Slime crown tuft (rising, curls to +X)", "tapered-sweep", "head", headw((0, 0, 0)),
          (0.12, 0.13, 0.05), "slime-hair", "hair", "meso", "fiber-strand",
          "Crown tuft rises above the hair mass (front.png y 16) and curls toward the character's left; swept strand with bulbous tip.",
          transform_scale=(1, 1, 1), importance=0.85, descriptor=sweep(tuft, tr_list, radial=12), stand_proud=proud,
          evidence=["full-object", "head-zone", "side-view"], confidence=0.75)
    lock_ids.append("hair-tuft")
    drops = [("hair-drop-1", H(92, 197, 0.03), 0.016), ("hair-drop-2", H(108, 188, 0.11), 0.012),
             ("hair-drop-3", H(301, 196, 0.07), 0.015), ("hair-drop-4", H(307, 218, 0.02), 0.011),
             ("hair-drop-5", H(176, 40, -0.13), 0.013)]
    drop_ids = []
    for did, p, r in drops:
        pts = [(0, r * 1.6, 0), (0, r * 0.9, 0), (0, 0.0, 0), (0, -r * 0.7, 0), (0, -r * 1.05, 0)]
        T.add(did, "Slime droplet (teardrop)", "tapered-sweep", "head", headw(p), (2 * r, 2.6 * r, 2 * r), "slime-skin",
              "drip", "micro", "continuous-sculpt",
              "Falling slime droplet: teardrop volume pointed at the top, round at the bottom.",
              transform_scale=(1, 1, 1), importance=0.45,
              descriptor=sweep(pts, [0.0, r * 0.55, r * 0.95, r * 0.8, 0.0], radial=12),
              evidence=["head-zone"], confidence=0.65)
        drop_ids.append(did)

    # ---------------- arms ----------------
    J = {}
    J["shoulder"] = img(117, 283, 0.01)
    J["elbow"] = img(97, 333, 0.012)
    J["wrist"] = img(75, 359, 0.016)
    J["tip"] = img(46, 421, 0.02)
    clav_root_r = (-0.035, 0.85, 0.0)
    for side, sgn in (("l", 1), ("r", -1)):
        f = (lambda p: p) if side == "r" else mirror
        shoulder, elbow, wrist, tipp = f(J["shoulder"]), f(J["elbow"]), f(J["wrist"]), f(J["tip"])
        clav_root = f(clav_root_r)
        T.add(f"clavicle-{side}", f"Shoulder yoke {side.upper()} (boxy jacket shoulder)", "capsule", "chest", clav_root,
              (0.16, 0.12, 0.12), "jacket-nylon", "support", "meso", "assembled-solid",
              "Boxy padded jacket shoulder from the collar to the shoulder joint (front.png shoulder top y 270); thick tapered segment.",
              attachment=(clav_root, shoulder, 0.05, 0.064, f"chest-clavicle-{side}", "rigid-weld"), importance=0.65,
              evidence=["full-object", "torso-zone"])
        d_up = norm(sub(elbow, shoulder))
        q_up = quat_from_unit_vectors((0, 1, 0), d_up)
        front_local = norm(quat_rotate(quat_conj(q_up), (0, 0, 1)))
        L_up = math.dist(shoulder, elbow)
        stripe = {"id": "sleeve-piping", "kind": "tapered-capsule", "color": "#19D3C5", "softness": 0.003,
                  "start": r5(add(mul(front_local, 0.062), (0, -L_up / 2, 0))),
                  "end": r5(add(mul(front_local, 0.06), (0, L_up / 2, 0))), "startRadius": 0.014, "endRadius": 0.014}
        T.add(f"upper-arm-{side}", f"Upper arm {side.upper()} (puffy jacket sleeve)", "capsule", f"clavicle-{side}", shoulder,
              (0.124, L_up, 0.124), "jacket-nylon", "arm", "meso", "conforming-shell",
              "Puffy elbow-length jacket sleeve over the slime upper arm (front.png 45 px wide); tapered segment shoulder->elbow carrying the sleeve piping.",
              attachment=(shoulder, elbow, 0.062, 0.06, f"clavicle-shoulder-{side}", "socket-joint"), importance=0.75,
              vertex_paint={"baseColor": "#1D1F23", "regions": [stripe]}, evidence=["full-object", "torso-zone"],
              collider={"type": "capsule", "offset": [0, 0, 0], "scale": [0.12, L_up, 0.12], "isTrigger": False, "notes": "sleeve capsule"})
        T.add(f"forearm-{side}", f"Forearm {side.upper()} (slime)", "capsule", f"upper-arm-{side}", elbow,
              (0.06, math.dist(elbow, wrist), 0.06), "slime-skin", "arm", "meso", "assembled-solid",
              "Exposed slime forearm between the sleeve cuff and wristband (front.png y 333-359).",
              attachment=(elbow, wrist, 0.031, 0.028, f"upper-arm-elbow-{side}", "hinge-joint"), importance=0.65,
              evidence=["full-object"])
        d_fa = norm(sub(wrist, elbow))
        q_cuff = quat_from_unit_vectors((0, 0, 1), d_fa)
        e_cuff = euler_xyz_from_quat(q_cuff)
        q_band = quat_from_unit_vectors((0, 1, 0), d_fa)
        e_band = euler_xyz_from_quat(q_band)
        T.add(f"sleeve-cuff-{side}", f"Sleeve cuff {side.upper()} (gathered)", "torus", f"forearm-{side}",
              add(elbow, mul(d_fa, 0.006)), (0.1, 0.1, 0.13), "jacket-nylon", "cuff", "meso", "conforming-shell",
              "Gathered elastic sleeve cuff ringing the elbow (front.png crop: cuff band at y 320-347).",
              rotation=e_cuff, importance=0.55, descriptor={"torusTubeRatio": 0.3}, evidence=["full-object"],
              features=[lf("cuff-gathers", "groove", "gathered elastic folds", "torus band", "full-object")])
        T.add(f"wristband-{side}", f"Wristband {side.upper()} (black velcro)", "lathe", f"forearm-{side}", wrist,
              (0.072, 0.028, 0.072), "strap-fabric", "band", "micro", "assembled-solid",
              "Black velcro wristband at the wrist (front.png y 348-370); a short closed lathe band.",
              rotation=e_band, transform_scale=(1, 1, 1), importance=0.55,
              descriptor={"latheProfile": {"points": [[0.0001, -0.014], [0.034, -0.014], [0.037, 0.0], [0.034, 0.014], [0.0001, 0.014]], "segments": 32}},
              evidence=["full-object"],
              features=[lf("velcro-tab", "seam", "velcro tab seam on the band", "documented on the lathe band", "full-object")])
        # hand: palm as a tapered sweep (unrotated bone); digits as tapered sweeps with attachment contracts
        d_h = norm(sub(tipp, wrist))
        lat = norm((-d_h[1], d_h[0], 0.0))   # in-plane (XY) perpendicular to the hand axis
        knuckle = add(wrist, mul(d_h, 0.085))
        palm_pts = [wrist, add(wrist, mul(d_h, 0.03)), add(wrist, mul(d_h, 0.06)), knuckle, add(wrist, mul(d_h, 0.1))]
        palm_local = [sub(p, wrist) for p in palm_pts]
        hand_sockets = []
        if side == "r":
            hand_sockets = [{"id": "hand_r", "localPosition": r5(mul(d_h, 0.055)), "localRotation": [0.0, 0.0, 0.0],
                             "purpose": "blaster grip (reference/blaster.png); prop parents here"}]
        T.add(f"hand-{side}", f"Hand {side.upper()} (slime mitten palm)", "tapered-sweep", f"forearm-{side}", wrist,
              (0.09, 0.1, 0.055), "slime-skin", "hand", "meso", "continuous-sculpt",
              "Mitten-like slime palm: one swept volume from wrist to knuckles, widest across the palm (front.png ~40 px wide).",
              transform_scale=(1, 1, 1), importance=0.7, sockets=hand_sockets,
              descriptor=sweep(palm_local, [(0.022, 0.026), (0.027, 0.04), (0.028, 0.046), (0.026, 0.044), (0.016, 0.02)], radial=14),
              evidence=["full-object"],
              features=[lf("hand-drip", "ridge", "small slime drip on the back of the hand", "documented", "full-object")],
              collider={"type": "sphere", "offset": [0, -0.05, 0], "scale": [0.1, 0.12, 0.08], "isTrigger": False, "notes": "hand sphere"})
        # digits: 3 fingers + thumb; local frames are unrotated so stations are authored in hand space
        digit_defs = [
            ("index", -0.026, 0.0, 0.062, 0.0175),
            ("middle", 0.0, 0.0, 0.068, 0.0185),
            ("ring", 0.026, 0.0, 0.058, 0.017),
        ]
        medial = (-float(sgn), 0.0, 0.0)  # toward the body: +X for the right hand, -X for the left
        for dname, off, _z, length, rad in digit_defs:
            # spread across the palm width along the in-plane lateral axis; index nearest the front
            # index sits medially (thumb side); lat flips with the side, so off*sgn keeps the pair a mirror
            root = add(knuckle, add(mul(lat, off * sgn), (0, 0, 0.012 - abs(off) * 0.3)))
            dvec = norm(add(d_h, mul(lat, off * sgn * 2.0)))
            end = add(root, mul(dvec, length))
            pts = [(0, 0, 0), mul(dvec, length * 0.35), mul(dvec, length * 0.75), mul(dvec, length)]
            L = length
            T.add(f"{dname}-{side}-1", f"{dname.capitalize()} finger {side.upper()} (slime)", "tapered-sweep", f"hand-{side}", root,
                  (L, L, L), "slime-skin", "finger", "micro", "continuous-sculpt",
                  "Rounded slime finger: swept digit with a bulbous tip (mitten hand reads as 3 fingers + thumb).",
                  transform_scale=(L, L, L), importance=0.35,
                  attachment=None,
                  descriptor=sweep([mul(p, 1 / L) for p in pts], [rad / L * 0.95, rad / L, rad / L * 1.05, 0.0], radial=10),
                  evidence=["full-object"], confidence=0.6,
                  extra={"attachment": ns._limb_attachment(r5(sub(root, T.anchor[f"hand-{side}"])), r5(sub(end, T.anchor[f"hand-{side}"])),
                                                           rad, rad * 0.8, socket=f"hand-{side}-{dname}-1",
                                                           contact_type="rigid-weld", evidence=["full-object"])})
        # thumb: from the palm's medial-front edge, forward/down
        th_root = add(wrist, add(mul(d_h, 0.03), add(mul(medial, 0.02), (0, 0, 0.022))))
        th_dir = norm(add(mul(d_h, 0.7), add(mul(medial, 0.35), (0, 0, 0.55))))
        th_len = 0.05
        th_end = add(th_root, mul(th_dir, th_len))
        th_pts = [(0, 0, 0), mul(th_dir, th_len * 0.4), mul(th_dir, th_len * 0.8), mul(th_dir, th_len)]
        T.add(f"thumb-{side}-1", f"Thumb {side.upper()} (slime)", "tapered-sweep", f"hand-{side}", th_root,
              (th_len, th_len, th_len), "slime-skin", "finger", "micro", "continuous-sculpt",
              "Opposed slime thumb branching medially/forward from the palm.",
              transform_scale=(th_len, th_len, th_len), importance=0.35,
              descriptor=sweep([mul(p, 1 / th_len) for p in th_pts], [0.019 / th_len, 0.02 / th_len, 0.02 / th_len, 0.0], radial=10),
              evidence=["full-object"], confidence=0.6,
              extra={"attachment": ns._limb_attachment(r5(sub(th_root, T.anchor[f"hand-{side}"])), r5(sub(th_end, T.anchor[f"hand-{side}"])),
                                                       0.019, 0.015, socket=f"hand-{side}-thumb-1",
                                                       contact_type="rigid-weld", evidence=["full-object"])})

    # ---------------- harness + backpack tank ----------------
    for side, sgn in (("l", 1), ("r", -1)):
        T.add(f"harness-strap-{side}", f"Harness strap {side.upper()} (front)", "box", "chest", (sgn * 0.102, 0.772, 0.142),
              (0.036, 0.16, 0.012), "strap-fabric", "strap", "meso", "conforming-shell",
              "Black webbing strap lying on the jacket front from the shoulder to the lower chest (front.png x 150/245, y 250-315).",
              importance=0.6, evidence=["full-object", "torso-zone"])
        T.add(f"harness-buckle-{side}", f"Harness buckle {side.upper()}", "torus", f"harness-strap-{side}",
              (sgn * 0.102, 0.79, 0.152), (0.052, 0.05, 0.03), "metal-brushed", "detail", "micro", "assembled-solid",
              "Silver rectangular buckle frame on the strap at chest height (front.png y 263-280).",
              importance=0.55, descriptor={"torusTubeRatio": 0.2}, evidence=["torso-zone"],
              features=[lf("buckle-frame", "fastener", "rectangular buckle frame + slide bar", "torus frame micro part", "torso-zone")])
        T.add(f"harness-yoke-{side}", f"Harness over-shoulder strap {side.upper()}", "box", "chest", (sgn * 0.105, 0.845, 0.0),
              (0.036, 0.016, 0.28), "strap-fabric", "strap", "meso", "conforming-shell",
              "Strap section running over the shoulder from the front strap to the back plate (3/4 and side views).",
              rotation=(0, 0, -sgn * 0.12), importance=0.5, evidence=["side-view", "back-view"])
    T.add("back-plate", "Backpack frame plate", "box", "chest", (0.0, 0.755, -0.142), (0.16, 0.25, 0.03), "rubber-black",
          "frame", "macro", "assembled-solid",
          "Black rigid back plate the tank mounts to (back.png y 225-355 behind the tank).",
          importance=0.8, detach=True, evidence=["back-view", "side-view"],
          sockets=[{"id": "back", "localPosition": [0.0, 0.0, -0.016], "localRotation": [0, 0, 0],
                    "purpose": "backpack tank mount (tank detaches here)"}])
    tank_c = (0.0, 0.755, -0.215)
    T.add("tank", "Ink tank glass cylinder", "lathe", "back-plate", tank_c, (0.116, 0.25, 0.116), "tank-glass", "container",
          "macro", "assembled-solid",
          "Vertical clear glass cylinder (back.png 0.12 wide, y 250-348) with rounded shoulders; lathe revolve.",
          transform_scale=(1, 1, 1), importance=0.95, detach=True,
          descriptor={"latheProfile": {"points": [[0.0001, -0.125], [0.05, -0.125], [0.058, -0.115], [0.058, 0.115], [0.05, 0.125], [0.0001, 0.125]], "segments": 40}},
          evidence=["back-view", "side-view"],
          features=[lf("glass-wall", "gloss", "clear glass wall with vertical specular streak", "transmission material", "back-view")],
          collider={"type": "cylinder", "offset": [0, 0, 0], "scale": [0.13, 0.33, 0.13], "isTrigger": False, "notes": "tank proxy"})
    T.add("tank-liquid", "Turquoise ink liquid", "lathe", "tank", tank_c, (0.1, 0.205, 0.1), "ink-liquid", "liquid", "meso",
          "continuous-sculpt", "Liquid volume filling ~85% of the glass (back.png); revolved with a flat meniscus.",
          transform_scale=(1, 1, 1), importance=0.85,
          descriptor={"latheProfile": {"points": [[0.0001, -0.118], [0.05, -0.118], [0.0505, -0.11], [0.0505, 0.085], [0.0001, 0.087]], "segments": 40}},
          evidence=["back-view", "side-view"],
          features=[lf("bubbles", "gloss", "small bubbles inside the liquid (tank-bubble-*)", "micro spheres", "back-view")])
    for i, (bx, by, bz, br) in enumerate([(0.02, 0.04, 0.02, 0.008), (-0.025, -0.02, 0.015, 0.006), (0.01, -0.07, -0.025, 0.007), (-0.015, 0.06, -0.02, 0.005)], 1):
        T.add(f"tank-bubble-{i}", f"Ink bubble {i}", "sphere", "tank-liquid", add(tank_c, (bx, by, bz)), (2 * br, 2 * br, 2 * br),
              "tank-glass", "detail", "micro", "continuous-sculpt", "Air bubble suspended in the ink (back.png).",
              importance=0.25, evidence=["back-view"], confidence=0.5)
    T.add("tank-cap-top", "Tank top cap", "lathe", "tank", add(tank_c, (0, 0.125, 0)), (0.126, 0.042, 0.126), "rubber-black",
          "cap", "meso", "assembled-solid", "Black rounded top cap (side.png y 210-228).", transform_scale=(1, 1, 1),
          importance=0.6, descriptor={"latheProfile": {"points": [[0.0001, -0.004], [0.063, -0.004], [0.063, 0.024], [0.05, 0.04], [0.0001, 0.042]], "segments": 32}},
          evidence=["back-view", "side-view"])
    T.add("tank-valve", "Tank valve knob", "lathe", "tank-cap-top", add(tank_c, (0, 0.165, 0)), (0.04, 0.035, 0.04),
          "rubber-black", "detail", "micro", "assembled-solid", "Valve knob on the top cap (side.png y 205-212).",
          transform_scale=(1, 1, 1), importance=0.4,
          descriptor={"latheProfile": {"points": [[0.0001, 0.0], [0.014, 0.0], [0.014, 0.018], [0.02, 0.022], [0.02, 0.032], [0.0001, 0.035]], "segments": 24}},
          evidence=["side-view"])
    T.add("tank-cap-bottom", "Tank bottom cap", "lathe", "tank", add(tank_c, (0, -0.125, 0)), (0.126, 0.042, 0.126),
          "rubber-black", "cap", "meso", "assembled-solid", "Black rounded bottom cap (back.png y 345-358).",
          transform_scale=(1, 1, 1), importance=0.6,
          descriptor={"latheProfile": {"points": [[0.0001, -0.042], [0.05, -0.04], [0.063, -0.024], [0.063, 0.004], [0.0001, 0.004]], "segments": 32}},
          evidence=["back-view", "side-view"])
    for name, dy in (("top", 0.108), ("bottom", -0.108)):
        T.add(f"tank-band-{name}", f"Tank metal band ({name})", "torus", "tank", add(tank_c, (0, dy, 0)), (0.136, 0.136, 0.17),
              "metal-brushed", "detail", "micro", "assembled-solid",
              "Polished metal band ringing the glass under the cap (back.png silver rings).",
              rotation=(math.pi / 2, 0, 0), importance=0.45, descriptor={"torusTubeRatio": 0.1}, evidence=["back-view"],
              features=[lf("band-bevel", "bevel", "bevelled polished band edge", "torus band", "back-view")])
    # corrugated hose: bottom cap -> loop -> right hip (back.png coil at the character's right; side.png U-loop)
    hose_ctrl = [(0.0, 0.592, -0.215), (-0.035, 0.545, -0.222), (-0.09, 0.505, -0.205), (-0.14, 0.49, -0.155),
                 (-0.168, 0.52, -0.095), (-0.163, 0.565, -0.055), (-0.15, 0.595, -0.035)]
    path = catmull(hose_ctrl, 10)
    stations, length = resample(path, 0.0045)
    hose_start = hose_ctrl[0]
    hose_radii = []
    for i in range(len(stations)):
        phase = (i % 4)
        r = (0.0175, 0.0145, 0.0092, 0.0145)[phase]
        hose_radii.append(r)
    T.add("hose", "Ink hose (corrugated, to right hip)", "tapered-sweep", "tank-cap-bottom", hose_start, (0.17, 0.09, 0.19),
          "rubber-black", "hose", "meso", "fiber-strand",
          f"Corrugated black hose ({length:.3f} long) looping from the bottom cap to the right hip; ribs are encoded as alternating station radii (peak 0.0175 / valley 0.0092), so the sweep varies in radius by construction.",
          transform_scale=(1, 1, 1), importance=0.8,
          descriptor=sweep([sub(p, hose_start) for p in stations], hose_radii, radial=10),
          evidence=["back-view", "side-view"], confidence=0.7,
          features=[lf("corrugation-ribs", "groove", "deep corrugation ribs along the hose", "alternating sweep radii", "back-view")])
    T.add("hose-coupler", "Hose hip coupler", "lathe", "pelvis", (-0.15, 0.598, -0.033), (0.04, 0.03, 0.04), "metal-brushed",
          "detail", "micro", "assembled-solid", "Metal coupler where the hose meets the right hip/belt (back.png, side.png).",
          rotation=(0.4, 0.0, -0.2), transform_scale=(1, 1, 1), importance=0.35,
          descriptor={"latheProfile": {"points": [[0.0001, -0.015], [0.02, -0.015], [0.02, 0.015], [0.0001, 0.015]], "segments": 20}},
          evidence=["back-view"], confidence=0.55)

    # ---------------- legs ----------------
    T.add("waistband", "Jogger waistband", "lathe", "pelvis", (0.0, 0.615, 0.005), (0.32, 0.03, 0.26), "pants-twill",
          "band", "meso", "assembled-solid", "Black elastic waistband below the tee hem (front.png y 340-350).",
          transform_scale=(1, 1, 0.82), importance=0.5,
          descriptor={"latheProfile": {"points": [[0.0001, -0.015], [0.158, -0.015], [0.162, 0.0], [0.158, 0.015], [0.0001, 0.015]], "segments": 40}},
          evidence=["torso-zone"])
    hip_r = (-0.095, 0.57, 0.01)
    knee_r = (-0.128, 0.39, 0.022)
    ankle_r = (-0.165, 0.215, -0.018)
    for side, sgn in (("l", 1), ("r", -1)):
        f = (lambda p: p) if side == "r" else mirror
        hip, knee, ankle = f(hip_r), f(knee_r), f(ankle_r)
        outer_w = (sgn * 1.0, 0.0, 0.0)

        def stripe_for(a, b, ra, rb, rid):
            d = norm(sub(b, a))
            q = quat_from_unit_vectors((0, 1, 0), d)
            o = quat_rotate(quat_conj(q), outer_w)
            o = norm((o[0], 0.0, o[2]))
            Lseg = math.dist(a, b)
            return {"id": rid, "kind": "tapered-capsule", "color": "#19D3C5", "softness": 0.003,
                    "start": r5(add(mul(o, ra), (0, -Lseg / 2, 0))), "end": r5(add(mul(o, rb), (0, Lseg / 2, 0))),
                    "startRadius": 0.015, "endRadius": 0.015}

        T.add(f"thigh-{side}", f"Thigh {side.upper()} (baggy cargo pant leg)", "capsule", "pelvis", hip,
              (0.18, math.dist(hip, knee), 0.18), "pants-twill", "leg", "meso", "conforming-shell",
              "Baggy jogger leg over the slime thigh (front.png y 390-450, ~0.18 wide); tapered segment hip->knee with the outer-seam stripe.",
              attachment=(hip, knee, 0.092, 0.085, f"pelvis-hip-{side}", "socket-joint"), importance=0.75,
              vertex_paint={"baseColor": "#2A2C31", "regions": [stripe_for(hip, knee, 0.092, 0.085, "outer-seam-stripe")]},
              evidence=["full-object", "legs-zone"],
              collider={"type": "capsule", "offset": [0, 0, 0], "scale": [0.18, 0.18, 0.18], "isTrigger": False, "notes": "thigh capsule"})
        # cargo pocket on the front-outer thigh (front.png x 108-148, y 383-440)
        # pocket on the thigh surface, 45 deg between front and outer side (front.png x 108-148, y 383-440)
        def thigh_surface(yw, out_off):
            t = (hip[1] - yw) / (hip[1] - knee[1])
            axis = add(hip, mul(sub(knee, hip), t))
            radius = 0.092 + (0.085 - 0.092) * t + out_off
            n_out = norm((sgn * 0.707, 0.0, 0.707))
            return add(axis, mul(n_out, radius))
        pocket_c = thigh_surface(0.453, 0.012)
        T.add(f"cargo-pocket-{side}", f"Cargo pocket {side.upper()}", "box", f"thigh-{side}", pocket_c, (0.09, 0.13, 0.03),
              "pants-twill", "pocket", "meso", "assembled-solid",
              "Large patch cargo pocket on the front-outer thigh, faces front-outward ~35 deg.",
              rotation=(0, sgn * 0.6, 0), importance=0.55, evidence=["full-object", "legs-zone"])
        flap_c = thigh_surface(0.512, 0.03)
        T.add(f"cargo-flap-{side}", f"Cargo pocket flap {side.upper()}", "box", f"thigh-{side}", flap_c, (0.097, 0.034, 0.036),
              "pants-twill", "pocket", "micro", "assembled-solid", "Pocket flap with seam and snap over the pocket opening.",
              rotation=(0, sgn * 0.6, 0), importance=0.45, evidence=["legs-zone"],
              features=[lf("flap-seam", "seam", "flap seam + snap", "box flap micro part", "legs-zone")])
        T.add(f"shin-{side}", f"Shin {side.upper()} (baggy jogger leg)", "capsule", f"thigh-{side}", knee,
              (0.176, math.dist(knee, ankle), 0.176), "pants-twill", "leg", "meso", "conforming-shell",
              "Ballooned jogger shin (front.png y 460-495, ~0.19 wide) narrowing to the gathered cuff.",
              attachment=(knee, ankle, 0.088, 0.072, f"thigh-knee-{side}", "hinge-joint"), importance=0.7,
              vertex_paint={"baseColor": "#2A2C31", "regions": [stripe_for(knee, ankle, 0.088, 0.072, "outer-seam-stripe")]},
              evidence=["full-object", "legs-zone"])
        d_sh = norm(sub(ankle, knee))
        e_sh = euler_xyz_from_quat(quat_from_unit_vectors((0, 1, 0), d_sh))
        T.add(f"pant-cuff-{side}", f"Jogger cuff {side.upper()} (gathered)", "lathe", f"shin-{side}", add(ankle, mul(d_sh, -0.028)),
              (0.15, 0.04, 0.15), "pants-twill", "cuff", "meso", "conforming-shell",
              "Gathered elastic jogger cuff at the ankle (front.png y 495-508).",
              rotation=e_sh, transform_scale=(1, 1, 1), importance=0.55,
              descriptor={"latheProfile": {"points": [[0.0001, -0.02], [0.066, -0.02], [0.076, -0.008], [0.077, 0.008], [0.07, 0.02], [0.0001, 0.02]], "segments": 32}},
              evidence=["full-object", "feet-zone"],
              features=[lf("elastic-gathers", "groove", "elastic gathers at the cuff", "lathe band narrower than the shin", "feet-zone")])
        foot_c = add(ankle, (0, -0.012, 0))
        T.add(f"foot-{side}", f"Foot {side.upper()} (slime ankle)", "ellipsoid", f"shin-{side}", foot_c, (0.085, 0.08, 0.085),
              "slime-skin", "foot", "meso", "continuous-sculpt",
              "Turquoise slime ankle visible between the jogger cuff and the shoe collar (front.png y 505-520).",
              importance=0.55, evidence=["full-object", "feet-zone"])
        # ---- shoe (all parts direct children of the unrotated foot; yaw mirrors exactly) ----
        yaw = sgn * math.radians(12)
        fwd = (math.sin(yaw), 0.0, math.cos(yaw))
        shoe_c = (foot_c[0] + sgn * 0.018 + fwd[0] * 0.06, 0.0, foot_c[2] + fwd[2] * 0.06)
        def at(f_off, y, lat=0.0):
            return (shoe_c[0] + fwd[0] * f_off + fwd[2] * lat * sgn, y, shoe_c[2] + fwd[2] * f_off - fwd[0] * lat * sgn)
        footprint_mid = []
        footprint_out = []
        for k in range(36):
            t = 2 * math.pi * k / 36
            c, s_ = math.cos(t), math.sin(t)
            hx = 0.096 * (abs(c) ** 0.7) * (1 if c >= 0 else -1)
            hz = 0.196 * (abs(s_) ** 0.85) * (1 if s_ >= 0 else -1)
            footprint_mid.append([round(hx, 5), round(-hz, 5)])
            footprint_out.append([round(hx * 1.04, 5), round(-hz * 1.025, 5)])
        T.add(f"shoe-upper-{side}", f"Sneaker upper {side.upper()} (black)", "ellipsoid", f"foot-{side}", at(0.0, 0.105),
              (0.17, 0.15, 0.33), "shoe-upper", "shoe", "meso", "continuous-sculpt",
              "Chunky high-top upper: one rounded volume over the midsole (side.png 0.39 long incl. sole, toe-out 12 deg).",
              rotation=(0, yaw, 0), importance=0.7, evidence=["full-object", "feet-zone", "side-view"])
        T.add(f"shoe-collar-{side}", f"Sneaker ankle collar {side.upper()}", "lathe", f"foot-{side}", at(-0.06, 0.14),
              (0.15, 0.06, 0.15), "shoe-upper", "shoe", "meso", "assembled-solid",
              "Padded high-top ankle collar ring (front.png y 518-530).", transform_scale=(1, 1, 1), importance=0.5,
              descriptor={"latheProfile": {"points": [[0.0001, 0.0], [0.074, 0.0], [0.074, 0.05], [0.066, 0.058], [0.0001, 0.058]], "segments": 32}},
              evidence=["feet-zone", "side-view"])
        T.add(f"shoe-collar-trim-{side}", f"Collar trim {side.upper()} (white)", "torus", f"foot-{side}", at(-0.06, 0.195),
              (0.16, 0.16, 0.3), "shoe-midsole", "trim", "micro", "assembled-solid", "White padded collar edge.",
              rotation=(math.pi / 2, 0, 0), importance=0.35, descriptor={"torusTubeRatio": 0.09}, evidence=["feet-zone"])
        T.add(f"shoe-midsole-{side}", f"Sneaker midsole {side.upper()} (white)", "extrude", f"foot-{side}", at(0.0, 0.018),
              (0.2, 0.05, 0.39), "shoe-midsole", "sole", "meso", "assembled-solid",
              "Thick white midsole: footprint outline extruded 0.05 up (front.png white band y 565-590).",
              rotation=(-math.pi / 2, 0, yaw), transform_scale=(1, 1, 1), importance=0.75,
              descriptor={"profile2D": {"points": footprint_mid, "depth": 0.05}}, evidence=["full-object", "feet-zone", "side-view"],
              features=[lf("midsole-sidewall", "bevel", "rounded midsole sidewall", "extruded footprint", "feet-zone")])
        T.add(f"shoe-outsole-{side}", f"Sneaker outsole {side.upper()} (turquoise)", "extrude", f"foot-{side}", at(0.0, 0.0),
              (0.2, 0.022, 0.4), "shoe-outsole", "sole", "meso", "assembled-solid",
              "Turquoise rubber outsole rim/tread band under the midsole (front.png y 590-600).",
              rotation=(-math.pi / 2, 0, yaw), transform_scale=(1, 1, 1), importance=0.7,
              descriptor={"profile2D": {"points": footprint_out, "depth": 0.022}}, evidence=["full-object", "feet-zone"],
              features=[lf("tread-lugs", "groove", "chunky tread lugs on the rim; underside hidden", "documented; band geometry", "feet-zone")])
        T.add(f"shoe-tongue-{side}", f"Sneaker tongue {side.upper()}", "box", f"foot-{side}", at(0.02, 0.17), (0.07, 0.07, 0.022),
              "shoe-upper", "shoe", "micro", "assembled-solid", "Black tongue rising at the front of the collar with a turquoise tab.",
              rotation=(-0.35, yaw, 0), importance=0.4, evidence=["feet-zone"])
        T.add(f"shoe-panel-{side}", f"Sneaker side panel {side.upper()} (turquoise)", "box", f"foot-{side}", at(0.02, 0.1, 0.083),
              (0.012, 0.05, 0.12), "accent-turquoise", "panel", "micro", "surface-relief",
              "Turquoise overlay panel on the outer side of the upper.", rotation=(0, yaw, 0), importance=0.4,
              evidence=["feet-zone"])
        T.add(f"shoe-heel-tab-{side}", f"Sneaker heel tab {side.upper()} (turquoise)", "box", f"foot-{side}", at(-0.165, 0.13),
              (0.05, 0.07, 0.016), "accent-turquoise", "panel", "micro", "assembled-solid", "Turquoise heel pull tab.",
              rotation=(0.15, yaw, 0), importance=0.35, evidence=["side-view"])
        for li, (foff, ly) in enumerate([(0.03, 0.158), (0.07, 0.143), (0.11, 0.128)], 1):
            T.add(f"shoe-lace-{li}-{side}", f"Lace bar {li} {side.upper()}", "box", f"foot-{side}", at(foff, ly), (0.075, 0.009, 0.014),
                  "shoe-lace", "lace", "micro", "surface-relief", "White lace crossing over the instep.",
                  rotation=(-0.35, yaw, 0), importance=0.3, evidence=["feet-zone"],
                  features=[lf("lace-crossing", "fastener", "lace bar crossing", "micro box", "feet-zone")] if li == 1 else None)
    notes["lockIds"] = lock_ids
    notes["dropIds"] = drop_ids
    return T.nodes, notes


# ----------------------------------------------------------------------------------------------
# spec assembly
# ----------------------------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skill", required=True, type=Path)
    ap.add_argument("--starter", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)
    sys.path.insert(0, str(args.skill / "forge" / "stage2_spec"))
    sys.path.insert(0, str(args.skill / "forge" / "_shared"))
    import new_sculpt_spec as ns  # noqa: E402  (the skill's own schema helpers)

    spec = json.loads(args.starter.read_text(encoding="utf-8"))
    tree, notes = build_tree(ns)
    spec["componentTree"] = tree
    spec["rig"] = ns.derive_character_rig(tree)
    spec["rig"]["notes"] = [
        "Derived from the component tree by new_sculpt_spec.derive_character_rig (bind pose == reference A-pose).",
        "Hair, goggles, garments' trims, shoe parts and tank parts ride their parent bone rigidly (no attachment => not bones).",
        "Digits are bones via attachment contracts but keep tapered-sweep geometry (generator only derives cylinders for attachment primitives).",
    ]
    # Worn/carried items declare an anchor for forge/stage4_review/attachment_anchor.py. Added AFTER
    # derive_character_rig on purpose: any component carrying an `attachment` block is read as a bone
    # by the rig derivation, and goggles/tank/hose must ride their anchor rigidly, not become bones.
    worn = {
        "goggle-body": ("head", 0.16, "worn"), "goggle-lens": ("head", 0.26, "worn"),
        "goggle-strap": ("head", 0.08, "worn"), "back-plate": ("chest", 0.2, "equipment"),
        "tank": ("back-plate", 0.1, "equipment"), "hose": ("tank-cap-bottom", 0.06, "equipment"),
        "hose-coupler": ("pelvis", 0.2, "equipment"), "harness-strap-l": ("chest", 0.22, "equipment"),
        "harness-strap-r": ("chest", 0.22, "equipment"),
    }
    by_id = {c["id"]: c for c in tree}
    for cid, (anchor_id, max_offset, category) in worn.items():
        comp = by_id[cid]
        assert not comp.get("attachment"), cid
        comp["category"] = category
        comp["attachment"] = {"anchor": anchor_id, "maxOffset": max_offset,
                              "contract": "worn/carried item anchor (attachment_anchor.py); rigid ride on the anchor, not a limb weld",
                              "evidenceRefs": comp.get("evidenceRefs", ["full-object"])}
    spec["materials"] = [make_material(d) for d in MATERIAL_DEFS]
    ids = [c["id"] for c in tree]

    spec["suitability"] = "conditional"
    spec["scores"] = {"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 3, "primitive_decomposition": 2,
                      "material_procedurality": 3, "occlusion_risk": 1, "interaction_fit": 3}
    spec["coordinateFrame"] = {"front": "+Z (character faces the front.png camera)", "up": "+Y", "left": "+X (character's own left)",
                               "handedness": "right-handed", "units": "world units; 1 head unit = 0.40",
                               "scaleReference": "front.png: 166 px = 1 HU = 0.40 units; ground at Y=0; figure height 1.41 incl. hair tuft"}
    spec["referenceCamera"] = {
        "solved": False, "fovDegrees": 30.0, "aspect": 400 / 615,
        "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.72, 3.2], "target": [0.0, 0.70, 0.0],
        "note": "Stylized route (pipeline/projection-route.md): no projection, so the camera is a near-orthographic front framing matching reference/front.png (subject fills ~95% of the frame height). Orbit views: +35, -35, 90, 135, 180 azimuth.",
    }
    spec["silhouette"] = {
        "boundingShape": "tall rounded figure 1.41 high x 0.80 wide (hand-to-hand) x 0.50 deep (goggles to tank)",
        "aspectRatios": ["figure height / head+hair height = 2.85", "goggle width / head width = 1.17", "shoe length / figure height = 0.28"],
        "symmetry": "bilateral except asymmetric hair locks (tuft curls to +X, jutting lock at upper +X) and the hose on the right hip",
        "dominantCurves": ["blobby drooping hair locks", "wide elliptical goggle visor", "A-pose arm lines ~27 deg from vertical", "ballooned jogger legs gathered at the ankle"],
        "negativeSpaces": ["gap between arms and torso below the elbows", "gap between the legs below the crotch (front.png y 388)", "hose loop under the tank"],
        "landmarks": ["goggle band at head-local 0.44-0.86", "smile at 0.90", "jacket hem Y 0.646", "crotch Y 0.511", "fingertips Y 0.43", "ankle Y 0.21"],
    }
    spec["viewEvidence"] = [
        {"id": "full-object", "view": "front (reference/front.png)", "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
         "observations": ["full figure front view, A-pose, light-grey background"], "confidence": 0.9},
        {"id": "head-zone", "view": "front", "imageRegion": {"x": 0.2, "y": 0.0, "width": 0.65, "height": 0.36, "units": "normalized"},
         "observations": ["slime hair locks + tuft + droplets", "goggles", "smile"], "confidence": 0.85},
        {"id": "torso-zone", "view": "front", "imageRegion": {"x": 0.2, "y": 0.35, "width": 0.6, "height": 0.22, "units": "normalized"},
         "observations": ["open cropped jacket, piping, collar lining, harness straps + buckles, tee"], "confidence": 0.85},
        {"id": "legs-zone", "view": "front", "imageRegion": {"x": 0.2, "y": 0.55, "width": 0.6, "height": 0.3, "units": "normalized"},
         "observations": ["cargo joggers, stripes, pockets"], "confidence": 0.85},
        {"id": "feet-zone", "view": "front", "imageRegion": {"x": 0.1, "y": 0.8, "width": 0.8, "height": 0.2, "units": "normalized"},
         "observations": ["chunky sneakers, cuffs, turquoise ankles"], "confidence": 0.85},
        {"id": "side-view", "view": "right side (reference/side.png)", "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
         "observations": ["goggle depth, tank behind the back, hose U-loop, shoe length"], "confidence": 0.85},
        {"id": "back-view", "view": "back (reference/back.png)", "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
         "observations": ["strap over hair, tank + bands + caps, hose coil at the character's right"], "confidence": 0.85},
        {"id": "three-quarter-view", "view": "front 3/4 (reference/three-quarter.png)", "imageRegion": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
         "observations": ["tank silhouette beside the torso, goggle depth"], "confidence": 0.8},
    ]
    spec["assumptions"] = [
        "Skull top under the hair estimated at front.png y=55 (hidden) -> head unit 0.40 +-10%.",
        "Left side mirrors the observed right side (side.png) except hair asymmetry and the right-hip hose.",
        "Hands are 3 fingers + thumb mitten slime hands.",
        "Ink outlines of the illustration are not modelled in geometry; an optional inverted-hull outline pass belongs to the viewer.",
        "Blaster prop (reference/blaster.png) and swim form are out of scope for this factory; hand_r socket and goggles detach are provided.",
    ]
    spec["risks"] = [
        "Hair locks are inferred paths from silhouettes; lock topology must pass the silhouette review before material tuning.",
        "Glass transmission on the tank costs an extra render pass in three.js; may fall back to opacity in optimization-pass.",
        "Extruded jacket/tee prisms have straight sides; shoulder slope comes from the clavicle yokes and may need a lofted shell in form-refinement.",
    ]
    # repetition systems: documentation of realised repeated parts (members all built individually)
    spec["repetitionSystems"] = [
        {"id": "hair-locks", "name": "Slime hair locks", "level": "meso", "parent": "head", "count": len(notes["lockIds"]),
         "primitive": "tapered-sweep", "material": "slime-hair", "elementComponentIds": notes["lockIds"],
         "placement": {"mode": "authored", "notes": "fringe x6, sides x5, back x5, crown sweep + tuft; paths from front/back/side silhouettes"},
         "distributionRule": "locks droop under gravity from the crown; fringe ends at the goggle top; side locks reach cheek level",
         "buildsGeometry": True, "realization": "individual components"},
        {"id": "hair-drops", "name": "Falling slime droplets", "level": "micro", "parent": "head", "count": len(notes["dropIds"]),
         "primitive": "tapered-sweep", "material": "slime-skin", "elementComponentIds": notes["dropIds"],
         "placement": {"mode": "authored"}, "buildsGeometry": True, "realization": "individual components"},
        {"id": "tank-bands", "name": "Tank metal bands", "level": "micro", "parent": "tank", "count": 2, "primitive": "torus",
         "material": "metal-brushed", "elementComponentIds": ["tank-band-top", "tank-band-bottom"], "placement": {"mode": "authored"},
         "buildsGeometry": True, "realization": "individual components"},
        {"id": "lace-bars", "name": "Shoe lace bars", "level": "micro", "parent": "foot-l", "count": 6, "primitive": "box",
         "material": "shoe-lace", "elementComponentIds": [f"shoe-lace-{i}-{s}" for s in ("l", "r") for i in (1, 2, 3)],
         "placement": {"mode": "authored", "notes": "3 bars per shoe along the instep"}, "buildsGeometry": True,
         "realization": "individual components"},
        {"id": "tank-bubbles", "name": "Ink bubbles", "level": "micro", "parent": "tank-liquid", "count": 4, "primitive": "sphere",
         "material": "tank-glass", "elementComponentIds": [f"tank-bubble-{i}" for i in range(1, 5)], "placement": {"mode": "authored"},
         "buildsGeometry": True, "realization": "individual components"},
        {"id": "hose-corrugation", "name": "Hose corrugation ribs", "level": "meso", "parent": "hose", "count": 1,
         "primitive": "tapered-sweep", "material": "rubber-black", "elementComponentIds": ["hose"],
         "placement": {"mode": "along-path", "notes": "peak/valley radii every 4.5 mm along the hose sweep"},
         "buildsGeometry": True, "realization": "station radii of the hose sweep"},
    ]
    # feature review targets
    spec["featureReviewTargets"] = [
        {"id": "anatomy-proportion", "name": "Chibi head-unit proportions (head+hair 35% of height, 3.4 skull HU)", "tier": "critical",
         "passIds": ["blockout", "proportion-lock"], "minimumScore": 0.78, "mustPass": True,
         "componentRefs": ["head", "hair-cap", "chest", "pelvis", "thigh-l", "shin-l"], "evidenceRefs": ["full-object", "side-view"]},
        {"id": "pose-silhouette", "name": "A-pose and full-body silhouette (arms ~27 deg, feet apart, toe-out)", "tier": "critical",
         "passIds": ["blockout", "proportion-lock"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["upper-arm-l", "upper-arm-r", "forearm-l", "thigh-l", "thigh-r", "shoe-upper-l"], "evidenceRefs": ["full-object"]},
        {"id": "slime-hair-drip-silhouette", "name": "Slime hair drip silhouette (blobby locks, crown tuft, droplets)", "tier": "critical",
         "passIds": ["blockout", "feature-placement"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["hair-cap", "hair-tuft", "hair-lock-02", "hair-lock-07", "hair-lock-13", "hair-drop-1"],
         "evidenceRefs": ["head-zone", "back-view", "side-view"]},
        {"id": "goggles-identity", "name": "Goggles: single black lens in white frame, wider than head, strap + clips", "tier": "critical",
         "passIds": ["blockout", "feature-placement"], "minimumScore": 0.78, "mustPass": True,
         "componentRefs": ["goggle-body", "goggle-lens", "goggle-strap", "goggle-clip-l"], "evidenceRefs": ["head-zone", "side-view"]},
        {"id": "face-landmark-placement", "name": "Goggle band (0.44-0.86 head height) and smile (0.90) placement on the eyeless face", "tier": "critical",
         "passIds": ["feature-placement"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["head", "goggle-lens", "mouth-smile"], "evidenceRefs": ["head-zone"]},
        {"id": "outfit-and-palette", "name": "Turquoise-on-black outfit palette with piping/stripes, white tee", "tier": "critical",
         "passIds": ["material-pass"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["jacket-body", "jacket-collar", "tee", "thigh-l", "upper-arm-l"], "evidenceRefs": ["torso-zone", "legs-zone"]},
        {"id": "backpack-ink-tank", "name": "Backpack glass ink tank + harness + hose to right hip", "tier": "important",
         "passIds": ["blockout", "material-pass"], "minimumScore": 0.7, "mustPass": False,
         "componentRefs": ["tank", "tank-liquid", "back-plate", "hose", "harness-strap-l"], "evidenceRefs": ["back-view", "side-view"]},
        {"id": "chunky-sneakers", "name": "Chunky sneakers (white midsole, turquoise outsole, black upper, laces)", "tier": "important",
         "passIds": ["blockout", "material-pass"], "minimumScore": 0.7, "mustPass": False,
         "componentRefs": ["shoe-upper-l", "shoe-midsole-l", "shoe-outsole-l", "shoe-lace-1-l"], "evidenceRefs": ["feet-zone", "side-view"]},
    ]
    goals = {
        "blockout": ("Match chibi head-unit proportions, A-pose silhouette and every macro/meso part placement at the front reference camera.",
                     ["Head+hair ~35% of figure height; goggles wider than the head; hands to upper thigh; shoes ~0.39 long.",
                      "Hair reads as blobby locks + tuft (not a cap); tank + hose visible from back/side.",
                      "AI vision >= 0.7 and every critical blockout feature >= its threshold."]),
        "proportion-lock": ("Lock head/torso/limb head-unit ratios and pose angles against front/side/back.",
                            ["Measured ratios within 5% of pipeline/anatomy.json; arm angle 27 deg; leg splay 11 deg."]),
        "feature-placement": ("Place goggles, smile, hair locks/droplets and clips to the measured landmarks.",
                              ["Goggle band 0.44-0.86 of head height, smile at 0.90, fringe ends at goggle top."]),
        "material-pass": ("Match flat toon-PBR palette: turquoise slime/accents, black nylon, charcoal twill, white tee/frame/midsole, glass tank.",
                          ["Piping/stripe/lining vertexPaint boundaries at the reference positions; team colour swap works."]),
        "lighting-pass": ("Soft key from upper-left + fill + rim, ACES tone mapping, contact shadow.", ["Readable under neutral light."]),
        "interaction-pass": ("Rig-ready pivots, sockets (hand_r, back, goggles), colliders, detachables.", ["Skeleton validates; sockets resolve."]),
        "optimization-pass": ("Protect runtime performance: decimate micro parts toward <= 60k triangles (blockout measured 173k), <= 160 draw calls.", ["Triangle/draw-call budget documented."]),
    }
    for bp in spec["buildPasses"]:
        bp["componentRefs"] = ids
        if bp["id"] in goals:
            bp["goal"], bp["acceptance"] = goals[bp["id"]]
    spec["qualityTargets"]["reviewViewpoints"] = ["front", "three-quarter-right", "three-quarter-left", "side", "rear-three-quarter", "back", "head-hero"]
    spec["qualityTargets"]["mustMatch"] = [
        "chibi proportions and A-pose silhouette", "slime hair lock silhouette", "goggles identity", "turquoise-on-black palette + piping",
        "backpack ink tank + hose", "chunky sneakers"]
    spec["performanceBudget"] = {
        "qualityPriority": "real-time-game-character", "targetTriangles": 180000, "maxDrawCalls": 160, "textureSize": 0,
        "fpsTarget": 60,
        "optimizationPolicy": "Blockout..lighting run at the hero tessellation tier (measured 173k triangles / 114 meshes on the executed blockout factory). optimization-pass target <= 60k: geometryDescriptor.decimate on spheres/tori/ellipsoid micro parts (bubbles, bands, buckles, cuffs, trims ~5k tris each), standard tier for far LOD, merge static trims per bone.",
    }
    spec["lodPlan"] = [
        {"tier": "near", "distance": 0, "strategy": "full component tree (hero tessellation)"},
        {"tier": "mid", "distance": 8, "strategy": "decimate hair locks/hose to 0.5 (geometryDescriptor.decimate), drop bubbles/laces"},
        {"tier": "far", "distance": 25, "strategy": "merge static trims into parent bones, standard tessellation tier"},
    ]
    spec["lightingFromPhoto"] = [
        {"role": "key light", "type": "directional", "direction": "from upper-left front (highlights sit upper-left on every slime blob)",
         "color": "#FFFFFF", "intensity": 2.2, "castShadow": True},
        {"role": "fill light", "type": "hemisphere", "skyColor": "#F4F6F8", "groundColor": "#B9BDC2", "intensity": 0.9,
         "notes": "soft studio fill matching the light-grey sheet background"},
        {"role": "rim light", "type": "directional", "direction": "from behind upper-right", "intensity": 0.8,
         "notes": "separates the black jacket from the background"},
        {"role": "environment", "type": "neutral studio HDRI/RoomEnvironment", "envMapIntensity": 1.0,
         "notes": "drives clearcoat/lens/glass reflections"},
        {"role": "camera", "exposure": 1.0, "toneMapping": "ACESFilmic", "outputColorSpace": "sRGB",
         "background": "#F3F2EE (reference sheet grey)"},
        {"role": "ground", "contact shadow": "soft ground contact shadow under the shoes (reference shows a faint grey floor shadow)",
         "ambient occlusion": "screen-space AO optional"},
    ]
    spec["proceduralStrategy"] = [
        "Head: one ellipsoid volume; goggles = white ellipsoid body + black lens dome + flattened torus strap + metal clips.",
        "Hair: hair-cap ellipsoid + 17 tapered-sweep locks with bulbous tips + crown tuft + teardrop droplets, standProud against the head.",
        "Body: pelvis ellipsoid, abdomen/chest/neck/limb segments from attachment endpoints (bones), palms/digits as tapered sweeps.",
        "Garments: tee = closed elliptical prism, jacket = C-section prism open at the front, collar = small C-ring; piping/stripes as vertexPaint regions.",
        "Shoes: ellipsoid upper + extruded footprint midsole/outsole + lathe collar + micro tongue/panel/heel tab/lace bars, yawed 12 deg toe-out.",
        "Backpack: box back plate + lathe glass/liquid/caps/valve + torus bands + corrugated tapered-sweep hose to the right hip.",
        "Flat textureless toon-PBR materials with team-colour slots; no external textures.",
    ]
    spec["animationAnchors"] = [
        "pelvis is the single bone root; spine abdomen->chest->neck->head; arms clavicle->upper-arm->forearm->hand->digits; legs thigh->shin->foot",
        "hand-r socket 'hand_r' holds the blaster prop; back-plate socket 'back' holds the tank (detachable)",
        "head socket 'goggles' (goggles detach for the swim form); root socket 'ground'",
        "hair/goggles/tank/shoe parts ride their parent bone rigidly (hair is never smooth-skinned)",
    ]
    spec["destructionAnchors"] = ["tank (detachable from back-plate:back)", "goggle-body (detachable for swim form)", "back-plate (detachable)"]
    spec["styleNotes"] = {"renderStyle": "stylized toon / semi-glossy", "approximation": "stylized reconstruction, not exact geometry",
                          "teamPalette": {"teamA": TEAM_A, "teamB": TEAM_B, "finishes": ["glossy", "textured", "glassy"]}}
    # structural-pass: the character template omits it; the strict gate (and the generic pass contract)
    # requires an explicit hierarchy/attachment review between blockout and the proportion lock.
    if not any(bp.get("id") == "structural-pass" for bp in spec["buildPasses"]):
        spec["buildPasses"].insert(1, {
            "id": "structural-pass",
            "goal": "Verify the component hierarchy: every limb/digit/garment/hardware part is rooted at its parent socket, garment shells layer tee < jacket < harness, tank/hose attach to back-plate and right hip.",
            "componentRefs": ids,
            "acceptance": [
                "attachment endpoints sit on their parent joints (no floating parts) in front, side and back views",
                "garment layer order holds at the hem, collar and cuffs; hose reaches the right hip coupler",
                "AI vision comparison score meets selfCorrectLoop.visualAcceptance.threshold",
            ],
        })
    for target in spec["featureReviewTargets"]:
        if target["id"] in {"pose-silhouette", "goggles-identity", "backpack-ink-tank", "chunky-sneakers"}:
            target["passIds"] = sorted(set(target["passIds"]) | {"structural-pass"}, key=lambda x: [b["id"] for b in spec["buildPasses"]].index(x))
    # unknowns: each one is resolved by an explicit, recorded decision (kept visible, not deleted)
    pre = spec["preSpecAssessment"]
    resolutions = {
        "Skull top": "Resolved by estimate: skull top at front.png y=55 (head unit 166 px = 0.40); +-10% recorded in assumptions; proportion-lock pass re-checks against side.png.",
        "Exact digit count": "Resolved: author 3 fingers + thumb per hand (mitten slime hand as read in front.png/zoom crop).",
        "Jacket interior": "Resolved: interior not modelled; jacket is a 26 mm C-section shell, collar lining turquoise via vertexPaint.",
        "Outsole tread": "Resolved: outsole modelled as a turquoise band; lug rhythm documented as a localFeature, underside flat.",
        "Hose routing": "Resolved: hose path authored from back.png coil + side.png U-loop control points (confidence 0.7).",
        "Face under the goggle": "Resolved: no eye geometry; goggle lens carries the eye-region identity.",
        "Hair lock count": "Resolved: 17 locks + crown tuft + 5 droplets authored from front/back/side silhouettes; lock topology locked only after the silhouette review.",
        "Left side": "Resolved: left mirrors the observed right side (side.png) except hair asymmetry and the right-hip hose.",
    }
    resolved = []
    for item in pre.get("unknownsToResolveBeforeImplementation", []):
        decision = next((v for k, v in resolutions.items() if item.startswith(k)), "Resolved by explicit assumption (see spec.assumptions).")
        resolved.append({"unknown": item, "resolution": decision})
    if resolved:
        pre["resolvedUnknowns"] = resolved
        pre["unknownsToResolveBeforeImplementation"] = []
    pipeline = spec.setdefault("sculptPipeline", {})
    pipeline["passOrder"] = [p["id"] for p in spec["buildPasses"]]
    args.out.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out} components={len(tree)} bones={len(spec['rig']['bones'])} materials={len(spec['materials'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
