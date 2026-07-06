#!/usr/bin/env python3
"""Generates the OCR smoke-test fixture: one synthetic "scanned" line of text,
stored as gzipped raw RGBA so the test needs no PNG decoder (Node's zlib only).

Consumed by tests/unit/ocr/ocrEngine.wasm.test.ts, which runs the REAL vendored
tesseract-wasm build from public/ocr/ over these pixels. Mirrors the VG-2 spike's
image generation (PIL + DejaVu fonts; see spikes/ocr-engine/DECISION.md,
"Reproduction"). Regeneration is safe: the test asserts recognized TEXT and
confidence, not pixel bytes, so font-rendering drift across PIL versions is fine.

Usage:    python3 tests/fixtures/ocr/generate-smoke-fixture.py
Requires: pillow (pip3 install pillow) + DejaVu fonts (preinstalled on most Linux).
"""

import gzip
import pathlib

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 720, 100
# The smoke test asserts recognition of this sentence (lowercased contains-check)
# and that mean word confidence clears the OCR_LOW_CONFIDENCE = 60 convention.
SENTENCE = "Lantern reads scanned pages locally."
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

out_dir = pathlib.Path(__file__).parent
img = Image.new("RGB", (WIDTH, HEIGHT), "white")
draw = ImageDraw.Draw(img)
font = ImageFont.truetype(FONT, 30)
bbox = draw.textbbox((0, 0), SENTENCE, font=font)
assert bbox[2] - bbox[0] <= WIDTH - 40, "sentence too wide for the canvas"
draw.text(
    (20, (HEIGHT - (bbox[3] - bbox[1])) // 2 - bbox[1]),
    SENTENCE,
    font=font,
    fill="black",
)

raw = img.convert("RGBA").tobytes()
assert len(raw) == WIDTH * HEIGHT * 4
out = out_dir / f"smoke-{WIDTH}x{HEIGHT}.rgba.gz"
# mtime=0 keeps the .gz byte-stable across regenerations of identical pixels.
out.write_bytes(gzip.compress(raw, 9, mtime=0))
print(f"wrote {out.name} ({len(raw)} raw RGBA bytes)")
