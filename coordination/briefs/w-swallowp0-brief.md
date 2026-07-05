# Fix brief — QA-44 P0: RAG retag failures swallowed (privilege/isolation leak)

**Lane:** cc-lantern-swallowp0 · dir `~/lp-swallowp0` (own worktree, branch `lp/swallow-p0`). **Model:** Opus 4.8 · high (privilege/isolation — the product's core promise; correctness-critical).
**Read FIRST:** BUG-DB QA-44 + coordination/qa-campaign/static-swallow-sweep.md (finding 1). **Rules:** NO-SHORTCUTS. TDD red-first. Codex self-review foreground/watched, ≥2 clean-adjacent rounds (isolation bar). PULL + reconcile before handoff.

## The bug (Codex static finding — CONFIRM against the code first, then fix)
useMemoryWiring.ts (~1489/1524/1549): when a folder/email folder is re-assigned to a different client, or a source is marked privileged, the retag call's failure is swallowed by `.catch(() => {})`. The UI reports the new rule active, but search/RAG may still use the OLD tags → **privileged content can remain retrievable in normal Ask, or content stays scoped to the WRONG client.** This is the isolation/privilege promise breaking silently.

## What to build
1. Confirm the exact failure path (read the three sites + what the retag calls do + how RAG scope/privilege is enforced downstream).
2. **Fail CLOSED on privilege:** if a privilege retag fails, the source must be EXCLUDED from normal retrieval until retag succeeds — never left retrievable on a swallowed error. Wrong-client retag failure: the content must not surface under the new (or old) wrong scope; surface the failure.
3. **Durable + visible:** replace the silent catch with retry-with-backoff AND a visible 'search scope update failed — retrying' state so the user knows the rule isn't live yet (never a false 'active').
4. Tests red-first: privilege-retag failure → source excluded from Ask (proves fail-closed), NOT still retrievable; client-retag failure → not surfaced under wrong scope + honest error; success → clears the state.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · Rust if touched (own CARGO_TARGET_DIR, timeout 1200). Handoff: confirmed failure path, fail-closed proof, gate counts, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/swallow-p0`

## Landmines
useMemoryWiring.ts was recently touched by qa19fix (live-index) — read its changes; don't regress the retry/cancellation work there. Never rename matter_id/Matter. No interactive menus.
