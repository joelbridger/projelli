# Build brief — QA fix batch 6: silent startup failures (QA-33 keychain-service outage; QA-32 folder-picker investigation)

**Lane:** cc-lantern-qafix6 · dir `~/lp-qafix6` (own worktree, branch `lp/qa-fix-batch6`). **Model:** Sonnet 5 · high.
**Read FIRST:** BUG-DB QA-32 + QA-33 full rows + qa5 lane detail + evidence `coordination/qa-campaign/evidence/qa5-20260704/`. **Rules:** NO-SHORTCUTS. TDD. Codex self-review foreground/watched. PULL + reconcile before handoff. Unique dev-server port.

## Lane boundary (three lanes live)
qafix5 owns the SAVE path (WorkspaceService writes, autosave, PathValidator naming). noticekit owns consent/meetings UI. transfix owns transcription Rust. You own STARTUP/keychain/dialog plumbing: KeychainService + its Rust command, workspace-open flow, the dialog-invocation sites. If a fix crosses into their files, STOP and ask (`COORDINATOR:`).

## QA-33 (P1): a stopped Windows Credential Manager service silently breaks workspace open
Real repro (bench-2): with Windows' `VaultSvc` service stopped, every keychain read (API keys) times out; opening an existing workspace silently fails after ~30 seconds with NO error. Fix honestly:
1. Keychain reads must fail FAST and DISTINGUISHABLY when the credential service is unavailable (detect the service-unavailable error class in the Rust keychain command rather than riding a generic timeout; check what the keyring crate surfaces).
2. Workspace open must NEVER silently fail: surface an honest, actionable error ("Windows' credential storage service isn't running — Advisor Prep Hero can't unlock your saved AI keys. [How to fix]"), and where safe, DEGRADE instead of block: open the workspace with keys unavailable (Ask/AI features show their existing no-key states) rather than refusing to open at all — the user's documents must never be hostage to a keychain outage. State the degrade-vs-block decision per call site.
3. Tests: mock the service-unavailable error → fast honest failure; workspace opens in degraded mode; no 30s hangs (bound any remaining timeout well below 30s with a visible spinner + message).

## QA-32 (P1, severity uncertain): the native folder-picker never opens on the fresh bench-2 VM
`plugin:dialog|open` spins forever — blocks onboarding ("Connect my own data"), "Open Existing", "Add files". qa5 couldn't get past first-run without a workaround. Your job is INVESTIGATE-then-fix:
1. Reproduce or rule out locally/in CI (it may be VM-environment-specific — e.g. a Windows shell/COM dependency missing on stripped VMs). Read qa5's evidence first.
2. Whatever the root cause: the UX hole is real regardless — a dialog that never returns must not spin forever. Add a bounded watchdog on dialog invocations (if no dialog result AND no visible dialog after N seconds → honest error with a manual-path-entry fallback input so the user is never hard-blocked).
3. If you root-cause the VM-specific trigger, document it in the bench setup log pointer (coordination note in your handoff) so bench sessions stop tripping on it.

## Gate + handoff
`npx tsc --noEmit` · typecheck:tests 0 · i18n 0 (new strings en/de/es) · full vitest · eslint-gate · Rust-touched ⇒ own `CARGO_TARGET_DIR=$HOME/.cargo-target-lp-qafix6`, `timeout 1200`, one cargo box-wide (qafix5 may also compile — coordinate via the lock, expect waits). Handoff: HEAD SHA · QA-32 root-cause verdict (proven/ruled-out/VM-specific) · gate counts · Rust yes/no · self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/qa-fix-batch6`
