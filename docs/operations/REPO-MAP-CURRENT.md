# Advisor Prep Hero Repo Map — where the current code lives (CURRENT)

> **Last updated: 2026-06-29** by the repo-hygiene cleanup.
> **If you only read one line:** the live, current code is the **`keepance-3.0`** branch. To read/search current code, use **`/home/jameson/keepance`** (now pinned to the `keepance-3.0` tip). To do new work, make a fresh worktree off `keepance-3.0` (command below). **Never trust a random `kp-*` side folder to be current** — check what branch it's on first.

---

## Plain-language summary (read me first)

Think of the project as one big notebook (the "repo"). Over time the team made **dozens of side copies** of that notebook — one per experiment — scattered across the home folder as `kp-…` directories. That's normal for parallel work, but it caused a real problem: the **main folder had quietly drifted onto an old experiment**, so when someone searched it they got *stale* answers. (That's why a search once concluded the OneDrive connector "didn't exist" — it does; the main folder was just looking at an old copy.)

This cleanup fixed that:
1. **The main folder now points at the current code again.** Searching it gives correct answers.
2. **Every dead/finished side copy was deleted** — but only after its work was safely copied to GitHub so nothing was lost.
3. **This map** tells the next person exactly where the current code is, so the confusion doesn't come back.

Nothing unique was thrown away. Everything removed was either already saved in the live branch, or backed up to GitHub under permanent labels (`backup/cleanup-2026-06-29/…`).

---

## The one thing to get right: which folder is current?

| Folder | What it is | Use it for |
|---|---|---|
| **`/home/jameson/keepance`** | The **canonical / main repo**. Pinned to the `keepance-3.0` tip (currently commit `020d8b50`). Shown by git as "detached HEAD" — that's intentional (see note). | **Reading and searching current code.** Don't commit here directly. |
| **`/home/jameson/kp-coord`** | The **coordinator's merge worktree** — it holds the actual `keepance-3.0` branch. The coordinator merges finished work here. | Coordinator only. Don't disturb. |
| **`/home/jameson/kp-<name>`** | A **worktree** = a separate folder checked out to one feature branch, so several agents can work at once without colliding. | Active feature work (each is on its own branch). |

### Why `/home/jameson/keepance` shows "detached HEAD" (and why that's fine)
Git won't let the **same branch** be checked out in two folders at once. The `keepance-3.0` branch currently lives in `kp-coord` (the coordinator uses it to merge). So the main folder can't *also* hold the `keepance-3.0` branch — instead it's **pinned to the exact same commit** as `keepance-3.0`. Result: the main folder always shows current code for reading/searching, without fighting the coordinator over the branch. **Don't commit directly in `/home/jameson/keepance`** — make a worktree instead (below).

---

## How to start new work (the right way, every time)

Always branch off `keepance-3.0` into a **new** worktree. Run this from `kp-coord`:

```bash
git -C /home/jameson/kp-coord worktree add -b <your-branch> /home/jameson/kp-<short-name> keepance-3.0
```

Example:
```bash
git -C /home/jameson/kp-coord worktree add -b feat/export-pdf /home/jameson/kp-export keepance-3.0
```

When the work is merged and done, remove the worktree so it doesn't become stale clutter:
```bash
git -C /home/jameson/kp-coord worktree remove /home/jameson/kp-export
git -C /home/jameson/kp-coord worktree prune
```

**Rule of thumb:** a `kp-*` folder should exist only while its feature is actively in flight. Finished → remove it.

---

## Active worktrees (as of 2026-06-29)

These are the folders that are alive and on a real feature branch. Anything not in this list that you find as a `kp-*` folder later is probably stale — check its branch before trusting it.

| Worktree | Branch | Notes |
|---|---|---|
| `/home/jameson/keepance` | *(pinned to keepance-3.0 tip)* | **Canonical — read/search here.** |
| `/home/jameson/kp-coord` | `keepance-3.0` | **Coordinator merge worktree.** |
| `/home/jameson/kp-clientmap-design` | `feat/clientmap-design` | Active design work. |
| `/home/jameson/kp-conn-access` | `docs/connector-access` | Active connector-access docs. |
| `/home/jameson/kp-demo-v3` | `feat/demo-v3` | Active demo polish. |
| `/home/jameson/kp-redeploy` | *(detached)* | Active redeploy worktree. |
| `/home/jameson/kp-phasec-fix` | `fix/phasec-bench-bugs` | Active (created 2026-06-29). |
| `/home/jameson/kp-conn-addepar` | `feat/connector-addepar` | Connector feature. |
| `/home/jameson/kp-conn-box` | `feat/connector-box` | Connector feature. |
| `/home/jameson/kp-conn-found2` | `feat/connector-foundation-v2` | Connector foundation. |
| `/home/jameson/kp-conn-integration` | `integration/connectors` | Connectors integration branch. |
| `/home/jameson/kp-conn-jotform` | `feat/connector-jotform` | Connector feature. |
| `/home/jameson/kp-conn-sharefile` | `feat/connector-sharefile` | Connector feature. |
| `/home/jameson/kp-conn-zocks` | `feat/connector-zocks` | Connector feature. |
| `/home/jameson/kp-demo-recut` | `feat/demo-video-recut` | Demo video recut. |
| `/home/jameson/kp-demo-v2` | `feat/demo-v2concise` | Demo v2 concise. |
| `/home/jameson/keepance-wt-dialin` | `website/advisor-dial-in` | Website (not deployed). |
| `/home/jameson/keepance-wt-onboarding` | `feat/onboarding-journey` | Onboarding journey. |
| `/home/jameson/keepance-wt-website` | `marketing/website-repositioning` | Website repositioning. |
| `/home/jameson/kp-wt-wealthbox` | `feat/advisor-wealthbox` | ⚠️ See "Open item" below — has a large WIP snapshot committed. |

---

## Branches that still exist and why

Live feature branches (each tied to an active worktree above): the `feat/connector-*`, `integration/connectors`, `feat/demo-*`, `feat/clientmap-design`, `feat/onboarding-journey`, `marketing/website-repositioning`, `website/advisor-dial-in`, `docs/connector-access`, `fix/phasec-bench-bugs`.

Kept on purpose (not deleted), even though not checked out:
- **`keepance-3.0`** — the live/main branch. The one source of truth.
- **`master`, `release/v1.5`, `release/v1.6`, `stable/last-known-good`, `v2-overhaul`** — historical / release / safety reference points. Left alone.
- **`backup/pre-reorg-2026-06-16`, `backup/pre-ui-fullscreen-2026-06-14`, `backup/pre-ui-reimagining-2026-06-13`** — deliberate pre-change safety snapshots. Left alone.
- **`design/clientmap-redesign-wip`, `feat/website-advisor-rewrite`, `feature/stream-c-spike`** — unfinished work not yet merged; preserved on GitHub. Kept.
- **`backup/cleanup-2026-06-29/ux-mockup-wip`, `backup/cleanup-2026-06-29/webdemo-wip`** — work-in-progress rescued from two folders during this cleanup (see below).

---

## What this cleanup did (2026-06-29)

**Before:** ~44 worktrees (including 9 abandoned agent worktrees *inside* `/home/jameson/keepance/.claude/worktrees/`, which is exactly what polluted searches) and ~59 local branches. The main folder was stranded on a stale branch (`fix/audit-load-normalize-metadata`).

**After:** 20 worktrees (all active) and 30 local branches (all justified). The main folder reads current code again.

**Removed (25 worktrees):** every worktree whose branch was already fully merged into `keepance-3.0`, plus the 9 abandoned agent worktrees, plus two throwaway `/tmp` worktrees. Each one's uncommitted work was committed and backed up first.

**Deleted (29 local branches):** every local branch already fully contained in `keepance-3.0` (so nothing unique was lost), plus the 9 internal `worktree-agent-*` refs.

**Backed up before anything was deleted** (data-safety was the priority):
- **20 permanent restore tags on GitHub**, all named `backup/cleanup-2026-06-29/<name>`. A tag carries its commit, so every rescued commit is recoverable forever.
- Uncommitted work was committed onto backup branches/tags first (entity-label/household samples, a privacy egress provider, a memory-wiring test, UX-mockup edits, a webdemo edit, and a 64-file Wealthbox WIP).
- Files git doesn't track (so a folder-delete would have erased them) were copied to **`/home/jameson/keepance-backups/cleanup-2026-06-29/`**: three SDD session reports, and the main folder's untracked docs (onboarding prototype variants, an advisor-first-users campaign, a bug-hunt doc, a ChatGPT UX conversation).

**Independent check:** OpenAI Codex re-verified the "safe to delete" list from scratch (read-only). It caught three untracked report files that would otherwise have been lost — those were rescued before any deletion.

### To restore anything that was removed
```bash
# See every restore point:
git ls-remote --tags origin 'backup/cleanup-2026-06-29/*'
# Recreate a branch from one:
git fetch origin 'refs/tags/backup/cleanup-2026-06-29/<name>:refs/tags/<name>'
git branch <restored> <name>
```
Or look under `/home/jameson/keepance-backups/cleanup-2026-06-29/` for the file copies.

---

## Open item for the coordinator / Jameson

- **`kp-wt-wealthbox`** (`feat/advisor-wealthbox`) had **64 uncommitted files** — a whole Wealthbox connector plus many backend changes. That was too large and ambiguous to auto-remove, so it was **left in place** and its WIP was **committed + tagged** (`backup/cleanup-2026-06-29/advisor-wealthbox-wip`) for safety. Decision needed: is this work still wanted? If yes, it should be reviewed and merged; if no, the worktree can be removed (the snapshot is preserved on GitHub).
- Note there's already a separate **`feat/wealthbox-connector`** that *was* merged — so part of the Wealthbox work is already in `keepance-3.0`. Worth confirming what's new in the `advisor-wealthbox` snapshot vs. what's already shipped.

---

## Screenshots note
The many `kp-*.png` / `keepance-*.png` files in `/home/jameson` are **screenshots, not code folders**. They were left untouched by this cleanup.
