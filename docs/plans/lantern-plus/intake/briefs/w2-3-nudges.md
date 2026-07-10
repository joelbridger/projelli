# CODEX BUILD BRIEF — Lantern Intake Wave 2, Lane 3: Nudge Engine (draft-only, cadence, audit) + cross-lane E2E

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push.** **Do NOT touch `backend/`, `intake-page/`, `src/platform/intake/onboardingModel.ts`/`intakeStore.ts`/`nudgeTypes.ts`** (Lane 0 owns them; import). Wrapper appends the DONE-EXIT sentinel.

> **The core promise of this lane: no nudge ever sends itself.** Approving a nudge SAVES A DRAFT into the advisor's own mailbox (`mailSaveDraft`). It NEVER calls `mailSend`. The advisor reviews the draft in their mailbox and sends it themselves.

## Context to read first
- `docs/plans/lantern-plus/intake/W2-EXEC-PLAN.md` §0 Q3/Q4/Q7, §1, §3, §4 (V5/V6/V7/V8).
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §8 (nudges — cadence: ≤1 per `cadenceDays`, 3 unanswered → suggest a call; draft references only what's missing; every draft shows "based on missing items as of [date]"; every save writes an audit row).
- `docs/plans/lantern-plus/intake/W2-PREP.md` "Nudge Copy Pack" (3 templates + merge fields — code-owned).
- **Consume Lane 0:** `deriveNudgeEligibility`/`deriveOnboardingRow` from `onboardingModel.ts`; `recordNudgeAttempt`, `IntakeNudgeAttempt`, `IntakeRecord.clientEmail`, `nudges`, `lastClientActivityAt` from the store; `DEFAULT_ONBOARDING_CONFIG`.
- **Reuse the real rails (read them):**
  - `src/platform/utils/mail-commands.ts` — `mailSaveDraft(accountId, to[], subject, bodyHtml, inReplyTo?)` (Outlook/Gmail Drafts, never sends; desktop-only, throws in browser), `composeMailAccountId(provider, account)`, `mailConnectedAccounts()`, `validateMailAttachmentsForProvider`. **IMAP has no draft support** — detect and fall back to "copy message".
  - `src/features/email/DraftFollowUpModal.tsx` — the safe AI-draft review pattern (copy this shape for the review modal).
  - `src/features/email/followUpDraft.ts` — prompt-safety helpers, structured output, `draftBodyToHtml()` (reuse for the optional AI rewrite).
  - `src/features/email/resolveEmailProvider.ts` — AI provider selection for drafting.
  - `src/features/email/emailAuditLog.ts` — `logEmailAuditEntry`, `setEmailAuditEmitter`, `emailMatterScope` (the emitter pattern to mirror for nudge audit).
  - `src/platform/types/audit.ts` — `AuditActionType` union + `AuditEntry` (`action`, `description`, `metadata`, `inputs`, `outputs`). Add `'intake_nudge'` to the union.
  - `src/app/shell/common/AuditLog.tsx` + `src/features/audit/auditHomeHelpers.ts` — add label/icon for `'intake_nudge'`.

## Scope (build all)

### 1. Deterministic nudge draft (`src/platform/intake/nudgeDraft.ts`)
- Encode the 3 copy-pack templates (gentle / helpful-with-link / suggest-a-call). Merge fields are CODE-OWNED, filled from the store/model: `client_first_name`, `advisor_first_name`, `firm_name`, `missing_items_list` (labels only), `primary_missing_item`, `intake_link`, `advisor_phone`, `advisor_calendar_link` (optional). Template choice by `nextSequence`/`suggestCall` (seq 1 gentle, 2 helpful, 3+/suggestCall → call).
- `buildNudgeDraft(row, intake, cfg): { subject, bodyHtml, to: string[], missingItemIds, sequence, basedOnAt }` — `to` from `intake.clientEmail`; `bodyHtml` via a safe HTML builder (reuse `draftBodyToHtml` shape); references ONLY currently-missing items.

### 2. Optional "Draft in my voice" (AI rewrite of BODY ONLY)
- A secondary action that lets AI reword the body text via the email drafting provider (`resolveEmailProvider` + `followUpDraft` helpers). The model may change ONLY the prose — code re-asserts recipient, subject, the intake link, and the missing-item list after the rewrite (never trust the model for those). Prompt-safety helpers from `followUpDraft.ts` apply. Ship deterministic as default; this is a button, not the path.

### 3. Cadence (`src/platform/intake/` — via Lane-0 `deriveNudgeEligibility`)
- The UI must consult `deriveNudgeEligibility(intake, now, cfg)` before offering a nudge. When blocked, EXPLAIN in plain language (cadence_wait → "You sent a note N days ago; you can send another in M days"; max_unanswered_suggest_call → "Three notes with no reply — a quick call may help more"). The guard reads durable `intake.nudges` (survives restart) — never in-memory-only.

### 4. Audit intent/outcome pair (`src/platform/intake/nudgeAudit.ts`)
- BEFORE `mailSaveDraft`: emit an `'intake_nudge'` **intent** row (metadata: `phase:'intent'`, `auditPairId`, `matterId`, `requestId`, `sequence`, `missingItemIds` (NOT values), provider/account identity). Use the audit emitter pattern (a `setIntakeNudgeAuditEmitter`/`logIntakeNudgeAudit` mirroring `emailAuditLog.ts`, OR reuse `logEmailAuditEntry` if scope fits — pick the cleaner fit and note it).
- AFTER `mailSaveDraft` succeeds: emit an **outcome** row (same `auditPairId`, `phase:'outcome'`, provider draft id, recipient count; NO body, NO restricted values). Then `recordNudgeAttempt(intakeId, {sequence, at:now, missingItemIds, auditPairId, channel:'email_draft'})`.
- If the draft save FAILS after intent: emit a FAILED outcome row (same pair id). Do NOT record a successful attempt.
- Recording a "suggest a call" (seq at max) writes an attempt with `channel:'call_suggested'` + its own audit rows.

### 5. UI (`src/features/intake/`)
- `NudgeDraftCard.tsx` — the inline board card (embedded in the stalled row, per §4/§8): shows the drafted follow-up + "based on missing items as of [date]"; one click expands to review.
- `NudgeReviewModal.tsx` — review/edit/approve (mirror `DraftFollowUpModal`): editable body, the code-owned fields shown read-only, `[Draft in my voice]` secondary, `[Save to my drafts]` primary (calls the save+audit path), a "copy message" fallback when no draft-capable mailbox (IMAP-only / none). **Stale-draft guard:** if `missingItemIds` changed since the draft was opened (client acted), block save and require regenerate.
- Wire the board's `onOpenNudge` slot (Lane 1 exposed it) to open this modal.

## Tests (Vitest + RTL — TS-only, no cargo)
- `src/platform/intake/__tests__/nudgeCadence.test.ts`: ≤1 per `cadenceDays`; 3 unanswered → suggestCall; unanswered resets when `lastClientActivityAt` advances; guard reads durable `nudges` across a store rehydrate.
- `src/features/intake/__tests__/nudgeEngine.test.tsx`: draft references ONLY missing items; approve → fake tauri asserts `mail_save_draft` invoked and `mail_send` NEVER invoked; intent row before save, outcome row after (shared `auditPairId`); failed save → failed outcome, no attempt recorded; stale-draft blocks save until regenerate; "copy message" path when no draft mailbox.
- `src/features/intake/__tests__/onboarding-e2e.test.tsx`: **CROSS-LANE E2E** (no wire mocks between lanes) — seed a real `useIntakeStore` intake with missing items + a `clientEmail`; run `deriveOnboardingRow`/`deriveNudgeEligibility`; open the nudge; save via a fake-tauri `mailSaveDraft`; assert the attempt is recorded, the intent/outcome pair written, cadence now blocks a second nudge; **rehydrate the store (simulate restart) and assert the cadence guard still blocks**; **redaction fixture**: restricted facts present → assert no SSN/last-4/license/amount/file-name appears in board row, nudge draft, or link signal output.

## Constraints
- `mailSaveDraft` ONLY — never `mailSend`. Code owns recipient/subject/link/missing-items/cadence; model owns only body prose.
- Audit before the external effect; refuse-to-lose-the-record semantics (intent first). No body / no restricted values in audit rows.
- Light theme, tokens (no hex). User copy client/household. No em dashes, no time estimates.
- Locale `intake.nudge.*` in en/de/es + snapshot inventory (add all three; lead reconciles snapshot at gate-fix).
- Strict TS, `@/` alias. TDD, real assertions. Match `DraftFollowUpModal.tsx` idiom.
- Before done: `npx vitest run src/features/intake src/platform/intake` green; `npx tsc --noEmit` clean; `npx eslint src/features/intake src/platform/intake` clean. Commit on your branch. Do NOT push.
