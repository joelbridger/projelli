# Wave 9 Lane 2 — Fix Round (typecheck failures found in independent verification)

**Branch:** `lp/intake-w9-advisor` (same branch, same worktree at `/home/jameson/lp-w9-advisor`). Your prior commit `47fa8361 feat(intake): W9-LANE2-ADVISOR direct DocuSign signing` is good, substantial work and matches the brief's file territory exactly — this is a targeted fix round.
**You are Codex, the builder.** Fix the issues below, re-run every check, commit. Do NOT push. Do NOT merge. Do not send notifications; never invoke `notify-jameson`.

## What happened

Your scoped `vitest` run genuinely passed (23/23, verified independently). But an independent re-run of the exact whole-project `npx tsc --noEmit` you were told to run in your brief found 12 real compile errors your own report didn't catch — your last edits were likely made after your last successful `tsc` pass. Also: the earlier "12 intake-page tests failed with connection-refused" and "backend port 5190 conflict" you may have seen in a mixed environment were **not real** — those were caused by three lanes' dev servers/test suites racing for the same ports when dispatched simultaneously. Re-run in isolation (as done here), Lane 3 and Lane 4 are both fully green, and their diffs stayed inside their own file territory, so this is genuinely just your lane's fix round.

## Fixes required

### 1. `egressReceipt.ts` call sites missing `userConfirmed` (TS2345, 3 errors: `egressReceipt.test.ts:11`, `signatureWorkflow.ts:69`, `signatureWorkflow.ts:72`)

`createDocusignEgressReceipt`'s input type requires `userConfirmed: true` (it's not optional — correctly so, since a receipt without it would be a contradiction). Three call sites construct the input object without it:

- `signatureWorkflow.ts:69` (the Local-only-blocked receipt)
- `signatureWorkflow.ts:72` (the allowed receipt)
- `egressReceipt.test.ts:11` (the test fixture)

Add `userConfirmed: true` to all three object literals. This is not a relaxation — the advisor's explicit confirmation is exactly what these receipts are meant to prove happened before the call, so the field being required is correct; the call sites were just incomplete.

### 2. `signatureWorkflow.ts` — `pollEnvelopeStatus` return type is too wide for `SignatureStatus` (TS2375, 2 errors at line ~94)

`DirectDocusignAdapter.pollEnvelopeStatus` (in `docusignAdapter.ts`) currently returns `Promise<string>`. In `retrieveAndFileDocusignCompletion`, the `declined`/`voided` branch builds `{ ...stored.record, status, events: [...] }` and passes it to `saveLocalSignatureRecord`, but because the source type is a bare `string`, the resulting object's `status` field is inferred as `string`, not `SignatureStatus` — even though the surrounding `if (status === 'declined' || status === 'voided')` guard logically guarantees one of those two literal values.

Fix `pollEnvelopeStatus`'s declared return type in `docusignAdapter.ts` to an explicit union of DocuSign's real envelope-status strings (e.g. `Promise<'sent' | 'delivered' | 'completed' | 'declined' | 'voided' | string>` is not good enough — define a real closed union covering every status value your adapter's polling logic actually distinguishes, and only widen with a residual `| 'created' | ...` if genuinely needed; check DocuSign's actual envelope status values if unsure). Then, at the two `signatureWorkflow.ts` construction sites (the declined/voided branch and the "not completed yet" branch), make sure the object passed to `saveLocalSignatureRecord` has a `status` field whose type is provably `SignatureStatus` — add an explicit `as const` or a narrow type assertion at the point of construction if the return-type fix alone doesn't fully propagate (the "not completed" branch already does this correctly with `'completion_pending' as const`; make the declined/voided branch just as explicit rather than relying on control-flow narrowing surviving an object-spread, which it evidently doesn't here). Do the same for each event's own `status` field in the `events` array — the same widening happens there.

### 3. `signatureWorkflow.ts:17` — unused import (TS6133)

`StoredLocalSignatureRecord` is imported from `./signatureRecordStore` but never used in this file. Remove it from the import, unless you find (while fixing #2) that you genuinely need it to type something explicitly — in that case, use it rather than deleting it, and say so in your report.

### 4. `OnboardingTab.tsx:400` — `exactOptionalPropertyTypes` violation on `SendForSignatureDialog`'s `status` prop (TS2375)

```tsx
<SendForSignatureDialog ... status={signatureStatuses?.[signatureDialogItemId]} ... />
```

`SendForSignatureDialogProps.status` is `status?: SignatureStatus` (correctly optional), but `signatureStatuses?.[signatureDialogItemId]` is `SignatureStatus | undefined` — under this project's `exactOptionalPropertyTypes: true`, explicitly passing `undefined` to an optional prop is a different (rejected) thing from omitting the prop entirely. This file already has the correct pattern elsewhere for exactly this situation (`{...(onExtend ? { onExtend } : {})}` a few lines below) — apply the same conditional-spread pattern to `status` instead of passing it directly:

```tsx
{...(signatureStatuses?.[signatureDialogItemId] !== undefined ? { status: signatureStatuses[signatureDialogItemId] } : {})}
```

(as a spread alongside the dialog's other props, replacing the direct `status={...}` prop).

### 5. `intakeStore.test.ts:251` — TS4111 index-signature access

```ts
persisted.intakesById.i?.items[0]?.pdfCompletion?.completedSha256
```

`persisted.intakesById` is a `Record<string, ...>` — dot-accessing the literal key `i` trips `noPropertyAccessFromIndexSignature`. Change to bracket notation: `persisted.intakesById['i']?.items[0]?.pdfCompletion?.completedSha256`.

### 6. `signatureWorkflow.test.ts:25` — `request.items[0].template` is possibly undefined and not all `RequestItem` variants have `.template` (TS2532, TS2345)

```ts
vi.mocked(loadPdfTemplateDescriptor).mockResolvedValue(request.items[0].template);
```

`request.items[0]` is `RequestItem | undefined` (index access), and even when present, only the `pdf_fill` variant of the `RequestItem` union has a `.template` field. Give the test a properly narrowed reference instead, e.g.:

```ts
const pdfItem = request.items[0];
if (pdfItem?.t !== 'pdf_fill') throw new Error('test setup: expected the pdf_fill fixture item first');
...
vi.mocked(loadPdfTemplateDescriptor).mockResolvedValue(pdfItem.template);
```

(or whatever equally-clean pattern you prefer — the point is a real type-narrowed reference, not an `as any`/`as never` escape hatch, since this is exactly the kind of shortcut the project's no-shortcuts rule forbids even in test code).

### 7. `signatureWorkflow.test.ts:28` — `new LocalOnlyExternalError()` called with zero arguments (TS2554)

```ts
vi.mocked(assertLocalOnlyAllowsExternal).mockImplementation(() => { throw new LocalOnlyExternalError(); });
```

TypeScript type-checks this against the **real** `LocalOnlyExternalError` class from `@/platform/privacy/localOnlyGuard` (the static import), whose constructor requires `(op: string)` — even though `vi.mock` replaces it at runtime with this file's own zero-arg `Block` class. Pass a string argument to satisfy the real type: `throw new LocalOnlyExternalError('Send for DocuSign signature');` (the exact string doesn't matter functionally since the mock intercepts it at runtime, but match the real call site's `op` label for readability).

## After fixing: re-run every check from your original brief

```
timeout 300 npx vitest run src/platform/docusignSigning src/features/intake/docusignSigning src/platform/intake/intakeFiling.test.ts src/platform/intake/intakeStore.test.ts
timeout 300 npx vitest run src/features/intake
timeout 180 npx tsc --noEmit
timeout 240 node scripts/eslint-gate.mjs
```

If any test fails with a connection-refused, port-in-use, or similar resource error rather than a real assertion failure, note that explicitly in your report as a possible environment/contention issue rather than reporting it as a code defect — but still investigate enough to be confident it isn't a real bug before dismissing it that way.

## Finish

Commit on `lp/intake-w9-advisor` (a new commit, do not amend the prior one) with a conventional message containing `W9-LANE2-ADVISOR-FIXES`. Do NOT push. Do NOT merge. Report exact check results for all four commands above and confirm the branch is clean.

The very last line of your output — after everything else, on its own line — must read exactly `DONE-EXIT:0` if every check genuinely passed and the branch is clean and committed, or `DONE-EXIT:1` if something is unresolved (explain above that line). Do not print this sentinel early, more than once, or inside quoted/example text.
