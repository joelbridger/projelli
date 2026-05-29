# Keepance Feature Reference

_Last updated: 2026-04-16 · v1.0.8_

Canonical "what can Keepance do" reference. Built from the actual code in `src/` and `src-tauri/`, not from marketing copy. Update this when features ship.

## Overview

Keepance is a local-first, artifact-driven desktop workspace for solo founders building businesses with AI assistance. Tauri 2 + React 18 + TypeScript, BYOK (bring your own API key), data never leaves the user's machine.

Unlike chat-first AI tools, Keepance treats **files as first-class citizens**: every AI conversation, workflow run, whiteboard, and research note lives on disk as a real file the user owns. The AI proposes, the user approves destructive actions. Think Obsidian plus ChatGPT artifacts plus founder playbooks, under one roof, with no cloud dependency.

Ships as signed installers for Windows (NSIS + MSI), macOS (signed, currently unnotarized), and Linux (AppImage + deb). Auto-updates via GitHub Releases and minisign signatures as of v1.0.8.

## Core concepts

- **Workspace model.** A workspace is any folder the user picks. Every file in that folder is part of the workspace; Keepance never writes outside it. Recent workspaces persist across launches.
- **BYOK AI.** Users paste their own API keys for Anthropic (Claude), OpenAI, or Google (Gemini). Keys live in `localStorage`, never on a server. No Keepance-managed AI, no usage metering.
- **Local-first data.** No cloud sync, no accounts, no telemetry. If a user wants sync, they put their workspace in Dropbox, iCloud, or Syncthing. This is the differentiator.
- **File as first-class citizen.** Chats save as `.aichat`, workflow runs as `.workflow`, whiteboards as `.whiteboard`, research sources as `.source`. Everything is a real file the user can open, rename, move, version, or delete.

## Feature areas

### 1. File management

- **File tree** (`src/components/workspace/FileTree.tsx`) with expand/collapse, multi-select (Ctrl+click, Shift+click range), drag-to-reorder, drag-drop between folders.
- **Grid view** (`FileGridView.tsx`) opens from the Files section header.
- **Supported file types** (from `src/utils/fileIcons.ts`):

| Extension | Icon color | Editor |
|---|---|---|
| `.md`, `.markdown`, `.txt` | zinc | Markdown / Plain Text editor |
| `.rt`, `.rtf` | indigo | TipTap rich text |
| `.docx`, `.doc` | blue | TipTap + docx round-trip |
| `.xlsx`, `.xls`, `.csv` | emerald | Spreadsheet viewer/editor |
| `.pptx`, `.ppt` | orange | LibreOffice preview |
| `.pdf` | red | PDF viewer |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico` | purple | Image viewer |
| `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv` | pink | Video viewer (webm routes to audio editor) |
| `.mp3`, `.wav`, `.m4a`, `.ogg` | pink | Waveform editor |
| `.json` | amber | Markdown-mode editor |
| `.source` | cyan | Research source card editor |
| `.aichat` | fuchsia | AI chat viewer |
| `.whiteboard` | sky | Whiteboard canvas |
| `.workflow` | amber | Workflow execution tab |

- **Create / rename / move / delete.** Every operation goes through `HistoryService` (`src/modules/history/`) so it's undoable with Ctrl+Z. Create-file dialog shows destination and filename preview before confirm.
- **Drag-drop upload** from desktop via `GlobalDropOverlay` (`src/components/common/GlobalDropOverlay.tsx`). Auto-switches to the newly uploaded file.
- **Trash** (`src/modules/history/TrashService.ts`). Soft-delete with restore. Retention configurable (7, 14, 30, or 90 days, or never). Delete undo toast plus Ctrl+Z on recent deletions.
- **Search.**
  - Filename fuzzy match via **Quick-Open** (Ctrl+P, `src/components/QuickOpen.tsx`). Recent files persist in localStorage.
  - **Full-text content search** (`src/modules/search/ContentIndex.ts`) across every text-extractable file, powered by MiniSearch. Rebuilds on workspace open, upserts per save.
  - Search UI in the sidebar's Search tab.

### 2. Editors

Every editor dispatches from `MainPanel.tsx` based on file extension.

| Editor | File types | Key capabilities | Limitations |
|---|---|---|---|
| **Markdown editor** (`editor/MarkdownEditor.tsx`) | `.md`, `.json`, `.aichat` | CodeMirror 6, syntax highlighting, line numbers, folding, bracket matching, search, autocompletion, outline panel, backlinks panel, wiki-links (`[[page]]`), split pane, word count footer | - |
| **Plain text** (`editor/PlainTextEditor.tsx`) | `.txt` | CodeMirror 6 without Markdown grammar, word count | - |
| **Rich text (.rt)** (`editor/RichTextEditor.tsx`) | `.rt` | TipTap WYSIWYG: bold, italic, underline, strike, H1-H3, lists, quote, code, links, undo/redo, character count | - |
| **RTF editor** (`media/RtfEditor.tsx`) | `.rtf` | TipTap plus custom `rtf-io` serializer, 2s debounced autosave, first-edit backup, fidelity banner | Drops advanced RTF formatting on round-trip |
| **Word (.docx)** (`media/DocxEditor.tsx`) | `.docx`, `.doc` | Mammoth extracts HTML into TipTap for editing, `docx` package re-serializes on save. Dismissible fidelity banner. `.doc` converted via LibreOffice on open | Tables, images, headers/footers not preserved on save. Backup written on first edit |
| **Spreadsheet** (`media/SpreadsheetViewer.tsx`) | `.xlsx`, `.xls`, `.csv` | Click-to-select, double-click or F2/Enter to edit, Tab/Enter commit, Esc cancel. Merged cells, virtualization over 500 rows, column resize, formula bar, selection summary, ARIA grid semantics, formatted values | See "Not yet supported" below |
| **PowerPoint** (`media/PresentationViewer.tsx`) | `.pptx`, `.ppt` | Primary: LibreOffice `--headless --convert-to pdf` into PDFViewer (native Tauri command, cached). Fallback: pure-JS slide extraction via `pptx-io` | Read-only viewer, no editing. Requires LibreOffice installed |
| **PDF** (`media/PDFViewer.tsx`) | `.pdf` | iframe with blob URL, zoom, download, open-external | - |
| **Image / Video** (`media/MediaViewer.tsx`) | image and video formats | Rendered inline | - |
| **Waveform editor** (`audio/WaveformEditor.tsx`) | `.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm` | WaveSurfer.js: play/pause, scrub, split regions, cut/copy/paste, undo/redo (50 MB cap), record, normalize, fade in/out, gain, reverse | - |
| **Whiteboard** (`whiteboard/Whiteboard.tsx`) | `.whiteboard` | Canvas drawing: pencil, text, rectangle, ellipse, line. Select tool, undo/redo, z-order, image paste, bold/italic/underline text | - |
| **Source file** (`research/SourceFileEditor.tsx`) | `.source` | URL, quote, and tag metadata for citations | - |
| **AI chat** (`ai/AIChatViewer.tsx`) | `.aichat` | Full chat thread with model selection, per-tab context toggle, drag responses to tree as `.md` | - |
| **Workflow execution** (`workflow/WorkflowExecutionTab.tsx`) | `.workflow` | Live interview form, step progress, generated output, export to Word or PowerPoint | - |
| **Browser tab** | URL | Renders a URL in an iframe for reference | No JS cross-origin |

Additional editor features:

- **Auto-save indicator** (`AutoSaveIndicator.tsx`). Reactive state: saving, saved, unsaved, or error, with spinner and relative time.
- **Formatting toolbar** (`FormattingToolbar.tsx`). Collapses to overflow menu at narrow widths.
- **Split pane** (`SplitPane.tsx`). Ctrl+\ to toggle.
- **Tab bar** (`TabBar.tsx`). Horizontal scroll plus overflow arrows; close buttons hide until hover; tab grouping via `TabGroupManager.tsx`.
- **Outline** (`OutlinePanel.tsx`) and **backlinks** (`BacklinksPanel.tsx`) side panels (Ctrl+Shift+O, Ctrl+Shift+B).
- **Diff viewer** (`DiffViewer.tsx`) for version history comparisons.

### 3. AI integration

- **Three providers**, BYOK: `ClaudeProvider`, `OpenAIProvider`, `GeminiProvider` in `src/modules/models/`. `MockProvider` for tests.
- **Streaming responses.** SSE streaming for all three (`content_block_delta`, `chat.completion.chunk`, `streamGenerateContent?alt=sse`). Stop button via `AbortController` cancels mid-stream.
- **Model selection per conversation.** Dropdown filters out non-chat models; cache-versioned model list.
- **Ambient file context** (v1.0.8 headline). Open files auto-inject into chat via `useOpenFileAIContext` and `fileContextStore`. Extracted snapshots live in memory only; per-file opt-out persists.
- **Per-tab AI context toggle** to exclude individual files.
- **AI as sidebar panel OR main-panel tab.** Ctrl+Shift+A pops out the AI Assistant full-width.
- **Chats saved as `.aichat` files** on disk, not in a hidden database.
- **Drag AI responses to file tree** to save as `.md` (AI_MESSAGE_MIME drag protocol). Drop on existing file appends; drop on folder creates new file.
- **AI rules / custom instructions** via Settings, AI, Manage AI Rules.
- **Tool use** (file read/write from chat) registered on all three providers. Non-streaming fallback when tools are registered so tools actually get sent.
- **Audit log** (`src/modules/audit/AuditService.ts`). Append-only record of every AI action plus significant user operation. Filterable, exportable. Sidebar, AI Audit.

### 4. Workflows

15 founder-focused templates in `src/modules/workflow/templates/`:

| Name | What it does |
|---|---|
| **New Business Kickoff** | Interview into Vision, PRD, Lean Canvas |
| **Competitor Analysis** | Landscape and sales battle cards |
| **Customer Persona Builder** | Detailed personas and Ideal Customer Profile |
| **Customer Interview Guide** | Discovery scripts and recruiting templates |
| **MVP Scope Definition** | Feature prioritization and user stories with acceptance criteria |
| **Financial Projections** | Projections and metrics tracking framework |
| **Pricing Strategy** | Full pricing strategy and pricing page copy |
| **Go-To-Market Plan** | Timeline, channel strategy, launch checklist |
| **Landing Page Copy** | Conversion copy and wireframe spec |
| **Content Strategy** | Strategy and 30-day content calendar |
| **Investor Pitch Deck** | Full deck content and pitch scripts of varying lengths |
| **Weekly Review** | Week review and next-week plan |
| **Investor Update** | Monthly or quarterly update: headlines, metrics, wins, losses, asks |
| **Board Meeting Prep** | Time-boxed agenda and pre-read briefing |
| **First Hire Playbook** | Job description, structured interview rubric, and 30/60/90 onboarding |

Workflow execution model:

- **Persistent `.workflow` files** (v1.0.8). Every run saved as a real file with live file links to generated outputs. Reopen anytime.
- **Main-panel tab** execution (not a sidebar modal).
- **Step-by-step interview.** `InterviewForm` collects answers, then the `WorkflowEngine` (`src/modules/workflow/WorkflowEngine.ts`) generates artifacts.
- **Cancel / restart** at any step.
- **Export** generated artifacts to Word (`.docx`) or PowerPoint (`.pptx`) via `docx-io.ts` and `pptx-io.ts`.
- **Run history** via `RunRecordService.ts`.

### 5. Settings

Schema-driven. Every setting lives in `src/settings/schema.ts`. Adding a setting means one schema entry. Seven categories:

| Category | Setting | Type | Default | Options |
|---|---|---|---|---|
| General | Theme | select | `system` | system, light, dark |
| General | On Startup | select | `reopen` | reopen last, show selector |
| General | Show Update Notifications | toggle | `true` | - |
| Editor | Tab Overflow | select | `scroll` | scroll, wrap |
| Editor | Font Size | number | `14` | 12-24 px |
| Editor | Auto Save | toggle | `true` | - |
| Editor | Auto Save Interval | number | `2` | 1-30 seconds |
| Editor | Word Wrap | toggle | `true` | - |
| Editor | Line Numbers | toggle | `true` | - |
| AI | Ambient File Context | toggle | `true` | - |
| AI | Context Token Limit | number | `50000` | 10k-200k |
| AI | API Keys (action) | link | - | Opens AI panel Keys tab |
| AI | AI Rules (action) | link | - | Opens rules editor |
| Files | Default New File Type | select | `markdown` | markdown, plaintext, richtext |
| Files | Trash Retention | select | `30` | 7 / 14 / 30 / 90 days / never |
| Files | Show Hidden Files | toggle | `false` | - |
| Updates | Check Automatically | toggle | `true` | - |
| Updates | Update Channel | select | `stable` | stable (beta reserved) |
| Updates | Check for updates now (action) | link | - | Forces update check |
| About | What's new | action | - | Opens changelog modal |
| About | Website | action | - | Opens keepance.com |
| About | GitHub | action | - | Opens repo |

- **Export / Import** as JSON.
- **Reset to defaults** button.
- **Live search** across all settings (top bar in modal).
- Opened via gear icon, **Ctrl+,**, or command palette.

### 6. Keyboard shortcuts

Single source of truth: `src/utils/shortcuts.ts`. Consumed by the `?` overlay, command palette, and toolbar tooltips. Ctrl auto-swaps to ⌘ on macOS.

| Shortcut | Action | Category |
|---|---|---|
| **Ctrl+S** | Save active file | File |
| **Ctrl+W** | Close active tab | File |
| **Ctrl+\\** | Toggle split pane | View |
| **Ctrl+Shift+O** | Toggle outline panel | View |
| **Ctrl+Shift+B** | Toggle backlinks panel | View |
| **Ctrl+K** | Open command palette | Navigation |
| **Ctrl+P** | Quick-open file | Navigation |
| **?** | Show keyboard shortcuts overlay | Navigation |
| **Ctrl+Shift+A** | Open AI Assistant as main tab | AI |
| **Ctrl+,** | Open settings | General |
| **Ctrl+Z** | Undo file op / restore deleted | Editing |
| **Ctrl+Shift+Z** | Redo | Editing |

Additional shortcuts are contextual (per-editor). CodeMirror provides its own standard editing bindings (Ctrl+F find, Ctrl+A select all, etc.). TipTap editors inherit StarterKit bindings.

### 7. Appearance and theming

- **Light / Dark / System** modes (`system` follows OS `prefers-color-scheme` and re-syncs live).
- **Accent colors per file type** via `fileIcons.ts` for scannable tree and tabs.
- **Branded welcome screen.** Coral Keepance logo (`brand/KeepanceLogo.tsx`), white full-viewport layout, gradient glow decoration (`brand/GradientGlow.tsx`).
- **Gradient glow.** CSS-only radial blur, brand gradient (blue, purple, pink) at 6% opacity.
- **Sidebar icons** show tooltips with labels and shortcuts when collapsed.
- **Empty states** with icon, explanation, and CTA on every sidebar panel (`common/EmptyState.tsx`).
- **Clickable breadcrumbs** in status bar navigate up through folders.

### 8. Auto-update system (NEW v1.0.8)

`tauri-plugin-updater` wired end-to-end. Flow: idle, checking, available, downloading, ready-to-restart.

- **Schedule:** 30 seconds after mount, then every 24 hours (`UpdateManager.tsx`).
- **Endpoint:** `https://github.com/keepance/keepance/releases/latest/download/latest.json`.
- **Signed artifacts** via minisign; pubkey embedded in `tauri.conf.json` at build time.
- **Settings integration:** toggle auto-check, view channel, manual "Check for updates now" button, release-notes modal.
- **Desktop-only target filter** keeps iOS/Android out of the crate graph.
- **Session-scoped dismiss.** Hide banner for this session without disabling the setting.

Platform behavior:

- **Windows:** NSIS installer replaces in place.
- **macOS:** `.tar.gz` extracted and swapped; `.app` is signed but unnotarized (Apple's notary service has been degraded since late March 2026). Right-click, Open on first launch, then trusted forever.
- **Linux:** AppImage replaces; `.deb` via package manager.

### 9. Storage and data model

- **FSBackend abstraction** (`src/modules/workspace/types.ts`). Two concrete implementations:
  - `TauriFSBackend.ts`: native filesystem via `@tauri-apps/plugin-fs`, used in desktop.
  - `WebFSBackend.ts`: File System Access API, used in browser/dev mode.
  - Selected by `BackendFactory.ts` based on `__TAURI__` window global.
- **Version history** (`src/modules/versioning/VersionService.ts`). Up to 50 snapshots per file. Tracked for: `.md`, `.txt`, `.json`, `.source`, `.aichat`, `.whiteboard` (see `shouldVersionFile` in `MainPanel.tsx:105`). History button auto-hides on non-versioned types. Restore via `VersionHistoryPanel.tsx`. Uses `DiffViewer` for before/after preview.
- **First-edit backup** for binary round-trip files (`.xlsx`, `.docx`, `.rtf`). `fileBackupStore.ts` writes one backup per session the first time a user edits, as a safety net against serializer loss.
- **Trash retention.** Configurable, auto-cleanup via `TrashService.ts`.
- **Persistence via localStorage** (Zustand persist middleware):
  - `keepance:settings`, all user settings
  - `keepance_onboarding_complete`, first-run wizard state
  - `workspace_expanded_*`, tree expansion per workspace
  - `workspace_versions`, version metadata
  - `audit_log_*`, audit entries per workspace
  - `quickopen:recents`, recent files for Ctrl+P
  - AI chat sessions and file-context opt-outs
  - Recent workspaces (up to N most recent)
- **NOT persisted:** extracted AI context (in-memory only to avoid bloating localStorage).

### 10. Platform distribution

- **Windows.** NSIS (`.exe` installer) plus MSI. Signed by Microsoft Azure Trusted Signing cert `keepance-public-trust` (no SmartScreen warning). NSIS uses `installMode: currentUser`, custom installer hooks at `src-tauri/windows/installer-hooks.nsh`, branded sidebar and header BMPs.
- **macOS.** ARM plus Intel universal. Signed by Apple Developer ID. Currently unnotarized (Apple outage), so right-click, Open on first launch.
- **Linux.** AppImage plus deb.
- **CI pipeline.** `.github/workflows/release.yml` builds 9 signed artifacts on every `git tag v*` push.

### 11. Extensibility

- **New file type.** (1) Add entry to `ICON_MAP` in `src/utils/fileIcons.ts` with Lucide icon and color. (2) Add viewer/editor in `src/components/` and import into `MainPanel.tsx`. (3) Update `MainPanel`'s extension dispatch switch.
- **New setting.** Add one object to `SETTINGS_SCHEMA` in `src/settings/schema.ts`. The settings modal auto-renders it. Toggle, select, number, text, and shortcut-display types supported.
- **New keyboard shortcut.** Add entry to `SHORTCUTS` in `src/utils/shortcuts.ts`, then wire the handler in `App.tsx` (the list is descriptive, it doesn't register handlers).
- **New workflow template.** Drop a `.ts` file in `src/modules/workflow/templates/` exporting a `WorkflowTemplate`. Register in `src/modules/workflow/index.ts#allWorkflows`.

## Architecture pointers

- **Tauri 2** shell (Rust). Native commands live in `src-tauri/src/commands/fs.rs`: `check_path`, `get_home_dir`, `open_in_explorer`, `detect_libreoffice`, `convert_doc_to_docx`, `convert_ppt_to_pdf`.
- **React 18 plus TypeScript**, Vite 6, `tsc -b` plus `vite build`.
- **Zustand** for state. Stores (`src/stores/`):
  - `workspaceStore`: root path, file tree, selection, recent workspaces
  - `editorStore`: open tabs, split panes, active tab
  - `aiChatStore`: chat sessions (persisted)
  - `fileContextStore`: ambient AI context per tab
  - `fileBackupStore`: first-edit backup tracking
  - `settingsStore`: schema-driven settings (persisted)
  - `updaterStore`: auto-update state machine
  - `workflowStore`: templates, current run, history
- **UI:** Radix primitives plus shadcn/ui plus Tailwind v4. Lucide React icons.
- **CodeMirror 6** for text/markdown editors. **TipTap 3** for rich text, docx, and rtf.
- **Heavy libs lazy-loaded:** xlsx (~500 KB), docx-preview (~300 KB), mammoth (~200 KB), docx (~500 KB).
- **Key directories:**
  - `src/components/`: 14 subdirs, grouped by feature area
  - `src/modules/`: non-UI logic (workflow engine, versioning, audit, search, history, audio effects, AI providers)
  - `src/utils/`: shared helpers (formula engine, file IO, shortcuts SSOT, file icons SSOT)
  - `src/stores/`: Zustand stores
  - `src/hooks/`: custom hooks

## Not yet supported

Honest limitations:

- **`.ods`, `.odt`, `.numbers`, `.pages`.** No demand; LibreOffice formats add complexity without a clear user base.
- **Cross-sheet formula refs.** `Sheet2!A1` parses but returns `#REF!`. Single-sheet recomputation is intentional.
- **Advanced Excel functions.** VLOOKUP, INDEX/MATCH, XLOOKUP, array formulas not implemented. In-house engine (`src/utils/formula-engine.ts`) covers ~20 common functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ABS, ROUND, SQRT, POWER, PRODUCT, CONCATENATE, LEN, UPPER, LOWER, TRIM, AND, OR, NOT. Anything else returns `#NAME?`. (We built in-house rather than using HyperFormula because HyperFormula is GPL-3, which conflicts with the commercial license.)
- **Docx tables, images, headers/footers.** Dropped on round-trip. First-edit backup protects the original.
- **Cloud sync, multi-user collaboration.** Deliberate. Local-first is the differentiator. Users can sync via Dropbox, iCloud, or Syncthing.
- **Mobile versions.**
- **Full-text search inside PDFs.** Only filename matching.
- **`.pptx` editing.** Read-only. Save-out via Word or PowerPoint export in workflows only.

## For future contributors

- **Tests.** Vitest unit tests in `tests/unit/`, `tests/integration/`, `tests/security/`. Playwright e2e in `tests/e2e/` (50 spec files).
- **Key patterns:**
  - `EmptyState` component: always has icon, explanation, and CTA.
  - SSOT for shortcuts (`utils/shortcuts.ts`) and file icons (`utils/fileIcons.ts`). Update the SSOT, all consumers follow.
  - `useConfirmDialog` and `usePromptDialog` hooks replace `window.confirm` and `window.prompt` everywhere (WIN-015 audit).
  - First-edit backup pattern: `onFirstEdit` prop on binary editors, `fileBackupStore` tracks per-session state.
- **UX polish tracker:** `docs/quality/UX_POLISH_BACKLOG.md`, 30+ tickets from the Phase 7 audit, most closed.
- **Implementation plans** live in `docs/features/` (marketing docs as of 2026-04-15; product feature plans live in `BACKLOG.md` by week).
- **Memory file** for AI assistants: `~/.claude/projects/-home-jameson/memory/project_keepance.md`.

## References

- [`CHANGELOG.md`](../../CHANGELOG.md), full version-by-version history.
- [`PROJELLI_BUSINESS_PLAN.md`](../../PROJELLI_BUSINESS_PLAN.md), commercial strategy, pricing, 8-week launch plan.
- [`BACKLOG.md`](../../BACKLOG.md), current roadmap.
- [`docs/reference/ARCHITECTURE.md`](ARCHITECTURE.md), layered architecture, module boundaries.
- [`docs/reference/DECISIONS.md`](DECISIONS.md), ADRs.
- [`docs/reference/SECURITY.md`](SECURITY.md), threat model.
