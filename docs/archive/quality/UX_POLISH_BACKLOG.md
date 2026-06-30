# UX Polish Backlog

Comprehensive list of UX improvements identified during the Phase 7 audit (2026-04-15). Each ticket has a unique ID, priority, acceptance criteria, and status. Updated as tickets close.

---

## Status legend

- 🚧 In progress
- ✅ Done — hash: `<commit>`
- ⏸ Deferred (with reason)
- 📋 Not started

## Priority legend

- **P0** — Critical: bug or blocker that affects first impression
- **P1** — High: clear friction or discoverability issue
- **P2** — Medium: polish, professional feel
- **P3** — Delight: nice-to-have, future iteration
- **P4** — Feature: bigger additions beyond pure polish

---

## Wave 1 — Critical bugs (P0)

### UX-01: Welcome dialog has no functional dismiss
**Priority:** P0
**Status:** ✅ Done — hash: `dc3f2c8`
**Problem:** On first run with no workspace, the Welcome to Advisor Prep Hero dialog shows a close X button. Clicking it does nothing. Pressing Escape does nothing. Dialog stays up indefinitely. First-run users see a broken product.
**Acceptance criteria:**
- Clicking the X closes the dialog AND returns the user to either the workspace-selection state or an empty app state where they can still reopen the dialog via command palette
- Escape key dismisses the dialog the same way
- If the dialog is meant to be strictly blocking, REMOVE the X button entirely to avoid the broken interaction
**Files:** `src/components/workspace/WorkspaceSelector.tsx` (or wherever the welcome dialog lives)
**Effort:** S

### UX-02: Command palette missing DialogTitle (a11y error)
**Priority:** P0
**Status:** ✅ Done — hash: `8c717b5`
**Problem:** Ctrl+K opens the command palette. Radix logs `DialogContent` requires a `DialogTitle` for the component to be accessible — this is an ERROR not a warning. Screen reader users get no context for the dialog.
**Acceptance criteria:**
- Add `<DialogTitle>` (using `VisuallyHidden` or `className="sr-only"` if no visible title is wanted)
- Radix errors no longer appear in the console when opening the palette
**Files:** `src/components/` command palette component (find via grep for `DialogContent`)
**Effort:** XS

### UX-03: Sidebar nav tabs aren't tabs (a11y)
**Priority:** P0
**Status:** ✅ Done — hash: `a094d45`
**Problem:** Sidebar section buttons (Files/Search/Workflows/etc.) use `role="button"`. The pattern is a tablist — screen readers won't announce arrow-key navigation or which tab is selected.
**Acceptance criteria:**
- Container uses `role="tablist"` with `aria-orientation="vertical"`
- Each button has `role="tab"` and `aria-selected` correctly set
- Associated panels have `role="tabpanel"` and `aria-labelledby` pointing to the tab
- Arrow up/down moves focus between tabs (native tablist keyboard pattern)
**Files:** `src/components/layout/Sidebar.tsx` or equivalent
**Effort:** S

---

## Wave 2 — Onboarding + welcome experience (P1)

### UX-04: Zero onboarding for BYOK model
**Priority:** P1
**Status:** ✅ Done — hash: `8d972bd`
**Problem:** A new user creates a workspace and gets dropped into an empty app. Nothing tells them they need to add an API key before AI works. Silent dead-end for a product whose core feature is AI.
**Acceptance criteria:**
- After workspace selection, if no API keys are configured, main panel shows a prominent "Next step: add your AI key" card with a one-click link to the API keys panel
- OR: first chat attempt with no keys inline-prompts the key setup
- Card is dismissible but reappears after a full session restart if still no keys
**Files:** `src/App.tsx`, `src/components/layout/MainPanel.tsx`, `src/components/onboarding/` (likely new dir)
**Effort:** M

### UX-05: "New Workspace" doesn't explain structure
**Priority:** P1
**Status:** ✅ Done — hash: `1c6bffb`
**Problem:** The button says "New Workspace — With default structure." What structure? Users hesitate without knowing.
**Acceptance criteria:**
- Either: show a small preview list of folders (e.g., `docs/`, `notes/`, `projects/`) under the button, OR remove the "With default structure" subtitle entirely if no real structure is created
- If a structure IS created, ensure it's documented in the Getting Started doc
**Files:** `src/components/workspace/WorkspaceSelector.tsx`
**Effort:** XS

### UX-06: Welcome dialog copy is too thin
**Priority:** P1
**Status:** ✅ Done — hash: `1dc106b`
**Problem:** "Select an existing workspace folder or create a new one to get started." Doesn't explain what a workspace is, why it matters (local-first), or what Advisor Prep Hero does.
**Acceptance criteria:**
- Add one-sentence elevator pitch: "Advisor Prep Hero saves your AI chats as real files on your computer — pick a folder to save them into."
- Add a small "Learn more" link that opens the Getting Started doc (already exists at `website/docs/getting-started.html`)
**Files:** `src/components/workspace/WorkspaceSelector.tsx`
**Effort:** XS

### UX-07: No onboarding tour or empty-state prompts
**Priority:** P1
**Status:** ✅ Done — hash: `7edffda`
**Problem:** Empty states are bare: "No files in workspace", "AI Audit Log (0 entries)". Users don't know what each tab does without clicking into it.
**Acceptance criteria:**
- Each sidebar panel's empty state has: an icon, a 1-2 sentence explanation of what that feature does, and a call-to-action (button or keyboard shortcut hint)
- Files empty state: "No files yet. Create one from the toolbar above, drop files in from your desktop, or press Ctrl+N."
- Search: "Search file names and content across your workspace. Try `todo:` or `@unresolved`."
- Workflows: "Pre-built AI workflows for founders. Pick one to start a guided conversation."
- AI Audit Log: "Every AI action in your workspace gets logged here so you can review or undo."
- Trash: "Deleted files live here for 30 days before being removed permanently."
**Files:** Sidebar panel components (each panel gets its own empty-state component or prop)
**Effort:** M

---

## Wave 3 — High-impact UX (P1)

### UX-08: API keys tab only shows one provider at a time
**Priority:** P1
**Status:** ✅ Done — hash: `e781fef`
**Problem:** The Keys sub-tab shows `api-key-input-google` when no keys are set — other providers (Anthropic, OpenAI, Gemini) aren't visible or require scroll. For a BYOK product, all providers should be immediately discoverable.
**Acceptance criteria:**
- All supported providers (Claude, OpenAI, Gemini) render simultaneously in the Keys panel with labeled inputs
- Each has a "Get key →" link that opens the provider's API key management page in a new tab
- Saved keys show a masked placeholder (e.g., `sk-ant-••••…••••abc`)
- Clear "tested ✓" or "invalid ✗" status per key after first use
**Files:** `src/components/ai/APIKeysPanel.tsx` or equivalent
**Effort:** M

### UX-09: Workflows panel unusable at narrow heights
**Priority:** P1
**Status:** ✅ Done — hash: `7aa7c25`
**Problem:** At 780px-tall viewport, workflows scrollable area is 131px of 3,230px content (4% visible). 15 workflows exist; only 1-2 visible at a time.
**Acceptance criteria:**
- Workflows panel stretches to fill all available sidebar height
- If the sidebar is too short to show the panel usefully, show a "View all workflows" button that opens a full-screen modal or dedicated tab
- Individual workflow cards don't wrap their titles awkwardly
**Files:** `src/components/workflow/WorkflowsPanel.tsx` or equivalent
**Effort:** S

### UX-10: No visible keyboard shortcut hints
**Priority:** P1
**Status:** ✅ Done — hash: `636e967`
**Problem:** Many features have shortcuts (discoverable via Ctrl+K) but the UI buttons themselves don't show them. Tooltips don't include shortcuts.
**Acceptance criteria:**
- All interactive elements with keyboard shortcuts show the shortcut in their tooltip (e.g., "Save File (Ctrl+S)")
- A `?` key shortcut opens a keyboard-shortcuts overlay modal listing every shortcut grouped by category
- The overlay uses proper Dialog a11y (no repeat of UX-02)
**Files:** `src/components/layout/MainPanel.tsx` toolbar buttons, new `src/components/ShortcutsOverlay.tsx`
**Effort:** M

---

## Wave 4 — Visual polish (P2)

### UX-11: Icon inconsistency — Research tab permanently tinted
**Priority:** P2
**Status:** ✅ Done — hash: `69a05dc`
**Problem:** The "Research" sidebar tab icon appears in a permanent orange/brown color regardless of selection state. Every other sidebar icon is monochrome when inactive. Looks like a stuck state.
**Acceptance criteria:**
- Research icon follows the same monochrome-inactive / accent-active pattern as other sidebar icons
- If a distinctive color was intentional (e.g., branded color), move it to a hover/selected state only
**Files:** `src/components/layout/Sidebar.tsx`
**Effort:** XS

### UX-12: Workflow template cards truncate names vertically
**Priority:** P2
**Status:** ✅ Done — hash: `df5eec1`
**Problem:** "New Business Kickoff" renders stacked vertically one word per line because card is too narrow.
**Acceptance criteria:**
- Workflow cards have sensible min-width (180px) or use intrinsic sizing with ellipsis
- Long names wrap gracefully (max 2 lines, then ellipsis)
- Hover reveals full name via tooltip
**Files:** `src/components/workflow/WorkflowCard.tsx` or equivalent
**Effort:** S

### UX-13: Editor toolbar wraps awkwardly at narrow widths
**Priority:** P2
**Status:** ✅ Done — hash: `36554df`
**Problem:** At narrow widths, the right-side toolbar actions (Auto-save / History / Export / Download / Split / Outline / Backlinks) wrap below the tab row, creating awkward layout.
**Acceptance criteria:**
- At narrow widths, less-critical toolbar items collapse into a `…` overflow menu
- Critical items (Save, Close) always visible
- OR: all items collapse to icon-only at narrow widths
**Files:** `src/components/layout/MainPanel.tsx` toolbar
**Effort:** M

### UX-14: No breadcrumb navigation for deep files
**Priority:** P2
**Status:** ✅ Done — hash: `49d68c0`
**Problem:** Status bar shows `test-workspace` and `test2.txt` but no clickable intermediate path. Users can't navigate up from deeply-nested files.
**Acceptance criteria:**
- Status bar breadcrumbs are clickable segments: `test-workspace / docs / guides / test2.txt`
- Clicking a segment navigates the file tree to that folder
- Truncates from the middle with an ellipsis button on very deep paths
**Files:** `src/components/layout/StatusBar.tsx`
**Effort:** M

### UX-15: "Create Markdown File" dialog doesn't show destination
**Priority:** P2
**Status:** ✅ Done — hash: `b52d7ff`
**Problem:** The prompt says "Enter file name (without extension):" but doesn't show where the file will live. If user is in a subfolder, they can't tell.
**Acceptance criteria:**
- Dialog shows: "Creating in `/docs/`" (or current-folder path)
- Below the input, show a preview of the resulting filename with extension: `my-document.md`
- Allow the user to change the destination via a "Change location" link
**Files:** `src/components/workspace/CreateFileDialog.tsx` or equivalent
**Effort:** S

### UX-16: No confirm before destructive actions
**Priority:** P2
**Status:** ✅ Done — hash: `5e2a4e7`
**Problem:** Rename and move may not require confirmation. For a local-first product holding user data, destructive actions should either require confirmation OR provide a 10-second undo toast.
**Acceptance criteria:**
- Delete shows an "Undo" toast for 10 seconds before committing
- Bulk delete requires a modal confirmation
- Rename is reversible within the same session via Ctrl+Z
**Files:** `src/components/workspace/FileTree.tsx`, new toast utilities
**Effort:** M

### UX-17: Auto-save indicator is cryptic
**Priority:** P2
**Status:** ✅ Done — hash: `008bbb7`
**Problem:** "Auto-save" appears as a static badge. No way to know if it's currently saving, last saved N seconds ago, or has pending changes.
**Acceptance criteria:**
- When saving: badge shows a spinner + "Saving..."
- When clean: badge shows "Saved · 3s ago" (relative time, updates)
- When dirty and about to save: "Unsaved changes"
- When save errors: "Save failed" + retry button
**Files:** `src/components/layout/MainPanel.tsx` or status-bar component
**Effort:** S

### UX-18: Formula bar + selection summary reserve space when empty
**Priority:** P2
**Status:** ✅ Done — hash: `b4cc38f`
**Problem:** Phase 7 made these always-visible (with nbsp placeholders) to prevent layout shift when selecting cells. They take vertical space even when no cell is selected.
**Acceptance criteria:**
- When no cell selected: collapse formula bar + summary to a thin (4-6px) divider that's visually quiet
- On first click: animate open to full height smoothly (~120ms ease)
- No layout shift between cells after the initial expansion
**Files:** `src/components/media/SpreadsheetViewer.tsx`
**Effort:** S

---

## Wave 5 — Delight (P3)

### UX-19: Drag-and-drop file upload to tree or editor
**Priority:** P3
**Status:** ✅ Done — hash: `dacc969`
**Problem:** "Upload" is a button but users expect to drag files into the window. Most workspace apps (Notion, Obsidian, VS Code) support this.
**Acceptance criteria:**
- Dragging a file over the window shows a drop-zone overlay ("Drop to add to workspace")
- Dropped files are copied into the current folder (or root if no folder selected)
- Multiple files dropped at once each become a new file
- Drop onto a specific folder in the tree puts them there
**Files:** `src/App.tsx` or new `src/hooks/useFileDropZone.ts`
**Effort:** M

### UX-20: No "What's new" for version updates
**Priority:** P3
**Status:** ✅ Done — hash: `360ac39`
**Problem:** When users update to a new version, no in-app changelog appears. Missed opportunity to highlight improvements.
**Acceptance criteria:**
- After version change, a dismissible toast/banner appears: "Updated to v1.x — see what's new"
- Links to an in-app changelog modal with release notes per version
- Persists "last seen version" in localStorage so toast only fires once per update
**Files:** `src/components/WhatsNew.tsx` (new), `src/utils/version.ts` (new)
**Effort:** M

### UX-22: Tab close X always visible
**Priority:** P3
**Status:** ✅ Done — hash: `1b2cde9`
**Problem:** Every open tab shows a close X. Visual noise with many tabs. Chrome/Arc show X only on hover.
**Acceptance criteria:**
- Close X shows only when tab is hovered or active
- Keyboard shortcut still closes active tab without needing the X (Ctrl+W already works)
- Non-hover close button with `aria-label="Close tab"` still accessible for keyboard users via Tab navigation
**Files:** `src/components/editor/TabBar.tsx`
**Effort:** S

### UX-23: Collapsed sidebar has unlabeled icons
**Priority:** P3
**Status:** ✅ Done — hash: `496deb7`
**Problem:** "Collapse sidebar" hides labels. Collapsed state shows just icons with no tooltips on hover.
**Acceptance criteria:**
- When sidebar is collapsed, each icon has a tooltip with its label
- Tooltips also include any keyboard shortcut
- Works for keyboard users (Tab navigation + focus → tooltip visible)
**Files:** `src/components/layout/Sidebar.tsx`
**Effort:** S

### UX-24: Version history confusing for non-versioned types
**Priority:** P3
**Status:** ✅ Done — hash: `7c7a12f`
**Problem:** "History (0)" shows for binary docs (.xlsx/.docx) but these files don't participate in version tracking per `shouldVersionFile()`. Confusing for users.
**Acceptance criteria:**
- Hide the History button on file types that aren't versioned (per `shouldVersionFile`)
- OR extend versioning to binaries (larger lift; defer unless cheap)
- Document which types are versioned in the user docs
**Files:** `src/components/layout/MainPanel.tsx`
**Effort:** XS

### UX-25: Theme toggle doesn't respect system preference
**Priority:** P3
**Status:** ✅ Done — hash: `58e0d15`
**Problem:** Theme toggle is binary (light/dark). No "system preference" option. Night mode users who change OS setting don't get automatic sync.
**Acceptance criteria:**
- Toggle cycles: light → dark → system (default: system)
- "System" mode follows `prefers-color-scheme` media query
- Icon reflects current mode (sun/moon/half-moon)
- Tooltip explains current state
**Files:** `src/stores/themeStore.ts` or equivalent, theme toggle component
**Effort:** S

### UX-30: Word count on markdown/plain-text editors
**Priority:** P3
**Status:** ✅ Done — hash: `f1ed7b8`
**Problem:** Phase 7 added word count to Docx/RTF editors but not to Markdown/Plain Text. Inconsistent.
**Acceptance criteria:**
- Markdown editor has same word-count footer (`247 words · 1,421 characters`)
- Plain Text editor likewise
- Same styling and testid (`editor-word-count`)
**Files:** `src/components/editor/MarkdownEditor.tsx`, `src/components/editor/PlainTextEditor.tsx`
**Effort:** S

---

## Wave 6 — Missing features (P4)

### UX-21: AI Assistant as main-panel tab type (not just sidebar)
**Priority:** P4
**Status:** ✅ Done — hash: `fd40eab`
**Problem:** The AI Assistant lives in the narrow sidebar. Heavy chat use — the core value prop — is cramped. Other tools (ChatGPT Desktop, Claude Desktop, Cursor) give chat a major UI slot.
**Acceptance criteria:**
- Opening AI Assistant creates a main-panel tab (like .aichat files already do)
- Sidebar retains a quick "New chat" button but the ongoing chats live in main-panel tabs
- Existing .aichat file type flows remain compatible
- Keyboard shortcut `Ctrl+Shift+A` opens AI Assistant as a new tab or focuses existing
**Files:** `src/components/layout/MainPanel.tsx`, `src/stores/editorStore.ts`, sidebar AI panel
**Effort:** L

### UX-26: Full-text search across file content
**Priority:** P4
**Status:** ✅ Done — hash: `885074e`
**Problem:** The Search panel exists but current scope unclear. Full-text search across workspace content is table-stakes for a workspace app.
**Acceptance criteria:**
- Search queries match both filenames AND file content (markdown, plain text, RTF, and text-extracted XLSX/DOCX/PPTX/CSV)
- Results show a snippet with highlighted match
- Cmd/Ctrl+clicking a result opens the file with the match highlighted
- Client-side indexing via MiniSearch or similar (no server required — stays local-first)
- Index rebuilds incrementally as files change
**Files:** `src/modules/search/` (new), `src/components/search/SearchPanel.tsx`
**Effort:** L

### UX-27: Ctrl+P fuzzy file switcher
**Priority:** P4
**Status:** ✅ Done — hash: `85e04ae`
**Problem:** Power users reach for `Ctrl+P` (VS Code, Obsidian) to quickly open files by fuzzy name. Advisor Prep Hero has `Ctrl+K` for commands but no separate file-open.
**Acceptance criteria:**
- `Ctrl+P` opens a quick-open modal with fuzzy filename matching (fuse.js or similar)
- Arrow keys navigate, Enter opens, Esc cancels
- Recent files shown first when input is empty
- Reuses the same Dialog pattern as Ctrl+K (and inherits the a11y fix from UX-02)
**Files:** `src/components/QuickOpen.tsx` (new)
**Effort:** M

### UX-28: AI response → draggable to file tree
**Priority:** P4
**Status:** ✅ Done — hash: `b68efa2`
**Problem:** Currently AI responses become files via buttons. A drag gesture from any AI response directly onto the file tree would be a delightful power-user shortcut.
**Acceptance criteria:**
- Any AI response message has a drag handle (or whole-message drag)
- Dropping on a file tree folder creates a new file there with the message content as markdown
- Dropping on an existing file inserts/appends content
- Filename generated from first line of content (sanitized)
**Files:** `src/components/ai/AIChatViewer.tsx`, file tree drop handlers
**Effort:** M

### UX-29: Undo for file deletions (Trash + toast)
**Priority:** P4
**Status:** ✅ Done — hash: `4fe507b`
**Problem:** Undoing accidental file deletes isn't obvious. A Trash panel exists but no toast-level undo.
**Acceptance criteria:**
- Deleting a file shows a toast with "Undo" for 10 seconds
- Clicking Undo restores the file immediately (also works from Trash)
- File stays in Trash 30 days then auto-purges (document in user docs)
- Keyboard: after deletion, Ctrl+Z restores most-recent
**Files:** `src/components/workspace/FileTree.tsx`, new toast component if not present
**Effort:** M

---

## Wave 7 — Testing feedback (2026-04-16)

User testing on the Windows build surfaced 11 issues. These are a mix of real bugs (CSV parse, DOCX corruption, app freeze) and missing polish. Priorities reflect severity, not position.

### UX-31: Welcome dialog — Recent workspaces section is too big
**Priority:** P2
**Status:** ✅ Done — hash: `c68c2e9`
**Problem:** When the welcome dialog opens, the "Recent workspaces" section is expanded by default and takes up a lot of vertical space, making the dialog look bloated and ugly.
**Acceptance criteria:**
- Recent workspaces section is collapsed by default (or capped to top 3 entries inline)
- Clicking an expand toggle (e.g., "Show all recent") reveals the full list
- Dialog feels compact and focused
**Files:** `src/components/workspace/WorkspaceSelector.tsx`
**Effort:** S

### UX-32: CSV drag-drop throws atob error (critical bug)
**Priority:** P0
**Status:** ✅ Done — hash: `1e962a4`
**Problem:** Dropping a `.csv` file onto the window produces: `Failed to parse spreadsheet, failed to execute ATOB on window: the string to be decoded is not correctly encoded.` Diagnosis: the drag-drop writer reads CSV as text, but `parseSpreadsheet` then calls `dataUrlToArrayBuffer` which runs `atob()` on non-base64 content.
**Acceptance criteria:**
- `parseSpreadsheet` handles both data URLs AND raw text for CSVs
- Dropping a CSV opens and renders correctly
- Add a unit test that exercises both input shapes
**Files:** `src/utils/spreadsheet-io.ts`, `src/utils/fileDrop.ts`
**Effort:** S

### UX-33: Uploaded files don't auto-switch to the new tab
**Priority:** P1
**Status:** ✅ Done — hash: `b4a9bf2`
**Problem:** When user drops files, they're added as tabs but the active tab doesn't change. User has to hunt for the new file.
**Acceptance criteria:**
- After drop, the last-dropped file becomes the active tab
- If multiple dropped, the first one becomes active (or the most recent — pick the common convention)
- Existing tab focus is preserved if drop fails
**Files:** `src/utils/fileDrop.ts`, `src/App.tsx`
**Effort:** XS

### UX-34: PowerPoint preview requires LibreOffice — add pure-JS fallback
**Priority:** P1
**Status:** ✅ Done — hash: `39b0606`
**Problem:** User without LibreOffice installed sees a dead-end. We chose LibreOffice for fidelity but never-preview isn't acceptable for a $49 product.
**Chosen approach:** Hybrid — keep the LibreOffice→PDF path as primary (high fidelity), add a pure-JS fallback renderer when LibreOffice isn't detected. Users see slides with basic shapes, text, and images even without the dependency.
**Acceptance criteria:**
- When LibreOffice is absent OR fails, `PresentationViewer` falls back to pure-JS rendering via a library like `pptxjs`, `pptx-preview`, or a custom slide walker over the DrawingML XML (via the JSZip we already load)
- Fallback clearly labeled: "Basic preview (install LibreOffice for full fidelity)"
- Both paths render — user can toggle "Install LibreOffice" messaging into a less-intrusive banner at top
**Files:** `src/components/media/PresentationViewer.tsx`, `src/utils/pptx-io.ts`
**Effort:** M-L

### UX-35: DOCX corruption — "can't find end of central directory" after edit
**Priority:** P0
**Status:** ✅ Done — hash: `7c37a57`
**Problem:** User edits a `.docx`, switches away, switches back — sees `Couldn't open {file}. Can't find end of central directory`. JSZip error = the file's ZIP structure is broken. Likely our docx round-trip serializer is producing a malformed archive on save.
**Acceptance criteria:**
- Round-trip save produces a valid `.docx` that re-opens cleanly
- If round-trip fails, the save is aborted and the user sees a clear error before the file is overwritten
- Backup-before-first-edit must remain effective so nothing is lost
- Investigate: look for a bug in `serializeDocx` in `src/utils/docx-io.ts`; possibly related to how images are re-embedded or how the Document is packaged. May need to compare the resulting zip structure against known-good .docx files.
**Files:** `src/utils/docx-io.ts`, `src/components/media/DocxEditor.tsx`
**Effort:** M

### UX-36: Tab overflow should be user-configurable
**Priority:** P3
**Status:** ✅ Done — hash: `f60efba`
**Problem:** Phase 7 replaced wrap with horizontal scroll. User wants to choose between horizontal scroll and multi-row wrap.
**Acceptance criteria:**
- Settings (new or existing panel) exposes a "Tab overflow behavior" option: `Scroll horizontally` | `Wrap to multiple rows`
- Persisted in localStorage
- Default: horizontal scroll (current behavior)
**Files:** `src/components/editor/TabBar.tsx`, a settings store/panel
**Effort:** M

### UX-37: File icons are all the same white document
**Priority:** P2
**Status:** ✅ Done — hash: `ea14f09`
**Problem:** In the Files pane, the tab bar, AND the grid view, every file currently shows a generic white document icon. Need unique, colored icons per extension so users can visually scan.
**Acceptance criteria:**
- Single source of truth `src/utils/fileIcons.ts` — maps extension → `{ Icon: LucideIcon, color: string }`
- Applied consistently in: FileTree rows, TabBar tab labels, GridView tiles, any other file surface
- Color palette coordinated (not random): spreadsheets green, word docs blue, powerpoints orange, audio pink, images purple, etc.
- Respects light/dark theme
**Files:** `src/utils/fileIcons.ts` (new), `src/components/workspace/FileTree.tsx`, `src/components/editor/TabBar.tsx`, `src/components/workspace/FileGridView.tsx`
**Effort:** M

### UX-38: AI chat 429 rate-limit hangs the conversation
**Priority:** P1
**Status:** ✅ Done — hash: `bdd5230`
**Problem:** When Anthropic returns 429 (rate limit), the chat UI hangs showing "loading..." forever. Console shows the error but the user sees nothing actionable.
**Acceptance criteria:**
- 429 and other API errors surface as an in-chat error message (not just console)
- Message includes: brief description, retry-after time if the API provides it, a "Retry" button
- Loading state clears on error
- Applies to all three providers (Claude, OpenAI, Gemini)
**Files:** `src/components/ai/AIChatViewer.tsx`, `src/modules/models/*Provider.ts`
**Effort:** S-M

### UX-39: Stop button doesn't cancel in-flight AI requests
**Priority:** P1
**Status:** ✅ Done — hash: `b601e5b`
**Problem:** User clicks Stop while AI is thinking — nothing happens. The chat stays locked in the loading state. Can't recover.
**Acceptance criteria:**
- Stop button genuinely aborts the in-flight request (AbortController signal wired to fetch)
- UI resets to pre-send state; the user can type a new message
- Any partial streamed content stays in the chat history (don't lose work)
- Works for all three providers
**Files:** `src/components/ai/AIChatViewer.tsx`, `src/modules/models/*Provider.ts`
**Effort:** M

### UX-40: Grid view button is on its own awkward line
**Priority:** P3
**Status:** ✅ Done — hash: `ba0a170`
**Problem:** In the file tree toolbar, "Grid View" is currently on a second line below File/Folder/Upload. Looks awkward and wastes space.
**Acceptance criteria:**
- Grid View moves somewhere that makes sense visually and logically
- Options: (a) icon-only button inline with File/Folder/Upload, (b) a top-right corner of the tree, (c) next to the Search sidebar tab as a view mode toggle
- Pick the option with the lowest regression risk and implement
**Files:** `src/components/workspace/FileTree.tsx`
**Effort:** S

### UX-41: Drop overlay stays stuck / app freezes after second drop
**Priority:** P0
**Status:** ✅ Done — hash: `a971537`
**Problem:** User dragged a PDF onto the app (worked). Dragged a second PDF — the "Drop files to add to your workspace" overlay stayed up, and the whole app froze. Unable to recover without reload.
**Acceptance criteria:**
- Drop handler always resets the overlay state, even on error (try/finally)
- Dragleave and drop events reliably dismiss the overlay; no stuck state on rapid subsequent drops
- If one file fails to write, other files in the same drop still proceed
- The depth counter in `useGlobalFileDrop` is bulletproof against dragenter/dragleave mismatches
- Add a test that simulates two rapid drag-drop cycles
**Files:** `src/utils/fileDrop.ts` (or hook), `src/components/common/GlobalDropOverlay.tsx`
**Effort:** S-M

---

## Wave 8 — Post-v1.0.8 follow-ups (2026-04-16)

Discovered during the v1.0.8 ship. Punted to v1.0.9.

### UX-42: CI doesn't sign Windows installers for auto-update
**Priority:** P1
**Status:** 📋
**Problem:** The `build-windows` job in `.github/workflows/release.yml` builds the Tauri app via raw `npm run tauri build` (not `tauri-action`), then signs the `.exe` and `.msi` via Azure Trusted Signing in a separate step. Tauri's updater signer never runs on Windows, so no `.exe.sig` is produced and `latest.json` has no `windows-x86_64` entry — Windows users can't auto-update. For the v1.0.8 ship this was patched manually on the server: signed the `.exe` with `npm run tauri -- signer sign -f ~/.keepance-secrets/updater.key -p '<pwd>' <file>`, uploaded the `.sig` via `gh release upload`, downloaded `latest.json`, injected the `windows-x86_64` entry with `python3` + `json`, re-uploaded. This manual patch won't scale — every release needs it.
**Acceptance criteria:**
- After Azure signs the `.exe`, a CI step runs `tauri signer sign` with the same `TAURI_SIGNING_PRIVATE_KEY` used by the Mac/Linux tauri-action step. Produces `Advisor Prep Hero_1.0.8_x64-setup.exe.sig`.
- The Mac/Linux job uploads `latest.json` without `windows-x86_64`. After the Windows job finishes, either (a) a final "assemble latest.json" step downloads the current `latest.json`, adds the Windows entry, and re-uploads; or (b) tauri-action is extended to merge. Option (a) is simpler; python + jq can do it in 10 lines.
- Next tagged release completes without manual intervention — Windows users on v1.0.8 get auto-updates for the first time.
**Files:** `.github/workflows/release.yml`
**Effort:** S
**Reference script** — see the post-publish patch I did for v1.0.8 in the `~/.claude/projects/-home-jameson/memory/project_keepance.md` session notes; can lift the logic straight into a workflow step.

### UX-43: 2 pre-existing visual snapshot failures
**Priority:** P3
**Status:** 📋
**Problem:** `file-tree.png` and `grid-view-breadcrumbs.png` visual snapshot tests have been failing since pre-v1.0.8. Cosmetic, not regressions from the doc suite or UX polish work. Running `npx playwright test --update-snapshots` in a clean state will regenerate them; needs a manual design review pass first to confirm the new baseline is intentional.
**Files:** `tests/e2e/file-tree.spec.ts-snapshots/`, `tests/e2e/grid-view.spec.ts-snapshots/`
**Effort:** XS

### UX-44: Orphan testid reference in docs
**Priority:** P3
**Status:** 📋
**Problem:** `docs/quality/PLAYWRIGHT_TESTING.md` references the old `new-file-button` testid from before UX-40 renamed it to `new-file-menu-trigger`. Zero code impact, just stale docs.
**Files:** `docs/quality/PLAYWRIGHT_TESTING.md`
**Effort:** XS

---

## Execution log

| Wave | Date | Commit | Tests pass | Notes |
|---|---|---|---|---|
| Wave 1 | 2026-04-15 | `dc3f2c8` UX-01, `8c717b5` UX-02, `a094d45` UX-03 | 9 new, 77 existing (7 pre-existing visual snapshot failures untouched) | Welcome dialog is now strictly blocking on first run (X hidden, Escape suppressed); dismissible when a workspace exists behind it. Command palette has sr-only DialogTitle. Sidebar nav is a proper ARIA tablist with arrow-key navigation. |
| Wave 2 | 2026-04-15 | `8d972bd` UX-04, `1c6bffb` UX-05, `1dc106b` UX-06, `7edffda` UX-07 | 11 new (3 onboarding-card + 3 welcome-dialog-copy + 5 empty-states), 87 total pass, 7 pre-existing failures unchanged (3 Claude Opus 4.5 model-id tests + 4 visual snapshots) | Added prominent API key setup card in MainPanel for BYOK onboarding (sessionStorage-dismissal, reappears after page reload). Welcome dialog now has elevator pitch + Learn more link + preview of docs/research/templates folders. New reusable EmptyState component applied to Files, Search, AI Audit, Trash, and Whiteboard panels; Workflows skipped (always has 15 templates). |
| Wave 3 | 2026-04-15 | `e781fef` UX-08, `7aa7c25` UX-09, `636e967` UX-10, `4719c60` model-id fix | 19 new (7 api-keys-panel + 6 workflows-panel + 6 shortcuts-overlay), 109 total pass, 4 pre-existing visual-snapshot failures unchanged (ai-models-tab, file-tree, breadcrumb-nav, status-bar). The 3 model-id tests that were red since Wave 1 are now green. Updated ai-keys-tab snapshot to match the new UX-08 layout. | API Keys panel now renders all 3 providers simultaneously with Get key, Test, Clear, masked display, and Valid/Invalid/Not tested status chip. Workflows sidebar panel fills available height via flex layout + exposes a full-view modal with 3-column grid and search. Keyboard-shortcuts overlay (`?` hotkey, focus-aware) lists every shortcut from a new SSOT at src/utils/shortcuts.ts; overlay has a visible DialogTitle. Tooltip audit added shortcut hints on MainPanel toolbar + TabBar close-X. |
| Wave 4 | 2026-04-15 | `69a05dc` UX-11, `df5eec1` UX-12, `36554df` UX-13, `49d68c0` UX-14, `b52d7ff` UX-15, `5e2a4e7` UX-16, `008bbb7` UX-17, `b4cc38f` UX-18, `a0b0ac4` fixes | 12 new spec files / tests (sidebar-icons, editor-toolbar-overflow, breadcrumbs, create-file-dialog, destructive-actions, auto-save-indicator, updated spreadsheet-improvements), 121 total pass, 3 pre-existing visual-snapshot failures unchanged (ai-models-tab, file-tree, grid-view-breadcrumbs). The status-bar visual snapshot was intentionally regenerated for the UX-14 breadcrumb layout. | Research + every other sidebar tab icon now inherits the same currentColor so no tab looks permanently tinted. Workflow cards use `line-clamp-2 break-words` + `title` tooltip, killing the one-word-per-line wrap at narrow widths. MainPanel toolbar collapses History/Split/Outline/Backlinks/Export into a `…` DropdownMenu via ResizeObserver when container width < 900px; Save/Auto-save/Download stay inline. StatusBar renders per-segment clickable breadcrumbs with chevrons and a `…` overflow DropdownMenu for paths with >4 segments; clicking a segment expands the FileTree sidebar to that folder. PromptDialog extended with `destinationPath` + `previewExtension` so every "New X" flow shows "Creating in /docs/" and a live filename preview. New in-app UndoToast shows "File moved to Trash — Undo" for 10s after delete; bulk delete uses the app's ConfirmDialog instead of window.confirm; Ctrl+Z reverts the most recent rename per session. Replaced the static "Auto-save" badge with a reactive AutoSaveIndicator state machine (idle → dirty → saving → saved-recent → error) with spinner + "Saved · Ns ago" updating every second. Spreadsheet formula bar + selection summary render at 5px thin divider before any selection in viewer mode, expanding to full size on first click; editable mode keeps the bar always-expanded to protect the dblclick-to-edit flow. |
| Wave 5 | 2026-04-15 | `dacc969` UX-19, `360ac39` UX-20, `1b2cde9` UX-22, `496deb7` UX-23, `7c7a12f` UX-24, `58e0d15` UX-25, `f1ed7b8` UX-30 | 17 new spec files/tests (drag-drop, whats-new, tab-close-visibility, sidebar-collapsed-tooltips, history-hidden-nonversioned, theme-system, word-count-md-txt), 138 total pass, 3 pre-existing visual-snapshot failures unchanged (ai-models-tab, file-tree, grid-view-breadcrumbs). | Dragging files anywhere onto the window now shows a dashed drop overlay and lands files in the nearest folder (or workspace root); duplicates get `(1)`, `(2)` suffixes; `.DS_Store` noise filtered out. After a version bump `useWhatsNew` compares the bundled changelog top entry against `localStorage['keepance:lastSeenVersion']` and shows a dismissible bottom-left toast that opens a per-release highlights modal; first-time users see nothing. TabBar close X now renders at `opacity-0` by default, `opacity-100` on active tab / group hover / keyboard focus so inactive tabs feel quiet. Sidebar in collapsed mode wraps every icon in a Radix tooltip via a root `TooltipProvider` (300ms delay, 100ms skip-delay) showing label + optional keyboard shortcut; added `@radix-ui/react-tooltip` dependency. MainPanel auto-closes the right-panel History tab when the active file switches to a non-versioned type so `.xlsx` no longer inherits a stale History view. Theme state upgraded from binary to `'light' \| 'dark' \| 'system'` with a matchMedia subscription; toggle cycles system → light → dark → system with Monitor/Sun/Moon icons. Shared `WordCountFooter` component added to MarkdownEditor + PlainTextEditor with the same `editor-word-count` testid as the TipTap editors. |
| Wave 6 | 2026-04-16 | `4fe507b` UX-29, `85e04ae` UX-27, `b68efa2` UX-28, `885074e` UX-26, `fd40eab` UX-21 | 17 new e2e + 16 new unit (7 filename-derivation + 9 content-index), 159 e2e total pass, 2 pre-existing visual-snapshot failures unchanged (file-tree, grid-view-breadcrumbs). Regenerated ai-keys-tab + ai-models-tab snapshots to pick up the new Pop-out button. | UX-29 extends the UX-16 undo path with keyboard parity: Ctrl+Z outside any input pops a combined rename+delete stack so the most recent destructive action reverses regardless of whether the undo toast is still visible. Trash retention default flipped from 'never' to 30 days so the "30 days" in-app copy is truthful; empty-state description now adapts to the active retention period. UX-27 introduces a Ctrl+P / Cmd+P quick-open modal via fuse.js (7.3.0, MIT). Arrow/Enter/Esc navigation, a persisted-in-localStorage recents list (10 entries) when the input is empty, sr-only DialogTitle mirroring the command palette a11y pattern. Ctrl+Shift+P still routes to the command palette because the new handler explicitly excludes Shift. UX-28 adds a grip-handle drag source next to every assistant bubble in AIChatViewer; the dragstart stuffs the content into a custom `application/x-keepance-chat-message` MIME plus text/plain. FileTree grew an `onDropAIMessage` prop: folder drops create a new .md file (filename derived from first heading or first 60 chars), file drops append with a `---` separator. UX-26 ships full-text content search via minisearch (7.2.0, MIT). Builds an index on workspace open over all text-extractable files (md/txt/rt/rtf/json/csv + extracted xlsx/docx/pptx via extractForAI); per-save `upsert` and per-delete `remove` keep the index current without rescans. SearchPanel merges filename + content hits, shows a 160-char snippet around the match with a `<mark>` highlight, debounces input 150ms, caps at 30 results. UX-21 opens AI Assistant as a MAIN-PANEL tab instead of the cramped sidebar — Ctrl+Shift+A toggles it, a second press focuses the existing tab instead of duplicating. Sidebar pane grew an additive "Pop out" button (Maximize2 icon) that calls the same helper. Drive-by fix for a React 18 "getSnapshot should be cached" infinite-loop in AIChatViewer's file-context selector: now subscribes to raw bags and derives via useMemo. |
| Wave 7 | 2026-04-16 | `a971537` UX-41, `1e962a4` UX-32, `7c37a57` UX-35, `b601e5b` UX-39, `bdd5230` UX-38, `b4a9bf2` UX-33, `39b0606` UX-34, `c68c2e9` UX-31, `ea14f09` UX-37, `ba0a170` UX-40, `f60efba` UX-36 | 5 new unit tests (3 spreadsheet-io + 2 docx-roundtrip), 1 new e2e spec (drag-drop-repeated, 2 tests), all unit + typecheck green | P0 bugs: UX-41 drop overlay stuck (try/finally + watchdog timer), UX-32 CSV atob (detect raw text vs data URL in parseSpreadsheet), UX-35 DOCX corruption (root cause: autosave wrote data-URL text to disk instead of decoded binary bytes; fix routes binary tabs through writeFileBinary). P1: UX-39 AbortController threaded through all 3 providers' sendMessage + makeRequest; UX-38 rate-limit error messages now include HTTP status so parseApiError works; UX-33 last-dropped file auto-activates; UX-34 pure-JS fallback renderer for PowerPoint using existing JSZip+DrawingML pipeline (no new deps). Polish: UX-31 recent workspaces capped at 3 with expand toggle, UX-37 new fileIcons.ts SSOT applied to FileTree/TabBar/FileGridView, UX-40 Grid View as icon-only button, UX-36 tabOverflow scroll/wrap persisted to localStorage with command palette toggle. |
| **v1.0.8 ship** | 2026-04-16 | tag moved to `db47900` (live commit: `0543ed4`) | 171 Playwright + 64 unit green; pre-existing snapshot failures unchanged | v1.0.8 PUBLISHED at 17:38Z. All 7 waves (41 tickets) + document suite (xlsx/csv/docx/pptx/ppt/rtf) + auto-updater + branded start screen + settings system + workflow-as-file shipped in one release. Four ship attempts required before success (wrong tag → secret with wrap artifact → race in parallel draft → missing Windows entry in latest.json). Final: GitHub Release has 16 artifacts, latest.json covers all 9 platform entries including windows-x86_64 (manually patched — see UX-42). macOS notarization still disabled (Apple service outage). |
