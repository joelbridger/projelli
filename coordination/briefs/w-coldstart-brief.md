# Worker brief — Local-AI cold start: ready must mean "can generate" (PRE-REHEARSAL, demo step 4)

You are **cc-lantern-coldstart**, worktree **~/lp-coldstart**, branch **lp/localai-warmup** (off tip c754a286). Rust-leaning, demo-critical — MERGES BEFORE the formal 3× dry-run. SCOPED tests only; push --no-verify authorized.

## Root cause (investigated + confirmed against live evidence — trust but verify)
Full log: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-coldstart.log` (read the last ~4.5KB). Live fact: first Ask after switching to Local-only fails with the 45s answer-stall timeout; immediate retry succeeds. Gap: readiness = HTTP `/health` success only (`src-tauri/src/sidecars/llama_server.rs:142-150` — status-only, body unparsed); the Ask gate (`askTimeout.ts:251-282`) clears "Local AI is starting…" on that signal; but the FIRST generation still has cold caches and can exceed 45s to first token (`useAsk.ts:1136-1138` watchdog → `ASK_ANSWER_STALL_ERROR_MESSAGE`). AppLocalProvider's warm-up retry only covers 502/503/504 (`AppLocalProvider.ts:124-128`), not accepted-but-slow.

## The fix (both parts, in Rust so every caller benefits)
1. **Warm-up generation probe in `LlamaServerSidecar::start()`:** after `/health` succeeds, run one tiny generation request (1-4 max tokens, trivial prompt, generous timeout ~90s) and only report the sidecar ready when it produces output. Pre-start on mode selection then absorbs the whole cold cost in the background — before any user question. The "Local AI is starting…" state naturally covers the probe window.
2. **Parse the health body:** on 2xx require `status == "ok"` (llama.cpp returns 503 while loading, 200 ok when loaded — but don't trust status codes alone).
Keep the frontend gate semantics unchanged (it already waits for sidecar-ready — the MEANING of ready is what changes). Make sure a probe failure surfaces as a real, honest error state (not an infinite "starting…").

## Method
TDD in Rust: health body parsing (ok / loading / garbage bodies); start() returns only after probe output (mock/fake server pattern — follow existing sidecar tests); probe-failure → error, not hang. Scoped `cargo test` for the sidecar area + tsc if any TS touched.

## Done criteria (HARD)
Red→green evidence, scoped cargo green, committed AND pushed (`git push --no-verify -u origin lp/localai-warmup`). THEN print exactly: `WORKER-DONE: lp/localai-warmup` + 3-line summary.
