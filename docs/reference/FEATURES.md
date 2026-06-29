# Keepance Feature Reference

For the authoritative latest changes see CHANGELOG.md; for connectors see docs/reference/CONNECTORS.md; for code structure see the repo-root ARCHITECTURE.md.

_Last updated: 2026-06-29 · v3.3.5_

Canonical "what can Keepance do" reference. This is grounded in the current `src/` and `src-tauri/` code on this branch. If this file disagrees with code, the code wins.

## Overview

Keepance is a local-first desktop workspace for financial advisors first: solo advisors, small RIAs, wealth managers, and financial planners who need private, cited answers across client documents and email. Law, tax, and consulting are secondary verticals with their own template packs.

The user-facing unit is a client or household. Internally, the isolation engine still uses `matter` and `matter_id`; don't rename those code or wire identifiers. The main product surface is the Client Map: a cited, client-scoped picture of a household built from local files, email, and connected sources.

Word is the primary document format. The active document editor is the in-house OOXML `.docx` engine backed by TipTap, with tracked changes, comments, accept/reject, and AI redline. CodeMirror remains for Markdown, plain text, and JSON utility files.

Keepance ships as signed desktop installers for Windows, signed and notarized macOS builds, and Linux packages. Auto-updates use GitHub Releases and signed update metadata.

## Product Surfaces

The current top-level information architecture is the three-tab spine in `src/app/shell/layout/Spine.tsx`:

| Surface | What it does | Code anchor |
|---|---|---|
| Client Map | Client and household home, scoped documents, scoped email, activity, cited map, and per-client Ask entry points. | `src/features/matters/` |
| Ask | Cited recall and AI chat across workspace files, email, and indexed sources. | `src/features/ask/` |
| Workflows | Template-driven work for advisors plus legal, tax, consulting, custom, and marketplace templates. | `src/features/workflows/` |

Other routable surfaces still exist, but they are reached through the Client Map, Ask filters, account window, or settings:

| Surface | What it does | Code anchor |
|---|---|---|
| Documents | File browser and editor host. | `src/features/documents/` and `src/app/shell/layout/MainPanel.tsx` |
| Email | Search, browse, cite, view, draft, and send connected email. | `src/features/email/` |
| Account and Firm | License, firm sign-in, firm admin, usage, connections, Ollama, and developer tools. | `src/features/account/AccountWindow.tsx` and `src/features/firm/` |
| Settings | Workspace, AI and Privacy, Voice, Advanced, and Help settings. | `src/features/settings/` and `src/platform/settings/schema.ts` |
| Privacy Center | Data map, egress controls, vault controls, and printable firm security pack. | `src/features/privacy/` and `src/platform/privacy/` |
| Activity Log | Filterable and exportable audit view with integrity status. | `src/features/audit/` |

## Core Concepts

- **Client-scoped work.** A client or household owns its documents, email mappings, Client Map, and activity. The engine stores this as `matter` data.
- **Local-first workspace.** A workspace is a folder the user chooses. Documents stay in real files. Native desktop features go through Tauri commands.
- **BYOK and local AI.** Cloud AI keys are the user's own Anthropic, OpenAI, or Google keys. Local AI can run through the embedded Keepance Local AI llama.cpp sidecar or the user's own Ollama.
- **Key storage.** In desktop builds, AI keys are stored in the operating system keychain through `KeychainService` and Tauri keychain commands: macOS Keychain, Windows Credential Manager, and Linux Secret Service. Legacy `apiKey_*` browser entries are migrated into the keychain.
- **Approval before destructive AI changes.** AI file writes use approval controls and audit events rather than silent destructive edits.
- **Inspectable trust.** The app has an always-visible egress model, Privacy Center, Data Map, encrypted audit store, and confidentiality modes: Local-only, Direct, and Assured.

## File And Document Handling

File operations route through the workspace/file-system layer rather than direct ad hoc writes. The current code anchors are `src/platform/fs/`, `src/platform/history/`, and `src/app/fileOps/`.

| Area | Current behavior |
|---|---|
| File tree and grid | Browsing, create, rename, move, delete, import, restore from trash, and open-in-editor flows live under `src/features/documents/workspace/` and the app file operation hooks. |
| Undoable operations | File write/delete/rename/move commands live under `src/platform/history/commands/`. |
| Trash | Soft-delete and retention are handled by `src/platform/history/TrashService.ts`. |
| Quick open | Filename fuzzy matching uses `fuse.js`. |
| Full-text search | Workspace text search uses `minisearch` through `src/platform/search/ContentIndex.ts`. |
| Semantic recall | RAG uses LanceDB plus fastembed's multilingual e5-small model in the Rust backend. |
| Scanned PDFs | OCR is available for scanned PDF pages through the local OCR pipeline in `src/platform/rag/ocr/` and PDF indexing code. |

Supported editor/viewer dispatch is centralized in `src/app/shell/layout/MainPanel.tsx`:

| File type | Current handling |
|---|---|
| `.docx` | Primary Word editor through `DocxEditor` plus the in-house Rust OOXML engine. |
| `.doc` | Legacy Word conversion fallback through LibreOffice when available. |
| `.md`, `.markdown`, `.txt`, no extension | CodeMirror editor through `MarkdownEditor` / text fallback. |
| `.json` | Text editing path. |
| `.source` | Source card editor for citation metadata. |
| `.aichat` | Saved AI chat file rendered by `AIChatViewer`. |
| `.workflow` | Workflow execution tab rendered by `WorkflowExecutionTab`. |
| `.pdf` | PDF viewer. |
| `.xlsx`, `.xls`, `.csv` | Spreadsheet viewer/editor. |
| `.pptx`, `.ppt` | Presentation preview, with LibreOffice conversion for supported desktop paths. |
| Images | Inline image viewer. |
| Audio | Waveform editor for `.wav`, `.mp3`, `.m4a`, `.ogg`, and recorded `.webm`. |
| Video | Inline video viewer for video extensions not routed to audio. |
| Email tab | Read-only stored email view from `EmailViewer`. |
| Browser tab | Embedded browser panel for reference URLs. |

Version history currently covers `.md`, `.txt`, `.json`, `.source`, `.aichat`, and `.docx`, based on `shouldVersionFile()` in `src/app/shell/layout/mainPanelHelpers.ts`. `.docx` history is binary-safe and disk-backed.

## Word And AI Editing

The Word path is the main document path:

- `src-tauri/crates/keepance-docx/` parses, serializes, validates, and preserves OOXML package parts.
- `src/platform/types/docx.ts` models paragraphs, runs, comments, insertions, deletions, and AI edit outcomes.
- `src/features/documents/media/DocxEditor.tsx` renders editable Word documents and routes saves through the engine.
- AI redline uses the same provider resolution rules as Ask and workflows. Local-only mode uses on-device models.

Markdown is still supported for utility notes, workflow output, and plain-text workflows, but it is not the headline product format.

## Ask, Recall, And AI Providers

Ask and AI chat use the provider layer in `src/platform/providers/`:

| Provider path | Status |
|---|---|
| Anthropic, OpenAI, Google | BYOK cloud providers. API keys are loaded through `KeychainService`. |
| Keepance Local AI | Embedded llama.cpp sidecar via `KeepanceLocalProvider` and `src-tauri/src/sidecars/llama_server.rs`. |
| Ollama | User-run local daemon through `OllamaProvider`. |

Current recall stack:

- Semantic search: LanceDB plus fastembed e5-small in `src-tauri/src/commands/rag/`.
- Keyword support: encrypted BM25 index in the Rust RAG backend.
- Frontend full-text search: MiniSearch in `src/platform/search/ContentIndex.ts`.
- Filename fuzzy search: Fuse through quick-open.
- Facts memory: workspace memory file at `.keepance/memory.json` through `src/platform/rag/FactsService.ts`.
- Matter/client scoping: `src/platform/rag/matterResolver.ts` and `matter_id` tagging.
- Email and external connector indexing: shared connector-to-RAG path in `src-tauri/src/commands/connector/` and RAG commands.

## Workflows And Templates

Built-in workflows live under `src/features/workflows/engine/templates/`. `src/features/workflows/engine/index.ts` loads:

| Pack | Code path | Notes |
|---|---|---|
| Advisors | `templates/advisors/` | Financial advisory practice workflows. This pack is prioritized for the advisor profession. |
| Legal | `templates/legal/` | Secondary vertical. Advisor users do not see the legal pack first. |
| Tax | `templates/tax/` | Secondary vertical. |
| Consulting | `templates/consulting/` | Secondary vertical. |
| General | `UserInterviews`, `UserInterviewsSynthesis`, `WeeklyReviewWorkflow` | Profession-neutral workflows. |
| Custom | `engine/userTemplates.ts` | User-authored and duplicated templates. |
| Marketplace | `src/features/workflows/marketplace/` | Community template catalog, install, update, provenance, and offline handling. |

Workflow execution uses `.workflow` files and the workflow engine in `src/features/workflows/engine/WorkflowEngine.ts`. Outputs can be saved as files and exported to Word or PowerPoint through the app workflow runner.

## Connectors

Do not treat this file as the detailed connector source of truth. The code-grounded connector reference is `docs/reference/CONNECTORS.md`.

Summary from that reference:

| Status | Connectors |
|---|---|
| Shipped on this branch | Email: Outlook/M365, Gmail, IMAP; OneDrive/SharePoint; Wealthbox; Calendly. |
| Code-complete, gated on vendor credentials | DocuSign, Salesforce, Redtail. |
| Staged elsewhere, not on this branch | Addepar, Box, Jotform, ShareFile, Zocks. |
| Roadmap, no code on this branch | Clio, iManage/NetDocuments, Microsoft Office add-ins. |

Connector credentials use the OS keychain. Imported connector data is tagged to `matter_id` and indexed into the same cited, client-scoped recall pipeline.

## Email

Email lives under `src/features/email/` and `src-tauri/src/commands/mail/`.

- Providers: Outlook/M365, Gmail, and IMAP.
- Connected account credentials and tokens use keychain-backed storage.
- Mail metadata uses a SQLCipher-backed store in desktop builds.
- Message bodies are encrypted AES-256-GCM blobs under the workspace `.keepance` area.
- Email can be browsed, searched, cited in Ask, opened as read-only tabs, used for reply drafting, and sent when the account has send permission.
- Client scoping is based on account and folder mappings to matters.

## Privacy, Audit, Vault, And Firm Features

| Area | Current behavior | Code anchor |
|---|---|---|
| Audit | Desktop audit entries are append-only in a SQLCipher database with integrity verification. Browser/dev fallback is clearly marked as less protected. | `src/platform/audit/AuditService.ts`, `src-tauri/src/commands/audit/` |
| Data Map and egress | Privacy UI explains where keys, prompts, files, mail, CRM data, and vault data live. | `src/platform/privacy/ui/DataMapDialog.tsx` |
| Confidentiality modes | Local-only, Direct, and Assured mode control where AI requests can go. | `src/features/settings/ConfidentialityModeSettings.tsx`, `src/platform/privacy/` |
| Encrypted vault | Workspace document files can be encrypted at rest with AES-256-GCM through the `keepance-vault` crate. | `src-tauri/crates/keepance-vault/`, `src/platform/firm/vault/` |
| Firm tier | Firm sign-in, admin console, seats, SSO path, managed Assured providers, information barriers, matter keys, and co-editing infrastructure. | `src/features/firm/`, `src/platform/firm/` |
| Co-editing | Firm shared notes/doc data uses Yjs/CRDT infrastructure and per-matter key access. | `src/platform/firm/coedit/` |

## Settings And Shortcuts

Settings are schema-driven in `src/platform/settings/schema.ts`. The five current settings sections are:

- Workspace
- AI & Privacy
- Voice
- Advanced
- Help

Account, Firm, Usage, and Connections moved out of Settings into `src/features/account/AccountWindow.tsx`.

Keyboard shortcut labels are centralized in `src/platform/utils/shortcuts.ts`:

| Shortcut | Action |
|---|---|
| Ctrl+S | Save active file |
| Ctrl+W | Close active tab |
| Ctrl+\\ | Toggle split pane |
| Ctrl+Shift+O | Toggle outline panel |
| Ctrl+Shift+B | Toggle backlinks panel |
| Ctrl+K | Open command palette |
| Ctrl+P | Quick-open file |
| ? | Show keyboard shortcuts |
| Ctrl+Shift+A | Open AI Assistant in a main-panel tab |
| Ctrl+, | Open settings |

The display layer swaps Ctrl for Command on macOS.

## Platform And Distribution

| Platform | Current state |
|---|---|
| Windows | NSIS and MSI installers. Release workflow signs Windows artifacts and update metadata. |
| macOS | Apple Silicon and Intel builds are signed with Apple Developer ID and notarized. |
| Linux | AppImage and Debian package outputs. |
| Updates | Tauri updater uses GitHub Release metadata and updater signatures. |

Version `3.3.5` is present in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

## Storage And Data Model

| Data | Where it lives |
|---|---|
| User documents | Real files in the chosen workspace folder. |
| Client/matter state | Frontend matter store, preserving legacy key names internally for compatibility. |
| Workspace memory facts | `.keepance/memory.json`. |
| RAG vectors and keyword index | Workspace `.keepance` data managed by the Rust RAG backend. Chunk text and keyword index data are encrypted at rest. |
| Mail index and blobs | SQLCipher metadata DB plus encrypted message-body blobs in the workspace `.keepance` area. |
| Audit log | SQLCipher audit DB in desktop builds. |
| AI keys and firm secrets | Operating system keychain in desktop builds. |
| Vaulted documents | AES-256-GCM encrypted workspace files with vault metadata and recovery flow. |

## Architecture Pointers

- Current source layout: `src/app/`, `src/features/`, `src/platform/`, `src/ui/`, and `src/lib/`. The repo-root `ARCHITECTURE.md` is the authoritative code map.
- Tauri commands are registered in `src-tauri/src/lib.rs`.
- Native command groups live under `src-tauri/src/commands/`.
- The in-house Word engine is `src-tauri/crates/keepance-docx/`.
- The encrypted vault crate is `src-tauri/crates/keepance-vault/`.
- Shared frontend types live under `src/platform/types/`.
- Shared cross-feature state lives mostly under `src/platform/state/`, `src/platform/matter/`, `src/platform/settings/`, and related platform domains.

## Known Limits

- `.odt`, `.ods`, `.pages`, and `.numbers` are listed as binary file types but do not have first-class editable document surfaces.
- Legacy `.doc` files require conversion before using the Word-native path.
- `.pptx` and `.ppt` are preview-focused, not editable presentation documents.
- Keepance Local AI is text-only; use a cloud model for image inputs.
- Local OCR quality depends on scan quality. Low-confidence scanned pages can be skipped rather than indexed as bad text.
- The detailed connector roadmap lives in `docs/reference/CONNECTORS.md`, not here.

## References

- `CHANGELOG.md`
- `ARCHITECTURE.md`
- `docs/reference/CONNECTORS.md`
- `docs/reference/RAG_PIPELINE.md`
- `docs/reference/SECURITY.md`
- `docs/reference/TAURI_COMMANDS.md`
