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
            // Phase 2 Rust foundation for v1.5 (M1-M6 enable, Q7/Q12 real).
            commands::http::fetch_url_title,
            commands::http::ollama_list_models,
            commands::http::ollama_chat_stream,
            commands::keychain::keychain_set,
            commands::keychain::keychain_get,
            commands::keychain::keychain_delete,
            // Phase 3 M1 RAG (LanceDB + fastembed-rs + e5-small).
            commands::rag::rag_set_workspace,
            commands::rag::rag_index_file,
            commands::rag::rag_index_workspace,
            commands::rag::rag_retrieve,
            commands::rag::rag_cancel_indexing,
            commands::rag::rag_delete_path,
            // A3 — PDF RAG indexing bridge (JS extracts, Rust embeds+stores).
            commands::rag::rag_index_pdf_chunks,
            // G4 — Mail RAG indexing (encrypted chunk text in LanceDB).
            commands::rag::rag_index_mail_text,
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
            // Phase 1 email — Microsoft 365 import.
            commands::mail::mail_set_workspace,
            commands::mail::mail_begin_login,
            commands::mail::mail_poll_login,
            commands::mail::mail_is_connected,
            commands::mail::mail_sync_all,
            commands::mail::mail_cancel_sync,
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
            // Auto-updater stack. Desktop-only because the underlying
            // crates are gated to macOS / Windows / Linux in Cargo.toml.
            // The plugin reads endpoints + pubkey from tauri.conf.json so
            // registration here is just a no-arg builder.
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
