# Wave 9 Lane 2 — Advisor Direct DocuSign Envelope, Retrieval, and Encrypted Filing

**Branch:** `lp/intake-w9-advisor`, branched off `lp/intake-w9` **after Lane 1 has merged into it** (confirm with `git log --oneline -5` that your branch point contains a commit with `W9-LANE1-CONTRACT` in its message before starting).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Read first

1. `/home/jameson/lantern-coordination/prep/W9-PREP.md` in full, especially §4.2 (JWT/key ownership), §4.3 (envelope creation), §4.5 (retrieval and filing), §7 Lane 2.
2. Lane 1's final report (in your branch history / the wave lead's notes) for the **exact** export names and signatures it landed — the names below are the design as specified to Lane 1; confirm each one still matches before you import it, and if Lane 1 changed a name, use the real one and note the discrepancy in your report.
3. The Wave 9 signature launch relay contract below (§Launch relay contract) — this is a **fixed, cross-lane-agreed wire contract** decided by the wave lead so Lanes 2, 3, and 4 can build in parallel without waiting on each other. Do not redesign it; if it is genuinely unworkable once you're implementing, stop and say why in your report rather than silently diverging (Lane 3 and Lane 4 are building against the exact same contract).
4. `src/platform/intake/pdfFillReceipt.ts`, `src/platform/intake/pdfTemplates/templateContract.ts`, `src/platform/intake/pdfTemplates/templateValidation.ts` — the Wave 8 verification primitives you will reuse to independently re-verify the source PDF before ever calling DocuSign (`verifyPdfFillReceipt`, `assertSafeFlattenedPdf`).
5. `src/platform/intake/intakeFiling.ts` — the existing `intakeRequestFolder`/`intakePdfFormFolder`/`fileIntakeDocument` pattern. You are adding a sibling `intakeSignaturesFolder` (`Requests/<slug>/signatures/`) the same way.
6. `src/platform/intake/intakeStore.ts` — `IntakeRecord`, `IntakeChecklistState`, `IntakeReceivedItem`. Read-and-extend: today neither type carries the `PdfCompletionReceipt` hashes, only a `filePath`. You need those hashes to call Lane 1's `assertSignatureEligible` (which needs `currentCompletion.{templateId,templateVersion,sourceSha256,completedSha256}`), so decide how to get them — the two honest options are (a) extend `IntakeChecklistState`/`IntakeReceivedItem` to also persist the receipt's hash fields when a `pdf_fill` item is received (small, additive, backward-compatible optional fields), or (b) recompute both hashes fresh from the filed PDF's bytes on disk plus the locally-kept template descriptor every time eligibility is checked (`sha256Hex` from `pdfTemplates/receipt.ts`, `loadPdfTemplateDescriptor` from `intakeKeychain.ts`). Prefer (b) as the primary source of truth for `completedSha256` (never trust a stored claim about bytes on disk — recompute), but you may cache (a) for display/UX speed as long as (b) is what gates the actual `assertSignatureEligible` call. Document your choice.
7. `src/platform/privacy/localOnlyGuard.ts` — `assertLocalOnlyAllowsExternal(op: string)`. This is the correct guard for this lane's DocuSign calls: it is the guard used for "off-device chatter that is NOT a connector [pulling data in] and NOT... " — read its doc comment fully. Sending the client's flattened PDF to DocuSign is an outbound send of client content to a third party (like cloud AI generation), not an inbound connector pull, so it belongs behind this guard, not behind the (deliberately unblocked) connector-sync guards used by the read-only DocuSign import elsewhere in the app.
8. `src/platform/providers/fetchUtils.ts` (`getCorsSafeFetch`) — how existing direct-to-cloud-provider calls (Claude/OpenAI/Gemini adapters in `src/platform/providers/`) make authenticated fetches straight from the desktop webview. Your DocuSign adapter follows the same shape: plain `fetch`-based TS client, no new Rust/Tauri command.
9. **Do not touch or reuse** `src/features/docusign/`, `src/platform/utils/docusign-commands.ts`, or `src-tauri/src/commands/docusign/`. That is the existing **read-only** DocuSign connector (OAuth authorization-code + PKCE, a completely different integration key and auth boundary). Wave 9 signing uses a separate JWT-based integration key end to end (Lane 4 owns the broker side of that). Reusing that connector's token or HTTP client would quietly widen its power — the prep pack explicitly forbids this.

## Goal (one paragraph)

Give the advisor a light "Send for signature" action on a completed Wave 8 form: pick the form, review signer name/email, see a plain-language egress explanation ("this sends the completed form and the signer's name and email directly to DocuSign"), confirm, and the app creates a DocuSign envelope by calling DocuSign's API **directly from the desktop app** — never through a Lantern server — using a short-lived JWT-derived authorization it gets from Lane 4's broker. You seal a `SignatureLaunchRecord` and push it through the new narrow relay endpoint (§Launch relay contract) so the client can later open the embedded signing ceremony from their existing intake page. After DocuSign completes the envelope (learned via Lane 4's webhook wake-up, or your own polling with backoff — never trust either alone), you fetch the signed PDF and certificate **directly from DocuSign**, verify them, encrypt them into the local workspace, and file them under `Requests/<slug>/signatures/` — leaving the original Wave 8 completed PDF untouched under `Requests/<slug>/forms/`.

## Non-negotiables (a reviewer will check these)

- The flattened PDF, signer name, and signer email travel **only** from this desktop app directly to DocuSign's API (`https://demo.docusign.net` and its account-specific variant in the sandbox stage). They never pass through any Lantern-operated server, including the intake relay and the Lane 4 broker.
- The broker (Lane 4) never receives document bytes, signer name/email, or `matter_id` — your adapter's calls to the broker are limited to whatever narrow capability-issuing contract Lane 4 documents (a short-lived authorization only). If you find yourself wanting to send the broker anything beyond that, stop — that is a Lane 4 contract violation, not a Lane 2 decision to make unilaterally.
- Before any DocuSign call: `assertLocalOnlyAllowsExternal('Send for DocuSign signature')` (or equivalent op label) runs, and a Local-only block produces **zero** DocuSign calls plus a recorded blocked receipt (see §Egress receipt below) — test this explicitly.
- Before any DocuSign call: `assertSignatureEligible` (Lane 1) must pass using **freshly recomputed** evidence, not a cached claim. A stale/tampered/changed Wave 8 completion, a foreign source, an inactive request, or an existing active signature record must all block the call before any network traffic — test each one with a network spy proving zero calls.
- `envelopeId`, the recipient-view URL, and all DocuSign event payloads live **only** in the encrypted local `LocalSignatureRecord` (Lane 1's contract) — never in generic request-board Zustand persistence, never in a plaintext log, never printed to console in production code paths.
- The signed PDF and certificate are filed together, only under `Requests/<slug>/signatures/`, only after independent local verification of both (hash recompute, safe-PDF check reusing `assertSafeFlattenedPdf`, expected envelope/template/request linkage). The original Wave 8 PDF under `Requests/<slug>/forms/` is never modified or deleted.
- A status can reach `signed` in the local record **only** after your code has itself retrieved and verified the final PDF + certificate and durably written both files — never from a webhook alone, never from the client's browser-return event alone (Lane 1's `assertValidLocalSignatureRecord` already makes an invalid signed-without-hashes record impossible to construct; your job is to never even attempt one).
- Declined, voided, invalid, or failed-retrieval outcomes stay visibly unresolved (`needs_followup` or the matching terminal status) and retryable — never silently dropped.

## Launch relay contract (fixed — do not redesign)

A small, dedicated, ciphertext-only relay surface lives in Lane 4's new `backend/src/routes/docusignSigning.ts` (not the existing `backend/src/routes/intake.ts` — Wave 9 does not touch the existing intake relay schema at all for this). It is a narrow push/pull mailbox for exactly **one active sealed blob per `intakeId`** (a Wave 9 scope decision: one active signature launch per intake at a time — a request with more than one signature item completes them serially, one launch overwrites the previous). The client never learns a signature item's `item_id` in advance (signature items can never be sent through the ordinary checklist, so there is nothing for the client to look up by), so the endpoint is keyed by `intakeId` alone; the decrypted payload itself carries `signatureItemId` for whoever reads it:

```
PUT  {firmApiBase}/docusign-signing/{intakeId}/launch
     Auth: advisor seat token (same X-Seat-Token / Authorization: Bearer headers IntakeRelayClient.authHeaders() already sends)
     Body: { launch_ciphertext_b64: string }
     Response: { ok: true }

GET  {firmApiBase}/docusign-signing/{intakeId}/launch
     Auth: public, gated by the client's own intake auth token (Lane 4 implements a narrow equivalent of intake.ts's gatePublicIntake — it is NOT exported, do not try to import it)
     Response: { launch_ciphertext_b64: string | null }

DELETE {firmApiBase}/docusign-signing/{intakeId}/launch
     Auth: advisor seat token — used to withdraw/clear a launch (e.g. envelope voided, or after the client consumes it, if you choose explicit cleanup over TTL-only expiry; Lane 4's call).
```

The ciphertext is `sealPageJson(pageKey, launchRecord)` where `launchRecord` is Lane 1's `SignatureLaunchRecord` shape (which already carries `signatureItemId`), and `pageKey` is `derivePageKey(linkSecretB64Bytes)` — **the exact same page key already used to seal this intake's checklist and state blobs.** You already have `linkSecretB64` locally (stored by `storeIntakeSecrets` at `createAdvisorIntake` time) because the advisor app is the one that created this intake's link. Reuse `derivePageKey`/`sealPageJson` from `src/platform/intake/intakeCrypto.ts` / `intake-page/src/pageCrypto.ts` exactly as-is — do not invent a new sealing scheme.

Your job in this lane: after a successful envelope + recipient-view creation, build the `SignatureLaunchRecord`, seal it, and `PUT` it via a small new client you add to `src/platform/docusignSigning/` (a plain `fetch`-based client using `getCorsSafeFetch` and `IntakeRelayClient`'s `authHeaders()` pattern for reference — you do not need to modify `IntakeRelayClient.ts` itself; write your own small client scoped to this one endpoint, in your own new module). Lane 3 owns the `GET` side.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/features/intake/RequestsBoard.tsx` — add the light advisor action (or a launch point into it) for a Wave 8-completed `pdf_fill` item that has an associated eligible `docusign` signature item. Keep this board's existing "derives only row metadata" contract intact (see the file's own doc comment) — do the actual sending from a dialog/panel, not by loading client facts into the board itself.
- `src/features/intake/ClientRequestsTab.tsx` and/or `OnboardingTab.tsx` (read `OnboardingTab.tsx` first — it renders per-item status via `requestItemStatusLabel`/`requestItemDisplayLabel`; you are adding an analogous branch for `t === 'signature'` items showing the plain-language statuses: Ready to send, Awaiting signature, Confirming signed form, Signed, Declined, Needs follow-up) — wire the send action and status display here.
- `src/platform/intake/intakeFiling.ts` — add `intakeSignaturesFolder(matterFolderPath, requestSlug)` mirroring `intakePdfFormFolder`, and extend `fileIntakeDocument`'s `folder` union with a `'signature'` option (or add a small sibling filing helper if that reads cleaner — your call, keep it consistent with the existing pattern).
- `src/platform/intake/intakeStore.ts` — whatever additive fields you decided in "Read first" item 6, plus wherever you persist `LocalSignatureRecord` (a new store, or fields on `IntakeRecord` — your call; it must be encrypted-local, never in the generic Zustand persistence blob in plaintext if that persistence layer isn't already encrypted at rest — check how `intakeKeychain.ts` stores `PdfTemplateDescriptor`s today and use the same encrypted-local pattern for `LocalSignatureRecord`, not raw Zustand `localStorage`).

**Create (all under `src/platform/docusignSigning/`):**
- The desktop DocuSign adapter: JWT capability exchange with Lane 4's broker (receives a short-lived, one-use capability; exchanges it only in memory; clears it after use or expiry — never written to disk, an intake record, a crash report, or a log), envelope creation (exact flattened PDF bytes as the sole document, real recipient name/email, stable local `clientUserId`, tabs placed from Lane 1's validated `tab_map`), recipient-view URL creation, status polling with backoff, direct retrieval of the final signed PDF + certificate of completion.
- The launch-relay push client described above.
- The egress receipt module (see below).
- Local signature record persistence (encrypted-local, per the intakeKeychain-style pattern), keyed by `(requestId, signatureItemId)`, written only after each durable step per Lane 1's `LocalSignatureRecord`/`SignatureStatus` state machine.

**Create (all under `src/features/intake/docusignSigning/`):**
- The advisor-facing dialog/panel: select the eligible completed form, review/edit signer name + email, show the egress explanation, confirm, show live status.

**Create (tests):**
- `src/platform/docusignSigning/*.test.ts` — adapter tests (mocked DocuSign HTTP), filing tests, egress tests.
- Extend/create `RequestsBoard`/`ClientRequestsTab`/`OnboardingTab` component tests covering the new action and status displays.

Nothing else. Do not touch `intake-page/`, any `backend/` file, or `src/platform/intake/docusignSignature/` (Lane 1's contract — import from it, never edit it).

## Egress receipt

Build a small, self-contained local record (do **not** wire into the global `AuditActionType`/`AuditService` in `src/platform/types/audit.ts` — that file is shared with unrelated in-flight work and is out of this lane's territory; a self-contained record inside `src/platform/docusignSigning/` satisfies the prep's "durable receipt" requirement without touching shared audit plumbing). Before any DocuSign document send, record: destination class + host (`docusign.net` / the demo host), operation, document/signer data categories being sent, client scope (which request/item), user confirmation (the advisor's explicit click), timestamp, and whether the action was blocked (Local-only) or allowed. Persist this alongside/inside the `LocalSignatureRecord` (e.g. as its first `SignatureEvent`, or a dedicated field — your call, document it). A Local-only block must write a "blocked" receipt and make zero DocuSign calls; test this by spying the fetch mock and asserting it was never invoked in that case.

## Deliverables

1. `intakeSignaturesFolder` + filing extension in `intakeFiling.ts`.
2. Encrypted-local `LocalSignatureRecord` persistence.
3. Desktop DocuSign adapter (JWT exchange, envelope create, recipient-view create, poll, retrieve) — direct `fetch`, no new Rust/Tauri command.
4. Launch-relay push client.
5. Egress receipt module + Local-only enforcement before every DocuSign call.
6. Advisor UI: send dialog + status display wired into `RequestsBoard`/`ClientRequestsTab`/`OnboardingTab`.
7. Full retrieval → verify → encrypt → file pipeline, idempotent against duplicate completion events, retryable on failure, never silently dropping a declined/voided/failed case.

## Acceptance tests (full list)

- Adapter: account-specific base URI use, short in-memory-only token lifetime (assert it's never in a variable that survives past use/expiry in a way a snapshot/serialization test could catch), exact envelope document hash matches the source PDF bytes, recipient `clientUserId` is stable and local, tabs come from the reviewed `tab_map` only, one-time recipient-view generation, status polling with backoff, launch state cleared on completion/expiry.
- Filing: signed PDF + certificate filed together under the correct request's `signatures/` folder; original W8 PDF under `forms/` untouched; duplicate completion events are idempotent (no double-file); a transient DocuSign failure during retrieval is retryable; a failed local write leaves status `completion_pending`/unresolved, never `signed`; an active onboarding request for the same `matterId` stays completely isolated from a standing `pdf_fill`+signature request's filing.
- Eligibility gating: every `assertSignatureEligible` rejection case (from Lane 1's tests) is proven to block **before any network call** here too (spy the fetch mock).
- Egress: recorded traffic shows the readable PDF and signer details go directly to DocuSign only, never to any Lantern-operated host; a Local-only block makes zero DocuSign calls and records a blocked receipt.
- UI: `RequestsBoard`/`ClientRequestsTab` render the new statuses correctly for each `SignatureStatus`; the send dialog is disabled/hidden when no eligible completed form exists.

## Self-converge requirement

Same discipline as every other lane: run the full acceptance list, fix every failure, rerun until green (skips only where you are genuinely blocked on Lane 3/4 exports that don't exist yet — name the exact missing export in a `// TODO(w9-gate): ...` comment, matching Lane 1's `docusignSignatureContract.test.ts` skip style). Make the most conservative choice on any undecided design point and document it.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout)

```
timeout 300 npx vitest run src/platform/docusignSigning src/features/intake/docusignSigning src/platform/intake/intakeFiling.test.ts src/platform/intake/intakeStore.test.ts
timeout 300 npx vitest run src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo — this lane makes no Rust changes.

## Finish

Commit on `lp/intake-w9-advisor` with a conventional message containing `W9-LANE2-ADVISOR`. Do NOT push. Do NOT merge. Report exact check results, every new export other lanes might need, every skipped test with its exact missing dependency, and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
