# Worker brief — QA-93: client/matter state becomes per-workspace (BUILD-ONLY, post-demo merge)

You are **cc-lantern-qa93**, worktree **~/lp-qa93**, branch **lp/qa93-per-workspace** (off current origin/lantern-plus tip). Architecture + migration lane, correctness-sensitive. You do NOT merge. 🧊 TIP FREEZE: build, prove, push, stop. SCOPED tests only.

## The flaw (observed live on a real bench; root-caused)
Switching workspaces moves files/indexing to the new root, but the client list stays — matters persist under ONE app-global key (`lantern:matters`, src/config/identity.ts:52; matterStore.ts:526/555/1174), client maps under `lantern:client-maps` (clientMapStore.ts:429), and workspace-switch reloads audit/tree/sources/chats but never the matter store (useWorkspaceLifecycle.ts:150-313). Result: workspace B shows workspace A's clients; whole-practice Ask counts the wrong book. Full investigation + agreed fix direction: `scratchpad wsswitch log summarized in TaskList #15` — the authoritative work-list is below.

## The fix (the investigation's direction, verified by the coordinator)
1. Scope matter/client-map persistence PER WORKSPACE (key includes a stable workspace identity — the root path or a derived id; choose and document).
2. On workspace switch (all entry paths: Open Existing, Recent Projects, boot restore), load ONLY that workspace's clients; fresh workspace = empty Client Map + the normal "+ New client / import" paths.
3. Make getMatters()/useMatters()/useActiveMatters()/resolveMatterIdForPath()/whole-practice Ask read current-workspace matters only.
4. MIGRATION for existing global data (one-time, safe): carry matters whose absolute folderPaths live under the opened workspace root; carry matching client maps by matter id; NEVER guess relative paths — leave unmigrated (still reachable if that workspace opens and matches).
5. Compatibility duty: the parked branch lp/swallow-p0 (@6fdcc5ed) touches mail-exclusion state in useMemoryWiring — READ its diff first and keep your store changes compatible (its durable mail-hold store pendingMailRetagStore is per-workspace already — follow its keying pattern for consistency).
6. LOCKED: never rename `matter_id`/`Matter` (wire facade). RAG matter scoping semantics unchanged — this is about STORE partitioning, not retrieval.

## Method
Strict TDD, staged commits: (a) keying + migration with tests (fresh install; legacy global data; two workspaces round-trip; relative-path data left alone); (b) lifecycle reload on switch (all three entry paths); (c) reader funnel-through; (d) whole-practice Ask counts current workspace only. tsc + scoped vitest per stage. This is core-app: robust over quick, no shortcuts.

## Done criteria (HARD)
All stages red→green, committed AND pushed (`git push --no-verify -u origin lp/qa93-per-workspace`). THEN print exactly: `WORKER-DONE: lp/qa93-per-workspace` + 5-line summary (keying choice, migration behavior, what happens to unmigrated data, swallow-p0 compatibility note). Branch waits for the post-demo window (merges AFTER lp/swallow-p0; expect a rebase).
