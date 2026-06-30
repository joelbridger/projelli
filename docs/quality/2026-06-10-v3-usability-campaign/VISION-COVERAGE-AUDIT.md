# Advisor Prep Hero 3.0 — North-Star Vision Coverage Audit

**Date:** 2026-06-10 · **Branch:** `keepance-3.0` · **Auditor:** read-only code + campaign cross-reference

**North star audited against:** `docs/research/2026-06-08-ux-attorney-v2.5.1/vision-most-viable-keepance.md` ("The Most Viable Advisor Prep Hero"). Cross-referenced: the 3.0 roadmap, the 3.0 STATUS file, and the v3 usability campaign artifacts (`findings.md`, `persona-findings.md`, `native-findings.md`, `sweep-findings.md`, `FIX-WAVE-PLAN.md`, `LAUNCH-READINESS-REPORT.md`).

**Method.** Every discrete commitment in the vision (3 jobs, 6 non-negotiables, 7 pillars, 4 moat elements) was classified against the actual code in `src/`, `src-tauri/`, and `backend/`, then grounded in a campaign verification artifact where one exists. Classifications:

- **BUILT + verified** — code exists AND confirmed working (test / native pass / persona study).
- **BUILT but unverified** — code exists; not confirmed working end-to-end on a real machine (mostly blocked by the embedder-model-download in the headless native pass).
- **PARTIAL** — some of it exists; the missing piece is named.
- **GAP / NOT BUILT** — the vision calls for it; it does not meaningfully exist.

**The single biggest honesty caveat in this whole audit:** the RAG vector index never populated on a real machine during the campaign, because the e5-small embedder ONNX model is **not bundled** and the first-run HuggingFace download stalled under the test rig's memory cap (`native-findings.md` F-415). So the positive half of the wedge — a natural-language question returning a real, matter-scoped, clickable, verified citation over an actually-indexed corpus — was **never observed working end to end on a real machine.** The retrieval *engine*, the verify command, the citation UI, the refusal-on-empty behavior, and encryption-at-rest were all individually proven; the integrated happy path was not. Read every "BUILT but unverified" below through that lens.

---

## JOB 1 (the wedge) — "Find anything, privately": cited recall across email, documents, prior matters

| Commitment | Status | Evidence | Gap note |
|---|---|---|---|
| Index email + documents + PDFs + matters into a private vector store with rich metadata (source id, page, matter id) | **BUILT + verified** | `src-tauri/src/commands/rag/mod.rs` (`Hit` carries `source_id`, `page`, `matter_id`, citation key); `pdf_indexer.rs`; `store.rs`. Native pass status bar showed "Memory: 4 files" once the embedder downloaded (`native-findings.md` F-407) | — |
| Ask in plain English, get the exact source back | **BUILT but unverified** | Engine + `MemoryService.retrieve` + `AIChatViewer` wiring present; the **integrated positive retrieval was never exercised** because the index never populated (`native-findings.md` F-415, F-422) | Bundle the embedder so the wedge works on first run; verify positive recall on Windows |
| One-click verifiable citation that opens the source | **BUILT but unverified** | Citation chips render as clickable, navigate to file/paragraph, and reflect verify state (`AIChatViewer.tsx:242-320`); `App.tsx:2603` wires `verifyCitation` → `ragVerifyCitation`. Full-text **Search** click-through WAS verified and was the persona's strongest moment (`persona-findings.md` Task 4). AI-answer citation chips over a populated index were **not** observed (F-117 deferred to native; blocked by F-415) | Same blocker: needs a populated index on a real machine |
| Across everything ingested, privately (no vendor sees it) | **BUILT + verified** | Local Ollama chat answered with the green egress indicator "Nothing leaves your machine" (`native-findings.md` F-411); embeddings + retrieval run in-process | — |

**Job 1 verdict: BUILT but unverified.** The wedge's machinery is all present and several pieces are individually proven (Search click-through, local-only egress, the verify command, refusal on empty results). The one thing the whole product is sold on — a cited AI answer over your indexed email/docs — has not been seen working end to end on a real machine, purely because the embedder model isn't bundled. This is the most important thing to close.

---

## JOB 2 (the depth) — "The tireless associate": deposition/discovery analysis, all cited, propose-not-decide

| Commitment | Status | Evidence | Gap note |
|---|---|---|---|
| Contradiction finder across transcripts, statements, emails | **BUILT but unverified** | `src/modules/workflow/templates/legal/DepositionContradictionFinder.ts` (v2.0.0, interview + cited analyze step, `.docx` output); engine path `WorkflowEngine.ts:368-440` (`runContradictionAnalysis`). Workflow is registered on the native build (`native-findings.md` F-421). **The full run never completed** — the analyze step hard-requires matter-scoped retrieval (`WorkflowEngine.ts:383`) which was blocked by the empty index (F-422, F-126) | The flagship litigation feature has **never produced its planted contradictions on a real machine.** Also: it refuses without RAG rather than falling back to the pasted excerpts |
| Timeline builder | **BUILT but unverified** | `CaseTimelineBuilder.ts` (`.docx`) registered (built-in templates list, F-421) | Same RAG-dependency / un-run caveat |
| Privilege-log drafter | **BUILT but unverified** | `PrivilegeLogDrafter.ts` (`.docx`) | Same |
| Discovery triage | **BUILT but unverified** | `DiscoveryDocumentTriage.ts`, `EvidenceGapAnalyzer.ts` (`.docx`) | Same |
| Issue spotter | **PARTIAL** | Adjacent templates exist (research memo, contract review) but no dedicated "issue spotter" matching the vision's word | Minor; likely covered by existing templates |
| "Propose, do not decide" + every claim cited | **BUILT + verified (as discipline)** | Templates carry `requiresVerification: true`, verification banners, "you decide what is real" framing; persona judged the gallery copy "domain-fluent and trust-literate" (`persona-findings.md` Task 2 positives). Citation *verification* engine is real (`rag_verify_citation`) | The discipline is real; whether the *output quality* is filing-grade is unvalidated (no design-partner attorney has reviewed it; templates remain `@draft`-adjacent in spirit) |

**Job 2 verdict: BUILT but unverified.** The litigation associate exists as a real, cited, Word-producing workflow suite, and the propose-not-decide discipline is genuinely baked in. But the marquee feature (contradiction finder) has never been seen surfacing real contradictions end to end, and no attorney has validated that the output is trustworthy. The roadmap's own exit gate for this job — "design-partner attorneys validate the contradiction-finder" — has not happened (design-partner recruiting was deliberately dropped, STATUS line 116).

---

## JOB 3 (the close) — "Real deliverables, in the lawyer's own format": Word/PDF on letterhead, full fidelity

| Commitment | Status | Evidence | Gap note |
|---|---|---|---|
| Draft/edit/redline in Word (.docx) with tracked changes, full fidelity | **BUILT + verified** | In-house OOXML engine `src-tauri/crates/keepance-docx/`; `DocxEditor.tsx`. Native pass: opened a 4-tracked-change + 2-comment fixture, accept-one / reject-one, save, reopen — faithful round-trip (`native-findings.md` F-406) | — |
| AI redline arrives as tracked changes you accept/reject | **BUILT + verified** | `src/modules/docx/redline.ts` + `author.rs`. Native pass: Ollama redline produced a tracked insert attributed to "Advisor Prep Hero AI", accepted, saved, persisted (`native-findings.md` F-417) | — |
| Never raw Markdown the lawyer sees | **BUILT + verified** | New-file menu puts Word first; legal templates all output `.docx` (`grep outputFile templates/legal/*.ts` → 18/18 `.docx`, F-112 fixed); markdown pipe-tables now convert to real `<w:tbl>` Word tables (`docx-io.ts:724-744` + `htmlToDocxChildren`, F-108 fixed) | Residual: the markdown editor still exists for `.md` notes (`incident-summary` opened in it, F-407) — but those are internal notes, not legal deliverables, which matches the vision's "invisible internal layer" |
| PDF export, on letterhead | **PARTIAL** | `convert_docx_to_pdf` via LibreOffice (`src-tauri/src/commands/fs.rs:196`, `lib.rs:39`); export menu offers PDF | **Depends on the user having LibreOffice installed** (`detect_libreoffice`). Not bundled. A lawyer without LibreOffice gets no PDF export. Letterhead = the user's own template; no template-management UI was surfaced |
| Excel + PowerPoint round-trip | **PARTIAL / BUILT** | xlsx via SheetJS (`spreadsheet-io`), pptx extract + export (`pptx-io`, `export-formats.ts`); STATUS claims xlsx/pptx round-trip done (`86b21b1`) | Lower priority per vision (Word first); not exercised in the campaign |
| Import opposing counsel's Word, redline, send back acceptable/rejectable | **BUILT + verified** | The F-406 round-trip is exactly this flow on the native build | — |

**Job 3 verdict: BUILT + verified** for the core (Word import → tracked AI redline → accept/reject → save → reopen, all proven on the real desktop build). The honest asterisks: PDF export silently depends on a LibreOffice install that isn't bundled, and there's no firm-template/letterhead management surface beyond "use your own .docx".

---

## THE SIX NON-NEGOTIABLES (table stakes)

| # | Non-negotiable | Status | Evidence | Gap note |
|---|---|---|---|---|
| 1 | Every AI answer over client data carries a one-click verifiable citation; refuse/flag when it can't cite | **BUILT + verified (refusal); BUILT-unverified (positive)** | **Refusal is proven:** `AIChatViewer.tsx:983-1013` refuses on retrieval *failure*; `:1066-1094` refuses on *empty* results — native pass confirmed the exact refusal across 3 no-result queries with NO hallucinated figures (`native-findings.md` F-412). Verify engine fails closed (`rag/mod.rs:662-733`: undecryptable → `TextMismatch`, not a false pass). Unverified citations get a visible "do not rely on this" chip (`AIChatViewer.tsx:316-323`). **Positive path** (a real cited answer over a populated index) unobserved (F-415) | The "Avianca trap" (the persona's #1 fear) is closed in code and proven. The remaining risk is purely that the happy path is unverified end to end |
| 2 | Output is real, faithful Office + PDF on letterhead; never Markdown the lawyer sees | **BUILT + verified (Word); PARTIAL (PDF)** | Word round-trip proven (F-406/F-417); all legal templates `.docx`; markdown tables → Word tables (F-108) | PDF export needs an unbundled LibreOffice; no letterhead/template manager UI |
| 3 | The lawyer can always explain, in one sentence, where their data is | **BUILT + verified** | Egress indicator on every chat (`EgressIndicator.tsx`, pure-logic `egress.ts` derived from real base URLs); printable Data Map (`DataMapDialog.tsx`); onboarding data-map accordion. Persona comprehension probe PASSED with certainty; she could point at the screen (`persona-findings.md` Task 4, verbatim quotes) | Status-bar lacks a *positive* cloud-egress signal in Direct mode (loud when safe, silent when egressing) — F-120, a P2 polish, not a gate failure |
| 4 | Only honest claims; provider-exposure asterisk told first, by us | **BUILT + verified** | Data map caveat states the provider receives the prompt, retains ~30 days, and that training opt-out lives in the user's provider console (`DataMapDialog.tsx:82`); confidentiality card repeats it (`ConfidentialityModeSettings.tsx:67`). Persona called it "the first vendor privacy page I'd actually believe" | The website still claims "SSO" which does not exist (see Pillar 7 / GAPS) — an honesty risk on the *marketing* surface, not the app |
| 5 | It fits beside Clio, Outlook, Word | **PARTIAL** | Outlook (M365 Graph) + Gmail + IMAP connectors are real (`src-tauri/src/commands/mail/`); Word coexistence is the whole Office engine. **Clio: positioning copy only, zero integration code** (`grep clio src/` → pricing/template-mention strings only) | "Fits beside Clio" is marketing; there is no Clio matter/contact sync. The vision and website both imply coexistence at the data level — that does not exist |
| 6 | Privilege and work-product handled (tag, segregate, scrub, audit) | **BUILT + verified** | Privilege excluded from retrieval by default (`rag/mod.rs:302` `resolve_privilege`, safe "none" default; prefilter `matter_id AND privilege='none'`); adversarial test withholds a privileged top-hit; "Include privileged" opt-in toggle present on native build (`native-findings.md` F-413). Metadata-scrub "clean copy" export (`86b21b1`). Audit is SQLCipher-encrypted at rest (F-425) with `retrieval_executed` / `citation_verified` / `privilege_evaluated` events (`types/audit.ts:27-29`, `App.tsx:2592-2609`) | Per-message mail privilege UI is engine-ready but not surfaced (STATUS "follow-ups"). The persona wanted the *enforcement guarantee explained*, not just labeled (F-121) — the toggle exists; the in-product explanation of "this is actually excluded" is thin |

**Non-negotiables verdict:** five of six are substantively met and most are proven; #2 (PDF) and #5 (Clio) are the soft spots. #1's positive path is the recurring unverified-wedge caveat.

---

## THE SEVEN PILLARS

### Pillar 1 — Ingest everything, privately

| Element | Status | Evidence | Gap note |
|---|---|---|---|
| Email: M365, Gmail, IMAP | **BUILT + verified (engine)** | `mail/provider.rs` ("m365" / "gmail" / "imap"); Graph device-code OAuth (`oauth.rs`); IMAP mandates TLS (`imap/client.rs`). Encryption-at-rest verified verbatim — bodies AES-256-GCM, metadata SQLCipher (`native-findings.md` F-420) | A **live import** was never driven (greenmail fixture is plaintext-only; the app correctly refuses plaintext IMAP; no headless keychain — F-419). Needs a Windows + real-mailbox spot check |
| Documents + PDFs | **BUILT** | PDF text via PDF.js → `rag_index_pdf_chunks` (`pdf_indexer.rs`); office docs indexed | Indexing-then-recall unverified (F-415) |
| **OCR for scanned filings** | **GAP / NOT BUILT** | `src/lib/pdf-extract.ts:23` *detects* a scanned/image-only PDF (`scanned: true`, under 100 chars) but **runs no OCR**; `sidecars/README.md` lists OCR as "future" | A scanned filing (extremely common in litigation: court-stamped PDFs, faxed exhibits) is **invisible to search.** The vision explicitly names "PDFs (with OCR for scanned filings)." This is a real wedge hole for litigators |
| Deposition transcripts | **PARTIAL** | Ingested as documents/PDFs like anything else; no transcript-aware parsing (page:line citation is generic page-based) | The contradiction finder expects page/line refs; there's no transcript-structure-aware ingest, just generic chunking |
| Encrypted at rest, bounded + resumable import | **BUILT + verified** | Mail SQLCipher + AES-GCM blobs (F-420); resumable sync cursors (`provider.rs` delta/historyId/UIDVALIDITY); vector chunk_text AES-256-GCM at rest (`store.rs:25`) | Documented residual: file `path`/`source_id` and the 384-dim vectors stay plaintext in the vector DB (`store.rs:35-37`) — a re-identification surface for someone with raw disk access |

**Pillar 1 verdict: PARTIAL.** Email/doc/PDF ingest + encryption are real (encryption proven verbatim). **OCR is the standout gap** — and it's load-bearing for the litigation ICP. Live email import and indexed recall are unverified on a real machine.

### Pillar 2 — Private search and cited recall (the wedge)
**BUILT but unverified.** See Job 1. Full-text Search (MiniSearch) click-through IS verified and delighted the persona; the AI cited-recall positive path is blocked behind the unbundled embedder.

### Pillar 3 — The litigation associate
**BUILT but unverified.** See Job 2. Real cited Word-producing workflows; never run to completion on a real machine; never attorney-validated.

### Pillar 4 — Real drafting and deliverables, Office-native
**BUILT + verified** for Word; **PARTIAL** for PDF (unbundled LibreOffice) and letterhead/templates. See Job 3.

### Pillar 5 — The trust and confidentiality layer

| Element | Status | Evidence | Gap note |
|---|---|---|---|
| Confidentiality spectrum (Local / BYOK / Assured) | **PARTIAL** | Local-only (Ollama) verified (F-411); BYOK-direct verified (egress shows direct-to-provider); **Assured** is gated on a firm managed key (`ConfidentialityModeSettings.tsx:86-88`) and the chat routes through the proxy when present (`AIChatViewer.tsx:1359-1411`) | Assured only works once a firm admin configures a managed key against the (now-deployed) backend; not exercised in the campaign. The in-file comment still says "Coming soon" though the gating logic is real |
| Egress indicator | **BUILT + verified** | F-411; pure `egress.ts` | Direct-mode status-bar silence (F-120, polish) |
| Data map (printable, client-shareable) | **BUILT + verified** | `DataMapDialog.tsx`; persona would "staple it to an engagement letter" | British "licence" ×3 typo (F-103, trivial) |
| Optional encrypted vault | **PARTIAL** | Mail + audit + vector chunk_text encrypted at rest; FDE nudge exists (`mail/fde.rs`) | The *workspace document files themselves* are ordinary Word files in a folder — NOT encrypted at rest (persona noted this: "whoever has the laptop has them unless the disk is locked"). The vision's "optional encrypted vault for the workspace" is not built; it relies on OS full-disk encryption |
| Audit + provenance trail | **BUILT + verified** | SQLCipher audit DB (F-425); new provenance events wired | Live audit capture needs the OS keychain (unverified headless) |
| Privilege tagging | **BUILT + verified** | See Non-negotiable #6 | Per-message mail privilege UI not surfaced |

**Pillar 5 verdict: PARTIAL** (strong). The trust *story* is the product's best asset and most of it is proven. The two honest gaps: Assured mode is real-but-unexercised, and there is no encrypted vault for the document files (they lean on OS disk encryption).

### Pillar 6 — The team and firm layer

| Element | Status | Evidence | Gap note |
|---|---|---|---|
| Shared matters with E2EE sync | **BUILT + verified** | Firm backend relay (ciphertext-only) + desktop `MatterSyncClient.ts` (Yjs); STATUS: 8/8 two-client convergence test against a live backend (`LAUNCH-READINESS-REPORT.md`); persona saw live bidirectional convergence (`persona-findings.md` Task 6) | Live multi-user **.docx** co-editing is deliberately NOT shipped (gated on design-partner validation per the spike) — only shared matter *notes* converge |
| Ethical walls (enforced by key denial, not UI hiding) | **BUILT + verified** | `matterKeyService.ts:68-128` (walled users skipped in key distribution; admins get escrow; epoch rotation re-wraps to remaining members); persona: "an ethical wall as a button" landed hard | First-open key handshake is a silent 3-step human dance (F-123/F-010) — works, but looks broken; fix-wave routed |
| Multi-seat + per-org licensing | **BUILT + verified** | `backend/` Ed25519 seat tokens, atomic seat-limit, min-3 enforced server-side; `seatToken.ts` in OS keychain; `/org/claim` self-serve | LemonSqueezy can't enforce min-quantity, so the Firm card stays "Talk to us" (a sales mechanic, not a code gap) |
| Cross-member key distribution | **BUILT + verified** | ECDH P-256 wrap + admin escrow (`keyWrap.ts`, `matterKeyService.ts`); CLAUDE.md confirms firm desktop wiring complete 2026-06-10 | The handshake choreography friction above |
| Assurance package (SOC 2, DPA, SLA) | **PARTIAL (honest)** | DPA *template* (`docs/legal/DPA-template.md`); SOC 2 *readiness/gap* doc explicitly stating NOT certified (`docs/trust/soc2-readiness.md`); security overview | No executed DPA, no SOC 2 report, no SLA. Both require a **formed legal entity** (does not exist). Website correctly says "SOC 2 readiness," not "SOC 2 certified" |
| **SSO / SAML** | **GAP / NOT BUILT** | Backend auth is email+password → HS256 JWT (`backend/src/contract.ts:34-50`); PKCE noted as "in production" but not implemented; **zero SSO/SAML/OIDC code anywhere** | The website (`website/index.html:619`) and in-app pricing (`src/config/pricing.ts:123`) both sell "Admin console with **SSO** and ethical walls." SSO does not exist. **This is a false website claim** |

**Pillar 6 verdict: PARTIAL (much stronger than expected).** The hard cryptographic firm engineering — E2EE shared matters, ethical walls by key denial, multi-seat, cross-member key distribution — is genuinely built and the convergence was verified. The gaps are: SSO is advertised but absent; SOC 2/DPA are documents not instruments (and need a legal entity); the key-handshake UX looks broken; .docx co-editing is intentionally deferred.

### Pillar 7 — Fits your stack (integrations)

| Element | Status | Evidence | Gap note |
|---|---|---|---|
| Outlook / M365 | **BUILT + verified (engine)** | M365 Graph connector (Pillar 1) | Coexistence is "import your mail," not a live add-in |
| Word | **BUILT + verified** | The whole OOXML engine + round-trip | — |
| **Clio integration** | **GAP / NOT BUILT** | `grep clio src/` → only pricing copy + a template mention ("adapt for Clio, Lawmatics…"). The roadmap (WS-H) lists "Clio matter sync" as *to build* | "It fits beside Clio" (website line 511, non-negotiable #5) is **positioning, not integration.** There is no Clio matter/contact/conflict sync. Honest as a *philosophy* (we don't replace Clio); misleading if read as a *connector* |
| DMS (NetDocuments / iManage) | **GAP / NOT BUILT** | Roadmap WS-H lists it as future | Not claimed prominently on the site; lower priority |
| Word / Outlook add-in surface | **GAP / NOT BUILT** | Roadmap WS-H "later in the phase" | Coexistence is via file/mail import, not native add-ins |

**Pillar 7 verdict: PARTIAL → mostly GAP.** Email import + Word are the real "fit." Clio (the spine of the persona's practice, named repeatedly in the research) has **no integration at all** — only the claim that Advisor Prep Hero "sits beside" it.

---

## THE MOAT

| Moat element | Status | Evidence | Gap note |
|---|---|---|---|
| Moat 1 — Confidentiality spectrum you control | **PARTIAL** | Local + BYOK verified; Assured real-but-unexercised (Pillar 5) | The differentiating "Assured" rung is the unproven one |
| Moat 2 — Radical transparency / honesty as the brand | **BUILT + verified (in-app); COMPROMISED (website)** | Egress indicator + data map + against-interest provider-exposure disclosure all proven and praised (Non-negotiable #3/#4). **BUT** the website oversells "SSO" (doesn't exist) and still leaks `jamesondaines@outlook.com` in the contact-form error (`website/index.html:747,750`) even though the in-app name leak was fixed (F-119) | Honesty is the moat; the marketing site currently contains a claim (SSO) the product can't back and a personal-email leak — exactly the overclaim the vision warns "inverts the moat into a liability" |
| Moat 3 — Data gravity | **BUILT but unverified** | The ingest + index machinery that creates gravity exists; but it's unproven end to end (F-415), and OCR gaps + no-live-import mean a lawyer's *whole* practice isn't yet provably ingestable | Gravity only compounds once ingest+recall demonstrably works on a real machine |
| Moat 4 — Proof that compounds (named attorneys, CLE, assurance) | **GAP / NOT BUILT** | Design-partner recruiting was **deliberately dropped** (STATUS line 116); no named attorney advocates; no CLE; no executed assurance; no formed entity | The vision and the persona both say this gates firm adoption ("show me three lawyers I respect"). Zero proof exists. This is the slowest moat and it hasn't started |

**Moat verdict: PARTIAL, with the proof leg empty.** The structural moat (confidentiality + honesty in-app) is largely real and is the product's genuine edge. But the website currently *damages* the honesty moat (SSO claim + name leak), data gravity is unproven, and the social-proof moat — which the research says is decisive in law — does not exist at all.

---

## GAPS TO CLOSE (prioritized)

Each tagged: **[blocks-the-wedge]** / **[blocks-a-website-claim]** / **[firm-tier]** / **[nice-to-have]**.

1. **Bundle the embedder model (or guarantee first-run download).** `[blocks-the-wedge]` The flagship — cited AI recall over your own email/docs — has never been seen working end to end on a real machine because the e5-small ONNX isn't bundled (`native-findings.md` F-415). *Recommendation: ship the model in the installer; the wedge must work offline on first launch.*

2. **OCR for scanned PDFs.** `[blocks-the-wedge]` Scanned filings are detected and then ignored — invisible to search (`pdf-extract.ts:23`). For a litigation ICP this is a real hole in "ingest everything." *Recommendation: add a local OCR sidecar (Tesseract) per the roadmap's WS-B; it's already named as "future" in `sidecars/README.md`.*

3. **Remove or build "SSO."** `[blocks-a-website-claim]` The site and in-app pricing sell "Admin console with SSO" (`website/index.html:619`, `pricing.ts:123`); there is no SSO/SAML/OIDC code. *Recommendation: either drop "SSO" from the copy now (cheapest, protects the honesty moat) or build OIDC against the firm backend before re-claiming it.*

4. **Fix the website honesty leaks.** `[blocks-a-website-claim]` The contact-form error still prints `jamesondaines@outlook.com` (`website/index.html:747,750`) although the app was scrubbed (F-119). Same firm-sale risk the persona flagged. *Recommendation: replace with support@keepance.com on the site to match the app.*

5. **Validate the litigation associate with a real attorney.** `[firm-tier]` The contradiction finder has never produced its planted contradictions on a real machine, and no attorney has judged output quality; design-partner recruiting was dropped. *Recommendation: run one populated-index session end to end (post-embedder-bundle), then get one attorney to review the .docx output before un-drafting the templates.*

6. **PDF export without a LibreOffice dependency.** `[nice-to-have]` `convert_docx_to_pdf` silently needs an installed LibreOffice (`fs.rs:196`). A lawyer without it gets no PDF. *Recommendation: bundle a headless converter or a pure-Rust DOCX→PDF path; at minimum detect-and-explain.*

7. **Clio coexistence honesty.** `[blocks-a-website-claim]` "It fits beside Clio" reads as integration; it's only positioning (no connector). *Recommendation: keep the "we sit beside Clio, we don't replace it" philosophy, but don't imply a connector until WS-H ships one.*

8. **Encrypted vault for workspace documents.** `[firm-tier]` Document files are plaintext on disk (lean on OS FDE). Vision calls for an optional encrypted vault. *Recommendation: optional at-rest encryption for the workspace folder, or make the FDE nudge unmissable.*

9. **Firm key-handshake choreography.** `[firm-tier]` Member's first open looks broken until an admin republishes (F-123/F-010). *Recommendation: auto-publish on member device registration, or show a "waiting for admin to grant access" state.* (Routed to the fix wave.)

10. **Social proof + legal entity + executed DPA/SOC 2.** `[firm-tier]` The proof moat is empty and the assurance docs are templates pending a formed entity. *Recommendation: this is the board-level, slow work the vision says gates firm adoption — start it; it cannot be coded.*

---

## VERDICT (blunt)

**About two-thirds of the north-star vision is real today, and the third that's real is the hard two-thirds.** The genuinely impressive part: the in-house Word/track-changes engine, the AI redline round-trip, the matter-scoped retrieval+citation-verify engine, the refuse-rather-than-hallucinate behavior, encryption-at-rest (proven verbatim), the privilege exclusion, the honest egress/data-map trust layer, and a fully-built E2EE firm tier with ethical walls by key denial — these exist, and most were proven on a real desktop build or by adversarial test. The product's soul (confidentiality you control and can prove, Word-native deliverables, propose-don't-decide AI) is shipped, not aspirational. The persona's verdict captures it: "the best story I have ever seen in legal software," adoptable solo-on-local today.

But the gap between the story and the shipped thing is concentrated in five places that matter disproportionately: **(1)** the wedge's positive path — a cited AI answer over your own indexed mail — has *never been observed working end to end on a real machine* because the embedder model isn't bundled `[blocks-the-wedge]`; **(2)** there is *no OCR*, so scanned litigation filings are silently unsearchable `[blocks-the-wedge]`; **(3)** the website sells *SSO* that does not exist in any line of code `[blocks-a-website-claim]`; **(4)** "fits beside *Clio*" is positioning with *zero integration* behind it, despite Clio being the named spine of the target practice `[blocks-a-website-claim]`; and **(5)** the *proof moat is empty* — no named attorneys, no CLE, no executed DPA/SOC 2, no legal entity — which the research says is exactly what gates the firm sale `[firm-tier]`. Close #1 and #2 and the wedge is finally demonstrably real; fix #3 and #4 and the honesty moat stops leaking; #5 is the slow board-level work that no amount of code replaces.
