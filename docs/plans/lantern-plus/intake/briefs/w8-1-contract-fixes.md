# Wave 8 Lane 1 — Fix Round (from adversarial codex-review)

**Branch:** `lp/intake-w8-contract` (same branch, new commit on top of `365dd3da`).
**You are Codex, the builder.** Fix these three findings, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

An independent adversarial review (`codex-review --base lp/intake-w7`) of your Lane 1 diff found three real issues. Fix all three.

## Finding 1 [P1] — PDF template descriptor leaks into plaintext persisted state

`createAdvisorIntake` (`src/platform/intake/createIntake.ts:99-114`) passes the full `requestItems` array — including, for a `pdf_fill` item, the entire `template` descriptor (`sourceSha256`, `sourceArtifactRef`, the field map with real `acroform_field` names and overlay coordinates) — into `store.upsertIntake(...)`. `useIntakeStore`'s persist config (`src/platform/intake/intakeStore.ts:398`, via `partializeIntakeStateForPersistence` at line 154) only strips `link`/`linkSecretB64`/`secret` before writing to `localStorage`. Everything else in `requestItems`, including the new sensitive template fields, gets written to disk in plaintext. This directly violates W8-PREP §3: "Keep them encrypted inside the sealed checklist, sealed resume state only where strictly needed, or encrypted advisor-local state. Do not put them in Zustand persistence, localStorage..."

**Fix it the same way this codebase already solves this exact problem for link secrets.** `intakeKeychain.ts` already has a working pattern: `storeIntakeSecrets`/`loadIntakePrivateKeyJwk`/`loadIntakeLinkSecret`/`clearIntakeSecrets` keep sensitive per-intake data in real OS-backed secure storage (not `localStorage`), and `intakeStore.ts`'s persist layer only ever sees the non-sensitive remainder. Extend that same pattern for PDF template descriptors:

1. Add a keychain-backed store/load/clear helper for PDF template descriptors in `intakeKeychain.ts`, keyed by `intakeId` (and `item_id` if a request can have more than one `pdf_fill` item — check `RequestItem[]` cardinality and handle plural correctly, don't assume exactly one).
2. In `createAdvisorIntake`, after building `requestItems`, store each `pdf_fill` item's full `template` descriptor through this new keychain helper, then build the `IntakeRecord.requestItems` value that goes into `store.upsertIntake` with those `pdf_fill` items' `template` field **redacted to a non-sensitive stub** — keep only what's needed for UI/ordering/typing (e.g. `templateId`, `version`, `kind` — no `sourceSha256`, no `sourceArtifactRef`, no `fields`). Every other item type (`typed_field`, `doc_upload`, etc.) is unaffected — this redaction is `pdf_fill`-specific.
3. The full descriptor must still be reconstructable for the **current in-memory session** — the checklist sealed into `createInitialIntakeLinkBundle` (line 90-95) already gets the real, unredacted `requestItems` before this redaction happens; keep that call exactly as-is, only the value handed to `store.upsertIntake` changes. Do not weaken what's sealed into the link bundle or sent to the relay — this fix is about local `localStorage`/Zustand persistence only, not the sealed checklist, which already stays off the relay wire.
4. A future Lane 4 (not built yet) will need to reconstruct the full descriptor from the keychain when it verifies a returned PDF against its template hash after an app restart. Add a `loadPdfTemplateDescriptor(intakeId, itemId)`-shaped export (naming your call, mirror the existing `loadIntakePrivateKeyJwk`/`loadIntakeLinkSecret` signature style) so that lane can wire it in later without redesigning this. Note the exact export name and signature in your final report so it can be referenced from the Lane 4 brief.
5. **Test:** serialize the actual persisted state (call `partializeIntakeStateForPersistence` or drive the real persist path, whichever your existing `intakeStore.test.ts`/`createIntake.test.ts` patterns use) after issuing a `pdf_fill` standing request, and assert the serialized JSON string does not contain the template's `sourceSha256`, `sourceArtifactRef`, or any `acroform_field`/overlay-coordinate value. Also assert the sealed checklist passed into `createInitialIntakeLinkBundle` still contains the full unredacted descriptor (regression: don't over-correct and weaken the sealed link bundle).

## Finding 2 [P2] — Duplicate AcroForm widget targets pass validation

`src/platform/intake/pdfTemplates/templateValidation.ts:198-203`: two different map keys/field IDs can both set `acroform_field` to the same underlying PDF widget name. When a client fills such a form, both answers compete for the one widget and the last write silently wins — a reviewed request can produce a wrong completed form with no error anywhere.

**Fix:** track seen `acroform_field` values while validating an `acroform`-kind descriptor's fields and throw if any value repeats (a `PdfTemplateValidationError`, consistent with how you already reject duplicate map-key/field-id pairs nearby). Do not flag this for `overlay`-kind descriptors, which have no `acroform_field` concept. **Test:** add a case to `templateValidation.test.ts` with two distinct field entries mapped to the same `acroform_field` string and assert it throws.

## Finding 3 [P2] — `maxOutputBytes` isn't enforced when verifying completed bytes

`src/platform/intake/pdfTemplates/receipt.ts:27-33`: the byte-length cap (`descriptor.maxOutputBytes`) is checked only when the advisor approves a template. Your completion-verification helper (`verifyCompletedBytesAgainstReceipt` or whatever you named it) accepts any byte length as long as the hash matches the receipt. A public-link holder could submit an oversized encrypted PDF; without this check, review of the design shows the inbox path would fetch and decrypt every chunk before any later stage could reject it.

**Fix:** in the completion-verification helper, check `bytes.byteLength` (or your fixture's equivalent) against `descriptor.maxOutputBytes` and throw/fail before (or alongside) the hash comparison — fail fast, don't do the hash work first if the size is already over. **Test:** add a case in the receipt test file with bytes longer than `descriptor.maxOutputBytes` and assert it's rejected, with a clear message distinguishable from a hash-mismatch failure (so a caller can tell which check failed).

## Checks to run (same as the original brief; report exact pass/fail)

```
timeout 300 npx vitest run src/platform/intake/pdfTemplates src/platform/intake/blueprintValidation.test.ts src/platform/intake/createIntake.test.ts src/platform/intake/intakeStore.test.ts src/platform/intake/__tests__/pdfFillContract.test.ts src/platform/intake/__tests__/standingRequestContract.test.ts src/platform/intake/__tests__/inboxSyncContract.test.ts
timeout 300 npx vitest run src/platform/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo — this lane makes no Rust changes.

## Finish

Commit on `lp/intake-w8-contract` with a conventional message containing the phrase `W8-LANE1-CONTRACT-FIXES`. Do NOT push. Do NOT merge. In your final report: confirm all three findings are fixed with the exact new/changed export names (especially the new `intakeKeychain.ts` helpers Lane 4 will need), confirm the sealed link-bundle checklist still carries the full unredacted descriptor (regression check), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
