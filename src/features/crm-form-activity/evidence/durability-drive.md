# Form activity real-store durability drive

Date: 2026-07-15

No durability claim is made for this commit. The real drive is implemented in
`form-activity-live-drive.mjs`. It uses the production `liveRecords` module to
save the form, household, and submissions; reads them; reloads the real app;
reads them again; and compares both newest-first order and the client-facing
filter result.

I attempted to launch the documented real desktop harness from this worktree.
It could not start because this environment has no already-built desktop
binary. I did not replace this with an in-memory round trip.

Exact commands and results:

```text
$ npm run dev -- --host 127.0.0.1 --port 5174

> advisor-prep-hero@3.3.5 predev
> node scripts/copy-build-assets.mjs

copied node_modules/pdfjs-dist/build/pdf.worker.min.mjs -> public/pdf.worker.min.mjs
copied node_modules/tesseract-wasm/dist/tesseract-worker.js -> public/ocr/tesseract-worker.js
copied node_modules/tesseract-wasm/dist/tesseract-core.wasm -> public/ocr/tesseract-core.wasm
copied node_modules/tesseract-wasm/dist/tesseract-core-fallback.wasm -> public/ocr/tesseract-core-fallback.wasm
skipped public/ocr/eng.traineddata (present, checksum OK)

> advisor-prep-hero@3.3.5 dev
> vite --host 127.0.0.1 --port 5174

VITE v6.4.2 ready in 136 ms
Local: http://127.0.0.1:5174/

$ scripts/crm-loop/launch-app.sh 9284 /tmp/form-activity-live-drive
No debug binary at /home/jameson/v1-1b2-form-activity/src-tauri/target/debug/lantern — run: cargo build --manifest-path src-tauri/Cargo.toml
```

Because this is a TypeScript-only lane and no shared desktop binary exists,
I did not start a Rust build. The real drive remains unrun and must be run by
the intake reviewer once a debug desktop binary is available:

```text
scripts/crm-loop/launch-app.sh 9284 /tmp/form-activity-live-drive
LANTERN_DEV_BRIDGE_PORT=9284 CRM_LOOP_WORKSPACE=/tmp/form-activity-live-drive \
  node src/features/crm-form-activity/evidence/form-activity-live-drive.mjs
```
