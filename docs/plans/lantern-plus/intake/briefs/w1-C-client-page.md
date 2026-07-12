# CODEX BUILD BRIEF — Lantern Intake Wave 1, Lane C: Client Page (static SPA)

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push. Do NOT touch files outside the new `intake-page/` workspace.** Wrapper appends the DONE-EXIT sentinel.

> NOTE: Lane A merged. Import its modules from `src/platform/intake/` — `intakeCrypto.ts` (derivePageKey, deriveAuthToken, generateContentKey, generateSubmissionId, wrapContentKey, sealItemChunk, sealManifest, verifySubmissionIntegrity), `intakeLink.ts` (parseLinkFragment), `intakeContract.ts` (BundleResponse, ChunkUpload, SubmitManifest, StateBlob), `types.ts` (FormRequest, RequestItem). Read those files first and use their exact signatures. Bundle them into the page build (they are pure WebCrypto, browser-safe).

## Context to read first
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §6 (client flow — the authoritative UX), §10 (edge cases), §1a design principles 1–7.
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §4 (what the browser can/cannot do — the crypto boot sequence), §2 (write-only property, resume state is cosmetic, done/not-done from finalization records).
- `docs/plans/lantern-plus/intake/RISKS.md` §2 (claims discipline — the page headline is conditional), §6 (phishing copy), §5 (email fallback labeling).
- `docs/plans/lantern-plus/intake/W1-EXEC-PLAN.md` §3 Lane C.

## What to build: `intake-page/` — a self-contained static SPA
- **Stack:** small and self-contained. Vite + React + TS (mirror the repo's frontend stack so tests/tooling are familiar), OR plain TS if lighter — your call, but the OUTPUT must be a static bundle with NO third-party origin at runtime (no CDN, no fonts from a network, no analytics). Everything inlined/bundled. It imports Lane A's crypto from the repo (`@/platform/intake/*` or a relative import into `../src/platform/intake`).
- **Routing:** the page loads at `/i/<intake_id>#v1.<b64 s>.<b64 pub>`. Parse `intake_id` from the path, the fragment via `parseLinkFragment`.

### Boot sequence (ARCHITECTURE §4)
1. **WebCrypto feature-gate FIRST** (`crypto.subtle` + P-256 ECDH probe). On failure → the sensitivity-routed fallback screen (documents → "reply to [advisor]'s email with a photo"; restricted fields → "call [advisor] and do it together"). A static `<noscript>` block: "This secure page needs a current browser. Please reply to the message that brought you here." NO degraded-crypto path, ever.
2. Parse fragment → `derivePageKey(s)`, `deriveAuthToken(s)`.
3. `GET /intake/:id/bundle` with `Authorization: Bearer <tokenB64>` → decrypt checklist + state with `k_page`.
4. Render. Firm name + accent come from the DECRYPTED checklist, never from the URL.

### The client experience (PRODUCT-DESIGN §6 — build all of it)
- **Light theme, mobile-first, firm-branded.** Big touch targets, generous type. Target user: a 68-year-old on an iPhone finishing in one sitting.
- **Welcome card** (read-only): "Hi [first name]. Welcome to [Firm]..." + the privacy line "This page locks your information on your device. Only [Firm] can unlock it. Learn how →" linking to a one-screen plain-language explainer (what encrypts where, what the firm sees, what Lantern-the-company can never see; footer: Lantern as tech provider). Copy rules: short sentences, no jargon, NO em dashes, second person.
- **One item per screen** with always-visible progress dots. Item renderers:
  - `typed_field`: date (DOB), SSN (format help + masking as they type; `autocomplete` hints that discourage retention), currency, free text.
  - `doc_upload`: **[Take a photo] first on mobile**, [Choose a file] second; license = one item with two slots (front, back) + framing guide.
  - `guided_question`: number / range picker / "I don't know yet" as EQUAL buttons.
  - `readonly_card`: welcome + what-happens-next.
  - every item: [Save and continue] + a quiet [Skip for now].
- **Per-item submit** (ARCHITECTURE §4): fresh `generateContentKey()` → encrypt payload (typed value as small JSON; files as 4 MiB chunks via `sealItemChunk` with the exact chunk ids) → `wrapContentKey` to the intake pubkey → upload chunks (`POST .../chunk`) → `sealManifest` + submit (`POST .../submit` with plaintext `submission_id` + wrapped key) → **discard content key + plaintext** → update sealed resume state with completion flag + generic confirmation ONLY (no last-4, no file names).
- **Write-only confirmations:** after SSN submit show "Provided ✓ (ending in 1234)" from memory in that session only; on any later visit just "Provided ✓" (the page genuinely holds nothing to show). Same for license: a checkmark, no re-preview.
- **Done/not-done comes from the bundle's `finalized_item_ids`** (server finalization records), NEVER from the writable resume state. "provided by you just now" for the local session's own submissions vs plain "provided" otherwise.
- **Replace this answer** on every completed item → reopens input → fresh submit (new submission supersedes).
- **Save/resume automatic:** state saves (sealed, `PUT /state`) after every item; reopening the link on any device resumes at the next incomplete item. No password, no "session expired."
- **Chunked resumable upload:** on reopen mid-upload, ask the relay which chunk indexes exist (count only) and resume; item shows "upload didn't finish" with one-tap resume.
- **Completion page v0:** "That's everything for now. Here's what happens next." + firm-authored placeholder steps.
- **Relay down:** fail politely, preserve typed-but-unsubmitted input in memory, retry with backoff, persist nothing sensitive.

## Tests — Playwright suite in `intake-page/` INCLUDING an automated axe accessibility pass
Run against a mocked relay (a small fixture server or route-mock) with a real Lane-A-sealed bundle:
1. Boot + decrypt + render the checklist (firm name from sealed data).
2. Complete all 5 items incl. camera-mock file uploads (chunked) → assert correct `chunk`/`submit` calls with well-formed sealed payloads.
3. Save/resume across a full reload → resumes at next incomplete item; done items reflect `finalized_item_ids`.
4. **Write-only:** after submitting SSN then reloading, the value/last-4 is NOT re-readable anywhere in the DOM or storage.
5. Replace-answer produces a new submission with a fresh `submission_id`.
6. Old-browser fallback branch renders (stub `crypto.subtle` absent) → sensitivity-routed message, no crypto attempted.
7. **axe accessibility pass = 0 serious/critical violations** on the welcome card, a typed field, an upload, and the completion page. (Gate for Wave 1.)
8. No network request goes to any origin other than the relay (assert via request interception).

## Constraints
- TDD. Real assertions. Self-contained bundle — no runtime third-party origin (one stray CDN/analytics call breaks the whole security story; the CSP in Lane E will block it, so don't rely on any).
- Light theme, no em dashes in any client-visible copy, no time estimates ("2 business days" is fine as a firm-authored placeholder; never a Lantern promise of duration).
- Keep it a NEW workspace — don't touch the advisor app's `src/` except importing Lane A's pure modules.
- Before done: `npx playwright test` green (incl. axe), page typechecks. Commit on your branch. Do NOT push.
