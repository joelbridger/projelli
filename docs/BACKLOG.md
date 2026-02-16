# Business OS - Technical Backlog

> **Last Updated:** 2026-01-26
> **Total Tickets:** 41
> **Status Summary:** 0 TODO | 0 IN_PROGRESS | 41 DONE

---

## Future Enhancements

---

### AI-001: Implement Background Streaming for AI Chat Persistence
**Status:** DONE
**Priority:** P1
**Phase:** N/A
**Estimated Size:** M
**Dependencies:** None
**Completed:** 2026-01-26

**Description:**
Fix the issue where navigating away from AI chat during an assistant's response causes content loss. Currently, the `AIChatViewer` component uses a blocking `await provider.sendMessage()` call, which means any state updates during the async operation are lost if the component unmounts before completion.

**Note:** This ticket is deferred pending strategic decision on AI chat features. The project vision emphasizes artifact-driven workflows over chat interfaces. Consider whether this feature aligns with Business OS's core philosophy before implementation.

**Root Cause:**
- File: `src/components/ai/AIChatViewer.tsx:303`
- The `provider.sendMessage()` call blocks with `await`
- If user navigates away during the API call, the component unmounts
- State updates from `setMessages()` are discarded
- No background persistence mechanism exists

**Implementation Details:**
Two possible approaches:

**Option A: Streaming with Background Persistence**
- Replace blocking `await` with streaming response handling
- Implement background service to persist partial responses
- Store in-progress conversations in global state or localStorage
- Restore conversation state when component remounts
- Show "continuing previous response..." indicator

**Option B: Global State Management**
- Move all AI chat state out of component into Zustand store
- Keep conversations in memory independent of component lifecycle
- Persist store to localStorage on every update
- Component becomes pure view layer over global state

**Files to Create/Modify:**
- `src/components/ai/AIChatViewer.tsx` - Update message handling
- `src/stores/aiChatStore.ts` - (Option B) Create global chat state
- `src/modules/ai/ChatPersistenceService.ts` - (Option A) Background persistence
- `src/hooks/useStreamingChat.ts` - (Option A) Streaming hook

**Acceptance Criteria:**
- [ ] Navigating away during AI response does not lose content
- [ ] Partial responses are saved incrementally
- [ ] Returning to chat shows full conversation state
- [ ] In-progress responses can be cancelled gracefully
- [ ] No memory leaks from unmounted components

**Tests Needed:**
- Integration test: Navigate away mid-response, return, verify state
- Unit test: Partial response chunks are persisted
- Test: Component unmount during API call doesn't crash

**Strategic Considerations:**
- .aichat files appear to be legacy from earlier development
- User guidance: "Business OS is NOT a chat UI - it is an artifact-driven workspace"
- User guidance: "AI chat features are explicitly OUT OF SCOPE"
- Alternative: Remove AI chat feature entirely if it conflicts with product vision
- If retained, ensure it serves artifact creation, not conversational interaction

---

## Phase 0: Repository Scaffolding

---

### TICKET-001: Initialize Vite + React + TypeScript Project
**Status:** DONE
**Priority:** P0
**Phase:** 0
**Estimated Size:** S
**Dependencies:** None

**Description:**
Create the base project using Vite with React and TypeScript template. Configure TypeScript with strict mode enabled for maximum type safety. This is the foundation for all subsequent development.

**Implementation Details:**
- Run `npm create vite@latest business-os -- --template react-ts`
- Update `tsconfig.json` to enable strict mode and configure path aliases
- Set target to ES2022 for modern JavaScript features
- Configure module resolution for bundler

**Files to Create/Modify:**
- `package.json` - Project dependencies and scripts
- `tsconfig.json` - TypeScript configuration with strict mode
- `tsconfig.node.json` - Node-specific TypeScript config
- `vite.config.ts` - Vite configuration
- `src/main.tsx` - Application entry point
- `src/App.tsx` - Root component placeholder

**Acceptance Criteria:**
- [ ] Project builds successfully with `npm run build`
- [ ] Development server starts with `npm run dev`
- [ ] TypeScript strict mode is enabled (noImplicitAny, strictNullChecks, etc.)
- [ ] Hot module replacement works in development

**Tests Needed:**
- Verify build produces valid output in `dist/`
- Verify no TypeScript errors with `npx tsc --noEmit`

---

### TICKET-002: Configure Tailwind CSS and shadcn/ui
**Status:** DONE
**Priority:** P0
**Phase:** 0
**Estimated Size:** S
**Dependencies:** TICKET-001

**Description:**
Set up Tailwind CSS for utility-first styling and initialize shadcn/ui for accessible, customizable React components. Configure the design system with consistent color tokens and spacing.

**Implementation Details:**
- Install Tailwind CSS and configure with Vite
- Run `npx shadcn@latest init` to set up component library
- Configure `components.json` for shadcn/ui
- Set up CSS variables for theming (dark mode support)
- Add base shadcn/ui components: Button, Dialog, Input, Card

**Files to Create/Modify:**
- `tailwind.config.js` - Tailwind configuration with custom theme
- `postcss.config.js` - PostCSS configuration
- `src/styles/globals.css` - Global styles with Tailwind directives
- `components.json` - shadcn/ui configuration
- `src/components/ui/button.tsx` - Button component
- `src/components/ui/dialog.tsx` - Dialog component
- `src/components/ui/input.tsx` - Input component
- `src/lib/utils.ts` - Utility functions (cn helper)

**Acceptance Criteria:**
- [ ] Tailwind classes work in components
- [ ] shadcn/ui Button renders correctly
- [ ] Dark mode CSS variables are defined
- [ ] Components are accessible (keyboard navigable, ARIA labels)

**Tests Needed:**
- Visual verification of Button component
- Verify CSS purging works in production build

---

### TICKET-003: Initialize Tauri Desktop Wrapper
**Status:** DONE
**Priority:** P0
**Phase:** 0
**Estimated Size:** M
**Dependencies:** TICKET-001

**Description:**
Set up Tauri 2 for desktop application packaging. Configure the Rust backend with basic commands and ensure the development workflow works with both browser and desktop targets.

**Implementation Details:**
- Run `npm create tauri-app` or add Tauri to existing project
- Configure `tauri.conf.json` with app name, identifier, window settings
- Set up development URL to point to Vite dev server
- Add fs plugin for filesystem access with scope restrictions
- Add os plugin for keychain access

**Files to Create/Modify:**
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/tauri.conf.json` - Tauri configuration
- `src-tauri/src/main.rs` - Tauri entry point
- `src-tauri/src/lib.rs` - Library exports
- `src-tauri/capabilities/default.json` - Permission capabilities

**Acceptance Criteria:**
- [ ] `npm run tauri dev` launches desktop window with React app
- [ ] Tauri commands can be invoked from frontend
- [ ] File system plugin is configured with scope restrictions
- [ ] App window has reasonable default size (1200x800)

**Tests Needed:**
- Verify Tauri builds successfully on target platform
- Test basic Tauri command invocation from React

---

### TICKET-004: Configure ESLint, Prettier, and Vitest
**Status:** DONE
**Priority:** P1
**Phase:** 0
**Estimated Size:** S
**Dependencies:** TICKET-001

**Description:**
Set up code quality tooling with ESLint for linting, Prettier for formatting, and Vitest for unit testing. Configure rules appropriate for a TypeScript React project.

**Implementation Details:**
- Install ESLint with TypeScript and React plugins
- Configure Prettier with consistent formatting rules
- Set up Vitest with React Testing Library
- Add npm scripts for linting, formatting, and testing
- Configure VS Code settings for auto-format on save

**Files to Create/Modify:**
- `.eslintrc.cjs` - ESLint configuration
- `.prettierrc` - Prettier configuration
- `vitest.config.ts` - Vitest configuration
- `package.json` - Add scripts: lint, format, test
- `.vscode/settings.json` - VS Code workspace settings

**Acceptance Criteria:**
- [ ] `npm run lint` checks code without errors
- [ ] `npm run format` formats all source files
- [ ] `npm run test` runs Vitest successfully
- [ ] ESLint catches React hook dependency issues

**Tests Needed:**
- Run a sample test to verify Vitest setup
- Verify ESLint catches intentional violation

---

### TICKET-005: Create Project Folder Structure
**Status:** DONE
**Priority:** P1
**Phase:** 0
**Estimated Size:** S
**Dependencies:** TICKET-001

**Description:**
Create the folder structure defined in the architecture document. Add placeholder index.ts files for module exports and set up path aliases for clean imports.

**Implementation Details:**
- Create all directories under `src/` per architecture
- Add index.ts barrel exports for each module
- Configure TypeScript path aliases (@/components, @/modules, etc.)
- Update Vite config to resolve path aliases
- Add .gitkeep files to empty directories if needed

**Files to Create/Modify:**
- `src/components/` - UI components directory structure
- `src/modules/` - All 9 module directories with index.ts
- `src/tools/` - Tool layer directory
- `src/stores/` - Zustand stores directory
- `src/hooks/` - React hooks directory
- `src/types/` - TypeScript types directory
- `src/utils/` - Utilities directory
- `src/lib/` - Third-party wrappers directory
- `tsconfig.json` - Add path aliases
- `vite.config.ts` - Configure alias resolution

**Acceptance Criteria:**
- [ ] All directories from architecture exist
- [ ] Path aliases work (e.g., `import { x } from '@/modules/workspace'`)
- [ ] Each module has index.ts with placeholder export
- [ ] No TypeScript errors from import paths

**Tests Needed:**
- Verify imports using path aliases compile correctly

---

## Phase 1: Workspace Browser + Editor

---

### TICKET-006: Implement Workspace Service with Path Validation
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** L
**Dependencies:** TICKET-005

**Description:**
Create the core WorkspaceService that handles all file system operations with strict security validation. Implement path traversal blocking and the abstraction layer for Web FS and Tauri backends.

**Implementation Details:**
- Define FSBackend interface for read, write, delete, move, list operations
- Implement PathValidator with traversal detection (block `../`, symlinks escaping root)
- Create WorkspaceService orchestrating backends and validation
- Store workspace root path securely
- Implement file/folder CRUD operations

**Files to Create/Modify:**
- `src/modules/workspace/types.ts` - FSBackend interface, FileNode types
- `src/modules/workspace/PathValidator.ts` - Security validation
- `src/modules/workspace/WorkspaceService.ts` - Main service
- `src/modules/workspace/index.ts` - Module exports
- `src/types/workspace.ts` - Workspace types

**Acceptance Criteria:**
- [ ] Path traversal attempts throw SecurityError
- [ ] Symlinks pointing outside workspace are blocked
- [ ] CRUD operations work through abstraction layer
- [ ] Workspace root is validated on initialization

**Tests Needed:**
- Unit test: `../` patterns are blocked
- Unit test: Nested traversal `foo/../../bar` is blocked
- Unit test: Valid paths within workspace succeed
- Security test: Symlink escape attempt fails

---

### TICKET-007: Implement Web File System Backend
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-006

**Description:**
Implement the FSBackend interface using the File System Access API for browser-based development. This allows rapid prototyping without requiring Tauri.

**Implementation Details:**
- Use `showDirectoryPicker()` to get workspace root handle
- Implement recursive directory reading with `entries()`
- Implement file read/write with FileHandle API
- Handle permission persistence across sessions
- Add fallback error handling for unsupported browsers

**Files to Create/Modify:**
- `src/modules/workspace/WebFSBackend.ts` - Web FS implementation
- `src/modules/workspace/index.ts` - Export backend

**Acceptance Criteria:**
- [ ] User can select folder as workspace root
- [ ] Files can be read and written
- [ ] Folder structure can be traversed recursively
- [ ] Permission prompt appears on first access

**Tests Needed:**
- Integration test: Select folder, create file, read file back
- Test permission handling when user denies access

---

### TICKET-008: Implement Tauri File System Backend
**Status:** DONE
**Priority:** P1
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-006, TICKET-003

**Description:**
Implement the FSBackend interface using Tauri's fs plugin for the desktop application. Configure scope restrictions to limit access to workspace root only.

**Implementation Details:**
- Use `@tauri-apps/plugin-fs` for file operations
- Configure fs scope in Tauri capabilities
- Implement all FSBackend interface methods
- Add Rust commands for operations requiring native performance
- Handle path normalization between platforms

**Files to Create/Modify:**
- `src/modules/workspace/TauriFSBackend.ts` - Tauri implementation
- `src-tauri/src/commands/fs.rs` - Rust filesystem commands
- `src-tauri/capabilities/default.json` - Update fs scope

**Acceptance Criteria:**
- [ ] All FSBackend methods work in Tauri environment
- [ ] Scope restrictions prevent access outside workspace
- [ ] Path handling works correctly on Windows
- [ ] Large file operations don't block UI

**Tests Needed:**
- Integration test: Full CRUD cycle in Tauri
- Test scope violation is properly rejected

---

### TICKET-009: Build File Tree Component
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-006

**Description:**
Create the file tree UI component that displays the workspace folder structure. Support expanding/collapsing folders, file selection, and context menus for CRUD operations.

**Implementation Details:**
- Build recursive FileTreeItem component
- Implement expand/collapse state management
- Add context menu with New File, New Folder, Rename, Delete
- Support keyboard navigation (arrow keys, Enter to open)
- Show file type icons based on extension

**Files to Create/Modify:**
- `src/components/workspace/FileTree.tsx` - Main tree component
- `src/components/workspace/FileTreeItem.tsx` - Tree node component
- `src/components/workspace/FileContextMenu.tsx` - Right-click menu
- `src/stores/workspaceStore.ts` - Tree state management

**Acceptance Criteria:**
- [ ] Folder tree renders from workspace root
- [ ] Folders expand/collapse on click
- [ ] Context menu shows appropriate actions
- [ ] Keyboard navigation works (up/down arrows, Enter)
- [ ] File icons differentiate types (.md, .json, folders)

**Tests Needed:**
- Unit test: Tree renders correct structure
- Unit test: Expand/collapse toggles correctly
- Interaction test: Context menu actions work

---

### TICKET-010: Implement Drag-and-Drop File Organization
**Status:** DONE
**Priority:** P2
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-009

**Description:**
Add drag-and-drop support to the file tree for moving files and folders. Show visual feedback during drag and confirm moves that might be destructive.

**Implementation Details:**
- Use HTML5 drag-and-drop API
- Highlight valid drop targets during drag
- Implement move operation via WorkspaceService
- Show confirmation dialog for moves into non-empty folders
- Support multi-select drag

**Files to Create/Modify:**
- `src/components/workspace/FileTree.tsx` - Add drag handlers
- `src/components/workspace/FileTreeItem.tsx` - Drop target logic
- `src/hooks/useDragDrop.ts` - Drag-and-drop hook

**Acceptance Criteria:**
- [ ] Files can be dragged to different folders
- [ ] Visual indicator shows valid drop targets
- [ ] Move operation updates file tree
- [ ] Invalid moves (into self, into file) are prevented

**Tests Needed:**
- Interaction test: Drag file to folder succeeds
- Test: Dragging folder into itself is blocked

---

### TICKET-011: Integrate CodeMirror 6 Markdown Editor
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** L
**Dependencies:** TICKET-006

**Description:**
Integrate CodeMirror 6 as the Markdown editor with syntax highlighting, line numbers, and basic editing features. Set up the extension system for future enhancements.

**Implementation Details:**
- Install CodeMirror 6 packages (@codemirror/state, view, lang-markdown)
- Create MarkdownEditor React component with useEffect for CodeMirror
- Configure Markdown language support with syntax highlighting
- Add line numbers, active line highlighting
- Implement controlled component pattern with onChange callback

**Files to Create/Modify:**
- `src/components/editor/MarkdownEditor.tsx` - Editor component
- `src/modules/editor/EditorService.ts` - Editor state management
- `src/modules/editor/extensions.ts` - CodeMirror extensions
- `src/styles/editor.css` - Editor-specific styles

**Acceptance Criteria:**
- [ ] Markdown syntax is highlighted correctly
- [ ] Changes trigger onChange callback
- [ ] Line numbers display
- [ ] Editor handles large files without lag
- [ ] Basic keyboard shortcuts work (Ctrl+Z undo, etc.)

**Tests Needed:**
- Unit test: Editor renders with initial content
- Unit test: onChange fires on edit
- Performance test: 10,000 line file loads in <1s

---

### TICKET-012: Build Tab System for Multiple Files
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-011

**Description:**
Create a tab bar component that allows opening multiple files simultaneously. Support tab switching, close buttons, and dirty state indicators.

**Implementation Details:**
- Build TabBar component with tab items
- Track open files in Zustand store
- Show dirty indicator (*) for unsaved changes
- Implement tab close with unsaved changes warning
- Support middle-click to close, Ctrl+click for new tab

**Files to Create/Modify:**
- `src/components/editor/TabBar.tsx` - Tab bar component
- `src/components/editor/Tab.tsx` - Individual tab component
- `src/stores/editorStore.ts` - Tab state management
- `src/hooks/useEditor.ts` - Editor operations hook

**Acceptance Criteria:**
- [ ] Multiple files can be open in tabs
- [ ] Clicking tab switches active file
- [ ] Close button removes tab
- [ ] Unsaved changes show warning on close
- [ ] Dirty state indicator appears when file modified

**Tests Needed:**
- Unit test: Opening file creates new tab
- Unit test: Switching tabs updates editor content
- Interaction test: Close with unsaved shows confirmation

---

### TICKET-013: Implement Split Pane View
**Status:** DONE
**Priority:** P1
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-012

**Description:**
Add the ability to view multiple files side-by-side in split panes. Support vertical and horizontal splits with resizable dividers.

**Implementation Details:**
- Create SplitPane container component
- Implement resizable divider with drag handling
- Store pane layout in editor state
- Support keyboard shortcut to split (Ctrl+\)
- Allow collapsing panes

**Files to Create/Modify:**
- `src/components/editor/SplitPane.tsx` - Split pane container
- `src/components/editor/PaneResizer.tsx` - Resizable divider
- `src/stores/editorStore.ts` - Add pane layout state

**Acceptance Criteria:**
- [ ] View can be split vertically or horizontally
- [ ] Panes can be resized by dragging divider
- [ ] Each pane has independent tab bar
- [ ] Panes can be closed/collapsed

**Tests Needed:**
- Unit test: Split creates two panes
- Interaction test: Resize updates pane widths

---

### TICKET-014: Add Outline Navigation Panel
**Status:** DONE
**Priority:** P1
**Phase:** 1
**Estimated Size:** S
**Dependencies:** TICKET-011

**Description:**
Create an outline panel that shows all headings in the current Markdown file. Clicking a heading scrolls the editor to that position.

**Implementation Details:**
- Parse Markdown content for headings (# through ######)
- Build hierarchical outline tree from headings
- Implement click-to-scroll functionality
- Highlight current section based on scroll position
- Update outline when document changes

**Files to Create/Modify:**
- `src/components/editor/OutlinePanel.tsx` - Outline component
- `src/modules/editor/OutlineParser.ts` - Heading extraction

**Acceptance Criteria:**
- [ ] All headings appear in outline with correct hierarchy
- [ ] Clicking heading scrolls editor to that line
- [ ] Current section is highlighted in outline
- [ ] Outline updates on document edit

**Tests Needed:**
- Unit test: Parser extracts headings correctly
- Unit test: Nested headings create hierarchy

---

### TICKET-015: Implement Wiki-Style Links and Backlinks
**Status:** DONE
**Priority:** P1
**Phase:** 1
**Estimated Size:** M
**Dependencies:** TICKET-011, TICKET-006

**Description:**
Add support for `[[wiki-link]]` syntax in Markdown. Parse links, make them clickable, and maintain a backlink index showing which documents link to the current one.

**Implementation Details:**
- Create CodeMirror extension to highlight `[[...]]` syntax
- Implement WikiLinkParser to extract links from content
- Build BacklinkIndex that tracks links across all files
- Add click handler to navigate to linked file
- Create Backlinks panel component

**Files to Create/Modify:**
- `src/modules/editor/WikiLinkParser.ts` - Link extraction
- `src/modules/editor/BacklinkIndex.ts` - Link tracking
- `src/modules/editor/extensions/wikiLinks.ts` - CodeMirror extension
- `src/components/editor/BacklinksPanel.tsx` - Backlinks display

**Acceptance Criteria:**
- [ ] `[[filename]]` syntax is highlighted in editor
- [ ] Clicking wiki link opens linked file
- [ ] Backlinks panel shows all files linking to current
- [ ] Backlink index updates when files are saved
- [ ] Non-existent links shown differently (create on click)

**Tests Needed:**
- Unit test: Parser extracts wiki links correctly
- Unit test: Backlink index tracks bidirectional links
- Integration test: Click link opens file

---

### TICKET-016: Build Workspace Root Selector Dialog
**Status:** DONE
**Priority:** P0
**Phase:** 1
**Estimated Size:** S
**Dependencies:** TICKET-007, TICKET-002

**Description:**
Create the initial dialog that prompts users to select or create a workspace folder. This is the first screen users see when no workspace is configured.

**Implementation Details:**
- Build WorkspaceSelector component with shadcn/ui Dialog
- Add "Select Existing Folder" button using directory picker
- Add "Create New Workspace" option
- Store selected workspace path persistently
- Show recent workspaces for quick access

**Files to Create/Modify:**
- `src/components/workspace/WorkspaceSelector.tsx` - Selector dialog
- `src/stores/workspaceStore.ts` - Add recent workspaces
- `src/modules/workspace/WorkspaceService.ts` - Add init logic

**Acceptance Criteria:**
- [ ] Dialog appears when no workspace is selected
- [ ] "Select Folder" triggers directory picker
- [ ] Selected workspace loads correctly
- [ ] Recent workspaces are saved and shown
- [ ] Invalid folder selection shows error

**Tests Needed:**
- Unit test: Dialog renders correctly
- Integration test: Selecting folder initializes workspace

---

## Phase 2: History + Audit

---

### TICKET-017: Implement Command Pattern for File Operations
**Status:** DONE
**Priority:** P0
**Phase:** 2
**Estimated Size:** M
**Dependencies:** TICKET-006

**Description:**
Create a command pattern implementation where all file operations are wrapped in Command objects that support execute and undo. This enables the undo/redo system.

**Implementation Details:**
- Define Command interface with execute() and undo() methods
- Create commands: WriteFileCommand, DeleteFileCommand, MoveFileCommand, RenameFileCommand
- Implement CommandStack for undo/redo history
- Limit stack size to prevent memory issues
- Persist command history for session recovery

**Files to Create/Modify:**
- `src/modules/history/Command.ts` - Command interface
- `src/modules/history/commands/` - Individual command classes
- `src/modules/history/CommandStack.ts` - Stack implementation
- `src/modules/history/HistoryService.ts` - Orchestration

**Acceptance Criteria:**
- [ ] All file operations create Command objects
- [ ] Commands can be undone and redone
- [ ] Undo restores previous file state
- [ ] Stack has configurable max size
- [ ] Commands serialize for persistence

**Tests Needed:**
- Unit test: Execute followed by undo restores state
- Unit test: Redo after undo re-applies change
- Unit test: Stack overflow drops oldest commands

---

### TICKET-018: Implement Soft Delete with Trash
**Status:** DONE
**Priority:** P1
**Phase:** 2
**Estimated Size:** M
**Dependencies:** TICKET-017

**Description:**
Implement soft delete functionality where deleted files move to a `.trash/` folder instead of being permanently removed. Allow restoration from trash.

**Implementation Details:**
- Create `.trash/` folder in workspace root
- Move deleted files to trash with timestamp prefix
- Build TrashService for list, restore, permanent delete
- Add automatic cleanup of items older than 30 days
- Preserve original path for restoration

**Files to Create/Modify:**
- `src/modules/history/TrashService.ts` - Trash management
- `src/modules/history/commands/DeleteFileCommand.ts` - Update for soft delete
- `src/components/common/TrashPanel.tsx` - Trash UI

**Acceptance Criteria:**
- [ ] Delete moves file to .trash folder
- [ ] Trash panel shows deleted files with deletion date
- [ ] Restore puts file back in original location
- [ ] Permanent delete available in trash
- [ ] Auto-cleanup removes old items

**Tests Needed:**
- Unit test: Delete moves to trash
- Unit test: Restore returns to original path
- Unit test: Cleanup removes old items

---

### TICKET-019: Build Audit Log Service
**Status:** DONE
**Priority:** P0
**Phase:** 2
**Estimated Size:** M
**Dependencies:** TICKET-005

**Description:**
Create an append-only audit log that records all AI actions and significant user operations. Store in SQLite for querying and export.

**Implementation Details:**
- Set up sql.js (SQLite WASM) wrapper
- Create audit_log table schema
- Implement AuditService with log() method
- Record: action type, timestamp, model, inputs, outputs, user_decision
- Never delete entries (append-only)
- Add export to JSON/CSV functionality

**Files to Create/Modify:**
- `src/lib/sqlite.ts` - sql.js wrapper
- `src/modules/audit/AuditService.ts` - Audit logging
- `src/modules/audit/schema.sql` - Table definitions
- `src/types/audit.ts` - Audit entry types

**Acceptance Criteria:**
- [ ] All AI actions are logged
- [ ] Logs cannot be deleted (only appended)
- [ ] Query by date range, model, action type
- [ ] Export to JSON works
- [ ] SQLite database persists across sessions

**Tests Needed:**
- Unit test: Log entry is persisted
- Unit test: Query filters work correctly
- Test: Attempting delete throws error

---

### TICKET-020: Create Diff Viewer Component
**Status:** DONE
**Priority:** P0
**Phase:** 2
**Estimated Size:** M
**Dependencies:** TICKET-011

**Description:**
Build a diff viewer component that shows changes between two versions of text. Used for previewing AI edits before accepting and for comparing workflow runs.

**Implementation Details:**
- Use a diff algorithm library (diff-match-patch or similar)
- Create side-by-side and unified diff views
- Syntax highlight diff with green (additions) and red (deletions)
- Add Accept/Reject buttons for AI edit preview
- Support line-by-line accept/reject

**Files to Create/Modify:**
- `src/components/editor/DiffViewer.tsx` - Diff display component
- `src/utils/diff.ts` - Diff computation utilities

**Acceptance Criteria:**
- [ ] Additions shown in green, deletions in red
- [ ] Both side-by-side and unified views available
- [ ] Accept applies changes to document
- [ ] Reject discards proposed changes
- [ ] Large diffs render performantly

**Tests Needed:**
- Unit test: Diff computed correctly for sample inputs
- Unit test: Accept applies changes
- Visual test: Diff renders correctly

---

### TICKET-021: Build Audit Log Viewer Component
**Status:** DONE
**Priority:** P1
**Phase:** 2
**Estimated Size:** S
**Dependencies:** TICKET-019

**Description:**
Create a UI component that displays the audit log with filtering and search capabilities. Allow users to review all AI actions taken in their workspace.

**Implementation Details:**
- Build AuditLog component with virtualized list for performance
- Add filters: date range, model, action type
- Show expandable detail view for each entry
- Implement search within logs
- Add export button

**Files to Create/Modify:**
- `src/components/common/AuditLog.tsx` - Log viewer
- `src/hooks/useAuditLog.ts` - Log data hook

**Acceptance Criteria:**
- [ ] All audit entries display in chronological order
- [ ] Filters narrow displayed entries
- [ ] Clicking entry expands full details
- [ ] Search finds entries by content
- [ ] Large logs scroll smoothly (virtualization)

**Tests Needed:**
- Unit test: Filters work correctly
- Performance test: 10,000 entries render smoothly

---

## Phase 3: Workflow Engine

---

### TICKET-022: Define Workflow Template Schema
**Status:** DONE
**Priority:** P0
**Phase:** 3
**Estimated Size:** M
**Dependencies:** TICKET-005

**Description:**
Design and implement the WorkflowTemplate type system that defines how workflows are structured. Templates describe interview questions, document outputs, and execution steps.

**Implementation Details:**
- Define WorkflowTemplate interface with steps, inputs, outputs
- Create WorkflowStep types: Interview, Generate, Review
- Define input/output schemas for type safety
- Implement template validation
- Create base templates directory structure

**Files to Create/Modify:**
- `src/types/workflow.ts` - Template and step types
- `src/modules/workflow/templateSchema.ts` - Validation
- `src/modules/workflow/templates/` - Template directory

**Acceptance Criteria:**
- [ ] WorkflowTemplate type is comprehensive and typed
- [ ] Templates can define interview questions
- [ ] Templates can specify output documents
- [ ] Invalid templates fail validation with clear errors

**Tests Needed:**
- Unit test: Valid template passes validation
- Unit test: Invalid template fails with specific error

---

### TICKET-023: Implement Workflow Engine Core
**Status:** DONE
**Priority:** P0
**Phase:** 3
**Estimated Size:** L
**Dependencies:** TICKET-022, TICKET-019

**Description:**
Build the workflow execution engine that runs templates step-by-step, handles interview collection, calls AI models, and generates output documents.

**Implementation Details:**
- Create WorkflowEngine class with execute() method
- Implement step handlers for each step type
- Collect interview answers via InterviewForm
- Call model adapters for generation steps
- Store RunRecord with full execution details
- Handle errors and partial completion

**Files to Create/Modify:**
- `src/modules/workflow/WorkflowEngine.ts` - Core engine
- `src/modules/workflow/RunRecordService.ts` - Run storage
- `src/stores/workflowStore.ts` - Execution state

**Acceptance Criteria:**
- [ ] Engine executes templates step-by-step
- [ ] Interview step pauses for user input
- [ ] Generate step calls model and creates files
- [ ] RunRecord captures all inputs/outputs
- [ ] Errors are handled gracefully with rollback

**Tests Needed:**
- Integration test: Execute simple workflow end-to-end
- Unit test: Each step type executes correctly
- Test: Error mid-workflow doesn't corrupt state

---

### TICKET-024: Implement "New Business Kickoff" Workflow
**Status:** DONE
**Priority:** P0
**Phase:** 3
**Estimated Size:** L
**Dependencies:** TICKET-023

**Description:**
Create the flagship "New Business Kickoff" workflow that interviews the founder and generates VISION.md, PRD.md, and Lean Canvas. This is the MVP feature that proves the core value proposition.

**Implementation Details:**
- Define NewBusinessKickoff template with structured interview questions
- Create prompts for generating each document type
- Implement document templates with placeholders
- Add validation that required fields are filled
- Test with mock model adapter

**Files to Create/Modify:**
- `src/modules/workflow/templates/NewBusinessKickoff.ts` - Template definition
- `src/modules/workflow/prompts/vision.ts` - VISION.md generation prompt
- `src/modules/workflow/prompts/prd.ts` - PRD.md generation prompt
- `src/modules/workflow/prompts/leanCanvas.ts` - Lean Canvas prompt

**Acceptance Criteria:**
- [ ] Interview collects: problem, solution, target customer, unique value, channels
- [ ] VISION.md generated with proper structure
- [ ] PRD.md generated with user stories
- [ ] Lean Canvas generated as Markdown table
- [ ] RunRecord contains all prompts and responses

**Tests Needed:**
- Integration test: Full kickoff with mock model
- Unit test: Each document template generates valid Markdown
- Test: Re-run with changed answers shows diff

---

### TICKET-025: Build Workflow Panel UI
**Status:** DONE
**Priority:** P0
**Phase:** 3
**Estimated Size:** M
**Dependencies:** TICKET-023

**Description:**
Create the UI for starting workflows, answering interview questions, viewing progress, and managing run history.

**Implementation Details:**
- Build WorkflowPanel sidebar component
- Create InterviewForm for question/answer collection
- Show execution progress with step indicators
- Display run history with status badges
- Add "Re-run" button for completed workflows

**Files to Create/Modify:**
- `src/components/workflow/WorkflowPanel.tsx` - Main panel
- `src/components/workflow/InterviewForm.tsx` - Q&A form
- `src/components/workflow/RunHistoryPanel.tsx` - History list
- `src/components/workflow/ProgressIndicator.tsx` - Step progress

**Acceptance Criteria:**
- [ ] Available workflows are listed
- [ ] Starting workflow shows interview questions
- [ ] Progress indicator shows current step
- [ ] Completed runs appear in history
- [ ] Re-run opens pre-filled interview form

**Tests Needed:**
- Unit test: Panel renders available workflows
- Interaction test: Answering questions enables next
- Integration test: Full workflow through UI

---

### TICKET-026: Implement Run Record Storage and Diff
**Status:** DONE
**Priority:** P1
**Phase:** 3
**Estimated Size:** M
**Dependencies:** TICKET-023, TICKET-019

**Description:**
Store RunRecords in SQLite with all execution metadata. Enable comparing runs to see what changed between executions.

**Implementation Details:**
- Create run_records table in SQLite
- Store inputs, outputs, tool_calls as JSON
- Implement diff between two RunRecords
- Show document-level diffs for changed outputs
- Add RunRecord viewer component

**Files to Create/Modify:**
- `src/modules/workflow/RunRecordService.ts` - CRUD operations
- `src/modules/workflow/schema.sql` - Table definitions
- `src/components/workflow/RunRecordViewer.tsx` - Detail view
- `src/components/workflow/RunDiff.tsx` - Comparison view

**Acceptance Criteria:**
- [ ] All runs are persisted to SQLite
- [ ] RunRecord contains complete execution trace
- [ ] Comparing runs shows input differences
- [ ] Output diffs show document changes
- [ ] Tool calls are recorded with timing

**Tests Needed:**
- Unit test: RunRecord persists and loads correctly
- Unit test: Diff identifies changed inputs/outputs

---

## Phase 4: Model Adapters

---

### TICKET-027: Define Provider Interface
**Status:** DONE
**Priority:** P0
**Phase:** 4
**Estimated Size:** S
**Dependencies:** TICKET-005

**Description:**
Define the Provider interface that all model adapters must implement. This abstraction allows the workflow engine to work with any AI model.

**Implementation Details:**
- Define Provider interface with sendMessage, toolCall, structuredOutput
- Add getMetadata for model name, cost estimate, latency
- Define SendOptions with temperature, max_tokens, etc.
- Create ProviderError types for consistent error handling
- Document interface contract

**Files to Create/Modify:**
- `src/modules/models/Provider.ts` - Interface definition
- `src/modules/models/types.ts` - Options and error types
- `src/modules/models/index.ts` - Exports

**Acceptance Criteria:**
- [ ] Interface covers all needed operations
- [ ] Cost/latency metadata is available
- [ ] Error types distinguish API vs validation errors
- [ ] Interface supports streaming (future)

**Tests Needed:**
- Type test: Interface compiles correctly
- Document: Interface contract is documented

---

### TICKET-028: Implement Mock Provider for Testing
**Status:** DONE
**Priority:** P0
**Phase:** 4
**Estimated Size:** S
**Dependencies:** TICKET-027

**Description:**
Create a mock model adapter that returns predictable outputs for testing workflows without API calls.

**Implementation Details:**
- Implement Provider interface with configurable responses
- Add response fixtures for common prompts
- Support response delay simulation
- Add error simulation mode
- Make default test provider for all tests

**Files to Create/Modify:**
- `src/modules/models/MockProvider.ts` - Mock implementation
- `src/modules/models/fixtures/` - Response fixtures

**Acceptance Criteria:**
- [ ] MockProvider implements full Provider interface
- [ ] Responses can be configured per-test
- [ ] Delay simulation works
- [ ] Error mode triggers ProviderError

**Tests Needed:**
- Unit test: Mock returns configured response
- Unit test: Delay adds specified wait time

---

### TICKET-029: Implement Claude Provider
**Status:** DONE
**Priority:** P0
**Phase:** 4
**Estimated Size:** M
**Dependencies:** TICKET-027

**Description:**
Create the model adapter for Anthropic's Claude API. Support message sending, structured output via tool use, and cost tracking.

**Implementation Details:**
- Install @anthropic-ai/sdk
- Implement sendMessage with system prompts
- Implement structuredOutput using tools/schemas
- Calculate cost from token usage
- Handle rate limits with retry logic
- Support claude-3-opus, claude-3-sonnet, claude-3-haiku

**Files to Create/Modify:**
- `src/modules/models/ClaudeProvider.ts` - Claude adapter
- `src/modules/models/pricing.ts` - Model pricing data

**Acceptance Criteria:**
- [ ] sendMessage returns Claude response
- [ ] structuredOutput validates against schema
- [ ] Cost is calculated from token count
- [ ] Rate limits trigger retry with backoff
- [ ] Model selection works

**Tests Needed:**
- Integration test: Send real message (with API key)
- Unit test: Cost calculation is accurate
- Unit test: Retry logic works on 429

---

### TICKET-030: Implement OpenAI Provider
**Status:** DONE
**Priority:** P1
**Phase:** 4
**Estimated Size:** M
**Dependencies:** TICKET-027

**Description:**
Create the model adapter for OpenAI's GPT API. Support chat completions, function calling for structured output, and cost tracking.

**Implementation Details:**
- Install openai SDK
- Implement sendMessage with chat completions
- Implement structuredOutput using function calling
- Calculate cost from token usage
- Support gpt-4, gpt-4-turbo, gpt-3.5-turbo

**Files to Create/Modify:**
- `src/modules/models/OpenAIProvider.ts` - OpenAI adapter
- `src/modules/models/pricing.ts` - Add OpenAI pricing

**Acceptance Criteria:**
- [ ] sendMessage returns GPT response
- [ ] structuredOutput uses function calling
- [ ] Cost calculated from completion tokens
- [ ] Model selection works

**Tests Needed:**
- Integration test: Send real message
- Unit test: Cost calculation accurate

---

### TICKET-031: Implement API Key Management
**Status:** DONE
**Priority:** P0
**Phase:** 4
**Estimated Size:** M
**Dependencies:** TICKET-003, TICKET-027

**Description:**
Create secure API key storage using OS keychain (via Tauri) with fallbacks for browser development. Build settings UI for key management.

**Implementation Details:**
- Use @tauri-apps/plugin-os for keychain access
- Implement encrypted file fallback for browser
- Create KeychainService abstraction
- Build API key settings panel
- Support env vars for development
- Never log or persist keys in plaintext

**Files to Create/Modify:**
- `src/modules/models/KeychainService.ts` - Key storage
- `src/components/settings/ApiKeySettings.tsx` - Settings UI
- `src-tauri/src/commands/keychain.rs` - Tauri commands

**Acceptance Criteria:**
- [ ] Keys stored in OS keychain on desktop
- [ ] Encrypted fallback works in browser
- [ ] Settings UI shows masked keys
- [ ] Keys never appear in logs or storage
- [ ] Audit log records key access (not values)

**Tests Needed:**
- Unit test: Key storage and retrieval works
- Security test: Keys not in any logs
- Test: Invalid key shows clear error

---

## Phase 5: Research + Citations

---

### TICKET-032: Implement SourceCard Service
**Status:** DONE
**Priority:** P1
**Phase:** 5
**Estimated Size:** M
**Dependencies:** TICKET-019

**Description:**
Build the service for creating, storing, and querying SourceCards. Sources are saved as JSON files and indexed in SQLite for search.

**Implementation Details:**
- Define SourceCard type with all required fields
- Create SourceCardService with CRUD operations
- Store as JSON in workspace/research/ folder
- Index in SQLite for filtering
- Generate unique IDs for citations

**Files to Create/Modify:**
- `src/types/research.ts` - SourceCard type
- `src/modules/research/SourceCardService.ts` - CRUD service
- `src/modules/research/schema.sql` - Index table

**Acceptance Criteria:**
- [ ] SourceCards persist as JSON files
- [ ] SQLite index enables fast filtering
- [ ] Filter by topic, competitor, reliability
- [ ] IDs are unique and stable

**Tests Needed:**
- Unit test: CRUD operations work
- Unit test: Filters return correct results

---

### TICKET-033: Build Source Card UI
**Status:** DONE
**Priority:** P1
**Phase:** 5
**Estimated Size:** M
**Dependencies:** TICKET-032

**Description:**
Create the UI for creating source cards from URLs, viewing saved sources, and attaching them to document claims.

**Implementation Details:**
- Build SourceCardForm for URL input
- Create SourceCardPanel for browsing sources
- Add citation syntax support in editor
- Show citation preview on hover
- Implement CompetitorMatrix generation

**Files to Create/Modify:**
- `src/components/research/SourceCardForm.tsx` - Creation form
- `src/components/research/SourceCardPanel.tsx` - Browse panel
- `src/components/research/CitationBadge.tsx` - Citation display
- `src/components/research/CompetitorMatrix.tsx` - Matrix view

**Acceptance Criteria:**
- [ ] Form creates SourceCard from pasted URL
- [ ] Panel shows all sources with filters
- [ ] Citations render inline in documents
- [ ] Hover shows source details
- [ ] Competitor matrix generates from sources

**Tests Needed:**
- Unit test: Form validates URL
- Integration test: Create source, cite in doc

---

## Phase 6: Cross-Analysis

---

### TICKET-034: Implement DocSummary Generation
**Status:** DONE
**Priority:** P1
**Phase:** 6
**Estimated Size:** M
**Dependencies:** TICKET-027, TICKET-032

**Description:**
Build the service that generates structured DocSummary objects from documents using AI. Summaries follow a defined schema and link to source citations.

**Implementation Details:**
- Define DocSummary schema with thesis, bullets, assumptions, risks, etc.
- Create prompts for summary extraction
- Use structuredOutput to ensure schema compliance
- Link citations to SourceCard IDs
- Store summaries in SQLite

**Files to Create/Modify:**
- `src/types/analysis.ts` - DocSummary type
- `src/modules/analysis/DocSummaryService.ts` - Generation service
- `src/modules/analysis/prompts/summary.ts` - Summary prompts

**Acceptance Criteria:**
- [ ] DocSummary validates against schema
- [ ] Assumptions are explicitly identified
- [ ] Citations reference valid SourceCards
- [ ] Confidence score is calculated

**Tests Needed:**
- Unit test: Schema validation works
- Integration test: Summary generation with mock model

---

### TICKET-035: Build Multi-Model Comparison View
**Status:** DONE
**Priority:** P1
**Phase:** 6
**Estimated Size:** L
**Dependencies:** TICKET-034, TICKET-029, TICKET-030

**Description:**
Create the UI and logic for running the same prompt across multiple models and comparing their outputs side-by-side. Detect contradictions and generate synthesis.

**Implementation Details:**
- Build ComparisonView component with columns per model
- Run prompt through multiple providers in parallel
- Implement ContradictionDetector algorithm
- Highlight contradictory statements
- Generate reconciled synthesis document
- Show confidence and uncertainty flags

**Files to Create/Modify:**
- `src/components/analysis/ComparisonView.tsx` - Side-by-side view
- `src/modules/analysis/ContradictionDetector.ts` - Detection logic
- `src/modules/analysis/SynthesisGenerator.ts` - Reconciliation
- `src/components/analysis/SynthesisPanel.tsx` - Synthesis display

**Acceptance Criteria:**
- [ ] Same prompt runs on selected models
- [ ] Outputs display side-by-side
- [ ] Contradictions are highlighted
- [ ] Synthesis document is generated
- [ ] Citations trace back to model responses

**Tests Needed:**
- Unit test: Contradiction detection works
- Integration test: Full comparison flow with mock models

---

## Phase 7: Packaging & Polish

---

### TICKET-036: Configure Tauri Production Build
**Status:** DONE
**Priority:** P1
**Phase:** 7
**Estimated Size:** M
**Dependencies:** All previous tickets

**Description:**
Configure Tauri for production builds targeting Windows. Set up application icons, metadata, and installer generation.

**Implementation Details:**
- Configure tauri.conf.json for production
- Create application icons for all sizes
- Set up Windows installer (WiX or NSIS)
- Configure code signing (if available)
- Add auto-update infrastructure (optional)

**Files to Create/Modify:**
- `src-tauri/tauri.conf.json` - Production settings
- `src-tauri/icons/` - Application icons
- `.github/workflows/release.yml` - Build automation

**Acceptance Criteria:**
- [ ] `npm run tauri build` produces Windows installer
- [ ] Application icon displays correctly
- [ ] Installer runs without errors
- [ ] Installed app launches and works

**Tests Needed:**
- Build test: Installer generates successfully
- Installation test: Fresh install works

---

### TICKET-037: Implement Onboarding Flow
**Status:** DONE
**Priority:** P2
**Phase:** 7
**Estimated Size:** M
**Dependencies:** TICKET-016, TICKET-024

**Description:**
Create a first-run onboarding experience that guides new users through workspace setup, API key configuration, and their first workflow.

**Implementation Details:**
- Build multi-step onboarding wizard
- Step 1: Welcome and workspace selection
- Step 2: API key configuration (optional skip)
- Step 3: Tour of UI features
- Step 4: Option to run New Business Kickoff
- Track onboarding completion in settings

**Files to Create/Modify:**
- `src/components/common/Onboarding.tsx` - Wizard component
- `src/stores/settingsStore.ts` - Track completion

**Acceptance Criteria:**
- [ ] Onboarding appears on first launch
- [ ] Each step is clear and actionable
- [ ] User can skip steps
- [ ] Onboarding doesn't repeat after completion

**Tests Needed:**
- Unit test: Wizard steps advance correctly
- E2E test: Complete onboarding flow

---

### TICKET-038: Add Keyboard Shortcuts and Command Palette
**Status:** DONE
**Priority:** P2
**Phase:** 7
**Estimated Size:** M
**Dependencies:** TICKET-012, TICKET-009

**Description:**
Implement comprehensive keyboard shortcuts for all major actions and a command palette (Cmd+K/Ctrl+K) for quick access to any feature.

**Implementation Details:**
- Create useKeyboardShortcuts hook
- Define default shortcuts for navigation, editing, workflows
- Build CommandPalette component with fuzzy search
- Allow custom shortcut configuration
- Show shortcut hints in menus

**Files to Create/Modify:**
- `src/hooks/useKeyboardShortcuts.ts` - Shortcut handling
- `src/components/common/CommandPalette.tsx` - Command UI
- `src/stores/settingsStore.ts` - Custom shortcuts

**Acceptance Criteria:**
- [ ] Cmd+K/Ctrl+K opens command palette
- [ ] All major actions have shortcuts
- [ ] Shortcuts shown in menus/tooltips
- [ ] Custom shortcuts can be defined
- [ ] No conflicts with browser shortcuts

**Tests Needed:**
- Unit test: Shortcuts trigger correct actions
- Interaction test: Command palette finds commands

---

### TICKET-039: Implement Search Service
**Status:** DONE
**Priority:** P1
**Phase:** 7
**Estimated Size:** M
**Dependencies:** TICKET-006

**Description:**
Build full-text search across the workspace using FlexSearch. Support searching by title, content, and tags with the ability to extend to semantic search later.

**Implementation Details:**
- Set up FlexSearch with fielded document index
- Index all Markdown files on workspace open
- Implement incremental index updates on file changes
- Create search UI with results preview
- Design interface for future embedding search

**Files to Create/Modify:**
- `src/modules/search/SearchService.ts` - FlexSearch wrapper
- `src/modules/search/IndexBuilder.ts` - Index management
- `src/components/common/SearchPanel.tsx` - Search UI

**Acceptance Criteria:**
- [ ] Full-text search returns relevant results
- [ ] Fielded search works (title:, tag:)
- [ ] Index updates when files change
- [ ] Search results show context snippets
- [ ] Interface supports future embedding search

**Tests Needed:**
- Unit test: Index builds correctly
- Unit test: Search returns expected results
- Performance test: Large workspace indexes in <5s

---

### TICKET-040: Security Hardening Review
**Status:** DONE
**Priority:** P0
**Phase:** 7
**Estimated Size:** M
**Dependencies:** All previous tickets

**Description:**
Comprehensive security review and hardening of the application. Run security tests, fix any vulnerabilities, and document security model.

**Implementation Details:**
- Run all security tests (path traversal, symlink, injection)
- Review all user input handling
- Audit API key handling
- Review Tauri scope restrictions
- Document security model and limitations
- Add Content Security Policy if applicable

**Files to Create/Modify:**
- `tests/security/` - Comprehensive security tests
- `docs/SECURITY.md` - Security documentation
- Various files for fixes as needed

**Acceptance Criteria:**
- [ ] All security tests pass
- [ ] Path traversal impossible from any entry point
- [ ] API keys never logged or exposed
- [ ] Prompt injection is sanitized
- [ ] Security model is documented

**Tests Needed:**
- Security test suite runs and passes
- Penetration testing for common vectors

---

## Summary

| Phase | Tickets | Priority Breakdown |
|-------|---------|-------------------|
| Phase 0: Scaffolding | 5 | 2 P0, 3 P1 |
| Phase 1: Workspace + Editor | 11 | 5 P0, 5 P1, 1 P2 |
| Phase 2: History + Audit | 5 | 3 P0, 2 P1 |
| Phase 3: Workflow Engine | 5 | 4 P0, 1 P1 |
| Phase 4: Model Adapters | 5 | 4 P0, 1 P1 |
| Phase 5: Research | 2 | 2 P1 |
| Phase 6: Cross-Analysis | 2 | 2 P1 |
| Phase 7: Packaging | 5 | 2 P0, 2 P1, 1 P2 |
| **Total** | **40** | **20 P0, 17 P1, 3 P2** |

---

*Tickets should be executed in order within each phase. Cross-phase dependencies are noted in each ticket. The MVP milestone is reached when Phase 3 (TICKET-024) is complete with a working "New Business Kickoff" workflow.*
