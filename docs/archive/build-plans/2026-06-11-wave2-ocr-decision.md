# Wave 2 Task 6 — OCR engine decision (pointer)

**Decision: tesseract-wasm in the renderer (Shape B). Sidecar rejected on binary acquisition.**

The canonical decision record — evidence tables (per-platform acquisition matrix, native vs wasm measured accuracy/timing), the chosen invocation contract, exact Task 7 consequences, and the sidecar revival conditions — lives at the plan-prescribed location:

**→ `spikes/ocr-engine/DECISION.md`**

Task 7 implements Shape B exactly as recorded there and deletes Shape A. Headline facts: no acquirable prebuilt Tesseract CLI exists for macOS (the project ships source only; every binary channel is third-party and per-platform inconsistent), while tesseract-wasm measured **identical accuracy** to the native binary (same tessdata_fast model) and **per-page time at parity** (~0.5 s per 200-dpi page), shipping as ~7.7 MB of identical static assets on every platform with zero packaging or signing surface. Fully local, no cloud OCR ever (plan rule 2).
