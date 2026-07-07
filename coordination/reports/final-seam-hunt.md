codex
Read-only seam hunt on `origin/lantern-plus` at `a7bbb578`. I did not edit files or run tests.

**Findings**

1. **High: client-scoped Ask/email saves write outside the client**
   - `src/app/shell/AppSurfaceRouter.tsx:513-524`
   - `src/app/shell/AppSurfaceRouter.tsx:399-410`
   - `src/app/shell/routeSavedAskDocument.ts:34-38`

   Concrete failure: with Hendricks active, “Save to Document” writes the `.docx` at the workspace root, then routes the user into Hendricks Documents. The screen says “client document,” but the file is not inside Hendricks’ folder. Same pattern exists for saving email content.

   Recommended change: when `activeMatter` exists, write to `activeMatter.folderPaths[0]/Documents/...` before routing to the client Documents tab. Add a test that checks the write path, not only the screen route.

2. **High: workflow artifacts saved in client folders reopen in global Documents**
   - `src/app/workflow/useWorkflowRunner.ts:117`
   - `src/app/workflow/useWorkflowRunner.ts:553-587`
   - `src/app/shell/AppSurfaceRouter.tsx:581-587`
   - `src/app/shell/openRunArtifactFromWorkflows.ts:14-16`
   - Existing test locks in the wrong behavior: `tests/unit/app/AppSurfaceRouter-workflow-artifact.test.ts:20-31`

   Concrete failure: workflow output is saved under the active client’s `Documents/Workflows/...`, but clicking it from Workflows opens the hidden/global `files` surface, not the client’s Documents sub-tab. That breaks the new rail-first client model and makes Back/history feel wrong.

   Recommended change: infer/store the artifact’s `matterId`, then route through `showMatterDocuments({ matterId, documentOpened: true })` and push a Back snapshot.

3. **Medium: Back to a deleted/archived client can land on an empty Client Map canvas**
   - `src/platform/state/appNavigationStore.ts:56-68`
   - `src/App.tsx:522-533`
   - `src/features/matters/MattersHome.tsx:952-970`
   - Archived edge source: `src/platform/matter/matterStore.ts:1776-1779`, `src/platform/matter/matterStore.ts:1469-1489`

   Concrete failure: a Back snapshot for Client A gets sanitized to `activeMatterId: null`, but keeps `mattersSurfaceMode: 'client-map'`. The app then shows the “select a client” empty canvas instead of All Clients. Archived clients are worse because `useMatters()` includes archived clients, so the snapshot is treated as valid until `setActiveMatter()` quietly drops it.

   Recommended change: sanitize against active, non-archived clients for UI navigation. If a client snapshot loses its client, convert the destination to All Clients.

4. **Low/Medium: Meeting “Export PDF” also creates an unwanted Word file**
   - `src/features/meetings/MeetingEntry.tsx:415-424`
   - `src/features/meetings/MeetingEntry.tsx:446-457`

   Concrete failure: clicking “Export PDF” first saves a `.docx` into the client Documents folder, then saves the `.pdf`. The user asked for one PDF but gets two client documents.

   Recommended change: convert through a temp docx or in-memory path, then only keep the PDF unless the user explicitly picked Word export.

VERDICT: FINDINGS
tokens used
229,275
Read-only seam hunt on `origin/lantern-plus` at `a7bbb578`. I did not edit files or run tests.

**Findings**

1. **High: client-scoped Ask/email saves write outside the client**
   - `src/app/shell/AppSurfaceRouter.tsx:513-524`
   - `src/app/shell/AppSurfaceRouter.tsx:399-410`
   - `src/app/shell/routeSavedAskDocument.ts:34-38`

   Concrete failure: with Hendricks active, “Save to Document” writes the `.docx` at the workspace root, then routes the user into Hendricks Documents. The screen says “client document,” but the file is not inside Hendricks’ folder. Same pattern exists for saving email content.

   Recommended change: when `activeMatter` exists, write to `activeMatter.folderPaths[0]/Documents/...` before routing to the client Documents tab. Add a test that checks the write path, not only the screen route.

2. **High: workflow artifacts saved in client folders reopen in global Documents**
   - `src/app/workflow/useWorkflowRunner.ts:117`
   - `src/app/workflow/useWorkflowRunner.ts:553-587`
   - `src/app/shell/AppSurfaceRouter.tsx:581-587`
   - `src/app/shell/openRunArtifactFromWorkflows.ts:14-16`
   - Existing test locks in the wrong behavior: `tests/unit/app/AppSurfaceRouter-workflow-artifact.test.ts:20-31`

   Concrete failure: workflow output is saved under the active client’s `Documents/Workflows/...`, but clicking it from Workflows opens the hidden/global `files` surface, not the client’s Documents sub-tab. That breaks the new rail-first client model and makes Back/history feel wrong.

   Recommended change: infer/store the artifact’s `matterId`, then route through `showMatterDocuments({ matterId, documentOpened: true })` and push a Back snapshot.

3. **Medium: Back to a deleted/archived client can land on an empty Client Map canvas**
   - `src/platform/state/appNavigationStore.ts:56-68`
   - `src/App.tsx:522-533`
   - `src/features/matters/MattersHome.tsx:952-970`
   - Archived edge source: `src/platform/matter/matterStore.ts:1776-1779`, `src/platform/matter/matterStore.ts:1469-1489`

   Concrete failure: a Back snapshot for Client A gets sanitized to `activeMatterId: null`, but keeps `mattersSurfaceMode: 'client-map'`. The app then shows the “select a client” empty canvas instead of All Clients. Archived clients are worse because `useMatters()` includes archived clients, so the snapshot is treated as valid until `setActiveMatter()` quietly drops it.

   Recommended change: sanitize against active, non-archived clients for UI navigation. If a client snapshot loses its client, convert the destination to All Clients.

4. **Low/Medium: Meeting “Export PDF” also creates an unwanted Word file**
   - `src/features/meetings/MeetingEntry.tsx:415-424`
   - `src/features/meetings/MeetingEntry.tsx:446-457`

   Concrete failure: clicking “Export PDF” first saves a `.docx` into the client Documents folder, then saves the `.pdf`. The user asked for one PDF but gets two client documents.

   Recommended change: convert through a temp docx or in-memory path, then only keep the PDF unless the user explicitly picked Word export.

VERDICT: FINDINGS
