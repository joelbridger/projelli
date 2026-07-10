# CODEX BUILD BRIEF — Wave 3, Lane 2: Proposal cards + accept path (+ ingestion wiring)

You are a Codex build agent in worktree /home/jameson/lp-w3-2 (branch lp/intake-w3-2). Lane 1 (the deterministic matcher + mail-auth/attachment rails) is merged into this branch's history — you CONSUME it. Build the scope below, TDD, commit on your branch. Do NOT push. Mostly TS; the durable proposal queue is in the intake SQLCipher store (Rust) — one cargo compile at a time.

## Context to read first
- `docs/plans/lantern-plus/intake/W3-EXEC-PLAN.md` §0/§1/§3, `W3-PREP.md` "Lane 2: Proposal Cards And Accept Path".
- **Consume Lane 1 (merged):** `src/platform/intake/emailReplyTypes.ts` (`EmailReplyCandidate` = matchedMatterId/matchedRequestId/targetOpenItemIds/confidenceEligible/attachments:`MailAttachmentRef[]`; `EmailReplyMatchResult`), `emailReplyMatcher.ts` (`matchEmailReply(mail, intakeState, now)`), `src/platform/utils/mail-commands.ts` `mailPersistAttachment()` → `mail_persist_attachment` (fetches + writes an attachment into the workspace with path validation, returns `MailPersistedAttachment`, NO bytes to renderer), `mailListMessages`/`mailGetMessage`.
- **Reuse patterns:** `src/features/matters/CrmWriteReviewCard.tsx` + `src/platform/state/crmWriteQueueStore.ts` (proposal-card + explicit-approve pattern — model the email-reply proposal on this), `src-tauri/src/commands/crm/commands.rs` (intent/outcome audit — intent BEFORE effect, refuse write if intent fails), `src/platform/intake/factsStore.ts` `intakeFactUpsert` (facts; use `channel:'email_reply'`), `src-tauri/src/commands/intake/{mod.rs,store.rs}` (the encrypted intake store — add the proposal-queue tables here), `src/features/intake/OnboardingTab.tsx` + `OnboardingBoardContainer.tsx` (where proposals surface), `src/platform/intake/nudgeAudit.ts` + `src/platform/types/audit.ts` (audit emitter pattern).

## Scope (build all)

### 1. Ingestion wiring (produce proposals from REAL synced mail — do NOT leave it unwired)
A hook/service that, on mail sync, runs `matchEmailReply` over newly-synced messages against the intake state and routes each result: `candidate` → the durable PROPOSAL queue; `quarantine` → a durable QUARANTINE queue (Lane 3 owns the quarantine UI + policy, but this wiring writes the quarantine rows so Lane 3 has data — coordinate the shape via `emailReplyTypes`); `ignore` → nothing. Idempotent by message id (a message already processed is not re-enqueued). Mount it where mail sync is driven (follow how mail sync / the Wave-2 intake inbox sync is mounted). **This is the "make it reachable" step — Wave 2's lesson: a feature that isn't wired into the running app is hollow.**

### 2. Durable proposal queue (encrypted intake SQLCipher store)
`src-tauri/src/commands/intake/` — add proposal rows (message ref, matched matter/request, target open item ids, confidence, attachment refs, status pending|accepted|dismissed) encrypted at rest. TS accessor `src/platform/intake/emailReplyProposalStore.ts` with masked reads (no restricted values, no body text in ordinary state). Survives restart.

### 3. Confidence classification (AI, on OPEN items only, code owns identifiers)
`src/platform/intake/emailReplyClassifier.ts` — for an authenticated candidate, classify which OPEN item(s) each attachment/body-fact matches + a confidence (high/med/low). The email body is UNTRUSTED: sanitize before any prompt (reuse `followUpDraft`/`sendWithEgressAudit` prompt-safety helpers), and the model NEVER chooses the target client/request/item/path — CODE maps to `targetOpenItemIds` from Lane 1; the classifier only ranks/suggests among those. High → checkable by default; medium → pre-selected only with the reasoning line visible; low → visible unchecked.

### 4. Proposal card + accept path
- `EmailReplyProposalCard.tsx` / `EmailReplyProposalRow.tsx` / `EmailReplyReviewModal.tsx` / `EmailReplyProposalBanner.tsx` — surface on the per-client Onboarding tab (and a board count signal via the container). Non-E2EE channel label (this came over normal email, not the E2EE link) — provenance chip + explainer. Restricted body-derived facts show MASKED previews only.
- `src/platform/intake/emailReplyAccept.ts` — the accept path: write an `intake_email_reply` audit **intent** row (add the action to `audit.ts` + `AuditLog.tsx` + `auditHomeHelpers.ts`) BEFORE any effect; if intent fails, refuse. Then: attachments → `mailPersistAttachment` into `Requests/onboarding/email-replies/<safe-message-id>/` (sanitized, uniquified, no overwrite); body-derived facts → `intakeFactUpsert({channel:'email_reply', confirmed_by:<advisor>, verification:'advisor_confirmed'})` with supersede handling (never silent-replace an active restricted fact); checklist tick ONLY after the file/fact write succeeds; write the **outcome** audit row (same auditPairId, item ids, fact ids/file paths, provider/account/message id, status) — NO body text, NO restricted values. Partial failure (file ok, fact fails) → outcome records partial + the proposal stays visible/unresolved.
- `emailReplyAudit.ts` — the intent/outcome helpers (mirror `nudgeAudit`).
- Locale `intake.email-reply.*` in en/de/es + snapshot inventory.

## Tests
- Vitest: matcher-candidate → proposal enqueued (ingestion idempotent by message id); accept writes intent-before-effect, persists attachment under the safe path (no overwrite), upserts an email_reply fact with supersede, ticks checklist only after success, writes outcome; intent-fail refuses; partial-failure keeps the proposal; restricted body fact shows masked preview + writes only after explicit approve; **body text controls NO identifier/path** (untrusted-body test); restart → proposals survive (durable store). RTL for the card/modal (confidence tiers: high checked, medium needs-reason, low unchecked; non-E2EE label present; no restricted value rendered).
- `cargo test` (SERIAL) for the intake proposal-store rows (encrypted; masked reads; the `backfill_marker...` flake passes in isolation).

## Constraints
- Never silently filed; audit intent before effect; model never chooses client/request/item/path; body untrusted. Restricted values masked, SQLCipher-only, never in ordinary state/audit. Non-E2EE labeling. Light theme, tokens, client/household copy, no em dashes, no time estimates, never rename matter/matter_id.
- Do NOT modify Lane-1 files (emailReplyMatcher/emailAddressMatch/emailAuthResult/emailReplyTypes, the mail-rail Rust) — import them. The lead wires the board count signal at merge if needed.
- GREEN before done: `npx vitest run src/features/intake src/platform/intake`; `cargo test` for the touched intake commands (SERIAL); `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Add locale keys to en/de/es. Commit on this branch. Do NOT push.
