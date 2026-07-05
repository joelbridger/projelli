ROLE: Security-hardening worker. A confirmed P1 class was found tonight: containment checks that `canonicalize()` a caller-supplied path FOLLOW symlinks, so an in-workspace alias (Clients/Alias -> Clients/RealClient) passes the `starts_with(workspace)` check and the operation hits the REAL client — cross-client isolation breach. The fix pattern already exists ON THE TIP, shipped with tonight's retention merge: `canonicalize_symlink_safe` in `src-tauri/src/commands/retention/sweep.rs` (~line 80) — a component-by-component `symlink_metadata` (no-follow) walk that refuses ANY symlink component and rejects `..` unconditionally. You apply that pattern to the remaining vulnerable sites. This is xhigh-class security work; self-converge to 2 clean codex rounds, MAX 6 rounds total then hand off.

WORKDIR: ~/lp-symfix (git worktree, branch lp/symlink-hardening off current origin/lantern-plus tip — pull first). NOT self-merged.

READ FIRST: retention/sweep.rs lines ~40-160 (the safe primitive + how canonicalize_workspace_relative/canonicalize_within delegate to it) — REUSE it (promote it to a shared module if needed, e.g. commands/pathguard.rs, with retention re-exporting; keep the retention tests green).

FIX THESE SITES (audited tonight, verified vulnerable — re-verify each by reading before changing):
1. `src-tauri/src/commands/vault/mod.rs:198 resolve_and_guard` (vault_read_file READ + vault_write_file WRITE): does a lexical ..-check then candidate/parent canonicalize (follows symlinks) + starts_with. Rebuild on the no-follow walk. Its existing test only proves OUTSIDE-workspace symlinks are rejected — add the in-workspace alias case for both read and write.
2. `src-tauri/src/mcp_bin/main.rs:302 resolve_workspace_path` + `src-tauri/src/mcp_bin/access.rs:151 canonicalized_workspace_child` (MCP read_workspace_file/write_workspace_file/search): same class; access.rs additionally RETURNS the non-canonical candidate so writes go through a symlinked parent. Rebuild both on the no-follow walk (mcp_bin is a separate bin — check what it can import from the lib; if it cannot reach the shared primitive, replicate it EXACTLY with a comment naming the canonical copy, and add a test pinning the two implementations' behavior together if feasible).
3. `src-tauri/src/commands/diarize/mod.rs:268 ensure_within_workspace` (diarize_meeting/apply_speaker_names READ+WRITE on meeting_dir): canonicalize-follow + starts_with. Rebuild on the no-follow walk. NOTE: reject_existing_symlink there only guards the temp-wav FINAL filename — leave that, it's a different (also valid) guard.
4. HARDEN (not vulnerable in practice, sloppy alone): `retention/sweep.rs contained()` — parent-canonicalize-follow; its entry points are backstopped by explicit no-follow guards, but make contained() itself no-follow-safe or add a loud comment forbidding standalone use. Your call, justify in handoff.
DO NOT touch capture/* (lp/meeting-capture, unmerged — its owner fixes its own guards) or tarball.rs (audited safe).

TESTS per site: in-workspace alias symlink REFUSED (the new class); out-of-workspace symlink still refused; normal nested path still works; `..` rejected. Plus keep every existing test green.

NON-NEGOTIABLES: never rename matter_id/Matter. Behavior for legitimate callers must not change (no path that previously worked without symlinks may break — the walk must handle non-existent tails the same way each helper documents). If a helper's semantics are ambiguous, STOP and ask COORDINATOR: with a stated default.

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-symfix in EVERY shell (seeded warm). Wrap EVERY cargo test in `timeout 1200 …`. One cargo at a time in your lane. Full check: scoped cargo tests + `timeout 1200 cargo test --lib` + npx tsc --noEmit if TS touched.

RULES: COORDINATION MODE (plain-text COORDINATOR: decisions, no menus). TDD (red alias-symlink test first per site). Evidence handoff: HEAD SHA, commit count, per-site before/after, test counts, review rounds, "NOT self-merged". THEN print exactly this as the very last line:
WORKER-DONE: lp/symlink-hardening ready for review
