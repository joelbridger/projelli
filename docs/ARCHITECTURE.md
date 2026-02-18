# Business OS - Architecture Document

## System Overview

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
```

---

## Modules

### 1. UI Layer (React Components)

**Location**: `src/components/`

**Responsibilities**:
- Render user interface using React functional components
- Handle user interactions and route to appropriate modules
- Manage local component state
- Use shadcn/ui primitives for consistent, accessible UI

**Key Components**:
- `layout/` - Sidebar, MainPanel, StatusBar
- `workspace/` - FileTree, WorkspaceSelector
- `editor/` - MarkdownEditor, TabBar, SplitPane, DiffViewer
- `workflow/` - WorkflowPanel, InterviewForm
- `research/` - SourceCardPanel, CompetitorMatrix
- `analysis/` - ComparisonView, SynthesisPanel
- `settings/` - ApiKeySettings
- `common/` - CommandPalette, AuditLog, TrashPanel

### 2. Workspace Module

**Location**: `src/modules/workspace/`

**Responsibilities**:
- File tree CRUD operations
- Workspace root management
- Path validation and security
- Abstraction over filesystem backends

**Key Files**:
- `WorkspaceService.ts` - Main workspace operations
- `WebFSBackend.ts` - Browser File System Access API implementation
- `TauriFSBackend.ts` - Tauri filesystem backend implementation
- `PathValidator.ts` - Security: path traversal blocking

### 3. Editor Module

**Location**: `src/modules/editor/`

**Responsibilities**:
- CodeMirror 6 integration
- Tab and pane management
- Outline navigation
- Wiki-link parsing and backlink indexing

**Key Files**:
- `EditorService.ts` - Editor state management
- `WikiLinkParser.ts` - `[[link]]` syntax parsing
- `BacklinkIndex.ts` - Backlink tracking across documents

### 4. History Module

**Location**: `src/modules/history/`

**Responsibilities**:
- Undo/redo stack using command pattern
- Soft delete with trash folder
- Version tracking

**Key Files**:
- `HistoryService.ts` - Undo/redo management
- `CommandStack.ts` - Command pattern implementation
- `TrashService.ts` - Soft delete management

### 5. Workflow Engine

**Location**: `src/modules/workflow/`

**Responsibilities**:
- Define and execute AI-powered workflows
- Store and retrieve RunRecords
- Support re-run with diff detection

**Key Files**:
- `WorkflowEngine.ts` - Workflow execution
- `RunRecordService.ts` - Run record storage and retrieval
- `templates/` - Workflow template definitions

### 6. Model Adapters

**Location**: `src/modules/models/`

**Responsibilities**:
- Unified Provider interface for all AI models
- Individual adapters for Claude, OpenAI, Gemini
- API key management and secure storage
- Cost and latency tracking

**Key Files**:
- `Provider.ts` - Provider interface definition
- `MockProvider.ts` - Testing provider
- `ClaudeProvider.ts` - Anthropic API adapter
- `OpenAIProvider.ts` - OpenAI API adapter
- `KeychainService.ts` - API key storage

### 7. Tool Layer

**Location**: `src/tools/`

**Responsibilities**:
- Unified interface for all operations AI models can invoke
- Abstraction layer between models and system capabilities

**Tool Categories**:
- `filesystem` - read, write, create, delete, move, rename, list
- `history` - undo, redo, restore, getVersions
- `search` - fullText, byTag, byType, byDate
- `render` - mermaidToSvg, chartToImage
- `research` - saveSourceCard, extractFromUrl

### 8. Search Module

**Location**: `src/modules/search/`

**Responsibilities**:
- Full-text search using FlexSearch
- Fielded document indexing (title, body, tags)
- Extensible interface for future embedding search

**Key Files**:
- `SearchService.ts` - FlexSearch wrapper
- `IndexBuilder.ts` - Index construction and updates

### 9. Audit Module

**Location**: `src/modules/audit/`

**Responsibilities**:
- Append-only logging of all AI actions
- Query interface for audit entries
- Export functionality

**Key Files**:
- `AuditService.ts` - Audit log management

### 10. Research Module

**Location**: `src/modules/research/`

**Responsibilities**:
- SourceCard CRUD operations
- Citation parsing and linking
- Competitor matrix generation

**Key Files**:
- `SourceCardService.ts` - SourceCard management
- `CitationParser.ts` - Parse citations in Markdown

### 11. Analysis Module

**Location**: `src/modules/analysis/`

**Responsibilities**:
- DocSummary generation
- Multi-model comparison
- Contradiction detection
- Synthesis generation

**Key Files**:
- `DocSummaryService.ts` - Summary generation
- `ContradictionDetector.ts` - Find contradictions between outputs
- `SynthesisGenerator.ts` - Generate reconciled synthesis

---

## Data Model

### Core Types

```typescript
// Workspace Types
interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  extension?: string;
  size?: number;
  modifiedAt?: Date;
}

interface Workspace {
  rootPath: string;
  name: string;
  createdAt: Date;
  lastOpenedAt: Date;
}
```

### Workflow Types

```typescript
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

interface ToolCall {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  duration: number;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  inputs: Record<string, unknown>;
  outputs: string[];
}
```

### Research Types

```typescript
interface SourceCard {
  id: string;
  url: string;
  title: string;
  date_accessed: string;  // ISO date
  quote_or_snippet: string;
  claim_supported: string;
  reliability_notes: string;
}
```

### Analysis Types

```typescript
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

## Security Model

### 1. Workspace Root Enforcement

- Only the selected workspace root is accessible
- All paths validated against workspace root before operations
- Path traversal (`../`) patterns are blocked
- Symlinks escaping workspace root are denied

```typescript
class PathValidator {
  constructor(private workspaceRoot: string) {}

  validate(path: string): boolean {
    const resolved = path.resolve(this.workspaceRoot, path);
    return resolved.startsWith(this.workspaceRoot);
  }
}
```

### 2. Hybrid Confirmation Model

| Operation Type | Confirmation Required |
|---------------|----------------------|
| Read file | Auto-approve |
| Search/index | Auto-approve |
| Create new file | Auto-approve |
| Write to existing file | Show diff preview, require confirm |
| Delete file | Require confirm with preview |
| Move/rename | Require confirm with file list |
| Bulk operations | Always require confirm |

### 3. API Key Security

**Storage Hierarchy**:
1. **Primary**: OS keychain (via Tauri plugin)
2. **Fallback**: Encrypted local file
3. **Dev-only**: Environment variables
4. **Emergency**: Prompt on startup (no persistence)

**Rules**:
- Never store keys in plaintext
- Never log keys
- Audit all key access

### 4. Audit Log

- Append-only (entries never deleted)
- Records: action type, timestamp, model, inputs, outputs, user decision
- Write-ahead logging for crash recovery
- Queryable by date range, action type, model

### 5. Prompt Injection Defense

- Sanitize external content before including in prompts
- Validate structured outputs against schemas
- Isolate tool execution from untrusted content

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | React 18 + TypeScript 5 | Type safety, component reusability, Tauri compatibility |
| **Build Tool** | Vite 5 | Fast HMR, native ESM, works with browser and Tauri |
| **State Management** | Zustand | Minimal boilerplate, TypeScript-native, no providers |
| **UI Components** | shadcn/ui + Radix | Accessible, customizable, Tailwind-native |
| **Styling** | Tailwind CSS 3 | Utility-first, consistent design tokens, small bundle |
| **Markdown Editor** | CodeMirror 6 | Extensible, performant, Obsidian-proven |
| **Desktop** | Tauri 2 | Small binary, native security model, Rust backend |
| **Database** | SQLite (sql.js/native) | Single-file, serverless, local-first |
| **Search** | FlexSearch | Fast client-side, fielded search, embedding-ready |
| **Diagrams** | Mermaid | Markdown-embeddable, text-based, diffable |
| **Testing** | Vitest + React Testing Library | Vite-native, fast, excellent TS support |

---

## Filesystem Layout

```
workspace-root/
├── .business-os/           # App metadata, SQLite DB, settings
│   ├── database.sqlite     # RunRecords, audit log, indexes
│   └── settings.json       # User preferences
├── docs/                   # User Markdown files (source of truth)
│   ├── VISION.md
│   ├── PRD.md
│   └── ...
├── research/               # SourceCards as JSON, organized by topic
│   ├── competitors/
│   └── market/
└── .trash/                 # Soft-deleted files for recovery
```

---

## Key Interfaces

### FSBackend Interface

```typescript
interface FSBackend {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(path: string): Promise<FileNode[]>;
  exists(path: string): Promise<boolean>;
}
```

### Provider Interface

```typescript
interface Provider {
  sendMessage(prompt: string, options?: SendOptions): Promise<string>;
  toolCall(tool: string, params: unknown): Promise<unknown>;
  structuredOutput<T>(prompt: string, schema: Schema): Promise<T>;
  getMetadata(): { model: string; costEstimate: number; latencyEstimate: number };
}
```

### Command Interface (for Undo/Redo)

```typescript
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
}
```

---

## Module Dependencies

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

*This architecture document should be updated as the system evolves. All implementation decisions should align with the patterns and interfaces defined here.*
