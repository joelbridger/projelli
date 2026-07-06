# Worker brief — QA-90 (part 1): Ask "still importing" banner

You are **cc-lantern-qa90**, worktree **~/lp-qa90**, branch **lp/qa90-import-banner** (off a4046edd). Small scoped frontend lane. You do NOT merge; the coordinator merges.

## Goal (demo step 4 polish)
While connectors are still importing data (email/OneDrive/Wealthbox sync in progress), the Ask surface should show a small, friendly, non-blocking banner telling the user data is still coming in — so a half-empty answer during a demo reads as "still importing", not "broken". Ask must remain fully usable while it shows.

## Pointers
- Ask surface: `src/features/ask/` (grep for the main Ask component).
- Import/sync progress state already exists — the setup progress screen consumes it (`useAccountSync`, recent work in lp/progress-screen merged at f3680f01, QA-89). Reuse that same signal; do NOT invent a new tracking mechanism.
- Visual: match the existing design system (`src/ui/`), light theme, subtle (e.g. a slim info bar above the Ask input), auto-hides when all imports are done. Plain everyday copy, no jargon, no "sync" tech-speak — something like "Still bringing in your files and email — answers may be incomplete."
- i18n: follow how neighboring Ask strings handle text (there is an i18n gate in CI).

## Method
TDD where practical: a Vitest component/unit test that the banner shows while imports are active and hides when done. Keep the diff SMALL and scoped to Ask + (if needed) a tiny selector export from the sync state. No refactors.

## Done criteria (HARD)
1. Tests red→green with real output; `npx tsc --noEmit` green; scoped `npx vitest run` green.
2. Committed AND pushed (`git push -u origin lp/qa90-import-banner`; `--no-verify` only if pre-push fails for unrelated assets — say so).
3. THEN print exactly: `WORKER-DONE: lp/qa90-import-banner` + 3-line summary.
