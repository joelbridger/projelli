# Worker brief — second-wave connector parity (BUILD-ONLY during demo freeze)

You are **cc-lantern-secondwave**, worktree **~/lp-secondwave**, branch **lp/connector-parity** (off tip edde3e89). Scoped robustness lane. You do NOT merge. 🧊 **TIP FREEZE: your branch merges AFTER the demo — build, test, push, stop.**

## Three fixes (from the connect-flow adversarial review, scratchpad/codex-connect.log findings 5-6, + cross-branch review finding 3)
1. **OneDrive disconnect ordering** — `src-tauri/src/commands/onedrive/commands.rs:286` deletes the saved token FIRST, then purges local imported data; a purge failure leaves the account looking disconnected with data still on disk. Fix: mirror Wealthbox's structured result (token removed / local data removed / data remains) and surface "Finish deleting local data" in the UI when cleanup fails. Read Wealthbox's pattern first and match it.
2. **Outlook connect cancel race** — `src-tauri/src/commands/mail/connect.rs:72` stores the token after Microsoft returns even if the user cancelled meanwhile; OneDrive already has the stronger cancel-arrived-late rollback (`commands.rs:211`). Port that pattern to Outlook connect.
3. **Legacy chat-send error parity (TS)** — `src/features/ask/hooks/useChatSending.ts:1879` still does its own provider-error parsing and never calls `markKeyInvalid`. Reuse `isAuthRejectionError` / `friendlyErrorMessage` from askHelpers (the unified path useAsk now uses) so a dead key is marked invalid from the chat path too.

## Method
TDD per fix; Rust touched (1, 2) ⇒ scoped `cargo test`; TS (3) ⇒ tsc + scoped vitest. NEVER the full suite. Match neighboring patterns; no refactors beyond the three fixes. No `matter_id`/`Matter` renames.

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify -u origin lp/connector-parity`). THEN print exactly: `WORKER-DONE: lp/connector-parity` + 3-line summary. Branch waits for the post-demo merge window.
