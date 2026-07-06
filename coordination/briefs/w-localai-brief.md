# Worker brief — Local-AI demo readiness (findings 1+2) + OpenAI stream retry (finding 5)

You are **cc-lantern-localai**, worktree **~/lp-localai**, branch **lp/localai-readiness** (off a4046edd). Provider-layer lane, demo-critical. You do NOT merge; the coordinator merges.

## Context
A live demo will Ask questions with the on-device Local AI ("Advisor Prep Hero Local AI", bundled llama.cpp) AND ChatGPT. Adversarial review found three failure modes (full log: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-step4.log`, last ~10KB). Verify each against the code before fixing.

## Fix 1 (HIGH): first Local-AI question races the engine startup
`AppLocalProvider` starts `llama-server` lazily on the first question; the server may take up to 120s to become healthy (`src-tauri/src/sidecars/llama_server.rs:28,130`), but Ask's no-token watchdog gives up at 45s (`src/features/ask/askTimeout.ts:103`, `src/features/ask/useAsk.ts:1045`). Robust fix, both halves:
- **Pre-start:** kick off the llama-server sidecar as soon as the user SELECTS Local AI as the provider (and on app boot if Local AI is the persisted provider) — not on first question.
- **Honest waiting state:** while the sidecar is starting, Ask shows "Local AI is starting…" and the 45s no-token timer must not run until the endpoint reports healthy.

## Fix 2 (HIGH): silent fallback to Ollama when AppLocal is not ready
`resolveLocalGenerationProvider()` (`src/platform/providers/resolveLocalProvider.ts:50,55`, used from `askHelpers.ts:410`) falls back to `OllamaProvider` whenever AppLocal's model status isn't `ready` — on a machine without Ollama this is a guaranteed wrong-provider failure. Fix: in Local-only mode, prefer AppLocal; if it's not ready, surface "Local AI is still downloading/setting up" (actionable, honest) instead of silently swapping providers. Use Ollama ONLY if the user explicitly chose Ollama or it is provably reachable.

## Fix 3 (MEDIUM, bounded): OpenAI streaming has no pre-stream retry
Non-streaming OpenAI calls retry with backoff; streaming throws immediately on 429/5xx (`src/platform/providers/OpenAIProvider.ts:459,469,670`). Add retry/backoff for 429, 500, 502, 503, 504 ONLY when no chunks have arrived yet (never retry after partial tokens), honoring `retry-after`. Keep it small.

## Method
TDD (Vitest; cargo test only if you must touch the Rust sidecar — prefer TS-side). Tests: provider pre-start on selection; timer gated on sidecar health; not-ready Local-only shows the setup message and never constructs Ollama implicitly; pre-stream 429 retries then succeeds; post-first-chunk errors do NOT retry. Scoped diff: providers + ask timeout wiring. No renames of `matter_id`/`Matter`. i18n per neighboring strings.

## Done criteria (HARD)
1. Tests red→green with real output; `npx tsc --noEmit` green; scoped `npx vitest run` green (+ cargo if Rust touched).
2. Committed AND pushed (`git push -u origin lp/localai-readiness`; `--no-verify` only for unrelated pre-push asset failures — say so).
3. THEN print exactly: `WORKER-DONE: lp/localai-readiness` + 5-line summary.
