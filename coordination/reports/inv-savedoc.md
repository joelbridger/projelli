codex
Read-only check done. I did not change files or run tests.

**Bug 1: Save To Document**

Root cause: the Save button is wired, and it likely creates the file, but it opens the new file into the hidden editor state while the screen stays on Ask. To Jameson, that looks like “nothing happened.”

Path:

- Button click: [TurnBlock.tsx](/home/jameson/lantern-plus/src/features/ask/TurnBlock.tsx:341) calls `onSaveToDocument(turnIdx, turn.answer)`.
- Ask passes handler: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:596)
- Handler sets loading and calls parent: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:1519)
- Parent creates `.docx`: [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:397)
- Break: it calls `openFile(...)` at [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:412), but does not navigate away from Ask.
- `openFile` only changes editor store state: [editorStore.ts](/home/jameson/lantern-plus/src/platform/state/editorStore.ts:261)

Fix shape:

```diff
After saving the .docx:
- refresh file tree
- open the new file
+ navigate to the right visible Documents place:
+   if activeMatter exists:
+     open that client's Client Map hub
+     switch to its Documents tab
+     show the saved file under the toolbar
+   else:
+     switch to global Documents editor
+ show an inline success/error state if save fails or cannot run
```

Also remove the silent return at [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:398), or surface “No workspace is open” if that ever happens.

**Bug 2: Source Click Navigation**

Current Client Map path:

- Client Map chip click: [ClientMapPanel.tsx](/home/jameson/lantern-plus/src/features/matters/ClientMapPanel.tsx:263)
- Matter hub handler: [MatterHub.tsx](/home/jameson/lantern-plus/src/features/matters/MatterHub.tsx:235)
- Shared dispatcher: [openSource.ts](/home/jameson/lantern-plus/src/features/matters/clientMap/openSource.ts:71)
- Document source sends `lantern:matter-launch` with `surface: 'files'`: [openSource.ts](/home/jameson/lantern-plus/src/features/matters/clientMap/openSource.ts:136)
- Break: event bus handles document source by switching to global `files`: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:118)

Current Ask source paths:

- Ask Sources side card uses built-in opener: [SourcePanel.tsx](/home/jameson/lantern-plus/src/features/ask/SourcePanel.tsx:32)
- It also sends `surface: 'files'`: [SourcePanel.tsx](/home/jameson/lantern-plus/src/features/ask/SourcePanel.tsx:41)
- Same break in event bus: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:120)

Extra Ask bug:

- Inline citation chips call `onOpenFileAtPath`: [CitationText.tsx](/home/jameson/lantern-plus/src/features/ask/CitationText.tsx:69)
- But Ask’s app wiring only handles email and ignores documents: [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:417)

Recommended shared helper:

Create one app-level helper, something like:

```ts
openMatterDocumentSource({
  matterId,
  ref,
  snippet,
  paragraphIndex,
  workspaceService,
  pushHistory,
})
```

It should do this in one place:

```diff
+ push current app location to Back history
+ setActiveMatter(matterId)
+ setClientMapHubId(matterId)
+ setClientMapHubTab('documents')
+ open/read the cited file
+ set active editor tab to that file
+ set a one-shot "show this file in embedded Documents" intent
+ set sidebarActiveTab('matters')
+ scroll to snippet/paragraph after mount
```

Important: plain `documentsView = 'editor'` is not enough. Embedded client Documents currently forces the file list on first mount: [DocumentsHome.tsx](/home/jameson/lantern-plus/src/features/documents/DocumentsHome.tsx:447). So the fix needs a specific “open this exact file in client Documents” one-shot, not the existing broad `documentsView` flag.

Both these callers should use the same helper:

- Client Map `dispatchOpenSource(...)`
- Ask `SourcePanel.openCitation(...)`
- Ask inline `onOpenFileAtPath(...)`

**Back Button Needs**

Add a small app navigation history stack. Each entry should remember:

```ts
{
  sidebarActiveTab,
  activeMatterId,
  clientMapHubId,
  clientMapHubTab,
  documentsView,
  activeTabPath
}
```

Hook `push` before programmatic jumps here:

- `useGlobalEventBus` matter-launch handling: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:101)
- Sidebar tab changes: [App.tsx](/home/jameson/lantern-plus/src/App.tsx:1623)
- The new shared source-document helper
- Any “open email/source/client” helper that moves the user across surfaces

Back restore should set those same stores back in reverse order, then restore the active tab.
tokens used
238,787
Read-only check done. I did not change files or run tests.

**Bug 1: Save To Document**

Root cause: the Save button is wired, and it likely creates the file, but it opens the new file into the hidden editor state while the screen stays on Ask. To Jameson, that looks like “nothing happened.”

Path:

- Button click: [TurnBlock.tsx](/home/jameson/lantern-plus/src/features/ask/TurnBlock.tsx:341) calls `onSaveToDocument(turnIdx, turn.answer)`.
- Ask passes handler: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:596)
- Handler sets loading and calls parent: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:1519)
- Parent creates `.docx`: [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:397)
- Break: it calls `openFile(...)` at [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:412), but does not navigate away from Ask.
- `openFile` only changes editor store state: [editorStore.ts](/home/jameson/lantern-plus/src/platform/state/editorStore.ts:261)

Fix shape:

```diff
After saving the .docx:
- refresh file tree
- open the new file
+ navigate to the right visible Documents place:
+   if activeMatter exists:
+     open that client's Client Map hub
+     switch to its Documents tab
+     show the saved file under the toolbar
+   else:
+     switch to global Documents editor
+ show an inline success/error state if save fails or cannot run
```

Also remove the silent return at [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:398), or surface “No workspace is open” if that ever happens.

**Bug 2: Source Click Navigation**

Current Client Map path:

- Client Map chip click: [ClientMapPanel.tsx](/home/jameson/lantern-plus/src/features/matters/ClientMapPanel.tsx:263)
- Matter hub handler: [MatterHub.tsx](/home/jameson/lantern-plus/src/features/matters/MatterHub.tsx:235)
- Shared dispatcher: [openSource.ts](/home/jameson/lantern-plus/src/features/matters/clientMap/openSource.ts:71)
- Document source sends `lantern:matter-launch` with `surface: 'files'`: [openSource.ts](/home/jameson/lantern-plus/src/features/matters/clientMap/openSource.ts:136)
- Break: event bus handles document source by switching to global `files`: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:118)

Current Ask source paths:

- Ask Sources side card uses built-in opener: [SourcePanel.tsx](/home/jameson/lantern-plus/src/features/ask/SourcePanel.tsx:32)
- It also sends `surface: 'files'`: [SourcePanel.tsx](/home/jameson/lantern-plus/src/features/ask/SourcePanel.tsx:41)
- Same break in event bus: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:120)

Extra Ask bug:

- Inline citation chips call `onOpenFileAtPath`: [CitationText.tsx](/home/jameson/lantern-plus/src/features/ask/CitationText.tsx:69)
- But Ask’s app wiring only handles email and ignores documents: [AppSurfaceRouter.tsx](/home/jameson/lantern-plus/src/app/shell/AppSurfaceRouter.tsx:417)

Recommended shared helper:

Create one app-level helper, something like:

```ts
openMatterDocumentSource({
  matterId,
  ref,
  snippet,
  paragraphIndex,
  workspaceService,
  pushHistory,
})
```

It should do this in one place:

```diff
+ push current app location to Back history
+ setActiveMatter(matterId)
+ setClientMapHubId(matterId)
+ setClientMapHubTab('documents')
+ open/read the cited file
+ set active editor tab to that file
+ set a one-shot "show this file in embedded Documents" intent
+ set sidebarActiveTab('matters')
+ scroll to snippet/paragraph after mount
```

Important: plain `documentsView = 'editor'` is not enough. Embedded client Documents currently forces the file list on first mount: [DocumentsHome.tsx](/home/jameson/lantern-plus/src/features/documents/DocumentsHome.tsx:447). So the fix needs a specific “open this exact file in client Documents” one-shot, not the existing broad `documentsView` flag.

Both these callers should use the same helper:

- Client Map `dispatchOpenSource(...)`
- Ask `SourcePanel.openCitation(...)`
- Ask inline `onOpenFileAtPath(...)`

**Back Button Needs**

Add a small app navigation history stack. Each entry should remember:

```ts
{
  sidebarActiveTab,
  activeMatterId,
  clientMapHubId,
  clientMapHubTab,
  documentsView,
  activeTabPath
}
```

Hook `push` before programmatic jumps here:

- `useGlobalEventBus` matter-launch handling: [useGlobalEventBus.ts](/home/jameson/lantern-plus/src/app/lifecycle/useGlobalEventBus.ts:101)
- Sidebar tab changes: [App.tsx](/home/jameson/lantern-plus/src/App.tsx:1623)
- The new shared source-document helper
- Any “open email/source/client” helper that moves the user across surfaces

Back restore should set those same stores back in reverse order, then restore the active tab.
