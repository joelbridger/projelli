# Worker brief — connector-parity round 2: two verified review findings (merge-blocking)

You are **cc-lantern-connfix2**. Work in the EXISTING worktree **~/lp-secondwave** (branch `lp/connector-parity` @2ef8a417 — its previous lane ended; the worktree is yours). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`. Rust is involved: `cargo test` scoped to the onedrive command area; only ONE cargo compile may run on this box at a time — if you hit the shared build lock (exit 144 pattern), wait and retry rather than parallelizing compiles.

Fresh Codex review found 2 High issues; the coordinator verified both against the code and set the fix direction (including one product-judgment correction to Codex's remedy — follow the coordinator's direction below, not Codex's, on F1).

## F1 — Disconnect overpromises: materialized files stay but the UI claims data was deleted
Sync materializes OneDrive files into client workspace folders (engine.rs ~280-325, "exactly like a file the user dropped in") tracked with `local_path` in the OneDrive store. Disconnect purges RAG rows + the tracking DB only (commands.rs `purge_onedrive_local_data`), then reports success (`dataRemains=false`), and the retry banner speaks of "Finish deleting local data". So the promise and the deed disagree — and the tracking DB (the only record of those paths) is deleted, making later cleanup impossible.

**Do NOT silently delete materialized files (Codex's remedy) — they are the user's documents now (possibly edited); silent deletion violates the product's user-in-control rule.** Instead:
1. Add an explicit disconnect confirmation step in `OneDriveConnect.tsx` that states plainly: importing stops, the connection and search index are removed, and files already imported into client folders STAY in the workspace — with an opt-in checkbox "Also delete the files imported from OneDrive".
2. If the user opts in: the backend enumerates every saved `local_path` from `OneDriveStore` and deletes those files BEFORE deleting the tracking DB; any file-delete failure → keep the token, `dataRemains=true`, accurate warnings (the existing retry banner then works).
3. If not opted in: files staying is NOT a failure — `dataRemains` stays false; adjust result semantics/copy so nothing overstates. Keep the plain-language, no-jargon copy voice.

## F2 — Disconnect races an active sync; a mid-flight write lands after the purge
`onedrive_cancel` only flips the flag (commands.rs ~1061); the UI calls cancel then disconnect immediately; `onedrive_disconnect_logic` purges without waiting for the running sync to stop. A file between the engine's cancel checks and its `std::fs::write`/`upsert_item` (engine.rs ~289-320) commits AFTER the purge — data reappears after a "successful" disconnect (and the store upsert can recreate the DB).
**Fix (backend-enforced):** in `onedrive_disconnect_logic`, after setting cancel, WAIT until `state.is_syncing` is false (bounded, e.g. poll up to ~15s); on timeout return `dataRemains=true`, keep the token, add a warning ("an import was still stopping"). UI: disable Disconnect or show "Stopping import…" while syncing, but the backend guarantee is the fix. Add a Rust test driving disconnect-during-sync (there is prior art for async command tests in this file ~1000-1060).

## Method
TDD both: F2 = Rust integration-style test (disconnect during an in-flight sync never leaves post-purge writes / returns dataRemains=true on timeout); F1 = component tests for the confirm flow (default keeps files + honest copy; opt-in delete path wired; delete-failure → retry banner). tsc + scoped vitest + scoped cargo test green — BARE exit codes in your evidence.

## Done criteria (HARD)
Committed AND pushed to `lp/connector-parity` (`git push --no-verify`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/connector-parity round2` + 3-line summary (F1 behavior chosen, F2 mechanism, test evidence).
