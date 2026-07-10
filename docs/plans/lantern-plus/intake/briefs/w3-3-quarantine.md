# CODEX BUILD BRIEF — Wave 3, Lane 3: Quarantine path (manual-only review)

You are a Codex build agent in worktree /home/jameson/lp-w3-3 (branch lp/intake-w3-3). Lanes 1 (matcher + quarantine reasons) and 2 (ingestion that writes quarantine rows + accept path) are merged into this branch's history — you CONSUME them. Build the scope below, TDD, commit on your branch. Do NOT push. TS-mostly; if the quarantine queue needs Rust store rows, one cargo compile at a time.

## Context to read first
- `docs/plans/lantern-plus/intake/W3-EXEC-PLAN.md` §0/§1/§3, `W3-PREP.md` "Lane 3: Quarantine Path" + the "Sender authenticity" / "No silent filing" acceptance criteria.
- **Consume Lanes 1/2 (merged):** `src/platform/intake/emailReplyTypes.ts` (`EmailReplyQuarantine`, `EmailReplyQuarantineReason` = auth_failed|lookalike|ambiguous_sender|ambiguous_request|inactive_request|accepted_item_update|attachment_metadata_missing), the durable quarantine rows written by Lane 2's ingestion (read the emailReply proposal/quarantine store Lane 2 added), `emailReplyAccept.ts` (the accept/audit pattern to mirror for manual-file), `factsStore.ts`, `mailPersistAttachment`.
- **Reuse:** `src/features/email/EmailViewer.tsx` (open/read the original email), `src/features/matters/CrmWriteReviewCard.tsx` (compact card), `src/features/intake/OnboardingTab.tsx` + `OnboardingBoardContainer.tsx` (placement + board count signal), `src/ui/kp/` (Card/Button/Badge/Callout).

## Scope (build all)
- `src/platform/intake/emailQuarantinePolicy.ts` — pure functions turning a quarantine row + its reason into: the plain-language reason text, what the advisor must do (pick client/request/item when applicable), and whether it is dismissible (informational) vs must-resolve. Encodes: NO accept-all, NO preselected rows, NO confidence tier for any quarantined message.
- `src/platform/intake/emailQuarantineStore.ts` — durable (encrypted intake store — reuse Lane 2's tables/accessor if present; do NOT duplicate) masked accessor; survives restart; statuses pending|dismissed|manually_filed.
- `src/features/intake/EmailReplyQuarantineCard.tsx` + `EmailReplyQuarantinePanel.tsx` — per-client Onboarding tab panel (Q12: quarantine lives INSIDE the affected client's Onboarding tab; a COUNT signal shows on the board row via the container, not full cards on the board). Loud, plain-language warning explaining the reason. Non-E2EE channel label. Renders NO submitted value / file name / last-4 / restricted fragment.
- **Manual-file path:** the advisor opens/reviews the message, explicitly picks the target client/request/item (CODE validates the pick against real open items — the model chooses nothing), and confirms. Writes files/facts through the SAME `emailReplyAccept`-style path (audit intent before effect, outcome after) but the resulting provenance is `channel:'email_reply'`, `verification:'advisor_confirmed'`, `confirmed_by:<advisor>`, and the activity trail says the advisor MANUALLY confirmed a quarantined message. A quarantined email can instead be DISMISSED as not intake material (audited).
- Audit: add any new action strings to `src/platform/types/audit.ts` + label them in `AuditLog.tsx` + `auditHomeHelpers.ts` (or reuse `intake_email_reply` with a quarantine/manual phase — pick the cleaner fit; no body text / no restricted values in rows).
- Locale `intake.quarantine.*` in en/de/es + snapshot inventory.

## Tests
- Vitest: `emailQuarantinePolicy` — each `EmailReplyQuarantineReason` → correct reason text + required-action + dismissible flag; auth_failed/lookalike/ambiguous are NOT dismissible-without-resolution and NEVER get a preselect/one-click/confidence tier. Manual-file writes intent-before-effect + advisor-confirmed provenance + outcome; dismiss is audited; restart → quarantine survives. RTL: card renders the loud plain warning + non-E2EE label + NO restricted value/file name; no accept-all button exists; nothing is preselected.
- `cargo test` (SERIAL) only if you added store rows.

## Constraints
- NO accept-all, NO preselected rows, NO confidence tier on quarantine. The advisor must explicitly pick + confirm; CODE validates the pick; the model chooses nothing. Never silently filed. Non-E2EE labeling. Restricted values masked, SQLCipher-only, never in ordinary state/audit. Light theme, tokens, client/household copy, no em dashes, no time estimates, never rename matter/matter_id.
- Do NOT modify Lane-1/Lane-2 platform files — import them. The lead wires the board count signal + panel mount at merge if needed.
- GREEN before done: `npx vitest run src/features/intake src/platform/intake`; `cargo test` if store rows added (SERIAL); `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Add locale keys to en/de/es. Commit on this branch. Do NOT push.
