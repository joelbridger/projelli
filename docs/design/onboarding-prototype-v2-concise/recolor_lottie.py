#!/usr/bin/env python3
# Recolor a Lottie's solid stroke/fill (and gradient) colors to the Keepance onboarding
# palette. Source colors are matched (with tolerance) to a per-file mapping and replaced.
# Usage is driven by the MAP table below; run: python3 recolor_lottie.py
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "anim-gallery", "lottie")
DST = os.path.join(BASE, "assets", "lottie")

def hx(h):
    h = h.lstrip("#")
    return [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)]

NAVY = hx("0A2540")
ACCENT = hx("1f74c4")
LIGHT = hx("5dc6ff")

# (source rgb, target rgb) pairs per file. Any color within TOL of a source is remapped.
MAP = {
    # "Connect your AI and files" — dashed nodes: bright cyan + light blue -> two-tone brand blue
    "connect-01.json": ("step1.json", [
        ([0.0, 0.82, 1.0], ACCENT),
        ([0.5, 0.66, 1.0], LIGHT),
    ]),
    # "Keepance builds Client Maps" — network hub: all black strokes -> accent blue
    "connect-02.json": ("step2.json", [
        ([0.0, 0.0, 0.0], ACCENT),
    ]),
    # "Ask anything, with sources" — neural-net node graph: gray nodes/lines -> two-tone brand blue
    "step3-new.json": ("step3.json", [
        ([0.518, 0.518, 0.518], ACCENT),
        ([0.557, 0.557, 0.56], LIGHT),
    ]),
}
TOL = 0.08

def near(c, s):
    return all(abs(c[i] - s[i]) <= TOL for i in range(3))

def remap_rgb(rgb, pairs):
    for src, tgt in pairs:
        if near(rgb, src):
            return [tgt[0], tgt[1], tgt[2]] + list(rgb[3:])
    return rgb

def recolor(node, pairs):
    if isinstance(node, dict):
        ty = node.get("ty")
        if ty in ("fl", "st") and isinstance(node.get("c"), dict):
            c = node["c"]
            if c.get("a") == 0 and isinstance(c.get("k"), list) and len(c["k"]) >= 3:
                c["k"] = remap_rgb(c["k"], pairs)
            elif c.get("a") == 1 and isinstance(c.get("k"), list):
                for kf in c["k"]:
                    if isinstance(kf, dict) and isinstance(kf.get("s"), list) and len(kf["s"]) >= 3:
                        kf["s"] = remap_rgb(kf["s"], pairs)
                        if isinstance(kf.get("e"), list) and len(kf["e"]) >= 3:
                            kf["e"] = remap_rgb(kf["e"], pairs)
        if ty in ("gf", "gs") and isinstance(node.get("g"), dict):
            g = node["g"]; k = g.get("k", {})
            if isinstance(k, dict) and isinstance(k.get("k"), list):
                arr = k["k"]; n = g.get("p", len(arr) // 4)
                for i in range(n):
                    o = i * 4
                    if o + 3 < len(arr):
                        rgb = remap_rgb(arr[o + 1:o + 4], pairs)
                        arr[o + 1], arr[o + 2], arr[o + 3] = rgb[0], rgb[1], rgb[2]
        for v in node.values():
            recolor(v, pairs)
    elif isinstance(node, list):
        for v in node:
            recolor(v, pairs)

for srcname, (dstname, pairs) in MAP.items():
    d = json.load(open(os.path.join(SRC, srcname)))
    recolor(d, pairs)
    out = os.path.join(DST, dstname)
    json.dump(d, open(out, "w"), separators=(",", ":"))
    # sanity: still valid lottie
    chk = json.load(open(out))
    assert "v" in chk and "layers" in chk
    print(f"recolored {srcname} -> {dstname} ({os.path.getsize(out)} bytes, OK)")
