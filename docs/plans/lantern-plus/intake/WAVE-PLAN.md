# Lantern Intake — Wave Plan
**Author:** dedicated Intake design session (Fable 5), 2026-07-10.
**Altitude note:** this is the program plan (the MASTER-PLAN altitude). Each wave gets its own detailed executable plan (the `2026-07-02-wave-N` template: per-task TDD checkboxes, File Structure table, VERIFY-LIVE register, gate/merge ritual as the final task) written at dispatch time by the wave's lead, from this document plus `PRODUCT-DESIGN.md` and `ARCHITECTURE.md`.

## Execution model (the house pattern)

- **Build = Codex lanes** (`codex-task`, own worktree, own cargo target dir per concurrent Rust lane, DONE-EXIT sentinel, liveness-watched). **Review = Claude** (Opus 4.8 · high as wave lead/reviewer; Fable only if a lane stalls on E2EE correctness). Codex never solo-reviews its own work.
- **Branching:** program branch `lp/intake` off `lp/ux-simplify-v1` (worktree `~/lp-intake`), matching the Calendly (`feat/calendly-scheduling`, `~/lp-calendly`) and Schwab-prefill (`feat/schwab-prefill`, `~/lp-schwab-prefill`) siblings. Wave lanes branch `lp/intake-w<N>-<slug>` off `lp/intake`, merge back `--no-ff` after review. Never push `keepance-3.0`.
- **Gate per wave:** `npm run gate` green (typecheck + i18n + vitest + ESLint + cargo) with tail-output evidence in the merge note; `codex-review --base lp/intake "<wave risk list>" < /dev/null` adversarial pass; backend tests (`backend/` bun tests) for relay waves; **Legion bench verification** for anything client-facing (reserve in `~/keepance-coordination/PARALLEL-EFFORTS.md`; screenshots into the merge note). UI work is co-governed by `../2026-07-02-UI-INTEGRATION-SPEC.md` §5 (frontend-design skill + screenshots + click-counts).
- **Global constraints (inherit all of `../2026-07-02-MASTER-PLAN.md`):** never rename `matter`/`matter_id`; AI proposes → advisor approves; intent/outcome audit rows; light theme; user-facing copy says client/household, no em dashes; no time estimates; robust-no-shortcuts (this is core product); **E2EE bar is absolute — any lane that can't meet it stops and escalates rather than shipping a server-readable path.**
- **Privacy proof is a standing gate, not a wave:** from Wave 1 onward a machine-checked test (same idea as the Calendly plan's Phase-4 booking-safe-payload test) asserts the relay request/storage surface for intake contains no plaintext field values, file names, or client names. Every later wave keeps it green.

## Wave roll-up

| Wave | Delivers | Size | Ships alone? |
|---|---|---|---|
| 1 | The honest slice: send link → client enters the 5 locked fields + uploads → E2EE round trip → files in client folder, facts in encrypted store, checklist state on the client page | XL | Yes — a real firm can onboard a real client with it |
| 2 | Onboarding board + nudge engine + link lifecycle UI | L | Yes |
| 3 | Email-native fallback (ingest → match → advisor confirm) | L | Yes |
| 4 | Document Detective (both tiers) + income/spending extraction | M | Yes |
| 5 | Phone-walkthrough mode + welcome journey + multi-advisor key sharing/escrow | M | Yes |
| 6 | Onboarding analytics + hardening + IT-gatekeeper pack integration | S–M | Yes |

Dependencies: 2–6 all sit on Wave 1's rails. 3 and 4 share the extraction/proposal card patterns (build 3 before 4). 5 and 6 are independent of 3–4.

---

## Wave 1 — the smallest honest slice (locked by the brief)

**Goal:** an advisor presses New client, sends a link; the client completes DOB, SSN, license front/back, income, spending on their phone; everything round-trips E2EE; files land in the client's folder, typed facts in the encrypted store, and the checklist state shows on the client's page.

**Lanes (Codex, parallelizable after Lane A lands contracts):**
- **A. Contracts + crypto core** (TS, the only lane other lanes wait on): `src/platform/intake/types.ts` (`ClientFact`, intake/item/state types — ARCHITECTURE.md §9 verbatim), link fragment codec, HKDF derivations, seal/unseal built on `keyWrap.ts` + `matterCrypto.ts` with intake context strings. Pure functions, exhaustive vitest round-trip + tamper tests (wrong AAD, wrong epoch/context, chunk reorder must all fail).
- **B. Relay** (backend TS): `backend/src/routes/intake.ts` + tables + rate limiting + caps + uniform-410 semantics + ack-deletes-ciphertext, per ARCHITECTURE.md §3. Bun tests including the standing privacy-proof test.
- **C. Client page** (new static SPA workspace, e.g. `intake-page/`): mobile-first checklist UI per PRODUCT-DESIGN.md §6 (one item per screen, camera-first capture, masked SSN entry, "I don't know", save/resume, write-only confirmations, WebCrypto feature gate, completion page v0). Light theme, firm name + accent from the sealed checklist. Playwright suite.
- **D. Advisor-side** (TS + a little Rust): compose flow on the New client path (`NewClientDialog` extension + minimal checklist editor with the locked template), link mint (keychain writes), `IntakeSyncClient` (inbox → unwrap → route → ack-last), SQLCipher facts store (new `src-tauri/src/commands/intake/` following the CRM store pattern), files → `WorkspaceService` → client folder, Onboarding tab v0 on `MatterHub` (`HUB_TABS` + checklist state list with provenance chips + masked facts + reveal-audits).
- **E. Hosting** (infra, small): static page deploy + relay deploy, CSP/referrer headers per ARCHITECTURE.md §4.

**Interfaces produced (cross-wave contracts):** `ClientFact` + `factsStore` accessor (consumed by Schwab prefill and every later wave); intake relay wire contract in `backend/src/contract.ts` + mirrored `src/platform/firm/contract.ts` style; `intakeStore` checklist-state shape (consumed by the board in Wave 2).

**Gate:** `npm run gate` + backend tests + Playwright (page) + privacy-proof test green; codex adversarial review with an explicit E2EE attack prompt; **Legion bench:** drive the real page from a phone-sized browser against a staged relay, complete all 5 items including camera uploads, verify decrypt-and-file on the desktop app, screenshot evidence. A relay-storage dump is inspected in review to confirm nothing readable (manual once; the machine test keeps it honest thereafter).

## Wave 2 — the board and the nudges

**Goal:** the Onboarding board (PRODUCT-DESIGN.md §4) as a first-class surface in the client hub; days-stalled; nudge drafts in the advisor's voice with approve-to-send via the advisor's own connected mailbox (`mail_save_draft` rails); cadence guards (max 1 per 4 days, 3 unanswered → suggest a call); link controls UI (extend/revoke/regenerate/copy); expired-link signal on the board; intent/outcome audit rows for every nudge send.

**Gate:** gate + codex review; bench: stall a fixture client, approve a nudge, verify the sent mail and audit pair; UI-spec §5 evidence.

## Wave 3 — email-native fallback

**Goal:** a client reply to the advisor's normal email gets ingested (existing mail rails: `EncryptedMailStore`, `mail_get_attachment`), matched deterministically (sender ∈ intake client's addresses ∧ active intake ∧ open items only), classified with confidence tiers, and presented as a proposal card — **never silently filed**. Accept files attachments to the client folder (net-new attachment-persist path), writes facts with `channel:'email_reply'` + `confirmed_by`, ticks the checklist, writes audit pairs. Non-E2EE channel labeling everywhere (provenance chips, privacy explainer).

**Gate:** gate + codex review focused on mis-filing attacks (spoofed sender, look-alike addresses, replies against completed intakes); bench: real mailbox round trip on the Legion.

## Wave 4 — Document Detective + extraction

**Goal:** Tier 1 in-browser classification (deterministic rules; wrong-doc and wrong-side-of-license catches with the "keep it anyway" escape) in the client page; Tier 2 advisor-side AI verification + income/spending extraction proposals from uploaded/emailed documents (tax returns, pay stubs, statements) landing as facts with `channel:'doc_extraction'`, `verification:'document_verified'`, source refs to document + page. All propose-then-approve.

**Gate:** gate + codex review; extraction accuracy spot-check on the fixture document set; bench: upload a wrong document on the page, see the Tier-1 catch live.

## Wave 5 — phone mode, welcome journey, firm key sharing

**Goal:** phone-walkthrough mode (advisor fills the same checklist in-app; provenance `phone_walkthrough`, interleaves freely with the link); the firm-authored what-happens-next page (template editor + rendering on completion, P7); intake private-key wrapping to matter member devices + org-admin escrow via `wrapped_matter_keys` machinery (removes the v1 lost-machine caveat).

**Gate:** gate + codex review with a key-sharing attack prompt (wrong-member wrap, ex-member epoch behavior mirroring `bumpMatterKeyEpoch` semantics); bench: two-advisor decrypt of one intake.

## Wave 6 — analytics, hardening, IT pack

**Goal:** board KPI strip (avg days-to-complete, stalled count, completion rate — computed locally from intake state); load/abuse hardening pass on the relay (rate-limit tuning, quota telemetry-without-content); the IT-gatekeeper pack section for Intake (architecture one-pager + honest metadata list from ARCHITECTURE.md §3, folded into the existing pack effort); accessibility audit of the client page (older clients are the point).

**Gate:** gate + codex review; accessibility pass evidence; a soak/abuse test against a staged relay.

---

## Composition with the sibling plans (the Onboarding OS chain)

- **Calendly plan** (`docs/plans/calendly-scheduling-plan.md`): booking is the step *before* intake. Composition hook (post-Wave-2): a completed booking for a new prospect offers "start onboarding" → New client + intake compose. Shared rail: the public static page + relay pattern (its `book.<domain>` page and our intake page are siblings; keep headers/CSP/hosting conventions identical).
- **Schwab-prefill plan** (`docs/plans/schwab-account-opening-plan.md`): the paperwork stage *after* intake. Its prefill mapping (plan step 2) consumes `ClientFact` rows (`dob`, `ssn`, `address`, beneficiaries as the registry grows) with the fact_id recorded per filled field — that is "ask once" made real. The facts accessor from Wave 1 Lane A is the contract; nothing in Schwab's plan needs to change shape.
- **DocuSign** (code-complete connector, credential-gated): collect (Intake) → prefill (Schwab plan) → sign (DocuSign) becomes the one-pipeline story once vendor credentials land.

## VERIFY-LIVE register (program level)

- Real iOS Safari and Android Chrome camera-capture behavior on the live page (not just Playwright emulation) — Wave 1 bench.
- Real relay under TLS with production headers (CSP, no-referrer) — confirm fragment never appears in any log — Wave 1 deploy check.
- Mail-provider quirks for the email fallback (Gmail/Graph attachment edge cases) against real mailboxes — Wave 3.
- Keychain behavior for intake keys on real Windows (Credential Manager) on the Legion — Wave 1.
