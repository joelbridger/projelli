// Business OS - Tauri Backend
// Local-first workspace for solo founders

mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::check_path,
            commands::fs::get_home_dir,
            commands::fs::open_in_explorer,
            commands::fs::detect_libreoffice,
            commands::fs::convert_doc_to_docx,
            commands::fs::convert_ppt_to_pdf,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
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
