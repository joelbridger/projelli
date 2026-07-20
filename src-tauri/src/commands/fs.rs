// Business OS - Filesystem Commands
// Custom filesystem operations that require native performance or capabilities

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Result of checking if a path exists
#[derive(Serialize, Deserialize)]
pub struct PathExistsResult {
    pub exists: bool,
    pub is_file: bool,
    pub is_directory: bool,
}

/// Grant the renderer filesystem access to a workspace directory at runtime.
///
/// The capability file no longer grants whole-disk access (`fs:scope` starts
/// EMPTY — see `capabilities/default.json`). Instead, when a workspace is
/// opened, `TauriFSBackend.setRootPath` calls this with the chosen root and we
/// extend the plugin fs scope to that directory and its descendants, right
/// before any fs-plugin call touches it. Files the user picks through a native
/// dialog are already granted by the dialog plugin itself; this covers the
/// workspace tree plus the non-dialog open paths (recent list, typed path,
/// create-new).
///
/// SECURITY NOTE (HD-4 shape): the path is renderer-supplied. Two independent
/// command-boundary guards run before anything is granted:
///
///  1. `is_dangerous_scope_root` refuses roots that would re-widen the
///     surface to the whole disk or the user's entire profile (filesystem root,
///     a bare drive root, the home directory itself, or any ancestor of it).
///  2. `protected_scope_root_for` refuses known protected system and
///     credential locations — `/etc`, `/usr`, `/bin`, `/sbin`, `C:\Windows`,
///     `C:\Program Files`, `~/.ssh`, the macOS keychain directory, the app's
///     own local-data directory, and so on. The capability `deny` list already
///     blocks reads inside those trees; this is DEFENSE IN DEPTH, an additional
///     layer at the command boundary, not a replacement for the deny list.
///
/// THE LAW — what each guard reads, and why the renderer cannot forge it:
///  - `path`: renderer-supplied. It is the SUBJECT being judged, never the
///    authority doing the judging. No policy is derived from it.
///  - `PROTECTED_SCOPE_ROOTS`: a compile-time `const` baked into the binary.
///  - `dirs::home_dir()` and the `SystemRoot`/`ProgramFiles`/… lookups: the
///    HOST PROCESS environment. A webview has no API that mutates its host
///    process's environment; anything that could set it already has native code
///    execution, which is outside this threat model.
///  - `app.path().app_local_data_dir()`: derived from the compiled bundle
///    identifier plus the OS data directory, taken from the `AppHandle` — it
///    never comes from the IPC payload.
///
/// This makes the grant strictly narrower than the former `**/*`, but it is
/// still NOT fully un-forgeable: a compromised renderer could name a specific
/// existing NON-system directory it is not meant to reach. Fully closing that
/// requires a backend-recorded set of paths the user actually picked in a
/// native dialog (only real picks populate it); called out in the c34 report as
/// follow-up.
#[tauri::command]
pub fn workspace_grant_fs_scope<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let raw = PathBuf::from(&path);
    if raw.as_os_str().is_empty() {
        return Err("workspace path is empty".to_string());
    }
    // Canonicalize when the directory already exists (the open flow); for the
    // create-new flow the directory does not exist yet, so fall back to the
    // lexical path. Either way both guards below still run.
    let resolved = raw.canonicalize().unwrap_or_else(|_| raw.clone());
    // The guards judge a lexically-normalised form so that a create-new path
    // that does not exist yet — where `canonicalize` cannot collapse anything —
    // cannot smuggle `..` past them (e.g. `/tmp/../etc/newdir`).
    let judged = normalize_lexically(&resolved);
    if is_dangerous_scope_root(&judged) {
        return Err(format!(
            "refusing to grant filesystem scope to a system or home-level directory: {}",
            judged.display()
        ));
    }
    let roots = protected_scope_roots(app.path().app_local_data_dir().ok());
    if let Some(root) = protected_scope_root_for(&judged, &roots) {
        return Err(format!(
            "refusing to grant filesystem scope inside a protected location ({}): {}",
            root.display(),
            judged.display()
        ));
    }
    let scope = app.fs_scope();
    scope
        .allow_directory(&resolved, true)
        .map_err(|error| format!("could not grant workspace filesystem scope: {error}"))?;
    // If canonicalization changed the spelling, also grant the raw form so a
    // path the renderer later builds with an equivalent-but-different spelling
    // still matches the scope.
    if resolved != raw {
        scope
            .allow_directory(&raw, true)
            .map_err(|error| format!("could not grant workspace filesystem scope: {error}"))?;
    }
    Ok(())
}

/// True if granting recursive fs access to `path` would re-open the whole disk
/// or the user's entire profile. Blocks the filesystem root, a bare drive root,
/// the home directory itself, and any ancestor of the home directory.
fn is_dangerous_scope_root(path: &Path) -> bool {
    // Filesystem root ("/") or a bare drive root ("C:\") has no parent.
    if path.parent().is_none() {
        return true;
    }
    let normal_components = path
        .components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count();
    if normal_components == 0 {
        return true;
    }
    if let Some(home) = dirs::home_dir() {
        if path == home {
            return true;
        }
        // `path` is an ancestor of the home directory (e.g. C:\Users, /home) —
        // too broad to grant recursively.
        if home.starts_with(path) {
            return true;
        }
    }
    false
}

/// Absolute locations that must never become a workspace scope root, nor
/// contain one. This MIRRORS the `fs:scope` `deny` list in
/// `capabilities/default.json` (`/etc`, `/usr/bin`, `/bin`, `/sbin`,
/// `C:/Windows`, `C:/Program Files`, `C:/Program Files (x86)`) and adds a few
/// unambiguous system directories no workspace can legitimately live in.
///
/// Both the POSIX and the Windows entries are listed UNCONDITIONALLY, with no
/// `cfg`: a Windows workspace path never matches a POSIX root and vice versa,
/// and keeping the list `cfg`-free means every platform's entries are compiled
/// and unit-tested on every platform — a `cfg`-gated list is only ever proved on
/// the machine that happens to build it (HD-3).
const PROTECTED_SCOPE_ROOTS: &[&str] = &[
    "/etc",
    // macOS canonicalises /etc to /private/etc, so the check must see both.
    "/private/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
];

/// Credential directories under the user's own home.
const PROTECTED_HOME_RELATIVE_ROOTS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    // macOS login keychain (also in the capability deny list).
    "Library/Keychains",
];

/// Windows environment variables that name a protected root. Read from the HOST
/// PROCESS environment (not from IPC); absent on other platforms, in which case
/// nothing is added.
const PROTECTED_ROOT_ENV_VARS: &[&str] = &[
    "SystemRoot",
    "windir",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramData",
];

/// Every form of the user's home directory worth matching against: the value
/// the OS reports, plus its canonicalised form when they differ (Fedora
/// Silverblue reports `/home/u` for a real `/var/home/u`; macOS data-volume
/// layouts do the same through firmlinks).
fn home_dir_forms() -> Vec<PathBuf> {
    let mut forms = Vec::new();
    if let Some(home) = dirs::home_dir() {
        if let Ok(canonical) = home.canonicalize() {
            if canonical != home {
                forms.push(canonical);
            }
        }
        forms.push(home);
    }
    forms
}

/// Build the protected-root list. `app_local_data` is the app's own local data
/// directory (the encrypted pool, the webview profile, the audit ledger) taken
/// from the `AppHandle`; passed in rather than looked up so this is unit
/// testable without a running app.
fn protected_scope_roots(app_local_data: Option<PathBuf>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = PROTECTED_SCOPE_ROOTS.iter().map(PathBuf::from).collect();

    for var in PROTECTED_ROOT_ENV_VARS {
        if let Some(value) = std::env::var_os(var) {
            let candidate = PathBuf::from(value);
            if candidate.is_absolute() {
                roots.push(candidate);
            }
        }
    }

    for home in home_dir_forms() {
        for relative in PROTECTED_HOME_RELATIVE_ROOTS {
            roots.push(home.join(relative));
        }
    }

    if let Some(app_local_data) = app_local_data {
        roots.push(app_local_data);
    }

    roots
}

/// The protected root that `path` is equal to or nested inside, if any.
///
/// A root that is an ancestor of the user's home directory is exempted only
/// for the home subtree: on layouts where home canonicalises under one of
/// these (`/var/home/<user>`, `/System/Volumes/Data/Users/<user>`) treating
/// that subtree as protected would refuse every legitimate workspace. Its
/// non-home siblings remain protected. Granting the ancestor ITSELF is still
/// refused — by `is_dangerous_scope_root`, which fires first.
fn protected_scope_root_for(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let homes = home_dir_forms();
    protected_scope_root_for_with_homes(path, roots, &homes)
}

/// The home-aware portion of [`protected_scope_root_for`], parameterized so
/// platform layouts can be tested without relying on the host machine.
fn protected_scope_root_for_with_homes(
    path: &Path,
    roots: &[PathBuf],
    homes: &[PathBuf],
) -> Option<PathBuf> {
    roots
        .iter()
        .find(|root| {
            let root_contains_home = homes.iter().any(|home| path_is_within(home, root));
            let path_is_in_home = homes.iter().any(|home| path_is_within(path, home));

            path_is_within(path, root) && !(root_contains_home && path_is_in_home)
        })
        .cloned()
}

/// `path == root` or `path` is nested under `root`, compared by whole path
/// components (so `/etcetera` is NOT inside `/etc`).
///
/// The second comparison is the Windows one: Windows paths are case-insensitive
/// and mix `/` with `\`, neither of which `Path::starts_with` accounts for. It
/// runs on every platform ON PURPOSE rather than behind a `cfg` — that way the
/// Windows matching is exercised by the unit tests on whatever host builds
/// them, instead of being a claim no test on this machine can settle (HD-3).
/// Running it on POSIX can only ever make the guard refuse MORE (a
/// case-variant spelling of a protected root); it never admits anything the
/// component comparison would have refused.
fn path_is_within(path: &Path, root: &Path) -> bool {
    if root.as_os_str().is_empty() {
        return false;
    }
    if path.starts_with(root) {
        return true;
    }
    let normalize = |p: &Path| p.to_string_lossy().replace('/', "\\").to_lowercase();
    let path = normalize(path);
    let root = normalize(root);
    let root = root.trim_end_matches('\\');
    if root.is_empty() {
        return false;
    }
    path == root || path.starts_with(&format!("{root}\\"))
}

/// Collapse `.` and `..` textually, without touching the filesystem. Used so the
/// guards judge the same location the OS would resolve, even for a path that
/// does not exist yet and therefore cannot be canonicalised. A leading `..` that
/// would escape above the root is kept (there is nothing above the root).
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut components = path.components().peekable();
    let mut out = if let Some(prefix @ Component::Prefix(..)) = components.peek().copied() {
        components.next();
        PathBuf::from(prefix.as_os_str())
    } else {
        PathBuf::new()
    };

    for component in components {
        match component {
            Component::Prefix(..) => unreachable!("prefix can only be the first component"),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                } else {
                    out.push("..");
                }
            }
            Component::Normal(part) => out.push(part),
        }
    }

    out
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

/// Open a path in the system file explorer.
///
/// Behaviour by entry type:
///   - **Directory**: opens the directory itself in the explorer/Finder/file
///     manager so the user sees its contents.
///   - **File**: on Windows uses `explorer /select,<path>` to open the parent
///     folder with the file highlighted; on macOS uses `open -R <path>` for
///     the same effect; on Linux passes the file path to `xdg-open` which
///     opens the parent application (most file managers handle this).
///
/// Returns `Err` with a clear message if the path does not exist. There is
/// no silent fallback: a bad path produces an error that callers surface as
/// a toast, rather than silently opening the user's home or Documents folder.

/// Validate that `path` exists on disk before we attempt to open it in the
/// file explorer. Extracted so tests can exercise the guard directly without
/// spawning a real system command (which has side effects and is
/// platform-specific).
///
/// Returns `Ok(is_file)` when the path exists, or `Err(message)` when it does not.
fn validate_explorer_path(path: &std::path::Path) -> Result<bool, String> {
    if !path.exists() {
        return Err(format!(
            "I could not find the path \"{}\" on disk. Make sure the workspace folder still exists.",
            path.display()
        ));
    }
    Ok(path.is_file())
}

#[tauri::command]
pub fn open_in_explorer(path: &str) -> Result<(), String> {
    let path = std::path::Path::new(path);

    // Delegate to the extracted validation fn so it is also exercised by tests.
    // `is_file` is used only in the Windows and macOS branches; allow unused
    // on Linux where xdg-open accepts both files and directories uniformly.
    #[allow(unused_variables)]
    let is_file = validate_explorer_path(path)?;

    #[cfg(target_os = "windows")]
    {
        use crate::util::proc::hide_console;
        if is_file {
            // /select,<path> opens the parent folder with the file highlighted.
            // Plain `explorer <path>` on a file path is unreliable and may open
            // Documents when the path has mixed separators.
            let select_arg = format!("/select,{}", path.display());
            let mut cmd = std::process::Command::new("explorer");
            cmd.arg(&select_arg);
            hide_console(&mut cmd);
            cmd.spawn()
                .map_err(|e| format!("I could not open File Explorer: {}", e))?;
        } else {
            let mut cmd = std::process::Command::new("explorer");
            cmd.arg(path);
            hide_console(&mut cmd);
            cmd.spawn()
                .map_err(|e| format!("I could not open File Explorer: {}", e))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        if is_file {
            // -R reveals (selects) the item in Finder rather than opening it.
            std::process::Command::new("open")
                .arg("-R")
                .arg(path)
                .spawn()
                .map_err(|e| format!("I could not open Finder: {}", e))?;
        } else {
            std::process::Command::new("open")
                .arg(path)
                .spawn()
                .map_err(|e| format!("I could not open Finder: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open on a file opens the associated application; on a directory
        // it opens the file manager. Both behaviours are correct here.
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("I could not open the file manager: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod open_in_explorer_tests {
    use super::{open_in_explorer, validate_explorer_path};

    /// Verify the path-existence guard via the REAL `validate_explorer_path` fn
    /// that `open_in_explorer` calls — NOT an inline copy. This ensures a
    /// regression in the production guard is caught here.
    #[test]
    fn nonexistent_path_returns_err_not_default() {
        let p = std::path::Path::new("/this/path/absolutely/does/not/exist/lantern-test-9f8a");
        let result = validate_explorer_path(p);
        assert!(result.is_err(), "expected Err for missing path, got Ok");
        let msg = result.unwrap_err();
        // The message must name the path so the user knows what went wrong.
        assert!(
            msg.contains("could not find"),
            "error message should say what went wrong, got: {msg}"
        );
        // Must name the path.
        assert!(
            msg.contains("lantern-test-9f8a"),
            "error message should include the path, got: {msg}"
        );
    }

    #[test]
    fn existing_directory_returns_ok_is_not_file() {
        // Use the system temp dir which is guaranteed to exist.
        let tmp = std::env::temp_dir();
        let result = validate_explorer_path(&tmp);
        assert!(result.is_ok(), "expected Ok for existing dir, got Err");
        assert!(!result.unwrap(), "temp dir should not be reported as a file");
    }

    #[test]
    fn existing_file_returns_ok_is_file() {
        // Create a real temp file so we can assert is_file == true.
        use std::io::Write;
        let mut tmp = std::env::temp_dir();
        tmp.push("lantern-open-explorer-test.tmp");
        {
            let mut f = std::fs::File::create(&tmp).expect("could not create temp file");
            f.write_all(b"test").expect("could not write temp file");
        }
        let result = validate_explorer_path(&tmp);
        let _ = std::fs::remove_file(&tmp); // clean up regardless of outcome
        assert!(result.is_ok(), "expected Ok for existing file, got Err");
        assert!(result.unwrap(), "existing file should be reported as is_file=true");
    }

    /// Call the REAL `open_in_explorer` Tauri command with a nonexistent path:
    /// it must return Err and never spawn a system process.
    /// Safe: `open_in_explorer` returns before any `Command::spawn()` when the
    /// path does not exist (the `validate_explorer_path` guard fires first).
    #[test]
    fn open_in_explorer_with_nonexistent_path_returns_err() {
        let result = open_in_explorer("/this/does/not/exist/lantern-explorer-guard");
        assert!(result.is_err(), "open_in_explorer must Err for missing path");
        let msg = result.unwrap_err();
        assert!(msg.contains("could not find"), "got: {msg}");
    }
}

#[cfg(test)]
mod workspace_scope_guard_tests {
    use super::is_dangerous_scope_root;
    use std::path::Path;

    #[test]
    fn filesystem_root_is_refused() {
        assert!(is_dangerous_scope_root(Path::new("/")));
    }

    #[test]
    fn home_directory_itself_is_refused() {
        if let Some(home) = dirs::home_dir() {
            assert!(
                is_dangerous_scope_root(&home),
                "granting the whole home dir would re-widen the surface"
            );
        }
    }

    #[test]
    fn an_ancestor_of_home_is_refused() {
        // The parent of the home directory (e.g. /home or C:\Users) contains
        // every user's profile — too broad to grant.
        if let Some(home) = dirs::home_dir() {
            if let Some(parent) = home.parent() {
                // Skip the degenerate case where home's parent is the fs root
                // (already covered by filesystem_root_is_refused).
                if parent.parent().is_some() {
                    assert!(is_dangerous_scope_root(parent));
                }
            }
        }
    }

    #[test]
    fn a_real_workspace_under_home_is_allowed() {
        if let Some(home) = dirs::home_dir() {
            let workspace = home.join("Advisor Prep Hero").join("Coast Wealth");
            assert!(
                !is_dangerous_scope_root(&workspace),
                "a genuine nested workspace must be grantable"
            );
        }
    }
}

/// Command-level rejection of known protected roots (c35 A3, defense in depth).
///
/// The capability `deny` list already refuses reads inside these trees. These
/// tests pin the ADDITIONAL layer: `workspace_grant_fs_scope` itself refuses
/// the grant at the command boundary, before `allow_directory` is ever called.
#[cfg(test)]
mod protected_scope_root_tests {
    use super::{
        normalize_lexically, path_is_within, protected_scope_root_for,
        protected_scope_root_for_with_homes, protected_scope_roots, workspace_grant_fs_scope,
    };
    use std::path::{Path, PathBuf};

    fn roots() -> Vec<PathBuf> {
        protected_scope_roots(None)
    }

    /// A mock app with the REAL `tauri-plugin-fs` registered, so
    /// `workspace_grant_fs_scope` runs end to end and the resulting scope can be
    /// interrogated — the refusal is proved by the scope still denying the
    /// protected path, not merely by an error string.
    fn mock_app_with_fs_plugin() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app with fs plugin")
    }

    /// THE NEGATIVE CONTROL for this lane.
    ///
    /// Calls the REAL `workspace_grant_fs_scope` Tauri command with `/etc` — a
    /// root the OLD code accepted (`is_dangerous_scope_root("/etc")` is false:
    /// it has a parent, it has normal components, and it is neither the home
    /// directory nor an ancestor of it). The command must now refuse it, and
    /// the message must name the PROTECTED guard so this cannot pass by
    /// accident through the pre-existing dangerous-root guard.
    ///
    /// Neuter the `protected_scope_root_for` block in the command and this test
    /// goes RED.
    #[test]
    fn command_refuses_a_known_protected_root() {
        use tauri_plugin_fs::FsExt;

        let app = mock_app_with_fs_plugin();
        let result = workspace_grant_fs_scope(app.handle().clone(), "/etc".to_string());
        assert!(
            result.is_err(),
            "workspace_grant_fs_scope must refuse a protected system root"
        );
        let message = result.unwrap_err();
        assert!(
            message.contains("protected location"),
            "must be refused by the protected-root guard specifically, got: {message}"
        );
        assert!(
            message.contains("/etc"),
            "refusal must name the offending root, got: {message}"
        );
        // The refusal is real, not cosmetic: nothing under /etc entered the
        // plugin's fs scope.
        assert!(
            !app.fs_scope().is_allowed("/etc/passwd"),
            "the refused root must NOT have been granted to the renderer"
        );
    }

    /// Same guard, reached through the create-new flow's shape: a path that does
    /// not exist yet (so `canonicalize` fails) and that hides the protected root
    /// behind `..`. The lexical normalisation must expose it.
    #[test]
    fn command_refuses_a_traversal_into_a_protected_root() {
        use tauri_plugin_fs::FsExt;

        let app = mock_app_with_fs_plugin();
        let result = workspace_grant_fs_scope(
            app.handle().clone(),
            "/tmp/lantern-a3/../../etc/ssh/lantern-not-a-workspace".to_string(),
        );
        let message = result.expect_err("traversal into /etc must be refused");
        assert!(message.contains("protected location"), "got: {message}");
        assert!(
            !app.fs_scope().is_allowed("/etc/ssh/ssh_host_rsa_key"),
            "the traversal target must NOT have been granted to the renderer"
        );
    }

    /// PR-2 positive control on the SAME code path: a genuine workspace still
    /// goes all the way through the command and really is granted. Proves the
    /// new layer does not fail closed on legitimate flows.
    #[test]
    fn command_still_grants_a_genuine_workspace() {
        use tauri_plugin_fs::FsExt;

        let app = mock_app_with_fs_plugin();
        let workspace = tempfile::tempdir().expect("workspace tempdir");
        let file = workspace.path().join("client.docx");
        std::fs::write(&file, b"in-workspace").expect("write workspace file");

        assert!(
            !app.fs_scope().is_allowed(&file),
            "precondition: nothing is granted before the command runs"
        );
        workspace_grant_fs_scope(
            app.handle().clone(),
            workspace.path().to_string_lossy().to_string(),
        )
        .expect("a genuine workspace must still be grantable");
        assert!(
            app.fs_scope().is_allowed(&file),
            "the workspace tree must be reachable after the grant"
        );
    }

    #[test]
    fn protected_roots_cover_the_capability_deny_list() {
        let roots = roots();
        for denied in [
            "/etc/shadow",
            "/usr/bin",
            "/bin/sh",
            "/sbin",
            "C:\\Windows\\System32",
            "C:\\Program Files\\Lantern",
            "C:\\Program Files (x86)\\Lantern",
        ] {
            assert!(
                protected_scope_root_for(Path::new(denied), &roots).is_some(),
                "{denied} is in the capability deny list; the command must refuse it too"
            );
        }
    }

    #[test]
    fn credential_directories_under_home_are_protected() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let roots = roots();
        for relative in [".ssh", ".ssh/id_rsa", ".gnupg", ".aws/credentials"] {
            let path = home.join(relative);
            assert!(
                protected_scope_root_for(&path, &roots).is_some(),
                "{} must be refused as a scope root",
                path.display()
            );
        }
    }

    #[test]
    fn the_apps_own_local_data_directory_is_protected() {
        let app_local_data = PathBuf::from("/home/someone/.local/share/com.lantern.app");
        let roots = protected_scope_roots(Some(app_local_data.clone()));
        assert!(
            protected_scope_root_for(&app_local_data.join("crm-core-enc.db"), &roots).is_some(),
            "$APPLOCALDATA is denied by the capability; the command must refuse it too"
        );
    }

    /// PR-2 self-diagnosis: the new layer must not break a legitimate flow. A
    /// genuine workspace — including one whose name merely resembles a
    /// protected root — stays grantable.
    #[test]
    fn a_genuine_workspace_is_not_protected() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let roots = roots();
        for relative in [
            "Advisor Prep Hero/Coast Wealth",
            "Documents/Clients",
            "Desktop/etc-planning", // NOT /etc
            "OneDrive/Advisor Prep Hero",
        ] {
            let path = home.join(relative);
            assert!(
                protected_scope_root_for(&path, &roots).is_none(),
                "{} is a legitimate workspace and must stay grantable",
                path.display()
            );
        }
    }

    /// A root that is an ancestor of the user's home must NOT poison every
    /// workspace (Fedora Silverblue: home is really `/var/home/<user>`).
    #[test]
    fn a_root_containing_the_home_directory_is_exempted() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let mut ancestors: Vec<PathBuf> = Vec::new();
        let mut cursor = home.parent();
        while let Some(parent) = cursor {
            if parent.parent().is_some() {
                ancestors.push(parent.to_path_buf());
            }
            cursor = parent.parent();
        }
        if ancestors.is_empty() {
            return;
        }
        let workspace = home.join("Advisor Prep Hero");
        assert!(
            protected_scope_root_for(&workspace, &ancestors).is_none(),
            "an ancestor of home must be exempted, or no workspace would ever be grantable"
        );
    }

    /// A protected root that contains home must not lose protection over its
    /// non-home siblings. This deliberately models a future `/var` root on a
    /// Silverblue-shaped layout; it must not depend on the host OS providing
    /// that arrangement.
    #[test]
    fn a_home_ancestor_root_keeps_non_home_siblings_protected() {
        let root = PathBuf::from("/var");
        let home = PathBuf::from("/var/home/advisor");
        let protected_sibling = Path::new("/var/lib/lantern/credentials.db");

        assert_eq!(
            protected_scope_root_for_with_homes(protected_sibling, &[root.clone()], &[home]),
            Some(root),
            "a protected root's non-home sibling must remain protected"
        );
    }

    /// The narrow exemption must still admit workspaces below home on the two
    /// layouts that motivated it. These are synthetic so the proof does not
    /// depend on the operating system that happens to run the test.
    #[test]
    fn home_ancestor_exemption_keeps_silverblue_and_macos_workspaces_grantable() {
        for (root, home) in [
            (PathBuf::from("/var"), PathBuf::from("/var/home/advisor")),
            (
                PathBuf::from("/System/Volumes/Data"),
                PathBuf::from("/System/Volumes/Data/Users/advisor"),
            ),
        ] {
            let workspace = home.join("Advisor Prep Hero/Coast Wealth");
            assert_eq!(
                protected_scope_root_for_with_homes(&workspace, &[root], &[home]),
                None,
                "a workspace under home must stay grantable"
            );
        }
    }

    #[test]
    fn similarly_named_siblings_are_not_treated_as_nested() {
        assert!(path_is_within(Path::new("/etc/ssh"), Path::new("/etc")));
        assert!(path_is_within(Path::new("/etc"), Path::new("/etc")));
        assert!(!path_is_within(Path::new("/etcetera"), Path::new("/etc")));
        assert!(!path_is_within(Path::new("/home/u/etc"), Path::new("/etc")));
    }

    #[test]
    fn lexical_normalisation_collapses_traversal() {
        assert_eq!(
            normalize_lexically(Path::new("/tmp/a/../../etc/x")),
            PathBuf::from("/etc/x")
        );
        assert_eq!(
            normalize_lexically(Path::new("/home/u/./ws")),
            PathBuf::from("/home/u/ws")
        );
        assert_eq!(
            normalize_lexically(Path::new("/home/u/ws")),
            PathBuf::from("/home/u/ws")
        );
    }
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

    let output = {
        use crate::util::proc::hide_console;
        let mut cmd = std::process::Command::new(&soffice);
        cmd.arg("--headless")
            .arg("--convert-to")
            .arg("docx")
            .arg("--outdir")
            .arg(parent)
            .arg(input);
        hide_console(&mut cmd);
        cmd.output().map_err(|e| format!("Failed to spawn LibreOffice: {}", e))?
    };

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

/// Extend the fs scope so the renderer may read a file this command just
/// produced OUTSIDE the workspace (the LibreOffice PDF cache under the OS temp
/// dir). The renderer reads these temp files through the fs plugin
/// (`readTauriFile`), and now that `fs:scope` is no longer whole-disk that read
/// would be refused unless the produced path is added to the runtime scope.
fn allow_generated_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_file(path)
        .map_err(|error| format!("could not grant read access to the generated file: {error}"))
}

/// Convert a PowerPoint file (`.ppt` or `.pptx`) to PDF using LibreOffice in
/// headless mode, and cache the resulting PDF inside the OS temp directory so
/// reopening the same file is instant.
///
/// Cache strategy:
///   - Key = `<djb2(canonical_path)>_<mtime_unix_seconds>` → deterministic for
///     an unchanged file, automatically invalidated on edit because the mtime
///     moves forward.
///   - Location = `<tempdir>/lantern-ppt-cache/<key>.pdf`
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
pub fn convert_ppt_to_pdf(app: AppHandle, input_path: String) -> Result<String, String> {
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
    cache_dir.push(crate::identity::CACHE_PPT_PREFIX);
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
            allow_generated_file(&app, &cached_pdf)?;
            return Ok(cached_pdf.display().to_string());
        }
    }

    // Slow path: run LibreOffice. `--outdir` is the cache dir; the produced
    // file will be named after the input's stem, which we then move into
    // place.
    let output = {
        use crate::util::proc::hide_console;
        let mut cmd = std::process::Command::new(&soffice);
        cmd.arg("--headless")
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(&cache_dir)
            .arg(&canonical);
        hide_console(&mut cmd);
        cmd.output().map_err(|e| format!("Failed to spawn LibreOffice: {}", e))?
    };

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

    allow_generated_file(&app, &cached_pdf)?;
    Ok(cached_pdf.display().to_string())
}

/// Convert a Word document (`.docx`) to PDF using LibreOffice in headless mode,
/// caching the result in the OS temp dir so re-exporting an unchanged file is
/// instant.
///
/// This is the PDF half of the document editor's Export control. The Word
/// (`.docx`) half is the in-house engine's own serialize (no LibreOffice
/// needed); only PDF requires a real Office renderer, which on user machines is
/// the bundled / expected LibreOffice. Mirrors [`convert_ppt_to_pdf`] exactly —
/// same cache strategy (`<djb2(canonical_path)>_<mtime>` keyed PDF under
/// `<tempdir>/lantern-docx-pdf-cache/`), same headless `soffice --convert-to
/// pdf` invocation — differing only in the accepted input extension and the
/// cache directory name.
///
/// Returns `Err` if:
/// - LibreOffice isn't installed (`detect_libreoffice()` returns `None`) — the
///   caller surfaces a friendly "install LibreOffice" message; we never fail
///   silently.
/// - the input path doesn't exist, isn't a file, or isn't a `.docx`
/// - the soffice process exits non-zero (stderr is included in the message)
/// - the expected output file wasn't produced / couldn't be moved
#[tauri::command]
pub fn convert_docx_to_pdf(app: AppHandle, input_path: String) -> Result<String, String> {
    let soffice = detect_libreoffice()?.ok_or_else(|| {
        "LibreOffice is required to export a PDF, but it was not found on this system. \
         Install LibreOffice (libreoffice.org) and try again. Your Word (.docx) export does \
         not need it."
            .to_string()
    })?;

    let input = Path::new(&input_path);
    if !input.exists() {
        return Err(format!("Input file does not exist: {}", input.display()));
    }
    if !input.is_file() {
        return Err(format!("Input path is not a file: {}", input.display()));
    }

    // Case-insensitive `.docx` check.
    let ext_ok = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("docx"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!("Expected a .docx file, got: {}", input.display()));
    }

    // Canonicalize so the cache key is stable across how the file was opened.
    let canonical = input
        .canonicalize()
        .map_err(|e| format!("Could not canonicalize input path: {}", e))?;

    let mtime_secs: u64 = canonical
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let path_hash = djb2_hash(canonical.to_string_lossy().as_bytes());
    let cache_key = format!("{:016x}_{}", path_hash, mtime_secs);

    let mut cache_dir: PathBuf = std::env::temp_dir();
    cache_dir.push(crate::identity::CACHE_DOCX_PDF_PREFIX);
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
            allow_generated_file(&app, &cached_pdf)?;
            return Ok(cached_pdf.display().to_string());
        }
    }

    // Slow path: run LibreOffice. `--outdir` is the cache dir; the produced file
    // is named after the input's stem, which we then move into place.
    let output = {
        use crate::util::proc::hide_console;
        let mut cmd = std::process::Command::new(&soffice);
        cmd.arg("--headless")
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(&cache_dir)
            .arg(&canonical);
        hide_console(&mut cmd);
        cmd.output().map_err(|e| format!("Failed to spawn LibreOffice: {}", e))?
    };

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

    // Overwrite a stale cache entry if present (rename fails on Windows otherwise).
    if cached_pdf.exists() {
        let _ = std::fs::remove_file(&cached_pdf);
    }
    std::fs::rename(&produced, &cached_pdf)
        .map_err(|e| format!("Failed to move converted PDF into cache: {}", e))?;

    allow_generated_file(&app, &cached_pdf)?;
    Ok(cached_pdf.display().to_string())
}
