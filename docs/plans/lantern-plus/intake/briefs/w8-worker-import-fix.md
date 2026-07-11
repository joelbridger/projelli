# Wave 8 — Fix Vite-Only Worker Import Breaking the Bun Contract Gate

**Branch:** `lp/intake-w8-worker-import-fix`, branched off `lp/intake-w8` at `b1c44aa3` (all lanes merged, all fixes applied, vitest/tsc/eslint-gate all clean).
**You are Codex, the builder.** Fix this, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## The bug

Running `npm run test:contracts` (which shells out to `scripts/test-contracts.sh`, which runs `backend/test/intake-e2e.test.ts` under **Bun's** test runner, not Vite) fails with:

```
SyntaxError: Missing 'default' export in module '.../intake-page/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'.
```

`backend/test/intake-e2e.test.ts` imports `normalizeFirm` from `intake-page/src/App.tsx` (line ~12: `import { normalizeFirm } from "../../intake-page/src/App.tsx";`). `App.tsx` now imports `PdfFillScreen` from `./pdfFill/PdfFillScreen.tsx` (added by Wave 8's Lane 3). `PdfFillScreen.tsx` line 3 does:

```ts
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
```

The `?url` suffix is a **Vite-specific** import convention (Vite's asset plugin turns it into a build-time-resolved static asset URL string). Bun's module resolver has no equivalent plugin for `?url` — it tries to load the file as a real module and fails, because `pdf.worker.min.mjs` isn't a module with a default export, it's a worker script.

This is a real regression the wave-end gate caught exactly as intended: Lane 3's browser-only code is now transitively reachable from a Bun-run backend contract test via `App.tsx`'s import graph, and the two runtimes disagree on this import syntax.

## The fix

Replace the Vite-only `?url` import with the **standard ESM `new URL(..., import.meta.url)` pattern** — this is `pdfjs-dist`'s own officially recommended way to resolve its worker URL, Vite has first-class native support for it (Vite specifically recognizes and rewrites `new URL('...', import.meta.url)` into a proper build-time asset URL — this is arguably the more idiomatic Vite pattern, not a workaround), and it does not require any bundler-specific import-suffix magic that Bun's static module resolution would choke on.

In `intake-page/src/pdfFill/PdfFillScreen.tsx`:

```ts
// Before:
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// After:
const pdfWorkerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
```

Remove the now-unnecessary `intake-page/src/pdfFill/vite-assets.d.ts` module declaration for the `?url` specifier (check if anything else in `intake-page/` still uses a `?url` import before deleting the whole file — if something else needs it, just remove the now-unused `pdfjs-dist/build/pdf.worker.min.mjs?url` declaration from it, not necessarily the whole file).

**Verify this doesn't just move the problem** — after the fix:
1. `cd backend && bun test test/intake-e2e.test.ts` (or however `npm run test:contracts` invokes it — check `scripts/test-contracts.sh`) must pass without the module-resolution error. Bun statically resolving/parsing `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` should be a no-op at parse time (it's just a runtime `URL` construction with a plain string argument, not a special import), so it should not error even though `App.tsx`'s module graph still transitively includes `PdfFillScreen.tsx`.
2. **The real browser behavior must be unchanged or better** — this worker URL is what makes PDF.js actually render PDFs in the client's browser. Run the actual Playwright test that exercises `PdfFillScreen` (`intake-page/tests/pdf-fill.spec.ts`, added by Lane 3) against a real dev/build server and confirm PDF rendering still works with the new worker-URL resolution — do not just fix the Bun error and assume the browser path is fine, actually drive it.
3. Run a real `intake-page` production build (`npm --prefix intake-page run build` or whatever this repo's actual build script is — check `intake-page/package.json`) and confirm the worker asset is correctly emitted and referenced in the built output, not just that dev-mode works. A `new URL(..., import.meta.url)` pattern that only works in dev but breaks in a production Vite build would be a worse regression than what you started with.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout)

```
timeout 180 npm run test:contracts
timeout 300 npm --prefix intake-page test
timeout 300 npx playwright test intake-page/tests/pdf-fill.spec.ts --project=chromium
timeout 120 npm --prefix intake-page run build
timeout 120 npm --prefix intake-page run typecheck
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

`npm run test:contracts` must exit 0 — that's the actual bug this brief exists to fix, treat it as the primary pass/fail signal. Everything else must stay green (they already are on this branch — do not regress any of them).

Do not run `npm run gate` or anything touching Rust/cargo.

## Finish

Commit on `lp/intake-w8-worker-import-fix` with a conventional message containing the phrase `W8-WORKER-IMPORT-FIX`. Do NOT push. Do NOT merge. In your final report: confirm `npm run test:contracts` passes, confirm you actually drove the Playwright PDF-fill test (not just trusted the fix by inspection), confirm the production build emits the worker asset correctly, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
