//! data_dir.rs - the single seam for the per-workspace internal data folder.
//!
//! The internal namespace is now Lantern. Fresh workspaces use `.lantern` for
//! app-owned stores such as mail blobs, RAG data, audit state, and memory facts.
//! The dev-data reset for this rename is approved, so this module deliberately
//! does not migrate old pre-rename folders.

use std::path::{Path, PathBuf};

use crate::identity::{OS_DATA_SUBDIR, VAULT_META_FILE, WORKSPACE_DATA_DIR};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DirOutcome {
    FreshInstall,
    AlreadyMigrated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileOutcome {
    FreshInstall,
    AlreadyMigrated,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct WorkspaceMigrationReport {
    pub data_dir: DirOutcome,
    pub vault_meta: FileOutcome,
}

pub fn workspace_data_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(WORKSPACE_DATA_DIR)
}

pub fn workspace_data_dir_name(_workspace_root: &Path) -> &'static str {
    WORKSPACE_DATA_DIR
}

pub fn is_workspace_data_dir_name(name: &str) -> bool {
    name.eq_ignore_ascii_case(WORKSPACE_DATA_DIR)
}

pub fn resolve_workspace_relative(workspace_root: &Path, rel: &str) -> PathBuf {
    let normalized = rel.replace('\\', "/");
    let (first, rest) = match normalized.split_once('/') {
        Some((f, r)) => (f, Some(r)),
        None => (normalized.as_str(), None),
    };
    if is_workspace_data_dir_name(first) {
        let base = workspace_root.join(WORKSPACE_DATA_DIR);
        return match rest {
            Some(r) => base.join(r),
            None => base,
        };
    }
    workspace_root.join(rel)
}

pub fn migrate_workspace(workspace_root: &Path) -> WorkspaceMigrationReport {
    let data_dir = if workspace_root.join(WORKSPACE_DATA_DIR).exists() {
        DirOutcome::AlreadyMigrated
    } else {
        DirOutcome::FreshInstall
    };
    let vault_meta = if workspace_root.join(VAULT_META_FILE).exists() {
        FileOutcome::AlreadyMigrated
    } else {
        FileOutcome::FreshInstall
    };
    WorkspaceMigrationReport {
        data_dir,
        vault_meta,
    }
}

pub fn migrate_os_data_dir() -> Option<DirOutcome> {
    let base = dirs::data_dir()?;
    Some(if base.join(OS_DATA_SUBDIR).exists() {
        DirOutcome::AlreadyMigrated
    } else {
        DirOutcome::FreshInstall
    })
}

#[tauri::command]
pub fn migrate_workspace_data_dir(workspace_root: String) -> Result<WorkspaceMigrationReport, String> {
    let root = PathBuf::from(&workspace_root);
    if !root.is_dir() {
        return Err(format!("workspace root is not a directory: {workspace_root}"));
    }
    Ok(migrate_workspace(&root))
}

#[tauri::command]
pub fn resolve_workspace_data_dir_name(workspace_root: String) -> String {
    workspace_data_dir_name(&PathBuf::from(&workspace_root)).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn current_dir(root: &Path) -> PathBuf {
        root.join(WORKSPACE_DATA_DIR)
    }

    #[test]
    fn fresh_install_resolves_to_lantern_without_creating_anything() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let report = migrate_workspace(root);

        assert_eq!(report.data_dir, DirOutcome::FreshInstall);
        assert_eq!(workspace_data_dir(root), current_dir(root));
        assert_eq!(workspace_data_dir_name(root), WORKSPACE_DATA_DIR);
        assert!(!current_dir(root).exists());
    }

    #[test]
    fn existing_lantern_dir_is_ready_and_not_mutated() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(current_dir(root)).unwrap();
        fs::write(current_dir(root).join("memory.json"), b"{}").unwrap();

        let report = migrate_workspace(root);

        assert_eq!(report.data_dir, DirOutcome::AlreadyMigrated);
        assert_eq!(fs::read(current_dir(root).join("memory.json")).unwrap(), b"{}");
    }

    #[test]
    fn only_current_data_dir_name_is_internal() {
        assert!(is_workspace_data_dir_name(".lantern"));
        assert!(is_workspace_data_dir_name(".LANTERN"));
        assert!(!is_workspace_data_dir_name("docs"));
        assert!(!is_workspace_data_dir_name(".lantern-vault.json"));
    }

    #[test]
    fn resolve_relative_rewrites_current_prefix_to_workspace_data_dir() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let resolved = resolve_workspace_relative(root, ".lantern/mail/blobs/abc.enc");

        assert_eq!(resolved, current_dir(root).join("mail/blobs/abc.enc"));
    }

    #[test]
    fn resolve_relative_passes_through_non_data_dir_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let resolved = resolve_workspace_relative(root, "Mail/Inbox/msg.md");

        assert_eq!(resolved, root.join("Mail/Inbox/msg.md"));
    }

    #[test]
    fn vault_meta_reports_existing_current_file() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join(VAULT_META_FILE), b"{}").unwrap();

        let report = migrate_workspace(root);

        assert_eq!(report.vault_meta, FileOutcome::AlreadyMigrated);
    }
}
