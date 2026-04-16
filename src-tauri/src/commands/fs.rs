// Business OS - Filesystem Commands
// Custom filesystem operations that require native performance or capabilities

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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

/// Simple, stable, non-cryptographic hash used to key the PowerPoint preview
/// cache. The key is derived from the absolute canonical path + modification
/// time: two different files at different paths never collide, and the same
/// file opened twice hits the cache until it's edited on disk.
///
/// The goal is uniqueness + stability, not cryptographic strength. We avoid
/// pulling in the `sha2` crate for this one call site — a DJB2-style hash over
/// the bytes produces a 64-bit value which is plenty for cache keying.
fn djb2_hash(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 5381;
    for b in bytes {
        hash = hash
            .wrapping_mul(33)
            .wrapping_add(u64::from(*b));
    }
    hash
}

/// Convert a PowerPoint file (`.ppt` or `.pptx`) to PDF using LibreOffice in
/// headless mode, and cache the resulting PDF inside the OS temp directory so
/// reopening the same file is instant.
///
/// Cache strategy:
///   - Key = `<djb2(canonical_path)>_<mtime_unix_seconds>` → deterministic for
///     an unchanged file, automatically invalidated on edit because the mtime
///     moves forward.
///   - Location = `<tempdir>/projelli-ppt-cache/<key>.pdf`
///   - If the file already exists AND is newer than the source, skip
///     conversion and return the cached path immediately.
///
/// LibreOffice names its output after the input's stem, so after each
/// conversion the produced file is renamed into the cache-key path. The cache
/// directory is created lazily; we deliberately don't clean it here — the OS
/// temp dir takes care of that across reboots.
///
/// Returns `Err` if:
/// - LibreOffice isn't installed (`detect_libreoffice()` returns `None`)
/// - the input path doesn't exist, isn't a file, or isn't a `.ppt`/`.pptx`
/// - the soffice process exits non-zero (stderr is included in the message)
/// - the expected output file wasn't produced / couldn't be moved
#[tauri::command]
pub fn convert_ppt_to_pdf(input_path: String) -> Result<String, String> {
    let soffice = detect_libreoffice()?
        .ok_or_else(|| "LibreOffice not found on this system.".to_string())?;

    let input = Path::new(&input_path);
    if !input.exists() {
        return Err(format!("Input file does not exist: {}", input.display()));
    }
    if !input.is_file() {
        return Err(format!("Input path is not a file: {}", input.display()));
    }

    // Case-insensitive `.ppt` / `.pptx` check.
    let ext_ok = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ppt") || e.eq_ignore_ascii_case("pptx"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!(
            "Expected a .ppt or .pptx file, got: {}",
            input.display()
        ));
    }

    // Canonicalize so the cache key doesn't change based on how the user
    // opened the file (symlinks, relative paths, etc).
    let canonical = input
        .canonicalize()
        .map_err(|e| format!("Could not canonicalize input path: {}", e))?;

    // Source mtime in unix seconds. If for any reason the metadata query or
    // `duration_since(UNIX_EPOCH)` fails (pre-1970 timestamp, weird FS), fall
    // back to 0 so we still produce a deterministic key — worst case, we
    // re-convert more often than necessary.
    let mtime_secs: u64 = canonical
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let path_hash = djb2_hash(canonical.to_string_lossy().as_bytes());
    let cache_key = format!("{:016x}_{}", path_hash, mtime_secs);

    // Cache dir under the OS temp dir — survives across runs of the app.
    let mut cache_dir: PathBuf = std::env::temp_dir();
    cache_dir.push("projelli-ppt-cache");
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }

    let mut cached_pdf: PathBuf = cache_dir.clone();
    cached_pdf.push(format!("{}.pdf", cache_key));

    // Fast path: cached file exists and is at least as new as the source.
    if cached_pdf.exists() {
        let cached_mtime = cached_pdf
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if cached_mtime >= mtime_secs {
            return Ok(cached_pdf.display().to_string());
        }
    }

    // Slow path: run LibreOffice. `--outdir` is the cache dir; the produced
    // file will be named after the input's stem, which we then move into
    // place.
    let output = std::process::Command::new(&soffice)
        .arg("--headless")
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(&cache_dir)
        .arg(&canonical)
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

    let stem = canonical
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Could not determine file stem of {}", canonical.display()))?;
    let mut produced: PathBuf = cache_dir.clone();
    produced.push(format!("{}.pdf", stem));

    if !produced.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "LibreOffice reported success but no .pdf was produced at {}{}",
            produced.display(),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(" (stderr: {})", stderr)
            }
        ));
    }

    // If the cached file happens to already exist (e.g. a stale entry we
    // want to overwrite because the source is newer), rename will fail on
    // Windows. Remove the old one first.
    if cached_pdf.exists() {
        let _ = std::fs::remove_file(&cached_pdf);
    }
    std::fs::rename(&produced, &cached_pdf)
        .map_err(|e| format!("Failed to move converted PDF into cache: {}", e))?;

    Ok(cached_pdf.display().to_string())
}
