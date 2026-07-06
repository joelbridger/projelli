# Worker brief — hide archived clients from the sidebar + welcome-tour recurrence

You are **cc-lantern-sidebar**, worktree **~/lp-sidebar**, branch **lp/sidebar-archived** (off tip 9067bb7f). Small scoped frontend lane, demo-visible. You do NOT merge. SCOPED tests only; push --no-verify authorized.

## Fix 1 (main): archived clients still show in the client sidebar/list
Found live on the Legion pre-flight: the client sidebar shows every client ever created; archiving does not hide them — so a practice with old/closed clients can never tidy its list. Find the sidebar/client-list source (`src/app/shell/layout/Spine.tsx` reads the matter list ~line 64; also check `src/features/matters/MattersHome.tsx` and the matter store's active/archived state — grep for archived in src/platform/matter/). Fix: archived clients are excluded from the default sidebar list and the Client Map default view; add a small "Show archived" affordance ONLY if one already exists in design patterns nearby — otherwise just exclude them (the Clients management dialog remains the place to see/unarchive them; verify it does). Do NOT rename `matter_id`/`Matter`.

## Fix 2 (bounded): welcome-tour popup re-appears after app restarts
Also found live: the one-time welcome tour showed repeatedly across restarts. Investigate the tour's seen/dismissed persistence (grep onboarding/tour/welcome in src/features/onboarding + platform/state). If it's a simple persist/flag bug (e.g. flag not saved, wrong storage key, cleared by workspace switch), fix it with a test. If it's deeper than ~an hour's scoped work, STOP, write down the root cause precisely, and report it as a finding instead — do not expand scope.

## Method
TDD: (1) archived matter excluded from sidebar list + Client Map default (component/store-level test); (2) unarchived still shows; (3) tour flag persists across a simulated restart. tsc + scoped vitest green.

## Done criteria (HARD)
Committed AND pushed. THEN print exactly: `WORKER-DONE: lp/sidebar-archived` + 3-line summary (incl. whether fix 2 was fixed or reported).
