# ACATS Transfer Autopilot - Plan

**Date:** 2026-07-10
**Pain:** P8 from `docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md`, section 5 item 1.
**Plain-English goal:** client uploads an old brokerage statement, Lantern reads it, builds a Schwab-ready transfer summary, and sends that summary into the existing Schwab-prefill path.
**Honest boundary:** Lantern can build the statement-to-transfer-packet workflow standalone. Direct submission or deep prefill inside Schwab's own digital ACATS workflow is Schwab-partnership-gated.

## 0. Executive Call

Build **ACATS Transfer Autopilot** as a local "prep and review" feature first:

1. Upload the old delivering-firm statement.
2. Extract the transfer facts with page citations.
3. Show an advisor-reviewed transfer summary.
4. Route the approved summary into the existing Schwab account-opening/prefill program as a new funding/transfer input.
5. Generate a Schwab Prep Packet and handoff checklist that the advisor uses in Schwab Advisor Center, Schwab's approved DocuSign path, or the firm's approved signing path.

Do **not** promise "Lantern submits the transfer to Schwab" until Schwab grants partner access. Public Schwab material shows the advisor-side digital onboarding flow exists, but the real partner prefill path sits behind Schwab's integration program.

## 1. Research: How Schwab Transfers Work Today For RIAs

### 1.1 The Schwab advisor flow

Schwab Advisor Services markets **Digital Client Onboarding** as a Schwab Advisor Center workflow for RIAs. It lets advisors create envelopes that can open, set up, and fund multiple accounts for a household, then send one client email for review and eAuthorization. Schwab also says the flow can collect data from third-party platforms and auto-fill available information. Source: [Schwab Digital Client Onboarding](https://advisorservices.schwab.com/serving-your-clients/acct-mgmnt-trading/account-management/digital-client-onboarding).

Schwab's "transfer to Schwab" public client flow is simpler: open or choose a Schwab account, pick "Investment account transfer," enter the other firm's name and account number, choose full or partial transfer, review, and authorize. Source: [Schwab transfer to Schwab](https://www.schwab.com/transfer-to-schwab).

The public Schwab transfer form gives the practical field model. Schwab asks for:

- Receiving Schwab account name, account number, registration, and SSN/TIN.
- Delivering firm name and phone.
- Delivering account title, account number, registration, and SSN/TIN.
- A recent statement, dated within 90 days.
- Whether the transfer is full or partial.
- For partial transfers, asset description, share/contract quantity, and transfer instructions.
- For mutual funds, fund name, account number, CUSIP/symbol, quantity, in-kind or liquidation choice, and dividend/capital-gain election.
- Schwab clearing number `0164` appears on the Schwab form for deliveries into Schwab.

Source: [Schwab Transfer Your Account to Schwab form PDF](https://content.schwab.com/dcc/APP13017.pdf).

### 1.2 What ACATS itself does

ACATS is the industry rail for eligible brokerage account transfers. DTCC describes ACATS as an automated transfer service between NSCC members and DTC bank participants, available through mainframe or secure internet communications. Source: [DTCC ACATS overview](https://www.dtcc.com/clearing-services/equities-clearing-services/acats).

FINRA's ACATS rule explains the practical validation shape: the receiving firm starts the transfer instruction, including the customer's name, SSN or tax ID, and account number. The delivering firm validates or takes exception within the rule window, and mismatches can reject or delay the transfer. Source: [FINRA Rule 11870](https://www.finra.org/rules-guidance/rulebooks/finra-rules/11870).

DTCC publishes DTC participant directories. That is the likely source for a local delivering-firm DTC/clearing lookup pack. Source: [DTCC DTC participant directories](https://www.dtcc.com/client-center/dtc-directories).

### 1.3 What is automatable now vs partnership-gated

**Works standalone, no Schwab partnership:**

- Import a delivering-firm statement into the client folder.
- Read a native-text PDF, or OCR a scanned PDF locally.
- Extract likely account number, account title, registration/title type, statement date, delivering firm name, account type, positions/holdings, symbols, CUSIPs if present, quantities, and market values.
- Look up likely delivering-firm DTC/clearing number from a local DTCC-derived reference pack, with advisor confirmation.
- Produce an advisor-reviewed transfer summary with citations back to the statement pages.
- Generate a Schwab Prep Packet: summary, missing-field checklist, copyable fields, official-form mapping, statement attachment reminder, and "use Schwab's approved signing/submission path" instructions.
- Feed the approved transfer summary into the existing Schwab-prefill track as a funding source for an account-opening packet.
- Run the Phase 2 NIGO pre-validation concept after the transfer packet is built.

**Needs Schwab partnership or firm-specific approved access:**

- Direct data-passing into Schwab Digital Client Onboarding / DAO.
- Direct ACATS transfer initiation from Lantern into Schwab.
- Schwab eAuthorization creation from Lantern.
- Transfer status callbacks from Schwab.
- Any production Schwab Advisor Center API access beyond public/manual handoff.
- Any "Advisor's Own DocuSign" delivery unless the firm and form are approved by Schwab for that route.

Schwab's public technology pages point vendors to the Schwab integration relationship path, not a self-serve account-opening API. Source: [Schwab API integration page](https://advisorservices.schwab.com/managing-your-business/tech-integration/api-integration) and [Schwab technology provider lead form](https://advisorservices.schwab.com/managing-your-business/tech-integration/lead-form).

### 1.4 Existing Schwab plan this must compose with

The approved Schwab account-opening plan already split the work into:

- **Track 1:** build prefilled Schwab paperwork locally, with advisor review and no auto-submit.
- **Track 2:** start the Schwab partnership clock for DAO data-passing and eAuthorization.
- **Track 3:** handoff mode and data-connect alternatives around the locked door.

Source: `docs/plans/schwab-account-opening-plan.md:1-48`.

A first Schwab account-opening implementation was also recorded as done in `coordination/briefs/done/schwab-p1.done.md:1-79`. That brief says the existing build has account types, field maps, a review UI, SSN redaction on storage/audit, placeholder template IDs, and no real Schwab PDF maps or auto-submit yet. ACATS should reuse that review/prefill model, not create a second paperwork engine.

The Phase 2 NIGO brief is the other sibling plan. It says the product should check custodian paperwork before it leaves the advisor's desk, with Schwab rules first, form-version rules, and clear "custodian makes the final call" language. Source: `docs/plans/lantern-plus/phase-2/nigo-pre-validation.md:1-69`.

## 2. What Lantern Can Extract Today

### 2.1 PDF statements

Lantern already has a PDF text path:

- `src/lib/pdf-extract.ts:1-11` says this is the shared PDF text extraction path.
- `src/lib/pdf-extract.ts:81-147` extracts text from each PDF page with PDF.js and flags encrypted or scanned PDFs.
- `src/lib/pdf-extract.ts:31-45` detects page-level scanned pages, not just whole-file scans.
- `src/lib/pdf-extract.ts:149-220` renders one PDF page to PNG bytes for OCR.

Lantern already has local OCR:

- `src/platform/rag/ocr/ocrEngine.ts:1-25` defines the OCR seam and says the engine is `tesseract-wasm`, bundled locally.
- `src/platform/rag/ocr/ocrEngine.ts:87-103` gates OCR to real app runtimes and exposes `ocrPageImage`.
- `src/platform/rag/ocr/ocrEngine.ts:103-128` reads one PNG page and returns text plus confidence.
- `src/platform/rag/ocr/ocrEngine.ts:130-148` tears down the OCR worker after a batch.

Lantern already wires PDF extraction into local memory:

- `src/platform/rag/MemoryService.ts:522-542` documents `indexPdfFile` as the single-file PDF indexing path.
- `src/platform/rag/MemoryService.ts:561-579` reads PDF bytes and finds pages needing OCR.
- `src/platform/rag/MemoryService.ts:580-614` OCRs pages sequentially and records confidence.
- `src/platform/rag/MemoryService.ts:624-663` drops very low-confidence OCR pages instead of polluting search.
- `src/platform/rag/MemoryService.ts:665-679` sends extracted pages and OCR confidence to Rust.
- `src/platform/utils/tauri-commands.ts:464-500` shows the bridge into `rag_index_pdf_chunks`.
- `src-tauri/src/commands/rag/pdf_indexer.rs:1-18` explains that PDFs are extracted in the renderer and indexed page-by-page in Rust.
- `src-tauri/src/commands/rag/pdf_indexer.rs:105-149` records whether a PDF page came from OCR and stores confidence.

The settings default is also already right for this feature:

- `src/platform/settings/schema.ts:457-472` has PDF indexing on by default and scanned-PDF OCR on by default.

**What that means for ACATS:** if a client uploads a Wells Fargo, Fidelity, Vanguard, Morgan Stanley, Pershing, or other statement as a text PDF, Lantern can read the page text. If it is a scanned PDF, Lantern can OCR it locally. Each extracted fact can carry a source page and an OCR confidence warning.

### 2.2 Word, Excel, and other statement-like documents

Most brokerage statements will be PDFs, but Lantern also has native Office extraction:

- `src-tauri/src/commands/rag/extractor.rs:1-12` says PDFs are handled by PDF.js, while Office files are extracted Rust-side.
- `src-tauri/src/commands/rag/extractor.rs:32-35` says `.docx`, `.xlsx`, `.pptx`, and `.rtf` are indexable Office formats.
- `src-tauri/src/commands/rag/extractor.rs:67-72` classifies those file types.
- `src-tauri/src/commands/rag/state.rs:281-299` extracts downloaded `.docx`, `.xlsx`, `.pptx`, `.rtf`, and text documents.

### 2.3 Import path

The normal file import path already copies chosen files into the workspace and indexes them:

- `src/platform/utils/fileDrop.ts:153-159` says picked files are imported into the workspace and explicitly indexed.
- `src/platform/utils/fileDrop.ts:187-195` routes PDFs to `indexPdf` and other files to `indexFile`.

### 2.4 What does not exist yet

Lantern can read text. It does **not** yet have a dedicated brokerage-statement parser that turns a statement into a validated ACATS transfer draft.

New work is needed for:

- Statement type detection: brokerage statement vs bank statement vs tax form.
- Delivering firm normalization: "Wells Fargo Advisors" vs "WF Clearing Services."
- Account number extraction with masked-account handling.
- Registration/title type detection: individual, joint, trust, IRA, Roth IRA, inherited IRA, custodial, TOD, etc.
- Holdings table extraction: symbol, CUSIP, description, quantity, market value, asset type.
- Transferability warnings: proprietary mutual funds, annuities, alternatives, fractional shares, retirement-plan transfers, margin/debit, options, and assets that usually need special handling.
- A confidence model and advisor review UI.

The feature should treat AI extraction as a **draft**, not a final transfer instruction.

## 3. Feature Design

### 3.1 Product promise

**"Drop in the old statement. Lantern builds the Schwab transfer packet, shows exactly where every field came from, and hands you the clean Schwab-ready summary."**

This is not a note-taking feature. It is a document-to-action workflow inside the Onboarding OS.

### 3.2 Main flow

1. **Entry points**
   - From Intake: checklist item "Upload old account statement for transfer."
   - From a client page: action "Start account transfer."
   - From the existing Schwab account-opening flow: funding source "Transfer from another firm."

2. **Upload old statement**
   - User uploads or imports the statement.
   - File lands in the client folder.
   - Existing PDF/OCR pipeline reads it.
   - If the PDF is encrypted or unreadable, Lantern asks for a password/unlocked copy or marks it "needs manual entry."

3. **Statement detective**
   - Classify firm, statement date, account type, and whether it looks like a brokerage/retirement statement.
   - If the upload is wrong, say what it appears to be and what is missing.
   - Keep this inside the existing "Document Detective" idea from Lantern Intake.

4. **Extraction draft**
   - Build an `AcatsTransferDraft`.
   - Every field has: value, confidence, source page, source quote/region when available, and extraction method (`native-pdf`, `ocr`, `manual`, `advisor-edited`).
   - Low-confidence OCR fields show a check-original warning.

5. **Advisor review**
   - Advisor sees a clean transfer summary:
     - Delivering firm.
     - Delivering account number.
     - Delivering account title/registration.
     - Statement date.
     - Account type.
     - Full vs partial transfer.
     - Holdings table.
     - Missing facts.
     - Warnings.
   - Advisor must confirm all critical fields before export or Schwab handoff.
   - Any edited field stores the advisor edit and keeps the original source as provenance.

6. **Route to Schwab-prefill program**
   - Reuse the account-opening review/prefill model from `docs/plans/schwab-account-opening-plan.md`.
   - If opening a new Schwab account, ACATS becomes the funding/transfer section of the Schwab application packet.
   - If transferring into an existing Schwab account, ACATS creates a standalone transfer packet.
   - Do not build a separate "Schwab transfer form engine." Add ACATS as a new data source and template family for the existing paperwork/prefill track.

7. **Output paths**
   - **Standalone now:** Schwab Prep Packet with copyable fields, checklist, attached statement reminder, and official-form mapping.
   - **NIGO composition:** pass the generated transfer packet into Phase 2 NIGO pre-validation.
   - **Partner later:** pass the same approved `AcatsTransferDraft` into Schwab DAO/transfer APIs when the partnership exists.

### 3.3 Draft data model

```ts
type AcatsTransferDraft = {
  id: string;
  matterId: string;
  sourceStatementPath: string;
  sourceStatementDate?: ExtractedField<string>;
  deliveringFirm: {
    name?: ExtractedField<string>;
    normalizedName?: string;
    dtcNumber?: ExtractedField<string>;
    phone?: ExtractedField<string>;
    address?: ExtractedField<string>;
  };
  deliveringAccount: {
    accountNumber?: ExtractedField<string>;
    accountTitle?: ExtractedField<string>;
    registrationType?: ExtractedField<
      'individual' | 'joint' | 'trust' | 'traditional_ira' | 'roth_ira' |
      'rollover_ira' | 'inherited_ira' | 'custodial' | 'tod' | 'unknown'
    >;
    taxStatus?: ExtractedField<'taxable' | 'tax_deferred' | 'tax_free' | 'unknown'>;
    owners: ExtractedField<string>[];
  };
  receivingSchwabAccount: {
    accountNumber?: string;
    accountType?: string;
    registrationType?: string;
  };
  instruction: {
    transferType: 'full' | 'partial' | 'unknown';
    liquidateAll?: boolean;
    residualSweep?: boolean;
  };
  assets: Array<{
    description: ExtractedField<string>;
    symbol?: ExtractedField<string>;
    cusip?: ExtractedField<string>;
    quantity?: ExtractedField<string>;
    marketValue?: ExtractedField<string>;
    assetType?: ExtractedField<string>;
    action: 'in_kind' | 'liquidate' | 'unknown';
    warnings: string[];
  }>;
  missingFields: string[];
  warnings: string[];
  reviewStatus: 'draft' | 'needs_review' | 'approved' | 'exported';
};

type ExtractedField<T> = {
  value: T;
  confidence: number;
  source: {
    path: string;
    page?: number;
    textSnippet?: string;
    extraction: 'native-pdf' | 'ocr' | 'office' | 'manual' | 'advisor-edited';
  };
};
```

### 3.4 Review rules

Fields that must be advisor-confirmed before handoff:

- Delivering firm.
- Delivering account number.
- Account title/registration.
- Statement date.
- Full vs partial transfer.
- For partial transfers: each asset row and action.
- Receiving Schwab account, or "new Schwab account packet will create this."

Warnings that should block "ready" until acknowledged:

- Statement older than Schwab's requested 90-day window.
- Account number is masked.
- Account title does not match the receiving Schwab account title.
- Trust/IRA/custodial type inferred with low confidence.
- Holding has no symbol/CUSIP.
- Likely proprietary fund or non-ACATS asset.
- Low OCR confidence on a critical field.
- Transfer might be a 401(k)/plan rollover, not a standard brokerage ACATS.

### 3.5 Security and privacy

- Keep extraction local.
- Do not send statement images or OCR text to a Lantern server.
- Treat account numbers like sensitive data.
- Show only masked account numbers in lists; reveal full number only inside the transfer review screen.
- Audit the advisor's approval and export, but store masked account numbers in audit rows.
- Keep Schwab handoff as user-approved egress. No Schwab call should happen silently.

### 3.6 What the demo should show

Demo household: "Move a Wells Fargo brokerage account to Schwab."

1. Client uploads a Wells Fargo statement in Intake.
2. Lantern recognizes it as a brokerage statement.
3. Lantern extracts account title, account number, statement date, and holdings.
4. Lantern flags one missing piece, such as "receiving Schwab account number."
5. Advisor fills the missing value.
6. Lantern shows "Transfer packet ready - checked against the statement."
7. Advisor routes it into the Schwab prefill workflow.
8. NIGO precheck catches a deliberate mismatch, such as joint statement title vs individual Schwab account.

## 4. Wave Breakdown For Codex Lanes

These waves are shaped so Codex workers can own separate lanes, with a human/Claude review gate between waves. Product code is future work; this document does not change source.

### Wave A - Research pack and field contract (S)

**Deliverable:** `AcatsTransferDraft` schema, public source list, Schwab transfer field map, and first delivering-firm normalization table.

Codex lanes:

- Lane A1: Schwab/ACATS public-source pack, with links and last-checked dates.
- Lane A2: Draft schema and required-field rules.
- Lane A3: DTCC participant directory research and update approach.
- Lane A4: Sample statement fixture inventory: Wells Fargo, Fidelity, Vanguard, Morgan Stanley, Pershing if legally available.

Gate:

- No code yet.
- Schema reviewed against Schwab form fields and ACATS validation needs.
- Explicit list of "partner-gated" fields and operations.

### Wave B - Statement extraction engine (M)

**Deliverable:** local extraction from uploaded statements into `AcatsTransferDraft`.

Codex lanes:

- Lane B1: Statement classifier and firm/account-type detector.
- Lane B2: Account/title/registration/date extractor.
- Lane B3: Holdings table extractor.
- Lane B4: Confidence and source-citation layer.
- Lane B5: Fixture tests for native PDF and scanned/OCR PDF paths.

Gate:

- Native PDF statement extracts critical fields.
- Scanned PDF statement extracts fields with OCR confidence.
- Low-confidence fields do not auto-approve.
- Masked account numbers remain marked missing/needs review.

### Wave C - Advisor review UI (M)

**Deliverable:** transfer summary review screen in the existing client/workflow shape.

Codex lanes:

- Lane C1: Review state store and edit tracking.
- Lane C2: Summary UI with source chips and confidence warnings.
- Lane C3: Holdings table review and missing-field controls.
- Lane C4: Audit/redaction behavior for approvals and exports.

Gate:

- Advisor can edit and approve the draft.
- Critical fields cannot be skipped.
- Source citations open the uploaded statement.
- Audit rows mask account numbers.

### Wave D - Schwab Prep Packet and prefill composition (M)

**Deliverable:** approved ACATS draft routes into the existing Schwab prefill/paperwork model.

Codex lanes:

- Lane D1: Adapter from `AcatsTransferDraft` to the existing account-opening/prefill field-map model.
- Lane D2: Schwab transfer packet template map and copy/checklist output.
- Lane D3: "Use Schwab's approved path" handoff screen.
- Lane D4: DocuSign eligibility guard: do not create a generic envelope unless the firm/form route is approved.

Gate:

- Existing account-opening path stays the owner of Schwab paperwork review.
- ACATS transfer appears as funding/transfer section, not as a separate duplicate app.
- Exported packet includes old statement attachment reminder.
- UI copy never says Lantern submitted the transfer.

### Wave E - NIGO and onboarding board composition (M)

**Deliverable:** ACATS drafts become visible in Intake/onboarding and can run pre-flight checks.

Codex lanes:

- Lane E1: Intake checklist integration.
- Lane E2: Onboarding board status: missing statement, extracted, needs advisor review, packet ready, sent through Schwab.
- Lane E3: NIGO rule hooks: title mismatch, stale statement, missing signature/date, masked account number, wrong account type.
- Lane E4: Receipts and client-file artifacts.

Gate:

- The transfer status is visible from the client page.
- NIGO warnings cite both the transfer packet and on-file facts.
- "Custodian makes the final call" language is used anywhere a check passes.

### Wave F - Schwab partner adapter (partner-gated, L)

**Deliverable:** once Schwab gives access, swap manual handoff for official digital handoff.

Codex lanes:

- Lane F1: Partner API contract wrapper.
- Lane F2: sandbox-only handoff from approved `AcatsTransferDraft`.
- Lane F3: eAuthorization/status callback ingestion.
- Lane F4: audit, retry, idempotency, and failure receipts.

Gate:

- Requires Schwab sandbox and written permission.
- No screen scraping.
- No production submit until Schwab and a design-partner RIA approve the path.

## 5. Open Questions

1. Which transfer route do Schwab-custodied RIAs actually use today for ACATS: Schwab Digital Client Onboarding, PDF form upload, Schwab DocuSign, or a back-office workflow?
2. Does Schwab's advisor digital transfer flow ask for delivering-firm DTC number, or does it resolve by firm name/account number?
3. Are the target firms mostly doing full account transfers, partial transfers, IRA rollovers, or all three?
4. Which delivering firms matter first? The likely first set is Wells Fargo Advisors, Fidelity, Vanguard, Morgan Stanley, Pershing/NetXInvestor, and Merrill.
5. Do target firms expect Lantern to support only brokerage ACATS first, or also non-ACATS transfers such as annuities, direct mutual funds, 401(k) rollovers, and bank CDs?
6. Can Jameson's design-partner firm share redacted sample statements and the exact Schwab transfer screens they use?
7. Does the existing Schwab prefill branch get merged before ACATS implementation starts, or should ACATS land as a separate branch that only defines the adapter contract?
8. What is the firm's approved signing route for Schwab transfer forms? Schwab Advisor Center DocuSign, wet signature, advisor's own DocuSign, or something else?
9. Should we include a public DTCC/DTC participant-number lookup pack in v1, or leave DTC number as manual confirmation?
10. How should Lantern handle a statement that shows only a masked account number?
11. For trust and inherited IRA registrations, what source document should win when statement title conflicts with client intake or CRM?
12. When partnership access arrives, does Schwab support ACATS prefill/status callbacks through the same DAO partner path, or is transfer initiation a separate approval?

## 6. Sources

Public sources:

- [Schwab Digital Client Onboarding](https://advisorservices.schwab.com/serving-your-clients/acct-mgmnt-trading/account-management/digital-client-onboarding)
- [Schwab transfer to Schwab](https://www.schwab.com/transfer-to-schwab)
- [Schwab Transfer Your Account to Schwab form PDF](https://content.schwab.com/dcc/APP13017.pdf)
- [DTCC ACATS overview](https://www.dtcc.com/clearing-services/equities-clearing-services/acats)
- [FINRA Rule 11870](https://www.finra.org/rules-guidance/rulebooks/finra-rules/11870)
- [DTCC DTC participant directories](https://www.dtcc.com/client-center/dtc-directories)
- [Schwab API integration page](https://advisorservices.schwab.com/managing-your-business/tech-integration/api-integration)
- [Schwab technology provider lead form](https://advisorservices.schwab.com/managing-your-business/tech-integration/lead-form)

Local docs and code checked:

- `docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md`
- `docs/plans/schwab-account-opening-plan.md`
- `coordination/briefs/done/schwab-p1.done.md`
- `docs/plans/lantern-plus/phase-2/nigo-pre-validation.md`
- `src/lib/pdf-extract.ts`
- `src/platform/rag/ocr/ocrEngine.ts`
- `src/platform/rag/MemoryService.ts`
- `src/platform/settings/schema.ts`
- `src/platform/utils/tauri-commands.ts`
- `src/platform/utils/fileDrop.ts`
- `src-tauri/src/commands/rag/extractor.rs`
- `src-tauri/src/commands/rag/state.rs`
- `src-tauri/src/commands/rag/pdf_indexer.rs`
