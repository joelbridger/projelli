# Projelli - Claude Code Project Context

## Quick Reference

| Item | Value |
|------|-------|
| **Start Command** | `npm run dev` (browser) or `npm run tauri dev` (desktop) |
| **Build Command** | `npm run build` or `npm run tauri build` |
| **Test Command** | `npm run test` |
| **Port** | 5173 (Vite default) |
| **TypeScript** | Strict mode enabled |
| **Target Platform** | Browser (prototype) → Windows desktop (Tauri) |

---

## Project Overview

**Projelli** is a local-first, artifact-driven workspace application for solo founders building businesses with AI assistance. **Projelli provides an integrated AI chat interface that produces and manages persistent business documents** (Vision, PRD, Lean Canvas, competitor matrices, pricing hypotheses) while keeping the human founder in control of all decisions.

**Core Thesis:** This is an **artifact-driven workspace WITH integrated AI chat**. Every chat interaction produces or modifies persistent documents. AI proposes, user approves all destructive actions. Unlike standalone chat tools where conversations are the end product, Projelli ensures all interactions create tangible artifacts.

**Key Principles:**
- **Local-first**: Everything works offline (except optional web research)
- **Artifact-driven with AI chat**: Every chat interaction produces persistent, versioned documents
- **User-in-control**: AI proposes, user decides; all destructive ops require confirmation
- **Reproducible**: Every workflow run is replayable (inputs, prompts, tool results saved)
- **Auditable**: Append-only log of all AI actions

---

## Architecture

### Layered System Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│         React + TypeScript + Zustand + shadcn/ui + Tailwind CSS             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CORE MODULES                                      │
│  Workspace │ Editor │ History │ Workflow │ Models │ Research │ Analysis     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TOOL LAYER                                        │
│     filesystem │ history │ search │ render │ research                        │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────────┐
│     FILESYSTEM BACKEND        │   │         SQLITE DATABASE               │
│   Web FS API │ Tauri FS       │   │  RunRecords │ SourceCards │ AuditLog  │
└───────────────────────────────┘   └───────────────────────────────────────┘
```

### Technology Stack (MANDATORY - DO NOT DEVIATE)

| Layer | Technology | Notes |
|-------|------------|-------|
| **Frontend** | React 18 + TypeScript 5 + Vite 5 | Strict mode enabled |
| **State** | Zustand | No providers needed, works outside React |
| **UI Components** | shadcn/ui + Radix + Tailwind CSS 3 | Accessible, customizable |
| **Editor** | CodeMirror 6 | Obsidian-proven, extensible |
| **Desktop** | Tauri 2 | Small binary, native security model |
| **Database** | SQLite (sql.js for browser, native for Tauri) | RunRecords, indexes, audit log |
| **Search** | FlexSearch | Extensible to embeddings later |
| **Diagrams** | Mermaid | Markdown-embeddable |
| **API Key Storage** | OS Keychain (Tauri) → Encrypted file fallback |
| **Testing** | Vitest + React Testing Library | Vite-native |

---

## Key Files

### Core Modules

| File | Purpose |
|------|---------|
| `src/modules/workspace/WorkspaceService.ts` | File CRUD, path validation, security |
| `src/modules/workspace/WebFSBackend.ts` | Browser File System Access API |
| `src/modules/workspace/TauriFSBackend.ts` | Tauri filesystem backend |
| `src/modules/workspace/PathValidator.ts` | Path traversal blocking |
| `src/modules/editor/EditorService.ts` | CodeMirror integration |
| `src/modules/editor/WikiLinkParser.ts` | `[[link]]` syntax parsing |
| `src/modules/history/HistoryService.ts` | Undo/redo command stack |
| `src/modules/history/TrashService.ts` | Soft delete management |
| `src/modules/workflow/WorkflowEngine.ts` | Workflow execution |
| `src/modules/workflow/RunRecordService.ts` | Run persistence |
| `src/modules/models/Provider.ts` | Model adapter interface |
| `src/modules/models/ClaudeProvider.ts` | Anthropic API adapter |
| `src/modules/models/OpenAIProvider.ts` | OpenAI API adapter |
| `src/modules/audit/AuditService.ts` | Append-only action log |
| `src/modules/research/SourceCardService.ts` | Citation management |
| `src/modules/analysis/DocSummaryService.ts` | Document summarization |

### UI Components

| File | Purpose |
|------|---------|
| `src/components/workspace/FileTree.tsx` | Folder/file navigation |
| `src/components/editor/MarkdownEditor.tsx` | CodeMirror wrapper |
| `src/components/editor/TabBar.tsx` | Multiple file tabs |
| `src/components/editor/SplitPane.tsx` | Side-by-side editing |
| `src/components/editor/DiffViewer.tsx` | Change preview |
| `src/components/workflow/WorkflowPanel.tsx` | Workflow launcher |
| `src/components/workflow/InterviewForm.tsx` | Q&A collection |

### Zustand Stores

| File | Purpose |
|------|---------|
| `src/stores/workspaceStore.ts` | File tree, workspace root |
| `src/stores/editorStore.ts` | Open tabs, pane layout |
| `src/stores/workflowStore.ts` | Running workflows, history |
| `src/stores/settingsStore.ts` | User preferences |

### Type Definitions

| File | Purpose |
|------|---------|
| `src/types/workspace.ts` | FileNode, Workspace types |
| `src/types/workflow.ts` | WorkflowTemplate, RunRecord, ToolCall |
| `src/types/research.ts` | SourceCard |
| `src/types/analysis.ts` | DocSummary |

---

## Development Guidelines

### Code Style

- **TypeScript strict mode** - All code must pass strict type checking
- **React functional components** - No class components
- **shadcn/ui patterns** - Use existing components, don't reinvent
- **Zustand for state** - Keep stores focused, use selectors
- **Path aliases** - Use `@/` prefix for imports (e.g., `@/modules/workspace`)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | `PascalCase.tsx` for components, `camelCase.ts` for utilities | `FileTree.tsx`, `pathUtils.ts` |
| Components | `PascalCase` | `WorkflowPanel` |
| Functions | `camelCase` | `validatePath()` |
| Types/Interfaces | `PascalCase` | `RunRecord`, `SourceCard` |
| Zustand stores | `use*Store` | `useWorkspaceStore` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_UNDO_STACK_SIZE` |

### Important Patterns

**Command Pattern for File Operations:**
```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
}
// All file writes go through commands for undo support
```

**Provider Interface for Models:**
```typescript
interface Provider {
  sendMessage(prompt: string, options?: SendOptions): Promise<string>;
  toolCall(tool: string, params: unknown): Promise<unknown>;
  structuredOutput<T>(prompt: string, schema: Schema): Promise<T>;
  getMetadata(): { model: string; costEstimate: number; latencyEstimate: number };
}
```

**FSBackend Abstraction:**
```typescript
interface FSBackend {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(path: string): Promise<FileNode[]>;
}
// Implemented by WebFSBackend and TauriFSBackend
```

### Autosave Behavior

**All file changes are automatically saved** - no manual save required.

**How it works:**
- **Interval**: Every 2 seconds (App.tsx lines 1875-1890)
- **Trigger**: Changes to file content mark tabs as `isDirty: true`
- **Persistence**: Autosave interval writes dirty tabs to disk via WorkspaceService
- **Visual Indicator**: "Auto-save" label with Save icon in MainPanel status bar (MainPanel.tsx lines 554-558)
- **Version History**: Versionable files (.md, .txt, .json, .source) automatically save versions on content change

**User Experience:**
- Type in any editor → content auto-saves within 2 seconds
- No Ctrl+S required (though keyboard shortcut still works for manual save)
- Tab shows dot indicator when dirty, clears after autosave completes
- All changes persist across app reloads

**Technical Implementation:**
```typescript
// App.tsx - Autosave interval
useEffect(() => {
  const autosaveInterval = setInterval(async () => {
    for (const tab of openTabs) {
      if (tab.isDirty) {
        await workspaceServiceRef.current.writeFile(tab.path, tab.content);
        markSaved(tab.path);
      }
    }
  }, 2000);
  return () => clearInterval(autosaveInterval);
}, [openTabs]);
```

**Note:** This is a deliberate design choice for a local-first application. Users never lose work due to crashes or accidental closes. All file operations go through the same WorkspaceService abstraction, ensuring consistency across browser and Tauri environments.

### Anti-Patterns to Avoid

- **NO direct file system access** - Always go through WorkspaceService
- **NO storing API keys in plaintext** - Use KeychainService
- **NO autonomous AI operations** - User must approve all changes
- **NO cloud sync or collaboration features** - Local-only
- **NO chat-only patterns without artifacts** - Every chat interaction must produce/modify persistent documents
- **NO path concatenation without validation** - Use PathValidator

### Security Requirements

1. **Path Validation** - Block `../` traversal, deny symlinks escaping workspace
2. **API Key Security** - OS keychain primary, never log keys
3. **Audit Logging** - All AI actions logged (append-only)
4. **Destructive Ops** - Require confirmation with diff preview
5. **Prompt Injection** - Sanitize external content before including in prompts

---

## Testing Requirements

### Unit Tests Required For:
- Workspace operations (CRUD for folders/files)
- Path validation (traversal blocking)
- History/undo operations
- Schema validation (DocSummary, SourceCard, RunRecord)
- Search indexing and querying

### Integration Tests Required For:
- Full workspace flow (create, edit, undo, delete, restore)
- "New Business Kickoff" workflow with mock models
- Research flow (create SourceCard, cite in doc)

### Security Tests Required For:
- Path traversal attempts (`../../../etc/passwd`)
- Symlink escape attempts
- Prompt injection scenarios

### Running Tests:
```bash
npm run test              # Run all tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests
npm run test:security     # Security tests
```

---

## Changelog Updates

**After EVERY implemented change, update CHANGELOG.md:**

1. Add changes under `## [Unreleased]`
2. Use categories: `### Added`, `### Changed`, `### Fixed`, `### Removed`
3. Include file names and specific details
4. Keep entries concise but informative

```markdown
### Added
- **Feature Name** - Brief description
  - Implementation detail
  - Files modified: `WorkspaceService.ts`, `FileTree.tsx`
```

---

## Directory Structure

```
projelli/
├── src/
│   ├── main.tsx                    # Entry point
│   ├── App.tsx                     # Root component
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives
│   │   ├── layout/                 # Sidebar, MainPanel, StatusBar
│   │   ├── workspace/              # FileTree, WorkspaceSelector
│   │   ├── editor/                 # MarkdownEditor, TabBar, SplitPane, DiffViewer
│   │   ├── workflow/               # WorkflowPanel, InterviewForm
│   │   ├── research/               # SourceCardPanel, CompetitorMatrix
│   │   ├── analysis/               # ComparisonView, SynthesisPanel
│   │   ├── settings/               # ApiKeySettings
│   │   └── common/                 # CommandPalette, AuditLog, TrashPanel
│   ├── modules/
│   │   ├── workspace/              # WorkspaceService, FSBackends, PathValidator
│   │   ├── editor/                 # EditorService, WikiLinkParser, BacklinkIndex
│   │   ├── history/                # HistoryService, CommandStack, TrashService
│   │   ├── workflow/               # WorkflowEngine, RunRecordService, templates/
│   │   ├── models/                 # Provider, ClaudeProvider, OpenAIProvider, KeychainService
│   │   ├── research/               # SourceCardService, CitationParser
│   │   ├── analysis/               # DocSummaryService, ContradictionDetector
│   │   ├── search/                 # SearchService, IndexBuilder
│   │   └── audit/                  # AuditService
│   ├── tools/                      # Unified tool layer for models
│   ├── stores/                     # Zustand stores
│   ├── hooks/                      # React hooks
│   ├── types/                      # TypeScript interfaces
│   ├── utils/                      # Shared utilities
│   ├── lib/                        # Third-party wrappers (sqlite.ts, mermaid.ts)
│   └── styles/                     # globals.css
├── src-tauri/                      # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/               # fs.rs, keychain.rs
│   │   └── lib.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── docs/
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

---

## Current Phase

**v0.1.0 - Operational**

The application is functional with core features implemented:
- Browser-based prototype working (File System Access API)
- File tree, tabs, markdown editor, split panes
- Workflow system, version history, trash management
- Audio recording/playback, whiteboard, search
- Test mode for automated testing
- AI chat integration

Project documentation is now organized in `docs/`:
- `docs/ARCHITECTURE.md` - System design
- `docs/VISION.md` - Product vision
- `docs/PRD.md` - Product requirements
- `docs/DECISIONS.md` - Architecture decisions
- `docs/DEFINITION_OF_DONE.md` - Quality standards
- `docs/BACKLOG.md` - Future improvements
- `docs/SECURITY.md` - Security guidelines

**Next Focus:** Desktop transition (Tauri), performance optimization, code organization

---

## Commands

```bash
# Development
npm run dev                 # Start Vite dev server (browser)
npm run tauri dev           # Start Tauri desktop app

# Build
npm run build               # Build for production (browser)
npm run tauri build         # Build desktop installer

# Code Quality
npm run lint                # Run ESLint
npm run format              # Run Prettier
npm run typecheck           # TypeScript type check

# Testing
npm run test                # Run Vitest
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage

# Syntax Check (before commit)
npx tsc --noEmit
```

---

## Structured Schemas (Reference)

```typescript
// src/types/workflow.ts
interface RunRecord {
  run_id: string;
  workflow: string;
  model: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  tool_calls: ToolCall[];
  start_time: string;  // ISO datetime
  end_time: string;    // ISO datetime
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// src/types/research.ts
interface SourceCard {
  id: string;
  url: string;
  title: string;
  date_accessed: string;  // ISO date
  quote_or_snippet: string;
  claim_supported: string;
  reliability_notes: string;
}

// src/types/analysis.ts
interface DocSummary {
  doc_id: string;
  thesis: string;
  bullets: string[];
  assumptions: string[];
  risks: string[];
  open_questions: string[];
  actions: string[];
  confidence: number;  // 0-1
  citations: string[];  // SourceCard IDs
}
```

---

## Troubleshooting

### "Module not found" errors
- Check path aliases in `tsconfig.json` and `vite.config.ts`
- Ensure module has `index.ts` barrel export

### Tauri window doesn't open
- Ensure Vite dev server is running on correct port
- Check `tauri.conf.json` devUrl matches Vite port

### TypeScript errors after changes
- Run `npx tsc --noEmit` to see all errors
- Check that strict mode rules are followed

### SQLite errors in browser
- sql.js WASM must be loaded before use
- Check async initialization in `src/lib/sqlite.ts`

### File operations fail silently
- Check browser DevTools console for permission errors
- Verify workspace root is set correctly

---

## Out of Scope (DO NOT IMPLEMENT)

- Cloud sync
- Real-time collaboration
- Payments/monetization
- Mobile support
- Autonomous agents (multi-step without approval)
- Web scraping/crawling
- Voice/audio input
- Plugin/extension system

---

*When in doubt, choose the path that keeps the founder in control and produces auditable, persistent artifacts.*
