# Lantern Intake — Wave 3 Executable Plan (email-native fallback)

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave-2 done tip `30f5f47a` (gate-green, Wave 2 + coord-fixes merged).
**Spec:** `W3-PREP.md` (374 lines — read it) + `WAVE-PLAN.md` Wave 3. **Briefs:** `briefs/w3-<lane>.md`.
**Predecessor lessons (apply from day one):** the adversarial `codex-review` pass caught the deepest bugs on EVERY Wave-2 lane (contract breaks, unreachable features, mirror-gaps) that the lead + scoped tests missed. For Wave 3 the review focus is **mis-filing attacks** (spoofed sender, look-alike address, replies vs completed/revoked intakes). Build the cross-lane + attack tests EARLY.

## 0. The 12 open questions — RESOLVED (grounded in shipped Wave 1/2 code)

| # | Question | Resolution |
|---|---|---|
| Q1 | Client/household email source of truth? | **`IntakeRecord.clientEmail`** (Wave 2 Lane 0 added it; `intakeStore.ts:54`). NOTE: only the PRIMARY email is stored — no per-household-member addresses exist. Wave 3 matches sender against `clientEmail`; a household with multiple member emails is not representable yet → treat a sender that isn't the stored `clientEmail` as **no match** (safe), and flag per-member addresses as a Wave-3 store addition ONLY if the design needs it (recommend: defer; primary-email match + quarantine-on-ambiguity). |
| Q2 | One active intake per client still invariant? | **Yes for Wave 3.** `intakeStore.getIntakeForMatter` returns ONE intake per matter; multi-`FormRequest` is Addendum 1 (Waves 7–10). Wave 3 assumes one active intake per client; if that assumption is ever violated (>1 active), **quarantine as ambiguous** rather than guess. |
| Q3 | Does Wave 2 store outbound thread/message ids? | **No.** Nudges store only the mailbox `draftId` (`nudgeSave.ts`), not a sent message-id or thread-id; the initial intake email is sent via `mailto:` (untracked). So there is **no reliable outbound thread anchor**. DECISION: Wave 3 matches on **sender + exactly-one-active-request** as the primary path. Thread-tie ranking (W3-PREP rule 6/7) is **best-effort only** using the inbound message's `In-Reply-To`/`References` if a future outbound-id capture lands; until then, **multiple active requests for one client → quarantine** (no unique tie available). Do NOT block Wave 3 on adding outbound-id capture. |
| Q4 | Which providers ship? | **M365 (Graph) + Gmail** ship with auth + attachment refs. **IMAP = body-only** (auth usually absent → quarantine; attachments unsupported this wave). |
| Q5 | IMAP attachment download now? | **No** — IMAP is body-only in Wave 3 (matches current `mail_get_attachment` "IMAP not supported"). Mark IMAP attachments unsupported in the card. |
| Q6 | `MailAuthResult` shape? | **NONE exists today** (no dkim/dmarc/spf/Authentication-Results parsing anywhere in `src-tauri/src/commands/mail/`). Lane 1 defines `MailAuthResult { dkim: 'pass'\|'fail'\|'none'; spf: 'pass'\|'fail'\|'none'; dmarc: 'pass'\|'fail'\|'none'; aligned: boolean; source: 'graph'\|'gmail'\|'imap'\|'missing' }`, parsed from `Authentication-Results`/`ARC-Authentication-Results`/`Received-SPF`. Missing/unparseable → all `'none'` (→ quarantine). |
| Q7 | Legit client, broken/missing DMARC? | **Quarantine, never normal proposal** (per recommendation). The quarantine reason line explains it plainly; the advisor can still manually file after review. |
| Q8 | Accept emailed restricted facts (SSN) after confirmation? | **Allowed, but through a stricter path:** masked preview only, explicit per-field advisor confirm, supersede handling (never silent replace of an active fact), `verification:'advisor_confirmed'`, `channel:'email_reply'`, `confirmed_by`. The facts-store contract already supports these (`types.ts:41/46/49`). Full restricted values never enter ordinary React state or audit rows. (Product note surfaced: a confidentiality-anxious ICP may prefer forcing phone re-entry for SSN — leave a config seam, default to allow-with-review.) |
| Q9 | Attachment persistence path? | **New Rust command** that fetches the provider attachment and writes it into the workspace with the same path-validation standard, WITHOUT returning bytes to the renderer (keeps large binaries out of the JS heap + one validated write). TS wrapper mirrors it. |
| Q10 | Durable proposal/quarantine queues? | **Encrypted Intake SQLCipher store** (`src-tauri/src/commands/intake/`), NOT Zustand/localStorage (restart-survival + no-plaintext rule). Proposals + quarantine rows live encrypted at rest; a thin TS accessor exposes masked reads. |
| Q11 | Audit action strings? | Add **`intake_email_reply`** to `AuditActionType` with `phase:'intent'\|'outcome'` + `auditPairId` (mirror `intake_nudge`/CRM). Intent before any file/fact write; outcome after (item ids, fact ids/file paths, provider/account/message id, status). No body text, no restricted values. Quarantine dismiss/manual-file also audit. |
| Q12 | Quarantine cards on the board? | **Inside the affected client's Onboarding tab** by default, with a **count/signal on the board row** (not full quarantine cards on the board). Keeps the board a work surface (§4). |

## 1. Non-negotiables every lane inherits
- **Never silently filed.** No imported email writes a file/fact/checklist tick until the advisor approves. Audit intent BEFORE effect, outcome AFTER; if intent can't be written, refuse the write.
- **The model never chooses** the target client, request, item id, destination path, recipient, or audit content — CODE does. AI is used only to classify/suggest against the OPEN item list, on already-authenticated mail.
- **Email body is untrusted** (prompt-injection surface): read for classification only; sanitize before any prompt; it must not control any identifier or path.
- **Deterministic gate BEFORE AI:** sender-match → auth-check → active-request → open-items. AI runs only after the gate passes on authenticated mail. Failed/missing auth or ambiguity → quarantine (no confidence tier, no preselect, no one-click).
- **Non-E2EE channel labeling** everywhere email-reply data appears (provenance chips + privacy explainer) — this data came in cleartext over normal email, unlike the E2EE intake link.
- Restricted values masked; SQLCipher-only; never in ordinary state or audit rows. Light theme, tokens, client/household copy, no em dashes, no time estimates, `matter`/`matter_id` never renamed.

## 2. Lane structure & order (critical path)

```
Lane 1 ingest+match  (Rust mail-rail auth/attachment + TS deterministic matcher) ── merges FIRST ──►
   ├── Lane 2 proposal cards + accept path (files/facts/checklist/audit)
   └── Lane 3 quarantine path (manual-only review)
```

**Merge order:** 1 → 2 → 3. Lane 1 is the blocker (defines `MailAuthResult`, attachment manifest, and the matcher output contract all others consume). Lanes 2/3 build in parallel off the Lane-1 tip. Quarantine (3) last (uses the final matcher outputs; can stub the auth shape early).

**⚠️ Lane 1 has the ONLY Rust in Wave 3** (mail auth parsing in `gmail/imap normalize.rs`, attachment refs in `store.rs`/`model.rs`/`messages.rs`, the new attachment-persist command, + the SQLCipher queue tables). **One cargo compile at a time, box-wide** — serialize its cargo with the gate. Lanes 2/3 are TS-mostly (Lane 2 may add the attachment-persist TS wrapper only).

## 3. Lane briefs (detail in `briefs/w3-<lane>.md`)
- **Lane 1 — ingest + match** (`briefs/w3-1-ingest-match.md`, written): Rust auth parsing + `MailAuthResult` + durable attachment refs in `MailView` + the new attachment-persist command; TS `emailReplyMatcher` (pure, deterministic, all the sender/auth/active-request/thread/open-item rules as tests) + `emailAddressMatch` (IDNA-normalized, no dot/plus stripping) + `emailAuthResult` mapping. The matcher output is the cross-lane contract.
- **Lane 2 — proposal cards + accept** (`briefs/w3-2-proposal-cards.md`, TO WRITE): `EmailReplyProposalCard`/row/modal, the accept path (`emailReplyAccept` — audit intent → file via the new persist command / fact via `intakeFactUpsert(channel:'email_reply')` → checklist tick → outcome audit; partial-failure handling), durable proposal queue in the SQLCipher store, masked restricted previews, confidence tiers from auth. Reuse `CrmWriteReviewCard`/`crmWriteQueueStore` patterns.
- **Lane 3 — quarantine** (`briefs/w3-3-quarantine.md`, TO WRITE): `emailQuarantinePolicy` (the quarantine triggers as tests) + `emailQuarantineStore` (durable) + quarantine card/panel in the Onboarding tab + board count signal; no accept-all/preselect/one-click; manual-file writes `channel:'email_reply'` + advisor-confirmed provenance + audit.

## 4. VERIFY register (Wave 3)
| # | Claim | How | When |
|---|---|---|---|
| V1 | Sender match is exact + IDNA-safe; look-alike/plus-alias/display-name never match | Lane 1 matcher tests (W3-PREP "Sender identity") | Lane 1 |
| V2 | Failed/missing auth → quarantine; spoofed sender never preselected/one-click | Lane 1 auth tests + Lane 3 policy tests (W3-PREP "Sender authenticity") | Lane 1/3 |
| V3 | No active/one-active/completed/revoked/multi-request rules hold | Lane 1 active-request tests | Lane 1 |
| V4 | Nothing filed until approve; intent-before-effect; intent-fail refuses write | Lane 2 accept tests | Lane 2 |
| V5 | Accepted file lands sanitized under `Requests/onboarding/email-replies/<safe-id>/`, no overwrite, outcome audited | Lane 2 attachment-persist test | Lane 2 |
| V6 | Emailed restricted fact: masked preview, explicit approve, supersede (never silent replace) | Lane 2 restricted-fact test | Lane 2 |
| V7 | Proposal + quarantine survive restart (durable encrypted state) | Lane 2/3 restart tests | Lane 2/3 |
| V8 | Body text controls no identifier/path; prompt-injection sanitized | Lane 1/2 untrusted-body tests | Lane 1/2 |
| V9 | Full quality gate green (ESLint/token/i18n parity/architecture-boundaries + cargo) | `npm run gate` after last lane | Final |
| V10 | Real mailbox round trip (spoof + look-alike + reply-vs-completed attacks) | **Legion bench** — coordinator-gated, post-WORKER-DONE | Bench |

## 5. Ritual (same as Wave 2)
Per lane: Codex build via prompt-from-file + `^DONE-EXIT:[0-9]+$`-anchored Monitor liveness ([[project-monitor-anchor-done-sentinel]]); lead diff review + ONE `codex-review --base lp/intake` adversarial pass **with mis-filing-attack focus**; batch findings into ONE fix round per lane; `git merge --no-ff`; gate (serialize Lane 1's cargo); push; keep `W3-TRACKER.md` current; `LANE-MERGED: <slug> <sha>`. Gate-fix round after the last lane. `WORKER-DONE: lp/intake` when all merged + gate-green + pushed + HEAD==origin. BENCH stays coordinator-gated.

## 6. Landmines
- Lane 1 Rust: one cargo at a time; fresh `lp-*` worktrees need `cp -a ~/lp-ux-integrate/src-tauri/binaries/. <wt>/src-tauri/binaries/` (+ `public/ocr/*`) or cargo build-script + pre-push fail. Symlink `node_modules` (+ `intake-page/node_modules`).
- Known baseline cargo flake `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (Some("1") vs None under parallel cargo; passes in isolation; NOT intake) — Lane 1 touches `commands::mail`, so re-run in isolation if it appears and confirm it's the flake, not a regression.
- Monitor sentinel filters MUST be anchored `^DONE-EXIT:[0-9]+$` (Codex echoes brief prose containing "DONE-EXIT") — see [[project-monitor-anchor-done-sentinel]].
