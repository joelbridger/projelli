# Wave 8 — P1a Real Fix: Stop Persisting Sensitive PDF Template Data in Browser `localStorage`

**Branch:** `lp/intake-w8-review-r1-p1a-real-fix`, branched off `lp/intake-w8` at `85fd8459`.
**You are Codex, the builder.** Fix this, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## Why this brief exists

An earlier fix round base64-obfuscated the browser-mode (`!isTauri()`) fallback in `src/platform/intake/pdfTemplateArtifacts.ts` instead of leaving it plaintext. That was flagged by a further review as **not actually sufficient**: base64 is an encoding, not encryption — trivially reversed with one `atob()` call in devtools. Traced precisely: the value being obfuscated is `JSON.stringify({ versions: { [version]: { descriptor: PdfTemplateDescriptor, sourceBytesB64: string } } })` (see `src/platform/intake/pdfTemplateStore.ts`'s `writeSensitiveRecord`/`SensitiveTemplateRecord`) — the complete field map, hashes, and raw PDF source bytes. This still violates the wave's non-negotiable that this data must never be recoverable from `localStorage`.

## The real fix

Browser mode in this app is **dev/test only** — this is a Tauri desktop product; browser mode is never a real customer deployment (confirm this understanding against `CLAUDE.md`'s "Target Platforms" section and this repo's existing `isTauri()` fallback conventions elsewhere before proceeding, but it should already be consistent with what you find). Given that, the correct fix is not a second encryption scheme for a mode that was never meant to hold real confidential data long-term — it's to **stop persisting the sensitive artifact to any durable browser storage at all**.

Change `src/platform/intake/pdfTemplateArtifacts.ts`'s non-Tauri branches (`writePdfTemplateArtifact`, `readPdfTemplateArtifact`, `deletePdfTemplateArtifact`) to use an **in-memory-only** store (a module-scoped `Map<string, string>`, keyed by `templateId`) instead of `localStorage`. Keep the exact same three function signatures — `pdfTemplateStore.ts` calls these generically and should need **no changes** if you preserve the signatures exactly. The Tauri branch (real AES-GCM encryption via the Rust command) is unaffected — do not touch it.

This means: in browser/dev mode, an imported template's sensitive data (source bytes, field map) now only survives for the current page session, not across a reload. That's an accepted, correct tradeoff for a dev-only code path — the real product path (Tauri desktop) already has genuine encrypted persistence. Do not try to preserve reload-durability for the browser path by inventing a weaker workaround; losing it is the fix, not a side effect to route around.

## What needs updating alongside this

- `src/platform/intake/pdfTemplateStore.test.ts` currently has a test (added by the earlier, insufficient fix round) asserting the browser-mode `localStorage` key holds a value that isn't plaintext-readable. That assertion no longer makes sense once nothing sensitive is written to `localStorage` at all — update it to assert the **opposite and stronger** property: after writing a template artifact in the (default, non-Tauri) test environment, **no key in `localStorage` contains the raw source bytes, field names, template ID, or hash** (you can assert this by checking `localStorage` is empty of any key related to this feature, or by scanning all `localStorage` values for the forbidden substrings — whichever this test file's existing patterns already favor). Also add a round-trip assertion that read-after-write still works correctly via the in-memory path within the same test run.
- Check whether `resetForTests` (`pdfTemplateStore.ts`, calls `clearSecret` for every known template id) still correctly clears the in-memory map between tests — it should, since it goes through `deletePdfTemplateArtifact`, but verify this doesn't silently break test isolation (e.g. if the in-memory `Map` is truly module-scoped and persists across `vitest` test cases within one file's run, confirm `resetForTests` (or the test file's own `beforeEach`) actually empties it, not just the Zustand `templatesById` state).
- Grep the codebase for any other reference to the `lantern:intake-pdf-template-artifact:` (or whatever the current fallback key prefix constant is) localStorage key pattern that might assume it's durably readable across a reload in browser mode, and update/remove it if found.

## Non-negotiables

- The Tauri (real desktop product) path must remain exactly as it is — genuinely AES-GCM encrypted via the Rust command, unaffected by this change.
- No sensitive template data (source bytes, field map, hashes) may be written to `localStorage`, `sessionStorage`, or any other durable browser storage in the non-Tauri path, in any form (plaintext, base64, or otherwise) — the fix must remove it from durable storage entirely, not obfuscate it further.
- No em dash in any comment or string you add.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 60 npx vitest run src/platform/intake/pdfTemplateStore.test.ts
timeout 300 npx vitest run src/platform/intake src/features/intake --test-timeout=20000
timeout 120 npx tsc --noEmit
timeout 300 node scripts/eslint-gate.mjs
timeout 60 node scripts/ui-system/token-guard.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo — this fix does not touch the Tauri/Rust path at all.

## Self-converge requirement

This is the second attempt at this exact fix after the first one was found insufficient on review — get it right this time. Prove the negative (nothing sensitive in `localStorage`) with a real test that would have caught the previous fix's gap, not just a test that happens to pass.

## Finish

Commit on `lp/intake-w8-review-r1-p1a-real-fix` with a conventional message containing the phrase `W8-P1A-REAL-FIX`. Do NOT push. Do NOT merge. In your final report: confirm no sensitive data reaches `localStorage` in the non-Tauri path (describe exactly what changed), confirm the Tauri path is untouched, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
