// Business OS - Filesystem Commands
// Custom filesystem operations that require native performance or capabilities

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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

/// Detect whether LibreOffice (`soffice`) is installed on the user's system.
///
/// Returns `Ok(Some(path))` with the absolute path to the `soffice` binary if
/// found, or `Ok(None)` otherwise. Platform-specific detection:
///
/// - **Linux**: runs `which soffice`, then falls back to `/usr/bin/soffice` and
///   `/snap/bin/libreoffice` if that fails.
/// - **macOS**: checks `/Applications/LibreOffice.app/Contents/MacOS/soffice`.
/// - **Windows**: checks the standard Program Files install locations.
///
/// Only returns `Err` for truly unexpected system errors (e.g. permission
/// problems enumerating the filesystem); a missing binary is a normal
/// `Ok(None)` result.
#[tauri::command]
pub fn detect_libreoffice() -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        // Try `which soffice` first — most portable way to discover installs.
        if let Ok(output) = std::process::Command::new("which").arg("soffice").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && Path::new(&path).exists() {
                    return Ok(Some(path));
                }
            }
        }

        // Fallback 1: distro default
        let usr_bin = Path::new("/usr/bin/soffice");
        if usr_bin.exists() {
            return Ok(Some(usr_bin.display().to_string()));
        }

        // Fallback 2: snap package
        let snap = Path::new("/snap/bin/libreoffice");
        if snap.exists() {
            return Ok(Some(snap.display().to_string()));
        }

        Ok(None)
    }

    #[cfg(target_os = "macos")]
    {
        let mac = Path::new("/Applications/LibreOffice.app/Contents/MacOS/soffice");
        if mac.exists() {
            return Ok(Some(mac.display().to_string()));
        }
        Ok(None)
    }

    #[cfg(target_os = "windows")]
    {
        let paths = [
            "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        ];
        for p in paths.iter() {
            if Path::new(p).exists() {
                return Ok(Some((*p).to_string()));
            }
        }
        Ok(None)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

/// Convert a legacy `.doc` file to `.docx` using LibreOffice in headless mode.
///
/// Runs `soffice --headless --convert-to docx --outdir <parent> <input>` and
/// returns the absolute path of the produced `.docx` file. The output is
/// written next to the input (same parent directory, same stem, `.docx`
/// extension) because users generally want the converted copy alongside the
/// original — not buried in a temp directory.
///
/// NOTE: this function uses a blocking `output()` call with no external
/// timeout. LibreOffice normally converts a single `.doc` file in well under
/// 30 seconds, but on a heavily loaded system or with a pathological file it
/// may hang. We avoid pulling in the `wait-timeout` crate for a single call
/// site; if this becomes a problem in practice, switch to spawning the
/// process and polling `try_wait()` on a separate thread with a timeout
/// channel.
///
/// Returns `Err` if:
/// - LibreOffice isn't installed (`detect_libreoffice()` returns `None`)
/// - the input path doesn't exist, isn't a file, or doesn't end in `.doc`
/// - the soffice process exits non-zero (stderr is included in the message)
/// - the expected output file wasn't produced
#[tauri::command]
pub fn convert_doc_to_docx(input_path: String) -> Result<String, String> {
    let soffice = detect_libreoffice()?
        .ok_or_else(|| "LibreOffice not found on this system.".to_string())?;

    let input = Path::new(&input_path);
    if !input.exists() {
        return Err(format!("Input file does not exist: {}", input.display()));
    }
    if !input.is_file() {
        return Err(format!("Input path is not a file: {}", input.display()));
    }

    // Case-insensitive `.doc` check (reject `.docx` and everything else).
    let ext_ok = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("doc"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!(
            "Expected a .doc file, got: {}",
            input.display()
        ));
    }

    let parent = input
        .parent()
        .ok_or_else(|| format!("Could not determine parent directory of {}", input.display()))?;

    let output = std::process::Command::new(&soffice)
        .arg("--headless")
        .arg("--convert-to")
        .arg("docx")
        .arg("--outdir")
        .arg(parent)
        .arg(input)
        .output()
        .map_err(|e| format!("Failed to spawn LibreOffice: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        return Err(format!("LibreOffice conversion failed: {}", detail));
    }

    // Expected output: same stem, .docx extension, in the parent directory.
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Could not determine file stem of {}", input.display()))?;
    let mut expected: PathBuf = parent.to_path_buf();
    expected.push(format!("{}.docx", stem));

    if !expected.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "LibreOffice reported success but no .docx was produced at {}{}",
            expected.display(),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(" (stderr: {})", stderr)
            }
        ));
    }

    Ok(expected.display().to_string())
}
