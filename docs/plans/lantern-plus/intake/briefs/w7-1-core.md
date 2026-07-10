# Wave 7 Lane 1 — Core Request Model and Safe Routing

**Branch:** `lp/intake-w7-core` (branch this off the current tip of the wave's integration branch — confirm the exact base commit with the dispatcher before starting; do not assume a stale SHA from this document).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Today Lantern's intake system supports exactly one active onboarding request per client, and its receiving code trusts several fields (`fact_kind`, `subject`, `response_format`, MIME type) straight out of decrypted client JSON. You're making the local model support **many requests per client** — a durable local `IntakeRecord` per request, each with its own generated slug, its own non-value item descriptors, and (for new standing requests only) opaque relay-visible item handles instead of semantic ones like `'ssn'`. You're also closing the trust gap: every field the receiver uses to decide what a submission means must come from a descriptor **you** wrote when the request was created, never from the client's decrypted payload. Existing onboarding behavior — its item ids, its folder, its routing, its tests — must not change by one byte. This lane is the foundation every other Wave 7 lane builds on; get the contract right and don't let anything past it that a hostile or buggy client submission could exploit.

## Non-negotiables (a reviewer will check these)

- `matter_id` is never renamed and is never sent to the relay in clear. It already isn't (verified in the current code) — add a regression test, don't "fix" something that isn't broken.
- The receiving code, not client-submitted JSON, chooses `matter_id`, `requestId`, logical item ID, submission class, guided format, subject, fact kind, MIME policy, file limits, and destination folder for any **standing** request. A submission for an unknown, wrong-class, or policy-breaking item is integrity-flagged and left unacked — never guessed into place.
- Legacy onboarding records and their routing behavior are unchanged. A pre-existing persisted record with no `kind` field becomes `kind: 'onboarding'`, `requestSlug: 'onboarding'` on migration, and its existing item ids keep routing exactly as they do today via the existing alias table.
- Standing-request relay item handles are opaque, code-generated values (e.g. a random hex/base62 string). They must never be a blueprint id, catalog id, or anything derived from the item's label or fact kind. The mapping from handle to meaning lives only in the local descriptor.
- Files from a standing request go to `Requests/<request-slug>/`. Existing onboarding stays exactly `Requests/onboarding/`. Slugs are generated and validated by code, never taken from a client submission or a blueprint label.
- No plaintext answer, file name, fact value, blueprint name, or request title becomes relay-visible metadata, a relay database column, or a relay URL/header. That's already true of the current wire shape — do not add a new field that breaks it.

## Files you own (do not touch anything outside this list without stopping and asking)

**Edit:**
- `src/platform/intake/types.ts`
- `src/platform/intake/intakeStore.ts`
- `src/platform/intake/createIntake.ts`
- `src/platform/intake/intakeFiling.ts`
- `src/platform/intake/useIntakeInboxSync.ts`
- `src/platform/intake/emailReplyAccept.ts`
- `src/platform/intake/emailReplyQuarantineManualFile.ts`
- `src/platform/intake/onboardingModel.ts`
- `intake-page/src/App.tsx`

**Create:**
- Any new files under `src/platform/intake/` needed for the descriptor/handle/slug machinery (e.g. `requestDescriptors.ts`, `requestSlug.ts`, `opaqueItemHandle.ts` — name them sensibly; there's no fixed list, this is your call).
- `src/platform/intake/intakeStore.test.ts` (extend, it already exists).
- `src/platform/intake/requestFiling.test.ts` (new).
- `src/platform/intake/useIntakeInboxSync.test.ts` (extend, it already exists).
- `src/platform/intake/__tests__/standingRequestContract.test.ts` (new — see §Cross-lane baseline below).

Nothing else. `src/features/intake/newHouseholdTemplate.ts`, blueprint files, and all Requests-board/tab UI belong to Lanes 2 and 3 — don't touch them even if it would be convenient.

## The shared contract (verbatim from `W7-PREP.md` §2, corrected)

This is what you're building. Lanes 2 and 3 depend on these exports existing with these semantics — do not narrow or rename them without documenting the change in your final report, since Codex builds for Lanes 2/3 will be written against what you actually shipped.

```ts
// Existing relay id remains intakeId. This is local non-sensitive request metadata.
interface IntakeRecord {
  intakeId: string;
  matterId: string;
  kind: FormRequestKind;         // 'onboarding' | 'standing'
  blueprintRef?: string;
  requestTitle: string;
  requestSlug: string;
  itemDescriptors: RequestItemDescriptor[];
  // Existing status, lifecycle, items, receivedItems, flags, cursors, and link data remain unchanged.
}

interface RequestItemDescriptor {
  /** Local logical item id. Never trust it from a client submission. */
  itemId: string;
  /** Relay-visible handle. For standing requests this IS the sealed checklist item_id — opaque, code-generated. For legacy onboarding it's the existing semantic id (e.g. 'ssn'); do not change onboarding's handle behavior. */
  relayItemHandle: string;
  type: RequestItem['t'];
  /** The only submission shape this item may produce. */
  expectedSubmissionClass: 'json_fact' | 'file_upload' | 'none';
  /** Receiver-owned guided answer format, when this is a guided fact. Constrain to 'money' | 'range' for new standing items (Lane 2 enforces this at blueprint-validation time; you just need the type to allow it). */
  guidedResponseFormat?: GuidedQuestionResponseFormat;
  /** Receiver-owned fact mapping. Omitted for files and non-answer cards. */
  factMapping?: { subject: string; factKind: FactKind };
  /** Receiver-owned upload policy. Present only for file uploads. */
  allowedMimeTypes?: string[];
  maxFiles?: number;
  maxBytes?: number;
  label: string;
  required: boolean;
}
```

`intakeFactMatchList` and `RequestBlueprint` belong to Lane 2 — you don't build them, but note that Lane 2's `factMapping` values on descriptors are what makes ask-once possible, so make sure `RequestItemDescriptor.factMapping` round-trips cleanly through your persistence layer.

## Deliverables

1. **Extend `IntakeRecord`** in `intakeStore.ts` with `kind`, `requestTitle`, `requestSlug`, `blueprintRef?`, `itemDescriptors`. Persist no answer values and no link secret (the existing `partializeIntakeStateForPersistence` already strips secrets — keep doing that for the new fields too; descriptors are non-value metadata so they're fine to persist).

2. **Write a real version-3 migration**, not a number bump. `migratePersistedIntakeState` (`intakeStore.ts:162-167`) currently ignores `_version` — replace/extend it so a version-2 persisted blob is explicitly upgraded: backfill `kind: 'onboarding'`, `requestSlug: 'onboarding'`, and reconstruct `itemDescriptors` from each legacy record's existing local `items` array using the existing alias table's inverse (income→`income_annual`, spending→`spending_monthly`, license→`drivers_license`, everything else 1:1 by item id since legacy onboarding ids are already semantic and equal to `relayItemHandle`). If a legacy row can't be reconstructed safely (missing/malformed items), **integrity-flag it, don't invent a mapping** — add a flag value for this if one doesn't already fit. Bump `version: 2` → `3` in the `persist` config (`intakeStore.ts:322`) as part of the same change, not before it.

   Write the migration test against a **real version-2 fixture** — literally construct (or capture) a JSON blob shaped like what a pre-Wave-7 install would have in `localStorage`, run it through the migration, and assert the result.

3. **Multi-request selectors.** `getIntakeForMatter` (`intakeStore.ts:197-198`) currently does a linear scan returning the first match — that's the "arbitrary first match" behavior called out in the findings doc. Add `getIntakesForMatter(matterId): IntakeRecord[]` returning all matching records in a stable order (e.g. sorted by creation/lastActivity, your call — document it). Keep `getIntakeForMatter` as a compatibility wrapper that filters to `kind === 'onboarding'` and returns that one record (existing callers assume "the" onboarding request; this preserves that assumption exactly while the multi-request selector is adopted elsewhere).

4. **Generic row derivation.** `onboardingModel.ts`'s `OnboardingRow.kind` (`onboardingModel.ts:41-58`) is hardcoded to the literal `'onboarding'`, not `FormRequestKind` — this is the actual generalization gap, not just a naming issue. Widen the row type (or add a generic sibling type — your call, but Lane 3 needs ONE clear generic row export to build the Requests board off of) so `kind` can be `'standing'` too, and export a generic `deriveRequestRow(intake, now, cfg)` that works for both kinds. `deriveLinkSignals`, `deriveNudgeEligibility`, and `sortOnboardingRows` (`onboardingModel.ts:108-186`, `188-250`, `292-300`) already take an `IntakeRecord` directly — reuse them as-is inside the generic derive function, don't reimplement their logic. Keep `deriveOnboardingRow` as a thin wrapper (`deriveRequestRow` filtered/asserted to `kind === 'onboarding'`) so existing callers and their tests don't move.

5. **Generalize `createAdvisorIntake`.** `createIntake.ts:31-63` becomes request-neutral (accepts `kind`, `requestTitle`, blueprint-produced items, etc.) while the existing exported function/signature remains as a compatibility wrapper for the New Client flow. Add `assertSendableRequest(items: RequestItem[])` in this file, called before key storage or relay creation on **every** path through the issuer — reject if any item has `t === 'pdf_fill'` or `t === 'signature'`. This must be enforced at the issuer, not only trusted from a caller like Lane 2's dialog (finding P1.6 — Lane 2's UI-level blocking is not a security boundary, this is).

   **Add the recovery rule.** Today (`createIntake.ts:47-61`) secrets are stored locally *before* the relay call, with no cleanup if the relay call throws afterward — that can leave a live untracked link with no local record. Add: write a durable **local pending record** before the relay call; on success, finalize it into the real `IntakeRecord`; on failure, call `revoke` on the just-created remote intake (if the relay call itself partially succeeded — check what state is reachable) and clean up the locally stored secret. The end state must never be "a link exists at the relay with no corresponding local record a user can see or revoke through the UI."

6. **Opaque relay item handles.** For a **new standing request**, when the local `RequestItemDescriptor`s are built, generate a random opaque `relayItemHandle` per item (not derived from the item's label, blueprint id, or fact kind) and use that handle as the `item_id` on the `RequestItem` that actually gets sealed into the checklist and sent to the relay. The descriptor keeps the mapping `relayItemHandle → { itemId, factMapping, guidedResponseFormat, ... }` locally. **Legacy onboarding items keep using their existing semantic id as both `itemId` and `relayItemHandle`** — do not touch onboarding's wire shape.

7. **Request-folder helper.** Add a helper in `intakeFiling.ts` alongside the existing `intakeOnboardingFolder` (`intakeFiling.ts:24-26`) that accepts only a locally generated, already-validated slug and returns `Requests/<slug>`. It must reject traversal characters, path separators, empty strings, and anything that didn't come from your own slug generator — mirror the delegation pattern already in this file (it doesn't do its own traversal check; `WorkspaceService`'s `pathValidator` does that downstream — keep relying on that, don't invent a second, possibly-inconsistent check). Keep `intakeOnboardingFolder`'s exact return value (`Requests/onboarding`) unchanged.

8. **Descriptor-based routing in `routeIntakeSubmission`.** `useIntakeInboxSync.ts`'s `routeJsonSubmission` (`:270-315`) currently derives `factKindForSubmission` (`:96-107`), `responseFormatForSubmission` (`:121-130`), and `subject` (`:298-300`) from the decrypted client body with fallback aliasing. Change the resolution order: **first** look up the local `IntakeRecord` by `submission.intakeId`, find the `RequestItemDescriptor` whose `relayItemHandle` matches `submission.itemId`. If a descriptor exists, derive `expectedSubmissionClass`, `guidedResponseFormat`, `factMapping` (subject + factKind), MIME policy, file count, and size **only** from that descriptor — never read `fact_kind`/`subject`/`response_format` out of the client JSON body at all for a descriptor-routed item. If no descriptor exists for that handle (this is the legacy-onboarding path, since old records may not have full descriptor coverage from the migration), fall back to exactly today's alias-table behavior — do not change onboarding's routing.

   Reject and integrity-flag (no ack) any of: JSON body for a `file_upload`-class item, a file for a `json_fact`-class item, an unknown `relayItemHandle` for that `intakeId`, a submission whose `intakeId` doesn't match the item's owning record (cross-request), a duplicate submission, a MIME type outside the descriptor's `allowedMimeTypes`, and a file count/size over the descriptor's limits.

9. **Email-reply attachment filing.** `emailReplyAccept.ts:72-74`'s `emailReplyAttachmentDestination` and `emailReplyQuarantineManualFile.ts` (which reuses it, `:13-15`/`:221`) both currently hard-code `Requests/onboarding/email-replies`. Change the destination to require the **matched target request's validated local slug**: `Requests/<request-slug>/email-replies/<safe-message-segment>`. There is no fallback to onboarding — if the matcher can't resolve which request an email belongs to, that's already a quarantine case upstream (Wave 3's matcher), not something this function should paper over.

10. **Client-page fail-closed.** `intake-page/src/App.tsx:655-686`'s `ItemInputScreen` falls through to a generic "not ready yet" screen **with a Skip button** for any unrecognized item type — including `pdf_fill` and `signature`. Change this so an actionable-but-unsupported item type (`pdf_fill`, `signature`) shows the same short "not available yet" message but with **no Skip button and no way to advance past it as complete**. It's fine for the client to be stuck and need to contact the advisor; it is not fine for the page to record a false completion. This is belt-and-suspenders with `assertSendableRequest` (deliverable 5) — the issuer should never let one of these items out the door in the first place, but the page must not trust that either.

## Cross-lane baseline test (this is YOUR gate deliverable, not Lane 4's)

`W7-PREP.md` assigns the full cross-lane acceptance matrix to Lane 4. Before you merge, prove the **core contract itself** works end-to-end with real crypto, so integration bugs in the fundamental round trip are caught now, not after three more lanes are built on top of a broken foundation. Lane 4 will later extend this same file with blueprint-based creation, board UI integration, and the full acceptance-case matrix — write it so that's easy, not so it needs a rewrite.

Create `src/platform/intake/__tests__/standingRequestContract.test.ts`. Mirror the harness in the existing `src/platform/intake/__tests__/inboxSyncContract.test.ts` **exactly**: real `intakeCrypto` sealing (`generateContentKey`, `generateIntakeKeypair`, `sealItemChunk`, `sealManifest`, `wrapContentKey`, etc.), a hand-built mock of `@/platform/providers/fetchUtils`' `getCorsSafeFetch` returning fixture HTTP responses, a real `IntakeRelayClient` and `IntakeSyncClient` driven through that mock, and a call into the real `routeIntakeSubmission`. Do **not** mock `IntakeRelayClient`/`IntakeSyncClient` themselves — that's the whole point of the contract test.

Minimum assertions:
- Build a standing `IntakeRecord` with your generalized `createAdvisorIntake` path (or its lower-level pieces if the full dialog doesn't exist yet — it doesn't, that's Lane 2) using at least one `json_fact` item and one `file_upload` item, each with a generated opaque `relayItemHandle`.
- Assert the actual HTTP body your mock fetch receives for the create call contains no `matter_id` and no semantic item id anywhere (grep the serialized body for the item's real `factMapping.subject`/`factKind` strings and assert absence).
- Simulate a client completing both items (real sealed chunks/manifests) and route them through `IntakeSyncClient` → `routeIntakeSubmission`; assert the fact lands with the right `factMapping` and the file lands under `Requests/<slug>/`.
- Simulate a JSON-for-upload and a file-for-fact mismatch against your descriptors; assert both are rejected with no ack.

## Acceptance tests (full list)

- `intakeStore.test.ts`: real version-2 fixture → version-3 migration with explicit descriptor reconstruction; two standing requests on one `matterId` both returned by `getIntakesForMatter`; `getIntakeForMatter` compatibility wrapper still returns only the onboarding record.
- `requestFiling.test.ts` (new): exact onboarding path unchanged; distinct standing paths for two different slugs; slug generator produces filesystem-safe, stable-after-send values; traversal strings rejected.
- `useIntakeInboxSync.test.ts`: descriptor-derived fact mapping for a standing item; rejection of unknown handle, wrong `intakeId`, body-supplied `fact_kind`/`subject`/`response_format` on a descriptor-routed item, JSON-for-upload, file-for-fact, wrong MIME, too many files, oversized file; existing legacy-onboarding test cases untouched and still passing.
- Opaque handle generation test: two calls never produce the same handle; a handle never contains/derives-from the item's label, fact kind, or blueprint id.
- `deriveRequestRow`/generic-selector test: standing and onboarding rows both derive correctly; `deriveOnboardingRow` wrapper behavior unchanged (existing tests for it stay green).
- `assertSendableRequest` test: rejects any item list containing `pdf_fill` or `signature`, called from every path through the issuer (not just one entry point).
- Client-page test: unsupported actionable item type shows no Skip button and cannot reach a completed state.
- Issuer recovery test: simulate the relay call throwing after local secret storage; assert no live untracked link remains (either the pending record surfaces as failed/revocable, or revoke was actually called — assert against your mock relay client's call log).
- Email attachment filing test: normal and quarantined attachments land under the matched standing request's slug, not `Requests/onboarding/`.
- `standingRequestContract.test.ts` per §Cross-lane baseline above.
- Regression: existing `intakeStore.test.ts`, `useIntakeInboxSync.test.ts`, `inboxSyncContract.test.ts`, and `onboardingModel`-related tests all still pass unmodified in behavior (you may need to touch these files to add cases, but do not change what they assert about existing onboarding behavior).

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes. If you hit a design question not answered by this brief or by `W7-PREP.md` §1–2, make the most conservative choice (never trust client input; never widen onboarding's blast radius; fail closed) and document the choice in your final report — don't block on it.

## Checks to run (report exact pass/fail for each; wrap every test invocation in a timeout so a hang doesn't burn the session)

```
timeout 300 npx vitest run src/platform/intake/intakeStore.test.ts src/platform/intake/requestFiling.test.ts src/platform/intake/useIntakeInboxSync.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
timeout 300 npm --prefix intake-page test
timeout 120 npm --prefix intake-page run typecheck
```

## Finish

Commit on `lp/intake-w7-core` with a conventional message containing the phrase `W7-LANE1-CORE-ROUTING`. Do NOT push. Do NOT merge. Report the exact check results (pass/fail, counts) in your final message, list every new export Lanes 2/3 will need to import (exact names, exact file paths — they will build against exactly what you wrote), and state the branch is clean. The dispatcher detects completion by your process exiting — just finish normally after committing.
