#!/usr/bin/env python3
"""Make the Tier 1 silhouette reference: reference/front.png minus the painted ground shadow.

diagnose_render.py compares pixel-aligned foreground masks. The character sheet paints a soft grey
ground shadow that spans the full crop width under the feet; its mask then claims the whole bottom
row, so aspect/scale deltas measure the shadow, not the character. The shadow is not part of the
subject (and the review renders are captured with `ground=0`), so this removes it: a flood fill from
the image border through background-like pixels and neutral grey shadow pixels (low saturation,
value 120-246) restricted to the bottom band, repainted with the sampled background colour.
Character pixels (saturated turquoise, near-black upper, the shoes' interior) are not reachable
through that path and stay untouched. Output: reference/tier1/front.png (+ a diff mask for review).

    python3 scripts/prepare_tier1_reference.py
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "reference" / "front.png"
OUT = ROOT / "reference" / "tier1" / "front.png"
BAND_TOP = 0.9  # only the bottom 10% of the crop holds the ground shadow


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    px = im.load()
    bg = px[3, 3]
    band_top = int(h * BAND_TOP)

    def shadow_like(p: tuple[int, int, int]) -> bool:
        mx, mn = max(p), min(p)
        sat = (mx - mn) / mx if mx else 0
        return sat < 0.08 and 120 <= mx <= 246

    def bg_like(p: tuple[int, int, int]) -> bool:
        return sum(abs(p[i] - bg[i]) for i in range(3)) < 24

    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    removed = 0
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y][x]:
            continue
        p = px[x, y]
        passable = bg_like(p) or (y >= band_top and shadow_like(p))
        if not passable:
            continue
        seen[y][x] = True
        if not bg_like(p):
            px[x, y] = bg
            mp[x, y] = 255
            removed += 1
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT)
    mask.save(OUT.with_name("front-shadow-removed-mask.png"))
    print(f"removed {removed} shadow pixels -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
