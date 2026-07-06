codex
I found two seam bugs. I stayed read-only.

**High — OneDrive “delete local files” can leave searchable ghost chunks**

Refs: `src-tauri/src/commands/onedrive/engine.rs:462`, `src-tauri/src/commands/onedrive/engine.rs:464`, `src-tauri/src/commands/onedrive/commands.rs:410`, `src-tauri/src/commands/onedrive/commands.rs:573`, `src-tauri/src/commands/onedrive/commands.rs:368`, `src/platform/hooks/useMemoryWiring.ts:771`

Failure scenario: OneDrive writes real files into the workspace, then the normal file watcher indexes those files as regular document chunks. On disconnect with “delete local files,” the backend deletes the files and purges only `source_type = "onedrive"` rows. It does not directly delete the regular document RAG rows for the materialized file paths. If the watcher delete event is missed or Ask runs before the queued cleanup finishes, deleted OneDrive content can still be retrieved and cited.

Recommended change: after each successful materialized file delete, synchronously delete RAG rows for that relative file path too. Treat that delete as part of the disconnect cleanup, not just a watcher side effect. Add a test that seeds a normal-file RAG row for a materialized OneDrive path, disconnects with delete enabled, then proves retrieval returns no hit.

```diff
- delete_materialized_files(...)
+ delete_materialized_files(...) should also purge RAG by each deleted relative path

  for rel in paths {
    remove workspace file...
+   if file delete succeeded or file was already missing {
+     rag_store::delete_path(table, rel, rag_key).await?;
+   }
  }
```

**Medium — OneDrive purge can leave old green citation checks on screen**

Refs: `src-tauri/src/commands/onedrive/commands.rs:368`, `src-features/ask/citationVerification.ts:149`, `src/features/ask/citationVerification.ts:168`, `src/features/ask/citationVerification.ts:243`, `src/features/ask/SourcePanel.tsx:320`, `src/features/ask/SourcePanel.tsx:365`, `src/features/ask/AnswerBlocks.tsx:155`

Failure scenario: an Ask answer cites a OneDrive-only chunk and the citation verifier marks it verified. Then the user disconnects OneDrive. The backend directly purges OneDrive RAG rows, but the frontend citation cache is only cleared by normal RAG progress events. The old citation key is still marked “already checked,” so it does not refetch. The UI can keep showing “verified” after the source was deleted.

Recommended change: any connector purge that changes RAG content should fire the same cache-invalidating event as indexing/deleting. Or call `clearCitationVerificationCache` after `oneDriveDisconnect` when `ragPurged` is true. Add a test that starts with a verified cached citation, simulates OneDrive purge, and proves the next render refetches instead of reusing the green verdict.

VERDICT: FINDINGS
tokens used
449,511
I found two seam bugs. I stayed read-only.

**High — OneDrive “delete local files” can leave searchable ghost chunks**

Refs: `src-tauri/src/commands/onedrive/engine.rs:462`, `src-tauri/src/commands/onedrive/engine.rs:464`, `src-tauri/src/commands/onedrive/commands.rs:410`, `src-tauri/src/commands/onedrive/commands.rs:573`, `src-tauri/src/commands/onedrive/commands.rs:368`, `src/platform/hooks/useMemoryWiring.ts:771`

Failure scenario: OneDrive writes real files into the workspace, then the normal file watcher indexes those files as regular document chunks. On disconnect with “delete local files,” the backend deletes the files and purges only `source_type = "onedrive"` rows. It does not directly delete the regular document RAG rows for the materialized file paths. If the watcher delete event is missed or Ask runs before the queued cleanup finishes, deleted OneDrive content can still be retrieved and cited.

Recommended change: after each successful materialized file delete, synchronously delete RAG rows for that relative file path too. Treat that delete as part of the disconnect cleanup, not just a watcher side effect. Add a test that seeds a normal-file RAG row for a materialized OneDrive path, disconnects with delete enabled, then proves retrieval returns no hit.

```diff
- delete_materialized_files(...)
+ delete_materialized_files(...) should also purge RAG by each deleted relative path

  for rel in paths {
    remove workspace file...
+   if file delete succeeded or file was already missing {
+     rag_store::delete_path(table, rel, rag_key).await?;
+   }
  }
```

**Medium — OneDrive purge can leave old green citation checks on screen**

Refs: `src-tauri/src/commands/onedrive/commands.rs:368`, `src-features/ask/citationVerification.ts:149`, `src/features/ask/citationVerification.ts:168`, `src/features/ask/citationVerification.ts:243`, `src/features/ask/SourcePanel.tsx:320`, `src/features/ask/SourcePanel.tsx:365`, `src/features/ask/AnswerBlocks.tsx:155`

Failure scenario: an Ask answer cites a OneDrive-only chunk and the citation verifier marks it verified. Then the user disconnects OneDrive. The backend directly purges OneDrive RAG rows, but the frontend citation cache is only cleared by normal RAG progress events. The old citation key is still marked “already checked,” so it does not refetch. The UI can keep showing “verified” after the source was deleted.

Recommended change: any connector purge that changes RAG content should fire the same cache-invalidating event as indexing/deleting. Or call `clearCitationVerificationCache` after `oneDriveDisconnect` when `ragPurged` is true. Add a test that starts with a verified cached citation, simulates OneDrive purge, and proves the next render refetches instead of reusing the green verdict.

VERDICT: FINDINGS
