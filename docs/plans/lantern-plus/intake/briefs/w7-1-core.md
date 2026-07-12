# Wave 7 Lane 1 — Core Request Model and Safe Routing

**Branch:** `lp/intake-w7-core`, branched off `origin/lp/intake` at the merged Waves-1-6 tip (`71bee41c` at time of writing — confirm the exact base commit with the dispatcher before starting, do not assume a stale SHA from this document).
**You are Codex, the builder.** Build the lane, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Goal (one paragraph)

Today Lantern's intake system supports exactly one active onboarding request per client, and its receiving code trusts several fields (`fact_kind`, `subject`, `response_format`, MIME type) straight out of decrypted client JSON — a triple-confirmed P1 finding (egress audit + foundation security sweep + cross-wave review all independently caught it: `useIntakeInboxSync.ts` lets a link holder submit under a valid item but claim any `fact_kind`/`subject`, and the advisor writes it). You're fixing that AND making the local model support **many requests per client** in the same piece of work, because the fix and the generalization are the same mechanism: `IntakeRecord` already has an optional `requestItems: RequestItem[]` field (`intakeStore.ts:83`, "the advisor-side copy of the sealed checklist") that today is only used for phone walkthroughs and is populated inconsistently. You're making it the **one receiver-owned contract** — reliably populated for every request (onboarding and standing), reconstructed for legacy records that predate it, and the *only* thing the receiver consults to decide what a submission means. Client JSON supplies the answer bytes; it supplies nothing else that matters. Existing onboarding behavior — its item ids, its folder, its routing outcome, its tests — must not change by one byte. This lane is the foundation every other Wave 7 lane builds on.

## Non-negotiables (a reviewer will check these)

- `matter_id` is never renamed and is never sent to the relay in clear. It already isn't (verified in the current code) — add a regression test, don't "fix" something that isn't broken.
- **The receiver never reads `fact_kind`, `subject`, `response_format`, or submission class from the decrypted client JSON body to decide behavior — ever, for any request, onboarding or standing.** It resolves the matching item from `IntakeRecord.requestItems` by `item_id` and derives every one of those fields from that item's own fields (`item.fact_kind`, `item.subject`, `item.response_format`, `item.t`). This is the P1-1 fix and it applies universally, not just to new standing items.
- If the client body *also* includes a `fact_kind`/`subject`/`response_format` that disagrees with what the contract says for that item, that's not a soft mismatch to shrug off — flag it `integrity_mismatch`, write no fact, leave it unacked. A legitimate client never has a reason to send these fields at all once the receiver ignores them for routing; a client that sends a *conflicting* value is either a bug or an attack, and either way the advisor should see it, not have it silently absorbed.
- Legacy onboarding records and their routing behavior are unchanged in outcome. A pre-existing persisted record with no `kind` field becomes `kind: 'onboarding'`, `requestSlug: 'onboarding'`, and a reconstructed `requestItems` on migration, and every existing test that currently passes for onboarding keeps passing.
- Standing-request relay item handles are opaque, code-generated values. They must never be a blueprint id, catalog id, or anything derived from the item's label or fact kind. Because `item.fact_kind`/`item.subject`/`item.label` already live directly on the `RequestItem` object (not derived from `item_id`), giving `item_id` a random value costs nothing — the item still carries its own meaning locally.
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
- `src/platform/intake/phoneWalkthrough.ts` (only if you need to share a helper with the router — see deliverable 6; do not change its existing exported behavior)
- `intake-page/src/App.tsx`

**Create:**
- Any new files under `src/platform/intake/` needed for slug generation / opaque handle generation (e.g. `requestSlug.ts`, `opaqueItemHandle.ts` — your naming call).
- `src/platform/intake/intakeStore.test.ts` (extend, it already exists).
- `src/platform/intake/requestFiling.test.ts` (new).
- `src/platform/intake/useIntakeInboxSync.test.ts` (extend, it already exists).
- `src/platform/intake/__tests__/standingRequestContract.test.ts` (new — see §Cross-lane baseline below).

Nothing else. `src/features/intake/newHouseholdTemplate.ts`, blueprint files, and all Requests-board/tab UI belong to Lanes 2 and 3 — don't touch them even if it would be convenient.

## The shared contract (revised from `W7-PREP.md` §2 — read this even if you read that doc, it changed)

`W7-PREP.md` originally specced a brand-new parallel `RequestItemDescriptor[]` structure. **Don't build that.** Grounding against the actual merged code found `IntakeRecord.requestItems` already exists, already stores the real sealed `RequestItem[]`, and each `RequestItem` already carries `subject` (on `RequestItemBase`) plus a type-specific fact mapping (`TypedFieldRequestItem.fact_kind` today; you're adding the equivalent to `GuidedQuestionRequestItem`). A second parallel structure would just be a second copy of the same data with a drift risk. Use what's there.

```ts
// src/platform/intake/intakeStore.ts — extend, don't replace
interface IntakeRecord {
  intakeId: string;
  matterId: string;
  kind: FormRequestKind;          // NEW: 'onboarding' | 'standing'
  blueprintRef?: string;          // NEW
  requestTitle: string;           // NEW
  requestSlug: string;            // NEW
  requestItems: RequestItem[];    // WIDEN from optional to reliably-populated — see deliverable 1
  // Existing status, lifecycle, items, receivedItems, flags, cursors, and link data remain unchanged.
}
```

```ts
// src/platform/intake/types.ts — one additive field
export interface GuidedQuestionRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'guided_question';
  prompt: string;
  response_format: GuidedQuestionResponseFormat;
  choices?: Array<{ value: string; label: string }>;
  fact_kind?: FactKind;   // NEW, additive — lets a guided item participate in receiver-owned routing and (Lane 2) ask-once matching
}
```

`RequestItemBase.item_id` is the field that becomes the opaque relay handle for a new standing item — see deliverable 6. Everything else the receiver needs (`fact_kind`, `subject`, `response_format`, `t`, and for `doc_upload` items `accepted_mime_types`/`max_files`/`max_bytes`) already lives directly on the item, keyed off nothing but the item object itself. Lanes 2 and 3 build against `IntakeRecord.requestItems` and this additive `GuidedQuestionRequestItem.fact_kind` field — not against any descriptor type, because there isn't one.

## Deliverables

1. **Extend `IntakeRecord`** in `intakeStore.ts` with `kind`, `requestTitle`, `requestSlug`. Widen `requestItems` from `RequestItem[] | undefined` to always being populated for every record your issuer creates going forward (deliverable 5) and for every legacy record after migration (deliverable 2) — keep the TS type optional if that's less churn for existing callers like `PhoneWalkthrough.tsx`, but treat "no `requestItems`" as an integrity-flagged state at the routing layer, never a silent fallback. Persist no answer values and no link secret (the existing `partializeIntakeStateForPersistence` already strips secrets — keep doing that; `requestItems`/`kind`/`requestTitle`/`requestSlug` are non-value metadata, fine to persist, same tier as the existing `items`/`receivedItems` arrays).

2. **Write a real version-3 migration**, not a number bump. `migratePersistedIntakeState` (`intakeStore.ts:162-167`) currently ignores `_version` and only sanitizes secrets — replace/extend it so a version-2 persisted blob is explicitly upgraded: backfill `kind: 'onboarding'`, `requestSlug: 'onboarding'`, and — the important part — reconstruct `requestItems` for any record that doesn't already have it. Do this by matching each legacy `items[].itemId` against `defaultNewHouseholdItems()` (`newHouseholdTemplate.ts`) by `item_id`; virtually every existing onboarding record used exactly that item set, so this is a real, not a guessed, reconstruction. **Do not reuse `PhoneWalkthrough.tsx`'s `fallbackItems()` helper for this** — it's a loose UI-display convenience that defaults an unmatched item to `fact_kind: 'address'`, which is fine for a phone-call display aid and completely wrong as a security-routing fallback. If a legacy item doesn't match any known template item, **integrity-flag that record, don't invent a mapping** for it (add a flag value for this if the existing `IntakeFlag.kind` union doesn't already fit — `integrity_mismatch` may already cover it). Bump `version: 2` → `3` in the `persist` config (`intakeStore.ts:322`) as part of the same change, not before it.

   Write the migration test against a **real version-2 fixture** — literally construct (or capture) a JSON blob shaped like what a pre-Wave-7 install would have in `localStorage`, run it through the migration, and assert the result, including that reconstructed items carry the correct `fact_kind`/`subject` (not just that the record didn't crash).

3. **Multi-request selectors.** `getIntakeForMatter` (`intakeStore.ts:197-198`) currently does a linear scan returning the first match — that's the "arbitrary first match" behavior called out in the findings doc. Add `getIntakesForMatter(matterId): IntakeRecord[]` returning all matching records in a stable order (e.g. sorted by creation/lastActivity, your call — document it). Keep `getIntakeForMatter` as a compatibility wrapper that filters to `kind === 'onboarding'` and returns that one record.

4. **Generic row derivation.** `onboardingModel.ts`'s `OnboardingRow.kind` (`onboardingModel.ts:41-58`) is hardcoded to the literal `'onboarding'`, not `FormRequestKind`. Widen the row type (or add a generic sibling type — your call, but Lane 3 needs ONE clear generic row export) so `kind` can be `'standing'` too, and export a generic `deriveRequestRow(intake, now, cfg)`. `deriveLinkSignals`, `deriveNudgeEligibility`, and `sortOnboardingRows` already take an `IntakeRecord` directly — reuse them as-is, don't reimplement. Keep `deriveOnboardingRow` as a thin wrapper filtered/asserted to `kind === 'onboarding'` so existing callers and tests don't move.

5. **Generalize `createAdvisorIntake`.** `createIntake.ts:31-63` becomes request-neutral (accepts `kind`, `requestTitle`, blueprint-produced items, etc.) while the existing exported function/signature remains as a compatibility wrapper for the New Client flow (which already populates `requestItems` today via `NewClientDialog.tsx:323` — make sure your generalized issuer keeps doing this for every caller, not just that one). Add `assertSendableRequest(items: RequestItem[])` in this file, called before key storage or relay creation on **every** path through the issuer — reject if any item has `t === 'pdf_fill'` or `t === 'signature'`. This must be enforced at the issuer, not only trusted from a caller like Lane 2's dialog.

   **Add the recovery rule.** Today secrets are stored locally *before* the relay call (`createIntake.ts:47-61`), with no cleanup if the relay call throws afterward. Add: write a durable **local pending record** before the relay call; on success, finalize it into the real `IntakeRecord`; on failure, revoke the just-created remote intake if reachable and clean up the locally stored secret. The end state must never be "a link exists at the relay with no corresponding local record a user can see or revoke through the UI."

6. **Opaque relay item handles.** For a **new standing request**, generate a random opaque value (not derived from the item's label, blueprint id, or fact kind) and use it as `item_id` on every `RequestItem` sealed into that request's checklist. Because `fact_kind`/`subject`/`label`/`response_format` already live directly on the item object, this needs no separate mapping table — the item sealed with the opaque `item_id` still carries everything the receiver needs. **Legacy onboarding items keep their existing semantic `item_id`** — do not touch onboarding's wire shape. If you find yourself wanting a shared `factKindForItem(item: RequestItem): FactKind | null` helper for both the phone-walkthrough path and the new router path, check `phoneWalkthrough.ts`'s existing `factKindForPhoneItem` first — it already implements exactly this resolution (typed_field → `item.fact_kind`; doc_upload → `drivers_license` special case; guided_question → currently hardcoded `income`/`spending` by `item_id`, which you should extend to prefer the new `item.fact_kind` field once you've added it, falling back to the `income`/`spending` id check only for pre-existing items that predate the field). Reuse or extend that one function rather than writing a second, possibly-divergent copy in `useIntakeInboxSync.ts`.

7. **Request-folder helper.** Add a helper in `intakeFiling.ts` alongside the existing `intakeOnboardingFolder` (`intakeFiling.ts:24-26`) that accepts only a locally generated, already-validated slug and returns `Requests/<slug>`. Mirror the delegation pattern already in this file (it doesn't do its own traversal check; `WorkspaceService`'s `pathValidator` does that downstream — keep relying on that). Keep `intakeOnboardingFolder`'s exact return value (`Requests/onboarding`) unchanged.

8. **Receiver-owned routing in `routeIntakeSubmission`.** This is the P1-1 fix. `useIntakeInboxSync.ts`'s `routeJsonSubmission` currently calls `factKindForSubmission(body, submission)` (`:99-110`, reads `body.fact_kind` then `body.item_id`), `responseFormatForSubmission(body, kind)` (`:124-133`, reads `body.response_format`), and inlines `subject` from `body.subject` (`:301-303`). Replace this resolution entirely:

   - Look up `options.intake.requestItems?.find(i => i.item_id === submission.itemId)`. If `requestItems` is missing or no item matches, fail closed (`failNeedsFollowup`, integrity-flag `routing_failed` or `integrity_mismatch` as fits) — do **not** fall back to the old body-trusting logic. (After deliverable 2's migration, every record should have `requestItems`; if one doesn't, that's itself a signal something's wrong, not a cue to trust the client.)
   - Derive `kind` (fact_kind) from the matched item via the shared helper from deliverable 6 — never from `body.fact_kind`/`body.item_id`.
   - Derive `subject` from `item.subject` — never from `body.subject`.
   - Derive `response_format` from `item.response_format` (guided_question items only) — never from `body.response_format`.
   - Derive expected submission class from `item.t` (`typed_field`/`guided_question` → JSON; `doc_upload` → file; `readonly_card`/`pdf_fill`/`signature` → reject, these should never receive a submission at all).
   - For `doc_upload` items, derive MIME/file-count/size limits from `item.accepted_mime_types`/`item.max_files`/`item.max_bytes`.
   - **Mismatch detection:** if the decrypted body *also* contains a `fact_kind`, `subject`, or `response_format` field, and its value disagrees with what you just derived from the contract, treat this as `integrity_mismatch` — flag it, write no fact, leave unacked. Do not silently proceed using the (correct) contract-derived value while ignoring a conflicting client-supplied one; surface it.
   - Reject and integrity-flag (no ack) any of: JSON body for a file-class item, a file for a JSON-class item, an unknown `item_id` for that `intakeId`, a submission whose `intakeId` doesn't match the item's owning record (cross-request), a duplicate submission, a MIME type outside the item's `accepted_mime_types`, a file count/size over the item's limits.

   Because legacy onboarding items are also resolved via this same lookup (once migration backfills their `requestItems`), **onboarding gets the same fix for free** — verify this explicitly with a test that a legacy onboarding submission with a spoofed `fact_kind: 'ssn'` in the body is rejected/flagged rather than written.

9. **Email-reply attachment filing.** `emailReplyAccept.ts:72-74`'s `emailReplyAttachmentDestination` and `emailReplyQuarantineManualFile.ts` (which reuses it) both currently hard-code `Requests/onboarding/email-replies`. Change the destination to require the **matched target request's validated local slug**: `Requests/<request-slug>/email-replies/<safe-message-segment>`. No fallback to onboarding.

10. **Client-page fail-closed.** `intake-page/src/App.tsx`'s `ItemInputScreen` (around `:655-686`) falls through to a generic "not ready yet" screen **with a Skip button** for any unrecognized item type, including `pdf_fill`/`signature`. Change this so an actionable-but-unsupported item type shows the same short message but with **no Skip button and no way to advance past it as complete**. Belt-and-suspenders with `assertSendableRequest` (deliverable 5) — the issuer should never let one of these out the door, but the page must not trust that either.

## Cross-lane baseline test (this is YOUR gate deliverable, not Lane 4's)

`W7-PREP.md` assigns the full cross-lane acceptance matrix to Lane 4. Before you merge, prove the **core contract itself** works end-to-end with real crypto, so integration bugs are caught now, not after three more lanes build on top. Lane 4 will extend this same file with blueprint-based creation, board UI integration, and the full acceptance-case matrix — write it so that's easy.

Create `src/platform/intake/__tests__/standingRequestContract.test.ts`. Mirror the harness in `src/platform/intake/__tests__/inboxSyncContract.test.ts` **exactly**: real `intakeCrypto` sealing (`generateContentKey`, `generateIntakeKeypair`, `sealItemChunk`, `sealManifest`, `wrapContentKey`, etc.), a hand-built mock of `@/platform/providers/fetchUtils`' `getCorsSafeFetch` returning fixture HTTP responses, a real `IntakeRelayClient` and `IntakeSyncClient` driven through that mock, and a call into the real `routeIntakeSubmission`. Do **not** mock `IntakeRelayClient`/`IntakeSyncClient` themselves.

Minimum assertions:
- Build a standing `IntakeRecord` with your generalized `createAdvisorIntake` path using at least one JSON-answer item and one file-upload item, each with a generated opaque `item_id`, both present in `requestItems` with their real `fact_kind`/`subject`.
- Assert the actual HTTP body your mock fetch receives for the create call contains no `matter_id` and no semantic item id anywhere (grep the serialized body for the item's real `fact_kind`/`subject` strings and assert absence).
- Simulate a client completing both items (real sealed chunks/manifests, decrypted body carrying only `value`/`answer` — no `fact_kind`/`subject`) and route them through `IntakeSyncClient` → `routeIntakeSubmission`; assert the fact lands with the contract's `fact_kind`/`subject` and the file lands under `Requests/<slug>/`.
- Simulate a JSON-for-upload and a file-for-fact mismatch; assert both are rejected with no ack.
- Simulate a submission whose decrypted body includes a conflicting `fact_kind` (e.g. contract says `income_annual`, body claims `ssn`); assert it's rejected/flagged, not silently written under either kind.

## Acceptance tests (full list)

- `intakeStore.test.ts`: real version-2 fixture → version-3 migration with explicit `requestItems` reconstruction (assert reconstructed `fact_kind`/`subject`, not just presence); two standing requests on one `matterId` both returned by `getIntakesForMatter`; `getIntakeForMatter` compatibility wrapper still returns only the onboarding record.
- `requestFiling.test.ts` (new): exact onboarding path unchanged; distinct standing paths for two different slugs; slug generator produces filesystem-safe, stable-after-send values; traversal strings rejected.
- `useIntakeInboxSync.test.ts`: contract-derived fact mapping for a standing item; rejection of unknown `item_id`, wrong `intakeId`, a body-supplied `fact_kind`/`subject`/`response_format` that **conflicts** with the contract (new — this is the coordinator-mandated mismatch-rejection test), JSON-for-upload, file-for-fact, wrong MIME, too many files, oversized file; **a legacy onboarding item with a spoofed body `fact_kind` is rejected the same way** (proves the fix isn't standing-only); existing legacy-onboarding test cases untouched and still passing for the non-attack path.
- Opaque handle generation test: two calls never produce the same handle; a handle never contains/derives-from the item's label, fact kind, or blueprint id.
- `deriveRequestRow`/generic-selector test: standing and onboarding rows both derive correctly; `deriveOnboardingRow` wrapper behavior unchanged.
- `assertSendableRequest` test: rejects any item list containing `pdf_fill` or `signature`, from every path through the issuer.
- Client-page test: unsupported actionable item type shows no Skip button and cannot reach a completed state.
- Issuer recovery test: simulate the relay call throwing after local secret storage; assert no live untracked link remains.
- Email attachment filing test: normal and quarantined attachments land under the matched standing request's slug, not `Requests/onboarding/`.
- `standingRequestContract.test.ts` per §Cross-lane baseline above.
- Regression: existing `intakeStore.test.ts`, `useIntakeInboxSync.test.ts`, `inboxSyncContract.test.ts`, `phoneWalkthrough`-related tests, and `onboardingModel`-related tests all still pass with unchanged assertions about existing onboarding behavior.

## Self-converge requirement

Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything in this brief's test list passes. If you hit a design question not answered by this brief, make the most conservative choice (never trust client input; never widen onboarding's blast radius; fail closed) and document the choice in your final report.

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

Commit on `lp/intake-w7-core` with a conventional message containing the phrase `W7-LANE1-CORE-ROUTING`. Do NOT push. Do NOT merge. Report the exact check results (pass/fail, counts) in your final message, list every new/changed export Lanes 2/3 will need (exact names, exact file paths, and explicitly confirm `GuidedQuestionRequestItem.fact_kind` and `IntakeRecord.requestItems` reliability — they will build against exactly what you shipped), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check in this brief passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). The dispatcher watches for this exact anchored line to detect completion; do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
