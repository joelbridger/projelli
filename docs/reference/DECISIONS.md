# Business OS - Architecture Decision Record

This document tracks key architectural and technical decisions made during the development of Business OS. Each decision includes context, the decision itself, consequences, and status.

---

## ADR-001: Technology Stack Selection

**Status:** Accepted
**Date:** 2026-01-24

### Context
Business OS requires a technology stack that supports:
- Local-first architecture with offline capability
- Cross-platform desktop deployment (Windows primary, macOS/Linux secondary)
- Fast iteration during browser-based development
- Type-safe, maintainable codebase
- Accessible, customizable UI components

### Decision
We will use the following stack:

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Frontend** | React 18 + TypeScript 5 | Type safety, large ecosystem, Tauri compatibility |
| **Build Tool** | Vite 5 | Fast HMR, native ESM, works with browser and Tauri |
| **State Management** | Zustand | Minimal boilerplate, TypeScript-native, no providers |
| **UI Components** | shadcn/ui + Radix | Accessible, customizable, Tailwind-native |
| **Styling** | Tailwind CSS 3 | Utility-first, consistent design tokens, small bundle |
| **Desktop** | Tauri 2 | Small binary, native security model, Rust backend |
| **Testing** | Vitest + React Testing Library | Vite-native, fast, excellent TS support |

### Consequences
- **Positive**: Fast development cycle, type safety throughout, small desktop bundle
- **Negative**: Team must learn Tauri/Rust for native commands, Zustand patterns differ from Redux
- **Mitigation**: Extensive documentation, clear patterns in CLAUDE.md

---

## ADR-002: Markdown Editor Selection

**Status:** Accepted
**Date:** 2026-01-24

### Context
The editor is the primary interface for Business OS. Requirements:
- Excellent Markdown support with syntax highlighting
- Extensible for wiki-links, backlinks, custom decorations
- Performant with large documents
- Good TypeScript support

### Options Considered
1. **Monaco Editor** - VS Code's editor, powerful but heavy
2. **ProseMirror** - Flexible but complex schema system
3. **CodeMirror 6** - Modern, extensible, Obsidian-proven
4. **Tiptap** - ProseMirror-based, simpler API

### Decision
We will use **CodeMirror 6**.

### Rationale
- Proven at scale by Obsidian
- Excellent extension system for wiki-links and custom syntax
- Modern architecture with good TypeScript support
- Reasonable bundle size with tree-shaking
- Active development and community

### Consequences
- **Positive**: Battle-tested, extensible, performant
- **Negative**: Learning curve for extension development
- **Mitigation**: Start with basic setup, add extensions incrementally

---

## ADR-003: Data Persistence Strategy (Hybrid)

**Status:** Accepted
**Date:** 2026-01-24

### Context
Business OS needs to persist:
- User documents (Markdown files)
- Application metadata (run records, source cards, audit log)
- Search indexes
- User settings

### Options Considered
1. **Files only** - All data in Markdown/JSON files
2. **Database only** - All data in SQLite
3. **Hybrid** - Documents in files, metadata in SQLite

### Decision
We will use a **hybrid approach**:
- **Markdown files**: User documents (source of truth, git-friendly)
- **JSON files**: SourceCards, structured research data
- **SQLite**: RunRecords, audit log, search indexes, cross-references

### Rationale
- Human-readable source files enable git versioning and portability
- SQLite provides fast querying for metadata and relationships
- Clear separation: content vs. metadata

### Consequences
- **Positive**: Best of both worlds - human-readable docs + fast queries
- **Negative**: Sync complexity between files and database
- **Mitigation**: Database as index/cache, files always authoritative

---

## ADR-004: Search Architecture

**Status:** Accepted
**Date:** 2026-01-24

### Context
Full-text search across workspace documents is essential. Future requirement: semantic/embedding-based search.

### Decision
We will use **FlexSearch** for full-text search with an abstraction layer that supports future embedding integration.

### Rationale
- FlexSearch is fast, client-side, supports fielded search
- Abstraction layer (`SearchService`) allows swapping implementations
- Future embeddings can be added without changing search API

### Interface Design
```typescript
interface SearchService {
  index(doc: SearchableDocument): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  remove(docId: string): Promise<void>;
  reindex(): Promise<void>;
}
```

### Consequences
- **Positive**: Fast local search, future-proof architecture
- **Negative**: No semantic search initially
- **Mitigation**: Design interface to support embedding search later

---

## ADR-005: Diagram Rendering

**Status:** Accepted
**Date:** 2026-01-24

### Context
Business documents often benefit from diagrams (flowcharts, architecture diagrams, matrices).

### Options Considered
1. **Mermaid** - Markdown-embeddable, text-based
2. **D2** - More modern, better layouts
3. **Excalidraw** - Freeform drawing, collaborative
4. **Chart.js** - Data-driven charts

### Decision
We will use **Mermaid** as the primary diagram solution.

### Rationale
- Embeds directly in Markdown (single source of truth)
- No external dependencies for rendering
- Supports flowcharts, sequence diagrams, ERDs, Gantt charts
- Text-based diagrams are diffable and version-controllable

### Future Considerations
- Design render abstraction to support D2 or Excalidraw later
- Provide export to SVG/PNG for external use

---

## ADR-006: API Key Storage

**Status:** Accepted
**Date:** 2026-01-24

### Context
Business OS uses external AI APIs (Claude, OpenAI, Gemini) requiring secure API key storage.

### Decision
Implement a **tiered key storage strategy**:

1. **Primary**: OS keychain (via Tauri plugin) - most secure
2. **Fallback**: Encrypted local file - when keychain unavailable
3. **Dev-only**: Environment variables - for development convenience
4. **Emergency**: Prompt on startup - no persistence, single session

### Rationale
- OS keychain is the industry standard for credential storage
- Fallbacks ensure the app works in various environments
- Never store keys in plaintext or application preferences

### Implementation
```typescript
interface KeychainService {
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

---

## ADR-007: Hybrid Confirmation Model

**Status:** Accepted
**Date:** 2026-01-24

### Context
AI-assisted operations can be destructive. Need to balance safety with usability.

### Decision
Implement **hybrid confirmation**:

| Operation Type | Confirmation Required |
|---------------|----------------------|
| Read file | Auto-approve |
| Search/index | Auto-approve |
| Create new file | Auto-approve |
| Write to existing file | Show diff preview, require confirm |
| Delete file | Require confirm with preview |
| Move/rename | Require confirm with file list |
| Bulk operations | Always require confirm |

### Rationale
- Non-destructive operations should be fast
- Destructive operations need human review
- Diff preview enables informed decisions
- Consistent UX for AI and manual operations

### Implementation
All operations go through `ConfirmationService` which applies these rules.

---

## ADR-008: Audit Log Architecture

**Status:** Accepted
**Date:** 2026-01-24

### Context
All AI actions must be auditable for transparency and debugging.

### Decision
Implement an **append-only audit log** in SQLite.

### Schema
```typescript
interface AuditEntry {
  id: string;
  timestamp: string;          // ISO datetime
  action_type: string;        // 'generate', 'edit', 'delete', etc.
  model: string | null;       // AI model used, if any
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  user_decision: 'approved' | 'rejected' | 'modified' | null;
  duration_ms: number;
}
```

### Constraints
- Entries are **never deleted** (append-only)
- Log survives application crashes (write-ahead logging)
- Queryable by date range, action type, model

### Consequences
- **Positive**: Full transparency, debugging capability, compliance
- **Negative**: Storage grows over time
- **Mitigation**: Implement optional archival/export for old entries

---

## ADR-009: Filesystem Backend Abstraction

**Status:** Accepted
**Date:** 2026-01-24

### Context
Business OS runs in two environments:
1. Browser (development) - uses File System Access API
2. Desktop (Tauri) - uses native filesystem via Rust

### Decision
Create an **FSBackend abstraction** with two implementations:

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

### Implementations
- `WebFSBackend` - File System Access API for browser
- `TauriFSBackend` - Tauri fs plugin for desktop

### Consequences
- **Positive**: Same code works in browser and desktop
- **Negative**: Must maintain two implementations
- **Mitigation**: Thorough testing, shared test suite

---

## ADR-010: Workspace Security Model

**Status:** Accepted
**Date:** 2026-01-24

### Context
File system access must be restricted to prevent security vulnerabilities.

### Decision
Implement strict **workspace root enforcement**:

1. **Allowlist**: Only the selected workspace root is accessible
2. **Path Validation**: Block all path traversal attempts (`../`)
3. **Symlink Policy**: Deny symlinks that escape workspace root
4. **Tauri Scope**: Configure fs plugin scope to workspace only

### Implementation
```typescript
class PathValidator {
  constructor(private workspaceRoot: string) {}

  validate(path: string): boolean {
    const resolved = path.resolve(this.workspaceRoot, path);
    return resolved.startsWith(this.workspaceRoot);
  }
}
```

### Testing
- Unit tests for path traversal attempts
- Security tests for symlink escapes
- Integration tests for Tauri scope enforcement

---

## Decision Log

| ID | Decision | Status | Date |
|----|----------|--------|------|
| ADR-001 | Technology Stack | Accepted | 2026-01-24 |
| ADR-002 | CodeMirror 6 Editor | Accepted | 2026-01-24 |
| ADR-003 | Hybrid Data Persistence | Accepted | 2026-01-24 |
| ADR-004 | FlexSearch + Abstraction | Accepted | 2026-01-24 |
| ADR-005 | Mermaid Diagrams | Accepted | 2026-01-24 |
| ADR-006 | Tiered API Key Storage | Accepted | 2026-01-24 |
| ADR-007 | Hybrid Confirmation Model | Accepted | 2026-01-24 |
| ADR-008 | Append-Only Audit Log | Accepted | 2026-01-24 |
| ADR-009 | FSBackend Abstraction | Accepted | 2026-01-24 |
| ADR-010 | Workspace Security Model | Accepted | 2026-01-24 |

---

*This document should be updated when significant architectural decisions are made or revisited.*
