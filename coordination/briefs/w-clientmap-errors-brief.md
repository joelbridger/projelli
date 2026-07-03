ROLE: Scoped fix worker. One bug: the per-client Client Map masks EVERY retrieval/index error as "check your AI connection" — a catch-all at src/features/matters/useClientMap.ts:118 (verify by symbol; the tip moves). Real-world cost, twice: during our Windows smokes, a RAG-store "memory integrity uncertain; re-index" error surfaced as an AI-connection error and burned triage time both times. For an advisor, being told to check their AI key when the real fix is "re-index this client's files" is a trust-eroding dead end.

WORKDIR: ~/lp-cmfix (git worktree, branch lp/clientmap-errors off current origin/lantern-plus tip — pull first). NOT self-merged.

FIX (robust route): classify the error at the catch site and surface DISTINCT advisor-facing states: (a) index/retrieval problems → plain-language message naming the real problem + a re-index action or hint ("This client's files need re-indexing" style — match existing copy voice, plain words); (b) provider/AI errors → keep the existing AI-connection message; (c) unknown → a generic message that does NOT claim it's the AI connection. Classify on the typed/structured error where one exists (read how the RAG layer and provider layer shape their errors first — classify on stable fields/types, not fragile message-string matching, unless strings are genuinely all there is; if so, note that in your handoff). Check whether sibling surfaces (whole-practice Ask, At-a-Glance) share the same catch-all pattern — if the SAME one-line pattern exists there, fix it the same way; if it's structurally different, report it, don't expand scope.

TESTS: unit tests for the classification (index error → re-index message; provider error → AI message; unknown → generic) + keep existing tests green.

NON-NEGOTIABLES: TS-only (no Rust — if the error shape genuinely needs a Rust change, STOP and ask COORDINATOR:). Never rename matter_id/Matter. Light theme. Plain-language user-facing copy per repo voice rules. Stay in-lane.

ENVIRONMENT: no cargo. npx vitest run <paths>; full check before handoff: npx tsc --noEmit + scoped vitest.

RULES: COORDINATION MODE (plain-text COORDINATOR: decisions, no menus). TDD. Self-converge via codex-review to one clean round. Evidence handoff: HEAD SHA, test counts, files touched, how you classified (typed vs string), sibling-surface findings, "NOT self-merged". THEN print your done sentinel for lp/clientmap-errors as the very last line in the standard worker format.
