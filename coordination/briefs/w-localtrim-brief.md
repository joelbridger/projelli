# Worker brief — Local-AI context trimming (BUILD-ONLY during demo freeze)

You are **cc-lantern-localtrim**, worktree **~/lp-localtrim**, branch **lp/localai-trimming** (off tip c754a286). Scoped TS lane. You do NOT merge. 🧊 **TIP FREEZE: merges post-demo — build, test, push, stop.**

## The problem (from the step-4 adversarial review, scratchpad/codex-step4.log finding 6)
The on-device Local AI reports a ~16k-token working window (`src/platform/providers/AppLocalProvider.ts:39,205`), but Ask always sends up to 8 retrieved chunks + history with no local-specific trimming (`src/platform/rag/workspaceCommand.ts:44`, `src/features/ask/useAsk.ts` retrieval assembly). A long question + full context overflows it → truncated/garbled answers. Cloud providers are forgiving; local is not.

## The fix
When the resolved provider is the embedded local one (`keepance-local`): estimate the assembled prompt size (a chars/4 heuristic is fine — pick a conservative ratio, document it) and trim to fit the model's reported window with sane priorities: keep the system prompt + the question intact; reduce retrieved chunks (drop lowest-relevance first, never partially truncate a chunk mid-citation); then trim oldest history. If even the minimum (question + top-1 chunk) can't fit, show the honest message ("This question is too long for the on-device AI — shorten it or switch to a cloud model."). NO behavior change for cloud providers. Read how the window size is exposed by AppLocalProvider and use the live value, not a hard-coded 16k.

## Method
TDD: over-budget prompt → chunks dropped lowest-relevance-first, citations stay consistent with what was actually sent; under-budget → untouched; impossible-fit → honest message; cloud provider → no trimming path taken. tsc + scoped vitest. No `matter_id`/`Matter` renames.

## Done criteria (HARD)
Committed AND pushed (`git push --no-verify -u origin lp/localai-trimming`). THEN print exactly: `WORKER-DONE: lp/localai-trimming` + 3-line summary. Branch waits for the post-demo merge window.
