# Implementation Plan: Business OS - Founder Workspace

## Technical Architecture

### System Overview

Business OS follows a layered architecture with clear separation between UI, business logic, and data persistence. The application runs as both a browser-based prototype (via Vite dev server) and a native desktop application (via Tauri).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │  File Tree  │ │   Tabs &    │ │  Workflow   │ │    Settings / API       ││
│  │  Sidebar    │ │ Split Panes │ │   Panels    │ │    Key Management       ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
│                         React + TypeScript + Zustand                         │
│                           shadcn/ui + Tailwind CSS                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CORE MODULES                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │   Workspace  │ │    Editor    │ │   Workflow   │ │   Model Adapters     ││
│  │   Manager    │ │    Module    │ │    Engine    │ │ (Claude/OpenAI/Gemini)│
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────────────┘│
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │   History    │ │    Search    │ │   Research   │ │   Cross-Analysis     ││
│  │   Module     │ │    Index     │ │   Module     │ │      Module          ││
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TOOL LAYER                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │  Unified Tool Interface: filesystem, history, search, render, research   ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────────┐
│      FILESYSTEM BACKEND         │   │         SQLITE DATABASE             │
│  ┌───────────┐ ┌───────────────┐│   │  ┌────────────┐ ┌────────────────┐  │
│  │   Web FS  │ │   Tauri FS    ││   │  │ RunRecords │ │  SourceCards   │  │
│  │   API     │ │   Plugin      ││   │  └────────────┘ └────────────────┘  │
│  └───────────┘ └───────────────┘│   │  ┌────────────┐ ┌────────────────┐  │
│         (Browser)  (Desktop)    │   │  │ AuditLog   │ │  SearchIndex   │  │
└─────────────────────────────────┘   │  └────────────┘ └────────────────┘  │
                                      └─────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOCAL FILESYSTEM                                     │
│  workspace-root/                                                             │
│  ├── .business-os/          (app metadata, SQLite DB, settings)             │
│  ├── docs/                  (user Markdown files - source of truth)          │
│  ├── research/              (SourceCards as JSON, organized by topic)        │
│  └── .trash/                (soft-deleted files for recovery)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend Framework** | React 18 + TypeScript 5 | Type safety, component reusability, large ecosystem, Tauri compatibility |
| **Build Tool** | Vite 5 | Fast HMR, native ESM, excellent TypeScript support, works with both browser and Tauri |
| **State Management** | Zustand | Minimal boilerplate, TypeScript-native, no providers needed, works outside React components |
| **Data Fetching** | TanStack Query (optional) | Add only if API caching needed; start without it for simplicity |
| **UI Components** | shadcn/ui + Radix | Accessible, customizable, copy-paste ownership, Tailwind-native |
| **Styling** | Tailwind CSS 3 | Utility-first, consistent design tokens, excellent DX, small bundle with purging |
| **Markdown Editor** | CodeMirror 6 | Extensible, performant, proven by Obsidian, excellent TypeScript support |
| **Desktop Wrapper** | Tauri 2 | Small binary size, native security model, Rust backend for fs operations |
| **Database** | SQLite (via sql.js or Tauri plugin) | Single-file, serverless, excellent for local-first, stores run records and indexes |
| **Full-Text Search** | FlexSearch | Fast, client-side, fielded search, designed for future embedding integration |
| **Diagrams** | Mermaid | Markdown-embeddable, no external dependencies, broad diagram type support |
| **API Key Storage** | OS Keychain (Tauri plugin) | Secure credential storage, fallback to encrypted file |
| **Testing** | Vitest + React Testing Library | Fast, Vite-native, excellent TypeScript support |

### Key Components

#### 1. Workspace Manager (`src/modules/workspace/`)
- **Responsibility**: File tree CRUD, workspace root management, path validation
- **Security**: Validates all paths against workspace root, blocks traversal attacks, denies escaping symlinks
- **Interfaces**: `WorkspaceService` with `create()`, `read()`, `write()`, `delete()`, `move()`, `rename()`, `list()`
- **Backends**: Web FS API for browser, Tauri commands for desktop

#### 2. Editor Module (`src/modules/editor/`)
- **Responsibility**: CodeMirror 6 integration, tabs, split panes, outline navigation
- **Features**: Markdown syntax highlighting, wiki-link parsing, live preview, diff view
- **State**: Open files, active tab, pane layout stored in Zustand

#### 3. History Module (`src/modules/history/`)
- **Responsibility**: Undo/redo stack, soft delete, version tracking
- **Implementation**: Command pattern for all file operations, trash folder for soft deletes
- **Audit Integration**: Every operation logged to audit module

#### 4. Workflow Engine (`src/modules/workflow/`)
- **Responsibility**: Define, execute, and record AI-powered workflows
- **Core Types**: `WorkflowTemplate`, `WorkflowRun`, `RunRecord`
- **Priority Workflow**: "New Business Kickoff" - interview → document generation
- **Storage**: RunRecords in SQLite with full input/output capture

#### 5. Model Adapters (`src/modules/models/`)
- **Responsibility**: Unified interface to Claude, OpenAI, Gemini APIs
- **Provider Interface**:
  ```typescript
  interface Provider {
    sendMessage(prompt: string, options?: SendOptions): Promise<string>;
    toolCall(tool: string, params: unknown): Promise<unknown>;
    structuredOutput<T>(prompt: string, schema: Schema): Promise<T>;
    getMetadata(): { model: string; costEstimate: number; latencyEstimate: number };
  }
  ```
- **Key Storage**: OS keychain primary, encrypted file fallback, env vars for dev

#### 6. Research Module (`src/modules/research/`)
- **Responsibility**: SourceCard management, citation tracking, assumption marking
- **Types**: `SourceCard` with URL, title, snippet, claim supported, reliability notes
- **Storage**: JSON files in `workspace/research/`, indexed in SQLite

#### 7. Cross-Analysis Module (`src/modules/analysis/`)
- **Responsibility**: DocSummary generation, multi-model comparison, contradiction detection
- **Types**: `DocSummary` with thesis, bullets, assumptions, risks, questions, actions, confidence, citations
- **Features**: Side-by-side model comparison, synthesis generation with uncertainty flags

#### 8. Search Module (`src/modules/search/`)
- **Responsibility**: Full-text search across workspace, tag filtering, backlink indexing
- **Implementation**: FlexSearch with fielded documents (title, body, tags)
- **Extensibility**: Interface designed for future semantic/embedding search

#### 9. Audit Module (`src/modules/audit/`)
- **Responsibility**: Append-only log of all AI actions and file operations
- **Fields**: Action type, timestamp, model used, inputs, outputs, user decision
- **Storage**: SQLite table, never deleted, exportable

#### 10. Tool Layer (`src/tools/`)
- **Responsibility**: Unified interface for all operations that models can invoke
- **Categories**:
  - `filesystem`: read, write, create, delete, move, rename, list
  - `history`: undo, redo, restore, getVersions
  - `search`: fullText, byTag, byType, byDate
  - `render`: mermaidToSvg, chartToImage
  - `research`: saveSourceCard, extractFromUrl

---

## Implementation Phases

### Phase 0: Repository Scaffolding
**Goal**: Establish project foundation with all tooling configured

**Deliverables:**
- [ ] Initialize Vite + React + TypeScript project (`npm create vite@latest`)
- [ ] Configure TypeScript strict mode (`tsconfig.json`)
- [ ] Set up Tailwind CSS with shadcn/ui configuration
- [ ] Initialize Tauri project with dev URL support
- [ ] Configure ESLint + Prettier with consistent rules
- [ ] Set up Vitest for unit testing
- [ ] Create folder structure matching architecture
- [ ] Add placeholder README and basic documentation structure
- [ ] Configure git with `.gitignore` for node_modules, dist, Tauri build artifacts

**Folder Structure Created:**
```
business-os/
├── src/
│   ├── components/          # React UI components
│   ├── modules/             # Core business logic
│   │   ├── workspace/
│   │   ├── editor/
│   │   ├── history/
│   │   ├── workflow/
│   │   ├── models/
│   │   ├── research/
│   │   ├── analysis/
│   │   ├── search/
│   │   └── audit/
│   ├── tools/               # Unified tool layer
│   ├── stores/              # Zustand stores
│   ├── hooks/               # React hooks
│   ├── types/               # TypeScript interfaces
│   └── utils/               # Shared utilities
├── src-tauri/               # Tauri Rust backend
├── tests/                   # Test files
└── docs/                    # Documentation
```

---

### Phase 1: Workspace Browser + Editor
**Goal**: Users can create a workspace, navigate files, and edit Markdown

**Deliverables:**
- [ ] Workspace root selection dialog (File System Access API for web)
- [ ] File tree component with folders and files
- [ ] Create/rename/delete folders and files
- [ ] Drag-and-drop file organization
- [ ] CodeMirror 6 Markdown editor with syntax highlighting
- [ ] Tab system for multiple open files
- [ ] Split pane view (vertical/horizontal)
- [ ] Outline navigation (jump to headings)
- [ ] Wiki-style `[[link]]` syntax parsing
- [ ] Backlink panel showing documents linking to current file
- [ ] Zustand store for workspace state (open files, tabs, layout)
- [ ] Path validation and traversal blocking

**Key Files:**
- `src/modules/workspace/WorkspaceService.ts`
- `src/modules/workspace/WebFSBackend.ts`
- `src/modules/editor/MarkdownEditor.tsx`
- `src/components/FileTree.tsx`
- `src/components/TabBar.tsx`
- `src/components/SplitPane.tsx`
- `src/stores/workspaceStore.ts`

---

### Phase 1.5: AI Chat Interface (CRITICAL)
**Goal**: Users can interact with AI to create, edit, and refine artifacts via natural language

**Deliverables:**
- [ ] AI chat panel component with message history
- [ ] Message composer with markdown support
- [ ] Streaming response display (token-by-token)
- [ ] File/artifact context selector (which docs AI can see)
- [ ] Inline file preview in chat (show snippets of referenced files)
- [ ] Action buttons for AI-suggested edits (Accept/Reject)
- [ ] Tool call visualization (show when AI reads/writes files)
- [ ] Model selector dropdown (Claude/OpenAI/Gemini)
- [ ] Chat history persistence (per workspace)
- [ ] Integration with workspace operations (AI can create/edit files with approval)

**Key Features:**
- Every AI response must produce/modify a persistent artifact
- File operations require explicit user approval with diff preview
- Chat messages reference which files were created/modified
- Context-aware: AI sees current open file + user-selected context
- Audit log tracks all AI file operations

**Key Files:**
- `src/components/ai/AIChatPanel.tsx`
- `src/components/ai/MessageComposer.tsx`
- `src/components/ai/ChatMessage.tsx`
- `src/modules/ai/ChatService.ts`
- `src/stores/chatStore.ts`

**Integration Points:**
- Uses existing WorkspaceService for file operations
- Uses existing Provider interface for model calls
- Uses existing DiffViewer for change previews
- Uses existing AuditService for logging

---

### Phase 2: History + Audit
**Goal**: Users can undo mistakes, recover deleted files, and review AI actions

**Deliverables:**
- [ ] Undo/redo stack for file operations (command pattern)
- [ ] Soft delete with `.trash/` folder
- [ ] Restore deleted files from trash UI
- [ ] Version history for edited files (internal or git integration)
- [ ] Append-only audit log table (SQLite)
- [ ] Audit log viewer component
- [ ] Read-only file locking (prevent edits to locked files)
- [ ] Diff preview component for showing changes before accepting

**Key Files:**
- `src/modules/history/HistoryService.ts`
- `src/modules/history/CommandStack.ts`
- `src/modules/audit/AuditService.ts`
- `src/components/DiffViewer.tsx`
- `src/components/TrashPanel.tsx`
- `src/components/AuditLog.tsx`

---

### Phase 3: Workflow Engine
**Goal**: Users can run the "New Business Kickoff" workflow end-to-end

**Deliverables:**
- [ ] `WorkflowTemplate` definition schema
- [ ] `RunRecord` type and SQLite storage
- [ ] Workflow execution engine with step-by-step processing
- [ ] **"New Business Kickoff" workflow** (PRIORITY):
  - Interview UI with structured questions
  - Generate VISION.md from answers
  - Generate PRD.md from answers
  - Generate Lean Canvas document
  - Store complete RunRecord with inputs/outputs
- [ ] Re-run workflow with updated answers
- [ ] Diff view showing what changed between runs
- [ ] Workflow run history panel
- [ ] Status indicators (pending, running, completed, failed)

**Key Files:**
- `src/modules/workflow/WorkflowEngine.ts`
- `src/modules/workflow/templates/NewBusinessKickoff.ts`
- `src/modules/workflow/RunRecordService.ts`
- `src/components/WorkflowPanel.tsx`
- `src/components/InterviewForm.tsx`
- `src/types/workflow.ts`

---

### Phase 4: Model Adapters
**Goal**: Users can configure AI models and the workflow engine can call them

**Deliverables:**
- [ ] `Provider` interface definition
- [ ] Mock adapter for testing (returns predictable outputs)
- [ ] Claude adapter (Anthropic API)
- [ ] OpenAI adapter (GPT-4 API)
- [ ] Gemini adapter (Google AI API with function calling)
- [ ] API key management UI
- [ ] OS keychain integration (Tauri plugin)
- [ ] Encrypted file fallback for key storage
- [ ] Cost and latency estimate display
- [ ] Model selection in workflow configuration

**Key Files:**
- `src/modules/models/Provider.ts` (interface)
- `src/modules/models/MockProvider.ts`
- `src/modules/models/ClaudeProvider.ts`
- `src/modules/models/OpenAIProvider.ts`
- `src/modules/models/GeminiProvider.ts`
- `src/modules/models/KeychainService.ts`
- `src/components/ApiKeySettings.tsx`
- `src/components/ModelSelector.tsx`

---

### Phase 5: Research + Citations
**Goal**: Users can save sources and attach citations to claims

**Deliverables:**
- [ ] `SourceCard` type definition
- [ ] SourceCard creation from pasted URL
- [ ] SourceCard storage (JSON files + SQLite index)
- [ ] SourceCard browser/filter UI
- [ ] Attach sources to claims in Markdown (custom syntax or frontmatter)
- [ ] Citation preview on hover
- [ ] Filter sources by topic, competitor, market, reliability
- [ ] Generate competitor matrix from SourceCards
- [ ] Mark statements as "assumption" when unsourced
- [ ] Research panel in sidebar

**Key Files:**
- `src/modules/research/SourceCardService.ts`
- `src/modules/research/CitationParser.ts`
- `src/components/SourceCardPanel.tsx`
- `src/components/CompetitorMatrix.tsx`
- `src/types/research.ts`

---

### Phase 6: Cross-Analysis
**Goal**: Users can compare model outputs and generate synthesized insights

**Deliverables:**
- [ ] `DocSummary` schema-validated type
- [ ] DocSummary generation from documents (via AI)
- [ ] Multi-model comparison view (same prompt → multiple models)
- [ ] Side-by-side output display
- [ ] Contradiction detection algorithm
- [ ] Highlight contradictions in comparison view
- [ ] Generate reconciled synthesis document
- [ ] Uncertainty flags and confidence scores
- [ ] Decision log export from synthesis
- [ ] Citations linking back to DocSummaries and SourceCards

**Key Files:**
- `src/modules/analysis/DocSummaryService.ts`
- `src/modules/analysis/ContradictionDetector.ts`
- `src/modules/analysis/SynthesisGenerator.ts`
- `src/components/ComparisonView.tsx`
- `src/components/SynthesisPanel.tsx`
- `src/types/analysis.ts`

---

### Phase 7: Packaging & Polish
**Goal**: Application is ready for distribution and daily use

**Deliverables:**
- [ ] Tauri build configuration for Windows
- [ ] Application icon and branding
- [ ] Onboarding flow for new users
- [ ] Sample workspace template (pre-filled with example content)
- [ ] Keyboard shortcuts for all major actions
- [ ] Command palette (Cmd+K / Ctrl+K)
- [ ] Error handling and user-friendly error messages
- [ ] Loading states and progress indicators
- [ ] Performance optimization (lazy loading, virtualization for large file trees)
- [ ] User documentation (in-app help, README)
- [ ] Security hardening review

**Key Files:**
- `src-tauri/tauri.conf.json`
- `src/components/Onboarding.tsx`
- `src/components/CommandPalette.tsx`
- `src/hooks/useKeyboardShortcuts.ts`

---

## Risk Analysis

| Technical Risk | Probability | Impact | Mitigation |
|----------------|-------------|--------|------------|
| **Path traversal vulnerabilities** | Medium | High | Strict allowlist validation, block `../` patterns, deny symlinks escaping root, comprehensive security tests |
| **API key exposure** | Medium | High | OS keychain primary, encrypted fallback, never log keys, audit key access |
| **CodeMirror 6 learning curve** | Medium | Medium | Start with basic editor, add features incrementally, leverage Obsidian community examples |
| **SQLite in browser limitations** | Medium | Medium | Use sql.js (WASM) for browser, native SQLite for Tauri; test both |
| **Model API rate limits/costs** | High | Medium | Show cost estimates, implement retry with backoff, cache responses where appropriate |
| **Large workspace performance** | Medium | Medium | Virtualize file tree, lazy-load content, index incrementally |
| **Tauri + Web FS API differences** | Medium | Medium | Abstract behind common interface, test both paths, prioritize web for rapid iteration |
| **Prompt injection attacks** | Medium | High | Sanitize external content, validate structured outputs against schemas, isolate tool execution |
| **State management complexity** | Low | Medium | Keep Zustand stores focused, avoid over-centralization, use selectors |
| **Offline SQLite sync issues** | Low | Medium | Files are source of truth, SQLite is index only, rebuild index if corrupted |

---

## Dependencies

### External Dependencies

**Core:**
- `react` ^18.2 - UI framework
- `react-dom` ^18.2 - React DOM bindings
- `typescript` ^5.3 - Type safety
- `vite` ^5.0 - Build tool

**UI:**
- `tailwindcss` ^3.4 - Utility CSS
- `@radix-ui/*` - Accessible primitives (via shadcn/ui)
- `lucide-react` - Icons
- `class-variance-authority` - Component variants
- `clsx` + `tailwind-merge` - Class utilities

**Editor:**
- `@codemirror/state` - Editor state
- `@codemirror/view` - Editor view
- `@codemirror/lang-markdown` - Markdown support
- `@codemirror/commands` - Editor commands

**State & Data:**
- `zustand` ^4.4 - State management
- `sql.js` ^1.8 - SQLite in browser (WASM)
- `flexsearch` ^0.7 - Full-text search

**Diagrams:**
- `mermaid` ^10 - Diagram rendering

**Desktop:**
- `@tauri-apps/api` ^2 - Tauri frontend bindings
- `@tauri-apps/plugin-fs` ^2 - Filesystem access
- `@tauri-apps/plugin-os` ^2 - OS keychain

**Testing:**
- `vitest` ^1.0 - Test runner
- `@testing-library/react` ^14 - React testing
- `@testing-library/user-event` ^14 - User interaction testing

**AI Model SDKs:**
- `@anthropic-ai/sdk` - Claude API
- `openai` ^4 - OpenAI API
- `@google/generative-ai` - Gemini API

### Internal Dependencies

```
┌─────────────────┐
│   UI Layer      │ ──depends on──▶ All modules
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Core Modules   │
│  ┌───────────┐  │
│  │ Workflow  │──┼──depends on──▶ Models, Workspace, History, Audit
│  │ Engine    │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │ Analysis  │──┼──depends on──▶ Models, Research, Search
│  └───────────┘  │
│  ┌───────────┐  │
│  │ Research  │──┼──depends on──▶ Workspace, Search
│  └───────────┘  │
│  ┌───────────┐  │
│  │ Editor    │──┼──depends on──▶ Workspace, History
│  └───────────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Tool Layer    │ ──depends on──▶ Workspace, History, Search
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Data Layer     │
│  (FS + SQLite)  │
└─────────────────┘
```

---

## Testing Strategy

### Unit Tests

**Workspace Operations:**
- Create/read/update/delete files and folders
- Path validation (traversal blocking)
- Symlink escape detection
- File tree construction from filesystem

**History Module:**
- Undo/redo stack operations
- Command execution and reversal
- Soft delete and restore

**Schema Validation:**
- `DocSummary` conforms to schema
- `SourceCard` conforms to schema
- `RunRecord` conforms to schema

**Search Module:**
- Index building
- Full-text search queries
- Tag and type filtering

**Model Adapters:**
- Mock provider returns expected outputs
- Error handling for API failures
- Cost/latency metadata

### Integration Tests

**Workspace Flow:**
1. Create workspace from folder
2. Create nested folders and files
3. Edit file content
4. Undo edit
5. Delete file (soft delete)
6. Restore from trash

**Workflow Execution:**
1. Create workspace
2. Run "New Business Kickoff" with mock model
3. Verify VISION.md created with correct content
4. Verify PRD.md created
5. Verify RunRecord stored in SQLite
6. Verify audit log entries

**Research Flow:**
1. Create SourceCard from URL
2. Attach to claim in document
3. Filter SourceCards by topic
4. Generate competitor matrix

### Security Tests

**Path Traversal:**
- Attempt `../../../etc/passwd` - must be blocked
- Attempt `workspace/../secret` - must be blocked
- Nested traversal attempts - must be blocked

**Symlink Escape:**
- Create symlink pointing outside workspace root
- Attempt to read via symlink - must be denied

**Prompt Injection:**
- Include `</system>` or similar in Markdown content
- Verify sanitization before prompt construction
- Validate structured outputs reject malformed data

### End-to-End Tests

**New User Onboarding:**
1. Launch application
2. Select folder as workspace root
3. Complete onboarding flow
4. Verify workspace created correctly

**New Business Kickoff Complete:**
1. Start "New Business Kickoff" workflow
2. Answer all interview questions
3. Select model (mock for test)
4. Execute workflow
5. Verify all documents generated
6. View run record
7. Re-run with modified answers
8. Verify diff shows changes

**Multi-Model Comparison:**
1. Configure multiple model adapters
2. Run same prompt across models
3. View side-by-side comparison
4. Detect contradictions
5. Generate synthesis

---

## Directory Structure

```
business-os/
├── src/
│   ├── main.tsx                      # Application entry point
│   ├── App.tsx                       # Root component
│   │
│   ├── components/                   # React UI components
│   │   ├── ui/                       # shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   └── ...
│   │   ├── layout/                   # Layout components
│   │   │   ├── Sidebar.tsx
│   │   │   ├── MainPanel.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── workspace/                # Workspace components
│   │   │   ├── FileTree.tsx
│   │   │   ├── FileTreeItem.tsx
│   │   │   └── WorkspaceSelector.tsx
│   │   ├── editor/                   # Editor components
│   │   │   ├── MarkdownEditor.tsx
│   │   │   ├── TabBar.tsx
│   │   │   ├── SplitPane.tsx
│   │   │   ├── OutlinePanel.tsx
│   │   │   └── DiffViewer.tsx
│   │   ├── workflow/                 # Workflow components
│   │   │   ├── WorkflowPanel.tsx
│   │   │   ├── InterviewForm.tsx
│   │   │   ├── RunHistoryPanel.tsx
│   │   │   └── RunRecordViewer.tsx
│   │   ├── research/                 # Research components
│   │   │   ├── SourceCardPanel.tsx
│   │   │   ├── SourceCardForm.tsx
│   │   │   ├── CitationBadge.tsx
│   │   │   └── CompetitorMatrix.tsx
│   │   ├── analysis/                 # Analysis components
│   │   │   ├── ComparisonView.tsx
│   │   │   ├── SynthesisPanel.tsx
│   │   │   └── ContradictionHighlight.tsx
│   │   ├── settings/                 # Settings components
│   │   │   ├── ApiKeySettings.tsx
│   │   │   ├── ModelSelector.tsx
│   │   │   └── PreferencesPanel.tsx
│   │   ├── common/                   # Shared components
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── Onboarding.tsx
│   │   │   ├── AuditLog.tsx
│   │   │   └── TrashPanel.tsx
│   │   └── index.ts                  # Component exports
│   │
│   ├── modules/                      # Core business logic
│   │   ├── workspace/
│   │   │   ├── WorkspaceService.ts   # Main workspace operations
│   │   │   ├── WebFSBackend.ts       # Browser File System Access API
│   │   │   ├── TauriFSBackend.ts     # Tauri filesystem backend
│   │   │   ├── PathValidator.ts      # Security: path validation
│   │   │   └── index.ts
│   │   ├── editor/
│   │   │   ├── EditorService.ts      # Editor state management
│   │   │   ├── WikiLinkParser.ts     # [[link]] syntax
│   │   │   ├── BacklinkIndex.ts      # Backlink tracking
│   │   │   └── index.ts
│   │   ├── history/
│   │   │   ├── HistoryService.ts     # Undo/redo management
│   │   │   ├── CommandStack.ts       # Command pattern impl
│   │   │   ├── TrashService.ts       # Soft delete management
│   │   │   └── index.ts
│   │   ├── workflow/
│   │   │   ├── WorkflowEngine.ts     # Workflow execution
│   │   │   ├── RunRecordService.ts   # Run record storage
│   │   │   ├── templates/
│   │   │   │   ├── NewBusinessKickoff.ts
│   │   │   │   ├── CompetitorScan.ts
│   │   │   │   ├── PricingHypotheses.ts
│   │   │   │   └── CustomerInterviewKit.ts
│   │   │   └── index.ts
│   │   ├── models/
│   │   │   ├── Provider.ts           # Provider interface
│   │   │   ├── MockProvider.ts       # Testing provider
│   │   │   ├── ClaudeProvider.ts     # Anthropic API
│   │   │   ├── OpenAIProvider.ts     # OpenAI API
│   │   │   ├── GeminiProvider.ts     # Google AI API
│   │   │   ├── KeychainService.ts    # API key storage
│   │   │   └── index.ts
│   │   ├── research/
│   │   │   ├── SourceCardService.ts  # SourceCard CRUD
│   │   │   ├── CitationParser.ts     # Parse citations in Markdown
│   │   │   └── index.ts
│   │   ├── analysis/
│   │   │   ├── DocSummaryService.ts  # Summary generation
│   │   │   ├── ContradictionDetector.ts
│   │   │   ├── SynthesisGenerator.ts
│   │   │   └── index.ts
│   │   ├── search/
│   │   │   ├── SearchService.ts      # FlexSearch wrapper
│   │   │   ├── IndexBuilder.ts       # Build search index
│   │   │   └── index.ts
│   │   └── audit/
│   │       ├── AuditService.ts       # Append-only logging
│   │       └── index.ts
│   │
│   ├── tools/                        # Unified tool layer
│   │   ├── ToolRegistry.ts           # Tool registration
│   │   ├── filesystem.ts             # File operations
│   │   ├── history.ts                # History operations
│   │   ├── search.ts                 # Search operations
│   │   ├── render.ts                 # Mermaid/chart rendering
│   │   ├── research.ts               # SourceCard operations
│   │   └── index.ts
│   │
│   ├── stores/                       # Zustand stores
│   │   ├── workspaceStore.ts         # Workspace state
│   │   ├── editorStore.ts            # Editor/tabs/panes state
│   │   ├── workflowStore.ts          # Workflow execution state
│   │   ├── settingsStore.ts          # User preferences
│   │   └── index.ts
│   │
│   ├── hooks/                        # React hooks
│   │   ├── useWorkspace.ts
│   │   ├── useEditor.ts
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useAuditLog.ts
│   │   └── index.ts
│   │
│   ├── types/                        # TypeScript interfaces
│   │   ├── workspace.ts
│   │   ├── editor.ts
│   │   ├── workflow.ts
│   │   ├── research.ts
│   │   ├── analysis.ts
│   │   └── index.ts
│   │
│   ├── utils/                        # Shared utilities
│   │   ├── paths.ts                  # Path manipulation
│   │   ├── dates.ts                  # Date formatting
│   │   ├── validation.ts             # Schema validation
│   │   └── index.ts
│   │
│   ├── lib/                          # Third-party wrappers
│   │   ├── sqlite.ts                 # sql.js wrapper
│   │   └── mermaid.ts                # Mermaid wrapper
│   │
│   └── styles/
│       └── globals.css               # Tailwind imports
│
├── src-tauri/                        # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs                   # Tauri entry point
│   │   ├── commands/                 # Tauri commands
│   │   │   ├── fs.rs                 # Filesystem commands
│   │   │   └── keychain.rs           # Keychain commands
│   │   └── lib.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/                        # Application icons
│
├── tests/                            # Test files
│   ├── unit/
│   │   ├── workspace.test.ts
│   │   ├── history.test.ts
│   │   ├── search.test.ts
│   │   └── validation.test.ts
│   ├── integration/
│   │   ├── workflow.test.ts
│   │   ├── research.test.ts
│   │   └── analysis.test.ts
│   ├── security/
│   │   ├── pathTraversal.test.ts
│   │   ├── symlinkEscape.test.ts
│   │   └── promptInjection.test.ts
│   └── e2e/
│       ├── onboarding.test.ts
│       └── kickoffWorkflow.test.ts
│
├── docs/                             # Documentation
│   ├── VISION.md
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── DEFINITION_OF_DONE.md
│   └── BACKLOG.md
│
├── public/                           # Static assets
│   └── favicon.ico
│
├── .github/                          # GitHub configuration
│   └── workflows/
│       └── ci.yml
│
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
└── README.md
```

---

## Structured Schemas (Reference)

```typescript
// types/analysis.ts
interface DocSummary {
  doc_id: string;
  thesis: string;
  bullets: string[];
  assumptions: string[];
  risks: string[];
  open_questions: string[];
  actions: string[];
  confidence: number; // 0-1
  citations: string[]; // SourceCard IDs
}

// types/research.ts
interface SourceCard {
  id: string;
  url: string;
  title: string;
  date_accessed: string; // ISO date
  quote_or_snippet: string;
  claim_supported: string;
  reliability_notes: string;
}

// types/workflow.ts
interface RunRecord {
  run_id: string;
  workflow: string;
  model: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tool_calls: ToolCall[];
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: string;
}
```

---

*This implementation plan should be executed phase by phase, with each phase tested and validated before proceeding to the next. The "New Business Kickoff" workflow in Phase 3 is the MVP milestone—once that works end-to-end, the core value proposition is proven.*
