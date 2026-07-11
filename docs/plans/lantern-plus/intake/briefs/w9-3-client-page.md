# Wave 9 Lane 3 — Client Signing Launch, Embedded Ceremony, and Data-Free Return

**Branch:** `lp/intake-w9-client-page`, branched off `lp/intake-w9` **after Lane 1 has merged into it** (confirm with `git log --oneline -5` that your branch point contains a commit with `W9-LANE1-CONTRACT` in its message before starting).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Read first

1. `/home/jameson/lantern-coordination/prep/W9-PREP.md` in full, especially §4.4 (embedded ceremony URL and client return), §7 Lane 3.
2. Lane 1's final report for exact export names/signatures (`SignatureLaunchRecord`, `assertSignatureLaunchUsable`, `SignatureStatus`) — confirm before importing.
3. `intake-page/src/App.tsx` — read the whole outer loader (`App()`, ~line 279 onward: fetches checklist + state via `window.location.pathname.match(/^\/i\/([^/]+)/u)` for the intake id and `window.location.hash` for the link fragment key material) and the item-flow driver beneath it (`currentItemId`, `isActionable`/similar item filter at ~line 69 which deliberately excludes `t === 'signature'` — that exclusion is correct and permanent, signature items are never part of the ordinary checklist item flow). You are adding a **separate** step/screen that becomes available once a signature launch exists, not a new case in the existing item switch.
4. `intake-page/src/pageCrypto.ts` (`sealPageJson`/`openPageJson`), `src/platform/intake/intakeCrypto.ts` (`derivePageKey`) — you will decrypt the launch record with the **same page key already derived from the link fragment's secret** that decrypts the checklist and state. No new key material.
5. `intake-page/src/relayClient.ts` — the existing client-side relay client pattern (plain `fetch`, the intake's own bearer token) you will mirror for the new launch-fetch call.
6. The Wave 9 launch relay contract below (§Launch relay contract) — fixed, cross-lane-agreed, do not redesign.
7. `intake-page/tests/` structure and existing Playwright specs (check what's there — likely `intake-page/tests/pdfFill.spec.ts`-style specs and `intake-page/tests/fixtures/`) for the test harness pattern you will extend.

## Goal (one paragraph)

Once the advisor has created a DocuSign envelope for a client's completed form, the client — returning to the exact same intake link they already used — should see a short, plain, accessible consent screen explaining that continuing sends the completed form and their name/email to DocuSign to collect the signature. On consent, the app opens DocuSign's one-time embedded signing ceremony in a new browser tab/window (not an iframe — DocuSign's security headers typically block framing, and the prep pack explicitly says not to fight that), keeping the original Lantern tab open on a waiting screen. DocuSign redirects the signing tab to an exact, allow-listed, static, data-free Lantern return page after the ceremony ends (completed, cancelled, declined, or expired); that return page relays only the outcome back to the original waiting tab via `postMessage` with a strict origin and event allow-list, then can close itself. The original tab then shows a sealed, generic "your signed form is being confirmed" state — it never claims completion itself; only the advisor app's independent retrieval (Lane 2) does that.

## Non-negotiables (a reviewer will check these)

- This page never receives a DocuSign API token, a JWT, or the readable Wave 8 PDF. It receives only the sealed `launch_ciphertext_b64` blob (decrypted locally with the page key it already has) and, from that, a one-time DocuSign recipient-view URL.
- The recipient-view URL is used exactly once (you track "already opened" locally for this session so a page refresh doesn't silently re-open a stale/consumed URL — but the real one-time enforcement is server-side on DocuSign's end; your job is not to make a bad UX out of a URL that's already been used, not to be the security boundary).
- The return page accepts **no** PDF, client detail, token, envelope ID, or `matter_id` in its URL, query string, or body — only the ceremony outcome event DocuSign appends to the return URL (`event=signing_complete|cancel|decline|ttl_expired|exception` or whatever DocuSign's actual embedded-signing return contract uses — confirm the exact parameter name against DocuSign's current embedded-signing documentation before hardcoding it, and handle an unrecognized/missing event value as a safe "something went wrong, ask your advisor" state, never as an implicit success).
- `postMessage` from the return page to the opener: exact target origin (this app's own origin, never `'*'`), a small closed set of allow-listed message shapes (just the outcome enum + nothing else), and the **receiving** side (the original tab) verifies `event.origin` against the same exact allow-list before trusting anything in the message.
- No analytics, remote fonts, DocuSign API calls, PDF downloads, custom logging, or third-party scripts anywhere in this lane's new code. Egress from this lane is limited to: the existing Lantern static/relay traffic, the one new launch-fetch relay call, and the one explicit top-level navigation to DocuSign's recipient-view URL.
- The client-facing copy is short, plain, accessible, light-theme, and contains no em dash. Use language close to: "Review and sign with DocuSign" for the consent screen, and "Your signed form is being confirmed" for the post-return waiting state. Never say Lantern signed the form or that a custodian has accepted it.
- This screen never marks anything "signed" itself — it only ever shows a generic "confirming" state after a completed ceremony. Completion truth comes only from the advisor app's independent retrieval (Lane 2), which the client page has no way to observe directly in Wave 9 (no live sync-back to this static page is in scope — the client's confirmation of a truly filed signature happens out of band, e.g. the advisor follows up, or a future wave adds a status check; document this limitation plainly in your report rather than inventing a live-status poll that isn't in the brief).

## Launch relay contract (fixed — do not redesign)

```
GET  {firmApiBase}/docusign-signing/{intakeId}/launch
     Auth: public, gated by the client's own intake auth token (mirror how relayClient.ts already authenticates its other calls to this same relay)
     Response: { launch_ciphertext_b64: string | null }
```

`launch_ciphertext_b64` is `sealPageJson(pageKey, launchRecord)` where `launchRecord` is Lane 1's `SignatureLaunchRecord` (carries `signatureItemId`, `recipientViewUrl`, `issuedAt`, `expiresAt`, `consumed`, `requestId`). Decrypt with the same `pageKey` already derived for this intake. A `null` response (or 404-equivalent) means no signature step is available yet — the app should not show anything new, and if you choose to poll for this, do so at a light interval (define one, e.g. every 15-30s, only while the app is in a state where a signature could plausibly become available — never a tight loop, and stop polling once a launch has been found and consumed/opened).

Validate the decrypted record with Lane 1's `assertSignatureLaunchUsable` before ever using `recipientViewUrl` — an expired or already-`consumed` record must show a clear "this signing link has expired, ask your advisor to resend" state, not a silent retry or a broken navigation.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `intake-page/src/App.tsx` — add the launch-check + consent screen + waiting state as a step that becomes available once a launch record is present, without disturbing the existing item-flow logic for `typed_field`/`doc_upload`/`guided_question`/`pdf_fill` items.
- `intake-page/src/types.ts` — add whatever minimal local types this lane needs (e.g. a narrow `SigningLaunchUiState` if useful); do not touch `AnswerPayload`/`ResumeState`'s existing shape beyond additive, optional fields if truly needed (state clearly in your report if you add any).
- Intake-page styles (wherever `styles.css` or inline style patterns already live) for the new screens — keep them visually consistent with the existing page (light theme, accessible, matches existing button/typography patterns already in `App.tsx`).

**Create (all under `intake-page/src/docusignSigning/`):**
- The launch-fetch relay client (mirrors `relayClient.ts`'s pattern).
- The consent screen component.
- The waiting/confirming screen component.
- The return-page component/route and its `postMessage` sender, plus the opener-side `postMessage` receiver wired into the main app flow.
- Origin/event allow-list constants, defined once and imported everywhere they're checked (no duplicated literal origin strings scattered across files).

**Create (tests):**
- `intake-page/tests/docusign-signing.spec.ts` — Playwright, per §Acceptance tests below.
- Synthetic fixture data under `intake-page/tests/fixtures/` for a sealed launch record (mirror the existing fixture pattern, e.g. `pdfFixtures.ts`).

Nothing else. Do not touch advisor-side code (`src/features/intake/`, `src/platform/docusignSigning/`), root dependencies, `backend/`, or Lane 1's `src/platform/intake/docusignSignature/` (import from it, never edit it).

## Deliverables

1. Launch detection: on load (and light polling per above), check for an active launch; decrypt and validate it.
2. Consent screen: plain-language explanation of what's sent to DocuSign, an explicit confirm action.
3. Ceremony launch: `window.open` (new tab/window) to `recipientViewUrl`, never an iframe; the original tab shows a waiting state immediately after opening.
4. Return page: exact static route, reads only the DocuSign-appended outcome parameter, sends one allow-listed `postMessage` to `window.opener` at the exact app origin, then may close itself.
5. Opener-side receiver: verifies origin + message shape, transitions the original tab to the sealed "confirming" state for `signing_complete`, or a clear cancelled/declined/expired/error state for the others.
6. Full keyboard-accessible flow (focus management when the new tab opens and when it returns/closes, ARIA labeling on the consent screen, no keyboard traps).

## Acceptance tests (full list)

- Playwright: client consent screen renders and requires explicit confirmation before any DocuSign navigation; one-time launch is "consumed" locally after first open (a page refresh does not silently re-navigate); correct DocuSign destination is used (assert the `window.open` target URL is exactly the decrypted `recipientViewUrl`, nothing appended/modified); trusted-origin return handling for `signing_complete`/`cancel`/`decline`/expired/unrecognized-event paths, each rendering a distinct correct state; expired launch record shows the "ask your advisor to resend" state without ever calling `window.open`; refresh and back-button behavior does not lose the user in a broken state; full keyboard-only flow reaches and completes the consent screen.
- Network capture: every request this lane's new code makes is either existing Lantern static/relay traffic or the one explicit top-level navigation to DocuSign — assert no JWT, bearer token, W8 PDF bytes, certificate, client value, `matter_id`, or envelope ID appears in any URL, DOM (including hidden state), console output, error report, or relay request body across the whole flow.
- `postMessage` allow-list: a message from an unexpected origin is ignored (does not transition state); a message with an unrecognized shape/event is ignored; only the exact allow-listed events transition state.
- `assertSignatureLaunchUsable` integration: an expired or already-consumed launch is rejected before any navigation, with a distinct test for each case.

## Self-converge requirement

Run the full acceptance list, fix every failure, rerun until green. Skip only genuinely Lane-2/4-blocked cases (name the exact missing export/endpoint in a `// TODO(w9-gate): ...` comment). Confirm DocuSign's actual embedded-signing return query-parameter contract against their current documentation before hardcoding an assumption about its exact name/values — if you cannot verify it, implement against the most commonly documented shape (`event=signing_complete|cancel|decline|ttl_expired|exception`) and flag the assumption clearly in your report so it can be verified against the real sandbox in the mandatory round-trip test later.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout)

```
timeout 120 npm --prefix intake-page run typecheck
timeout 300 npm --prefix intake-page test
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate`, the root `npx vitest`, or anything touching Rust/cargo — this lane only touches `intake-page/`.

## Finish

Commit on `lp/intake-w9-client-page` with a conventional message containing `W9-LANE3-CLIENT-PAGE`. Do NOT push. Do NOT merge. Report exact check results, every new export other lanes might need, every skipped test with its exact missing dependency, the exact DocuSign return-parameter assumption you made (flagged for later real-sandbox verification), and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
