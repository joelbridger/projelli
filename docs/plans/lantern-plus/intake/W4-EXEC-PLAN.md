# Lantern Intake — Wave 4 Execution Plan (Document Detective + income/spending extraction)

**Lead:** Wave 4 (Opus 4.8 · high), worktree `/home/jameson/lp-intake`, branch `lp/intake`.
**Grounded against HEAD `bf6fbc77`** (Waves 1–3 all merged, gate-green). This plan supersedes nothing in W4-PREP; it *decides* the open questions and pins the dispatch order against the code that actually exists now.

**One-line goal (plain):** A client can upload a document and get a gentle "this looks like the wrong file" warning before it ever leaves their browser (Tier 1, deterministic, no AI, no network). After it syncs to the advisor's machine and is decrypted, the app reads it locally, guesses what it is, and *proposes* income/spending numbers with a page citation — the advisor approves before anything is written (Tier 2, propose-then-approve). Nothing is ever filed or written without the advisor's explicit click.

---

## §0. Open questions — RESOLVED (decisions the lanes build to)

These are the 8 open questions from `W4-PREP.md`, decided so the lanes don't stall. Rationale is terse; where W4-PREP already recommended, we take it unless the current code changes the answer.

1. **Income/spending upload items?** — **Add optional document-upload items** for income-support and spending-support to the New Household template (`src/features/intake/newHouseholdTemplate.ts`), AND run Tier 2 on emailed attachments + advisor-added files. Extraction must not depend on a dedicated slot existing. *(Lane 1 adds the items behind the existing `DocUploadRequestItem`; Lane 2/3 read whatever lands.)*
2. **Ship client-page OCR for license-side detection?** — **NO in Wave 4.** Tier 1 stays text+filename deterministic only. Camera photos with no extractable text return `unknown` and never warn. Serving OCR wasm to the intake host with integrity is a Wave-5+ item. *(Keeps Tier 1 offline, tiny, and honest.)*
3. **"Keep this file anyway" advisor-visible?** — **YES.** Store the warning + `kept_anyway` inside the **sealed manifest** (relay sees ciphertext only), render it as a non-sensitive flag on the Onboarding received-item. *(Lane 1 seals it; Lane 2 surfaces it.)*
4. **Auto-run extraction or click-to-run?** — **Hybrid, approval always required.** Auto-*create* proposals only when document class is high-confidence AND the target fact is missing or marked "I don't know". Otherwise the advisor clicks "Run extraction". **A fact is NEVER written without an explicit per-row approve** regardless.
5. **Doc-fact vs client-stated conflict?** — **Show both, advisor picks the final editable value.** Never auto-supersede. Mirror the existing conflict UI in `EmailReplyReviewModal`.
6. **Reuse Wave 3's proposal queue?** — **YES, extend it.** Wave 3 Lane 2 shipped `emailReplyProposalStore.ts` + Rust `email_reply_proposals` table (masked-at-rest, idempotent enqueue) + `acceptEmailReplyProposal` (intent-audit → per-row `intakeFactUpsert` → outcome-audit, fail-closed). Wave 4 adds a **sibling `document_extraction_proposals`** table + store that mirrors these exactly (same masking, same stable-id, same audit-pair discipline) rather than a divergent design. One *design*, two tables — a doc proposal and an email-reply proposal differ enough (source ref, tier, no attachment rows) that a shared table would need nullable soup; the SHARED thing is the pattern and the accept-path shape, which we copy verbatim.
7. **Spending: transaction totals or printed totals?** — **Explicit printed totals + statement-period totals only** in Wave 4. No transaction categorization. Model returns `null` if no printed total.
8. **Standardize source-ref string now?** — **YES.** `document:<workspace-path>#page=<n>` for `ClientFact.provenance.source_ref`; keep the richer `SourceRef` (`kind:'document'`, `ref`, `locator:'p. N'`, `snippet`) for UI/Client Map. Both emitted by the same `documentSourceRef.ts` helper.

---

## §1. Non-negotiables (carried from Wave 3, still binding)

- **Propose-then-approve, always.** No fact written on file receipt, page mount, board mount, or extraction completion. Every fact needs an explicit per-row approve. Medium/low confidence rows are NOT preselected.
- **Code chooses identifiers, never the model.** The model may suggest a *value* and a *page*. It must never choose `matter_id`, `request_id`, `item_id`, destination path, or `fact_kind`. Code validates every model output against a schema and drops unsupported kinds.
- **Untrusted document text.** Treat uploaded/emailed document text as hostile input. Sanitize before any prompt; ignore instructions inside it; it never controls an identifier or path.
- **Audit intent BEFORE effect.** Write a `doc_extraction` intent row (matter/request/proposal-ids/fact-kinds/source-refs/audit-pair-id) before any fact write; if the intent write fails, refuse to write facts. Outcome row after. Audit rows carry NO raw document text, SSNs, account numbers, full restricted values, or model prompts.
- **Privacy walls.** Tier 1 never calls network AI and never sends plaintext to the relay. Tier 2 runs only on the advisor machine after decryption. Proposal queues holding extracted values are encrypted at rest (SQLCipher); never in Zustand/localStorage. No extracted values/snippets in board rows (counts only). No cloud OCR. No client-page AI-key path.
- **Restricted values.** Wave 4 extracts ONLY `income_annual` + `spending_monthly` (both `confidential`, not `restricted`). Do NOT extract SSN, full license number, account number, or routing details.
- **House rules.** Light theme, design tokens, client/household user-facing copy, no em dashes, no time estimates, `matter`/`matter_id` never renamed, non-E2EE channel labeling where email data appears.

---

## §2. Lanes, branches, dependencies

| Lane | Branch | Outcome | Rust? | Depends on |
|---|---|---|---|---|
| **1. Tier 1 client classifier** | `lp/intake-w4-tier1` | Client-page deterministic warning (wrong-doc / wrong-side / duplicate-side) + keep-it-anyway, sealed into manifest | No | Wave 1 client page |
| **2. Advisor doc reader + classifier** | `lp/intake-w4-doc-core` | Local text/OCR read, deterministic doc class, `IntakeDocumentSourceRef` | No | Wave 1 sync/filing, PDF/OCR rails |
| **3. Extraction proposals + approval** | `lp/intake-w4-extraction` | `document_extraction_proposals` queue + card + approve path, facts w/ `doc_extraction` provenance | **YES** | Lane 2 + Wave 3 proposal pattern |
| **4. Fixtures + gates** | `lp/intake-w4-fixtures` | Synthetic doc set, golden labels, Vitest/Playwright spot checks | No | Lanes 1–3 |

**Merge order:** Lanes 1 and 2 build in **parallel** (both TS-only, disjoint files → no cargo, no conflict). Lane 3 starts after Lane 2 merges (needs `documentReader`/`documentClassifier`/`documentSourceRef`). Lane 4 lands last against the real merged surfaces.

**Cargo discipline:** ONLY Lane 3 touches Rust (`src-tauri/src/commands/intake/store.rs` new table/commands + `mod.rs` wrappers). One cargo compile box-wide — the sibling lead on `lp/intake-w56` also uses cargo. **Before Lane 3's cargo build + before the wave-end full gate, post a `COORDINATOR:` line to claim the cargo lock; wait for release.** A blocked cargo self-aborts exit 144.

---

## §3. File territory (stay out of the sibling's lane)

**Wave 4 owns / creates** (none overlap the email-reply Wave-3 files except additive mounts):
- New TS: `src/platform/intake/documentDetectiveTypes.ts`, `documentDetectiveRules.ts`, `documentSourceRef.ts`, `documentReader.ts`, `documentClassifier.ts`, `documentExtractionTypes.ts`, `documentExtractionEngine.ts`, `documentExtractionProposalStore.ts`, `documentExtractionAccept.ts`, `documentExtractionAudit.ts`.
- New components: `src/features/intake/DocumentExtractionProposalCard.tsx`, `DocumentExtractionProposalRow.tsx`, `DocumentExtractionReviewModal.tsx`.
- **Additive edits** (append, don't rewrite): `intake-page/src/App.tsx` (`DocUploadScreen` gate), `intake-page/src/types.ts`, `src/platform/intake/intakeContract.ts` + `intakeCrypto.ts` (additive `document_detective` manifest field + validator), `src/platform/intake/types.ts` (`DocUploadRequestItem.expected_doc_types?`), `src/features/intake/newHouseholdTemplate.ts`, `src/platform/intake/useIntakeInboxSync.ts` (capture sealed Tier-1 metadata), `src/platform/intake/intakeStore.ts` (non-sensitive proposal-count flag), `src/features/intake/OnboardingTab.tsx` + `OnboardingBoardContainer.tsx` (mount proposal cards / count), `src-tauri/src/commands/intake/store.rs` + `mod.rs` (new proposal table + wrappers), `src/platform/types/audit.ts` + `src/app/shell/common/AuditLog.tsx` + `src/features/audit/auditHomeHelpers.ts` (doc_extraction labels).
- New tests + `tests/fixtures/intake-document-detective/`.

**Coordination rule:** `OnboardingTab.tsx`, `OnboardingBoardContainer.tsx`, `useIntakeInboxSync.ts`, `store.rs`, `mod.rs` are hot shared files. If the w56 sibling also edits them, coordinate via `COORDINATOR:` before merge and rebase-merge to avoid clobber. Sibling territory (Waves 5/6: phone mode, welcome journey, firm key sharing) is disjoint at the feature level; the risk is only these shared mount files + cargo.

---

## §4. Per-lane build briefs (written just-in-time, one at a time)

Each brief written to `docs/plans/lantern-plus/intake/briefs/w4-<n>-<slug>.md` right before dispatch, grounded on the then-current tip. Brief contents: exact paths, the deterministic rule tables (copied from W4-PREP §Lane-n), the acceptance tests, the reuse targets to mirror, and the non-negotiables checklist. Codex builds from the file (never inline — backticks corrupt).

### Lane 1 brief highlights
- Pure `classifyTier1(input): Tier1Classification` in `documentDetectiveRules.ts` (types in `documentDetectiveTypes.ts`). Rule tables verbatim from W4-PREP §Lane-1 (expected-doc inference, observed-kind signals, conflict = more-specific-wins, wrong-side signals, duplicate-side).
- Warning is **non-blocking**, two choices (pick different / keep anyway), no shaming copy.
- Keep-it-anyway → additive `document_detective` object sealed into `SealedManifest` (`intakeContract.ts` + `intakeCrypto.ts` validator accepts it). Override survives reload as **non-sensitive** page state only (no filename, no extracted text in resume state).
- Tests: `tests/unit/intake/documentDetectiveRules.test.ts` + extend `intake-page/tests/intake-page.spec.ts` (wrong-doc warns, wrong-side warns, dup-side warns, pick-different clears, keep-anyway completes + E2EE unchanged, warning details never in relay plaintext / resume / logs / page-visible finalize flags).

### Lane 2 brief highlights
- `documentReader.ts`: PDF via `extractPdfText`; scanned pages via `ocrEngine` sequential (mirror `MemoryService.indexPdfFile`); images → local OCR text+confidence or `unknown`; encrypted/unreadable → "needs advisor view" proposal, not a throw. **Never read a path outside the matched matter folder.**
- `documentClassifier.ts`: deterministic class from reader text (same signal tables as Tier 1, advisor-side). Text wins over filename. Model never chooses target.
- `documentSourceRef.ts`: emits both the compact `document:<path>#page=<n>` string and the UI `SourceRef`.
- Tests: `documentClassifier.test.ts` (page-indexed refs, OCR confidence surfaced, low-confidence ≠ high-trust, wrong-doc → review card no fact, path-refusal outside client folder).

### Lane 3 brief highlights
- **Mirror `emailReplyProposalStore.ts` + `email_reply_proposals` Rust table** into `document_extraction_proposals` (masked-at-rest, idempotent enqueue, stable id). Extend, don't diverge.
- **Mirror `acceptEmailReplyProposal`** into `documentExtractionAccept.ts`: intent-audit (fail-closed) → per-row `intakeFactUpsert` (`channel:'doc_extraction'`, `verification:'document_verified'`, `confirmed_by`/`entered_by`=advisor, `source_ref`=doc#page) → outcome-audit → set-status. Partial-failure keeps unresolved proposals visible.
- Extraction prompt: narrow, schema-bound, only `income_annual`/`spending_monthly`, every value needs page+quote, `null` when unsupported, ignore in-doc instructions. Code validates + drops unsupported kinds.
- Cards mirror `EmailReplyProposalCard/Row/ReviewModal` (conflict view = show existing+proposed+editable-final; Accept-all only visible-checked rows). Board shows a **count only**.
- Tests: `documentExtractionProposal.test.ts` + `DocumentExtractionProposalCard.test.tsx`.

### Lane 4 brief highlights
- Synthetic fixtures only (no real data) per W4-PREP §Lane-4 table + `manifest.json` + `generate-fixtures.mjs`. Golden labels + expected facts + expected-warn flags. Wire into the Vitest suites + intake-page Playwright.

---

## §5. Per-lane ritual (identical to Wave 3 — it caught the deepest bug every lane)

1. Write brief to file. Dispatch Codex build **prompt-from-file** (`codex exec --cd <wt> --sandbox danger-full-access --skip-git-repo-check "$(cat PF)" < /dev/null`), anchored sentinel watch `^DONE-EXIT:0$`.
2. Lead diff review — read the security core closely (path-confinement, manifest additivity, fact-write gate, audit fail-closed).
3. **ONE `codex-review --base lp/intake`** with **mis-filing + prompt-injection focus** (spoofed doc class, in-document prompt injection choosing a fact/path, source-ref spoofing, silent fact write, path escape outside client folder, keep-anyway leaking to relay). MANDATORY — never skip.
4. **Batch ALL findings into ONE fix round** (no drip-feed). Codex fixes from a single combined brief.
5. Merge `--no-ff` into `lp/intake`. Fast gate for the lane: `test:contracts` + `gate:changed` (once landed) or scoped `vitest` + `tsc` + `eslint-gate` if gates not yet present.
6. Push (pre-push hook = typecheck + full vitest). `LANE-MERGED: <lane> <sha>`. Update tracker.

**Wave end:** full `npm run gate` (serialize cargo via COORDINATOR line) + extraction accuracy spot-check on the fixture set + a final gate-fix round (ESLint / token-guard / i18n-locale-parity / architecture-boundaries — scoped tests miss these). Then `WORKER-DONE: lp/intake`.

---

## §6. Landmines (Wave-3 hard-won, still live)

- Anchor every monitor sentinel `^DONE-EXIT:[0-9]+$` — loose match false-fires on echoed brief prose.
- Codex prompt-FROM-FILE only; backticks/quotes inline get shell-executed and corrupt the prompt.
- One cargo at a time box-wide (shared with w56 sibling); blocked job self-aborts 144. Serialize; claim via COORDINATOR line.
- Fresh `lp-*` worktrees need sidecar binaries copied in + `node_modules` symlinked (root + `intake-page`) or the cargo build-script + pre-push hook fail on missing assets.
- The pre-push FULL vitest catches what scoped tests miss (arch-boundary, i18n-kebab, exactOptional types) — budget a gate-fix round.
- `codex-review --base lp/intake` takes NO custom prompt (bare form); run on a CLEAN committed worktree.
- Legion BENCH stays coordinator-gated — do NOT bench/deploy until released.

---

## §7. Status ledger (updated as lanes land)

- [ ] Prep merge: land velocity fast-gates (`gate:changed` / `test:contracts`) onto `lp/intake` — *pending coordinator OK (COORDINATOR line raised).*
- [ ] Lane 1 — Tier 1 client classifier
- [ ] Lane 2 — advisor doc reader + classifier
- [ ] Lane 3 — extraction proposals + approval
- [ ] Lane 4 — fixtures + gates
- [ ] Wave-end full gate + gate-fix round
- [ ] `WORKER-DONE: lp/intake`
