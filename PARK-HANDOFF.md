# PARK-HANDOFF — Wave 3 meeting-capture, Tasks 1-6

**Parked:** 2026-07-03, server hardware upgrade. Branch `lp/meeting-capture` @ `d910be62`, pushed to `origin/lp/meeting-capture`. Working tree clean, all committed.

## What this lane is

Coordinator-confirmed scope: Tasks 1-6 of `docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md` (local meeting capture engine — chunk writer, session finalize, per-OS audio sources, capture engine + commands, crash recovery, real-device verification harness). **NOT self-merged** — the coordinator merges. Read `LANTERN-PLUS.md` + the master plan's Global Constraints first if you're new to this repo.

## Status: Tasks 1-5 DONE and code-complete. Task 6 NOT STARTED. Currently mid-way through Codex-review convergence (round 7 of an open-ended "2 consecutive clean rounds" requirement for Tasks 4-5, data-loss-critical).

### Done, tested, committed (16/16 `cargo test --lib capture::` passing as of HEAD):
- Task 1: `chunks.rs` — crash-durable chunked WAV writer
- Task 2: `session.rs` — SessionManifest + `finalize_session` (now **streaming**, not load-into-memory — see round 5 fix below)
- Task 3: `sources.rs` — `AudioSource` trait, `CpalSource` (thread-owned, format-generic F32/I16/U16), `MacTapSource` (std::thread-based, graceful SIGTERM, byte-carryover reader)
- Task 4: `engine.rs` — `CaptureEngine`, global `ENGINE` singleton, path guards (`guard_matter_folder`/`guard_meeting_path` in `mod.rs`), `capture_start/stop/status` commands
- Task 5: `recovery.rs` — `find_orphans`/`recover`, `capture_find_orphans`/`capture_recover` commands, active-recording exclusion

### The immediate next step (was in progress when parked)
I was adding a unit test in `sources.rs` proving `Resampler` (the new stateful phase-carrying resampler, just wired into `CpalSource::build_typed_stream` in the last commit) doesn't accumulate drift across many synthetic callbacks — e.g. simulate ~500 callbacks × 1000 frames at 44100→16000 Hz (a non-integer ratio, which is what exposes the bug), assert total output sample count is within ±1-2 of the ideal `total_frames * 16000/44100`. This is testable without real hardware (no device needed, pure math over synthetic `f32` buffers), same pattern as the existing `downmix_resample_48k_stereo_f32_to_16k_mono_i16_length` test right below where you'd add it (`sources.rs`, end of the `mod tests` block, ~line 460).

**The fix itself is already committed and compiles/tests clean** — only the regression test proving it is missing. Add it, run `cd src-tauri && export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4 && timeout 90 cargo test --lib capture:: -- --nocapture`, confirm pass, commit as its own small commit.

### Then: finish the Codex-review convergence loop for Tasks 4-5
This wave has been through 7 rounds of `codex-review --base lantern-plus` so far, each finding real (and increasingly narrow/subtle) issues, all fixed:
1. Windows `std::os::unix::fs::symlink` test compile failure — fixed (`#[cfg(unix)]`)
2. Same-day meeting folder collision — fixed (numeric suffix disambiguation)
3. macOS reader-task drain race — fixed (std::thread rewrite, unverified — no Mac toolchain here)
4. Non-F32 device sample format rejection — fixed (format-generic `build_typed_stream`)
5. macOS permission-denial not detected — fixed (grace-period exit check, unverified)
6. macOS sidecar resolution (dev-CWD-only) — fixed via `current_exe()` Resources dir (unverified)
7. macOS sidecar triple-suffixed name — fixed
8. macOS PCM byte-alignment carryover — fixed (real bug, would corrupt mac audio after any odd-byte read)
9. Active recording mistaken for a crashed orphan — fixed (`active_meeting_dir()` exclusion, both listing + recover layers)
10. Failed source start leaves a phantom orphan — fixed (cleanup on `start_with_sources` failure)
11. `finalize_session` loading whole meeting into memory — fixed (streaming `ChannelSampleStream`)
12. `guard_matter_folder` rejecting the real (absolute) `Matter.folderPaths` shape — fixed, **verified against the actual `matterStore.folderPaths.test.ts`**, not just codex's claim
13. `find_orphans` depth cap too shallow for nested matter folders — fixed (4→12)
14. Resampler phase reset per-callback causing multi-second drift over long meetings — fixed (stateful `Resampler`), **test not yet added (see above)**

**Not fixed, deliberately, flagged in commit messages:** the `capture-mac` Swift binary itself doesn't exist (no source, no build/fetch script) — this is explicitly out of Tasks 1-6 scope; the plan's own Task 6 Step 4 treats building it on an M1 bench as a manual precondition, not a deliverable of this lane. Don't try to build it without real Mac hardware/Swift toolchain access.

**Next round:** after adding the Resampler drift test, run `codex-review --base lantern-plus` again (**foreground**, not backgrounded — see gotcha below). If clean, that's round 1 of 2 consecutive. Run once more; if STILL clean, Tasks 4-5's review requirement is satisfied and you can move to Task 6. If it finds something, fix it and the "2 consecutive" counter resets to 0 — keep iterating. Given the pattern so far (progressively narrower findings), it's likely close to converged, but don't assume — verify.

### Task 6 (not started): real-device verification harness
Per the plan (already fully read into a prior session's context, see the plan file directly): write `scripts/capture-smoke.mjs` + `scripts/wav-energy.mjs`, run on the Legion Windows bench (`james@100.127.67.22`) via `scripts/desktop-drive.mjs`. **Coordinate Legion access first** — check `coordination/STATUS.md` (top of file = latest entry) for current Wave-2 retest / bench busy status before connecting; the coordinator said the Legion is reserved for this lane but may be intermittently busy with a Wave-2 re-test. Do NOT skip this coordination check.

Task 6 also needs: a mid-recording hard-kill test (`taskkill /F`, then verify `capture_find_orphans` + `capture_recover`), and — only if an M1 bench becomes available — a macOS repeat (out of reach this session).

## Environment gotchas hit this session (don't re-discover these)

1. **`CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4`** — this lane's own cargo cache, already seeded and healthy as of this handoff. If a fresh session shows a build failure referencing `.cargo-target-lantern-plus` paths inside build script output (`cargo:PERMISSION_FILES_PATH=/home/jameson/.cargo-target-lantern-plus/...`), that means the fingerprint cache got re-seeded with stale absolute paths again — fix: `rm -rf $CARGO_TARGET_DIR/debug/.fingerprint $CARGO_TARGET_DIR/debug/build` and rebuild (CPU-only, no network, ~3 min).
2. **Missing sidecar binary stubs**: `src-tauri/binaries/piper-x86_64-unknown-linux-gnu` and `llama-server-x86_64-unknown-linux-gnu` are gitignored stub files (`cp /bin/true`) needed for `cargo build`/`cargo test` to pass tauri-build's bundle-resource-existence check on this Linux dev box. If they're missing in a fresh checkout, recreate them the same way (`cp /bin/true src-tauri/binaries/<name>-x86_64-unknown-linux-gnu && chmod +x ...`) — never commit them (`.gitignore` already excludes `/binaries/`).
3. **`npm ci` + `node scripts/copy-build-assets.mjs`** may be needed on a fresh checkout for the pre-push hook (typecheck+vitest gate) to actually run instead of erroring on missing `node_modules`/`public/ocr/*.wasm`.
4. **Background Bash jobs (`run_in_background: true`) got killed unpredictably this session** — repeatedly, regardless of workload size, seemingly unrelated to memory pressure (checked: no OOM, no cgroup kill events). Root cause unknown/unresolved. **Workaround that worked reliably: run `cargo test`/`codex-review` in the FOREGROUND with an explicit long `timeout` parameter** (e.g. `timeout: 300000` on the Bash tool call, plus a shell-level `timeout 280 cargo ...` wrapper) instead of backgrounding. If you hit the same issue, don't fight it — just go foreground.
5. **`cargo test` (full suite, no `--lib`) compiles every integration-test binary** (heavy — LanceDB/DataFusion/onnxruntime) and is slow/memory-heavy on this shared box (many concurrent Claude sessions + Chrome + docker). Prefer `cargo test --lib` for iteration — it covers the same registration-breakage concern (whole-lib compile + all lib-level unit tests, 1112+ tests) far more cheaply. Confirmed clean at `cargo test --lib` (1112 passed) earlier this session; re-run if you touch anything outside `commands/capture/`.
6. **`ugrep` is aliased over `grep`** in this shell and mishandles relative paths from certain cwd states — use absolute paths with grep/ugrep, or `Read`/`Bash cat` instead if you hit "No such file or directory" on a file you know exists.

## Key files (all under `src-tauri/src/commands/capture/`)
`chunks.rs`, `session.rs`, `sources.rs`, `engine.rs`, `recovery.rs`, `mod.rs` (path guards + `mac_sidecar_path`). Registered in `src-tauri/src/lib.rs` (5 commands: `capture_start/stop/status`, `capture_find_orphans/recover`) and `src-tauri/src/commands/mod.rs` (`pub mod capture;`).

## Verify you're picking this up cleanly
```bash
cd ~/lp-w4 && git log --oneline -1   # should show d910be62 or later
git status --short                   # should be empty
cd src-tauri && export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4
timeout 90 cargo test --lib capture:: -- --nocapture   # expect 16 passed
```
