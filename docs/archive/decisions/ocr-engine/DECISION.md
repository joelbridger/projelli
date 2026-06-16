# OCR Engine Decision — VG-2 (Wave 2 Task 6 spike)

**Date:** 2026-06-11 · **Plan:** `docs/superpowers/plans/2026-06-11-wave2-ingest-everything.md` Task 6 · **Consumed by:** Task 7 (implements exactly this; Shape B) and Task 8 (pipeline notes at the end).

## Verdict: **tesseract-wasm in the renderer (Shape B).** The sidecar is rejected on binary acquisition, not on capability.

The plan's locked decision rule: *"sidecar IF a maintainable per-target binary source exists for all three platforms; ELSE wasm."* The acquisition survey (Evidence A) found **no acquirable prebuilt Tesseract CLI for macOS at all** — not arm64, not x86_64 — and only personal-repo or installer-shaped sources for Linux and Windows. The Tesseract project itself ships **source only**, by policy. Piper's situation (official static single-file release per platform, which is what makes our existing sidecar pattern cheap) simply does not exist for Tesseract; going sidecar would mean operating our own 4-target static C++ build farm (leptonica + image codecs + tesseract via vcpkg or autotools), which is exactly the packaging burden the rule screens out. Meanwhile the wasm prototype (Evidence C) measured **accuracy identical to the native binary** (same engine lineage, same tessdata_fast model weights) and **per-page wall time at parity** (~0.5 s for a 200-dpi letter page) — so the sidecar's one claimed advantage, speed, is empirically absent at our page sizes. Wasm ships as ~7.7 MB of static assets vendored into `public/ocr/`, identical on every platform, zero per-platform acquisition, zero signing surface, fully local (rule 2: no cloud OCR, ever; assets ship in the app bundle, no runtime network fetch).

This supersedes the roadmap WS-B wording "new local OCR sidecar" (`docs/strategy/2026-06-09-keepance-3.0-roadmap.md:60`) — the roadmap's preference predated these acquisition facts.

---

## Evidence A — binary acquisition per ship target

Surveyed 2026-06-11. Ship targets: win-x64, mac-arm64, mac-x64, linux-x64.

| Source | win-x64 | mac-arm64 | mac-x64 | linux-x64 | Signed? | Maintainership / risk |
|---|---|---|---|---|---|---|
| **Official `tesseract-ocr/tesseract` releases** | source only | source only | source only | source only | n/a | The project publishes **no prebuilt binaries** (only a 3.02-era Windows installer survives on SourceForge). Official docs route users to third parties. |
| **UB-Mannheim builds** (tessdoc's named Windows channel) | **YES** — `tesseract-ocr-w64-setup-5.5.0.20241111.exe` | no | no | no | yes (Authenticode, their key) | University of Mannheim project. x64 only (32-bit dropped 2023, no ARM64). It is an **NSIS installer, not a portable archive** — portable extraction (7z) is unofficial and the uninstaller semantics show it is not designed for it. Lags upstream (5.5.0 Nov 2024 vs upstream 5.5.x in 2026). |
| **AlexanderP/tesseract-appimage** | no | no | no | **YES** — 5.5.2, Jan 2026 | no | Personal repo, actively maintained, x86_64 only. AppImage is one file but needs libfuse2 **or** `--appimage-extract-and-run` (tmp-extract per spawn); built on Ubuntu 18.04 docker. |
| **DanielMYT/tesseract-static** | no | no | no | YES (x86_64 + aarch64, truly static) | no | Personal repo, low bus factor. |
| **conda-forge `tesseract`** | pkg | pkg | pkg | pkg | no | Covers all targets **but** as conda packages: dynamically linked against conda-forge runtime libs with env-relative relocation. Extracting a standalone sidecar from one is unsupported surgery. |
| **Homebrew bottles** (macOS) | n/a | dylib tree | dylib tree | n/a | no | `tesseract` + leptonica + ~10 codec dylibs hard-pathed to Cellar/opt prefixes; relocating requires `install_name_tool` surgery and shipping the tree. Not a single-file binary. |
| **lexiaoyao20/tesseract-Apple** (XCFramework, arm64 macOS 11+) | no | static **library** | partial | no | no | Wrong artifact shape: a linkable lib for Xcode targets, not a CLI sidecar binary. |
| **Build it ourselves** (vcpkg static triplets or autotools in CI) | possible | possible | possible | possible | we sign | Honest estimate: vcpkg has a tesseract port and static triplets exist for all four targets, so it **can** be done — at the cost of ~30-60 min cold native builds per target in `release.yml`, a pinned vcpkg snapshot we own, and breakage-on-update of a C++ dependency tree (leptonica, libpng, libjpeg-turbo, libtiff, zlib) forever after. We become the binary's maintainer. That is not an "acquisition source"; it is the burden the decision rule exists to avoid. |

**Rule resolution:** Windows has one good-but-installer-shaped signed source; Linux has personal repos; macOS has **nothing acquirable**. No maintainable per-target binary source exists for all platforms → **wasm**.

## Evidence B — native invocation truth (recorded for the revival path)

Probed on this rig (Ubuntu, apt `tesseract-ocr` 5.3.4-1build5, leptonica 1.82, eng model = tessdata_fast 4.0 MB at `/usr/share/tesseract-ocr/5/tessdata/eng.traineddata`):

- **Exact contract:** `tesseract <image.png> stdout --psm 3 tsv` → TSV on stdout, 12 columns (`level page_num block_num par_num line_num word_num left top width height conf text`). Words are `level == 5` rows; structural rows carry `conf == -1`.
- **Text reconstruction:** group level-5 rows by `(page_num, block_num, par_num, line_num)` in row order, join words with spaces, lines with newlines.
- **Mean-confidence math:** mean of `conf` over level-5 rows with `conf >= 0` and non-blank text (0-100 scale).
- Whole-process wall times below include process spawn (~80-150 ms of the clean-page figure).

## Evidence C — wasm prototype, real numbers

`tesseract-wasm` **0.11.0** (robertknight; BSD-2-Clause; npm latest, last published 2025-10-24; engine API + `OCRClient` web-worker wrapper; **no SharedArrayBuffer / COOP-COEP requirement**; SIMD "fast" build + non-SIMD fallback, both 1.8 MB). Run in Node 20 (V8 wasm SIMD ≈ WebView2's engine; WKWebView/WebKitGTK are JavaScriptCore — same order of magnitude expected, not benchmarked) against the **same model file** as the native probe, on two PIL-generated scanned-style pages mirroring Task 8's planned fixtures (clean 200-dpi motion with FILED stamp box, planted sentence "Defendant's motion to compel production of the September audit file is DENIED."; noisy 150-dpi fax: mono type, 2% salt-and-pepper, 2.5° rotation):

| Probe | native CLI 5.3.4 (whole process) | tesseract-wasm 0.11.0 (in-process) |
|---|---|---|
| clean filing, 1700×2200 | **0.53 s** wall, ~49 MB peak | recognize **512-623 ms** + 5-12 ms image load (one-time init+model ≈ 50 ms) |
| noisy fax, 1275×1650 | **0.24 s** wall, ~43 MB | recognize **202-210 ms** |
| clean accuracy (vs ground truth) | word 91.7%, char 95.4%, mean conf 94.5 | word **91.7%**, char **95.4%**, mean conf 94.8 |
| noisy accuracy | word 79.5%, char 97.6%, mean conf 66.0 | word **79.5%**, char **97.6%**, mean conf 63.5 |
| planted quotable sentence | recovered verbatim | recovered verbatim |
| memory during OCR | ~50 MB per process | ~255 MB RSS total in Node (incl. runtime baseline; wasm heap held until `destroy()`) |

Notes kept honest: the clean-page word score is depressed by stamp-box reading order vs the truth file plus one genuine collision error (stamp box overlapping "COURT" → "COURFN"); body text was effectively perfect in both engines. Accuracy parity is expected — same engine lineage and identical model weights — and held exactly. Confidence convention: tesseract-wasm reports per-word confidence in [0,1]; ×100 matches the native TSV scale.

## What Task 7 implements (Shape B, exact)

The plan's Shape B is confirmed; specifics verified in this spike:

1. `npm i tesseract-wasm` (BSD-2-Clause; the chosen path's only new dependency, landing in Task 7, not here).
2. **Vendor into `public/ocr/`** via prebuild, mirroring `copy-pdf-worker` (`package.json:11-13`; note `public/pdf.worker.min.mjs` is also committed): `tesseract-worker.js`, `tesseract-core.wasm`, `tesseract-core-fallback.wasm` (all from `node_modules/tesseract-wasm/dist/`) + `eng.traineddata` (tessdata_fast, 4.0 MB, Apache-2.0, from `github.com/tesseract-ocr/tessdata_fast` — pin the exact file; do NOT fetch at runtime).
3. `src/modules/ocr/ocrEngine.ts`: lazy module-level `OCRClient` from `createOCRClient({ workerURL: '/ocr/tesseract-worker.js' })` — `workerURL` is an explicit constructor option (verified `lib.js:415`), and the emscripten worker resolves `tesseract-core*.wasm` **relative to the worker script's directory** (verified), so everything stays under `/ocr/` with no bundler URL magic; the lib picks fast vs fallback wasm itself via `supportsFastBuild()`. `loadModel('/ocr/eng.traineddata')` once. `ocrPageImage(png: Uint8Array): Promise<{ text: string; confidence: number }>` = `createImageBitmap(new Blob([png]))` → `client.loadImage(bitmap)` → `client.getTextBoxes('word')` for confidences (mean of non-blank words × 100, matching the 0-100 convention and `OCR_LOW_CONFIDENCE = 60`) → `client.getText()` (reuses the recognition pass; costs ~1 ms after `getTextBoxes`). `destroyOcrClient()` after a batch — the wasm heap (~150-200 MB) is only returned on destroy.
4. The seam is unchanged from the plan: callers never know the engine; a later sidecar swap touches only `ocrEngine.ts`.
5. Tests per the plan's Shape B: vitest with the client mocked (init-once, confidence math); real-OCR proof rides Task 8's pipeline + Task 14's native run. The worker runs OCR off the UI thread (the renderer has real `Worker` + canvas — `pdf-extract.ts:38-45` precedent).

**Delete Shape A from Task 7** (no `ocr.rs` command, no `fetch-tesseract-sidecar.sh`, no `release.yml` step, no `externalBin` change, no `resources/ocr/` tessdata).

**Notes for Task 8:** (a) budget ~0.5 s per 200-dpi page in the progress UX (a 50-page scanned filing ≈ 25 s); (b) my noisy-fax probe landed at conf 63-66 — **above** the 60 threshold; the `scanned-fax-noisy.pdf` generator needs heavier degradation than 2% noise + 2.5° rotation to reliably land below `OCR_LOW_CONFIDENCE`; (c) bundle cost is ~7.7 MB once, all platforms identically.

## Rejected path: Tesseract sidecar — revival conditions

Revive (swap inside `ocrEngine.ts`, pipeline untouched) only if one of these becomes true:

1. **A maintained official or first-class binary channel appears** for all four targets (the piper situation), or we knowingly accept operating a vcpkg/autotools static build pipeline in `release.yml` with its cold-build and upkeep costs.
2. **Throughput demands outgrow wasm:** sustained bulk back-file digitization where multi-process native parallelism and lower per-worker memory beat N wasm workers at ~250 MB heap each.
3. **Accuracy demands move to heavier configs** (tessdata_best, custom preprocessing pipelines) where native CPU headroom matters; revisit numbers then — do not assume.

The native invocation contract to revive against is recorded in Evidence B; the resolver/bundling pattern to clone is piper's (`tauri.conf.json:81-83` `externalBin`, `scripts/fetch-piper-sidecar.sh`, `release.yml:146-158`, `tts.rs:49 resolve_piper_binary`).

## Licensing

All clean for commercial distribution: Tesseract engine **Apache-2.0**; `tesseract-wasm` npm package **BSD-2-Clause**; `tessdata_fast` `eng.traineddata` **Apache-2.0**. Ship the license texts alongside the vendored assets (Task 7; same treatment as other bundled third-party components). No cloud OCR was ever a candidate (plan rule 2): pages are rasterized, recognized, and indexed entirely in-process on the user's machine.

## Reproduction (spike artifacts, not committed)

Probe lived in `/tmp/ocr-spike/`: `make-images.py` (PIL, seed 42 — generates the two pages + raw-RGBA dumps + ground truth), `tsv-parse.py` (native TSV → text + mean conf), `score.py` (SequenceMatcher word/char scoring), `wasm-run.mjs` (engine API in Node: `createOCREngine({ wasmBinary })`, `loadModel`, `loadImage({ data, width, height })`, 3 timed runs per image). Native side: `sudo apt-get install -y tesseract-ocr` then `tesseract <png> stdout --psm 3 tsv`. The wasm run used apt's own `eng.traineddata` so both engines scored with identical weights.
