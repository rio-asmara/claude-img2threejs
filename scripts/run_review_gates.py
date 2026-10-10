#!/usr/bin/env python3
"""Run every deterministic img2threejs review gate for one build pass of the Slime Agent.

    IMG2THREEJS_SKILL_ROOT=/path/to/img2threejs \\
    python3 scripts/run_review_gates.py --pass-id blockout --renders renders/review \\
        --data pipeline/review-data --out pipeline/gates/blockout [--record]

Inputs are produced by this repo's own tooling:
  renders/<label>/        `node scripts/capture.mjs --label <label> --views front,three-quarter,side,back,turntable --query ground=0`
  pipeline/review-data/   `node scripts/export-review-data.mjs` (parts, skull rings, hair points, meshes, positions)

Each gate's stdout/JSON lands in --out, and gates-summary.json lists every command with its exit
code. `--record` adds `--spec ... --pass-id ... --in-place` to diagnose_render so the Tier 1 result
is written into the spec (needed before `orchestrate_passes.py check`). Scoring visuals is NOT done
here: the AI-vision review is recorded separately with append_review.py after reading the sheets.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "pipeline" / "object-sculpt-spec.json"
REF = ROOT / "reference"
VIEWS = {"front": "front.png", "three-quarter": "three-quarter.png", "side": "side.png", "back": "back.png"}
# Head + hair occupy the top ~35% of this chibi figure (not the default 0.19 head band).
BANDS = [("head-hair", 0.0, 0.35), ("torso-arms", 0.35, 0.62), ("legs-shoes", 0.62, 1.0)]


def skill_root() -> Path:
    env = os.environ.get("IMG2THREEJS_SKILL_ROOT")
    candidates = [Path(env)] if env else []
    candidates.append(Path.home() / ".claude" / "skills" / "img2threejs")
    for c in candidates:
        if (c / "forge" / "next.py").exists():
            return c
    sys.exit("run_review_gates: set IMG2THREEJS_SKILL_ROOT to an img2threejs checkout")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pass-id", required=True)
    ap.add_argument("--renders", type=Path, required=True)
    ap.add_argument("--data", type=Path, default=ROOT / "pipeline" / "review-data")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--record", action="store_true", help="record Tier 1 diagnostics into the spec")
    args = ap.parse_args()

    sk = skill_root()
    review = sk / "forge" / "stage4_review"
    renders = args.renders.resolve()
    data = args.data.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    summary: list[dict[str, object]] = []

    def run(name: str, cmd: list[str], save: str | None = None) -> int:
        proc = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, cwd=sk)
        if save:
            (out / save).write_text(proc.stdout)
        summary.append({
            "gate": name,
            "exit": proc.returncode,
            "command": " ".join(str(c) for c in cmd).replace(str(sk) + "/", "").replace(str(ROOT) + "/", ""),
            "output": save,
            "stderrTail": proc.stderr.strip().splitlines()[-3:] if proc.stderr.strip() else [],
        })
        print(f"[{proc.returncode}] {name}" + (f" -> {save}" if save else ""))
        return proc.returncode

    front = renders / "front.png"
    py = sys.executable

    # Tier 1 (must run before the comparison sheet / pass check).
    # The Tier 1 reference is front.png minus its painted ground shadow (scripts/prepare_tier1_reference.py);
    # review renders are captured with ground=0, so neither mask contains a floor shadow.
    tier1 = [py, review / "diagnose_render.py", "--reference", REF / "tier1" / "front.png", "--render", front, "--json"]
    stripped = renders / "map-stripped" / "front.png"  # capture.mjs --label <label>/map-stripped --query "ground=0&maps=0"
    if stripped.exists():
        tier1 += ["--map-stripped-render", stripped]
    if args.record:
        tier1 += ["--spec", SPEC, "--pass-id", args.pass_id, "--in-place"]
    run("tier1-diagnostics", tier1, "diagnose-front.json")

    # Non-planar form must hold from >= 2 angles (reference-free self-consistency).
    run("multi-angle", [py, review / "diagnose_render_multi_angle.py", "--reference", front,
                        "--orbit", renders / "three-quarter.png", "--orbit", renders / "side.png",
                        "--orbit", renders / "back.png", "--json"], "multi-angle.json")

    # Off-axis turntable (front / left / back / right). Captured on a neutral grey background
    # (`--query "ground=0&bg=808080"`, renders/<label>/turntable-gray/): on the sheet-coloured
    # background the white tee / midsoles read as background and the flood fill reports them as
    # holes. --allow-holes: the only enclosed gap on grey is the hose loop between the tank, the
    # back plate and the hip coupler at az 270 (inspected: pipeline/gates/<pass>/hole-270.png).
    tt = renders / "turntable-gray"
    run("turntable", [py, review / "turntable_gate.py",
                      "--capture", f"0={tt / 'turntable-000.png'}",
                      "--capture", f"90={tt / 'turntable-090.png'}",
                      "--capture", f"180={tt / 'turntable-180.png'}",
                      "--capture", f"270={tt / 'turntable-270.png'}", "--allow-holes", "--json"], "turntable.json")

    # Interior difference per height band, for every view the sheet covers.
    for view, ref_name in VIEWS.items():
        for band, lo, hi in BANDS:
            run(f"interior-{view}-{band}", [py, review / "interior_difference.py", REF / ref_name, renders / f"{view}.png",
                                            "--from", lo, "--to", hi, "--json"], f"interior-{view}-{band}.json")

    # Hair: hard geometric scalp gate first (hair zone = above the goggle line), then the soft gate.
    run("scalp-exposure", [py, review / "scalp_exposure.py", "--rings", data / "head_rings.json",
                           "--hair-points", data / "hair_points.json", "--v-low", "0.6",
                           "--out", out / "scalp-exposure.json"], None)
    run("hair-gate", [py, review / "hair_gate.py",
                      "--reference", f"front={REF / 'front.png'}", f"back={REF / 'back.png'}", f"side={REF / 'side.png'}",
                      "--render", f"front={front}", f"back={renders / 'back.png'}", f"side={renders / 'side.png'}",
                      "--scalp-exposure", out / "scalp-exposure.json", "--out", out / "hair-gate.json"], None)

    # Geometry / structure gates (no pixels).
    run("self-intersection", [py, review / "self_intersection.py", data / "meshes.json", "--json"], "self-intersection.json")
    run("part-coverage", [py, review / "check_part_coverage.py", "--spec", SPEC, "--manifest", data / "parts.json",
                          "--json", out / "part-coverage.json"], "part-coverage.txt")
    run("attachment-anchor", [py, review / "attachment_anchor.py", SPEC, "--measured", data / "measured-positions.json",
                              "--json"], "attachment-anchor.json")

    # Comparison sheets for AI-vision review (one per sheet view).
    for view, ref_name in VIEWS.items():
        run(f"comparison-{view}", [py, review / "make_comparison_sheet.py", "--reference", REF / ref_name,
                                   "--render", renders / f"{view}.png", "--out", out / f"cmp-{view}.png", "--json"],
            f"cmp-{view}.json")

    run("pass-gate-check", [py, sk / "forge" / "stage3_build" / "orchestrate_passes.py", "check", SPEC,
                            "--pass-id", args.pass_id, "--json"], "pass-check.json")

    (out / "gates-summary.json").write_text(json.dumps({"passId": args.pass_id, "renders": str(renders.relative_to(ROOT)),
                                                         "gates": summary}, indent=2) + "\n")
    failed = [g["gate"] for g in summary if g["exit"] not in (0,)]
    print(f"non-zero exits: {failed or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
