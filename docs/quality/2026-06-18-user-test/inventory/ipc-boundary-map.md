# Browser vs Desktop IPC Boundary Map

Date: 2026-06-18  
Scope: `src-tauri/src/commands/**`, registered in `src-tauri/src/lib.rs`, and frontend call sites in `src/**`.

## Classification Key

- **BROWSER-OK**: Works in the Vite dev server without a real Tauri runtime, either through a true browser implementation, a no-op, a localStorage fallback, or an explicit fixture/mock path.
- **DESKTOP-ONLY**: Requires the real Rust/Tauri backend, native plugins, OS services, sidecars, SQLCipher store, LanceDB/fastembed, the OOXML engine, real disk, OAuth loopback, or the firm relay.
- **PARTIAL**: The UI can render in browser and may have fixture data, but the real operation is desktop-only.

Important browser substitutes:

- Files: `src/platform/fs/BackendFactory.ts` chooses `WebFSBackend` in browser and `TauriFSBackend` in desktop; test mode also exposes `window.__mockWorkspaceFs`.
- API keys: `src/platform/providers/KeychainService.ts` uses localStorage/memory/env backends for browser/test development. Real secure key storage is OS keychain.
- Firm secrets and device keys: `src/platform/firm/firmKeychain.ts` and `src/platform/firm/deviceKeys.ts` have a base64 localStorage fallback in browser/dev/test. Real firm security depends on desktop OS keychain.
- Email list UI: `src/platform/utils/mail-commands.ts` supports `?mailFixture=1` in non-Tauri dev mode for list/search/account fixtures only. Message body decrypt, OAuth connect, sync, attachment fetch, and send remain desktop-only.
- Audit: `src/platform/utils/tauri-commands.ts` returns no-op/empty results in browser; `AuditService` keeps its legacy localStorage path there. Desktop audit is encrypted SQLCipher.
- DOCX: `src/platform/utils/docx-commands.ts` throws a clear browser-mode error. Browser can show fallbacks, but real `.docx` open/save/redline/export needs the Rust OOXML engine.
- RAG: `src/platform/utils/tauri-commands.ts` throws for indexing/retrieve/verify in browser, except setup/no-op helpers. Real semantic memory requires desktop LanceDB + fastembed model files.
- Voice/TTS/MCP: settings and UI render in browser, but sidecar-backed speech, transcription, and MCP write approvals need desktop.

## Command Inventory

| Command | Class | What it does | Rust file | Frontend wrapper / invoking feature |
|---|---:|---|---|---|
| `audit_set_workspace` | PARTIAL | Points the encrypted audit store at the active workspace. Browser wrapper no-ops. | `src-tauri/src/commands/audit/mod.rs:37` | `auditSetWorkspace()` in `src/platform/utils/tauri-commands.ts`; called by `src/platform/audit/AuditService.ts` during hydrate/workspace setup. |
| `audit_append` | PARTIAL | Appends one audit entry to the encrypted SQLCipher audit log. Browser falls back to localStorage audit service. | `src-tauri/src/commands/audit/mod.rs:48` | `auditAppend()` in `src/platform/utils/tauri-commands.ts`; AI actions, TTS, marketplace, settings, and audit surfaces flow through `AuditService`. |
| `audit_list` | PARTIAL | Reads audit entries from the encrypted store. Browser returns `[]` from wrapper and uses localStorage path. | `src-tauri/src/commands/audit/mod.rs:71` | `auditList()` in `src/platform/utils/tauri-commands.ts`; `src/features/audit/AuditHome.tsx` via `AuditService`. |
| `audit_count` | PARTIAL | Counts encrypted audit entries. Browser returns `0`. | `src-tauri/src/commands/audit/mod.rs:93` | `auditCount()` in `src/platform/utils/tauri-commands.ts`; no direct feature call found beyond service readiness/count helpers. |
| `sha256_file` | DESKTOP-ONLY | Computes SHA-256 for a downloaded marketplace tarball. | `src-tauri/src/commands/checksum.rs:14` | Direct `invoke('sha256_file')` in `src/features/workflows/marketplace/svc/install.ts` during template install. Browser E2E notes this throws without an IPC mock. |
| `extract_tarball` | DESKTOP-ONLY | Extracts a `.tar.gz` template package into the user-template destination. | `src-tauri/src/commands/tarball.rs:19` | Direct `invoke('extract_tarball')` in `src/features/workflows/marketplace/svc/install.ts` during marketplace install. |
| `docx_open` | DESKTOP-ONLY | Opens a `.docx` file into the in-house JSON DOM. | `src-tauri/src/commands/docx/mod.rs:322` | `docxOpen()` in `src/platform/utils/docx-commands.ts`; `src/features/documents/media/DocxEditor.tsx`, version diff utilities, and DOCX history. |
| `docx_save` | DESKTOP-ONLY | Saves a JSON DOM back to `.docx`, preserving unmodeled package parts. | `src-tauri/src/commands/docx/mod.rs:331` | `docxSave()`; `DocxEditor.tsx` autosave/edit persistence. |
| `docx_author_revision` | DESKTOP-ONLY | Authors one tracked insertion/deletion/paragraph insertion in the DOM. | `src-tauri/src/commands/docx/mod.rs:352` | `docxAuthorRevision()` wrapper exists; current UI primarily uses batch `docx_author_revisions`. |
| `docx_author_revisions` | DESKTOP-ONLY | Applies a batch of AI redline edits drift-safely and returns per-edit results. | `src-tauri/src/commands/docx/mod.rs:403` | `docxAuthorRevisions()`; `DocxEditor.tsx` AI redline / selected text edits. |
| `docx_resolve_revision` | DESKTOP-ONLY | Accepts or rejects one tracked change by revision id. | `src-tauri/src/commands/docx/mod.rs:436` | `docxResolveRevision()`; `DocxEditor.tsx` review controls. |
| `docx_resolve_all` | DESKTOP-ONLY | Accepts or rejects all tracked changes in a document. | `src-tauri/src/commands/docx/mod.rs:455` | `docxResolveAll()`; `DocxEditor.tsx` review-all controls. |
| `docx_export_copy` | DESKTOP-ONLY | Exports a faithful `.docx` copy. | `src-tauri/src/commands/docx/mod.rs:546` | `docxExportCopy()`; `DocxEditor.tsx` Export -> Word copy. |
| `docx_export_clean_copy` | DESKTOP-ONLY | Exports a metadata-scrubbed clean `.docx`, optionally accepting changes/removing comments. | `src-tauri/src/commands/docx/mod.rs:562` | `docxExportCleanCopy()`; `DocxEditor.tsx` Export -> Clean copy. |
| `docx_apply_letterhead` | DESKTOP-ONLY | Rehouses generated `.docx` bytes inside a firm letterhead package. | `src-tauri/src/commands/docx/mod.rs:587` | `docxApplyLetterhead()`; `src/platform/utils/docx-io.ts` workflow deliverable generation. |
| `firm_sso_authenticate` | DESKTOP-ONLY | Runs firm OIDC/SSO auth with browser + loopback and returns login JSON. | `src-tauri/src/commands/firm/sso.rs:87` | Direct dynamic import/invoke in `src/platform/firm/firmStore.ts` `signInSso()`; UI in `src/features/firm/FirmSignIn.tsx` / admin SSO settings. |
| `check_path` | DESKTOP-ONLY | Checks whether a native filesystem path exists and whether it is a directory. | `src-tauri/src/commands/fs.rs:17` | Registered but no current TS call site found. Likely legacy workspace picker support. |
| `get_home_dir` | DESKTOP-ONLY | Returns the OS home directory. | `src-tauri/src/commands/fs.rs:37` | Registered but no current TS call site found. |
| `open_in_explorer` | DESKTOP-ONLY | Opens a file or folder in Finder/Explorer/file manager after path validation. | `src-tauri/src/commands/fs.rs:74` | Direct `invoke('open_in_explorer')` in `src/features/documents/workspace/FileTree.tsx` Open on Desktop action. Browser UI shows an alert/fallback. |
| `detect_libreoffice` | BROWSER-OK probe / DESKTOP real | Detects LibreOffice/`soffice`. Browser wrapper returns `null`. | `src-tauri/src/commands/fs.rs:212` | `detectLibreOffice()` in `src/platform/utils/tauri-commands.ts`; DOC/PPT/DOCX PDF fallback notices in `MainPanelDocFallbacks.tsx`, `PresentationViewer.tsx`, `DocxEditor.tsx`. |
| `convert_doc_to_docx` | DESKTOP-ONLY | Converts legacy `.doc` to `.docx` using LibreOffice. | `src-tauri/src/commands/fs.rs:291` | `convertDocToDocx()`; `src/app/shell/layout/MainPanelDocFallbacks.tsx` Convert action. |
| `convert_ppt_to_pdf` | DESKTOP-ONLY | Converts `.ppt`/`.pptx` to cached PDF preview using LibreOffice. | `src-tauri/src/commands/fs.rs:411` | `convertPptToPdf()`; `src/features/documents/media/PresentationViewer.tsx`. |
| `convert_docx_to_pdf` | DESKTOP-ONLY | Converts saved `.docx` to PDF using LibreOffice. | `src-tauri/src/commands/fs.rs:564` | `docxConvertToPdf()` in `docx-commands.ts`; `DocxEditor.tsx` Export -> PDF. |
| `fetch_url_title` | BROWSER-OK fallback / DESKTOP real | Fetches a URL title with native HTTP to avoid browser CORS. Browser returns empty string. | `src-tauri/src/commands/http.rs:157` | `fetchUrlTitle()`; Markdown smart paste in `src/features/documents/editor/MarkdownEditor.tsx` / `editor-core/smartPaste.ts`. |
| `ollama_list_models` | DESKTOP-ONLY, currently unimplemented | Placeholder for native Ollama model listing; returns not implemented. | `src-tauri/src/commands/http.rs:235` | Registered but no current TS wrapper/call site found. Ollama UI uses provider fetch/probe paths instead. |
| `ollama_chat_stream` | DESKTOP-ONLY, currently unimplemented | Placeholder for native Ollama streaming chat; returns not implemented. | `src-tauri/src/commands/http.rs:242` | Registered but no current TS wrapper/call site found. |
| `keychain_set` | PARTIAL | Stores a secret in OS keychain under optional service namespace. Browser wrappers throw; higher-level dev services may use localStorage fallback instead. | `src-tauri/src/commands/keychain.rs:79` | `keychainSet()`; used by `firmKeychain.ts`, `deviceKeys.ts`, provider settings/key storage paths. |
| `keychain_get` | PARTIAL | Reads a secret from OS keychain. | `src-tauri/src/commands/keychain.rs:93` | `keychainGet()`; firm auth tokens, seat token, matter keys, device keys, provider keys. |
| `keychain_delete` | PARTIAL | Deletes a secret from OS keychain. | `src-tauri/src/commands/keychain.rs:105` | `keychainDelete()`; firm sign-out/deprovision, API-key delete paths. |
| `mail_fde_status` | BROWSER-OK fallback / DESKTOP real | Detects OS full-disk encryption posture for mail safety nudge. Browser returns `{status:'unknown', platform:'browser'}`. | `src-tauri/src/commands/mail/fde.rs:133` | `mailFdeStatus()`; `src/features/settings/MailConnect.tsx`. |
| `mail_set_workspace` | PARTIAL | Points encrypted mail store at the active workspace. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:243` | `mailSetWorkspace()`; `src/platform/hooks/useMemoryWiring.ts` on workspace open. |
| `mail_get_message` | DESKTOP-ONLY | Fetches and decrypts one stored email body/metadata for the viewer. | `src-tauri/src/commands/mail/mod.rs:285` | `mailGetMessage()`; `EmailViewer.tsx`, `MailRow.tsx`, export/preview/reply flows. |
| `mail_list_messages` | PARTIAL | Lists/searches stored email metadata without decrypting blobs. Browser supports `?mailFixture=1` demo data or empty list. | `src-tauri/src/commands/mail/mod.rs:309` | `mailListMessages()`; `src/features/email/EmailWorkspace.tsx`. |
| `mail_retag_folder_matter` | PARTIAL | Reassigns all messages in a provider/account/folder to a matter. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:339` | `mailRetagFolderMatter()`; `MatterPickerPopover.tsx`, `useMemoryWiring.ts` matter mapping changes. |
| `mail_retag_message_matter` | PARTIAL | Reassigns one email and its RAG chunks to a matter. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:417` | `mailRetagMessageMatter()`; `EmailViewer.tsx`, `EmailWorkspace.tsx`, `BulkMatterPicker.tsx`, `MatterPickerPopover.tsx`. |
| `mail_get_attachment` | DESKTOP-ONLY | Fetches one email attachment on demand, in memory only. | `src-tauri/src/commands/mail/mod.rs:473` | `mailGetAttachment()`; `src/features/email/EmailViewer.tsx` attachment click. |
| `mail_backfill_rag` | PARTIAL | Re-indexes imported mail that could not be embedded while the model was unavailable. Browser returns `0`. | `src-tauri/src/commands/mail/mod.rs:546` | `mailBackfillRag()`; `src/platform/hooks/useMemoryWiring.ts` on model-ready/workspace boot. |
| `outlook_connect` | DESKTOP-ONLY | Runs Microsoft 365 Outlook loopback OAuth/PKCE and stores refresh token. | `src-tauri/src/commands/mail/mod.rs:798` | `outlookConnect()`; `src/features/settings/MailConnect.tsx` Connect Outlook. |
| `mail_begin_login` | DESKTOP-ONLY, legacy | Starts Microsoft device-code login. | `src-tauri/src/commands/mail/mod.rs:827` | `mailBeginLogin()` wrapper exists; no current feature import found. Current Outlook UI uses `outlook_connect`. |
| `mail_poll_login` | DESKTOP-ONLY, legacy | Polls Microsoft device-code login. Browser wrapper returns `pending`. | `src-tauri/src/commands/mail/mod.rs:845` | `mailPollLogin()` wrapper exists; no current feature import found. |
| `mail_is_connected` | PARTIAL | Checks whether Outlook/M365 refresh token exists. Browser returns `false`. | `src-tauri/src/commands/mail/mod.rs:862` | `mailIsConnected()`; `MailConnect.tsx`, `MattersHome.tsx`, `SetupChecklist.tsx`. |
| `mail_cancel_sync` | PARTIAL | Cancels an active mail sync. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:889` | `mailCancelSync()`; Outlook/Gmail settings panels. |
| `mail_imap_connect` | DESKTOP-ONLY | Stores/tests IMAP connection config in keychain. | `src-tauri/src/commands/mail/mod.rs:897` | `mailImapConnect()`; `src/features/settings/MailImapConnect.tsx`. |
| `mail_imap_is_connected` | PARTIAL | Checks whether IMAP config exists. Browser returns `false`. | `src-tauri/src/commands/mail/mod.rs:931` | `mailImapIsConnected()`; IMAP settings, setup checklist, matters connection status. |
| `mail_connected_accounts` | PARTIAL | Lists connected accounts for matter mapping. Browser returns demo accounts only with `?mailFixture=1`, otherwise `[]`. | `src-tauri/src/commands/mail/mod.rs:950` | `mailConnectedAccounts()`; `EmailWorkspace.tsx`, `MatterManagerDialog.tsx`. |
| `mail_imap_disconnect` | PARTIAL | Removes stored IMAP config. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:977` | `mailImapDisconnect()`; `MailImapConnect.tsx`. |
| `gmail_connect` | DESKTOP-ONLY | Runs Gmail loopback OAuth/PKCE and stores refresh token. | `src-tauri/src/commands/mail/mod.rs:991` | `gmailConnect()`; `src/features/settings/MailGmailConnect.tsx`. |
| `gmail_is_connected` | PARTIAL | Checks whether Gmail refresh token exists. Browser returns `false`. | `src-tauri/src/commands/mail/mod.rs:1008` | `gmailIsConnected()`; Gmail settings, setup checklist, matters status. |
| `gmail_disconnect` | PARTIAL | Removes Gmail refresh token. Browser no-ops. | `src-tauri/src/commands/mail/mod.rs:1013` | `gmailDisconnect()`; `MailGmailConnect.tsx`. |
| `mail_sync_all` | DESKTOP-ONLY | Syncs connected mail providers into encrypted mail store and emits indexing/progress events. | `src-tauri/src/commands/mail/mod.rs:1549` | `mailSyncAll()`; Outlook/Gmail settings sync buttons and post-connect sync. |
| `mail_send` | DESKTOP-ONLY | Sends email through M365/Gmail/IMAP with optional reply threading and attachments. | `src-tauri/src/commands/mail/mod.rs:1661` | `mailSend()`; `EmailWorkspace.tsx` compose and `EmailViewer.tsx` reply. |
| `mcp_list_pending_approvals` | BROWSER-OK empty / DESKTOP real | Reads pending MCP write approval requests from disk. Browser returns `[]`. | `src-tauri/src/commands/mcp.rs:82` | `mcpListPendingApprovals()`; `src/features/settings/McpApprovalGate.tsx`. |
| `mcp_approve_write` | BROWSER-OK no-op / DESKTOP real | Writes the user's approve/deny response for a pending MCP write. Browser no-ops. | `src-tauri/src/commands/mcp.rs:120` | `mcpApproveWrite()`; `McpApprovalGate.tsx` / `McpApprovalModal.tsx`. |
| `mcp_bundle_path` | BROWSER-OK null / DESKTOP real | Resolves the platform `.mcpb` bundle path. Browser returns `null`. | `src-tauri/src/commands/mcp.rs:155` | `mcpBundlePath()`; `src/features/settings/McpSettingsSection.tsx` Download/Revealed path. |
| `rag_set_workspace` | BROWSER-OK no-op / DESKTOP real | Points LanceDB/fastembed RAG state at a workspace. Browser no-ops. | `src-tauri/src/commands/rag/mod.rs:244` | `ragSetWorkspace()`; `MemoryService.setWorkspace()`, `useMemoryWiring.ts`. |
| `rag_index_file` | DESKTOP-ONLY | Embeds and stores one supported file, tagged with matter and privilege. | `src-tauri/src/commands/rag/mod.rs:279` | `MemoryService.indexFile()` / `reindexPaths()`; watcher and matter mapping flows. |
| `rag_index_workspace` | DESKTOP-ONLY | Walks and indexes the workspace, emitting progress and doing migrations. | `src-tauri/src/commands/rag/mod.rs:677` | `MemoryService.indexWorkspace()`; `useMemoryWiring.ts` on workspace open and reindex actions. |
| `rag_retrieve` | DESKTOP-ONLY | Retrieves semantic hits from local RAG store with matter/privilege filtering. | `src-tauri/src/commands/rag/mod.rs:930` | `MemoryService.retrieve()`; AI chat retrieval, `PrivilegeExclusionExplainer.tsx`, workflow legal analysis. |
| `rag_verify_citation` | DESKTOP-ONLY | Verifies a citation id/text/matter claim before surfacing an answer. | `src-tauri/src/commands/rag/mod.rs:1114` | `ragVerifyCitation()`; `src/app/workflow/useWorkflowRunner.ts`, `src/platform/rag/workspaceCommand.ts`, `SourcePanel.tsx`, workflow legal analysis. |
| `rag_cancel_indexing` | BROWSER-OK no-op / DESKTOP real | Cancels active workspace indexing. | `src-tauri/src/commands/rag/mod.rs:1231` | `MemoryService.cancelIndexing()`; progress banner/settings actions. |
| `rag_delete_path` | BROWSER-OK no-op / DESKTOP real | Removes chunks for a deleted/moved path. | `src-tauri/src/commands/rag/mod.rs:1240` | `MemoryService.deletePath()`; watcher/file delete flows. |
| `rag_index_pdf_chunks` | DESKTOP-ONLY | Stores pre-extracted PDF/OCR page chunks into RAG. | `src-tauri/src/commands/rag/mod.rs:1284` | `MemoryService.indexPdfFile()` after renderer PDF/OCR extraction. |
| `rag_retag_privilege` | BROWSER-OK `0` / DESKTOP real | Re-tags existing chunks with privilege status without re-embedding. | `src-tauri/src/commands/rag/mod.rs:1335` | `MemoryService.retagPrivilege()`; privilege UI for files/email/chat. |
| `rag_retag_matter` | BROWSER-OK `0` / DESKTOP real | Re-tags existing chunks with matter id without re-embedding. | `src-tauri/src/commands/rag/mod.rs:1378` | `MemoryService.retagMatter()`; matter mapping for files/email. |
| `model_status` | DESKTOP-ONLY | Reports local embedding model lifecycle: ready/absent/downloading. | `src-tauri/src/commands/rag/model_download.rs:286` | `modelStatus()`; `useModelStatus.ts`, `useMemoryWiring.ts`, `ModelDownloadCard.tsx`. No browser guard in wrapper. |
| `model_ensure` | DESKTOP-ONLY | Downloads/verifies the e5-small embedding model with progress events. | `src-tauri/src/commands/rag/model_download.rs:304` | `modelEnsure()`; `useModelStatus.ts` / `ModelDownloadCard.tsx`. |
| `tts_sidecar_available` | DESKTOP-ONLY | Checks for Piper binary and bundled voice model. | `src-tauri/src/commands/tts.rs:119` | Direct invoke in `src/features/dictation/engine/TTSService.ts`; status UI in `VoiceOutputSettingsSection.tsx`. |
| `tts_speak` | DESKTOP-ONLY | Synthesizes WAV speech bytes through Piper sidecar. | `src-tauri/src/commands/tts.rs:128` | `TTSService.speak()` / `ReadAloudButton.tsx`. |
| `tts_stop` | DESKTOP-ONLY | Stops active Piper speech. | `src-tauri/src/commands/tts.rs:160` | `TTSService.stop()` / audio controls. |
| `tts_download_voice` | DESKTOP-ONLY | Downloads a voice model into app data. | `src-tauri/src/commands/tts.rs:168` | `TTSService.downloadVoice()` / voice picker/settings. |
| `vault_status` | DESKTOP-ONLY | Reads vault metadata and reports lock/enabled state. | `src-tauri/src/commands/vault/mod.rs:371` | `vaultStatus()` in `src/platform/firm/vault/vaultClient.ts`; `BackendFactory.ts`, vault prompts/settings. |
| `vault_create` | DESKTOP-ONLY | Creates workspace vault metadata, VMK, verifier, and recovery phrase. | `src-tauri/src/commands/vault/mod.rs:412` | `vaultCreate()`; `vaultStore.ts`, `src/features/firm/vault/VaultEnableFlow.tsx`. |
| `vault_read_file` | DESKTOP-ONLY | Decrypts one vaulted file and returns bytes. | `src-tauri/src/commands/vault/mod.rs:486` | `VaultFSBackend.ts`, `vaultClient.ts`; all file reads once a workspace is vaulted. |
| `vault_write_file` | DESKTOP-ONLY | Encrypts and writes one vaulted file. | `src-tauri/src/commands/vault/mod.rs:515` | `VaultFSBackend.ts`, `vaultClient.ts`; all file writes once a workspace is vaulted. |
| `vault_unlock_with_recovery` | DESKTOP-ONLY | Unlocks/reseals VMK using recovery phrase. | `src-tauri/src/commands/vault/mod.rs:556` | `vaultUnlockWithRecovery()`; `RecoveryPhraseCeremony.tsx`, `VaultLockedPrompt.tsx`. |
| `vault_export_vmk_for_escrow` | DESKTOP-ONLY | Exports VMK for admin escrow wrapping while unlocked. | `src-tauri/src/commands/vault/mod.rs:613` | `vaultExportVmkForEscrow()`; escrow provisioning in `vaultClient.ts`. |
| `vault_set_escrow_wraps` | DESKTOP-ONLY | Persists wrapped VMK escrow entries. | `src-tauri/src/commands/vault/mod.rs:641` | `vaultSetEscrowWraps()`; firm/admin escrow setup. |
| `vault_encrypt_all` | DESKTOP-ONLY | Migrates all eligible workspace files into encrypted vault format. | `src-tauri/src/commands/vault/mod.rs:678` | `vaultEncryptAll()`; `vaultStore.ts`, `VaultEnableFlow.tsx`. |
| `vault_decrypt_all` | DESKTOP-ONLY | Decrypts all vaulted files back to normal files. | `src-tauri/src/commands/vault/mod.rs:711` | `vaultDecryptAll()`; `VaultEscapeHatchDialog.tsx`, locked prompt escape hatch. |
| `vault_disable` | DESKTOP-ONLY | Safety-scans and disables vault metadata/keychain entry after decrypt. | `src-tauri/src/commands/vault/mod.rs:744` | `vaultDisable()`; `VaultEscapeHatchDialog.tsx`. |
| `voice_sidecar_available` | BROWSER-OK false / DESKTOP real | Checks whether bundled transcription sidecar is available. | `src-tauri/src/commands/voice.rs:112` | `voiceSidecarAvailable()` and `voiceStatus.ts`; voice input status. |
| `transcribe_audio` | DESKTOP-ONLY | Transcribes WAV bytes with bundled sidecar. | `src-tauri/src/commands/voice.rs:144` | `transcribeAudio()`; `src/features/dictation/voice/PressToTalk.tsx`. |
| `watch_workspace` | BROWSER-OK no-op / DESKTOP real | Starts native workspace watcher and emits file-change events. | `src-tauri/src/commands/watcher.rs:114` | `watchWorkspace()`; `src/platform/hooks/useMemoryWiring.ts` keeps RAG/file index current. |

## Feature Boundary Summary

| Feature / user action | Browser status | Desktop-only boundary |
|---|---|---|
| App shell, navigation, settings, command palette, light UI, most dialogs | BROWSER-OK | None, except desktop-only buttons need graceful disabled/error states. |
| Workspace file create/edit/delete for text/Markdown | BROWSER-OK via `WebFSBackend` / test `__mockWorkspaceFs` | Real disk persistence, native watcher, explorer reveal, and vaulted workspaces need desktop. |
| Open on Desktop | Browser shows fallback alert | `open_in_explorer`. |
| `.docx` open/edit/autosave/tracked changes/AI redline/export | Browser should show read-only/fallback state | `docx_*`, `convert_docx_to_pdf`, native save path, optional LibreOffice. |
| Legacy `.doc` convert and PowerPoint preview | Browser can show unavailable state | `detect_libreoffice`, `convert_doc_to_docx`, `convert_ppt_to_pdf`. |
| Markdown smart paste URL title | BROWSER-OK with empty-title fallback | Real title fetch uses `fetch_url_title`. |
| API key entry in browser | BROWSER-OK localStorage/dev backend | Secure provider/firm secrets require `keychain_*`. |
| Firm password sign-in / org claim / seat activation | PARTIAL in browser with fetch + localStorage fallback | Production security requires OS keychain; SSO requires `firm_sso_authenticate`. |
| Firm SSO login | DESKTOP-ONLY | `firm_sso_authenticate` loopback/system-browser flow. |
| Firm shared matter notes and co-edit transport | PARTIAL browser unit/E2E with localStorage fallback and mocked/in-process relay patterns | Real desktop must combine keychain secrets, live firm API, real relay WebSocket, and file persistence. |
| Ethical walls / member removal / key epoch rotation | PARTIAL unit/browser coverage | Real desktop must prove stale key purge from OS keychain and fail-closed relay behavior. |
| Encrypted workspace vault | DESKTOP-ONLY | `vault_*`, OS keychain VMK, `VaultFSBackend`, real file migration. |
| Email list/search UI | BROWSER-OK only with `?mailFixture=1`; otherwise empty | Real import/read/send requires mail OAuth, SQLCipher encrypted store, keychain tokens, provider APIs. |
| Email body, attachments, send/reply | DESKTOP-ONLY | `mail_get_message`, `mail_get_attachment`, `mail_send`. |
| Semantic memory/RAG | DESKTOP-ONLY for real data | `model_*`, `rag_*`, LanceDB/fastembed, local model files, watcher. Browser tests can only cover UI states/mocks. |
| AI chat with real cloud models | BROWSER-OK via Vite proxy per full user-test playbook | RAG-backed cited answers and citation verification need desktop RAG. |
| Audit log UI | BROWSER-OK with localStorage audit | Encrypted defense-file audit is desktop `audit_*`. |
| MCP settings UI | BROWSER-OK for static UI / empty approvals | Real pending approvals and bundle path are desktop `mcp_*`. |
| Voice dictation / transcription | Browser can capture UI states | `voice_*` sidecar required for real transcription. |
| Read aloud / TTS | UI/settings can render | `tts_*` Piper sidecar required for real speech. |
| Marketplace browse | BROWSER-OK for catalog UI with mocked network | Install/extract/checksum is desktop `sha256_file` + `extract_tarball`. |
| Auto-updater | Browser can test banner store/UI only | Real update check/download/restart is Tauri updater plugin, not custom `#[tauri::command]`. |

## Existing Automated Coverage Notes

Coverage is broad, but it is mostly not native integrated coverage:

- Browser E2E: many `tests/e2e/**` and `tests/campaign/**` suites drive the Vite app with `?testMode=true`; these cover shell, file UI, chat UI, email fixture list/search, settings, and some firm collaboration UX.
- Renderer/unit IPC mocks: `tests/unit/docx-commands.test.ts`, `tests/unit/DocxEditor.test.tsx`, `tests/unit/vault/vaultClient.test.ts`, `tests/unit/vault/vaultFsBackend.test.ts`, `tests/unit/mail-commands.test.ts`, firm SSO/key distribution tests, TTS tests, and marketplace install tests assert wrapper calls and mocked behavior.
- Rust/native unit or integration: `src-tauri/crates/keepance-docx/tests/**`, `src-tauri/crates/keepance-vault/tests/destructive.rs`, `src-tauri/tests/rag_*.rs`, `src-tauri/tests/mcp_binary.rs`, and ignored live mail harnesses in `src-tauri/tests/mail_e2e.rs`.
- Gap: no automated harness was found that launches the desktop app and drives real UI + real IPC end to end for the highest-risk data/auth/collaboration workflows.

## Top 10 Desktop-Only Integrated Journeys Needing Native Coverage

These are "no automated integrated desktop coverage" gaps. Some have unit, mocked IPC, Rust-only, or browser-fixture coverage; the missing layer is a real app journey through Tauri IPC and observable UI.

| Rank | Journey | Why high risk | Commands / native boundaries | Existing partial coverage | Recommended native test |
|---:|---|---|---|---|---|
| 1 | Create or claim a firm org, sign in, activate a seat, quit/reopen, and verify the firm session hydrates from OS keychain. | Auth, entitlement, paid tier access, token persistence, customer onboarding. | `keychain_*`, firm API HTTP, seat token verification. SSO variant also `firm_sso_authenticate`. | Unit tests for firm store/entitlement/seat token; no full desktop create/claim -> activate -> relaunch path found. | L2/L3 desktop harness with disposable firm backend org and test license; assert UI state, keychain persistence, and no localStorage secrets. |
| 2 | Firm SSO login through configured OIDC provider. | Loopback/browser auth is brittle and platform-specific; failure blocks enterprise login. | `firm_sso_authenticate`, system browser, localhost callback, firm token storage. | `tests/unit/firm/signInSso.test.ts`; `docs/quality/2026-06-11-wave3a-sso/RESULTS.md` manual run. | Automated desktop run against Dex/test IdP, asserting successful session and stored tokens. |
| 3 | Ethical wall: admin walls a member from a shared matter; member already has notes/doc open; member loses access, stale matter key is purged, UI fails closed. | Confidentiality boundary; most severe legal/privacy failure if wrong. | Firm relay, `keychain_delete`, `fetchMatterKeys` 403/404, key epoch rotation, `MatterSyncClient`/`MatterDocSyncClient`. | Browser E2E `tests/e2e/firm-collaboration.spec.ts` and unit key-distribution tests; likely uses localStorage fallback/mocks. | Two desktop clients/profiles against test relay; assert old key removed from OS keychain and updates cannot decrypt or push. |
| 4 | Shared matter notes co-editing across two real desktop app instances. | Core Firm promise; combines relay, E2EE, presence, catch-up, conflict handling, offline/online. | Firm API push/pull/ticket/WS, OS keychain matter keys, Yjs CRDT. | Unit tests for `MatterSyncClient`, browser `firm-collaboration.spec.ts`; no real desktop multi-instance run found. | Launch two isolated app profiles, sign into two users, edit same matter notes concurrently, restart both, assert convergence and ciphertext-only relay. |
| 5 | Live multi-user `.docx` co-editing with tracked changes and comments. | Highest data-loss/fidelity risk: OOXML DOM + CRDT + relay + autosave. | `docx_open`, `docx_save`, `docx_author_revisions`, `docx_resolve_*`, `MatterDocSyncClient`, keychain, relay. | `tests/unit/coedit/**`, `tests/unit/DocxEditor.test.tsx`, Rust DOCX crate tests. No real app two-desktop DOCX co-edit run found. | Two desktop profiles open same shared `.docx`, make edits/redlines/comments, accept/reject, relaunch, compare resulting `.docx` with Rust parser. |
| 6 | Enable encrypted vault on a real workspace, migrate files, quit/reopen locked/unlocked states, recover with phrase, then disable via escape hatch. | Data-loss and recoverability risk; touches every file read/write path. | `vault_create`, `vault_encrypt_all`, `vault_status`, `vault_read_file`, `vault_write_file`, `vault_unlock_with_recovery`, `vault_decrypt_all`, `vault_disable`, OS keychain. | Vault client/unit tests and crate destructive tests; no UI-driven desktop migration/recovery run found. | Temp workspace with text/docx/pdf fixtures; drive Vault UI; verify files are KPV1 on disk, readable through app, recoverable after keychain wipe, and clean after disable. |
| 7 | Real Outlook/Gmail/IMAP connect -> sync -> Email tab shows imported mail -> open body -> attachment -> send/reply. | OAuth, SQLCipher mail store, encrypted blob decrypt, provider variance, user trust. | `outlook_connect`, `gmail_connect`, `mail_imap_connect`, `mail_sync_all`, `mail_list_messages`, `mail_get_message`, `mail_get_attachment`, `mail_send`, `keychain_*`. | Browser `?mailFixture=1`; unit mail tests; ignored live import harnesses in `src-tauri/tests/mail_e2e.rs`. No full UI desktop import-to-view test found. | Desktop harness with fixture IMAP server plus one live OAuth smoke; assert encrypted store rows, UI counts, body rendering, attachment bytes, and no plaintext disk writes. |
| 8 | Semantic search index build: first-run model download, workspace indexing over DOCX/PDF/OCR/transcript/mail, cited Ask answer verifies and click-through opens source. | Core product promise; combines model files, extraction, indexing, retrieval, citation verification, source navigation. | `model_status`, `model_ensure`, `rag_index_workspace`, `rag_index_file`, `rag_index_pdf_chunks`, `rag_retrieve`, `rag_verify_citation`, `mail_backfill_rag`, `watch_workspace`. | Rust RAG tests and wedge-proof manual artifacts; browser cannot run real RAG. | Desktop temp workspace using `tests/fixtures/matter-corpus`; drive indexing UI, ask known questions, assert verified citations and correct source open. |
| 9 | Privilege and matter scoping in real retrieval: privileged source excluded by default; include-privileged opt-in works; cross-matter leakage is blocked. | Confidentiality and legal ethics boundary. | `rag_retag_privilege`, `rag_retag_matter`, `rag_retrieve`, `rag_verify_citation`, mail/file matter mapping commands. | Rust `rag_matter_scope.rs` store-layer tests; UI unit/browser tests. No full desktop UI + real index test found. | Desktop index two matters plus privileged docs/mail; exercise UI toggles and assert returned citations never cross scope unless explicitly requested. |
| 10 | Marketplace install of a real template package into the workspace and subsequent run/audit. | Supply-chain/install path: checksum, tar extraction, filesystem writes, audit trail. | `sha256_file`, `extract_tarball`, audit commands, workspace FS. | Integration tests mock invoke; browser E2E documents native throw. No real desktop install smoke found. | Desktop test with local fixture catalog/tarball; assert checksum enforcement, extraction path safety, template appears, workflow runs, audit row exists. |

## Suggested Test Plan Layers

- **L1 browser-dev**: Continue using Playwright/Vite for app shell, layout, settings, browser fallbacks, mail fixture list/search, chat with cloud provider proxy, file UI, and graceful desktop-only messaging.
- **L2 desktop-local**: Add a Tauri-driver harness for Linux that launches the built app with an isolated app data dir and temp workspace. Cover vault, DOCX, RAG/model, audit, marketplace install, Open on Desktop fallback behavior, and local keychain behavior where available.
- **L3 live-service harness**: Use disposable firm backend/relay and provider OAuth/IMAP fixtures. Cover firm auth/seat activation, SSO, shared matter sync, ethical walls, mail import/send.
- **L4 platform/signed-build manual or CI matrix**: Windows/macOS keychain specifics, installer/updater, code-signing/notarization, OS file manager integration, and LibreOffice detection/conversion on each OS.

## Open Questions For Test Design

- Should the native desktop harness use Tauri WebDriver, Playwright against the webview debug port, or a command-level harness plus screenshots? The current repo has browser Playwright depth but no obvious desktop UI driver.
- Should firm relay tests run against `api.keepance.com` staging or a local disposable backend? For destructive wall/seat/key tests, local/staging is safer than production.
- Should live mail import tests use real Outlook/Gmail accounts, fixture IMAP only, or both? Recommendation: fixture IMAP on every run, OAuth smoke on scheduled/manual runs.
- Should vault recovery tests deliberately wipe only Advisor Prep Hero keychain entries or run under a throwaway OS user/keyring? Recommendation: isolated app data plus explicit Advisor Prep Hero service-prefix cleanup.
