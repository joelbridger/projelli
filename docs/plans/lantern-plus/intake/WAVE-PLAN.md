# Lantern Intake — Wave Plan
**Author:** dedicated Intake design session (Fable 5), 2026-07-10.
**Altitude note:** this is the program plan (the MASTER-PLAN altitude). Each wave gets its own detailed executable plan (the `2026-07-02-wave-N` template: per-task TDD checkboxes, File Structure table, VERIFY-LIVE register, gate/merge ritual as the final task) written at dispatch time by the wave's lead, from this document plus `PRODUCT-DESIGN.md` and `ARCHITECTURE.md`.

## Execution model (the house pattern)

- **Build = Codex lanes** (`codex-task`, own worktree, own cargo target dir per concurrent Rust lane, DONE-EXIT sentinel, liveness-watched). **Review = Claude** (Opus 4.8 · high as wave lead/reviewer; Fable only if a lane stalls on E2EE correctness). Codex never solo-reviews its own work.
- **Branching:** program branch `lp/intake` off `lp/ux-simplify-v1` (worktree `~/lp-intake`), matching the Calendly (`feat/calendly-scheduling`, `~/lp-calendly`) and Schwab-prefill (`feat/schwab-prefill`, `~/lp-schwab-prefill`) siblings. Wave lanes branch `lp/intake-w<N>-<slug>` off `lp/intake`, merge back `--no-ff` after review. Never push `keepance-3.0`.
- **Gate per wave:** `npm run gate` green (typecheck + i18n + vitest + ESLint + cargo) with tail-output evidence in the merge note; `codex-review --base lp/intake "<wave risk list>" < /dev/null` adversarial pass; backend tests (`backend/` bun tests) for relay waves; **Legion bench verification** for anything client-facing (reserve in `~/keepance-coordination/PARALLEL-EFFORTS.md`; screenshots into the merge note). UI work is co-governed by `../2026-07-02-UI-INTEGRATION-SPEC.md` §5 (frontend-design skill + screenshots + click-counts).
- **Global constraints (inherit all of `../2026-07-02-MASTER-PLAN.md`):** never rename `matter`/`matter_id`; AI proposes → advisor approves; intent/outcome audit rows; light theme; user-facing copy says client/household, no em dashes; no time estimates; robust-no-shortcuts (this is core product); **E2EE bar is absolute for the link machinery — any lane that can't meet it stops and escalates rather than shipping a server-readable path.** Exactly two sanctioned exits exist, each explicitly marked, audited, and honestly labeled: the email fallback channel (Wave 3) and the DocuSign sign stage (Wave 9, desktop→DocuSign directly, never proxied through our relay). Nothing else leaves the envelope.
- **Privacy proof is a standing gate, not a wave:** from Wave 1 onward a machine-checked test (same idea as the Calendly plan's Phase-4 booking-safe-payload test) asserts that the honest client page's request/storage surface contains no plaintext client-submitted values, file names, or client names, and that no `restricted`-tier fact ever ships outbound to the page — scoped to honest-client behavior, since no test can prove an arbitrary sender encrypted (the page-integrity gate below covers the other half). Advisor-opted outbound prefills (Wave 8+) are the one sanctioned page-visible value class and are excluded by construction, not by loosening the test. Every later wave keeps it green.

## Wave roll-up

| Wave | Delivers | Size | Ships alone? |
|---|---|---|---|
| 1 | The honest slice: send link → client completes the 5 locked items (typed fields, license uploads, guided questions) → E2EE round trip → files in client folder, facts in encrypted store, checklist state on the client page | XL | Yes — a real firm can onboard a real client with it |
| 2 | Onboarding board + nudge engine + link lifecycle UI | L | Yes |
| 3 | Email-native fallback (ingest → match → advisor confirm) | L | Yes |
| 4 | Document Detective (both tiers) + income/spending extraction | M | Yes |
| 5 | Phone-walkthrough mode + welcome journey + multi-advisor key sharing/escrow | M | Yes |
| 6 | Onboarding analytics + hardening + IT-gatekeeper pack integration | S–M | Yes |
| 7 | Standing form requests for existing clients (Addendum 1): request composer from the client page, blueprints, requests-board generalization | M | Yes |
| 8 | Custodian/vendor PDF pipeline: AcroForm import → field map → fact-prefill → client-side fill + seal; honest flat-scan path | L | Yes |
| 9 | The sign stage: DocuSign envelope **send** (new build — today's connector is read-only) + native click-to-sign assessment for firm-internal forms | M–L | Yes |
| 10 | Lantern-native form builder (constrained: items in a request, never a survey tool) | M | Yes |

Dependencies: 2–6 all sit on Wave 1's rails. 3 and 4 share the extraction/proposal card patterns (build 3 before 4). 5 and 6 are independent of 3–4. Waves 7–10 (the Addendum 1 generalization) sit on Wave 1's forward-compatible `FormRequest` schema and Wave 2's board; 8–10 are independent of each other after 7, except 9 consumes 8's filled PDFs when both exist. DocuSign credentials (Jameson's vendor task) gate Wave 9's ship, not its build.

## Status ledger — synced 2026-07-12

- [x] **W1-W10 are landed in the main program fold:** `f4c66ce8` merged the
  complete intake program, its fixes, and the scrub seam into
  `lp/ux-simplify-v1`.
- [x] **Wave 9 DocuSign signing is landed:** `698ff0d8` merged the signing
  batch, including the advisor, client-page, and signing-broker lanes.
- [x] **Post-fold integration is landed:** the ten-feature batch is
  `052ecf5f`; dated evidence is `871f9e45`; firm meeting templates are
  `cf289dfd`; and reviewed meeting-note delivery is `8105d3c8`.
- [x] **Mail re-index repair follow-ups are landed:** `63a93502` and
  `92898bdc`.
- [ ] **Firm relay remains pending.**
- [ ] **Offline Mode remains pending.**

These entries describe merged source only. They do not say the related vendor
credentials are configured, that a release has shipped, or that either pending
item is complete.

---

## Wave 1 — the smallest honest slice (locked by the brief)

**Goal:** an advisor presses New client, sends a link; the client completes DOB, SSN, license front/back, income, spending on their phone; everything round-trips E2EE; files land in the client's folder, typed facts in the encrypted store, and the checklist state shows on the client's page.

**Lanes (Codex, parallelizable after Lane A lands contracts):**
- **A. Contracts + crypto core** (TS, the only lane other lanes wait on): `src/platform/intake/types.ts` (`ClientFact` with the full versioned fact-kind registry — ARCHITECTURE.md §9 verbatim, including the not-yet-collected Schwab-needed kinds — **and the `FormRequest`/`RequestItem` schema of §9a with `schema_version`, `kind`, and the later item types declared now** — Waves 7–10 then evolve the schema additively with no migration of existing data, per §9a's forward-compat definition), link fragment codec, HKDF derivations, and the **intake sibling wrapper** of the `keyWrap.ts`/`matterCrypto.ts` constructions (the existing functions hardcode matter contexts and device-key unwrap; intake gets its own module with `intake/*` HKDF info + AAD and intake-keychain unwrap). Pure functions, exhaustive vitest round-trip + tamper tests (wrong AAD, cross-context wrap/unwrap must fail both directions, chunk reorder/transplant across items/intakes/submissions must fail, duplicate `submission_id` rejected, and the replay-relabel case: same ciphertext re-posted under a new plaintext `submission_id` must be rejected on the sealed-vs-plaintext id mismatch).
- **B. Relay** (backend TS): `backend/src/routes/intake.ts` + tables + rate limiting + caps + uniform-410 semantics + ack-deletes-ciphertext, per ARCHITECTURE.md §3. Bun tests including the standing privacy-proof test.
- **C. Client page** (new static SPA workspace, e.g. `intake-page/`): mobile-first checklist UI per PRODUCT-DESIGN.md §6 (one item per screen, camera-first capture, masked SSN entry, "I don't know", replace-this-answer, save/resume, write-only confirmations, WebCrypto feature gate with sensitivity-routed fallback, completion page v0). Light theme, firm name + accent from the sealed checklist. Playwright suite **including an automated accessibility pass (axe) — older clients are the target user, so WCAG basics gate Wave 1, not Wave 6.**
- **D. Advisor-side** (TS + a little Rust): compose flow on the New client path (`NewClientDialog` extension + minimal checklist editor with the locked template), link mint (keychain writes), **link controls (copy again / extend / revoke / regenerate — the leaked-link answer must ship with the first link ever sent)**, **minimal manual fact entry (advisor types a value with `channel:'manual'` provenance — this is what makes the client page's "call [advisor] and do it together" fallback for restricted fields honest in Wave 1; full phone-walkthrough mode remains Wave 5)**, `IntakeSyncClient` (inbox → unwrap → route → ack-last, replay/duplicate flagging), SQLCipher facts store (new `src-tauri/src/commands/intake/` following the CRM store pattern), files → `WorkspaceService` → client folder, Onboarding tab v0 on `MatterHub` (`HUB_TABS` + checklist state list with provenance chips + masked facts + reveal-audits).
- **E. Hosting** (infra, small): static page deploy + relay deploy, CSP/referrer headers per ARCHITECTURE.md §4, **versioned bundle with published hashes + a deploy-time integrity check that fails the deploy if the served bundle differs from the signed manifest (ARCHITECTURE.md §8 T3 — this is a Wave 1 gate, not a roadmap item).**

**Interfaces produced (cross-wave contracts):** `ClientFact` + `factsStore` accessor (consumed by Schwab prefill and every later wave); intake relay wire contract in `backend/src/contract.ts` + mirrored `src/platform/firm/contract.ts` style; `intakeStore` checklist-state shape (consumed by the board in Wave 2).

**Gate:** `npm run gate` + backend tests + Playwright (page) + privacy-proof test green; codex adversarial review with an explicit E2EE attack prompt; **Legion bench:** drive the real page from a phone-sized browser against a staged relay, complete all 5 items including camera uploads, verify decrypt-and-file on the desktop app, screenshot evidence. A relay-storage dump is inspected in review to confirm nothing readable (manual once; the machine test keeps it honest thereafter).

## Wave 2 — the board and the nudges

**Goal:** the Onboarding board (PRODUCT-DESIGN.md §4) as a first-class surface in the client hub; days-stalled; nudge drafts in the advisor's voice with approve-to-send via the advisor's own connected mailbox (`mail_save_draft` rails); cadence guards (max 1 per 4 days, 3 unanswered → suggest a call); board-level link signals (expired-link attempts, anomaly flags) layered on the Wave 1 link controls; intent/outcome audit rows for every nudge send.

**Gate:** gate + codex review; bench: stall a fixture client, approve a nudge, verify the sent mail and audit pair; UI-spec §5 evidence.

## Wave 3 — email-native fallback

**Goal:** a client reply to the advisor's normal email gets ingested (existing mail rails: `EncryptedMailStore`, `mail_get_attachment`), matched deterministically (sender ∈ intake client's addresses ∧ active intake ∧ open items only, with in-thread replies ranked above cold messages), then split by DKIM/DMARC authentication into two paths: authenticated → confidence-tiered proposal card; failed/missing auth → quarantined manual-only card (nothing pre-selected, no one-click accept, loud warning). **Never silently filed** on either path. Accept files attachments to the client folder (net-new attachment-persist path), writes facts with `channel:'email_reply'` + `confirmed_by`, ticks the checklist, writes audit pairs. Non-E2EE channel labeling everywhere (provenance chips, privacy explainer).

**Gate:** gate + codex review focused on mis-filing attacks (spoofed sender, look-alike addresses, replies against completed intakes); bench: real mailbox round trip on the Legion.

## Wave 4 — Document Detective + extraction

**Goal:** Tier 1 in-browser classification (deterministic rules; wrong-doc and wrong-side-of-license catches with the "keep it anyway" escape) in the client page; Tier 2 advisor-side AI verification + income/spending extraction proposals from uploaded/emailed documents (tax returns, pay stubs, statements) landing as facts with `channel:'doc_extraction'`, `verification:'document_verified'`, source refs to document + page. All propose-then-approve.

**Gate:** gate + codex review; extraction accuracy spot-check on the fixture document set; bench: upload a wrong document on the page, see the Tier-1 catch live.

## Wave 5 — phone mode, welcome journey, firm key sharing

**Goal:** phone-walkthrough mode (advisor fills the same checklist in-app; provenance `phone_walkthrough`, interleaves freely with the link; supersedes Wave 1's minimal manual fact entry); the firm-authored what-happens-next page (template editor + rendering on completion, P7); intake private-key wrapping to matter member devices + org-admin escrow via `wrapped_matter_keys` machinery (removes the v1 lost-machine caveat). Tier decision (2026-07-10): the multi-advisor sharing/escrow parts are Firm-tier features; intake itself ships on all paid tiers.

**Gate:** gate + codex review with a key-sharing attack prompt (wrong-member wrap, ex-member epoch behavior mirroring `bumpMatterKeyEpoch` semantics); bench: two-advisor decrypt of one intake.

## Wave 6 — analytics, hardening, IT pack

**Goal:** board KPI strip (avg days-to-complete, stalled count, completion rate — computed locally from intake state); load/abuse hardening pass on the relay (rate-limit tuning, quota telemetry-without-content); the IT-gatekeeper pack section for Intake (architecture one-pager + honest metadata list from ARCHITECTURE.md §3, folded into the existing pack effort); accessibility audit of the client page (older clients are the point).

**Gate:** gate + codex review; accessibility pass evidence; a soak/abuse test against a staged relay.

## Wave 7 — standing form requests (the Addendum 1 generalization ships)

**Goal:** "Request from client" on any client page: pick a firm blueprint (saved item sets, the New household template becomes the first blueprint), tweak, send — the same E2EE link, nudges, provenance, and filing now serving year-three asks. The board becomes the **requests board** with Onboarding as its flagship filtered view; the per-client tab lists all requests. Returned artifacts continue landing under `Requests/<request-slug>/` — the convention Wave 1 already established (onboarding = `Requests/onboarding/`), so nothing re-files.

**Gate:** gate + codex review; bench: send a standing request to a fixture client, complete it, verify filing + board state alongside an active onboarding.

## Wave 8 — custodian/vendor PDF pipeline

**Goal:** advisor imports a fillable PDF (Schwab-style AcroForm): advisor-side parse → field map editor (map fields to fact kinds and item types) → prefill from `ClientFact`s (each prefilled value carries its fact_id) → client page renders mapped fields as ordinary one-at-a-time items → filled PDF regenerated client-side and sealed (ARCHITECTURE.md §9a — the document never leaves the E2EE envelope). Flat scanned PDFs get the honest path only: advisor-side overlay or attach-print-sign-photograph; no pretend-parsing.

**Gate:** gate + codex review with a field-mapping attack prompt (mis-mapped SSN into a visible field, prefill leaking a restricted fact into a low-sensitivity item); bench: real Schwab PDF round trip on the Legion; privacy-proof test extended to pdf_fill payloads.

## Wave 9 — the sign stage

**Goal:** a request can end in a signature. DocuSign grade: **envelope sending is a new write-capable lane** — the shipped connector (`src-tauri/src/commands/docusign/client.rs`, `src/platform/connectors/docusign/`) is read-only today, so this wave builds it, against sandbox, shipping when Jameson's vendor-credential task lands. Hard exit rules: explicit advisor approval before any plaintext leaves the E2EE flow; intent audit row written before upload (CRM-engine pattern — refuse the send if the audit append fails); upload goes **directly from the desktop to DocuSign, never through our relay**; completed envelopes pull back into the vault-encrypted client folder with the outcome audit row. Native click-to-sign assessment: scope the E2EE-preserving typed-name + affirmation + audit grade for firm-internal forms and recommend build/skip with evidence (worth building only if design-partner firms actually have internal-only signing needs).

**Gate:** gate + codex review with an exit-boundary attack prompt (any path where a document could transit our relay in plaintext must fail the review); DocuSign sandbox round trip; honesty-card copy reviewed against RISKS.md §2 claims discipline.

## Wave 10 — the native form builder (constrained)

**Goal:** compose custom items beyond the built-ins — inside a request, never a standalone survey product (the JotForm-ification guard, board stance). Item palette = the existing types + labels/help text/validation; saved as firm blueprints; no conditional logic in the first cut.

**Gate:** gate + codex review; UI-spec §5 evidence; a blueprint authored by a non-engineer (Jameson) in the bench session without docs.

---

## Composition with the sibling plans (the Onboarding OS chain)

- **Calendly plan** (`docs/plans/calendly-scheduling-plan.md`): booking is the step *before* intake. Composition hook (post-Wave-2): a completed booking for a new prospect offers "start onboarding" → New client + intake compose. Shared rail: the public static page + relay pattern (its `book.<domain>` page and our intake page are siblings; keep headers/CSP/hosting conventions identical).
- **Schwab-prefill plan** (`docs/plans/schwab-account-opening-plan.md`): the paperwork stage *after* intake. Its prefill mapping (plan step 2) consumes `ClientFact` rows with the fact_id recorded per filled field — that is "ask once" made real. The contract work happens in Wave 1 Lane A: the fact-kind registry is defined in full there (including `address`, `citizenship`, `beneficiary` — kinds Schwab needs that v1 intake doesn't collect yet), it is versioned, and prefill consumers read restricted facts only through the accessor's masking-and-audit policy. Schwab's plan consumes the registry; it does not define it.
- **DocuSign** (code-complete connector, credential-gated): collect (Intake) → prefill (Schwab plan) → sign (Wave 9) becomes the one-pipeline story once vendor credentials land. The Schwab-prefill plan's filled-PDF delivery and Wave 8's client-side PDF fill are the same field-map machinery pointed at two fillers (advisor-side vs client-side) — build the map format once, in Wave 8's design, and hand it to the Schwab lane.

## VERIFY-LIVE register (program level)

- Real iOS Safari and Android Chrome camera-capture behavior on the live page (not just Playwright emulation) — Wave 1 bench.
- Real relay under TLS with production headers (CSP, no-referrer) — confirm fragment never appears in any log — Wave 1 deploy check.
- Mail-provider quirks for the email fallback (Gmail/Graph attachment edge cases) against real mailboxes — Wave 3.
- Keychain behavior for intake keys on real Windows (Credential Manager) on the Legion — Wave 1.
