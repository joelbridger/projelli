# Wave 8 Bridge Fix — Attach Source PDF Bytes to the Sealed Request Item

**Branch:** `lp/intake-w8-advisor` (same branch, new commit on top of `8ceac6ff`).
**You are Codex, the builder.** Fix this gap, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

## The gap (found by the wave lead reviewing all three lanes together)

Lane 2 (this branch) built `PdfTemplateDescriptor.sourceArtifactRef` as a deliberately opaque local reference (`sealed-artifact:...`, validated by Lane 1 to never be a URL or filesystem path) and a local `pdfTemplateStore.ts` that keeps real source PDF bytes in local encrypted storage, retrievable via `loadSourceBytes(templateId, version): Promise<Uint8Array | null>`.

Lane 3 (the public client page, `intake-page/`) built its renderer assuming the actual source PDF bytes travel to the client **inside the sealed checklist itself**, base64-encoded on the `PdfFillRequestItem`, under the field name `sealed_source_pdf_b64` (see `intake-page/src/App.tsx`, `sealedPdfSourceBytes()`). This is architecturally correct — W8-PREP §2.2 says "The sealed checklist carries the encrypted immutable template artifact... It carries no custodian URL for the browser to fetch" — but **nothing currently populates that field.** `createPdfFillDraftItem` (`src/features/intake/pdfTemplates/requestComposerPdf.ts`) only copies the structural `PdfTemplateDescriptor`, never the bytes. Even if it did, `copyBlueprintItem`'s `pdf_fill` case (`src/platform/intake/blueprintValidation.ts`, Lane 1's file) does an explicit allowlist copy that would silently strip any extra field — and `instantiateRequestBlueprint` (called by `RequestFromClientDialog.tsx`'s `sendRequest`) routes every composed item through exactly that copy on its way into the issued request.

**Net effect today: every real client would hit Lane 3's fail-closed "contact your advisor" path, because the source PDF bytes never actually reach them.** This is not a security bug (it fails closed, safely) but it is a completeness bug that breaks the entire feature. Fix it.

## The fix

1. **`src/platform/intake/pdfTemplates/templateContract.ts`** (Lane 1's file — this is a deliberate, narrow, cross-lane addition; make it, don't route around it): add an optional field to `PdfFillRequestItem`, exactly named `sealed_source_pdf_b64?: string`, to match what Lane 3 already reads. Document with a one-line comment that this carries the base64 source PDF bytes for a request actually being sent, is populated only at compose/send time, and must never be populated on a persisted reusable blueprint record. Re-export it from `src/platform/intake/types.ts` the same way the other Lane 1 PDF types are already re-exported (check the existing `export type { ... } from './pdfTemplates/templateContract'` block).

2. **`src/platform/intake/blueprintValidation.ts`** (Lane 1's file): in `copyBlueprintItem`'s `pdf_fill` case, **pass through `sealed_source_pdf_b64` if present on the source item**, instead of silently dropping it (its current allowlist copy only keeps `template` and clears `prefill` — add one more conditional field, following the exact style already used elsewhere in this function for optional fields, e.g. how `doc_upload`'s optional fields are conditionally spread). Do not *populate* this field here and do not require it — it stays optional and is simply preserved when already present, exactly like every other pass-through field in this function.

3. **`src/features/intake/pdfTemplates/requestComposerPdf.ts`** (Lane 2's file): change `createPdfFillDraftItem(template: PdfTemplateDescriptor)` to `createPdfFillDraftItem(template: PdfTemplateDescriptor, sourceBytes: Uint8Array)`, base64-encode `sourceBytes` (reuse this codebase's existing base64 helper if one is already in scope — check `pdfTemplateStore.ts`'s own `b64()` helper and reuse the same encoding approach, don't invent a second one), and set `sealed_source_pdf_b64` on the returned item. Verify the encoded bytes actually hash to `template.sourceSha256` before returning (call Lane 1's `sha256Hex` from `src/platform/intake/pdfTemplates/receipt.ts`) — if they don't match, throw, because attaching wrong bytes to a request that claims a specific approved hash is exactly the kind of integrity gap this whole feature exists to prevent.

4. **`src/features/intake/RequestFromClientDialog.tsx`** (Lane 2's file): `addApprovedTemplate` (around line 135-147) currently calls `createPdfFillDraftItem(template)` synchronously. Change it to load the real bytes first — `usePdfTemplateStore`'s `loadSourceBytes(template.templateId, template.version)` — before constructing the item (this makes `addApprovedTemplate` async; update its caller, the `onClick`/`onChoose` wiring in `TemplateLibraryPanel`'s consumer, accordingly). If `loadSourceBytes` returns `null` (template bytes missing from local storage for some reason), show a clear error and do not add the item — never silently add a `pdf_fill` item with no attached bytes, since that's exactly the broken state this fix exists to prevent.

## Non-negotiables

- A **persisted, reusable blueprint** (saved via the normal "save as blueprint" path, if this codebase has one for `pdf_fill` items — check `blueprintStore.ts`) must never carry `sealed_source_pdf_b64`. This field is send-time-only, attached fresh by the composer immediately before `instantiateRequestBlueprint`, never something that should survive into a saved, reusable template record. Add a test proving this explicitly: build an item via `createPdfFillDraftItem` (which will have the field), pass it through whatever code path leads to a *saved blueprint* (not a *sent request*), and assert the field is absent from the persisted blueprint record. If no such "save this composed item as a blueprint" path currently exists in this codebase, state that explicitly in your report instead of inventing one.
- The bytes that reach the sealed checklist must match `template.sourceSha256` — verified before attachment (Deliverable 3) so a mismatch is caught at compose time, not silently discovered later by Lane 3's own re-verification.
- No em dash in any comment or user-facing string you add.

## Tests to add/update

- `requestComposerPdf.test.ts` (create if it doesn't exist, alongside the file per this repo's convention): `createPdfFillDraftItem` with matching bytes succeeds and the returned item's `sealed_source_pdf_b64` base64-decodes back to the exact original bytes; mismatched bytes (wrong hash) throws.
- `RequestFromClientDialog.test.tsx`: adding an approved template via the library panel now results in a draft item carrying real source bytes (mock `loadSourceBytes` to return known fixture bytes, assert the item added to `draftItems` has them); a `loadSourceBytes` miss (returns `null`) shows an error and does not add the item.
- `blueprintValidation.test.ts`: `copyBlueprintItem` preserves `sealed_source_pdf_b64` when present on the source item, and the field's absence (the normal case for a template item with no bytes attached, e.g. any pre-existing test fixture) round-trips as absent, not as `undefined`-but-present or empty-string.
- Round-trip test somewhere sensible (composer test file is fine): build a `pdf_fill` item via `createPdfFillDraftItem` with real fixture bytes, run it through `instantiateRequestBlueprint` (the actual function `sendRequest` calls), and assert the resulting `FormRequest`'s item still carries the exact same `sealed_source_pdf_b64` value — this is the specific path that was silently stripping it before your fix; prove it no longer does.

## Checks to run (report exact pass/fail for each; wrap every invocation in a timeout)

```
timeout 300 npx vitest run src/platform/intake/blueprintValidation.test.ts src/features/intake/__tests__/RequestFromClientDialog.test.tsx src/features/intake/pdfTemplates
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo.

## Finish

Commit on `lp/intake-w8-advisor` with a conventional message containing the phrase `W8-BRIDGE-SOURCE-BYTES`. Do NOT push. Do NOT merge. In your final report: confirm the exact new field name and its exact location in the type, confirm `copyBlueprintItem` preserves it, confirm the round-trip test through `instantiateRequestBlueprint` passes, and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
