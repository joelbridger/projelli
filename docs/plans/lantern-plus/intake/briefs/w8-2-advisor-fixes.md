# Wave 8 Lane 2 — Fix Round (from adversarial codex-review)

**Branch:** `lp/intake-w8-advisor` (same branch, new commit on top of `6f82b0ec`).
**You are Codex, the builder.** Fix these five findings, run the checks, commit. Do NOT push. Do NOT merge. Never invoke `notify-jameson`.

An independent adversarial review (`codex-review --base lp/intake-w8`) of this branch found five real issues, four of them P1. The wave lead independently verified Finding 1 against `pdfjs-dist`'s actual worker source before dispatching this — it is not a false positive. Fix all five.

## Finding 1 [P1] — AcroForm field detection is completely broken for every real fillable PDF

`src/platform/intake/pdfTemplates/pdfInspector.ts:67-72` (`fieldType()`), used by `inspectPdfTemplate` around line 97-99: the code reads `widget?.fieldType` and maps `'checkbox' | 'radiobutton' | 'choice' | 'text'` against it.

**This is wrong.** The wave lead traced `pdfjs-dist`'s actual worker source (`node_modules/pdfjs-dist/build/pdf.worker.mjs`, the `getFieldObject()` methods on `TextWidgetAnnotation`, `ButtonWidgetAnnotation`, `ChoiceWidgetAnnotation`) and confirmed `getFieldObjects()` returns each widget with a **`type`** property, not `fieldType`, using these exact semantic strings:
- `TextWidgetAnnotation.getFieldObject()` → `type: "text"`
- `ButtonWidgetAnnotation.getFieldObject()` → `type: "checkbox"` or `type: "radiobutton"` or `type: "button"` (push button, not a fill field — skip it)
- `ChoiceWidgetAnnotation.getFieldObject()` → `type: this.data.combo ? "combobox" : "listbox"`

`widget?.fieldType` is always `undefined` on these objects, so `fieldType(undefined)` returns `null` for every field, every time — meaning **every real fillable PDF is currently misclassified as a non-fillable overlay with zero detected fields.** This is a complete, 100%-reproducible failure of the primary AcroForm path, not an edge case.

**Fix:** read `widget?.type` instead of `widget?.fieldType`. Map: `"text"` → `text` (this codebase's `InspectedPdfFieldType` doesn't distinguish text/date/number/money at the PDF-structure level — keep defaulting detected text fields to `text` and let the advisor recategorize to `date`/`number`/`money` in the mapper UI, exactly as the existing UI's `pdf_field_type` dropdown already allows); `"checkbox"` → `checkbox`; `"radiobutton"` → `radio`; `"combobox"` and `"listbox"` → `select`; `"button"` (push button) → skip, it's not a fillable answer field; anything else → skip. For radio/select fields, options come from `widget.items` (already correctly read) — verify that still works once `type` gates correctly (it already did structurally, it just never ran because no field ever passed the type check).

**Test:** build (or find/adapt) a synthetic fixture whose `getFieldObjects()`-shaped mock returns real `type: "text"`/`"checkbox"`/`"radiobutton"`/`"combobox"` objects (matching the real shape you just traced, not the old assumed shape) and assert `inspectPdfTemplate` classifies it `kind: 'acroform'` with the correct field count and types. If existing tests mocked the wrong shape (using `fieldType` instead of `type`), fix those mocks too — they were testing the bug, not the real behavior.

## Finding 2 [P1] — Storing base64 PDF bytes in the OS keychain will fail on Windows for virtually any real file

`src/platform/intake/pdfTemplateStore.ts:77-80` (and the surrounding `writeSecret`/`readSecret`): the entire base64-encoded PDF plus descriptor gets written as one keychain value via `keychainSet`. Windows' native Credential Manager backend has a hard ~2.5 KB limit per credential blob. Since imports allow files up to 50 MiB, this means real advisor PDFs will fail to save on Windows — the primary supported desktop platform — even though nothing in the UI says why.

**Fix:** move the actual PDF bytes (and the descriptor's field map, if it's also large) out of the keychain and into this codebase's existing encrypted local artifact storage for large sensitive blobs — check `src/platform/fs/WorkspaceService.ts` and how other features in this codebase persist large sensitive local files (the vault crate `keepance-vault`, or a workspace-relative encrypted-artifact convention — search for how similarly-sized sensitive local blobs are already stored elsewhere in `src/platform/`, don't invent a new mechanism if one exists). Keep the **keychain** for only a small reference/key (or nothing at all, if the vault path is itself already access-controlled the way the keychain is) — mirror whatever size discipline the rest of this codebase already uses for "small secret in keychain, large blob in vault/workspace" patterns.

**Test:** a PDF significantly larger than the ~2.5 KB Windows credential limit (e.g. a multi-hundred-KB or multi-MB fixture) round-trips through import → store → `loadSourceBytes` → identical bytes, without ever attempting to write more than a small reference through the keychain call path (mock/spy on the keychain call and assert its value size stays small regardless of the PDF's actual size).

## Finding 3 [P1] — A `pdf_fill` item built from a saved blueprint can be sent with no source PDF at all

`src/features/intake/RequestFromClientDialog.tsx:51-53` (`unsupportedItem`): checks `isValidPdfTemplateDescriptor(item.template)` but never checks for `sealed_source_pdf_b64`. Because `copyRequestBlueprintForPersistence` (the bridge fix's own new function) correctly strips that field before a blueprint is saved, **any `pdf_fill` item reached via a saved/reused blueprint has a valid descriptor but no attached bytes** — `unsupportedItem` doesn't catch this, so the item is treated as sendable, and the client ends up on Lane 3's fail-closed "contact your advisor" path instead of a working form. The existing "allows an approved PDF item" test in this file's test suite exercises exactly this broken path without catching it, because that test presumably builds the item fresh (with bytes) rather than round-tripping it through blueprint persistence.

**Fix:** `unsupportedItem` must also treat a `pdf_fill` item with no `sealed_source_pdf_b64` as unsupported/blocked. Since a legitimate compose-time flow always attaches bytes via `createPdfFillDraftItem` (which now requires `sourceBytes`, per the bridge fix), and a blueprint-sourced item never has them, this guard is the correct backstop: block sending until bytes are present. If there's a legitimate product path where an advisor picks a *saved blueprint* containing a `pdf_fill` item and should be able to re-resolve fresh bytes from the local template library at that point (rather than just being blocked), that's a reasonable enhancement — but the **minimum required fix** is: never let a `pdf_fill` item without bytes reach `assertSendableRequest`/`instantiateRequestBlueprint`. Pick the minimum fix unless resolving fresh bytes from the library (via `usePdfTemplateStore`'s `loadSourceBytes`, matching `template.templateId`/`template.version`) is a small, clearly-correct addition to the same guard — your call, document which you chose and why.

**Test:** build a `pdf_fill` item, round-trip it through `copyRequestBlueprintForPersistence` (stripping bytes, as it correctly does), then attempt to add/send it through `RequestFromClientDialog`'s flow — assert it's now blocked (or correctly re-resolved with fresh bytes, if you took that path) rather than silently issued with no source.

## Finding 4 [P1] — The overlay editor cannot actually place fields

`src/features/intake/pdfTemplates/TemplateLibraryPanel.tsx:46-49` (`overlayField`) and its call site around line 198 (`onClick={() => setFields(... overlayField(Object.keys(current).length + 1) ...)}`): `overlayField(index)` **ignores its `index` parameter entirely** and always returns the identical hardcoded `rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }` on page 1. Every "Add overlay field" click stacks a new field exactly on top of the previous ones. The rendered mapper UI (same region, ~line 198) only exposes `pdf_field_type` and `overflow` dropdowns per field — there is no control for page, x/y/width/height, font, alignment, or size anywhere. For a genuinely non-fillable/scanned source (the overlay path's entire reason to exist per W8-PREP), an advisor cannot place real fields on the actual form.

**Fix:** add real per-field geometry controls to the overlay editing UI: page number, x/y/width/height (as normalized 0-1 coordinates, matching `PdfOverlayRect`'s existing contract), font family (constrained to the three allowed built-in fonts per Lane 1's validator — `Helvetica`/`Times-Roman`/`Courier`), size, and alignment. A reasonable minimum: numeric inputs for each geometry value, defaulting each *new* field to a position that doesn't collide with existing ones (e.g. offset each new field's default `y` down the page, or place it near wherever the advisor last clicked/scrolled in the preview if you want to go further — a simple non-colliding default plus manual numeric adjustment is enough to satisfy this finding; a drag-to-place canvas interaction would be nicer but is not required to close this finding). The key requirement is that **the advisor must be able to make two overlay fields land at different, correct positions on the actual page**, verified against the live preview.

**Test:** add two overlay fields with different geometry via the UI/component API, assert their resulting `PdfFieldMapEntry.rect`/`page` values are distinct and match what was set (not both defaulting to the same hardcoded rect).

## Finding 5 [P2] — The dry-fill preview never actually renders values onto the PDF

`src/features/intake/pdfTemplates/TemplateLibraryPanel.tsx:97-109` (`PdfPagePreview`): renders only the pristine original first page via PDF.js, then lists `dryFillText()` sample values as plain text underneath the canvas — it never draws or overlays those values onto the rendered page, and never applies AcroForm field values either. `assertDryFillPreview`/`buildDryFillPreviewSnapshot` only compare descriptor JSON, not rendered pixels or drawn positions. An advisor approving a template today has no actual visual proof that a field lands where they think it does — exactly the "shifted or missing field" scenario the golden-fixture requirement in the original brief was meant to catch, but the *approval-time UI* doesn't give the advisor that same signal live.

**Fix:** make the preview actually draw the sample values onto the rendered page canvas at their real positions — for an overlay field, draw the `dryFillText()` value at its `rect`/`font`/`alignment` exactly as the real Lane 3 overlay writer would (you can reuse the drawing-position math conceptually, it doesn't need to call Lane 3's actual `intake-page` code, just replicate the placement logic locally since canvas 2D and `pdf-lib` positioning aren't identical APIs — get the *relative* placement visibly correct). For an AcroForm field, if you can cheaply indicate the field's approximate location from `pdfjs-dist`'s annotation data (it has `rect` on the widget object per the shapes you just fixed in Finding 1), draw a marker/label near it; if that's a bigger lift than fits this fix round, at minimum keep the current text-listing fallback for AcroForm but make it explicit in the UI copy that positions aren't visually verified for that path yet — don't silently claim parity you haven't built. Prioritize the overlay case, since that's the one with no other placement feedback at all (Finding 4 just added the numeric controls; this finding is what lets the advisor *see* whether those numbers are right).

**Test:** for an overlay field, assert the preview's draw call actually receives the field's real `rect`-derived canvas coordinates and its `dryFillText()` value (a rendering-intent test — assert the draw function was called with expected args, since pixel-diffing a canvas in this test environment is likely impractical; check what testing approach this repo's other canvas-touching tests already use and match it).

## Checks to run (same suite as the original brief; report exact pass/fail)

```
timeout 300 npx vitest run src/platform/intake/pdfTemplateStore.test.ts src/features/intake/__tests__/pdfTemplates src/features/intake/__tests__/RequestFromClientDialog.test.tsx src/platform/intake/pdfTemplates
timeout 300 npx vitest run src/platform/intake src/features/intake
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

Do not run `npm run gate` or anything touching Rust/cargo.

## Self-converge requirement

This is core-product correctness work — per this repo's standing rule, do not ship a cheap partial fix when the robust one is knowable and achievable in this pass. Do not stop and report failing tests as your finishing state. Run the full acceptance list, read every failure, fix it, and rerun until everything passes. If Finding 2's exact vault-storage mechanism or Finding 5's rendering approach genuinely isn't clear from this codebase's existing patterns, make the most conservative, secure choice (never widen what the keychain accepts; never claim a preview is accurate when it isn't) and document the choice precisely in your final report so the wave lead can evaluate it.

## Finish

Commit on `lp/intake-w8-advisor` with a conventional message containing the phrase `W8-LANE2-ADVISOR-FIXES`. Do NOT push. Do NOT merge. In your final report: confirm all five findings are fixed (or explain precisely what you chose for Finding 2's storage mechanism and Finding 5's rendering approach and why), and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
