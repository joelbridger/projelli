# Lantern Intake — Wave 2 Executable Plan

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave 1 tip `8ac43d3b` (gate-green).
**Spec:** `W2-PREP.md` + `PRODUCT-DESIGN.md` §4/§5/§8 + `WAVE-PLAN.md` Wave 2. **Briefs:** `briefs/w2-<lane>.md`.
**Predecessor lessons applied:** `W1-LEAD-HANDOFF.md` §4 (prompt-from-file, codex-review resets worktree, scoped tests miss the gate, cross-lane seams are the lead's job, build the cross-lane test EARLY).

---

## 0. The 7 open questions — RESOLVED (grounded in the shipped Wave-1 code)

| # | Question | Resolution (grounded) |
|---|---|---|
| Q1 | Final `intakeStore` shape? | `IntakeRecord` (see `src/platform/intake/intakeStore.ts`): `intakeId, matterId, clientFirstName, firmName, status('draft'\|'active'\|'revoked'\|'expired'\|'completed'), link(in-mem only — NOT persisted), expiresAt, checklistVersion, items(IntakeChecklistState{itemId,label,state,provenance?,factId?,filePath?}), receivedItems, flags(IntakeFlag{kind:'duplicate'\|'new_device'\|'integrity_mismatch'\|'stale_overwrite'\|'vault_off_nudge'}), knownSessionIds, publicKeyRawB64, ciphertexts, lastCursor`. **GAPS Wave 2 must add (Lane 0):** `clientEmail?`, `clientPhone?`, `lastClientActivityAt?`, `nudges: IntakeNudgeAttempt[]`. |
| Q2 | Where is the client email? | **Nowhere durable.** `NewClientDialog.tsx` collects `email`/`phone` in local state and uses them only for a `mailto:` href — they are dropped. **Lane 0 persists `clientEmail`/`clientPhone` into `IntakeRecord` via `upsertIntake`.** |
| Q3 | Approve = save draft or send? | **Save a mailbox DRAFT via `mailSaveDraft` — NEVER `mailSend`.** Locked by the product promise ("no nudge sends itself"; AI proposes, advisor decides), CLAUDE.md out-of-scope (no autonomous ops), and WAVE-PLAN's own `mail_save_draft` wording. The bench line "verify the sent mail" = the advisor manually sends the draft. IMAP-only / no draft-capable mailbox → show **"copy message"**, no `mailSend`. |
| Q4 | Audit: one action + phase, or two strings? | **Mirror the CRM `audit_phase`/`audit_pair_id` pattern** (`src-tauri/src/commands/crm/commands.rs`): one logical nudge action written as an **intent** row then an **outcome** row sharing an `auditPairId`. On the TS side (nudges are a TS/email-adjacent action) use ONE new `AuditActionType` `'intake_nudge'` carrying a `phase:'intent'\|'outcome'` + `auditPairId`, via the audit emitter (mirror `setEmailAuditEmitter`/`logEmailAuditEntry`). Update both audit UIs (`AuditLog.tsx`, `auditHomeHelpers.ts`). |
| Q5 | Expired/new-device already exposed by relay? | **new_device / duplicate / integrity_mismatch: YES** — produced LOCALLY by `IntakeSyncClient` → land in `intake.flags`. **expired / expires-soon / revoked / active: derivable LOCALLY** from `expiresAt` + `status`, no relay call. **Expired/revoked "opened" attempts + wrong-token probes: NO, and NOT added** — the relay deliberately returns uniform 410 and rate-limits before auth (coordinator hardening P2-5) to kill the id-space oracle; re-adding attempt telemetry would reverse that. **Lane 2 = locally-derived signals ONLY, no relay change.** (Flagged to coordinator.) |
| Q6 | Board: toggle in MattersHome or new surface? | **Inside `MattersHome`** as a board view toggle beside the client list (W2-PREP #6 recommendation; keeps it with the client hub, reuses `SurfaceToolbar`). Not a new top-level nav surface. |
| Q7 | AI voice matching in Wave 2? | **Deterministic templates ship as the core; "Draft in my voice" is a secondary button** that lets AI reword the BODY TEXT ONLY. Code owns recipient, subject, link, missing-items list, cadence, call-suggestion — never the model. Reuses `src/features/email/followUpDraft.ts` prompt-safety/citation helpers. |

---

## 1. Non-negotiables every lane inherits

- **AI proposes, advisor decides.** No nudge sends itself. `mailSaveDraft` only; never `mailSend`.
- **User-facing copy says "client"/"household"** (never "matter"). Engine keeps `matter_id`/`Matter` on the wire — never rename.
- **Light theme only.** Design tokens, never hard-coded hex (token-guard gate).
- **No restricted value ever leaves the redaction boundary.** Board rows, nudge drafts, and link signals render **item LABELS and IDs only** — never SSNs, last-4, license numbers, amounts, or file names. This is enforced by the read-model's TYPES (the model carries no value fields), not by string-scrubbing.
- **Cadence + audit are durable** — nudge history and last-activity survive an app restart (persisted store), because the cadence guard and "based on missing items as of [date]" receipts depend on it.
- **Every user string in locale files** (`intake.board.*`, `intake.link.*`, `intake.nudge.*`) — added to en/de/es AND the `en-json-snapshot.test.ts` inventory.
- **Stable `data-testid`s** for every row/action.

---

## 2. Lane structure & execution order (the critical path)

The #1 Wave-1 lesson: **per-lane tests that mock the other side let contract breaks ship green.** Wave 2's answer is a **fat shared-contract Lane 0 that merges FIRST**, so all three UI lanes consume ONE already-merged derivation module (no drift possible), then a **cross-lane integration test built in Lane 3** that drives the real store → model → nudge → `mailSaveDraft` → audit across a simulated restart.

```
Lane 0 (contract + model + store)  ── merges FIRST, alone ──►  then fan out:
   ├── Lane 1  Board UI          (thin: renders deriveOnboardingRow/sortOnboardingRows)
   ├── Lane 2  Link Lifecycle UI (thin: renders deriveLinkSignals — local only)
   └── Lane 3  Nudge Engine      (deriveNudgeEligibility + templates + mail + audit + E2E test)
```

**Merge order:** 0 → 1 → 2 → 3. Lanes 1/2/3 build in parallel off the Lane-0 tip once it merges (mostly disjoint files; shared touchpoints — `MattersHome.tsx`, `OnboardingTab.tsx`, locale files — reconciled by the lead at each merge). Nudges (3) last: it touches mail, AI, cadence, audit.

**Dispatch:** Lane 0 alone first (it is the only blocker, exactly like Wave-1 Lane A). Fan out 1/2/3 after Lane 0 merges + re-gates.

---

## 3. File structure (net-new unless marked ✎ = edit existing)

| Path | Lane | What |
|---|---|---|
| ✎ `src/platform/intake/intakeStore.ts` | 0 | Add `clientEmail?`,`clientPhone?`,`lastClientActivityAt?`,`nudges:IntakeNudgeAttempt[]`; actions `recordNudgeAttempt`,`setLastClientActivity`; **persist `version:1→2` + migration** (nudges default `[]`; keep stripping `link`/secrets in `partialize`). |
| `src/platform/intake/nudgeTypes.ts` | 0 | `IntakeNudgeAttempt{sequence,at,missingItemIds,auditPairId,channel:'email_draft'\|'call_suggested'}`; `OnboardingConfig` (stall days=5, cadence days=4, maxUnanswered=3, expiresSoonDays=3). |
| `src/platform/intake/onboardingModel.ts` | 0 | **The shared contract.** Pure fns: `deriveOnboardingRow(intake,now,cfg)→OnboardingRow`, `sortOnboardingRows(rows)`, `deriveLinkSignals(intake,now,cfg)→LinkSignal[]`, `deriveNudgeEligibility(intake,now,cfg)→NudgeEligibility`. `OnboardingRow` carries LABELS/IDS/counts/timestamps/signals ONLY — no fact values, no file names. |
| `src/platform/intake/__tests__/onboardingModel.test.ts` | 0 | Exhaustive: sort order, stall math, expires-soon/expired/revoked signals, cadence (before/after 4d, 3-unanswered→suggestCall, "unanswered" = no activity after last attempt), rehydrate-durability, redaction-by-type (assert no value/file-name field exists on the row). |
| ✎ `src/features/matters/NewClientDialog.tsx` | 0 | Pass `clientEmail`/`clientPhone` into `upsertIntake`. |
| ✎ `src/features/matters/MatterHub.tsx` | 0 | Stamp `setLastClientActivity(intakeId, now)` in the `routeSubmission` wiring (a client submission arrived) — incl. the duplicate path (client still acted). |
| `src/features/intake/OnboardingBoard.tsx`, `OnboardingBoardRow.tsx`, `OnboardingBoardEmptyState.tsx` | 1 | Board view + rows + empty state. |
| ✎ `src/features/matters/MattersHome.tsx` | 1 | Board view toggle beside the client list; reuse `SurfaceToolbar`; empty-state "New client" reuses existing path. |
| `src/features/intake/__tests__/OnboardingBoard.test.tsx` | 1 | Sort, missing-item labels, stalled state, row-click routes to Onboarding tab, redaction. |
| `src/features/intake/LinkLifecyclePanel.tsx`, `LinkSignalBadge.tsx`, `LinkSignalDetails.tsx` | 2 | Per-client link panel + board-row badges + details. |
| `src/features/intake/__tests__/linkSignals.test.tsx` | 2 | Each signal state; no restricted value rendered. |
| ✎ `src/features/intake/OnboardingTab.tsx` | 2 | Mount `LinkLifecyclePanel` (keep the Wave-1 copy/extend/revoke/regenerate controls one-click visible). |
| `src/platform/intake/nudgeDraft.ts` | 3 | Copy pack (3 templates) + code-owned merge-field fill; `buildNudgeDraft(row,intake,cfg)→{subject,bodyHtml,to,missingItemIds,sequence}`. |
| `src/platform/intake/nudgeAudit.ts` | 3 | intent/outcome emit helpers (shared `auditPairId`). |
| `src/features/intake/NudgeDraftCard.tsx`, `NudgeReviewModal.tsx` | 3 | Inline board nudge card + review/edit/approve modal (+ optional "Draft in my voice"). |
| ✎ `src/platform/types/audit.ts`, ✎ `src/app/shell/common/AuditLog.tsx`, ✎ `src/features/audit/auditHomeHelpers.ts` | 3 | `'intake_nudge'` action + `phase`/`auditPairId` fields + label/icon. |
| `src/features/intake/__tests__/nudgeEngine.test.tsx` + `src/platform/intake/__tests__/nudgeCadence.test.ts` | 3 | Draft references only missing items; stale-draft (missing items changed after open → save blocked until regenerate); cadence across rehydrate; mail-draft path writes intent+outcome pair; failed save → failed outcome. |
| `src/features/intake/__tests__/onboarding-e2e.test.tsx` | 3 | **CROSS-LANE E2E** — real store → model → board → nudge → fake-tauri `mailSaveDraft` → audit, across a simulated restart (rehydrate). Redaction fixture: restricted facts present in store, assert none appear in board/nudge/link output. |
| ✎ `src/locales/{en,de,es}.json` + ✎ `tests/unit/i18n/en-json-snapshot.test.ts` | 1/2/3 | `intake.board.*` / `intake.link.*` / `intake.nudge.*` keys + inventory/counts. |
| ✎ `tests/unit/architecture-boundaries.test.ts` | as needed | Declare any new feature→feature / feature→platform edge (e.g. `intake`→`email` if nudges import mail rails; `matters`→`intake` already declared). |

---

## 4. VERIFY register (Wave 2)

| # | Claim | How verified | When |
|---|---|---|---|
| V1 | The onboarding read-model carries no restricted value or file name (redaction by construction) | Lane 0 model test asserts row/signal/eligibility types have no value field + a redaction fixture render | Lane 0 merge |
| V2 | Board sorts "needs you" first, shows who/what-missing/how-long/next-action, row click opens the Onboarding tab | Lane 1 `OnboardingBoard.test.tsx` | Lane 1 merge |
| V3 | Link signals are correct and reveal no submitted value; controls stay one-click | Lane 2 `linkSignals.test.tsx` + lead read of OnboardingTab | Lane 2 merge |
| V4 | No relay change — Lane 2 adds no new relay route/event (privacy oracle preserved) | Lead diff review: `git diff` touches no `backend/` intake route; `IntakeRelayClient` unchanged | Lane 2 merge |
| V5 | Cadence: ≤1 nudge / 4 days; 3 unanswered → suggest call; guard survives restart | Lane 3 `nudgeCadence.test.ts` (rehydrate case) | Lane 3 merge |
| V6 | Approve saves a DRAFT via `mailSaveDraft`, never sends; intent+outcome audit pair written | Lane 3 `nudgeEngine.test.tsx` (fake tauri asserts `mail_save_draft` invoked, `mail_send` never) | Lane 3 merge |
| V7 | Stale draft (missing items changed after open) is blocked until regenerated | Lane 3 stale-draft test | Lane 3 merge |
| V8 | End-to-end store→model→board→nudge→draft→audit holds across restart with real modules | Lane 3 `onboarding-e2e.test.tsx` (no wire mocks between lanes) | Lane 3 merge |
| V9 | Full quality gate green (ESLint, token-guard, i18n parity, architecture-boundaries) | `npm run gate` after the gate-fix round | Final |
| V10 | Bench: stall a fixture client, approve a nudge, verify the draft + audit pair; UI-spec §5 evidence | **Legion bench** — coordinated AFTER WORKER-DONE (bench currently BLOCKED by the coordinator) | Post-merge bench |

---

## 5. Per-lane merge ritual (same as Wave 1)

1. Codex lane finishes (`DONE-EXIT:0`), liveness-watched via the **Monitor tool** throughout (background Bash watchers get reaped).
2. **Lead reads the full diff.** Batch ALL findings into ONE combined fix brief per lane ([[feedback-batch-findings-one-fix-round]]) — no drip-feed.
3. **One `codex-review --base lp/intake < /dev/null`** adversarial pass from a different codex call (bare `--base` form — it takes no custom prompt). Run it in a CLEAN worktree with no uncommitted edits (codex-review can reset the worktree during live-probing).
4. Fold findings → re-verify (scoped vitest for the lane).
5. `git merge --no-ff` the lane into `lp/intake`. Reconcile shared touchpoints (locale files, MattersHome, OnboardingTab) at merge — the lead owns cross-lane seams.
6. Run `npm run gate`. TS-only lanes may skip cargo with a **logged reason** (Wave 2 is TS-only — no Rust changes expected). Commit fixes immediately.
7. Update `W2-TRACKER.md` (lane status, HEAD SHA, review rounds, gate evidence). Print `LANE-MERGED: <slug> <sha>`.
8. Push `lp/intake`; confirm `HEAD == origin/lp/intake`.

## 6. Gate-fix round (budgeted, after Lane 3)

The scoped per-lane vitest MISSES: ESLint (`lantern-async/no-silent-failure`, `lantern-i18n/no-hardcoded-string`), token-guard (hex→tokens), **i18n locale parity** (new en.json keys → de.json + es.json + `en-json-snapshot.test.ts` inventory+counts), architecture-boundaries (new cross-feature edges). Budget one combined fix round. This is normal, not a surprise.

## 7. Wave-2 done definition (WORKER-DONE gate)

All 4 lanes (0/1/2/3) merged with lead review + one codex adversarial pass each; `npm run gate` full tail-output shown green; backend `bun test` green (no backend change expected, but re-run to confirm no regression); the cross-lane E2E + redaction tests green; `W2-TRACKER.md` updated; `lp/intake` pushed and `HEAD == origin/lp/intake`; tree clean. Then print the evidence block, then `WORKER-DONE: lp/intake`. The Legion bench (V10) is coordinated separately AFTER WORKER-DONE and is currently BLOCKED by the coordinator (demo practice indexing) — do NOT deploy/bench until released.

## 8. Coordinator standing items (carried from W1 handoff)

- The coordinator's independent Wave-1 pass may still surface findings → handle as a fix round (batch). (Wave-1 hardening already merged `67962a45`; watch for any follow-on.)
- **BENCH BLOCKED** — no Legion deploy / no `W1-BENCH-RUNBOOK` until the coordinator releases it.
- Worker driven over tmux: no interactive menus; decisions as plain text prefixed `COORDINATOR:`.
