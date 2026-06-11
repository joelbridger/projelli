# Vendored OCR engine assets (VG-2)

Everything Keepance needs to read scanned pages, shipped inside the app bundle.
Nothing here is ever fetched from the network at runtime: page images are
rasterized, recognized, and indexed entirely on the user's machine
(`src/modules/ocr/ocrEngine.ts` is the only consumer).

Engine decision and benchmarks: `spikes/ocr-engine/DECISION.md` (Wave 2 Task 6,
2026-06-11). Native-sidecar revival conditions live there too.

## Files and provenance

| File | What | Source | License |
|---|---|---|---|
| `tesseract-worker.js` | Web worker that hosts the engine off the UI thread | `tesseract-wasm@0.11.0` npm package, `dist/` | BSD-2-Clause |
| `tesseract-core.wasm` | Tesseract compiled to wasm, SIMD ("fast") build | `tesseract-wasm@0.11.0` npm package, `dist/` | BSD-2-Clause wrapper; embeds Tesseract (Apache-2.0) + Leptonica (BSD-2-Clause-style) |
| `tesseract-core-fallback.wasm` | Non-SIMD fallback; the worker picks fast vs fallback itself | `tesseract-wasm@0.11.0` npm package, `dist/` | same as above |
| `eng.traineddata` | English recognition model (tessdata_fast) | `github.com/tesseract-ocr/tessdata_fast`, tag `4.1.0` | Apache-2.0 |

The three `tesseract-*` files are refreshed from `node_modules` by the
`copy-ocr-assets` prebuild step (`package.json`), mirroring how
`public/pdf.worker.min.mjs` is managed: committed AND re-copied on every
build so they always match the pinned npm version. `eng.traineddata` has no
npm source; it is committed here directly, pinned by checksum:

```
sha256(eng.traineddata) = 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  (4,113,088 bytes)
```

This is byte-identical to the model the VG-2 spike benchmarked against the
native CLI (accuracy parity, ~0.5 s per 200-dpi page), so those numbers hold
for the shipped file. To update it, download
`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/<tag>/eng.traineddata`,
record the new tag + sha256 here, and re-run the OCR test suite
(`npx vitest run tests/unit/ocr` exercises the real wasm + model).

## License texts (ship with the bundle)

- `LICENSE-tesseract-wasm.md` — BSD-2-Clause, © 2022 Robert Knight and
  tesseract-wasm contributors (covers the worker JS and the wasm build
  wrapper).
- `LICENSE-tessdata` — Apache License 2.0 (covers `eng.traineddata`, from the
  `tessdata_fast` repository, and the Tesseract engine compiled inside the
  wasm binaries; also covers comlink, the Apache-2.0 RPC helper that
  `tesseract-worker.js` bundles inline and that ships as a regular npm
  dependency of `tesseract-wasm`).

All compatible with commercial distribution.
