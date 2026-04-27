# Projelli — Claude Code Project Context

> **Read this first if you're a future Claude session working in this repo.**
>
> **Operating contract:** Read `~/projelli/PROJELLI_BUSINESS_PLAN.md` BEFORE doing anything substantive. It's the strategic plan, the 8-week launch roadmap, and the record of every CEO-level decision made on Jameson's behalf. Don't override its decisions without explicit board input.
>
> **Current state:** Read `~/projelli/BACKLOG.md` for the live week-by-week task list, what's done, what's in flight, and what's blocked.
>
> **If you're working on marketing:** Read `~/projelli/docs/marketing/README.md` first. It's the canonical entry point for all marketing work — explains the marketing/ folder structure (playbook/, channels/, action-packs/, campaigns/) and where new campaigns land. The playbook subfolder ties together email sequences, master playbook, and reply bank; channels/ has per-platform launch packages (PH, HN, IH, Reddit, newsletter, etc.). **Don't write any new marketing content without checking what's already there** — the channel playbooks have pre-staged FAQ replies and reply templates that should be reused, not duplicated. New marketing pushes get a folder under `docs/marketing/campaigns/YYYY-MM-<slug>/`.
>
> **User profile:** Jameson is **NOT a developer**. He's a Senior Product Designer at Wheel Health. Explain technical concepts in plain language. Don't assume he can read code. Don't dump stack traces on him — translate them. The persistent project memory file at `~/.claude/projects/-home-jameson/memory/project_projelli.md` has the full user/project context.
>
> **Voice rules for any user-facing copy:** Every marketing artifact in `docs/features/` and `website/blog/` was written under the rules in `~/.claude/projects/-home-jameson/memory/feedback_marketing_copy_voice.md` and `~/.claude/projects/-home-jameson/memory/reference_ai_writing_tells.md`. The short version: first-person singular always, contractions, specific concrete nouns over abstractions, no "leverage / delve / seamless / transform / empower / elevate / unlock", no italicized fragments at sentence ends, no "It's not X, it's Y" parallelism, uneven sentence length, occasional informal fragments. If in doubt, read the homepage at projelli.com (audited 2026-04-08) for the canonical voice reference.

## Where things live

| Item | Path | Notes |
|---|---|---|
| **Canonical source** | `/home/jameson/projelli/` | Server-resident, mirrors jameworld/behaviorux/portfolio pattern |
| **GitHub** | `github.com/projelli/projelli` | Org owned by joelbridger account; transferred from joelbridger/projelli on 2026-04-08 |
| **Live website** | `https://projelli.com` → `/var/www/projelli.com/index.html` | System Caddy on `:8080`, Cloudflare tunnel `d4e16129` |
| **Deploy script** | `~/projelli/infra/deploy.sh` | rsync website/ → /var/www/projelli.com + CF cache purge |
| **Business plan** | `~/projelli/PROJELLI_BUSINESS_PLAN.md` | Operating contract — every CEO decision lives here |
| **Backlog** | `~/projelli/BACKLOG.md` | Week-by-week tickets, includes marketing asset inventory section |
| **Board action items** | `~/projelli/docs/operations/BOARD_ACTION_ITEMS.md` | Engineering / financial / identity work that needs Jameson's hands (Azure signing, Apple Developer, LemonSqueezy, etc.) |
| **Marketing entry point** | `~/projelli/docs/marketing/README.md` | **Read first before any marketing work.** Explains the marketing/ folder structure (playbook, channels, action-packs, campaigns) and where new campaigns land. |
| **Marketing playbook** | `~/projelli/docs/marketing/playbook/MARKETING_PLAYBOOK.md` | Master index tying all marketing artifacts together + critical-path launch timeline. |
| **Marketing action pack** | `~/projelli/docs/marketing/action-packs/JAMESON_ACTION_PACK.md` | The 8 marketing tasks only Jameson can do (PH hunters, beta testers, screenshots, demo video, X posts, etc.) with pre-staged drafts. Complementary to BOARD_ACTION_ITEMS.md, not a duplicate. |
| **Competitive landscape** | `~/projelli/docs/reference/COMPETITIVE_LANDSCAPE.md` | Side-by-side vs Notion AI / Obsidian / ChatGPT / Reflect / Tana / etc. with reply paragraphs ready for PH/HN comments. |
| **Channel playbooks** | `~/projelli/docs/marketing/channels/{PRODUCT_HUNT_LAUNCH,SHOW_HN_LAUNCH,INDIE_HACKERS_LAUNCH,NEWSLETTER_OUTREACH,REDDIT_SIDEPROJECT_POST,DIRECTORY_SUBMISSIONS,PH_HUNTERS,BUILD_IN_PUBLIC_TWEETS}.md` | Per-channel launch playbooks with title variants, reply templates, anti-patterns. |
| **Email sequences** | `~/projelli/docs/marketing/playbook/EMAIL_SEQUENCES.md` | 10 plain-text emails covering signup → purchase → retention → refund → re-engagement. |
| **Press kit** | `~/projelli/website/press-kit/` | Live at projelli.com/press-kit/ — founder bio (3 lengths), fact sheet, brand colors, screenshot slots, demo video links. |
| **Blog** | `~/projelli/website/blog/` | Live at projelli.com/blog/ — multiple publishable posts (8-week launch story, why local-first, picking templates, Notion AI math, hidden tokenizer tax, chat persistence, v1.5 announce). |
| **Docs** | `~/projelli/docs/{reference,operations,features,marketing,quality,strategy,launch-v1.0,archive}/` | Reorganized 2026-04-22: `features/` = product release plans only; `marketing/` = ALL marketing work; `launch-v1.0/` = one-time v1.0 launch operational docs (renamed from `launch/`). |
| **Financial / legal** | `~/financial/` | Server-wide repository for tax, entity, banking, legal, insurance, retirement decisions. **Read first for any tax/legal/banking question.** Core timeline: `~/financial/08-recommendations/minimum-viable-launch.md` (milestone-gated launch framework reusable across projects). |
| **CI** | `~/projelli/.github/workflows/release.yml` | Tauri matrix build for Win/Mac/Linux on git tag |

## Quick Reference (development)

| Item | Value |
|------|-------|
| **Start Command** | `npm run dev` (browser) or `npm run tauri:dev` (desktop) |
| **Build Command** | `npm run build` or `npm run tauri:build` |
| **Test Command** | `npm run test` |
| **Port** | 5173 (Vite default) |
| **TypeScript** | Strict mode enabled |
| **Target Platforms** | Windows (live v1.0.0), macOS (Week 3), Linux (post-launch) |

---

## What Projelli is

**Projelli** is a local-first AI workspace for indie founders. Every AI chat conversation produces real Markdown files in a real folder on the user's hard drive. The product combines a CodeMirror 6 editor (with wiki-links, backlinks, version history, split panes) with an AI chat interface (Claude/OpenAI/Gemini, BYOK, streaming) and 12+ founder-focused workflow templates.

**The pitch in one sentence:** *Obsidian for the AI era, built for founders, sold once.*

**The differentiator:** local-first + BYOK + chat-as-artifacts. Your data stays on your machine. Your API keys live in your OS keychain. AI requests go directly from your machine to the provider, never via Projelli's servers.

**Pricing (post-Week 4):** $0 free / $49 one-time Pro / $99 one-time Lifetime / $29 Founder's Launch (first 100 buyers). Sold via LemonSqueezy.

**Key Principles:**
- **Local-first** — works offline (except for AI calls)
- **Chat creates artifacts** — every AI interaction produces persistent, editable documents
- **User in control** — AI proposes, user decides; destructive ops need confirmation
- **Reproducible** — every workflow run is replayable
- **Auditable** — append-only log of all AI actions
- **BYOK forever** — Projelli never holds AI keys, never sees user data, never charges for inference

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
| `src/modules/models/ModelListService.ts` | Auto-fetch available models from provider APIs with 24h cache |
| `src/modules/models/fetchUtils.ts` | Shared provider base URL resolution (dev proxy / production) |
| `src/hooks/useModelList.ts` | React hook for dynamic model list fetching and caching |
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
| `src/stores/aiChatStore.ts` | AI chat sessions, streaming message updates, draft input persistence |

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
  sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse>;
  sendMessageStreaming?(prompt: string, options: StreamOptions): Promise<ProviderResponse>;
  toolCall?(tool: string, params: Record<string, unknown>, options?: SendOptions): Promise<unknown>;
  structuredOutput<T>(prompt: string, options: StructuredOutputOptions): Promise<T>;
  getMetadata(): ProviderMetadata;
}

// StreamOptions extends SendOptions with:
// - onChunk: (chunk: string) => void  — called for each text token
// - signal?: AbortSignal              — allows cancelling mid-stream
```

**AI Chat Provider Selection:**
- Each `.aichat` file stores `provider` and `model` fields
- `AIChatViewer` reads these to instantiate the correct provider (Claude/OpenAI/Gemini)
- Users select their model in the AI Assistant "Models" tab before creating a new chat
- Streaming is used by default; tokens appear in real-time with a Stop button

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
│   │   ├── models/                 # Provider, ClaudeProvider, OpenAIProvider, ModelListService, fetchUtils
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
