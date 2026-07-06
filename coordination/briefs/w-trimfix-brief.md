# Worker brief — localai-trimming round 2: two verified review findings (merge-blocking)

You are **cc-lantern-trimfix**. Work in the EXISTING worktree **~/lp-localtrim** (branch `lp/localai-trimming` @b488eff9 — its previous lane ended; the worktree is yours). You do NOT merge. SCOPED tests only (tsc + the ask/provider vitest files you touch). Read `coordination/WORKER-DISCIPLINE.md`.

Fresh Codex review found 2 issues; the coordinator verified both against the code.

## F1 (BLOCKER) — trimming budgets against a window Ollama never allocates
`useAsk.ts` (~1030) budgets trimming from `provider.getMetadata().capabilities.maxContextTokens`. For Ollama that is `getMaxContextTokens('ollama', model)` — the THEORETICAL model max (e.g. 131k for llama3.2:3b) — while every actual request pins `num_ctx` to `resolveNumCtx()` (`OLLAMA_WORKING_CONTEXT_WINDOW` = 16384; OllamaProvider.ts:62/272/284/428). So the trimmer can approve a 100k+ prompt that gets silently truncated in a 16k window — the exact failure this branch exists to prevent.
**Fix:** the budget the trimmer uses must equal the window the request will actually get (the resolveNumCtx value). Prefer making Ollama's reported `capabilities.maxContextTokens` the working window — but FIRST check every consumer of that metadata field (grep `maxContextTokens`) so you don't break a display/estimator that legitimately wants the theoretical max; if a consumer needs the theoretical number, split the fields instead (e.g. add `workingContextTokens` and have the trimmer prefer it). Add a test on the REAL `OllamaProvider` (not a fake) asserting the trimmer-visible window equals the working window.

## F2 — a single oversized chunk erases useful history, then refuses anyway
`localContextTrim.ts` (~90): the loop never drops the last remaining hit (`hits.length > 1`), so one huge chunk → all history dropped → `fits=false`. In SMART mode this breaks follow-ups ("summarize what you just said") that would have worked with history alone.
**Fix (coordinator direction):** in smart mode, when the sole remaining chunk still busts the budget, drop it too (zero fresh hits), keep as much history as fits, and send with `hasEvidence: false` — the existing no-evidence smart path handles honest wording. Files-only mode keeps its honest decline when no usable file context remains (that behavior is correct — an Ask about your documents must not answer without them). Update the test at localContextTrim.test.ts:102 to the new contract; add the smart-mode follow-up scenario red→green.

## Done criteria (HARD)
Both red→green, tsc + scoped vitest green (bare exit codes), committed AND pushed to `lp/localai-trimming` (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/localai-trimming round2` + 3-line summary (budget mechanism chosen + consumers checked, F2 contract, test evidence).
