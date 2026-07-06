codex
Fetched and reviewed `origin/lantern-plus` at `1aeef22112db5693ef931019373a496bf423f548`.

**P1 - Deleted client can leave old AI-search memory behind if purge fails**
`src/platform/matter/matterStore.ts:1059` removes the matter from UI state immediately, then fire-and-forgets `ragDeleteMatter(id)` and `mailClearMatterFilings(id)` at `src/platform/matter/matterStore.ts:1105` / `:1111`. If `rag_delete_matter` fails once in `src-tauri/src/commands/rag/lifecycle.rs:64`-`:88` because LanceDB/table delete is temporarily unavailable, the matter is already gone from the app and there is no durable retry/hold.

Concrete failure: user deletes Client A, purge fails, then whole-practice Ask can still retrieve Client A chunks because all-matters search has no matter filter (`src-tauri/src/commands/rag/query.rs:141`-`:148`). On next boot, reconcile can trust the stale manifest/rows as “already indexed” under the deleted matter id (`src-tauri/src/commands/rag/reconcile.rs:149`-`:168`), so this may not self-heal.

Recommended change: make matter deletion fail-closed. Either wait for RAG/mail cleanup before removing the matter, or write a durable “pending deleted matter” record before UI removal, exclude those matter ids from retrieval, and retry purge on boot until clean.

```diff
- remove matter from store
- void ragDeleteMatter(id).catch(console.warn)
+ markDeletedMatterPending(id) // durable, retrieval excludes it now
+ await ragDeleteMatter(id)
+ await mailClearMatterFilings(id)
+ remove matter from store
+ clearDeletedMatterPending(id)
```

**P2 - Purge progress event can overwrite a real indexing banner**
`src-tauri/src/commands/onedrive/commands.rs:711`-`:720` emits `rag-indexing-progress` with `status: Done` and `deleted: 1` after purge. `useRagStatus` treats every progress event as the full latest state (`src/platform/hooks/useRagStatus.ts:81`-`:106`). So if workspace indexing is currently running, this purge event can replace the “indexing” snapshot with “done.” `RagStatusBadge` then says “Memory: ready” (`src/platform/rag/ui/RagStatusBadge.tsx:24`-`:30`), and `RagProgressBanner` hides because the purge event has `total = 0` (`src/platform/rag/ui/RagProgressBanner.tsx:159`).

Concrete failure: user starts a large workspace index, disconnects OneDrive during it, and the memory banner/status briefly says ready or disappears even though indexing is still running. That is confusing and removes the visible Cancel button until another indexing event arrives.

Recommended change: do not reuse the indexing progress channel as an authoritative UI snapshot for purge-only invalidation. Add a separate “content invalidated” event, or have `useRagStatus` ignore/merge purge-only `done` events.

```diff
- emit("rag-indexing-progress", { status: "done", deleted: 1 })
+ emit("rag-content-invalidated", { deleted: 1, source: "onedrive" })
```

or:

```diff
+ if (p.status === 'done' && p.deleted > 0 && p.total === 0 && p.reindexed === 0) {
+   // invalidate citation cache elsewhere, but do not replace active indexing UI state
+   return;
+ }
```

VERDICT: FINDINGS
tokens used
256,059
Fetched and reviewed `origin/lantern-plus` at `1aeef22112db5693ef931019373a496bf423f548`.

**P1 - Deleted client can leave old AI-search memory behind if purge fails**
`src/platform/matter/matterStore.ts:1059` removes the matter from UI state immediately, then fire-and-forgets `ragDeleteMatter(id)` and `mailClearMatterFilings(id)` at `src/platform/matter/matterStore.ts:1105` / `:1111`. If `rag_delete_matter` fails once in `src-tauri/src/commands/rag/lifecycle.rs:64`-`:88` because LanceDB/table delete is temporarily unavailable, the matter is already gone from the app and there is no durable retry/hold.

Concrete failure: user deletes Client A, purge fails, then whole-practice Ask can still retrieve Client A chunks because all-matters search has no matter filter (`src-tauri/src/commands/rag/query.rs:141`-`:148`). On next boot, reconcile can trust the stale manifest/rows as “already indexed” under the deleted matter id (`src-tauri/src/commands/rag/reconcile.rs:149`-`:168`), so this may not self-heal.

Recommended change: make matter deletion fail-closed. Either wait for RAG/mail cleanup before removing the matter, or write a durable “pending deleted matter” record before UI removal, exclude those matter ids from retrieval, and retry purge on boot until clean.

```diff
- remove matter from store
- void ragDeleteMatter(id).catch(console.warn)
+ markDeletedMatterPending(id) // durable, retrieval excludes it now
+ await ragDeleteMatter(id)
+ await mailClearMatterFilings(id)
+ remove matter from store
+ clearDeletedMatterPending(id)
```

**P2 - Purge progress event can overwrite a real indexing banner**
`src-tauri/src/commands/onedrive/commands.rs:711`-`:720` emits `rag-indexing-progress` with `status: Done` and `deleted: 1` after purge. `useRagStatus` treats every progress event as the full latest state (`src/platform/hooks/useRagStatus.ts:81`-`:106`). So if workspace indexing is currently running, this purge event can replace the “indexing” snapshot with “done.” `RagStatusBadge` then says “Memory: ready” (`src/platform/rag/ui/RagStatusBadge.tsx:24`-`:30`), and `RagProgressBanner` hides because the purge event has `total = 0` (`src/platform/rag/ui/RagProgressBanner.tsx:159`).

Concrete failure: user starts a large workspace index, disconnects OneDrive during it, and the memory banner/status briefly says ready or disappears even though indexing is still running. That is confusing and removes the visible Cancel button until another indexing event arrives.

Recommended change: do not reuse the indexing progress channel as an authoritative UI snapshot for purge-only invalidation. Add a separate “content invalidated” event, or have `useRagStatus` ignore/merge purge-only `done` events.

```diff
- emit("rag-indexing-progress", { status: "done", deleted: 1 })
+ emit("rag-content-invalidated", { deleted: 1, source: "onedrive" })
```

or:

```diff
+ if (p.status === 'done' && p.deleted > 0 && p.total === 0 && p.reindexed === 0) {
+   // invalidate citation cache elsewhere, but do not replace active indexing UI state
+   return;
+ }
```

VERDICT: FINDINGS
