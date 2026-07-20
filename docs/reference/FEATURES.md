# Advisor Prep Hero Feature Reference

For the authoritative latest changes see CHANGELOG.md; for connectors see docs/reference/CONNECTORS.md; for code structure see the repo-root ARCHITECTURE.md.

_Last updated: 2026-07-13 · current `merge/combined` product line (72607d89)_

Canonical "what can Advisor Prep Hero do" reference. This is grounded in the current `src/` and `src-tauri/` code on this branch. If this file disagrees with code, the code wins. Feature status is deliberately split between what exists in the current code and what has been driven in a Windows installer.

## Overview

Advisor Prep Hero is a local-first desktop workspace for financial advisors first: solo advisors, small RIAs, wealth managers, and financial planners who need private, cited answers across client documents, email, calendar data, and CRM records. Law, tax, and consulting are secondary verticals with their own template packs.

The user-facing unit is a client or household. The main product surface is the Client Map: a cited, client-scoped picture of a household built from local files, email, calendar data, and connected sources.

Word is the primary document format. The active document editor is the in-house OOXML `.docx` engine backed by TipTap, with tracked changes, comments, accept/reject, and AI redline. CodeMirror remains for Markdown, plain text, and JSON utility files.

Advisor Prep Hero ships as signed desktop installers for Windows, signed and notarized macOS builds, and Linux packages. Auto-updates use GitHub Releases and signed update metadata.

## Product Surfaces

The current top-level information architecture is the three-tab spine:

| Surface | What it does | Code anchor |
|---|---|---|
| Home | Daily practice work: Today, tasks, saved views, pipeline, reports, workflows, email tools, firm controls, and activity. | CRM Home |
| Clients | Client directory, household records, Client Maps, client documents, email, meetings, reviews, and activity. | Client records |
| Ask | Cited answers and AI chat across workspace files, email, calendar data, CRM records, and indexed sources. | Ask |

Other routable surfaces still exist, but they are reached through the Client Map, Ask filters, account window, or settings:

| Surface | What it does | Code anchor |
|---|---|---|
| Documents | File browser and editor host. | `src/features/documents/` and `src/app/shell/layout/MainPanel.tsx` |
| Email | Search, browse, cite, view, draft, and send connected email. | `src/features/email/` |
| Account and Firm | License, firm sign-in, firm admin, workspaces, usage, connections, Ollama, and developer tools. | Account and Firm |
| Settings | Workspace, AI and Privacy, Voice, Advanced, and Help settings. | `src/features/settings/` and `src/platform/settings/schema.ts` |
| Privacy Center | Data map, egress controls, vault controls, and printable firm security pack. | `src/features/privacy/` and `src/platform/privacy/` |
| Activity Log | Filterable and exportable audit view with integrity status. | `src/features/audit/` |

## Core Concepts

- **Client-scoped work.** A client or household owns its documents, email mappings, Client Map, meetings, and activity.
- **Local-first workspace.** A workspace is a folder the user chooses. Documents stay in real files. Native desktop features go through Tauri commands.
- **BYOK and local AI.** Cloud AI keys are the user's own Anthropic, OpenAI, or Google keys. Local AI can run through the embedded Advisor Prep Hero Local AI llama.cpp sidecar or the user's own Ollama.
- **Key storage.** In desktop builds, AI keys are stored in the operating system keychain through `KeychainService` and Tauri keychain commands: macOS Keychain, Windows Credential Manager, and Linux Secret Service. Legacy `apiKey_*` browser entries are migrated into the keychain.
- **Approval before destructive AI changes.** AI file writes use approval controls and audit events rather than silent destructive edits.
- **Inspectable trust.** The app has an always-visible egress model, Privacy Center, Data Map, encrypted audit store, and confidentiality modes: Local-only, Direct, and Assured.

## CRM And Practice Operations

Advisor Prep Hero now includes a local-first CRM alongside its document workspace. The primary rail is Today, CRM, Meetings, and Ask; the features below are reached from Today or a client record.

| Area | What it does | Current evidence |
|---|---|---|
| Client directory and records | Browse households and people; create and edit clients, people, accounts, notes, facts, tags, and custom details; keep a per-client timeline. | Built in the current product. The Windows installer was driven with 80 imported Wealthbox households. |
| Today and tasks | Shows the day's work, capacity-aware triage, tasks, projects, notifications, and activity. | Built in the current product; final Windows drive still pending. |
| Search and CRM Ask | Searches saved CRM records locally and answers questions with cited CRM records alongside files and email. | Driven in the Windows installer: a real imported Wealthbox household returned a fresh cited answer, and a separate-client isolation check passed. |
| Pipeline, saved views, and reports | Tracks opportunities, saves household lists, builds reports, and keeps report views. | Built in the current product; final Windows drive still pending. |
| Workflows | Runs practice workflows, creates workflow instances from migration checklists, and lets an advisor review propagation before it changes records. | Built in the current product; final Windows drive still pending. |
| Firm and workspaces | Provides firm setup, organization controls, custom fields and tags, separate workspaces, and a cross-workspace firm overview. | Built in the current product; final Windows drive still pending. |
| Migration and CSV import | Imports client data, guides migration, and can export migration records. | CSV import, Ask search, and restart persistence were fully driven in the Windows installer. The broader migration flow is built and awaiting its final Windows drive. |
| Client documents and email | Links files to client records and keeps client-specific Documents and Email tabs. | Built in the current product; client-scoped Ask was driven in the Windows installer. |
| Client groups | Lets an advisor create named, collapsible local client groups in the Clients rail. | Built in the current product; final Windows drive still pending. |

### Client Map, Book, And Reviews

- **Client Map.** Each client record can build or refresh a cited summary from that client's saved records, show gaps, and open the supporting source.
- **Book view.** The Clients directory includes a whole-practice view that ranks Client Maps by completeness, freshness, and last touch, and opens the selected client. This entry point was restored after the last Windows bench run, so it is **built and awaiting a final Windows drive**.
- **Whole-practice Ask.** Ask can use built Client Maps for a whole-practice question without falling back to raw cross-client retrieval. It refuses honestly when no Client Maps have been built yet.
- **Reviews.** Each client has a Reviews tab for account-transfer preparation from a PDF statement and for approving proposed RightCapital or Holistiplan updates. The current planning-tool connections are approval-review surfaces; they are not a live vendor integration claim.

### CRM Email Tools

- **Private email dropbox.** An advisor can choose a mailbox folder, check it for messages to file, and assign a message to a client. The last Windows bench could not detect the test message; the current product contains the subsequent folder-refresh repair, so this flow is **built and awaiting a final Windows drive**.
- **Reviewed email broadcast.** An advisor can start from a saved household view, review recipients, draft a message, and send only to verified recipients. The last Windows bench found the recipient-review control inactive; the current product contains the subsequent repair, so this flow is **built and awaiting a final Windows drive**.

### Client Intake

Advisor Prep Hero can start a new-client collection flow, send a client a phone-friendly link, receive their submitted documents and answers, and show onboarding progress on the advisor side. The client-facing flow is designed to encrypt answers and documents before they leave the client's browser. The hosted intake page is staged rather than a production service, and the final packaged Windows drive is still pending.

## Meetings, Voice, And Retention

| Area | What it does | Current evidence |
|---|---|---|
| Meeting Notes | A client-record tab for recording or importing meeting audio, local transcription, transcript review, speaker naming, meeting type, and reviewed notes/action delivery. | The last Windows bench could not reach this tab. The current product restores its entry point, so the full loop is **built and awaiting a final Windows drive**. |
| Meeting briefs | Shows today's meetings, prepares a cited before-you-meet brief, refreshes stale briefs, and exports an agenda. | Built in the current product; final Windows drive still pending. |
| Recording consent and Notice Card | Records consent choices and can offer an optional visible recording-notice card for detected Teams or Zoom meetings. If the card cannot join, Advisor Prep Hero tells the advisor to say the notice aloud; Google Meet has the same honest fallback. | Built in the current product; final Windows drive still pending. |
| Retention and attestation | Lets an advisor set a meeting-recording retention policy, clean up eligible audio, and export a Word attestation report. | Fully driven in the Windows installer using a disclosed seeded meeting fixture: the eligible audio was removed, the transcript and notes remained, and the exported report recorded the cleanup and verified audit integrity. |
| Voice readiness | Bundles local transcription and speaker-separation support for packaged builds. | The last bench initially found missing voice components; current packaging includes the follow-up repair. Final end-to-end Windows meeting drive is still pending. |

The Windows evidence above reflects what was actually driven. It does not turn a source-level feature, or a repair merged after that bench, into a claimed live pass.

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
| Advisor Prep Hero Local AI | Embedded llama.cpp sidecar via `Advisor Prep HeroLocalProvider` and `src-tauri/src/sidecars/llama_server.rs`. |
| Ollama | User-run local daemon through `OllamaProvider`. |

Current recall stack:

- Semantic search: LanceDB plus fastembed e5-small in `src-tauri/src/commands/rag/`.
- Keyword support: encrypted BM25 index in the Rust RAG backend.
- Frontend full-text search: MiniSearch in `src/platform/search/ContentIndex.ts`.
- Filename fuzzy search: Fuse through quick-open.
- Facts memory: workspace memory file at `.keepance/memory.json` through `src/platform/rag/FactsService.ts`.
- Client scoping: client and household tags keep retrieved records, files, and mail with the right client.
- Email and external connector indexing: shared connector-to-RAG path in `src-tauri/src/commands/connector/` and RAG commands.

Ask also shows dated source evidence where available, labels recognized RightCapital plan exports and Jump notes honestly as dated saved sources, and can answer from cited CRM records.

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
| Code-complete, gated on vendor credentials | DocuSign, Salesforce, Redtail, Addepar, Box, Jotform, ShareFile, and Zocks. |
| Recognized saved sources, not live connectors | RightCapital plan exports and Jump notes; Advisor Prep Hero reads the exported file or saved note and shows its date. |
| Roadmap, no code on this branch | Clio, iManage/NetDocuments, Microsoft Office add-ins. |

Connector credentials use the OS keychain. Imported connector data is assigned to the right client and indexed into the same cited, client-scoped recall pipeline. Connection screens also include an honesty card explaining what a connector reads, writes, cannot access, and when it was last verified.

## Email

Email lives under `src/features/email/` and `src-tauri/src/commands/mail/`.

- Providers: Outlook/M365, Gmail, and IMAP.
- Connected account credentials and tokens use keychain-backed storage.
- Mail metadata uses a SQLCipher-backed store in desktop builds.
- Message bodies are encrypted AES-256-GCM blobs under the workspace `.keepance` area.
- Email can be browsed, searched, cited in Ask, opened as read-only tabs, used for reply drafting, and sent when the account has send permission.
- Client scoping is based on account and folder mappings to clients.

## Privacy, Audit, Vault, And Firm Features

| Area | Current behavior | Code anchor |
|---|---|---|
| Audit | Desktop audit entries are append-only in a SQLCipher database with integrity verification. Browser/dev fallback is clearly marked as less protected. | `src/platform/audit/AuditService.ts`, `src-tauri/src/commands/audit/` |
| Data Map and egress | Privacy UI explains where keys, prompts, files, mail, CRM data, and vault data live. | `src/platform/privacy/ui/DataMapDialog.tsx` |
| Confidentiality modes | Local-only, Direct, and Assured mode control where AI requests can go. | `src/features/settings/ConfidentialityModeSettings.tsx`, `src/platform/privacy/` |
| Encrypted vault | Workspace document files can be encrypted at rest with AES-256-GCM through the `keepance-vault` crate. | `src-tauri/crates/keepance-vault/`, `src/platform/firm/vault/` |
| Firm tier | Firm sign-in, admin console, seats, SSO path, managed Assured providers, information barriers, client access keys, and co-editing infrastructure. | `src/features/firm/`, `src/platform/firm/` |
| Co-editing | Firm shared notes/doc data uses Yjs/CRDT infrastructure and per-client access. | `src/platform/firm/coedit/` |

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
| Client state | Local client directory and client-record state. |
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
- Shared cross-feature state lives mostly in the platform state, client-data, settings, and related platform domains.

## Known Limits

- `.odt`, `.ods`, `.pages`, and `.numbers` are listed as binary file types but do not have first-class editable document surfaces.
- Legacy `.doc` files require conversion before using the Word-native path.
- `.pptx` and `.ppt` are preview-focused, not editable presentation documents.
- Advisor Prep Hero Local AI is text-only; use a cloud model for image inputs.
- Local OCR quality depends on scan quality. Low-confidence scanned pages can be skipped rather than indexed as bad text.
- The detailed connector roadmap lives in `docs/reference/CONNECTORS.md`, not here.

## References

- `CHANGELOG.md`
- `ARCHITECTURE.md`
- `docs/reference/CONNECTORS.md`
- `docs/reference/RAG_PIPELINE.md`
- `docs/reference/SECURITY.md`
- `docs/reference/TAURI_COMMANDS.md`
