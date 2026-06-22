// Business OS - Tauri Backend
// Local-first workspace for solo founders

// `pub` so the `keepance-mcp` sidecar binary (see `src/bin/mcp.rs`) can
// reuse the `commands::rag::{store, embedder, extractor}` helpers without
// duplicating code. The binary only touches the pure, Tauri-agnostic
// sub-modules; the `#[tauri::command]` wrapper fns stay host-only in
// practice even though the module path is now public.
pub mod commands;
// Shared Sidecar trait + concrete impls (ParakeetSidecar, and later
// PiperSidecar for Stream B TTS). The trait defines a lifecycle contract
// (start/stop/is_running) that long-lived daemon sidecars and fire-and-forget
// per-request sidecars both satisfy via appropriate no-ops.
pub mod sidecars;
// Cross-cutting utilities (process helpers, etc.).
pub mod util;

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
            commands::fs::check_path,
            commands::fs::get_home_dir,
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
            // Keepance 3.0 — encrypted, append-only audit store (the "defense file").
            commands::audit::audit_set_workspace,
            commands::audit::audit_append,
            commands::audit::audit_list,
            commands::audit::audit_count,
            commands::audit::audit_verify_integrity,
            // Phase 3 M1 RAG (LanceDB + fastembed-rs + e5-small).
            commands::rag::rag_set_workspace,
            commands::rag::rag_index_file,
            commands::rag::rag_index_workspace,
            commands::rag::rag_retrieve,
            // WS-B/C — citation verification (refuse answers whose citation doesn't verify).
            commands::rag::rag_verify_citation,
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
            // Keepance 3.0 email viewer — fetch + decrypt one stored message.
            commands::mail::mail_get_message,
            // Mail browse/search surface — metadata-only, never decrypts a blob.
            commands::mail::mail_list_messages,
            // WS-B/C — re-tag a mail folder's messages to a matter in place.
            commands::mail::mail_retag_folder_matter,
            // Re-tag a single message's RAG chunks to a matter in place.
            commands::mail::mail_retag_message_matter,
            // Clear every email's filing for a matter being deleted (BUG-042).
            commands::mail::mail_clear_matter_filings,
            // Fetch one attachment's bytes on demand (never writes to disk).
            commands::mail::mail_get_attachment,
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
            commands::mail::gmail_is_connected,
            commands::mail::gmail_disconnect,
            // Outlook loopback auth-code + PKCE (replaces device-code for personal accounts).
            commands::mail::outlook_connect,
            // Email send — compose and send from any connected provider (M365/Gmail/IMAP).
            commands::mail::mail_send,
            // Wave 3a SSO — firm-tier OIDC desktop dance (loopback + browser).
            commands::firm::sso::firm_sso_authenticate,
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
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Phase 3 M1 — manage shared RAG state (active workspace +
            // cancellation flag for the workspace indexer). Required by all
            // `rag_*` commands.
            commands::rag::manage_state(app);
            // Phase 1 email — manage mail state (active workspace + cancel flag).
            commands::mail::manage_state(app);
            // Keepance 3.0 — manage encrypted audit-store state (active workspace).
            commands::audit::manage_state(app);
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
