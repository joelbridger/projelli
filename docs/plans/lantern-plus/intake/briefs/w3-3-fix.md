# CODEX FIX BRIEF — Wave 3, Lane 3 (quarantine) fix round

You are a Codex fix agent in worktree /home/jameson/lp-w3-3 (branch lp/intake-w3-3). Your build (d3e800fc) is solid but the adversarial review found 3 P1 quarantine-policy holes + 1 P2 + ESLint findings. Fix ALL, TDD, commit on this branch. Do NOT push. TS-only.

## Fixes (do ALL)

### [P1-1] Enforce the non-dismissible policy — `EmailReplyQuarantineCard.tsx` (~156) + the dismiss function
The policy sets `dismissible: false` for `auth_failed`/`lookalike`/ambiguous reasons, but the dismiss button always dismisses and the underlying function doesn't check the policy — so an advisor can permanently delete a MANDATORY security-review record without resolving it. Fix: the dismiss action (UI + the store/function) must REFUSE when the policy says `dismissible: false`; only informational quarantines can be dismissed. Hide/disable the dismiss button for non-dismissible reasons AND guard the function itself.

### [P1-2] Surface quarantines with NO matched client — `EmailReplyQuarantinePanel.tsx` (~19) + board/mount
`matchEmailReply` quarantines lookalike messages WITHOUT a `matchedMatterId`, but the only panel mount queries the store for one specific matter and the board count skips null matter IDs — so lookalike (potential-spoofing) quarantines have NO UI path to be reviewed/filed/dismissed. Fix: give unmatched quarantines a home — e.g. a global/unmatched quarantine surface (or include them in a place the advisor sees), so every quarantine (matched or not) is reviewable. Ensure the board signal/count accounts for them.

### [P1-3] Manual review must let the advisor choose ANY active client — `EmailReplyQuarantineCard.tsx` (~46)
For `ambiguous_sender`, the matcher attaches only the first matching intake as a display anchor, but the policy requires the advisor to CHOOSE the real client. The client/request selector is restricted to the card's `matterId`, so the advisor can't pick the other matching client → a valid reply can't be filed OR dismissed. Fix: the manual-file selector must offer all active clients/requests (CODE validates the pick against real open items; the model chooses nothing), not just the anchor matter.

### [P2-4] Make a failed manual-file status update recoverable — `emailReplyQuarantineManualFile.ts` (~186)
If attachment persist succeeds but `setStatus` fails, the local checklist item is already marked accepted while the durable quarantine stays pending; a retry fails `requireOpenTarget` (item no longer open) → stuck queue + orphaned/duplicate files. Fix (same idempotency pattern as Lane 2's accept): persist a durable per-target completion receipt BEFORE/atomically with the local checklist transition, and on retry skip already-completed targets so nothing is re-persisted and the queue isn't stuck.

### [lint] Fix the 8 ESLint findings properly (no baseline update, no eslint-disable except a genuine best-effort with a reason)
`lantern-async/no-silent-failure` (3, EmailReplyQuarantineCard: add `.catch`), `no-confusing-void-expression` (EmailReplyQuarantineCard + Panel: add braces), `require-await` + `no-unnecessary-type-assertion` (the test file: fix types).

## Done bar
- Non-dismissible quarantines cannot be dismissed; every quarantine (incl. no-matter lookalikes) is reviewable; manual-file can target any active client (code-validated); partial-file is recoverable/idempotent. No accept-all/preselect/confidence on quarantine. Restricted values masked, never in state/audit. Never rename matter/matter_id. Light theme, tokens, no em dashes/time estimates. Kebab-case locale namespaces (intake.quarantine.*) in en/de/es + snapshot.
- GREEN before done: `npx vitest run src/features/intake src/platform/intake` ; `npx tsc --noEmit` ; `npm run typecheck:tests` ; `node scripts/eslint-gate.mjs` (clean, no baseline update) ; `npm run i18n:completeness`. Commit on this branch. Do NOT push.
