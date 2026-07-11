# Wave 9 Lane 1 Returns — Wire the Real Cross-Lane Contract Test

**Branch:** `lp/intake-w9` directly (the wave's fully-merged integration branch — Lanes 1-4 are all merged in already; you are working at the tip, not a separate lane branch). Worktree: `/home/jameson/lp-w9`.
**You are Codex, the builder.** This is the final, mandatory step before Wave 9 is release-gated per the prep pack: "Lane 1 returns after they merge to finish the real cross-lane test — its green run is a release blocker." Do NOT push. Do NOT merge (there is nothing to merge into; commit directly on `lp/intake-w9`). Do not send notifications; never invoke `notify-jameson`.

## What exists right now

`src/platform/intake/__tests__/docusignSignatureContract.test.ts` has 6 `it.skip` placeholders written against **guessed** export names from when Lane 1 built the shared contract, before Lanes 2, 3, and 4 existed. All four lanes are now merged into `lp/intake-w9` with real, working, independently-verified code. Your job is to replace every placeholder's guessed imports with the real ones and make each test actually exercise real code — not mocks of your own invention standing in for real modules.

## The real exports (verified against the actual merged code — read each file yourself before wiring, this list is a map, not a substitute)

- **Lane 2** (`src/platform/docusignSigning/`):
  - `docusignAdapter.ts`: `DirectDocusignAdapter` class, `.createEnvelopeAndRecipientView(input: DocusignEnvelopeInput): Promise<DocusignEnvelopeResult>`, `.pollEnvelopeStatus(envelopeId, attempts?, initialDelayMs?): Promise<string>`, `.retrieveCompletion(envelopeId): Promise<DocusignRetrievedCompletion>`. Constructor takes a `DocusignAuthorizationProvider` (`() => Promise<DocusignAuthorization>`).
  - `signatureWorkflow.ts`: `startDocusignSignature(input: StartSignatureInput): Promise<LocalSignatureRecord>`, `retrieveAndFileDocusignCompletion(input): Promise<LocalSignatureRecord>`, `loadFreshCompletionEvidence(...)`.
  - `launchRelayClient.ts`: `DocusignLaunchRelayClient` class (advisor/seat-token side), `.putLaunch(intakeId, launchCiphertextB64): Promise<void>`, `.deleteLaunch(intakeId): Promise<void>`. Uses `getCorsSafeFetch` internally (already mocked in this test file via `vi.mock('@/platform/providers/fetchUtils', ...)` — reuse the existing `fetchMock`).
  - `egressReceipt.ts`: `createDocusignEgressReceipt(input): DocusignEgressReceipt`.
  - `signatureRecordStore.ts`: `saveLocalSignatureRecord`/`loadLocalSignatureRecord`/`deleteLocalSignatureRecord`.
  - `src/platform/intake/intakeFiling.ts` (Lane 2 extended this Lane-0 file): confirm the exact new folder option name it added (read the file — the brief asked for a `'signature'` folder kind alongside the existing `'request'`/`'pdf_form'`) and use `fileIntakeDocument` with that option directly; there is no separate `fileRetrievedDocusignArtifacts` function — filing happens inline via two `fileIntakeDocument` calls (see `retrieveAndFileDocusignCompletion` in `signatureWorkflow.ts` for the exact pattern to mirror in your test's assertions).

- **Lane 3** (`intake-page/src/docusignSigning/`):
  - `launchRelayClient.ts`: `SigningLaunchRelayClient` class (public/client side), `.fetchLaunch(): Promise<string | null>`.
  - `message.ts`: `DOCUSIGN_SIGNING_MESSAGE_TYPE`, `DocusignSigningMessage`, `createDocusignSigningMessage`, `isDocusignSigningMessage`.
  - `origins.ts`: `DOCUSIGN_RETURN_PATH`, `DOCUSIGN_CEREMONY_OUTCOMES`, `DocusignCeremonyOutcome`, `isDocusignCeremonyOutcome`, `isDocusignReturnPath`.
  - Note: `intake-page/` is a **separate package** from the root `src/` tree (own `node_modules`, own `tsconfig`). Confirm your test file's existing import style already reaches into `intake-page/src/...` the way `pdfFillContract.test.ts` does (it imports `../../../../intake-page/src/...` relative paths per that file's established pattern — mirror it exactly) before assuming a `@/`-style alias works across the package boundary.

- **Lane 4** (`backend/src/lib/docusignSigning/` and `backend/src/routes/docusignSigning.ts`):
  - **Runtime constraint — read this before wiring anything from Lane 4:** `backend/src/lib/db.ts` imports `bun:sqlite`, and `backend/src/routes/docusignSigning.ts` imports `Store` from `db.ts` — so the actual HTTP route handlers (`handleIssueSigningCapability`, `handlePutSignatureLaunch`, `handleGetSignatureLaunch`, `handleDeleteSignatureLaunch`, `handleDocusignConnectEvent`, `handleListSignatureWakeups`, `handleAckSignatureWakeups`) **cannot be imported into this file** — this test runs under `vitest` (Node), not under `bun test`, and `bun:sqlite` is not resolvable there. Do not attempt to import anything from `backend/src/routes/docusignSigning.ts` or `backend/src/lib/db.ts` here — it will fail at import time, not at runtime.
  - However, `backend/src/lib/docusignSigning/connect.ts` and `backend/src/lib/docusignSigning/store.ts` use **only `node:crypto`** — no Bun-specific imports — so they genuinely are importable here. Use them directly:
    - `connect.ts`: `verifyDocusignConnectSignature(rawBody, signature, connectKey): boolean`, `validateDocusignConnectPayload(rawBody, expectedEnvironment, nowMs?): ConnectValidation`. Read its `FORBIDDEN_FIELD` regex and `ALLOWED_FIELDS` set (near the top of the file) — this is the real, working equivalent of what the old placeholder called `assertValidDocusignBrokerRequest`: it rejects a payload containing any document/recipient/matter-shaped field before any further processing.
    - `store.ts`: `isDuplicateSignatureWakeup(records, candidate): boolean`, `SignatureWakeupRecord` type. This is the real equivalent of the old placeholder's generic `handleDocusignConnectEvent` dedup check — it's the same idempotency logic the real route handler calls internally, just at the pure-function level this test process can actually reach.
  - The full HTTP-handler-level behavior (the actual endpoints rejecting bad requests, the actual webhook handler enqueueing exactly one wake-up per unique event) is already verified by Lane 4's own `backend/test/docusignSigning.test.ts` (10 passing tests, real `bun test`, already independently confirmed green). Your job here is not to duplicate that — it's to prove the **shared pure contract** (the same validation/dedup functions the real handlers call) holds, using the real functions, not a stand-in.

## Deliverables — replace each `it.skip` with real wiring

Un-skip all six. For each, use the **real** imports above. If a case genuinely cannot be wired against real code for a sound architectural reason (only the Bun-runtime constraint above should ever be that reason), do not silently delete it — replace it with a test that exercises the real Node-importable equivalent and add one sentence in your final report explaining the substitution, same as the runtime-constraint reasoning already given to you above for cases 3 and 6.

1. **Envelope adapter captures exact bytes/tabs** — construct a real `DirectDocusignAdapter` with a synthetic `DocusignAuthorizationProvider`, drive `fetchMock` (already set up in this file's `beforeEach`) to return synthetic DocuSign envelope + recipient-view responses, call `.createEnvelopeAndRecipientView(...)` with a known `pdfBytes` and the `signature().tab_map` fixture already in this file, and assert (from the captured `fetchMock` call) that the exact bytes and exact reviewed tabs were sent — mirror the real assertion style already used in `src/platform/docusignSigning/docusignAdapter.test.ts` (Lane 2's own adapter test) rather than inventing a new one.

2. **Sealed launch record round-trips as ciphertext-only** — build a real `SignatureLaunchRecord` (Lane 1's own type, already imported or importable from `./docusignSignature/signatureLaunch`), seal it with the real `sealPageJson`/`derivePageKey` primitives this file's sibling contract tests already use (check `pdfFillContract.test.ts` for the exact pattern), `PUT` it through a real `DocusignLaunchRelayClient` against the mocked fetch, capture the exact serialized wire body, and assert it contains no `recipientViewUrl`, no `signatureItemId`, no `requestId` in clear text — only opaque base64 ciphertext. Optionally also drive a `SigningLaunchRelayClient.fetchLaunch()` call against the same mocked wire response to prove the round trip is symmetric (advisor pushes, client pulls, same opaque bytes).

3. **Rejects document bytes, recipient details, and a matter id before processing** — use `validateDocusignConnectPayload` directly (see the Lane 4 runtime-constraint note above) with a payload containing a forbidden field (e.g. `documentBytes`, `recipientEmail`, `matter_id` — check the exact `FORBIDDEN_FIELD` regex in `connect.ts` for which literal field-name variants it actually catches, and pick ones it demonstrably rejects) and assert `{ ok: false, ... }` comes back, never a value suggesting the payload was accepted or partially processed.

4. **Files signed artifacts together without changing the original Wave 8 form** — build a minimal fake `WorkspaceService` (in-memory map keyed by path, matching whatever interface `fileIntakeDocument` actually needs — check `intakeFiling.ts` and any existing test fakes for this interface, e.g. `intakeFiling.test.ts` likely already has one; reuse its pattern rather than inventing a new fake), call the real filing path (either `retrieveAndFileDocusignCompletion` end-to-end with a synthetic adapter returning a signed PDF + certificate, or `fileIntakeDocument` directly twice with the real `'signature'`-folder option — your call on which is the more faithful integration, prefer the full `retrieveAndFileDocusignCompletion` path since it's the real production code path), and assert both files land under `Requests/<slug>/signatures/` while a separately-filed Wave 8 form under `Requests/<slug>/forms/` is untouched.

5. **Does not mark browser-return-only or webhook-only records signed** — this is fully testable at the frontend level without touching Lane 4's backend at all: call `retrieveAndFileDocusignCompletion` with a synthetic adapter whose `pollEnvelopeStatus` resolves to a DocuSign status that is not `'completed'` (e.g. `'sent'` or `'delivered'`) and confirm the resulting `LocalSignatureRecord.status` is `'completion_pending'`, never `'signed'`, and that `retrieveCompletion` (the actual document-fetching call) was never invoked. This directly proves a mere status ping can never mark something signed without the real verified-retrieval path running to completion.

6. **Deduplicates repeated completion events** — use `isDuplicateSignatureWakeup` (Lane 4's real Node-importable function) directly: build a `SignatureWakeupRecord[]` containing one event, assert a second call with the same `event_id` is detected as a duplicate (`isDuplicateSignatureWakeup` returns `true`) and a genuinely new `event_id` is not (`false`) — mirroring Lane 1's own `isDuplicateSignatureEvent` test pattern in `docusignSignature/docusignSignature.test.ts` for the equivalent local-record-level check, since this is the backend's analogous idempotency primitive.

## Non-negotiables (unchanged from the original contract, verify they still hold with real code)

- No `matter_id`, client name/email, envelope ID, ceremony URL, or document byte appears in any serialized wire body you inspect in case 2 — assert this explicitly with a string-search over the actual captured request body, not just a type-level claim.
- Every rejection case (3, and the eligibility rejections already covered by the earlier non-skipped tests in this file) is proven to happen **before** any DocuSign network call would occur — since case 3 doesn't touch DocuSign directly, this means before any further processing/storage.
- Case 5's `retrieveCompletion` — assert it was never called (`expect(adapter.retrieveCompletion).not.toHaveBeenCalled()` or equivalent) for the non-`'completed'` status, not just that the final status field looks right — a spy assertion is what actually proves "browser-return-only or webhook-only can't mark it signed," a status-field check alone could pass even if you'd accidentally called the retrieval anyway.

## Self-converge requirement

Run the checks below, fix every failure, rerun until green. This file's 2 already-passing non-skipped tests must remain passing unchanged. Do not weaken any assertion to make a case pass — if a real wiring genuinely can't prove what the case claims, say so plainly in your report rather than accepting a weaker proof silently.

## Checks to run (report exact pass/fail; wrap every invocation in a timeout)

```
timeout 300 npx vitest run src/platform/intake/__tests__/docusignSignatureContract.test.ts
timeout 300 npx vitest run src/platform/intake src/platform/docusignSigning src/features/intake
timeout 180 npx tsc --noEmit
timeout 240 node scripts/eslint-gate.mjs
```

Do not run `npm run gate`, `bun test`, or anything touching Rust/cargo/backend from this task — you are not modifying backend code, only importing two of its already-Node-compatible lib functions for read-only use in a frontend test.

## Finish

Commit directly on `lp/intake-w9` with a conventional message containing `W9-CROSSLANE-GATE`. Do NOT push. Report exact check results for all four commands, confirm all 6 previously-skipped cases now run for real (list which real exports each one ended up using, noting any deviation from the map above), confirm the branch is clean, and state plainly whether you believe the mandatory cross-lane contract test genuinely proves what W9-PREP.md §5 and §8 require (structural proof only — the real DocuSign sandbox round-trip in §8 still requires live demo credentials, which are not available yet; say so).

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
