// Business OS - Filesystem Commands
// Custom filesystem operations that require native performance or capabilities

use serde::{Deserialize, Serialize};

/// Result of checking if a path exists
#[derive(Serialize, Deserialize)]
pub struct PathExistsResult {
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
}

/// Check if a path exists and get its type
#[tauri::command]
pub fn check_path(path: &str) -> Result<PathExistsResult, String> {
    let path = std::path::Path::new(path);

    if path.exists() {
        Ok(PathExistsResult {
            exists: true,
            is_file: path.is_file(),
            is_directory: path.is_dir(),
        })
    } else {
        Ok(PathExistsResult {
            exists: false,
            is_file: false,
            is_directory: false,
        })
    }
}

/// Get the home directory path
#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

/// Open a folder in the system file explorer
#[tauri::command]
pub fn open_in_explorer(path: &str) -> Result<(), String> {
    let path = std::path::Path::new(path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    let path_to_open = if path.is_file() {
        // If it's a file, open its parent directory
        path.parent().ok_or_else(|| "Could not get parent directory".to_string())?
    } else {
        path
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path_to_open)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
