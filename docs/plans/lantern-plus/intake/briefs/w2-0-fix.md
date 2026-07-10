# CODEX FIX BRIEF — Lantern Intake Wave 2, Lane 0 fix round (batched)

You are a Codex fix agent in worktree /home/jameson/lp-w2-0 (branch lp/intake-w2-0). Your previous build (commit 4a4729c2) added the onboarding contract + live inbox sync. Two independent reviews (the lead + an adversarial codex-review) found real cross-lane contract breaks — the live sync does NOT match the real relay/client contract, and it can silently drop or corrupt client data. Fix ALL of the following in ONE pass, TDD, then commit on this branch. Do NOT push.

For THIS fix round you MAY edit the normally-off-limits files listed per item (Lane A contract + Lane C client page) — the fixes legitimately require them, and no other lane is touching them right now. There are ZERO deployed intake submissions (pre-launch), so wire/format changes are atomic — no migration needed, just update both sides together.

## Read first (ground the real contracts)
- `backend/src/routes/intake.ts`: `handleIntakeInbox` (returns `submissions` with a `blobs: {blob_id,index,size}[]` array, NOT inline chunk ciphertext), `handleGetIntakeBlob` (`GET /intake/:id/blob/:blob_id` → raw `application/octet-stream` ciphertext), `parseCursor` (reads the `cursor` query param), `submissionEnvelope` (the exact envelope shape).
- `intake-page/src/submission.ts`: how the client seals answers — typed_field bodies are `{item_id,item_type,subject,value,display_value}`; guided_question bodies are `{item_id,item_type,subject,answer}` (NOTE: `answer`, not `value`); `fileToChunks` tags each chunk with `fileIndex`/`filePart`; a multi-file `doc_upload` currently flattens ALL files into ONE submission.
- `src/platform/intake/IntakeSyncClient.ts`: `IntakeInboxSubmission` (expects `chunks: ChunkUpload[]`), `RoutedIntakeSubmission`, `decryptAndVerify`.
- `src/platform/intake/intakeContract.ts`: `ChunkUpload` (`intake_id,item_id,submission_id,index,ciphertext_b64`), `SealedManifest`.
- `src/platform/intake/factsStore.ts` (`intakeFactUpsert`), `types.ts` (`FactKind`, `FactValue`, `FACT_KIND_SENSITIVITY`, `GuidedQuestionResponseFormat`).

## Fixes (do ALL)

### [P1-A] `fetchInbox` must fetch blobs and assemble chunks — `src/platform/intake/IntakeRelayClient.ts`
The relay inbox returns each submission with `blobs: {blob_id,index,size}[]` (+ `manifest_ciphertext_b64`, `wrapped_content_key_b64`, `item_id`, `submission_id`, `submitted_at`, `session_id?`, `cursor`) — it does NOT include chunk ciphertext inline. Current `fetchInbox` casts the response straight to `IntakeInboxSubmission[]`, so `submission.chunks` is undefined and `decryptAndVerify` throws → nothing ever files. Fix: for each submission, for each blob, `GET /intake/:id/blob/:blob_id` (raw bytes — use `getCorsSafeFetch` directly and read `arrayBuffer()`, then base64-encode; the JSON `request<T>` helper won't work for binary), and build `chunks: ChunkUpload[]` = `{intake_id, item_id, submission_id, index: blob.index, ciphertext_b64}` sorted by index. Return a well-formed `IntakeInboxPage`. Keep the seat/access-token auth headers on the blob GET (reuse the request auth). Add a test with a mock fetch that returns the blob envelope + blob bytes and asserts the assembled `chunks` are correct.

### [P1-B] Never drop/ack a fact — handle guided `answer` bodies — `src/platform/intake/useIntakeInboxSync.ts`
`routeJsonSubmission` only reads `body.value`, so guided questions (the standard-template Income and Spending items send `{...,answer}`) return `{}`, yet the item is still marked `received` and the submission is acked → the client's answer is deleted from the relay, stored nowhere. Fix: handle BOTH shapes — typed (`value`) and guided (`answer`). Map the value to a `FactValue` by the item's response_format / fact-kind: money→`{t:'money'}`, range→`{t:'range'}`, number→money/number, text/choice→`{t:'string'}`; map item_id→FactKind (income→income_annual, spending→spending_monthly, plus the existing dob/ssn/kind matches). If a JSON/typed submission carries a real answer but you CANNOT store it as a fact (unknown kind/format), do NOT mark it cleanly received and do NOT let it ack silently — throw from `routeSubmission` (ack-last then re-delivers; no silent deletion) OR flag it `needs_followup` + an intake flag. Losing a decrypted client value is the worst outcome — prevent it. Test both body shapes end-to-end (fact stored, correct FactValue, item received) + the unstorable case (not acked / flagged, value not lost).

### [P1-C] Multi-file uploads must not be concatenated/lost
Root cause: `SealedManifest` has `file_names[]` + a flat `chunk_count` but NO per-file boundary, so a multi-file submission's decrypted bytes can't be split. `routeFileSubmission` uses `file_names[0]` and `concatBytes(ALL chunks)` → the 2nd file is lost and the 1st is corrupt (two files concatenated). The driver's-license front/back item hits this. **Robust fix (client-side, no wire/crypto change): a `doc_upload` item submits ONE file per submission** — in `intake-page/src/submission.ts` / the submit call site (`intake-page/src/App.tsx`), when a doc-upload has multiple files, send each file as its own `submitAnswer` (its own submission_id, `file_names:[oneName]`, its own chunk set). Keep resume/replace working (replacing re-submits the file set). Then each relay submission has exactly one file and the advisor path files it cleanly. **Also add a defensive guard in `routeFileSubmission`:** if `file_names.length > 1` ever appears, do NOT concat — flag the submission (`needs_followup` + intake flag) and do not ack (throw), so no corruption/loss. Keep the existing intake-page Playwright/axe suite green (`npm --prefix intake-page test` or the repo's page test script) and the backend `bun test` E2E green.

### [P2-D] Inbox cursor query param — `src/platform/intake/IntakeRelayClient.ts`
`fetchInbox` sends `?since=<n>`; the relay reads `?cursor=`. Change the query param to `cursor=<sinceCursor>` so the stored `lastCursor` actually advances the server query. Fix the `IntakeRelayClient.test.ts` assertion that currently checks `since=`.

### [P2-E] Emit `regenerate_available` — `src/platform/intake/onboardingModel.ts`
`deriveLinkSignals` declares `regenerate_available` but never emits it, so Lane 2 can't surface it. Emit a `regenerate_available` signal (severity `info`, dismissible false) when the link is `expired` or `revoked` AND the intake has at least one received item (`items` in state received/accepted, or `receivedItems.length>0`) — regenerating keeps received items and kills the old link. Add it alongside the primary link signal. Test it.

### [ADD] Cross-lane contract test — `src/platform/intake/__tests__/inboxSyncContract.test.ts`
Lock the client→relay→advisor contract at the foundation (this class of bug is why Wave 1 shipped two contract breaks). One test that:
- builds the TWO real client JSON body shapes EXACTLY as `intake-page/src/submission.ts` does (typed `value` for dob+ssn; guided `answer` for income+spending) and a single-file `doc_upload` body,
- drives them through a mock relay that returns the real envelope shape (`blobs[]` + a blob endpoint) → `IntakeRelayClient.fetchInbox` → `IntakeSyncClient`/`routeIntakeSubmission`,
- asserts: dob/ssn/income/spending facts are stored with correct `FactValue`; the file lands via the workspace; `lastClientActivityAt` is stamped; item states advance to `received`; nothing is acked when a value can't be stored.
Add a comment that the two body shapes MUST stay in sync with `intake-page/src/submission.ts`.

## Constraints & done bar
- No silent data loss anywhere — a decrypted client value/file is either stored+filed+acked, or flagged+NOT acked. Never acked-and-dropped.
- Never rename matter/matter_id. Light theme. User copy client/household. No em dashes, no time estimates. Pure model fns take `now` as an arg.
- TDD, real assertions. Strict TS, `@/` alias.
- Before done, GREEN: `npx vitest run src/platform/intake`; `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`; the intake-page page test suite; and `cd backend && bun test` (the standing E2E/privacy-proof must stay green). Commit on this branch with a clear message. Do NOT push.
