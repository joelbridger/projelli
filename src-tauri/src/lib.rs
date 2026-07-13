// Business OS - Tauri Backend
// Local-first workspace for solo founders

// `pub` so the `lantern-mcp` sidecar binary (see `src/bin/mcp.rs`) can
// reuse the `commands::rag::{store, embedder, extractor}` helpers without
// duplicating code. The binary only touches the pure, Tauri-agnostic
// sub-modules; the `#[tauri::command]` wrapper fns stay host-only in
// practice even though the module path is now public.
pub mod commands;
// Permanent runtime identity constants (keychain services, data-dir names,
// MCP identifiers, OS data paths). Single source of truth for all
// Rust-side identity strings — call sites import from here, never hard-code.
pub mod identity;
// Shared Sidecar trait + concrete impls (ParakeetSidecar, and later
// PiperSidecar for Stream B TTS). The trait defines a lifecycle contract
// (start/stop/is_running) that long-lived daemon sidecars and fire-and-forget
// per-request sidecars both satisfy via appropriate no-ops.
pub mod sidecars;
// Cross-cutting utilities (process helpers, etc.).
pub mod util;
// The Windows bench's local-only automation bridge. This module is absent from
// release artifacts, so port 9250 can never be opened by a production build.
#[cfg(debug_assertions)]
mod dev_bridge;
// Shared WebView2 additional-browser-args string used by EVERY webview window
// (main + Notice Card companion). Centralized so the windows are byte-identical,
// which is what prevents the 0x8007139F (ERROR_INVALID_STATE) crash when a
// second webview is created with mismatched options. See the module docs.
pub mod webview_env;

/// A debug-only, startup-only bridge from the process environment to the
/// renderer. The webview executes this before its application JavaScript, so
/// `App.tsx` can decide whether first-run decoration should render without a
/// later flash or a synthetic click. Release builds never compile this path.
#[cfg(debug_assertions)]
fn test_mode_initialization_script() -> Option<&'static str> {
    matches!(
        std::env::var("LANTERN_TEST_MODE").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE")
    )
    .then_some("window.__LANTERN_TEST_MODE__ = true;")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(crate::commands::tts::TtsState(tokio::sync::Mutex::new(
            crate::sidecars::PiperSidecar::new(
                // Resolved at runtime; placeholder path. Real resolution happens
                // inside each command via the AppHandle.
                std::path::PathBuf::from(""),
                std::path::PathBuf::from(""),
            ),
        )))
        .invoke_handler(tauri::generate_handler![
            #[cfg(debug_assertions)]
            dev_bridge::dev_bridge_result,
            commands::fs::check_path,
            commands::fs::get_home_dir,
            // First-launch migration of the per-workspace data folder
            // (`.lantern` → `.lantern`). Called from the renderer at workspace
            // open, BEFORE any store (audit/mail/rag/…) is opened.
            commands::data_dir::migrate_workspace_data_dir,
            // Resolve the live internal data-dir name (`.lantern` / legacy
            // `.lantern`) so renderer-side writers land on the same folder the
            // Rust stores use, even in the migration fail-safe state.
            commands::data_dir::resolve_workspace_data_dir_name,
            commands::fs::open_in_explorer,
            commands::fs::detect_libreoffice,
            commands::fs::convert_doc_to_docx,
            commands::fs::convert_ppt_to_pdf,
            // A6: PDF export from the document editor (saved .docx -> PDF via LibreOffice).
            commands::fs::convert_docx_to_pdf,
            // Phase 2 Rust foundation for v1.5 (M1-M6 enable, Q7/Q12 real).
            commands::http::fetch_url_title,
            commands::http::ollama_list_models,
            commands::http::ollama_chat_stream,
            commands::keychain::keychain_set,
            commands::keychain::keychain_get,
            commands::keychain::keychain_delete,
            // Advisor Prep Hero 3.0 — encrypted, append-only audit store (the "defense file").
            commands::audit::audit_set_workspace,
            commands::audit::audit_append,
            commands::audit::audit_list,
            commands::audit::audit_count,
            commands::audit::audit_verify_integrity,
            commands::audit::audit_repair_seal,
            // Phase 3 M1 RAG (LanceDB + fastembed-rs + e5-small).
            commands::rag::rag_set_workspace,
            commands::rag::rag_index_file,
            commands::rag::rag_index_workspace,
            // P1.1 — boot reconcile (index once, not every launch) + PDF manifest.
            commands::rag::rag_reconcile_workspace,
            commands::rag::rag_manifest_pdf_fresh,
            commands::rag::rag_manifest_record_pdf,
            commands::rag::rag_manifest_forget_pdfs,
            commands::rag::rag_retag_matter_batch,
            commands::rag::rag_scope_write_queue_depth,
            commands::rag::rag_retrieve,
            // WS-B/C — citation verification (refuse answers whose citation doesn't verify).
            commands::rag::rag_verify_citation,
            // P2.1 (Finding 2) — batch citation verification (one table open + one
            // `id IN (...)` read for all citations, replacing the per-citation loop).
            commands::rag::rag_verify_citations_batch,
            commands::rag::rag_cancel_indexing,
            commands::rag::rag_delete_path,
            commands::rag::rag_delete_matter,
            // A3 — PDF RAG indexing bridge (JS extracts, Rust embeds+stores).
            commands::rag::rag_index_pdf_chunks,
            // WS-PRIV — re-tag a source's privilege in place (default-exclude privileged).
            commands::rag::rag_retag_privilege,
            // WS-B/C — re-tag a source's matter in place (mail/file re-scope).
            commands::rag::rag_retag_matter,
            // Option B — visible, resumable first-run download of the e5-small model.
            commands::rag::model_download::model_status,
            commands::rag::model_download::model_ensure,
            // WS3d-A — optional cross-encoder reranker: visible, resumable
            // first-run download + status (the feature itself is default-OFF).
            commands::rag::reranker_download::reranker_status,
            commands::rag::reranker_download::reranker_ensure,
            // Advisor Prep Hero Local AI — visible first-run GGUF download and lazy
            // llama.cpp server sidecar lifecycle.
            commands::local_llm::model_download::local_llm_model_status,
            commands::local_llm::model_download::local_llm_model_ensure,
            commands::local_llm::local_llm_sidecar_start,
            commands::local_llm::local_llm_sidecar_stop,
            commands::local_llm::local_llm_sidecar_health,
            commands::local_llm::local_llm_sidecar_is_running,
            // N2: rag_index_mail_text removed — latent plaintext-over-IPC surface.
            // The real indexing path is index_mail_text_internal (mail/mod.rs).
            commands::watcher::watch_workspace,
            // Phase 4 M4 (v1.5 Flag 2) — MCP approval bridge + .mcpb path.
            commands::mcp::mcp_list_pending_approvals,
            commands::mcp::mcp_approve_write,
            commands::mcp::mcp_bundle_path,
            // Phase 4 M6 (v1.5 Flag 4) — voice input via bundled
            // Parakeet/whisper.cpp sidecar.
            commands::voice::voice_sidecar_available,
            commands::voice::transcribe_audio,
            // Lantern-Plus Wave 3a — local meeting capture (mic + system-audio
            // loopback, crash-durable chunked WAV, never a cloud path).
            commands::capture::engine::capture_start,
            commands::capture::engine::capture_stop,
            commands::capture::engine::capture_status,
            commands::capture::engine::capture_free_disk_bytes,
            commands::capture::recovery::capture_find_orphans,
            commands::capture::recovery::capture_recover,
            // Wave 3b — local long-form transcription over the existing
            // per-request STT sidecar (still local-only, still no cloud path).
            commands::capture::transcribe::transcribe_meeting,
            // Stream B TTS (v2.0) — Piper sidecar speech synthesis.
            commands::tts::tts_sidecar_available,
            commands::tts::tts_speak,
            commands::tts::tts_stop,
            commands::tts::tts_download_voice,
            // Stream C1 (v2.0): Templates Marketplace install pipeline.
            commands::checksum::sha256_file,
            commands::tarball::extract_tarball,
            // WS-A / A1 (v3.0): in-house OOXML document engine. Open a .docx
            // into the JSON DOM, save it back preserving unmodeled parts, and
            // author AI tracked changes (the helper A4 calls).
            commands::docx::docx_open,
            commands::docx::docx_save,
            commands::docx::docx_author_revision,
            // AI redline (A4) — apply a BATCH of edits drift-safely in one pass.
            commands::docx::docx_author_revisions,
            // Editor (A3) accept/reject tracked changes — one revision or all.
            commands::docx::docx_resolve_revision,
            commands::docx::docx_resolve_all,
            // A6: discoverable Export — faithful Word (.docx) copy + privilege-safe
            // "clean copy" (strip hidden metadata, optionally accept-all + drop comments).
            commands::docx::docx_export_copy,
            commands::docx::docx_export_clean_copy,
            // VG-4c: re-house generated deliverable bytes inside a firm
            // letterhead template package (sectPr-safe).
            commands::docx::docx_apply_letterhead,
            // Phase 1 email — Microsoft 365 import.
            commands::mail::mail_set_workspace,
            commands::mail::mail_begin_login,
            commands::mail::mail_poll_login,
            commands::mail::mail_is_connected,
            commands::mail::mail_disconnect,
            commands::mail::mail_sync_all,
            commands::mail::mail_cancel_sync,
            // Advisor Prep Hero 3.0 email viewer — fetch + decrypt one stored message.
            commands::mail::mail_get_message,
            // Mail browse/search surface — metadata-only, never decrypts a blob.
            commands::mail::mail_list_messages,
            // F2.6b — per-client mail browse, isolation enforced in the engine.
            commands::mail::mail_list_messages_by_matter,
            // WS-B/C — re-tag a mail folder's messages to a matter in place.
            commands::mail::mail_retag_folder_matter,
            commands::mail::mail_retag_messages_matter,
            // Re-tag a single message's RAG chunks to a matter in place.
            commands::mail::mail_retag_message_matter,
            // Source-level recovery for a filing whose RAG scope update failed.
            commands::mail::mail_list_pending_rag_retags,
            commands::mail::mail_repair_pending_rag_retags,
            // Clear every email's filing for a matter being deleted (BUG-042).
            commands::mail::mail_clear_matter_filings,
            // Fetch one attachment's bytes on demand (never writes to disk).
            commands::mail::mail_get_attachment,
            // Save one provider attachment directly into the workspace; bytes
            // do not cross into the renderer.
            commands::mail::mail_persist_attachment,
            // Option B — heal mail RAG indexing that failed while the embedding
            // model was still downloading (no-op when the marker is absent).
            commands::mail::mail_backfill_rag,
            // WS-B/C — list connected mail accounts for the matter-mapping UI.
            commands::mail::mail_connected_accounts,
            // G6 — OS full-disk encryption detection + nudge in MailConnect.
            commands::mail::fde::mail_fde_status,
            // IMAP multi-provider support.
            commands::mail::mail_imap_connect,
            commands::mail::mail_imap_is_connected,
            commands::mail::mail_imap_disconnect,
            // Gmail native provider (loopback PKCE OAuth).
            commands::mail::gmail_connect,
            commands::mail::gmail_connect_cancel,
            commands::mail::gmail_oauth_configured,
            commands::mail::gmail_is_connected,
            commands::mail::gmail_disconnect,
            // Outlook loopback auth-code + PKCE (replaces device-code for personal accounts).
            commands::mail::outlook_connect,
            commands::mail::outlook_connect_cancel,
            // Email send — compose and send from any connected provider (M365/Gmail/IMAP).
            commands::mail::mail_send,
            // Wave 0 — save an AI-proposed draft into the account's real mailbox Drafts folder.
            commands::mail::mail_save_draft,
            // Plan 1B.4 — Wealthbox CRM connector commands (connect/sync/status/disconnect).
            commands::crm::commands::crm_set_workspace,
            commands::crm::commands::crm_connect,
            commands::crm::commands::crm_oauth_connect,
            commands::crm::commands::crm_oauth_connect_cancel,
            commands::crm::commands::crm_is_connected,
            commands::crm::commands::crm_disconnect,
            commands::crm::commands::crm_rebuild_store,
            commands::crm::commands::crm_sync_all,
            commands::crm::commands::crm_sync_status,
            commands::crm::commands::crm_cancel_sync,
            commands::crm::commands::crm_list_households,
            // Lantern-Plus Wave 2 — approval-gated CRM write-back (Wealthbox first).
            commands::crm::commands::crm_save_write_proposal,
            commands::crm::commands::crm_prepare_write_proposal,
            commands::crm::commands::crm_approve_write_proposal,
            commands::crm::commands::crm_list_write_proposals,
            commands::crm::commands::crm_delete_write_proposal,
            // Lantern Intake — encrypted facts store and audit-gated reveals/purges.
            commands::intake::intake_set_workspace,
            commands::intake::intake_pdf_template_artifact_write,
            commands::intake::intake_pdf_template_artifact_read,
            commands::intake::intake_pdf_template_artifact_delete,
            commands::intake::intake_fact_upsert,
            commands::intake::intake_fact_list,
            commands::intake::intake_fact_reveal,
            commands::intake::intake_fact_purge,
            commands::intake::intake_email_reply_save_proposal,
            commands::intake::intake_email_reply_save_quarantine,
            commands::intake::intake_email_reply_list_proposals,
            commands::intake::intake_email_reply_get_proposal,
            commands::intake::intake_email_reply_mark_row_completed,
            commands::intake::intake_email_reply_set_proposal_status,
            commands::intake::intake_document_extraction_save_proposal,
            commands::intake::intake_document_extraction_list_proposals,
            commands::intake::intake_document_extraction_get_proposal,
            commands::intake::intake_document_extraction_accept_row,
            commands::intake::intake_document_extraction_mark_row_completed,
            commands::intake::intake_document_extraction_set_proposal_status,
            commands::intake::intake_email_reply_list_quarantines,
            commands::intake::intake_email_reply_get_quarantine,
            commands::intake::intake_email_reply_set_quarantine_status,
            // Lantern-Plus Track 2 — generic approval-gated writeback engine.
            commands::writeback::commands::external_write_set_workspace,
            commands::writeback::commands::external_write_save_proposal,
            commands::writeback::commands::external_write_prepare_proposal,
            commands::writeback::commands::external_write_approve_proposal,
            commands::writeback::commands::external_write_list_proposals,
            commands::writeback::commands::external_write_delete_proposal,
            commands::crm::commands::crm_create_note,
            commands::crm::commands::crm_create_task,
            commands::crm::commands::crm_update_field,
            commands::crm::core_commands::crm_core_cursor,
            commands::crm::core_commands::crm_core_record_applied,
            commands::crm::core_commands::crm_core_commit_propagation,
            commands::crm::core_commands::crm_live_upsert,
            commands::crm::core_commands::crm_live_upsert_many,
            commands::crm::core_commands::crm_live_list,
            commands::crm::search::crm_search,
            commands::crm::migration_commands::crm_migration_import,
            commands::crm::migration_commands::crm_migration_export,
            // OneDrive / SharePoint document connector (read-only Graph import).
            commands::onedrive::commands::onedrive_set_workspace,
            commands::onedrive::commands::onedrive_connect,
            commands::onedrive::commands::onedrive_connect_cancel,
            commands::onedrive::commands::onedrive_begin_login,
            commands::onedrive::commands::onedrive_poll_login,
            commands::onedrive::commands::onedrive_is_connected,
            commands::onedrive::commands::onedrive_disconnect,
            commands::onedrive::commands::onedrive_list_drives,
            commands::onedrive::commands::onedrive_list_folders,
            commands::onedrive::commands::onedrive_sync,
            commands::onedrive::commands::onedrive_cancel,
            commands::onedrive::commands::onedrive_status,
            // Box document connector (read-only Developer Token import).
            commands::boxc::commands::box_set_workspace,
            commands::boxc::commands::box_connect,
            commands::boxc::commands::box_is_connected,
            commands::boxc::commands::box_disconnect,
            commands::boxc::commands::box_list_folders,
            commands::boxc::commands::box_sync,
            commands::boxc::commands::box_cancel,
            commands::boxc::commands::box_status,
            // ShareFile document connector (read-only portal import).
            commands::sharefile::commands::sharefile_set_workspace,
            commands::sharefile::commands::sharefile_connect,
            commands::sharefile::commands::sharefile_is_connected,
            commands::sharefile::commands::sharefile_disconnect,
            commands::sharefile::commands::sharefile_list_folders,
            commands::sharefile::commands::sharefile_sync,
            commands::sharefile::commands::sharefile_cancel,
            commands::sharefile::commands::sharefile_status,
            // Read-only DocuSign connector — completed envelopes + signing timeline.
            commands::docusign::commands::docusign_set_workspace,
            commands::docusign::commands::docusign_connect,
            commands::docusign::commands::docusign_is_connected,
            commands::docusign::commands::docusign_disconnect,
            commands::docusign::commands::docusign_sync,
            commands::docusign::commands::docusign_cancel_sync,
            commands::docusign::commands::docusign_sync_status,
            commands::docusign::commands::docusign_list_unassigned,
            // Read-only Jotform connector — intake/KYC submissions.
            commands::jotform::commands::jotform_set_workspace,
            commands::jotform::commands::jotform_connect,
            commands::jotform::commands::jotform_is_connected,
            commands::jotform::commands::jotform_disconnect,
            commands::jotform::commands::jotform_list_forms,
            commands::jotform::commands::jotform_sync,
            commands::jotform::commands::jotform_cancel,
            commands::jotform::commands::jotform_status,
            commands::jotform::commands::jotform_list_unassigned,
            // Read-only Zocks connector — meeting notes/transcripts into client memory.
            commands::zocks::commands::zocks_set_workspace,
            commands::zocks::commands::zocks_connect,
            commands::zocks::commands::zocks_is_connected,
            commands::zocks::commands::zocks_disconnect,
            commands::zocks::commands::zocks_list_sessions,
            commands::zocks::commands::zocks_sync,
            commands::zocks::commands::zocks_cancel,
            commands::zocks::commands::zocks_status,
            commands::zocks::commands::zocks_list_unassigned,
            // Read-only Addepar portfolio connector — household holdings/performance.
            commands::addepar::commands::addepar_set_workspace,
            commands::addepar::commands::addepar_connect,
            commands::addepar::commands::addepar_is_connected,
            commands::addepar::commands::addepar_disconnect,
            commands::addepar::commands::addepar_list_entities,
            commands::addepar::commands::addepar_sync,
            commands::addepar::commands::addepar_cancel,
            commands::addepar::commands::addepar_status,
            // Calendly connector — read-only scheduled events + invitee Q&A.
            commands::calendly::commands::calendly_set_workspace,
            commands::calendly::commands::calendly_connect,
            commands::calendly::commands::calendly_is_connected,
            commands::calendly::commands::calendly_disconnect,
            commands::calendly::commands::calendly_sync_all,
            commands::calendly::commands::calendly_sync_status,
            commands::calendly::commands::calendly_cancel_sync,
            // Calendar connector — read-only Outlook/Google/ICS events.
            commands::calendar::commands::calendar_set_workspace,
            commands::calendar::commands::calendar_connect_outlook,
            commands::calendar::commands::calendar_connect_outlook_cancel,
            commands::calendar::commands::calendar_connect_google,
            commands::calendar::commands::calendar_connect_google_cancel,
            commands::calendar::commands::calendar_connect_ics,
            commands::calendar::commands::calendar_is_connected,
            commands::calendar::commands::calendar_disconnect,
            commands::calendar::commands::calendar_sync_all,
            commands::calendar::commands::calendar_sync_status,
            commands::calendar::commands::calendar_cancel_sync,
            commands::calendar::commands::calendar_list_events,
            // Notice Card — isolated companion-webview lifecycle (open/close/status).
            commands::notice_card::notice_card_open,
            commands::notice_card::notice_card_close,
            commands::notice_card::notice_card_status,
            commands::notice_card::notice_card_announce,
            // Wave 3a SSO — firm-tier OIDC desktop dance (loopback + browser).
            commands::firm::sso::firm_sso_authenticate,
            commands::firm::sso::firm_sso_cancel,
            // Wave 3b encrypted vault — per-workspace AES-256-GCM at-rest encryption.
            commands::vault::vault_status,
            commands::vault::vault_create,
            commands::vault::vault_read_file,
            commands::vault::vault_write_file,
            // Task 9: recovery unlock + escrow export/set.
            commands::vault::vault_unlock_with_recovery,
            commands::vault::vault_export_vmk_for_escrow,
            commands::vault::vault_set_escrow_wraps,
            // Task 10: migration + escape-hatch + disable.
            commands::vault::vault_encrypt_all,
            commands::vault::vault_decrypt_all,
            commands::vault::vault_disable,
            // Onboarding/setup progress — one unified, queryable snapshot of all
            // five first-run setup signals, plus a renderer hook to report the
            // frontend-only Client Map build counts.
            commands::setup_progress::get_setup_progress,
            commands::setup_progress::setup_report_client_map,
            // Wave 4 Track A — within-channel speaker diarization + naming.
            commands::diarize::diarize_meeting,
            commands::diarize::apply_speaker_names,
            // Wave 4 Track A — encrypted per-matter voiceprint store.
            commands::voiceprint::voiceprint_list,
            commands::voiceprint::voiceprint_enroll,
            commands::voiceprint::voiceprint_match,
            commands::voiceprint::voiceprint_confirm,
            commands::voiceprint::voiceprint_delete,
            // Wave 4 Track D — per-workspace retention policy sweep.
            commands::retention::retention_sweep,
            commands::retention::retention_read_pending_rag_cleanup,
            commands::retention::retention_clear_pending_rag_cleanup_id,
            commands::retention::redact::redact_meeting_segments,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(debug_assertions)]
            crate::dev_bridge::manage_state(app);
            // The main window is created here (not via `tauri.conf.json`'s
            // automatic `create: true` path — see `"create": false` there) so
            // Windows debug builds can start WebView2 with a CDP debug port.
            //
            // Important split:
            // - Release/non-Windows keeps today's explicit wry args behavior.
            // - Windows debug also passes the full string directly through wry's
            //   `AdditionalBrowserArguments` path. In wry 0.55.1 this is the
            //   path that makes the Edge/WebView2 child process visibly carry
            //   `--remote-debugging-port=...`; the attempted custom-environment
            //   path succeeded but did not open CDP on the Windows bench.
            if let Some(window_config) = app.config().app.windows.first() {
                let builder =
                    tauri::WebviewWindowBuilder::from_config(app.handle(), window_config)?;

                // A workspace supplied on the command line (or through the
                // dedicated environment variable) is an automation affordance,
                // not a replacement for normal first-run onboarding. Pass it to
                // the renderer only after the host has proved it is a real
                // directory. JSON encoding keeps unusual but valid path
                // characters from becoming executable script text.
                #[cfg(debug_assertions)]
                let builder = if let Some(workspace) = explicit_launch_workspace() {
                    let workspace_json = serde_json::to_string(&workspace)
                        .expect("serializing a workspace path cannot fail");
                    builder.initialization_script(format!(
                        "window.__LANTERN_WORKSPACE__ = {workspace_json};"
                    ))
                } else {
                    builder
                };

                // CRM test drives need a visible test-mode flag as well as the
                // optional workspace path above. Tauri keeps both startup
                // scripts, so neither automation contract replaces the other.
                #[cfg(debug_assertions)]
                let builder = match test_mode_initialization_script() {
                    Some(script) => builder.initialization_script(script),
                    None => builder,
                };

                // A release build deliberately has no command-line or
                // environment workspace override at all. This makes the
                // automation-only capability impossible to invoke in shipped
                // binaries, even if an environment variable is present.
                #[cfg(not(debug_assertions))]
                let builder = builder;

                #[cfg(all(windows, debug_assertions))]
                let builder = {
                    let browser_args = crate::webview_env::debug_webview_browser_args("main");
                    log::info!("[webview2-debug] main: window_path=additional_browser_args");
                    builder.additional_browser_args(&browser_args)
                };

                #[cfg(not(all(windows, debug_assertions)))]
                let builder = {
                    // The SAME string the Notice Card companion window uses
                    // outside Windows debug builds. Both windows MUST pass an
                    // identical args string or the second webview can fail with
                    // WebView2 0x8007139F (ERROR_INVALID_STATE).
                    let browser_args = crate::webview_env::webview_browser_args();
                    builder.additional_browser_args(&browser_args)
                };

                builder.build()?;

                #[cfg(debug_assertions)]
                crate::dev_bridge::start(app.handle().clone());
            }
            // Check the OS-level data subdir (`<data_dir>/lantern`, holding
            // downloaded models + logs) once at startup, before anything
            // resolves a model/log path. Dev-data reset is approved for the
            // Lantern rename, so old app-data folders are not migrated.
            match commands::data_dir::migrate_os_data_dir() {
                Some(outcome) => log::info!("[data-dir-setup] OS data dir: {outcome:?}"),
                None => log::warn!("[data-dir-setup] OS data dir unavailable; skipped"),
            }
            // Phase 3 M1 — manage shared RAG state (active workspace +
            // cancellation flag for the workspace indexer). Required by all
            // `rag_*` commands.
            commands::rag::manage_state(app);
            // Advisor Prep Hero Local AI sidecar state is empty at startup; the
            // llama-server process remains lazy until explicitly started.
            commands::local_llm::manage_state(app);
            // Phase 1 email — manage mail state (active workspace + cancel flag).
            commands::mail::manage_state(app);
            // Plan 1B.4 — manage CRM state (active workspace + sync flag + last report).
            commands::crm::commands::manage_state(app);
            // Lantern-Plus Track 2 — approval-gated external writeback state.
            commands::writeback::commands::manage_state(app);
            // OneDrive / SharePoint connector state.
            commands::onedrive::commands::manage_state(app);
            // Box connector state.
            commands::boxc::commands::manage_state(app);
            // ShareFile connector state.
            commands::sharefile::commands::manage_state(app);
            // Read-only DocuSign connector state.
            commands::docusign::commands::manage_state(app);
            // Read-only Jotform connector state.
            commands::jotform::commands::manage_state(app);
            // Read-only Zocks connector state.
            commands::zocks::commands::manage_state(app);
            // Read-only Addepar connector state.
            commands::addepar::commands::manage_state(app);
            // Calendly connector — manage workspace, single-flight sync, and progress.
            commands::calendly::commands::manage_state(app);
            // Calendar connector — workspace, single-flight sync, progress.
            commands::calendar::commands::manage_state(app);
            // Wave 3a SSO — manage the pending-sign-in cancel flag.
            commands::firm::sso::manage_state(app);
            // Advisor Prep Hero 3.0 — manage encrypted audit-store state (active workspace).
            commands::audit::manage_state(app);
            // Lantern Intake — manage encrypted fact-store state (active workspace).
            commands::intake::manage_state(app);
            // Onboarding/setup progress — register the aggregator state + the
            // listeners that bridge the five per-source events into one
            // `setup-progress-changed` notification.
            commands::setup_progress::manage_state(app);
            // Auto-updater stack. Desktop-only because the underlying
            // crates are gated to macOS / Windows / Linux in Cargo.toml.
            // The plugin reads endpoints + pubkey from tauri.conf.json so
            // registration here is just a no-arg builder.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Returns an explicitly requested, existing workspace directory for this
/// launch. `--workspace <dir>` takes precedence over `LANTERN_WORKSPACE`.
/// Invalid or absent values deliberately return `None`, preserving the normal
/// first-run picker rather than creating or opening an unexpected folder.
#[cfg(debug_assertions)]
fn explicit_launch_workspace() -> Option<String> {
    let cli_workspace = workspace_argument(std::env::args_os().skip(1));
    let candidate = cli_workspace
        .or_else(|| std::env::var_os("LANTERN_WORKSPACE").map(std::path::PathBuf::from))?;

    match canonical_existing_directory(candidate) {
        Some(path) => path.into_os_string().into_string().ok(),
        None => {
            log::warn!("[launch-workspace] ignoring missing or invalid explicit workspace");
            None
        }
    }
}

#[cfg(any(debug_assertions, test))]
fn workspace_argument<I>(args: I) -> Option<std::path::PathBuf>
where
    I: IntoIterator<Item = std::ffi::OsString>,
{
    let mut args = args.into_iter();
    while let Some(argument) = args.next() {
        if argument == "--workspace" {
            return args.next().map(std::path::PathBuf::from);
        }
        if let Some(value) = argument
            .to_str()
            .and_then(|value| value.strip_prefix("--workspace="))
        {
            return Some(std::path::PathBuf::from(value));
        }
    }
    None
}

#[cfg(any(debug_assertions, test))]
fn canonical_existing_directory(path: std::path::PathBuf) -> Option<std::path::PathBuf> {
    use std::path::Component;

    // This debug-only convenience must never quietly turn a visibly-relative
    // input into a different folder. It also refuses a symlink at the root so
    // automation cannot disguise the workspace it is about to open.
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

#[cfg(test)]
mod launch_workspace_tests {
    use super::{canonical_existing_directory, workspace_argument};
    use std::ffi::OsString;

    #[test]
    fn reads_a_separate_workspace_argument() {
        assert_eq!(
            workspace_argument([
                OsString::from("--workspace"),
                OsString::from("/tmp/lantern")
            ]),
            Some("/tmp/lantern".into())
        );
    }

    #[test]
    fn reads_an_equals_workspace_argument() {
        assert_eq!(
            workspace_argument([OsString::from("--workspace=/tmp/lantern")]),
            Some("/tmp/lantern".into())
        );
    }

    #[test]
    fn ignores_unrelated_arguments() {
        assert_eq!(
            workspace_argument([OsString::from("--other"), OsString::from("value")]),
            None
        );
    }

    #[test]
    fn accepts_only_an_existing_directory() {
        let directory = tempfile::tempdir().expect("temporary directory");
        assert_eq!(
            canonical_existing_directory(directory.path().to_path_buf()),
            Some(std::fs::canonicalize(directory.path()).expect("canonical directory"))
        );
        assert_eq!(
            canonical_existing_directory(directory.path().join("missing")),
            None
        );
    }

    #[test]
    fn rejects_parent_traversal_even_when_the_resolved_directory_exists() {
        let directory = tempfile::tempdir().expect("temporary directory");
        std::fs::create_dir(directory.path().join("child")).expect("child directory");
        let traversal = directory.path().join("child").join("..");
        assert_eq!(canonical_existing_directory(traversal), None);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_workspace_roots() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let target = directory.path().join("target");
        let link = directory.path().join("workspace-link");
        std::fs::create_dir(&target).expect("target directory");
        symlink(&target, &link).expect("workspace symlink");
        assert_eq!(canonical_existing_directory(link), None);
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn release_build_rejects_the_workspace_override_at_compile_time() {
        // This test only compiles in a non-debug test build. The host injection
        // and explicit_launch_workspace() are both cfg(debug_assertions), so
        // no release binary can read --workspace or LANTERN_WORKSPACE.
        assert!(!cfg!(debug_assertions));
    }
}
