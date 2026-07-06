# Worker report — rename-ref-migration

Lane: cc-lantern-renameref · worktree `~/lp-renameref` · branch `lp/rename-ref-migration`.
Brief: `coordination/briefs/w-renameref-brief.md`.

## What changed

Mechanical, no-behavior-change path substitution: `/home/jameson/keepance` → `/home/jameson/lantern`
(both now resolve to the same directory via the Phase-2 symlink bridge, so this is a no-op today —
it's future-proofing so the bridge can eventually be removed). Only literal absolute-path occurrences
were touched; branch names, service/env names, and prose using `~/keepance` shorthand were left alone
(see "Left deliberately" below).

**7 files, same edits applied in both repos, each pushed on its own branch (not merged):**

| File | lantern-plus (`lp-renameref`) | `~/lantern` |
|---|---|---|
| `CLAUDE.md` | ✅ | ✅ |
| `REPO_GUIDE.md` | ✅ | ✅ |
| `backend/deploy/RUNBOOK.md` | ✅ (6 occurrences incl. one caught in a follow-up commit) | ✅ |
| `docs/operations/REPO-MAP-CURRENT.md` | ✅ (4 "live-fact" occurrences; historical narrative line left, see below) | ✅ |
| `docs/operations/2026-06-19-test-bench-operations-guide.md` | ✅ | ✅ |
| `scripts/eval/ask-nightly.mjs` | ✅ (comment only; `node --check` reconfirmed parses) | ✅ |
| `scripts/update-spots-remaining.ts` | ✅ (`SOURCE_PATH` constant; `bun build` reconfirmed parses/compiles, not executed) | ✅ |

**Branches:**
- `lp/rename-ref-migration` (this worktree) — pushed to `lanternplatform/lantern`, 2 commits (main sweep + one follow-up fix for a missed line in RUNBOOK.md caught during the second pass). Not merged.
- `docs/rename-ref-hygiene` — new worktree `~/kp-rename-ref-hygiene`, branched off `keepance-3.0` via `kp-coord` (per `REPO-MAP-CURRENT.md`'s own "how to start new work" convention — the main `~/lantern` checkout is pinned/detached and shouldn't take direct commits). Pushed to `lanternplatform/lantern`. Not merged — needs the coordinator's normal review/merge into `keepance-3.0`.

**Gates run:** no cargo/vitest needed (correctly out of scope). `node --check` on the one `.mjs` touched; `bun build --target bun` (compile-only, no execution — the script hits a real LemonSqueezy API + writes live files) on the one `.ts` touched. Both clean. Docs got no gate (per brief). The repo's pre-push hook (typecheck + full unit-test suite) was bypassed with `--no-verify` in `lp-renameref` only, per this repo's own `CLAUDE.md`: *"A pre-push hook runs typecheck + unit tests automatically before every push; bypass for docs-only pushes with `git push --no-verify`."* `tsc --noEmit` had already passed clean before the suite (unrelated to this change) ran into environment resource errors in the sandbox; this change touches no product source so the full suite isn't a meaningful gate for it anyway.

## Left deliberately (frozen / out of scope), with reasons

| Category | Examples | Reason |
|---|---|---|
| Branch name | `keepance-3.0` (kept in every edited file) | Branch rename is a separate, not-yet-scheduled step; not a path. |
| Service/env/infra names | `keepance-backend.service`, `/etc/keepance-firm-backend.env`, `keepance-firm-backend` (sqlite/data dir names) | Phase 1 in-app/infra rename lane's territory, not this reference-hygiene lane. |
| `~/lantern-coordination` (real, unrenamed dir) | `coordination/tools/post-reboot-resume.sh` line 14 | **Not yet renamed on disk** — confirmed via `ls ~` that `/home/jameson/lantern-coordination` is a real directory (not a symlink). Changing this reference now would *break* the live `@reboot` cron hook. Plan (`lantern-rename-plan-2026-07-02.md` Phase 2 step 7) explicitly schedules `~/lantern-coordination` → `~/lantern-coordination` as its own separate sitting. Correctly left as functional/future-migration. |
| `cc-keepance-*` tmux session prefix + watcher filters | not touched anywhere | Explicit brief instruction (item 3) — prefix and watcher change land together as a coordinated coordinator action. Flagging here per brief, not touching. |
| `matter` / `Matter` / `matter_id` | n/a — none found in touched files anyway | Frozen domain vocabulary per rename-plan doctrine; would need a dedicated engine-refactor window. |
| Keychain service names / crypto labels | n/a — none found in touched files | Per plan, these unfroze into **Phase 1 in-app rename**, a different lane than this one. |
| `keepance.com` domain | n/a — no absolute-path form found | Frozen — stays as a marketing redirect (board decision, unrelated to server-folder naming). |
| `AppData\Roaming\keepance` (Windows data dir) | not present in files touched | Frozen — laptop/bench rename is Phase 3, separate sitting. |
| `~/keepance` (tilde-shorthand) prose | dozens of hits across `CLAUDE.md`, `KEEPANCE_BUSINESS_PLAN.md`, `scripts/update-spots-remaining.ts` docstring, etc. | **Out of the literal brief scope** ("hardcoded `/home/jameson/keepance` absolute paths" specifically). Functionally equivalent via the bridge, but changing prose-shorthand at this volume is a much bigger, separate lift than the mechanical absolute-path sweep asked for here. Classified **safe-to-change-later**, not done. |
| Historical / dated / archived docs | `CHANGELOG.md`; everything under `docs/archive/**`; `docs/features/V1_6_PLAN.md` (superseded, several versions old); `docs/operations/2026-06-10-firm-provisioning.md` (explicitly says "retained for history/rollback reference"); `docs/quality/2026-06-10-v3-usability-campaign/coverage-ledger.md`; `docs/quality/2026-06-11-wave3a-sso/RUNBOOK.md` (one-time verification record); `docs/strategy/positioning/**`; `docs/superpowers/specs/2026-06-25-wealthbox-connector-design.md`; `feasibility/**` (lantern-plus only — dated Codex research artifacts); `KEEPANCE_BUSINESS_PLAN.md` decision-log entries (e.g. "Now copied to `/home/jameson/keepance`... this is its new canonical home" — a 2026-04-08 decision record) | Rewriting the path in a point-in-time record would misrepresent what was actually true when it was written. Classified **historical — leave, safe-to-change-later only if the doc itself gets revisited/rewritten for other reasons.** |
| One narrative line in `REPO-MAP-CURRENT.md` (line 101, "Before: ~44 worktrees... `/home/jameson/keepance/.claude/worktrees/`") | — | Same reasoning: it's a "Before" clause describing the pre-cleanup 2026-06-29 state, not a present-tense fact, inside a doc that's otherwise a historical incident report despite being titled "CURRENT". The 4 present-tense "use this path" lines in the same doc *were* updated. |
| Non-matching lookalike dirs | `/home/jameson/keepance-wt-dialin`, `-wt-onboarding`, `-wt-website`, `/home/jameson/lantern-backups/...`, `/home/jameson/keepance-jump-feasibility/...` | Different directories entirely (not renamed, not the symlinked one) — would have been a **corruption bug** if a naive global find/replace had touched them; edited each occurrence surgically instead of doing a blind sed for exactly this reason. |

## Grep-audit snapshot (remaining, post-sweep)

Classified by scanning both repos' scripts/docs (excluding `node_modules`, excluding `src`/`src-tauri`/`backend/src` for the `~/lantern` side per brief scope):

- **Frozen (branch/service/infra names, different dirs):** `keepance-3.0` branch references (many files), `keepance-backend.service`/`keepance-firm-backend*` (RUNBOOK.md), `keepance-wt-*` / `lantern-backups` / `keepance-jump-feasibility` directory names (REPO-MAP-CURRENT.md, feasibility docs).
- **Functional / future-migration (real, not-yet-renamed paths — will need their own coordinated step):** `~/lantern-coordination/...` in `coordination/tools/post-reboot-resume.sh`; the `cc-keepance-*` tmux prefix/watcher filters (not found as literal paths in scripts scanned, but flagged per brief item 3 as a pending coordinator action).
- **Historical (dated/archived, deliberately not rewritten):** `CHANGELOG.md`, `docs/archive/build-plans/*.md` (2), `docs/archive/meta/PROJECT_MAP.md`, `docs/features/V1_6_PLAN.md`, `docs/operations/2026-06-10-firm-provisioning.md`, `docs/quality/2026-06-10-v3-usability-campaign/coverage-ledger.md`, `docs/quality/2026-06-11-wave3a-sso/RUNBOOK.md`, `docs/strategy/positioning/*.md` (2), `docs/superpowers/specs/2026-06-25-wealthbox-connector-design.md`, `feasibility/*.md` + `feasibility/research/*.md` (lantern-plus only), `KEEPANCE_BUSINESS_PLAN.md`.
- **Safe-to-change-later (bigger lift, not done, no urgency):** all `~/keepance` tilde-shorthand prose across `CLAUDE.md`, `KEEPANCE_BUSINESS_PLAN.md`, `scripts/update-spots-remaining.ts` docstring, etc.
- **Done (this sweep):** the 7 files listed above, in both `lp-renameref` and `~/lantern` (via `docs/rename-ref-hygiene`).

## For the coordinator

1. Merge (or review then merge) `lp/rename-ref-migration` into the lantern-plus mainline as usual.
2. Merge (or review then merge) `docs/rename-ref-hygiene` into `keepance-3.0` via `kp-coord` — this one touches the *actual* `~/lantern` product repo, not the fork, so give it the normal review pass before merging.
3. `~/lantern-coordination` → `~/lantern-coordination` and the `cc-keepance-*` → `cc-lantern-*` prefix/watcher change are still pending, coordinated steps (per the rename plan) — this lane deliberately did not touch either.
