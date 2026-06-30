# Advisor Prep Hero UX — ROUND 6 plan (2026-06-15)

Jameson's live testing feedback on the Files tab + Settings. Branch `feature/ux-round6-2026-06-15`,
backup tag `pre-ux-round6-2026-06-15`. NOT deployed. R6-1 then R6-2 (both touch App.tsx, so SEQUENTIAL).

## R6-1 — Files tab: tree + grid views, drag-and-drop, create-in-folder
The v2 working components STILL EXIST (byte-identical) but aren't wired into the reimagined Documents tab:
- `src/components/workspace/FileTree.tsx` — a vertical EXPANDING tree with working drag-into-folder DnD
  (draggable rows, onDragOver/onDrop on folders, drop indicators, root-drop, self/descendant guard). Reads
  the workspace store; needs only `onMove={handleMove}` (already exists).
- `src/components/workspace/FileGridView.tsx` — a grid with working move-DnD + breadcrumb drop targets.
- App's `handleMove` (App.tsx:1858) + `WorkspaceService.move` + the backends are COMPLETE and `onMove` is
  already passed to `ReimaginedDocumentsHome` (3818) -> but `DocumentGridView` declares `onMove` and never
  uses it (props not destructured) = "cannot drag files/folders into folders".
- New-doc bug: `handleCreateDocxAtRoot` (App.tsx:2074) hardcodes `${rootPath}/docs/`; New folder already
  uses `currentFolderPath` correctly. So new documents always land at root, not the open folder.

Build:
- **A tree/grid toggle in the Files tab.** Tree view = reuse `FileTree.tsx` (expanding + DnD already work).
  Grid view = `DocumentGridView` with DnD WIRED (port FileGridView's handlers: draggable cards, onDrop on
  folder cards -> `await onMove(source, folder.path)`; breadcrumb drop; actually destructure + use the
  `onMove` prop that's already passed). Both read the same store + the same onMove/onFileOpen/create handlers.
- **Drag folders into folders + files into folders** working in BOTH views (FileTree already does folders;
  ensure the grid does too; the move handler appends the basename, guards self/descendant).
- **Create-in-current-folder fix:** add an optional `parentPath` to `handleCreateDocxAtRoot` /
  `handleCreateDefaultDocument` (+ the md/text/richtext variants), default to `<root>/docs`, and pass
  `currentFolderPath ?? rootPath` from `DocumentGridView.handleCreateDocument` through `ReimaginedDocumentsHome`.
  So a new document appears in the folder you're in. (Mirror what New folder already does.)
- **Icon fix:** `DocumentGridView.getGridIcon` reads `node.extension` which TauriFSBackend never populates;
  derive the extension from `node.name` so desktop icons render.
- Preserve: files-as-tabs, Add files + trust note, Trash, the citation-persistence e2e (email-open).

## R6-2 — Settings: accordion sub-sections, scroll-reset, and Settings as a nav tab
- **Accordion sub-sections.** The 5 sections render flat `<h3>` SubHeaders (Editor/Files; AI/Memory/Privacy;
  Account/Firm/Usage/Connections; etc.) with too much shown at once. Make each sub-section a COLLAPSIBLE
  accordion, AUTO-COLLAPSED, with only ONE open at a time (within a section). Sensible default-open (the
  first/most-used sub-section). Keep search working (a search hit should reveal/expand the relevant sub-section).
- **Scroll reset.** The content area keeps its scroll position when you switch top-level sections; reset the
  content scrollTop to 0 on section change.
- **Settings as a nav tab.** Add a "Settings" item to the left nav UNDER Activity Log (`ReimaginedSpine`),
  rendering the same settings content full-page in the main window (so Settings is available as a tab, not
  only the modal). Extract the modal's inner content into a reusable `SettingsContent` used by BOTH the modal
  and the full-page tab; add a `'settings'` SpineTab + an App.tsx render branch; keep the existing modal +
  all deep-links working (the modal can stay for quick access; the tab is the in-window home).

## Waves (sequential — both touch App.tsx)
R6-1 (Files) -> verify + commit -> R6-2 (Settings) -> verify + commit -> verify + merge to keepance-3.0,
docs + memory, NOT deployed, notify.

## Verification gate
typecheck 0 · targeted vitest then full suite · eslint clean on touched · live dev-server check (drag a
file into a folder in BOTH tree + grid; new doc appears in the open folder; tree/grid toggle; Settings
accordions open one-at-a-time + scroll resets on section switch; the Settings nav tab renders; citations
survive nav; --kp-navy ok; zero errors). Master ledger: `2026-06-14-ux-program-LEDGER.md`.
