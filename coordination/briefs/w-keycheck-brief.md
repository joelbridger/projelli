# Worker brief — dress-rehearsal fixes: persistent key-verify state + Local-AI mode-switch warm-up

You are **cc-lantern-keycheck**, worktree **~/lp-keycheck**, branch **lp/dressrun-fixes** (off tip edde3e89). Demo-path lane — this MERGES BEFORE the formal 3× dry-run, so it's on the clock. SCOPED tests only; push --no-verify authorized.

## Source: the dress rehearsal (coordination/qa-campaign/evidence/legion-dressrun1/REPORT.md on lp/legionverify-evidence @84a93648 — read findings #1 and #5 fully; screenshots cited there)

## Fix 1 (finding #1): "✓ Working" key-verification state doesn't persist
Verified live: check a key → "✓ Working" → close and reopen the Manage AI Account Keys dialog ~2 min later (NO app restart) → back to "Unverified". The verified state evidently lives only in dialog-local component state. Note `markKeyVerified`/`markKeyInvalid` already exist (`src/platform/providers/keyVerification.ts` — recently wired into Ask sends). Fix: the dialog's Check result persists through that same store (with a checked-at timestamp); on dialog open, show the last known state (e.g. "✓ Working — checked 5 min ago") instead of resetting to Unverified. A dead key still flips to invalid on the next real failure (that wiring exists). Check ApiKeyManager, ApiKeyWizard, ApiKeyTester (all recently touched by lp/connect-demo-hardening — read their current shape first).

## Fix 2 (finding #5): first Local-AI question after a MODE SWITCH fails, then retry works
Reproduced twice on the Legion at a tip INCLUDING lp/localai-readiness (which pre-starts the llama sidecar on provider selection/boot). The gap: switching to "On this computer only" happens via the ConfidentialityModeSettings card — trace whether that path calls `preStartLocalAi` (see `src/platform/providers/localAiPreStart.ts` + `src/platform/hooks/useConfidentialityMode*`). The live symptom was an ERROR ("couldn't get an answer — may still be downloading or loading") rather than the honest "Local AI is starting…" wait state, so BOTH halves need closing: (a) the mode-switch path must trigger the pre-start; (b) if a question arrives while the sidecar is still warming, Ask must show the starting state and wait (the merged health-gate logic exists in askTimeout.ts — find why this path missed it), never a retry-able error.

## Method
TDD both: (a) dialog reopen shows persisted verified state; (b) mode-switch triggers pre-start; question-during-warmup → starting state, not error. tsc + scoped vitest green.

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify -u origin lp/dressrun-fixes`). THEN print exactly: `WORKER-DONE: lp/dressrun-fixes` + 4-line summary (root cause of each + what now happens instead).
