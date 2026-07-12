# Wave 7 Lane 3 — Combined Fix Round

**Branch:** `lp/intake-w7-requests-ui` (same worktree as the original build, `/home/jameson/lp-w7-requests-ui`). Your prior commit `b5ad51f7 feat(intake): W7-LANE3-REQUESTS-UI generalize request surfaces` is already there. Work on top of it — do not start over.
**You are Codex, the builder.** Fix the findings below, run the checks, commit. Do NOT push. Do NOT merge. Do not send notifications or messages of any kind; never invoke `notify-jameson`.

## Context

Your build was reviewed two ways: a lead diff read, and an independent adversarial `codex-review --base lp/intake-w7`. Both independently found the same P1 from different angles, plus codex-review found one more P2. Batch both into one fix pass — no drip-feed.

## Finding 1 (P1, confirmed two ways) — the matter-wide review panels are now unreachable

`OnboardingTab.tsx`'s new `showMatterSignals` prop (which your build added) gates `EmailReplyProposalCard`, `EmailReplyQuarantinePanel`, and `DocumentExtractionReviewPanel` — the panels an advisor uses to actually **accept, dismiss, or file** a matched inbound email reply, quarantined email, or document-extraction proposal. Your own doc comment on that prop says: `/** Matter-wide inbox panels are rendered once by the Requests tab, per request. */` — but `ClientRequestsTab.tsx` sets `showMatterSignals={false}` unconditionally on every `OnboardingTab` instance it mounts (line ~130) and never renders those three panels anywhere else. The board (`RequestsBoardContainer.tsx`) only ever shows **counts** (`EmailReplyProposalBanner`/`EmailReplyQuarantineBanner`), which is correct for the board — a board row should never expose full review actions — but that means, after this change, there is **no surface left anywhere in the app** where an advisor can act on a matched proposal or quarantine. This regresses shipped Wave 3 (email-reply proposals + quarantine) and Wave 4 (document-extraction review) functionality, not something either of your product's non-negotiables asked you to remove.

**Fix:** render `EmailReplyProposalCard`, `EmailReplyQuarantinePanel` (in its normal, non-`unmatchedOnly` mode), and `DocumentExtractionReviewPanel` **once per matter** at the top level of `ClientRequestsTab` — outside the per-request `.map()` loop, exactly matching what the `showMatterSignals` doc comment already says was the intent. Keep `showMatterSignals={false}` on every individual `OnboardingTab` instance (that part is correct — you don't want N duplicate copies of the same matter-wide panels, one per request card). Wire the existing `onAccepted` reload-facts callback the same way `OnboardingTab.tsx` itself already does internally (check what it passes to these components today for reference — you don't need to invent new plumbing, just relocate the mount point).

Add a test: a matter with two requests and a matched email-reply proposal for that matter renders exactly one `EmailReplyProposalCard` (not zero, not two), and clicking through it still works (reuse whatever interaction `OnboardingTab.test.tsx` or `emailReplyAccept`-related tests already exercise for this card if that's faster than writing new interaction assertions from scratch — the important assertion is that the card is *present and singular*, not a full re-test of Wave 3's accept flow).

## Finding 2 (P2, from codex-review) — a no-op Nudge button on standing-request rows

In `RequestsBoardContainer.tsx`, `onOpenNudge` is defined as `(row) => { if (row.kind === 'onboarding') setReviewRow(row as OnboardingRow); }` — it silently no-ops for a standing row. The bug isn't this callback itself; it's that `RequestsBoard.tsx` passes the *same* `onOpenNudge` down to **every** row regardless of kind (`{...(onOpenNudge ? { onOpenNudge: ... } : {})}`, unconditional on `row.kind`). Since `OnboardingBoardRow` renders an enabled Nudge button whenever it's given an `onOpenNudge` prop at all (it has no way to know the row underneath the `as OnboardingRow` cast is actually a standing request), a stalled standing request in the "All requests" filter gets a Nudge button that does nothing when clicked.

**Fix, in `RequestsBoard.tsx` (your file, not `OnboardingBoardRow.tsx` — don't fork or modify the shared row component for this):** only spread `onOpenNudge` down to a row when `row.kind === 'onboarding'`. A standing row should render with no Nudge button at all rather than a disabled or no-op one. Add a test: a standing-request row in the "All requests" view has no Nudge button/control present (not just disabled — absent), while an onboarding row's Nudge button still works exactly as before.

## Self-converge requirement

Fix both findings, then run every test in your original brief's acceptance list again plus the two new regression tests above, until everything passes. Do not stop on a red test.

## Checks to run (report exact pass/fail; every test invocation wrapped in a timeout)

```
timeout 300 npx vitest run src/features/intake/__tests__/RequestsBoard.test.tsx src/features/intake/__tests__/ClientRequestsTab.test.tsx src/features/intake/__tests__/OnboardingBoard.test.tsx src/features/intake/__tests__/OnboardingBoardContainer.test.tsx src/features/intake/OnboardingTab.test.tsx
timeout 300 npx vitest run src/platform/intake src/features/intake src/features/matters
timeout 120 npx tsc --noEmit
timeout 120 node scripts/eslint-gate.mjs
```

## Finish

Create a NEW commit on `lp/intake-w7-requests-ui` with a conventional message containing the phrase `W7-LANE3-FIXROUND`. Do NOT push. Do NOT merge. Report exact check results and state the branch is clean.

The very last line of your output — after everything else, on its own line — must be exactly `DONE-EXIT:0` if every check passed and the branch is clean and committed, or `DONE-EXIT:1` if you are stopping with something unresolved (explain what, above that line). Do not print it early, do not print it more than once, and do not let it appear anywhere in quoted/example text earlier in your output.
