# Worker brief — Rename reference migration (post-Phase-2, bridge active)

**Lane:** cc-lantern-renameref · worktree `~/lp-renameref` · branch `lp/rename-ref-migration`. **Model:** Sonnet 5 · high.
Context: `~/keepance` is now a symlink to `~/lantern` (Phase 2 done 2026-07-04). Everything works via the bridge; this lane migrates lingering absolute-path + name references so the bridge can eventually be removed. Plan: `~/lantern-coordination/INITIATIVES/lantern-rename-plan-2026-07-02.md` (Phase 2 step 5).

## Scope — SAFE reference hygiene ONLY (do not break anything the bridge is currently covering)
1. Grep the lantern-plus repo (`~/lantern-plus`) for hardcoded `/home/jameson/keepance` absolute paths in scripts/docs/coordination tooling; update to `/home/jameson/lantern` where the reference is ours to change AND the target is unambiguous. Leave anything that is a deliberate keepance name (domain keepance.com redirect, `AppData\Roaming\keepance` legacy data-dir functional references, `matter`/`Matter`/`matter_id`, keychain service names — all FROZEN per the plan).
2. Same grep in `~/lantern` repo scripts/docs (NOT src runtime code — that's the separate Phase-1 app migration lane; this is scripts/docs/infra only).
3. Do NOT change: the `cc-keepance-*` tmux session prefix or watcher filters (the plan says prefix + watcher filters change TOGETHER in a coordinated step — flag them in your report as a coordinator action, don't touch).
4. Produce a report: what you changed, what you deliberately left (with the frozen-reason), and a grep-audit snapshot of remaining `keepance` references classified (frozen / functional / future-migration / safe-to-change-later).

## Rules
- Additive/mechanical only; no behavior change. If a path change would alter what a script actually does, STOP and report it instead.
- Gates: for any script touched, shellcheck-or-run its `--help`/dry-run to confirm it still parses; for docs, none. No product source, no cargo, no vitest expected (flag if you find yourself needing them — means you strayed out of scope).
- Push; do NOT merge. Last line exactly: `WORKER-DONE: lp/rename-ref-migration`
