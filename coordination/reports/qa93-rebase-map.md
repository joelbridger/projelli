codex
Read-only investigation done. I ran `git fetch origin` and a no-touch `git merge-tree`.

**Result**
- Merge base: `9c3a4f5a`
- `origin/lantern-plus` has 34 commits after that base, representing the 6 landed branches.
- Git finds **one text conflict**: `CHANGELOG.md`.
- I found **one real semantic collision**: the new citation-verification memory needs to be cleared on workspace switch.

**Conflict Map**
1. `CHANGELOG.md`
   - QA93 side: adds the per-workspace client/matter storage fix and the later audit/cancel-switch fixes.
   - Latest `lantern-plus` side: adds Local-AI trimming plus theme light-lock, citation badge consistency, notice-card retry, connector/reindex fixes.
   - Correct resolution: keep both. Remove markers. Keep the latest `### Added` Local-AI section, then under `### Fixed` include the QA93 bullets plus all landed tip bullets. Do not pick one side.

2. `src/features/ask/citationVerification.ts` + `src/app/lifecycle/useWorkspaceLifecycle.ts`
   - QA93 intent: when the workspace changes, client/matter/client-map state swaps to the new workspace, and migration audit entries only flush after the audit log points at the new workspace.
   - Tip intent: citation verification is now app-wide, remembers checked citations, dedupes checks, and writes audit entries.
   - Collision: citation verification is app-wide but not workspace-aware. If workspace A starts a citation check, then the user switches to workspace B before it finishes, the late result can:
     - show a stale verdict in workspace B if ids/excerpts line up;
     - skip a needed re-check because `requested` still contains the old key;
     - write the old citation audit entry into the new workspace’s audit log.
   - Correct resolution: clear/cancel citation-verification cache on workspace root change. Do this from `useWorkspaceLifecycle.ts`, not `reloadWorkspaceScopedStores.ts`, because `platform/state` should not import an Ask feature.

Recommended patch shape, not applied:

```diff
diff --git a/src/features/ask/citationVerification.ts b/src/features/ask/citationVerification.ts
@@
-function clearCitationVerificationCache(): void {
+export function clearCitationVerificationCacheForWorkspaceChange(): void {
   if (
@@
   cacheEpoch += 1;
   useCitationVerdictsStore.setState((s) => ({
     verdicts: new Map<string, RealVerdict>(),
     retryTick: s.retryTick + 1,
   }));
 }
@@
-  if (contentChanged) clearCitationVerificationCache();
+  if (contentChanged) clearCitationVerificationCacheForWorkspaceChange();
}
```

```diff
diff --git a/src/app/lifecycle/useWorkspaceLifecycle.ts b/src/app/lifecycle/useWorkspaceLifecycle.ts
@@
 import { reloadWorkspaceScopedStores } from '@/platform/state/reloadWorkspaceScopedStores';
 import { flushPendingMatterMigrationAudit } from '@/platform/matter/matterStore';
+import { clearCitationVerificationCacheForWorkspaceChange } from '@/features/ask/citationVerification';
@@
       const nextRoot = state.rootPath;
       if (nextRoot === prevRoot) return;
       prevRoot = nextRoot;
+      clearCitationVerificationCacheForWorkspaceChange();
       reloadWorkspaceScopedStores(nextRoot);
```

Add a small test proving a workspace switch bumps the citation cache epoch so an old in-flight verification result does not land or audit after the switch.

**Clean Merge Areas**
- `settingsStore.ts` theme light-lock: no QA93 code overlap. Keep the `origin/lantern-plus` version.
- Retrieval/privileged-source exclusion: no direct QA93 overlap. QA93’s per-workspace matter scoping should make this safer, not worse.
- RAG reindex swap / local AI trimming / OneDrive changes: no QA93 overlap.

**Watch Item**
`tests/e2e/theme-system.spec.ts` in `origin/lantern-plus` appears to seed `themeExplicitlyChosen` inside `values`, but `settingsStore.ts` reads it as a top-level persisted field. That looks like a tip-side test bug, not a QA93 rebase collision.
tokens used
151,145
Read-only investigation done. I ran `git fetch origin` and a no-touch `git merge-tree`.

**Result**
- Merge base: `9c3a4f5a`
- `origin/lantern-plus` has 34 commits after that base, representing the 6 landed branches.
- Git finds **one text conflict**: `CHANGELOG.md`.
- I found **one real semantic collision**: the new citation-verification memory needs to be cleared on workspace switch.

**Conflict Map**
1. `CHANGELOG.md`
   - QA93 side: adds the per-workspace client/matter storage fix and the later audit/cancel-switch fixes.
   - Latest `lantern-plus` side: adds Local-AI trimming plus theme light-lock, citation badge consistency, notice-card retry, connector/reindex fixes.
   - Correct resolution: keep both. Remove markers. Keep the latest `### Added` Local-AI section, then under `### Fixed` include the QA93 bullets plus all landed tip bullets. Do not pick one side.

2. `src/features/ask/citationVerification.ts` + `src/app/lifecycle/useWorkspaceLifecycle.ts`
   - QA93 intent: when the workspace changes, client/matter/client-map state swaps to the new workspace, and migration audit entries only flush after the audit log points at the new workspace.
   - Tip intent: citation verification is now app-wide, remembers checked citations, dedupes checks, and writes audit entries.
   - Collision: citation verification is app-wide but not workspace-aware. If workspace A starts a citation check, then the user switches to workspace B before it finishes, the late result can:
     - show a stale verdict in workspace B if ids/excerpts line up;
     - skip a needed re-check because `requested` still contains the old key;
     - write the old citation audit entry into the new workspace’s audit log.
   - Correct resolution: clear/cancel citation-verification cache on workspace root change. Do this from `useWorkspaceLifecycle.ts`, not `reloadWorkspaceScopedStores.ts`, because `platform/state` should not import an Ask feature.

Recommended patch shape, not applied:

```diff
diff --git a/src/features/ask/citationVerification.ts b/src/features/ask/citationVerification.ts
@@
-function clearCitationVerificationCache(): void {
+export function clearCitationVerificationCacheForWorkspaceChange(): void {
   if (
@@
   cacheEpoch += 1;
   useCitationVerdictsStore.setState((s) => ({
     verdicts: new Map<string, RealVerdict>(),
     retryTick: s.retryTick + 1,
   }));
 }
@@
-  if (contentChanged) clearCitationVerificationCache();
+  if (contentChanged) clearCitationVerificationCacheForWorkspaceChange();
}
```

```diff
diff --git a/src/app/lifecycle/useWorkspaceLifecycle.ts b/src/app/lifecycle/useWorkspaceLifecycle.ts
@@
 import { reloadWorkspaceScopedStores } from '@/platform/state/reloadWorkspaceScopedStores';
 import { flushPendingMatterMigrationAudit } from '@/platform/matter/matterStore';
+import { clearCitationVerificationCacheForWorkspaceChange } from '@/features/ask/citationVerification';
@@
       const nextRoot = state.rootPath;
       if (nextRoot === prevRoot) return;
       prevRoot = nextRoot;
+      clearCitationVerificationCacheForWorkspaceChange();
       reloadWorkspaceScopedStores(nextRoot);
```

Add a small test proving a workspace switch bumps the citation cache epoch so an old in-flight verification result does not land or audit after the switch.

**Clean Merge Areas**
- `settingsStore.ts` theme light-lock: no QA93 code overlap. Keep the `origin/lantern-plus` version.
- Retrieval/privileged-source exclusion: no direct QA93 overlap. QA93’s per-workspace matter scoping should make this safer, not worse.
- RAG reindex swap / local AI trimming / OneDrive changes: no QA93 overlap.

**Watch Item**
`tests/e2e/theme-system.spec.ts` in `origin/lantern-plus` appears to seed `themeExplicitlyChosen` inside `values`, but `settingsStore.ts` reads it as a top-level persisted field. That looks like a tip-side test bug, not a QA93 rebase collision.
