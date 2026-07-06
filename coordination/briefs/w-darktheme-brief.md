# Worker brief — unprompted DARK THEME after app restart (Jameson-priority bug)

You are **cc-lantern-darktheme**, a scoped frontend investigation+fix lane. Create worktree **~/lp-darktheme** on a new branch **lp/theme-light-lock** off current `origin/lantern-plus` (`git -C ~/lantern-plus worktree add -b lp/theme-light-lock ~/lp-darktheme origin/lantern-plus`). Copy `public/ocr/*` from another lp-* worktree if the pre-push hook complains (known gap). You do NOT merge. SCOPED tests only. Read `coordination/WORKER-DISCIPLINE.md`.

## The bug (observed live in the demo dry-run on real Windows)
After an app restart, the app came up in a DARK theme without anyone asking for it. Product rule: the app is a polished LIGHT theme; Jameson strongly dislikes dark mode. An unprompted dark flip during his real demo would be a disaster — this is why it's priority.

## Job
1. Root-cause it. Prime suspects: a `prefers-color-scheme`/OS-theme-following default kicking in when the persisted theme flag is missing or not yet hydrated at first paint; a storage key cleared on restart or scoped per-workspace; Tauri/WebView2 dark titlebar/background default. Grep theme/dark/color-scheme across `src/` + `src-tauri/` (tauri.conf.json, window config) and find the exact mechanism — evidence, not guesses.
2. Fix it robustly (core-app rule: no shortcuts): the app must deterministically come up LIGHT on every launch regardless of OS theme, unless a user explicitly chose otherwise in some future setting. Kill any flash-of-dark at first paint too if present.
3. TDD where testable (theme resolution/persistence unit tests); tsc + scoped vitest green.

## Done criteria (HARD)
Root cause written in the commit message in plain language. Committed AND pushed (`git push --no-verify -u origin lp/theme-light-lock`), verify with `git ls-remote`. THEN print exactly: `WORKER-DONE: lp/theme-light-lock` + 3-line summary (root cause, fix, how verified).
