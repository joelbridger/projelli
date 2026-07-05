# Worker brief — Audit-chain silent-reseal gap (fail-closed tamper evidence)

**Lane:** cc-lantern-auditfix · worktree `~/lp-auditfix` · branch `lp/audit-chain-failclosed`
**Model:** Opus 4.8 · xhigh (correctness-critical security; stated reason: this is the tamper-evidence guarantee the product's trust story cites).
**CARGO_TARGET_DIR:** `$HOME/.cargo-target-lp-auditfix` (already seeded warm). `timeout 1200` on every cargo command.

## The gap (pre-existing, found by audit)
`EncryptedAuditStore::open()` in `src-tauri/src/commands/audit/store.rs`: an attacker (or bug) that deletes tail rows AND the `chain_head_v1` metadata gets the store to reseal the remaining prefix as a valid chain on next open — silent truncation, defeating tamper-evidence. Read the file and its tests first; reproduce the gap with a failing test BEFORE designing the fix (tdd skill applies).

## Design decision (made by the coordinator — build this, not alternatives)
Fail-closed + explicit acknowledged repair:
1. `open()` must DETECT the resealable-truncation state (rows present but chain head metadata missing/behind) and refuse to silently re-derive a head. Distinguish, as far as the data allows, "fresh/empty store" (benign) from "rows exist but head is gone" (suspicious).
2. In the suspicious state the store opens in a TAMPER-EVIDENT-DEGRADED mode: existing rows remain readable, new appends are refused (or quarantined) until repair, and the condition is surfaced to the caller via a typed state/error the frontend can show honestly ("the audit log's integrity seal is missing — history before <timestamp> can no longer be cryptographically verified").
3. Repair is an explicit command (not automatic): it re-seals from the surviving prefix but FIRST writes a permanent audit entry recording the anomaly (when detected, how many rows survive, that prior integrity cannot be verified). The anomaly record itself becomes part of the new chain.
4. Frontend: minimal honest surfacing — wire the degraded state into the existing audit UI error/status path (find where store-open errors already surface; do not build new UI surfaces). Plain-language copy, light theme, i18n like neighboring strings.

## Constraints
- This file is cross-cutting (retention Track D and others append entries) — do NOT reorder the existing audit-store-open ordering in retention_sweep (see the PARK-HANDOFF landmine about opening the audit store only after enumeration). Grep callers of open() and keep their contracts.
- Never rename Matter/matter_id. No shortcuts — robust over minimal (core-app rule).
- Tests: the reproducing test (red first), fresh-store-still-works, degraded-mode append refusal, repair writes the anomaly entry and restores appends, and the retention integration keeps passing (`cargo test --lib` full).
- Self-review: codex-review --commit per major commit; cap at ~4 rounds or 2 low-severity rounds.
- Do NOT merge; do NOT pull mid-bench-pass unless I tell you the tip moved for you. Push your branch when green.
- Evidence handoff: commit count, test counts, exact commands + output. Last line exactly: `WORKER-DONE: lp/audit-chain-failclosed`
